import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { sql } from "drizzle-orm";
import { createCursorBrain, createStubBrain } from "@amilo/brain-cursor";
import { createGrokBrain } from "@amilo/brain-grok";
import type { BrainPort } from "@amilo/brain-contract";
import {
  createWhatsAppChannel,
  isPhoneAllowed,
  parseWhatsAppWebhook,
  verifyWebhookSignature,
  type WindowStore,
} from "@amilo/channels-whatsapp";
import { handleInbound, type InboundMessage, type OrchestratorDeps } from "@amilo/core";
import {
  applyGraphUpdates,
  claimWebhookMessage,
  createDb,
  getUserById,
  getWhatsAppAddress,
  getWhatsAppLastInbound,
  logMessage,
  setCursorAgentId,
  setUserStatus,
  summarizeContextGraph,
  touchWhatsAppInbound,
  upsertWhatsAppUser,
  type Db,
} from "@amilo/db";
import { loadSettings, resolveBrainLabel } from "./config.js";

loadEnv();

const settings = loadSettings();
const app = new Hono();
const db: Db = createDb(settings.databaseUrl);
const brainLabel = resolveBrainLabel(settings);

function createBrain(): BrainPort {
  if (settings.xaiApiKey) {
    return createGrokBrain({
      apiKey: settings.xaiApiKey,
      model: settings.grokModel,
    });
  }
  if (settings.cursorApiKey) {
    return createCursorBrain({
      apiKey: settings.cursorApiKey,
      model: settings.cursorModel,
      repoUrl: settings.cursorBrainRepo,
      startingRef: settings.cursorBrainRef,
      agentStore: {
        get: async (userId) => {
          const u = await getUserById(db, userId);
          return u?.cursorAgentId ?? null;
        },
        set: async (userId, id) => {
          await setCursorAgentId(db, userId, id);
        },
      },
    });
  }
  return createStubBrain();
}

const brain = createBrain();

const windows: WindowStore = {
  getLastInbound: (waId) => getWhatsAppLastInbound(db, waId),
  setLastInbound: (waId, at) => touchWhatsAppInbound(db, waId, at),
};

const waChannel = createWhatsAppChannel({
  cfg: {
    accessToken: settings.wabaAccessToken,
    phoneNumberId: settings.wabaPhoneNumberId,
    appSecret: settings.wabaAppSecret,
  },
  windows,
  resolveAddress: async (userId) => {
    const addr = await getWhatsAppAddress(db, userId);
    if (!addr) throw new Error(`no whatsapp channel for user ${userId}`);
    return addr;
  },
});

function orchestratorDeps(): OrchestratorDeps {
  return {
    brain,
    channel: waChannel,
    resolveUserName: async (id) => {
      const u = await getUserById(db, id);
      return u?.name ?? "there";
    },
    isPaused: async (id) => {
      const u = await getUserById(db, id);
      return u?.status === "paused";
    },
    setPaused: async (id, p) => {
      await setUserStatus(db, id, p ? "paused" : "active");
    },
    getContextGraphSummary: (id) => summarizeContextGraph(db, id),
    applyGraphUpdates: async (opts) => {
      await applyGraphUpdates(db, {
        userId: opts.userId,
        userName: opts.userName,
        claim: opts.message,
        updates: opts.updates,
        ...(opts.sourceMessageId ? { sourceMessageId: opts.sourceMessageId } : {}),
      });
    },
  };
}

