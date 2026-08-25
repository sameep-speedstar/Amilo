import { formatLocalHm, localDayBoundsUtc } from "./time.js";

export const DEFAULT_TRAVEL_BUFFER_MINS = 10;
export const ALERT_LEAD_MINS = 15;
export const T30_RECHECK_MINS = 30;
export const T10_RECHECK_MINS = 10;
export const MATERIAL_DEGRADATION_MINS = 10;
/** Conservative km/h for haversine conflict estimate (no Routes). */
export const CONFLICT_ESTIMATE_KMH = 20;

export type TravelBlock = {
  id: string;
  title: string;
  start: Date;
  end: Date;
  location: string | null;
};

export type TravelConflict = {
  first: TravelBlock;
  second: TravelBlock;
  estimatedMins: number;
  gapMins: number;
};

export function computeLeaveBy(
  itemStart: Date,
  travelMins: number,
  bufferMins: number,
): Date {
  return new Date(itemStart.getTime() - (travelMins + bufferMins) * 60_000);
}

export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const r = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lng2 - lng1);
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dlambda / 2) ** 2;
  return 2 * r * Math.asin(Math.sqrt(a));
}

/** Pure conflict scan given blocks that already have lat/lng resolved. */
export function detectTravelConflictsFromCoords(
  blocks: Array<TravelBlock & { lat: number; lng: number }>,
): TravelConflict[] {
  const ordered = [...blocks].sort((a, b) => a.start.getTime() - b.start.getTime());
  const conflicts: TravelConflict[] = [];
  for (let i = 0; i < ordered.length; i++) {
    const first = ordered[i]!;
    for (let j = i + 1; j < ordered.length; j++) {
      const second = ordered[j]!;
      if (second.start < first.end) continue;
      const gapMs = second.start.getTime() - first.end.getTime();
      if (gapMs > 3 * 3600_000) break;
      const distanceKm = haversineKm(first.lat, first.lng, second.lat, second.lng);
      const estimatedMins = Math.round((distanceKm / CONFLICT_ESTIMATE_KMH) * 60);
      const gapMins = Math.round(gapMs / 60_000);
      if (estimatedMins > gapMins) {
        conflicts.push({ first, second, estimatedMins, gapMins });
      }
    }
  }
  return conflicts;
}

export function describeTravelConflict(
  conflict: TravelConflict,
  timeZone: string,
): string {
  const endHm = formatLocalHm(conflict.first.end, timeZone);
  const startHm = formatLocalHm(conflict.second.start, timeZone);
  return (
    `${conflict.first.title} ends ${endHm} at ${conflict.first.location}; ` +
    `${conflict.second.title} is at ${startHm} at ${conflict.second.location} — ` +
    `that's ~${conflict.estimatedMins} min away with only ${conflict.gapMins} min to get there.`
  );
}

export function buildDepartureAlertText(opts: {
  title: string;
  travelMins: number;
  leaveBy: Date;
  originLabel: string;
  destLat: number;
  destLng: number;
  timeZone: string;
  escalate?: boolean;
  deepLink: string;
}): string {
  const leaveHm = formatLocalHm(opts.leaveBy, opts.timeZone);
  const title = opts.title || "your next thing";
  if (opts.escalate) {
    return (
      `Traffic has gotten worse for ${title} — leave now, not ${leaveHm} ` +
      `(assuming you're leaving from ${opts.originLabel}). ${opts.deepLink}`
    );
  }
  return (
    `${title}, ~${opts.travelMins} min travel — leave by ${leaveHm} ` +
    `(assuming you're leaving from ${opts.originLabel}). ${opts.deepLink}`
  );
}

const MEETING_URL_RE =
  /https?:\/\/(?:meet\.google\.com\/[a-z0-9-]+|[\w.-]*zoom\.us\/[^\s<>"']+|teams\.microsoft\.com\/l\/meetup-join\/[^\s<>"']+|teams\.live\.com\/[^\s<>"']+)/i;

/** Pull a join URL from Calendar hangout / conference / location / description. */
export function extractMeetingUrl(opts: {
  hangoutLink?: string | null;
  location?: string | null;
  description?: string | null;
  conferenceEntryPoints?: Array<{ entryPointType?: string | null; uri?: string | null }> | null;
}): string | null {
  const hangout = opts.hangoutLink?.trim();
  if (hangout && /^https?:\/\//i.test(hangout)) return hangout.split(/\s/)[0]!;

  const video = (opts.conferenceEntryPoints ?? []).find(
    (p) =>
      String(p.entryPointType ?? "").toLowerCase() === "video" &&
      String(p.uri ?? "").trim().startsWith("http"),
  );
  if (video?.uri) return String(video.uri).trim().split(/\s/)[0]!;

  for (const blob of [opts.location, opts.description]) {
    const m = String(blob ?? "").match(MEETING_URL_RE);
    if (m?.[0]) return m[0].replace(/[),.;]+$/, "");
  }
  return null;
}

