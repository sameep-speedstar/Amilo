import type { CalendarBlock } from "./calendarConflict.js";
import {
  formatLocalHm,
  localDayBoundsUtc,
  parseClockToken,
  zonedLocalDateTime,
  type ParsedClock,
} from "./time.js";

/** Recurrence for schedule memory nodes. */
export type ScheduleDays = "daily" | "weekdays" | string;

export type ScheduleAttrs = {
  days: ScheduleDays;
  startHm: string;
  endHm: string;
  holdUntilIso?: string;
  autoDecline?: boolean;
};

export type ScheduleNodeLike = {
  label: string;
  attrs: Record<string, unknown>;
};

export type ScheduleIntent =
  | {
      type: "standing";
      label: string;
      days: ScheduleDays;
      startHm: string;
      endHm: string;
    }
  | {
      type: "extend_hold";
      labelHint: string;
      untilHm: string;
      autoDecline: boolean;
    }
  | {
      type: "cancel_hold";
      labelHint: string | null;
    };

function normalizeHm(clock: ParsedClock): string {
  return `${String(clock.hour).padStart(2, "0")}:${String(clock.minute).padStart(2, "0")}`;
}

function parseHmPair(
  startRaw: string,
  endRaw: string,
): { startHm: string; endHm: string } | null {
  const endHasMer = /am|pm/i.test(endRaw);
  const startHasMer = /am|pm/i.test(startRaw);
  let end = parseClockToken(endRaw.trim());
  let start = parseClockToken(startRaw.trim());
  if (!end) {
    const bare = endRaw.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (bare) {
      const h = Number(bare[1]);
      const m = Number(bare[2] ?? 0);
      if (h <= 23 && m <= 59) end = { hour: h, minute: m };
    }
  }
  if (!start) {
    const bare = startRaw.trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
    if (bare) {
      const h = Number(bare[1]);
      const m = Number(bare[2] ?? 0);
      if (h <= 23 && m <= 59) start = { hour: h, minute: m };
    }
  }
  if (!start || !end) return null;

  // Inherit meridiem from the peer when only one side has it.
  if (!startHasMer && endHasMer) {
    const mer = /pm/i.test(endRaw) ? "pm" : "am";
    if (start.hour <= 12) {
      if (mer === "pm" && start.hour < 12 && start.hour !== 0) {
        const endH12 = end.hour === 0 ? 12 : end.hour > 12 ? end.hour - 12 : end.hour;
        if (start.hour === 12) start = { hour: 12, minute: start.minute };
        else if (start.hour > endH12) {
          /* morning before pm end */
        } else start = { hour: start.hour + 12, minute: start.minute };
      } else if (mer === "am" && start.hour === 12) {
        start = { hour: 0, minute: start.minute };
      }
    }
  } else if (startHasMer && !endHasMer && end.hour <= 12) {
    const mer = /pm/i.test(startRaw) ? "pm" : "am";
    if (mer === "pm" && end.hour < 12) end = { hour: end.hour + 12, minute: end.minute };
    if (mer === "am" && end.hour === 12) end = { hour: 0, minute: end.minute };
  }

  if (end.hour * 60 + end.minute <= start.hour * 60 + start.minute) {
    if (end.hour < 12) end = { hour: end.hour + 12, minute: end.minute };
  }
  return { startHm: normalizeHm(start), endHm: normalizeHm(end) };
}

