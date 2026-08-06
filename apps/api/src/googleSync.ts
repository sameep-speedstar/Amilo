import {
  isPromotionalMail,
  listCalendarToday,
  listRecentGmail,
  refreshAccessToken,
  type GoogleOAuthConfig,
} from "@amilo/google";
import { decryptToken, encryptToken } from "@amilo/google";
import {
  getGoogleAccount,
  listGoogleAccounts,
  matchesMutedPattern,
  updateGoogleSyncCursors,
  updateGoogleTokens,
  upsertEvent,
  type Db,
  type GoogleAccountRow,
} from "@amilo/db";

export async function ensureAccessToken(
  db: Db,
  cfg: GoogleOAuthConfig,
  account: GoogleAccountRow,
): Promise<{ accessToken: string; account: GoogleAccountRow }> {
  const skewMs = 60_000;
  if (account.expiresAt.getTime() > Date.now() + skewMs) {
    return {
      accessToken: decryptToken(cfg.encryptionKey, account.accessTokenEnc),
      account,
    };
  }
  const refresh = decryptToken(cfg.encryptionKey, account.refreshTokenEnc);
  const tokens = await refreshAccessToken(cfg, refresh);
  const accessTokenEnc = encryptToken(cfg.encryptionKey, tokens.accessToken);
  const refreshTokenEnc = encryptToken(
    cfg.encryptionKey,
    tokens.refreshToken ?? refresh,
  );
  await updateGoogleTokens(db, account.id, {
    accessTokenEnc,
    refreshTokenEnc,
    expiresAt: tokens.expiresAt,
  });
  const updated = (await getGoogleAccount(db, account.userId, account.label)) ?? account;
  return { accessToken: tokens.accessToken, account: updated };
}

async function syncOneAccount(
  db: Db,
  cfg: GoogleOAuthConfig,
  userId: string,
  account: GoogleAccountRow,
  timezone: string,
  mutedPatterns: string[],
): Promise<{ mail: number; skippedPromo: number; skippedMuted: number; calendar: number }> {
  const { accessToken, account: acct } = await ensureAccessToken(db, cfg, account);
  const emailTag = acct.email ?? acct.label;

  const gmail = await listRecentGmail(accessToken, acct.gmailHistoryId);
  let mail = 0;
  let skippedPromo = 0;
  let skippedMuted = 0;
  for (const m of gmail.messages) {
    if (isPromotionalMail(m)) {
      skippedPromo += 1;
      continue;
    }
    const hay = `${m.from} ${m.subject} ${m.snippet}`;
    if (matchesMutedPattern(hay, mutedPatterns)) {
      skippedMuted += 1;
      continue;
    }
    await upsertEvent(db, {
      userId,
      source: "gmail",
      sourceId: `${acct.id}:${m.id}`,
      actor: m.from.slice(0, 320),
      title: m.subject,
      snippet: m.snippet.slice(0, 2000),
      kind: "mail",
      meta: {
        threadId: m.threadId,
        labelIds: m.labelIds,
        accountLabel: acct.label,
        accountEmail: emailTag,
        gmailId: m.id,
      },
    });
    mail += 1;
  }

  const cal = await listCalendarToday(accessToken, timezone);
  let calendar = 0;
  for (const ev of cal) {
    if (ev.status === "cancelled") continue;
    await upsertEvent(db, {
      userId,
      source: "calendar",
      sourceId: `${acct.id}:${ev.id}`,
      title: ev.summary,
      snippet: ev.location,
      kind: "meeting",
      meta: {
        end: ev.endIso,
        status: ev.status,
        accountLabel: acct.label,
        accountEmail: emailTag,
        calendarId: ev.id,
      },
      occursAt: ev.startIso ? new Date(ev.startIso) : null,
    });
    calendar += 1;
  }

  await updateGoogleSyncCursors(db, acct.id, {
    gmailHistoryId: gmail.historyId,
  });

  return { mail, skippedPromo, skippedMuted, calendar };
}

/** Sync every linked Google account for the user. */
export async function syncGoogleForUser(
  db: Db,
  cfg: GoogleOAuthConfig,
  userId: string,
  timezone = "Asia/Kolkata",
  mutedPatterns: string[] = [],
): Promise<{
  mail: number;
  skippedPromo: number;
  skippedMuted: number;
  calendar: number;
  accounts: number;
}> {
  const accounts = await listGoogleAccounts(db, userId);
  if (!accounts.length) {
    throw new Error(
      "Google not connected — send: connect google personal (or work / another label)",
    );
  }

  let mail = 0;
  let skippedPromo = 0;
  let skippedMuted = 0;
  let calendar = 0;
  const errors: string[] = [];
  for (const account of accounts) {
    try {
      const r = await syncOneAccount(db, cfg, userId, account, timezone, mutedPatterns);
      mail += r.mail;
      skippedPromo += r.skippedPromo;
      skippedMuted += r.skippedMuted;
      calendar += r.calendar;
    } catch (err) {
      errors.push(
        `${account.label}(${account.email ?? "?"}): ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
  if (errors.length === accounts.length) {
    throw new Error(`Sync failed for all accounts:\n${errors.join("\n")}`);
  }
  return { mail, skippedPromo, skippedMuted, calendar, accounts: accounts.length };
}
