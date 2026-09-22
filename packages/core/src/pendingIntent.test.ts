import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyPendingEditPatch,
  looksLikeNewActionIntent,
} from "./orchestrator.js";

describe("pending intent routing", () => {
  it("treats calendar / email asks as new intents", () => {
    assert.equal(
      looksLikeNewActionIntent("Block calendar for tomorrow 10 AM", "Asia/Kolkata"),
      true,
    );
    assert.equal(
      looksLikeNewActionIntent(
        "Send an email to rajeev@speedstar.ai saying hi",
        "Asia/Kolkata",
      ),
      true,
    );
    assert.equal(
      looksLikeNewActionIntent("Send calendar invite to Rajiv at speedstar.ai", "Asia/Kolkata"),
      true,
    );
    assert.equal(looksLikeNewActionIntent("show draft", "Asia/Kolkata"), false);
    assert.equal(looksLikeNewActionIntent("send", "Asia/Kolkata"), false);
    assert.equal(
      looksLikeNewActionIntent("take these as my directions", "Asia/Kolkata"),
      false,
    );
    assert.equal(
      looksLikeNewActionIntent("This is wrong mail composition", "Asia/Kolkata"),
      false,
    );
    assert.equal(
      looksLikeNewActionIntent("And add an event to his google calendar", "Asia/Kolkata"),
      true,
    );
    assert.equal(looksLikeNewActionIntent("reconnect google personal", "Asia/Kolkata"), true);
    assert.equal(looksLikeNewActionIntent("Connect google speedstar", "Asia/Kolkata"), true);
    assert.equal(looksLikeNewActionIntent("connect uber", "Asia/Kolkata"), true);
    assert.equal(looksLikeNewActionIntent("book Uber to airport", "Asia/Kolkata"), true);
    assert.equal(
      looksLikeNewActionIntent("UK 30 year yield declined last week, read about it", "Asia/Kolkata"),
      true,
    );
    assert.equal(
      looksLikeNewActionIntent("How much NSE IPO is subscribed as of yesterday?", "Asia/Kolkata"),
      true,
    );
  });

  it("does not treat chatter or yes/cancel as new intents", () => {
    assert.equal(looksLikeNewActionIntent("Perfect, voice note is working.", "Asia/Kolkata"), false);
    assert.equal(looksLikeNewActionIntent("yes", "Asia/Kolkata"), false);
    assert.equal(looksLikeNewActionIntent("cancel", "Asia/Kolkata"), false);
  });

  it("applies edit email patches to payload to=", () => {
    const r = applyPendingEditPatch(
      "email_draft",
      { to: "rajiv@speedstar.ai", subject: "Amilo on WhatsApp" },
      "<rajeev@speedstar.ai>",
    );
    assert.equal(r.payload.to, "rajeev@speedstar.ai");
    assert.match(r.summaryHint, /rajeev@speedstar\.ai/);
  });

  it("corrects @speedstart.ai domain typo only", () => {
    const r = applyPendingEditPatch("email_draft", {}, "rajiv@speedstart.ai");
    assert.equal(r.payload.to, "rajiv@speedstar.ai");
  });
});
