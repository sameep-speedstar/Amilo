import {
  classifyOptionListKind,
  optionPickSource,
} from "./lifeOps.js";

/** Exact / near-exact standing WhatsApp commands (bypass the brain). */

export function normalizeCommandText(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/g, "")
    .replace(/\s+/g, " ");
}

export function isHelpCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return t === "help" || t === "commands" || t === "command" || t === "menu";
}

export function isHowItWorksCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "how it works" ||
    t === "how does it work" ||
    t === "how does this work" ||
    t === "how does amilo work" ||
    t === "how do you work" ||
    t === "how amilo works"
  );
}

/** First-day / explore: what can you do, capabilities, etc. */
export function isCapabilitiesCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  if (
    t === "what can you do" ||
    t === "what do you do" ||
    t === "what can amilo do" ||
    t === "what does amilo do" ||
    t === "how can you help" ||
    t === "how can amilo help" ||
    t === "what are you" ||
    t === "who are you" ||
    t === "capabilities" ||
    t === "features" ||
    t === "what is amilo" ||
    t === "what's amilo" ||
    t === "whats amilo" ||
    t === "tell me about yourself" ||
    t === "tell me about amilo"
  ) {
    return true;
  }
  // "amilo what can you do" / "hi what can you do"
  return /^(?:(?:hi|hey|hello)\s+)?(?:amilo\s+)?what can you do$/.test(t);
}

/** Hi / Hi Amilo / hey — Day-0 welcome path. */
export function isGreetingCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "hi" ||
    t === "hello" ||
    t === "hey" ||
    t === "/start" ||
    t === "hi amilo" ||
    t === "hello amilo" ||
    t === "hey amilo" ||
    t === "hi there" ||
    t === "hello there" ||
    t === "yo amilo" ||
    t === "good morning" ||
    t === "good morning amilo" ||
    t === "good evening" ||
    t === "good evening amilo"
  );
}

export function isSkipOnboardingCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "skip onboarding" ||
    t === "skip guide" ||
    t === "stop onboarding" ||
    t === "end onboarding"
  );
}

/** training / training tip / next tip — pull next Days 2–7 tip on demand. */
export function isTrainingTipCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "training" ||
    t === "training tip" ||
    t === "training tips" ||
    t === "next tip" ||
    t === "next training tip" ||
    t === "tip" ||
    /^training tip\s*#?\d*$/.test(t)
  );
}

/** Call me X / my name is X / I'm X — Day-1 name reply. */
export function parseDisplayNameReply(text: string): string | null {
  const t = text.trim();
  const m =
    t.match(/^(?:call me|my name is|i(?:'m| am))\s+(.+)$/i) ??
    t.match(/^just\s+(.+)$/i);
  if (!m?.[1]) return null;
  const name = m[1].replace(/[?.!]+$/g, "").trim().slice(0, 80);
  if (!name || /^(yes|no|ok|okay|fine|that|it)$/i.test(name)) return null;
  // Single token or short phrase only — avoid capturing full sentences.
  if (name.split(/\s+/).length > 4) return null;
  return name;
}

export function isCompletedListCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "completed" ||
    t === "done list" ||
    t === "what's done" ||
    t === "whats done" ||
    t === "what is done"
  );
}

export function isHandledListCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "handled" ||
    t === "what's handled" ||
    t === "whats handled" ||
    t === "what was handled" ||
    t === "what is handled"
  );
}

export function isStatusCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "status" ||
    t === "pending" ||
    t === "open" ||
    t === "what's pending" ||
    t === "whats pending" ||
    t === "what's open" ||
    t === "whats open" ||
    t === "show pending" ||
    t === "list pending" ||
    t === "what is pending" ||
    t === "what is open"
  );
}

export function isAboutMeCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "about me" ||
    t === "memory" ||
    t === "profile" ||
    t === "what do you know" ||
    t === "what do you know about me" ||
    t === "what you know about me" ||
    t === "show memory"
  );
}

