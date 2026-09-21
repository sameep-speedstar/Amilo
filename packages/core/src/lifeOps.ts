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

/**
 * How pickable life-ops lists are labeled.
 * - numeric: 1) 2) 3) — can collide with FOCUS mail 1–3
 * - alpha:   A) B) C) — preferred; never hits the brief digit handler
 * - combo:   A1) A2) B1) — for longer menus without recycling letters
 */
export type LifeOpsOptionScheme = "numeric" | "alpha" | "combo";

/** Default for dining/movie/travel picks — letters avoid FOCUS 1–3 / M. */
export const LIFE_OPS_DEFAULT_SCHEME: LifeOpsOptionScheme = "alpha";

/** 0-based index → option id for the chosen scheme. */
export function lifeOpsOptionId(
  index0: number,
  scheme: LifeOpsOptionScheme = LIFE_OPS_DEFAULT_SCHEME,
): string {
  if (index0 < 0) return "A";
  if (scheme === "numeric") return String((index0 % 9) + 1);
  if (scheme === "alpha") return String.fromCharCode(65 + (index0 % 26));
  const letter = String.fromCharCode(65 + Math.floor(index0 / 9) % 26);
  const n = (index0 % 9) + 1;
  return `${letter}${n}`;
}

export function lifeOpsPickPrompt(
  scheme: LifeOpsOptionScheme = LIFE_OPS_DEFAULT_SCHEME,
  count = 5,
): string {
  if (scheme === "numeric") {
    return `Reply with a number (1–${Math.min(count, 9)}) to pick.`;
  }
  if (scheme === "combo") {
    return "Reply with a code (e.g. A1) to pick.";
  }
  const last = lifeOpsOptionId(Math.max(0, Math.min(count, 26) - 1), "alpha");
  return `Reply with a letter (A–${last}) to pick.`;
}

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

/** Resolve "2" / "B" / "A1" / "option 2" against a numbered or lettered list in recent chat. */
export function parseLifeOpsOptionPick(text: string): string | null {
  const t = text.trim();
  if (!t || t.length > 40) return null;
  const raw =
    t.match(
      /^(?:option|pick|choose|book|reserve|handoff|hand\s*off)\s*([1-9]|[A-Za-z]\d?)\b/i,
    )?.[1] ??
    t.match(/^([1-9]|[A-Za-z]\d?)\s*[).:\-]?\s*$/i)?.[1] ??
    t.match(/^([1-9]|[A-Za-z]\d?)\b/i)?.[1];
  if (!raw) return null;
  if (/^[1-9]$/.test(raw)) return raw;
  if (/^[A-Za-z]\d$/.test(raw)) return raw.toUpperCase();
  if (/^[A-Za-z]$/.test(raw)) return raw.toUpperCase();
  return null;
}

/**
 * Pull venue/label from Amilo's numbered / lettered / combo option list in recent chat.
 * Supports: `1) Name`, `A) Name — detail`, `A1) Name`, `1. **Name**`
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
    `(?:^|[^0-9A-Za-z])${esc}\\)\\s+\\*{0,2}([^*\\n]+?)\\*{0,2}(?=\\s+[—\\-]\\s+|\\s+[A-Z]\\d?\\)|\\s+[1-9]\\)|\\s*$|\\s*\\()`,
    `(?:^|[^0-9A-Za-z])${esc}[.:]\\s+\\*{0,2}([^*\\n]+?)\\*{0,2}(?=\\s+[—\\-]\\s+|\\s+[A-Z]\\d?\\)|\\s+[1-9]\\)|\\s*$|\\s*\\()`,
  ];
  for (const src of patterns) {
    const re = new RegExp(src, "gi");
    let found: string | null = null;
    let m: RegExpExecArray | null;
    while ((m = re.exec(chat)) !== null) {
      const hit = m[1]?.replace(/\*+/g, "").trim();
      if (hit && hit.length >= 2 && !isBookPlatformOnly(hit)) {
        found = hit.slice(0, 80);
      }
      if (!m[0]) re.lastIndex += 1;
    }
    if (found) return found;
  }
  return null;
}

/** Full option line for a letter/number pick (A) … / 1) …). */
export function resolveListedOptionLine(
  recentChat: string | null | undefined,
  optionId: string,
): string | null {
  const chat = (recentChat ?? "").trim();
  if (!chat || !optionId) return null;
  const id = optionId.trim();
  const esc = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `(?:^|\\n)\\s*(?:Amilo:\\s*)?${esc}\\)\\s+[^\\n]+`,
    "gi",
  );
  let found: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(chat)) !== null) {
    const line = m[0].replace(/^(?:\n)?\s*(?:Amilo:\s*)?/i, "").trim();
    if (line.length >= 4) found = line;
  }
  if (found) return found;
  // Fallback: same-line packed lists
  const packed = new RegExp(
    `(?:^|[^0-9A-Za-z])${esc}\\)\\s+([^\\n]+?)(?=\\s+[A-Z]\\d?\\)|\\s+[1-9]\\)|$)`,
    "gi",
  );
  while ((m = packed.exec(chat)) !== null) {
    const hit = `${id}) ${m[1]!.trim()}`;
    if (hit.length >= 4) found = hit;
  }
  return found;
}

/** Maps URL on the picked dining line, or a fresh search URL for the venue. */
export function resolveListedOptionMapsUrl(
  recentChat: string | null | undefined,
  optionId: string,
  venue?: string | null,
): string | null {
  const line = resolveListedOptionLine(recentChat, optionId);
  if (line) {
    const m = line.match(
      /https?:\/\/(?:www\.)?(?:google\.(?:com|co\.\w+)\/maps|maps\.app\.goo\.gl)[^\s)>\]]+/i,
    );
    if (m?.[0]) return m[0].replace(/[),.;]+$/, "");
  }
  const name = venue?.trim() || resolveListedOptionVenue(recentChat, optionId);
  if (!name) return null;
  const area =
    (recentChat ?? "").match(
      /\b(?:near|@)\s+([A-Za-z][A-Za-z0-9 &'.\/-]{2,40})/i,
    )?.[1] ?? null;
  return shortMapsSearchUrl(name, area);
}

/**
 * After a dining letter pick: Maps link + calendar ask (research-only; no book/pay).
 * Travel leave-by advisory fires once calendar is blocked with time + place.
 */
export function diningPickAckReply(opts: {
  venue: string;
  mapsUrl?: string | null;
  whenHint?: string | null;
  partySize?: number | null;
}): string {
  const venue = opts.venue.trim().slice(0, 80);
  const maps = (opts.mapsUrl?.trim() || shortMapsSearchUrl(venue)).slice(0, 300);
  const bits = [venue];
  if (opts.whenHint?.trim()) bits.push(opts.whenHint.trim());
  if (opts.partySize && opts.partySize > 0) bits.push(`table for ${opts.partySize}`);
  const calAsk = opts.whenHint?.trim()
    ? "Shall I block your calendar for then?"
    : "Shall I block your calendar? Reply with day/time (e.g. tomorrow 8pm).";
  return [`Got it — ${bits.join(" · ")}.`, `Maps: ${maps}`, calAsk].join("\n");
}

/** Soft yes to "Shall I block your calendar?" after a dining pick. */
export function isDiningCalendarBlockAffirm(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 40) return false;
  return /^(?:(?:yes|yeah|yep|sure|ok|okay|please|y)\b[\s,.]*)+(?:block(?:\s+it)?|do\s+it|go\s+ahead)?\.?$/i.test(
    t,
  );
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
  // "&" inside q= breaks many clients (treated as a new query param). Use "and".
  const q = venue
    .trim()
    .slice(0, 80)
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ");
  return `https://www.zomato.com/${city}/restaurants?q=${encodeURIComponent(q)}`;
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
  const zomatoQ = [venue, opts.area?.trim()].filter(Boolean).join(" ");
  const mapsArea = [opts.area, city !== "bangalore" ? city : "Bangalore"].filter(Boolean).join(" ");
  const safe = (s: string) => s.replace(/\s*&\s*/g, " and ").replace(/\s+/g, " ").trim();
  return {
    zomato: zomatoSearchUrl(zomatoQ, city),
    dineout: `https://www.dineout.co.in/${city}-restaurants?search=${encodeURIComponent(safe(venue))}`,
    eazydiner: `https://www.eazydiner.com/${city}/search?query=${encodeURIComponent(safe(venue))}`,
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
  const slug = (opts.movieSlug ?? "movie").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
  const day = opts.dateYmd.replace(/-/g, "").slice(0, 8);
  return `https://in.bookmyshow.com/movies/${city}/${slug}/buytickets/${opts.eventCode}/${day}`;
}

export type MovieTicketAsk = {
  title: string | null;
  venue: string | null;
  city: string;
  dateYmd: string | null;
  dateHint: string | null;
  tickets: number | null;
  showTime: string | null;
  eventCode: string | null;
};

const THEATRE_ALIAS: Record<string, string> = {
  ilante: "Elante",
  elante: "Elante",
};

export function looksLikeMovieTicketAsk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/\b(tickets?|seats?)\b/i.test(t) && /\bbook\b/i.test(t)) return true;
  if (
    /\b(movie|cinema|showtimes?|pvr|inox|cinepolis|bookmyshow|theatre|theater)\b/i.test(t) &&
    /\b(book|tickets?|seats?)\b/i.test(t)
  ) {
    return true;
  }
  return false;
}

function slugMovieTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/['’]/g, "")
    .replace(/[^\w]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}

function localYmd(timeZone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addCalendarDay(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 2026, (m ?? 1) - 1, (d ?? 1) + days));
  return dt.toISOString().slice(0, 10);
}

export function normalizeTheatreName(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let v = raw
    .replace(/\b(today|tomorrow|tonight)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!v) return null;
  v = v.replace(/\b(ilante|elante)\b/gi, (m) => THEATRE_ALIAS[m.toLowerCase()] ?? m);
  return v.replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 80);
}

export function parseMovieTicketAsk(
  text: string,
  recentChat?: string | null,
  timeZone = "Asia/Kolkata",
  now: Date = new Date(),
): MovieTicketAsk {
  const t = text.trim();
  const hay = `${t}\n${recentChat ?? ""}`;
  const bms = parseBookMyShowUrl(hay);
  const ticketsWord = t.match(/\b(two|three|four|five|\d{1,2})\s+tickets?\b/i)?.[1];
  const ticketsN =
    ticketsWord == null
      ? null
      : /two/i.test(ticketsWord)
        ? 2
        : /three/i.test(ticketsWord)
          ? 3
          : /four/i.test(ticketsWord)
            ? 4
            : /five/i.test(ticketsWord)
              ? 5
              : Number(ticketsWord);
  const title =
    t.match(/\btickets?\s+for\s+(.+?)(?:\s+(?:today|tomorrow|tonight|on\b|in\b|at\b|near\b|,))/i)?.[1]?.trim() ??
    t.match(/\b(?:movie|film)\s+([A-Za-z0-9][A-Za-z0-9 :'-]{1,40}?)(?:\s+(?:today|tomorrow|tonight|in|at|near|,)|$)/i)?.[1]?.trim() ??
    recentChat?.match(/\btickets?\s+for\s+(.+?)(?:\s+(?:today|tomorrow|tonight|in|at|near|,))/i)?.[1]?.trim() ??
    (bms ? bms.slug.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : null);
  const venueRaw =
    t.match(/\b(?:in|at)\s+(.+?)$/i)?.[1]?.trim() ??
    t.match(/\b(?:pvr|inox|cinepolis|elante|ilante)[^,]{0,50}/i)?.[0]?.trim() ??
    null;
  const dateHint =
    t.match(/\b(today|tomorrow|tonight)\b/i)?.[1]?.toLowerCase() ??
    recentChat?.match(/\b(today|tomorrow|tonight)\b/i)?.[1]?.toLowerCase() ??
    null;
  let dateYmd: string | null = null;
  if (dateHint === "today" || dateHint === "tonight") dateYmd = localYmd(timeZone, now);
  else if (dateHint === "tomorrow") dateYmd = addCalendarDay(localYmd(timeZone, now), 1);
  const showTime =
    t.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i)?.[0]?.trim() ??
    (/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i.test(title ?? "") ? null : null);
  const city = movieCitySlug(`${t} ${recentChat ?? ""} ${venueRaw ?? ""}`);
  return {
    title: title && title.length >= 2 ? title.replace(/\s+/g, " ").slice(0, 60) : null,
    venue: normalizeTheatreName(venueRaw),
    city,
    dateYmd,
    dateHint,
    tickets: ticketsN && Number.isFinite(ticketsN) && ticketsN > 0 && ticketsN < 20 ? ticketsN : null,
    showTime,
    eventCode: bms?.eventCode ?? null,
  };
}

export function buildBookMyShowBookingLink(ask: MovieTicketAsk): string {
  const city = ask.city || "bengaluru";
  const slug = ask.title ? slugMovieTitle(ask.title) : "movies";
  if (ask.eventCode && ask.dateYmd) {
    return buildBookMyShowBuyLink({
      citySlug: city,
      movieSlug: slug,
      eventCode: ask.eventCode,
      dateYmd: ask.dateYmd,
    });
  }
  if (ask.eventCode) {
    return `https://in.bookmyshow.com/movies/${city}/${slug}/${ask.eventCode}`;
  }
  if (ask.title) {
    return `https://in.bookmyshow.com/movies/${city}/${slug}`;
  }
  return `https://in.bookmyshow.com/explore/movies-${city}`;
}

export function buildMovieHandoffScript(ask: MovieTicketAsk, url: string): string {
  const bits = [
    ask.title ?? "movie",
    ask.venue,
    ask.dateHint ?? (ask.dateYmd ? ask.dateYmd : null),
    ask.showTime,
    ask.tickets ? `${ask.tickets} tickets` : null,
  ].filter(Boolean);
  return [
    `Open BookMyShow to finish (Amilo did not buy seats or pay):`,
    `· ${bits.join(" · ")}`,
    url,
  ].join("\n");
}

const MOVIE_LINE_RE =
  /\b(bookmyshow|showtimes?|IMDb|film|films|PVR|INOX|Cinepolis|buytickets|ET\d{5,}|\bshows?\b|movie|cinema)\b/i;
const DINING_LINE_RE =
  /\b(dinner|lunch|brunch|restaurant|dining|zomato|eazydiner|dineout|table for|rooftop|fine dining|client dinner|pubs?|brewery)\b/i;
const CAB_LINE_RE =
  /\b(uber|ola|meru|gozo|rapido|taxi|cabs?|airport\s+(?:cab|taxi|transfer)|outstation)\b/i;
const FLIGHT_LINE_RE =
  /\b(flight|flights|hotel|hotels|train|trains|indigo|air\s*india|spicejet|akasa|vistara|google flights|airline|6e-)\b/i;

const DOMAIN_SWITCH_USER_RE =
  /\b(cab|uber|ola|meru|gozo|taxi|airport|movie|movies|film|cinema|showtimes?|flight|flights|hotel|gilt|yield|chart|bond)\b/i;

export type DiningOccasion = "client" | "partner" | "family" | "friends" | "general";

/** Companion/purpose for a dining ask — used to stop client dinner leaking into wife dinner. */
export function diningOccasion(text: string): DiningOccasion {
  const t = text.trim();
  if (!t) return "general";
  if (
    /\b(client|clients|business\s+dinner|work\s+dinner|investor|customer\s+dinner|corp(?:orate)?\s+dinner)\b/i.test(
      t,
    )
  ) {
    return "client";
  }
  if (
    /\b(wife|husband|spouse|partner|girlfriend|boyfriend|date\s*night|anniversary|romantic)\b/i.test(
      t,
    )
  ) {
    return "partner";
  }
  if (/\b(family|kids?|children|parents?|\bmom\b|\bdad\b|in-?laws?)\b/i.test(t)) {
    return "family";
  }
  if (/\b(friends?|mates?|buddies)\b/i.test(t)) return "friends";
  return "general";
}

/** Cut a domain thread before the user pivots to another topic. */
function threadUntilDomainSwitch(lines: string[], start: number, keepDomain: RegExp): string {
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (!/^User:/i.test(line)) continue;
    if (keepDomain.test(line)) {
      // same domain continue — but dining occasion switches still cut
      if (DINING_LINE_RE.test(line) || /\b(dinner|lunch|brunch)\b/i.test(line)) {
        const startOcc = diningOccasion(lines[start] ?? "");
        const lineOcc = diningOccasion(line);
        if (
          startOcc !== "general" &&
          lineOcc !== "general" &&
          startOcc !== lineOcc
        ) {
          end = i;
          break;
        }
      }
      continue;
    }
    if (DOMAIN_SWITCH_USER_RE.test(line) && !keepDomain.test(line)) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join("\n");
}

/** Prefer the latest dining ask + replies (avoids MG Road / client leaking into wife dinner). */
export function latestDiningThread(
  chat: string | null | undefined,
  currentText?: string | null,
): string {
  const full = (chat ?? "").trim();
  if (!full) return "";
  const lines = full.split("\n");
  const wantOcc = currentText?.trim() ? diningOccasion(currentText) : "general";
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (
      !/^User:/i.test(line) ||
      !/\b(dinner|lunch|brunch|restaurant|dining|table|zomato|eazydiner|dineout|family dinner|client dinner)\b/i.test(
        line,
      )
    ) {
      continue;
    }
    const occ = diningOccasion(line);
    // Specific occasion (wife/client/…) must not inherit a different dining ask.
    if (wantOcc !== "general" && occ !== "general" && occ !== wantOcc) continue;
    start = i;
  }
  if (start < 0) {
    // New occasion (e.g. wife) with only a prior different occasion in chat → blank, don't bleed.
    if (wantOcc !== "general") return "";
    return scopeChatToDining(full);
  }
  return scopeChatToDining(
    threadUntilDomainSwitch(
      lines,
      start,
      /\b(dinner|lunch|brunch|restaurant|dining|table|zomato|family dinner|client dinner)\b/i,
    ),
  );
}

/**
 * Scope recent chat for a live research ask so prior occasions/domains don't bleed.
 * Dining: only the latest matching occasion thread. Movie/cab/travel: domain thread.
 */
export function scopeRecentChatForResearch(
  chat: string | null | undefined,
  message: string,
): string {
  const full = (chat ?? "").trim();
  if (!full) return "";
  if (looksLikeMovieTicketAsk(message) || MOVIE_LINE_RE.test(message)) {
    return latestMovieThread(full) || full;
  }
  if (CAB_LINE_RE.test(message)) return latestCabThread(full) || full;
  if (DINING_LINE_RE.test(message) || /\b(dinner|lunch|brunch)\b/i.test(message)) {
    return latestDiningThread(full, message) || full;
  }
  return full;
}

/** Latest cab / airport-transfer thread only. */
export function latestCabThread(chat: string | null | undefined): string {
  const full = (chat ?? "").trim();
  if (!full) return "";
  const lines = full.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^User:/i.test(line) && CAB_LINE_RE.test(line)) start = i;
  }
  if (start < 0) {
    return full
      .split("\n")
      .filter((l) => CAB_LINE_RE.test(l) || /Reply with a letter/i.test(l))
      .join("\n");
  }
  return threadUntilDomainSwitch(lines, start, CAB_LINE_RE);
}

