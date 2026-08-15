import { and, asc, desc, eq, gte, isNull, lt, lte, ne, or, sql } from "drizzle-orm";
import type { GraphUpdate } from "@amilo/brain-contract";
import { formatLocalDayShort, formatLocalHm, guessTimezoneFromPhone, localDayBoundsUtc, cleanCalendarDisplayTitle, formatLeaveByBriefLine, detectTravelConflictsFromCoords, describeTravelConflict } from "@amilo/core";
import type { Db } from "./index.js";
import {
  calendarLocationFromEvent,
  getGeocodeCache,
  getNearestUpcomingTravelPlan,
} from "./travelRepos.js";
import {
  channels,
  commitments,
  contextEdges,
  contextNodes,
  contextObservations,
  evalEvents,
  events,
  googleAccounts,
  messageLog,
  pendingActions,
  auditLog,
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
  await db
    .update(users)
    .set({
      timezone,
      prefs: prefsToJson({
        ...prefs,
        tzConfirmed: opts?.confirmed ?? prefs.tzConfirmed,
      }),
    })
    .where(eq(users.id, userId));
}

export async function setTimezoneConfirmed(
  db: Db,
  userId: string,
  confirmed: boolean,
): Promise<void> {
  await patchUserPrefs(db, userId, { tzConfirmed: confirmed });
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
): Promise<{ id: string }> {
  const [inserted] = await db
    .insert(messageLog)
    .values({
      userId: row.userId ?? null,
      channel: row.channel,
      direction: row.direction,
      kind: row.kind,
      bodyRef: row.bodyRef ?? null,
      meta: row.meta ?? {},
    })
    .returning({ id: messageLog.id });
  return { id: inserted?.id ?? "" };
}

/** Look up a prior WhatsApp message by Graph wamid (for reply-to). */
export async function findMessageByWaId(
  db: Db,
  userId: string,
  waMessageId: string,
): Promise<{
  direction: string;
  bodyRef: string | null;
  kind: string;
} | null> {
  const rows = await db.query.messageLog.findMany({
    where: and(eq(messageLog.userId, userId), eq(messageLog.channel, "whatsapp")),
    orderBy: [desc(messageLog.ts)],
    limit: 80,
  });
  for (const r of rows) {
    const meta = (r.meta ?? {}) as { waMessageId?: unknown };
    if (String(meta.waMessageId ?? "") === waMessageId) {
      return { direction: r.direction, bodyRef: r.bodyRef, kind: r.kind };
    }
  }
  return null;
}

