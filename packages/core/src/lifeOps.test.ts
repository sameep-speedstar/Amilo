import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildResearchOptions,
  formatMoneyCapNote,
  parseInboxErrandDraftAsk,
  parseLifeOpsHandoffIntent,
  parseLifeOpsResearchIntent,
  parseMoneyCapInr,
} from "./lifeOps.js";

describe("lifeOps", () => {
  it("parses money caps", () => {
    assert.equal(parseMoneyCapInr("flights to Goa under 8k"), 8000);
    assert.equal(parseMoneyCapInr("hotel under ₹12,000"), 12000);
    assert.equal(parseMoneyCapInr("budget of Rs 5000"), 5000);
  });

  it("parses travel research standing intent", () => {
    const r = parseLifeOpsResearchIntent("find flights to Goa under 8k tomorrow");
    assert.ok(r);
    assert.equal(r!.domain, "travel");
    assert.equal(r!.moneyCapInr, 8000);
    assert.equal(r!.options.length, 3);
    assert.match(r!.summary, /Money cap/);
    assert.match(r!.summary, /still no spend/i);
  });

  it("does not treat calendar book as research", () => {
    assert.equal(parseLifeOpsResearchIntent("book a meeting with Priya tomorrow at 4"), null);
  });

  it("parses errand handoff / return", () => {
    const h = parseLifeOpsHandoffIntent("chase the Amazon return for the kettle");
    assert.ok(h);
    assert.equal(h!.domain, "errand");
    assert.equal(h!.channel, "email");
    assert.ok(h!.email?.subject);
  });

  it("parses vendor handoff", () => {
    const h = parseLifeOpsHandoffIntent("hand off to the plumber for the kitchen leak");
    assert.ok(h);
    assert.equal(h!.channel, "vendor");
  });

  it("formats money cap note", () => {
    assert.match(formatMoneyCapNote(8000)!, /₹8,000/);
    assert.equal(formatMoneyCapNote(null), null);
  });

  it("builds home options", () => {
    const opts = buildResearchOptions("home", "PTI slots next week", null);
    assert.equal(opts.length, 3);
  });

  it("parses inbox errand draft asks", () => {
    const e = parseInboxErrandDraftAsk("draft an email to chase the electricity bill");
    assert.ok(e);
    assert.equal(e!.kind, "bill");
    assert.equal(e!.mode, "draft");
  });
});
