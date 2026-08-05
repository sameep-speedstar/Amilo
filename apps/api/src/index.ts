import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createCursorBrain, createStubBrain } from "@amilo/brain-cursor";
import { verifyWebhookSignature } from "@amilo/channels-whatsapp";
import { handleInbound, type InboundMessage } from "@amilo/core";
import { loadSettings } from "./config.js";

loadEnv(); // local .env; Azure injects app settings instead

const settings = loadSettings();
const app = new Hono();

const agentMemory = new Map<string, string>();
const brain = settings.cursorApiKey
  ? createCursorBrain({
      apiKey: settings.cursorApiKey,
      model: settings.cursorModel,
      repoUrl: settings.cursorBrainRepo,
      startingRef: settings.cursorBrainRef,
      agentStore: {
        get: async (userId) => agentMemory.get(userId) ?? null,
        set: async (userId, id) => {
          agentMemory.set(userId, id);
        },
      },
    })
  : createStubBrain();

/** In-memory pause flags until DB wiring in M2. */
const paused = new Set<string>();

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "amilo",
    brain: settings.cursorApiKey ? "cursor-cloud" : "stub",
    milestone: "M0",
  }),
);

/** Meta webhook verification challenge. */
app.get("/webhooks/whatsapp", (c) => {
  const mode = c.req.query("hub.mode");
  const token = c.req.query("hub.verify_token");
  const challenge = c.req.query("hub.challenge");
  if (mode === "subscribe" && token === settings.wabaVerifyToken && challenge) {
    return c.text(challenge);
  }
  return c.text("Forbidden", 403);
});

/**
 * Inbound webhook — M0 verifies signature + ACKs.
 * Full normalize → orchestrator → send lands in M1.
 */
app.post("/webhooks/whatsapp", async (c) => {
  const raw = Buffer.from(await c.req.arrayBuffer());
  if (settings.wabaAppSecret) {
    const sig = c.req.header("x-hub-signature-256");
    if (!verifyWebhookSignature(settings.wabaAppSecret, raw, sig)) {
      return c.json({ error: "invalid signature" }, 401);
    }
  }
  // Always 200 quickly — Meta retries on non-2xx.
  return c.json({ received: true });
});

/** Local/dev chat harness (not WhatsApp) — exercises orchestrator + brain. */
app.post("/dev/chat", async (c) => {
  if (settings.nodeEnv === "production") {
    return c.json({ error: "disabled in production" }, 404);
  }
  const body = await c.req.json<{ userId?: string; text?: string; name?: string }>();
  const userId = body.userId ?? "dev-user";
  const text = body.text ?? "";
  const msg: InboundMessage = {
    userId,
    channel: "web",
    kind: "text",
    content: text,
    ts: new Date(),
  };
  const outbound = await handleInbound(msg, {
    brain,
    channel: {
      async send() {
        /* no-op for dev */
      },
    },
    resolveUserName: async () => body.name ?? "Sameep",
    isPaused: async (id) => paused.has(id),
    setPaused: async (id, p) => {
      if (p) paused.add(id);
      else paused.delete(id);
    },
  });
  return c.json({ outbound });
});

const port = settings.port;
serve({ fetch: app.fetch, port, createServer }, (info) => {
  console.log(`Amilo API listening on :${info.port} (brain=${settings.cursorApiKey ? "cursor" : "stub"})`);
});