/** Latest movie / showtimes thread only. */
export function latestMovieThread(chat: string | null | undefined): string {
  const full = (chat ?? "").trim();
  if (!full) return "";
  const lines = full.split("\n");
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^User:/i.test(line) && MOVIE_LINE_RE.test(line) && !DINING_LINE_RE.test(line)) {
      start = i;
    }
  }
  if (start < 0) return "";
  return threadUntilDomainSwitch(
    lines,
    start,
    /\b(movie|movies|film|cinema|showtimes?|bookmyshow|theater|theatre|shows?)\b/i,
  );
}

export function diningCitySlug(areaOrText?: string | null): string {
  const t = (areaOrText ?? "").toLowerCase();
  if (/chandigarh|mohali|panchkula|elante|ilante|sector\s*\d+/i.test(t)) return "chandigarh";
  if (/\bmumbai\b|\bbombay\b/i.test(t)) return "mumbai";
  if (/\bdelhi\b|\bgurgaon\b|\bnoida\b|\bncr\b/i.test(t)) return "ncr";
  if (/\bhyderabad\b/i.test(t)) return "hyderabad";
  if (/\bchennai\b/i.test(t)) return "chennai";
  if (/\bpune\b/i.test(t)) return "pune";
  return "bangalore";
}

export function movieCitySlug(areaOrText?: string | null): string {
  const city = diningCitySlug(areaOrText);
  return city === "bangalore" ? "bengaluru" : city === "ncr" ? "national-capital-region-ncr" : city;
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

/**
 * Generic WhatsApp formatting for pickable life-ops lists (dinner, movie, cab, flight…).
 * Grok often packs `A) … B) … C) …` onto one line — force one option per line.
 * Also lifts a headline that shares the line with the first option.
 */
export function formatLifeOpsOptionLines(text: string): string {
  const t = text.replace(/\r\n/g, "\n").trim();
  if (!t) return t;

  const re = /(?:^|[^A-Za-z0-9*])([A-Z]\d?|[1-9])\)\s+/g;
  const starts: { at: number; id: string }[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    const id = m[1]!;
    const idParen = `${id})`;
    const at = m.index + m[0].lastIndexOf(idParen);
    starts.push({ at, id });
  }
  if (starts.length < 2) return t;

  const ids = starts.map((s) => s.id);
  const allAlpha = ids.every((id) => /^[A-Z]$/.test(id));
  const allNumeric = ids.every((id) => /^[1-9]$/.test(id));
  const allCombo = ids.every((id) => /^[A-Z]\d$/.test(id));
  if (!allAlpha && !allNumeric && !allCombo) return t;
  // Require a real pick list (starts at A / 1 / A1), not random mid-prose parens.
  if (allAlpha && ids[0] !== "A") return t;
  if (allNumeric && ids[0] !== "1") return t;
  if (allCombo && ids[0] !== "A1") return t;

  const parts: string[] = [];
  const headRaw = t.slice(0, starts[0]!.at).trim().replace(/[:：]\s*$/, "").trim();
  if (headRaw) parts.push(headRaw);

  for (let i = 0; i < starts.length; i++) {
    const from = starts[i]!.at;
    const to = i + 1 < starts.length ? starts[i + 1]!.at : t.length;
    let chunk = t.slice(from, to).trim();
    if (i === starts.length - 1) {
      const replySplit = chunk.match(
        /^(.*?)([ \t]+Reply with a (?:letter|number|code)\b[\s\S]*)$/i,
      );
      if (replySplit?.[1] && replySplit[2]) {
        parts.push(replySplit[1].trim());
        parts.push(replySplit[2].trim());
        continue;
      }
    }
    if (chunk) parts.push(chunk);
  }
  return parts.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** True when a BookMyShow URL is invented / placeholder (never send to the user). */
export function isFakeBookMyShowUrl(url: string): boolean {
  const u = url.trim();
  if (!/bookmyshow\.com/i.test(u)) return false;
  if (/ET0*X|XXXX|placeholder|example\.com|ET\d*X+/i.test(u)) return true;
  // buytickets / show deep-links need a real ET###### code
  if (/\/buytickets\//i.test(u) && !/ET\d{6,}/i.test(u)) return true;
  if (/show-ET/i.test(u) && !/ET\d{6,}/i.test(u)) return true;
  if (/movie-[a-z]+-ET[^/\s]*X/i.test(u)) return true;
  return false;
}

/** True when a dining platform URL is inventable / placeholder (never send). */
export function isFakeDiningBookUrl(url: string): boolean {
  const raw = url.trim();
  if (!raw) return false;
  const full = /^https?:\/\//i.test(raw) ? raw : `https://${raw.replace(/^\/\//, "")}`;
  if (!/zomato\.com|dineout\.co\.in|eazydiner\.com/i.test(full)) return false;
  // Only search / query URLs are trusted — place-slug pages are routinely invented.
  if (/[?&](q|query|search)=/i.test(full)) return false;
  if (/\/restaurants\?/i.test(full)) return false;
  if (/\/search\?/i.test(full)) return false;
  // City root alone (zomato.com/bangalore) is ok; anything deeper is unverified.
  if (
    /(?:zomato\.com|eazydiner\.com|dineout\.co\.in)\/[a-z-]+\/?$/i.test(full) &&
    !/\/[a-z-]+\/[a-z0-9-]+/i.test(full)
  ) {
    return false;
  }
  return true;
}

function diningSearchReplacement(url: string, venueHint?: string | null): string {
  const full = /^https?:\/\//i.test(url.trim()) ? url.trim() : `https://${url.trim()}`;
  const slugVenue =
    full.match(/\/([a-z0-9-]+)\/?(?:\?|$)/i)?.[1]?.replace(/-/g, " ") ?? null;
  const venue = (venueHint?.trim() || slugVenue || "restaurant")
    .replace(/\s*&\s*/g, " and ")
    .replace(/\s+/g, " ")
    .slice(0, 80);
  const citySlug =
    full.match(/eazydiner\.com\/([a-z-]+)\//i)?.[1] ??
    full.match(/zomato\.com\/([a-z-]+)\//i)?.[1] ??
    full.match(/dineout\.co\.in\/([a-z-]+)/i)?.[1]?.replace(/-restaurants$/i, "") ??
    "bangalore";
  if (/eazydiner/i.test(full)) {
    return `https://www.eazydiner.com/${citySlug}/search?query=${encodeURIComponent(venue)}`;
  }
  if (/dineout/i.test(full)) {
    return `https://www.dineout.co.in/${citySlug}-restaurants?search=${encodeURIComponent(venue)}`;
  }
  return zomatoSearchUrl(venue, citySlug);
}

/** Pull venue name from a lettered dining line: `A) Olive Bar & Kitchen — …`. */
function venueNameFromDiningLine(line: string): string | null {
  const m = line.match(/^[A-Ea-e1-9]\)\s+([^—\n–-]{2,60})/);
  if (!m?.[1]) return null;
  return m[1].replace(/\s+/g, " ").trim().slice(0, 80) || null;
}

/** Western $-band prices (Zomato/Google style) — never send $ on India WA. */
const DOLLAR_PRICE_BAND_RE = /(\${1,4})\s*[-–—]\s*(\${1,4})/g;
const DOLLAR_PRICE_SOLO_RE = /(?<![A-Za-z0-9])\${1,4}(?![A-Za-z0-9.])/g;

function dollarBandLabel(n: number): string {
  if (n >= 4) return "fine-dining";
  if (n === 3) return "upscale";
  if (n === 2) return "mid-range";
  return "budget";
}

/**
 * Scrub invented showtimes / fake BMS deep-links from outbound life-ops replies.
 * Prefer a verified movie page (ET###### from the same reply or recent chat); else explore.
 */
export function sanitizeLifeOpsReplyText(
  text: string,
  opts?: { recentChat?: string | null; citySlug?: string },
): string {
  let t = formatLifeOpsOptionLines(text);
  if (!t) return t;

  const realFromText = parseBookMyShowUrl(t);
  const realFromChat = opts?.recentChat ? parseBookMyShowUrl(opts.recentChat) : null;
  const real = realFromText ?? realFromChat;
  const city =
    real?.city ??
    opts?.citySlug ??
    (/\bchandigarh|mohali|panchkula\b/i.test(t) ? "chandigarh" : "bengaluru");

  const fallback =
    real?.url ??
    `https://in.bookmyshow.com/explore/movies-${city}`;

  let scrubbedFake = false;
  t = t.replace(
    /https?:\/\/(?:in\.)?bookmyshow\.com\/[^\s)>\]]+/gi,
    (url) => {
      if (!isFakeBookMyShowUrl(url)) return url;
      scrubbedFake = true;
      return fallback;
    },
  );
  // Bare host links without scheme
  t = t.replace(
    /(?:^|[\s(])((?:in\.)?bookmyshow\.com\/[^\s)>\]]+)/gi,
    (full, path: string) => {
      const url = `https://${path}`;
      if (!isFakeBookMyShowUrl(url)) return full;
      scrubbedFake = true;
      const prefix = full.slice(0, full.length - path.length);
      return `${prefix}${fallback.replace(/^https:\/\//, "")}`;
    },
  );

  // Dining: strip Zomato/EazyDiner/Dineout — Maps only (distance/time shortlisting).
  // Also kill Western $-band prices ($$ / $$$) — India copy uses ~₹X for two or mid/upscale words.
  t = t
    .split("\n")
    .map((line) => {
      const venueHint = venueNameFromDiningLine(line);
      const hadDiningPlatform = /zomato|eazy\s*diner|dineout/i.test(line);
      const looksDiningLine =
        hadDiningPlatform ||
        /\$+|₹|rs\.?|for two|cuisine|rooftop|fine.?dine|restaurant|bistro|dhaba|pub|brewery/i.test(
          line,
        );
      let next = line
        .replace(/\b(?:Zomato|Eazy\s*Diner|Dineout)\s*:\s*/gi, "")
        .replace(
          /(?:https?:\/\/(?:www\.)?|(?<![\/\w])(?:www\.)?)(?:eazydiner\.com|zomato\.com|dineout\.co\.in)\/[^\s)>\]]+/gi,
          "",
        )
        .replace(DOLLAR_PRICE_BAND_RE, (_, left: string, right?: string) => {
          const a = dollarBandLabel(left.length);
          const b = right ? dollarBandLabel(right.length) : null;
          if (b && b !== a) return `${a}–${b}`;
          return a;
        })
        .replace(DOLLAR_PRICE_SOLO_RE, (m) => dollarBandLabel(m.length))
        .replace(/\s{2,}/g, " ")
        .replace(/\s+([.,;])/g, "$1")
        .trim();
      if (hadDiningPlatform) scrubbedFake = true;
      if (
        venueHint &&
        looksDiningLine &&
        !/maps\.(google|app)|google\.com\/maps/i.test(next)
      ) {
        const area =
          next.match(/\bnear\s+([A-Za-z][A-Za-z0-9 &'.-]{2,40})/i)?.[1] ??
          (/\bmg\s*road\b/i.test(next) || /\bmg\s*road\b/i.test(t)
            ? "MG Road Bangalore"
            : "Bangalore");
        next = `${next} Maps: ${shortMapsSearchUrl(venueHint, area)}`;
      }
      return next;
    })
    .join("\n");

  if (scrubbedFake) {
    // Drop claims of a specific show deep-link we couldn't verify — no verbose scrub footers.
    t = t.replace(/\bBookMyShow link\s*[—\-–:]\s*/gi, "");
  }

  // Research-only: strip invented BMS checkout links; keep real movie/cinema pages.
  t = t.replace(
    /https?:\/\/(?:in\.)?bookmyshow\.com\/[^\s)>\]]*buytickets[^\s)>\]]*/gi,
    (url) => (isFakeBookMyShowUrl(url) ? "" : url),
  );
  t = t.replace(/\bBook via BookMyShow\.?/gi, "");
  t = t.replace(/\bNext:\s*BookMyShow link[^\n]*/gi, "");
  t = t.replace(/\n*Replaced an unverified[^\n]*/gi, "");
  t = t.replace(/\n*Nothing booked or paid yet\.?/gi, "");

  // One closing pick prompt — drop duplicates from model + wrappers.
  t = t.replace(
    /(?:\n|^)Reply with a letter[^\n]*(?:\n+Reply with a letter[^\n]*)+/gi,
    "\nReply with a letter to pick.",
  );
  t = t.replace(/\n{3,}/g, "\n\n").trim();

  // Flag likely invented "every theatre has exactly the user's clock" lists without a real BMS movie URL.
  const hasRealMoviePage = Boolean(parseBookMyShowUrl(t)?.eventCode);
  const clockHits = t.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/gi) ?? [];
  const normClock = (c: string) =>
    c
      .toLowerCase()
      .replace(/\s+/g, "")
      .replace(/:00(?=[ap]m)/, "");
  const uniqueClocks = new Set(clockHits.map(normClock));
  if (
    !hasRealMoviePage &&
    clockHits.length >= 2 &&
    uniqueClocks.size === 1 &&
    /(?:inox|pvr|cinepolis|theatre|theater|showtimes?)/i.test(t)
  ) {
    // Drop identical invented clocks from option lines; keep theatre names + live page.
    t = t
      .replace(
        /^([A-Z]\)\s+.+?)\s*[—\-–:]\s*\d{1,2}(?::\d{2})?\s*[ap]m\s*(?:show)?\.?\s*$/gim,
        "$1 — check live showtimes",
      )
      .replace(/\(\s*today\s+\d{1,2}(?::\d{2})?\s*[ap]m\s*\)/gi, "(today — live times)")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
    if (!/couldn't confirm identical clocks|won't invent showtimes/i.test(t)) {
      t = `${t}\n\nI couldn't confirm identical clocks from search — Amilo won't invent showtimes. Ask for a theatre or day and I'll research again.`;
    }
  }

  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/** True when chat looks like a pickable life-ops list (any domain), not FOCUS mail. */
