import {
  computeLeaveBy,
  DEFAULT_TRAVEL_BUFFER_MINS,
  occurrenceDateLocal,
  timeOfDayPlaceLabel,
  type TravelBlock,
} from "@amilo/core";
import {
  countRoutesCallsToday,
  getGeocodeCache,
  getNearestUpcomingTravelPlan,
  getTravelPlanByOccurrence,
  listPlaces,
  logMessage,
  putGeocodeCache,
  updateTravelPlanRecheck,
  upsertTravelPlan,
  type Db,
  type EventRow,
  type TravelPlanRow,
  calendarLocationFromEvent,
} from "@amilo/db";
import { MapsClient, buildMapsDeepLink } from "@amilo/google";

const ROUTES_DAILY_CAP = 200;
const GEOCODE_COST_USD = 0.005;
const ROUTES_COST_USD = 0.01;
const ORIGIN_ADJACENCY_MS = 2 * 3600_000;

async function logMapsCost(
  db: Db,
  userId: string | null,
  kind: "maps_geocode" | "maps_routes",
  costUsd: number,
): Promise<void> {
  if (!userId) return;
  await logMessage(db, {
    userId,
    channel: "system",
    direction: "out",
    kind,
    meta: { costUsd },
  });
}

export async function geocodeAddress(
  db: Db,
  maps: MapsClient,
  address: string,
  userId?: string | null,
): Promise<{ lat: number; lng: number } | null> {
  const cached = await getGeocodeCache(db, address);
  if (cached === "miss") return null;
  if (cached) return cached;
  const result = await maps.geocode(address);
  await logMapsCost(db, userId ?? null, "maps_geocode", GEOCODE_COST_USD);
  await putGeocodeCache(db, address, result);
  return result;
}

function bufferMinsFromPrefs(prefs: Record<string, unknown>): number {
  const raw = prefs.travelBufferMins ?? prefs.travel_buffer_mins;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.round(n) : DEFAULT_TRAVEL_BUFFER_MINS;
}

export type LocatedCalendarBlock = TravelBlock & {
  eventId: string;
};

export function eventToTravelBlock(e: EventRow, timeZone: string): LocatedCalendarBlock | null {
  if (!e.occursAt) return null;
  const location = calendarLocationFromEvent(e);
  if (!location) return null;
  const endIso = (e.meta as { end?: unknown })?.end;
  const end =
    typeof endIso === "string" && endIso
      ? new Date(endIso)
      : new Date(e.occursAt.getTime() + 60 * 60 * 1000);
  return {
    id: e.id,
    eventId: e.id,
    title: (e.title ?? "Event").trim() || "Event",
    start: e.occursAt,
    end,
    location,
  };
}

async function inferOrigin(
  db: Db,
  maps: MapsClient,
  userId: string,
  itemStart: Date,
  preceding: LocatedCalendarBlock[],
  timeZone: string,
): Promise<{
  label: string;
  lat: number;
  lng: number;
  placeId: string | null;
} | null> {
  const candidates = preceding
    .filter((b) => b.location && b.end <= itemStart)
    .sort((a, b) => b.end.getTime() - a.end.getTime());
  if (candidates[0] && itemStart.getTime() - candidates[0].end.getTime() <= ORIGIN_ADJACENCY_MS) {
    const block = candidates[0];
    const latlng = await geocodeAddress(db, maps, block.location!, userId);
    if (latlng) {
      return {
        label: `your ${block.title}`,
        lat: latlng.lat,
        lng: latlng.lng,
        placeId: null,
      };
    }
  }

  const userPlaces = (await listPlaces(db, userId)).filter(
    (p) => p.lat != null && p.lng != null,
  );
  if (!userPlaces.length) return null;
  const localHour = Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      hour: "numeric",
      hour12: false,
    }).format(itemStart),
  );
  const pickLabel = timeOfDayPlaceLabel(
    localHour,
    userPlaces.map((p) => p.label),
  );
  const place =
    userPlaces.find((p) => p.label === pickLabel) ?? userPlaces[0]!;
  return {
    label: place.label === "home" ? "home" : place.label,
    lat: place.lat!,
    lng: place.lng!,
    placeId: place.id,
  };
}

export async function computeTravelPlanForBlock(
  db: Db,
  maps: MapsClient,
  opts: {
    userId: string;
    timeZone: string;
    prefs: Record<string, unknown>;
    block: LocatedCalendarBlock;
    preceding: LocatedCalendarBlock[];
    now?: Date;
  },
): Promise<TravelPlanRow | null> {
  const now = opts.now ?? new Date();
  const occurrenceDate = occurrenceDateLocal(opts.block.start, opts.timeZone);
  const existing = await getTravelPlanByOccurrence(db, {
    userId: opts.userId,
    itemKind: "event",
    itemId: opts.block.eventId,
    occurrenceDate,
  });
  if (existing?.computedAt) return existing;

  if ((await countRoutesCallsToday(db)) >= ROUTES_DAILY_CAP) {
    console.warn(JSON.stringify({ event: "maps_routes_daily_cap", cap: ROUTES_DAILY_CAP }));
    return existing;
  }

  const destination = await geocodeAddress(
    db,
    maps,
    opts.block.location!,
    opts.userId,
  );
  if (!destination) return null;
  const origin = await inferOrigin(
    db,
    maps,
    opts.userId,
    opts.block.start,
    opts.preceding,
    opts.timeZone,
  );
  if (!origin) return null;

  const route = await maps.computeRouteMinutes(
    origin.lat,
    origin.lng,
    destination.lat,
    destination.lng,
    opts.block.start,
  );
  await logMapsCost(db, opts.userId, "maps_routes", ROUTES_COST_USD);
  if (!route) return null;

  const buffer = bufferMinsFromPrefs(opts.prefs);
  const leaveBy = computeLeaveBy(opts.block.start, route.durationMins, buffer);
  return upsertTravelPlan(db, {
    userId: opts.userId,
    itemId: opts.block.eventId,
    occurrenceDate,
    itemStartAt: opts.block.start,
    itemTitle: opts.block.title,
    destinationText: opts.block.location!,
    destinationLat: destination.lat,
    destinationLng: destination.lng,
    originLabel: origin.label,
    originPlaceId: origin.placeId,
    originLat: origin.lat,
    originLng: origin.lng,
    travelMins: route.durationMins,
    leaveBy,
    computedAt: now,
  });
}

