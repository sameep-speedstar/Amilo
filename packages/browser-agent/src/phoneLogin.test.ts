import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nationalPhoneDigits } from "./skills/phoneLogin.js";

describe("phoneLogin helpers", () => {
  it("takes last 10 digits from E.164", () => {
    assert.equal(nationalPhoneDigits("+918108506999"), "8108506999");
    assert.equal(nationalPhoneDigits("8108506999"), "8108506999");
  });
});
