import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isAboutMeCommand,
  isClearMemoryConfirmCommand,
  isDeletePendingCommand,
  isHelpCommand,
  isHowItWorksCommand,
  isStatusCommand,
  parseForgetCommand,
  STANDING_HELP,
} from "./standingCommands.js";

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

  it("recognizes how it works + delete helpers", () => {
    assert.equal(isHowItWorksCommand("how it works"), true);
    assert.equal(isDeletePendingCommand("delete pending"), true);
    assert.equal(parseForgetCommand("forget Rajeev"), "Rajeev");
    assert.equal(isClearMemoryConfirmCommand("clear memory yes"), true);
  });

  it("help text names the key commands", () => {
    assert.match(STANDING_HELP, /connect google/i);
    assert.match(STANDING_HELP, /status/i);
    assert.match(STANDING_HELP, /about me/i);
    assert.match(STANDING_HELP, /delete pending/i);
  });
});
