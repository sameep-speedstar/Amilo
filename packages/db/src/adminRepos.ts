import { and, asc, count, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import {
  accessRequests,
  channels,
  commitments,
  evalEvents,
  googleAccounts,
  invites,
  messageLog,
  pendingActions,
  usageEvents,
  users,
  watches,
} from "./schema.js";
import type { Db } from "./index.js";
import {
  DEFAULT_USAGE_CAPS,
  isUsageCapExemptPhone,
  summarizeUserUsage,
  usageDayStartUtc,
  type UsageCaps,
} from "./onboardRepos.js";

export type AdminUserRow = {
  id: string;
  name: string | null;
  phoneE164: string;
  status: string;
  timezone: string;
  createdAt: Date;
  lastSeen: Date | null;
  googleLinked: boolean;
  googleEmails: string[];
  googleLastSync: Date | null;
  dayUsage: number;
  weekUsage: number;
  weekCostMicros: number;
  dayCap: number;
  weekCap: number;
  capExempt: boolean;
  capPctDay: number;
  capPctWeek: number;
};

export type AdminChatLine = {
  id: string;
  direction: string;
  kind: string;
  bodyRef: string | null;
  ts: Date;
};

export type AdminUserInspect = {
  user: typeof users.$inferSelect;
  lastSeen: Date | null;
  googleAccounts: Array<{
    label: string;
    email: string | null;
    lastSyncAt: Date | null;
  }>;
  dayUsage: number;
  weekUsage: number;
  weekCostMicros: number;
  capExempt: boolean;
  chat: AdminChatLine[];
  commitments: Array<{ id: string; title: string; dueAt: Date | null; status: string }>;
  pending: typeof pendingActions.$inferSelect | null;
  openWatches: Array<{ id: string; kind: string; title: string; status: string }>;
};

export type DailyFunnelRow = {
  day: string;
  requests: number;
  invited: number;
  active: number;
  newUsers: number;
};

export type DailyUsageKindRow = {
  day: string;
  kind: string;
  units: number;
  costMicros: number;
};

export type BriefQualityStats = {
  morning: number;
  evening: number;
  total: number;
  avgPriorities: number;
  freeFormRate: number;
  byDay: Array<{ day: string; count: number }>;
};

export type WatcherQualityStats = {
  open: number;
  firedWeek: number;
  cancelledWeek: number;
  alertsWeek: number;
  byKindOpen: Record<string, number>;
  byKindFiredWeek: Record<string, number>;
};

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export async function listUsersForAdmin(
  db: Db,
  opts: {
    caps?: UsageCaps;
    exemptPhones?: string[];
    limit?: number;
  } = {},
): Promise<AdminUserRow[]> {
  const caps = opts.caps ?? DEFAULT_USAGE_CAPS;
  const exemptPhones = opts.exemptPhones ?? [];
  const limit = Math.min(200, opts.limit ?? 100);
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);

  const rows = await db
    .select({
      user: users,
      lastInboundAt: channels.lastInboundAt,
    })
    .from(users)
    .leftJoin(
      channels,
      and(eq(channels.userId, users.id), eq(channels.kind, "whatsapp")),
    )
    .orderBy(desc(users.createdAt))
    .limit(limit);

  const out: AdminUserRow[] = [];
  for (const r of rows) {
    const u = r.user;
    const gAccounts = await db.query.googleAccounts.findMany({
      where: eq(googleAccounts.userId, u.id),
      columns: { email: true, lastSyncAt: true },
    });
    const dayStart = usageDayStartUtc(u.timezone || "Asia/Kolkata", now);
    const day = await summarizeUserUsage(db, u.id, dayStart);
    const week = await summarizeUserUsage(db, u.id, weekAgo);
    const weekCostRows = await db
      .select({ cost: sum(usageEvents.costMicros) })
      .from(usageEvents)
      .where(and(eq(usageEvents.userId, u.id), gte(usageEvents.ts, weekAgo)));
    const weekCostMicros = Number(weekCostRows[0]?.cost ?? 0) || 0;
    const exempt = isUsageCapExemptPhone(u.phoneE164, exemptPhones);
    const dayPct = caps.day > 0 ? Math.round((day.interactions / caps.day) * 100) : 0;
    const weekPct = caps.week > 0 ? Math.round((week.interactions / caps.week) * 100) : 0;
    const emails = gAccounts.map((a) => a.email).filter(Boolean) as string[];
    const lastSync = gAccounts.reduce<Date | null>((best, a) => {
      if (!a.lastSyncAt) return best;
      if (!best || a.lastSyncAt > best) return a.lastSyncAt;
      return best;
    }, null);

    out.push({
      id: u.id,
      name: u.name,
      phoneE164: u.phoneE164,
      status: u.status,
      timezone: u.timezone,
      createdAt: u.createdAt,
      lastSeen: r.lastInboundAt ?? null,
      googleLinked: gAccounts.length > 0,
      googleEmails: emails,
      googleLastSync: lastSync,
      dayUsage: day.interactions,
      weekUsage: week.interactions,
      weekCostMicros,
      dayCap: caps.day,
      weekCap: caps.week,
      capExempt: exempt,
      capPctDay: dayPct,
      capPctWeek: weekPct,
    });
  }
  return out;
}

