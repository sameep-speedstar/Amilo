import { and, desc, eq, inArray, lte } from "drizzle-orm";
import {
  studioAssets,
  studioChannels,
  studioPlans,
  studioPosts,
  studioProducts,
  studioTargets,
} from "./schema.js";
import type { Db } from "./index.js";

export const STUDIO_CHANNEL_KINDS = ["x", "instagram", "linkedin"] as const;
export type StudioChannelKind = (typeof STUDIO_CHANNEL_KINDS)[number];

export async function listStudioProducts(db: Db) {
  return db.select().from(studioProducts).orderBy(studioProducts.createdAt);
}

export async function getStudioProduct(db: Db, id: string) {
  const rows = await db.select().from(studioProducts).where(eq(studioProducts.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function createStudioProduct(
  db: Db,
  input: { slug: string; name: string; tagline?: string; timezone?: string },
) {
  const rows = await db
    .insert(studioProducts)
    .values({
      slug: input.slug,
      name: input.name,
      ...(input.tagline ? { tagline: input.tagline } : {}),
      ...(input.timezone ? { timezone: input.timezone } : {}),
    })
    .returning();
  return rows[0]!;
}

export async function listStudioChannels(db: Db, productId: string) {
  return db.select().from(studioChannels).where(eq(studioChannels.productId, productId));
}

export async function upsertStudioChannel(
  db: Db,
  input: {
    productId: string;
    kind: string;
    handle: string;
    credentialsEnc?: string;
    meta?: Record<string, unknown>;
    enabled?: boolean;
  },
) {
  const existing = await db
    .select()
    .from(studioChannels)
    .where(and(eq(studioChannels.productId, input.productId), eq(studioChannels.kind, input.kind)))
    .limit(1);
  if (existing[0]) {
    const rows = await db
      .update(studioChannels)
      .set({
        handle: input.handle,
        updatedAt: new Date(),
        ...(input.credentialsEnc !== undefined ? { credentialsEnc: input.credentialsEnc } : {}),
        ...(input.meta ? { meta: input.meta } : {}),
        ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
      })
      .where(eq(studioChannels.id, existing[0].id))
      .returning();
    return rows[0]!;
  }
  const rows = await db
    .insert(studioChannels)
    .values({
      productId: input.productId,
      kind: input.kind,
      handle: input.handle,
      ...(input.credentialsEnc !== undefined ? { credentialsEnc: input.credentialsEnc } : {}),
      ...(input.meta ? { meta: input.meta } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    })
    .returning();
  return rows[0]!;
}

export async function createStudioPlan(
  db: Db,
  input: { productId: string; title: string; rawText: string },
) {
  const rows = await db.insert(studioPlans).values(input).returning();
  return rows[0]!;
}

export async function createStudioPost(
  db: Db,
  input: {
    productId: string;
    planId?: string;
    source: string;
    hook: string;
    scheduledAt: Date;
    status: string;
    mockup?: Record<string, unknown>;
  },
) {
  const rows = await db
    .insert(studioPosts)
    .values({
      productId: input.productId,
      source: input.source,
      hook: input.hook,
      scheduledAt: input.scheduledAt,
      status: input.status,
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.mockup ? { mockup: input.mockup } : {}),
    })
    .returning();
  return rows[0]!;
}

export async function addStudioTargets(
  db: Db,
  postId: string,
  targets: Array<{ channelKind: string; copy: string }>,
) {
  if (targets.length === 0) return [];
  return db
    .insert(studioTargets)
    .values(targets.map((t) => ({ postId, channelKind: t.channelKind, copy: t.copy })))
    .returning();
}

export async function listStudioPosts(db: Db, productId: string) {
  const posts = await db
    .select()
    .from(studioPosts)
    .where(eq(studioPosts.productId, productId))
    .orderBy(desc(studioPosts.scheduledAt));
  const ids = posts.map((p) => p.id);
  const targets =
    ids.length === 0
      ? []
      : await db.select().from(studioTargets).where(inArray(studioTargets.postId, ids));
  const assets =
    ids.length === 0
      ? []
      : await db.select().from(studioAssets).where(inArray(studioAssets.postId, ids));
  return posts.map((p) => ({
    ...p,
    targets: targets.filter((t) => t.postId === p.id),
    assets: assets.filter((a) => a.postId === p.id),
  }));
}

export async function getStudioPost(db: Db, id: string) {
  const rows = await db.select().from(studioPosts).where(eq(studioPosts.id, id)).limit(1);
  const post = rows[0];
  if (!post) return null;
  const targets = await db.select().from(studioTargets).where(eq(studioTargets.postId, id));
  const assets = await db.select().from(studioAssets).where(eq(studioAssets.postId, id));
  return { ...post, targets, assets };
}

export async function setStudioPostStatus(
  db: Db,
  id: string,
  status: string,
  extra: { error?: string | null; postedAt?: Date | null } = {},
) {
  await db
    .update(studioPosts)
    .set({
      status,
      ...(extra.error !== undefined ? { error: extra.error } : {}),
      ...(extra.postedAt !== undefined ? { postedAt: extra.postedAt } : {}),
    })
    .where(eq(studioPosts.id, id));
}

export async function setStudioTargetStatus(
  db: Db,
  id: string,
  status: string,
  extra: { remoteId?: string; error?: string | null } = {},
) {
  await db
    .update(studioTargets)
    .set({
      status,
      ...(extra.remoteId !== undefined ? { remoteId: extra.remoteId } : {}),
      ...(extra.error !== undefined ? { error: extra.error } : {}),
    })
    .where(eq(studioTargets.id, id));
}

export async function armStudioPosts(db: Db, productId: string, ids?: string[]) {
  const q = ids?.length
    ? and(eq(studioPosts.productId, productId), inArray(studioPosts.id, ids), eq(studioPosts.status, "draft"))
    : and(eq(studioPosts.productId, productId), eq(studioPosts.status, "draft"));
  const rows = await db.update(studioPosts).set({ status: "ready" }).where(q).returning();
  return rows.length;
}

export async function listDueStudioPosts(db: Db, now = new Date()) {
  const posts = await db
    .select()
    .from(studioPosts)
    .where(and(eq(studioPosts.status, "ready"), lte(studioPosts.scheduledAt, now)));
  const result = [];
  for (const post of posts) {
    const targets = await db.select().from(studioTargets).where(eq(studioTargets.postId, post.id));
    const assets = await db.select().from(studioAssets).where(eq(studioAssets.postId, post.id));
    const channels = await db
      .select()
      .from(studioChannels)
      .where(eq(studioChannels.productId, post.productId));
    result.push({ post, targets, assets, channels });
  }
  return result;
}

export async function createStudioAsset(
  db: Db,
  input: {
    productId: string;
    postId?: string;
    kind: string;
    filename: string;
    mime: string;
    bytesB64: string;
  },
) {
  const rows = await db
    .insert(studioAssets)
    .values({
      productId: input.productId,
      kind: input.kind,
      filename: input.filename,
      mime: input.mime,
      bytesB64: input.bytesB64,
      ...(input.postId ? { postId: input.postId } : {}),
    })
    .returning();
  return rows[0]!;
}

export async function getStudioAsset(db: Db, id: string) {
  const rows = await db.select().from(studioAssets).where(eq(studioAssets.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listStudioAssets(db: Db, productId: string) {
  return db
    .select()
    .from(studioAssets)
    .where(eq(studioAssets.productId, productId))
    .orderBy(desc(studioAssets.createdAt));
}

export async function attachStudioAsset(db: Db, assetId: string, postId: string) {
  await db.update(studioAssets).set({ postId }).where(eq(studioAssets.id, assetId));
}

export async function listStudioChannelsByProductIds(db: Db, productIds: string[]) {
  if (productIds.length === 0) return [];
  return db.select().from(studioChannels).where(inArray(studioChannels.productId, productIds));
}
