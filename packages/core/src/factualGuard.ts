/**
 * Post-generation guards for market/finance/news factual replies.
 * Enforce what prompts alone cannot: instrument lock, consistency, no filler, WA splits.
 */

const WA_SOFT_MAX = 900;

const FILLER_RE =
  /\n?[^.!\n]*(?:No other (?:major )?(?:NSE )?IPOs? reported[^.!\n]*|nothing else (?:notable|reported)[^.!\n]*)[.!]?/gi;

export type FactualGuardOpts = {
  userText?: string | null;
  recentChat?: string | null;
  replyToContent?: string | null;
  /** User-local "now" for weekend/date sanity notes. */
  now?: Date;
  timeZone?: string;
};

/** Chart / ask hints that pin the instrument (e.g. UK 30Y). */
export function extractInstrumentHint(blob: string | null | undefined): string | null {
  const t = (blob ?? "").replace(/\s+/g, " ");
  if (!t.trim()) return null;
  const m30 =
    t.match(/\b(?:UK|United Kingdom|gilt)?\s*30[\s-]*(?:year|yr|y)\b/i) ??
    t.match(/\bUK\s*30Y\b/i) ??
    t.match(/\b30Y\b/i);
  if (m30) {
    if (/\b(UK|United Kingdom|gilt)\b/i.test(t) || /\b30Y\b/i.test(t)) {
      return "UK 30Y gilt yield";
    }
  }
  const m10 =
    t.match(/\b(?:UK|United Kingdom|gilt)?\s*10[\s-]*(?:year|yr|y)\b/i) ??
    t.match(/\bUK\s*10Y\b/i);
  if (m10 && /\b(UK|United Kingdom|gilt)\b/i.test(t)) return "UK 10Y gilt yield";
  const nse = t.match(/\bNSE\s+IPO\b/i);
  if (nse) return "NSE IPO";
  return null;
}

export function looksLikeFactualMarketText(text: string | null | undefined): boolean {
  const t = (text ?? "").trim();
  if (!t) return false;
  return (
    /\b(ipo|subscription|subscribed|qib|nii|retail|gilt|yield|bond|bonds|boE|bank of england|cpi|inflation|fed|rbi|nifty|sensex|equity|equities|qt\b|treasury)\b/i.test(
      t,
    ) ||
    /\b(as of|yesterday|today|latest|this week)\b/i.test(t)
  );
}

/** Drop unsolicited negative filler ("no other IPOs…") unless clearly sourced. */
export function scrubFactualFiller(text: string): string {
  return text
    .replace(FILLER_RE, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Fix contradictory above/below claims vs the two numbers in the same clause.
 * Example: "5.750% (now below EMA20 at 5.674%)" → above.
 */
export function fixComparativeConsistency(text: string): string {
  let out = text;
  // Parenthetical: "5.750% (now below EMA20 at 5.674%)"
  // Right-hand figure must be decimal (avoid matching EMA20's "20").
  out = out.replace(
    /(\d+\.\d+)(%?)\s*\(([^)]{0,80}?)(\bbelow\b|\babove\b|\bunder\b|\bover\b)([^)]{0,80}?)(\d+\.\d+)(%?)([^)]*)\)/gi,
    (full, leftNum, leftPct, pre, rel, mid, rightNum, rightPct, post) => {
      const a = Number(leftNum);
      const b = Number(rightNum);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return full;
      const fixed = fixRel(String(rel), a, b);
      return `${leftNum}${leftPct} (${pre}${fixed}${mid}${rightNum}${rightPct}${post})`;
    },
  );
  // Inline: "5.750% below … 5.674%"
  out = out.replace(
    /(\d+\.\d+)(%?)\s+(?:is\s+)?(below|above|under|over|higher than|lower than)\s+(?:[^0-9\n]{0,40}?)(\d+\.\d+)(%?)/gi,
    (full, leftNum, _leftPct, rel, rightNum, _rightPct) => {
      const a = Number(leftNum);
      const b = Number(rightNum);
      if (!Number.isFinite(a) || !Number.isFinite(b)) return full;
      const fixed = fixRel(String(rel), a, b);
      if (fixed === String(rel)) return full;
      return full.replace(String(rel), fixed);
    },
  );
  return out;
}

function fixRel(rel: string, a: number, b: number): string {
  const relL = rel.toLowerCase();
  const wantsBelow = /below|under|lower than/.test(relL);
  const wantsAbove = /above|over|higher than/.test(relL);
  if (wantsBelow && a > b) {
    if (/below/i.test(rel)) return rel.replace(/below/i, "above");
    if (/under/i.test(rel)) return rel.replace(/under/i, "over");
    if (/lower than/i.test(rel)) return rel.replace(/lower than/i, "higher than");
  }
  if (wantsAbove && a < b) {
    if (/above/i.test(rel)) return rel.replace(/above/i, "below");
    if (/over/i.test(rel)) return rel.replace(/over/i, "under");
    if (/higher than/i.test(rel)) return rel.replace(/higher than/i, "lower than");
  }
  return rel;
}

