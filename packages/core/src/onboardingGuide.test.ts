import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  markTipDelivered,
  onboardingDayIndex,
  resolveOnboardingTip,
  type OnboardingContext,
  type OnboardingState,
} from "./onboardingGuide.js";

const blankState = (over: Partial<OnboardingState> = {}): OnboardingState => ({
  startedAt: "2026-09-01T10:00:00.000Z",
  startedLocalDay: "2026-09-01",
  guideComplete: false,
  skipped: false,
  completedMilestones: [],
  lastTipLocalDay: null,
  lastTipId: null,
  ...over,
});

const blankCtx = (over: Partial<OnboardingContext> = {}): OnboardingContext => ({
  googleAccountCount: 0,
  hasReceivedBrief: false,
  hasPlaces: false,
  tzConfirmed: false,
  hasReminder: false,
  hasWatch: false,
  hasMutedPattern: false,
  hasContextPerson: false,
  ...over,
});

describe("onboardingGuide", () => {
  it("computes day index from startedAt", () => {
    assert.equal(onboardingDayIndex("2026-09-01T10:00:00.000Z", "2026-09-01"), 1);
    assert.equal(onboardingDayIndex("2026-09-01T10:00:00.000Z", "2026-09-02"), 2);
    assert.equal(onboardingDayIndex("2026-09-01T10:00:00.000Z", "2026-09-07"), 7);
  });

  it("returns null on day 1 and after day 7 by default", () => {
    assert.equal(
      resolveOnboardingTip(blankState(), blankCtx(), "2026-09-01"),
      null,
    );
    assert.equal(
      resolveOnboardingTip(blankState(), blankCtx(), "2026-09-10"),
      null,
    );
  });

  it("on-demand allows tip on day 1", () => {
    const tip = resolveOnboardingTip(blankState(), blankCtx(), "2026-09-01", {
      onDemand: true,
    });
    assert.ok(tip);
    assert.equal(tip!.tipNumber, 1);
    assert.match(tip!.text, /^Training tip #1/);
    assert.match(tip!.text, /connect google personal/i);
  });

  it("caps to one tip per local day unless on-demand", () => {
    assert.equal(
      resolveOnboardingTip(
        blankState({ lastTipLocalDay: "2026-09-02" }),
        blankCtx(),
        "2026-09-02",
      ),
      null,
    );
    const tip = resolveOnboardingTip(
      blankState({ lastTipLocalDay: "2026-09-02", completedMilestones: ["google"] }),
      blankCtx(),
      "2026-09-02",
      { onDemand: true },
    );
    assert.ok(tip);
    assert.equal(tip!.tipNumber, 2);
    assert.match(tip!.text, /^Training tip #2/);
  });

  it("day 2 nudges google when unlinked", () => {
    const tip = resolveOnboardingTip(blankState(), blankCtx(), "2026-09-02");
    assert.ok(tip);
    assert.equal(tip!.milestoneId, "google");
    assert.equal(tip!.tipNumber, 1);
    assert.match(tip!.text, /Training tip #1/);
    assert.match(tip!.text, /Ask training tip anytime/i);
  });

  it("day 2 teaches multi-account when google already linked", () => {
    const tip = resolveOnboardingTip(
      blankState(),
      blankCtx({ googleAccountCount: 1 }),
      "2026-09-02",
    );
    assert.ok(tip);
    assert.equal(tip!.milestoneId, "google_multi");
    assert.match(tip!.text, /Training tip #1/);
    assert.match(tip!.text, /connect google work/i);
  });

  it("day 3 teaches on-demand brief for google users", () => {
    const tip = resolveOnboardingTip(
      blankState(),
      blankCtx({ googleAccountCount: 1 }),
      "2026-09-03",
    );
    assert.ok(tip);
    assert.equal(tip!.milestoneId, "brief");
    assert.match(tip!.text, /Just type: brief/);
  });

  it("day 3 teaches CoS move for no-google users", () => {
    const tip = resolveOnboardingTip(blankState(), blankCtx(), "2026-09-03");
    assert.ok(tip);
    assert.equal(tip!.milestoneId, "cos_move");
    assert.match(tip!.text, /remind me Friday/i);
  });

  it("skips completed milestones and advances", () => {
    const tip = resolveOnboardingTip(
      blankState({ completedMilestones: ["brief"] }),
      blankCtx({ googleAccountCount: 1, hasReceivedBrief: true }),
      "2026-09-03",
    );
    assert.ok(tip);
    assert.equal(tip!.milestoneId, "cos_move");
    assert.equal(tip!.tipNumber, 2);
  });

  it("day 7 wrap introduces Help", () => {
    const tip = resolveOnboardingTip(
      blankState({
        completedMilestones: ["google", "brief", "cos_move", "mute", "memory"],
      }),
      blankCtx({
        googleAccountCount: 1,
        hasReceivedBrief: true,
        hasReminder: true,
        hasMutedPattern: true,
        hasContextPerson: true,
      }),
      "2026-09-07",
    );
    assert.ok(tip);
    assert.equal(tip!.milestoneId, "wrap");
    assert.match(tip!.text, /Training tip #6/);
    assert.match(tip!.text, /Type Help anytime/i);
  });

  it("markTipDelivered stamps wrap as guide complete", () => {
    const next = markTipDelivered(
      blankState(),
      { milestoneId: "wrap", tipNumber: 6, text: "done" },
      "2026-09-07",
    );
    assert.equal(next.guideComplete, true);
    assert.equal(next.lastTipId, "wrap");
    assert.equal(next.lastTipLocalDay, "2026-09-07");
    assert.ok(next.completedMilestones.includes("wrap"));
  });

  it("respects skipped and guideComplete", () => {
    assert.equal(
      resolveOnboardingTip(blankState({ skipped: true }), blankCtx(), "2026-09-03"),
      null,
    );
    assert.equal(
      resolveOnboardingTip(
        blankState({ guideComplete: true }),
        blankCtx(),
        "2026-09-03",
      ),
      null,
    );
  });
});
