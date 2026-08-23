import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { and, count, desc, eq, gte, inArray, sql, sum } from "drizzle-orm";
import { localDayBoundsUtc } from "@amilo/core";
import {
  accessRequests,
  adminSessions,
  allowedPhones,
  invites,
  usageEvents,
  users,
} from "./schema.js";
import type { Db } from "./index.js";

export type AllowedPhoneRow = typeof allowedPhones.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;
export type AccessRequestRow = typeof accessRequests.$inferSelect;
export type AccessRequestStatus =
  | "new"
  | "invited"
  | "active"
  | "declined"
  | "spam";

export function normalizePhoneE164(raw: string): string | null {
  const digits = raw.replace(/\D/g, "");
  if (digits.length < 10 || digits.length > 15) return null;
  return `+${digits}`;
}

export function phoneDigits(raw: string): string {
  return raw.replace(/\D/g, "");
}

export async function listAllowedPhones(db: Db): Promise<AllowedPhoneRow[]> {
  return db.query.allowedPhones.findMany({
    orderBy: [desc(allowedPhones.createdAt)],
    limit: 200,
  });
}

export async function isPhoneAllowlisted(
  db: Db,
  waIdOrE164: string,
  envPhones: string[],
): Promise<boolean> {
  const key = phoneDigits(waIdOrE164);
  if (!key) return false;
  if (envPhones.some((p) => phoneDigits(p) === key)) return true;
  const rows = await db.query.allowedPhones.findMany({
    where: eq(allowedPhones.active, true),
    limit: 500,
  });
  return rows.some((r) => phoneDigits(r.phoneE164) === key);
}

export async function addAllowedPhone(
  db: Db,
  opts: { phoneE164: string; label?: string; note?: string },
): Promise<AllowedPhoneRow> {
  const phone = normalizePhoneE164(opts.phoneE164);
  if (!phone) throw new Error("Invalid phone — use E.164 like +9198XXXXXXXX");
  const existing = await db.query.allowedPhones.findFirst({
    where: eq(allowedPhones.phoneE164, phone),
  });
  if (existing) {
    const [updated] = await db
      .update(allowedPhones)
      .set({
        active: true,
        ...(opts.label ? { label: opts.label.slice(0, 120) } : {}),
        ...(opts.note ? { note: opts.note.slice(0, 500) } : {}),
      })
      .where(eq(allowedPhones.id, existing.id))
      .returning();
    return updated ?? existing;
  }
  const [row] = await db
    .insert(allowedPhones)
    .values({
      phoneE164: phone,
      label: opts.label?.slice(0, 120) ?? null,
      note: opts.note?.slice(0, 500) ?? null,
      active: true,
    })
    .returning();
  if (!row) throw new Error("failed to add allowed phone");
  return row;
}

export async function deactivateAllowedPhone(
  db: Db,
  phoneE164: string,
): Promise<boolean> {
  const phone = normalizePhoneE164(phoneE164);
  if (!phone) return false;
  const [row] = await db
    .update(allowedPhones)
    .set({ active: false })
    .where(eq(allowedPhones.phoneE164, phone))
    .returning();
  return Boolean(row);
}

function newInviteToken(): string {
  return randomBytes(9).toString("base64url");
}

export async function createInvite(
  db: Db,
  opts: {
    phoneE164?: string | null;
    label?: string | null;
    maxUses?: number;
    expiresInDays?: number;
  } = {},
): Promise<InviteRow> {
  let phone: string | null = null;
  if (opts.phoneE164) {
    phone = normalizePhoneE164(opts.phoneE164);
    if (!phone) throw new Error("Invalid phone for invite");
    await addAllowedPhone(db, {
      phoneE164: phone,
      ...(opts.label ? { label: opts.label } : {}),
    });
  }
  const expiresAt =
    opts.expiresInDays && opts.expiresInDays > 0
      ? new Date(Date.now() + opts.expiresInDays * 86_400_000)
      : null;
  const [row] = await db
    .insert(invites)
    .values({
      token: newInviteToken(),
      phoneE164: phone,
      label: opts.label?.slice(0, 120) ?? null,
      maxUses: Math.max(1, Math.min(50, opts.maxUses ?? 1)),
      useCount: 0,
      expiresAt,
    })
    .returning();
  if (!row) throw new Error("failed to create invite");
  return row;
}

