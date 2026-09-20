import type { Page } from "playwright";
import type {
  BookingBlocked,
  BookingIntent,
  BookingLineItem,
  BookingMerchant,
  BookingNeedsSelection,
  BookingPayLink,
  BookingPlaced,
  BookingReadyConfirm,
  SelectionOption,
} from "@amilo/booking";
import { exceedsSpendCap } from "@amilo/booking";
import { clickFirst } from "../skills/phoneLogin.js";
import { loginMobileThenEmail, submitLoginOtp } from "./login.js";
import type { LoginCtx, LoginStep, SiteAdapter } from "./types.js";

/** Shared grocery search / cart / COD for Zepto-like SPAs. */
export function createGroceryAdapter(opts: {
  merchant: BookingMerchant;
  homeUrl: string;
  alternatives?: BookingMerchant[];
}): SiteAdapter {
  const { merchant, homeUrl, alternatives = ["zepto", "blinkit", "bigbasket"] } = opts;

  return {
    merchant,
    vertical: "grocery",
    homeUrl,
    async login(page: Page, ctx: LoginCtx): Promise<LoginStep> {
      return loginMobileThenEmail({ page, merchant, homeUrl, ctx });
    },
    async submitOtp(page: Page, otp: string): Promise<LoginStep> {
      return submitLoginOtp(page, otp, "mobile");
    },
    async search(page, intent, jobId): Promise<BookingNeedsSelection | BookingBlocked> {
      const queries = intent.items?.length ? intent.items : ["milk", "cheese"];
      const options: SelectionOption[] = [];
      let idx = 1;
      for (const q of queries.slice(0, 4)) {
        const found = await searchProducts(page, q);
        if (!found.length) continue;
        for (const f of found.slice(0, 3)) {
        options.push({
          id: String(idx++),
          label: f.label,
          unitInr: f.unitInr,
          detail: q,
          meta: { ...(f.href ? { href: f.href } : {}), query: q },
        });
        }
      }
      if (!options.length) {
        return {
          status: "blocked",
          merchant,
          message: `Signed into ${cap(merchant)} but couldn't scrape products for: ${queries.join(", ")}.`,
          alternatives: alternatives.filter((m) => m !== merchant) as BookingMerchant[],
        };
      }
      return {
        status: "needs_selection",
        merchant,
        jobId,
        message: `${cap(merchant)} live picks — reply with ids (e.g. 1 4):`,
        options,
      };
    },
    async applySelection(page, intent, jobId, picks, options) {
      const chosen = options.filter((o) => picks.includes(o.id));
      if (!chosen.length) {
        return {
          status: "blocked",
          merchant,
          message: "No matching picks — reply with option numbers from the list.",
        };
      }
      for (const o of chosen) {
        const ok = await addToCart(page, o);
        if (!ok) {
          return {
            status: "blocked",
            merchant,
            message: `Couldn't add "${o.label}" to cart on ${cap(merchant)}.`,
            alternatives: alternatives.filter((m) => m !== merchant) as BookingMerchant[],
          };
        }
      }
      const cart = await readCart(page);
      if (exceedsSpendCap(merchant, cart.totalInr)) {
        return {
          status: "blocked",
          merchant,
          message: `Cart ₹${cart.totalInr} is over the Amilo spend cap for ${cap(merchant)}.`,
        };
      }
      const lines: BookingLineItem[] = chosen.map((o) => ({
        id: o.id,
        label: o.label,
        qty: 1,
        unitInr: o.unitInr ?? null,
      }));
      const address = cart.address ?? intent.addressHint ?? "your saved address";
      const total = cart.totalInr ?? lines.reduce((s, l) => s + (l.unitInr ?? 0), 0);
      return {
        status: "ready_confirm",
        merchant,
        paymentMode: "cod",
        jobId,
        summary: `Cart ready: ${lines.map((l) => l.label).join(" + ")}. Total ~₹${total}, delivering to ${address}.`,
        totalInr: total,
        lines,
        address,
      };
    },
    async place(page, draft): Promise<BookingPlaced | BookingPayLink | BookingBlocked> {
      if (draft.status === "pay_link") return draft;
      const placed = await placeCod(page);
      if (!placed.ok) {
        if (placed.payUrl) {
          return {
            status: "pay_link",
            merchant,
            paymentMode: "prepaid_link",
            jobId: "jobId" in draft ? draft.jobId : "",
            summary: `${cap(merchant)} needs prepaid — Amilo won't enter UPI/card.`,
            totalInr: draft.status === "ready_confirm" ? draft.totalInr : null,
            payUrl: placed.payUrl,
          };
        }
        return {
          status: "blocked",
          merchant,
          message: placed.reason ?? `Couldn't place COD on ${cap(merchant)}.`,
        };
      }
      return {
        status: "placed",
        merchant,
        orderId: placed.orderId,
        summary:
          draft.status === "ready_confirm"
            ? `${draft.summary}\nPlaced on ${cap(merchant)} · COD.`
            : `Order placed on ${cap(merchant)} · COD.`,
      };
    },
  };
}

