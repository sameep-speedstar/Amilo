import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { buildUberAuthUrl, UBER_SCOPES } from "./oauth.js";

describe("uber oauth helpers", () => {
  it("builds authorize URL with request scope", () => {
    const url = buildUberAuthUrl(
      {
        clientId: "cid",
        clientSecret: "sec",
        redirectUri: "https://api.amilo.io/oauth/uber/callback",
      },
      "state123",
    );
    assert.match(url, /auth\.uber\.com\/oauth\/v2\/authorize/);
    assert.match(url, /client_id=cid/);
    assert.match(url, /request/);
    assert.match(url, /offline_access/);
    assert.ok(UBER_SCOPES.includes("request"));
  });
});
