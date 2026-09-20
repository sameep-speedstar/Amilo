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
  /** Dining / flight structured hints for the research runner. */
  dining?: DiningResearchHints;
  flight?: FlightResearchHints;
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
  const q = [nameOrQuery.trim(), area?.trim(), "Bangalore"]
    .filter(Boolean)
    .join(" ")
    .replace(/\s+/g, " ")
    .slice(0, 120);
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export function zomatoSearchUrl(venue: string, city = "bangalore"): string {
  return `https://www.zomato.com/${city}/restaurants?q=${encodeURIComponent(venue.trim().slice(0, 80))}`;
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

/** Pull dining context from research / handoff lines in recent chat. */
export function extractLifeOpsDiningContext(
  recentChat: string | null | undefined,
  bookText?: string | null,
): LifeOpsDiningContext | null {
  const chat = (recentChat ?? "").trim();
  const book = (bookText ?? "").trim();
  if (!chat && !book) return null;

  const venueFromBook =
    book.match(/^(?:book|reserve)\s+(.+)$/i)?.[1]?.trim() ??
    book.match(/\bbook\s+(?:a\s+table\s+at\s+|at\s+)(.+)$/i)?.[1]?.trim() ??
    null;
  const venueClean =
    venueFromBook && !/^[A-Ea-e]$/.test(venueFromBook)
      ? venueFromBook.replace(/\s+/g, " ").slice(0, 80)
      : null;

  const optionLetter = book.match(/^(?:book|reserve|option)\s*([A-Ea-e])\b/i)?.[1]?.toUpperCase();
  let venueFromList: string | null = null;
  if (optionLetter && chat) {
    const re = new RegExp(`^${optionLetter}\\)\\s+([^\\n—\\-]+)`, "im");
    venueFromList = chat.match(re)?.[1]?.trim()?.slice(0, 80) ?? null;
  }
  if (!venueFromList && chat) {
    const picks = [...chat.matchAll(/^[A-E]\)\s+([^\n—\-]+)/gim)];
    const last = picks[picks.length - 1]?.[1]?.trim();
    if (last && /locked|handoff|reservation/i.test(chat.slice(-400))) {
      venueFromList = last.slice(0, 80);
    }
  }

  const venue =
    venueClean ??
    chat.match(/Handoff \(reservation\):\s*([^\n·]+)/i)?.[1]?.trim()?.slice(0, 80) ??
    chat.match(/\b([A-Z][A-Za-z0-9 &'.-]{2,40})\s+locked\b/i)?.[1]?.trim() ??
    venueFromList ??
    null;

  const head =
    chat.match(
      /(?:Pure-veg|Dining|Pubs?|Pub picks)[^\n]{0,140}/i,
    )?.[0] ?? chat;
  const diningHints = parseDiningResearchHints(chat) ?? parseDiningResearchHints(head);
  const partySize =
    diningHints?.partySize ??
    (Number(chat.match(/\btable for\s+(\d{1,2})\b/i)?.[1]) || null);
  const whenHint =
    diningHints?.whenHint ??
    chat.match(/\b(tomorrow|today|tonight)\b[^\n.]{0,40}/i)?.[0]?.trim() ??
    chat.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i)?.[0]?.trim() ??
    null;
  const area =
    diningHints?.area ??
    chat.match(/\bnear\s+([A-Za-z][A-Za-z0-9 .'-]{2,40})/i)?.[1]?.trim() ??
    null;

  if (!venue && !whenHint && !diningHints) return null;
  return {
    venue,
    partySize: partySize && partySize > 0 ? partySize : null,
    whenHint,
    area,
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
}): string {
  const party = ctx.partySize && ctx.partySize > 0 ? `table for ${ctx.partySize}` : "a table";
  const when = ctx.whenHint?.trim() || "our preferred slot";
  const where = ctx.area ? ` (${ctx.area})` : "";
  const kind = ctx.vibe === "pub" ? "drinks / a table" : party;
  return [
    `Call / Zomato / EazyDiner — ${ctx.venue}${where}`,
    `Hi — looking for ${kind} ${when}. Please confirm availability.`,
    `Zomato: ${zomatoSearchUrl(ctx.venue)}`,
    `Maps: ${shortMapsSearchUrl(ctx.venue, ctx.area)}`,
  ].join("\n");
}

/** Standing: find/research options — never books. */
export function parseLifeOpsResearchIntent(text: string): LifeOpsResearchIntent | null {
  const t = text.trim();
  if (!t || t.length > 800) return null;

  const dining = parseDiningResearchHints(t);
  const flight = parseFlightResearchHints(t);

  const asksResearch =
    Boolean(dining) ||
    Boolean(flight) ||
    /\b(find|research|look up|lookup|options? for|compare|cheapest|best|check|suggest|recommend)\b/i.test(
      t,
    ) ||
    (/\b(flight|hotel|train)s?\b/i.test(t) &&
      /\b(to|from|under|for|tomorrow|next)\b/i.test(t)) ||
    // Movies / showtimes — open web research, not booking (unless book/buy elsewhere)
    (/\b(movie|movies|film|films|cinema|showtimes?|what's\s+on|whats\s+on)\b/i.test(t) &&
      !/\b(book|buy|order|reserve)\b/i.test(t.replace(/\bbook\s*my\s*show\b/gi, "BMS"))) ||
    (/^(which|what)\b/i.test(t) &&
      /\b(movie|film|running|playing|showing)\b/i.test(t));
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
  const letters = ["A", "B", "C", "D", "E"];
  const options: LifeOpsOption[] = places.slice(0, 3).map((p, i) => {
    const id = letters[i]!;
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
    "Say book A (or the name) for a reservation handoff — still needs your yes before I contact anyone.",
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

  const optionPick = t.match(/^(?:book|reserve|handoff|hand ?off|option)\s*([A-Ea-e])\b/i)?.[1];
  const bookNamed =
    t.match(/^(?:book|reserve)\s+(.+)$/i)?.[1]?.trim() ??
    t.match(/\bbook\s+(?:a\s+table\s+at\s+|at\s+)(.+)$/i)?.[1]?.trim();

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
  const venueHint = bookNamed && !/^[A-Ea-e]$/.test(bookNamed) ? bookNamed.slice(0, 80) : null;
  const optionId = optionPick?.toUpperCase();
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
        `Handoff (reservation): ${who}`,
        formatMoneyCapNote(moneyCapInr),
        "Reply yes for the call/Zomato script — I won't book or pay without that.",
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
      payload.script ?? payload.summary ?? "Call/message the venue with your preferred slot.",
    ).slice(0, 600);
    const calNote = payload.calendarHold
      ? "\n\nCalendar hold proposed next — reply yes to put it on your calendar (still confirm-first)."
      : "\n\nWhen you've booked, say block calendar tomorrow 8pm at <venue> invite <name>.";
    return [
      "Handoff plan locked. Script:",
      script,
      "",
      "I did not contact anyone or pay.",
      calNote.trim(),
    ].join("\n");
  }
  return "Handoff plan locked — nothing spent or sent. Say what to do next.";
}
