import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  flattenWaTemplateParam,
  formatLocalDayShort,
  formatLocalHm,
  formatLocalWhenFriendly,
  guessTimezoneFromPhone,
  isHmInWindow,
  isInQuietHours,
  localDayBoundsUtc,
  parseCalendarCreateHint,
  parseClockToken,
  parseReminderMessage,
  parseTimezoneUpdateMessage,
  relativeDayLabel,
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

  it("labels relative day vs now in IST (afternoon 'tomorrow' must not steal today)", () => {
    const now = new Date("2026-08-11T11:23:00.000Z"); // Tue 11 Aug ~16:53 IST
    const gvp = new Date("2026-08-11T09:30:00.000Z"); // Tue 11 Aug 15:00 IST
    const nextDay = new Date("2026-08-12T09:30:00.000Z"); // Wed 12 Aug 15:00 IST
    assert.equal(relativeDayLabel(gvp, "Asia/Kolkata", now), "today");
    assert.equal(relativeDayLabel(nextDay, "Asia/Kolkata", now), "tomorrow");
    assert.match(formatLocalDayShort(gvp, "Asia/Kolkata"), /11/);
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

  it("fires brief window after target", () => {
    assert.equal(isHmInWindow("07:30", "07:30", 5), true);
    assert.equal(isHmInWindow("07:34", "07:30", 5), true);
    assert.equal(isHmInWindow("07:35", "07:30", 5), false);
    assert.equal(isHmInWindow("07:29", "07:30", 5), false);
  });

  it("quiet hours overnight", () => {
    const late = new Date("2026-08-06T17:30:00.000Z"); // 23:00 IST
    assert.equal(isInQuietHours(late, "Asia/Kolkata", "22:00", "07:00"), true);
    const day = new Date("2026-08-06T04:30:00.000Z"); // 10:00 IST
    assert.equal(isInQuietHours(day, "Asia/Kolkata", "22:00", "07:00"), false);
  });

  it("flattens WA template params", () => {
    assert.equal(flattenWaTemplateParam("a\nb\tc    d"), "a b c d");
  });

  it("formats friendly when without ISO", () => {
    const d = new Date("2026-08-07T07:30:00.000Z"); // 1:00 pm IST
    assert.equal(
      formatLocalWhenFriendly(d, "Asia/Kolkata"),
      "Friday 7 August · 1:00 pm",
    );
  });

  it("parses calendar create hint for tomorrow 1pm", () => {
    const now = new Date("2026-08-06T12:00:00.000Z");
    const hint = parseCalendarCreateHint(
      "add lunch with Raj tomorrow at 1pm",
      "Asia/Kolkata",
      now,
    );
    assert.ok(hint);
    assert.match(hint!.title, /lunch/i);
    assert.equal(
      formatLocalWhenFriendly(new Date(hint!.startIso), "Asia/Kolkata"),
      "Friday 7 August · 1:00 pm",
    );
  });

  it("strips ack + book verb; keeps duration and who", () => {
    const now = new Date("2026-08-06T18:30:00.000Z"); // Fri 7 Aug 00:00 IST
    const hint = parseCalendarCreateHint(
      "Cool, book 1 hour with Rajeev at 1 PM today",
      "Asia/Kolkata",
      now,
    );
    assert.ok(hint);
    assert.equal(hint!.title, "Meeting with Rajeev");
    assert.equal(
      formatLocalWhenFriendly(new Date(hint!.startIso), "Asia/Kolkata"),
      "Friday 7 August · 1:00 pm",
    );
    assert.equal(
      formatLocalWhenFriendly(new Date(hint!.endIso), "Asia/Kolkata"),
      "Friday 7 August · 2:00 pm",
    );
  });

  it("block calendar without activity → Busy; with activity → title", () => {
    const now = new Date("2026-08-07T12:00:00.000Z");
    const bare = parseCalendarCreateHint(
      "Block calendar for tomorrow 10 AM",
      "Asia/Kolkata",
      now,
    );
    assert.ok(bare);
    assert.equal(bare!.title, "Busy");
    assert.equal(
      formatLocalWhenFriendly(new Date(bare!.startIso), "Asia/Kolkata"),
      "Saturday 8 August · 10:00 am",
    );

    const play = parseCalendarCreateHint(
      "Block calendar at 10 a.m. in the morning, we have to go to play table tennis",
      "Asia/Kolkata",
      now,
    );
    assert.ok(play);
    assert.match(play!.title, /table tennis/i);
  });

  it("parses from–to range (Nisha: noon–2pm, not 2–3pm)", () => {
    // Thu 13 Aug 2026 ~16:41 IST — "tomorrow" = Fri 14 Aug
    const now = new Date("2026-08-13T11:11:00.000Z");
    const hint = parseCalendarCreateHint(
      "Fix meeting with Nisha tomorrow from 12 to 2 PM",
      "Asia/Kolkata",
      now,
    );
    assert.ok(hint);
    assert.match(hint!.title, /nisha/i);
    assert.doesNotMatch(hint!.title, /\bfrom\b|\bto\b|\d/i);
    assert.equal(
      formatLocalWhenFriendly(new Date(hint!.startIso), "Asia/Kolkata"),
      "Friday 14 August · 12:00 pm",
    );
    assert.equal(
      formatLocalWhenFriendly(new Date(hint!.endIso), "Asia/Kolkata"),
      "Friday 14 August · 2:00 pm",
    );
  });

  it("infers am for start when end is pm and start hour is later (11 to 1pm)", () => {
    const now = new Date("2026-08-13T11:11:00.000Z");
    const hint = parseCalendarCreateHint(
      "Book call with Raj today from 11 to 1pm",
      "Asia/Kolkata",
      now,
    );
    assert.ok(hint);
    assert.equal(
      formatLocalWhenFriendly(new Date(hint!.startIso), "Asia/Kolkata"),
      "Thursday 13 August · 11:00 am",
    );
    assert.equal(
      formatLocalWhenFriendly(new Date(hint!.endIso), "Asia/Kolkata"),
      "Thursday 13 August · 1:00 pm",
    );
  });
});
