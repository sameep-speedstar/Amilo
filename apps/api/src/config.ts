export interface Settings {
  port: number;
  nodeEnv: string;
  databaseUrl: string;
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

  return {
    port: Number(req("PORT", "8080")),
    nodeEnv: req("NODE_ENV", "development"),
    databaseUrl: req("DATABASE_URL", "postgresql://amilo:amilo@localhost:5432/amilo"),
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
  };
}

/** Chat path prefers Grok; Cursor reserved for heavy jobs; else stub. */
export function resolveBrainLabel(s: Settings): "grok" | "cursor-cloud" | "stub" {
  if (s.xaiApiKey) return "grok";
  if (s.cursorApiKey) return "cursor-cloud";
  return "stub";
}