/** Recent chat turns for brain context (oldest → newest). */
export async function getRecentChatSummary(
  db: Db,
  userId: string,
  limit = 12,
  opts?: { excludeWaMessageId?: string },
): Promise<string> {
  const rows = await db.query.messageLog.findMany({
    where: and(eq(messageLog.userId, userId), eq(messageLog.channel, "whatsapp")),
    orderBy: [desc(messageLog.ts)],
    limit: opts?.excludeWaMessageId ? limit + 4 : limit,
  });
  const filtered = opts?.excludeWaMessageId
    ? rows.filter((r) => {
        const meta = (r.meta ?? {}) as { waMessageId?: unknown };
        return String(meta.waMessageId ?? "") !== opts.excludeWaMessageId;
      })
    : rows;
  const slice = filtered.slice(0, limit);
  if (!slice.length) return "none yet";
  return [...slice]
    .reverse()
    .map((r) => {
      const who = r.direction === "in" ? "User" : "Amilo";
      const body = (r.bodyRef ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
      return `${who}: ${body || `(${r.kind})`}`;
    })
    .join("\n");
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

/** Schedule memory nodes (personal protected windows — not Google Calendar). */
export async function listScheduleNodes(
  db: Db,
  userId: string,
): Promise<Array<{ id: string; label: string; attrs: Record<string, unknown> }>> {
  const nodes = await db.query.contextNodes.findMany({
    where: and(eq(contextNodes.userId, userId), eq(contextNodes.kind, "schedule")),
    orderBy: [desc(contextNodes.lastSeenAt)],
    limit: 40,
  });
  return nodes.map((n) => ({
    id: n.id,
    label: n.label,
    attrs: (n.attrs ?? {}) as Record<string, unknown>,
  }));
}

export async function upsertScheduleNode(
  db: Db,
  userId: string,
  label: string,
  attrs: Record<string, unknown>,
  confidence = 95,
): Promise<ContextNodeRow> {
  return upsertNode(db, userId, "schedule", label, attrs, confidence);
}

/** Clear hold overlay on one schedule (by label hint) or all schedules. */
export async function clearScheduleHolds(
  db: Db,
  userId: string,
  labelHint?: string | null,
): Promise<{ cleared: number; labels: string[] }> {
  const nodes = await listScheduleNodes(db, userId);
  const needle = (labelHint ?? "").trim().toLowerCase();
  const targets = needle
    ? nodes.filter(
        (n) =>
          n.label.toLowerCase().includes(needle) ||
          needle.includes(n.label.toLowerCase()) ||
          needle.split(/\s+/).some((w) => w.length > 2 && n.label.toLowerCase().includes(w)),
      )
    : nodes.filter((n) => n.attrs.holdUntilIso || n.attrs.autoDecline);
  const labels: string[] = [];
  for (const n of targets) {
    const next = { ...n.attrs };
    delete next.holdUntilIso;
    delete next.autoDecline;
    await db
      .update(contextNodes)
      .set({ attrs: next, lastSeenAt: new Date() })
      .where(eq(contextNodes.id, n.id));
    labels.push(n.label);
  }
  return { cleared: labels.length, labels };
}

/** User-facing memory dump (only for explicit "about me" commands). */
export async function summarizeAboutMe(db: Db, userId: string): Promise<string> {
  const nodes = await db.query.contextNodes.findMany({
    where: eq(contextNodes.userId, userId),
    orderBy: [desc(contextNodes.lastSeenAt)],
    limit: 40,
  });
  if (!nodes.length) {
    return "I don't have durable facts stored yet. Tell me things like roles or emails and I'll keep them quietly.";
  }

  const people: string[] = [];
  const prefs: string[] = [];
  const schedules: string[] = [];
  const other: string[] = [];
  for (const n of nodes) {
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    if (attrs.self === true || n.label === "user") continue;
    const bits = Object.entries(attrs)
      .filter(([k]) => !["aliases", "self", "displayName"].includes(k))
      .slice(0, 4)
      .map(([k, v]) => `${k}=${String(v)}`);
    const line = bits.length ? `• ${n.label} (${bits.join(", ")})` : `• ${n.label}`;
    if (n.kind === "person") people.push(line);
    else if (n.kind === "preference") prefs.push(line);
    else if (n.kind === "schedule") schedules.push(line);
    else other.push(`• [${n.kind}] ${n.label}${bits.length ? ` (${bits.join(", ")})` : ""}`);
  }

  const sections = [
    people.length ? ["People", ...people.slice(0, 15)].join("\n") : null,
    schedules.length ? ["Schedules", ...schedules.slice(0, 10)].join("\n") : null,
    prefs.length ? ["Preferences", ...prefs.slice(0, 10)].join("\n") : null,
    other.length ? ["Other", ...other.slice(0, 10)].join("\n") : null,
  ].filter(Boolean);

  if (!sections.length) {
    return "Nothing durable beyond your account yet. Facts you share (people, emails, prefs) show up here.";
  }
  return ["What I've stored (ask forget <name> to remove):", "", ...sections].join("\n");
}

/** User-facing dump for one person/node (explicit about <name>). */
export async function summarizeAboutPerson(
  db: Db,
  userId: string,
  nameHint: string,
): Promise<string> {
  const needle = normalizeLabel(nameHint).toLowerCase();
  if (!needle) {
    return "Who should I look up? Try about Rajeev.";
  }
  const nodes = await db.query.contextNodes.findMany({
    where: eq(contextNodes.userId, userId),
    orderBy: [desc(contextNodes.lastSeenAt)],
    limit: 80,
  });
  const hit = nodes.find((n) => {
    if ((n.attrs as { self?: boolean })?.self || n.label === "user") return false;
    if (n.label.toLowerCase() === needle) return true;
    const aliases = Array.isArray((n.attrs as { aliases?: unknown })?.aliases)
      ? ((n.attrs as { aliases: unknown[] }).aliases).map((a) => String(a).toLowerCase())
      : [];
    return (
      aliases.includes(needle) ||
      n.label.toLowerCase().startsWith(needle) ||
      needle.startsWith(n.label.toLowerCase())
    );
  });
  if (!hit) {
    return `Nothing stored about “${normalizeLabel(nameHint)}”. Tell me a durable fact (role, email) and I'll keep it quietly.`;
  }

  const attrs = (hit.attrs ?? {}) as Record<string, unknown>;
  const bits = Object.entries(attrs)
    .filter(([k]) => !["aliases", "self", "displayName"].includes(k))
    .map(([k, v]) => `• ${k}: ${String(v)}`);

  const edges = await db.query.contextEdges.findMany({
    where: and(
      eq(contextEdges.userId, userId),
      or(eq(contextEdges.fromNodeId, hit.id), eq(contextEdges.toNodeId, hit.id)),
    ),
    limit: 20,
  });
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const edgeLines = edges.map((e) => {
    const from = byId.get(e.fromNodeId)?.label ?? "?";
    const to = byId.get(e.toNodeId)?.label ?? "?";
    return `• ${from} —${e.rel}→ ${to}`;
  });

  const commits = await db.query.commitments.findMany({
    where: and(eq(commitments.userId, userId), eq(commitments.status, "open")),
    orderBy: [asc(commitments.dueAt), desc(commitments.createdAt)],
    limit: 20,
  });
  const labelLower = hit.label.toLowerCase();
  const related = commits.filter((c) => c.title.toLowerCase().includes(labelLower));

  const parts = [
    `${hit.kind === "person" ? hit.label : `[${hit.kind}] ${hit.label}`}`,
    bits.length ? bits.join("\n") : "• (no attrs yet)",
    edgeLines.length ? ["", "Links", ...edgeLines].join("\n") : null,
    related.length
      ? ["", "Open commitments", ...related.map((c) => `• ${c.title}`)].join("\n")
      : null,
    "",
    "Ask forget <name> or forget <name> <attr> to edit.",
  ].filter(Boolean);
  return parts.join("\n");
}

/** Strip one attr key from a context node (fact-level forget). */
export async function forgetContextAttr(
  db: Db,
  userId: string,
  label: string,
  attrKey: string,
): Promise<{ ok: boolean; label: string; attr: string; reason?: string }> {
  const needle = normalizeLabel(label).toLowerCase();
  const key = attrKey.trim().toLowerCase();
  if (!key || ["aliases", "self", "displayName"].includes(key)) {
    return { ok: false, label: normalizeLabel(label), attr: key, reason: "attr" };
  }
  const all = await db.query.contextNodes.findMany({
    where: eq(contextNodes.userId, userId),
    limit: 80,
  });
  const hit = all.find((n) => {
    if ((n.attrs as { self?: boolean })?.self) return false;
    if (n.label.toLowerCase() === needle) return true;
    const aliases = Array.isArray((n.attrs as { aliases?: unknown })?.aliases)
      ? ((n.attrs as { aliases: unknown[] }).aliases).map((a) => String(a).toLowerCase())
      : [];
    return aliases.includes(needle);
  });
  if (!hit) return { ok: false, label: normalizeLabel(label), attr: key, reason: "none" };
  const attrs = { ...(hit.attrs ?? {}) } as Record<string, unknown>;
  const matchKey = Object.keys(attrs).find((k) => k.toLowerCase() === key);
  if (!matchKey) {
    return { ok: false, label: hit.label, attr: key, reason: "attr" };
  }
  delete attrs[matchKey];
  await db
    .update(contextNodes)
    .set({ attrs, lastSeenAt: new Date() })
    .where(eq(contextNodes.id, hit.id));
  return { ok: true, label: hit.label, attr: matchKey };
}

/** Create a non-reminder open commitment. */
export async function createCommitment(
  db: Db,
  opts: {
    userId: string;
    title: string;
    dueAt?: Date | null;
    reason?: string | null;
  },
): Promise<{ id: string }> {
  const [row] = await db
    .insert(commitments)
    .values({
      userId: opts.userId,
      title: opts.title.slice(0, 500),
      status: "open",
      dueAt: opts.dueAt ?? null,
      reason: opts.reason ?? "waiting_on",
    })
    .returning({ id: commitments.id });
  if (!row) throw new Error("failed to create commitment");
  return row;
}

/** Ensure person node + user --waiting_on--> person edge (Mind Map fuel). */
export async function linkWaitingOnPerson(
  db: Db,
  opts: {
    userId: string;
    userName: string;
    personLabel: string;
    email?: string | null;
    commitmentId?: string | null;
  },
): Promise<void> {
  const self = await ensureUserSelfNode(db, opts.userId, opts.userName);
  const person = await upsertNode(
    db,
    opts.userId,
    "person",
    opts.personLabel,
    opts.email ? { email: opts.email.trim().toLowerCase() } : {},
    90,
  );
  const existing = await db.query.contextEdges.findFirst({
    where: and(
      eq(contextEdges.userId, opts.userId),
      eq(contextEdges.fromNodeId, self.id),
      eq(contextEdges.toNodeId, person.id),
      eq(contextEdges.rel, "waiting_on"),
    ),
  });
  const edgeAttrs: Record<string, unknown> = {
    ...(opts.commitmentId ? { commitmentId: opts.commitmentId } : {}),
  };
  if (existing) {
    await db
      .update(contextEdges)
      .set({
        attrs: { ...existing.attrs, ...edgeAttrs },
        confidence: Math.max(existing.confidence, 90),
        lastSeenAt: new Date(),
      })
      .where(eq(contextEdges.id, existing.id));
  } else {
    await db.insert(contextEdges).values({
      userId: opts.userId,
      fromNodeId: self.id,
      toNodeId: person.id,
      rel: "waiting_on",
      attrs: edgeAttrs,
      confidence: 90,
    });
  }
}

/** Remove a context node by label (and cascading edges). */
export async function deleteContextNodeByLabel(
  db: Db,
  userId: string,
  label: string,
): Promise<{ deleted: boolean; label: string }> {
  const needle = normalizeLabel(label).toLowerCase();
  const all = await db.query.contextNodes.findMany({
    where: eq(contextNodes.userId, userId),
    limit: 80,
  });
  const hit = all.find((n) => {
    if ((n.attrs as { self?: boolean })?.self) return false;
    if (n.label.toLowerCase() === needle) return true;
    const aliases = Array.isArray((n.attrs as { aliases?: unknown })?.aliases)
      ? ((n.attrs as { aliases: unknown[] }).aliases).map((a) => String(a).toLowerCase())
      : [];
    return aliases.includes(needle);
  });
  if (!hit) return { deleted: false, label: normalizeLabel(label) };
  await db.delete(contextNodes).where(eq(contextNodes.id, hit.id));
  return { deleted: true, label: hit.label };
}

/** Wipe learned context graph for a user (keeps account + Google + commitments). */
export async function clearContextGraph(
  db: Db,
  userId: string,
): Promise<{ nodes: number; edges: number }> {
  const edges = await db
    .delete(contextEdges)
    .where(eq(contextEdges.userId, userId))
    .returning({ id: contextEdges.id });
  const nodes = await db
    .delete(contextNodes)
    .where(eq(contextNodes.userId, userId))
    .returning({ id: contextNodes.id });
  return { nodes: nodes.length, edges: edges.length };
}

/** Remove globally seeded Speedstar contacts from non-owner graphs. */
export async function scrubSeededKnownContacts(
  db: Db,
  ownerPhones: string[],
): Promise<number> {
  const ownerDigits = new Set(
    ownerPhones.map((p) => p.replace(/\D/g, "")).filter((d) => d.length >= 10),
  );
  const seeded = await db.query.contextNodes.findMany({
    where: and(
      eq(contextNodes.kind, "person"),
      or(
        sql`lower(${contextNodes.label}) in ('rajeev', 'rajiv')`,
        sql`${contextNodes.attrs}::text ilike '%rajeev@speedstar.ai%'`,
      ),
    ),
    limit: 500,
  });
  let n = 0;
  for (const node of seeded) {
    const user = await db.query.users.findFirst({ where: eq(users.id, node.userId) });
    const digits = (user?.phoneE164 ?? "").replace(/\D/g, "");
    if (ownerDigits.has(digits)) continue;
    await db.delete(contextNodes).where(eq(contextNodes.id, node.id));
    n += 1;
  }
  return n;
}

/** Persist / merge a person node's email for later invite resolution. */
export async function rememberPersonEmail(
  db: Db,
  userId: string,
  opts: { label: string; email: string; attrs?: Record<string, unknown> },
): Promise<ContextNodeRow> {
  const email = opts.email.trim().toLowerCase();
  const label = normalizeLabel(opts.label);
  return upsertNode(
    db,
    userId,
    "person",
    label,
    { ...(opts.attrs ?? {}), email },
    95,
  );
}

/** Resolve a person's email from the context graph (+ known seeds). */
export async function resolvePersonEmail(
  db: Db,
  userId: string,
  nameHint: string,
): Promise<{ label: string; email: string } | null> {
  const needle = nameHint.trim().toLowerCase().replace(/[^a-z]/g, "");
  if (!needle || needle.length < 2) return null;

  const nodes = await db.query.contextNodes.findMany({
    where: and(eq(contextNodes.userId, userId), eq(contextNodes.kind, "person")),
    orderBy: [desc(contextNodes.lastSeenAt)],
    limit: 80,
  });

  for (const n of nodes) {
    const labelNorm = n.label.toLowerCase().replace(/[^a-z]/g, "");
    const attrs = (n.attrs ?? {}) as Record<string, unknown>;
    const emailRaw = typeof attrs.email === "string" ? attrs.email.trim().toLowerCase() : "";
    const aliases = Array.isArray(attrs.aliases)
      ? attrs.aliases.map((a) => String(a).toLowerCase().replace(/[^a-z]/g, ""))
      : [];
    const hit =
      labelNorm === needle ||
      labelNorm.startsWith(needle) ||
      needle.startsWith(labelNorm) ||
      aliases.includes(needle);
    if (hit && emailRaw.includes("@")) {
      return { label: n.label, email: emailRaw };
    }
  }
  return null;
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
): Promise<{ inserted: boolean }> {
  const existing = await db.query.events.findFirst({
    where: and(
      eq(events.userId, row.userId),
      eq(events.source, row.source),
      eq(events.sourceId, row.sourceId),
    ),
    columns: { id: true, meta: true },
  });
  const prevMeta = (existing?.meta ?? {}) as Record<string, unknown>;
  const nextMeta = { ...prevMeta, ...(row.meta ?? {}) };
  // Preserve conflictAlertedAt unless explicitly set in this write.
  if (
    prevMeta.conflictAlertedAt != null &&
    row.meta &&
    !("conflictAlertedAt" in row.meta)
  ) {
    nextMeta.conflictAlertedAt = prevMeta.conflictAlertedAt;
  }
  // Preserve brief close markers (user dismissed a priority until new mail).
  if (
    prevMeta.briefClosedAt != null &&
    row.meta &&
    !("briefClosedAt" in row.meta)
  ) {
    nextMeta.briefClosedAt = prevMeta.briefClosedAt;
  }

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
      meta: nextMeta,
      occursAt: row.occursAt ?? null,
    })
    .onConflictDoUpdate({
      target: [events.userId, events.source, events.sourceId],
      set: {
        actor: row.actor ?? null,
        title: row.title ?? null,
        snippet: row.snippet ?? null,
        kind: row.kind ?? null,
        meta: nextMeta,
        occursAt: row.occursAt ?? null,
      },
    });
  return { inserted: !existing };
}

