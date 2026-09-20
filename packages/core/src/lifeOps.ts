/**
 * Life ops — live research for dining/travel; handoff/book still confirm-first.
 * Never spend / send / book without explicit yes.
 */

export type LifeOpsDomain = "travel" | "errand" | "home";

export type LifeOpsResearchIntent = {
  domain: LifeOpsDomain;
  query: string;
  moneyCapInr: number | null;
  /** Filled by live research when available; stubs only as fallback. */
  options: LifeOpsOption[];
  /** Dining / flight / movie structured hints for the research runner. */
  dining?: DiningResearchHints;
  flight?: FlightResearchHints;
  movie?: MovieResearchHints;
};

export type LifeOpsOption = {
  id: string;
  label: string;
  detail: string;
  estInr: number | null;
  url?: string;
};

export type DiningResearchHints = {
  area: string | null;
  partySize: number | null;
  whenHint: string | null;
  vegetarian: boolean;
  /** restaurant | pub — drives Places query + type filter. */
  vibe: "restaurant" | "pub";
  searchQuery: string;
};

/** Context carried from research → book → handoff / calendar. */
export type LifeOpsDiningContext = {
  venue: string | null;
  partySize: number | null;
  whenHint: string | null;
  area: string | null;
  vegetarian: boolean;
  vibe: "restaurant" | "pub";
};

export type FlightResearchHints = {
  from: string | null;
  to: string | null;
  whenHint: string | null;
  morning: boolean;
  evening: boolean;
  googleFlightsUrl: string | null;
};

/** Movies / showtimes — research only; booking is a separate explicit ask. */
export type MovieResearchHints = {
  title: string | null;
  eventCode: string | null;
  city: string;
  area: string | null;
  language: string | null;
  bookMyShowUrl: string | null;
  /** listing = what's playing; showtimes = times for a title/url */
  mode: "listing" | "showtimes";
};

export type MovieShowVenue = {
  name: string;
  distanceKm: number | null;
  times: string[];
  url: string | null;
};

export type LifeOpsHandoffIntent = {
  domain: LifeOpsDomain;
  channel: "email" | "calendar" | "vendor" | "note";
  summary: string;
  email?: { toHint: string | null; subject: string; body: string };
  calendar?: { title: string; whenHint: string };
  moneyCapInr: number | null;
  optionId?: string;
  venueHint?: string;
};

/** Resolve "2" / "option 2" / "book 2" against a numbered or A–E list in recent chat. */
export function parseLifeOpsOptionPick(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 40) return null;
  const m =
    t.match(/^(?:option|pick|choose|book|reserve|handoff|hand\s*off)\s*([1-9A-Ea-e])\b/i)?.[1] ??
    t.match(/^([1-9A-Ea-e])\s*[).:\-]?\s*$/i)?.[1] ??
    t.match(/^([1-9])\b/i)?.[1];
  if (!m) return null;
  return /^[1-9]$/.test(m) ? m : m.toUpperCase();
}

/**
 * Pull venue label from Amilo's numbered / lettered option list in recent chat.
 * Supports: `1) Name`, `1. **Name**`, `A) Name — detail`
 */
export function resolveListedOptionVenue(
  recentChat: string | null | undefined,
  optionId: string,
): string | null {
  const chat = (recentChat ?? "").trim();
  if (!chat || !optionId) return null;
  const id = optionId.trim();
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(
      `(?:^|[^0-9A-Za-z])${esc}\\)\\s+\\*{0,2}([^*\\n—\\-]+?)\\*{0,2}(?:\\s*[—\\-]|\\s*$|\\s*\\()`,
      "i",
    ),
    new RegExp(
      `(?:^|[^0-9A-Za-z])${esc}[.:]\\s+\\*{0,2}([^*\\n—\\-]+?)\\*{0,2}`,
      "i",
    ),
  ];
  for (const re of patterns) {
    const hit = chat.match(re)?.[1]?.replace(/\*+/g, "").trim();
    if (hit && hit.length >= 2 && !isBookPlatformOnly(hit)) return hit.slice(0, 80);
  }
  return null;
}

const MONEY_CAP_RE =
  /(?:under|below|max(?:imum)?|cap(?:ped)?(?:\s+at)?|budget(?:\s+of)?|upto|up to)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand)?/i;
const RUPEE_RE = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|thousand)?/i;

const CITY_AIRPORTS: Record<string, string> = {
  bangalore: "BLR",
  bengaluru: "BLR",
  mumbai: "BOM",
  bombay: "BOM",
  delhi: "DEL",
  "new delhi": "DEL",
  hyderabad: "HYD",
  chennai: "MAA",
  kolkata: "CCU",
  pune: "PNQ",
  goa: "GOI",
};

