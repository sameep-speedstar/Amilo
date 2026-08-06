import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { createCursorBrain, createStubBrain } from "@amilo/brain-cursor";
import { createGrokBrain } from "@amilo/brain-grok";
import type { BrainPort } from "@amilo/brain-contract";
import {
  createWhatsAppChannel,
  isPhoneAllowed,
  parseWhatsAppWebhook,
  verifyWebhookSignature,
  type WindowStore,
} from "@amilo/channels-whatsapp";
import { handleInbound, type InboundMessage, type OrchestratorDeps } from "@amilo/core";
import {
  addMutedPattern,
  applyGraphUpdates,
  claimWebhookMessage,
  createDb,
  createReminder,
  deleteGoogleAccount,
  getUserById,
  getUserPrefs,
  getWhatsAppAddress,
  getWhatsAppLastInbound,
  listGoogleAccounts,
  logMessage,
  patchUserPrefs,
  removeMutedPattern,
  setCursorAgentId,
  setTimezoneConfirmed,
  setUserStatus,
  setUserTimezone,
  summarizeCalendarToday,
  summarizeContextGraph,
  summarizeOpenCommitments,
  summarizeRecentMail,
  touchWhatsAppInbound,
  upsertGoogleAccount,
  upsertWhatsAppUser,
  type Db,
} from "@amilo/db";
import {
  buildAuthUrl,
  decodeState,
  encryptToken,
  exchangeCode,
  fetchEmail,
  type GoogleOAuthConfig,
} from "@amilo/google";
import { googleConfigured, loadSettings, resolveBrainLabel } from "./config.js";
import { syncGoogleForUser } from "./googleSync.js";
import { startBriefWorker } from "./briefWorker.js";
import { startReminderWorker } from "./reminders.js";

loadEnv();

const settings = loadSettings();
const app = new Hono();
const db: Db = createDb(settings.databaseUrl);
const brainLabel = resolveBrainLabel(settings);
const googleOk = googleConfigured(settings);

const googleCfg: GoogleOAuthConfig | null = googleOk
  ? {
      clientId: settings.googleClientId,
      clientSecret: settings.googleClientSecret,
      redirectUri: settings.googleRedirectUri,
      encryptionKey: settings.tokenEncryptionKey,
    }
  : null;

function createBrain(): BrainPort {
  if (settings.xaiApiKey) {
    return createGrokBrain({
      apiKey: settings.xaiApiKey,
      model: settings.grokModel,
    });
  }
  if (settings.cursorApiKey) {
    return createCursorBrain({
      apiKey: settings.cursorApiKey,
      model: settings.cursorModel,
      repoUrl: settings.cursorBrainRepo,
      startingRef: settings.cursorBrainRef,
      agentStore: {
        get: async (userId) => {
          const u = await getUserById(db, userId);
          return u?.cursorAgentId ?? null;
        },
        set: async (userId, id) => {
          await setCursorAgentId(db, userId, id);
        },
      },
    });
  }
  return createStubBrain();
}

const brain = createBrain();

const windows: WindowStore = {
  getLastInbound: (waId) => getWhatsAppLastInbound(db, waId),
  setLastInbound: (waId, at) => touchWhatsAppInbound(db, waId, at),
};

const waChannel = createWhatsAppChannel({
  cfg: {
    accessToken: settings.wabaAccessToken,
    phoneNumberId: settings.wabaPhoneNumberId,
    appSecret: settings.wabaAppSecret,
  },
  windows,
  resolveAddress: async (userId) => {
    const addr = await getWhatsAppAddress(db, userId);
    if (!addr) throw new Error(`no whatsapp channel for user ${userId}`);
    return addr;
  },
});

