import {
  buildInboundConflictAlert,
  findInboundInviteConflicts,
  formatLocalWhenFriendly,
  isInQuietHours,
  localDayBoundsUtc,
  underWatcherDailyCap,
  type ChannelPort,
  type InboundCalendarBlock,
} from "@amilo/core";
import { and, eq } from "drizzle-orm";
import {
  countWatcherAlertsToday,
  createPendingAction,
  events,
  getUserById,
  getUserPrefs,
  listGoogleAccounts,
  listUsersWithGoogleForScan,
  logMessage,
  markCalendarConflictAlerted,
  type Db,
} from "@amilo/db";
import { listCalendarRange, type GoogleOAuthConfig } from "@amilo/google";
import { ensureAccessToken } from "./googleSync.js";

/**
 * Live-scan connected calendars for inbound invites that overlap existing blocks.
 * Creates a calendar_conflict pending + WhatsApp alert (capped / quiet hours).
 */
export async function scanInboundCalendarConflicts(opts: {
  db: Db;
  googleCfg: GoogleOAuthConfig;
  channel: ChannelPort;
  userId: string;
  alertTemplate?: string;
  languageCode?: string;
  now?: Date;
}): Promise<{ alerted: number }> {
  const now = opts.now ?? new Date();
  const user = await getUserById(opts.db, opts.userId);
  if (!user || user.status === "paused" || user.status === "deleted") {
    return { alerted: 0 };
  }
  const timezone = user.timezone || "Asia/Kolkata";
  const prefs = await getUserPrefs(opts.db, opts.userId);
  if (isInQuietHours(now, timezone, prefs.quietStartHm, prefs.quietEndHm)) {
    return { alerted: 0 };
  }
  const sentToday = await countWatcherAlertsToday(opts.db, opts.userId, now);
  if (!underWatcherDailyCap(sentToday)) return { alerted: 0 };

  const accounts = await listGoogleAccounts(opts.db, opts.userId);
  if (!accounts.length) return { alerted: 0 };

  const rangeStart = localDayBoundsUtc(timezone, now).timeMin;
  const rangeEnd = new Date(now.getTime() + 7 * 86_400_000);
  const blocks: InboundCalendarBlock[] = [];

  for (const acct of accounts) {
    try {
      const { accessToken } = await ensureAccessToken(opts.db, opts.googleCfg, acct);
      const live = await listCalendarRange(accessToken, rangeStart, rangeEnd, timezone);
      const accountEmail = (acct.email ?? "").toLowerCase();
      for (const ev of live) {
        if (ev.status === "cancelled" || !ev.startIso) continue;
        const start = new Date(ev.startIso);
        const end = ev.endIso
          ? new Date(ev.endIso)
          : new Date(start.getTime() + 60 * 60 * 1000);
        if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) continue;

        const sourceId = `${acct.id}:${ev.id}`;
        const row = await opts.db.query.events.findFirst({
          where: and(
            eq(events.userId, opts.userId),
            eq(events.source, "calendar"),
            eq(events.sourceId, sourceId),
          ),
        });
        const meta = (row?.meta ?? {}) as { conflictAlertedAt?: unknown };
        blocks.push({
          eventId: ev.id,
          title: (ev.summary ?? "Event").trim() || "Event",
          start,
          end,
          allDay: ev.allDay,
          organizerEmail: ev.organizerEmail,
          selfResponseStatus: ev.selfResponseStatus,
          accountEmail,
          createdIso: ev.createdIso,
          conflictAlerted: Boolean(meta.conflictAlertedAt),
        });
      }
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "inbound_conflict_list_error",
          userId: opts.userId,
          label: acct.label,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }

  const hits = findInboundInviteConflicts(blocks, timezone, now);
  if (!hits.length) return { alerted: 0 };

  // One alert per tick (attention discipline).
  const hit = hits[0]!;
  const body = buildInboundConflictAlert(hit, timezone);
  const inv = hit.invite;
  const account = accounts.find(
    (a) => (a.email ?? "").toLowerCase() === (inv.accountEmail ?? "").toLowerCase(),
  ) ?? accounts[0]!;

  const summary = `Conflict: ${inv.title} vs ${hit.blockers[0]?.title ?? "busy"}`;
  await createPendingAction(opts.db, {
    userId: opts.userId,
    kind: "calendar_conflict",
    summary,
    payload: {
      accountLabel: account.label,
      accountEmail: inv.accountEmail ?? account.email,
      eventId: inv.eventId,
      title: inv.title,
      start: inv.start.toISOString(),
      end: inv.end.toISOString(),
      startIso: inv.start.toISOString(),
      endIso: inv.end.toISOString(),
      organizerEmail: inv.organizerEmail,
      conflictWith: hit.blockers[0]?.title ?? "an existing block",
      conflictWithStart: hit.blockers[0]?.start.toISOString(),
      conflictWithEnd: hit.blockers[0]?.end.toISOString(),
      ...(hit.suggested
        ? {
            suggestedStart: hit.suggested.start.toISOString(),
            suggestedEnd: hit.suggested.end.toISOString(),
          }
        : {}),
    },
    expiresInMs: 6 * 60 * 60 * 1000,
  });

  const name = (user.name || "there").split(/\s+/)[0] || "there";
  let sent = false;
  try {
    const waMessageId = await opts.channel.send(opts.userId, { text: body });
    await logMessage(opts.db, {
      userId: opts.userId,
      channel: "whatsapp",
      direction: "out",
      kind: "text",
      bodyRef: body.slice(0, 500),
      meta: {
        watchId: `calconflict:${inv.eventId}`,
        watchKind: "calendar_conflict",
        calendarConflictEventId: inv.eventId,
        ...(waMessageId ? { waMessageId } : {}),
      },
    });
    sent = true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (/Outside 24h|24h window/i.test(msg) && opts.alertTemplate) {
      const param = body.replace(/\n/g, " ").replace(/\s{2,}/g, " ").slice(0, 900);
      const waMessageId = await opts.channel.send(opts.userId, {
        templateName: opts.alertTemplate,
        languageCode: opts.languageCode ?? "en",
        variables: [name, param],
      });
      await logMessage(opts.db, {
        userId: opts.userId,
        channel: "whatsapp",
        direction: "out",
        kind: "template",
        bodyRef: param.slice(0, 500),
        meta: {
          watchId: `calconflict:${inv.eventId}`,
          watchKind: "calendar_conflict",
          calendarConflictEventId: inv.eventId,
          via: "template",
          ...(waMessageId ? { waMessageId } : {}),
        },
      });
      sent = true;
    } else {
      console.error(
        JSON.stringify({
          event: "inbound_conflict_send_error",
          userId: opts.userId,
          error: msg,
        }),
      );
    }
  }

  if (sent) {
    await markCalendarConflictAlerted(opts.db, opts.userId, inv.eventId, now);
    console.log(
      JSON.stringify({
        event: "inbound_conflict_alerted",
        userId: opts.userId,
        eventId: inv.eventId,
        conflictWith: hit.blockers[0]?.title,
        when: formatLocalWhenFriendly(inv.start, timezone),
      }),
    );
    return { alerted: 1 };
  }
  return { alerted: 0 };
}

/** Scan all Google-connected active users (watch-worker tick). */
export async function scanInboundConflictsForAllUsers(opts: {
  db: Db;
  googleCfg: GoogleOAuthConfig | null;
  channel: ChannelPort;
  alertTemplate?: string;
  languageCode?: string;
}): Promise<void> {
  if (!opts.googleCfg) return;
  const users = await listUsersWithGoogleForScan(opts.db);
  for (const u of users) {
    try {
      await scanInboundCalendarConflicts({
        db: opts.db,
        googleCfg: opts.googleCfg,
        channel: opts.channel,
        userId: u.id,
        ...(opts.alertTemplate ? { alertTemplate: opts.alertTemplate } : {}),
        ...(opts.languageCode ? { languageCode: opts.languageCode } : {}),
      });
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "inbound_conflict_user_error",
          userId: u.id,
          error: err instanceof Error ? err.message : String(err),
        }),
      );
    }
  }
}
