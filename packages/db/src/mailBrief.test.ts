import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  dedupeHandledMailLines,
  isActionDemandingMail,
  isClosedMailFingerprintSuppressed,
  isClosedMailThreadSuppressed,
  isFyiRecruitingMail,
  isPassiveTransactionalMail,
  mailBriefFingerprint,
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
    // Reminders are calendar-bound, not action-demanding priority mail.
    assert.equal(isActionDemandingMail(title), false);
    const score = mailPriorityScore(title, "no-reply@practo.net", [], "", {
      timezone: "Asia/Kolkata",
      now: new Date("2026-08-07T03:00:00.000Z"),
    });
    assert.ok(score >= 90, `score=${score}`);
  });

  it("drops stale Practo appointment reminders from priority scores", () => {
    const title =
      "Appointment Reminder: Sat, 08 Aug 2026 04:30 pm @ LITTLE PEARLS ® Dental Clinic";
    const score = mailPriorityScore(title, "no-reply@practo.net", [], "", {
      timezone: "Asia/Kolkata",
      now: new Date("2026-08-09T03:00:00.000Z"),
    });
    assert.equal(score, 0);
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

  it("surfaces school registration reminders and person+charges mail", () => {
    assert.ok(
      mailPriorityScore(
        "Registration for Independence Day Celebrations - Reminder",
        "Valiants Academy <info@valiants.edu>",
      ) >= 70,
    );
    assert.ok(
      mailPriorityScore(
        "SSL ESAAS — IMPS charges",
        "Juhi Badle <juhi@example.com>",
        [],
        "Please review the IMPS charges levied on the SSL ESAAS invoice and confirm.",
      ) >= 70,
    );
  });

  it("does not leak FYI via a soft human+please score", () => {
    assert.equal(
      mailPriorityScore(
        "Yes Bank account statement",
        "alerts@yesbank.in",
        [],
        "Please find your monthly statement attached.",
      ),
      0,
    );
    assert.equal(
      mailPriorityScore(
        "Admissions are open for 2026-27",
        "Valiants Academy <valiantsacademy@gmail.com>",
        [],
        "Please visit our campus to know more.",
      ),
      0,
    );
  });

  it("keeps certificate / SSL expiry as actionable", () => {
    assert.ok(
      mailPriorityScore(
        "Your SSL certificate expires in 7 days",
        "Mallikarjun <ops@example.com>",
      ) >= 70,
    );
  });

  it("fingerprints free-mailbox senders by display name", () => {
    const a = mailBriefFingerprint(
      "Valiants Academy <valiantsacademy@gmail.com>",
      "Registration for Independence Day Celebrations - Reminder",
    );
    const b = mailBriefFingerprint(
      "Valiants Academy <other@gmail.com>",
      "Registration for Independence Day Celebrations - Reminder",
    );
    assert.equal(a, b);
    assert.ok(a.startsWith("valiants academy|"));
    assert.ok(!a.startsWith("gmail.com|"));
  });
});

describe("closed brief mail suppress", () => {
  it("suppresses closed thread until newer mail", () => {
    const closedAt = "2026-08-13T14:00:00.000Z";
    const closed = { thr1: closedAt };
    const older = new Date("2026-08-13T12:00:00.000Z");
    const newer = new Date("2026-08-13T16:00:00.000Z");
    assert.equal(
      isClosedMailThreadSuppressed("thr1", older, closed, older),
      true,
    );
    assert.equal(
      isClosedMailThreadSuppressed("thr1", newer, closed, newer),
      false,
    );
    assert.equal(
      isClosedMailThreadSuppressed("other", older, closed, older),
      false,
    );
  });

  it("holds the same KYC ask across a new thread for 14 days", () => {
    const a = mailBriefFingerprint(
      "Team OneCard <notify@getonecard.app>",
      "Important: Update your KYC to avoid card block",
    );
    const b = mailBriefFingerprint(
      "notify@getonecard.app",
      "Reminder: Update your KYC to avoid card block",
    );
    assert.equal(a, b);
    const closedAt = "2026-08-13T14:00:00.000Z";
    const closed = { [a]: closedAt };
    assert.equal(
      isClosedMailFingerprintSuppressed(b, closed, new Date("2026-08-16T02:00:00.000Z")),
      true,
    );
    assert.equal(
      isClosedMailFingerprintSuppressed(b, closed, new Date("2026-08-28T02:00:00.000Z")),
      false,
    );
  });
});

describe("handled list dedupe", () => {
  it("collapses dual-inbox copies of the same quieter mail", () => {
    const onecard = mailBriefFingerprint(
      "Team OneCard <notify@getonecard.app>",
      "🇮🇳 NOW LIVE: Feel the Freedom Sale: Edition 8.0!",
    );
    const mcx = mailBriefFingerprint("Mcxindia <alerts@mcxindia.com>", "Trade Mail - MCX");
    const lines = dedupeHandledMailLines([
      { line: "NOW LIVE: Feel the Freedom Sale: Edition 8.0! — Team OneCard", fingerprint: onecard, threadId: "a1" },
      { line: "NOW LIVE: Feel the Freedom Sale: Edition 8.0! — Team OneCard", fingerprint: onecard, threadId: "b1" },
      { line: "Trade Mail - MCX — Mcxindia", fingerprint: mcx, threadId: "m1" },
      { line: "Trade Mail - MCX — Mcxindia", fingerprint: mcx, threadId: "m1" },
      { line: "Trade Mail - MCX — Mcxindia", fingerprint: mcx, threadId: "m2" },
      { line: "UPI Debit Alert — Yes Bank", fingerprint: "yesbank.in|upi debit alert", threadId: "u1" },
      { line: "UPI Debit Alert — Yes Bank", fingerprint: "yesbank.in|upi debit alert", threadId: "u2" },
    ]);
    assert.deepEqual(lines, [
      "NOW LIVE: Feel the Freedom Sale: Edition 8.0! — Team OneCard",
      "Trade Mail - MCX — Mcxindia",
      "UPI Debit Alert — Yes Bank",
    ]);
  });
});
