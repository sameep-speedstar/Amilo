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

/** Short calendar line date, e.g. "Tue 11 Aug". */
export function formatLocalDayShort(date: Date, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    day: "numeric",
    month: "short",
  }).format(date);
}

/** Relative day label vs now in user TZ: today | tomorrow | yesterday | weekday date. */
export function relativeDayLabel(
  date: Date,
  timeZone: string,
  now: Date = new Date(),
): "today" | "tomorrow" | "yesterday" | string {
  const eventDay = localDayBoundsUtc(timeZone, date).day;
  const today = localDayBoundsUtc(timeZone, now).day;
  const tomorrow = localDayBoundsUtc(timeZone, localDayBoundsUtc(timeZone, now).timeMax).day;
  const yest = localDayBoundsUtc(
    timeZone,
    new Date(localDayBoundsUtc(timeZone, now).timeMin.getTime() - 60_000),
  ).day;
  if (eventDay === today) return "today";
  if (eventDay === tomorrow) return "tomorrow";
  if (eventDay === yest) return "yesterday";
  return formatLocalDayShort(date, timeZone);
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
    .replace(/\ba\.m\./gi, "am")
    .replace(/\bp\.m\./gi, "pm")
    .trim();
  if (
    !/\b(add|schedule|book|create|put|block|invite|fix)\b/i.test(text) &&
    !/\b(meeting|lunch|call|event|appointment|calendar invite)\b/i.test(text) &&
    !/\b(pickup|pick\s*up|drop[\s-]?off|dropoff|school)\b/i.test(text)
  ) {
    return null;
  }
  if (/^remind\b/i.test(text)) return null;
  // Bare lifestyle chatter without a clock — don't invent a booking.
  if (
    /\b(pickup|pick\s*up|drop[\s-]?off|dropoff|school)\b/i.test(text) &&
    !/\b(add|schedule|book|create|put|block|invite|fix|meeting|lunch|call|event|appointment)\b/i.test(
      text,
    ) &&
    !/\b(?:at|@)\s*\d{1,2}/i.test(text) &&
    !/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(text) &&
    !/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/.test(text) &&
    !/\b(?:from\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|–|—)\s*\d{1,2}/i.test(text)
  ) {
    return null;
  }

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

  // Explicit range: "from 12 to 2 PM", "12–2pm", "10:30 to 11:30am"
  const rangeParsed = parseClockRange(text);
  let startClock: ParsedClock | null = rangeParsed?.start ?? null;
  let endClock: ParsedClock | null = rangeParsed?.end ?? null;
  let durationMs = 60 * 60 * 1000;

  if (!startClock) {
    // Duration: "1 hour" / "30 min" (default 60m). Prefer this over bare "1" as a clock.
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
    startClock = clockMatch?.[1] ? parseClockToken(clockMatch[1]) : null;
    if (!startClock) {
      const bare = text.match(/\b(\d{1,2}(?::\d{2})?\s*(?:am|pm))\b/i);
      startClock = bare?.[1] ? parseClockToken(bare[1]) : null;
    }
    if (!startClock) {
      const hm24 = text.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
      startClock = hm24?.[0] ? parseClockToken(hm24[0]) : null;
    }
  }
  if (!startClock) return null;

  let title = text
    // Instruction verbs — not part of the event title
    .replace(
      /^(?:please\s+)?(?:add|schedule|book|create|put|block|invite|send|fix)\s+(?:a\s+|an\s+|me\s+)?/i,
      "",
    )
    .replace(
      /\b(?:add|schedule|book|create|put|block|invite|send)\s+(?:a\s+|an\s+|me\s+)?/gi,
      "",
    )
    // Filler before the real title ("another meeting", "one more call")
    .replace(
      /^(?:another|also|again|one more|extra|quick|short|brief)\s+/i,
      "",
    )
    .replace(/\b(?:calendar\s+)?invite\b/gi, "")
    .replace(/\bto\s+[A-Za-z][A-Za-z.'-]{1,40}\b/gi, (m) =>
      /\bto\s+(today|tomorrow|me|calendar)\b/i.test(m) ? m : "",
    )
    .replace(/\b(?:today|tomorrow|tomorow|tommorow|in\s+\d+\s+days?)\b/gi, "")
    // Strip time ranges before single clocks so "from 12 to" doesn't linger in the title.
    .replace(
      /\b(?:from\s+)?\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|-|–|—)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi,
      "",
    )
    .replace(/\b(?:at|@)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b/gi, "")
    .replace(/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/gi, "")
    .replace(/\b(?:[01]?\d|2[0-3]):[0-5]\d\b/g, "")
    .replace(/\b\d{1,2}(?:\.\d+)?\s*(?:hours?|hrs?|h|minutes?|mins?|m)\b/gi, "")
    .replace(/\bon\s+(?:personal|work|excro|speedstar)\b/gi, "")
    // "calendar for/on/at …" is scaffolding, not a title
    .replace(/^(?:the\s+)?calendar(?:\s+(?:for|on|at|to))?\b/i, "")
    .replace(/\b(?:in the morning|in the evening|in the afternoon)\b/gi, "")
    .replace(/\b(?:we have to|i have to|have to|need to|going to|go to)\b/gi, "")
    .replace(/\b(?:play)\b/gi, "")
    // "of/for daughter" → keep as "daughter" phrasing; normalize pickup wording later
    .replace(/\s+/g, " ")
    .replace(/^[\s,.\-–—]+|[\s,.\-–—]+$/g, "")
    .trim();

  // "meeting with Vivek" / "call with Raj" — title-case Meeting/Call
  if (/^(?:meeting|call|lunch|sync|catch[\s-]?up)\s+with\s+\S/i.test(title)) {
    title = title.replace(
      /^(meeting|call|lunch|sync|catch[\s-]?up)\b/i,
      (m) => m.charAt(0).toUpperCase() + m.slice(1).toLowerCase(),
    );
  }
  if (/^with\s+\S/i.test(title)) {
    title = `Meeting ${title}`;
  }
  // Normalize pickup / drop-off phrasing
  if (/\bpick\s*up\b/i.test(title) || /\bpickup\b/i.test(title)) {
    title = title
      .replace(/\bpick\s*up\b/gi, "Pickup")
      .replace(/\bpickup\b/gi, "Pickup");
  }
  if (/\bdrop[\s-]?off\b/i.test(title) || /\bdropoff\b/i.test(title)) {
    title = title
      .replace(/\bdrop[\s-]?off\b/gi, "Drop-off")
      .replace(/\bdropoff\b/gi, "Drop-off");
  }
  // Bare leftovers after "block calendar for tomorrow 10am"
  if (!title || /^(calendar|for|on|at|the|a|an|event|from|to|another)$/i.test(title)) {
    title = /\bblock\b/i.test(message) ? "Busy" : "Event";
  }
  // Title-case short activity phrases ("school pickup of daughter")
  if (title === title.toLowerCase() && title.length <= 60) {
    title = title.replace(/\b\w/g, (c) => c.toUpperCase());
  }
  // Prefer "School Pickup — Daughter" when "of/for" names a person
  title = title.replace(
    /^(.*?\b(?:Pickup|Drop-off))\s+(?:Of|For)\s+(.+)$/i,
    (_, kind: string, who: string) => `${kind} — ${who}`,
  );

  const start = zonedLocalDateTime(timeZone, day, startClock.hour, startClock.minute);
  let end: Date;
  if (endClock) {
    end = zonedLocalDateTime(timeZone, day, endClock.hour, endClock.minute);
    if (end.getTime() <= start.getTime()) {
      // Cross-midnight range (rare in CoS booking).
      end = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
  } else {
    end = new Date(start.getTime() + durationMs);
  }
  return {
    title,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
  };
}

/** "from 12 to 2 PM" / "10-11am" → start+end clocks with shared meridiem inference. */
export function parseClockRange(
  text: string,
): { start: ParsedClock; end: ParsedClock } | null {
  const m = text.match(
    /\b(?:from\s+)?(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\s*(?:to|-|–|—)\s*(\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i,
  );
  if (!m?.[1] || !m[2]) return null;
  const startRaw = m[1].trim();
  const endRaw = m[2].trim();
  const startHasMer = /am|pm/i.test(startRaw);
  const endHasMer = /am|pm/i.test(endRaw);

  let end = parseClockToken(endRaw) ?? parseBareHourClock(endRaw);
  let start = parseClockToken(startRaw) ?? parseBareHourClock(startRaw);
  if (!start || !end) return null;

  if (!startHasMer && endHasMer) {
    const endMer = /pm/i.test(endRaw) ? "pm" : "am";
    start = applyMeridiemToBareHour(startRaw, endMer, end);
    if (!start) return null;
  } else if (startHasMer && !endHasMer) {
    const startMer = /pm/i.test(startRaw) ? "pm" : "am";
    end = applyMeridiemToBareHour(endRaw, startMer, start);
    if (!end) return null;
  }

  if (end.hour * 60 + end.minute <= start.hour * 60 + start.minute) {
    // e.g. bare "11 to 1" with no meridiem — bump end into afternoon if both < 12.
    if (!startHasMer && !endHasMer && end.hour < 12 && start.hour < 12) {
      end = { hour: end.hour + 12, minute: end.minute };
    }
  }
  return { start, end };
}

function parseBareHourClock(raw: string): ParsedClock | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, "");
  const m = s.match(/^(\d{1,2})(?::(\d{2}))?$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2] ?? 0);
  if (!Number.isFinite(hour) || hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/** Apply am/pm from the peer clock onto a bare hour like "12" or "10:30". */
function applyMeridiemToBareHour(
  raw: string,
  mer: "am" | "pm",
  peer: ParsedClock,
): ParsedClock | null {
  const bare = parseBareHourClock(raw);
  if (!bare) return parseClockToken(raw);
  // Already 24h-looking
  if (bare.hour > 12) return bare;

  const peerH12 = peer.hour === 0 ? 12 : peer.hour > 12 ? peer.hour - 12 : peer.hour;
  // "11 to 1pm" → 11am; "12 to 2pm" → noon; "1 to 3pm" → 1pm
  if (mer === "pm") {
    if (bare.hour === 12) return { hour: 12, minute: bare.minute }; // noon
    if (bare.hour > peerH12) return { hour: bare.hour, minute: bare.minute }; // morning before pm end
    return { hour: bare.hour + 12, minute: bare.minute };
  }
  // am
  if (bare.hour === 12) return { hour: 0, minute: bare.minute }; // midnight
  return { hour: bare.hour, minute: bare.minute };
}

export function formatCalendarProposalSummary(opts: {
  kind: string;
  title: string;
  startIso?: string | null;
  endIso?: string | null;
  timeZone: string;
  attendees?: string[] | null;
}): string {
  const start = parseIsoDate(opts.startIso);
  const when = start ? formatLocalWhenFriendly(start, opts.timeZone) : "time TBD";
  const verb =
    opts.kind === "calendar_update"
      ? "Update"
      : opts.kind === "calendar_cancel"
        ? "Cancel"
        : "Create";
  const invite =
    opts.attendees?.length ? ` (invite ${opts.attendees.join(", ")})` : "";
  return `${verb}: ${opts.title} — ${when}${invite}`;
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
