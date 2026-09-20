import type { BookingIntent, BookingMerchant, BookingVertical, PaymentMode } from "./types.js";

const MERCHANT_ALIASES: Array<{ re: RegExp; merchant: BookingMerchant }> = [
  { re: /\bzepto\b/i, merchant: "zepto" },
  { re: /\bblinkit\b/i, merchant: "blinkit" },
  { re: /\bbig\s*basket\b|\bbigbasket\b/i, merchant: "bigbasket" },
  { re: /\binstamart\b|\bswiggy\s+instamart\b/i, merchant: "instamart" },
  { re: /\bzomato\b/i, merchant: "zomato" },
  { re: /\beazydiner\b|\beasy\s*diner\b/i, merchant: "eazydiner" },
  { re: /\bbook\s*my\s*show\b|\bbms\b|\bbookmyshow\b/i, merchant: "bookmyshow" },
  { re: /\bdistrict\b/i, merchant: "district" },
  { re: /\buber\b/i, merchant: "uber" },
  { re: /\bola\b/i, merchant: "ola" },
  { re: /\brapido\b/i, merchant: "rapido" },
];

function verticalFor(merchant: BookingMerchant, text: string): BookingVertical {
  if (merchant === "zepto" || merchant === "blinkit" || merchant === "bigbasket" || merchant === "instamart") {
    return "grocery";
  }
  if (merchant === "zomato" || merchant === "eazydiner") return "dining";
  if (merchant === "bookmyshow" || merchant === "district") return "ticketing";
  if (merchant === "uber" || merchant === "ola" || merchant === "rapido") return "cab";
  if (/\b(cab|taxi|ride|uber|ola|rapido)\b/i.test(text)) return "cab";
  if (/\b(movie|ticket|tickets|cinema|pvr|inox)\b/i.test(text)) return "ticketing";
  if (/\b(table|reserv|dinner|lunch|restaurant)\b/i.test(text)) return "dining";
  if (/\b(order|grocery|milk|vegetables|zepto|blinkit)\b/i.test(text)) return "grocery";
  return "generic";
}

function defaultPayment(vertical: BookingVertical): PaymentMode {
  if (vertical === "grocery") return "cod";
  if (vertical === "dining") return "venue";
  if (vertical === "ticketing") return "prepaid_link";
  if (vertical === "cab") return "prepaid_link";
  return "cod";
}

/**
 * Open research / “what’s on” asks — never enter the booking pipeline.
 * Instinct-style: “which Hindi movie is running” is search, not book.
 */
