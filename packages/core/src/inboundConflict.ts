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
};

export type InboundConflictHit = {
  invite: InboundCalendarBlock;
  blockers: CalendarBlock[];
  suggested: { start: Date; end: Date } | null;
};

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

/** WhatsApp body for an inbound overlap. */
export function buildInboundConflictAlert(
  hit: InboundConflictHit,
  timeZone: string,
): string {
  const inv = hit.invite;
  const blocker = hit.blockers[0]!;
  const day = formatLocalDayShort(inv.start, timeZone);
  const want = `${formatLocalHm(inv.start, timeZone)}–${formatLocalHm(inv.end, timeZone)}`;
  const taken = `${formatLocalHm(blocker.start, timeZone)}–${formatLocalHm(blocker.end, timeZone)}`;
  const who = (inv.organizerEmail ?? "Someone").trim();
  const title = (inv.title || "a meeting").trim().slice(0, 80);
  const blockTitle = (blocker.title || "an existing block").trim().slice(0, 80);

  const lines = [
    `${who} scheduled “${title}” ${day} ${want}.`,
    `That conflicts with “${blockTitle}” (${taken}).`,
  ];
  if (hit.suggested) {
    const free = `${formatLocalHm(hit.suggested.start, timeZone)}–${formatLocalHm(hit.suggested.end, timeZone)}`;
    lines.push(
      `Reply yes to keep / accept, alternate to propose ${free}, or decline to reject the invite.`,
    );
  } else {
    lines.push(
      `Reply yes to keep / accept, or decline to reject the invite.`,
    );
  }
  return lines.join("\n");
}
