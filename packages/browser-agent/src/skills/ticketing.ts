import type { BookingIntent, BookingResult } from "@amilo/booking";
import type { SessionPool } from "../sessionPool.js";

export async function runTicketingSkill(opts: {
  intent: BookingIntent;
  jobId: string;
  mode: "demo" | "live";
  pool: SessionPool;
  userId: string;
}): Promise<BookingResult> {
  const { intent, jobId, mode } = opts;
  const title = intent.movieHint ?? intent.query.slice(0, 80);

  if (mode === "demo") {
    const name = intent.merchant === "bookmyshow" ? "BookMyShow" : "District";
    return {
      status: "needs_otp",
      merchant: intent.merchant,
      jobId,
      message: `Demo mode — no real ${name} SMS. Reply with any 6-digit code (e.g. 123456) to continue the dry run.`,
    };
  }

  try {
    const session = await opts.pool.getSession(opts.userId);
    await session.page.goto("https://in.bookmyshow.com", {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
    // Never complete prepaid — stop at pay link extraction when available.
    const payUrl = session.page.url();
    return {
      status: "pay_link",
      merchant: intent.merchant,
      paymentMode: "prepaid_link",
      jobId,
      summary: `Seats flow started · ${title}. Pay on the merchant page — Amilo won't enter UPI/card.`,
      totalInr: null,
      payUrl,
    };
  } catch (err) {
    return {
      status: "failed",
      message: `Ticketing browser failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