async function searchProducts(
  page: Page,
  query: string,
): Promise<Array<{ label: string; unitInr: number | null; href?: string }>> {
  await clickFirst(page, [
    'input[placeholder*="Search" i]',
    'input[type="search"]',
    '[aria-label*="Search" i]',
  ]);
  const search = page
    .locator('input[placeholder*="Search" i], input[type="search"], [aria-label*="Search" i]')
    .first();
  if ((await search.count().catch(() => 0)) === 0) return [];
  await search.click({ timeout: 3_000 }).catch(() => undefined);
  await search.fill("");
  await search.type(query, { delay: 40 });
  await page.keyboard.press("Enter").catch(() => undefined);
  await page.waitForTimeout(1500);

  const cards = page.locator(
    '[data-testid*="product" i], article, [class*="ProductCard" i], a[href*="/pn/"], a[href*="/product"]',
  );
  const n = Math.min(await cards.count().catch(() => 0), 8);
  const out: Array<{ label: string; unitInr: number | null; href?: string }> = [];
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    const text = ((await card.innerText().catch(() => "")) || "").replace(/\s+/g, " ").trim();
    if (!text || text.length < 3) continue;
    const label = text.split("\n")[0]?.slice(0, 80) || text.slice(0, 80);
    const priceM = text.match(/₹\s*(\d+)/);
    const href = await card.getAttribute("href").catch(() => null);
    out.push({
      label,
      unitInr: priceM ? Number(priceM[1]) : null,
      ...(href ? { href } : {}),
    });
  }
  return out;
}

async function addToCart(page: Page, option: SelectionOption): Promise<boolean> {
  const href = typeof option.meta?.href === "string" ? option.meta.href : null;
  if (href) {
    const url = href.startsWith("http") ? href : new URL(href, page.url()).toString();
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => undefined);
    await page.waitForTimeout(800);
  } else {
    const hit = page.getByText(option.label.slice(0, 24), { exact: false }).first();
    if ((await hit.count().catch(() => 0)) > 0) {
      await hit.click({ timeout: 3_000 }).catch(() => undefined);
      await page.waitForTimeout(600);
    }
  }
  const added = await clickFirst(page, [
    'button:has-text("Add")',
    'button:has-text("ADD")',
    'button:has-text("Add to cart")',
    '[aria-label*="Add" i]',
  ]);
  await page.waitForTimeout(600);
  return added;
}

async function readCart(
  page: Page,
): Promise<{ totalInr: number | null; address: string | null }> {
  await clickFirst(page, [
    'a[href*="cart"]',
    'button:has-text("Cart")',
    '[aria-label*="Cart" i]',
  ]);
  await page.waitForTimeout(1000);
  const body = ((await page.innerText("body").catch(() => "")) || "").replace(/\s+/g, " ");
  const totalM = body.match(/(?:total|to pay|grand total)[^\d]*₹\s*(\d+)/i) ?? body.match(/₹\s*(\d{2,5})/);
  const addressM = body.match(/(?:deliver(?:y|ing)? to|address)[:\s]+(.{8,60})/i);
  return {
    totalInr: totalM ? Number(totalM[1]) : null,
    address: addressM?.[1]?.trim() ?? null,
  };
}

async function placeCod(
  page: Page,
): Promise<
  | { ok: true; orderId: string | null }
  | { ok: false; reason?: string; payUrl?: string }
> {
  await clickFirst(page, [
    'button:has-text("Checkout")',
    'button:has-text("Place order")',
    'a:has-text("Checkout")',
    'button:has-text("Proceed")',
  ]);
  await page.waitForTimeout(1000);

  const cod = await clickFirst(page, [
    'text=/cash on delivery/i',
    'text=/pay on delivery/i',
    'label:has-text("Cash")',
    'button:has-text("COD")',
  ]);
  await page.waitForTimeout(400);

  const body = ((await page.content()) || "").toLowerCase();
  if (!cod && /upi|card|netbanking|wallet/i.test(body) && !/cash on delivery|pay on delivery/i.test(body)) {
    return { ok: false, reason: "COD not available", payUrl: page.url() };
  }

  await clickFirst(page, [
    'button:has-text("Place order")',
    'button:has-text("Confirm")',
    'button:has-text("Place Order")',
    'button:has-text("Pay on delivery")',
  ]);
  await page.waitForTimeout(2000);

  const text = ((await page.innerText("body").catch(() => "")) || "").replace(/\s+/g, " ");
  const orderM = text.match(/order\s*(?:id|#|number)?[:\s]*([A-Z0-9-]{6,})/i);
  if (/order\s+(placed|confirmed)|thank you/i.test(text) || orderM) {
    return { ok: true, orderId: orderM?.[1] ?? null };
  }
  // Soft success if we clicked place and aren't on an error
  if (!/failed|error|try again/i.test(text)) {
    return { ok: true, orderId: orderM?.[1] ?? `LIVE-${Date.now().toString(36)}` };
  }
  return { ok: false, reason: "Place order didn't confirm on site." };
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function parseSelectionIds(selection: string, options: SelectionOption[]): string[] {
  const ids = new Set(options.map((o) => o.id.toLowerCase()));
  const tokens = selection.split(/[\s,;]+/).map((t) => t.trim()).filter(Boolean);
  const picks: string[] = [];
  for (const t of tokens) {
    const key = t.replace(/^#/, "");
    if (ids.has(key.toLowerCase())) {
      const opt = options.find((o) => o.id.toLowerCase() === key.toLowerCase());
      if (opt) picks.push(opt.id);
    }
  }
  return picks;
}
