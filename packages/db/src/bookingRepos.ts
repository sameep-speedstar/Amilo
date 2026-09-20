import { and, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "./index.js";
import { browserJobs, browserProfiles } from "./schema.js";

export async function upsertBrowserProfile(
  db: Db,
  opts: {
    userId: string;
    status?: string;
    storagePath?: string | null;
  },
) {
  const now = new Date();
  const existing = await db
    .select()
    .from(browserProfiles)
    .where(eq(browserProfiles.userId, opts.userId))
    .limit(1);
  if (existing[0]) {
    const [row] = await db
      .update(browserProfiles)
      .set({
        ...(opts.status ? { status: opts.status } : {}),
        ...(opts.storagePath !== undefined ? { storagePath: opts.storagePath } : {}),
        lastActiveAt: now,
        updatedAt: now,
      })
      .where(eq(browserProfiles.userId, opts.userId))
      .returning();
    return row!;
  }
  const [row] = await db
    .insert(browserProfiles)
    .values({
      userId: opts.userId,
      status: opts.status ?? "idle",
      storagePath: opts.storagePath ?? null,
      lastActiveAt: now,
    })
    .returning();
  return row!;
}

export async function createBrowserJob(
  db: Db,
  opts: {
    id?: string;
    userId: string;
    merchant: string;
    vertical: string;
    intent: Record<string, unknown>;
    status?: string;
    pendingKind?: string | null;
    result?: Record<string, unknown>;
  },
) {
  const [row] = await db
    .insert(browserJobs)
    .values({
      ...(opts.id ? { id: opts.id } : {}),
      userId: opts.userId,
      merchant: opts.merchant,
      vertical: opts.vertical,
      intent: opts.intent,
      status: opts.status ?? "running",
      pendingKind: opts.pendingKind ?? null,
      result: opts.result ?? {},
    })
    .returning();
  return row!;
}

export async function updateBrowserJob(
  db: Db,
  jobId: string,
  patch: {
    status?: string;
    result?: Record<string, unknown>;
    error?: string | null;
    pendingKind?: string | null;
  },
) {
  const [row] = await db
    .update(browserJobs)
    .set({
      ...(patch.status ? { status: patch.status } : {}),
      ...(patch.result ? { result: patch.result } : {}),
      ...(patch.error !== undefined ? { error: patch.error } : {}),
      ...(patch.pendingKind !== undefined ? { pendingKind: patch.pendingKind } : {}),
      updatedAt: new Date(),
    })
    .where(eq(browserJobs.id, jobId))
    .returning();
  return row ?? null;
}

export async function getBrowserJob(db: Db, jobId: string) {
  const rows = await db.select().from(browserJobs).where(eq(browserJobs.id, jobId)).limit(1);
  return rows[0] ?? null;
}

export async function listOpenBrowserJobs(db: Db, userId: string) {
  return db
    .select()
    .from(browserJobs)
    .where(
      and(
        eq(browserJobs.userId, userId),
        inArray(browserJobs.status, [
          "queued",
          "running",
          "needs_otp",
          "needs_selection",
          "ready_confirm",
          "pay_link",
        ]),
      ),
    )
    .orderBy(desc(browserJobs.createdAt))
    .limit(10);
}