/** about <name> / what do you know about <name> — not "about me". */
export function parseAboutPersonCommand(text: string): string | null {
  const t = text.trim();
  const m =
    t.match(/^about\s+(.+)$/i) ??
    t.match(/^what do you know about\s+(.+)$/i) ??
    t.match(/^what you know about\s+(.+)$/i);
  if (!m?.[1]) return null;
  const name = m[1].replace(/[?.!]+$/g, "").trim();
  if (!name || /^(me|myself|my memory)$/i.test(name)) return null;
  return name.slice(0, 120);
}

export function isDeleteMenuCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return t === "delete" || t === "remove" || t === "forget";
}

/**
 * forget <label> → whole node
 * forget <label> <attr> → one attr (e.g. forget Rajeev email)
 */
export function parseForgetCommand(
  text: string,
): { label: string; attr?: string } | null {
  const m = text.trim().match(/^(?:forget|delete memory|remove memory)\s+(.+)$/i);
  if (!m?.[1]) return null;
  const rest = m[1].replace(/[?.!]+$/g, "").trim();
  if (!rest || /^(pending|all|memory|me)$/i.test(rest)) return null;
  const parts = rest.split(/\s+/);
  if (parts.length >= 2) {
    const attr = parts[parts.length - 1]!;
    const label = parts.slice(0, -1).join(" ");
    // Treat last token as attr only if it looks like a field key (no spaces, short).
    if (/^[a-z_][a-z0-9_]{1,30}$/i.test(attr) && !/^(jr|sr|ii|iii)$/i.test(attr)) {
      return { label: label.slice(0, 120), attr: attr.toLowerCase() };
    }
  }
  return { label: rest.slice(0, 120) };
}

/**
 * Schedule overview for today/tomorrow — deterministic, bypasses the brain.
 * Avoids "is X scheduled tomorrow?" style questions (those stay with the brain).
 */
export function parseScheduleDayQuery(text: string): "today" | "tomorrow" | null {
  const t = normalizeCommandText(text);
  const wantsTomorrow = /\btomorrow\b/.test(t);
  const wantsToday = /\btoday\b/.test(t);
  if (wantsTomorrow === wantsToday) return null; // neither or both

  // Create / hold / invite — not a "what's on my calendar" query.
  if (/\b(block|book|add|create|invite|put|fix)\b/.test(t)) return null;
  if (/\bschedule\s+(?:a|an|the|me|my)?\s*(meeting|call|lunch|event|appointment|invite)\b/.test(t)) {
    return null;
  }

  // "scheduled" without asking for the schedule itself → leave to brain
  if (/\bscheduled\b/.test(t) && !/\b(my\s+)?(schedule|calendar|agenda|plan)\b/.test(t)) {
    return null;
  }

  const scheduleish =
    /\b(schedule|calendar|agenda|plan)\b/.test(t) ||
    /\b(what'?s|whats|what is|how'?s|hows|how is)\s+on\b/.test(t) ||
    /\banything\s+(on|up)\b/.test(t) ||
    /\bwhat'?s\s+(up|happening)\b/.test(t) ||
    /\b(what'?s|whats|what is|how'?s|hows|how is)\s+(my\s+)?(day|week)\b/.test(t);

  if (!scheduleish) return null;
  return wantsTomorrow ? "tomorrow" : "today";
}

/** waiting on <person> for <thing> */
export function parseWaitingOnCommand(
  text: string,
): { person: string; thing: string } | null {
  const m = text
    .trim()
    .match(/^waiting on\s+(.+?)\s+for\s+(.+)$/i);
  if (!m?.[1] || !m[2]) return null;
  const person = m[1].replace(/[?.!]+$/g, "").trim();
  const thing = m[2].replace(/[?.!]+$/g, "").trim();
  if (person.length < 2 || thing.length < 2) return null;
  return { person: person.slice(0, 80), thing: thing.slice(0, 200) };
}

/** cancel watch <hint> */
export function parseCancelWatchCommand(text: string): string | null {
  const m = text.trim().match(/^cancel watch(?:es)?\s+(.+)$/i);
  if (!m?.[1]) return null;
  const hint = m[1].replace(/[?.!]+$/g, "").trim();
  return hint ? hint.slice(0, 120) : null;
}

export function isDeletePendingCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "delete pending" ||
    t === "drop pending" ||
    t === "clear pending" ||
    t === "cancel pending"
  );
}

