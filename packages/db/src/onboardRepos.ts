import { localDayBoundsUtc } from "@amilo/core";
import { and, desc, eq, gte, sql, sum } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { allowedPhones, invites, usageEvents, users } from "./schema.js";
import type { Db } from "./index.js";

export type AllowedPhoneRow = typeof allowedPhones.$inferSelect;
export type InviteRow = typeof invites.$inferSelect;

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

  return { ok: true, phoneE164: phone, invite: updated ?? invite };
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