export async function getUserInspect(
  db: Db,
  userId: string,
  opts: { exemptPhones?: string[] } = {},
): Promise<AdminUserInspect | null> {
  const user = await db.query.users.findFirst({ where: eq(users.id, userId) });
  if (!user) return null;

  const ch = await db.query.channels.findFirst({
    where: and(eq(channels.userId, userId), eq(channels.kind, "whatsapp")),
  });
  const gAccounts = await db.query.googleAccounts.findMany({
    where: eq(googleAccounts.userId, userId),
    columns: { label: true, email: true, lastSyncAt: true },
  });
  const now = new Date();
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
  const dayStart = usageDayStartUtc(user.timezone || "Asia/Kolkata", now);
  const day = await summarizeUserUsage(db, userId, dayStart);
  const week = await summarizeUserUsage(db, userId, weekAgo);
  const weekCostRows = await db
    .select({ cost: sum(usageEvents.costMicros) })
    .from(usageEvents)
    .where(and(eq(usageEvents.userId, userId), gte(usageEvents.ts, weekAgo)));
  const weekCostMicros = Number(weekCostRows[0]?.cost ?? 0) || 0;

  const chatRows = await db.query.messageLog.findMany({
    where: and(eq(messageLog.userId, userId), eq(messageLog.channel, "whatsapp")),
    orderBy: [desc(messageLog.ts)],
    limit: 40,
    columns: { id: true, direction: true, kind: true, bodyRef: true, ts: true },
  });

  const openCommits = await db.query.commitments.findMany({
    where: and(eq(commitments.userId, userId), eq(commitments.status, "open")),
    orderBy: [asc(commitments.dueAt)],
    limit: 30,
    columns: { id: true, title: true, dueAt: true, status: true },
  });

  const pending = await db.query.pendingActions.findFirst({
    where: and(eq(pendingActions.userId, userId), eq(pendingActions.status, "pending")),
    orderBy: [desc(pendingActions.createdAt)],
  });

  const openWatches = await db.query.watches.findMany({
    where: and(eq(watches.userId, userId), eq(watches.status, "open")),
    orderBy: [asc(watches.armedAt)],
    limit: 20,
    columns: { id: true, kind: true, title: true, status: true },
  });

  return {
    user,
    lastSeen: ch?.lastInboundAt ?? null,
    googleAccounts: gAccounts,
    dayUsage: day.interactions,
    weekUsage: week.interactions,
    weekCostMicros,
    capExempt: isUsageCapExemptPhone(user.phoneE164, opts.exemptPhones ?? []),
    chat: chatRows.map((c) => ({
      id: c.id,
      direction: c.direction,
      kind: c.kind,
      bodyRef: c.bodyRef,
      ts: c.ts,
    })),
    commitments: openCommits,
    pending: pending ?? null,
    openWatches,
  };
}

export async function getInviteFunnelByDay(
  db: Db,
  days = 14,
): Promise<DailyFunnelRow[]> {
  const since = new Date(Date.now() - days * 86_400_000);
  const dayMap = new Map<string, DailyFunnelRow>();

  const initDay = (day: string): DailyFunnelRow => {
    const existing = dayMap.get(day);
    if (existing) return existing;
    const row: DailyFunnelRow = {
      day,
      requests: 0,
      invited: 0,
      active: 0,
      newUsers: 0,
    };
    dayMap.set(day, row);
    return row;
  };

  const reqRows = await db
    .select({
      day: sql<string>`date_trunc('day', ${accessRequests.createdAt})::date`.as("day"),
      n: count(),
    })
    .from(accessRequests)
    .where(gte(accessRequests.createdAt, since))
    .groupBy(sql`date_trunc('day', ${accessRequests.createdAt})::date`);

  for (const r of reqRows) {
    const day = String(r.day).slice(0, 10);
    initDay(day).requests = Number(r.n) || 0;
  }

  const invitedRows = await db
    .select({
      day: sql<string>`date_trunc('day', coalesce(${accessRequests.decidedAt}, ${accessRequests.createdAt}))::date`.as(
        "day",
      ),
      n: count(),
    })
    .from(accessRequests)
    .where(
      and(
        gte(accessRequests.createdAt, since),
        inArray(accessRequests.status, ["invited", "active"]),
      ),
    )
    .groupBy(
      sql`date_trunc('day', coalesce(${accessRequests.decidedAt}, ${accessRequests.createdAt}))::date`,
    );

  for (const r of invitedRows) {
    const day = String(r.day).slice(0, 10);
    initDay(day).invited = Number(r.n) || 0;
  }

  const activeRows = await db
    .select({
      day: sql<string>`date_trunc('day', ${users.createdAt})::date`.as("day"),
      n: count(),
    })
    .from(users)
    .where(gte(users.createdAt, since))
    .groupBy(sql`date_trunc('day', ${users.createdAt})::date`);

  for (const r of activeRows) {
    const day = String(r.day).slice(0, 10);
    const row = initDay(day);
    row.newUsers = Number(r.n) || 0;
    row.active = row.newUsers;
  }

  return [...dayMap.values()].sort((a, b) => b.day.localeCompare(a.day));
}

