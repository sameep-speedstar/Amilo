import { and, eq, sql } from "drizzle-orm";
import type { Db } from "./index.js";
import { channels, messageLog, users, webhookDedupe } from "./schema.js";

export type UserRow = typeof users.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;

export async function claimWebhookMessage(db: Db, messageId: string): Promise<boolean> {
  const inserted = await db
    .insert(webhookDedupe)
    .values({ id: messageId })
    .onConflictDoNothing()
    .returning({ id: webhookDedupe.id });
  return inserted.length > 0;
}

/** Upsert WhatsApp user + channel; returns durable user id (UUID). */
export async function upsertWhatsAppUser(
  db: Db,
  opts: { phoneE164: string; waId: string; profileName?: string },
): Promise<UserRow> {
  const existing = await db.query.users.findFirst({
    where: eq(users.phoneE164, opts.phoneE164),
  });

  let user: UserRow;
  if (existing) {
    if (opts.profileName && opts.profileName !== existing.name) {
      const [updated] = await db
        .update(users)
        .set({ name: opts.profileName })
        .where(eq(users.id, existing.id))
        .returning();
      user = updated ?? existing;
    } else {
      user = existing;
    }
  } else {
    const [created] = await db
      .insert(users)
      .values({
        phoneE164: opts.phoneE164,
        name: opts.profileName ?? null,
        status: "active",
      })
      .returning();
    if (!created) throw new Error("failed to create user");
    user = created;
  }

  const ch = await db.query.channels.findFirst({
    where: and(eq(channels.kind, "whatsapp"), eq(channels.address, opts.waId)),
  });
  if (!ch) {
    await db.insert(channels).values({
      userId: user.id,
      kind: "whatsapp",
      address: opts.waId,
      isPrimary: true,
    });
  }

  return user;
}

export async function getUserById(db: Db, userId: string): Promise<UserRow | undefined> {
  return db.query.users.findFirst({ where: eq(users.id, userId) });
}

export async function setUserStatus(
  db: Db,
  userId: string,
  status: "active" | "paused" | "deleted",
): Promise<void> {
  await db.update(users).set({ status }).where(eq(users.id, userId));
}

export async function setCursorAgentId(db: Db, userId: string, agentId: string): Promise<void> {
  await db.update(users).set({ cursorAgentId: agentId }).where(eq(users.id, userId));
}

export async function getWhatsAppAddress(db: Db, userId: string): Promise<string | null> {
  const ch = await db.query.channels.findFirst({
    where: and(eq(channels.userId, userId), eq(channels.kind, "whatsapp")),
  });
  return ch?.address ?? null;
}

export async function touchWhatsAppInbound(
  db: Db,
  waId: string,
  at: Date,
): Promise<void> {
  await db
    .update(channels)
    .set({ lastInboundAt: at })
    .where(and(eq(channels.kind, "whatsapp"), eq(channels.address, waId)));
}

export async function getWhatsAppLastInbound(
  db: Db,
  waId: string,
): Promise<Date | null> {
  const ch = await db.query.channels.findFirst({
    where: and(eq(channels.kind, "whatsapp"), eq(channels.address, waId)),
  });
  return ch?.lastInboundAt ?? null;
}

export async function logMessage(
  db: Db,
  row: {
    userId?: string | null;
    channel: string;
    direction: "in" | "out";
    kind: string;
    bodyRef?: string;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(messageLog).values({
    userId: row.userId ?? null,
    channel: row.channel,
    direction: row.direction,
    kind: row.kind,
    bodyRef: row.bodyRef ?? null,
    meta: row.meta ?? {},
  });
}

/** Best-effort cleanup of old dedupe rows (keep ~7 days). */
export async function pruneWebhookDedupe(db: Db): Promise<void> {
  await db.execute(sql`delete from webhook_dedupe where seen_at < now() - interval '7 days'`);
}
