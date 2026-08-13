import { formatLocalHm, localDayBoundsUtc, localHm, zonedLocalDateTime } from "./time.js";

export type CalendarBlock = {
  title: string;
  start: Date;
  end: Date;
  allDay?: boolean;
};

export type ConflictCheckResult = {
  clear: boolean;
  /** Requested window. */
  requestedStart: Date;
  requestedEnd: Date;
  conflicts: CalendarBlock[];
  /** Next free window of the same duration, if found. */
  suggested: { start: Date; end: Date } | null;
};

export function intervalsOverlap(
  aStart: Date,
  aEnd: Date,
  bStart: Date,
  bEnd: Date,
): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Timed events only — all-day flags/reminders are ignored for slot conflicts. */
export function findOverlappingBlocks(
  blocks: CalendarBlock[],
  start: Date,
  end: Date,
): CalendarBlock[] {
  return blocks.filter(
    (b) => !b.allDay && intervalsOverlap(start, end, b.start, b.end),
  );
}

function dayYmdInZone(at: Date, timeZone: string): string {
  return localDayBoundsUtc(timeZone, at).day;
}

function hmParts(hm: string): { hour: number; minute: number } | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  return { hour: Number(m[1]), minute: Number(m[2]) };
}

/**
 * Find the next free slot of `durationMs` after `from`, within local
 * working hours (08:00–21:00), looking ahead up to `maxDays`.
 */
export function findNextFreeSlot(
  from: Date,
  durationMs: number,
  blocks: CalendarBlock[],
  timeZone: string,
  opts?: { stepMs?: number; maxDays?: number; dayStartHm?: string; dayEndHm?: string },
): { start: Date; end: Date } | null {
  const stepMs = opts?.stepMs ?? 30 * 60 * 1000;
  const maxDays = opts?.maxDays ?? 3;
  const dayStart = hmParts(opts?.dayStartHm ?? "08:00") ?? { hour: 8, minute: 0 };
  const dayEnd = hmParts(opts?.dayEndHm ?? "21:00") ?? { hour: 21, minute: 0 };
  const timed = blocks.filter((b) => !b.allDay);

  // Start searching at the next step boundary at/after `from`.
  let cursor = new Date(Math.ceil(from.getTime() / stepMs) * stepMs);
  if (cursor.getTime() < from.getTime()) {
    cursor = new Date(cursor.getTime() + stepMs);
  }

  const horizon = new Date(from.getTime() + maxDays * 86_400_000);

  while (cursor.getTime() + durationMs <= horizon.getTime()) {
    const ymd = dayYmdInZone(cursor, timeZone);
    const windowStart = zonedLocalDateTime(
      timeZone,
      ymd,
      dayStart.hour,
      dayStart.minute,
    );
    const windowEnd = zonedLocalDateTime(timeZone, ymd, dayEnd.hour, dayEnd.minute);

    if (cursor.getTime() < windowStart.getTime()) {
      cursor = windowStart;
      continue;
    }
    const slotEnd = new Date(cursor.getTime() + durationMs);
    if (slotEnd.getTime() > windowEnd.getTime()) {
      // Jump to next local morning.
      const nextDay = localDayBoundsUtc(
        timeZone,
        new Date(windowEnd.getTime() + 60_000),
      ).day;
      cursor = zonedLocalDateTime(timeZone, nextDay, dayStart.hour, dayStart.minute);
      continue;
    }

    const hits = findOverlappingBlocks(timed, cursor, slotEnd);
    if (hits.length === 0) {
      return { start: new Date(cursor), end: slotEnd };
    }
    // Jump to end of the blocking event (rounded up to step).
    const blockEnd = Math.max(...hits.map((h) => h.end.getTime()));
    cursor = new Date(Math.ceil(blockEnd / stepMs) * stepMs);
  }
  return null;
}

export function checkSlotConflicts(
  blocks: CalendarBlock[],
  start: Date,
  end: Date,
  timeZone: string,
): ConflictCheckResult {
  const conflicts = findOverlappingBlocks(blocks, start, end);
  if (!conflicts.length) {
    return {
      clear: true,
      requestedStart: start,
      requestedEnd: end,
      conflicts: [],
      suggested: null,
    };
  }
  const durationMs = Math.max(15 * 60_000, end.getTime() - start.getTime());
  // Search from the end of the first conflict (or requested start + step).
  const searchFrom = new Date(
    Math.max(start.getTime() + 30 * 60_000, conflicts[0]!.end.getTime()),
  );
  const suggested = findNextFreeSlot(searchFrom, durationMs, blocks, timeZone);
  return {
    clear: false,
    requestedStart: start,
    requestedEnd: end,
    conflicts,
    suggested,
  };
}

/** One-line conflict explanation for WhatsApp — keep original time; offer choice. */
export function formatConflictProposalNote(
  result: ConflictCheckResult,
  timeZone: string,
): string | null {
  if (result.clear) return null;
  const taken = result.conflicts[0]!;
  const wantHm = formatLocalHm(result.requestedStart, timeZone);
  const blocker = (taken.title || "an existing event").trim();
  const blockerWhen = `${formatLocalHm(taken.start, timeZone)}–${formatLocalHm(taken.end, timeZone)}`;

  if (result.suggested) {
    const freeHm = formatLocalHm(result.suggested.start, timeZone);
    const freeEnd = formatLocalHm(result.suggested.end, timeZone);
    return (
      `${wantHm} conflicts with “${blocker}” (${blockerWhen}). ` +
      `Next free: ${freeHm}–${freeEnd}.`
    );
  }
  return (
    `${wantHm} conflicts with “${blocker}” (${blockerWhen}). ` +
    `No open slot in the next few days.`
  );
}

/** Exported for tests — local wall clock helper. */
export function localHmForConflict(at: Date, timeZone: string): string {
  return localHm(at, timeZone);
}
