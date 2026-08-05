import { and, desc, eq, sql } from "drizzle-orm";
import type { GraphUpdate } from "@amilo/brain-contract";
import type { Db } from "./index.js";
import {
  channels,
  contextEdges,
  contextNodes,
  contextObservations,
  messageLog,
  users,
  webhookDedupe,
} from "./schema.js";

export type UserRow = typeof users.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type ContextNodeRow = typeof contextNodes.$inferSelect;

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

function normalizeLabel(label: string): string {
  return label.trim().replace(/\s+/g, " ");
}

function confidenceToInt(c?: number): number {
  if (c === undefined || Number.isNaN(c)) return 80;
  if (c <= 1) return Math.round(Math.min(1, Math.max(0, c)) * 100);
  return Math.round(Math.min(100, Math.max(0, c)));
}

async function ensureUserSelfNode(db: Db, userId: string, userName: string): Promise<ContextNodeRow> {
  const label = normalizeLabel(userName || "user");
  const existing = await db.query.contextNodes.findFirst({
    where: and(
      eq(contextNodes.userId, userId),
      eq(contextNodes.kind, "person"),
      eq(contextNodes.label, label),
    ),
  });
  if (existing) return existing;
  const byAlias = await db.query.contextNodes.findFirst({
    where: and(
      eq(contextNodes.userId, userId),
      eq(contextNodes.kind, "person"),
      eq(contextNodes.label, "user"),
    ),
  });
  if (byAlias) return byAlias;
  const [created] = await db
    .insert(contextNodes)
    .values({
      userId,
      kind: "person",
      label: "user",
      attrs: { self: true, displayName: label },
      confidence: 100,
    })
    .returning();
  if (!created) throw new Error("failed to create self node");
  return created;
}

async function upsertNode(
  db: Db,
  userId: string,
  kind: string,
  label: string,
  attrs: Record<string, unknown>,
  confidence: number,
): Promise<ContextNodeRow> {
  const normalized = normalizeLabel(label);
  const existing = await db.query.contextNodes.findFirst({
    where: and(
      eq(contextNodes.userId, userId),
      eq(contextNodes.kind, kind),
      eq(contextNodes.label, normalized),
    ),
  });
  if (existing) {
    const [updated] = await db
      .update(contextNodes)
      .set({
        attrs: { ...existing.attrs, ...attrs },
        confidence: Math.max(existing.confidence, confidence),
        lastSeenAt: new Date(),
      })
      .where(eq(contextNodes.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  const [created] = await db
    .insert(contextNodes)
    .values({
      userId,
      kind,
      label: normalized,
      attrs,
      confidence,
      lastSeenAt: new Date(),
    })
    .returning();
  if (!created) throw new Error("failed to create context node");
  return created;
}

/** Apply graph deltas from the brain; returns observation id. */
export async function applyGraphUpdates(
  db: Db,
  opts: {
    userId: string;
    userName: string;
    sourceMessageId?: string;
    claim: string;
    updates: GraphUpdate[];
  },
): Promise<void> {
  if (!opts.updates.length) return;

  const self = await ensureUserSelfNode(db, opts.userId, opts.userName);
  const labelToId = new Map<string, string>();
  labelToId.set("user", self.id);
  labelToId.set(self.label.toLowerCase(), self.id);

  const linkedNodeIds: string[] = [];
  const linkedEdgeIds: string[] = [];

  for (const u of opts.updates) {
    if (u.op === "upsert_node") {
      const node = await upsertNode(
        db,
        opts.userId,
        u.kind,
        u.label,
        u.attrs ?? {},
        confidenceToInt(u.confidence),
      );
      labelToId.set(normalizeLabel(u.label).toLowerCase(), node.id);
      linkedNodeIds.push(node.id);
    }
  }

  for (const u of opts.updates) {
    if (u.op !== "upsert_edge") continue;
    const fromKey = normalizeLabel(u.fromLabel).toLowerCase();
    const toKey = normalizeLabel(u.toLabel).toLowerCase();
    let fromId = labelToId.get(fromKey);
    let toId = labelToId.get(toKey);

    if (!fromId) {
      const n = await upsertNode(db, opts.userId, "person", u.fromLabel, {}, confidenceToInt(u.confidence));
      fromId = n.id;
      labelToId.set(fromKey, fromId);
      linkedNodeIds.push(fromId);
    }
    if (!toId) {
      const n = await upsertNode(db, opts.userId, "person", u.toLabel, {}, confidenceToInt(u.confidence));
      toId = n.id;
      labelToId.set(toKey, toId);
      linkedNodeIds.push(toId);
    }

    const existing = await db.query.contextEdges.findFirst({
      where: and(
        eq(contextEdges.userId, opts.userId),
        eq(contextEdges.fromNodeId, fromId),
        eq(contextEdges.toNodeId, toId),
        eq(contextEdges.rel, u.rel),
      ),
    });
    if (existing) {
      const [updated] = await db
        .update(contextEdges)
        .set({
          attrs: { ...existing.attrs, ...(u.attrs ?? {}) },
          confidence: Math.max(existing.confidence, confidenceToInt(u.confidence)),
          lastSeenAt: new Date(),
        })
        .where(eq(contextEdges.id, existing.id))
        .returning();
      if (updated) linkedEdgeIds.push(updated.id);
    } else {
      const [created] = await db
        .insert(contextEdges)
        .values({
          userId: opts.userId,
          fromNodeId: fromId,
          toNodeId: toId,
          rel: u.rel,
          attrs: u.attrs ?? {},
          confidence: confidenceToInt(u.confidence),
        })
        .returning();
      if (created) linkedEdgeIds.push(created.id);
    }
  }

  await db.insert(contextObservations).values({
    userId: opts.userId,
    sourceMessageId: opts.sourceMessageId ?? null,
    claim: opts.claim.slice(0, 2000),
    linkedNodeIds,
    linkedEdgeIds,
    raw: { updates: opts.updates },
  });
}

/** Compact text for silent brain context (top recent nodes + edges). */
export async function summarizeContextGraph(db: Db, userId: string): Promise<string> {
  const nodes = await db.query.contextNodes.findMany({
    where: eq(contextNodes.userId, userId),
    orderBy: [desc(contextNodes.lastSeenAt)],
    limit: 40,
  });
  if (!nodes.length) return "none yet";

  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edges = await db.query.contextEdges.findMany({
    where: eq(contextEdges.userId, userId),
    orderBy: [desc(contextEdges.lastSeenAt)],
    limit: 40,
  });

  const nodeLines = nodes.map((n) => {
    const attrs =
      n.attrs && Object.keys(n.attrs).length
        ? ` (${Object.entries(n.attrs)
            .slice(0, 4)
            .map(([k, v]) => `${k}=${String(v)}`)
            .join(", ")})`
        : "";
    return `- [${n.kind}] ${n.label}${attrs} conf=${n.confidence}`;
  });

  const edgeLines = edges.map((e) => {
    const from = byId.get(e.fromNodeId)?.label ?? e.fromNodeId.slice(0, 8);
    const to = byId.get(e.toNodeId)?.label ?? e.toNodeId.slice(0, 8);
    return `- ${from} --${e.rel}--> ${to} conf=${e.confidence}`;
  });

  return [
    "Nodes:",
    ...nodeLines,
    edges.length ? "Edges:" : "",
    ...edgeLines,
  ]
    .filter(Boolean)
    .join("\n");
}
