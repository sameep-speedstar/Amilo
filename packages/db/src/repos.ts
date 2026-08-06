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
      const gid = googleCalendarIdFromEvent(e);
      const idBit = gid ? ` [id:${gid}]` : "";
      return `• ${when} ${e.title ?? "(untitled)"}${idBit}`;
    })
    .join("\n");
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
  };
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

export function buildFlatBriefDigest(opts: {
  calendarToday: string;
  recentMail: string;
  openCommitmentsSummary: string;
}): string {
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
  return parts.join(" | ").replace(/\n/g, " • ");
}

export type PendingActionKind =
  | "calendar_create"
  | "calendar_update"
  | "calendar_cancel"
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


