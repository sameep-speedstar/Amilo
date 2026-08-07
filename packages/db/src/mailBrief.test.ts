import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isActionDemandingMail,
  isFyiRecruitingMail,
  isPassiveTransactionalMail,
  mailPriorityScore,
  parseAppointmentReminder,
} from "./repos.js";

describe("brief mail action filter", () => {
  it("drops UPI / debit alerts as passive", () => {
    assert.equal(isPassiveTransactionalMail("UPI Debit Alert"), true);
    assert.equal(isActionDemandingMail("UPI Debit Alert"), false);
    assert.equal(mailPriorityScore("UPI Debit Alert", "alerts@yes.bank.in"), 0);
  });

  it("keeps bill due / failed SIP as actionable", () => {
    assert.equal(
      isActionDemandingMail("Credit Card bill due today"),
      true,
    );
    assert.equal(
      isPassiveTransactionalMail("Credit Card bill due today"),
      false,
    );
    assert.ok(
      mailPriorityScore(
        "Important: SIP Instalment Failed Due to Insufficient Balance",
        "service@icicisecurities.com",
      ) >= 70,
    );
    assert.ok(mailPriorityScore("Credit Card bill due today", "OneCard") >= 70);
  });

  it("drops trade confirmations and portfolio updates", () => {
    assert.equal(
      isPassiveTransactionalMail("F&O Order and Trade Confirmations for 06-Aug-2026"),
      true,
    );
    assert.equal(
      mailPriorityScore("Latest Updates on Stocks in Your Portfolio", "ICICI"),
      0,
    );
    assert.equal(
      mailPriorityScore("Next MF SIP will be triggered on 07-Aug-2026", "ICICI"),
      0,
    );
  });

  it("keeps complete-your-profile style asks", () => {
    assert.equal(
      isActionDemandingMail("Add alternate contact details for your account"),
      false,
    );
    assert.equal(
      isPassiveTransactionalMail("Add alternate contact details for your account"),
      true,
    );
    assert.equal(
      mailPriorityScore(
        "Add alternate contact details for your account",
        "notify@getonecard.app",
      ),
      0,
    );
    assert.ok(
      mailPriorityScore(
        "Important: Update your KYC to avoid card block",
        "Team OneCard",
      ) >= 70,
    );
  });

  it("surfaces today's dental appointment reminders", () => {
    const title =
      "Appointment Reminder: Fri, 07 Aug 2026 04:30 pm @ LITTLE PEARLS ® Dental Clinic";
    assert.equal(isActionDemandingMail(title), true);
    const score = mailPriorityScore(title, "no-reply@practo.net", [], "", {
      timezone: "Asia/Kolkata",
      now: new Date("2026-08-07T03:00:00.000Z"),
    });
    assert.ok(score >= 90, `score=${score}`);
  });

  it("dedupes Practo reminders by time+clinic (patient optional)", () => {
    const now = new Date("2026-08-07T03:00:00.000Z");
    const a = parseAppointmentReminder(
      "Appointment Reminder: Fri, 07 Aug 2026 04:30 pm @ LITTLE PEARLS ® Dental Clinic",
      "Asia/Kolkata",
      now,
      "Patient Name Sameep Bansal",
    );
    const b = parseAppointmentReminder(
      "Appointment Reminder: Fri, 07 Aug 2026 04:30 pm @ LITTLE PEARLS ® Dental Clinic",
      "Asia/Kolkata",
      now,
      "",
    );
    const c = parseAppointmentReminder(
      "Appointment Reminder: Fri, 07 Aug 2026 05:30 pm @ LITTLE PEARLS ® Dental Clinic",
      "Asia/Kolkata",
      now,
      "Patient Name Shreeja",
    );
    assert.ok(a && b && c);
    assert.equal(a.dedupeKey, b.dedupeKey);
    assert.notEqual(a.dedupeKey, c.dedupeKey);
    assert.ok(a.label.includes("Sameep"));
    assert.ok(c.label.includes("Shreeja"));
    assert.ok(a.clockSort < c.clockSort);
  });

  it("drops Greenhouse hire FYI even when subject says Application", () => {
    const title = "Anthropic Application for Enterprise Account Executive, Industries";
    const snippet =
      "Hi Sameep, Thank you so much for your interest in Anthropic and for applying to the Enterprise Account Executive, Industries role. We wanted to let you know that we recently hired for the Enterprise";
    const hay = `${title} ${snippet}`;
    assert.equal(isFyiRecruitingMail(hay), true);
    assert.equal(isActionDemandingMail(hay), false);
    assert.equal(isPassiveTransactionalMail(`greenhouse ${hay}`), true);
    assert.equal(
      mailPriorityScore(title, "no-reply@us.greenhouse-mail.io", [], snippet),
      0,
    );
  });

  it("keeps interview invite / offer letter as actionable", () => {
    assert.ok(
      mailPriorityScore("Interview invitation — Tuesday 2pm", "recruiter@acme.com") >= 70,
    );
    assert.ok(mailPriorityScore("Your offer letter from Acme", "hr@acme.com") >= 70);
  });

  it("keeps credit card bill due phrasing and drops spend alerts", () => {
    assert.ok(
      mailPriorityScore("Your Axis Bank Credit Card bill is due today", "alerts@axis.bank.in") >=
        70,
    );
    assert.ok(
      mailPriorityScore(
        "Payment due reminder",
        "onecard",
        [],
        "Total amount due INR 12000. Payment due date 07-Aug-2026",
      ) >= 70,
    );
    assert.equal(
      mailPriorityScore("INR 1050 spent on credit card no. XX9396", "alerts@axis.bank.in"),
      0,
    );
    assert.equal(
      mailPriorityScore("USD 5 spent on credit card no. XX9396", "alerts@axis.bank.in"),
      0,
    );
  });

  it("does not surface VIP-only FYI", () => {
    assert.equal(
      mailPriorityScore("Weekly digest", "ceo@acme.com", ["ceo@acme.com"], "FYI only"),
      0,
    );
  });
});
