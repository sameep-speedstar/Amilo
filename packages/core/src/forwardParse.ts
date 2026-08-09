import {
  formatLocalHm,
  localDayBoundsUtc,
  parseClockToken,
  zonedLocalDateTime,
} from "./time.js";

export type ForwardCalendarHint = {
  title: string;
  startIso: string;
  endIso: string;
  description?: string;
  source: "appointment" | "travel";
};

function parseLooseDate(blob: string): string | null {
  const iso = blob.match(/\b(20\d{2})-(\d{2})-(\d{2})\b/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  const months: Record<string, string> = {
    jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
    jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
  };

  const mdy = blob.match(
    /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(\d{1,2}),?\s+(20\d{2})\b/i,
  );
  if (mdy) {
    const mon = months[mdy[1]!.slice(0, 3).toLowerCase()];
    if (mon) return `${mdy[3]}-${mon}-${String(Number(mdy[2])).padStart(2, "0")}`;
  }

  const dmy = blob.match(
    /\b(\d{1,2})\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+(20\d{2})\b/i,
  );
  if (dmy) {
    const mon = months[dmy[2]!.slice(0, 3).toLowerCase()];
    if (mon) return `${dmy[3]}-${mon}-${String(Number(dmy[1])).padStart(2, "0")}`;
  }
  return null;
}

function parseLooseClock(blob: string): { hour: number; minute: number } | null {
  const ampm = blob.match(/\b(\d{1,2}(?::\d{2})?\s*[ap]m)\b/i);
  if (ampm?.[1]) return parseClockToken(ampm[1]);

  const hms = blob.match(/\b(\d{1,2}):(\d{2})(?::\d{2})?\b/);
  if (hms) {
    const hour = Number(hms[1]);
    const minute = Number(hms[2]);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) {
      return { hour, minute };
    }
  }
  return null;
}

