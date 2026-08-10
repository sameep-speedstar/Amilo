import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import type { Db } from "./index.js";
import type { EventRow } from "./repos.js";
import { geocodeCache, messageLog, places, travelPlans } from "./schema.js";

export type PlaceRow = typeof places.$inferSelect;
export type TravelPlanRow = typeof travelPlans.$inferSelect;

export async function listPlaces(db: Db, userId: string): Promise<PlaceRow[]> {
  return db.query.places.findMany({
    where: eq(places.userId, userId),
    orderBy: [asc(places.label)],
  });
}

export async function upsertPlace(
  db: Db,
  opts: {
    userId: string;
    label: string;
    address: string;
    lat: number | null;
    lng: number | null;
    source?: string;
  },
): Promise<PlaceRow> {
  const label = opts.label.trim().toLowerCase().slice(0, 20);
  const existing = await db.query.places.findFirst({
    where: and(eq(places.userId, opts.userId), eq(places.label, label)),
  });
  if (existing) {
    const [updated] = await db
      .update(places)
      .set({
        address: opts.address,
        lat: opts.lat,
        lng: opts.lng,
        source: opts.source ?? existing.source,
        lastConfirmedAt: new Date(),
      })
      .where(eq(places.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  const [created] = await db
    .insert(places)
    .values({
      userId: opts.userId,
      label,
      address: opts.address,
      lat: opts.lat,
      lng: opts.lng,
      source: opts.source ?? "user",
      lastConfirmedAt: new Date(),
    })
    .returning();
  if (!created) throw new Error("failed to create place");
  return created;
}

function normalizeAddressKey(address: string): string {
  return address.trim().toLowerCase().replace(/\s+/g, " ");
}

export async function getGeocodeCache(
  db: Db,
  address: string,
): Promise<{ lat: number; lng: number } | null | "miss"> {
  const key = normalizeAddressKey(address);
  if (!key) return "miss";
  const row = await db.query.geocodeCache.findFirst({
    where: eq(geocodeCache.addressKey, key),
  });
  if (!row) return null; // not cached
  if (!row.resolved || row.lat == null || row.lng == null) return "miss";
  return { lat: row.lat, lng: row.lng };
}

export async function putGeocodeCache(
  db: Db,
  address: string,
  result: { lat: number; lng: number } | null,
): Promise<void> {
  const key = normalizeAddressKey(address);
  if (!key) return;
  const existing = await db.query.geocodeCache.findFirst({
    where: eq(geocodeCache.addressKey, key),
  });
  if (existing) return;
  await db.insert(geocodeCache).values({
    addressKey: key,
    addressText: address.trim(),
    lat: result?.lat ?? null,
    lng: result?.lng ?? null,
    resolved: Boolean(result),
  });
}

export async function getTravelPlanByOccurrence(
  db: Db,
  opts: {
    userId: string;
    itemKind: string;
    itemId: string;
    occurrenceDate: string;
  },
): Promise<TravelPlanRow | null> {
  const row = await db.query.travelPlans.findFirst({
    where: and(
      eq(travelPlans.userId, opts.userId),
      eq(travelPlans.itemKind, opts.itemKind),
      eq(travelPlans.itemId, opts.itemId),
      eq(travelPlans.occurrenceDate, opts.occurrenceDate),
    ),
  });
  return row ?? null;
}

export async function upsertTravelPlan(
  db: Db,
  row: {
    userId: string;
    itemKind?: string;
    itemId: string;
    occurrenceDate: string;
    itemStartAt: Date;
    itemTitle: string | null;
    destinationText: string;
    destinationLat: number | null;
    destinationLng: number | null;
    originLabel: string;
    originPlaceId?: string | null;
    originLat: number | null;
    originLng: number | null;
    travelMins: number;
    leaveBy: Date;
    computedAt: Date;
  },
): Promise<TravelPlanRow> {
  const itemKind = row.itemKind ?? "event";
  const existing = await getTravelPlanByOccurrence(db, {
    userId: row.userId,
    itemKind,
    itemId: row.itemId,
    occurrenceDate: row.occurrenceDate,
  });
  if (existing) {
    const [updated] = await db
      .update(travelPlans)
      .set({
        itemStartAt: row.itemStartAt,
        itemTitle: row.itemTitle,
        destinationText: row.destinationText,
        destinationLat: row.destinationLat,
        destinationLng: row.destinationLng,
        originLabel: row.originLabel,
        originPlaceId: row.originPlaceId ?? null,
        originLat: row.originLat,
        originLng: row.originLng,
        travelMins: row.travelMins,
        leaveBy: row.leaveBy,
        computedAt: row.computedAt,
      })
      .where(eq(travelPlans.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  const [created] = await db
    .insert(travelPlans)
    .values({
      userId: row.userId,
      itemKind,
      itemId: row.itemId,
      occurrenceDate: row.occurrenceDate,
      itemStartAt: row.itemStartAt,
      itemTitle: row.itemTitle,
      destinationText: row.destinationText,
      destinationLat: row.destinationLat,
      destinationLng: row.destinationLng,
      originLabel: row.originLabel,
      originPlaceId: row.originPlaceId ?? null,
      originLat: row.originLat,
      originLng: row.originLng,
      travelMins: row.travelMins,
      leaveBy: row.leaveBy,
      computedAt: row.computedAt,
    })
    .returning();
  if (!created) throw new Error("failed to create travel plan");
  return created;
}

export async function updateTravelPlanRecheck(
  db: Db,
  id: string,
  patch: {
    travelMins: number;
    leaveBy: Date;
    lastCheckStage: string;
    lastCheckAt: Date;
    escalated?: boolean;
    originLabel?: string;
    originPlaceId?: string | null;
    originLat?: number;
    originLng?: number;
  },
): Promise<TravelPlanRow | null> {
  const [updated] = await db
    .update(travelPlans)
    .set(patch)
    .where(eq(travelPlans.id, id))
    .returning();
  return updated ?? null;
}

export async function markTravelAlertSent(
  db: Db,
  id: string,
  at: Date = new Date(),
): Promise<void> {
  await db.update(travelPlans).set({ alertSentAt: at }).where(eq(travelPlans.id, id));
}

/** Upcoming leave-bys that still need an alert (leave_by within lead window). */
export async function listTravelPlansNeedingAlert(
  db: Db,
  opts: { now?: Date; leadMins?: number } = {},
): Promise<TravelPlanRow[]> {
  const now = opts.now ?? new Date();
  const leadMins = opts.leadMins ?? 15;
  const windowEnd = new Date(now.getTime() + leadMins * 60_000);
  return db.query.travelPlans.findMany({
    where: and(
      isNull(travelPlans.alertSentAt),
      lte(travelPlans.leaveBy, windowEnd),
      gte(travelPlans.leaveBy, new Date(now.getTime() - 30 * 60_000)),
    ),
    orderBy: [asc(travelPlans.leaveBy)],
    limit: 50,
  });
}

export async function listUpcomingTravelPlans(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<TravelPlanRow[]> {
  return db.query.travelPlans.findMany({
    where: and(eq(travelPlans.userId, userId), gte(travelPlans.itemStartAt, now)),
    orderBy: [asc(travelPlans.leaveBy)],
    limit: 20,
  });
}

export async function getNearestUpcomingTravelPlan(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<TravelPlanRow | null> {
  const rows = await listUpcomingTravelPlans(db, userId, now);
  return rows[0] ?? null;
}

  /** Plans due for T-30 or T-10 recheck. */
export async function listTravelPlansForRecheck(
  db: Db,
  now: Date = new Date(),
): Promise<Array<TravelPlanRow & { stage: "t30" | "t10" }>> {
  const plans = await db.query.travelPlans.findMany({
    where: and(gte(travelPlans.leaveBy, now)),
    limit: 100,
  });
  const out: Array<TravelPlanRow & { stage: "t30" | "t10" }> = [];
  for (const p of plans) {
    if (!p.leaveBy) continue;
    const minsToLeave = (p.leaveBy.getTime() - now.getTime()) / 60_000;
    if (minsToLeave <= 10 && p.lastCheckStage !== "t10") {
      out.push({ ...p, stage: "t10" });
    } else if (
      minsToLeave <= 30 &&
      minsToLeave > 10 &&
      p.lastCheckStage !== "t30" &&
      p.lastCheckStage !== "t10"
    ) {
      out.push({ ...p, stage: "t30" });
    }
  }
  return out;
}

export function calendarLocationFromEvent(e: EventRow): string | null {
  const metaLoc = (e.meta as { location?: unknown })?.location;
  if (typeof metaLoc === "string" && metaLoc.trim()) return metaLoc.trim();
  if (e.snippet?.trim()) return e.snippet.trim();
  return null;
}

export async function countRoutesCallsToday(db: Db): Promise<number> {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: messageLog.id })
    .from(messageLog)
    .where(and(eq(messageLog.kind, "maps_routes"), gte(messageLog.ts, start)));
  return rows.length;
}