export function isLifeOpsPickableList(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  if (
    /\bFOCUS\b/i.test(t) &&
    !DINING_LINE_RE.test(t) &&
    !MOVIE_LINE_RE.test(t) &&
    !FLIGHT_LINE_RE.test(t) &&
    !/Reply with a (?:number|letter|code)\b/i.test(t)
  ) {
    return false;
  }
  return (
    DINING_LINE_RE.test(t) ||
    MOVIE_LINE_RE.test(t) ||
    FLIGHT_LINE_RE.test(t) ||
    /Reply with a (?:number|letter|code)\b/i.test(t) ||
    /(?:^|[^0-9A-Za-z])[A-Z]\d?\)\s+\S/i.test(t) ||
    /(?:^|[^0-9A-Za-z])[1-9]\)\s+\S/.test(t)
  );
}

export type OptionListKind =
  | "dining"
  | "cab"
  | "movie"
  | "travel"
  | "brief_focus"
  | "brief_more"
  | "other";

/** Morning/evening FOCUS or quieter-mail lists that own bare 1/2/3. */
export function looksLikeBriefOptionList(text: string | null | undefined): boolean {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return false;
  return (
    /\bfocus\b/.test(t) ||
    /\bmore from your brief\b/.test(t) ||
    /\bhandled yesterday\b/.test(t) ||
    /\bgood morning\b/.test(t) ||
    /\bmorning brief\b/.test(t) ||
    /\bevening wrap\b/.test(t) ||
    /\bstill open\b/.test(t) ||
    /\breply m for quieter\b/.test(t) ||
    (t.includes("quieter") && /\d+\)/.test(t))
  );
}

