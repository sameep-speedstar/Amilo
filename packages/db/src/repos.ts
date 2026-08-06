import { and, asc, desc, eq, gte, isNull, lte, ne, sql } from "drizzle-orm";
import type { GraphUpdate } from "@amilo/brain-contract";
import { formatLocalHm, guessTimezoneFromPhone, localDayBoundsUtc } from "@amilo/core";
import type { Db } from "./index.js";
import {
  channels,
  commitments,
  contextEdges,
  contextNodes,
  contextObservations,
  events,
  googleAccounts,
  messageLog,
  users,
  webhookDedupe,
} from "./schema.js";

export type UserRow = typeof users.$inferSelect;
export type ChannelRow = typeof channels.$inferSelect;
export type ContextNodeRow = typeof contextNodes.$inferSelect;
export type GoogleAccountRow = typeof googleAccounts.$inferSelect;
export type EventRow = typeof events.$inferSelect;

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
        timezone: guessTimezoneFromPhone(opts.phoneE164),
        status: "active",
        prefs: { mutedPatterns: [], vipList: [], tzConfirmed: false },
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

export async function setUserTimezone(
  db: Db,
  userId: string,
  timezone: string,
  opts?: { confirmed?: boolean },
): Promise<void> {
  const prefs = await getUserPrefs(db, userId);
  const nextPrefs = {
    mutedPatterns: prefs.mutedPatterns,
    vipList: prefs.vipList,
    tzConfirmed: opts?.confirmed ?? prefs.tzConfirmed,
  };
  await db
    .update(users)
    .set({ timezone, prefs: nextPrefs })
    .where(eq(users.id, userId));
}

export async function setTimezoneConfirmed(
  db: Db,
  userId: string,
  confirmed: boolean,
): Promise<void> {
  const prefs = await getUserPrefs(db, userId);
  await db
    .update(users)
    .set({
      prefs: {
        mutedPatterns: prefs.mutedPatterns,
        vipList: prefs.vipList,
        tzConfirmed: confirmed,
      },
    })
    .where(eq(users.id, userId));
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

export async function getGoogleAccount(
  db: Db,
  userId: string,
  label = "personal",
): Promise<GoogleAccountRow | undefined> {
  return db.query.googleAccounts.findFirst({
    where: and(eq(googleAccounts.userId, userId), eq(googleAccounts.label, label)),
  });
}

export async function listGoogleAccounts(
  db: Db,
  userId: string,
): Promise<GoogleAccountRow[]> {
  return db.query.googleAccounts.findMany({
    where: eq(googleAccounts.userId, userId),
    orderBy: [googleAccounts.label],
  });
}

export async function upsertGoogleAccount(
  db: Db,
  row: {
    userId: string;
    label?: string;
    email: string;
    scopes: string;
    accessTokenEnc: string;
    refreshTokenEnc: string;
    expiresAt: Date;
  },
): Promise<GoogleAccountRow> {
  const label = row.label ?? "personal";
  const existing = await getGoogleAccount(db, row.userId, label);
  if (existing) {
    const [updated] = await db
      .update(googleAccounts)
      .set({
        email: row.email,
        scopes: row.scopes,
        accessTokenEnc: row.accessTokenEnc,
        refreshTokenEnc: row.refreshTokenEnc,
        expiresAt: row.expiresAt,
        updatedAt: new Date(),
      })
      .where(eq(googleAccounts.id, existing.id))
      .returning();
    if (!updated) throw new Error("failed to update google account");
    return updated;
  }
  const [created] = await db
    .insert(googleAccounts)
    .values({
      userId: row.userId,
      label,
      email: row.email,
      scopes: row.scopes,
      accessTokenEnc: row.accessTokenEnc,
      refreshTokenEnc: row.refreshTokenEnc,
      expiresAt: row.expiresAt,
    })
    .returning();
  if (!created) throw new Error("failed to create google account");
  return created;
}

/** Local disconnect only — never revoke at Google (shared OAuth client with LifeOS). */
export async function deleteGoogleAccount(
  db: Db,
  userId: string,
  label?: string,
): Promise<{ deleted: number; labels: string[] }> {
  if (label) {
    const deleted = await db
      .delete(googleAccounts)
      .where(and(eq(googleAccounts.userId, userId), eq(googleAccounts.label, label)))
      .returning({ label: googleAccounts.label });
    return { deleted: deleted.length, labels: deleted.map((d) => d.label) };
  }
  const deleted = await db
    .delete(googleAccounts)
    .where(eq(googleAccounts.userId, userId))
    .returning({ label: googleAccounts.label });
  return { deleted: deleted.length, labels: deleted.map((d) => d.label) };
}

export async function updateGoogleTokens(
  db: Db,
  accountId: string,
  tokens: {
    accessTokenEnc: string;
    refreshTokenEnc?: string;
    expiresAt: Date;
  },
): Promise<void> {
  await db
    .update(googleAccounts)
    .set({
      accessTokenEnc: tokens.accessTokenEnc,
      ...(tokens.refreshTokenEnc ? { refreshTokenEnc: tokens.refreshTokenEnc } : {}),
      expiresAt: tokens.expiresAt,
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.id, accountId));
}

export async function updateGoogleSyncCursors(
  db: Db,
  accountId: string,
  cursors: {
    gmailHistoryId?: string | null;
    calendarSyncToken?: string | null;
  },
): Promise<void> {
  await db
    .update(googleAccounts)
    .set({
      ...(cursors.gmailHistoryId !== undefined
        ? { gmailHistoryId: cursors.gmailHistoryId }
        : {}),
      ...(cursors.calendarSyncToken !== undefined
        ? { calendarSyncToken: cursors.calendarSyncToken }
        : {}),
      lastSyncAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(googleAccounts.id, accountId));
}

export async function upsertEvent(
  db: Db,
  row: {
    userId: string;
    source: string;
    sourceId: string;
    actor?: string | null;
    title?: string | null;
    snippet?: string | null;
    kind?: string | null;
    meta?: Record<string, unknown>;
    occursAt?: Date | null;
  },
): Promise<void> {
  await db
    .insert(events)
    .values({
      userId: row.userId,
      source: row.source,
      sourceId: row.sourceId,
      actor: row.actor ?? null,
      title: row.title ?? null,
      snippet: row.snippet ?? null,
      kind: row.kind ?? null,
      meta: row.meta ?? {},
      occursAt: row.occursAt ?? null,
    })
    .onConflictDoUpdate({
      target: [events.userId, events.source, events.sourceId],
      set: {
        actor: row.actor ?? null,
        title: row.title ?? null,
        snippet: row.snippet ?? null,
        kind: row.kind ?? null,
        meta: row.meta ?? {},
        occursAt: row.occursAt ?? null,
      },
    });
}

export async function summarizeCalendarToday(
  db: Db,
  userId: string,
  timezone = "Asia/Kolkata",
): Promise<string> {
  const { timeMin, timeMax } = localDayBoundsUtc(timezone);
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, userId),
      eq(events.source, "calendar"),
      gte(events.occursAt, timeMin),
      lte(events.occursAt, timeMax),
    ),
    orderBy: [events.occursAt],
    limit: 20,
  });
  if (!rows.length) return "none yet";
  return rows
    .map((e) => {
      const allDay = Boolean((e.meta as { allDay?: unknown })?.allDay);
      const when =
        allDay || !e.occursAt ? "all day" : formatLocalHm(e.occursAt, timezone);
      return `• ${when} ${e.title ?? "(untitled)"}`;
    })
    .join("\n");
}

