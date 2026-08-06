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

export interface CalendarWriteInput {
  title: string;
  startIso: string;
  endIso: string;
  timezone?: string;
  location?: string | null;
  description?: string | null;
}

const BASE = "https://www.googleapis.com/calendar/v3/calendars/primary/events";

/** Events in [timeMin, timeMax] for the given IANA timezone. */
export async function listCalendarRange(
  accessToken: string,
  timeMin: Date,
  timeMax: Date,
  timezone = "Asia/Kolkata",
): Promise<CalendarEvent[]> {
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

/** Today's events in the given IANA timezone (default Asia/Kolkata). */
export async function listCalendarToday(
  accessToken: string,
  timezone = "Asia/Kolkata",
): Promise<CalendarEvent[]> {
  const { timeMin, timeMax } = localDayBoundsUtc(timezone);
  return listCalendarRange(accessToken, timeMin, timeMax, timezone);
}

export async function createCalendarEvent(
  accessToken: string,
  input: CalendarWriteInput,
): Promise<CalendarEvent> {
  const tz = input.timezone ?? "Asia/Kolkata";
  const body = {
    summary: input.title,
    location: input.location ?? undefined,
    description: input.description ?? undefined,
    start: { dateTime: input.startIso, timeZone: tz },
    end: { dateTime: input.endIso, timeZone: tz },
  };
  const res = await fetch(BASE, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Calendar create ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return parseEvent((await res.json()) as Record<string, unknown>);
}

export async function patchCalendarEvent(
  accessToken: string,
  eventId: string,
  input: Partial<CalendarWriteInput>,
): Promise<CalendarEvent> {
  const tz = input.timezone ?? "Asia/Kolkata";
  const body: Record<string, unknown> = {};
  if (input.title != null) body.summary = input.title;
  if (input.location !== undefined) body.location = input.location;
  if (input.description !== undefined) body.description = input.description;
  if (input.startIso) body.start = { dateTime: input.startIso, timeZone: tz };
  if (input.endIso) body.end = { dateTime: input.endIso, timeZone: tz };

  const res = await fetch(`${BASE}/${encodeURIComponent(eventId)}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`Calendar patch ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return parseEvent((await res.json()) as Record<string, unknown>);
}

export async function cancelCalendarEvent(
  accessToken: string,
  eventId: string,
): Promise<void> {
  const res = await fetch(`${BASE}/${encodeURIComponent(eventId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok && res.status !== 410) {
    throw new Error(`Calendar cancel ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
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
