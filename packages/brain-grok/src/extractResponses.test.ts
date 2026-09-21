import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  extractJson,
  extractResponsesText,
  interpretFromModelText,
  isLegacyStubReply,
  isLiveResearchAsk,
  researchWebSearchDomains,
  sanitizeRecentChat,
} from "./index.js";

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

describe("extractJson / interpretFromModelText", () => {
  it("skips web_search citation prefixes before intent JSON", () => {
    const raw = `[1,2] Sources about Bengaluru films
{"intent":{"type":"reply_text","text":"1. VIBE 2. Saiyaara"},"graphUpdates":[]}`;
    const parsed = extractJson<{ intent: { type: string; text: string } }>(raw);
    assert.equal(parsed.intent.type, "reply_text");
    assert.match(parsed.intent.text, /VIBE/);
  });

  it("handles [1] citation then intent object", () => {
    const raw = `[1] https://bookmyshow.com
{"intent":{"type":"reply_text","text":"Saiyaara near Arekere"},"graphUpdates":[]}`;
    const parsed = extractJson<{ intent: { text: string } }>(raw);
    assert.match(parsed.intent.text, /Saiyaara/);
  });

  it("does not treat [[1]] footnotes as the brain payload", () => {
    const prose = `**Hindi movies this week:**
- **Mirzapur: The Movie** at PVR.[[1]](https://timesofindia.indiatimes.com/x)
- **Toxic** at INOX.[[1]](https://example.com)
Want showtimes near Arekere?`;
    assert.throws(() => extractJson(prose));
    const r = interpretFromModelText(prose);
    assert.equal(r.intent.type, "reply_text");
    if (r.intent.type === "reply_text") {
      assert.match(r.intent.text, /Mirzapur/);
      assert.notEqual(r.intent.text, "Got it.");
    }
  });

  it("falls back to prose as reply_text", () => {
    const r = interpretFromModelText(
      "Near L&T South City: 1. URU Brewpark 2. The Pump House. Want timings?",
    );
    assert.equal(r.intent.type, "reply_text");
    if (r.intent.type === "reply_text") {
      assert.match(r.intent.text, /URU Brewpark/);
    }
  });
});

describe("isLiveResearchAsk", () => {
  it("detects movie research", () => {
    assert.equal(isLiveResearchAsk("which Hindi movie is running this week"), true);
    assert.equal(
      isLiveResearchAsk("Book two tickets for Mirzapur today in Ilante Chandigarh Mall"),
      true,
    );
    assert.equal(isLiveResearchAsk("Book 2 tickets for VIBE"), true);
    assert.equal(isLiveResearchAsk("Book Katani Dhaba Fri 8pm"), false);
  });

  it("detects dining research including client dinner", () => {
    assert.equal(
      isLiveResearchAsk("Have to take my client for a dinner near MG road, suggest options"),
      true,
    );
    assert.equal(
      isLiveResearchAsk("suggest good dinner options near Sector 35 Chandigarh"),
      true,
    );
  });

  it("detects show-for research and movie domain allow-list", () => {
    assert.equal(isLiveResearchAsk("Find shows for VIBE in PVR Vega City"), true);
    const domains = researchWebSearchDomains("Find shows for VIBE in PVR Vega City");
    assert.ok(domains);
    assert.ok(domains!.includes("bookmyshow.com"));
    assert.ok(domains!.length <= 5);
    const dining = researchWebSearchDomains("client dinner near MG Road");
    assert.ok(dining);
    assert.ok(dining!.every((d) => !/zomato|eazydiner/i.test(d)));
  });

  it("auto-searches NSE IPO / gilt / follow-ups (screenshot failures)", () => {
    assert.equal(
      isLiveResearchAsk("How much NSE IPO is subscribed as of yesterday?"),
      true,
    );
    assert.equal(
      isLiveResearchAsk("UK 30 year yield declined last week, read about it for reasons.", {
        hasImage: true,
      }),
      true,
    );
    assert.equal(
      isLiveResearchAsk("Share more details", {
        recentChat: "Amilo: UK 30Y gilt yield fell…",
        hasImage: true,
      }),
      true,
    );
    assert.equal(
      isLiveResearchAsk("What are the reasons?", {
        recentChat: "UK 30Y yield declined",
      }),
      true,
    );
    assert.equal(isLiveResearchAsk("web search and check", {
      recentChat: "How much NSE IPO is subscribed as of yesterday?",
    }), true);
  });
});

describe("sanitizeRecentChat / isLegacyStubReply", () => {
  it("strips BMS explore stub lines from recent chat", () => {
    const stub =
      "Amilo: Hindi movies · Bengaluru Open BookMyShow for what's playing (live list): https://in.bookmyshow.com/explore/movies-bengaluru";
    assert.equal(isLegacyStubReply(stub), true);
    const cleaned = sanitizeRecentChat(`User: which Hindi movie\n${stub}\nUser: shows near me`);
    assert.ok(cleaned);
    assert.doesNotMatch(cleaned!, /Open BookMyShow for what's playing/);
    assert.match(cleaned!, /which Hindi movie/);
  });
});