/** True when the event is virtual (Meet/Zoom/Teams) — no leave-by / Maps. */
export function isOnlineMeeting(opts: {
  meetingUrl?: string | null;
  location?: string | null;
}): boolean {
  if (opts.meetingUrl?.trim()) return true;
  const loc = String(opts.location ?? "").toLowerCase();
  if (!loc) return false;
  if (MEETING_URL_RE.test(loc)) return true;
  return (
    /\b(google meet|zoom|microsoft teams|webex|online only|virtual meeting)\b/.test(loc) &&
    !/\b\d{1,5}\s+\w/.test(loc) // street-ish address still physical
  );
}

/** WhatsApp ping for an online meeting (join link instead of Maps). */
export function buildMeetingLinkAlertText(opts: {
  title: string;
  start: Date;
  meetingUrl: string;
  timeZone: string;
}): string {
  const when = formatLocalHm(opts.start, opts.timeZone);
  const title = (opts.title || "Meeting").trim() || "Meeting";
  return `${title} starts at ${when} — join: ${opts.meetingUrl}`;
}

export function occurrenceDateLocal(start: Date, timeZone: string): string {
  return localDayBoundsUtc(timeZone, start).day;
}

export function parsePlaceSetCommand(
  text: string,
): { label: "home" | "office" | "school"; address: string } | null {
  return parsePlaceSetCommands(text)[0] ?? null;
}

/** One or more `home/office/school is …` lines in a single WhatsApp message. */
export function parsePlaceSetCommands(
  text: string,
): Array<{ label: "home" | "office" | "school"; address: string }> {
  const out: Array<{ label: "home" | "office" | "school"; address: string }> = [];
  const re = /(home|office|school)\s+is\s+([^\n]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const label = m[1]!.toLowerCase() as "home" | "office" | "school";
    const address = m[2]!.replace(/[?.!]+$/g, "").trim();
    if (address.length >= 3) out.push({ label, address });
  }
  return out;
}

/** Pull a destination from "at LITTLE PEARLS…" / "at 12 MG Road". */
export function extractEventLocation(message: string): string | null {
  const atClinic = message.match(
    /\bat\s+((?:LITTLE PEARLS|KHUSHI)[^,.\n]{0,60}|[A-Z][A-Za-z0-9 &.'-]{3,80})/i,
  );
  if (atClinic?.[1]) {
    const loc = atClinic[1].replace(/\s+/g, " ").trim();
    if (!/^(home|office|school|am|pm|\d)/i.test(loc)) return loc.slice(0, 120);
  }
  return null;
}

export function isPlacesListCommand(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[?.!]+$/g, "");
  return t === "places" || t === "my places";
}

/** "I'm at home" / "I'm at the office" / "leaving from office" */
export function parseOriginCorrection(text: string): string | null {
  const t = text.trim();
  const m =
    t.match(
      /^(?:i(?:'m| am)\s+(?:at|in)\s+(?:the\s+)?(home|office|school)|leaving from\s+(?:the\s+)?(home|office|school))\s*[?.!]*$/i,
    ) ??
    t.match(/^i(?:'m| am)\s+at\s+(.+)$/i);
  if (!m) return null;
  const label = (m[1] ?? m[2] ?? "").trim();
  return label || null;
}

export function timeOfDayPlaceLabel(
  localHour: number,
  available: Array<"home" | "office" | "school" | "custom" | string>,
): string | null {
  const ordered =
    localHour < 12
      ? ["home", "office", "school", "custom"]
      : ["office", "home", "school", "custom"];
  for (const label of ordered) {
    if (available.includes(label)) return label;
  }
  return available[0] ?? null;
}

export function formatLeaveByBriefLine(opts: {
  title: string;
  leaveBy: Date;
  travelMins: number;
  originLabel: string;
  timeZone: string;
}): string {
  const hm = formatLocalHm(opts.leaveBy, opts.timeZone);
  return `Leave by ${hm} for ${opts.title} (~${opts.travelMins} min from ${opts.originLabel})`;
}
