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
  isGoogleListCommand,
  parseDisconnectGoogleCommand,
  parseSyncCommand,
  parseMailLookup,
  parseMailLookbackDays,
  isLookbackOnlyMessage,
  isMailFollowUp,
  looksLikeInventedMailMiss,
  mailHayMatchesQuery,
  buildGmailSearchQuery,
  parseWaitingForMail,
  formatMailWorkingSet,
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

  it("recognizes google list phrasing", () => {
    assert.equal(isGoogleListCommand("google"), true);
    assert.equal(isGoogleListCommand("Show google accounts"), true);
    assert.equal(isGoogleListCommand("Which google account os is connected?"), true);
    assert.equal(isGoogleListCommand("which 3 accounts"), true);
    assert.equal(isGoogleListCommand("book google meet"), false);
  });

  it("parses disconnect / sync", () => {
    assert.deepEqual(parseDisconnectGoogleCommand("Disconnect personal 2"), {
      rawLabel: "personal2",
    });
    assert.deepEqual(parseDisconnectGoogleCommand("disconnect personal2"), {
      rawLabel: "personal2",
    });
    assert.deepEqual(parseDisconnectGoogleCommand("disconnect google personal2"), {
      rawLabel: "personal2",
    });
    assert.deepEqual(parseSyncCommand("Sync"), {});
    assert.deepEqual(parseSyncCommand("sync personal"), { label: "personal" });
  });

  it("parses mail lookup + lookback", () => {
    const a = parseMailLookup("Is there any mail from Valiant Academy on independence day?");
    assert.ok(a);
    assert.match(a!.query, /valiant/i);
    assert.match(a!.query, /independence/i);
    assert.equal(a!.lookbackDays, 14);
    const b = parseMailLookup(
      "Please check email from Valiants Academy on independence day celebrations",
    );
    assert.ok(b);
    assert.match(b!.query, /valiant/i);
    assert.equal(parseMailLookbackDays("In last 2 weeks"), 14);
    assert.equal(isLookbackOnlyMessage("In last 2 weeks"), true);
    assert.equal(parseMailLookup("summarize my emails"), null);
    const c = parseMailLookup(
      "any email from Valiants Academy regarding independence day celebration?",
    );
    assert.ok(c);
    assert.match(c!.query, /valiant/i);
    assert.match(c!.query, /independence/i);
    const d = parseMailLookup("any email from Juhi?");
    assert.ok(d);
    assert.match(d!.query, /juhi/i);
    const e = parseMailLookup("show emails from Valiants Academy");
    assert.ok(e);
    assert.match(e!.query, /valiant/i);
    assert.equal(parseMailLookup("list emails from valiants academy")?.query.toLowerCase().includes("valiant"), true);
    assert.equal(parseMailLookup("summarise the action points of these emails"), null);
    assert.equal(parseMailLookup("email had any attachment?"), null);
    const juhiActions = parseMailLookup("action points from Juhi's email");
    assert.ok(juhiActions);
    assert.match(juhiActions!.query, /juhi/i);
    assert.ok(parseWaitingForMail("I'm waiting for an email from Juhi"));
    assert.match(parseWaitingForMail("waiting for mail from Valiants")!.query, /valiant/i);
    const formatted = formatMailWorkingSet({
      query: "Valiants",
      lookbackDays: 14,
      savedAt: new Date().toISOString(),
      hits: [
        {
          from: "Valiants Academy <valiantsacademy@gmail.com>",
          to: "Sameep Bansal <sameep@excro.in>",
          subject: "Registration for Independence Day Celebrations - Reminder",
          snippet: "Kindly complete the registration using the link below",
          date: "2026-08-14",
        },
      ],
    });
    assert.match(formatted, /To: Sameep/);
    assert.match(formatted, /complete the registration/i);
    assert.equal(isMailFollowUp("show emails"), true);
    assert.equal(
      isMailFollowUp("i am asking specifically about valiant academy and independence day"),
      true,
    );
    const onecard =
      "Team OneCard Earn rewards Independence Day Special Nasher Miles backpack";
    const valiant =
      "Valiants Academy <valiantsacademy@gmail.com> Registration for Independence Day Celebrations - Reminder";
    assert.equal(mailHayMatchesQuery(onecard, "Valiants Academy independence day"), false);
    assert.equal(mailHayMatchesQuery(valiant, "Valiants Academy independence day"), true);
    assert.equal(mailHayMatchesQuery(valiant, "Valiant Academy independence"), true);
    assert.equal(mailHayMatchesQuery("Juhi Badle <juhi.badle@idfcfirst.bank.in> IMPS", "Juhi"), true);
    assert.match(buildGmailSearchQuery("Valiants Academy independence day", 14), /valiant/i);
    assert.match(buildGmailSearchQuery("Valiants Academy independence day", 14), /newer_than:14d/);
    assert.equal(looksLikeInventedMailMiss("No emails from Valiants Academy in either inbox."), true);
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
