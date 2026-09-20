import type { BookingMerchant, BookingVertical } from "./types.js";

export type AllowlistEntry = {
  merchant: BookingMerchant;
  vertical: BookingVertical;
  hosts: string[];
  /** Max order/ticket total INR before hard stop (user must reconfirm higher). */
  spendCapInr: number;
  /** Max concurrent jobs per user for this merchant. */
  maxJobsPerUser: number;
};

/** Beta allowlist before true any-site. Expand via config / env later. */
export const BOOKING_ALLOWLIST: AllowlistEntry[] = [
  {
    merchant: "zepto",
    vertical: "grocery",
    hosts: ["zepto.com", "www.zepto.com"],
    spendCapInr: 5000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "blinkit",
    vertical: "grocery",
    hosts: ["blinkit.com", "www.blinkit.com"],
    spendCapInr: 5000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "bigbasket",
    vertical: "grocery",
    hosts: ["bigbasket.com", "www.bigbasket.com"],
    spendCapInr: 5000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "instamart",
    vertical: "grocery",
    hosts: ["swiggy.com", "www.swiggy.com"],
    spendCapInr: 5000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "zomato",
    vertical: "dining",
    hosts: ["zomato.com", "www.zomato.com"],
    spendCapInr: 10000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "eazydiner",
    vertical: "dining",
    hosts: ["eazydiner.com", "www.eazydiner.com"],
    spendCapInr: 10000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "bookmyshow",
    vertical: "ticketing",
    hosts: ["bookmyshow.com", "in.bookmyshow.com", "www.bookmyshow.com"],
    spendCapInr: 8000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "district",
    vertical: "ticketing",
    hosts: ["district.in", "www.district.in"],
    spendCapInr: 8000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "uber",
    vertical: "cab",
    hosts: ["uber.com", "www.uber.com", "m.uber.com"],
    spendCapInr: 3000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "ola",
    vertical: "cab",
    hosts: ["olacabs.com", "www.olacabs.com"],
    spendCapInr: 3000,
    maxJobsPerUser: 1,
  },
  {
    merchant: "rapido",
    vertical: "cab",
    hosts: ["rapido.bike", "www.rapido.bike"],
    spendCapInr: 1500,
    maxJobsPerUser: 1,
  },
];

const DEFAULT_GENERIC_CAP = 3000;

export function getAllowlistEntry(merchant: BookingMerchant): AllowlistEntry | null {
  return BOOKING_ALLOWLIST.find((e) => e.merchant === merchant) ?? null;
}

export function isHostAllowed(urlOrHost: string): boolean {
  let host = urlOrHost.trim().toLowerCase();
  try {
    if (host.includes("://")) host = new URL(host).hostname;
  } catch {
    /* keep raw */
  }
  host = host.replace(/^www\./, "");
  return BOOKING_ALLOWLIST.some((e) =>
    e.hosts.some((h) => h.replace(/^www\./, "") === host || host.endsWith(`.${h.replace(/^www\./, "")}`)),
  );
}

/** Generic any-site: only when explicitly enabled; still spend-capped. */
export function allowGenericSite(enabled: boolean): boolean {
  return enabled === true;
}

export function spendCapFor(merchant: BookingMerchant): number {
  return getAllowlistEntry(merchant)?.spendCapInr ?? DEFAULT_GENERIC_CAP;
}

export function exceedsSpendCap(merchant: BookingMerchant, totalInr: number | null): boolean {
  if (totalInr == null || !(totalInr > 0)) return false;
  return totalInr > spendCapFor(merchant);
}
