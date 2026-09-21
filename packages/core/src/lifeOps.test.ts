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
  preferLifeOpsNumberPick,
  resolveListedOptionVenue,
  latestDiningThread,
  diningCitySlug,
  buildDiningBookLinks,
  buildCabHandoffScript,
  shortMapsSearchUrl,
  lifeOpsOptionId,
  lifeOpsPickPrompt,
  LIFE_OPS_DEFAULT_SCHEME,
  formatLifeOpsOptionLines,
  optionPickSource,
  classifyOptionListKind,
  coerceOptionPick,
  classifyVendorHandoffKind,
  cleanBookVenueName,
  extractCabContext,
  isWhenPartyFollowUp,
  isWeakLifeOpsHandoffSummary,
  parseCabProvider,
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
    assert.equal(options[0]!.id, "A");
    assert.match(text, /A\)\s+PVR Vega City/i);
    assert.match(text, /closest/i);
    assert.match(text, /Reply with a letter/i);
    assert.match(text, /book <theatre>/i);
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
    assert.equal(options[0]!.id, "A");
    assert.equal(options[1]!.id, "B");
    assert.match(text, /A\)\s+Plente/);
    assert.match(text, /Reply with a letter/i);
    assert.doesNotMatch(text, /Reply yes to lock/i);
    assert.doesNotMatch(text, /cid=/);
    assert.match(text, /Maps: https:\/\/www\.google\.com\/maps\/search/);
    assert.ok(text.length < 900);
  });

  it("supports numeric, alpha, and combo option id schemes", () => {
    assert.equal(LIFE_OPS_DEFAULT_SCHEME, "alpha");
    assert.equal(lifeOpsOptionId(0, "numeric"), "1");
    assert.equal(lifeOpsOptionId(3, "numeric"), "4");
    assert.equal(lifeOpsOptionId(0, "alpha"), "A");
    assert.equal(lifeOpsOptionId(3, "alpha"), "D");
    assert.equal(lifeOpsOptionId(0, "combo"), "A1");
    assert.equal(lifeOpsOptionId(9, "combo"), "B1");
    assert.match(lifeOpsPickPrompt("alpha", 4), /A–D/);
    assert.equal(parseLifeOpsOptionPick("D"), "D");
    assert.equal(parseLifeOpsOptionPick("a1"), "A1");
    assert.equal(parseLifeOpsOptionPick("option B"), "B");
    assert.equal(
      resolveListedOptionVenue("A) Pashtun — kebabs\nD) Katani Dhaba — Punjabi", "D"),
      "Katani Dhaba",
    );
    assert.equal(
      resolveListedOptionVenue("A1) Pashtun — kebabs\nA2) Katani — Punjabi", "A2"),
      "Katani",
    );
  });

  it("splits inline movie/cab letter options onto WhatsApp lines", () => {
    const movie =
      "**Mirzapur showtimes at PVR Elante Mall (today):** A) 7:00 PM — 2h 30m, Hindi. B) 10:15 PM — 2h 30m, Hindi. Book via BookMyShow. Reply with a letter to pick.";
    const movieOut = formatLifeOpsOptionLines(movie);
    assert.match(movieOut, /\*\*Mirzapur showtimes/);
    assert.match(movieOut, /\nA\) 7:00 PM/);
    assert.match(movieOut, /\nB\) 10:15 PM/);
    assert.match(movieOut, /\nReply with a letter to pick/);
    assert.doesNotMatch(movieOut, /A\)[^\n]+B\)/);

    const cab =
      "**BLR airport cabs tomorrow 8 PM for 2:** A) Ola Outstation — ~₹900-1100. B) Uber Intercity — ~₹950-1200. C) Meru Cabs — ~₹1000. Reply with a letter to pick.";
    const cabOut = formatLifeOpsOptionLines(cab);
    assert.match(cabOut, /\nA\) Ola/);
    assert.match(cabOut, /\nB\) Uber/);
    assert.match(cabOut, /\nC\) Meru/);
    assert.doesNotMatch(cabOut, /A\)[^\n]+B\)/);

    // Already vertical — unchanged shape
    const dinner = "Picks\nA) Pashtun — kebabs\nB) Peddlers — vibe\nReply with a letter to pick.";
    assert.equal(formatLifeOpsOptionLines(dinner), dinner);
  });

  it("resolves 4, for 3 people, 8 PM against Chandigarh list — not stale Bangalore handoff", () => {
    const chat = [
      "User: Have to take my client for a dinner near MG road",
      "Amilo: Book links: via Zomato · near MG road",
      "User: suggest good dinner options near Sector 35 Chandigarh for today with family",
      "Amilo: Sector 35 Chandigarh family dinner options: 1) Pashtun — kebabs 2) Refections Cafe — multi 3) Peddlers — vibe 4) Katani Dhaba — Punjabi",
    ].join("\n");
    assert.equal(parseLifeOpsOptionPick("4, for 3 people, 8 PM"), "4");
    assert.equal(resolveListedOptionVenue(latestDiningThread(chat), "4"), "Katani Dhaba");
    const ctx = extractLifeOpsDiningContext(chat, "4, for 3 people, 8 PM");
    assert.equal(ctx!.venue, "Katani Dhaba");
    assert.equal(ctx!.partySize, 3);
    assert.match(ctx!.whenHint ?? "", /8\s*PM/i);
    assert.doesNotMatch(ctx!.area ?? "", /MG road/i);
    assert.match(ctx!.area ?? "", /Sector 35|Chandigarh/i);
    assert.equal(diningCitySlug(ctx!.area), "chandigarh");
    const links = buildDiningBookLinks({
      venue: ctx!.venue!,
      partySize: ctx!.partySize,
      whenHint: ctx!.whenHint,
      area: ctx!.area,
    });
    assert.match(links.zomato, /chandigarh/);
    assert.match(links.zomato, /Katani/);
  });

  it("letter D after dinner list prefers life-ops; FOCUS digits stay mail", () => {
    const chat = [
      "User: suggest dinner near Sector 35 Chandigarh",
      "Amilo: A) Pashtun — kebabs B) Refections Cafe — multi C) Peddlers — vibe D) Katani Dhaba — Punjabi",
      "Reply with a letter to lock one, then day/time.",
    ].join("\n");
    assert.equal(parseLifeOpsOptionPick("D"), "D");
    assert.equal(resolveListedOptionVenue(chat, "D"), "Katani Dhaba");
    assert.equal(
      preferLifeOpsNumberPick({ text: "D", recentChat: chat }),
      true,
    );
    // Legacy numeric lists still divert away from FOCUS.
    assert.equal(
      preferLifeOpsNumberPick({
        text: "4",
        recentChat: [
          "User: dinner options",
          "Amilo: 1) A 2) B 3) C 4) Katani Dhaba — Punjabi",
          "Reply with a number to pick.",
        ].join("\n"),
      }),
      true,
    );
    assert.equal(
      preferLifeOpsNumberPick({
        text: "4",
        recentChat: chat,
        replyToContent: "FOCUS\n1) Invoice from vendor\n2) School PTI",
      }),
      false,
    );
    assert.equal(
      preferLifeOpsNumberPick({
        text: "2",
        recentChat: "User: brief\nAmilo: FOCUS\n1) Mail A\n2) Mail B",
      }),
      false,
    );
  });

  it("binds option picks to the latest list unless the user quoted an older one", () => {
    const chat = [
      "User: brief",
      "Amilo: Good morning.\nFOCUS\n1) Invoice from vendor\n2) School PTI",
      "User: dinner near Sector 35",
      "Amilo: A) Pashtun — kebabs\nB) Katani Dhaba — Punjabi\nReply with a letter to pick.",
      "User: flights to Goa under 8k",
      "Amilo: Flights BLR → GOI\nA) Indigo 6E-6123 — 07:10\nB) Akasa QP-1514 — 09:40\nReply with a letter to pick.",
    ].join("\n");
    const latest = optionPickSource({ recentChat: chat });
    assert.match(latest, /Indigo 6E-6123/);
    assert.equal(classifyOptionListKind(latest), "travel");
    assert.equal(resolveListedOptionVenue(latest, "A"), "Indigo 6E-6123");
    assert.equal(coerceOptionPick("1", latest), "A");
    assert.equal(classifyVendorHandoffKind("A", chat), "travel");
    assert.equal(preferLifeOpsNumberPick({ text: "A", recentChat: chat }), true);
    assert.equal(preferLifeOpsNumberPick({ text: "1", recentChat: chat }), true);
    assert.equal(extractLifeOpsDiningContext(chat, "A")?.venue ?? null, null);

    const quotedDinner =
      "A) Pashtun — kebabs\nB) Katani Dhaba — Punjabi\nReply with a letter to pick.";
    assert.equal(
      resolveListedOptionVenue(
        optionPickSource({ recentChat: chat, replyToContent: quotedDinner }),
        "B",
      ),
      "Katani Dhaba",
    );
    assert.equal(
      preferLifeOpsNumberPick({
        text: "2",
        recentChat: chat,
        replyToContent: "FOCUS\n1) Invoice from vendor\n2) School PTI",
      }),
      false,
    );
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

  it("cab book never becomes Zomato dining handoff", () => {
    assert.equal(cleanBookVenueName("Uber, flight is at 11 PM"), "Uber");
    assert.equal(parseCabProvider("Book Uber, flight is at 11 PM"), "Uber");
    assert.equal(
      classifyVendorHandoffKind("Book Uber, flight is at 11 PM"),
      "cab",
    );
    const chat = [
      "User: suggest dinner near Sector 35",
      "Amilo: D) Katani Dhaba — Punjabi",
      "User: 8 PM today for 3 people",
      "User: need cab from Home to Bangalore airport at 8 PM",
      "Amilo: A) Ola B) Uber Intercity",
      "User: for tomorrow for 2 people",
    ].join("\n");
    assert.equal(classifyVendorHandoffKind("Book Uber, flight is at 11 PM", chat), "cab");
    const cab = extractCabContext(chat, "Book Uber, flight is at 11 PM");
    assert.ok(cab);
    assert.equal(cab!.provider, "Uber");
    assert.equal(cab!.partySize, 2);
    assert.match(cab!.whenHint ?? "", /11\s*PM/i);
    assert.doesNotMatch(cab!.routeHint ?? "", /Katani|Sector 35/i);

    const dining = extractLifeOpsDiningContext(chat, "Book Uber, flight is at 11 PM");
    // Dining thread must not claim Uber as a restaurant venue for Zomato.
    if (dining?.venue) {
      assert.doesNotMatch(dining.venue, /Uber|flight/i);
    }

    const script = buildCabHandoffScript({
      provider: "Uber",
      whenHint: "11 PM",
      partySize: 2,
      routeHint: "Home to Bangalore airport",
    });
    assert.match(script, /m\.uber\.com/i);
    assert.doesNotMatch(script, /zomato|dineout|eazydiner/i);
    assert.doesNotMatch(script, /table for/i);
  });

  it("when/party follow-up detected for dining pending", () => {
    assert.equal(isWhenPartyFollowUp("8 PM today for 3 people"), true);
    assert.equal(isWhenPartyFollowUp("Book Uber"), false);
    assert.equal(isWeakLifeOpsHandoffSummary("life_ops_handoff: life ops"), true);
    assert.equal(isWeakLifeOpsHandoffSummary("Cab: Uber · 2 riders"), false);
  });

  it("builds dining handoff script with table/time", () => {
    const script = buildDiningHandoffScript({
      venue: "Burma Burma",
      partySize: 2,
      whenHint: "tomorrow 8pm",
      area: "Indiranagar",
    });
    assert.match(script, /Burma Burma/);
    assert.match(script, /tomorrow 8pm/);
    assert.match(script, /table for 2/);
    assert.doesNotMatch(script, /flight/i);
    assert.match(script, /zomato\.com/i);
    assert.match(script, /dineout\.co\.in/i);
    assert.match(script, /Open to finish booking/i);
  });

  it("ignores movie chat when extracting dinner when/venue", () => {
    const chat = [
      "User: which good movie is running",
      "Amilo: Hanuman Ansh showtimes today (Sun 20 Sep) — INOX Megaplex Mall of Asia",
      "User: Have to take my client for a dinner near MG road",
      "Amilo: 1) Kai — rooftop\n2) Ebony @ Barton Centre — rooftop",
      "User: Book Ebony",
    ].join("\n");
    const ctx = extractLifeOpsDiningContext(chat, "Book Ebony");
    assert.ok(ctx);
    assert.equal(ctx!.venue, "Ebony");
    assert.equal(ctx!.whenHint, null);
    assert.doesNotMatch(ctx!.venue ?? "", /INOX/i);
  });

  it("does not treat book via Zomato as a venue handoff", () => {
    assert.equal(parseLifeOpsHandoffIntent("Book via Zomato"), null);
  });

  it("merges life-ops context into calendar block text", () => {
    const chat = [
      "User: table for 2 near Indiranagar tomorrow 8pm vegetarian",
      "Amilo: Pure-veg · near Indiranagar · tomorrow 8pm · table for 2",
      "Amilo: A) Burma Burma — ★4.5 · Indiranagar",
      "Amilo: B) MTR — ★4.2",
      "Amilo: Handoff (reservation): Burma Burma",
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
