import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { checkSlotConflicts } from "./calendarConflict.js";
import {
  formatScheduleAck,
  holdUntilIsoForHm,
  isAutoDeclineHoldActive,
  matchScheduleLabel,
  parseScheduleIntent,
  briefScheduleWindowLine,
  scheduleAppliesOnDay,
  scheduleBlocksForRange,
} from "./schedules.js";
import { formatLocalHm, zonedLocalDateTime } from "./time.js";

describe("schedule memory", () => {
  it("parses standing daily pickup range", () => {
    const intent = parseScheduleIntent(
      "everyday I have School pickup 4:00–4:30 pm daily. do not book any meeting in this time",
    );
    assert.ok(intent);
    assert.equal(intent!.type, "standing");
    if (intent!.type !== "standing") return;
    assert.match(intent.label, /pickup/i);
    assert.equal(intent.startHm, "16:00");
    assert.equal(intent.endHm, "16:30");
    assert.equal(intent.days, "daily");
  });

  it("parses gym weekdays range", () => {
    const intent = parseScheduleIntent("Gym weekdays 7-8am — don't book during that");
    assert.ok(intent);
    assert.equal(intent!.type, "standing");
    if (intent!.type !== "standing") return;
    assert.match(intent.label, /gym/i);
    assert.equal(intent.startHm, "07:00");
    assert.equal(intent.endHm, "08:00");
    assert.equal(intent.days, "weekdays");
  });

  it("parses extend hold with don't book", () => {
    const intent = parseScheduleIntent(
      "extend my school pickup time till 5 o'clock and do not book any meeting",
    );
    assert.ok(intent);
    assert.equal(intent!.type, "extend_hold");
    if (intent!.type !== "extend_hold") return;
    assert.match(intent.labelHint, /pickup/i);
    assert.equal(intent.untilHm, "17:00");
    assert.equal(intent.autoDecline, true);
  });

  it("parses cancel hold", () => {
    const intent = parseScheduleIntent("cancel hold");
    assert.ok(intent);
    assert.equal(intent!.type, "cancel_hold");
  });

  it("expands schedule blocks and extends with hold", () => {
    const tz = "Asia/Kolkata";
    // Friday 14 Aug 2026
    const day = "2026-08-14";
    const from = zonedLocalDateTime(tz, day, 0, 0);
    const to = zonedLocalDateTime(tz, day, 23, 59);
    const holdUntil = zonedLocalDateTime(tz, day, 17, 0).toISOString();
    const blocks = scheduleBlocksForRange(
      [
        {
          label: "School Pickup",
          attrs: {
            days: "weekdays",
            startHm: "16:00",
            endHm: "16:30",
            holdUntilIso: holdUntil,
            autoDecline: true,
          },
        },
      ],
      tz,
      from,
      to,
    );
    assert.equal(blocks.length, 1);
    assert.equal(formatLocalHm(blocks[0]!.start, tz), "16:00");
    assert.equal(formatLocalHm(blocks[0]!.end, tz), "17:00");
  });

  it("treats schedule block as busy in conflict check", () => {
    const tz = "Asia/Kolkata";
    const day = "2026-08-14";
    const blocks = scheduleBlocksForRange(
      [
        {
          label: "School Pickup",
          attrs: { days: "weekdays", startHm: "16:00", endHm: "16:30" },
        },
      ],
      tz,
      zonedLocalDateTime(tz, day, 0, 0),
      zonedLocalDateTime(tz, day, 23, 59),
    );
    const result = checkSlotConflicts(
      blocks,
      zonedLocalDateTime(tz, day, 16, 0),
      zonedLocalDateTime(tz, day, 17, 0),
      tz,
    );
    assert.equal(result.clear, false);
    assert.match(result.conflicts[0]!.title, /pickup/i);
  });

  it("holdUntilIso + autoDecline active until expiry", () => {
    const until = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    assert.equal(
      isAutoDeclineHoldActive({
        days: "weekdays",
        startHm: "16:00",
        endHm: "16:30",
        holdUntilIso: until,
        autoDecline: true,
      }),
      true,
    );
    assert.equal(
      isAutoDeclineHoldActive({
        days: "weekdays",
        startHm: "16:00",
        endHm: "16:30",
        holdUntilIso: new Date(Date.now() - 1000).toISOString(),
        autoDecline: true,
      }),
      false,
    );
  });

  it("matches schedule label by hint", () => {
    const hit = matchScheduleLabel(
      [{ label: "School Pickup", attrs: {} }],
      "pickup",
    );
    assert.ok(hit);
    assert.equal(hit!.label, "School Pickup");
  });

  it("weekdays apply Mon–Fri only", () => {
    const tz = "Asia/Kolkata";
    assert.equal(scheduleAppliesOnDay("weekdays", "2026-08-14", tz), true); // Fri
    assert.equal(scheduleAppliesOnDay("weekdays", "2026-08-15", tz), false); // Sat
    assert.equal(scheduleAppliesOnDay("daily", "2026-08-15", tz), true);
  });

  it("formats standing and hold acks", () => {
    const standing = formatScheduleAck({
      label: "School Pickup",
      startHm: "16:00",
      endHm: "16:30",
      days: "daily",
      timeZone: "Asia/Kolkata",
    });
    assert.match(standing, /School Pickup/);
    assert.match(standing, /memory only/i);

    const holdIso = holdUntilIsoForHm("17:00", "Asia/Kolkata", new Date("2026-08-14T10:00:00.000Z"));
    assert.ok(holdIso);
    const hold = formatScheduleAck({
      label: "School Pickup",
      startHm: "16:00",
      endHm: "17:00",
      days: "weekdays",
      holdUntilIso: holdIso,
      autoDecline: true,
      timeZone: "Asia/Kolkata",
    });
    assert.match(hold, /held till/i);
    assert.match(hold, /decline/i);
  });

  it("keeps standing pickup off the daily brief", () => {
    const tz = "Asia/Kolkata";
    const now = zonedLocalDateTime(tz, "2026-08-20", 10, 0);
    const standing = briefScheduleWindowLine(
      "school pickup",
      { days: "daily", startHm: "16:00", endHm: "16:30" },
      { timeZone: tz, now, focusDay: "2026-08-20" },
    );
    assert.equal(standing, null);
  });

  it("prints an active hold on the focus day only", () => {
    const tz = "Asia/Kolkata";
    const now = zonedLocalDateTime(tz, "2026-08-20", 10, 0);
    const holdUntil = zonedLocalDateTime(tz, "2026-08-20", 17, 0).toISOString();
    const line = briefScheduleWindowLine(
      "school pickup",
      { days: "daily", startHm: "16:00", endHm: "16:30", holdUntilIso: holdUntil },
      { timeZone: tz, now, focusDay: "2026-08-20" },
    );
    assert.equal(line, "16:00–17:00 school pickup (hold)");
    const tomorrow = briefScheduleWindowLine(
      "school pickup",
      { days: "daily", startHm: "16:00", endHm: "16:30", holdUntilIso: holdUntil },
      { timeZone: tz, now, focusDay: "2026-08-21" },
    );
    assert.equal(tomorrow, null);
  });
});
