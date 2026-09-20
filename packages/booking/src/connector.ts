import { exceedsSpendCap, getAllowlistEntry, isHostAllowed } from "./allowlist.js";
import type {
  ApiAdapter,
  BookingIntent,
  BookingMerchant,
  BookingResult,
  BrowserSkillRunner,
  PaymentMode,
} from "./types.js";

export type BookingConnectorOpts = {
  adapters?: ApiAdapter[];
  browser?: BrowserSkillRunner | null;
  /** When true, generic hosts beyond allowlist may run (still spend-capped). */
  allowAnySite?: boolean;
};

/**
 * API-preferred booking router. Browser is fallback when no live adapter
 * or API returns failed/blocked.
 */
export class BookingConnector {
  private adapters: Map<BookingMerchant, ApiAdapter>;
  private browser: BrowserSkillRunner | null;
  private allowAnySite: boolean;

  constructor(opts: BookingConnectorOpts = {}) {
    this.adapters = new Map();
    for (const a of opts.adapters ?? []) {
      this.adapters.set(a.merchant, a);
    }
    this.browser = opts.browser ?? null;
    this.allowAnySite = opts.allowAnySite === true;
  }

  registerAdapter(adapter: ApiAdapter): void {
    this.adapters.set(adapter.merchant, adapter);
  }

  setBrowser(runner: BrowserSkillRunner | null): void {
    this.browser = runner;
  }

  resolvePaymentMode(intent: BookingIntent): PaymentMode {
    const entry = getAllowlistEntry(intent.merchant);
    if (intent.preferredPayment) return intent.preferredPayment;
    if (intent.vertical === "ticketing") return "prepaid_link";
    if (intent.vertical === "dining") return "venue";
    if (intent.vertical === "cab") return "prepaid_link";
    if (entry) return intent.vertical === "grocery" ? "cod" : "cod";
    return "cod";
  }

  async fulfill(intent: BookingIntent): Promise<BookingResult> {
    const entry = getAllowlistEntry(intent.merchant);
    if (!entry && intent.merchant !== "generic" && !this.allowAnySite) {
      return {
        status: "blocked",
        merchant: intent.merchant,
        message: `${intent.merchant} isn't on the Amilo booking allowlist yet.`,
      };
    }
    if (intent.merchant === "generic" && !this.allowAnySite) {
      return {
        status: "failed",
        message:
          "Tell me which service (Zepto, Blinkit, BookMyShow, Zomato, …) — or ask to enable general sites.",
      };
    }

    const api = this.adapters.get(intent.merchant);
    if (api?.enabled) {
      try {
        const result = await api.searchAndFulfill(intent);
        if (result.status !== "failed" && result.status !== "blocked") {
          return this.enforceSpendCap(intent, result);
        }
        // Fall through to browser on soft failure.
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "booking_api_failed",
            merchant: intent.merchant,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }

    if (!this.browser) {
      return {
        status: "failed",
        message:
          "Live booking isn't configured yet (no partner API or browser agent). I can still draft a handoff — say book <place> for dining.",
      };
    }

    const result = await this.browser.start(intent);
    return this.enforceSpendCap(intent, result);
  }

  async submitOtp(jobId: string, otp: string): Promise<BookingResult> {
    if (!this.browser) {
      return { status: "failed", message: "Browser agent offline — can't submit OTP." };
    }
    return this.browser.submitOtp(jobId, otp);
  }

  async selectOptions(jobId: string, selection: string): Promise<BookingResult> {
    if (!this.browser) {
      return { status: "failed", message: "Browser agent offline." };
    }
    return this.browser.selectOptions(jobId, selection);
  }

  async confirmPlace(jobId: string): Promise<BookingResult> {
    if (!this.browser) {
      return { status: "failed", message: "Browser agent offline." };
    }
    return this.browser.confirmPlace(jobId);
  }

  private enforceSpendCap(intent: BookingIntent, result: BookingResult): BookingResult {
    const total =
      result.status === "ready_confirm" || result.status === "pay_link"
        ? result.totalInr
        : null;
    if (exceedsSpendCap(intent.merchant, total)) {
      return {
        status: "blocked",
        merchant: intent.merchant,
        message: `Total ₹${total} is over the Amilo spend cap for ${intent.merchant}. Lower the cart or raise the cap.`,
      };
    }
    return result;
  }
}

export function formatBookingResultForWa(result: BookingResult): string {
  switch (result.status) {
    case "needs_otp":
      return result.message;
    case "needs_selection":
      return [
        result.message,
        ...result.options.map(
          (o) =>
            `${o.id}) ${o.label}${o.unitInr != null ? ` — ₹${o.unitInr}` : ""}${o.detail ? ` · ${o.detail}` : ""}`,
        ),
        "",
        "Reply with picks (e.g. milk 3 cheese A) or cancel.",
      ].join("\n");
    case "ready_confirm":
      return [
        result.summary,
        result.paymentMode === "cod"
          ? "Pay on delivery"
          : result.paymentMode === "venue"
            ? "Pay at venue"
            : "No payment needed",
        result.totalInr != null ? `Total ₹${result.totalInr}` : null,
        result.address ? `Deliver / meet: ${result.address}` : null,
        "",
        "Reply yes to place / confirm, cancel to drop.",
      ]
        .filter(Boolean)
        .join("\n");
    case "pay_link":
      return [
        result.summary,
        result.totalInr != null ? `Amount ₹${result.totalInr}` : null,
        "",
        "Pay here to finish (Amilo won't enter UPI/card):",
        result.payUrl,
        "",
        "After you pay, send done or forward the ticket/receipt.",
      ]
        .filter(Boolean)
        .join("\n");
    case "placed":
      return result.summary + (result.orderId ? `\nOrder: ${result.orderId}` : "");
    case "blocked":
      return [
        result.message,
        result.alternatives?.length
          ? `Try: ${result.alternatives.join(", ")}`
          : null,
      ]
        .filter(Boolean)
        .join("\n");
    case "failed":
      return result.message;
    default:
      return "Booking update.";
  }
}

export { isHostAllowed };