export async function listInvites(db: Db): Promise<InviteRow[]> {
  return db.query.invites.findMany({
    orderBy: [desc(invites.createdAt)],
    limit: 100,
  });
}

export async function getInviteByToken(
  db: Db,
  token: string,
): Promise<InviteRow | null> {
  const t = token.trim();
  if (!t) return null;
  return (
    (await db.query.invites.findFirst({
      where: eq(invites.token, t),
    })) ?? null
  );
}

export function inviteIsOpen(row: InviteRow, now = new Date()): boolean {
  if (row.expiresAt && row.expiresAt.getTime() < now.getTime()) return false;
  return row.useCount < row.maxUses;
}

/** Claim invite: bind phone if needed, allowlist, bump useCount. */
export async function claimInvite(
  db: Db,
  token: string,
  phoneRaw?: string | null,
): Promise<{ ok: true; phoneE164: string; invite: InviteRow } | { ok: false; reason: string }> {
  const invite = await getInviteByToken(db, token);
  if (!invite) return { ok: false, reason: "Invite not found." };
  if (!inviteIsOpen(invite)) return { ok: false, reason: "Invite expired or already used." };

  let phone = invite.phoneE164;
  if (!phone) {
    if (!phoneRaw) return { ok: false, reason: "Enter your WhatsApp number (with country code)." };
    phone = normalizePhoneE164(phoneRaw);
    if (!phone) return { ok: false, reason: "Invalid phone — e.g. +9198XXXXXXXX" };
  }

  await addAllowedPhone(db, {
    phoneE164: phone,
    ...(invite.label ? { label: invite.label } : {}),
  });

  const [updated] = await db
    .update(invites)
    .set({
      useCount: invite.useCount + 1,
      phoneE164: phone,
    })
    .where(eq(invites.id, invite.id))
    .returning();

  await markAccessRequestActiveByPhone(db, phone);
  return { ok: true, phoneE164: phone, invite: updated ?? invite };
}

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

export function isValidEmail(raw: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(raw));
}

export async function createAccessRequest(
  db: Db,
  opts: {
    name: string;
    phone: string;
    email: string;
    source?: string | null;
    detail?: string | null;
    pageUrl?: string | null;
  },
): Promise<AccessRequestRow> {
  const name = opts.name.trim().slice(0, 120);
  if (name.length < 2) throw new Error("Name is required");
  const phone = normalizePhoneE164(opts.phone);
  if (!phone) throw new Error("Invalid WhatsApp number — use country code, e.g. +9198XXXXXXXX");
  const email = normalizeEmail(opts.email);
  if (!isValidEmail(email)) throw new Error("Invalid email");

  const existing = await db.query.accessRequests.findFirst({
    where: and(
      eq(accessRequests.phoneE164, phone),
      inArray(accessRequests.status, ["new", "invited"]),
    ),
    orderBy: [desc(accessRequests.createdAt)],
  });
  if (existing) {
    const [updated] = await db
      .update(accessRequests)
      .set({
        name,
        email,
        source: opts.source?.trim().slice(0, 120) || existing.source,
        detail: opts.detail?.trim().slice(0, 2000) || existing.detail,
        pageUrl: opts.pageUrl?.trim().slice(0, 500) || existing.pageUrl,
      })
      .where(eq(accessRequests.id, existing.id))
      .returning();
    return updated ?? existing;
  }

  const [row] = await db
    .insert(accessRequests)
    .values({
      name,
      phoneE164: phone,
      email,
      source: opts.source?.trim().slice(0, 120) || null,
      detail: opts.detail?.trim().slice(0, 2000) || null,
      pageUrl: opts.pageUrl?.trim().slice(0, 500) || null,
      status: "new",
    })
    .returning();
  if (!row) throw new Error("failed to save access request");
  return row;
}

