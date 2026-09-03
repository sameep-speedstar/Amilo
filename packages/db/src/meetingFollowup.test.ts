import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  attendedMeetingLabel,
  extractMeetingActionItems,
  focusDedupeKey,
  focusLabelsMatch,
  isAttendedMeeting,
} from "./meetingFollowup.js";

describe("isAttendedMeeting", () => {
  const dayStart = new Date("2026-09-03T00:00:00+05:30");
  const dayEnd = new Date("2026-09-03T23:59:59.999+05:30");
  const evening = new Date("2026-09-03T20:00:00+05:30");

  it("counts ended accepted meetings", () => {
    assert.equal(
      isAttendedMeeting(
        {
          id: "1",
          title: "TSP",
          occursAt: new Date("2026-09-03T10:30:00+05:30"),
          meta: {
            end: "2026-09-03T11:30:00+05:30",
            selfResponseStatus: "accepted",
          },
        },
        evening,
        dayStart,
        dayEnd,
      ),
      true,
    );
  });

  it("skips declined, future, and all-day", () => {
    assert.equal(
      isAttendedMeeting(
        {
          id: "2",
          title: "Skip",
          occursAt: new Date("2026-09-03T10:00:00+05:30"),
          meta: {
            end: "2026-09-03T11:00:00+05:30",
            selfResponseStatus: "declined",
          },
        },
        evening,
        dayStart,
        dayEnd,
      ),
      false,
    );
    assert.equal(
      isAttendedMeeting(
        {
          id: "3",
          title: "Later",
          occursAt: new Date("2026-09-03T21:00:00+05:30"),
          meta: { end: "2026-09-03T22:00:00+05:30" },
        },
        evening,
        dayStart,
        dayEnd,
      ),
      false,
    );
    assert.equal(
      isAttendedMeeting(
        {
          id: "4",
          title: "Holiday",
          occursAt: dayStart,
          meta: { allDay: true, end: "2026-09-04T00:00:00+05:30" },
        },
        evening,
        dayStart,
        dayEnd,
      ),
      false,
    );
  });
});

describe("extractMeetingActionItems", () => {
  it("returns empty for free-form notes", () => {
    assert.deepEqual(
      extractMeetingActionItems("Discussed roadmap and hiring. Good call."),
      [],
    );
  });

  it("pulls labeled and checkbox actions", () => {
    const items = extractMeetingActionItems(`
Agenda: Q3 review
Action: Send revised deck to Ameya
TODO: Confirm escrow account opening
- [ ] Follow up with Yogish on addendum
Notes: parking lot
`);
    assert.deepEqual(items, [
      "Send revised deck to Ameya",
      "Confirm escrow account opening",
      "Follow up with Yogish on addendum",
    ]);
  });

  it("pulls bullets under an Action items heading", () => {
    const items = extractMeetingActionItems(`
Action items:
• Draft CMS proposal reply
• Share UAT credentials with Ananda
Attendees: Sameep, Ananda
`);
    assert.ok(items.some((i) => /CMS proposal/i.test(i)));
    assert.ok(items.some((i) => /UAT credentials/i.test(i)));
  });

  it("ignores empty action placeholders", () => {
    assert.deepEqual(extractMeetingActionItems("Action: none\nTODO: TBD"), []);
  });
});

describe("attendedMeetingLabel", () => {
  it("prefixes time", () => {
    assert.equal(attendedMeetingLabel("Esaas TSP Model Discussion", "16:00"), "16:00 Esaas TSP Model Discussion");
  });
});

describe("focusLabelsMatch", () => {
  it("collapses mail + overdue commitment for the same meeting", () => {
    const mail = "Cosmos <> API usecase discussion <> Esaas Technologies — Suyash Sinha";
    const commit = "Overdue: 14:00 Cosmos <> API usecase discussion <> Esaas Technologies";
    assert.equal(focusLabelsMatch(mail, commit), true);
    assert.ok(focusDedupeKey(mail).includes("cosmos"));
  });

  it("keeps unrelated labels distinct", () => {
    assert.equal(
      focusLabelsMatch(
        "Pickup checklist details — REVV",
        "Important: Update your KYC to avoid card block — Team OneCard",
      ),
      false,
    );
  });
});
