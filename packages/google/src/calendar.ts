export interface CalendarEvent {
  id: string;
  summary: string | null;
  startIso: string | null;
  endIso: string | null;
  location: string | null;
  status: string;
}

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Today's events in the given IANA timezone (default Asia/Kolkata). */
export async function listCalendarToday(
  accessToken: string,
  timezone = "Asia/Kolkata",
): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = localDayBoundsUtc(timezone);
  const url = new URL(BASE);
  url.searchParams.set("singleEvents", "true");
  url.searchParams.set("orderBy", "startTime");
  url.searchParams.set("timeMin", timeMin.toISOString());
  url.searchParams.set("timeMax", timeMax.toISOString());

  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    throw new Error(`Calendar ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as {
    items?: Array<Record<string, unknown>>;
  };
  return (data.items ?? []).map(parseEvent);
}

function parseEvent(item: Record<string, unknown>): CalendarEvent {
  const start = (item.start ?? {}) as Record<string, string>;
  const end = (item.end ?? {}) as Record<string, string>;
  return {
    id: String(item.id),
    summary: item.summary ? String(item.summary) : null,
    startIso: start.dateTime ?? start.date ?? null,
    endIso: end.dateTime ?? end.date ?? null,
    location: item.location ? String(item.location) : null,
    status: String(item.status ?? "confirmed"),
  };
}

function localDayBoundsUtc(timeZone: string): { timeMin: Date; timeMax: Date } {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);

  const offsetMin = getTimezoneOffsetMinutes(timeZone, now);
  const [y, m, d] = day.split("-").map(Number) as [number, number, number];
  const startUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMin * 60_000;
  const endUtcMs = startUtcMs + 24 * 60 * 60 * 1000;
  return { timeMin: new Date(startUtcMs), timeMax: new Date(endUtcMs) };
}

function getTimezoneOffsetMinutes(timeZone: string, at: Date): number {
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