export function parseMoneyCapInr(text: string): number | null {
  const m = text.match(MONEY_CAP_RE) ?? text.match(RUPEE_RE);
  if (!m?.[1]) return null;
  let n = Number(String(m[1]).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (m[2]) n *= 1000;
  return Math.round(n);
}

export function formatMoneyCapNote(cap: number | null | undefined): string | null {
  if (cap == null || !(cap > 0)) return null;
  return `Money cap: ₹${cap.toLocaleString("en-IN")} — I will not spend or book above this without a fresh yes.`;
}

export function domainFromText(t: string): LifeOpsDomain {
  if (
    /\b(flight|flights|hotel|hotels|train|trains|indigo|airbnb|booking\.com|airport|leave[- ]?by|blr|bom)\b/i.test(
      t,
    ) ||
    /\bfrom\s+\w+.+\bto\s+\w+/i.test(t)
  ) {
    return "travel";
  }
  if (
    /\b(bill|subscription|return|refund|chase|invoice|appointment|renewal|cancel (my |the )?sub)\b/i.test(
      t,
    )
  ) {
    return "errand";
  }
  if (
    /\b(school|pti|vendor|plumber|electrician|handyman|reservation|restaurant|table for|dinner|lunch|brunch|vegetarian|vegan|pickup|nanny|maid|pub|pubs|bar|bars|biergarten|drinks|hangout|movie|movies|cinema|showtimes?|film|films)\b/i.test(
      t,
    )
  ) {
    return "home";
  }
  // Named book/reserve without travel keywords → home (not "flight option").
  if (/\b(book|reserve)\b/i.test(t)) return "home";
  return "travel";
}

/** Short Maps search URL — safe for WhatsApp (no long place cid / gmm params). */
export function shortMapsSearchUrl(
  nameOrQuery: string,
  area?: string | null,
): string {
  const areaBit = area?.trim() || "";
  const hasCity =
    /\b(bangalore|bengaluru|chandigarh|mumbai|delhi|hyderabad|chennai|pune)\b/i.test(
      `${nameOrQuery} ${areaBit}`,
    );
  const q = [nameOrQuery.trim(), areaBit, hasCity ? null : "Bangalore"]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function zomatoSearchUrl(venue: string, city = "bangalore"): string {
  return `https://www.zomato.com/${city}/restaurants?q=${encodeURIComponent(venue.trim().slice(0, 80))}`;
}

/** Best-effort dining book deep links (platform search / open). Exact slot fill needs partner IDs. */
export function buildDiningBookLinks(opts: {
  venue: string;
  partySize?: number | null;
  whenHint?: string | null;
  area?: string | null;
  city?: string;
}): { zomato: string; dineout: string; eazydiner: string; maps: string } {
  const city = opts.city ?? diningCitySlug(opts.area) ?? "bangalore";
  const venue = opts.venue.trim().slice(0, 80);
  const qParts = [venue];
  if (opts.partySize && opts.partySize > 0) qParts.push(`table for ${opts.partySize}`);
  if (opts.whenHint?.trim()) qParts.push(opts.whenHint.trim());
  if (opts.area?.trim()) qParts.push(opts.area.trim());
  const q = qParts.join(" ").slice(0, 120);
  const mapsArea = [opts.area, city !== "bangalore" ? city : "Bangalore"].filter(Boolean).join(" ");
  return {
    zomato: `https://www.zomato.com/${city}/restaurants?q=${encodeURIComponent(q)}`,
    dineout: `https://www.dineout.co.in/${city}-restaurants?search=${encodeURIComponent(venue)}`,
    eazydiner: `https://www.eazydiner.com/${city}/search?query=${encodeURIComponent(venue)}`,
    maps: shortMapsSearchUrl(venue, mapsArea || opts.area),
  };
}

/** BMS buytickets URL when we have an ET code + YYYYMMDD the user actually stated (or ISO day). */
export function buildBookMyShowBuyLink(opts: {
  citySlug?: string;
  movieSlug?: string;
  eventCode: string;
  dateYmd: string;
}): string {
  const city = opts.citySlug ?? "bengaluru";
  const slug = (opts.movieSlug ?? "movie").replace(/[^a-z0-9-]/gi, "-").toLowerCase();
  const day = opts.dateYmd.replace(/-/g, "").slice(0, 8);
  return `https://in.bookmyshow.com/movies/${city}/${slug}/buytickets/${opts.eventCode}/${day}`;
}

const MOVIE_LINE_RE =
  /\b(bookmyshow|showtimes?|IMDb|film|films|PVR|INOX|Cinepolis|buytickets|ET\d{5,}|\bshows?\b|movie|cinema)\b/i;
const DINING_LINE_RE =
  /\b(dinner|lunch|brunch|restaurant|dining|zomato|eazydiner|dineout|table for|rooftop|fine dining|client dinner|pubs?|brewery)\b/i;

/** Prefer the latest dining ask + replies (avoids MG Road leaking into Chandigarh). */
export function latestDiningThread(chat: string | null | undefined): string {
  const full = (chat ?? "").trim();
  if (!full) return "";
  const lines = full.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (
      /^User:/i.test(line) &&
      /\b(dinner|lunch|brunch|restaurant|dining|table|zomato|eazydiner|dineout|family dinner|client dinner)\b/i.test(
        line,
      )
    ) {
      start = i;
    }
  }
  if (start < 0) return scopeChatToDining(full);
  return scopeChatToDining(lines.slice(start).join("\n"));
}

export function diningCitySlug(areaOrText?: string | null): string {
  const t = (areaOrText ?? "").toLowerCase();
  if (/chandigarh|mohali|panchkula|sector\s*\d+/i.test(t)) return "chandigarh";
  if (/\bmumbai\b|\bbombay\b/i.test(t)) return "mumbai";
  if (/\bdelhi\b|\bgurgaon\b|\bnoida\b|\bncr\b/i.test(t)) return "ncr";
  if (/\bhyderabad\b/i.test(t)) return "hyderabad";
  if (/\bchennai\b/i.test(t)) return "chennai";
  if (/\bpune\b/i.test(t)) return "pune";
  return "bangalore";
}

export function parsePartySize(text: string | null | undefined): number | null {
  if (!text?.trim()) return null;
  const n =
    Number(text.match(/\btable for\s+(\d{1,2})\b/i)?.[1]) ||
    Number(text.match(/\bfor\s+(\d{1,2})\s+(?:people|guests|of us|pax)\b/i)?.[1]) ||
    Number(text.match(/\b(\d{1,2})\s+people\b/i)?.[1]) ||
    0;
  return n > 0 && n < 50 ? n : null;
}

/** Bare "4" after a dinner list must not steal FOCUS mail numbering. */
export function preferLifeOpsNumberPick(opts: {
  text: string;
  recentChat?: string | null;
  replyToContent?: string | null;
}): boolean {
  const pickId = parseLifeOpsOptionPick(opts.text);
  if (!pickId) return false;
  const reply = opts.replyToContent?.trim() ?? "";
  // Quoted morning FOCUS brief → keep mail numbering.
  if (reply && /\bFOCUS\b/i.test(reply) && !DINING_LINE_RE.test(reply)) {
    return false;
  }
  if (reply && DINING_LINE_RE.test(reply) && resolveListedOptionVenue(reply, pickId)) {
    return true;
  }
  const chat = opts.recentChat ?? "";
  // FOCUS-only brief without dining → never divert digits to life-ops.
  if (/\bFOCUS\b/i.test(chat) && !DINING_LINE_RE.test(chat)) {
    return false;
  }
  if (!DINING_LINE_RE.test(chat)) return false;
  const thread = latestDiningThread(chat);
  if (resolveListedOptionVenue(thread, pickId)) return true;
  return Boolean(resolveListedOptionVenue(chat, pickId));
}

/** Drop movie/cinema lines so dinner handoff never inherits showtimes / invented "today". */
export function scopeChatToDining(chat: string | null | undefined): string {
  if (!chat?.trim()) return "";
  return chat
    .split("\n")
    .filter((line) => {
      if (MOVIE_LINE_RE.test(line) && !DINING_LINE_RE.test(line)) return false;
      return true;
    })
    .join("\n");
}

/** Prefer when/party from the user's own lines + current message — never from Amilo invented dates. */
export function extractUserStatedWhen(
  recentChat: string | null | undefined,
  bookText?: string | null,
): string | null {
  const book = (bookText ?? "").trim();
  const fromBook =
    book.match(/\b(tomorrow|today|tonight)\b[^.]{0,60}/i)?.[0]?.trim() ??
    book.match(
      /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[^.]{0,40}\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i,
    )?.[0]?.trim() ??
    book.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i)?.[0]?.trim() ??
    book.match(/\b\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?\b/)?.[0]?.trim() ??
    null;
  if (fromBook) return fromBook.slice(0, 80);

  const userLines = (recentChat ?? "")
    .split("\n")
    .filter((l) => /^User:/i.test(l))
    .join("\n");
  if (!userLines) return null;
  return (
    userLines.match(/\b(tomorrow|today|tonight)\b[^.]{0,60}/i)?.[0]?.trim() ??
    userLines.match(
      /\b(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*\b[^.]{0,40}\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i,
    )?.[0]?.trim() ??
    userLines.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i)?.[0]?.trim() ??
    null
  )?.slice(0, 80) ?? null;
}

