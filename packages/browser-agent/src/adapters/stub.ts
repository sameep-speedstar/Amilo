import type {
  BookingBlocked,
  BookingMerchant,
  BookingNeedsSelection,
  BookingPayLink,
  BookingPlaced,
  BookingVertical,
} from "@amilo/booking";
import type { LoginStep, SiteAdapter } from "./types.js";

/** Allowlisted but not yet automated — honest blocked. */
export function createStubAdapter(opts: {
  merchant: BookingMerchant;
  vertical: BookingVertical;
  homeUrl: string;
  message?: string;
  alternatives?: BookingMerchant[];
}): SiteAdapter {
  const {
    merchant,
    vertical,
    homeUrl,
    message = `Live browser for ${merchant} isn't wired yet — try Zepto, BookMyShow, or Uber.`,
    alternatives,
  } = opts;
  const blocked = (): BookingBlocked => ({
    status: "blocked",
    merchant,
    message,
    ...(alternatives?.length ? { alternatives } : {}),
  });

  return {
    merchant,
    vertical,
    homeUrl,
    async login(): Promise<LoginStep> {
      return { kind: "blocked", reason: message };
    },
    async submitOtp(): Promise<LoginStep> {
      return { kind: "blocked", reason: message };
    },
    async search(): Promise<BookingNeedsSelection | BookingBlocked> {
      return blocked();
    },
    async applySelection(): Promise<BookingPayLink | BookingBlocked> {
      return blocked();
    },
    async place(): Promise<BookingPlaced | BookingPayLink | BookingBlocked> {
      return blocked();
    },
  };
}