export function isBookingResearchAsk(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  // Explicit transactional verb wins — this is a book ask.
  if (hasExplicitBookingVerb(t)) return false;

  if (/^(which|what|who|where|when|how|is|are|do|does|did|can|could|should)\b/i.test(t)) {
    return true;
  }
  if (
    /\b(running|playing|showing|showtimes?|what'?s\s+on|films?\s+this\s+week|movies?\s+this\s+week)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  // “shows for this?” / BMS link follow-ups without book/buy
  if (/\b(shows?\s+for|showtimes?|timings?)\b/i.test(t)) return true;
  return false;
}

/** Clear intent to place/order/reserve — not mere mention of movie/merchant. */
function hasExplicitBookingVerb(t: string): boolean {
  if (/\b(order|buy|purchase|reserve|place\s+an?\s+order)\b/i.test(t)) return true;
  // "book tickets/cab/table" — strip merchant brand "BookMyShow" first
  const withoutBrand = t.replace(/\bbook\s*my\s*show\b/gi, "BMS");
  if (/\bbook\b/i.test(withoutBrand)) return true;
  // "get/grab X from Zepto"
  if (
    /\b(get|grab)\b/i.test(t) &&
    /\b(from|on)\s+(zepto|blinkit|big\s*basket|bigbasket|instamart)\b/i.test(t)
  ) {
    return true;
  }
  // "uber to airport" / "ola to Indiranagar"
  if (/\b(uber|ola|rapido)\s+to\b/i.test(t)) return true;
  return false;
}

/**
 * Standing parse for life bookings. Returns null if not a booking ask.
 * Phone must be supplied by the channel layer.
 *
 * Research questions (what’s playing, which movie…) return null so life-ops /
 * brain can answer — only explicit book/order/reserve enters this pipeline.
 */
export function parseBookingIntent(
  text: string,
  phone: string,
): BookingIntent | null {
  const t = text.trim();
  if (!t || t.length > 800) return null;
  if (!phone?.trim()) return null;

  // Don't steal calendar / pure life-ops research / open web asks.
  if (/\b(block calendar|invite |add to calendar|check flight|flights?\s+from)\b/i.test(t)) {
    return null;
  }
  if (isBookingResearchAsk(t)) return null;
  if (!hasExplicitBookingVerb(t)) return null;

  let merchant: BookingMerchant = "generic";
  for (const a of MERCHANT_ALIASES) {
    if (a.re.test(t)) {
      merchant = a.merchant;
      break;
    }
  }
  if (merchant === "generic") {
    if (/\b(cab|taxi|ride|uber|ola|rapido)\b/i.test(t)) merchant = "uber";
    else if (/\b(movie|cinema|tickets?|pvr|inox|bookmyshow)\b/i.test(t)) merchant = "bookmyshow";
    else if (/\b(table|reserv|dinner|lunch)\b/i.test(t) && !/\border\b/i.test(t))
      merchant = "zomato";
    else if (/\b(order|grocery|milk|cheese|vegetables|zepto|blinkit)\b/i.test(t))
      merchant = "zepto";
  }

  const vertical = verticalFor(merchant, t);
  const partySize =
    Number(t.match(/\btable for\s+(\d{1,2})\b/i)?.[1]) ||
    Number(t.match(/\b(\d{1,2})\s+(?:tickets?|seats?)\b/i)?.[1]) ||
    null;
  const whenHint =
    t.match(/\b(tomorrow|today|tonight)\b[^.]{0,40}/i)?.[0]?.trim() ??
    t.match(/\b\d{1,2}(?::\d{2})?\s*[ap]m\b/i)?.[0]?.trim() ??
    null;
  const venueHint =
    t.match(/\bat\s+([A-Z][A-Za-z0-9 &'.-]{2,40})/)?.[1]?.trim() ??
    t.match(/\b(pvr|inox)\s+([A-Za-z0-9 &'-]{2,40})/i)?.[0]?.trim() ??
    null;

  const destinationHint =
    t.match(/\b(?:to|towards)\s+([A-Za-z0-9 &'.-]{2,60})/i)?.[1]?.trim() ?? null;

  const email =
    t.match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i)?.[1]?.trim() ?? null;

  const items: string[] = [];
  const fromOrder = t.match(
    /\b(?:order|get|buy)\s+(.+?)(?:\s+from\s+|\s+on\s+|$)/i,
  )?.[1];
  if (fromOrder) {
    for (const part of fromOrder.split(/\band\b|,/i)) {
      const s = part.trim();
      if (s && s.length < 80) items.push(s);
    }
  }

  const movieHint =
    vertical === "ticketing"
      ? t.match(/\b(?:for|movie)\s+([A-Za-z0-9 :'-]{2,60})/i)?.[1]?.trim() ??
        (t.replace(/\b(book|tickets?|for|at|pvr|inox|bookmyshow)\b/gi, "").trim().slice(0, 60) ||
          null)
      : null;

  return {
    vertical,
    merchant,
    query: t.replace(/\s+/g, " ").slice(0, 240),
    phone: phone.trim(),
    ...(email ? { email } : {}),
    ...(items.length ? { items } : {}),
    partySize: partySize && partySize > 0 ? partySize : null,
    whenHint,
    venueHint,
    ...(destinationHint ? { destinationHint } : {}),
    ...(movieHint ? { movieHint } : {}),
    preferredPayment: defaultPayment(vertical),
  };
}

/** OTP reply while a booking_otp pending is open — bare 4–8 digit code. */
export function parseBookingOtpReply(text: string): string | null {
  const t = text.trim();
  const m = t.match(/^(\d{4,8})$/);
  return m?.[1] ?? null;
}

/**
 * Email reply while booking_email pending is open.
 * Returns the email, "use_linked" for yes/ok without an address, or null.
 */
export function parseBookingEmailReply(
  text: string,
): { email: string } | { useLinked: true } | null {
  const t = text.trim();
  if (!t || /^(cancel|no|nope)$/i.test(t)) return null;
  const email = t.match(/\b([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})\b/i)?.[1]?.trim();
  if (email) return { email: email.toLowerCase() };
  if (/^(yes|y|ok|okay|sure|use email|email)$/i.test(t)) return { useLinked: true };
  return null;
}
