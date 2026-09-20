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
];

function verticalFor(merchant: BookingMerchant, text: string): BookingVertical {
  if (merchant === "zepto" || merchant === "blinkit" || merchant === "bigbasket" || merchant === "instamart") {
    return "grocery";
  }
  if (merchant === "zomato" || merchant === "eazydiner") return "dining";
  if (merchant === "bookmyshow" || merchant === "district") return "ticketing";
  if (/\b(movie|ticket|tickets|cinema|pvr|inox)\b/i.test(text)) return "ticketing";
  if (/\b(table|reserv|dinner|lunch|restaurant)\b/i.test(text)) return "dining";
  if (/\b(order|grocery|milk|vegetables|zepto|blinkit)\b/i.test(text)) return "grocery";
  return "generic";
}

function defaultPayment(vertical: BookingVertical): PaymentMode {
  if (vertical === "grocery") return "cod";
  if (vertical === "dining") return "venue";
  if (vertical === "ticketing") return "prepaid_link";
  return "cod";
}

/**
 * Standing parse for life bookings. Returns null if not a booking ask.
 * Phone must be supplied by the channel layer.
 */
export function parseBookingIntent(
  text: string,
  phone: string,
): BookingIntent | null {
  const t = text.trim();
  if (!t || t.length > 800) return null;
  if (!phone?.trim()) return null;

  const looksBooking =
    /\b(order|buy|get|book|reserve|tickets?|grocery|milk|cheese|table for|movie|cinema)\b/i.test(
      t,
    ) || MERCHANT_ALIASES.some((a) => a.re.test(t));
  if (!looksBooking) return null;

  // Don't steal calendar / pure life-ops research.
  if (/\b(block calendar|invite |add to calendar|check flight|flights?\s+from)\b/i.test(t)) {
    return null;
  }

  let merchant: BookingMerchant = "generic";
  for (const a of MERCHANT_ALIASES) {
    if (a.re.test(t)) {
      merchant = a.merchant;
      break;
    }
  }
  if (merchant === "generic") {
    if (/\b(movie|cinema|tickets?|pvr|inox)\b/i.test(t)) merchant = "bookmyshow";
    else if (/\b(table|reserv|dinner|lunch)\b/i.test(t) && !/\border\b/i.test(t))
      merchant = "zomato";
    else if (/\b(order|grocery|milk|cheese|vegetables)\b/i.test(t)) merchant = "zepto";
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

  return {
    vertical,
    merchant,
    query: t.replace(/\s+/g, " ").slice(0, 240),
    phone: phone.trim(),
    ...(items.length ? { items } : {}),
    partySize: partySize && partySize > 0 ? partySize : null,
    whenHint,
    venueHint,
    preferredPayment: defaultPayment(vertical),
  };
}

/** OTP reply while a booking_otp pending is open — bare 4–8 digit code. */
export function parseBookingOtpReply(text: string): string | null {
  const t = text.trim();
  const m = t.match(/^(\d{4,8})$/);
  return m?.[1] ?? null;
}