function orchestratorDeps(): OrchestratorDeps {
  return {
    brain,
    channel: waChannel,
    resolveUserName: async (id) => {
      const u = await getUserById(db, id);
      return u?.name ?? "there";
    },
    isPaused: async (id) => {
      const u = await getUserById(db, id);
      return u?.status === "paused";
    },
    setPaused: async (id, p) => {
      await setUserStatus(db, id, p ? "paused" : "active");
    },
    getContextGraphSummary: (id) => summarizeContextGraph(db, id),
    applyGraphUpdates: async (opts) => {
      await applyGraphUpdates(db, {
        userId: opts.userId,
        userName: opts.userName,
        claim: opts.message,
        updates: opts.updates,
        ...(opts.sourceMessageId ? { sourceMessageId: opts.sourceMessageId } : {}),
      });
    },
    getGoogleAuthUrl: async (userId, label) => {
      if (!googleCfg) return null;
      return buildAuthUrl(googleCfg, userId, label);
    },
    listGoogleAccounts: async (userId) => {
      const rows = await listGoogleAccounts(db, userId);
      return rows.map((r) => ({ label: r.label, email: r.email }));
    },
    disconnectGoogle: async (userId, label) => {
      if (label === "all") return deleteGoogleAccount(db, userId);
      return deleteGoogleAccount(db, userId, label);
    },
    syncGoogle: async (userId) => {
      if (!googleCfg) throw new Error("Google OAuth not configured");
      const u = await getUserById(db, userId);
      const prefs = await getUserPrefs(db, userId);
      return syncGoogleForUser(
        db,
        googleCfg,
        userId,
        u?.timezone ?? "Asia/Kolkata",
        prefs.mutedPatterns,
      );
    },
    isGoogleConnected: async (userId) => {
      const rows = await listGoogleAccounts(db, userId);
      return rows.length > 0;
    },
    getBriefingContext: async (userId) => {
      const u = await getUserById(db, userId);
      const prefs = await getUserPrefs(db, userId);
      const timezone = u?.timezone ?? "Asia/Kolkata";
      return {
        timezone,
        openCommitmentsSummary: await summarizeOpenCommitments(db, userId, timezone),
        calendarToday: await summarizeCalendarToday(db, userId, timezone),
        recentMail: await summarizeRecentMail(db, userId, prefs.mutedPatterns),
        ignoredPatterns: prefs.mutedPatterns,
        vipList: prefs.vipList,
      };
    },
    briefingTemplates: {
      morning: settings.wabaTemplateMorning,
      evening: settings.wabaTemplateEvening,
      languageCode: "en",
    },
    addMutedPattern: (userId, pattern) => addMutedPattern(db, userId, pattern),
    removeMutedPattern: (userId, pattern) => removeMutedPattern(db, userId, pattern),
    listMutedPatterns: async (userId) => (await getUserPrefs(db, userId)).mutedPatterns,
    getTimezoneState: async (userId) => {
      const u = await getUserById(db, userId);
      const prefs = await getUserPrefs(db, userId);
      return {
        timezone: u?.timezone ?? "Asia/Kolkata",
        tzConfirmed: prefs.tzConfirmed,
      };
    },
    setTimezone: async (userId, timezone, confirmed) => {
      await setUserTimezone(db, userId, timezone, { confirmed });
    },
    confirmTimezone: async (userId) => {
      await setTimezoneConfirmed(db, userId, true);
    },
    createReminders: async (userId, items) => {
      const out: Array<{ title: string; dueAt: Date }> = [];
      for (const item of items) {
        await createReminder(db, { userId, title: item.title, dueAt: item.dueAt });
        out.push(item);
      }
      return out;
    },
    getBriefSchedule: async (userId) => {
      const u = await getUserById(db, userId);
      const prefs = await getUserPrefs(db, userId);
      return {
        enabled: prefs.briefsEnabled,
        morningHm: prefs.morningHm,
        eveningHm: prefs.eveningHm,
        quietStartHm: prefs.quietStartHm,
        quietEndHm: prefs.quietEndHm,
        timezone: u?.timezone ?? "Asia/Kolkata",
      };
    },
    setBriefsEnabled: async (userId, enabled) => {
      await patchUserPrefs(db, userId, { briefsEnabled: enabled });
    },
    setBriefSlot: async (userId, slot, hm) => {
      if (slot === "morning") await patchUserPrefs(db, userId, { morningHm: hm });
      else await patchUserPrefs(db, userId, { eveningHm: hm });
    },
    setQuietHours: async (userId, startHm, endHm) => {
      await patchUserPrefs(db, userId, {
        quietStartHm: startHm,
        quietEndHm: endHm,
      });
    },
  };
}