export async function markCalendarConflictAlerted(
  db: Db,
  userId: string,
  googleEventId: string,
  at: Date = new Date(),
): Promise<void> {
  const id = googleEventId.trim();
  if (!id) return;
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, userId),
      eq(events.source, "calendar"),
      sql`(
        ${events.meta}->>'calendarId' = ${id}
        OR ${events.sourceId} LIKE ${"%:" + id}
      )`,
    ),
    limit: 5,
  });
  for (const e of rows) {
    const meta = { ...((e.meta ?? {}) as Record<string, unknown>), conflictAlertedAt: at.toISOString() };
    await db.update(events).set({ meta }).where(eq(events.id, e.id));
  }
}

/** Drop local calendar rows for a Google event id (after cancel). */
export async function deleteCalendarEventByGoogleId(
  db: Db,
  userId: string,
  googleEventId: string,
): Promise<number> {
  const id = googleEventId.trim();
  if (!id) return 0;
  const deleted = await db
    .delete(events)
    .where(
      and(
        eq(events.userId, userId),
        eq(events.source, "calendar"),
        sql`(
          ${events.meta}->>'calendarId' = ${id}
          OR ${events.sourceId} LIKE ${"%:" + id}
        )`,
      ),
    )
    .returning({ id: events.id });
  return deleted.length;
}

/**
 * Remove local calendar rows in [timeMin, timeMax] for an account that are no
 * longer present in the latest Google list (cancelled/deleted remotely).
 */
export async function pruneMissingCalendarEvents(
  db: Db,
  opts: {
    userId: string;
    accountId: string;
    timeMin: Date;
    timeMax: Date;
    keepGoogleIds: Set<string>;
  },
): Promise<number> {
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, opts.userId),
      eq(events.source, "calendar"),
      gte(events.occursAt, opts.timeMin),
      lte(events.occursAt, opts.timeMax),
    ),
    limit: 100,
  });
  let n = 0;
  for (const row of rows) {
    if (!row.sourceId.startsWith(`${opts.accountId}:`)) continue;
    const gid = googleCalendarIdFromEvent(row);
    if (!gid || opts.keepGoogleIds.has(gid)) continue;
    await db.delete(events).where(eq(events.id, row.id));
    n += 1;
  }
  return n;
}

function googleCalendarIdFromEvent(e: {
  sourceId: string;
  meta: Record<string, unknown> | null;
}): string | null {
  const metaId = e.meta?.calendarId;
  if (typeof metaId === "string" && metaId.trim()) return metaId.trim();
  const parts = e.sourceId.split(":");
  const tail = parts.length > 1 ? parts.slice(1).join(":") : e.sourceId;
  return tail.trim() || null;
}

export async function summarizeCalendarToday(
  db: Db,
  userId: string,
  timezone = "Asia/Kolkata",
  opts?: { includeIds?: boolean; dayOffset?: number; now?: Date },
): Promise<string> {
  const now = opts?.now ?? new Date();
  const dayOffset = opts?.dayOffset ?? 0;
  let bounds = localDayBoundsUtc(timezone, now);
  if (dayOffset === 1) {
    bounds = localDayBoundsUtc(timezone, bounds.timeMax);
  } else if (dayOffset !== 0) {
    const mid = new Date(bounds.timeMin.getTime() + dayOffset * 86_400_000 + 12 * 3600_000);
    bounds = localDayBoundsUtc(timezone, mid);
  }
  const { timeMin, timeMax } = bounds;
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, userId),
      eq(events.source, "calendar"),
      gte(events.occursAt, timeMin),
      // timeMax is exclusive (start of next local day)
      lt(events.occursAt, timeMax),
    ),
    orderBy: [events.occursAt],
    limit: 20,
  });
  if (!rows.length) return "none yet";
  const dayShort = formatLocalDayShort(
    new Date(timeMin.getTime() + 12 * 3600_000),
    timezone,
  );
  const rel =
    dayOffset === 0 ? "today" : dayOffset === 1 ? "tomorrow" : dayShort;
  return rows
    .map((e) => {
      const allDay = Boolean((e.meta as { allDay?: unknown })?.allDay);
      const when =
        allDay || !e.occursAt ? "all day" : formatLocalHm(e.occursAt, timezone);
      const gid = opts?.includeIds ? googleCalendarIdFromEvent(e) : null;
      const idBit = gid ? ` [id:${gid}]` : "";
      // Absolute date on every line so the brain cannot re-label today as tomorrow.
      return `• ${dayShort} (${rel}) ${when} ${e.title ?? "(untitled)"}${idBit}`;
    })
    .join("\n");
}

export async function summarizeCalendarTomorrow(
  db: Db,
  userId: string,
  timezone = "Asia/Kolkata",
  opts?: { includeIds?: boolean; now?: Date },
): Promise<string> {
  return summarizeCalendarToday(db, userId, timezone, {
    ...opts,
    dayOffset: 1,
  });
}

/** Timed calendar blocks from synced events (conflict fallback). */
export async function listSyncedCalendarBlocks(
  db: Db,
  userId: string,
  timeMin: Date,
  timeMax: Date,
): Promise<Array<{ title: string; start: Date; end: Date; allDay: boolean }>> {
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, userId),
      eq(events.source, "calendar"),
      gte(events.occursAt, timeMin),
      lte(events.occursAt, timeMax),
    ),
    limit: 80,
  });
  const out: Array<{ title: string; start: Date; end: Date; allDay: boolean }> = [];
  for (const e of rows) {
    if (!e.occursAt) continue;
    const meta = (e.meta ?? {}) as {
      allDay?: unknown;
      end?: unknown;
      status?: unknown;
    };
    if (meta.status === "cancelled") continue;
    const end =
      typeof meta.end === "string" && meta.end
        ? new Date(meta.end)
        : new Date(e.occursAt.getTime() + 60 * 60 * 1000);
    if (Number.isNaN(end.getTime())) continue;
    out.push({
      title: (e.title ?? "Event").trim() || "Event",
      start: e.occursAt,
      end,
      allDay: Boolean(meta.allDay),
    });
  }
  return out;
}

export type CalendarMatch = {
  eventId: string;
  title: string;
  occursAt: Date | null;
  accountLabel: string;
  startIso: string | null;
  endIso: string | null;
};

/** Match synced calendar rows by title / local time (today + tomorrow). */
export async function findCalendarEventMatches(
  db: Db,
  userId: string,
  opts: {
    timezone: string;
    titleHint?: string;
    /** Local HH:MM to prefer nearby events. */
    aroundHm?: string;
    hintText?: string;
  },
): Promise<CalendarMatch[]> {
  const today = localDayBoundsUtc(opts.timezone);
  const tomorrowStart = new Date(today.timeMax.getTime() + 1);
  const tomorrowEnd = new Date(tomorrowStart.getTime() + 24 * 60 * 60 * 1000 - 1);
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, userId),
      eq(events.source, "calendar"),
      gte(events.occursAt, today.timeMin),
      lte(events.occursAt, tomorrowEnd),
    ),
    orderBy: [asc(events.occursAt)],
    limit: 40,
  });

  const titleHint = (opts.titleHint ?? "").trim().toLowerCase();
  const hintBlob = `${opts.hintText ?? ""} ${titleHint}`.toLowerCase();

  const idFromHint = `${opts.hintText ?? ""} ${opts.titleHint ?? ""}`.match(
    /\[id:([^\]]+)\]/i,
  );
  if (idFromHint?.[1]) {
    const want = idFromHint[1].trim();
    for (const e of rows) {
      const eventId = googleCalendarIdFromEvent(e);
      if (eventId === want) {
        const meta = (e.meta ?? {}) as { accountLabel?: unknown; end?: unknown };
        return [
          {
            eventId,
            title: (e.title ?? "").trim() || "(untitled)",
            occursAt: e.occursAt,
            accountLabel:
              typeof meta.accountLabel === "string" ? meta.accountLabel : "personal",
            startIso: e.occursAt ? e.occursAt.toISOString() : null,
            endIso: typeof meta.end === "string" ? meta.end : null,
          },
        ];
      }
    }
  }

  let targetMinutes: number | null = null;
  if (opts.aroundHm) {
    const parts = opts.aroundHm.split(":").map(Number);
    const h = parts[0];
    const m = parts[1] ?? 0;
    if (Number.isFinite(h) && Number.isFinite(m)) targetMinutes = (h as number) * 60 + m;
  }
  if (targetMinutes == null) {
    const clock = hintBlob.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
    if (clock) {
      let h = Number(clock[1]);
      const min = clock[2] ? Number(clock[2]) : 0;
      const ap = (clock[3] ?? "").toLowerCase();
      if (ap === "pm" && h < 12) h += 12;
      if (ap === "am" && h === 12) h = 0;
      if (h >= 0 && h < 24) targetMinutes = h * 60 + min;
    }
  }

  const scored: Array<CalendarMatch & { score: number }> = [];
  for (const e of rows) {
    const eventId = googleCalendarIdFromEvent(e);
    if (!eventId) continue;
    const title = (e.title ?? "").trim() || "(untitled)";
    const titleLower = title.toLowerCase();
    let score = 0;
    if (titleHint) {
      if (titleLower === titleHint) score += 50;
      else if (titleLower.includes(titleHint) || titleHint.includes(titleLower)) score += 30;
      else {
        const tokens = titleHint.split(/\s+/).filter((t) => t.length >= 3);
        const hits = tokens.filter((t) => titleLower.includes(t)).length;
        if (hits) score += hits * 8;
        else if (tokens.length) continue;
      }
    } else if (hintBlob) {
      const tokens = titleLower.split(/\s+/).filter((t) => t.length >= 3);
      const hits = tokens.filter((t) => hintBlob.includes(t)).length;
      if (hits) score += hits * 6;
    }

    if (targetMinutes != null && e.occursAt) {
      const hm = formatLocalHm(e.occursAt, opts.timezone);
      const hmParts = hm.split(":").map(Number);
      const hh = hmParts[0] ?? 0;
      const mm = hmParts[1] ?? 0;
      const mins = hh * 60 + mm;
      const delta = Math.abs(mins - targetMinutes);
      if (delta <= 5) score += 40;
      else if (delta <= 30) score += 20;
      else if (delta <= 90) score += 5;
      else if (titleHint) {
        /* title match can still win */
      } else {
        continue;
      }
    }

    if (!titleHint && targetMinutes == null && !hintBlob) score += 1;
    if (score <= 0) continue;

    const meta = (e.meta ?? {}) as { accountLabel?: unknown; end?: unknown };
    scored.push({
      eventId,
      title,
      occursAt: e.occursAt,
      accountLabel: typeof meta.accountLabel === "string" ? meta.accountLabel : "personal",
      startIso: e.occursAt ? e.occursAt.toISOString() : null,
      endIso: typeof meta.end === "string" ? meta.end : null,
      score,
    });
  }

  scored.sort((a, b) => b.score - a.score || (a.occursAt?.getTime() ?? 0) - (b.occursAt?.getTime() ?? 0));
  return scored.map(({ score: _s, ...rest }) => rest);
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

