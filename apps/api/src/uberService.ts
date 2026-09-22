/**
 * Uber ride flow — OAuth tokens + estimate shortlist + confirm-before-request.
 * Requires UBER_CLIENT_ID/SECRET; Limited Access covers founder + up to 5 registered testers.
 */
import {
  buildUberAuthUrl,
  buildUberEstimates,
  createUberRideRequest,
  exchangeUberCode,
  refreshUberAccessToken,
  type UberEstimate,
  type UberOAuthConfig,
} from "@amilo/booking";
import { encodeOAuthState, decodeOAuthState, encryptToken, decryptToken } from "@amilo/google";
import {
  createPendingAction,
  deleteUberAccount,
  getUberAccount,
  listPlaces,
  upsertUberAccount,
  type Db,
} from "@amilo/db";
import { MapsClient } from "@amilo/google";
import type { OutboundMessage } from "@amilo/core";

export type UberRuntime = {
  oauth: UberOAuthConfig;
  encryptionKey: string;
  mapsApiKey: string | null;
};

export function uberConfigured(rt: UberRuntime | null | undefined): boolean {
  return Boolean(rt?.oauth.clientId && rt.oauth.clientSecret && rt.oauth.redirectUri);
}

export function buildUberConnectUrl(rt: UberRuntime, userId: string): string {
  const state = encodeOAuthState(rt.encryptionKey, userId, "uber");
  return buildUberAuthUrl(rt.oauth, state);
}

export async function completeUberOAuth(
  db: Db,
  rt: UberRuntime,
  opts: { code: string; state: string },
): Promise<{ userId: string }> {
  const { userId } = decodeOAuthState(rt.encryptionKey, opts.state);
  const tokens = await exchangeUberCode(rt.oauth, opts.code);
  await upsertUberAccount(db, {
    userId,
    scopes: tokens.scope,
    accessTokenEnc: encryptToken(rt.encryptionKey, tokens.accessToken),
    refreshTokenEnc: tokens.refreshToken
      ? encryptToken(rt.encryptionKey, tokens.refreshToken)
      : "",
    expiresAt: tokens.expiresAt,
  });
  return { userId };
}

async function accessTokenForUser(db: Db, rt: UberRuntime, userId: string): Promise<string | null> {
  const acct = await getUberAccount(db, userId);
  if (!acct) return null;
  const refreshEnc = acct.refreshTokenEnc?.trim();
  const needsRefresh = acct.expiresAt.getTime() < Date.now() + 60_000;
  if (!needsRefresh) {
    return decryptToken(rt.encryptionKey, acct.accessTokenEnc);
  }
  if (!refreshEnc) return decryptToken(rt.encryptionKey, acct.accessTokenEnc);
  const refreshed = await refreshUberAccessToken(
    rt.oauth,
    decryptToken(rt.encryptionKey, refreshEnc),
  );
  await upsertUberAccount(db, {
    userId,
    scopes: refreshed.scope || acct.scopes,
    accessTokenEnc: encryptToken(rt.encryptionKey, refreshed.accessToken),
    refreshTokenEnc: refreshed.refreshToken
      ? encryptToken(rt.encryptionKey, refreshed.refreshToken)
      : refreshEnc,
    expiresAt: refreshed.expiresAt,
  });
  return refreshed.accessToken;
}

async function resolveOrigin(
  db: Db,
  _maps: MapsClient | null,
  userId: string,
): Promise<{ lat: number; lng: number; label: string } | null> {
  const places = await listPlaces(db, userId);
  const home = places.find((p) => p.label === "home" && p.lat != null && p.lng != null);
  if (home?.lat != null && home.lng != null) {
    return { lat: home.lat, lng: home.lng, label: home.address || "home" };
  }
  const any = places.find((p) => p.lat != null && p.lng != null);
  if (any?.lat != null && any.lng != null) {
    return { lat: any.lat, lng: any.lng, label: any.address || any.label };
  }
  return null;
}

async function geocodeDest(
  maps: MapsClient,
  destination: string,
): Promise<{ lat: number; lng: number; label: string } | null> {
  const hit = await maps.geocode(destination);
  if (!hit) return null;
  return { lat: hit.lat, lng: hit.lng, label: destination.trim().slice(0, 80) };
}

function formatEstimateLines(estimates: UberEstimate[]): string {
  const letters = "ABCDEF";
  return estimates
    .slice(0, 5)
    .map((e, i) => {
      const id = letters[i]!;
      const price = e.estimate ?? (e.lowEstimateInr != null && e.highEstimateInr != null
        ? `₹${e.lowEstimateInr}–${e.highEstimateInr}`
        : "price on confirm");
      const eta =
        e.pickupEstimateSecs != null
          ? ` · ~${Math.max(1, Math.round(e.pickupEstimateSecs / 60))} min pickup`
          : "";
      return `${id}) ${e.displayName} — ${price}${eta}`;
    })
    .join("\n");
}

/**
 * Start Uber estimate shortlist. Creates pending `uber_ride_select` with estimate payload.
 */
