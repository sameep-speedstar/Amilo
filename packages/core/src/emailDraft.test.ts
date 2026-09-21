import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanAppointmentVenue,
  composeAppointmentReminder,
  composeEmailDraft,
  emailDraftIntro,
  extractPlaceAddressFromChat,
  isEmailRewriteDirection,
  isSendDraftAsk,
  isShowDraftAsk,
  latestEmailToHintFromChat,
  looksLikeAppointmentNotify,
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

  it("does not dump 'Send mail to sameep' as the body", () => {
    const ask = parseEmailComposeAsk("Send mail to sameep");
    assert.ok(ask);
    assert.equal(ask.mode, "send");
    assert.equal(ask.toHint?.toLowerCase(), "sameep");
    const composed = composeEmailDraft(ask, "Rajeev");
    assert.equal(composed.subject, "Follow up");
    assert.match(composed.body, /Hi Sameep,/);
    assert.doesNotMatch(composed.body, /To sameep/i);
  });

  it("treats rewrite directions as composition notes, not a new dump", () => {
    for (const t of [
      "This is wrong mail composition",
      "you are adding my text",
      "take these as my directions",
      "compose the mail accordingly",
      "you have to draft a mail reminding him",
    ]) {
      assert.equal(isEmailRewriteDirection(t), true, t);
      assert.equal(parseEmailComposeAsk(t), null, t);
    }
  });

  it("detects appointment notify vs calendar hold", () => {
    assert.equal(
      looksLikeAppointmentNotify(
        "Send tomorrow's appointment at Clinic 11 from 11 to 1 along with address details",
      ),
      true,
    );
    assert.equal(
      looksLikeAppointmentNotify(
        "Ok can you block sameep bansals calendar for dental appointment tomorrow 1-4 pm ist",
      ),
      false,
    );
    assert.equal(
      looksLikeAppointmentNotify("And add an event to his google calendar"),
      false,
    );
  });

  it("composes an appointment reminder and pulls address from chat", () => {
    const composed = composeAppointmentReminder({
      recipientFirst: "Sameep",
      venue: "Clinic 11",
      whenLabel: "Tuesday 22 September · 11:00–13:00",
      address: "SCO 11, Sector 11",
      userName: "Rajeev",
    });
    assert.match(composed.subject, /Clinic 11/);
    assert.match(composed.body, /Hi Sameep,/);
    assert.match(composed.body, /Clinic 11/);
    assert.match(composed.body, /Address: SCO 11/);
    assert.match(composed.body, /Rajeev/);
    assert.equal(cleanAppointmentVenue("tomorrow's appointment at Clinic 11"), "Clinic 11");
    assert.equal(
      extractPlaceAddressFromChat(
        "User: Clinic 11 (SCO 11, Sector 11D)\nAmilo: ok",
        "Clinic 11",
      ),
      "SCO 11, Sector 11D",
    );
    assert.equal(
      latestEmailToHintFromChat("User: Send mail to sameep\nAmilo: Draft ready"),
      "sameep",
    );
  });
});
