import type { BookingIntent, BookingResult } from "@amilo/booking";
import type { SessionPool } from "../sessionPool.js";

export async function runGrocerySkill(opts: {
  intent: BookingIntent;
  jobId: string;
  mode: "demo" | "live";
  pool: SessionPool;
  userId: string;
}): Promise<BookingResult> {
  const { intent, jobId, mode, pool, userId } = opts;

  if (mode === "demo") {
    // Instinct-like: pretend merchant sent OTP to user phone.
    return {
      status: "needs_otp",
      merchant: intent.merchant,
      jobId,
      message: `${capitalize(intent.merchant)} sent a login code to your phone. Send me that one-time code and I'll finish signing in.`,
    };
  }

  // Live: open merchant home; if login wall detected → needs_otp.
  try {
    const session = await pool.getSession(userId);
    const url =
      intent.merchant === "blinkit"
        ? "https://blinkit.com"
        : intent.merchant === "bigbasket"
          ? "https://www.bigbasket.com"
          : "https://www.zepto.com";
    await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    const body = ((await session.page.content()) || "").toLowerCase();
    if (/otp|login|sign in|verify/i.test(body)) {
      return {
        status: "needs_otp",
        merchant: intent.merchant,
        jobId,
        message: `${capitalize(intent.merchant)} needs a login code sent to your phone. Forward that OTP here.`,
      };
    }
    // Blocked / soft-fail → ask user to try alternate.
    if (/access denied|blocked|captcha/i.test(body)) {
      return {
        status: "blocked",
        merchant: intent.merchant,
        message: `${capitalize(intent.merchant)} is blocking automated access right now.`,
        alternatives: (["zepto", "blinkit", "bigbasket"] as const).filter(
          (m) => m !== intent.merchant,
        ) as Array<"zepto" | "blinkit" | "bigbasket">,
      };
    }
    return {
      status: "needs_selection",
      merchant: intent.merchant,
      jobId,
      message: `Opened ${intent.merchant}. Pick items (live catalog scrape TBD — reply with brands/qty):`,
      options: (intent.items ?? ["milk", "cheese"]).map((label, i) => ({
        id: String(i + 1),
        label,
        unitInr: null,
      })),
    };
  } catch (err) {
    return {
      status: "blocked",
      merchant: intent.merchant,
      message: `Couldn't reach ${intent.merchant}: ${err instanceof Error ? err.message : String(err)}`,
      alternatives: ["blinkit", "zepto"],
    };
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