async function processInbound(rawJson: unknown): Promise<void> {
  const messages = parseWhatsAppWebhook(rawJson);
  for (const parsed of messages) {
    const claimed = await claimWebhookMessage(db, parsed.messageId);
    if (!claimed) {
      console.log(JSON.stringify({ event: "wa_dup_skip", id: parsed.messageId }));
      continue;
    }

    if (!isPhoneAllowed(parsed.waId, settings.allowedPhones)) {
      console.log(
        JSON.stringify({
          event: "wa_ignored_not_allowlisted",
          waId: parsed.waId.slice(0, 4) + "…",
        }),
      );
      continue;
    }

    const user = await upsertWhatsAppUser(db, {
      phoneE164: parsed.phoneE164,
      waId: parsed.waId,
      ...(parsed.profileName ? { profileName: parsed.profileName } : {}),
    });
    await touchWhatsAppInbound(db, parsed.waId, parsed.timestamp);

    await logMessage(db, {
      userId: user.id,
      channel: "whatsapp",
      direction: "in",
      kind: parsed.kind,
      bodyRef: parsed.content.slice(0, 500),
      meta: { waMessageId: parsed.messageId },
    });

    if (parsed.kind === "voice") {
      const text = "Voice notes land in a later milestone — send text for now, or help.";
      await waChannel.send(user.id, { text });
      await logMessage(db, {
        userId: user.id,
        channel: "whatsapp",
        direction: "out",
        kind: "text",
        bodyRef: text,
      });
      continue;
    }

    const inbound: InboundMessage = {
      userId: user.id,
      channel: "whatsapp",
      kind: parsed.kind,
      content: parsed.content,
      messageId: parsed.messageId,
      ts: parsed.timestamp,
      ...(parsed.mediaId ? { mediaRef: parsed.mediaId } : {}),
    };

    console.log(
      JSON.stringify({
        event: "wa_inbound",
        userId: user.id,
        phone: parsed.phoneE164,
        kind: parsed.kind,
        chars: parsed.content.length,
        brain: brainLabel,
      }),
    );

    try {
      const outbound = await handleInbound(inbound, orchestratorDeps());

      for (const msg of outbound) {
        await waChannel.send(user.id, msg);
        await logMessage(db, {
          userId: user.id,
          channel: "whatsapp",
          direction: "out",
          kind: "templateName" in msg ? "template" : "text",
          bodyRef: "templateName" in msg ? msg.templateName : msg.text.slice(0, 500),
          meta: "templateName" in msg ? { template: msg.templateName } : {},
        });
      }
      console.log(
        JSON.stringify({
          event: "wa_outbound",
          userId: user.id,
          count: outbound.length,
        }),
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ event: "wa_process_error", error: errMsg }));
      try {
        const text =
          /permission-denied|credits or licenses/i.test(errMsg)
            ? "Grok API has no credits on this xAI team — add billing at console.x.ai, then try again."
            : "Something went wrong on my side — try again in a moment.";
        await waChannel.send(user.id, { text });
        await logMessage(db, {
          userId: user.id,
          channel: "whatsapp",
          direction: "out",
          kind: "text",
          bodyRef: text,
        });
      } catch {
        /* already logged */
      }
    }
  }
}

app.get("/health", async (c) => {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return c.json({
    ok: true,
    service: "amilo",
    brain: brainLabel,
    google: googleOk ? "configured" : "off",
    db: dbOk ? "up" : "down",
    milestone: "M4.2",
  });
});

