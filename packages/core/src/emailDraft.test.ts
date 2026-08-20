import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  composeEmailDraft,
  emailDraftIntro,
  isSendDraftAsk,
  isShowDraftAsk,
  looksLikeFakeDraftAck,
  parseBareEmail,
  parseEmailComposeAsk,
} from "./emailDraft.js";

describe("email compose parse", () => {
  it("treats help-me-draft as draft-only even if the body says send", () => {
    const ask = parseEmailComposeAsk(
      "Help me draft an email. I have to send a reminder email to CAP up that please release the payment, close the invoice so that we can terminate the agreement.",
    );
    assert.ok(ask);
    assert.equal(ask.mode, "draft");
    assert.equal(ask.toHint, "CAP up");
    assert.match(ask.about, /release the payment/i);
    const composed = composeEmailDraft(ask, "Sameep");
    assert.equal(composed.subject, "Reminder: release payment and close invoice");
    assert.match(composed.body, /Hi CAP,/);
    assert.match(composed.body, /terminate the agreement/);
    assert.match(composed.body, /Sameep/);
    const intro = emailDraftIntro({ mode: "draft", recipientLabel: "CAP up" });
    assert.match(intro, /need CAP up's email/i);
  });

  it("treats send-email-to as send mode", () => {
    const ask = parseEmailComposeAsk(
      "Send email to Mahesh that I'm testing Amilo app through WhatsApp.",
    );
    assert.ok(ask);
    assert.equal(ask.mode, "send");
    assert.equal(ask.toHint, "Mahesh");
    assert.match(ask.about, /testing Amilo/i);
  });

  it("detects show-draft / send / fake ack / bare email", () => {
    assert.equal(isShowDraftAsk("Show draft"), true);
    assert.equal(isShowDraftAsk("show me the draft"), true);
    assert.equal(isShowDraftAsk("yes"), false);
    assert.equal(isSendDraftAsk("send"), true);
    assert.equal(isSendDraftAsk("send the draft"), true);
    assert.equal(isSendDraftAsk("yes"), false);
    assert.equal(looksLikeFakeDraftAck("Draft ready. Reply yes to send, cancel to drop, or edit <change>."), true);
    assert.equal(looksLikeFakeDraftAck("To: a@b.com\nSubject: Hi\nHello"), false);
    assert.equal(parseBareEmail("billing@capup.com"), "billing@capup.com");
    assert.equal(parseBareEmail("Show draft"), null);
  });
});
