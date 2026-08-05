import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isInside24hWindow,
  isPhoneAllowed,
  parseWhatsAppWebhook,
  toInboundMessage,
} from "@amilo/channels-whatsapp";
import { handleInbound } from "@amilo/core";
import { createStubBrain } from "@amilo/brain-cursor";

describe("24h window", () => {
  it("rejects null last inbound", () => {
    assert.equal(isInside24hWindow(null), false);
  });
  it("accepts recent inbound", () => {
    assert.equal(isInside24hWindow(new Date()), true);
  });
  it("rejects older than 24h", () => {
    const old = new Date(Date.now() - 25 * 60 * 60 * 1000);
    assert.equal(isInside24hWindow(old), false);
  });
});

describe("allowlist", () => {
  it("matches E.164 against WA digits", () => {
    assert.equal(isPhoneAllowed("919876543210", ["+919876543210"]), true);
    assert.equal(isPhoneAllowed("919876543210", ["+911111111111"]), false);
  });
});

describe("webhook parse", () => {
  it("extracts text messages", () => {
    const parsed = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ wa_id: "919876543210", profile: { name: "Sameep" } }],
                messages: [
                  {
                    from: "919876543210",
                    id: "wamid.1",
                    timestamp: "1754395200",
                    type: "text",
                    text: { body: "help" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    assert.equal(parsed.length, 1);
    assert.equal(parsed[0]?.content, "help");
    assert.equal(parsed[0]?.phoneE164, "+919876543210");
    const inbound = toInboundMessage(parsed[0]!);
    assert.equal(inbound.channel, "whatsapp");
    assert.equal(inbound.userId, "+919876543210");
  });

  it("ignores status-only payloads", () => {
    const parsed = parseWhatsAppWebhook({
      object: "whatsapp_business_account",
      entry: [{ changes: [{ field: "messages", value: { statuses: [{ id: "1" }] } }] }],
    });
    assert.equal(parsed.length, 0);
  });
});

describe("orchestrator standing commands", () => {
  it("answers help without brain", async () => {
    const brain = createStubBrain();
    let brainCalled = false;
    const wrapped = {
      ...brain,
      interpret: async () => {
        brainCalled = true;
        return { intent: { type: "noop" as const } };
      },
    };
    const out = await handleInbound(
      {
        userId: "u1",
        channel: "whatsapp",
        kind: "text",
        content: "help",
        ts: new Date(),
      },
      {
        brain: wrapped,
        channel: { async send() {} },
        resolveUserName: async () => "Sameep",
        isPaused: async () => false,
        setPaused: async () => {},
      },
    );
    assert.equal(brainCalled, false);
    assert.ok(out[0] && "text" in out[0] && out[0].text.includes("Commands"));
  });
});