export function parseChatTurns(
  chat: string | null | undefined,
): { who: "user" | "amilo"; body: string }[] {
  const raw = (chat ?? "").trim();
  if (!raw || /^none yet$/i.test(raw)) return [];
  const turns: { who: "user" | "amilo"; body: string }[] = [];
  for (const line of raw.split("\n")) {
    const m = line.match(/^(User|Amilo):\s*(.*)$/i);
    if (m) {
      turns.push({
        who: m[1]!.toLowerCase() === "user" ? "user" : "amilo",
        body: m[2] ?? "",
      });
    } else if (turns.length) {
      const last = turns[turns.length - 1]!;
      last.body += (last.body ? "\n" : "") + line;
    }
  }
  return turns;
}

/** Most recent Amilo message that is asking the user to pick an option. */
export function latestAmiloOptionList(recentChat: string | null | undefined): string | null {
  const turns = parseChatTurns(recentChat);
  for (let i = turns.length - 1; i >= 0; i--) {
    const turn = turns[i]!;
    if (turn.who !== "amilo") continue;
    const body = turn.body.trim();
    if (isLifeOpsPickableList(body) || looksLikeBriefOptionList(body)) return body;
  }
  return null;
}

/**
 * Bind an option reply to one list:
 * 1) the message the user quoted (WhatsApp reply-to), else
 * 2) the most recent Amilo option list.
 */
export function optionPickSource(opts: {
  recentChat?: string | null | undefined;
  replyToContent?: string | null | undefined;
}): string {
  const quoted = opts.replyToContent?.trim() ?? "";
  if (quoted) return quoted;
  return latestAmiloOptionList(opts.recentChat) ?? "";
}

export function classifyOptionListKind(text: string | null | undefined): OptionListKind {
  const t = (text ?? "").trim();
  if (!t) return "other";
  const lower = t.toLowerCase();
  if (
    /\bmore from your brief\b/.test(lower) ||
    /\bhandled yesterday\b/.test(lower) ||
    (lower.includes("quieter") && /\d+\)/.test(t))
  ) {
    return "brief_more";
  }
  if (looksLikeBriefOptionList(t)) return "brief_focus";
  if (CAB_LINE_RE.test(t)) return "cab";
  if (MOVIE_LINE_RE.test(t) && !DINING_LINE_RE.test(t) && !FLIGHT_LINE_RE.test(t)) {
    return "movie";
  }
  if (FLIGHT_LINE_RE.test(t) && !DINING_LINE_RE.test(t) && !CAB_LINE_RE.test(t)) {
    return "travel";
  }
  if (DINING_LINE_RE.test(t)) return "dining";
  // Venue shortlist without an explicit "dinner" headline (e.g. quoted "A) Katani Dhaba — Punjabi").
  // Never classify bare macro enumerations (1) BoE… 2) …) as dining.
  if (
    isLifeOpsPickableList(t) &&
    !MOVIE_LINE_RE.test(t) &&
    !FLIGHT_LINE_RE.test(t) &&
    !CAB_LINE_RE.test(t) &&
    /\b(dhaba|cafe|café|kitchen|bistro|eatery|rooftop|brewery|pub|bar\b|for two|₹|rs\.?|zomato|dineout|biryani|punjabi|cuisine|kebabs?|multi-cuisine|fine dining)\b/i.test(
      t,
    )
  ) {
    return "dining";
  }
  return "other";
}

/** True when reply is a life-ops shortlist worth wrapping as research pending. */
export function isLifeOpsResearchShortlist(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t || !isLifeOpsPickableList(t)) return false;
  const kind = classifyOptionListKind(t);
  return kind === "dining" || kind === "movie" || kind === "travel" || kind === "cab";
}

