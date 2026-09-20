import type { BookingMerchant } from "@amilo/booking";
import { createBookMyShowAdapter } from "./bookmyshow.js";
import { createCabAdapter } from "./cab.js";
import { createGroceryAdapter } from "./grocery.js";
import { createStubAdapter } from "./stub.js";
import type { SiteAdapter } from "./types.js";

const adapters: Map<BookingMerchant, SiteAdapter> = new Map();

function buildRegistry(): Map<BookingMerchant, SiteAdapter> {
  const list: SiteAdapter[] = [
    createGroceryAdapter({
      merchant: "zepto",
      homeUrl: "https://www.zepto.com",
      alternatives: ["blinkit", "bigbasket"],
    }),
    createGroceryAdapter({
      merchant: "blinkit",
      homeUrl: "https://blinkit.com",
      alternatives: ["zepto", "bigbasket"],
    }),
    createGroceryAdapter({
      merchant: "bigbasket",
      homeUrl: "https://www.bigbasket.com",
      alternatives: ["zepto", "blinkit"],
    }),
    createBookMyShowAdapter(),
    createCabAdapter({ merchant: "uber", homeUrl: "https://m.uber.com" }),
    createCabAdapter({ merchant: "ola", homeUrl: "https://www.olacabs.com" }),
    createStubAdapter({
      merchant: "rapido",
      vertical: "cab",
      homeUrl: "https://www.rapido.bike",
      message: "Rapido live booking isn't wired yet — try Uber or Ola.",
      alternatives: ["uber", "ola"],
    }),
    createStubAdapter({
      merchant: "instamart",
      vertical: "grocery",
      homeUrl: "https://www.swiggy.com",
      alternatives: ["zepto", "blinkit"],
    }),
    createStubAdapter({
      merchant: "district",
      vertical: "ticketing",
      homeUrl: "https://www.district.in",
      alternatives: ["bookmyshow"],
    }),
    createStubAdapter({
      merchant: "zomato",
      vertical: "dining",
      homeUrl: "https://www.zomato.com",
      message: "Dining live table book is light for now — confirm venue pay after demo hold.",
    }),
    createStubAdapter({
      merchant: "eazydiner",
      vertical: "dining",
      homeUrl: "https://www.eazydiner.com",
    }),
    createStubAdapter({
      merchant: "generic",
      vertical: "generic",
      homeUrl: "about:blank",
      message: "Name a merchant (Zepto, BookMyShow, Uber…).",
    }),
  ];
  const map = new Map<BookingMerchant, SiteAdapter>();
  for (const a of list) map.set(a.merchant, a);
  return map;
}

export function getSiteAdapter(merchant: BookingMerchant): SiteAdapter {
  if (!adapters.size) {
    for (const [k, v] of buildRegistry()) adapters.set(k, v);
  }
  return (
    adapters.get(merchant) ??
    createStubAdapter({
      merchant,
      vertical: "generic",
      homeUrl: "about:blank",
      message: `No live adapter for ${merchant}.`,
    })
  );
}