export async function startUberRideFlow(
  db: Db,
  rt: UberRuntime,
  opts: { userId: string; destination: string },
): Promise<OutboundMessage[]> {
  const token = await accessTokenForUser(db, rt, opts.userId);
  if (!token) {
    const url = buildUberConnectUrl(rt, opts.userId);
    return [
      {
        text: `Link Uber first — then I can quote and book after you confirm.\n${url}`,
      },
    ];
  }
  if (!rt.mapsApiKey) {
    return [{ text: "Maps isn't configured — can't geocode a pickup/drop for Uber." }];
  }
  const maps = new MapsClient(rt.mapsApiKey);
  const origin = await resolveOrigin(db, maps, opts.userId);
  if (!origin) {
    return [
      {
        text: "Set a pickup first: home is <address> (or office is …). Then ask again for Uber.",
      },
    ];
  }
  const dest = await geocodeDest(maps, opts.destination);
  if (!dest) {
    return [{ text: `Couldn't find "${opts.destination}" on the map — try a clearer place name.` }];
  }

  let estimates: UberEstimate[];
  try {
    estimates = await buildUberEstimates(token, origin, dest);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/403|forbidden|privileged|scope/i.test(msg)) {
      return [
        {
          text: "Uber linked, but the ride-request scope isn't approved for this app yet (need Uber Full Access, or add your account under Limited Access testers).",
        },
      ];
    }
    return [{ text: `Uber quote failed: ${msg.slice(0, 160)}` }];
  }
  if (!estimates.length) {
    return [{ text: `No Uber products near ${origin.label} right now.` }];
  }

  const summary = [
    `Uber → ${dest.label}`,
    `From: ${origin.label}`,
    "",
    formatEstimateLines(estimates),
    "",
    "Reply with a letter to pick — Amilo won't request the ride until you confirm.",
  ].join("\n");

  await createPendingAction(db, {
    userId: opts.userId,
    kind: "uber_ride_select",
    summary: summary.slice(0, 480),
    payload: {
      origin,
      destination: dest,
      estimates: estimates.slice(0, 5),
    },
    expiresInMs: 10 * 60_000,
  });

  return [{ text: summary }];
}

export async function confirmUberRideSelection(
  db: Db,
  _rt: UberRuntime,
  opts: {
    userId: string;
    letter: string;
  },
): Promise<OutboundMessage[]> {
  const { getOpenPendingAction, createPendingAction } = await import("@amilo/db");
  const pending = await getOpenPendingAction(db, opts.userId);
  if (!pending || pending.kind !== "uber_ride_select") {
    return [{ text: "No Uber quote pending — ask again (e.g. book Uber to airport)." }];
  }
  const payload = pending.payload as {
    origin: { lat: number; lng: number; label: string };
    destination: { lat: number; lng: number; label: string };
    estimates: UberEstimate[];
  };
  const idx = opts.letter.toUpperCase().charCodeAt(0) - 65;
  const chosen = payload.estimates?.[idx];
  if (!chosen) {
    return [{ text: "Pick a letter from the Uber list (A–E)." }];
  }
  const price =
    chosen.estimate ??
    (chosen.lowEstimateInr != null
      ? `~₹${chosen.lowEstimateInr}${chosen.highEstimateInr != null ? `–${chosen.highEstimateInr}` : ""}`
      : "see Uber app");

  await createPendingAction(db, {
    userId: opts.userId,
    kind: "uber_ride_confirm",
    summary: `Uber ${chosen.displayName} → ${payload.destination.label} · ${price}`,
    payload: {
      origin: payload.origin,
      destination: payload.destination,
      productId: chosen.productId,
      displayName: chosen.displayName,
      fareId: chosen.fareId,
      estimate: price,
    },
    expiresInMs: 5 * 60_000,
  });

  return [
    {
      text: [
        `Proposed (uber_ride_confirm):`,
        `Uber ${chosen.displayName} → ${payload.destination.label}`,
        `From ${payload.origin.label} · ${price}`,
        "",
        "Reply yes to request the ride (charged on your Uber payment method), cancel to drop.",
      ].join("\n"),
    },
  ];
}

export async function executeUberRideConfirm(
  db: Db,
  rt: UberRuntime,
  opts: {
    userId: string;
    payload: Record<string, unknown>;
  },
): Promise<{ ok: boolean; message: string }> {
  const token = await accessTokenForUser(db, rt, opts.userId);
  if (!token) return { ok: false, message: "Uber isn't linked — send: connect uber" };

  const origin = opts.payload.origin as { lat: number; lng: number; label: string };
  const destination = opts.payload.destination as { lat: number; lng: number; label: string };
  const productId = String(opts.payload.productId ?? "");
  const fareId = opts.payload.fareId ? String(opts.payload.fareId) : null;
  const displayName = String(opts.payload.displayName ?? "Uber");
  if (!productId || !origin?.lat || !destination?.lat) {
    return { ok: false, message: "Missing ride details — ask for Uber again." };
  }

  try {
    const ride = await createUberRideRequest(token, {
      start: origin,
      end: destination,
      productId,
      fareId,
    });
    return {
      ok: true,
      message: [
        `Uber requested: ${displayName} → ${destination.label}`,
        `Status: ${ride.status}${ride.eta != null ? ` · ETA ${ride.eta} min` : ""}`,
        `Request ${ride.requestId.slice(0, 8)}… — track in the Uber app.`,
      ].join("\n"),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, message: `Uber request failed: ${msg.slice(0, 200)}` };
  }
}

export async function disconnectUber(db: Db, userId: string): Promise<string> {
  const ok = await deleteUberAccount(db, userId);
  return ok ? "Uber unlinked from Amilo." : "No Uber account was linked.";
}
