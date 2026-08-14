import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  formatUsdFromMicros,
  inviteIsOpen,
  normalizePhoneE164,
  phoneDigits,
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