/** IVF / clinic WhatsApp appointment forwards. */
export function parseAppointmentForward(
  message: string,
  timeZone: string,
  now: Date = new Date(),
): ForwardCalendarHint | null {
  const text = message.replace(/\s+/g, " ").trim();
  if (!/appointment confirmation|your appointment with|scheduled on/i.test(text)) {
    return null;
  }

  const day =
    parseLooseDate(text.match(/date\s*[:=]?\s*([^\n.]+)/i)?.[1] ?? "") ??
    parseLooseDate(text);
  if (!day) return null;

  const timeBlob =
    text.match(/time\s*[:=]?\s*([^\n.]+)/i)?.[1] ??
    text;
  const clock = parseLooseClock(timeBlob) ?? parseLooseClock(text);
  if (!clock) return null;

  const clinic =
    text.match(/\bat\s+([A-Z][A-Z0-9 &.'-]{3,60})/i)?.[1]?.trim() ??
    text.match(/\b(KHUSHI[^\n,]{0,40}|LITTLE PEARLS[^\n,]{0,40})/i)?.[1]?.trim() ??
    "Appointment";
  const patient =
    text.match(/patient\s+([A-Za-z][A-Za-z .']{1,40})/i)?.[1]?.trim() ??
    text.match(/\(\s*patient\s+([^)]+)\)/i)?.[1]?.trim();
  const doctor = text.match(/dr\.?\s*([A-Za-z .']{2,40})/i)?.[1]?.trim();

  const isIvf = /fertility|ivf/i.test(text) || /khushi/i.test(clinic);
  const title = (
    patient
      ? `${isIvf ? "IVF appointment" : "Appointment"} for ${patient.split(/\s+/).slice(0, 2).join(" ")}`
      : doctor
        ? `Appointment with Dr ${doctor.split(/\s+/)[0]}`
        : `Appointment at ${clinic.slice(0, 40)}`
  ).slice(0, 80);

  const start = zonedLocalDateTime(timeZone, day, clock.hour, clock.minute);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  if (start.getTime() < now.getTime() - 12 * 60 * 60 * 1000) return null;

  return {
    title,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    description: text.slice(0, 500),
    source: "appointment",
  };
}

/** Bus / train booking forwards (Zingbus-style). */
export function parseTravelForward(
  message: string,
  timeZone: string,
  now: Date = new Date(),
): ForwardCalendarHint | null {
  const text = message.replace(/\r/g, "");
  if (
    !/pickup date|pnr\s*:|bus number|seat\s*:|track your bus|zingbus|journey details/i.test(
      text,
    )
  ) {
    return null;
  }

  const whenLine =
    text.match(/pickup date\s*&\s*time\s*[:=]?\s*([^\n]+)/i)?.[1]?.trim() ??
    text.match(/pickup date\s*[:=]?\s*([^\n]+)/i)?.[1]?.trim();
  if (!whenLine) return null;

  const day = parseLooseDate(whenLine);
  const clock = parseLooseClock(whenLine);
  if (!day || !clock) return null;

  const route = text.match(/route\s*[:=]?\s*([^\n]+)/i)?.[1]?.trim() ?? "Bus journey";
  const pnr = text.match(/pnr\s*[:=]?\s*([A-Z0-9]+)/i)?.[1];
  const seat = text.match(/seat\s*[:=]?\s*([^\n]+)/i)?.[1]?.trim();
  const pickup = text.match(/pickup point\s*[:=]?\s*([^\n]+)/i)?.[1]?.trim();

  const start = zonedLocalDateTime(timeZone, day, clock.hour, clock.minute);
  if (start.getTime() < now.getTime() - 6 * 60 * 60 * 1000) return null;
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  const title = `Bus: ${route.replace(/\s+/g, " ").slice(0, 50)}`.slice(0, 80);
  const description = [
    pnr ? `PNR ${pnr}` : null,
    seat ? `Seat ${seat}` : null,
    pickup ? `Pickup: ${pickup}` : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return {
    title,
    startIso: start.toISOString(),
    endIso: end.toISOString(),
    ...(description ? { description } : {}),
    source: "travel",
  };
}

export function parseForwardToCalendar(
  message: string,
  timeZone: string,
  now: Date = new Date(),
): ForwardCalendarHint | null {
  return (
    parseAppointmentForward(message, timeZone, now) ??
    parseTravelForward(message, timeZone, now)
  );
}

/** Display cleanup for junk Google titles already written. */
export function cleanCalendarDisplayTitle(title: string): string {
  const t = title.trim();
  if (/^calendar for$/i.test(t)) return "Busy";
  if (/^cool,\s*book\b/i.test(t)) {
    return t.replace(/^cool,\s*/i, "").replace(/^book\s+/i, "Meeting ").trim() || "Busy";
  }
  return t;
}

/** Names mentioned as invite / meeting targets (no emails). */
export function extractInviteeNames(message: string): string[] {
  const names: string[] = [];
  const patterns = [
    /\binvite\s+([A-Z][a-zA-Z.'-]{1,40})(?:\s+(?:for|to|on|at|tomorrow|today)\b|[.,]|$)/,
    /\b(?:to|with)\s+([A-Z][a-zA-Z.'-]{1,40})(?:\s+(?:for|on|at|tomorrow|today)\b|[.,]|$)/i,
    /\bcalendar invite (?:to|for)\s+([A-Z][a-zA-Z.'-]{1,40})\b/i,
    /\bsend (?:a )?(?:calendar )?invite to\s+([A-Z][a-zA-Z.'-]{1,40})\b/i,
  ];
  for (const re of patterns) {
    const m = message.match(re);
    if (m?.[1]) {
      const n = m[1].trim();
      if (!/^(the|a|an|me|him|her|them|us|email|calendar|meeting)$/i.test(n)) {
        names.push(n);
      }
    }
  }
  // Lowercase "rajeev" / "rajiv" still count
  const lower = message.match(
    /\b(?:invite|to|with)\s+(rajeev|rajiv)\b/i,
  );
  if (lower?.[1]) {
    const canon = lower[1].toLowerCase() === "rajiv" ? "Rajeev" : "Rajeev";
    if (!names.some((n) => n.toLowerCase() === canon.toLowerCase())) {
      names.push(canon);
    }
  }
  return [...new Set(names.map((n) => n.trim()).filter(Boolean))];
}

export function isCalendarInviteIntent(message: string): boolean {
  const t = message.trim();
  if (/\bcalendar invite\b/i.test(t)) return true;
  if (/\bsend\s+(?:a\s+)?invite\b/i.test(t) && !/\b(email|mail)\b/i.test(t)) return true;
  if (/\binvite\b/i.test(t) && /\b(calendar|meeting|call)\b/i.test(t)) return true;
  if (/\binvite\b/i.test(t) && extractInviteeNames(t).length > 0) return true;
  return false;
}

export function formatForwardWhen(hint: ForwardCalendarHint, timeZone: string): string {
  return `${formatLocalHm(new Date(hint.startIso), timeZone)} ${hint.title}`;
}

/** @internal test helper */
export function tomorrowYmd(timeZone: string, now: Date = new Date()): string {
  const { timeMax } = localDayBoundsUtc(timeZone, now);
  return localDayBoundsUtc(timeZone, timeMax).day;
}
