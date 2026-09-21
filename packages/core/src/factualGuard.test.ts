import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  annotateStaleOrWeekendAsOf,
  enforceInstrumentLock,
  extractInstrumentHint,
  fixComparativeConsistency,
  outboundTextsFromReply,
  sanitizeFactualReplyText,
  scrubFactualFiller,
  splitWhatsAppText,
} from "./factualGuard.js";

/** Fixtures = recorded model drafts (as if after search), not live retrieval. */
const FIXTURE_NSE_STALE = [
  "*NSE IPO (National Stock Exchange of India) subscription as of yesterday (20 Sep 2026):* ~1.16x overall.",
  "QIB 1.53x · NII 1.68x · Retail 0.72x.",
  "No other major NSE IPOs reported for that date.",
].join("\n");

const FIXTURE_UK30_WRONG_TENOR =
  "UK 10y gilt yield fell ~25 bps last week on: 1) BoE dovish tilt after softer CPI, 2) flight-to-safety, 3) LDI buying. CPI 3.8% vs 4.0% exp.";

const FIXTURE_EMA_CONTRADICTION =
  "UK 30Y gilt yield fell 16.4 bp last week to 5.750% (now below EMA20 at 5.674%). RSI 55.33.";

describe("factualGuard — screenshot regressions (fixture drafts)", () => {
  it("S1: strips unsolicited IPO filler; weekend yesterday gets a note", () => {
    // Mon 21 Sep 2026 IST → yesterday Sun
    const monday = new Date("2026-09-21T08:00:00+05:30");
    const out = sanitizeFactualReplyText(FIXTURE_NSE_STALE, {
      userText: "How much NSE IPO is subscribed as of yesterday?",
      now: monday,
      timeZone: "Asia/Kolkata",
    });
    assert.doesNotMatch(out, /No other major NSE IPOs reported/i);
    assert.match(out, /weekend|Fri|last bidding|no .*bidding/i);
  });

  it("S3: locks UK 30Y when chart/caption says 30-year (not 10Y)", () => {
    const hint = extractInstrumentHint(
      "UK 30 year yield declined last week, read about it for reasons.\nUnited Kingdom 30 Year Government Bonds Yield",
    );
    assert.match(hint ?? "", /30Y/i);
    const out = enforceInstrumentLock(FIXTURE_UK30_WRONG_TENOR, hint);
    assert.match(out, /UK 30Y/i);
    assert.doesNotMatch(out, /UK 10y|UK 10Y|10y gilt/i);
  });

  it("S2: fixes EMA above/below contradiction", () => {
    const out = fixComparativeConsistency(FIXTURE_EMA_CONTRADICTION);
    assert.match(out, /5\.750%.*above.*5\.674%/i);
    assert.doesNotMatch(out, /5\.750%.*below.*5\.674%/i);
  });

  it("scrubFactualFiller alone drops no-other-IPO line", () => {
    assert.doesNotMatch(scrubFactualFiller(FIXTURE_NSE_STALE), /No other major NSE IPOs/i);
  });

  it("splits long replies into multiple WA messages without truncating", () => {
    const long = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} with some detail about yields and IPOs.`).join(
      " ",
    );
    const parts = splitWhatsAppText(long, 200);
    assert.ok(parts.length >= 2);
    assert.equal(parts.join(" ").replace(/\s+/g, " "), long.replace(/\s+/g, " "));
    for (const p of parts) assert.ok(p.length <= 220);
    const outbound = outboundTextsFromReply(long, 200);
    assert.equal(outbound.length, parts.length);
  });

  it("weekend annotate is a no-op when reply already explains as-of", () => {
    const monday = new Date("2026-09-21T08:00:00+05:30");
    const already =
      "NSE IPO ~1.04x overall. Latest data is from Fri 18 Sep (no weekend bidding). Src: Moneycontrol.";
    const out = annotateStaleOrWeekendAsOf(already, {
      userText: "as of yesterday",
      now: monday,
      timeZone: "Asia/Kolkata",
    });
    assert.equal(out, already);
  });
});
