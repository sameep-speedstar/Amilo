import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  eveningBriefTemplateVarsV2,
  isStructuredBriefTemplate,
  morningBriefTemplateVarsV2,
  padFocusTemplateSlots,
} from "./briefFormat.js";

describe("brief template formatting", () => {
  it("detects structured v2 template names", () => {
    assert.equal(isStructuredBriefTemplate("morning_update_v2"), true);
    assert.equal(isStructuredBriefTemplate("evening_wrap_bullets"), true);
    assert.equal(isStructuredBriefTemplate("morning_update"), false);
  });

  it("pads focus slots with em dashes", () => {
    assert.deepEqual(padFocusTemplateSlots([{ label: "Only one" }]), [
      "Only one",
      "—",
      "—",
    ]);
  });

  it("builds morning v2 vars without newlines in values", () => {
    const vars = morningBriefTemplateVarsV2({
      name: "Sameep",
      dateLong: "Thursday 3 September",
      items: [
        { label: "Escrow addendum — Yogish" },
        { label: "KYC update — OneCard" },
      ],
      quieterCount: 6,
      calendarLines: [],
    });
    assert.equal(vars.length, 6);
    assert.equal(vars[0], "Sameep");
    assert.equal(vars[2], "Escrow addendum — Yogish");
    assert.equal(vars[4], "—");
    assert.match(vars[5]!, /6 quieter/);
    for (const v of vars) assert.equal(/\n/.test(v), false);
  });

  it("builds evening v2 vars with today/tomorrow lines", () => {
    const vars = eveningBriefTemplateVarsV2({
      name: "Sameep",
      todayLines: ["10:30 Esaas TSP", "16:00 Board"],
      calendarLines: ["09:00 Standup"],
      items: [{ label: "Send deck to Ameya" }],
    });
    assert.equal(vars.length, 6);
    assert.match(vars[1]!, /Esaas TSP/);
    assert.match(vars[2]!, /Standup/);
    assert.equal(vars[3], "Send deck to Ameya");
    assert.equal(vars[4], "—");
  });
});
