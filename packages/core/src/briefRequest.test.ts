import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { isBriefRequest } from "./orchestrator.js";

describe("isBriefRequest", () => {
  it("matches exact and natural briefing phrases", () => {
    for (const t of [
      "brief",
      "Brief",
      "morning",
      "evening",
      "latest brief please",
      "send me the brief",
      "give me a briefing",
      "morning update",
      "evening wrap",
      "today's brief",
      "my briefing",
      "brief please",
      "pull latest brief",
      "summarize my emails",
      "summarize mail",
    ]) {
      assert.equal(isBriefRequest(t), true, t);
    }
  });

  it("does not steal unrelated chat", () => {
    for (const t of [
      "briefly explain the IVF plan",
      "briefs on",
      "briefs off",
      "mute briefs",
      "can you book a meeting",
      "yes",
      "",
    ]) {
      assert.equal(isBriefRequest(t), false, t);
    }
  });
});
