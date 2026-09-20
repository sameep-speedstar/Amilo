import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { BookingConnector, formatBookingResultForWa } from "./connector.js";
import { exceedsSpendCap, isHostAllowed } from "./allowlist.js";
import { parseBookingIntent, parseBookingOtpReply } from "./parseIntent.js";
import { PARTNER_API_STUBS } from "./adapters/stubs.js";
import type { BookingIntent, BookingResult, BrowserSkillRunner } from "./types.js";

describe("booking", () => {
  it("parses grocery order intent", () => {
    const i = parseBookingIntent("Order milk and cheese from Zepto", "+919999000001");
    assert.ok(i);
    assert.equal(i!.merchant, "zepto");
    assert.equal(i!.vertical, "grocery");
    assert.equal(i!.preferredPayment, "cod");
    assert.ok(i!.items?.some((x) => /milk/i.test(x)));
  });

  it("parses movie ticketing as prepaid_link", () => {
    const i = parseBookingIntent("Book 2 tickets for Saiyaara at PVR Forum", "+919999000001");
    assert.ok(i);
    assert.equal(i!.vertical, "ticketing");
    assert.equal(i!.preferredPayment, "prepaid_link");
  });

  it("parses table dining as venue", () => {
    const i = parseBookingIntent("Reserve table for 2 at Burma Burma tomorrow 8pm", "+91");
    assert.ok(i);
    assert.equal(i!.vertical, "dining");
    assert.equal(i!.preferredPayment, "venue");
  });

  it("parses OTP reply", () => {
    assert.equal(parseBookingOtpReply("482913"), "482913");
    assert.equal(parseBookingOtpReply("yes"), null);
  });

  it("allowlists zepto host", () => {
    assert.equal(isHostAllowed("https://www.zepto.com/cart"), true);
    assert.equal(isHostAllowed("https://evil.example"), false);
  });

  it("enforces spend cap", () => {
    assert.equal(exceedsSpendCap("zepto", 6000), true);
    assert.equal(exceedsSpendCap("zepto", 200), false);
  });

  it("prefers API when enabled else browser", async () => {
    const browser: BrowserSkillRunner = {
      async start(intent: BookingIntent): Promise<BookingResult> {
        return {
          status: "ready_confirm",
          merchant: intent.merchant,
          paymentMode: "cod",
          summary: "Demo cart",
          totalInr: 205,
          lines: [],
          jobId: "job-1",
        };
      },
      async submitOtp() {
        return { status: "failed", message: "n/a" };
      },
      async selectOptions() {
        return { status: "failed", message: "n/a" };
      },
      async confirmPlace() {
        return { status: "placed", merchant: "zepto", orderId: "Z-1", summary: "Placed COD" };
      },
    };
    const c = new BookingConnector({
      adapters: PARTNER_API_STUBS,
      browser,
    });
    const intent = parseBookingIntent("Order milk from Zepto", "+9199")!;
    const r = await c.fulfill(intent);
    assert.equal(r.status, "ready_confirm");
    if (r.status === "ready_confirm") assert.equal(r.totalInr, 205);
  });

  it("formats pay_link for WA", () => {
    const text = formatBookingResultForWa({
      status: "pay_link",
      merchant: "bookmyshow",
      paymentMode: "prepaid_link",
      summary: "Seats held · PVR Forum",
      totalInr: 480,
      payUrl: "https://in.bookmyshow.com/pay/abc",
      jobId: "j2",
    });
    assert.match(text, /Pay here/);
    assert.match(text, /bookmyshow\.com\/pay/);
    assert.doesNotMatch(text, /UPI PIN/i);
  });
});
