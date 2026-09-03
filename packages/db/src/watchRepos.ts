import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { commitments, events, messageLog, users, watches } from "./schema.js";

export type WatchRow = typeof watches.$inferSelect;
export type WatchKind = "awaiting_reply" | "commitment_stall";
export type WatchStatus = "open" | "fired" | "cancelled";

export async function createWatch(
  db: Db,
  opts: {
    userId: string;
    kind: WatchKind;
    title: string;
    personLabel?: string | null;
    email?: string | null;
    commitmentId?: string | null;
    dueAt?: Date | null;
    meta?: Record<string, unknown>;
  },
): Promise<WatchRow> {
  const [row] = await db
    .insert(watches)
    .values({
      userId: opts.userId,
      kind: opts.kind,
      status: "open",
      title: opts.title.slice(0, 500),
      personLabel: opts.personLabel?.slice(0, 200) ?? null,
      email: opts.email?.trim().toLowerCase().slice(0, 320) || null,
      commitmentId: opts.commitmentId ?? null,
      dueAt: opts.dueAt ?? null,
      armedAt: new Date(),
      meta: opts.meta ?? {},
    })
    .returning();
  if (!row) throw new Error("failed to create watch");
  return row;
}

export async function listOpenWatches(db: Db, userId?: string): Promise<WatchRow[]> {
  if (userId) {
    return db.query.watches.findMany({
      where: and(eq(watches.userId, userId), eq(watches.status, "open")),
      orderBy: [asc(watches.armedAt)],
      limit: 100,
    });
  }
  return db.query.watches.findMany({
    where: eq(watches.status, "open"),
    orderBy: [asc(watches.armedAt)],
    limit: 200,
  });
}

export async function markWatchChecked(db: Db, id: string, at: Date = new Date()): Promise<void> {
  await db.update(watches).set({ lastCheckedAt: at }).where(eq(watches.id, id));
}

export async function fireWatch(
  db: Db,
  id: string,
  at: Date = new Date(),
): Promise<WatchRow | null> {
  const [updated] = await db
    .update(watches)
    .set({
      status: "fired",
      alertSentAt: at,
      lastCheckedAt: at,
    })
    .where(and(eq(watches.id, id), eq(watches.status, "open")))
    .returning();
  return updated ?? null;
}

export async function cancelWatch(db: Db, id: string): Promise<WatchRow | null> {
  const [updated] = await db
    .update(watches)
    .set({ status: "cancelled" })
    .where(and(eq(watches.id, id), eq(watches.status, "open")))
    .returning();
  return updated ?? null;
}

export async function cancelWatchesForCommitment(db: Db, commitmentId: string): Promise<number> {
  const rows = await db
    .update(watches)
    .set({ status: "cancelled" })
    .where(and(eq(watches.commitmentId, commitmentId), eq(watches.status, "open")))
    .returning({ id: watches.id });
  return rows.length;
}

/**
 * When a person email is learned later, attach it to open awaiting_reply
 * watches that still lack email (label / title match).
 */
export async function attachEmailToOpenWatches(
  db: Db,
  userId: string,
  opts: { personLabel: string; email: string },
): Promise<number> {
  const email = opts.email.trim().toLowerCase();
  if (!email.includes("@")) return 0;
  const needle = opts.personLabel.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!needle) return 0;
  const open = await listOpenWatches(db, userId);
  let n = 0;
  for (const w of open) {
    if (w.kind !== "awaiting_reply") continue;
    if (w.email) continue;
    const hay = `${w.personLabel ?? ""} ${w.title}`.toLowerCase();
    const label = (w.personLabel ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
    const match =
      (label && (label === needle || label.includes(needle) || needle.includes(label))) ||
      hay.includes(needle);
    if (!match) continue;
    await db.update(watches).set({ email }).where(eq(watches.id, w.id));
    n += 1;
  }
  return n;
}

export async function cancelWatchesByHint(
  db: Db,
  userId: string,
  hint: string,
): Promise<{ cancelled: number; titles: string[] }> {
  const needle = hint.trim().toLowerCase();
  if (!needle) return { cancelled: 0, titles: [] };
  const open = await listOpenWatches(db, userId);
  const matches = open.filter((w) => {
    const hay = `${w.title} ${w.personLabel ?? ""} ${w.email ?? ""}`.toLowerCase();
    return hay.includes(needle) || needle.includes((w.personLabel ?? "").toLowerCase());
  });
  const titles: string[] = [];
  for (const w of matches) {
    await cancelWatch(db, w.id);
    titles.push(w.title);
  }
  return { cancelled: titles.length, titles };
}

/** Inbound mail events from actor/email after armedAt. */
export async function findInboundMailAfter(
  db: Db,
  opts: { userId: string; email: string; after: Date },
): Promise<Array<{ id: string; title: string | null; actor: string | null; createdAt: Date }>> {
  const email = opts.email.trim().toLowerCase();
  if (!email.includes("@")) return [];
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, opts.userId),
      eq(events.source, "gmail"),
      gte(events.createdAt, opts.after),
    ),
    orderBy: [desc(events.createdAt)],
    limit: 40,
  });
  return rows
    .filter((e) => {
      const actor = (e.actor ?? "").toLowerCase();
      const metaEmail =
        typeof (e.meta as { from?: unknown })?.from === "string"
          ? String((e.meta as { from: string }).from).toLowerCase()
          : "";
      return actor.includes(email) || metaEmail.includes(email) || actor === email;
    })
    .map((e) => ({
      id: e.id,
      title: e.title,
      actor: e.actor,
      createdAt: e.createdAt,
    }));
}

/** Stall watches: open commitment due within lead window (or overdue). */
export function commitmentStallDue(
  dueAt: Date | null | undefined,
  now: Date,
  leadMs = 4 * 3600_000,
): boolean {
  if (!dueAt) return false;
  const t = dueAt.getTime();
  return t <= now.getTime() + leadMs;
}

export async function countWatcherAlertsToday(
  db: Db,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const rows = await db
    .select({ id: messageLog.id })
    .from(messageLog)
    .where(
      and(
        eq(messageLog.userId, userId),
        eq(messageLog.direction, "out"),
        gte(messageLog.ts, start),
        sql`${messageLog.meta}->>'watchId' is not null`,
      ),
    );
  return rows.length;
}

export type OpenWatchWithUser = WatchRow & {
  userName: string | null;
  timezone: string;
  userStatus: string;
};

export async function listOpenWatchesWithUsers(db: Db): Promise<OpenWatchWithUser[]> {
  const rows = await db
    .select({
      watch: watches,
      userName: users.name,
      timezone: users.timezone,
      userStatus: users.status,
    })
    .from(watches)
    .innerJoin(users, eq(users.id, watches.userId))
    .where(eq(watches.status, "open"))
    .orderBy(asc(watches.armedAt))
    .limit(200);

  return rows.map((r) => ({
    ...r.watch,
    userName: r.userName,
    timezone: r.timezone,
    userStatus: r.userStatus,
  }));
}

export async function getCommitmentById(
  db: Db,
  id: string,
): Promise<(typeof commitments.$inferSelect) | null> {
  const row = await db.query.commitments.findFirst({
    where: eq(commitments.id, id),
  });
  return row ?? null;
}