export async function listAccessRequests(
  db: Db,
  opts?: { status?: AccessRequestStatus | "all"; limit?: number },
): Promise<AccessRequestRow[]> {
  const limit = Math.min(200, Math.max(1, opts?.limit ?? 100));
  if (opts?.status && opts.status !== "all") {
    return db.query.accessRequests.findMany({
      where: eq(accessRequests.status, opts.status),
      orderBy: [desc(accessRequests.createdAt)],
      limit,
    });
  }
  return db.query.accessRequests.findMany({
    orderBy: [desc(accessRequests.createdAt)],
    limit,
  });
}

export async function getAccessRequest(
  db: Db,
  id: string,
): Promise<AccessRequestRow | null> {
  return (
    (await db.query.accessRequests.findFirst({
      where: eq(accessRequests.id, id),
    })) ?? null
  );
}

export async function decideAccessRequest(
  db: Db,
  id: string,
  opts: {
    status: Exclude<AccessRequestStatus, "new">;
    adminNote?: string | null;
    inviteId?: string | null;
    userId?: string | null;
  },
): Promise<AccessRequestRow | null> {
  const [row] = await db
    .update(accessRequests)
    .set({
      status: opts.status,
      decidedAt: new Date(),
      ...(opts.adminNote !== undefined
        ? { adminNote: opts.adminNote?.slice(0, 1000) ?? null }
        : {}),
      ...(opts.inviteId !== undefined ? { inviteId: opts.inviteId } : {}),
      ...(opts.userId !== undefined ? { userId: opts.userId } : {}),
    })
    .where(eq(accessRequests.id, id))
    .returning();
  return row ?? null;
}

/** Approve: allowlist + invite link, mark invited (or active if already chatting). */
export async function approveAccessRequest(
  db: Db,
  id: string,
  opts?: { adminNote?: string | null; expiresInDays?: number },
): Promise<{ request: AccessRequestRow; invite: InviteRow; inviteUrlPath: string }> {
  const req = await getAccessRequest(db, id);
  if (!req) throw new Error("Request not found");
  if (req.status === "declined" || req.status === "spam") {
    throw new Error("Request was declined — create a new invite manually if needed.");
  }
  const invite = await createInvite(db, {
    phoneE164: req.phoneE164,
    label: req.name,
    maxUses: 1,
    expiresInDays: opts?.expiresInDays ?? 14,
  });
  const user = await db.query.users.findFirst({
    where: eq(users.phoneE164, req.phoneE164),
  });
  const alreadyActive = Boolean(user);
  const updated = await decideAccessRequest(db, id, {
    status: alreadyActive ? "active" : "invited",
    inviteId: invite.id,
    userId: user?.id ?? null,
    adminNote: opts?.adminNote ?? null,
  });
  if (!updated) throw new Error("failed to update request");
  return { request: updated, invite, inviteUrlPath: `/i/${invite.token}` };
}

export async function markAccessRequestActiveByPhone(
  db: Db,
  phoneRaw: string,
  userId?: string | null,
): Promise<void> {
  const phone = normalizePhoneE164(phoneRaw);
  if (!phone) return;
  await db
    .update(accessRequests)
    .set({
      status: "active",
      decidedAt: new Date(),
      ...(userId ? { userId } : {}),
    })
    .where(
      and(
        eq(accessRequests.phoneE164, phone),
        inArray(accessRequests.status, ["new", "invited"]),
      ),
    );
}

export async function countActiveUsers(db: Db): Promise<number> {
  const rows = await db
    .select({ n: count() })
    .from(users)
    .where(eq(users.status, "active"));
  return Number(rows[0]?.n ?? 0) || 0;
}