function titleCaseLabel(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function cleanScheduleLabel(raw: string): string {
  let s = raw
    .replace(
      /\b(every\s*day|everyday|daily|weekdays?|i have|i've got|we have|my|the|a|an)\b/gi,
      " ",
    )
    .replace(/\b(from|between|at|till|until|to)\b/gi, " ")
    .replace(/\bdo\s*n['’]?t\s+book\b.*$/i, " ")
    .replace(/\bno\s+meetings?\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) s = "Busy";
  return titleCaseLabel(s).slice(0, 80);
}

/** Parse standing schedule / extend-hold / cancel-hold from user text. */
export function parseScheduleIntent(message: string): ScheduleIntent | null {
  const text = message
    .trim()
    .replace(/\ba\.m\./gi, "am")
    .replace(/\bp\.m\./gi, "pm");
  if (!text || text.length < 6) return null;

  if (/^(cancel|lift|clear|drop)\s+hold\b/i.test(text) || /^hold\s+off\b/i.test(text)) {
    const hint = text
      .replace(/^(cancel|lift|clear|drop)\s+hold\b/i, "")
      .replace(/^hold\s+off\b/i, "")
      .replace(/^(on|for)\s+/i, "")
      .trim();
    return { type: "cancel_hold", labelHint: hint || null };
  }

  // Extend / hold: "extend school pickup till 5", "pickup until 5 don't book"
  const textNorm = text.replace(/\b(\d{1,2})\s*o['’]?clock\b/gi, "$1");
  const extend =
    textNorm.match(
      /\b(?:extend|push|stretch)\s+(.+?)\s+(?:till|until|to)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
    ) ??
    textNorm.match(
      /\b(.+?)\s+(?:till|until)\s+(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
    );
  const wantsNoBook =
    /\bdon['’]?t\s+book\b/i.test(text) ||
    /\bno\s+meetings?\b/i.test(text) ||
    /\bdo\s+not\s+book\b/i.test(text);
  if (extend?.[1] && extend[2] && (/\bextend\b|\bpush\b|\bstretch\b/i.test(text) || wantsNoBook)) {
    const untilClock =
      parseClockToken(extend[2].trim()) ??
      (() => {
        const bare = extend[2].trim().match(/^(\d{1,2})(?::(\d{2}))?$/);
        if (!bare) return null;
        let h = Number(bare[1]);
        const m = Number(bare[2] ?? 0);
        // Bare "5" in afternoon pickup context → 5pm
        if (h >= 1 && h <= 11) h += 12;
        if (h > 23 || m > 59) return null;
        return { hour: h, minute: m };
      })();
    if (untilClock) {
      let hint = extend[1]
        .replace(/^(my|the|a|an)\s+/i, "")
        .replace(/\b(time|window|block)\b/gi, "")
        .trim();
      if (!hint || hint.length < 2) hint = "pickup";
      return {
        type: "extend_hold",
        labelHint: hint.slice(0, 80),
        untilHm: normalizeHm(untilClock),
        autoDecline: wantsNoBook || /\bextend\b/i.test(text),
      };
    }
  }

  // Standing: needs a recurring cue or "don't book during" + a time range
  const recurring =
    /\b(every\s*day|everyday|daily|weekdays?|each\s+day)\b/i.test(text) ||
    /\bdon['’]?t\s+book\b/i.test(text) ||
    /\bno\s+meetings?\s+(?:during|from|between)\b/i.test(text);
  if (!recurring) return null;

  const range = text.match(
    /\b(?:from\s+|between\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|–|—)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
  );
  if (!range?.[1] || !range[2]) return null;
  const pair = parseHmPair(range[1], range[2]);
  if (!pair) return null;

  const days: ScheduleDays = /\b(every\s*day|everyday|daily|each\s+day)\b/i.test(text)
    ? "daily"
    : "weekdays";

  const labelBlob = text
    .slice(0, range.index ?? 0)
    .replace(
      /\b(every\s*day|everyday|daily|weekdays?|each\s+day|i have|i've got|we have|don['’]?t book|do not book|no meetings?|during|for)\b/gi,
      " ",
    );
  const label = cleanScheduleLabel(labelBlob);

  return {
    type: "standing",
    label,
    days,
    startHm: pair.startHm,
    endHm: pair.endHm,
  };
}

export function parseScheduleAttrs(raw: Record<string, unknown>): ScheduleAttrs | null {
  const startHm = String(raw.startHm ?? "").trim();
  const endHm = String(raw.endHm ?? "").trim();
  if (!/^\d{2}:\d{2}$/.test(startHm) || !/^\d{2}:\d{2}$/.test(endHm)) return null;
  const daysRaw = String(raw.days ?? "weekdays").trim() || "weekdays";
  const attrs: ScheduleAttrs = {
    days: daysRaw as ScheduleDays,
    startHm,
    endHm,
  };
  if (typeof raw.holdUntilIso === "string" && raw.holdUntilIso) {
    attrs.holdUntilIso = raw.holdUntilIso;
  }
  if (raw.autoDecline === true) attrs.autoDecline = true;
  return attrs;
}

/** Local weekday Mon=1 … Sun=7 in the given zone. */
function localWeekdayMon1(dayYmd: string, timeZone: string): number {
  const noon = zonedLocalDateTime(timeZone, dayYmd, 12, 0);
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
  }).format(noon);
  const map: Record<string, number> = {
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
    Sun: 7,
  };
  return map[wd] ?? 1;
}

export function scheduleAppliesOnDay(
  days: ScheduleDays,
  dayYmd: string,
  timeZone: string,
): boolean {
  const d = String(days).toLowerCase();
  if (d === "daily" || d === "every day" || d === "everyday") return true;
  const mon1 = localWeekdayMon1(dayYmd, timeZone);
  if (d === "weekdays" || d === "weekday") return mon1 >= 1 && mon1 <= 5;
  if (d === "weekends" || d === "weekend") return mon1 >= 6;
  // MTWRFSU bitmask-style string
  const letters = "MTWRFSU";
  if (/^[mtwrfsu]+$/i.test(d)) {
    return [...d.toUpperCase()].some((ch) => {
      const idx = letters.indexOf(ch);
      return idx >= 0 && idx + 1 === mon1;
    });
  }
  return true;
}

function hmParts(hm: string): { hour: number; minute: number } | null {
  const m = hm.match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

export function isAutoDeclineHoldActive(
  attrs: ScheduleAttrs,
  now: Date = new Date(),
): boolean {
  if (!attrs.autoDecline || !attrs.holdUntilIso) return false;
  const until = new Date(attrs.holdUntilIso);
  if (Number.isNaN(until.getTime())) return false;
  return until.getTime() > now.getTime();
}

function holdStillActive(attrs: ScheduleAttrs, now: Date): Date | null {
  if (!attrs.holdUntilIso) return null;
  const until = new Date(attrs.holdUntilIso);
  if (Number.isNaN(until.getTime()) || until.getTime() <= now.getTime()) return null;
  return until;
}

/**
 * Standing pickup/gym windows stay off TODAY — they are silent memory for
 * conflict checks. Print only an active hold (one-off extension).
 */
export function briefScheduleWindowLine(
  label: string,
  attrs: ScheduleAttrs,
  opts: { timeZone: string; now: Date; focusDay: string },
): string | null {
  const until = holdStillActive(attrs, opts.now);
  if (!until) return null;
  const { day: untilDay } = localDayBoundsUtc(opts.timeZone, until);
  if (untilDay !== opts.focusDay) return null;
  const endHm = formatLocalHm(until, opts.timeZone);
  return `${attrs.startHm}–${endHm} ${label} (hold)`;
}

/**
 * Expand schedule nodes into timed busy blocks over [from, to] (usually a few days).
 * Active hold extends end to holdUntil when later than standing endHm.
 */
export function scheduleBlocksForRange(
  nodes: ScheduleNodeLike[],
  timeZone: string,
  from: Date,
  to: Date,
  now: Date = new Date(),
): CalendarBlock[] {
  const out: CalendarBlock[] = [];
  const cursorDay = localDayBoundsUtc(timeZone, from).day;
  const endDay = localDayBoundsUtc(timeZone, to).day;
  let day = cursorDay;
  for (let i = 0; i < 14; i++) {
    for (const node of nodes) {
      const attrs = parseScheduleAttrs(node.attrs);
      if (!attrs) continue;
      if (!scheduleAppliesOnDay(attrs.days, day, timeZone)) continue;
      const startP = hmParts(attrs.startHm);
      let endP = hmParts(attrs.endHm);
      if (!startP || !endP) continue;

      let start = zonedLocalDateTime(timeZone, day, startP.hour, startP.minute);
      let end = zonedLocalDateTime(timeZone, day, endP.hour, endP.minute);

      if (attrs.holdUntilIso) {
        const holdEnd = new Date(attrs.holdUntilIso);
        if (!Number.isNaN(holdEnd.getTime())) {
          const holdDay = localDayBoundsUtc(timeZone, holdEnd).day;
          if (holdDay === day && holdEnd.getTime() > end.getTime()) {
            end = holdEnd;
          }
        }
      }

      if (end.getTime() <= start.getTime()) continue;
      if (end.getTime() < from.getTime() || start.getTime() > to.getTime()) continue;

      out.push({
        title: node.label.trim() || "Schedule",
        start,
        end,
        allDay: false,
      });
    }
    if (day >= endDay) break;
    const next = addCalendarDays(day, 1);
    day = next;
  }
  // Touch now so callers can pass it for future hold-expiry filters
  void now;
  return out;
}

function addCalendarDays(dayYmd: string, delta: number): string {
  const [y, m, d] = dayYmd.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

/** Build holdUntilIso for today at untilHm in timezone. */
export function holdUntilIsoForHm(
  untilHm: string,
  timeZone: string,
  now: Date = new Date(),
): string | null {
  const p = hmParts(untilHm);
  if (!p) return null;
  const day = localDayBoundsUtc(timeZone, now).day;
  return zonedLocalDateTime(timeZone, day, p.hour, p.minute).toISOString();
}

/** Match schedule label by fuzzy hint (pickup → School Pickup). */
export function matchScheduleLabel(
  nodes: ScheduleNodeLike[],
  hint: string,
): ScheduleNodeLike | null {
  const needle = hint.trim().toLowerCase();
  if (!needle) return nodes[0] ?? null;
  const exact = nodes.find((n) => n.label.toLowerCase() === needle);
  if (exact) return exact;
  const partial = nodes.find(
    (n) =>
      n.label.toLowerCase().includes(needle) ||
      needle.includes(n.label.toLowerCase()) ||
      needle.split(/\s+/).some((w) => w.length > 2 && n.label.toLowerCase().includes(w)),
  );
  return partial ?? null;
}

export function formatScheduleAck(opts: {
  label: string;
  startHm: string;
  endHm: string;
  days: ScheduleDays;
  holdUntilIso?: string | null;
  autoDecline?: boolean;
  timeZone: string;
}): string {
  const daysLabel =
    opts.days === "daily" ? "daily" : opts.days === "weekdays" ? "weekdays" : String(opts.days);
  const start = hmParts(opts.startHm);
  const end = hmParts(opts.endHm);
  const startFriendly = start
    ? formatLocalHm(
        zonedLocalDateTime(opts.timeZone, "2026-01-05", start.hour, start.minute),
        opts.timeZone,
      )
    : opts.startHm;
  const endFriendly = end
    ? formatLocalHm(
        zonedLocalDateTime(opts.timeZone, "2026-01-05", end.hour, end.minute),
        opts.timeZone,
      )
    : opts.endHm;

  if (opts.holdUntilIso) {
    const until = formatLocalHm(new Date(opts.holdUntilIso), opts.timeZone);
    const decline = opts.autoDecline
      ? " I’ll decline overlapping invites and block new bookings in that window."
      : "";
    return `${opts.label} held till ${until} today.${decline} Say cancel hold to lift.`;
  }
  return `Saved schedule: ${opts.label} ${startFriendly}–${endFriendly} ${daysLabel} (memory only — not on Google).`;
}
