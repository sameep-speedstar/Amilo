import type { BookingIntent, BookingResult } from "@amilo/booking";
import type { SessionPool } from "../sessionPool.js";

export async function runDiningSkill(opts: {
  intent: BookingIntent;
  jobId: string;
  mode: "demo" | "live";
  pool: SessionPool;
  userId: string;
}): Promise<BookingResult> {
  const { intent, jobId, mode } = opts;
  const venue = intent.venueHint ?? "the restaurant";
  const when = intent.whenHint ?? "your preferred slot";
  const party = intent.partySize ?? 2;

  if (mode === "demo") {
    return {
      status: "ready_confirm",
      merchant: intent.merchant,
      paymentMode: "venue",
      jobId,
      summary: `Table for ${party} · ${venue} · ${when} (pay at venue).`,
      totalInr: null,
      lines: [
        {
          id: "table",
          label: `Table for ${party} at ${venue}`,
          qty: 1,
          unitInr: null,
        },
      ],
      address: venue,
    };
  }

  try {
    const session = await opts.pool.getSession(opts.userId);
    const url =
      intent.merchant === "eazydiner"
        ? "https://www.eazydiner.com"
        : "https://www.zomato.com";
    await session.page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
    return {
      status: "ready_confirm",
      merchant: intent.merchant,
      paymentMode: "venue",
      jobId,
      summary: `Opened ${intent.merchant} for ${venue}. Confirm table for ${party} · ${when} (pay at venue).`,
      totalInr: null,
      lines: [],
      address: venue,
    };
  } catch (err) {
    return {
      status: "failed",
      message: `Dining browser failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
