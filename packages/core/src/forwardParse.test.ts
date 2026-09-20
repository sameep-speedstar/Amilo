import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  cleanCalendarDisplayTitle,
  extractInviteeNames,
  isCalendarInviteIntent,
  parseAppointmentForward,
  parseFlightForward,
  parseHotelForward,
  parseTrainForward,
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
    const hold = extractInviteeNames(
      "block sameep bansals calendar for dental appointment tomorrow 1-4 pm",
    );
    assert.ok(hold.some((n) => /sameep/i.test(n)));
    const fwd = extractInviteeNames("And forward to sameep bansal as well");
    assert.ok(fwd.some((n) => /sameep/i.test(n)));
  });

  it("parses flight e-ticket forward", () => {
    const msg = `
Indigo e-ticket
PNR: AB3C4D
Flight 6E 204 DEL → GOI
Departure: Aug 12, 2026 09:15 AM
Boarding gate TBA
`;
    const hint = parseFlightForward(msg, "Asia/Kolkata", new Date("2026-08-10T10:00:00.000Z"));
    assert.ok(hint);
    assert.match(hint!.title, /Flight/i);
    assert.match(hint!.description ?? "", /Leave-by/i);
  });

  it("parses hotel check-in forward", () => {
    const msg = `
Booking.com confirmation
Hotel: Taj Holiday Village
Check-in: Sep 20, 2026 2:00 PM
Confirmation number: HX991122
`;
    const hint = parseHotelForward(msg, "Asia/Kolkata", new Date("2026-09-01T10:00:00.000Z"));
    assert.ok(hint);
    assert.match(hint!.title, /Hotel/i);
  });

  it("parses train PNR forward", () => {
    const msg = `
IRCTC
PNR: 1234567890
Train number: 12627
From SBC to MAS
Departure: Oct 5, 2026 06:00 AM
Coach: A1 Berth: 12
`;
    const hint = parseTrainForward(msg, "Asia/Kolkata", new Date("2026-10-01T10:00:00.000Z"));
    assert.ok(hint);
    assert.match(hint!.title, /Train/i);
  });
});