export type BriefPriorityItem = {
  index: number;
  label: string;
  detail: string;
  kind: "calendar" | "mail" | "commitment";
  /** Synced gmail/calendar event id when known. */
  eventId?: string | null;
  /** Gmail thread id — close suppresses until newer mail on this thread. */
  threadId?: string | null;
  commitmentId?: string | null;
};

export type UserPrefs = {
  mutedPatterns: string[];
  vipList: string[];
  tzConfirmed: boolean;
  briefsEnabled: boolean;
  morningHm: string;
  eveningHm: string;
  quietStartHm: string;
  quietEndHm: string;
  lastMorningBriefDay: string | null;
  lastEveningBriefDay: string | null;
  /** Last scheduled/on-demand brief priorities for 1/2/3/M replies. */
  lastBriefItems: BriefPriorityItem[];
  lastBriefMore: string | null;
  /**
   * Gmail threadId → ISO time the user closed that priority.
   * Suppressed in briefs until a newer message lands on the thread.
   */
  closedMailThreads: Record<string, string>;
};

const DEFAULT_PREFS: UserPrefs = {
  mutedPatterns: [],
  vipList: [],
  tzConfirmed: false,
  briefsEnabled: true,
  morningHm: "07:30",
  eveningHm: "20:00",
  quietStartHm: "22:00",
  quietEndHm: "07:00",
  lastMorningBriefDay: null,
  lastEveningBriefDay: null,
  lastBriefItems: [],
  lastBriefMore: null,
  closedMailThreads: {},
};

function asHm(raw: unknown, fallback: string): string {
  if (typeof raw !== "string") return fallback;
  const m = raw.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return fallback;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return fallback;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

export function parseUserPrefs(raw: Record<string, unknown> | null | undefined): UserPrefs {
  const muted = Array.isArray(raw?.mutedPatterns)
    ? raw!.mutedPatterns.map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  const vip = Array.isArray(raw?.vipList)
    ? raw!.vipList.map(String).map((s) => s.trim()).filter(Boolean)
    : [];
  const lastBriefItems = parseBriefItems(raw?.lastBriefItems);
  const closedMailThreads = parseClosedMailThreads(raw?.closedMailThreads);
  return {
    mutedPatterns: muted,
    vipList: vip,
    tzConfirmed: raw?.tzConfirmed === true,
    briefsEnabled: raw?.briefsEnabled === false ? false : true,
    morningHm: asHm(raw?.morningHm, DEFAULT_PREFS.morningHm),
    eveningHm: asHm(raw?.eveningHm, DEFAULT_PREFS.eveningHm),
    quietStartHm: asHm(raw?.quietStartHm, DEFAULT_PREFS.quietStartHm),
    quietEndHm: asHm(raw?.quietEndHm, DEFAULT_PREFS.quietEndHm),
    lastMorningBriefDay:
      typeof raw?.lastMorningBriefDay === "string" && raw.lastMorningBriefDay
        ? raw.lastMorningBriefDay
        : null,
    lastEveningBriefDay:
      typeof raw?.lastEveningBriefDay === "string" && raw.lastEveningBriefDay
        ? raw.lastEveningBriefDay
        : null,
    lastBriefItems,
    lastBriefMore:
      typeof raw?.lastBriefMore === "string" && raw.lastBriefMore.trim()
        ? raw.lastBriefMore.trim().slice(0, 1500)
        : null,
    closedMailThreads,
  };
}

function parseClosedMailThreads(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const key = String(k).trim();
    const iso = String(v ?? "").trim();
    if (!key || !iso) continue;
    if (Number.isNaN(Date.parse(iso))) continue;
    out[key] = iso;
  }
  return out;
}

function parseBriefItems(raw: unknown): BriefPriorityItem[] {
  if (!Array.isArray(raw)) return [];
  const out: BriefPriorityItem[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const index = Number(o.index);
    const label = String(o.label ?? "").trim();
    const detail = String(o.detail ?? "").trim();
    const kind = String(o.kind ?? "mail");
    if (!label || !Number.isFinite(index)) continue;
    out.push({
      index,
      label: label.slice(0, 160),
      detail: (detail || label).slice(0, 1200),
      kind:
        kind === "calendar" || kind === "commitment" || kind === "mail"
          ? kind
          : "mail",
      ...(typeof o.eventId === "string" && o.eventId.trim()
        ? { eventId: o.eventId.trim() }
        : {}),
      ...(typeof o.threadId === "string" && o.threadId.trim()
        ? { threadId: o.threadId.trim() }
        : {}),
      ...(typeof o.commitmentId === "string" && o.commitmentId.trim()
        ? { commitmentId: o.commitmentId.trim() }
        : {}),
    });
  }
  return out.slice(0, 8);
}

export function prefsToJson(prefs: UserPrefs): Record<string, unknown> {
  return {
    mutedPatterns: prefs.mutedPatterns,
    vipList: prefs.vipList,
    tzConfirmed: prefs.tzConfirmed,
    briefsEnabled: prefs.briefsEnabled,
    morningHm: prefs.morningHm,
    eveningHm: prefs.eveningHm,
    quietStartHm: prefs.quietStartHm,
    quietEndHm: prefs.quietEndHm,
    lastMorningBriefDay: prefs.lastMorningBriefDay,
    lastEveningBriefDay: prefs.lastEveningBriefDay,
    lastBriefItems: prefs.lastBriefItems,
    lastBriefMore: prefs.lastBriefMore,
    closedMailThreads: prefs.closedMailThreads,
  };
}

export async function getUserPrefs(db: Db, userId: string): Promise<UserPrefs> {
  const u = await getUserById(db, userId);
  return parseUserPrefs(u?.prefs ?? {});
}

export async function patchUserPrefs(
  db: Db,
  userId: string,
  patch: Partial<UserPrefs>,
): Promise<UserPrefs> {
  const prefs = await getUserPrefs(db, userId);
  const next: UserPrefs = { ...prefs, ...patch };
  await db.update(users).set({ prefs: prefsToJson(next) }).where(eq(users.id, userId));
  return next;
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
  await patchUserPrefs(db, userId, { mutedPatterns: next });
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
  await patchUserPrefs(db, userId, { mutedPatterns: next });
  return next;
}

export type MailSearchHit = {
  from: string;
  subject: string;
  snippet: string;
  createdAt: Date;
};

export async function searchMailEvents(
  db: Db,
  userId: string,
  opts: { query: string; lookbackDays: number; mutedPatterns?: string[] },
): Promise<MailSearchHit[]> {
  const tokens = opts.query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3)
    .slice(0, 8);
  if (!tokens.length) return [];
  const since = new Date(Date.now() - Math.max(1, opts.lookbackDays) * 86_400_000);
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, userId),
      eq(events.source, "gmail"),
      gte(events.createdAt, since),
    ),
    orderBy: [desc(events.createdAt)],
    limit: 200,
  });
  const muted = opts.mutedPatterns ?? [];
  const hits: MailSearchHit[] = [];
  for (const e of rows) {
    const hay = `${e.actor ?? ""} ${e.title ?? ""} ${e.snippet ?? ""}`.toLowerCase();
    if (muted.length && matchesMutedPattern(hay, muted)) continue;
    if (!tokens.every((tok) => hay.includes(tok))) {
      // Match if any distinctive token hits (sender OR subject phrase)
      if (!tokens.some((tok) => hay.includes(tok))) continue;
    }
    hits.push({
      from: (e.actor ?? "").slice(0, 120),
      subject: (e.title ?? "(no subject)").slice(0, 160),
      snippet: (e.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 180),
      createdAt: e.createdAt,
    });
    if (hits.length >= 8) break;
  }
  return hits;
}

