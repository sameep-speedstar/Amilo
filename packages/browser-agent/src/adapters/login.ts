import type { Page } from "playwright";
import type { OtpChannel } from "@amilo/booking";
import {
  clickFirst,
  enterPhoneOtp,
  nationalPhoneDigits,
  requestPhoneOtp,
} from "../skills/phoneLogin.js";
import type { LoginCtx, LoginStep } from "./types.js";

/**
 * Mobile OTP first; email OTP/magic-link as fallback.
 * Never claims OTP sent unless UI hints confirm.
 */
export async function loginMobileThenEmail(opts: {
  page: Page;
  merchant: string;
  homeUrl: string;
  ctx: LoginCtx;
}): Promise<LoginStep> {
  const { page, merchant, homeUrl, ctx } = opts;

  const mobile = await requestPhoneOtp({
    page,
    merchant,
    phoneE164: ctx.phoneE164,
    homeUrl,
  });
  if (mobile.ok) {
    return {
      kind: "needs_otp",
      channel: "mobile",
      message: `${cap(merchant)} should text a login code to ••••${mobile.phoneLast4}. Forward that OTP here.`,
    };
  }

  // Fallback: email
  const email = ctx.email?.trim();
  if (!email) {
    return {
      kind: "need_email",
      message: `${cap(merchant)} mobile login failed (${mobile.reason}). Reply with your email for ${cap(merchant)} login, or try another merchant.`,
    };
  }

  const emailTry = await requestEmailOtp({ page, merchant, email, homeUrl });
  if (emailTry.ok) {
    return {
      kind: "needs_otp",
      channel: "email",
      message: `${cap(merchant)} should email a login code to ${maskEmail(email)}. Forward that code here.`,
    };
  }

  return {
    kind: "blocked",
    reason: `Couldn't start ${cap(merchant)} login. Mobile: ${mobile.reason}. Email: ${emailTry.reason}`,
  };
}

export async function submitLoginOtp(
  page: Page,
  otp: string,
  _channel?: OtpChannel,
): Promise<LoginStep> {
  const entered = await enterPhoneOtp({ page, otp });
  if (!entered.ok) {
    return {
      kind: "needs_otp",
      channel: _channel ?? "mobile",
      message: entered.reason ?? "Couldn't enter that OTP — send the code again.",
    };
  }
  return { kind: "logged_in" };
}

async function requestEmailOtp(opts: {
  page: Page;
  merchant: string;
  email: string;
  homeUrl: string;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { page, merchant, email, homeUrl } = opts;
  // Ensure we're on a login surface
  if (!page.url() || page.url() === "about:blank") {
    await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  }
  await page.waitForTimeout(400);

  await clickFirst(page, [
    'button:has-text("Email")',
    'a:has-text("Email")',
    'text=/continue with email/i',
    'text=/login with email/i',
    'button:has-text("Use email")',
  ]);
  await page.waitForTimeout(400);

  const emailField = page
    .locator(
      'input[type="email"], input[name*="email" i], input[autocomplete="email"], input[placeholder*="email" i]',
    )
    .first();
  if ((await emailField.count().catch(() => 0)) === 0) {
    return {
      ok: false,
      reason: `${cap(merchant)} didn't show an email field.`,
    };
  }
  try {
    await emailField.fill(email);
  } catch {
    return { ok: false, reason: `Couldn't fill email on ${cap(merchant)}.` };
  }

  await clickFirst(page, [
    'button:has-text("Continue")',
    'button:has-text("Send")',
    'button:has-text("Get OTP")',
    'button:has-text("Submit")',
    'button[type="submit"]',
  ]);
  await page.waitForTimeout(1200);

  const body = ((await page.content()) || "").toLowerCase();
  const hint =
    /otp|verification|check your email|magic link|enter.*(code|otp)/i.test(body) ||
    (await page.locator('input[autocomplete="one-time-code"]').count().catch(() => 0)) > 0;
  if (!hint) {
    return {
      ok: false,
      reason: `${cap(merchant)} didn't confirm an email code was sent.`,
    };
  }
  return { ok: true };
}

function maskEmail(email: string): string {
  const [user, domain] = email.split("@");
  if (!user || !domain) return "your email";
  const u = user.length <= 2 ? `${user[0]}*` : `${user.slice(0, 2)}***`;
  return `${u}@${domain}`;
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export { nationalPhoneDigits };
