import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { allowGenericSite, BOOKING_ALLOWLIST, spendCapFor } from "./allowlist.js";

describe("booking allowlist / general sites", () => {
  it("lists grocery dining ticketing merchants", () => {
    const verticals = new Set(BOOKING_ALLOWLIST.map((e) => e.vertical));
    assert.ok(verticals.has("grocery"));
    assert.ok(verticals.has("dining"));
    assert.ok(verticals.has("ticketing"));
  });

  it("gates generic any-site behind flag", () => {
    assert.equal(allowGenericSite(false), false);
    assert.equal(allowGenericSite(true), true);
  });

  it("has spend caps", () => {
    assert.ok(spendCapFor("zepto") > 0);
    assert.ok(spendCapFor("bookmyshow") > 0);
  });
});
