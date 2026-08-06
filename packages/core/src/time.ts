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
  if (/\btomorrow\b/.test(lower)) day = addCalendarDays(today, 1);
  else {
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
