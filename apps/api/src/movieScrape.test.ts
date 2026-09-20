import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { haversineKm, parseShowtimeHtml } from "./movieScrape.js";

describe("movieScrape", () => {
  it("parses venue + times from __NEXT-style JSON blob", () => {
    const html = `"venues":[{"name":"PVR Vega City, Bannerghatta Road","showTimes":[{"showTime":"4:05 PM"},{"showTime":"6:30 PM"},{"showTime":"10:15 PM"}]}]`;
    const venues = parseShowtimeHtml(
      html,
      "https://in.bookmyshow.com/movies/bengaluru/vibe/ET1",
    );
    assert.equal(venues.length, 1);
    assert.match(venues[0]!.name, /Vega/i);
    assert.ok(venues[0]!.times.length >= 2);
  });

  it("haversine is ~5km for nearby points", () => {
    const a = { lat: 12.889, lng: 77.597 };
    const b = { lat: 12.912, lng: 77.607 };
    const km = haversineKm(a, b);
    assert.ok(km > 1 && km < 10);
  });
});
