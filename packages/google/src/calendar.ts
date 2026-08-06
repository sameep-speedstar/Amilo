import { localDayBoundsUtc } from "@amilo/core";

export interface CalendarEvent {
  id: string;
  summary: string | null;
  startIso: string | null;
  endIso: string | null;
  location: string | null;
  status: string;
  allDay: boolean;
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
  url.searchParams.set("timeZone", timezone);
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
  const allDay = Boolean(start.date && !start.dateTime);
  return {
    id: String(item.id),
    summary: item.summary ? String(item.summary) : null,
    startIso: start.dateTime ?? start.date ?? null,
    endIso: end.dateTime ?? end.date ?? null,
    location: item.location ? String(item.location) : null,
    status: String(item.status ?? "confirmed"),
    allDay,
  };
}
