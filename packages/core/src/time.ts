/** Timezone helpers — all user-facing clocks use IANA TZ, never host UTC. */

export function localDayBoundsUtc(
  timeZone: string,
  at: Date = new Date(),
): { timeMin: Date; timeMax: Date; day: string } {
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);

  const offsetMin = getTimezoneOffsetMinutes(timeZone, at);
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMin * 60_000;
  return {
    day,
    timeMin: new Date(startUtcMs),
    timeMax: new Date(startUtcMs + 24 * 60 * 60 * 1000),
  };
}

export function getTimezoneOffsetMinutes(timeZone: string, at: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    hour: "2-digit",
  }).formatToParts(at);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!match) return 0;
  const sign = match[1] === "-" ? -1 : 1;
  const hh = Number(match[2] ?? 0);
  const mm = Number(match[3] ?? 0);
  return sign * (hh * 60 + mm);
}

/** 24h clock in the user's timezone, e.g. "15:00". */
export function formatLocalHm(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}

export function formatLocalDateLong(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
}

/** Wall-clock ISO without offset for Google Calendar + timeZone field. */
export function formatLocalIsoWall(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}`;
}

/** Human confirm line, e.g. "Thursday, 7 August · 1:00 pm" (no raw ISO). */
export function formatLocalWhenFriendly(date: Date, timeZone: string): string {
  const day = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "long",
    day: "numeric",
    month: "long",
  }).format(date);
  const time = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  })
    .format(date)
    .toLowerCase()
    .replace(/\s+/g, " ");
  return `${day} · ${time}`;
}

/** Parse ISO / offset string into Date; null if invalid. */
export function parseIsoDate(raw: unknown): Date | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

/**
 * Prefer parsing a calendar create from the user message (relative days + clock)
 * so we don't trust a hallucinated year from the model.
 */
export function parseCalendarCreateHint(
  message: string,
  timeZone: string,
  now: Date = new Date(),
): { title: string; startIso: string; endIso: string } | null {
  // Drop leading acknowledgements / filler ("Cool, …", "Ok — …") before the verb.
  let text = message
    .trim()
    .replace(
      /^(?:(?:cool|ok|okay|sure|thanks|thank you|ty|yeah|yep|yup|got it|great|nice|perfect|awesome|alright|right|noted|sounds good)[\s,!.\-–—:]*)+/i,
      "",
    )
    .trim();
  if (
    !/\b(add|schedule|book|create|put|block)\b/i.test(text) &&
    !/\b(meeting|lunch|call|event|appointment)\b/i.test(text)
  ) {
    return null;
  }
  if (/^remind\b/i.test(text)) return null;

  const { day: today } = localDayBoundsUtc(timeZone, now);
  let day = today;
  const lower = text.toLowerCase();
  if (/\btomorr?ow\b/.test(lower) || /\btommorow\b/.test(lower)) {
    day = addCalendarDays(today, 1);
  } else if (/\btoday\b/.test(lower)) day = today;
  else {
    const inDays = lower.match(/\bin\s+(\d+)\s+days?\b/);
    if (inDays) day = addCalendarDays(today, Number(inDays[1]));
  }

  // Duration: "1 hour" / "30 min" (default 60m). Prefer this over bare "1" as a clock.
  let durationMs = 60 * 60 * 1000;
  const durMatch = text.match(
    /\b(\d{1,2}(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i,
  );
  if (durMatch) {
    const n = Number(durMatch[1]);
    const unit = durMatch[2]!.toLowerCase();
    if (Number.isFinite(n) && n > 0) {
      durationMs = /^(minutes?|mins?|m)$/.test(unit)
        ? Math.round(n * 60_000)
        : Math.round(n * 3_600_000);
    }
  }

  // Clock: prefer "at 1pm" / "1:00 pm"; avoid treating "1 hour" as 1:00.
  const clockMatch = text.match(
    /\b(?:at|@)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?|\d{1,2}:\d{2})\b/i,
  );
  let clock = clockMatch?.[1] ? parseClockToken(clockMatch[1]) : null;
  if (!clock) {
    const bare = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
    clock = bare?.[1] ? parseClockToken(bare[1]) : null;
  }
  if (!clock) {
    const hm24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
    clock = hm24?.[0] ? parseClockToken(hm24[0]) : null;
  }
  if (!clock) return null;

  let title = text
    // Instruction verbs — not part of the event title
    .replace(
      /^(?:please\s+)?(?:add|schedule|book|create|put|block)\s+(?:a\s+|an\s+|me\s+)?/i,
      "",
    )
    .replace(
      /\b(?:add|schedule|book|create|put|block)\s+(?:a\s+|an\s+|me\s+)?/gi,
      "",
    )
    .replace(/\b(?:today|tomorrow|tomorow|tommorow|in\s+\d+\s+days?)\b/gi, "")
    .replace(/\b(?:at|@)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, "")
    .replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g, "")
    .replace(/\b\d{1,2}(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi, "")
    .replace(/\bon\s+(?:personal|work|excro|speedstar)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, "")
    .trim();

  if (/^with\s+\S/i.test(title)) {
    title = `Meeting ${title}`;
  }
  if (!title) title = "Event";

  const start = zonedLocalDateTime(timeZone, day, clock.hour, clock.minute);
  const end = new Date(start.getTime() + durationMs);
  return {
    title,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

export function formatCalendarProposalSummary(opts: {
  kind: string;
  title: string;
  startIso?: string | null;
  endIso?: string | null;
  timeZone: string;
}): string {
  const start = parseIsoDate(opts.startIso);
  const when = start ? formatLocalWhenFriendly(start, opts.timeZone) : "time TBD";
  const verb =
    opts.kind === "calendar_update"
      ? "Update"
      : opts.kind === "calendar_cancel"
        ? "Cancel"
        : "Create";
  return `${verb}: ${opts.title} — ${when}`;
}

/** Friendly label for confirmations. */
export function timezoneFriendlyLabel(timeZone: string): string {
  const map: Record<string, string> = {
    "Asia/Kolkata": "India (IST)",
    "Asia/Dubai": "Dubai (GST)",
    "Asia/Singapore": "Singapore",
    "Europe/London": "London",
    "America/New_York": "US Eastern",
    "America/Los_Angeles": "US Pacific",
    "America/Chicago": "US Central",
    "Australia/Sydney": "Sydney",
  };
  return map[timeZone] ?? timeZone;
}

/** Guess IANA timezone from E.164 phone; defaults to Asia/Kolkata. */
export function guessTimezoneFromPhone(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  const table: Array<{ prefix: string; tz: string }> = [
    { prefix: "91", tz: "Asia/Kolkata" },
    { prefix: "971", tz: "Asia/Dubai" },
    { prefix: "65", tz: "Asia/Singapore" },
    { prefix: "44", tz: "Europe/London" },
    { prefix: "61", tz: "Australia/Sydney" },
    { prefix: "1", tz: "America/New_York" },
  ];
  for (const row of table) {
    if (digits.startsWith(row.prefix)) return row.tz;
  }
  return "Asia/Kolkata";
}

const PLACE_TZ: Array<{ needles: string[]; tz: string }> = [
  { needles: ["india", "mumbai", "delhi", "bangalore", "bengaluru", "hyderabad", "pune", "chennai", "kolkata", "ist"], tz: "Asia/Kolkata" },
  { needles: ["dubai", "uae", "abu dhabi"], tz: "Asia/Dubai" },
  { needles: ["singapore", "sg"], tz: "Asia/Singapore" },
  { needles: ["london", "uk", "britain"], tz: "Europe/London" },
  { needles: ["new york", "nyc", "eastern", "est", "edt"], tz: "America/New_York" },
  { needles: ["los angeles", "sf", "san francisco", "pacific", "pst", "pdt", "la"], tz: "America/Los_Angeles" },
  { needles: ["chicago", "central", "cst", "cdt"], tz: "America/Chicago" },
  { needles: ["sydney", "australia", "melbourne"], tz: "Australia/Sydney" },
];

/** Resolve free text / IANA id to a timezone, or null. */
export function resolveTimezoneInput(raw: string): string | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^[A-Za-z]+\/[A-Za-z_]+$/.test(s)) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: s });
      return s;
    } catch {
      return null;
    }
  }
  const lower = s.toLowerCase();
  for (const row of PLACE_TZ) {
    if (row.needles.some((n) => lower === n || lower.includes(n))) return row.tz;
  }
  return null;
}

export function isValidIanaTimezone(tz: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** Build a Date for local wall-clock time on a given calendar day in `timeZone`. */
export function zonedLocalDateTime(
  timeZone: string,
  dayYmd: string,
  hour: number,
  minute: number,
): Date {
  const offsetMin = getTimezoneOffsetMinutes(
    timeZone,
    // Approximate with noon UTC on that day for offset (IST has no DST).
    new Date(`${dayYmd}T12:00:00.000Z`),
  );
  const [y, m, d] = dayYmd.split("-").map(Number) as [number, number, number];
  const utcMs = Date.UTC(y, m - 1, d, hour, minute, 0) - offsetMin * 60_000;
  return new Date(utcMs);
}

function addCalendarDays(dayYmd: string, delta: number): string {
  const [y, m, d] = dayYmd.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d + delta));
  return dt.toISOString().slice(0, 10);
}

export interface ParsedClock {
  hour: number;
  minute: number;
}

/** Parse "12:30", "8pm", "8 PM", "20:00". */
export function parseClockToken(raw: string): ParsedClock | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  const m12 = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (m12) {
    let hour = Number(m12[1]);
    const minute = Number(m12[2] ?? 0);
    const ap = m12[3];
    if (hour < 1 || hour > 12 || minute > 59) return null;
    if (ap === "am") hour = hour === 12 ? 0 : hour;
    else hour = hour === 12 ? 12 : hour + 12;
    return { hour, minute };
  }
  const m24 = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m24) {
    const hour = Number(m24[1]);
    const minute = Number(m24[2]);
    if (hour > 23 || minute > 59) return null;
    return { hour, minute };
  }
  const bare = s.match(/^(\d{1,2})(am|pm)$/);
  if (bare) {
    return parseClockToken(`${bare[1]}:00${bare[2]}`);
  }
  return null;
}

export interface ReminderSpec {
  title: string;
  dueAt: Date;
}

/**
 * Parse "remind me … at 12:30 and 8pm" style messages into due times in `timeZone`.
 * Returns [] if not a reminder-shaped message.
 */
export function parseReminderMessage(
  message: string,
  timeZone: string,
  now: Date = new Date(),
): ReminderSpec[] {
  const text = message.trim();
  if (!/remind/i.test(text)) return [];

  const { day: today } = localDayBoundsUtc(timeZone, now);
  let day = today;
  const lower = text.toLowerCase();
  if (/\btomorr?ow\b/.test(lower) || /\btommorow\b/.test(lower)) {
    day = addCalendarDays(today, 1);
  } else {
    const inDays = lower.match(/\bin\s+(\d+)\s+days?\b/);
    if (inDays) day = addCalendarDays(today, Number(inDays[1]));
  }

  // Collect clock tokens (with optional am/pm attached or following).
  const clocks: ParsedClock[] = [];
  const re =
    /\b(\d{1,2}:\d{2}\s*(?:am|pm)?|\d{1,2}\s*(?:am|pm)|(?:at|@)\s*\d{1,2}(?::\d{2})?(?:\s*(?:am|pm))?)\b/gi;
  let match: RegExpExecArray | null;
  const raw = text;
  while ((match = re.exec(raw)) !== null) {
    let token = match[1]!.replace(/^(?:at|@)\s*/i, "").replace(/\s+/g, "");
    const clock = parseClockToken(token);
    if (clock) clocks.push(clock);
  }

  if (!clocks.length) return [];

  // Title: strip remind boilerplate and time phrases.
  let title = text
    .replace(/^(?:please\s+)?remind\s+me\s+(?:to\s+|about\s+|for\s+|of\s+)?/i, "")
    .replace(/\b(?:today|tomorrow|in\s+\d+\s+days?)\b/gi, "")
    .replace(
      /\b(?:at|@)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?(?:\s*(?:and|,|&)\s*(?:at\s*)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?)*\b/gi,
      "",
    )
    .replace(/\b\d{1,2}:\d{2}\s*(?:am|pm)?\b/gi, "")
    .replace(/\b\d{1,2}\s*(?:am|pm)\b/gi, "")
    .replace(/\s+/g, " ")
    .replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, "")
    .trim();
  if (!title || /^(a |the )?(call|meeting|it)?$/i.test(title)) {
    title = title && !/^(a |the )?$/i.test(title) ? title : "Reminder";
  }
  // Prefer "call" if that was the only content word.
  if (/^call$/i.test(title)) title = "Call";

  const specs: ReminderSpec[] = [];
  for (const c of clocks) {
    let due = zonedLocalDateTime(timeZone, day, c.hour, c.minute);
    // If time already passed today (and not tomorrow), roll to tomorrow.
    if (!/\btomorrow\b/i.test(text) && due.getTime() <= now.getTime() - 60_000) {
      due = zonedLocalDateTime(timeZone, addCalendarDays(day, 1), c.hour, c.minute);
    }
    specs.push({ title, dueAt: due });
  }
  return specs;
}

/** Extract travel / timezone update from NL. */
export function parseTimezoneUpdateMessage(message: string): string | null {
  const t = message.trim();
  const cmd = t.match(/^(?:timezone|tz|set timezone|set tz)\s+(.+)$/i);
  if (cmd?.[1]) return resolveTimezoneInput(cmd[1]);

  const travel = t.match(
    /^(?:i(?:'m| am)\s+)?(?:in|travelling to|traveling to|based in|moved to)\s+(.+?)(?:\s+this\s+week|\s+for\s+now|\s+until\s+\w+)?\.?$/i,
  );
  if (travel?.[1]) return resolveTimezoneInput(travel[1]);

  return null;
}

export function isTimezoneAffirmative(message: string): boolean {
  return /^(yes|y|yeah|yep|ok|okay|keep|correct|right|india|ist|that'?s?\s+right|confirm)$/i.test(
    message.trim(),
  );
}

/** Local wall-clock "HH:MM" (24h) in timezone. */
export function localHm(at: Date, timeZone: string): string {
  return formatLocalHm(at, timeZone);
}

/** Minutes since local midnight for "HH:MM". */
export function hmToMinutes(hm: string): number | null {
  const m = hm.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

/** Format minutes since midnight as "HH:MM". */
export function minutesToHm(total: number): string {
  const t = ((total % (24 * 60)) + 24 * 60) % (24 * 60);
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * True if nowHm is in [targetHm, targetHm + windowMinutes) in the same local day.
 * Used so a 60s poller can catch a scheduled brief without exact-second match.
 */
export function isHmInWindow(
  nowHm: string,
  targetHm: string,
  windowMinutes = 5,
): boolean {
  const now = hmToMinutes(nowHm);
  const target = hmToMinutes(targetHm);
  if (now == null || target == null) return false;
  if (now < target) return false;
  return now < target + windowMinutes;
}

/**
 * Quiet hours spanning midnight, e.g. 22:00–07:00.
 * Inclusive of start, exclusive of end when overnight; both ends inclusive for same-day ranges.
 */
export function isInQuietHours(
  at: Date,
  timeZone: string,
  quietStartHm: string,
  quietEndHm: string,
): boolean {
  const now = hmToMinutes(localHm(at, timeZone));
  const start = hmToMinutes(quietStartHm);
  const end = hmToMinutes(quietEndHm);
  if (now == null || start == null || end == null) return false;
  if (start === end) return false;
  if (start < end) {
    return now >= start && now < end;
  }
  // Overnight: e.g. 22:00–07:00
  return now >= start || now < end;
}

/** Meta WABA template body params: no newlines/tabs, no 4+ consecutive spaces. */
export function flattenWaTemplateParam(s: string, max = 900): string {
  return s
    .replace(/[\r\n\t]+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim()
    .slice(0, max) || "—";
}

/** Parse "7:30", "8pm", "20:00" into "HH:MM" 24h. */
export function parseHmInput(raw: string): string | null {
  const clock = parseClockToken(raw.trim());
  if (!clock) return null;
  return minutesToHm(clock.hour * 60 + clock.minute);
}