app.get("/oauth/google/callback", async (c) => {
  if (!googleCfg) {
    return c.html("<h1>Google OAuth not configured</h1>", 503);
  }
  const err = c.req.query("error");
  if (err) {
    return c.html(`<h1>Google connect cancelled</h1><p>${err}</p>`, 400);
  }
  const code = c.req.query("code");
  const state = c.req.query("state");
  if (!code || !state) {
    return c.html("<h1>Missing code/state</h1>", 400);
  }
  try {
    const { userId, label } = decodeState(googleCfg, state);
    const tokens = await exchangeCode(googleCfg, code);
    if (!tokens.refreshToken) {
      return c.html(
        "<h1>No refresh token</h1><p>Revoke Amilo access in Google Account permissions and try connect google again with consent.</p>",
        400,
      );
    }
    const email = await fetchEmail(tokens.accessToken);
    await upsertGoogleAccount(db, {
      userId,
      label,
      email,
      scopes: tokens.scope || googleCfg.clientId,
      accessTokenEnc: encryptToken(googleCfg.encryptionKey, tokens.accessToken),
      refreshTokenEnc: encryptToken(googleCfg.encryptionKey, tokens.refreshToken),
      expiresAt: tokens.expiresAt,
    });
    console.log(JSON.stringify({ event: "google_connected", userId, email, label }));
    return c.html(
      `<!doctype html><html><body style="font-family:system-ui;padding:2rem">
        <h1>Amilo connected</h1>
        <p>Linked <strong>${email}</strong> as <code>${label}</code>. Return to WhatsApp and send <code>sync</code> or <code>brief</code>.</p>
        <p>Add another inbox: <code>connect google work</code> (or any label).</p>
      </body></html>`,
    );
  } catch (e) {
    console.error(
      JSON.stringify({
        event: "google_oauth_error",
        error: e instanceof Error ? e.message : String(e),
      }),
    );
    return c.html(
      `<h1>Connect failed</h1><p>${e instanceof Error ? e.message : String(e)}</p>`,
      400,
    );
  }
});

app.get("/webhooks/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && token === settings.wabaVerifyToken && challenge) {
    return c.text(challenge);
  }
  return c.text("Forbidden", 403);
});

app.post("/webhooks/whatsapp", async (c) => {
  const raw = Buffer.from(await c.req.arrayBuffer());
  if (settings.wabaAppSecret) {
    const sig = c.req.header("x-hub-signature-256");
    if (!verifyWebhookSignature(settings.wabaAppSecret, raw, sig)) {
      console.error(JSON.stringify({ event: "wa_bad_signature" }));
      return c.json({ error: "invalid signature" }, 401);
    }
  }

  let json: unknown = {};
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  try {
    await processInbound(json);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "wa_async_error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return c.json({ received: true });
});

app.post("/dev/chat", async (c) => {
  if (settings.nodeEnv === "production") {
    return c.json({ error: "disabled in production" }, 404);
  }
  const body = await c.req.json<{ phone?: string; text?: string; name?: string }>();
  const phone = body.phone ?? settings.allowedPhones[0] ?? "+910000000000";
  const waId = phone.replace(/\D/g, "");
  const user = await upsertWhatsAppUser(db, {
    phoneE164: phone.startsWith("+") ? phone : `+${waId}`,
    waId,
    ...(body.name ? { profileName: body.name } : {}),
  });
  const deps = orchestratorDeps();
  const outbound = await handleInbound(
    {
      userId: user.id,
      channel: "web",
      kind: "text",
      content: body.text ?? "",
      ts: new Date(),
    },
    {
      ...deps,
      channel: {
        async send() {
          /* no-op */
        },
      },
      resolveUserName: async () => body.name ?? user.name ?? "Sameep",
    },
  );
  return c.json({ userId: user.id, brain: brainLabel, outbound });
});

const port = settings.port;
serve({ fetch: app.fetch, port, createServer }, (info) => {
  console.log(
    `Amilo API listening on :${info.port} (brain=${brainLabel}, google=${googleOk ? "on" : "off"}, milestone=M4.2)`,
  );
});

startReminderWorker({
  db,
  channel: waChannel,
  alertTemplate: settings.wabaTemplateAlert,
  languageCode: "en",
  intervalMs: 30_000,
});

startBriefWorker({
  db,
  channel: waChannel,
  googleCfg,
  morningTemplate: settings.wabaTemplateMorning,
  eveningTemplate: settings.wabaTemplateEvening,
  languageCode: "en",
  intervalMs: 60_000,
});