/** If the ask/chart is 30Y but the reply talks 10Y, lock instrument wording. */
export function enforceInstrumentLock(text: string, hint: string | null): string {
  if (!hint || !/30Y/i.test(hint)) return text;
  let out = text;
  // Common mislabel: "UK 10y gilt" / "UK 10-year"
  out = out.replace(/\bUK\s*10[\s-]*(?:year|yr|y)\s+gilt\b/gi, "UK 30Y gilt");
  out = out.replace(/\bUK\s*10[\s-]*(?:year|yr|y)\s+yield\b/gi, "UK 30Y yield");
  out = out.replace(/\bUK\s*10Y\b/gi, "UK 30Y");
  out = out.replace(/\b10[\s-]*year\s+gilt\s+yield\b/gi, "30-year gilt yield");
  if (!/^\s*\*?UK\s*30Y/i.test(out) && !/\bUK\s*30Y\b/i.test(out.slice(0, 120))) {
    out = `UK 30Y (from chart):\n${out}`;
  }
  return out;
}

/**
 * If the question implies a weekend "as of" date and the reply dates that day,
 * nudge toward the prior business session wording when we can detect it.
 */
export function annotateStaleOrWeekendAsOf(
  text: string,
  opts?: { userText?: string | null; now?: Date; timeZone?: string },
): string {
  const user = (opts?.userText ?? "").trim();
  if (!/\b(yesterday|as of)\b/i.test(user)) return text;
  const now = opts?.now ?? new Date();
  const tz = opts?.timeZone ?? "Asia/Kolkata";
  // "Yesterday" from Mon → Sunday; from Sun → Saturday.
  const yesterdayWd = (() => {
    const d = new Date(now.getTime() - 86_400_000);
    return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(d);
  })();
  const weekendAsk =
    /\byesterday\b/i.test(user) && /^(Sat|Sun)$/i.test(yesterdayWd);
  if (!weekendAsk) return text;
  if (/latest (?:data|figures?) (?:is|are) from|no (?:ipo )?bidding|weekend|Fri\b/i.test(text)) {
    return text;
  }
  // Soft note — do not invent a specific subscription figure.
  return `${text}\n(Note: yesterday was ${yesterdayWd} — IPO books don't update on weekends; prefer the last bidding session's as-of date.)`;
}

/** Numbers/figures present but no source / as-of cue → mark unverified. */
export function ensureSourceOrUnverified(text: string): string {
  const hasFigure =
    /\d+(?:\.\d+)?\s*(?:x|%|bp|bps|cr|bn|mn)\b/i.test(text) ||
    /₹\s*[\d,]+/.test(text) ||
    /\b\d{1,2}(?:\.\d{1,3})?\s*%/.test(text);
  if (!hasFigure) return text;
  const hasSource =
    /\b(source|sources|per|via|reuters|bloomberg|moneycontrol|chittorgarh|nseindia|boe|ons|ft\.com)\b/i.test(
      text,
    ) ||
    /\bas of\b/i.test(text) ||
    /https?:\/\//i.test(text) ||
    /\bSrc:\s*/i.test(text);
  if (hasSource) return text;
  return `${text}\nSrc: couldn't verify from search this turn — treat figures carefully.`;
}

export function sanitizeFactualReplyText(
  text: string,
  opts?: FactualGuardOpts,
): string {
  let t = (text ?? "").trim();
  if (!t) return t;
  const blob = [opts?.userText, opts?.replyToContent, opts?.recentChat]
    .filter(Boolean)
    .join("\n");
  const hint = extractInstrumentHint(blob);
  t = scrubFactualFiller(t);
  t = fixComparativeConsistency(t);
  t = enforceInstrumentLock(t, hint);
  t = annotateStaleOrWeekendAsOf(t, {
    ...(opts?.userText !== undefined ? { userText: opts.userText } : {}),
    ...(opts?.now !== undefined ? { now: opts.now } : {}),
    ...(opts?.timeZone !== undefined ? { timeZone: opts.timeZone } : {}),
  });
  t = ensureSourceOrUnverified(t);
  return t.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Split a long WhatsApp reply into multiple messages without cutting mid-URL / mid-word.
 * Prefer paragraph / sentence boundaries under ~WA_SOFT_MAX chars.
 */
export function splitWhatsAppText(text: string, maxLen = WA_SOFT_MAX): string[] {
  const t = text.trim();
  if (!t) return [];
  if (t.length <= maxLen) return [t];

  const parts: string[] = [];
  let rest = t;
  while (rest.length > maxLen) {
    const window = rest.slice(0, maxLen);
    let cut =
      Math.max(
        window.lastIndexOf("\n\n"),
        window.lastIndexOf("\n"),
        window.lastIndexOf(". "),
        window.lastIndexOf("; "),
      ) + 1;
    if (cut < maxLen * 0.4) {
      cut = window.lastIndexOf(" ");
      if (cut < maxLen * 0.4) cut = maxLen;
    }
    // Don't split inside a URL
    const urlOpen = window.lastIndexOf("https://");
    if (urlOpen >= 0 && urlOpen < cut) {
      const afterUrl = rest.slice(urlOpen).search(/[\s)]/);
      const urlEnd = afterUrl === -1 ? rest.length : urlOpen + afterUrl;
      if (urlEnd > cut && urlEnd - urlOpen < maxLen) cut = urlEnd;
    }
    const chunk = rest.slice(0, cut).trim();
    if (chunk) parts.push(chunk);
    rest = rest.slice(cut).trim();
  }
  if (rest) parts.push(rest);
  return parts.length ? parts : [t];
}

export function outboundTextsFromReply(text: string, maxLen = WA_SOFT_MAX): Array<{ text: string }> {
  return splitWhatsAppText(text, maxLen).map((text) => ({ text }));
}
