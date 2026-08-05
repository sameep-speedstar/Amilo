import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isInside24hWindow } from "@amilo/channels-whatsapp";
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