export async function summarizeRecentMail(
  db: Db,
  userId: string,
  mutedPatterns: string[] = [],
  vipList: string[] = [],
): Promise<string> {
  const rows = await listMailCandidates(db, userId, mutedPatterns, 20, {
    excludePassive: true,
  });
  const scored = rows
    .map((e) => {
      const title = (e.title ?? "").trim();
      const snippet = (e.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
      const score = mailPriorityScore(title, e.actor ?? "", vipList, snippet);
      return { e, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 8);
  if (!scored.length) return "none yet";
  return scored
    .map(({ e }) => `• ${shortActor(e.actor)} — ${cleanSubject(e.title)}`)
    .join("\n");
}

function cleanSubject(title: string | null | undefined): string {
  const t = (title ?? "(no subject)").replace(/\s+/g, " ").trim();
  return t.slice(0, 100);
}

function shortActor(actor: string | null | undefined): string {
  if (!actor) return "Someone";
  const named = actor.match(/^"?([^"<]+?)"?\s*<[^>]+>/);
  if (named?.[1]?.trim()) return named[1].trim().slice(0, 40);
  if (actor.includes("@")) {
    const email = (actor.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? actor).toLowerCase();
    const domain = email.split("@")[1] ?? "";
    const brand = humanizeMailDomain(domain);
    if (brand) return brand;
    const local = email.split("@")[0] ?? "mail";
    return local.replace(/[._-]+/g, " ").slice(0, 30);
  }
  return actor.slice(0, 40);
}

function humanizeMailDomain(domain: string): string | null {
  const d = domain.toLowerCase().replace(/^mail\./, "").replace(/^email\./, "");
  const map: Record<string, string> = {
    "yes.bank.in": "Yes Bank",
    "icicisecurities.com": "ICICI Securities",
    "axisbank.com": "Axis Bank",
    "easemytrip.com": "EaseMyTrip",
    "practo.net": "Practo",
    "practo.com": "Practo",
    "getonecard.app": "OneCard",
    "greenhouse-mail.io": "Greenhouse",
    "us.greenhouse-mail.io": "Greenhouse",
  };
  if (map[d]) return map[d];
  const root = d.split(".").slice(-2).join(".");
  if (map[root]) return map[root];
  const company = d.split(".")[0];
  if (!company || company.length < 3) return null;
  return company.charAt(0).toUpperCase() + company.slice(1);
}

async function listMailCandidates(
  db: Db,
  userId: string,
  mutedPatterns: string[],
  limit: number,
  opts?: { excludePassive?: boolean },
) {
  const rows = await db.query.events.findMany({
    where: and(
      eq(events.userId, userId),
      eq(events.source, "gmail"),
      ne(events.kind, "promo"),
      ne(events.kind, "social"),
      ne(events.kind, "muted"),
    ),
    orderBy: [desc(events.createdAt)],
    limit: 50,
  });
  return rows
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
      if (looksLikePromoMail(hay)) return false;
      if (opts?.excludePassive && isPassiveTransactionalMail(hay)) return false;
      return e.kind === "mail" || !e.kind;
    })
    .slice(0, limit);
}

export function gmailThreadIdFromMeta(meta: unknown): string | null {
  if (!meta || typeof meta !== "object") return null;
  const tid = String((meta as { threadId?: unknown }).threadId ?? "").trim();
  return tid || null;
}

function newestMailCreatedByThread(
  rows: Array<{ createdAt: Date; meta: unknown }>,
): Map<string, Date> {
  const map = new Map<string, Date>();
  for (const e of rows) {
    const tid = gmailThreadIdFromMeta(e.meta);
    if (!tid) continue;
    const prev = map.get(tid);
    if (!prev || e.createdAt.getTime() > prev.getTime()) map.set(tid, e.createdAt);
  }
  return map;
}

/**
 * Closed brief mail stays quiet until a newer message on the same Gmail thread.
 * Exported for unit tests.
 */
export function isClosedMailThreadSuppressed(
  threadId: string | null | undefined,
  _eventCreatedAt: Date,
  closedThreads: Record<string, string>,
  newestInThread: Date,
): boolean {
  if (!threadId) return false;
  const closedAtRaw = closedThreads[threadId];
  if (!closedAtRaw) return false;
  const closedAt = Date.parse(closedAtRaw);
  if (Number.isNaN(closedAt)) return false;
  // New mail after the user closed → allow resurfacing.
  if (newestInThread.getTime() > closedAt) return false;
  return true;
}

/**
 * Mark a brief priority closed. Mail: suppress thread until newer mail.
 * Commitment: resolve as done/dropped when commitmentId present.
 */
export async function closeBriefPriorityItem(
  db: Db,
  userId: string,
  opts: {
    kind?: BriefPriorityItem["kind"] | null;
    eventId?: string | null;
    threadId?: string | null;
    commitmentId?: string | null;
    label?: string | null;
    status?: "done" | "dropped";
  },
): Promise<{ ok: boolean; message: string }> {
  const status = opts.status ?? "done";
  if (opts.kind === "commitment" || opts.commitmentId) {
    if (opts.commitmentId) {
      const title = String(opts.label ?? "commitment").slice(0, 200);
      await finalizeCommitment(db, opts.commitmentId, title, status);
      return {
        ok: true,
        message: `${status === "dropped" ? "Dropped" : "Done"}: ${title.slice(0, 80)}`,
      };
    }
    if (opts.label) {
      const r = await resolveCommitmentByHint(db, userId, opts.label, status);
      if (r.ok) {
        return {
          ok: true,
          message: `${status === "dropped" ? "Dropped" : "Done"}: ${r.title}`,
        };
      }
    }
  }

  let threadId = (opts.threadId ?? "").trim() || null;
  const eventId = (opts.eventId ?? "").trim() || null;

  if (!threadId && eventId) {
    const row = await db.query.events.findFirst({
      where: and(eq(events.id, eventId), eq(events.userId, userId)),
    });
    threadId = gmailThreadIdFromMeta(row?.meta) ?? null;
    if (row) {
      const meta = {
        ...((row.meta ?? {}) as Record<string, unknown>),
        briefClosedAt: new Date().toISOString(),
      };
      await db.update(events).set({ meta }).where(eq(events.id, row.id));
    }
  }

  if (!threadId && opts.label) {
    const prefs = await getUserPrefs(db, userId);
    const mailRows = await listMailCandidates(db, userId, prefs.mutedPatterns, 40, {
      excludePassive: true,
    });
    const needle = opts.label.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    const hit = mailRows.find((e) => {
      const subject = cleanSubject(e.title).toLowerCase();
      const from = shortActor(e.actor).toLowerCase();
      const label = `${subject} — ${from}`.slice(0, 90);
      return (
        label.includes(needle.slice(0, 40)) ||
        needle.includes(subject.slice(0, 24)) ||
        subject.includes(needle.split("—")[0]?.trim().slice(0, 24) ?? "___")
      );
    });
    if (hit) {
      threadId = gmailThreadIdFromMeta(hit.meta);
      const meta = {
        ...((hit.meta ?? {}) as Record<string, unknown>),
        briefClosedAt: new Date().toISOString(),
      };
      await db.update(events).set({ meta }).where(eq(events.id, hit.id));
    }
  }

  if (threadId) {
    const prefs = await getUserPrefs(db, userId);
    const closedMailThreads = {
      ...prefs.closedMailThreads,
      [threadId]: new Date().toISOString(),
    };
    // Cap map size
    const entries = Object.entries(closedMailThreads).sort(
      (a, b) => Date.parse(b[1]) - Date.parse(a[1]),
    );
    const trimmed = Object.fromEntries(entries.slice(0, 80));
    await patchUserPrefs(db, userId, { closedMailThreads: trimmed });
    return {
      ok: true,
      message: `${status === "dropped" ? "Dropped" : "Done"}: ${String(opts.label ?? "mail item").slice(0, 80)}. Won't resurface unless there's new mail on that thread.`,
    };
  }

  return {
    ok: false,
    message: `Couldn't close “${String(opts.label ?? "item").slice(0, 60)}” — no thread/commitment on file. Try done 1 after a brief, or mute <phrase>.`,
  };
}

function looksLikePromoMail(hay: string): boolean {
  const h = hay.toLowerCase();
  if (/\boffer letter\b/.test(h)) return false;
  return (
    /\b(mubarak|newsletter|unsubscribe|% off|flat \d+%|travel budget|flash sale|limited time)\b/.test(
      h,
    ) || /\b(deal|special offer|promo|latest updates on stocks)\b/.test(h) ||
    (/\boffer\b/.test(h) && /\b(discount|sale|coupon|deal)\b/.test(h))
  );
}

/** Recruiting status FYI (e.g. Greenhouse “we hired for the role”) — no action. */
export function isFyiRecruitingMail(hay: string): boolean {
  const h = hay.toLowerCase();
  return (
    /\b(recently )?hired for\b/.test(h) ||
    /\bwe (have |recently )?hired\b/.test(h) ||
    /\b(position|role|requisition) (has been |was )?filled\b/.test(h) ||
    /\bdecided to (move|go) (forward )?with (another|other)\b/.test(h) ||
    /\bnot moving forward (with )?your (application|candidacy)\b/.test(h) ||
    /\bpursue other candidates\b/.test(h) ||
    /\bapplication was unsuccessful\b/.test(h) ||
    /\bother candidates\b/.test(h) && /\b(moving forward|selected|chosen)\b/.test(h)
  );
}

