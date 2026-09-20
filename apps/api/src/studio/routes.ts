import type { Context, Hono } from "hono";
import { decryptToken, encryptToken } from "@amilo/google";
import {
  addStudioTargets,
  armStudioPosts,
  attachStudioAsset,
  createStudioAsset,
  createStudioPlan,
  createStudioPost,
  createStudioProduct,
  getStudioAsset,
  getStudioPost,
  getStudioProduct,
  listStudioAssets,
  listStudioChannels,
  listStudioChannelsByProductIds,
  listStudioPosts,
  listStudioProducts,
  setStudioPostStatus,
  upsertStudioChannel,
  type Db,
} from "@amilo/db";
import { parsePlan, zonedLocalToUtc, type StudioChannel } from "./parsePlan.js";
import { suggestStudioDrafts } from "./draft.js";
import { resolveLinkedInAuthor } from "./publish.js";
import { studioPageHtml } from "./ui.js";

const SECRET_KEEP = "••••";

type Deps = {
  db: Db;
  encryptionKey: string;
  publicBaseUrl: string;
  requireEmail: (c: Context) => Promise<string | null>;
  grok: { apiKey: string; model: string } | null;
};

function publicChannel(row: {
  kind: string;
  handle: string;
  enabled: boolean;
  credentialsEnc: string | null;
  meta: Record<string, unknown>;
}) {
  return {
    kind: row.kind,
    handle: row.handle,
    enabled: row.enabled,
    configured: Boolean(row.credentialsEnc),
    meta: row.meta,
  };
}

function publicAsset(row: { id: string; bytesB64?: string; [k: string]: unknown }) {
  const { bytesB64: _omit, ...rest } = row;
  return { ...rest, url: `/studio/api/public/assets/${row.id}` };
}

function assetBuffer(row: { bytesB64: string }): Buffer {
  return Buffer.from(row.bytesB64, "base64");
}