/** Map "1" ↔ "A" when the bound list used the other scheme. */
export function coerceOptionPick(pickId: string, source: string): string | null {
  const id = pickId.trim();
  if (!id || !source.trim()) return null;
  if (resolveListedOptionVenue(source, id)) return id;
  if (/^[1-9]$/.test(id)) {
    const letter = String.fromCharCode(64 + Number(id));
    if (resolveListedOptionVenue(source, letter)) return letter;
  }
  if (/^[A-Za-z]$/.test(id)) {
    const n = id.toUpperCase().charCodeAt(0) - 64;
    if (n >= 1 && n <= 9 && resolveListedOptionVenue(source, String(n))) return String(n);
  }
  return null;
}

/**
 * Bare digit/letter after a life-ops options list must not steal FOCUS mail numbering.
 * Only the latest option list counts, unless the user quoted a specific message.
 */
export function preferLifeOpsNumberPick(opts: {
  text: string;
  recentChat?: string | null | undefined;
  replyToContent?: string | null | undefined;
}): boolean {
  const pickId = parseLifeOpsOptionPick(opts.text);
  if (!pickId) return false;
  const source = optionPickSource(opts);
  if (!source) return false;
  const kind = classifyOptionListKind(source);
  if (kind === "brief_focus" || kind === "brief_more") {
    return !/^[1-9]$/.test(pickId) && Boolean(coerceOptionPick(pickId, source));
  }
  if (!isLifeOpsPickableList(source)) return false;
  return Boolean(coerceOptionPick(pickId, source));
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

/**
 * Calendar "book meeting / book 1h with X" — not vendor life-ops booking.
 * Must stay on the Google calendar path.
 */
export function looksLikeCalendarBookingAsk(text: string): boolean {
  const t = text.trim();
  if (!t || !/\b(book|schedule|block)\b/i.test(t)) return false;
  if (
    /\b(table|reservation|tickets?|seats?|uber|ola|rapido|meru|zomato|eazy\s*diner|dineout|restaurant|dinner|lunch|brunch|pub|bar|flight|hotel|train|movie|cinema|showtimes?)\b/i.test(
      t,
    )
  ) {
    return false;
  }
  return (
    /\b(meeting|call|sync|invite|calendar|\d+\s*(?:min|mins|minutes|hours?|hrs?|hr))\b/i.test(t) ||
    (/\bwith\s+[A-Za-z]/i.test(t) &&
      /\b(at\s+\d|\d{1,2}(?::\d{2})?\s*[ap]m|tomorrow|today|tonight)\b/i.test(t))
  );
}

/**
 * User asked to book/reserve a vendor thing (table, tickets, cab, flight).
 * Partner APIs are off — Amilo states the limit and offers find-only help.
 */
export function isVendorBookOrReserveAsk(text: string): boolean {
  const t = text.trim();
  if (!t || looksLikeCalendarBookingAsk(t)) return false;
  if (/\b(return|refund|subscription|plumber|electrician|handyman)\b/i.test(t)) {
    return false;
  }
  if (/\b(reserve(\s+a)?\s+table|book\s+(a\s+)?(table|reservation|tickets?|seats?))\b/i.test(t)) {
    return true;
  }
  if (!/^(?:book|reserve)\b/i.test(t) && !/\bhand\s?off\b/i.test(t)) return false;
  const h = parseLifeOpsHandoffIntent(t);
  if (h?.channel === "email") return false;
  if (h?.channel === "vendor" && (h.venueHint || h.optionId)) return true;
  const kind = classifyVendorHandoffKind(t);
  return kind === "dining" || kind === "cab" || kind === "movie" || kind === "travel";
}

/** Short WA copy: cannot book/reserve yet; offer find help. */
export function vendorBookingUnavailableReply(opts?: {
  venueHint?: string | null;
  vendorKind?: VendorHandoffKind | null;
}): string {
  const who = opts?.venueHint?.trim() || null;
  const kind = opts?.vendorKind ?? null;
  const head = who
    ? `I can't book or reserve ${who} from Amilo yet.`
    : `I can't book or reserve from Amilo yet.`;
  const offer =
    kind === "cab"
      ? "I can help find cab options though — where/when?"
      : kind === "movie"
        ? "I can help find films and showtimes though — what should I look up?"
        : kind === "travel"
          ? "I can help find flight/hotel options though — where/when?"
          : kind === "dining"
            ? "I can help find places though — area, vibe, or a name to dig into?"
            : "I can help find options though — dinner, movies, flights, cabs. What should I look up?";
  return `${head}\n${offer}`;
}

export type VendorHandoffKind = "dining" | "cab" | "movie" | "travel" | "other";

/** Locked life-ops / brief domain for routing. Null = unlocked → Grok owns the ask. */
export type ActiveDomain =
  | "dining"
  | "cab"
  | "movie"
  | "travel"
  | "brief"
  | "email"
  | "calendar"
  | null;

function domainFromOptionListKind(kind: OptionListKind): ActiveDomain {
  if (kind === "dining" || kind === "cab" || kind === "movie" || kind === "travel") return kind;
  if (kind === "brief_focus" || kind === "brief_more") return "brief";
  return null;
}

function domainFromVendorKind(kind: string | null | undefined): ActiveDomain {
  const k = (kind ?? "").toLowerCase();
  if (k === "dining" || k === "cab" || k === "movie" || k === "travel") return k;
  return null;
}

/** Strong dining wording on this turn (not mere "book <name>"). */
export function hasStrongDiningCues(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (looksLikeMovieTicketAsk(t)) return false;
  if (CAB_LINE_RE.test(t) || parseCabProvider(t)) return false;
  return (
    DINING_LINE_RE.test(t) ||
    /\b(table\s+for|party\s+of|dinner|lunch|brunch|restaurant|reserve\s+a\s+table)\b/i.test(t)
  );
}

/**
 * Single domain lock for life-ops / brief routing.
 * Priority: quote → open pending → latest option list → strong lexical → unlocked (null).
 */
export function resolveActiveDomain(opts: {
  text: string;
  recentChat?: string | null;
  replyToContent?: string | null;
  openPending?: { kind: string; payload?: Record<string, unknown>; summary?: string } | null;
}): ActiveDomain {
  const t = opts.text.trim();
  const quoted = opts.replyToContent?.trim() ?? "";
  if (quoted) {
    const fromQuote = domainFromOptionListKind(classifyOptionListKind(quoted));
    if (fromQuote) return fromQuote;
  }

  const pending = opts.openPending;
  if (pending) {
    if (pending.kind === "email_draft") return "email";
    if (pending.kind.startsWith("calendar_")) return "calendar";
    if (pending.kind === "life_ops_research" || pending.kind === "life_ops_handoff") {
      const fromPayload = domainFromVendorKind(String(pending.payload?.vendorKind ?? ""));
      if (fromPayload) return fromPayload;
      const blob = [
        String(pending.payload?.findings ?? ""),
        String(pending.payload?.script ?? ""),
        String(pending.summary ?? ""),
      ]
        .filter(Boolean)
        .join("\n");
      const fromBlob = domainFromOptionListKind(classifyOptionListKind(blob));
      if (fromBlob) return fromBlob;
    }
  }

  const latest = latestAmiloOptionList(opts.recentChat);
  if (latest) {
    const fromLatest = domainFromOptionListKind(classifyOptionListKind(latest));
    if (fromLatest) return fromLatest;
  }

  if (looksLikeMovieTicketAsk(t)) return "movie";
  if (
    (MOVIE_LINE_RE.test(t) || /\bbook\s+(?:tickets?|seats?)\b/i.test(t)) &&
    !DINING_LINE_RE.test(t) &&
    !CAB_LINE_RE.test(t)
  ) {
    return "movie";
  }
  if (CAB_LINE_RE.test(t) || parseCabProvider(t)) return "cab";
  if (
    /\b(flight|indigo|air\s*india|spicejet|hotel|train)\b/i.test(t) &&
    !CAB_LINE_RE.test(t) &&
    !DINING_LINE_RE.test(t) &&
    !/\btickets?\b/i.test(t)
  ) {
    return "travel";
  }
  if (hasStrongDiningCues(t)) return "dining";

  // Bare "book <name>" with no lock / no strong cues → unlocked (Grok).
  return null;
}

/** True when orchestrator may run a scripted vendor handoff (not Grok-first). */
export function canScriptVendorHandoff(
  domain: ActiveDomain,
  vendorKind: VendorHandoffKind,
  text: string,
): boolean {
  if (looksLikeMovieTicketAsk(text) || domain === "movie" || vendorKind === "movie") {
    return false;
  }
  if (domain === "cab" || vendorKind === "cab") return true;
  if (domain === "travel" || vendorKind === "travel") return true;
  if (domain === "dining" || (vendorKind === "dining" && hasStrongDiningCues(text))) {
    return true;
  }
  // Locked dining list + bare book / letter pick already handled via domain === "dining".
  return false;
}

/** Strip timing/party/flight clauses from "Book Uber, flight is at 11 PM". */
export function cleanBookVenueName(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  let v = raw.trim();
  v = v.replace(
    /[,;]?\s*(?:flight\s+is\s+at|flight\s+at|table\s+for|for\s+\d+|party\s+of|today|tomorrow|tonight)\b.*$/i,
    "",
  );
  v = v.replace(/\s+at\s+\d{1,2}(?::\d{2})?\s*[ap]m\b.*$/i, "");
  v = v.replace(/\s+/g, " ").trim();
  if (!v || BOOK_PLATFORM_ONLY_RE.test(v)) return null;
  return v.slice(0, 80);
}

export function parseCabProvider(text: string | null | undefined): string | null {
  if (!text?.trim()) return null;
  const t = text.trim();
  const fromBook = cleanBookVenueName(t.match(/^(?:book|reserve)\s+(.+)$/i)?.[1] ?? null);
  const hit = t.match(/\b(uber|ola|meru|gozo|rapido)\b/i)?.[1] ?? fromBook;
  if (!hit) return null;
  const name = hit.trim();
  if (/^(uber|ola|meru|gozo|rapido)$/i.test(name)) {
    return name[0]!.toUpperCase() + name.slice(1).toLowerCase();
  }
  return CAB_LINE_RE.test(name) ? name.slice(0, 40) : null;
}

/**
 * Classify vendor handoff so cab/movie never get Zomato dining scripts.
 * "Book Uber, flight is at 11 PM" → cab (flight time = pickup context).
 */
export function classifyVendorHandoffKind(
  text: string,
  recentChat?: string | null,
  replyToContent?: string | null,
): VendorHandoffKind {
  const t = text.trim();
  const source = optionPickSource({ recentChat, replyToContent });

  if (CAB_LINE_RE.test(t) || parseCabProvider(t)) return "cab";
  if (
    /\b(flight|indigo|air\s*india|spicejet|hotel|train)\b/i.test(t) &&
    !CAB_LINE_RE.test(t) &&
    !DINING_LINE_RE.test(t) &&
    !/\btickets?\b/i.test(t)
  ) {
    return "travel";
  }
  if (looksLikeMovieTicketAsk(t)) return "movie";
  if (
    (MOVIE_LINE_RE.test(t) || /\bbook\s+(?:tickets?|seats?)\b/i.test(t)) &&
    !DINING_LINE_RE.test(t) &&
    !CAB_LINE_RE.test(t)
  ) {
    return "movie";
  }
  if (DINING_LINE_RE.test(t) || /\b(table|reserve|restaurant|dinner|lunch|brunch)\b/i.test(t)) {
    return "dining";
  }

  const pick = parseLifeOpsOptionPick(t);
  if (pick && source && coerceOptionPick(pick, source)) {
    const kind = classifyOptionListKind(source);
    if (kind === "cab" || kind === "movie" || kind === "dining" || kind === "travel") {
      return kind;
    }
  }
  if (/^(?:book|reserve)\b/i.test(t)) {
    const cabThread = latestCabThread(recentChat);
    const diningThread = latestDiningThread(recentChat);
    const movieThread = latestMovieThread(recentChat);
    if (cabThread && CAB_LINE_RE.test(cabThread)) return "cab";
    if (diningThread && DINING_LINE_RE.test(diningThread)) return "dining";
    if (movieThread && MOVIE_LINE_RE.test(movieThread)) return "movie";
    // Named place alone is unlocked — Grok researches; do not assume dining.
    if (hasStrongDiningCues(t)) return "dining";
  }
  return "other";
}

/** Day/time (+ optional party) follow-up after a venue was locked — not a fresh "book X". */
export function isWhenPartyFollowUp(text: string): boolean {
  const t = text.trim();
  if (!t || t.length > 80) return false;
  if (/^(?:book|reserve|handoff|hand\s*off)\b/i.test(t)) return false;
  const hasWhen =
    /\b(today|tomorrow|tonight)\b/i.test(t) ||
    /\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i.test(t) ||
    /\b\d{1,2}\s*[ap]m\b/i.test(t);
  const hasParty = parsePartySize(t) != null || /\btable for\s+\d/i.test(t);
  return hasWhen || hasParty;
}

export function buildCabHandoffScript(ctx: {
  provider: string;
  whenHint?: string | null;
  partySize?: number | null;
  routeHint?: string | null;
}): string {
  const p = ctx.provider.trim();
  const link =
    /^uber$/i.test(p)
      ? "https://m.uber.com/"
      : /^ola$/i.test(p)
        ? "https://book.olacabs.com/"
        : /^meru$/i.test(p)
          ? "https://www.merucabs.com/"
          : /^gozo$/i.test(p)
            ? "https://www.gozocabs.com/"
            : `https://www.google.com/search?q=${encodeURIComponent(`${p} cab book`)}`;
  const bits = [
    p,
    ctx.routeHint?.trim() || null,
    ctx.whenHint?.trim() || null,
    ctx.partySize && ctx.partySize > 0 ? `${ctx.partySize} riders` : null,
  ].filter(Boolean);
  return [
    `Open to finish the cab booking (Amilo did not reserve or pay):`,
    `· ${bits.join(" · ")}`,
    `${p}: ${link}`,
    "Use the app for live fare — Amilo won't book or pay.",
  ].join("\n");
}

export function extractCabContext(
  recentChat: string | null | undefined,
  bookText?: string | null,
  replyToContent?: string | null,
): {
  provider: string | null;
  partySize: number | null;
  whenHint: string | null;
  routeHint: string | null;
} | null {
  const source = optionPickSource({ recentChat, replyToContent });
  const sourceKind = classifyOptionListKind(source);
  const thread = latestCabThread(recentChat);
  const chat = thread || (sourceKind === "cab" ? source : "");
  const book = (bookText ?? "").trim();
  if (!chat && !book) return null;
  if (!CAB_LINE_RE.test(book) && !CAB_LINE_RE.test(chat)) return null;

  const pickId = parseLifeOpsOptionPick(book);
  const listForPick = sourceKind === "cab" ? source || chat : chat;
  const coerced =
    pickId && listForPick ? coerceOptionPick(pickId, listForPick) ?? pickId : pickId;
  const provider =
    parseCabProvider(book) ??
    (coerced ? resolveListedOptionVenue(listForPick, coerced) : null) ??
    parseCabProvider(chat);

  const routeHint =
    book.match(/\bfrom\s+.+?\s+to\s+.+?(?:\s+at\b|,|$)/i)?.[0]?.trim() ??
    chat.match(/\bfrom\s+.+?\s+to\s+.+?(?:\s+at\b|,|$)/i)?.[0]?.trim() ??
    chat.match(/\b(?:Home|L&T)[^\n]{0,80}(?:airport|BLR)/i)?.[0]?.trim() ??
    null;

  const whenHint =
    extractUserStatedWhen(recentChat, book) ??
    book.match(/\bflight\s+is\s+at\s+(\d{1,2}(?::\d{2})?\s*[ap]m)\b/i)?.[1]?.trim() ??
    null;

  const partyFromChat = Number(chat.match(/\bfor\s+(\d{1,2})\s+people\b/i)?.[1]) || 0;
  const partySize =
    parsePartySize(book) ?? parsePartySize(chat) ?? (partyFromChat > 0 ? partyFromChat : null);

  return {
    provider: provider && !isBookPlatformOnly(provider) ? provider.slice(0, 40) : null,
    partySize: partySize && partySize > 0 && partySize < 20 ? partySize : null,
    whenHint: whenHint?.slice(0, 80) ?? null,
    routeHint: routeHint?.slice(0, 100) ?? null,
  };
}

export function isWeakLifeOpsHandoffSummary(summary: string | null | undefined): boolean {
  const s = (summary ?? "").trim();
  if (!s) return true;
  if (/^life[_\s-]?ops([_\s-]?handoff)?$/i.test(s)) return true;
  if (/^life[_\s-]?ops[_\s-]?handoff:\s*life\s*ops$/i.test(s)) return true;
  if (s.length < 12) return true;
  return false;
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
        "Want showtimes near you? Say shows for <title> near <area>.",
        "Research-only for now — Amilo can't book seats yet.",
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
        "Live showtimes aren't scraped here — ask for a title + area and I'll research.",
        hints.area ? `I can still list nearby cinemas around ${hints.area} if useful.` : null,
        "Research-only — Amilo can't book seats yet.",
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
          label: "Research a theatre",
          detail: "Ask for a cinema name or area",
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
    const id = lifeOpsOptionId(i, LIFE_OPS_DEFAULT_SCHEME);
    const dist = v.distanceKm != null ? ` · ~${v.distanceKm.toFixed(1)} km` : "";
    const times = v.times.length
      ? v.times.join(", ")
      : hasAnyTimes
        ? "see link"
        : "times on BookMyShow";
    return `${id}) ${v.name}${dist}\n   ${times}`;
  });
  const options: LifeOpsOption[] = sorted.slice(0, 3).map((v, i) => ({
    id: lifeOpsOptionId(i, LIFE_OPS_DEFAULT_SCHEME),
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
      `${lifeOpsPickPrompt(LIFE_OPS_DEFAULT_SCHEME, options.length)} Ask me to dig into a letter if you want more — booking isn't live yet.`,
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
  replyToContent?: string | null,
): LifeOpsDiningContext | null {
  const source = optionPickSource({ recentChat, replyToContent });
  const sourceKind = classifyOptionListKind(source);
  const thread = latestDiningThread(recentChat);
  const chat = thread || (sourceKind === "dining" ? source : "");
  const book = (bookText ?? "").trim();
  if (!chat && !book) return null;
  // Cab / rideshare books are not dining — never feed Uber into Zomato context.
  if (book && (CAB_LINE_RE.test(book) || parseCabProvider(book))) return null;

  const optionPick =
    parseLifeOpsOptionPick(book) ??
    book.match(/^(?:book|reserve|option)\s*([A-Ea-e1-9])\b/i)?.[1]?.toUpperCase() ??
    null;
  if (optionPick && sourceKind !== "dining" && sourceKind !== "other") return null;

  const venueFromBook =
    cleanBookVenueName(
      book.match(/^(?:book|reserve)\s+(.+)$/i)?.[1]?.trim() ??
        book.match(/\bbook\s+(?:a\s+table\s+at\s+|at\s+)(.+)$/i)?.[1]?.trim() ??
        null,
    );
  const venueClean =
    venueFromBook && !/^[A-Ea-e]$/.test(venueFromBook) && !/^[1-9]$/.test(venueFromBook)
      ? venueFromBook
      : null;

  let venueFromList: string | null = null;
  const listForPick = sourceKind === "dining" ? source || chat : chat;
  if (optionPick && listForPick) {
    const coerced = coerceOptionPick(optionPick, listForPick);
    venueFromList = coerced ? resolveListedOptionVenue(listForPick, coerced) : null;
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
    `Open Maps to check distance/time (Amilo did not reserve or pay):`,
    `· ${bits.join(" · ")}`,
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
    const id = lifeOpsOptionId(i, LIFE_OPS_DEFAULT_SCHEME);
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

  // Short lines for WhatsApp — letters avoid FOCUS mail 1–3 collision.
  const lines = [
    head || (hints.vibe === "pub" ? "Pub picks" : "Dining picks"),
    ...options.map((o) => `${o.id}) ${o.label} — ${o.detail}`),
    "",
    `Maps: ${mapsSearchUrl}`,
    `${lifeOpsPickPrompt(LIFE_OPS_DEFAULT_SCHEME, options.length)} I'll ask for day/time (and party size) if missing. Never assume.`,
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
      detail: "Open the Flights page to finish booking yourself — Amilo can't reserve",
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
    "I can't book flights from Amilo yet — pick a letter if you want me to dig further, or open the link yourself.",
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
  const bookNamed = cleanBookVenueName(bookNamedRaw ?? null);

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

  const vendorKind = classifyVendorHandoffKind(t);
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
  // Cab book with "flight is at 11 PM" stays home/cab, not travel.
  const domain: LifeOpsDomain =
    vendorKind === "cab"
      ? "home"
      : venueHint && domainRaw === "travel" && !/\b(flight|hotel|train|indigo)\b/i.test(t)
        ? "home"
        : vendorKind === "travel"
          ? "travel"
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

  if (optionId || venueHint || /\b(table|reservation|restaurant|pub|bar|flight|uber|ola|cab)\b/i.test(t)) {
    const who = venueHint ?? (optionId ? `option ${optionId}` : t.replace(/\s+/g, " ").slice(0, 120));
    const isTravel = vendorKind === "travel" || (domain === "travel" && /\b(flight|hotel|train|indigo)\b/i.test(t));
    const linkHint =
      vendorKind === "cab"
        ? "Reply yes for the cab app link — Amilo won't reserve or pay."
        : vendorKind === "movie"
          ? "Reply yes for BookMyShow link — Amilo won't reserve or pay."
          : vendorKind === "dining"
            ? "Reply yes for Zomato/Dineout/EazyDiner links — Amilo won't reserve or pay."
            : "Reply yes for platform book links — Amilo won't reserve or pay.";
    return {
      domain: isTravel ? "travel" : "home",
      channel: "vendor",
      moneyCapInr,
      ...(optionId ? { optionId } : {}),
      ...(venueHint ? { venueHint } : {}),
      summary: [
        vendorKind === "cab" ? `Cab: ${who}` : `Book links: ${who}`,
        formatMoneyCapNote(moneyCapInr),
        linkHint,
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
  // "Send tomorrow's appointment at Clinic 11–1" is a notify/hold, not a dump-the-instruction errand.
  if (
    /\bappointment\b/i.test(t) &&
    (/\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b/i.test(t) ||
      /\b(?:from\s+)?\d{1,2}.+\bto\b.+\d{1,2}/i.test(t))
  ) {
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
    "Still find-only — Amilo can't book or hand a final pay link. Ask me to dig into a letter, or book yourself on the platform.",
  ].join("\n");
}

export function lifeOpsHandoffConfirmMessage(payload: Record<string, unknown>): string {
  const channel = String(payload.channel ?? "note");
  if (channel === "email") {
    return "Handoff ready as an email draft next — say send when the draft looks right (or cancel).";
  }
  if (channel === "vendor") {
    const kind = String(payload.vendorKind ?? "") as VendorHandoffKind;
    return vendorBookingUnavailableReply({
      venueHint: String(payload.venueHint ?? "").trim() || null,
      vendorKind:
        kind === "dining" || kind === "cab" || kind === "movie" || kind === "travel"
          ? kind
          : null,
    });
  }
  return "Handoff plan locked — nothing spent or sent. Say what to do next.";
}
