import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  buildDiningHandoffScript,
  domainFromText,
  extractLifeOpsDiningContext,
  formatDiningResearchReply,
  formatFlightResearchReply,
  formatMoneyCapNote,
  formatMovieResearchReply,
  mergeFlightHintsFromChat,
  mergeLifeOpsIntoCalendarText,
  mergeMovieHintsFromChat,
  parseDiningResearchHints,
  parseFlightResearchHints,
  parseInboxErrandDraftAsk,
  parseLifeOpsHandoffIntent,
  parseLifeOpsOptionPick,
  parseLifeOpsResearchIntent,
  parseMoneyCapInr,
  parseMovieResearchHints,
  resolveListedOptionVenue,
  shortMapsSearchUrl,
} from "./lifeOps.js";

describe("lifeOps", () => {
  it("parses money caps", () => {
    assert.equal(parseMoneyCapInr("flights to Goa under 8k"), 8000);
    assert.equal(parseMoneyCapInr("hotel under ₹12,000"), 12000);
  });

  it("parses travel research standing intent", () => {
    const r = parseLifeOpsResearchIntent("check flight from Bangalore to Mumbai for tomorrow");
    assert.ok(r);
    assert.equal(r!.domain, "travel");
    assert.ok(r!.flight);
    assert.equal(r!.flight!.from, "BLR");
    assert.equal(r!.flight!.to, "BOM");
    assert.ok(r!.flight!.googleFlightsUrl?.includes("travel/flights"));
  });

  it("parses table-for-2 dining research", () => {
    const r = parseLifeOpsResearchIntent(
      "Table for 2 tomorrow 8pm near Indiranagar, vegetarian.",
    );
    assert.ok(r);
    assert.equal(r!.domain, "home");
    assert.ok(r!.dining);
    assert.equal(r!.dining!.partySize, 2);
    assert.match(r!.dining!.area ?? "", /Indiranagar/i);
    assert.equal(r!.dining!.vegetarian, true);
  });

  it("routes pub/bar suggests through dining Places", () => {
    const r = parseLifeOpsResearchIntent("suggest an upbeat pub in Indiranagar");
    assert.ok(r);
    assert.equal(r!.domain, "home");
    assert.ok(r!.dining);
    assert.equal(r!.dining!.vibe, "pub");
    assert.match(r!.dining!.searchQuery, /pub/i);
  });

  it("parses movie what's-playing as research not calendar", () => {
    const r = parseLifeOpsResearchIntent("which Hindi movie is running this week");
    assert.ok(r);
    assert.equal(r!.domain, "home");
    assert.ok(r!.movie);
    assert.equal(r!.movie!.mode, "listing");
    assert.equal(r!.movie!.language, "hindi");
  });

  it("parses shows-for follow-up as movie showtimes research", () => {
    const r = parseLifeOpsResearchIntent("shows for this?");
    assert.ok(r);
    assert.ok(r!.movie);
  });

  it("merges BMS url from prior chat for showtimes", () => {
    const base = parseMovieResearchHints("shows for this?")!;
    const merged = mergeMovieHintsFromChat(
      base,
      "https://in.bookmyshow.com/movies/bengaluru/vibe/ET00456789\nVIBE (2026)",
    );
    assert.equal(merged.eventCode, "ET00456789");
    assert.match(merged.bookMyShowUrl ?? "", /vibe/i);
    assert.equal(merged.mode, "showtimes");
  });

  it("formats movie showtimes with closest + book offer", () => {
    const { text, options } = formatMovieResearchReply({
      hints: {
        title: "VIBE",
        eventCode: "ET00456789",
        city: "bengaluru",
        area: "Arekere",
        language: null,
        bookMyShowUrl: "https://in.bookmyshow.com/movies/bengaluru/vibe/ET00456789",
        mode: "showtimes",
      },
      venues: [
        {
          name: "PVR Vega City, Bannerghatta Road",
          distanceKm: 5,
          times: ["4:05 PM", "6:30 PM", "10:15 PM"],
          url: null,
        },
        {
          name: "PVR Forum Mall, Kanakapura Road",
          distanceKm: 8,
          times: ["4:25 PM", "6:50 PM"],
          url: null,
        },
      ],
    });
    assert.ok(options.length >= 2);
    assert.match(text, /Vega City/i);
    assert.match(text, /closest/i);
    assert.match(text, /Want me to book/i);
    assert.doesNotMatch(text, /Reply yes to lock/i);
  });

  it("does not treat calendar book as research", () => {
    assert.equal(parseLifeOpsResearchIntent("book a meeting with Priya tomorrow at 4"), null);
  });

  it("formats dining picks Instant-style with short Maps link", () => {
    const { text, options } = formatDiningResearchReply({
      query: "table for 2 near Indiranagar vegetarian",
      hints: parseDiningResearchHints("table for 2 near Indiranagar vegetarian")!,
      places: [
        {
          name: "Plente",
          address: "80 Feet Rd, Indiranagar",
          rating: 4.6,
          mapsUrl:
            "https://maps.google.com/?cid=8752509999999999999&g_mp=Cidnb29nbGUubWFwcy5wbGFjZXMudjEuUGxhY2VzLlNlYXJ",
        },
        {
          name: "Street Storyss",
          address: "Indiranagar",
          rating: 4.4,
          mapsUrl: "https://maps.example/ss",
        },
      ],
    });
    assert.equal(options.length, 2);
    assert.equal(options[0]!.id, "1");
    assert.match(text, /1\)\s+Plente/);
    assert.match(text, /Reply with a number/i);
    assert.doesNotMatch(text, /Reply yes to lock/i);
    assert.doesNotMatch(text, /cid=/);
    assert.match(text, /Maps: https:\/\/www\.google\.com\/maps\/search/);
    assert.ok(text.length < 900);
  });

  it("resolves numbered pick from recent chat", () => {
    const chat = [
      "Client dinner near MG Road:",
      "1) Kai – Bar & Kitchen — rooftop",
      "2) Rim Naam @ The Oberoi — Thai",
      "3) Yauatcha — Michelin Chinese",
      "Reply with a number to pick.",
    ].join("\n");
    assert.equal(parseLifeOpsOptionPick("2"), "2");
    assert.equal(resolveListedOptionVenue(chat, "2"), "Rim Naam @ The Oberoi");
    const ctx = extractLifeOpsDiningContext(chat, "2");
    assert.equal(ctx!.venue, "Rim Naam @ The Oberoi");
  });

  it("falls back to Maps search link when Places is empty", () => {
    const { text, options } = formatDiningResearchReply({
      query: "table for 2 near Indiranagar vegetarian",
      hints: parseDiningResearchHints("table for 2 near Indiranagar vegetarian")!,
      places: [],
    });
    assert.ok(options.length >= 1);
    assert.match(text, /google\.com\/maps\/search/);
    assert.match(text, /book <name>/i);
  });

  it("formats flight research without inventing fares", () => {
    const hints = parseFlightResearchHints("flights Bangalore to Mumbai tomorrow morning")!;
    const { text } = formatFlightResearchReply({
      query: "flights Bangalore to Mumbai",
      hints,
      moneyCapInr: 8000,
    });
    assert.match(text, /BLR → BOM/);
    assert.match(text, /google\.com\/travel\/flights/i);
    assert.doesNotMatch(text, /6E-123/);
  });

  it("merges flight follow-up from prior chat", () => {
    const merged = mergeFlightHintsFromChat(
      {
        from: null,
        to: null,
        whenHint: null,
        morning: true,
        evening: false,
        googleFlightsUrl: null,
      },
      "Flights BLR → BOM · tomorrow\nI don't invent flight numbers",
    );
    assert.equal(merged.from, "BLR");
    assert.equal(merged.to, "BOM");
    assert.ok(merged.googleFlightsUrl?.includes("morning"));
  });

  it("book named venue is home handoff not flight", () => {
    const h = parseLifeOpsHandoffIntent("Book Burma Burma");
    assert.ok(h);
    assert.equal(h!.domain, "home");
    assert.equal(h!.venueHint, "Burma Burma");
    assert.notEqual(domainFromText("Book Burma Burma"), "travel");
  });

  it("builds dining handoff script with table/time", () => {
    const script = buildDiningHandoffScript({
      venue: "Burma Burma",
      partySize: 2,
      whenHint: "tomorrow 8pm",
      area: "Indiranagar",
    });
    assert.match(script, /table for 2/);
    assert.match(script, /tomorrow 8pm/);
    assert.doesNotMatch(script, /flight/i);
    assert.match(script, /zomato\.com/i);
  });

  it("merges life-ops context into calendar block text", () => {
    const chat = [
      "Pure-veg · near Indiranagar · tomorrow 8pm · table for 2",
      "A) Burma Burma — ★4.5 · Indiranagar",
      "B) MTR — ★4.2",
      "Handoff (reservation): Burma Burma",
    ].join("\n");
    const merged = mergeLifeOpsIntoCalendarText(
      "block calendar and send invite to Mahesh",
      chat,
    );
    assert.match(merged, /8\s*pm/i);
    assert.match(merged, /Burma Burma/i);
    assert.match(merged, /tomorrow/i);
  });

  it("extracts dining context from chat", () => {
    const ctx = extractLifeOpsDiningContext(
      "Dining · near Indiranagar · tomorrow 8pm · table for 2\nA) Biergarten — ★4.3",
      "book Biergarten",
    );
    assert.ok(ctx);
    assert.equal(ctx!.venue, "Biergarten");
    assert.equal(ctx!.partySize, 2);
  });

  it("shortMapsSearchUrl stays short", () => {
    const u = shortMapsSearchUrl("Burma Burma", "Indiranagar");
    assert.ok(u.length < 120);
    assert.match(u, /maps\/search/);
  });

  it("parses book A handoff", () => {
    const h = parseLifeOpsHandoffIntent("book A");
    assert.ok(h);
    assert.equal(h!.optionId, "A");
    assert.equal(h!.channel, "vendor");
  });

  it("parses errand handoff / return", () => {
    const h = parseLifeOpsHandoffIntent("chase the Amazon return for the kettle");
    assert.ok(h);
    assert.equal(h!.domain, "errand");
    assert.equal(h!.channel, "email");
  });

  it("formats money cap note", () => {
    assert.match(formatMoneyCapNote(8000)!, /₹8,000/);
  });

  it("parses inbox errand draft ask", () => {
    const e = parseInboxErrandDraftAsk("draft an email to chase the electricity bill");
    assert.ok(e);
    assert.equal(e!.kind, "bill");
  });
});
