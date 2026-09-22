import { eq } from "drizzle-orm";
import type { Db } from "./index.js";
import { uberAccounts } from "./schema.js";

export type UberAccountRow = typeof uberAccounts.$inferSelect;

export async function getUberAccount(db: Db, userId: string): Promise<UberAccountRow | null> {
  const rows = await db.select().from(uberAccounts).where(eq(uberAccounts.userId, userId)).limit(1);
  return rows[0] ?? null;
}

export async function upsertUberAccount(
  db: Db,
  row: {
    userId: string;
    uberUserId?: string | null;
    scopes: string;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    expiresAt: Date;
  },
): Promise<UberAccountRow> {
  const existing = await getUberAccount(db, row.userId);
  if (existing) {
    const [updated] = await db
      .update(uberAccounts)
      .set({
        ...(row.uberUserId !== undefined ? { uberUserId: row.uberUserId } : {}),
        scopes: row.scopes,
        accessTokenEnc: row.accessTokenEnc,
        refreshTokenEnc: row.refreshTokenEnc || existing.refreshTokenEnc,
        expiresAt: row.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(uberAccounts.userId, row.userId))
      .returning();
    return updated!;
  }
  const [created] = await db
    .insert(uberAccounts)
    .values({
      userId: row.userId,
      uberUserId: row.uberUserId ?? null,
      scopes: row.scopes,
      accessTokenEnc: row.accessTokenEnc,
      refreshTokenEnc: row.refreshTokenEnc,
      expiresAt: row.expiresAt,
    })
    .returning();
  return created!;
}

export async function deleteUberAccount(db: Db, userId: string): Promise<boolean> {
  const res = await db.delete(uberAccounts).where(eq(uberAccounts.userId, userId)).returning();
  return res.length > 0;
}
