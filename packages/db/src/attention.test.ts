import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  mailBriefOrgKey,
  markCompleted,
  markDoneShown,
  markShown,
  recentCompleted,
  reopenIfReminded,
  shouldShowInFocus,
  unshownCompleted,
  userIsOnTo,
} from "./attention.js";

describe("mailBriefOrgKey", () => {
  it("uses display name for free mailboxes", () => {
    assert.equal(
      mailBriefOrgKey("Valiants Academy <valiantsacademy@gmail.com>"),
      "valiants academy",
    );
    assert.equal(
      mailBriefOrgKey("Valiants Academy <other@gmail.com>"),
      "valiants academy",
    );
    assert.notEqual(
      mailBriefOrgKey("Valiants Academy <valiantsacademy@gmail.com>"),
      "gmail.com",
    );
  });

  it("uses domain for org mailboxes", () => {
    assert.equal(mailBriefOrgKey("Team OneCard <notify@getonecard.app>"), "getonecard.app");
  });
});

describe("userIsOnTo", () => {
  it("returns null when To: is unknown", () => {
    assert.equal(userIsOnTo("", ["me@excro.in"]), null);
    assert.equal(userIsOnTo(null, ["me@excro.in"]), null);
  });

  it("detects whether the user is on To:", () => {
    assert.equal(userIsOnTo("Sameep <me@excro.in>", ["me@excro.in"]), true);
    assert.equal(userIsOnTo("other@school.edu", ["me@excro.in"]), false);
  });
});

describe("focus cadence", () => {
  const now = new Date("2026-08-16T02:00:00.000Z");

  it("parks after two touches unless a deadline is near", () => {
    const once = markShown({}, "a", { now, label: "Vote" });
    assert.equal(shouldShowInFocus(once.a, { now, kind: "am" }), false);
    const twice = markShown(once, "a", { now, label: "Vote" });
    assert.equal(twice.a?.status, "parked");
    assert.equal(shouldShowInFocus(twice.a, { now, kind: "am" }), false);
  });

  it("shows overdue once, then parks (money/KYC gets one extra)", () => {
    const overdue = new Date("2026-08-15T02:00:00.000Z");
    assert.equal(
      shouldShowInFocus(undefined, { now, kind: "am", deadline: overdue }),
      true,
    );
    const shown = markShown({}, "reg", { now, label: "Register", deadline: overdue });
    assert.equal(
      shouldShowInFocus(shown.reg, { now, kind: "am", deadline: overdue }),
      false,
    );
    assert.equal(
      shouldShowInFocus(undefined, {
        now,
        kind: "am",
        deadline: overdue,
        moneyOrKyc: true,
      }),
      true,
    );
    const kycOnce = markShown({}, "kyc", { now, label: "KYC", deadline: overdue });
    assert.equal(
      shouldShowInFocus(kycOnce.kyc, {
        now,
        kind: "am",
        deadline: overdue,
        moneyOrKyc: true,
      }),
      true,
    );
    const kycTwice = markShown(kycOnce, "kyc", { now, label: "KYC", deadline: overdue });
    assert.equal(
      shouldShowInFocus(kycTwice.kyc, {
        now,
        kind: "am",
        deadline: overdue,
        moneyOrKyc: true,
      }),
      false,
    );
  });

  it("resets on new mail on the same thread", () => {
    const parked = markShown(markShown({}, "t", { now, label: "Ask" }), "t", {
      now,
      label: "Ask",
    });
    assert.equal(parked.t?.status, "parked");
    assert.equal(
      shouldShowInFocus(parked.t, { now, kind: "am", newMailOnThread: true }),
      true,
    );
  });

  it("prints completed items once, then only via completed list", () => {
    let state = markCompleted({}, "mail:kyc", { now, label: "OneCard KYC" });
    const first = unshownCompleted(state);
    assert.equal(first.length, 1);
    assert.equal(first[0]?.label, "OneCard KYC");
    state = markDoneShown(state, ["mail:kyc"], now);
    assert.equal(unshownCompleted(state).length, 0);
    assert.equal(recentCompleted(state)[0]?.label, "OneCard KYC");
    assert.equal(shouldShowInFocus(state["mail:kyc"], { now, kind: "am" }), false);
  });

  it("reopens only the same identity after a reminder", () => {
    const done = markCompleted({}, "valiants academy|registration", {
      now,
      label: "Registration",
    });
    const reopened = reopenIfReminded(done, "valiants academy|registration");
    assert.equal(reopened["valiants academy|registration"]?.status, "open");
    assert.equal(reopenIfReminded(done, "valiants academy|admissions")["valiants academy|admissions"], undefined);
  });
});