async function processInbound(rawJson: unknown): Promise<void> {
  const messages = parseWhatsAppWebhook(rawJson);
  for (const parsed of messages) {
    const claimed = await claimWebhookMessage(db, parsed.messageId);
    if (!claimed) {
      console.log(JSON.stringify({ event: "wa_dup_skip", id: parsed.messageId }));
      continue;
    }

    if (!isPhoneAllowed(parsed.waId, settings.allowedPhones)) {
      console.log(
        JSON.stringify({
          event: "wa_ignored_not_allowlisted",
          waId: parsed.waId.slice(0, 4) + "…",
        }),
      );
      continue;
    }

    const user = await upsertWhatsAppUser(db, {
      phoneE164: parsed.phoneE164,
      waId: parsed.waId,
      ...(parsed.profileName ? { profileName: parsed.profileName } : {}),
    });
    await touchWhatsAppInbound(db, parsed.waId, parsed.timestamp);

    await logMessage(db, {
      userId: user.id,
      channel: "whatsapp",
      direction: "in",
      kind: parsed.kind,
      bodyRef: parsed.content.slice(0, 500),
      meta: { waMessageId: parsed.messageId },
    });

    if (parsed.kind === "voice") {
      const text = "Voice notes land in a later milestone — send text for now, or help.";
      await waChannel.send(user.id, { text });
      await logMessage(db, {
        userId: user.id,
        channel: "whatsapp",
        direction: "out",
        kind: "text",
        bodyRef: text,
      });
      continue;
    }

    const inbound: InboundMessage = {
      userId: user.id,
      channel: "whatsapp",
      kind: parsed.kind,
      content: parsed.content,
      messageId: parsed.messageId,
      ts: parsed.timestamp,
      ...(parsed.mediaId ? { mediaRef: parsed.mediaId } : {}),
    };

    console.log(
      JSON.stringify({
        event: "wa_inbound",
        userId: user.id,
        phone: parsed.phoneE164,
        kind: parsed.kind,
        chars: parsed.content.length,
        brain: brainLabel,
      }),
    );

    try {
      const outbound = await handleInbound(inbound, orchestratorDeps());

      for (const msg of outbound) {
        await waChannel.send(user.id, msg);
        await logMessage(db, {
          userId: user.id,
          channel: "whatsapp",
          direction: "out",
          kind: "templateName" in msg ? "template" : "text",
          bodyRef: "templateName" in msg ? msg.templateName : msg.text.slice(0, 500),
          meta: "templateName" in msg ? { template: msg.templateName } : {},
        });
      }
      console.log(
        JSON.stringify({
          event: "wa_outbound",
          userId: user.id,
          count: outbound.length,
        }),
      );
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      console.error(JSON.stringify({ event: "wa_process_error", error: errMsg }));
      try {
        const text =
          /permission-denied|credits or licenses/i.test(errMsg)
            ? "Grok API has no credits on this xAI team — add billing at console.x.ai, then try again."
            : "Something went wrong on my side — try again in a moment.";
        await waChannel.send(user.id, { text });
        await logMessage(db, {
          userId: user.id,
          channel: "whatsapp",
          direction: "out",
          kind: "text",
          bodyRef: text,
        });
      } catch {
        /* already logged */
      }
    }
  }
}

app.get("/health", async (c) => {
  let dbOk = false;
  try {
    await db.execute(sql`select 1`);
    dbOk = true;
  } catch {
    dbOk = false;
  }
  return c.json({
    ok: true,
    service: "amilo",
    brain: brainLabel,
    db: dbOk ? "up" : "down",
    milestone: "M3",
  });
});

app.get("/webhooks/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && token === settings.wabaVerifyToken && challenge) {
    return c.text(challenge);
  }
  return c.text("Forbidden", 403);
});

app.post("/webhooks/whatsapp", async (c) => {
  const raw = Buffer.from(await c.req.arrayBuffer());
  if (settings.wabaAppSecret) {
    const sig = c.req.header("x-hub-signature-256");
    if (!verifyWebhookSignature(settings.wabaAppSecret, raw, sig)) {
      console.error(JSON.stringify({ event: "wa_bad_signature" }));
      return c.json({ error: "invalid signature" }, 401);
    }
  }

  let json: unknown = {};
  try {
    json = JSON.parse(raw.toString("utf8"));
  } catch {
    return c.json({ error: "invalid json" }, 400);
  }

  try {
    await processInbound(json);
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "wa_async_error",
        error: err instanceof Error ? err.message : String(err),
      }),
    );
  }

  return c.json({ received: true });
});

app.post("/dev/chat", async (c) => {
  if (settings.nodeEnv === "production") {
    return c.json({ error: "disabled in production" }, 404);
  }
  const body = await c.req.json<{ phone?: string; text?: string; name?: string }>();
  const phone = body.phone ?? settings.allowedPhones[0] ?? "+910000000000";
  const waId = phone.replace(/\D/g, "");
  const user = await upsertWhatsAppUser(db, {
    phoneE164: phone.startsWith("+") ? phone : `+${waId}`,
    waId,
    ...(body.name ? { profileName: body.name } : {}),
  });
  const deps = orchestratorDeps();
  const outbound = await handleInbound(
    {
      userId: user.id,
      channel: "web",
      kind: "text",
      content: body.text ?? "",
      ts: new Date(),
    },
    {
      ...deps,
      channel: {
        async send() {
          /* no-op */
        },
      },
      resolveUserName: async () => body.name ?? user.name ?? "Sameep",
    },
  );
  return c.json({ userId: user.id, brain: brainLabel, outbound });
});

const port = settings.port;
serve({ fetch: app.fetch, port, createServer }, (info) => {
  console.log(
    `Amilo API listening on :${info.port} (brain=${brainLabel}, milestone=M3)`,
  );
});
