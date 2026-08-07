import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isActionDemandingMail,
  isPassiveTransactionalMail,
  mailPriorityScore,
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
      true,
    );
    assert.ok(
      mailPriorityScore(
        "Add alternate contact details for your account",
        "notify@getonecard.app",
      ) > 0,
    );
  });
});
