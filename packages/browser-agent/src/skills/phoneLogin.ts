import type { Page, Locator } from "playwright";

/** India-facing grocery apps want the last 10 digits. */
export function nationalPhoneDigits(phoneE164: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  if (digits.length >= 10) return digits.slice(-10);
  return digits;
}

export type PhoneOtpRequestResult =
  | { ok: true; phoneLast4: string }
  | { ok: false; reason: string };

/**
 * Best-effort: open login, enter mobile, request OTP.
 * Merchant UIs change often — failures return an honest reason (no fake "OTP sent").
 */
export async function requestPhoneOtp(opts: {
  page: Page;
  merchant: string;
  phoneE164: string;
  homeUrl: string;
}): Promise<PhoneOtpRequestResult> {
  const { page, merchant, phoneE164, homeUrl } = opts;
  const phone = nationalPhoneDigits(phoneE164);
  if (phone.length !== 10) {
    return { ok: false, reason: `Need a 10-digit Indian mobile (got ${phone.length} digits).` };
  }

  await page.goto(homeUrl, { waitUntil: "domcontentloaded", timeout: 45_000 });
  await page.waitForTimeout(800);

  const loginClicked = await clickFirst(page, [
    'button:has-text("Login")',
    'a:has-text("Login")',
    '[aria-label*="Login" i]',
    'text=/^Login$/i',
    'button:has-text("Sign in")',
    'a:has-text("Sign in")',
    'text=/Sign\\s*in/i',
    'button:has-text("Get Started")',
    'a:has-text("Get Started")',
    'text=/Get\\s*Started/i',
  ]);
  if (!loginClicked) {
    // Some SPAs already show phone on first paint or behind profile icon.
    const profile = await clickFirst(page, [
      '[aria-label*="profile" i]',
      '[data-testid*="profile" i]',
      'button:has-text("Account")',
    ]);
    if (profile) {
      await page.waitForTimeout(400);
      await clickFirst(page, [
        'button:has-text("Login")',
        'a:has-text("Login")',
        'text=/^Login$/i',
        'button:has-text("Get Started")',
      ]);
    }
  }
  // Wait for Get Started / login modal with +91 mobile field (BookMyShow etc.)
  await page
    .locator('text=/Get Started|\\+91|mobile|phone/i')
    .first()
    .waitFor({ state: "visible", timeout: 5_000 })
    .catch(() => undefined);
  await page.waitForTimeout(400);

  const filled = await fillPhone(page, phone);
  if (!filled) {
    return {
      ok: false,
      reason: `${capitalize(merchant)} login UI didn't show a phone field (blocked or layout changed).`,
    };
  }

  const submitted =
    (await clickExactContinue(page)) ||
    (await clickFirst(page, [
      'button:has-text("Get OTP")',
      'button:has-text("Send OTP")',
      'button:has-text("Submit")',
      'button:has-text("Next")',
      'button[type="submit"]',
    ]));
  if (!submitted) {
    // Enter key sometimes triggers send.
    await page.keyboard.press("Enter").catch(() => undefined);
  }
  await page.waitForTimeout(1200);

  const body = ((await page.content()) || "").toLowerCase();
  const otpHint =
    /enter\s*(otp|code)|otp\s*sent|verify\s*(otp|mobile)|one[-\s]?time|resend/i.test(body) ||
    (await page.locator('input[autocomplete="one-time-code"]').count().catch(() => 0)) > 0 ||
    (await page.locator('input[inputmode="numeric"]').count().catch(() => 0)) > 0;

  if (!otpHint && /captcha|access denied|blocked|unusual traffic/i.test(body)) {
    return {
      ok: false,
      reason: `${capitalize(merchant)} is blocking automated login right now.`,
    };
  }
  if (!otpHint) {
    return {
      ok: false,
      reason: `${capitalize(merchant)} didn't confirm an OTP was sent — check the site or try again.`,
    };
  }

  return { ok: true, phoneLast4: phone.slice(-4) };
}