export async function getOnboardingStats(db: Db): Promise<{
  requestsTotal: number;
  requestsPending: number;
  requestsInvited: number;
  requestsActive: number;
  requestsDeclined: number;
  requestsThisWeek: number;
  activeUsers: number;
}> {
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000);
  const byStatus = await db
    .select({
      status: accessRequests.status,
      n: count(),
    })
    .from(accessRequests)
    .groupBy(accessRequests.status);
  const map = new Map(byStatus.map((r) => [r.status, Number(r.n) || 0]));
  const weekRows = await db
    .select({ n: count() })
    .from(accessRequests)
    .where(gte(accessRequests.createdAt, weekAgo));
  const activeUsers = await countActiveUsers(db);
  const requestsPending = map.get("new") ?? 0;
  const requestsInvited = map.get("invited") ?? 0;
  const requestsActive = map.get("active") ?? 0;
  const requestsDeclined = (map.get("declined") ?? 0) + (map.get("spam") ?? 0);
  return {
    requestsTotal: [...map.values()].reduce((a, b) => a + b, 0),
    requestsPending,
    requestsInvited,
    requestsActive,
    requestsDeclined,
    requestsThisWeek: Number(weekRows[0]?.n ?? 0) || 0,
    activeUsers,
  };
}

function hashSessionToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function hashAdminPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 32).toString("hex");
}

export function verifyAdminPassword(
  password: string,
  salt: string,
  expectedHex: string,
): boolean {
  try {
    const got = Buffer.from(hashAdminPassword(password, salt), "hex");
    const exp = Buffer.from(expectedHex, "hex");
    if (got.length !== exp.length) return false;
    return timingSafeEqual(got, exp);
  } catch {
    return false;
  }
}

/** Dev/deploy convenience: derive a stable hash from password + salt. */
export function adminPasswordMatches(
  password: string,
  opts: { passwordPlain?: string; passwordHash?: string; passwordSalt?: string },
): boolean {
  const plain = opts.passwordPlain?.trim() ?? "";
  if (plain) {
    const a = Buffer.from(password);
    const b = Buffer.from(plain);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
  const hash = opts.passwordHash?.trim() ?? "";
  const salt = opts.passwordSalt?.trim() ?? "";
  if (!hash || !salt) return false;
  return verifyAdminPassword(password, salt, hash);
}

export async function createAdminSession(
  db: Db,
  email: string,
  ttlDays = 14,
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + ttlDays * 86_400_000);
  await db.insert(adminSessions).values({
    email: normalizeEmail(email),
    tokenHash: hashSessionToken(token),
    expiresAt,
  });
  return { token, expiresAt };
}

export async function getAdminSessionEmail(
  db: Db,
  token: string | undefined | null,
): Promise<string | null> {
  if (!token) return null;
  const hash = hashSessionToken(token);
  const row = await db.query.adminSessions.findFirst({
    where: eq(adminSessions.tokenHash, hash),
  });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(adminSessions).where(eq(adminSessions.id, row.id));
    return null;
  }
  return row.email;
}

export async function destroyAdminSession(
  db: Db,
  token: string | undefined | null,
): Promise<void> {
  if (!token) return;
  await db.delete(adminSessions).where(eq(adminSessions.tokenHash, hashSessionToken(token)));
}

/** Rough micro-USD estimates for beta metering. */
export const USAGE_COST_MICROS = {
  brain: 800, // ~$0.0008 / chat turn
  stt: 500,
  maps: 500,
  wa_out: 100,
  interaction: 800,
} as const;

export async function recordUsage(
  db: Db,
  opts: {
    userId: string | null;
    kind: string;
    units?: number;
    costMicros?: number;
    meta?: Record<string, unknown>;
  },
): Promise<void> {
  await db.insert(usageEvents).values({
    userId: opts.userId,
    kind: opts.kind.slice(0, 40),
    units: opts.units ?? 1,
    costMicros: opts.costMicros ?? 0,
    meta: opts.meta ?? {},
  });
}

