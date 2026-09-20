import {
  formatDiningResearchReply,
  formatFlightResearchReply,
  formatMovieResearchReply,
  type LifeOpsOption,
  type LifeOpsResearchIntent,
  type MovieShowVenue,
} from "@amilo/core";
import { MapsClient } from "@amilo/google";
import {
  haversineKm,
  scrapeBookMyShowListing,
  scrapeBookMyShowShowtimes,
} from "./movieScrape.js";

export type LifeOpsResearchResult = {
  text: string;
  options: LifeOpsOption[];
  domain: string;
  query: string;
};

/** Live research for dining (Places) / flights / movies. Never books. */
export async function runLifeOpsResearch(opts: {
  intent: LifeOpsResearchIntent;
  mapsApiKey?: string | null;
}): Promise<LifeOpsResearchResult> {
  const { intent } = opts;
  const maps = opts.mapsApiKey ? new MapsClient(opts.mapsApiKey) : null;

  if (intent.dining) {
    if (!maps) {
      return {
        domain: intent.domain,
        query: intent.query,
        options: [],
        text: [
          "Maps isn't configured (GOOGLE_MAPS_API_KEY), so I can't pull live restaurant picks yet.",
          "Once set, asks like “table for 2 near Indiranagar vegetarian” return real Places results.",
          "I still won't reserve without your yes.",
        ].join("\n"),
      };
    }
    const hits = await maps.searchPlaces(intent.dining.searchQuery, { limit: 5 });
    const isPub = intent.dining.vibe === "pub";
    // Prefer food / bar establishments when the API returns mixed results.
    const foodish = hits.filter(
      (h) =>
        h.types.some((t) =>
          isPub
            ? /bar|night_club|restaurant|food|cafe|meal_takeaway/i.test(t)
            : /restaurant|food|cafe|bakery|meal_takeaway|meal_delivery/i.test(t),
        ) || !h.types.length,
    );
    const places = (foodish.length ? foodish : hits).slice(0, 3).map((h) => ({
      name: h.name,
      address: h.address,
      rating: h.rating,
      // Short search URLs only — long Place URIs truncate on WhatsApp.
      mapsUrl: null as string | null,
    }));
    const formatted = formatDiningResearchReply({
      query: intent.query,
      hints: intent.dining,
      places,
    });
    return {
      domain: intent.domain,
      query: intent.query,
      text: formatted.text,
      options: formatted.options,
    };
  }

  if (intent.movie) {
    return runMovieResearch(intent, maps);
  }

  if (intent.flight || intent.domain === "travel") {
    const hints =
      intent.flight ??
      ({
        from: null,
        to: null,
        whenHint: null,
        morning: false,
        evening: false,
        googleFlightsUrl: null,
      } as const);
    const formatted = formatFlightResearchReply({
      query: intent.query,
      hints: {
        from: hints.from,
        to: hints.to,
        whenHint: hints.whenHint,
        morning: hints.morning,
        evening: hints.evening,
        googleFlightsUrl: hints.googleFlightsUrl,
      },
      moneyCapInr: intent.moneyCapInr,
    });
    return {
      domain: intent.domain,
      query: intent.query,
      text: formatted.text,
      options: formatted.options,
    };
  }

  // Generic fallback — no invented facts.
  return {
    domain: intent.domain,
    query: intent.query,
    options: [],
    text: [
      `Got it: ${intent.query.slice(0, 160)}`,
      "I can research dining (Places), flights, and movie showtimes live; I won't invent prices or book without your yes.",
      "Try: table for 2 near Indiranagar — flights Bangalore to Mumbai — or which Hindi movie is running this week.",
    ].join("\n"),
  };
}

async function runMovieResearch(
  intent: LifeOpsResearchIntent,
  maps: MapsClient | null,
): Promise<LifeOpsResearchResult> {
  const hints = intent.movie!;
  const bmsUrl =
    hints.bookMyShowUrl ??
    (hints.eventCode && hints.title
      ? `https://in.bookmyshow.com/movies/${hints.city}/${hints.title.toLowerCase().replace(/\s+/g, "-")}/${hints.eventCode}`
      : `https://in.bookmyshow.com/explore/movies-${hints.city}`);

  if (hints.mode === "listing") {
    const scraped = await scrapeBookMyShowListing(hints.city, hints.language);
    const formatted = formatMovieResearchReply({
      hints: { ...hints, bookMyShowUrl: bmsUrl },
      venues: [],
      ...(scraped.length ? { listingLines: scraped.map((t, i) => `${String.fromCharCode(65 + i)}) ${t}`) } : {}),
    });
    return {
      domain: intent.domain,
      query: intent.query,
      text: formatted.text,
      options: formatted.options,
    };
  }

  // Showtimes: try public scrape (often 403) + nearby cinemas from Places for closest.
  const [scraped, nearby] = await Promise.all([
    hints.bookMyShowUrl || hints.eventCode
      ? scrapeBookMyShowShowtimes(bmsUrl)
      : Promise.resolve([]),
    maps ? nearbyCinemas(maps, hints.area, hints.city) : Promise.resolve([]),
  ]);

  const venues: MovieShowVenue[] = mergeVenuesWithDistance(scraped, nearby);
  const formatted = formatMovieResearchReply({
    hints: { ...hints, bookMyShowUrl: bmsUrl },
    venues,
  });
  return {
    domain: intent.domain,
    query: intent.query,
    text: formatted.text,
    options: formatted.options,
  };
}

async function nearbyCinemas(
  maps: MapsClient,
  area: string | null,
  city: string,
): Promise<Array<{ name: string; distanceKm: number | null; url: string | null }>> {
  const where = [area, city === "bengaluru" ? "Bengaluru" : city]
    .filter(Boolean)
    .join(" ");
  const origin = await maps.geocode(where || "Bengaluru");
  const hits = await maps.searchPlaces(`cinema movie theatre ${where}`.trim(), {
    limit: 6,
    ...(origin ? { location: origin, radiusMeters: 12_000 } : {}),
  });
  const cinemas = hits.filter(
    (h) =>
      h.types.some((t) => /movie_theater|cinema/i.test(t)) ||
      /\b(pvr|inox|cinepolis|miraj|carnival|theatre|theater|cinema)\b/i.test(h.name),
  );
  const list = (cinemas.length ? cinemas : hits).slice(0, 5);
  return list.map((h) => {
    let distanceKm: number | null = null;
    if (origin && h.location) {
      distanceKm = Math.round(haversineKm(origin, h.location) * 10) / 10;
    }
    return {
      name: h.name,
      distanceKm,
      url: null as string | null,
    };
  });
}

function mergeVenuesWithDistance(
  scraped: Array<{ name: string; times: string[]; url: string | null }>,
  nearby: Array<{ name: string; distanceKm: number | null; url: string | null }>,
): MovieShowVenue[] {
  if (!scraped.length && !nearby.length) return [];

  if (scraped.length) {
    return scraped.map((s) => {
      const match = nearby.find((n) => softNameMatch(n.name, s.name));
      return {
        name: s.name,
        times: s.times,
        distanceKm: match?.distanceKm ?? null,
        url: s.url,
      };
    });
  }

  // No scrape (typical BMS 403) — list closest cinemas; times via BMS link in formatter.
  return nearby.map((n) => ({
    name: n.name,
    times: [] as string[],
    distanceKm: n.distanceKm,
    url: n.url,
  }));
}

function softNameMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/\b(pvr|inox|cinepolis|cinemas?|theatre|theater)\b/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const na = norm(a);
  const nb = norm(b);
  if (!na || !nb) return false;
  return na.includes(nb) || nb.includes(na);
}