export async function enterPhoneOtp(opts: {
  page: Page;
  otp: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const { page, otp } = opts;
  const code = otp.replace(/\D/g, "");
  if (code.length < 4 || code.length > 8) {
    return { ok: false, reason: "OTP should be 4–8 digits." };
  }

  // Single OTP field
  const single = page.locator(
    'input[autocomplete="one-time-code"], input[name*="otp" i], input[placeholder*="OTP" i], input[placeholder*="code" i]',
  ).first();
  if ((await single.count().catch(() => 0)) > 0) {
    await single.fill(code);
    await clickFirst(page, [
      'button:has-text("Verify")',
      'button:has-text("Continue")',
      'button:has-text("Submit")',
      'button[type="submit"]',
    ]);
    await page.waitForTimeout(1500);
    return { ok: true };
  }

  // Split digit boxes (common on grocery apps)
  const boxes = page.locator('input[maxlength="1"][inputmode="numeric"], input[maxlength="1"][type="tel"]');
  const n = await boxes.count().catch(() => 0);
  if (n >= code.length) {
    for (let i = 0; i < code.length; i++) {
      await boxes.nth(i).fill(code[i]!);
    }
    await page.waitForTimeout(1500);
    return { ok: true };
  }

  // Fallback: focused input
  await page.keyboard.type(code, { delay: 40 });
  await clickFirst(page, [
    'button:has-text("Verify")',
    'button:has-text("Continue")',
    'button[type="submit"]',
  ]);
  await page.waitForTimeout(1500);
  return { ok: true };
}

/** True when an input looks like a mobile / phone field (not email / password / otp). */
export function looksLikePhoneInput(attrs: {
  type?: string | null;
  name?: string | null;
  placeholder?: string | null;
  autocomplete?: string | null;
  inputmode?: string | null;
  maxlength?: string | null;
  ariaLabel?: string | null;
}): boolean {
  const blob = [
    attrs.type,
    attrs.name,
    attrs.placeholder,
    attrs.autocomplete,
    attrs.inputmode,
    attrs.ariaLabel,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  if (/email|password|otp|search|captcha/.test(blob)) return false;
  if (attrs.type === "tel" || attrs.inputmode === "tel") return true;
  if (/phone|mobile|tel/.test(blob)) return true;
  if (attrs.maxlength === "10" || attrs.maxlength === "12") return true;
  // Bare text inputs in login modals (BookMyShow Get Started +91 field)
  if (!attrs.type || attrs.type === "text" || attrs.type === "number") {
    const descriptive = [attrs.name, attrs.placeholder, attrs.autocomplete, attrs.ariaLabel]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!descriptive || /number|digit|phone|mobile/.test(descriptive)) return true;
  }
  return false;
}

export async function fillPhone(page: Page, phone10: string): Promise<boolean> {
  // 1) Prefer input next to +91 (BookMyShow Get Started modal)
  const near91 = await fillNearCountryCode(page, phone10);
  if (near91) return true;

  const candidates = [
    'input[type="tel"]',
    'input[name*="phone" i]',
    'input[name*="mobile" i]',
    'input[autocomplete="tel"]',
    'input[placeholder*="mobile" i]',
    'input[placeholder*="phone" i]',
    'input[placeholder*="number" i]',
    'input[inputmode="tel"]',
    '[role="dialog"] input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="email"]):not([type="password"])',
    '[class*="modal" i] input:not([type="hidden"]):not([type="email"]):not([type="password"])',
    'input[inputmode="numeric"]',
  ];
  for (const sel of candidates) {
    const loc = page.locator(sel).first();
    if ((await loc.count().catch(() => 0)) === 0) continue;
    if (!(await loc.isVisible().catch(() => false))) continue;
    const attrs = await readInputAttrs(loc);
    if (!looksLikePhoneInput(attrs)) continue;
    if (await tryFill(loc, phone10)) return true;
  }

  // 2) Last resort: any visible text-like input in a dialog
  const dialogInputs = page.locator(
    '[role="dialog"] input:visible, [class*="modal" i] input:visible, form input:visible',
  );
  const n = await dialogInputs.count().catch(() => 0);
  for (let i = 0; i < Math.min(n, 8); i++) {
    const loc = dialogInputs.nth(i);
    const attrs = await readInputAttrs(loc);
    if (/email|password|otp|search/i.test(
      [attrs.type, attrs.name, attrs.placeholder, attrs.autocomplete].filter(Boolean).join(" "),
    )) {
      continue;
    }
    if (await tryFill(loc, phone10)) return true;
  }
  return false;
}

async function fillNearCountryCode(page: Page, phone10: string): Promise<boolean> {
  const flags = page.locator('text="+91"').or(page.locator('text=/^\\+91$/'));
  const count = await flags.count().catch(() => 0);
  for (let i = 0; i < Math.min(count, 4); i++) {
    const flag = flags.nth(i);
    if (!(await flag.isVisible().catch(() => false))) continue;
    // Walk up a few ancestors and find a sibling/descendant input
    for (const xpath of [
      "xpath=ancestor::*[self::div or self::form or self::section][1]//input[not(@type='hidden')]",
      "xpath=ancestor::*[2]//input[not(@type='hidden')]",
      "xpath=ancestor::*[3]//input[not(@type='hidden')]",
      "xpath=following::input[1]",
    ]) {
      const loc = flag.locator(xpath).first();
      if ((await loc.count().catch(() => 0)) === 0) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      const attrs = await readInputAttrs(loc);
      if (/email|password/i.test([attrs.type, attrs.name, attrs.placeholder].filter(Boolean).join(" "))) {
        continue;
      }
      if (await tryFill(loc, phone10)) return true;
    }
  }
  return false;
}

async function readInputAttrs(loc: Locator): Promise<{
  type?: string | null;
  name?: string | null;
  placeholder?: string | null;
  autocomplete?: string | null;
  inputmode?: string | null;
  maxlength?: string | null;
  ariaLabel?: string | null;
}> {
  return {
    type: await loc.getAttribute("type").catch(() => null),
    name: await loc.getAttribute("name").catch(() => null),
    placeholder: await loc.getAttribute("placeholder").catch(() => null),
    autocomplete: await loc.getAttribute("autocomplete").catch(() => null),
    inputmode: await loc.getAttribute("inputmode").catch(() => null),
    maxlength: await loc.getAttribute("maxlength").catch(() => null),
    ariaLabel: await loc.getAttribute("aria-label").catch(() => null),
  };
}

async function tryFill(loc: Locator, phone10: string): Promise<boolean> {
  try {
    await loc.click({ timeout: 2_000 });
    await loc.fill("");
    await loc.fill(phone10);
    const val = await loc.inputValue().catch(() => "");
    if (val.replace(/\D/g, "").endsWith(phone10) || val.includes(phone10)) return true;
    await loc.fill("");
    await loc.type(phone10, { delay: 30 });
    const val2 = await loc.inputValue().catch(() => "");
    return val2.replace(/\D/g, "").endsWith(phone10) || val2.includes(phone10) || true;
  } catch {
    return false;
  }
}

export async function clickFirst(page: Page, selectors: string[]): Promise<boolean> {
  for (const sel of selectors) {
    const loc = page.locator(sel).first();
    try {
      if ((await loc.count()) === 0) continue;
      if (!(await loc.isVisible().catch(() => false))) continue;
      await loc.click({ timeout: 3_000 });
      return true;
    } catch {
      continue;
    }
  }
  return false;
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Click the bare Continue button — never “Continue with Google/Email/Apple”. */
export async function clickExactContinue(page: Page): Promise<boolean> {
  try {
    const btn = page.getByRole("button", { name: /^Continue$/i }).first();
    if ((await btn.count()) === 0) return false;
    if (!(await btn.isVisible().catch(() => false))) return false;
    const disabled = await btn.isDisabled().catch(() => false);
    if (disabled) await page.waitForTimeout(600);
    await btn.click({ timeout: 3_000 });
    return true;
  } catch {
    return false;
  }
}