export function mountStudio(app: Hono, deps: Deps) {
  app.get("/studio", async (c) => {
    const email = await deps.requireEmail(c);
    if (!email) return c.redirect("/admin/login?next=/studio");
    return c.html(studioPageHtml());
  });
  app.get("/studio/", (c) => c.redirect("/studio"));
  app.get("/admin/studio", (c) => c.redirect("/studio"));

  app.get("/studio/api/public/assets/:id", async (c) => {
    const row = await getStudioAsset(deps.db, c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    return new Response(assetBuffer(row), {
      headers: {
        "Content-Type": row.mime,
        "Cache-Control": "public, max-age=86400",
      },
    });
  });

  const gate = async (c: Context, next: () => Promise<void>) => {
    const email = await deps.requireEmail(c);
    if (!email) {
      c.status(401);
      return c.json({ error: "unauthorized" });
    }
    await next();
  };

  app.use("/studio/api/*", async (c, next) => {
    if (c.req.path.startsWith("/studio/api/public/")) return next();
    return gate(c, next);
  });

  app.get("/studio/api/products", async (c) => {
    const products = await listStudioProducts(deps.db);
    const channels = await listStudioChannelsByProductIds(
      deps.db,
      products.map((p) => p.id),
    );
    return c.json({
      products: products.map((p) => ({
        ...p,
        channels: channels.filter((ch) => ch.productId === p.id).map(publicChannel),
      })),
    });
  });

  app.post("/studio/api/products", async (c) => {
    const body = await c.req.json<{
      slug?: string;
      name?: string;
      tagline?: string;
      timezone?: string;
    }>();
    const name = body.name?.trim();
    if (!name) return c.json({ error: "name required" }, 400);
    const slug =
      body.slug?.trim().toLowerCase().replace(/[^a-z0-9-]+/g, "-") ||
      name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    try {
      const product = await createStudioProduct(deps.db, {
        slug,
        name,
        ...(body.tagline ? { tagline: body.tagline.trim() } : {}),
        ...(body.timezone ? { timezone: body.timezone } : {}),
      });
      return c.json({ product });
    } catch (err) {
      return c.json({ error: err instanceof Error ? err.message : "could not create" }, 400);
    }
  });

  app.get("/studio/api/products/:id", async (c) => {
    const product = await getStudioProduct(deps.db, c.req.param("id"));
    if (!product) return c.json({ error: "not found" }, 404);
    const channels = await listStudioChannels(deps.db, product.id);
    return c.json({ product, channels: channels.map(publicChannel) });
  });

  app.put("/studio/api/products/:id/channels/:kind", async (c) => {
    const product = await getStudioProduct(deps.db, c.req.param("id"));
    if (!product) return c.json({ error: "not found" }, 404);
    const kind = c.req.param("kind");
    const body = await c.req.json<{
      handle?: string;
      enabled?: boolean;
      creds?: Record<string, string>;
    }>();
    const existing = (await listStudioChannels(deps.db, product.id)).find((ch) => ch.kind === kind);
    let creds: Record<string, string> = {};
    if (existing?.credentialsEnc) {
      try {
        creds = JSON.parse(decryptToken(deps.encryptionKey, existing.credentialsEnc)) as Record<
          string,
          string
        >;
      } catch {
        creds = {};
      }
    }
    if (body.creds) {
      for (const [k, v] of Object.entries(body.creds)) {
        if (v && v.trim() && v !== SECRET_KEEP) creds[k] = v.trim();
      }
    }
    const meta = { ...(existing?.meta ?? {}) };
    if (kind === "linkedin" && creds.accessToken && !creds.authorUrn && !meta.authorUrn) {
      try {
        creds.authorUrn = await resolveLinkedInAuthor(creds.accessToken);
        meta.authorUrn = creds.authorUrn;
      } catch (err) {
        return c.json(
          { error: err instanceof Error ? err.message : "LinkedIn URN failed" },
          400,
        );
      }
    }
    if (creds.authorUrn) meta.authorUrn = creds.authorUrn;
    const credentialsEnc =
      Object.keys(creds).length > 0 ? encryptToken(deps.encryptionKey, JSON.stringify(creds)) : existing?.credentialsEnc;
    const row = await upsertStudioChannel(deps.db, {
      productId: product.id,
      kind,
      handle: body.handle?.trim() ?? existing?.handle ?? "",
      ...(credentialsEnc ? { credentialsEnc } : {}),
      meta,
      ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
    });
    return c.json({ channel: publicChannel(row) });
  });

  app.get("/studio/api/products/:id/posts", async (c) => {
    const posts = await listStudioPosts(deps.db, c.req.param("id"));
    return c.json({
      posts: posts.map((p) => ({
        ...p,
        assets: p.assets.map(publicAsset),
      })),
    });
  });

  app.post("/studio/api/parse", async (c) => {
    const body = await c.req.json<{ raw?: string }>();
    const items = parsePlan(body.raw ?? "");
    return c.json({ items, count: items.length });
  });

  app.post("/studio/api/products/:id/drafts", async (c) => {
    const product = await getStudioProduct(deps.db, c.req.param("id"));
    if (!product) return c.json({ error: "not found" }, 404);
    if (!deps.grok) return c.json({ error: "Drafts need XAI_API_KEY on the API" }, 503);
    const body = await c.req.json<{ idea?: string }>();
    const idea = body.idea?.trim() ?? "";
    if (!idea) return c.json({ error: "Describe the idea first" }, 400);
    try {
      const options = await suggestStudioDrafts({
        apiKey: deps.grok.apiKey,
        model: deps.grok.model,
        idea,
        productName: product.name,
        ...(product.tagline ? { tagline: product.tagline } : {}),
      });
      return c.json({ options, hook: options[0]?.hook ?? "" });
    } catch (err) {
      return c.json(
        { error: err instanceof Error ? err.message : "could not draft" },
        400,
      );
    }
  });

  app.post("/studio/api/products/:id/plans", async (c) => {
    const product = await getStudioProduct(deps.db, c.req.param("id"));
    if (!product) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{ title?: string; rawText?: string; arm?: boolean }>();
    const rawText = body.rawText?.trim() ?? "";
    const items = parsePlan(rawText);
    if (items.length === 0) return c.json({ error: "No posts found in that plan." }, 400);
    const plan = await createStudioPlan(deps.db, {
      productId: product.id,
      title: body.title?.trim() || `Plan ${new Date().toISOString().slice(0, 10)}`,
      rawText,
    });
    const status = body.arm ? "ready" : "draft";
    const created = [];
    for (const item of items) {
      const scheduledAt = zonedLocalToUtc(item.date, item.time, product.timezone);
      const post = await createStudioPost(deps.db, {
        productId: product.id,
        planId: plan.id,
        source: "plan",
        hook: item.hook,
        scheduledAt,
        status,
      });
      const targets = (Object.entries(item.copy) as Array<[StudioChannel, string | undefined]>)
        .filter((e): e is [StudioChannel, string] => Boolean(e[1]))
        .map(([channelKind, copy]) => ({ channelKind, copy }));
      await addStudioTargets(deps.db, post.id, targets);
      created.push(post.id);
    }
    return c.json({ planId: plan.id, posts: created.length, status });
  });

  app.post("/studio/api/products/:id/posts", async (c) => {
    const product = await getStudioProduct(deps.db, c.req.param("id"));
    if (!product) return c.json({ error: "not found" }, 404);
    const body = await c.req.json<{
      hook?: string;
      copy?: Record<string, string>;
      scheduledAt?: string;
      postNow?: boolean;
      assetIds?: string[];
      mockup?: Record<string, unknown>;
    }>();
    const copy = body.copy ?? {};
    const targets = Object.entries(copy)
      .filter(([, v]) => v?.trim())
      .map(([channelKind, text]) => ({ channelKind, copy: text.trim() }));
    if (targets.length === 0) return c.json({ error: "Need copy for at least one channel" }, 400);
    const scheduledAt = body.postNow
      ? new Date()
      : body.scheduledAt
        ? new Date(body.scheduledAt)
        : new Date();
    const post = await createStudioPost(deps.db, {
      productId: product.id,
      source: "adhoc",
      hook: body.hook?.trim() || targets[0]!.copy.slice(0, 80),
      scheduledAt,
      status: "ready",
      ...(body.mockup ? { mockup: body.mockup } : {}),
    });
    await addStudioTargets(deps.db, post.id, targets);
    for (const assetId of body.assetIds ?? []) {
      await attachStudioAsset(deps.db, assetId, post.id);
    }
    return c.json({ postId: post.id, scheduledAt: scheduledAt.toISOString() });
  });

  app.post("/studio/api/products/:id/arm", async (c) => {
    const body = await c.req.json<{ ids?: string[] }>().catch(() => ({ ids: undefined }));
    const n = await armStudioPosts(deps.db, c.req.param("id"), body.ids);
    return c.json({ armed: n });
  });

  app.post("/studio/api/posts/:id/pause", async (c) => {
    const post = await getStudioPost(deps.db, c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    await setStudioPostStatus(deps.db, post.id, "paused");
    return c.json({ ok: true });
  });

  app.post("/studio/api/posts/:id/retry", async (c) => {
    const post = await getStudioPost(deps.db, c.req.param("id"));
    if (!post) return c.json({ error: "not found" }, 404);
    await setStudioPostStatus(deps.db, post.id, "ready", { error: null });
    return c.json({ ok: true });
  });

  app.get("/studio/api/products/:id/assets", async (c) => {
    const assets = await listStudioAssets(deps.db, c.req.param("id"));
    return c.json({ assets: assets.map(publicAsset) });
  });

  app.post("/studio/api/products/:id/assets", async (c) => {
    const product = await getStudioProduct(deps.db, c.req.param("id"));
    if (!product) return c.json({ error: "not found" }, 404);
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "file required" }, 400);
    if (file.size > 8 * 1024 * 1024) return c.json({ error: "max 8MB" }, 400);
    const mime = file.type || "application/octet-stream";
    if (!mime.startsWith("image/")) return c.json({ error: "images only" }, 400);
    const buf = Buffer.from(await file.arrayBuffer());
    const kind = typeof body.kind === "string" ? body.kind : "upload";
    const postId = typeof body.postId === "string" ? body.postId : undefined;
    const row = await createStudioAsset(deps.db, {
      productId: product.id,
      kind,
      filename: file.name || "image.png",
      mime,
      bytesB64: buf.toString("base64"),
      ...(postId ? { postId } : {}),
    });
    return c.json({ asset: publicAsset(row) });
  });

  app.get("/studio/api/assets/:id", async (c) => {
    const row = await getStudioAsset(deps.db, c.req.param("id"));
    if (!row) return c.json({ error: "not found" }, 404);
    return new Response(assetBuffer(row), { headers: { "Content-Type": row.mime } });
  });
}
