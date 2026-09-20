import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parsePlan, zonedLocalToUtc } from "./parsePlan.js";

describe("parsePlan", () => {
  it("reads Amilo JSON queue", () => {
    const items = parsePlan(
      JSON.stringify([
        {
          date: "2026-09-21",
          platforms: ["x"],
          hook: "Most things",
          copy: { x: "Most things don't deserve your attention." },
        },
        {
          date: "2026-09-21",
          platforms: ["instagram"],
          copy: { instagram: "Link in bio." },
        },
      ]),
    );
    assert.equal(items.length, 1);
    assert.equal(items[0]?.copy.x?.includes("deserve"), true);
    assert.equal(items[0]?.copy.instagram, "Link in bio.");
  });

  it("reads pipe lines", () => {
    const items = parsePlan(`2026-09-22 | twitter | Quiet is the product.
2026-09-22 | ig | Same idea, longer caption.`);
    assert.equal(items.length, 1);
    assert.ok(items[0]?.copy.x);
    assert.ok(items[0]?.copy.instagram);
  });

  it("reads markdown headings", () => {
    const items = parsePlan(`# 2026-10-01 16:00
## linkedin
Leave-by is part of the brief.

## x
Calendars don't know Bangalore traffic.`);
    assert.equal(items.length, 1);
    assert.equal(items[0]?.time, "16:00");
    assert.ok(items[0]?.copy.linkedin);
    assert.ok(items[0]?.copy.x);
  });
});

describe("zonedLocalToUtc", () => {
  it("maps 09:30 IST to 04:00 UTC", () => {
    const d = zonedLocalToUtc("2026-09-21", "09:30", "Asia/Kolkata");
    assert.equal(d.toISOString(), "2026-09-21T04:00:00.000Z");
  });
});
