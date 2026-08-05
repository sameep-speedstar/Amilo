import { createServer } from "node:http";
import { config as loadEnv } from "dotenv";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createCursorBrain, createStubBrain } from "@amilo/brain-cursor";
import {
  createWhatsAppChannel,
  isPhoneAllowed,
  parseWhatsAppWebhook,
  toInboundMessage,
  verifyWebhookSignature,
  type WindowStore,
} from "@amilo/channels-whatsapp";
import { handleInbound } from "@amilo/core";
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

/** In-memory pause + 24h window until DB wiring in M2. */
const paused = new Set<string>();
const lastInboundByWa = new Map<string, Date>();
const processedMessageIds = new Map<string, number>();
const PROFILE_NAMES = new Map<string, string>();

const windows: WindowStore = {
  getLastInbound: async (waId) => lastInboundByWa.get(waId) ?? null,
  setLastInbound: async (waId, at) => {
    lastInboundByWa.set(waId, at);
  },
};

/** userId is E.164 (+digits); Graph send wants digits only. */
function waDigitsFromUserId(userId: string): string {
  return userId.replace(/\D/g, "");
}

const waChannel = createWhatsAppChannel({
  cfg: {
    accessToken: settings.wabaAccessToken,
    phoneNumberId: settings.wabaPhoneNumberId,
    appSecret: settings.wabaAppSecret,
  },
  windows,
  resolveAddress: async (userId) => waDigitsFromUserId(userId),
});

function rememberMessageId(id: string): boolean {
  const now = Date.now();
  if (processedMessageIds.has(id)) return false;
  processedMessageIds.set(id, now);
  if (processedMessageIds.size > 2000) {
    for (const [k, ts] of processedMessageIds) {
      if (now - ts > 24 * 60 * 60 * 1000) processedMessageIds.delete(k);
    }
  }
  return true;
}

async function processInbound(rawJson: unknown): Promise<void> {
  const messages = parseWhatsAppWebhook(rawJson);
  for (const parsed of messages) {
    if (!rememberMessageId(parsed.messageId)) {
      console.log(JSON.stringify({ event: "wa_dup_skip", id: parsed.messageId }));
      continue;
    }

    await windows.setLastInbound(parsed.waId, parsed.timestamp);
    if (parsed.profileName) {
      PROFILE_NAMES.set(parsed.phoneE164, parsed.profileName);
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

    if (parsed.kind === "voice") {
      await waChannel.send(parsed.phoneE164, {
        text: "Voice notes land in a later milestone — send text for now, or help.",
      });
      continue;
    }

    const inbound = toInboundMessage(parsed);
    console.log(
      JSON.stringify({
        event: "wa_inbound",
        userId: parsed.phoneE164,
        kind: parsed.kind,
        chars: parsed.content.length,
      }),
    );

    try {
      const outbound = await handleInbound(inbound, {
        brain,
        channel: waChannel,
        resolveUserName: async (userId) => PROFILE_NAMES.get(userId) ?? "there",
        isPaused: async (userId) => paused.has(userId),
        setPaused: async (userId, p) => {
          if (p) paused.add(userId);
          else paused.delete(userId);
        },
      });

      for (const msg of outbound) {
        await waChannel.send(parsed.phoneE164, msg);
      }
      console.log(
        JSON.stringify({
          event: "wa_outbound",
          userId: parsed.phoneE164,
          count: outbound.length,
        }),
      );
    } catch (err) {
      console.error(
        JSON.stringify({
          event: "wa_process_error",
          error: err instanceof Error ? err.message : String(err),
        }),
      );
      try {
        await waChannel.send(parsed.phoneE164, {
          text: "Something went wrong on my side — try again in a moment.",
        });
      } catch {
        /* already logged */
      }
    }
  }
}

app.get("/health", (c) =>
  c.json({
    ok: true,
    service: "amilo",
    brain: settings.cursorApiKey ? "cursor-cloud" : "stub",
    milestone: "M1",
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
 * Inbound webhook — verify signature, ACK immediately, process async.
 * Meta retries on non-2xx; never block the handshake on LLM/send.
 */
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

/** Local/dev chat harness (not WhatsApp) — exercises orchestrator + brain. */
app.post("/dev/chat", async (c) => {
  if (settings.nodeEnv === "production") {
    return c.json({ error: "disabled in production" }, 404);
  }
  const body = await c.req.json<{ userId?: string; text?: string; name?: string }>();
  const userId = body.userId ?? "dev-user";
  const text = body.text ?? "";
  const outbound = await handleInbound(
    {
      userId,
      channel: "web",
      kind: "text",
      content: text,
      ts: new Date(),
    },
    {
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
    },
  );
  return c.json({ outbound });
});

const port = settings.port;
serve({ fetch: app.fetch, port, createServer }, (info) => {
  console.log(
    `Amilo API listening on :${info.port} (brain=${settings.cursorApiKey ? "cursor" : "stub"}, milestone=M1)`,
  );
});