/** FYI bank/broker/app/recruiting noise — no user action needed. */
export function isPassiveTransactionalMail(hay: string): boolean {
  const h = hay.toLowerCase();
  if (isFyiRecruitingMail(h)) return true;
  if (isActionDemandingMail(h)) return false;
  return (
    /\bupi\s+debit\b/.test(h) ||
    /\bdebit alert\b/.test(h) ||
    /\bcredit alert\b/.test(h) ||
    /\btransaction (alert|notification|successful|summary)\b/.test(h) ||
    (/\b(spent|paid|debited|credited)\b/.test(h) && /\balert\b/.test(h)) ||
    /\bspent on (credit )?card\b/.test(h) ||
    /\b(inr|usd|eur|gbp|rs\.?)\s*[\d,]+\.?\d*\s+spent\b/.test(h) ||
    /\bcard (transaction|purchase)\b/.test(h) && !/\b(due|failed|declined)\b/.test(h) ||
    /\bautopay\b/.test(h) && /\bactivated\b/.test(h) ||
    /\border and trade confirmation/.test(h) ||
    /\btrade confirmation/.test(h) ||
    /\bprovisional margin statement\b/.test(h) ||
    /\bmargin statement\b/.test(h) ||
    (/\bportfolio\b/.test(h) && /\b(update|summary|statement)\b/.test(h)) ||
    /\bnext (mf )?sip will be triggered\b/.test(h) ||
    /\bsip (will be|is) (triggered|processed)\b/.test(h) ||
    /\breceipt from\b/.test(h) ||
    /\bpayment (received|successful|confirmed)\b/.test(h) ||
    /\b(otp|one[- ]time password|passcode)\b/.test(h) ||
    /\b(shipping|shipped|out for delivery|delivered)\b/.test(h) ||
    /\badd alternate (contact|details)\b/.test(h)
  );
}

