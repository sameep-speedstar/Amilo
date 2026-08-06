import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatLocalHm,
  guessTimezoneFromPhone,
  localDayBoundsUtc,
  parseClockToken,
  parseReminderMessage,
  parseTimezoneUpdateMessage,
  resolveTimezoneInput,
  zonedLocalDateTime,
} from "./time.js";

describe("timezone helpers", () => {
  it("guesses India from +91", () => {
    assert.equal(guessTimezoneFromPhone("+918108506999"), "Asia/Kolkata");
  });

  it("formats local HM in IST not UTC", () => {
    const d = new Date("2026-08-06T09:30:00.000Z");
    assert.equal(formatLocalHm(d, "Asia/Kolkata"), "15:00");
  });

  it("local day bounds for Kolkata", () => {
    const at = new Date("2026-08-06T12:00:00.000Z");
    const b = localDayBoundsUtc("Asia/Kolkata", at);
    assert.equal(b.day, "2026-08-06");
    assert.equal(b.timeMin.toISOString(), "2026-08-05T18:30:00.000Z");
    assert.equal(b.timeMax.toISOString(), "2026-08-06T18:30:00.000Z");
  });

  it("zonedLocalDateTime 15:00 IST", () => {
    const d = zonedLocalDateTime("Asia/Kolkata", "2026-08-06", 15, 0);
    assert.equal(d.toISOString(), "2026-08-06T09:30:00.000Z");
  });

  it("parses clocks", () => {
    assert.deepEqual(parseClockToken("12:30"), { hour: 12, minute: 30 });
    assert.deepEqual(parseClockToken("8pm"), { hour: 20, minute: 0 });
    assert.deepEqual(parseClockToken("8 PM"), { hour: 20, minute: 0 });
  });

  it("parses dual reminders", () => {
    const now = new Date("2026-08-06T04:00:00.000Z"); // 09:30 IST
    const specs = parseReminderMessage(
      "remind me for call at 12:30 and 8 PM",
      "Asia/Kolkata",
      now,
    );
    assert.equal(specs.length, 2);
    assert.equal(formatLocalHm(specs[0]!.dueAt, "Asia/Kolkata"), "12:30");
    assert.equal(formatLocalHm(specs[1]!.dueAt, "Asia/Kolkata"), "20:00");
    assert.match(specs[0]!.title, /call/i);
  });

  it("resolves travel updates", () => {
    assert.equal(parseTimezoneUpdateMessage("I'm in Dubai"), "Asia/Dubai");
    assert.equal(resolveTimezoneInput("Asia/Kolkata"), "Asia/Kolkata");
    assert.equal(parseTimezoneUpdateMessage("timezone London"), "Europe/London");
  });
});