export async function listUsageByKindDay(
  db: Db,
  since: Date,
): Promise<DailyUsageKindRow[]> {
  const rows = await db
    .select({
      day: sql<string>`date_trunc('day', ${usageEvents.ts})::date`.as("day"),
      kind: usageEvents.kind,
      units: sum(usageEvents.units),
      cost: sum(usageEvents.costMicros),
    })
    .from(usageEvents)
    .where(gte(usageEvents.ts, since))
    .groupBy(sql`date_trunc('day', ${usageEvents.ts})::date`, usageEvents.kind)
    .orderBy(desc(sql`date_trunc('day', ${usageEvents.ts})::date`));

  return rows.map((r) => ({
    day: String(r.day).slice(0, 10),
    kind: r.kind,
    units: Number(r.units ?? 0) || 0,
    costMicros: Number(r.cost ?? 0) || 0,
  }));
}

export async function getBriefQualityStats(
  db: Db,
  since: Date,
): Promise<BriefQualityStats> {
  const rows = await db.query.evalEvents.findMany({
    where: and(eq(evalEvents.event, "brief_sent"), gte(evalEvents.ts, since)),
    columns: { note: true, meta: true, ts: true },
    limit: 500,
  });

  let morning = 0;
  let evening = 0;
  let prioritySum = 0;
  let freeFormCount = 0;
  const byDay = new Map<string, number>();

  for (const r of rows) {
    if (r.note === "morning") morning += 1;
    else if (r.note === "evening") evening += 1;
    const meta = (r.meta ?? {}) as { priorities?: unknown; freeForm?: unknown };
    const pri = Number(meta.priorities ?? 0);
    if (Number.isFinite(pri)) prioritySum += pri;
    if (meta.freeForm === true) freeFormCount += 1;
    const dk = dayKey(r.ts);
    byDay.set(dk, (byDay.get(dk) ?? 0) + 1);
  }

  const total = rows.length;
  return {
    morning,
    evening,
    total,
    avgPriorities: total > 0 ? Math.round((prioritySum / total) * 10) / 10 : 0,
    freeFormRate: total > 0 ? Math.round((freeFormCount / total) * 100) : 0,
    byDay: [...byDay.entries()]
      .map(([day, count]) => ({ day, count }))
      .sort((a, b) => b.day.localeCompare(a.day)),
  };
}

export async function getWatcherQualityStats(
  db: Db,
  since: Date,
): Promise<WatcherQualityStats> {
  const openRows = await db
    .select({ kind: watches.kind, n: count() })
    .from(watches)
    .where(eq(watches.status, "open"))
    .groupBy(watches.kind);

  const firedRows = await db
    .select({ kind: watches.kind, n: count() })
    .from(watches)
    .where(and(eq(watches.status, "fired"), gte(watches.alertSentAt, since)))
    .groupBy(watches.kind);

  const cancelledRows = await db
    .select({ n: count() })
    .from(watches)
    .where(and(eq(watches.status, "cancelled"), gte(watches.createdAt, since)));

  const alertRows = await db
    .select({ n: count() })
    .from(messageLog)
    .where(
      and(
        eq(messageLog.direction, "out"),
        gte(messageLog.ts, since),
        sql`${messageLog.meta}->>'watchId' is not null`,
      ),
    );

  const byKindOpen: Record<string, number> = {};
  for (const r of openRows) {
    byKindOpen[r.kind] = Number(r.n) || 0;
  }
  const byKindFiredWeek: Record<string, number> = {};
  let firedWeek = 0;
  for (const r of firedRows) {
    const n = Number(r.n) || 0;
    byKindFiredWeek[r.kind] = n;
    firedWeek += n;
  }

  return {
    open: openRows.reduce((a, r) => a + (Number(r.n) || 0), 0),
    firedWeek,
    cancelledWeek: Number(cancelledRows[0]?.n ?? 0) || 0,
    alertsWeek: Number(alertRows[0]?.n ?? 0) || 0,
    byKindOpen,
    byKindFiredWeek,
  };
}

export async function countInvitesSummary(db: Db): Promise<{
  total: number;
  open: number;
  totalUses: number;
}> {
  const rows = await db.query.invites.findMany({
    columns: { useCount: true, maxUses: true, expiresAt: true },
    limit: 500,
  });
  const now = Date.now();
  let open = 0;
  let totalUses = 0;
  for (const i of rows) {
    totalUses += i.useCount;
    const expired = i.expiresAt && i.expiresAt.getTime() < now;
    if (!expired && i.useCount < i.maxUses) open += 1;
  }
  return { total: rows.length, open, totalUses };
}
