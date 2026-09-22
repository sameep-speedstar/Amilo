/**
 * Uber OAuth 2.0 (authorization code) — auth.uber.com.
 * @see https://developer.uber.com/docs/riders/guides/authentication/user-access-token
 */

const AUTH_BASE = "https://auth.uber.com/oauth/v2/authorize";
const TOKEN_URL = "https://auth.uber.com/oauth/v2/token";

/** Rider book scopes — `request` is privileged (Limited Access until Full Access approved). */
export const UBER_SCOPES = ["profile", "request", "offline_access"] as const;

export type UberOAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
};

export type UberTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
};

export function buildUberAuthUrl(
  cfg: UberOAuthConfig,
  state: string,
  scopes: readonly string[] = UBER_SCOPES,
): string {
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    response_type: "code",
    redirect_uri: cfg.redirectUri,
    scope: scopes.join(" "),
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

function tokenSetFromResponse(payload: Record<string, unknown>): UberTokenSet {
  const expiresIn = Number(payload.expires_in ?? 2592000);
  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scope: String(payload.scope ?? ""),
  };
}

export async function exchangeUberCode(
  cfg: UberOAuthConfig,
  code: string,
): Promise<UberTokenSet> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "authorization_code",
    redirect_uri: cfg.redirectUri,
    code,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Uber token exchange ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return tokenSetFromResponse((await res.json()) as Record<string, unknown>);
}

export async function refreshUberAccessToken(
  cfg: UberOAuthConfig,
  refreshToken: string,
): Promise<UberTokenSet> {
  const body = new URLSearchParams({
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
    refresh_token: refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) {
    throw new Error(`Uber token refresh ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const set = tokenSetFromResponse((await res.json()) as Record<string, unknown>);
  // Uber may omit refresh_token on refresh — keep the old one.
  if (!set.refreshToken) set.refreshToken = refreshToken;
  return set;
}
