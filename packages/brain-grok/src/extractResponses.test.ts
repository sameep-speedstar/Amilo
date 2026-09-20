import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { extractResponsesText } from "./index.js";

describe("extractResponsesText", () => {
  it("reads output_text convenience field", () => {
    assert.equal(
      extractResponsesText({ output_text: "  hello  ", output: [] }),
      "hello",
    );
  });

  it("reads message content parts", () => {
    const text = extractResponsesText({
      output: [
        {
          type: "message",
          content: [
            { type: "output_text", text: '{"intent":{"type":"reply_text","text":"Hi"}}' },
          ],
        },
      ],
    });
    assert.match(text, /reply_text/);
  });
});

describe("isLiveResearchAsk", () => {
  it("detects movie research", async () => {
    const { isLiveResearchAsk } = await import("./index.js");
    assert.equal(isLiveResearchAsk("which Hindi movie is running this week"), true);
    assert.equal(isLiveResearchAsk("Book 2 tickets for VIBE"), false);
  });
});

describe("sanitizeRecentChat / isLegacyStubReply", () => {
  it("strips BMS explore stub lines from recent chat", async () => {
    const { sanitizeRecentChat, isLegacyStubReply } = await import("./index.js");
    const stub =
      "Amilo: Hindi movies · Bengaluru Open BookMyShow for what's playing (live list): https://in.bookmyshow.com/explore/movies-bengaluru";
    assert.equal(isLegacyStubReply(stub), true);
    const cleaned = sanitizeRecentChat(`User: which Hindi movie\n${stub}\nUser: shows near me`);
    assert.ok(cleaned);
    assert.doesNotMatch(cleaned!, /Open BookMyShow for what's playing/);
    assert.match(cleaned!, /which Hindi movie/);
  });
});
