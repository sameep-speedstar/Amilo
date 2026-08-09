import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanCalendarDisplayTitle,
  extractInviteeNames,
  isCalendarInviteIntent,
  parseAppointmentForward,
  parseTravelForward,
} from "./forwardParse.js";

describe("forwardParse", () => {
  it("parses IVF appointment confirmation", () => {
    const msg = `
Appointment Confirmation
Your appointment with Dr. Mehta at KHUSHI IVF is scheduled on
Date: 2026-08-10
Time: 16:20:00
Patient Sameep Bansal
`;
    const hint = parseAppointmentForward(msg, "Asia/Kolkata", new Date("2026-08-09T10:00:00.000Z"));
    assert.ok(hint);
    assert.match(hint!.title, /IVF|Appointment/i);
    assert.ok(hint!.startIso.includes("2026-08-10") || hint!.startIso.includes("T"));
  });

  it("parses Zingbus travel forward", () => {
    const msg = `
Zingbus Journey Details
PNR: ABC123
Route: Kolhapur to Bangalore
Pickup Date & Time: Aug 10, 2026 11:25 PM
Seat: 12
Pickup Point: Kolhapur Bypass
`;
    const hint = parseTravelForward(msg, "Asia/Kolkata", new Date("2026-08-09T10:00:00.000Z"));
    assert.ok(hint);
    assert.match(hint!.title, /Bus:.*Kolhapur/i);
    assert.ok(hint!.description?.includes("PNR"));
  });

  it("cleans junk calendar titles", () => {
    assert.equal(cleanCalendarDisplayTitle("calendar for"), "Busy");
    assert.equal(cleanCalendarDisplayTitle("Cool, book 1 hour with Rajeev"), "Meeting 1 hour with Rajeev");
  });

  it("detects calendar invite intent and names", () => {
    assert.equal(
      isCalendarInviteIntent("send calendar invite to Rajeev tomorrow at 3pm"),
      true,
    );
    const names = extractInviteeNames("send calendar invite to Rajeev for tomorrow 3pm");
    assert.ok(names.some((n) => /rajeev/i.test(n)));
  });
});