const BOOK_PLATFORM_ONLY_RE =
  /^(?:via|on|using|with|through)?\s*(?:zomato|eazy\s*diner|dineout|book\s*my\s*show|bms|maps)\s*$/i;

export function isBookPlatformOnly(name: string | null | undefined): boolean {
  return Boolean(name && BOOK_PLATFORM_ONLY_RE.test(name.trim()));
}

export function parseDiningResearchHints(text: string): DiningResearchHints | null {
  const t = text.trim();
  const isPub =
    /\b(pub|pubs|bar|bars|biergarten|nightlife|drinks|cocktail|brewery|taproom)\b/i.test(t) ||
    /\bupbeat\b/i.test(t);
  const isDining =
    /\b(table|restaurant|dinner|lunch|brunch|dine|reservation|cafe|eatery)\b/i.test(t) ||
    /\bvegetarian|vegan\b/i.test(t) ||
    isPub;
  if (!isDining) return null;

  const party =
    Number(t.match(/\btable for\s+(\d{1,2})\b/i)?.[1]) ||
    Number(t.match(/\bfor\s+(\d{1,2})\s+(?:people|guests|of us)\b/i)?.[1]) ||
    null;
  const area =
    t.match(/\bnear\s+([A-Za-z][A-Za-z0-9 .'-]{2,40}?)(?:\s*,|\s+tomorrow|\s+today|\s+at\b|,|$)/i)?.[1]?.trim() ??
    t.match(/\bin\s+([A-Za-z][A-Za-z0-9 .'-]{2,40}?)(?:\s*,|\s+tomorrow|\s+today|\s+at\b|,|$)/i)?.[1]?.trim() ??
    null;
  const whenHint =
    t.match(/\b(tomorrow|today|tonight)\b[^.]{0,80}/i)?.[0]?.trim() ??
    t.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i)?.[0]?.trim() ??
    null;
  const vegetarian = /\b(vegetarian|veggie|pure[- ]?veg|vegan)\b/i.test(t);
  const vibe: "restaurant" | "pub" = isPub && !vegetarian ? "pub" : "restaurant";
  const kind =
    vibe === "pub"
      ? "upbeat pubs bars"
      : vegetarian
        ? "vegetarian restaurants"
        : "restaurants";
  const bits = [kind, area, "Bangalore"].filter(Boolean);
  return {
    area,
    partySize: party && party > 0 ? party : null,
    whenHint,
    vegetarian,
    vibe,
    searchQuery: bits.join(" "),
  };
}

function cityToAirport(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim().toLowerCase();
  if (/^[a-z]{3}$/i.test(t)) return t.toUpperCase();
  return CITY_AIRPORTS[t] ?? null;
}

export function parseFlightResearchHints(text: string): FlightResearchHints | null {
  const t = text.trim();
  if (!/\bflight|flights|fly\b/i.test(t) && !/\b(blr|bom|del|hyd|maa)\b/i.test(t)) {
    return null;
  }
  const fromTo =
    t.match(/\bfrom\s+([A-Za-z .]{2,40}?)\s+to\s+([A-Za-z .]{2,40}?)(?:\s+for|\s+tomorrow|\s+today|\s+under|\s+on|,|$)/i) ??
    t.match(/\b([A-Za-z]{3,})\s*(?:→|->|to)\s*([A-Za-z]{3,})\b/i);
  let from = fromTo?.[1]?.trim() ?? null;
  let to = fromTo?.[2]?.trim() ?? null;
  if (!from || !to) {
    // "flight Bangalore to Mumbai"
    const loose = t.match(
      /\b(?:flight|flights|fly)\s+(?:from\s+)?([A-Za-z .]{3,40}?)\s+to\s+([A-Za-z .]{3,40}?)(?:\s+for|\s+tomorrow|\s+today|,|$)/i,
    );
    from = loose?.[1]?.trim() ?? from;
    to = loose?.[2]?.trim() ?? to;
  }
  const fromCode = cityToAirport(from) ?? from?.toUpperCase() ?? null;
  const toCode = cityToAirport(to) ?? to?.toUpperCase() ?? null;
  const whenHint =
    t.match(/\b(tomorrow|today|tonight|next\s+\w+)\b/i)?.[0]?.trim() ?? null;
  const morning = /\bmorning\b/i.test(t) || /\bearly\b/i.test(t);
  const evening = /\bevening\b/i.test(t) || /\bnight\b/i.test(t);

  let googleFlightsUrl: string | null = null;
  if (fromCode && toCode && fromCode.length === 3 && toCode.length === 3) {
    // Soft date: tomorrow → leave Google Flights to resolve "one-way" search string.
    const q = encodeURIComponent(
      `Flights from ${fromCode} to ${toCode}${whenHint ? ` ${whenHint}` : ""}${morning ? " morning" : ""}${evening ? " evening" : ""}`,
    );
    googleFlightsUrl = `https://www.google.com/travel/flights?q=${q}&curr=INR`;
  }

  return {
    from: fromCode,
    to: toCode,
    whenHint,
    morning,
    evening,
    googleFlightsUrl,
  };
}

/** Merge route/time from prior chat when follow-up is "option A / morning flight". */
export function mergeFlightHintsFromChat(
  hints: FlightResearchHints,
  recentChat: string | null | undefined,
): FlightResearchHints {
  if (!recentChat?.trim()) return hints;
  const prior = parseFlightResearchHints(recentChat);
  const route =
    recentChat.match(/\b([A-Z]{3})\s*→\s*([A-Z]{3})\b/) ??
    recentChat.match(/\bFlights\s+([A-Z]{3})\s*[→\-]+\s*([A-Z]{3})\b/i);
  const from =
    hints.from && hints.from.length === 3
      ? hints.from
      : prior?.from && prior.from.length === 3
        ? prior.from
        : route?.[1]?.toUpperCase() ?? hints.from;
  const to =
    hints.to && hints.to.length === 3
      ? hints.to
      : prior?.to && prior.to.length === 3
        ? prior.to
        : route?.[2]?.toUpperCase() ?? hints.to;
  const whenHint = hints.whenHint ?? prior?.whenHint ?? null;
  const morning = hints.morning || Boolean(prior?.morning);
  const evening = hints.evening || Boolean(prior?.evening);
  let googleFlightsUrl = hints.googleFlightsUrl;
  if (from && to && from.length === 3 && to.length === 3) {
    const q = encodeURIComponent(
      `Flights from ${from} to ${to}${whenHint ? ` ${whenHint}` : ""}${morning ? " morning" : ""}${evening ? " evening" : ""}`,
    );
    googleFlightsUrl = `https://www.google.com/travel/flights?q=${q}&curr=INR`;
  }
  return { from, to, whenHint, morning, evening, googleFlightsUrl };
}

const BMS_URL_RE =
  /https?:\/\/(?:in\.)?bookmyshow\.com\/movies\/([a-z0-9-]+)\/([a-z0-9-]+)\/(ET\d+)/i;

export function parseBookMyShowUrl(text: string): {
  city: string;
  slug: string;
  eventCode: string;
  url: string;
} | null {
  const m = text.match(BMS_URL_RE);
  if (!m) return null;
  return {
    city: m[1]!.toLowerCase(),
    slug: m[2]!,
    eventCode: m[3]!.toUpperCase(),
    url: m[0]!,
  };
}

/** Movies / showtimes research hints — never books. */
export function parseMovieResearchHints(text: string): MovieResearchHints | null {
  const t = text.trim();
  if (!t) return null;

  const transactional = /\b(book|buy|order|reserve)\b/i.test(
    t.replace(/\bbook\s*my\s*show\b/gi, "BMS"),
  );
  if (transactional) return null;

  const bms = parseBookMyShowUrl(t);
  const showAsk =
    /\b(shows?\s+for|showtimes?|timings?|when\s+is\s+it\s+playing)\b/i.test(t) ||
    Boolean(bms);
  const listingAsk =
    (/^(which|what)\b/i.test(t) && /\b(movie|film|running|playing|showing)\b/i.test(t)) ||
    (/\b(movie|movies|film|films|cinema|what's\s+on|whats\s+on)\b/i.test(t) &&
      /\b(running|playing|showing|this\s+week|near)\b/i.test(t));

  if (!showAsk && !listingAsk) return null;

  const language =
    t.match(/\b(hindi|english|kannada|tamil|telugu|malayalam|marathi)\b/i)?.[1]?.toLowerCase() ??
    null;
  const area =
    t.match(/\bnear\s+([A-Za-z][A-Za-z0-9 &'.-]{2,40})/i)?.[1]?.trim() ??
    t.match(/\bin\s+(Arekere|Indiranagar|Koramangala|HSR|Whitefield|Jayanagar)\b/i)?.[1] ??
    null;
  const cityFromText = t.match(/\b(bengaluru|bangalore|mumbai|delhi|hyderabad|chennai|pune)\b/i)?.[1];
  const city = (bms?.city ?? cityFromText ?? "bengaluru").toLowerCase().replace("bangalore", "bengaluru");

  let title: string | null = null;
  if (bms) {
    title = bms.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  } else {
    title =
      t.match(/\b(?:for|movie)\s+([A-Za-z0-9 :'-]{2,40})/i)?.[1]?.trim() ?? null;
  }

  return {
    title,
    eventCode: bms?.eventCode ?? null,
    city,
    area,
    language,
    bookMyShowUrl: bms?.url ?? null,
    mode: showAsk && (bms || title) ? "showtimes" : "listing",
  };
}

/** Pull BMS movie link / title from prior chat for “shows for this?”. */
export function mergeMovieHintsFromChat(
  hints: MovieResearchHints,
  recentChat: string | null | undefined,
): MovieResearchHints {
  if (!recentChat?.trim()) return hints;
  const fromChat = parseBookMyShowUrl(recentChat);
  const area =
    hints.area ??
    recentChat.match(/\bnear\s+([A-Za-z][A-Za-z0-9 &'.-]{2,40})/i)?.[1]?.trim() ??
    recentChat.match(/\b(Arekere|Indiranagar|Koramangala|HSR|Whitefield|Jayanagar)\b/i)?.[1] ??
    null;
  if (!fromChat && hints.bookMyShowUrl) {
    return { ...hints, ...(area && !hints.area ? { area } : {}) };
  }
  if (!fromChat) {
    // Title from a prior research line like "VIBE (2026)"
    const titled =
      recentChat.match(/\b([A-Z][A-Za-z0-9 ':-]{1,40})\s*\(20\d{2}\)/)?.[1]?.trim() ?? null;
    if (titled && !hints.title) {
      return { ...hints, title: titled, mode: "showtimes", ...(area ? { area } : {}) };
    }
    return { ...hints, ...(area && !hints.area ? { area } : {}) };
  }
  const title =
    hints.title ??
    fromChat.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
  return {
    ...hints,
    title,
    eventCode: hints.eventCode ?? fromChat.eventCode,
    city: hints.city || fromChat.city,
    bookMyShowUrl: hints.bookMyShowUrl ?? fromChat.url,
    mode: "showtimes",
    ...(area ? { area } : {}),
  };
}

export function formatMovieResearchReply(opts: {
  hints: MovieResearchHints;
  venues: MovieShowVenue[];
  listingLines?: string[];
}): { text: string; options: LifeOpsOption[] } {
  const { hints, venues, listingLines } = opts;
  const bms =
    hints.bookMyShowUrl ??
    (hints.eventCode
      ? `https://in.bookmyshow.com/movies/${hints.city}/${(hints.title ?? "movie").toLowerCase().replace(/\s+/g, "-")}/${hints.eventCode}`
      : `https://in.bookmyshow.com/explore/movies-${hints.city}`);

  if (hints.mode === "listing") {
    const lines = listingLines?.length
      ? listingLines
      : [
          "Open BookMyShow for what's playing (live list):",
          bms,
        ];
    const options: LifeOpsOption[] = [
      {
        id: "A",
        label: "Open BookMyShow movies",
        detail: hints.city,
        estInr: null,
        url: bms,
      },
      {
        id: "B",
        label: "Ask showtimes",
        detail: "Paste a movie link or say shows for <title>",
        estInr: null,
      },
      {
        id: "C",
        label: "Book after you pick",
        detail: "Say book <movie> at <theatre> <time> — still needs your yes",
        estInr: null,
      },
    ];
    return {
      text: [
        hints.language
          ? `${hints.language[0]!.toUpperCase()}${hints.language.slice(1)} movies · ${hints.city}`
          : `Movies · ${hints.city}`,
        "",
        ...lines,
        "",
        "Want showtimes near you? Paste the BookMyShow movie link or say shows for <title>.",
        "I won't book until you say book <theatre> <time>.",
      ].join("\n"),
      options,
    };
  }

  const title = hints.title ?? "This movie";
  const head = `${title} shows${hints.area ? ` near ${hints.area}` : ""} · ${hints.city}`;
  // No scrape (typical BMS 403) — closest cinemas only; times via BMS link.
  if (!venues.length) {
    return {
      text: [
        head,
        "",
        "Live showtimes:",
        bms,
        "",
        "BookMyShow blocks automated scrape right now — open that link for today's times.",
        hints.area ? `I can still list nearby cinemas around ${hints.area} if useful.` : null,
        "Want me to book one? Say book <theatre> <time> (still needs your yes).",
      ]
        .filter(Boolean)
        .join("\n"),
      options: [
        {
          id: "A",
          label: "Open showtimes",
          detail: title,
          estInr: null,
          url: bms,
        },
        {
          id: "B",
          label: "Book after you pick",
          detail: "Say book <theatre> <time>",
          estInr: null,
        },
      ],
    };
  }

  const sorted = [...venues].sort(
    (a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99),
  );
  const closest = sorted[0]!;
  const hasAnyTimes = sorted.some((v) => v.times.length > 0);
  const body = sorted.slice(0, 4).map((v, i) => {
    const dist = v.distanceKm != null ? ` · ~${v.distanceKm.toFixed(1)} km` : "";
    const times = v.times.length
      ? v.times.join(", ")
      : hasAnyTimes
        ? "see link"
        : "times on BookMyShow";
    return `${i + 1}) ${v.name}${dist}\n   ${times}`;
  });
  const options: LifeOpsOption[] = sorted.slice(0, 3).map((v, i) => ({
    id: String.fromCharCode(65 + i),
    label: v.name,
    detail: v.times.slice(0, 3).join(", ") || "showtimes",
    estInr: null,
    ...(v.url ? { url: v.url } : {}),
  }));

  return {
    text: [
      head,
      "",
      ...body,
      "",
      !hasAnyTimes ? `Live times: ${bms}` : null,
      closest.distanceKm != null
        ? `${closest.name} is closest${hints.area ? ` to ${hints.area}` : ""}.`
        : null,
      "Want me to book one? Say book <theatre> <time> — I won't pay or lock seats without your yes.",
      hasAnyTimes ? bms : null,
    ]
      .filter(Boolean)
      .join("\n"),
    options,
  };
}

/** Pull dining context from research / handoff lines in recent chat. */
export function extractLifeOpsDiningContext(
  recentChat: string | null | undefined,
  bookText?: string | null,
): LifeOpsDiningContext | null {
  const chat = latestDiningThread(recentChat);
  const book = (bookText ?? "").trim();
  if (!chat && !book) return null;

  const venueFromBook =
    book.match(/^(?:book|reserve)\s+(.+)$/i)?.[1]?.trim() ??
    book.match(/\bbook\s+(?:a\s+table\s+at\s+|at\s+)(.+)$/i)?.[1]?.trim() ??
    null;
  const venueClean =
    venueFromBook &&
    !/^[A-Ea-e]$/.test(venueFromBook) &&
    !/^[1-9]$/.test(venueFromBook) &&
    !BOOK_PLATFORM_ONLY_RE.test(venueFromBook)
      ? venueFromBook.replace(/\s+/g, " ").slice(0, 80)
      : null;

  const optionPick =
    parseLifeOpsOptionPick(book) ??
    book.match(/^(?:book|reserve|option)\s*([A-Ea-e1-9])\b/i)?.[1]?.toUpperCase() ??
    null;
  let venueFromList: string | null = null;
  if (optionPick && chat) {
    venueFromList = resolveListedOptionVenue(chat, optionPick);
  }

  const handoffVenueRaw =
    chat.match(/Book links:\s*([^\n·]+)/i)?.[1]?.trim() ??
    chat.match(/Handoff \(reservation\):\s*([^\n·]+)/i)?.[1]?.trim() ??
    null;
  const handoffVenue =
    handoffVenueRaw && !BOOK_PLATFORM_ONLY_RE.test(handoffVenueRaw)
      ? handoffVenueRaw.slice(0, 80)
      : null;

  // Prefer explicit pick/list over stale handoff names (e.g. old "via Zomato").
  const venue =
    venueClean ??
    (optionPick ? venueFromList : null) ??
    venueFromList ??
    handoffVenue ??
    null;

  const head =
    chat.match(
      /(?:Pure-veg|Dining|Pubs?|Pub picks|Client dinner|Sector\s*\d+[^\n]{0,80}dinner)[^\n]{0,140}/i,
    )?.[0] ?? chat;
  const diningHints = parseDiningResearchHints(chat) ?? parseDiningResearchHints(head);
  const partySize =
    parsePartySize(book) ??
    diningHints?.partySize ??
    parsePartySize(chat);
  // When/date only if the USER said it — never from Amilo movie "today (Sun 20 Sep)" lines.
  const whenHint = extractUserStatedWhen(recentChat, book);
  const area =
    chat.match(/\b(?:near|in)\s+((?:Sector\s*\d+[A-Za-z]?\s*)?[A-Za-z][A-Za-z0-9 .'-]{2,40})/i)?.[1]?.trim() ??
    diningHints?.area ??
    book.match(/\b(?:near|in)\s+([A-Za-z][A-Za-z0-9 .'-]{2,40})/i)?.[1]?.trim() ??
    null;

  if (!venue && !whenHint && !diningHints) return null;
  return {
    venue,
    partySize: partySize && partySize > 0 ? partySize : null,
    whenHint,
    area: area?.slice(0, 60) ?? null,
    vegetarian: diningHints?.vegetarian ?? /\bvegetarian|pure[- ]?veg\b/i.test(chat),
    vibe: diningHints?.vibe ?? (/\bpub|bar|biergarten\b/i.test(chat) ? "pub" : "restaurant"),
  };
}

/**
 * When user says "block calendar / invite X" without time/venue, splice
 * life-ops context from recent chat so parseCalendarCreateHint keeps 8pm + place.
 */
export function mergeLifeOpsIntoCalendarText(
  text: string,
  recentChat: string | null | undefined,
): string {
  const t = text.trim();
  if (!t || !recentChat?.trim()) return t;
  if (!/\b(block|calendar|invite|schedule|add|put)\b/i.test(t)) return t;

  const ctx = extractLifeOpsDiningContext(recentChat, t);
  if (!ctx) return t;

  let out = t;
  const hasClock =
    /\b\d{1,2}(?::\d{2})?\s*(?:am|pm|o['']?clock)\b/i.test(out) ||
    /\b(?:at|@)\s*\d{1,2}/i.test(out);
  if (!hasClock && ctx.whenHint) {
    // Prefer an explicit clock if whenHint is only "tomorrow".
    const clock =
      ctx.whenHint.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i)?.[0] ??
      (/\btomorrow\b/i.test(ctx.whenHint) ? "8pm" : null);
    const day = /\btomorrow\b/i.test(ctx.whenHint)
      ? "tomorrow"
      : /\btoday|tonight\b/i.test(ctx.whenHint)
        ? "today"
        : "tomorrow";
    if (clock) out = `${out} ${day} at ${clock}`;
    else out = `${out} ${ctx.whenHint}`;
  } else if (!/\b(today|tomorrow|tonight)\b/i.test(out) && ctx.whenHint) {
    if (/\btomorrow\b/i.test(ctx.whenHint)) out = `${out} tomorrow`;
    else if (/\btoday|tonight\b/i.test(ctx.whenHint)) out = `${out} today`;
  }

  if (ctx.venue && !new RegExp(ctx.venue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(out)) {
    if (/\bat\s+[A-Za-z]/i.test(out)) {
      /* already has a place */
    } else {
      out = `${out} at ${ctx.venue}`;
    }
  }

  // Title: "block calendar" alone → "Dinner at Venue" / "Drinks at Venue"
  if (
    /\bblock\s+(?:the\s+)?calendar\b/i.test(out) &&
    ctx.venue &&
    !/\b(dinner|lunch|brunch|drinks|meeting|client)\b/i.test(out)
  ) {
    const kind = ctx.vibe === "pub" ? "Drinks" : "Dinner";
    out = out.replace(
      /\bblock\s+(?:the\s+)?calendar\b/i,
      `block calendar ${kind} at ${ctx.venue}`,
    );
  }
  return out.replace(/\s+/g, " ").trim();
}

export function buildDiningHandoffScript(ctx: {
  venue: string;
  partySize?: number | null;
  whenHint?: string | null;
  area?: string | null;
  vibe?: "restaurant" | "pub";
  city?: string;
}): string {
  const links = buildDiningBookLinks(ctx);
  const bits = [
    ctx.venue,
    ctx.whenHint?.trim() || null,
    ctx.partySize && ctx.partySize > 0 ? `table for ${ctx.partySize}` : null,
    ctx.area ? `near ${ctx.area}` : null,
  ].filter(Boolean);
  return [
    `Open to finish booking (Amilo did not reserve or pay):`,
    `· ${bits.join(" · ")}`,
    `Zomato: ${links.zomato}`,
    `Dineout: ${links.dineout}`,
    `EazyDiner: ${links.eazydiner}`,
    `Maps: ${links.maps}`,
  ].join("\n");
}

/** Standing: find/research options — never books. */
export function parseLifeOpsResearchIntent(text: string): LifeOpsResearchIntent | null {
  const t = text.trim();
  if (!t || t.length > 800) return null;

  const dining = parseDiningResearchHints(t);
  const flight = parseFlightResearchHints(t);
  const movie = parseMovieResearchHints(t);

  const asksResearch =
    Boolean(dining) ||
    Boolean(flight) ||
    Boolean(movie) ||
    /\b(find|research|look up|lookup|options? for|compare|cheapest|best|check|suggest|recommend)\b/i.test(
      t,
    ) ||
    (/\b(flight|hotel|train)s?\b/i.test(t) &&
      /\b(to|from|under|for|tomorrow|next)\b/i.test(t)) ||
    // Movies / showtimes — open web research, not booking (unless book/buy elsewhere)
    (/\b(movie|movies|film|films|cinema|showtimes?|what's\s+on|whats\s+on)\b/i.test(t) &&
      !/\b(book|buy|order|reserve)\b/i.test(t.replace(/\bbook\s*my\s*show\b/gi, "BMS"))) ||
    (/^(which|what)\b/i.test(t) &&
      /\b(movie|film|running|playing|showing)\b/i.test(t)) ||
    /\b(shows?\s+for|showtimes?|timings?)\b/i.test(t);
  if (!asksResearch) return null;

  if (/\b(book (me |a |the )?(meeting|call|slot)|invite |add to calendar)\b/i.test(t)) {
    return null;
  }
  if (/pnr\s*:|boarding pass|e-?ticket|confirmation (number|code)/i.test(t)) {
    return null;
  }

  const domain = dining ? "home" : flight ? "travel" : domainFromText(t);
  const moneyCapInr = parseMoneyCapInr(t);
  const query = t.replace(/\s+/g, " ").slice(0, 240);

  return {
    domain,
    query,
    moneyCapInr,
    options: [],
    ...(dining ? { dining } : {}),
    ...(flight ? { flight } : {}),
    ...(movie ? { movie } : {}),
  };
}

export function buildResearchOptions(
  domain: LifeOpsDomain,
  query: string,
  moneyCapInr: number | null,
): LifeOpsOption[] {
  const cap = moneyCapInr;
  if (domain === "travel") {
    const dest =
      query.match(/\b(?:to|for)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:\s+(?:under|below|on|from|tomorrow|next|this)\b|,|$)/i)?.[1]?.trim() ??
      "your destination";
    return [
      {
        id: "A",
        label: `Direct / early → ${dest}`,
        detail: cap ? `aim under ₹${cap.toLocaleString("en-IN")}` : "earliest sensible departure",
        estInr: cap ? Math.round(cap * 0.85) : null,
      },
      {
        id: "B",
        label: `Value → ${dest}`,
        detail: cap ? `stay under ₹${cap.toLocaleString("en-IN")}` : "best price/time tradeoff",
        estInr: cap ? Math.round(cap * 0.7) : null,
      },
      {
        id: "C",
        label: "Flexible / later",
        detail: "wider window if A/B miss the cap",
        estInr: null,
      },
    ];
  }
  if (domain === "home") {
    return [
      {
        id: "A",
        label: "Hold on calendar",
        detail: "propose a block after your yes",
        estInr: null,
      },
      {
        id: "B",
        label: "Vendor / reservation handoff",
        detail: "draft message — you confirm before send",
        estInr: cap,
      },
      {
        id: "C",
        label: "Family schedule memory",
        detail: "standing window only",
        estInr: null,
      },
    ];
  }
  return [
    {
      id: "A",
      label: "Chase / pay draft",
      detail: "email draft for your review — send only after yes",
      estInr: cap,
    },
    {
      id: "B",
      label: "Return / cancel path",
      detail: "portal steps + draft if needed",
      estInr: null,
    },
    {
      id: "C",
      label: "Hold + remind",
      detail: "calendar nudge; no money moved",
      estInr: null,
    },
  ];
}

export function formatDiningResearchReply(opts: {
  query: string;
  hints: DiningResearchHints;
  places: Array<{
    name: string;
    address: string;
    rating?: number | null;
    mapsUrl?: string | null;
  }>;
}): { text: string; options: LifeOpsOption[] } {
  const { hints, places } = opts;
  const mapsSearchUrl = shortMapsSearchUrl(hints.searchQuery);

  const headBits = [
    hints.vibe === "pub" ? "Pubs" : hints.vegetarian ? "Pure-veg" : "Dining",
    hints.area ? `near ${hints.area}` : null,
    hints.whenHint ?? null,
    hints.partySize ? `table for ${hints.partySize}` : null,
  ].filter(Boolean);
  const head = headBits.join(" · ");

  if (!places.length) {
    const options: LifeOpsOption[] = [
      {
        id: "A",
        label: "Open live Maps results",
        detail: hints.searchQuery,
        estInr: null,
        url: mapsSearchUrl,
      },
      {
        id: "B",
        label: "Narrow the area",
        detail: "e.g. near 100 Feet Road Indiranagar",
        estInr: null,
      },
      {
        id: "C",
        label: "Book after you pick",
        detail: "Say book <venue name> for a reservation handoff (still needs yes)",
        estInr: null,
      },
    ];
    return {
      text: [
        head || (hints.vibe === "pub" ? "Pubs" : "Dining"),
        "",
        "Live map search:",
        mapsSearchUrl,
        "",
        "A) Open that link and pick a place",
        "B) Narrow the area and ask again",
        "C) Say book <name> when you've chosen — reservation handoff still needs your yes",
      ].join("\n"),
      options,
    };
  }
  const options: LifeOpsOption[] = places.slice(0, 5).map((p, i) => {
    const id = String(i + 1);
    const rating =
      p.rating != null && Number.isFinite(p.rating) ? `★${p.rating.toFixed(1)}` : null;
    return {
      id,
      label: p.name,
      detail: [rating, p.address].filter(Boolean).join(" · ").slice(0, 100),
      estInr: null,
      url: shortMapsSearchUrl(p.name, hints.area),
    };
  });

  // Short lines for WhatsApp — one Maps search link at the bottom (not per-option cid URLs).
  const lines = [
    head || (hints.vibe === "pub" ? "Pub picks" : "Dining picks"),
    ...options.map((o) => `${o.id}) ${o.label} — ${o.detail}`),
    "",
    `Maps: ${mapsSearchUrl}`,
    "Reply with a number to pick — I'll ask for day/time (and party size) if missing. Never assume.",
  ];
  return { text: lines.join("\n"), options };
}

export function formatFlightResearchReply(opts: {
  query: string;
  hints: FlightResearchHints;
  moneyCapInr: number | null;
  leaveByHint?: string | null;
}): { text: string; options: LifeOpsOption[] } {
  const { hints, moneyCapInr, leaveByHint, query } = opts;
  const route =
    hints.from && hints.to ? `${hints.from} → ${hints.to}` : query.slice(0, 60);
  const options: LifeOpsOption[] = [
    {
      id: "A",
      label: "Open live fares",
      detail: hints.googleFlightsUrl
        ? "Google Flights (current prices — I won't invent a fare)"
        : "Need clearer from/to cities",
      estInr: moneyCapInr,
      ...(hints.googleFlightsUrl ? { url: hints.googleFlightsUrl } : {}),
    },
    {
      id: "B",
      label: hints.morning ? "Morning window" : hints.evening ? "Evening window" : "Flexible time",
      detail: "Pick on the Flights page, then say book with the flight number",
      estInr: null,
    },
    {
      id: "C",
      label: "Leave-by",
      detail: leaveByHint ?? "Set home is <address> for airport leave-by",
      estInr: null,
    },
  ];
  const lines = [
    `Flights ${route}${hints.whenHint ? ` · ${hints.whenHint}` : ""}`,
    moneyCapInr ? formatMoneyCapNote(moneyCapInr) : null,
    "",
    "I don't invent flight numbers or fares. Live search:",
    hints.googleFlightsUrl ?? "(tell me from/to cities — e.g. Bangalore to Mumbai)",
    "",
    ...options.map((o) => `${o.id}) ${o.label} — ${o.detail}`),
    "",
    "After you pick one, say book Indigo 6E-… or handoff option A — booking still needs your yes.",
  ].filter(Boolean) as string[];
  return { text: lines.join("\n"), options };
}

/** Standing: hand off after research or direct ask. */
export function parseLifeOpsHandoffIntent(text: string): LifeOpsHandoffIntent | null {
  const t = text.trim();
  if (!t || t.length > 800) return null;

  const optionPick =
    t.match(/^(?:book|reserve|handoff|hand ?off|option)\s*([A-Ea-e1-9])\b/i)?.[1] ??
    (parseLifeOpsOptionPick(t) && /^(?:book|reserve|handoff|hand ?off|option)\b/i.test(t)
      ? parseLifeOpsOptionPick(t)
      : null);
  const bookNamedRaw =
    t.match(/^(?:book|reserve)\s+(.+)$/i)?.[1]?.trim() ??
    t.match(/\bbook\s+(?:a\s+table\s+at\s+|at\s+)(.+)$/i)?.[1]?.trim();
  const bookNamed =
    bookNamedRaw && !BOOK_PLATFORM_ONLY_RE.test(bookNamedRaw) ? bookNamedRaw : null;

  // "book via Zomato" with no venue — not a handoff yet.
  if (bookNamedRaw && !bookNamed && BOOK_PLATFORM_ONLY_RE.test(bookNamedRaw)) {
    return null;
  }

  const wantsHandoff =
    Boolean(optionPick) ||
    Boolean(bookNamed) ||
    /\b(hand ?off|handoff|chase|follow up|follow-up|book (the |a )?(table|reservation|plumber|electrician|vendor|flight)|call the (plumber|electrician|vendor|restaurant)|reserve (a |the )?table)\b/i.test(
      t,
    ) ||
    /\b(return (this|the|my)|request (a )?refund|cancel (my |the )?subscription)\b/i.test(t);
  if (!wantsHandoff) return null;

  const domainRaw = domainFromText(t);
  const moneyCapInr = parseMoneyCapInr(t);
  const venueHint =
    bookNamed && !/^[A-Ea-e1-9]$/.test(bookNamed) ? bookNamed.slice(0, 80) : null;
  const optionId = optionPick
    ? /^[1-9]$/.test(optionPick)
      ? optionPick
      : optionPick.toUpperCase()
    : undefined;
  // Named restaurant/pub book must never become "flight option".
  const domain: LifeOpsDomain =
    venueHint && domainRaw === "travel" && !/\b(flight|hotel|train|indigo)\b/i.test(t)
      ? "home"
      : domainRaw;

  if (/\b(return|refund|chase|subscription|bill|invoice)\b/i.test(t) && !optionId && !venueHint) {
    const about = t.replace(/\s+/g, " ").slice(0, 200);
    return {
      domain: "errand",
      channel: "email",
      moneyCapInr,
      summary: [
        `Handoff (errand email): ${about}`,
        formatMoneyCapNote(moneyCapInr),
        "Reply yes to open the draft (still not sent), cancel to drop.",
      ]
        .filter(Boolean)
        .join("\n"),
      email: {
        toHint: null,
        subject: /\breturn\b/i.test(t)
          ? "Return request"
          : /\brefund\b/i.test(t)
            ? "Refund request"
            : /\bsubscription\b/i.test(t)
              ? "Subscription cancellation"
              : "Follow-up",
        body: [
          "Hi,",
          "",
          `Following up on: ${about}`,
          "",
          "Please confirm next steps.",
          "",
          "Thanks",
        ].join("\n"),
      },
    };
  }

  if (optionId || venueHint || /\b(table|reservation|restaurant|pub|bar|flight)\b/i.test(t)) {
    const who = venueHint ?? (optionId ? `option ${optionId}` : t.replace(/\s+/g, " ").slice(0, 120));
    const isTravel = domain === "travel" && /\b(flight|hotel|train|indigo)\b/i.test(t);
    return {
      domain: isTravel ? "travel" : "home",
      channel: "vendor",
      moneyCapInr,
      ...(optionId ? { optionId } : {}),
      ...(venueHint ? { venueHint } : {}),
      summary: [
        `Book links: ${who}`,
        formatMoneyCapNote(moneyCapInr),
        "Reply yes for platform book links — Amilo won't reserve or pay.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (/\b(plumber|electrician|handyman|vendor)\b/i.test(t)) {
    return {
      domain: "home",
      channel: "vendor",
      moneyCapInr,
      summary: [
        `Handoff (vendor): ${t.replace(/\s+/g, " ").slice(0, 200)}`,
        formatMoneyCapNote(moneyCapInr),
        "Reply yes for the call/message script — I won't contact anyone without that.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return {
    domain,
    channel: "note",
    moneyCapInr,
    summary: [
      `Handoff (${domain}): ${t.replace(/\s+/g, " ").slice(0, 200)}`,
      formatMoneyCapNote(moneyCapInr),
      "Reply yes to lock the handoff plan (no spend/send yet), cancel to drop.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Inbox errand → prefer email_draft path with chase/return framing. */
export function parseInboxErrandDraftAsk(text: string): {
  mode: "draft" | "send";
  toHint: string | null;
  about: string;
  kind: "bill" | "return" | "subscription" | "appointment" | "chase";
} | null {
  const t = text.trim();
  if (!/\b(bill|subscription|return|refund|chase|appointment|renewal)\b/i.test(t)) {
    return null;
  }
  if (!/\b(draft|email|mail|send|chase|follow[- ]?up|cancel|return|refund)\b/i.test(t)) {
    return null;
  }
  let kind: "bill" | "return" | "subscription" | "appointment" | "chase" = "chase";
  if (/\breturn\b/i.test(t)) kind = "return";
  else if (/\brefund\b/i.test(t)) kind = "return";
  else if (/\bsubscription\b/i.test(t)) kind = "subscription";
  else if (/\bappointment\b/i.test(t)) kind = "appointment";
  else if (/\bbill\b/i.test(t)) kind = "bill";

  const email = t.match(/\b([\w.+-]+@[\w.-]+\.\w+)\b/)?.[1] ?? null;
  return {
    mode: /\bsend\b/i.test(t) && !/\bdraft\b/i.test(t) ? "send" : "draft",
    toHint: email,
    about: t.replace(/\s+/g, " ").slice(0, 240),
    kind,
  };
}

export function lifeOpsResearchConfirmMessage(payload: Record<string, unknown>): string {
  const domain = String(payload.domain ?? "travel");
  const query = String(payload.query ?? "your request");
  return [
    `Shortlist locked for ${domain}: ${query.slice(0, 120)}.`,
    "Still not booked / paid. Say e.g. book A, or handoff after you pick.",
  ].join("\n");
}

export function lifeOpsHandoffConfirmMessage(payload: Record<string, unknown>): string {
  const channel = String(payload.channel ?? "note");
  if (channel === "email") {
    return "Handoff ready as an email draft next — say send when the draft looks right (or cancel).";
  }
  if (channel === "vendor") {
    const script = String(
      payload.script ?? payload.summary ?? "Open the book link for your venue and slot.",
    ).slice(0, 700);
    const calNote = payload.calendarHold
      ? "\n\nCalendar hold proposed next — reply yes to put it on your calendar (still confirm-first)."
      : "\n\nAfter you've booked on the platform, say block calendar <day time> at <venue> if you want it on Google.";
    return [
      "Book links ready (nothing reserved or paid by Amilo):",
      script,
      calNote.trim(),
    ].join("\n");
  }
  return "Handoff plan locked — nothing spent or sent. Say what to do next.";
}