export function isClearMemoryCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return t === "clear memory" || t === "wipe memory" || t === "delete memory";
}

export function isClearMemoryConfirmCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  return (
    t === "clear memory yes" ||
    t === "wipe memory yes" ||
    t === "delete memory yes" ||
    t === "yes clear memory"
  );
}

/** done / drop / snooze open commitments */
export function parseCommitmentCloseCommand(
  text: string,
): { status: "done" | "dropped" | "snoozed"; titleHint: string; snoozeRaw?: string } | null {
  const t = text.trim().replace(/[.!]+$/, "").trim();
  if (/^(?:that'?s\s+)?(?:done|mark(?:ed)?(?:\s+as)?\s+done)$/i.test(t)) {
    return { status: "done", titleHint: "" };
  }
  const done = t.match(/^(?:done|mark done|finish(?:ed)?|complete(?:d)?)\s+(.+)$/i);
  if (done?.[1]) {
    return {
      status: "done",
      titleHint: done[1].replace(/^(on|the|my)\s+/i, "").trim(),
    };
  }
  const drop = t.match(/^(?:drop|dismiss|cancel reminder)\s+(.+)$/i);
  if (drop?.[1]) {
    return {
      status: "dropped",
      titleHint: drop[1].replace(/^(the|my)\s+/i, "").trim(),
    };
  }
  const snooze = t.match(/^snooze\s+(.+?)\s+(?:to|until)\s+(.+)$/i);
  if (snooze?.[1] && snooze[2]) {
    return {
      status: "snoozed",
      titleHint: snooze[1].replace(/^(the|my)\s+/i, "").trim(),
      snoozeRaw: snooze[2].trim(),
    };
  }
  const mark = t.match(/^mark\s+(.+?)\s+done$/i);
  if (mark?.[1]) {
    return { status: "done", titleHint: mark[1].trim() };
  }
  return null;
}

/** connect google / reconnect gmail personal */
export function parseConnectGoogleCommand(
  text: string,
): { kind: "connect" | "reconnect"; rawLabel: string | null } | null {
  const t = normalizeCommandText(text);
  const m = t.match(/^(?:please\s+)?(re)?connect\s+(?:google|gmail)(?:\s+(\S+))?$/);
  if (!m) return null;
  return {
    kind: m[1] ? "reconnect" : "connect",
    rawLabel: m[2]?.trim() || null,
  };
}

export function isGoogleListCommand(text: string): boolean {
  const t = normalizeCommandText(text);
  if (
    t === "google" ||
    t === "gmail" ||
    t === "google accounts" ||
    t === "list google" ||
    t === "show google" ||
    t === "show google accounts"
  ) {
    return true;
  }
  if (/^which\s+\d+\s+accounts?$/.test(t)) return true;
  if (
    /google account/.test(t) &&
    /\b(which|what|show|list|connected|linked)\b/.test(t)
  ) {
    return true;
  }
  if (/^(show|list|which|what)\s+(are\s+)?(the\s+)?(my\s+)?(linked\s+|connected\s+)?google\b/.test(t)) {
    return true;
  }
  return false;
}

/** disconnect personal2 / disconnect google personal 2 / unlink google all */
export function parseDisconnectGoogleCommand(
  text: string,
): { rawLabel: string | "all" | null } | null {
  const t = normalizeCommandText(text);
  let m = t.match(/^(?:please\s+)?(?:disconnect|unlink)\s+(?:google\s+|gmail\s+)?(.*)$/);
  if (!m) {
    m = t.match(/^(?:please\s+)?remove\s+google(?:\s+(.*))?$/);
  }
  if (!m) return null;
  const rest = (m[1] ?? "").trim();
  if (!rest) return { rawLabel: null };
  if (/\b(the|this|that)\s+(call|line|chat|meeting)\b/.test(rest)) return null;
  if (rest === "all" || rest === "everything") return { rawLabel: "all" };
  return { rawLabel: rest.replace(/\s+/g, "") };
}

/** sync / sync personal / please sync google */
export function parseSyncCommand(text: string): { label?: string } | null {
  const t = normalizeCommandText(text);
  const m = t.match(/^(?:please\s+)?sync(?:\s+google)?(?:\s+(.+))?$/);
  if (!m) return null;
  const rest = (m[1] ?? "").trim();
  if (!rest) return {};
  const compact = rest.replace(/\s+/g, "");
  if (!/^[\w-]{1,40}$/.test(compact)) return null;
  return { label: compact };
}

export function parseMailLookbackDays(text: string): number | null {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  const numbered = t.match(
    /\b(?:in\s+(?:the\s+)?)?last\s+(\d+)\s+(day|days|week|weeks|month|months)\b/,
  );
  if (numbered?.[1] && numbered[2]) {
    const n = Number(numbered[1]);
    if (!Number.isFinite(n) || n < 1) return null;
    const unit = numbered[2];
    if (unit.startsWith("week")) return Math.min(90, n * 7);
    if (unit.startsWith("month")) return Math.min(90, n * 30);
    return Math.min(90, n);
  }
  if (/\b(?:in\s+(?:the\s+)?)?last\s+week\b/.test(t)) return 7;
  if (/\b(?:in\s+(?:the\s+)?)?last\s+fortnight\b/.test(t)) return 14;
  if (/\b(?:in\s+(?:the\s+)?)?last\s+month\b/.test(t)) return 30;
  return null;
}

const MAIL_WORD_RE = /\b(?:e-?mails?|mails?|inbox|gmail)\b/i;

const MAIL_SEARCH_STOP = new Set([
  "about",
  "regarding",
  "show",
  "list",
  "from",
  "the",
  "and",
  "for",
  "any",
  "please",
  "check",
  "find",
  "look",
  "search",
  "email",
  "emails",
  "mail",
  "mails",
  "inbox",
  "gmail",
  "specifically",
  "asking",
  "there",
  "this",
  "that",
  "those",
  "them",
  "with",
  "your",
  "have",
  "just",
  "some",
  "into",
  "over",
  "last",
  "week",
  "weeks",
  "month",
  "months",
  "days",
  "day",
  "celebration",
  "celebrations",
  "special",
  "asking",
]);

export function isLookbackOnlyMessage(text: string): boolean {
  const t = normalizeCommandText(text);
  if (t.length > 48) return false;
  if (MAIL_WORD_RE.test(t)) return false;
  return parseMailLookbackDays(t) != null;
}

export function mailTokenVariants(tok: string): string[] {
  const t = tok.toLowerCase();
  const out = new Set([t]);
  if (t.endsWith("s") && t.length > 4) out.add(t.slice(0, -1));
  else if (t.length >= 4) out.add(`${t}s`);
  return [...out];
}

export function mailSearchTokens(query: string): string[] {
  const seen = new Set<string>();
  const tokens: string[] = [];
  for (const raw of query.toLowerCase().split(/[^\p{L}\p{N}]+/u)) {
    const t = raw.trim();
    if (t.length < 4 || MAIL_SEARCH_STOP.has(t) || seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
    if (tokens.length >= 8) break;
  }
  return tokens;
}

export function mailTokenInHay(tok: string, hay: string): boolean {
  const h = hay.toLowerCase();
  return mailTokenVariants(tok).some((v) => h.includes(v));
}

/** True when every distinctive token is present (sender/subject/snippet). */
export function mailHayMatchesQuery(hay: string, query: string): boolean {
  const tokens = mailSearchTokens(query);
  if (!tokens.length) return false;
  const h = hay.toLowerCase();
  return tokens.every((tok) => mailTokenInHay(tok, h));
}

export function buildGmailSearchQuery(query: string, lookbackDays: number): string {
  const tokens = mailSearchTokens(query);
  const body =
    tokens
      .map((t) => {
        const vars = mailTokenVariants(t);
        return vars.length > 1 ? `(${vars.join(" OR ")})` : t;
      })
      .join(" ") || query.trim();
  return `${body} newer_than:${Math.max(1, lookbackDays)}d`.trim();
}

export function isMailFollowUp(text: string): boolean {
  const t = normalizeCommandText(text);
  if (!t || parseMailLookup(t)) return false;
  if (/\b(show|list|those|that|them)\s+(?:e-?mails?|mails?)\b/.test(t)) return true;
  if (/^(show|list|find)\s+(them|those|it|that)$/.test(t)) return true;
  if (/\b(specifically|i mean|i'?m asking|i am asking|asking about)\b/.test(t)) {
    return true;
  }
  return false;
}

export function isMailQueryRefine(text: string, priorQuery: string): boolean {
  const cur = mailSearchTokens(text);
  const prev = mailSearchTokens(priorQuery);
  if (!cur.length || !prev.length) return false;
  return cur.some((t) => prev.some((p) => mailTokenInHay(t, p) || mailTokenInHay(p, t)));
}

export function looksLikeInventedMailMiss(text: string): boolean {
  const t = text.trim();
  if (/\beither inbox\b/i.test(t)) return true;
  if (/\bno (?:e-?mails?|mails?)\b/i.test(t) && /\b(inbox|from)\b/i.test(t)) return true;
  return false;
}

export type MailWorkingHit = {
  from: string;
  to?: string;
  subject: string;
  snippet: string;
  date?: string;
  eventId?: string;
};

export type MailWorkingSet = {
  query: string;
  lookbackDays: number;
  savedAt: string;
  hits: MailWorkingHit[];
};

export const MAIL_WORKING_SET_TTL_MS = 6 * 60 * 60 * 1000;

export function isMailWorkingSetFresh(set: MailWorkingSet | null | undefined, now = Date.now()): boolean {
  if (!set?.savedAt || !Array.isArray(set.hits)) return false;
  const t = Date.parse(set.savedAt);
  return Number.isFinite(t) && now - t < MAIL_WORKING_SET_TTL_MS;
}

/** Digest / meta on the last find — not a new search. */
function isMailOperatorAsk(raw: string): boolean {
  return /\b(action points?|summaris[ee]|summarize|attachment|latest|how many|when did i|when was)\b/i.test(
    raw,
  );
}

export function parseWaitingForMail(text: string): {
  query: string;
  lookbackDays: number;
  watch: true;
} | null {
  const m = text
    .trim()
    .match(
      /wait(?:ing)?\s+(?:for|on)\s+(?:an?\s+)?(?:e-?mails?|mails?)\s+from\s+(.+)$/i,
    );
  if (!m?.[1]) return null;
  const query = m[1].replace(/[?.!]+$/g, "").trim();
  if (query.length < 2) return null;
  return { query: query.slice(0, 80), lookbackDays: 14, watch: true };
}

export function formatMailWorkingSet(set: MailWorkingSet): string {
  if (!set.hits.length) {
    return `Mail working set: query “${set.query}”, last ${set.lookbackDays}d, hits: none. There is no matching mail. Do not invent any.`;
  }
  const blocks = set.hits.slice(0, 5).map((h, i) =>
    [
      `${i + 1}. From: ${h.from}`,
      h.to ? `   To: ${h.to}` : null,
      h.date ? `   Date: ${h.date}` : null,
      `   Subject: ${h.subject}`,
      h.snippet ? `   Snippet: ${h.snippet}` : null,
    ]
      .filter(Boolean)
      .join("\n"),
  );
  return [
    `Mail working set (ground truth for this thread). Query “${set.query}”, last ${set.lookbackDays}d:`,
    ...blocks,
  ].join("\n");
}

export function parseMailLookup(
  text: string,
): { query: string; lookbackDays: number } | null {
  const raw = text.trim();
  if (!MAIL_WORD_RE.test(raw)) return null;
  if (/\b(send|draft|compose|write)\b/i.test(raw) && !/\b(check|find|any|search|look|from|show|list)\b/i.test(raw)) {
    return null;
  }
  if (/^summarize\b/i.test(raw) || /^summarise\b/i.test(raw)) return null;

  if (isMailOperatorAsk(raw)) {
    const fromPerson = raw.match(/\bfrom\s+(.+)$/i);
    if (fromPerson?.[1] && !/\bthese\b/i.test(raw)) {
      const name = fromPerson[1]
        .replace(/[?.!]+$/g, "")
        .replace(/'s\s+(?:e-?mails?|mails?).*$/i, "")
        .replace(/\b(?:e-?mails?|mails?)\b/gi, "")
        .replace(/\b(the|this|that)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();
      if (name.length >= 3) {
        return { query: name.slice(0, 80), lookbackDays: parseMailLookbackDays(raw) ?? 14 };
      }
    }
    return null;
  }

  const lookbackDays = parseMailLookbackDays(raw) ?? 14;
  let work = raw
    .replace(/[?.!]+$/g, "")
    .replace(
      /\b(?:please\s+)?(?:check|find|look(?:\s+for)?|search|show|list|is there|are there|any)\b/gi,
      " ",
    )
    .replace(/\b(?:the\s+)?(?:e-?mails?|mails?|inbox|gmail)\b/gi, " ")
    .replace(/\bfrom\b/gi, " ")
    .replace(/\b(?:in|over)\s+(?:the\s+)?last\s+\d+\s+(?:days?|weeks?|months?)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  const split = work.match(/^(.+?)\s+(?:on|regarding|about|re)\s+(.+)$/i);
  if (split?.[1] && split[2]) {
    const right = split[2].replace(/\bcelebrations?\b/gi, "").trim();
    work = [split[1].trim(), right].filter(Boolean).join(" ");
  }

  const query = work.replace(/\s+/g, " ").trim();
  if (query.length < 3) return null;
  return { query: query.slice(0, 160), lookbackDays };
}

export function mailLookupFromChatSummary(summary: string | undefined): {
  query: string;
  lookbackDays: number;
} | null {
  if (!summary) return null;
  const lines = summary.split("\n").reverse();
  for (const line of lines) {
    const body = line.replace(/^User:\s*/i, "").trim();
    if (!body || /^Amilo:/i.test(line)) continue;
    const hit = parseMailLookup(body);
    if (hit) return hit;
  }
  return null;
}

/** Bare yes/ok/sure — used to confirm a prior mail-search offer. */
export function isBareAffirmative(message: string): boolean {
  return /^(yes|y|yeah|yep|yup|ok|okay|sure|please|do it|go ahead|search(\s+it)?|yes\s+please|sure\s+please)$/i.test(
    message.trim().replace(/[.!]+$/g, ""),
  );
}

/**
 * Which brief list a bare 1/2/3 reply should open.
 * Quoted WhatsApp reply-to wins; otherwise the latest option list;
 * stored lastBriefNumberContext is last resort.
 */
export function briefNumberListTarget(opts: {
  replyToContent?: string | null;
  replyToScheduled?: string | null;
  recentChat?: string | null;
  numberContext: "focus" | "more";
}): "focus" | "more" {
  const source = optionPickSource({
    recentChat: opts.recentChat,
    replyToContent: opts.replyToContent,
  });
  const kind = classifyOptionListKind(source);
  if (kind === "brief_more") return "more";
  if (kind === "brief_focus") return "focus";

  const replyTo = (opts.replyToContent ?? "").toLowerCase();
  const scheduled = (opts.replyToScheduled ?? "").toLowerCase();

  const replyIsMore =
    /\bmore from your brief\b/.test(replyTo) ||
    /\bhandled yesterday\b/.test(replyTo) ||
    (replyTo.includes("quieter") && /\d+\)/.test(replyTo));
  if (replyIsMore) return "more";

  const replyIsFocus =
    scheduled === "morning" ||
    scheduled === "evening" ||
    /\bfocus\b/.test(replyTo) ||
    /\bgood morning\b/.test(replyTo) ||
    /\bmorning brief\b/.test(replyTo) ||
    /\bevening wrap\b/.test(replyTo) ||
    /\bstill open\b/.test(replyTo) ||
    /\breply m for quieter\b/.test(replyTo);
  if (replyIsFocus) return "focus";

  return opts.numberContext === "more" ? "more" : "focus";
}

const MAIL_SEARCH_OFFER_RE =
  /\b(want me to search|shall i search|should i search|i can search|search (your |the )?mail|look (it|that) up in (your )?mail|search (for )?it)\b/i;

/** Pull a subject / mail needle from a user line that isn't a formal find-mail command. */
export function mailQueryFromUserLine(body: string): { query: string; lookbackDays: number } | null {
  const raw = body.trim().replace(/[?.!]+$/g, "");
  if (!raw || isBareAffirmative(raw)) return null;
  const mail = parseMailLookup(raw);
  if (mail) return mail;
  const details = raw.match(
    /^(?:more\s+details?\s+(?:on|about|for)\s+|show\s+(?:me\s+)?(?:more\s+)?details?\s+(?:on|about|for)\s+|details?\s+(?:on|about|for)\s+)(.+)$/i,
  );
  if (details?.[1]) {
    const q = details[1].trim();
    if (q.length >= 5) return { query: q.slice(0, 160), lookbackDays: 14 };
  }
  if (/\b(re|fwd|fw):/i.test(raw) || /—/.test(raw) || /<>/.test(raw)) {
    if (raw.length >= 8) return { query: raw.slice(0, 160), lookbackDays: 14 };
  }
  return null;
}

/**
 * If Amilo just offered to search mail, return the query from the prior user ask.
 * Used so a bare "yes" actually runs the search instead of soft-holding.
 */
export function pendingMailSearchFromChat(summary: string | undefined): {
  query: string;
  lookbackDays: number;
} | null {
  if (!summary) return null;
  const lines = summary.split("\n");
  let lastAmilo = -1;
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    if (/^Amilo:/i.test(lines[i]!)) {
      lastAmilo = i;
      break;
    }
  }
  if (lastAmilo < 0 || !MAIL_SEARCH_OFFER_RE.test(lines[lastAmilo]!)) return null;
  for (let i = lastAmilo - 1; i >= 0; i -= 1) {
    const line = lines[i]!;
    if (!/^User:/i.test(line)) continue;
    const body = line.replace(/^User:\s*/i, "").trim();
    const hit = mailQueryFromUserLine(body);
    if (hit) return hit;
  }
  return mailLookupFromChatSummary(summary);
}

export const STANDING_HELP = [
  "Amilo — quick commands",
  "",
  "Basics",
  "• help / commands — this list",
  "• what can you do — 5 uses with examples",
  "• how it works — what Amilo does under the hood",
  "• pause / resume — stop or restart",
  "• status / pending / open — waiting proposal + open items",
  "• completed — items you marked done",
  "• handled — quieter mail from yesterday",
  "• about me / memory — what I've stored (only when you ask)",
  "• about <name> — what I know about one person",
  "",
  "Google",
  "• connect google personal — link Gmail + Calendar",
  "• google — list linked accounts",
  "• disconnect google <label|all> — unlink (LifeOS untouched)",
  "• sync — refresh mail + today's calendar",
  "• brief — curated priorities (also: morning / evening)",
  "",
  "Attention",
  "• mute <phrase> / unmute <phrase> / mutes",
  "• vip <name> / vip list — people whose mail always matters",
  "• training tip — next Days 2–7 tip (or wait for the daily push)",
  "• briefs on|off · brief morning 7:30 · brief evening 8pm",
  "• quiet hours 22:00-07:00",
  "• timezone — show or set (I'm in Dubai)",
  "• remind me … at 3pm — 1 min on calendar (even over a meeting)",
  "• remind me Friday to … — 09:00 1 min on calendar + ping after that morning brief",
  "• waiting on <person> for <thing> — watch for their reply",
  "• cancel watch <hint> — drop an open watch",
  "• schedules (memory): “school pickup 4–4:30 daily” · extend till 5 · cancel hold",
  "",
  "Travel",
  "• home is <address> / office is <address>",
  "• places — list saved places",
  "• I'm at home|office — fix leave-by origin",
  "• find flights/hotels/trains … — research shortlist (yes locks plan, never books)",
  "• Forward flight/hotel/train tickets — propose calendar + leave-by tip",
  "",
  "Life ops (confirm-first)",
  "• chase / return / subscription / bill drafts — email after yes",
  "• handoff plumber|reservation … — script only until you confirm",
  "• Money caps (under ₹8k) stick on the pending — no spend above without a fresh yes",
  "",
  "Writes (always confirm)",
  "• Talk normally to book / invite / cancel calendar",
  "• draft an email to … — shows the draft; say send to deliver",
  "• show draft — reshow the open email",
  "• yes — confirm · send — deliver draft · cancel — drop · edit <change>",
  "",
  "Delete / forget",
  "• delete — what you can remove",
  "• delete pending — drop open proposal",
  "• forget <name> — remove a remembered person/fact",
  "• forget <name> <attr> — e.g. forget Rajeev email",
  "• clear memory yes — wipe learned context",
  "",
  "Commitments",
  "• done <title> / drop <title> — close an open item",
  "• done / done 1 / done 2 — close a brief priority (same ask stays off)",
  "• snooze <title> to tomorrow — push due date",
  "",
  "Voice notes work like text. Everything else: just talk.",
].join("\n");

export const HOW_IT_WORKS = [
  "How Amilo works",
  "",
  "1) I sync Gmail + Calendar when you connect Google.",
  "2) Briefs surface only mail that needs action — not every alert.",
  "3) I remember durable facts quietly (people, roles, prefs).",
  "4) Ask about me / about <name> anytime to inspect what I've stored.",
  "5) waiting on <person> for <thing> arms a CoS watch for their reply.",
  "6) With places set, I compute leave-by times and warn on impossible back-to-backs.",
  "7) Calendar/email writes need your yes first — I never invent a write.",
  "8) pause stops me; your data stays until you delete/forget.",
  "",
  'Type Help for anything else.',
].join("\n");

/**
 * Day-1 / explore: what I can do (bubble 2).
 * Also returned for "what can you do" / "who are you".
 */
export const WHAT_I_DO = [
  "I can:",
  "a) brief — morning priorities from mail + calendar",
  "   Try: brief",
  "b) Reminders that land on time",
  "   Try: remind me Friday 3pm to call the bank",
  "c) VIP list — people whose mail always matters",
  "   Try: vip Priya",
  "d) Book calendars — I propose, you say yes",
  "   Try: book 30 min with Priya tomorrow at 4",
  "e) Draft emails — same confirm-before-send",
  "   Try: draft an email to Priya about the deck",
  "f) Life ops — research travel/errands/home, never book without yes",
  "   Try: find flights to Goa under 8k",
  "",
  "Text or voice note — both work.",
].join("\n");

export const DAY1_GOOGLE_SETUP = [
  "Let's start by connecting Google.",
  "Just type: connect google personal",
  "(or connect google work — your choice)",
  "",
  "Training tips land over the next week — or ask: training tip",
].join("\n");

/** Day-1 greeting as 3 short WhatsApp bubbles. */
export function welcomeMessages(name?: string | null): string[] {
  const first =
    name?.trim() && name.trim().toLowerCase() !== "there"
      ? name.trim().split(/\s+/)[0]!
      : null;
  const hi = first
    ? `Hi ${first} — I'm Amilo, your chief of staff on WhatsApp.`
    : `Hi — I'm Amilo, your chief of staff on WhatsApp.`;
  return [
    [
      hi,
      "",
      "Save this number in Contacts as Amilo (or any name you like) so I'm easy to find.",
    ].join("\n"),
    WHAT_I_DO,
    DAY1_GOOGLE_SETUP,
  ];
}

/** @deprecated Prefer welcomeMessages — kept for scripts that join one blob. */
export function welcomeMessage(name?: string | null): string {
  return welcomeMessages(name).join("\n\n");
}

/** vip Priya / add vip Priya / vip list */
export function parseVipCommand(text: string): { op: "add" | "list"; name?: string } | null {
  const t = normalizeCommandText(text);
  if (t === "vip" || t === "vips" || t === "vip list" || t === "list vip" || t === "list vips") {
    return { op: "list" };
  }
  const m = text.trim().match(/^(?:add\s+)?vip\s+(.+)$/i);
  if (!m?.[1]) return null;
  const raw = m[1].replace(/[?.!]+$/g, "").trim();
  if (!raw || /^(list|me)$/i.test(raw)) return { op: "list" };
  return { op: "add", name: raw.slice(0, 80) };
}

export const DELETE_MENU = [
  "What you can remove:",
  "• delete pending — drop the open yes/cancel proposal",
  "• forget <name> — e.g. forget Rajeev",
  "• forget <name> <attr> — e.g. forget Rajeev email",
  "• cancel watch <hint> — drop an open reply/stall watch",
  "• clear memory yes — wipe learned context (people/facts)",
  "• disconnect google <label|all> — unlink Google",
  "",
  "Reminders: say done on that reminder, or cancel when proposed.",
].join("\n");