export function matchesMutedPattern(
  haystack: string,
  patterns: string[],
): boolean {
  if (!patterns.length) return false;
  const h = haystack.toLowerCase().replace(/\s+/g, " ");
  return patterns.some((p) => {
    const needle = p.trim().toLowerCase().replace(/\s+/g, " ");
    if (needle.length < 2) return false;
    if (h.includes(needle)) return true;
    // All significant tokens present (order-independent) for multi-word mutes.
    const tokens = needle.split(" ").filter((t) => t.length >= 3);
    return tokens.length >= 2 && tokens.every((t) => h.includes(t));
  });
}

export type UserPrefs = {
  mutedPatterns: string[];
  vipList: string[];
  tzConfirmed: boolean;
};

export function parseUserPrefs(raw: Record<string, unknown> | null | undefined): UserPrefs {
  const muted = Array.isArray(raw?.mutedPatterns)
    ? raw!.mutedPatterns.map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  const vip = Array.isArray(raw?.vipList)
    ? raw!.vipList.map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  const tzConfirmed = raw?.tzConfirmed === true;
  return { mutedPatterns: muted, vipList: vip, tzConfirmed };
}

export async function getUserPrefs(db: Db, userId: string): Promise<UserPrefs> {
  const u = await getUserById(db, userId);
  return parseUserPrefs(u?.prefs ?? {});
}

