import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createFsProfileStore } from "./profileStore.js";
import { SessionPool } from "./sessionPool.js";
import { BrowserAgentRunner } from "./runner.js";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("browser-agent demo grocery COD", () => {
  it("OTP → select → confirm place", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amilo-prof-"));
    const profiles = createFsProfileStore({
      rootDir: dir,
      encryptionKey: "test-key-amilo-browser",
    });
    // Don't launch Chromium in demo path for start→otp.
    const pool = new SessionPool({ profiles, headless: true });
    const agent = new BrowserAgentRunner({ pool, mode: "demo" });
    const start = await agent.start({
      vertical: "grocery",
      merchant: "zepto",
      query: "Order milk and cheese from Zepto",
      phone: "+919999000001",
      items: ["milk", "cheese"],
      preferredPayment: "cod",
      userId: "user-demo-1",
    } as Parameters<typeof agent.start>[0]);
    assert.equal(start.status, "needs_otp");
    if (start.status !== "needs_otp") return;
    const afterOtp = await agent.submitOtp(start.jobId, "123456");
    assert.equal(afterOtp.status, "needs_selection");
    const cart = await agent.selectOptions(start.jobId, "Milk 3; Cheese A");
    assert.equal(cart.status, "ready_confirm");
    if (cart.status === "ready_confirm") {
      assert.equal(cart.paymentMode, "cod");
      assert.ok((cart.totalInr ?? 0) > 0);
    }
    const placed = await agent.confirmPlace(start.jobId);
    assert.equal(placed.status, "placed");
    await pool.shutdown();
  });

  it("ticketing returns pay_link after OTP in demo", async () => {
    const dir = await mkdtemp(join(tmpdir(), "amilo-prof-"));
    const profiles = createFsProfileStore({
      rootDir: dir,
      encryptionKey: "test-key-amilo-browser",
    });
    const pool = new SessionPool({ profiles });
    const agent = new BrowserAgentRunner({ pool, mode: "demo" });
    const start = await agent.start({
      vertical: "ticketing",
      merchant: "bookmyshow",
      query: "Book tickets Saiyaara PVR",
      phone: "+91",
      preferredPayment: "prepaid_link",
      userId: "user-demo-2",
    } as Parameters<typeof agent.start>[0]);
    assert.equal(start.status, "needs_otp");
    if (start.status !== "needs_otp") return;
    const pay = await agent.submitOtp(start.jobId, "999888");
    assert.equal(pay.status, "pay_link");
    if (pay.status === "pay_link") assert.match(pay.payUrl, /^https?:\/\//);
    await pool.shutdown();
  });
});
