import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAboutMeCommand,
  isClearMemoryConfirmCommand,
  isDeletePendingCommand,
  isHelpCommand,
  isHowItWorksCommand,
  isStatusCommand,
  parseAboutPersonCommand,
  parseCancelWatchCommand,
  parseForgetCommand,
  parseScheduleDayQuery,
  parseWaitingOnCommand,
  STANDING_HELP,
} from "./standingCommands.js";
import {
  buildAwaitingReplyAlert,
  emailMatchesWatch,
  isCommitmentStallDue,
  underWatcherDailyCap,
} from "./watches.js";

describe("standing commands", () => {
  it("recognizes help aliases", () => {
    assert.equal(isHelpCommand("help"), true);
    assert.equal(isHelpCommand("Commands"), true);
    assert.equal(isHelpCommand("menu?"), true);
    assert.equal(isHelpCommand("help me book"), false);
  });

  it("recognizes status / pending / open", () => {
    for (const t of ["status", "pending", "what's open", "whats pending", "open"]) {
      assert.equal(isStatusCommand(t), true, t);
    }
    assert.equal(isStatusCommand("open the gate"), false);
  });

  it("recognizes about me", () => {
    assert.equal(isAboutMeCommand("about me"), true);
    assert.equal(isAboutMeCommand("what do you know about me?"), true);
    assert.equal(isAboutMeCommand("memory"), true);
  });

  it("parses about person", () => {
    assert.equal(parseAboutPersonCommand("about Rajeev"), "Rajeev");
    assert.equal(parseAboutPersonCommand("what do you know about Priya?"), "Priya");
    assert.equal(parseAboutPersonCommand("about me"), null);
  });

  it("parses forget label and attr", () => {
    assert.deepEqual(parseForgetCommand("forget Rajeev"), { label: "Rajeev" });
    assert.deepEqual(parseForgetCommand("forget Rajeev email"), {
      label: "Rajeev",
      attr: "email",
    });
  });

  it("parses waiting on / cancel watch", () => {
    assert.deepEqual(parseWaitingOnCommand("waiting on Rajeev for board deck"), {
      person: "Rajeev",
      thing: "board deck",
    });
    assert.equal(parseCancelWatchCommand("cancel watch Rajeev"), "Rajeev");
  });

  it("parses schedule day overview queries", () => {
    assert.equal(parseScheduleDayQuery("Hows the schedule for tomorrow?"), "tomorrow");
    assert.equal(parseScheduleDayQuery("what's my plan for today"), "today");
    assert.equal(parseScheduleDayQuery("tomorrow's calendar"), "tomorrow");
    assert.equal(parseScheduleDayQuery("anything on tomorrow"), "tomorrow");
    // specific "scheduled" questions stay with the brain
    assert.equal(parseScheduleDayQuery("is the GVP meeting scheduled tomorrow?"), null);
    assert.equal(parseScheduleDayQuery("help"), null);
  });

  it("recognizes how it works + delete helpers", () => {
    assert.equal(isHowItWorksCommand("how it works"), true);
    assert.equal(isDeletePendingCommand("delete pending"), true);
    assert.equal(isClearMemoryConfirmCommand("clear memory yes"), true);
  });

  it("help text names the key commands", () => {
    assert.match(STANDING_HELP, /connect google/i);
    assert.match(STANDING_HELP, /status/i);
    assert.match(STANDING_HELP, /about me/i);
    assert.match(STANDING_HELP, /waiting on/i);
    assert.match(STANDING_HELP, /delete pending/i);
  });
});

describe("watch helpers", () => {
  it("matches emails and stall windows", () => {
    assert.equal(emailMatchesWatch("rajeev@speedstar.ai", "Rajeev <rajeev@speedstar.ai>"), true);
    assert.equal(emailMatchesWatch("x@y.com", "other@z.com"), false);
    const now = new Date("2026-08-10T12:00:00Z");
    assert.equal(isCommitmentStallDue(new Date("2026-08-10T15:00:00Z"), now), true);
    assert.equal(isCommitmentStallDue(new Date("2026-08-10T18:00:00Z"), now), false);
    assert.equal(underWatcherDailyCap(1), true);
    assert.equal(underWatcherDailyCap(2), false);
    assert.match(
      buildAwaitingReplyAlert({ personLabel: "Rajeev", mailTitle: "Re: deck" }),
      /Rajeev replied/,
    );
  });
});
