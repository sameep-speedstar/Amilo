/** Life bookings — grocery, dining, tickets, cab, generic. API-preferred; browser fallback. */

export type BookingVertical = "grocery" | "dining" | "ticketing" | "cab" | "generic";

/** How Amilo finishes payment. Never enters UPI/card. */
export type PaymentMode = "cod" | "venue" | "prepaid_link" | "none";

export type BookingMerchant =
  | "zepto"
  | "blinkit"
  | "bigbasket"
  | "instamart"
  | "zomato"
  | "eazydiner"
  | "bookmyshow"
  | "district"
  | "uber"
  | "ola"
  | "rapido"
  | "generic";

/** Login channel for OTP relay on WhatsApp. */
export type OtpChannel = "mobile" | "email";

export type BookingIntent = {
  vertical: BookingVertical;
  merchant: BookingMerchant;
  query: string;
  phone: string;
  /** Optional email for sites that prefer email login. */
  email?: string | null;
  /** Structured hints from parse. */
  items?: string[];
  partySize?: number | null;
  whenHint?: string | null;
  venueHint?: string | null;
  addressHint?: string | null;
  movieHint?: string | null;
  /** Cab destination hint. */
  destinationHint?: string | null;
  /** Preferred payment; connector may override if merchant cannot. */
  preferredPayment?: PaymentMode;
};

export type BookingLineItem = {
  id: string;
  label: string;
  qty: number;
  unitInr: number | null;
};

export type BookingNeedsOtp = {
  status: "needs_otp";
  merchant: BookingMerchant;
  message: string;
  jobId: string;
  otpChannel?: OtpChannel;
};

/** Waiting for user to supply email after mobile login failed. */
export type BookingNeedsEmail = {
  status: "needs_email";
  merchant: BookingMerchant;
  message: string;
  jobId: string;
};

export type SelectionOption = {
  id: string;
  label: string;
  detail?: string;
  unitInr?: number | null;
  /** Opaque adapter hint (href / sku) — not shown on WA. */
  meta?: Record<string, unknown>;
};

export type BookingNeedsSelection = {
  status: "needs_selection";
  merchant: BookingMerchant;
  message: string;
  options: SelectionOption[];
  jobId: string;
};

export type BookingReadyConfirm = {
  status: "ready_confirm";
  merchant: BookingMerchant;
  paymentMode: "cod" | "venue" | "none";
  summary: string;
  totalInr: number | null;
  lines: BookingLineItem[];
  address?: string | null;
  jobId: string;
};

export type BookingPayLink = {
  status: "pay_link";
  merchant: BookingMerchant;
  paymentMode: "prepaid_link";
  summary: string;
  totalInr: number | null;
  payUrl: string;
  jobId: string;
};

export type BookingPlaced = {
  status: "placed";
  merchant: BookingMerchant;
  orderId: string | null;
  summary: string;
};

export type BookingBlocked = {
  status: "blocked";
  merchant: BookingMerchant;
  message: string;
  alternatives?: BookingMerchant[];
};

export type BookingFailed = {
  status: "failed";
  message: string;
};

export type BookingResult =
  | BookingNeedsOtp
  | BookingNeedsEmail
  | BookingNeedsSelection
  | BookingReadyConfirm
  | BookingPayLink
  | BookingPlaced
  | BookingBlocked
  | BookingFailed;

export type ApiAdapter = {
  merchant: BookingMerchant;
  vertical: BookingVertical;
  paymentModes: PaymentMode[];
  /** True when founding team has live partner credentials. */
  enabled: boolean;
  searchAndFulfill: (intent: BookingIntent) => Promise<BookingResult>;
};

export type BrowserSkillRunner = {
  start: (intent: BookingIntent) => Promise<BookingResult>;
  submitOtp: (jobId: string, otp: string) => Promise<BookingResult>;
  selectOptions: (jobId: string, selection: string) => Promise<BookingResult>;
  confirmPlace: (jobId: string) => Promise<BookingResult>;
  /** Resume login with email after needs_email. */
  continueWithEmail?: (jobId: string, email: string) => Promise<BookingResult>;
  /** Reattach an in-flight job after process recycle (from DB). */
  rehydrateJob?: (job: {
    id: string;
    userId: string;
    intent: BookingIntent;
    phase: string;
    draft?: BookingResult;
  }) => void;
};
