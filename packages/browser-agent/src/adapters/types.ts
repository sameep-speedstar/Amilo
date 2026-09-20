import type { Page } from "playwright";
import type {
  BookingBlocked,
  BookingIntent,
  BookingMerchant,
  BookingNeedsSelection,
  BookingPayLink,
  BookingPlaced,
  BookingReadyConfirm,
  BookingVertical,
  OtpChannel,
  SelectionOption,
} from "@amilo/booking";

export type LoginCtx = {
  phoneE164: string;
  email?: string | null;
};

export type LoginStep =
  | {
      kind: "needs_otp";
      channel: OtpChannel;
      message: string;
    }
  | { kind: "logged_in" }
  | { kind: "blocked"; reason: string }
  | { kind: "need_email"; message: string };

export type PlaceDraft =
  | BookingReadyConfirm
  | BookingPayLink
  | BookingNeedsSelection;

/**
 * Merchant plugin for live browser bookings.
 * Implement per site; runner dispatches by merchant.
 */
export type SiteAdapter = {
  merchant: BookingMerchant;
  vertical: BookingVertical;
  homeUrl: string;
  login(page: Page, ctx: LoginCtx): Promise<LoginStep>;
  submitOtp(page: Page, otp: string): Promise<LoginStep>;
  search(
    page: Page,
    intent: BookingIntent,
    jobId: string,
  ): Promise<BookingNeedsSelection | BookingBlocked>;
  applySelection(
    page: Page,
    intent: BookingIntent,
    jobId: string,
    picks: string[],
    options: SelectionOption[],
  ): Promise<BookingReadyConfirm | BookingPayLink | BookingBlocked>;
  place(
    page: Page,
    draft: PlaceDraft,
  ): Promise<BookingPlaced | BookingPayLink | BookingBlocked>;
};
