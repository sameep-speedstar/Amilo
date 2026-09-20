import type { Page } from "playwright";
import type {
  BookingBlocked,
  BookingNeedsSelection,
  BookingPayLink,
  BookingPlaced,
  SelectionOption,
} from "@amilo/booking";
import { clickFirst } from "../skills/phoneLogin.js";
import { loginMobileThenEmail, submitLoginOtp } from "./login.js";
import type { LoginCtx, LoginStep, SiteAdapter } from "./types.js";

export function createBookMyShowAdapter(): SiteAdapter {
  const merchant = "bookmyshow" as const;
  const homeUrl = "https://in.bookmyshow.com";

  return {
    merchant,
    vertical: "ticketing",
    homeUrl,
    async login(page: Page, ctx: LoginCtx): Promise<LoginStep> {
      return loginMobileThenEmail({ page, merchant, homeUrl, ctx });
    },
    async submitOtp(page: Page, otp: string): Promise<LoginStep> {
      return submitLoginOtp(page, otp, "mobile");
    },
    async search(page, intent, jobId): Promise<BookingNeedsSelection | BookingBlocked> {
      const q = intent.movieHint ?? intent.query.slice(0, 60);
      const search = page
        .locator('input[placeholder*="Search" i], input[type="search"]')
        .first();
      if ((await search.count().catch(() => 0)) > 0) {
        await search.fill("");
        await search.type(q, { delay: 40 });
        await page.keyboard.press("Enter").catch(() => undefined);
        await page.waitForTimeout(1500);
      }
      const links = page.locator('a[href*="/movies/"], a[href*="/movie/"]');
      const n = Math.min(await links.count().catch(() => 0), 5);
      const options: SelectionOption[] = [];
      for (let i = 0; i < n; i++) {
        const a = links.nth(i);
        const label = ((await a.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim().slice(0, 80);
        const href = await a.getAttribute("href").catch(() => null);
        if (!label) continue;
        options.push({
          id: String(i + 1),
          label,
          ...(intent.whenHint ? { detail: intent.whenHint } : {}),
          ...(href ? { meta: { href } } : {}),
        });
      }
      if (!options.length) {
        // Still offer a synthetic pick so user can confirm the query
        options.push({
          id: "1",
          label: q.slice(0, 80),
          detail: "Open search result",
          meta: { query: q },
        });
      }
      return {
        status: "needs_selection",
        merchant,
        jobId,
        message: "Tickets — pick a show (reply with id):",
        options,
      };
    },
    async applySelection(page, intent, jobId, picks, options) {
      const chosen = options.find((o) => picks.includes(o.id)) ?? options[0];
      if (!chosen) {
        return { status: "blocked", merchant, message: "No show selected." };
      }
      const href = typeof chosen.meta?.href === "string" ? chosen.meta.href : null;
      if (href) {
        const url = href.startsWith("http") ? href : new URL(href, page.url()).toString();
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
      }
      await clickFirst(page, [
        'button:has-text("Book")',
        'button:has-text("Buy")',
        'a:has-text("Book tickets")',
      ]);
      await page.waitForTimeout(1200);
      return {
        status: "pay_link",
        merchant,
        paymentMode: "prepaid_link",
        jobId,
        summary: `Seats flow · ${chosen.label}. Pay on BookMyShow — Amilo won't enter UPI/card.`,
        totalInr: null,
        payUrl: page.url(),
      };
    },
    async place(page, draft): Promise<BookingPlaced | BookingPayLink | BookingBlocked> {
      if (draft.status === "pay_link") return draft;
      return {
        status: "pay_link",
        merchant,
        paymentMode: "prepaid_link",
        jobId: "jobId" in draft ? draft.jobId : "",
        summary: "Finish payment on BookMyShow — Amilo won't enter UPI/card.",
        totalInr: null,
        payUrl: page.url(),
      };
    },
  };
}
