import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  checkSlotConflicts,
  findNextFreeSlot,
  formatConflictProposalNote,
  intervalsOverlap,
} from "./calendarConflict.js";
import { formatLocalHm, zonedLocalDateTime } from "./time.js";

describe("calendar conflict", () => {
  it("detects overlapping intervals", () => {
    const a0 = new Date("2026-08-08T04:30:00.000Z"); // 10:00 IST
    const a1 = new Date("2026-08-08T05:30:00.000Z"); // 11:00 IST
    const b0 = new Date("2026-08-08T05:00:00.000Z"); // 10:30 IST
    const b1 = new Date("2026-08-08T06:00:00.000Z"); // 11:30 IST
    assert.equal(intervalsOverlap(a0, a1, b0, b1), true);
    assert.equal(intervalsOverlap(a0, a1, a1, b1), false);
  });

  it("suggests 11:00 when 10:00–11:00 is busy", () => {
    const tz = "Asia/Kolkata";
    const busyStart = zonedLocalDateTime(tz, "2026-08-08", 10, 0);
    const busyEnd = zonedLocalDateTime(tz, "2026-08-08", 11, 0);
    const wantStart = zonedLocalDateTime(tz, "2026-08-08", 10, 0);
    const wantEnd = zonedLocalDateTime(tz, "2026-08-08", 11, 0);

    const result = checkSlotConflicts(
      [{ title: "Busy", start: busyStart, end: busyEnd }],
      wantStart,
      wantEnd,
      tz,
    );
    assert.equal(result.clear, false);
    assert.ok(result.suggested);
    assert.equal(formatLocalHm(result.suggested!.start, tz), "11:00");
    assert.equal(formatLocalHm(result.suggested!.end, tz), "12:00");

    const note = formatConflictProposalNote(result, tz);
    assert.ok(note);
    assert.match(note!, /10:00 conflicts/i);
    assert.match(note!, /go ahead/i);
    assert.match(note!, /alternate/i);
    assert.match(note!, /11:00/i);
  });

  it("skips past a back-to-back block to the next free hour", () => {
    const tz = "Asia/Kolkata";
    const blocks = [
      {
        title: "Busy",
        start: zonedLocalDateTime(tz, "2026-08-08", 10, 0),
        end: zonedLocalDateTime(tz, "2026-08-08", 11, 0),
      },
      {
        title: "Call",
        start: zonedLocalDateTime(tz, "2026-08-08", 11, 0),
        end: zonedLocalDateTime(tz, "2026-08-08", 12, 0),
      },
    ];
    const slot = findNextFreeSlot(
      zonedLocalDateTime(tz, "2026-08-08", 10, 0),
      60 * 60 * 1000,
      blocks,
      tz,
    );
    assert.ok(slot);
    assert.equal(formatLocalHm(slot!.start, tz), "12:00");
  });

  it("returns clear when the slot is free", () => {
    const tz = "Asia/Kolkata";
    const result = checkSlotConflicts(
      [
        {
          title: "Lunch",
          start: zonedLocalDateTime(tz, "2026-08-08", 13, 0),
          end: zonedLocalDateTime(tz, "2026-08-08", 14, 0),
        },
      ],
      zonedLocalDateTime(tz, "2026-08-08", 10, 0),
      zonedLocalDateTime(tz, "2026-08-08", 11, 0),
      tz,
    );
    assert.equal(result.clear, true);
    assert.equal(formatConflictProposalNote(result, tz), null);
  });
});
