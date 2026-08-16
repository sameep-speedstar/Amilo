import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatUsdFromMicros,
  inviteIsOpen,
  isUsageCapExemptPhone,
  normalizePhoneE164,
  phoneDigits,
  usageDayStartUtc,
  waMeUrl,
  type InviteRow,
} from "./onboardRepos.js";

describe("onboard phone helpers", () => {
  it("normalizes E.164", () => {
    assert.equal(normalizePhoneE164("+91 98765 43210"), "+919876543210");
    assert.equal(normalizePhoneE164("919876543210"), "+919876543210");
    assert.equal(normalizePhoneE164("123"), null);
  });

  it("strips to digits", () => {
    assert.equal(phoneDigits("+91-98"), "9198");
  });

  it("builds wa.me deep link", () => {
    assert.equal(
      waMeUrl("+919876543210", "Hi Amilo"),
      "https://wa.me/919876543210?text=Hi%20Amilo",
    );
  });

  it("formats micros as USD", () => {
    assert.equal(formatUsdFromMicros(800), "$0.0008");
  });
});

describe("usage caps", () => {
  it("exempts the host number", () => {
    assert.equal(
      isUsageCapExemptPhone("+918108506999", ["+918108506999"]),
      true,
    );
    assert.equal(isUsageCapExemptPhone("918108506999", ["+91 81085 06999"]), true);
    assert.equal(isUsageCapExemptPhone("+919779840201", ["+918108506999"]), false);
  });

  it("starts the day at local midnight, not a rolling 24h", () => {
    // 16 Aug 2026 07:52 IST = 16 Aug 02:22 UTC
    const morning = new Date("2026-08-16T02:22:00.000Z");
    const start = usageDayStartUtc("Asia/Kolkata", morning);
    assert.equal(start.toISOString(), "2026-08-15T18:30:00.000Z");
    // Yesterday 11pm IST should be a different local day
    const late = new Date("2026-08-15T17:30:00.000Z"); // 16 Aug 2026 00:00 IST is 15 Aug 18:30Z
    const lateStart = usageDayStartUtc("Asia/Kolkata", late);
    assert.equal(lateStart.toISOString(), "2026-08-14T18:30:00.000Z");
  });
});

describe("inviteIsOpen", () => {
  const base: InviteRow = {
    id: "00000000-0000-0000-0000-000000000001",
    token: "abc",
    phoneE164: null,
    label: null,
    maxUses: 1,
    useCount: 0,
    expiresAt: null,
    createdAt: new Date(),
  };

  it("open when under max uses", () => {
    assert.equal(inviteIsOpen(base), true);
  });

  it("closed when useCount >= maxUses", () => {
    assert.equal(inviteIsOpen({ ...base, useCount: 1 }), false);
  });

  it("closed when expired", () => {
    assert.equal(
      inviteIsOpen({ ...base, expiresAt: new Date(Date.now() - 1000) }),
      false,
    );
  });
});
