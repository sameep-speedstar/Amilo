import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildInboundConflictAlert,
  findInboundInviteConflicts,
  isInboundInviteCandidate,
} from "./inboundConflict.js";
import { zonedLocalDateTime } from "./time.js";

describe("inbound calendar conflicts", () => {
  const tz = "Asia/Kolkata";

  it("flags needsAction invites as inbound", () => {
    assert.equal(
      isInboundInviteCandidate({
        eventId: "1",
        title: "Test",
        start: new Date(),
        end: new Date(),
        selfResponseStatus: "needsAction",
        accountEmail: "me@x.com",
        organizerEmail: "them@x.com",
      }),
      true,
    );
  });

  it("skips self-organized blocks", () => {
    assert.equal(
      isInboundInviteCandidate({
        eventId: "1",
        title: "Pickup",
        start: new Date(),
        end: new Date(),
        accountEmail: "me@x.com",
        organizerEmail: "me@x.com",
        selfResponseStatus: "accepted",
      }),
      false,
    );
  });

  it("detects overlap and builds alert with alternate", () => {
    const pickupStart = zonedLocalDateTime(tz, "2026-08-12", 16, 0);
    const pickupEnd = zonedLocalDateTime(tz, "2026-08-12", 16, 30);
    const meetStart = zonedLocalDateTime(tz, "2026-08-12", 16, 0);
    const meetEnd = zonedLocalDateTime(tz, "2026-08-12", 17, 0);
    const now = zonedLocalDateTime(tz, "2026-08-12", 10, 0);

    const hits = findInboundInviteConflicts(
      [
        {
          eventId: "pickup",
          title: "Pickup",
          start: pickupStart,
          end: pickupEnd,
          accountEmail: "me@x.com",
          organizerEmail: "me@x.com",
          selfResponseStatus: "accepted",
        },
        {
          eventId: "invite",
          title: "Test meeting",
          start: meetStart,
          end: meetEnd,
          accountEmail: "me@x.com",
          organizerEmail: "boss@acme.com",
          selfResponseStatus: "needsAction",
        },
      ],
      tz,
      now,
    );
    assert.equal(hits.length, 1);
    assert.equal(hits[0]!.invite.eventId, "invite");
    assert.match(hits[0]!.blockers[0]!.title, /Pickup/i);

    const body = buildInboundConflictAlert(hits[0]!, tz);
    assert.match(body, /boss@acme\.com/i);
    assert.match(body, /Test meeting/i);
    assert.match(body, /Pickup/i);
    assert.match(body, /yes/i);
    assert.match(body, /alternate/i);
    assert.match(body, /decline/i);
  });
});