export async function summarizeUserUsage(
  db: Db,
  userId: string,
  since: Date,
): Promise<{ interactions: number; costMicros: number }> {
  const rows = await db
    .select({
      units: sum(usageEvents.units),
      cost: sum(usageEvents.costMicros),
    })
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.userId, userId),
        gte(usageEvents.ts, since),
        sql`${usageEvents.kind} in ('brain','interaction','stt')`,
      ),
    );
  const units = Number(rows[0]?.units ?? 0);
  const cost = Number(rows[0]?.cost ?? 0);
  return {
    interactions: Number.isFinite(units) ? units : 0,
    costMicros: Number.isFinite(cost) ? cost : 0,
  };
}

export type UsageCaps = { day: number; week: number };

export const DEFAULT_USAGE_CAPS: UsageCaps = { day: 40, week: 150 };

/** Product host — never metered. Extra numbers via HOST_PHONE / USAGE_CAP_EXEMPT_PHONES. */
export const DEFAULT_HOST_PHONES = ["+918108506999"];

export function isUsageCapExemptPhone(
  phone: string,
  exemptPhones: string[],
): boolean {
  const key = phoneDigits(phone);
  if (!key) return false;
  return exemptPhones.some((p) => phoneDigits(p) === key);
}

/** Local calendar-day start (00:00 in the user's timezone). */
export function usageDayStartUtc(timeZone: string, now = new Date()): Date {
  return localDayBoundsUtc(timeZone, now).timeMin;
}

export async function checkUsageCaps(
  db: Db,
  userId: string,
  caps: UsageCaps = DEFAULT_USAGE_CAPS,
  opts?: { now?: Date; timeZone?: string },
): Promise<{ ok: true } | { ok: false; message: string }> {
  const now = opts?.now ?? new Date();
  const timeZone = opts?.timeZone ?? "Asia/Kolkata";
  const dayStart = usageDayStartUtc(timeZone, now);
  const weekAgo = new Date(now.getTime() - 7 * 24 * 3600_000);
  const day = await summarizeUserUsage(db, userId, dayStart);
  if (day.interactions >= caps.day) {
    return {
      ok: false,
      message: `Daily Amilo cap reached (${caps.day} interactions). Resets at midnight — or ask the host to raise your limit.`,
    };
  }
  const week = await summarizeUserUsage(db, userId, weekAgo);
  if (week.interactions >= caps.week) {
    return {
      ok: false,
      message: `Weekly Amilo cap reached (${caps.week} interactions). Resets on a rolling 7-day window.`,
    };
  }
  return { ok: true };
}

export async function listUsageByUser(
  db: Db,
  since: Date,
): Promise<
  Array<{
    userId: string | null;
    phone: string | null;
    name: string | null;
    interactions: number;
    costMicros: number;
  }>
> {
  const rows = await db
    .select({
      userId: usageEvents.userId,
      units: sum(usageEvents.units),
      cost: sum(usageEvents.costMicros),
    })
    .from(usageEvents)
    .where(
      and(
        gte(usageEvents.ts, since),
        sql`${usageEvents.kind} in ('brain','interaction','stt')`,
      ),
    )
    .groupBy(usageEvents.userId)
    .orderBy(desc(sum(usageEvents.units)))
    .limit(50);

  const out: Array<{
    userId: string | null;
    phone: string | null;
    name: string | null;
    interactions: number;
    costMicros: number;
  }> = [];
  for (const r of rows) {
    let phone: string | null = null;
    let name: string | null = null;
    if (r.userId) {
      const u = await db.query.users.findFirst({ where: eq(users.id, r.userId) });
      phone = u?.phoneE164 ?? null;
      name = u?.name ?? null;
    }
    out.push({
      userId: r.userId,
      phone,
      name,
      interactions: Number(r.units ?? 0) || 0,
      costMicros: Number(r.cost ?? 0) || 0,
    });
  }
  return out;
}

export function waMeUrl(displayPhoneE164: string, text = "Hi Amilo"): string {
  const digits = phoneDigits(displayPhoneE164);
  const q = encodeURIComponent(text);
  return `https://wa.me/${digits}?text=${q}`;
}

export function formatUsdFromMicros(micros: number): string {
  return `$${(micros / 1_000_000).toFixed(4)}`;
}