export async function recheckTravelPlan(
  db: Db,
  maps: MapsClient,
  plan: TravelPlanRow,
  stage: "t30" | "t10",
  prefs: Record<string, unknown>,
  now: Date = new Date(),
): Promise<{ degraded: boolean; plan: TravelPlanRow } | null> {
  if (
    plan.originLat == null ||
    plan.originLng == null ||
    plan.destinationLat == null ||
    plan.destinationLng == null
  ) {
    return null;
  }
  if ((await countRoutesCallsToday(db)) >= ROUTES_DAILY_CAP) return null;

  const route = await maps.computeRouteMinutes(
    plan.originLat,
    plan.originLng,
    plan.destinationLat,
    plan.destinationLng,
    plan.leaveBy ?? now,
  );
  await logMapsCost(db, plan.userId, "maps_routes", ROUTES_COST_USD);
  if (!route) return null;

  const oldMins = plan.travelMins;
  const buffer = bufferMinsFromPrefs(prefs);
  const leaveBy = computeLeaveBy(plan.itemStartAt, route.durationMins, buffer);
  const degraded =
    oldMins != null && route.durationMins - oldMins >= 10;
  const updated = await updateTravelPlanRecheck(db, plan.id, {
    travelMins: route.durationMins,
    leaveBy,
    lastCheckStage: stage,
    lastCheckAt: now,
    ...(degraded ? { escalated: true } : {}),
  });
  if (!updated) return null;
  return { degraded, plan: updated };
}

export async function correctTravelOrigin(
  db: Db,
  maps: MapsClient,
  opts: {
    userId: string;
    correctionText: string;
    prefs: Record<string, unknown>;
    timeZone: string;
    now?: Date;
  },
): Promise<string> {
  const now = opts.now ?? new Date();
  const plan = await getNearestUpcomingTravelPlan(db, opts.userId, now);
  if (!plan) return "Nothing upcoming to correct.";

  const textLower = opts.correctionText.trim().toLowerCase();
  const userPlaces = (await listPlaces(db, opts.userId)).filter(
    (p) => p.lat != null && p.lng != null,
  );
  const matched = userPlaces.find(
    (p) => p.label === textLower || textLower.includes(p.label),
  );

  let originLabel: string;
  let originLat: number;
  let originLng: number;
  let originPlaceId: string | null;

  if (matched) {
    originLabel = matched.label;
    originLat = matched.lat!;
    originLng = matched.lng!;
    originPlaceId = matched.id;
  } else {
    const latlng = await geocodeAddress(db, maps, opts.correctionText, opts.userId);
    if (!latlng) {
      return `Couldn't find a location for '${opts.correctionText}' — leave-by stays as is.`;
    }
    originLabel = opts.correctionText.trim();
    originLat = latlng.lat;
    originLng = latlng.lng;
    originPlaceId = null;
  }

  if (plan.destinationLat == null || plan.destinationLng == null) {
    return "Couldn't recompute — missing destination.";
  }
  if ((await countRoutesCallsToday(db)) >= ROUTES_DAILY_CAP) {
    return "Travel routing budget hit for today — leave-by stays as is.";
  }

  const route = await maps.computeRouteMinutes(
    originLat,
    originLng,
    plan.destinationLat,
    plan.destinationLng,
    now,
  );
  await logMapsCost(db, opts.userId, "maps_routes", ROUTES_COST_USD);
  if (!route) return "Couldn't recompute travel time right now — leave-by stays as is.";

  const buffer = bufferMinsFromPrefs(opts.prefs);
  const leaveBy = computeLeaveBy(plan.itemStartAt, route.durationMins, buffer);
  await updateTravelPlanRecheck(db, plan.id, {
    travelMins: route.durationMins,
    leaveBy,
    lastCheckStage: plan.lastCheckStage ?? "t30",
    lastCheckAt: now,
    originLabel,
    originPlaceId,
    originLat,
    originLng,
  });

  const leaveHm = new Intl.DateTimeFormat("en-GB", {
    timeZone: opts.timeZone,
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(leaveBy);

  return (
    `Got it — from ${originLabel}, ${plan.itemTitle || "that"} is ` +
    `~${route.durationMins} min away. Leave by ${leaveHm}.`
  );
}

export { buildMapsDeepLink };
