import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { looksLikePhoneInput, nationalPhoneDigits } from "./skills/phoneLogin.js";

describe("phoneLogin helpers", () => {
  it("takes last 10 digits from E.164", () => {
    assert.equal(nationalPhoneDigits("+918108506999"), "8108506999");
    assert.equal(nationalPhoneDigits("8108506999"), "8108506999");
  });

  it("treats bare tel / +91-style fields as phone", () => {
    assert.equal(looksLikePhoneInput({ type: "tel" }), true);
    assert.equal(looksLikePhoneInput({ type: "text", maxlength: "10" }), true);
    assert.equal(looksLikePhoneInput({ type: "text", name: null, placeholder: null }), true);
    assert.equal(looksLikePhoneInput({ type: "email" }), false);
    assert.equal(looksLikePhoneInput({ type: "text", placeholder: "Email" }), false);
  });
});
