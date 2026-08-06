export interface Settings {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
  publicBaseUrl: string;
  allowedPhones: string[];
  wabaVerifyToken: string;
  wabaAppSecret: string;
  wabaAccessToken: string;
  wabaPhoneNumberId: string;
  xaiApiKey: string;
  grokModel: string;
  cursorApiKey: string;
  cursorModel: string;
  cursorBrainRepo: string;
  cursorBrainRef: string;
  googleClientId: string;
  googleClientSecret: string;
  googleRedirectUri: string;
  tokenEncryptionKey: string;
  wabaTemplateMorning: string;
  wabaTemplateEvening: string;
  wabaTemplateAlert: string;
}

function req(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined) return "";
  return v;
}

export function loadSettings(): Settings {
  const phones = req("ALLOWED_PHONES")
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);

  const publicBaseUrl = req("PUBLIC_BASE_URL", "http://localhost:8080").replace(/\/$/, "");
  const googleRedirectUri = req(
    "GOOGLE_REDIRECT_URI",
    `${publicBaseUrl}/oauth/google/callback`,
  );

  return {
    port: Number(req("PORT", "8080")),
    nodeEnv: req("NODE_ENV", "development"),
    databaseUrl: req("DATABASE_URL", "postgresql://amilo:amilo@localhost:5432/amilo"),
    publicBaseUrl,
    allowedPhones: phones,
    wabaVerifyToken: req("WABA_VERIFY_TOKEN", "change-me"),
    wabaAppSecret: req("WABA_APP_SECRET"),
    wabaAccessToken: req("WABA_ACCESS_TOKEN"),
    wabaPhoneNumberId: req("WABA_PHONE_NUMBER_ID"),
    xaiApiKey: req("XAI_API_KEY"),
    grokModel: req("GROK_MODEL", "grok-4-1-fast-non-reasoning"),
    cursorApiKey: req("CURSOR_API_KEY"),
    cursorModel: req("CURSOR_MODEL", "composer-2.5"),
    cursorBrainRepo: req("CURSOR_BRAIN_REPO", "https://github.com/sameep-speedstar/Amilo"),
    cursorBrainRef: req("CURSOR_BRAIN_REF", "main"),
    googleClientId: req("GOOGLE_CLIENT_ID"),
    googleClientSecret: req("GOOGLE_CLIENT_SECRET"),
    googleRedirectUri,
    tokenEncryptionKey: req("TOKEN_ENCRYPTION_KEY"),
    wabaTemplateMorning: req("WABA_TEMPLATE_MORNING", "morning_update"),
    wabaTemplateEvening: req("WABA_TEMPLATE_EVENING", "evening_wrap"),
    wabaTemplateAlert: req("WABA_TEMPLATE_ALERT", "priority_update"),
  };
}

/** Chat path prefers Grok; Cursor reserved for heavy jobs; else stub. */
export function resolveBrainLabel(s: Settings): "grok" | "cursor-cloud" | "stub" {
  if (s.xaiApiKey) return "grok";
  if (s.cursorApiKey) return "cursor-cloud";
  return "stub";
}

export function googleConfigured(s: Settings): boolean {
  return Boolean(s.googleClientId && s.googleClientSecret && s.tokenEncryptionKey);
}
