import { formatLocalIsoWall, parseIsoDate } from "@amilo/core";
import {
  listGoogleAccounts,
  upsertEvent,
  type Db,
} from "@amilo/db";
import { createCalendarEvent, type GoogleOAuthConfig } from "@amilo/google";
import { ensureAccessToken } from "./googleSync.js";

const NUDGE_MS = 60_000;

function toGoogleWall(iso: string, timezone: string): string {
  const d = parseIsoDate(iso);
  if (!d) return iso;
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(iso) && !/[zZ]|[+-]\d{2}:?\d{2}$/.test(iso)) {
    return iso.slice(0, 19);
  }
  return formatLocalIsoWall(d, timezone);
}

/** 1-minute calendar ping at `dueAt`. Overlaps meetings on purpose. */
export async function writeReminderCalendarNudge(opts: {
  db: Db;
  googleCfg: GoogleOAuthConfig | null;
  userId: string;
  timezone: string;
  title: string;
  dueAt: Date;
}): Promise<boolean> {
  if (!opts.googleCfg) return false;
  const accounts = await listGoogleAccounts(opts.db, opts.userId);
  const account = accounts.find((a) => a.label === "personal") ?? accounts[0];
  if (!account) return false;
  const { accessToken } = await ensureAccessToken(opts.db, opts.googleCfg, account);
  const startIso = opts.dueAt.toISOString();
  const endIso = new Date(opts.dueAt.getTime() + NUDGE_MS).toISOString();
  const title = `Reminder: ${opts.title}`.slice(0, 200);
  const created = await createCalendarEvent(accessToken, {
    title,
    startIso: toGoogleWall(startIso, opts.timezone),
    endIso: toGoogleWall(endIso, opts.timezone),
    timezone: opts.timezone,
    description: "Amilo 1-minute nudge",
    popupAtStart: true,
  });
  await upsertEvent(opts.db, {
    userId: opts.userId,
    source: "calendar",
    sourceId: `${account.id}:${created.id}`,
    title: created.summary ?? title,
    snippet: "Amilo reminder nudge",
    kind: "nudge",
    meta: {
      end: created.endIso,
      status: created.status,
      allDay: created.allDay,
      accountLabel: account.label,
      accountEmail: account.email,
      calendarId: created.id,
      amiloNudge: true,
    },
    occursAt: created.startIso ? new Date(created.startIso) : opts.dueAt,
  });
  return true;
}
