import {
  formatDiningResearchReply,
  formatFlightResearchReply,
  type LifeOpsOption,
  type LifeOpsResearchIntent,
} from "@amilo/core";
import { MapsClient } from "@amilo/google";

export type LifeOpsResearchResult = {
  text: string;
  options: LifeOpsOption[];
  domain: string;
  query: string;
};

/** Live research for dining (Places) / flights (honest Flights deep link). Never books. */
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
      "I can research dining (Places) and flight search links live; I won't invent prices or book without your yes.",
      "Try: table for 2 tomorrow 8pm near Indiranagar vegetarian — or check flights Bangalore to Mumbai tomorrow.",
    ].join("\n"),
  };
}
