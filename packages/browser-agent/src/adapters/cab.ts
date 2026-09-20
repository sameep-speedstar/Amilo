import type { Page } from "playwright";
import type {
  BookingBlocked,
  BookingMerchant,
  BookingNeedsSelection,
  BookingPayLink,
  BookingPlaced,
  BookingReadyConfirm,
  SelectionOption,
} from "@amilo/booking";
import { clickFirst } from "../skills/phoneLogin.js";
import { loginMobileThenEmail, submitLoginOtp } from "./login.js";
import type { LoginCtx, LoginStep, SiteAdapter } from "./types.js";

export function createCabAdapter(opts: {
  merchant: BookingMerchant;
  homeUrl: string;
}): SiteAdapter {
  const { merchant, homeUrl } = opts;

  return {
    merchant,
    vertical: "cab",
    homeUrl,
    async login(page: Page, ctx: LoginCtx): Promise<LoginStep> {
      return loginMobileThenEmail({ page, merchant, homeUrl, ctx });
    },
    async submitOtp(page: Page, otp: string): Promise<LoginStep> {
      return submitLoginOtp(page, otp, "mobile");
    },
    async search(page, intent, jobId): Promise<BookingNeedsSelection | BookingBlocked> {
      const dest = intent.destinationHint ?? intent.query.slice(0, 60);
      const destField = page
        .locator(
          'input[placeholder*="Where to" i], input[placeholder*="Destination" i], input[aria-label*="destination" i]',
        )
        .first();
      if ((await destField.count().catch(() => 0)) > 0) {
        await destField.fill("");
        await destField.type(dest, { delay: 40 });
        await page.waitForTimeout(1000);
      }
      const options: SelectionOption[] = [
        { id: "1", label: "Uber Go / Mini", detail: dest, unitInr: null },
        { id: "2", label: "Sedan / Premier", detail: dest, unitInr: null },
        { id: "3", label: "Auto / Moto", detail: dest, unitInr: null },
      ];
      // Try scrape live quotes
      const body = ((await page.innerText("body").catch(() => "")) || "").replace(/\s+/g, " ");
      const quoteM = [...body.matchAll(/(Uber\s+\w+|Go|Premier|Auto|Mini)[^\d]{0,20}₹\s*(\d+)/gi)];
      if (quoteM.length) {
        return {
          status: "needs_selection",
          merchant,
          jobId,
          message: `Cab to ${dest} — pick a ride:`,
          options: quoteM.slice(0, 5).map((m, i) => ({
            id: String(i + 1),
            label: m[1]!.trim(),
            unitInr: Number(m[2]),
            detail: dest,
          })),
        };
      }
      return {
        status: "needs_selection",
        merchant,
        jobId,
        message: `Cab to ${dest} — pick a vehicle class:`,
        options,
      };
    },
    async applySelection(page, intent, jobId, picks, options) {
      const chosen = options.find((o) => picks.includes(o.id)) ?? options[0];
      if (!chosen) {
        return { status: "blocked", merchant, message: "No ride selected." };
      }
      await clickFirst(page, [
        `text=/${escapeRe(chosen.label.slice(0, 12))}/i`,
        'button:has-text("Choose")',
        'button:has-text("Select")',
      ]);
      await page.waitForTimeout(800);
      const body = ((await page.content()) || "").toLowerCase();
      if (/pay|upi|card|wallet/i.test(body) && !/confirm|request|book/i.test(body)) {
        return {
          status: "pay_link",
          merchant,
          paymentMode: "prepaid_link",
          jobId,
          summary: `Ride · ${chosen.label} to ${intent.destinationHint ?? "destination"}. Finish pay in ${cap(merchant)} — Amilo won't enter UPI/card.`,
          totalInr: chosen.unitInr ?? null,
          payUrl: page.url(),
        };
      }
      const result: BookingReadyConfirm = {
        status: "ready_confirm",
        merchant,
        paymentMode: "none",
        jobId,
        summary: `Ride · ${chosen.label} to ${intent.destinationHint ?? "destination"}${chosen.unitInr != null ? ` · ~₹${chosen.unitInr}` : ""}.`,
        totalInr: chosen.unitInr ?? null,
        lines: [
          {
            id: chosen.id,
            label: chosen.label,
            qty: 1,
            unitInr: chosen.unitInr ?? null,
          },
        ],
        address: intent.destinationHint ?? null,
      };
      return result;
    },
    async place(page, draft): Promise<BookingPlaced | BookingPayLink | BookingBlocked> {
      if (draft.status === "pay_link") return draft;
      const confirmed = await clickFirst(page, [
        'button:has-text("Confirm")',
        'button:has-text("Request")',
        'button:has-text("Book")',
        'button:has-text("Confirm ride")',
      ]);
      await page.waitForTimeout(1500);
      if (!confirmed) {
        return {
          status: "pay_link",
          merchant,
          paymentMode: "prepaid_link",
          jobId: "jobId" in draft ? draft.jobId : "",
          summary: `Finish in ${cap(merchant)} — Amilo won't enter UPI/card.`,
          totalInr: draft.status === "ready_confirm" ? draft.totalInr : null,
          payUrl: page.url(),
        };
      }
      return {
        status: "placed",
        merchant,
        orderId: `CAB-${Date.now().toString(36)}`,
        summary:
          draft.status === "ready_confirm"
            ? `${draft.summary}\nRide requested on ${cap(merchant)}.`
            : `Ride requested on ${cap(merchant)}.`,
      };
    },
  };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
