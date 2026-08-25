import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildMeetingLinkAlertText,
  computeLeaveBy,
  detectTravelConflictsFromCoords,
  extractMeetingUrl,
  haversineKm,
  isOnlineMeeting,
  parseOriginCorrection,
  parsePlaceSetCommand,
  parsePlaceSetCommands,
} from "./travel.js";
import { parseCommitmentCloseCommand } from "./standingCommands.js";

describe("travel helpers", () => {
  it("computes leave_by from travel + buffer", () => {
    const start = new Date("2026-08-10T10:00:00.000Z");
    const leave = computeLeaveBy(start, 30, 10);
    assert.equal(leave.toISOString(), "2026-08-10T09:20:00.000Z");
  });

  it("haversine is symmetric and positive", () => {
    const d = haversineKm(28.7, 77.1, 28.5, 77.2);
    assert.ok(d > 0);
    assert.equal(haversineKm(28.7, 77.1, 28.5, 77.2), d);
  });

  it("flags infeasible back-to-back blocks", () => {
    const a = {
      id: "1",
      title: "A",
      start: new Date("2026-08-10T10:00:00.000Z"),
      end: new Date("2026-08-10T10:30:00.000Z"),
      location: "Place A",
      lat: 28.7,
      lng: 77.1,
    };
    const b = {
      id: "2",
      title: "B",
      start: new Date("2026-08-10T10:45:00.000Z"),
      end: new Date("2026-08-10T11:30:00.000Z"),
      location: "Place B",
      lat: 28.4,
      lng: 77.4,
    };
    const conflicts = detectTravelConflictsFromCoords([a, b]);
    assert.ok(conflicts.length >= 1);
  });

  it("parses place and origin commands", () => {
    assert.deepEqual(parsePlaceSetCommand("home is 12 MG Road Bangalore"), {
      label: "home",
      address: "12 MG Road Bangalore",
    });
    assert.equal(parseOriginCorrection("I'm at home"), "home");
    assert.equal(parseOriginCorrection("I'm at the office"), "office");
  });

  it("parses multiple place lines in one message", () => {
    const multi = parsePlaceSetCommands(
      "home is L&T South City, Arekere\noffice is WeWork Salapuria, Banerghatta Road",
    );
    assert.equal(multi.length, 2);
    assert.equal(multi[0]?.label, "home");
    assert.equal(multi[1]?.label, "office");
  });

  it("extracts Meet/Zoom links and classifies online vs physical", () => {
    assert.equal(
      extractMeetingUrl({ hangoutLink: "https://meet.google.com/abc-defg-hij" }),
      "https://meet.google.com/abc-defg-hij",
    );
    assert.equal(
      extractMeetingUrl({
        location: "Zoom: https://zoom.us/j/123456789",
      }),
      "https://zoom.us/j/123456789",
    );
    assert.equal(
      isOnlineMeeting({ meetingUrl: "https://meet.google.com/abc-defg-hij" }),
      true,
    );
    assert.equal(
      isOnlineMeeting({ location: "LITTLE PEARLS Dental Clinic, Bangalore" }),
      false,
    );
    const text = buildMeetingLinkAlertText({
      title: "Standup",
      start: new Date("2026-08-25T11:00:00.000Z"),
      meetingUrl: "https://meet.google.com/abc-defg-hij",
      timeZone: "UTC",
    });
    assert.match(text, /Standup starts at/);
    assert.match(text, /meet\.google\.com/);
  });
});

describe("commitment close commands", () => {
  it("parses done/drop/snooze", () => {
    assert.deepEqual(parseCommitmentCloseCommand("done Khushi apt"), {
      status: "done",
      titleHint: "Khushi apt",
    });
    assert.equal(parseCommitmentCloseCommand("drop the Practo reminder")?.status, "dropped");
    assert.equal(
      parseCommitmentCloseCommand("snooze bill pay to tomorrow")?.status,
      "snoozed",
    );
    assert.deepEqual(parseCommitmentCloseCommand("done"), {
      status: "done",
      titleHint: "",
    });
    assert.deepEqual(parseCommitmentCloseCommand("that's done"), {
      status: "done",
      titleHint: "",
    });
    assert.deepEqual(parseCommitmentCloseCommand("marked as done"), {
      status: "done",
      titleHint: "",
    });
  });
});
