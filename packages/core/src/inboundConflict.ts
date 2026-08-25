import {
  checkSlotConflicts,
  findOverlappingBlocks,
  type CalendarBlock,
} from "./calendarConflict.js";
import { formatLocalHm, formatLocalDayShort } from "./time.js";

export type InboundCalendarBlock = CalendarBlock & {
  eventId: string;
  /** Organizer email when known. */
  organizerEmail?: string | null;
  /** Self attendee responseStatus when known. */
  selfResponseStatus?: string | null;
  /** Account email this calendar belongs to. */
  accountEmail?: string | null;
  /** When Google created the event (ISO). */
  createdIso?: string | null;
  /** Already alerted for overlap. */
  conflictAlerted?: boolean;
  /** Already WhatsApp'd as a new invite / meeting. */
  inviteNotified?: boolean;
  location?: string | null;
  meetingUrl?: string | null;
};

export type InboundConflictHit = {
  invite: InboundCalendarBlock;
  blockers: CalendarBlock[];
  suggested: { start: Date; end: Date } | null;
};

/** How recent an invite must be to fire a "new meeting" WhatsApp (avoid backfill spam). */
export const NEW_INVITE_NOTIFY_MAX_AGE_MS = 48 * 3600_000;

function isSelfOrganized(b: InboundCalendarBlock): boolean {
  const org = (b.organizerEmail ?? "").trim().toLowerCase();
  const acct = (b.accountEmail ?? "").trim().toLowerCase();
  if (!org || !acct) return false;
  return org === acct;
}

/** True when this looks like someone else's booking on your calendar. */
export function isInboundInviteCandidate(b: InboundCalendarBlock): boolean {
  if (b.allDay || b.conflictAlerted) return false;
  const status = (b.selfResponseStatus ?? "").toLowerCase();
  if (status === "declined") return false;
  if (status === "needsaction") return true;
  // Not organized by you → treat as inbound (invite or shared booking).
  if (b.organizerEmail && !isSelfOrganized(b)) return true;
  return false;
}

/** Fresh inbound invite that still needs a "new meeting" WhatsApp. */
export function shouldNotifyNewInvite(
  b: InboundCalendarBlock,
  now: Date = new Date(),
  maxAgeMs = NEW_INVITE_NOTIFY_MAX_AGE_MS,
): boolean {
  if (b.inviteNotified || b.allDay) return false;
  if (!isInboundInviteCandidate(b)) return false;
  if (b.end.getTime() <= now.getTime()) return false;
  if (!b.createdIso) return false;
  const created = Date.parse(b.createdIso);
  if (Number.isNaN(created)) return false;
  if (now.getTime() - created > maxAgeMs) return false;
  return true;
}

/**
 * Find inbound invites that overlap other timed blocks on the same calendar set.
 * Only returns invites that look foreign (needsAction or other organizer).
 */
export function findInboundInviteConflicts(
  blocks: InboundCalendarBlock[],
  timeZone: string,
  now: Date = new Date(),
): InboundConflictHit[] {
  const timed = blocks.filter((b) => !b.allDay);
  const hits: InboundConflictHit[] = [];

  for (const invite of timed) {
    if (!isInboundInviteCandidate(invite)) continue;
    if (invite.end.getTime() <= now.getTime()) continue; // past

    const others = timed.filter((b) => b.eventId !== invite.eventId);
    const blockers = findOverlappingBlocks(others, invite.start, invite.end);
    if (!blockers.length) continue;

    const check = checkSlotConflicts(others, invite.start, invite.end, timeZone);
    hits.push({
      invite,
      blockers,
      suggested: check.suggested,
    });
  }
  return hits;
}

/** Fresh inbound invites that need a new-meeting ping (no conflict required). */
export function findNewInboundInvites(
  blocks: InboundCalendarBlock[],
  now: Date = new Date(),
): InboundCalendarBlock[] {
  return blocks
    .filter((b) => shouldNotifyNewInvite(b, now))
    .sort((a, b) => {
      const ac = Date.parse(a.createdIso ?? "") || 0;
      const bc = Date.parse(b.createdIso ?? "") || 0;
      return bc - ac;
    });
}

function inviteDetailLines(inv: InboundCalendarBlock, timeZone: string): string[] {
  const day = formatLocalDayShort(inv.start, timeZone);
  const when = `${formatLocalHm(inv.start, timeZone)}–${formatLocalHm(inv.end, timeZone)}`;
  const who = (inv.organizerEmail ?? "Someone").trim();
  const title = (inv.title || "a meeting").trim().slice(0, 80);
  const lines = [
    `New meeting: “${title}”`,
    `From: ${who}`,
    `When: ${day} ${when}`,
  ];
  const meet = (inv.meetingUrl ?? "").trim();
  const loc = (inv.location ?? "").trim();
  if (meet) {
    lines.push(`Join: ${meet}`);
  } else if (loc) {
    lines.push(`Where: ${loc.slice(0, 120)}`);
  }
  return lines;
}

/** WhatsApp body for a new inbound meeting (hard commitment). */
export function buildNewCalendarInviteAlert(
  inv: InboundCalendarBlock,
  timeZone: string,
): string {
  const lines = inviteDetailLines(inv, timeZone);
  const status = (inv.selfResponseStatus ?? "").toLowerCase();
  if (status === "needsaction") {
    lines.push("Reply yes to accept, or decline to reject.");
  } else {
    lines.push("Amilo is tracking this as a commitment.");
  }
  return lines.join("\n");
}

/** WhatsApp body for an inbound overlap. */
export function buildInboundConflictAlert(
  hit: InboundConflictHit,
  timeZone: string,
): string {
  const inv = hit.invite;
  const blocker = hit.blockers[0]!;
  const taken = `${formatLocalHm(blocker.start, timeZone)}–${formatLocalHm(blocker.end, timeZone)}`;
  const blockTitle = (blocker.title || "an existing block").trim().slice(0, 80);

  const lines = inviteDetailLines(inv, timeZone);
  lines.push(`That conflicts with “${blockTitle}” (${taken}).`);
  if (hit.suggested) {
    const free = `${formatLocalHm(hit.suggested.start, timeZone)}–${formatLocalHm(hit.suggested.end, timeZone)}`;
    lines.push(
      `Reply yes to keep / accept, alternate to propose ${free}, or decline to reject the invite.`,
    );
  } else {
    lines.push(`Reply yes to keep / accept, or decline to reject the invite.`);
  }
  return lines.join("\n");
}
