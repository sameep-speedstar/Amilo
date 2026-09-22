import type { ApiAdapter, BookingIntent, BookingResult } from "../types.js";

/**
 * Stub adapters — enabled:false until founding team lands partner APIs.
 * Flip `enabled` + implement searchAndFulfill when credentials exist.
 */
function stub(
  merchant: ApiAdapter["merchant"],
  vertical: ApiAdapter["vertical"],
  paymentModes: ApiAdapter["paymentModes"],
): ApiAdapter {
  return {
    merchant,
    vertical,
    paymentModes,
    enabled: false,
    async searchAndFulfill(_intent: BookingIntent): Promise<BookingResult> {
      return {
        status: "failed",
        message: `${merchant} API not enabled yet — falling back to browser.`,
      };
    },
  };
}

export const PARTNER_API_STUBS: ApiAdapter[] = [
  stub("zepto", "grocery", ["cod", "prepaid_link"]),
  stub("blinkit", "grocery", ["cod", "prepaid_link"]),
  stub("bigbasket", "grocery", ["cod", "prepaid_link"]),
  stub("instamart", "grocery", ["cod", "prepaid_link"]),
  stub("zomato", "dining", ["venue", "none"]),
  stub("eazydiner", "dining", ["venue", "none"]),
  stub("bookmyshow", "ticketing", ["prepaid_link"]),
  stub("district", "ticketing", ["prepaid_link"]),
  stub("uber", "cab", ["prepaid_link", "none"]),
  stub("ola", "cab", ["prepaid_link", "none"]),
  stub("rapido", "cab", ["prepaid_link", "none"]),
];

/** BD checklist — track in docs; flip adapters when live. */
export const PARTNER_API_BD_TRACK = [
  { merchant: "zepto", need: "Phone-auth grocery order API / agent program" },
  { merchant: "blinkit", need: "Phone-auth grocery order API" },
  { merchant: "bigbasket", need: "Phone-auth or agentic checkout API" },
  { merchant: "zomato", need: "Table reservation API" },
  { merchant: "eazydiner", need: "Reservation partner API" },
  { merchant: "bookmyshow", need: "Seat hold + payment-link API" },
  { merchant: "uber", need: "Ride quote + book API (Riders API — request scope; Limited Access OK for founder)" },
  { merchant: "ola", need: "Ride quote + book API" },
] as const;