/** Needs the user to do something (pay, fix, reply, complete, show up). */
export function isActionDemandingMail(hay: string): boolean {
  const h = hay.toLowerCase();
  if (isFyiRecruitingMail(h)) return false;
  // Appointment reminders are calendar items — not priority mail (scored separately).
  if (/\bappointment reminder\b/.test(h)) return false;
  return (
    (/\b(bill|payment|emi|sip instalment|sip installment|installment)\b/.test(h) &&
      /\b(due|overdue|pending|failed|fail|insufficient|unpaid|outstanding)\b/.test(h)) ||
    /\b(amount due|minimum (amount )?due|payment due( date)?|total (amount )?due|last date to pay|pay by)\b/.test(
      h,
    ) ||
    /\b(failed|failure|insufficient balance|could(?:n't| not) process)\b/.test(h) ||
    /\b(action required|action needed|immediate action)\b/.test(h) ||
    /\bplease (verify|update|confirm|add|complete|respond|reply)\b/.test(h) ||
    (/\b(verify|update|add|complete)\b/.test(h) &&
      /\b(kyc|details|contact|profile|account|document)\b/.test(h) &&
      !/\badd alternate (contact|details)\b/.test(h)) ||
    /\b(overdue|past due|due (today|tomorrow|on|by))\b/.test(h) ||
    (/\b(invoice|payment)\b/.test(h) && /\b(due|pay now|outstanding|unpaid)\b/.test(h)) ||
    (/\b(credit )?card bill\b/.test(h) && /\b(due|pay|outstanding)\b/.test(h)) ||
    (/\b(credit )?card statement\b/.test(h) && /\b(due|pay|outstanding)\b/.test(h)) ||
    /\b(interview (invite|invitation|scheduled)|offer letter)\b/.test(h) ||
    /\bschedule (a|an) (interview|call)\b/.test(h) ||
    (/\byour application\b/.test(h) &&
      /\b(incomplete|complete|deadline|submit|action|review|next step)\b/.test(h))
  );
}

/** Parse Practo-style "Appointment Reminder: Fri, 07 Aug 2026 04:30 pm @ Clinic". */
export function parseAppointmentReminder(
  title: string,
  timeZone: string,
  now: Date = new Date(),
  snippet = "",
): {
  label: string;
  detail: string;
  score: number;
  dayOffset: number;
  dedupeKey: string;
  clockSort: string;
} | null {
  if (!/appointment reminder/i.test(title)) return null;
  const m = title.match(
    /appointment reminder:\s*(.+?)\s+(\d{1,2}:\d{2}\s*[ap]m)\s*@\s*(.+)$/i,
  );
  const whenBlob = m?.[1]?.trim() ?? "";
  const clockRaw = (m?.[2] ?? "").trim().toLowerCase().replace(/\s+/g, " ");
  const place = (m?.[3] ?? "Appointment").replace(/\s+/g, " ").trim();
  const dayMatch = whenBlob.match(/(\d{1,2})\s+([A-Za-z]{3,9})\s+(\d{4})/);
  let dayOffset = 0;
  let dayScore = 55;
  if (dayMatch) {
    const dayNum = Number(dayMatch[1]);
    const mon = dayMatch[2]!;
    const year = Number(dayMatch[3]);
    const months: Record<string, number> = {
      jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2,
      apr: 3, april: 3, may: 4, jun: 5, june: 5, jul: 6, july: 6,
      aug: 7, august: 7, sep: 8, sept: 8, september: 8,
      oct: 9, october: 9, nov: 10, november: 10, dec: 11, december: 11,
    };
    const mi = months[mon.toLowerCase()];
    if (mi != null && Number.isFinite(dayNum) && Number.isFinite(year)) {
      const { day: todayYmd } = localDayBoundsUtc(timeZone, now);
      const apptYmd = `${year}-${String(mi + 1).padStart(2, "0")}-${String(dayNum).padStart(2, "0")}`;
      const today = Date.parse(`${todayYmd}T12:00:00Z`);
      const appt = Date.parse(`${apptYmd}T12:00:00Z`);
      dayOffset = Math.round((appt - today) / 86_400_000);
      if (dayOffset < 0 || dayOffset > 2) return null; // only today / tomorrow / +2
      dayScore = dayOffset === 0 ? 95 : dayOffset === 1 ? 85 : 70;
    }
  }
  const dayWord =
    dayOffset === 0 ? "today" : dayOffset === 1 ? "tomorrow" : null;
  const whenLabel = [clockRaw, dayWord].filter(Boolean).join(" ");
  const clinic = place.replace(/\s*®\s*/g, " ").trim();
  const patientMatch = snippet.match(/Patient Name\s+([A-Za-z][A-Za-z .']{1,60})/i);
  const patient = patientMatch?.[1]?.trim().replace(/\s+/g, " ") ?? "";
  const patientFirst = patient.split(/\s+/)[0] ?? "";
  const label = (
    patientFirst
      ? `${whenLabel || "Appointment"} — ${clinic} (${patientFirst})`
      : `${whenLabel || "Appointment"} — ${clinic}`
  ).slice(0, 90);
  // Time + clinic only — duplicate syncs / missing patient names still collapse.
  const dedupeKey = `${clockRaw}|${clinic.toLowerCase()}`;
  const clockSort = (() => {
    const mm = clockRaw.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
    if (!mm) return clockRaw;
    let h = Number(mm[1]);
    const min = Number(mm[2]);
    const ap = (mm[3] ?? "").toLowerCase();
    if (ap === "pm" && h < 12) h += 12;
    if (ap === "am" && h === 12) h = 0;
    return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
  })();
  return {
    score: dayScore,
    label,
    detail: [
      `Appointment: ${clinic}`,
      patient ? `Patient: ${patient}` : null,
      whenLabel ? `When: ${whenLabel}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
    dayOffset,
    dedupeKey,
    clockSort,
  };
}

function isVipMail(hay: string, vipList: string[]): boolean {
  const h = hay.toLowerCase();
  return vipList.some((v) => {
    const needle = v.trim().toLowerCase();
    return needle.length >= 2 && h.includes(needle);
  });
}

/**
 * Score for brief priority. Passive txn alerts → 0 (excluded).
 * Action-demanding mail scores high; VIP can still surface.
 */
export function mailPriorityScore(
  title: string,
  actor: string,
  vipList: string[] = [],
  snippet = "",
  opts?: { timezone?: string; now?: Date },
): number {
  const hay = `${actor} ${title} ${snippet}`;
  const t = title.toLowerCase();
  if (looksLikePromoMail(hay)) return 0;
  if (isPassiveTransactionalMail(hay)) return 0;

  // Practo-style reminders: calendar line only for focus day — never stale priorities.
  if (/appointment reminder/i.test(title)) {
    const appt = parseAppointmentReminder(
      title,
      opts?.timezone ?? "Asia/Kolkata",
      opts?.now,
      snippet,
    );
    return appt ? appt.score : 0;
  }

  if (isFyiRecruitingMail(hay)) return 0;

  let score = 0;
  if (isActionDemandingMail(hay)) {
    score += 70;
    if (/\b(failed|insufficient|overdue|due today)\b/.test(t)) score += 20;
    if (/\bbill\b/.test(t) && /\bdue\b/.test(t)) score += 15;
    if (/\b(amount due|minimum due|payment due)\b/.test(hay.toLowerCase())) score += 15;
  }
  if (/\b(interview (invite|invitation|scheduled)|offer letter)\b/.test(t)) score += 55;
  // VIP boosts only already-actionable mail — never surfaces FYI alone.
  if (score > 0 && isVipMail(hay, vipList)) score += 40;

  // Generic personal mail with no action signal stays out of top brief.
  return score;
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
  const { createWatch } = await import("./watchRepos.js");
  await createWatch(db, {
    userId: opts.userId,
    kind: "commitment_stall",
    title: opts.title.slice(0, 500),
    commitmentId: row.id,
    dueAt: opts.dueAt,
  });
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

  // Prefer watch alerts when an open commitment_stall watch exists for the row.
  const { listOpenWatches } = await import("./watchRepos.js");
  const watchedIds = new Set<string>();
  for (const r of rows) {
    const open = await listOpenWatches(db, r.userId);
    for (const w of open) {
      if (w.commitmentId) watchedIds.add(w.commitmentId);
    }
  }

  return rows
    .filter((r): r is typeof r & { dueAt: Date } => r.dueAt != null)
    .filter((r) => !watchedIds.has(r.id))
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

export type ScheduledBriefUser = {
  id: string;
  name: string | null;
  timezone: string;
  status: string;
  prefs: UserPrefs;
};

/** Active users who have at least one Google account linked. */
export async function listUsersForScheduledBriefs(db: Db): Promise<ScheduledBriefUser[]> {
  const rows = await db
    .select({
      id: users.id,
      name: users.name,
      timezone: users.timezone,
      status: users.status,
      prefs: users.prefs,
    })
    .from(users)
    .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
    .where(eq(users.status, "active"))
    .limit(200);

  const seen = new Set<string>();
  const out: ScheduledBriefUser[] = [];
  for (const r of rows) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    out.push({
      id: r.id,
      name: r.name,
      timezone: r.timezone,
      status: r.status,
      prefs: parseUserPrefs(r.prefs as Record<string, unknown>),
    });
  }
  return out;
}

/** Thin alias for inbound conflict / CoS scans. */
export async function listUsersWithGoogleForScan(
  db: Db,
): Promise<Array<{ id: string; timezone: string; status: string }>> {
  const rows = await listUsersForScheduledBriefs(db);
  return rows.map((r) => ({ id: r.id, timezone: r.timezone, status: r.status }));
}

export function buildFlatBriefDigest(opts: {
  calendarToday: string;
  recentMail: string;
  openCommitmentsSummary: string;
}): string {
  // Legacy fallback — prefer buildPriorityBriefPayload.
  const parts: string[] = [];
  const cal =
    opts.calendarToday === "none yet" ? "Calendar: none today." : `Calendar: ${opts.calendarToday}`;
  const mail =
    opts.recentMail === "none yet"
      ? "Mail: none needing you."
      : `Mail: ${opts.recentMail}`;
  parts.push(cal, mail);
  if (opts.openCommitmentsSummary && opts.openCommitmentsSummary !== "none yet") {
    parts.push(`Open: ${opts.openCommitmentsSummary}`);
  }
  return parts.join(" · ").replace(/\n/g, " · ");
}

/** Curated morning/evening brief: top 3 priorities + calendar (WABA flat + free-form bullets). */
export async function buildPriorityBriefPayload(
  db: Db,
  userId: string,
  timezone: string,
  mutedPatterns: string[] = [],
  vipList: string[] = [],
  opts?: {
    kind?: "am" | "pm";
    now?: Date;
    closedMailThreads?: Record<string, string>;
  },
): Promise<{
  digestFlat: string;
  digestText: string;
  items: BriefPriorityItem[];
  quieterCount: number;
  moreText: string | null;
  calendarCount: number;
  commitmentCount: number;
}> {
  const kind = opts?.kind ?? "am";
  const now = opts?.now ?? new Date();
  const closedMailThreads = opts?.closedMailThreads ?? {};
  const todayBounds = localDayBoundsUtc(timezone, now);
  // Evening looks ahead to tomorrow; morning is today.
  const focusBounds =
    kind === "pm"
      ? localDayBoundsUtc(timezone, todayBounds.timeMax)
      : todayBounds;
  const { timeMin, timeMax } = focusBounds;
  const apptDayOffset = kind === "pm" ? 1 : 0;
  type Cand = {
    score: number;
    label: string;
    detail: string;
    kind: BriefPriorityItem["kind"];
    eventId?: string;
    threadId?: string;
    commitmentId?: string;
  };
  const cands: Cand[] = [];

  const calRows = await db.query.events.findMany({
    where: and(
      eq(events.userId, userId),
      eq(events.source, "calendar"),
      gte(events.occursAt, timeMin),
      lte(events.occursAt, timeMax),
    ),
    orderBy: [asc(events.occursAt)],
    limit: 8,
  });

  const commits = await db.query.commitments.findMany({
    where: and(eq(commitments.userId, userId), eq(commitments.status, "open")),
    orderBy: [asc(commitments.dueAt), desc(commitments.createdAt)],
    limit: 8,
  });
  for (const c of commits) {
    const due =
      c.dueAt && c.dueAt >= timeMin && c.dueAt <= timeMax
        ? formatLocalHm(c.dueAt, timezone)
        : c.dueAt
          ? formatLocalHm(c.dueAt, timezone)
          : null;
    const dueOnFocus = Boolean(c.dueAt && c.dueAt >= timeMin && c.dueAt <= timeMax);
    // Evening: only surface commitments still open / due on the focus day.
    if (kind === "pm" && !dueOnFocus && c.dueAt && c.dueAt < timeMin) continue;
    cands.push({
      score: dueOnFocus ? 85 : kind === "pm" ? 55 : 45,
      kind: "commitment",
      label: (due ? `${due} ${c.title}` : c.title).slice(0, 80),
      detail: [`Reminder: ${c.title}`, due ? `Due: ${due}` : "No due time set"].join("\n"),
      commitmentId: c.id,
    });
  }

  const mailRows = await listMailCandidates(db, userId, mutedPatterns, 30, {
    excludePassive: true,
  });
  const newestByThread = newestMailCreatedByThread(mailRows);
  const apptByKey = new Map<string, { label: string; detail: string; clockSort: string }>();
  for (const e of mailRows) {
    const from = shortActor(e.actor);
    const subject = cleanSubject(e.title);
    const fullTitle = (e.title ?? "").trim();
    const snippet = (e.snippet ?? "").replace(/\s+/g, " ").trim().slice(0, 280);
    const threadId = gmailThreadIdFromMeta(e.meta);
    // Appointment reminders → calendar only (never PRIORITIES / STILL OPEN).
    if (/appointment reminder/i.test(fullTitle)) {
      const appt = parseAppointmentReminder(fullTitle, timezone, now, snippet);
      if (appt && appt.dayOffset === apptDayOffset) {
        const prev = apptByKey.get(appt.dedupeKey);
        if (!prev || (appt.label.length > prev.label.length && /\(/.test(appt.label))) {
          apptByKey.set(appt.dedupeKey, {
            label: appt.label,
            detail: appt.detail,
            clockSort: appt.clockSort,
          });
        }
      }
      continue;
    }
    if (
      isClosedMailThreadSuppressed(
        threadId,
        e.createdAt,
        closedMailThreads,
        threadId ? newestByThread.get(threadId) ?? e.createdAt : e.createdAt,
      )
    ) {
      continue;
    }
    const score = mailPriorityScore(fullTitle, e.actor ?? "", vipList, snippet, {
      timezone,
      now,
    });
    // Evening bar: action-demanding only (drop soft FYI that barely clears 0).
    if (score <= 0) continue;
    if (kind === "pm" && score < 70) continue;
    cands.push({
      score,
      kind: "mail",
      label: `${subject} — ${from}`.slice(0, 90),
      detail: [`From: ${from}`, `Subject: ${subject}`, snippet ? `Preview: ${snippet}` : null]
        .filter(Boolean)
        .join("\n"),
      eventId: e.id,
      ...(threadId ? { threadId } : {}),
    });
  }

  cands.sort((a, b) => b.score - a.score);
  const seenLabels = new Set<string>();
  const ranked: Cand[] = [];
  for (const c of cands) {
    if (c.score <= 0) continue;
    const key = c.label.toLowerCase().replace(/\s+/g, " ").slice(0, 80);
    if (seenLabels.has(key)) continue;
    seenLabels.add(key);
    ranked.push(c);
  }
  const top = ranked.slice(0, 3);
  const rest = ranked.slice(3, 8);
  const quieterCount = Math.max(0, ranked.length - top.length);
  const items: BriefPriorityItem[] = top.map((c, i) => ({
    index: i + 1,
    label: c.label,
    detail: c.detail,
    kind: c.kind,
    ...(c.eventId ? { eventId: c.eventId } : {}),
    ...(c.threadId ? { threadId: c.threadId } : {}),
    ...(c.commitmentId ? { commitmentId: c.commitmentId } : {}),
  }));
  const moreText = rest.length
    ? rest.map((c, i) => `${i + 4}) ${c.label}`).join("\n")
    : null;

  const apptSorted = [...apptByKey.values()].sort((a, b) =>
    a.clockSort.localeCompare(b.clockSort),
  );
  const calBits = [
    ...calRows.map((e) => {
      const allDay = Boolean((e.meta as { allDay?: unknown })?.allDay);
      const when =
        allDay || !e.occursAt ? "all day" : formatLocalHm(e.occursAt, timezone);
      return `${when} ${cleanCalendarDisplayTitle((e.title ?? "Event").trim())}`;
    }),
    ...apptSorted.map((a) => a.label),
  ];

  // Leave-by from nearest upcoming travel plan (no Routes call).
  const upcomingPlan = await getNearestUpcomingTravelPlan(db, userId, now);
  if (
    upcomingPlan?.leaveBy &&
    upcomingPlan.travelMins != null &&
    upcomingPlan.leaveBy >= now &&
    upcomingPlan.leaveBy <= new Date(now.getTime() + 18 * 3600_000)
  ) {
    calBits.unshift(
      formatLeaveByBriefLine({
        title: upcomingPlan.itemTitle ?? "Event",
        leaveBy: upcomingPlan.leaveBy,
        travelMins: upcomingPlan.travelMins,
        originLabel: upcomingPlan.originLabel,
        timeZone: timezone,
      }),
    );
  }

  // Travel conflicts via cached geocodes only (never Routes on brief render).
  const locatedBlocks: Array<{
    id: string;
    title: string;
    start: Date;
    end: Date;
    location: string | null;
    lat: number;
    lng: number;
  }> = [];
  for (const e of calRows) {
    if (!e.occursAt) continue;
    const loc = calendarLocationFromEvent(e);
    if (!loc) continue;
    const cached = await getGeocodeCache(db, loc);
    if (!cached || cached === "miss") continue;
    const endIso = (e.meta as { end?: unknown })?.end;
    const end =
      typeof endIso === "string" && endIso
        ? new Date(endIso)
        : new Date(e.occursAt.getTime() + 60 * 60 * 1000);
    locatedBlocks.push({
      id: e.id,
      title: (e.title ?? "Event").trim() || "Event",
      start: e.occursAt,
      end,
      location: loc,
      lat: cached.lat,
      lng: cached.lng,
    });
  }
  for (const conflict of detectTravelConflictsFromCoords(locatedBlocks).slice(0, 2)) {
    calBits.push(describeTravelConflict(conflict, timezone));
  }
  const calSeen = new Set<string>();
  const calUnique: string[] = [];
  for (const bit of calBits) {
    const k = bit.toLowerCase().replace(/\s+/g, " ");
    if (calSeen.has(k)) continue;
    calSeen.add(k);
    calUnique.push(bit);
  }

  const calHeading = kind === "pm" ? "TOMORROW" : "CALENDAR";
  const openHeading = kind === "pm" ? "STILL OPEN" : "PRIORITIES";
  const calEmpty = kind === "pm" ? "• none yet" : "• none today";
  const calLine =
    calUnique.length === 0
      ? `${calHeading}\n${calEmpty}`
      : `${calHeading}\n${calUnique.map((b) => `• ${b}`).join("\n")}`;

  const priorityLines = items.map((it) => `${it.index}) ${it.label}`);
  const quietBit =
    quieterCount > 0 ? ` +${quieterCount} quieter.` : items.length ? "" : " Inbox clear.";

  // WABA template params cannot contain newlines — keep readable separators.
  const digestFlat = [
    calUnique.length === 0
      ? kind === "pm"
        ? "Tomorrow: none yet."
        : "Calendar: none today."
      : `${kind === "pm" ? "Tomorrow" : "Calendar"}: ${calUnique
          .slice(0, 4)
          .map((b) => `• ${b}`)
          .join(" ")}${calUnique.length > 4 ? ` (+${calUnique.length - 4})` : ""}.`,
    items.length
      ? `${kind === "pm" ? "Still open" : "Top"} ${items.length}: ${priorityLines.join(" · ")}.`
      : kind === "pm"
        ? "Nothing still open."
        : "No priorities flagged.",
    quietBit.trim(),
  ]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();

  const digestText = [
    calLine,
    "",
    openHeading,
    ...(items.length ? items.map((it) => `${it.index}) ${it.label}`) : ["• none needing you"]),
    quieterCount > 0 ? "" : null,
    quieterCount > 0
      ? `+${quieterCount} quieter. Reply 1–3 for detail, M for more.`
      : "Reply 1–3 for detail.",
  ]
    .filter((l) => l != null)
    .join("\n")
    .trim();

  return {
    digestFlat,
    digestText,
    items,
    quieterCount,
    moreText,
    calendarCount: calUnique.length,
    commitmentCount: commits.filter(
      (c) => c.dueAt && c.dueAt >= timeMin && c.dueAt <= timeMax,
    ).length,
  };
}

export type PendingActionKind =
  | "calendar_create"
  | "calendar_update"
  | "calendar_cancel"
  | "calendar_conflict"
  | "email_draft";

export type PendingActionStatus =
  | "pending"
  | "confirmed"
  | "rejected"
  | "expired"
  | "failed";

export type PendingActionRow = typeof pendingActions.$inferSelect;

export async function createPendingAction(
  db: Db,
  opts: {
    userId: string;
    kind: PendingActionKind;
    summary: string;
    payload: Record<string, unknown>;
    expiresInMs?: number;
  },
): Promise<PendingActionRow> {
  // Only one open pending per user — expire older ones.
  await expirePendingActions(db, opts.userId);
  await db
    .update(pendingActions)
    .set({ status: "expired", resolvedAt: new Date() })
    .where(
      and(eq(pendingActions.userId, opts.userId), eq(pendingActions.status, "pending")),
    );

  const expiresAt = new Date(Date.now() + (opts.expiresInMs ?? 2 * 60 * 60 * 1000));
  const [row] = await db
    .insert(pendingActions)
    .values({
      userId: opts.userId,
      kind: opts.kind,
      summary: opts.summary.slice(0, 1000),
      payload: opts.payload,
      status: "pending",
      expiresAt,
    })
    .returning();
  if (!row) throw new Error("failed to create pending action");
  return row;
}

export async function getOpenPendingAction(
  db: Db,
  userId: string,
): Promise<PendingActionRow | null> {
  await expirePendingActions(db, userId);
  const row = await db.query.pendingActions.findFirst({
    where: and(eq(pendingActions.userId, userId), eq(pendingActions.status, "pending")),
    orderBy: [desc(pendingActions.createdAt)],
  });
  return row ?? null;
}

export async function expirePendingActions(db: Db, userId?: string): Promise<number> {
  const now = new Date();
  const cond = userId
    ? and(
        eq(pendingActions.userId, userId),
        eq(pendingActions.status, "pending"),
        lte(pendingActions.expiresAt, now),
      )
    : and(eq(pendingActions.status, "pending"), lte(pendingActions.expiresAt, now));
  const updated = await db
    .update(pendingActions)
    .set({ status: "expired", resolvedAt: now })
    .where(cond)
    .returning({ id: pendingActions.id });
  return updated.length;
}

export async function resolvePendingAction(
  db: Db,
  id: string,
  opts: {
    status: Exclude<PendingActionStatus, "pending">;
    result?: Record<string, unknown>;
  },
): Promise<PendingActionRow | null> {
  const [row] = await db
    .update(pendingActions)
    .set({
      status: opts.status,
      result: opts.result ?? {},
      resolvedAt: new Date(),
    })
    .where(eq(pendingActions.id, id))
    .returning();
  return row ?? null;
}

export async function updatePendingPayload(
  db: Db,
  id: string,
  payload: Record<string, unknown>,
  summary?: string,
): Promise<PendingActionRow | null> {
  const [row] = await db
    .update(pendingActions)
    .set({
      payload,
      ...(summary ? { summary: summary.slice(0, 1000) } : {}),
    })
    .where(and(eq(pendingActions.id, id), eq(pendingActions.status, "pending")))
    .returning();
  return row ?? null;
}

export async function appendAudit(
  db: Db,
  opts: {
    userId: string;
    action: string;
    detail?: Record<string, unknown>;
    confirmed?: boolean;
  },
): Promise<void> {
  await db.insert(auditLog).values({
    userId: opts.userId,
    action: opts.action.slice(0, 80),
    detail: opts.detail ?? {},
    confirmed: opts.confirmed ?? false,
  });
}

export async function logEvalEvent(
  db: Db,
  opts: {
    userId?: string | null;
    bot?: string;
    channel?: string;
    event: string;
    score?: number | null;
    note?: string | null;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(evalEvents).values({
    userId: opts.userId ?? null,
    bot: opts.bot ?? "amilo-wa",
    channel: opts.channel ?? "whatsapp",
    event: opts.event.slice(0, 80),
    score: opts.score ?? null,
    note: opts.note ?? null,
    meta: opts.meta ?? {},
  });
}

/** Open commitments for matching. */
export async function listOpenCommitmentRows(
  db: Db,
  userId: string,
): Promise<Array<{ id: string; title: string; dueAt: Date | null; status: string }>> {
  return db.query.commitments.findMany({
    where: and(eq(commitments.userId, userId), eq(commitments.status, "open")),
    orderBy: [asc(commitments.dueAt), desc(commitments.createdAt)],
    limit: 40,
  });
}

async function finalizeCommitment(
  db: Db,
  id: string,
  title: string,
  status: "done" | "dropped" | "snoozed",
  snoozeUntil?: Date,
): Promise<{ ok: true; title: string; status: string }> {
  await db
    .update(commitments)
    .set({
      status,
      resolvedAt: status === "snoozed" ? null : new Date(),
      ...(status === "snoozed" && snoozeUntil ? { dueAt: snoozeUntil } : {}),
      ...(status === "snoozed" ? { notifiedAt: null } : {}),
    })
    .where(eq(commitments.id, id));
  if (status === "done" || status === "dropped") {
    const { cancelWatchesForCommitment } = await import("./watchRepos.js");
    await cancelWatchesForCommitment(db, id);
  }
  return { ok: true, title, status };
}

export async function resolveCommitmentByHint(
  db: Db,
  userId: string,
  titleHint: string,
  status: "done" | "dropped" | "snoozed",
  opts?: { snoozeUntil?: Date },
): Promise<
  | { ok: true; title: string; status: string }
  | { ok: false; reason: "none" | "ambiguous"; matches: string[] }
> {
  const needle = titleHint.trim().toLowerCase().replace(/\s+/g, " ");
  if (!needle) return { ok: false, reason: "none", matches: [] };
  const open = await listOpenCommitmentRows(db, userId);
  const matches = open.filter((c) => {
    const t = c.title.toLowerCase();
    return t.includes(needle) || needle.includes(t.slice(0, 40));
  });
  if (!matches.length) return { ok: false, reason: "none", matches: [] };
  if (matches.length > 1) {
    const exact = matches.filter((c) => c.title.toLowerCase() === needle);
    if (exact.length === 1) {
      return finalizeCommitment(db, exact[0]!.id, exact[0]!.title, status, opts?.snoozeUntil);
    }
    return {
      ok: false,
      reason: "ambiguous",
      matches: matches.slice(0, 5).map((m) => m.title),
    };
  }
  const one = matches[0]!;
  return finalizeCommitment(db, one.id, one.title, status, opts?.snoozeUntil);
}


