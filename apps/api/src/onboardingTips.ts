import {
  localDayBoundsUtc,
  localHm,
  markTipDelivered,
  resolveOnboardingTip,
  type OnboardingContext,
  type OnboardingTip,
  type ChannelPort,
} from "@amilo/core";
import { isInside24hWindow } from "@amilo/channels-whatsapp";
import { and, count, eq, ne, sql } from "drizzle-orm";
import {
  commitments,
  contextNodes,
  getUserPrefs,
  getWhatsAppAddress,
  getWhatsAppLastInbound,
  listGoogleAccounts,
  listOpenWatches,
  listPlaces,
  listUsersActiveForOnboarding,
  logMessage,
  patchUserPrefs,
  type Db,
  type OnboardingState,
  type UserPrefs,
} from "@amilo/db";

export async function buildOnboardingContext(
  db: Db,
  userId: string,
  prefs: UserPrefs,
): Promise<OnboardingContext> {
  const accounts = await listGoogleAccounts(db, userId);
  const places = await listPlaces(db, userId);
  const watches = await listOpenWatches(db, userId);
  const remRows = await db
    .select({ n: count() })
    .from(commitments)
    .where(
      and(
        eq(commitments.userId, userId),
        sql`${commitments.reason} in ('reminder', 'user_reminder')`,
      ),
    );
  const personRows = await db
    .select({ n: count() })
    .from(contextNodes)
    .where(
      and(
        eq(contextNodes.userId, userId),
        eq(contextNodes.kind, "person"),
        ne(contextNodes.label, "user"),
      ),
    );
  return {
    googleAccountCount: accounts.length,
    hasReceivedBrief: Boolean(prefs.lastMorningBriefDay || prefs.lastEveningBriefDay),
    hasPlaces: places.length > 0,
    tzConfirmed: prefs.tzConfirmed,
    hasReminder: Number(remRows[0]?.n ?? 0) > 0,
    hasWatch: watches.length > 0,
    hasMutedPattern: prefs.mutedPatterns.length > 0,
    hasContextPerson: Number(personRows[0]?.n ?? 0) > 0,
  };
}

export async function resolveAndStampTip(
  db: Db,
  userId: string,
  prefs: UserPrefs,
  localDay: string,
  opts?: { onDemand?: boolean },
): Promise<{ tip: OnboardingTip; next: OnboardingState } | null> {
  const ob = prefs.onboarding;
  if (!ob.startedAt || ob.guideComplete || ob.skipped) return null;
  if (!opts?.onDemand && ob.lastTipLocalDay === localDay) return null;
  const ctx = await buildOnboardingContext(db, userId, prefs);
  const tip = resolveOnboardingTip(
    ob,
    ctx,
    localDay,
    opts?.onDemand ? { onDemand: true } : {},
  );
  if (!tip) return null;
  const next = markTipDelivered(ob, tip, localDay);
  await patchUserPrefs(db, userId, { onboarding: next });
  return { tip, next };
}

/** Append tip under free-form morning brief text when eligible. */
export async function appendOnboardingTipToBrief(
  db: Db,
  userId: string,
  prefs: UserPrefs,
  localDay: string,
  briefText: string,
): Promise<string> {
  const hit = await resolveAndStampTip(db, userId, prefs, localDay);
  if (!hit) return briefText;
  return `${briefText}\n\n${hit.tip.text}`.slice(0, 3500);
}

/**
 * Standalone Day 2–7 tips for users still in the guide (esp. no Google).
 * Fires mid-morning local, inside WhatsApp 24h window only.
 */
export async function sendStandaloneOnboardingTips(opts: {
  db: Db;
  channel: ChannelPort;
  now?: Date;
  fireWindowMinutes?: number;
}): Promise<number> {
  const now = opts.now ?? new Date();
  const fireWindow = opts.fireWindowMinutes ?? 5;
  const users = await listUsersActiveForOnboarding(opts.db);
  let sent = 0;
  for (const u of users) {
    const prefs = u.prefs;
    const ob = prefs.onboarding;
    if (!ob.startedAt || ob.guideComplete || ob.skipped) continue;
    const tz = u.timezone || "Asia/Kolkata";
    const { day } = localDayBoundsUtc(tz, now);
    if (ob.lastTipLocalDay === day) continue;
    const hm = localHm(now, tz);
    // Mid-morning window around 09:00 (after typical 07:30 brief).
    if (!isHmNear(hm, "09:00", fireWindow)) continue;

    const accounts = await listGoogleAccounts(opts.db, u.id);
    // Google users get tips appended to morning brief; only solo-nudge no-Google
    // or Google users who somehow missed morning tip today.
    if (accounts.length > 0 && prefs.lastMorningBriefDay === day) continue;

    const waAddr = await getWhatsAppAddress(opts.db, u.id);
    const lastIn = waAddr ? await getWhatsAppLastInbound(opts.db, waAddr) : null;
    if (!isInside24hWindow(lastIn, now)) continue;

    // Fresh prefs in case morning brief just stamped
    const fresh = await getUserPrefs(opts.db, u.id);
    const hit = await resolveAndStampTip(opts.db, u.id, fresh, day);
    if (!hit) continue;
    try {
      const waMessageId = await opts.channel.send(u.id, { text: hit.tip.text });
      await logMessage(opts.db, {
        userId: u.id,
        channel: "whatsapp",
        direction: "out",
        kind: "text",
        bodyRef: hit.tip.text.slice(0, 500),
        meta: {
          onboardingTip: hit.tip.milestoneId,
          day,
          ...(waMessageId ? { waMessageId } : {}),
        },
      });
      sent += 1;
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "onboarding_tip_error",
          userId: u.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
  return sent;
}

function isHmNear(hm: string, target: string, windowMinutes: number): boolean {
  const [h, m] = hm.split(":").map(Number);
  const [th, tm] = target.split(":").map(Number);
  const cur = (h ?? 0) * 60 + (m ?? 0);
  const tgt = (th ?? 0) * 60 + (tm ?? 0);
  const diff = Math.abs(cur - tgt);
  return diff <= windowMinutes || diff >= 24 * 60 - windowMinutes;
}