export async function addMutedPattern(
  db: Db,
  userId: string,
  pattern: string,
): Promise<string[]> {
  const prefs = await getUserPrefs(db, userId);
  const cleaned = pattern.trim().replace(/^["']|["']$/g, "");
  if (!cleaned) return prefs.mutedPatterns;
  const next = [...new Set([...prefs.mutedPatterns, cleaned])];
  await db
    .update(users)
    .set({ prefs: { mutedPatterns: next, vipList: prefs.vipList, tzConfirmed: prefs.tzConfirmed } })
    .where(eq(users.id, userId));
  // Hide already-synced matching mail so brief updates without waiting for re-sync.
  await markMatchingMailMuted(db, userId, cleaned);
  return next;
}

/** Mark existing gmail events matching a mute phrase so they leave the brief. */
export async function markMatchingMailMuted(
  db: Db,
  userId: string,
  pattern: string,
): Promise<number> {
  const rows = await db.query.events.findMany({
    where: and(eq(events.userId, userId), eq(events.source, "gmail")),
    limit: 200,
  });
  let n = 0;
  for (const e of rows) {
    if (e.kind === "muted" || e.kind === "promo") continue;
    const hay = `${e.actor ?? ""} ${e.title ?? ""} ${e.snippet ?? ""}`;
    if (!matchesMutedPattern(hay, [pattern])) continue;
    await db
      .update(events)
      .set({ kind: "muted", meta: { ...e.meta, mutedBy: pattern } })
      .where(eq(events.id, e.id));
    n += 1;
  }
  return n;
}

export async function removeMutedPattern(
  db: Db,
  userId: string,
  pattern: string,
): Promise<string[]> {
  const prefs = await getUserPrefs(db, userId);
  const needle = pattern.trim().toLowerCase();
  const next = prefs.mutedPatterns.filter((p) => p.toLowerCase() !== needle);
  await db
    .update(users)
    .set({ prefs: { mutedPatterns: next, vipList: prefs.vipList, tzConfirmed: prefs.tzConfirmed } })
    .where(eq(users.id, userId));
  return next;
}

export async function summarizeRecentMail(
  db: Db,
  userId: string,
  mutedPatterns: string[] = [],
): Promise<string> {
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, userId),
      eq(events.source, "gmail"),
      ne(events.kind, "promo"),
      ne(events.kind, "social"),
      ne(events.kind, "muted"),
    ),
    orderBy: [desc(events.createdAt)],
    limit: 40,
  });
  const filtered = rows
    .filter((e) => {
      const labels = (e.meta as { labelIds?: unknown })?.labelIds;
      if (Array.isArray(labels)) {
        if (
          labels.includes("CATEGORY_PROMOTIONS") ||
          labels.includes("CATEGORY_SOCIAL") ||
          labels.includes("CATEGORY_FORUMS")
        ) {
          return false;
        }
      }
      const hay = `${e.actor ?? ""} ${e.title ?? ""} ${e.snippet ?? ""}`;
      if (matchesMutedPattern(hay, mutedPatterns)) return false;
      return e.kind === "mail" || !e.kind;
    })
    .slice(0, 12);
  if (!filtered.length) return "none yet";
  return filtered
    .map(
      (e) =>
        `• ${shortActor(e.actor)} | ${e.title ?? "(no subject)"}`,
    )
    .join("\n");
}

function shortActor(actor: string | null | undefined): string {
  if (!actor) return "?";
  const m = actor.match(/<([^>]+)>/);
  if (m?.[1]) return m[1];
  if (actor.includes("@")) return actor.split(/\s+/).pop() ?? actor;
  return actor.slice(0, 40);
}

export async function summarizeOpenCommitments(
  db: Db,
  userId: string,
  timezone = "Asia/Kolkata",
): Promise<string> {
  const rows = await db.query.commitments.findMany({
    where: and(eq(commitments.userId, userId), eq(commitments.status, "open")),
    orderBy: [asc(commitments.dueAt), desc(commitments.createdAt)],
    limit: 10,
  });
  if (!rows.length) return "none yet";
  return rows
    .map((c) => {
      if (!c.dueAt) return `• ${c.title}`;
      return `• ${formatLocalHm(c.dueAt, timezone)} ${c.title}`;
    })
    .join("\n");
}

export async function createReminder(
  db: Db,
  opts: { userId: string; title: string; dueAt: Date },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(commitments)
    .values({
      userId: opts.userId,
      title: opts.title.slice(0, 500),
      status: "open",
      dueAt: opts.dueAt,
      reason: "reminder",
    })
    .returning({ id: commitments.id });
  if (!row) throw new Error("failed to create reminder");
  return row;
}

export type DueReminder = {
  id: string;
  userId: string;
  title: string;
  dueAt: Date;
  userName: string | null;
  timezone: string;
  status: string;
};

/** Open reminders that are due and not yet notified (within lookback). */
export async function listDueReminders(
  db: Db,
  opts?: { lookbackMs?: number; now?: Date },
): Promise<DueReminder[]> {
  const now = opts?.now ?? new Date();
  const lookbackMs = opts?.lookbackMs ?? 6 * 60 * 60 * 1000;
  const earliest = new Date(now.getTime() - lookbackMs);
  const rows = await db
    .select({
      id: commitments.id,
      userId: commitments.userId,
      title: commitments.title,
      dueAt: commitments.dueAt,
      userName: users.name,
      timezone: users.timezone,
      status: users.status,
    })
    .from(commitments)
    .innerJoin(users, eq(users.id, commitments.userId))
    .where(
      and(
        eq(commitments.status, "open"),
        eq(commitments.reason, "reminder"),
        isNull(commitments.notifiedAt),
        lte(commitments.dueAt, now),
        gte(commitments.dueAt, earliest),
      ),
    )
    .orderBy(asc(commitments.dueAt))
    .limit(50);

  return rows
    .filter((r): r is typeof r & { dueAt: Date } => r.dueAt != null)
    .map((r) => ({
      id: r.id,
      userId: r.userId,
      title: r.title,
      dueAt: r.dueAt,
      userName: r.userName,
      timezone: r.timezone,
      status: r.status,
    }));
}

export async function markReminderNotified(db: Db, id: string): Promise<void> {
  const now = new Date();
  await db
    .update(commitments)
    .set({
      notifiedAt: now,
      status: "done",
      resolvedAt: now,
    })
    .where(eq(commitments.id, id));
}
