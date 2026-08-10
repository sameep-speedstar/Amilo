import { encodeOAuthState, decodeOAuthState } from "./crypto.js";

const AUTH_BASE = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

export const GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export function hasGmailSendScope(scopes: string): boolean {
  return /\bgmail\.send\b/.test(scopes) || scopes.includes("https://www.googleapis.com/auth/gmail.send");
}

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  encryptionKey: string;
}

export interface TokenSet {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: Date;
  scope: string;
}

export function buildAuthUrl(
  cfg: GoogleOAuthConfig,
  userId: string,
  label = "personal",
): string {
  const state = encodeOAuthState(cfg.encryptionKey, userId, label);
  const params = new URLSearchParams({
    client_id: cfg.clientId,
    redirect_uri: cfg.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state,
  });
  return `${AUTH_BASE}?${params.toString()}`;
}

export function decodeState(
  cfg: GoogleOAuthConfig,
  state: string,
): { userId: string; label: string } {
  return decodeOAuthState(cfg.encryptionKey, state);
}

function tokenSetFromResponse(payload: Record<string, unknown>): TokenSet {
  const expiresIn = Number(payload.expires_in ?? 3600);
  return {
    accessToken: String(payload.access_token),
    refreshToken: payload.refresh_token ? String(payload.refresh_token) : null,
    expiresAt: new Date(Date.now() + expiresIn * 1000),
    scope: String(payload.scope ?? ""),
  };
}

export async function exchangeCode(cfg: GoogleOAuthConfig, code: string): Promise<TokenSet> {
  const body = new URLSearchParams({
    code,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    redirect_uri: cfg.redirectUri,
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  return tokenSetFromResponse((await res.json()) as Record<string, unknown>);
}

export async function refreshAccessToken(
  cfg: GoogleOAuthConfig,
  refreshToken: string,
): Promise<TokenSet> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: cfg.clientId,
    client_secret: cfg.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google refresh failed ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const set = tokenSetFromResponse((await res.json()) as Record<string, unknown>);
  // Refresh responses often omit refresh_token — keep the old one.
  if (!set.refreshToken) set.refreshToken = refreshToken;
  return set;
}

export async function fetchEmail(accessToken: string): Promise<string> {
  const res = await fetch(USERINFO_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    throw new Error(`Google userinfo failed ${res.status}`);
  }
  const json = (await res.json()) as { email?: string };
  if (!json.email) throw new Error("Google userinfo missing email");
  return json.email;
}
