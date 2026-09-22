/** Parse / format email compose asks so a draft always shows on WhatsApp. */

export type EmailComposeMode = "draft" | "send";

export type EmailComposeAsk = {
  mode: EmailComposeMode;
  toHint: string | null;
  about: string;
  sourceText: string;
};

export type RewrittenEmailDraft = {
  subject: string;
  body: string;
  toHint: string | null;
  strippedMeta: boolean;
};

export type GmailAccountLike = {
  label: string;
  email: string | null;
  scopes?: string;
};

export function accountHasGmailSend(scopes?: string): boolean {
  return Boolean(scopes && /gmail\.send/i.test(scopes));
}

/**
 * Prefer a send-capable Google account. If preferred has send, use it;
 * else any non-personal with send, else any with send.
 */
export function pickGmailSendAccount(
  accounts: GmailAccountLike[],
  preferred?: string,
): GmailAccountLike | null {
  const sendable = accounts.filter((a) => accountHasGmailSend(a.scopes));
  if (!sendable.length) return null;
  const pref = preferred?.trim();
  if (pref) {
    const hit = sendable.find((a) => a.label === pref);
    if (hit) return hit;
  }
  return sendable.find((a) => a.label !== "personal") ?? sendable[0] ?? null;
}

const EMAIL_RE = /\b([\w.+-]+@[\w.-]+\.\w+)\b/;
const NOT_A_NAME =
  /^(the|a|an|to|for|and|or|of|my|your|his|her|their|this|that|it|me|us|him|them|chase|send|draft|write|compose|remind|follow|email|mail|another)$/i;

export function isShowDraftAsk(text: string): boolean {
  const t = text.trim();
  return (
    /^(show|see|view|what'?s|whats)\s+(me\s+)?(the\s+)?draft\b/i.test(t) ||
    /^(the\s+)?draft\??$/i.test(t)
  );
}

export function isSendDraftAsk(text: string): boolean {
  return /^(send|send it|send now|send the (email|mail|draft)|yes send)[!.]?$/i.test(
    text.trim(),
  );
}

export function parseBareEmail(text: string): string | null {
  const t = text.trim().replace(/^<|>$/g, "").trim();
  const m = t.match(/^([\w.+-]+@[\w.-]+\.\w+)$/);
  return m?.[1] ?? null;
}

/** User is correcting composition, not dictating the email body. */
export function isEmailRewriteDirection(text: string): boolean {
  const t = text.trim();
  return (
    /\bwrong (?:mail |email )?composition\b/i.test(t) ||
    /\byou are adding my text\b/i.test(t) ||
    /\btake these as (?:my )?directions\b/i.test(t) ||
    /\bcompose (?:the |it |them )?(?:mail|email)?\s*accordingly\b/i.test(t) ||
    /\byou have to draft\b/i.test(t) ||
    /\bdraft a (?:mail|email) reminding\b/i.test(t)
  );
}

export function parseEmailComposeAsk(text: string): EmailComposeAsk | null {
  const t = text.trim();
  if (isEmailRewriteDirection(t)) return null;
  if (!/\b(e-?mails?|mails?)\b/i.test(t)) return null;
  if (/\bcalendar invite\b/i.test(t)) return null;
  const wantsDraft = /\b(help me draft|draft|compose|write)\b/i.test(t);
  const wantsSend = /\bsend\b/i.test(t);
  if (!wantsDraft && !wantsSend) return null;

  const mode: EmailComposeMode = wantsDraft ? "draft" : "send";
  const email = t.match(EMAIL_RE)?.[1] ?? null;
  let toHint = email;
  if (!toHint) {
    const afterMail = t.match(
      /\b(?:e-?mails?|mails?)\s+(?:to|for)\s+(.+?)(?:\s+(?:that|saying|about|tell|re\b|:)|[.,]|$)/i,
    );
    const named =
      afterMail ||
      t.match(/\b(?:to|for)\s+(.+?)\s+(?:that|saying|about|tell|re\b|:)/i);
    if (named?.[1]) toHint = cleanPersonLabel(named[1]);
  }
  if (!toHint) {
    const tail = t.match(/\b(?:to|for)\s+([A-Za-z][\w .&'-]{1,60})$/);
    if (tail?.[1] && !/\b(email|mail)\b/i.test(tail[1])) toHint = cleanPersonLabel(tail[1]);
  }

  const facts = extractEmailFacts(t, toHint);
  return { mode, toHint, about: facts.facts, sourceText: t };
}

/**
 * "Send mail to X and block calendar …" is two asks. The mail source keeps
 * the recipient and the topic, and drops the calendar clause.
 */
export function mailAskBesideCalendar(text: string): EmailComposeAsk | null {
  const ask = parseEmailComposeAsk(text);
  if (!ask) return null;
  if (!/\b(block|calendar|schedule|invite)\b/i.test(text)) return null;
  const purpose =
    text.match(/\bdiscussing(?:\s+on)?\s+([^.]+)/i)?.[1]?.trim() ??
    text.match(/\b(?:about|regarding)\s+([^.]+?)(?:\s+and\s+block\b|$)/i)?.[1]?.trim() ??
    null;
  const topic = purpose
    ?.replace(/\s+and\s+block[\s\S]*$/i, "")
    .replace(/\s+(?:today|tomorrow|tonight)\b[\s\S]*$/i, "")
    .trim();
  const who = ask.toHint ?? "them";
  const sourceText = topic
    ? `Send mail to ${who} about ${topic}`
    : `Send mail to ${who}`;
  const facts = extractEmailFacts(sourceText, ask.toHint);
  return { mode: ask.mode, toHint: ask.toHint, about: facts.facts, sourceText };
}

export function composeEmailDraft(
  ask: EmailComposeAsk,
  userName?: string,
): { subject: string; body: string } {
  const rewritten = rewriteSpokenEmailDirections({
    sourceText: ask.sourceText || ask.about,
    ...(ask.toHint != null ? { toHint: ask.toHint } : {}),
    ...(userName ? { userName } : {}),
  });
  return { subject: rewritten.subject, body: rewritten.body };
}

/** First 1–3 name tokens. Stops at punctuation or a speech verb. */
export function cleanPersonLabel(raw: string | null | undefined): string | null {
  if (!raw?.trim()) return null;
  if (raw.includes("@")) return null;
  let s = raw.trim().replace(/\s+/g, " ");
  s = (s.split(/[.,:;!?]/)[0] ?? s).trim();
  s = s
    .replace(
      /\b(tell|saying|say|asking|ask|that|who|which|this|email|mail|him|her|them)\b[\s\S]*$/i,
      "",
    )
    .trim();
  const names: string[] = [];
  for (const tok of s.split(/\s+/).filter(Boolean)) {
    if (!/^[A-Za-z][A-Za-z'-]*$/.test(tok)) break;
    if (NOT_A_NAME.test(tok)) break;
    names.push(names.length === 0 ? capFirst(tok) : tok);
    if (names.length >= 3) break;
  }
  return names.length ? names.join(" ") : null;
}

/** Only store graph people that look like a name, not a dictated sentence. */
export function isPersistableContactLabel(label: string): boolean {
  const cleaned = cleanPersonLabel(label);
  if (!cleaned) return false;
  const compact = label.trim().replace(/\s+/g, " ");
  if (/[.,:;!?]/.test(compact)) return false;
  if (compact.split(/\s+/).length > 3) return false;
  if (compact.length > 40) return false;
  return cleaned.toLowerCase() === compact.toLowerCase();
}

/** Recipient-ready prose from spoken directions (never a transcript dump). */
export function rewriteSpokenEmailDirections(opts: {
  sourceText: string;
  toHint?: string | null;
  userName?: string;
}): RewrittenEmailDraft {
  const source = opts.sourceText.replace(/\s+/g, " ").trim();
  const toHint = cleanPersonLabel(opts.toHint ?? extractRecipientHint(source));
  const { facts, strippedMeta } = extractEmailFacts(source, toHint);
  const first = personFirstName(toHint);
  const sign = (opts.userName ?? "").trim();
  if (isThinEmailAbout(facts, toHint)) {
    return {
      subject: "Follow up",
      body: [first ? `Hi ${first},` : "Hi,", "", sign || "Thanks"].join("\n"),
      toHint,
      strippedMeta,
    };
  }
  const subject = subjectFromFacts(facts, source);
  const paragraphs = paragraphsFromFacts(facts);
  const body = [
    first ? `Hi ${first},` : "Hi,",
    "",
    ...joinBodyParagraphs(paragraphs),
    "",
    sign || "Thanks",
  ].join("\n");
  return { subject, body, toHint, strippedMeta };
}

/** True when the pending draft is still dictation / test-talk, not a mail. */
export function emailDraftNeedsRewrite(
  payload: Record<string, unknown>,
  sourceText?: string,
): boolean {
  const body = String(payload.body ?? payload.body_draft ?? "").trim();
  const subject = String(payload.subject ?? "").trim();
  const source = (sourceText || String(payload.sourceDirections ?? "")).replace(/\s+/g, " ");
  if (/Hi [^,\n]+[.,];,/i.test(body) || /Hi [^\n]+?,\./i.test(body)) return true;
  if (/^That I\b/im.test(stripGreetingAndSign(body))) return true;
  if (
    /\b(random words|sound professional|i'?m just checking if|getting drafted by)\b/i.test(body)
  ) {
    return true;
  }
  if (/\b(in this e-?mail|tell him that|saying that i am)\b/i.test(body)) return true;
  if (subjectLooksTruncated(subject)) return true;
  if (payload.rewroteFromNotes === true) return false;
  const core = stripGreetingAndSign(body);
  if (source && core.length > 40) {
    const compactCore = compactForCompare(core);
    const compactSource = compactForCompare(source);
    if (compactCore && compactSource.includes(compactCore)) return true;
  }
  return false;
}

export function polishEmailDraftPayload(
  payload: Record<string, unknown>,
  opts: { sourceText: string; userName?: string; toHint?: string | null },
): Record<string, unknown> {
  const next = { ...payload };
  const sourceText = opts.sourceText.replace(/\s+/g, " ").trim();
  next.sourceDirections = sourceText;
  const parsedTo =
    cleanPersonLabel(opts.toHint) ??
    cleanPersonLabel(String(next.recipientLabel ?? "")) ??
    extractRecipientHint(sourceText);
  if (parsedTo) next.recipientLabel = parsedTo;
  const existing = String(next.body ?? next.body_draft ?? "").trim();
  if (existing && !emailDraftNeedsRewrite(next, sourceText)) {
    next.body = fixGreetingPunctuation(existing);
    if (parsedTo)     next.body = ensureGreetingName(String(next.body), parsedTo);
    return next;
  }
  const rewritten = rewriteSpokenEmailDirections({
    sourceText,
    ...(parsedTo != null || opts.toHint != null ? { toHint: parsedTo ?? opts.toHint } : {}),
    ...(opts.userName ? { userName: opts.userName } : {}),
  });
  next.subject = rewritten.subject;
  next.body = rewritten.body;
  next.rewroteFromNotes = true;
  if (rewritten.toHint) next.recipientLabel = rewritten.toHint;
  return next;
}

function extractRecipientHint(text: string): string | null {
  const email = text.match(EMAIL_RE)?.[1];
  if (email) return email;
  const afterMail = text.match(
    /\b(?:e-?mails?|mails?)\s+(?:to|for)\s+(.+?)(?:\s+(?:that|saying|about|tell|re\b|:)|[.,]|$)/i,
  );
  if (afterMail?.[1]) return cleanPersonLabel(afterMail[1]);
  const named = text.match(/\b(?:to|for)\s+(.+?)\s+(?:that|saying|about|tell|re\b|:)/i);
  if (named?.[1]) return cleanPersonLabel(named[1]);
  return null;
}

function extractEmailFacts(
  source: string,
  toHint: string | null,
): { facts: string; strippedMeta: boolean } {
  let t = source.replace(/\s+/g, " ").trim();
  t = t
    .replace(
      /^(please\s+)?(help me\s+)?(to\s+)?(draft|compose|write|send)\s+(an?\s+|another\s+)?(reminder\s+)?(e-?mail|mail)\s*(to|for)?\s*/i,
      "",
    )
    .trim();
  if (toHint) {
    const escaped = toHint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    t = t.replace(new RegExp(`^(for|to)\\s+${escaped}[.,]?\\s*`, "i"), "").trim();
    t = t.replace(new RegExp(`^${escaped}[.,]?\\s*`, "i"), "").trim();
  }
  t = t
    .replace(/^(tell\s+(him|her|them|[A-Za-z][A-Za-z'-]*)\s+that\s+)/i, "")
    .replace(/^(saying\s+that\s+)/i, "")
    .replace(/^(saying\s+)/i, "")
    .replace(/^that\s+/i, "")
    .trim();

  let strippedMeta = false;
  const meta = [
    /\bin this e-?mail[,.]?\s*/gi,
    /\bi'?m just checking if\b[\s\S]*?(?:professional[.!]?\s*)?/gi,
    /\bthe random words\b[\s\S]*?professional[.!]?\s*/gi,
    /\b(?:getting )?drafted by \w+ to sound professional[.!]?\s*/gi,
    /\b(?:and also\s+)?this e-?mail has to sound(?: very)? professional(?: saying that)?\s*/gi,
    /\bsound very professional(?: saying that)?\s*/gi,
  ];
  for (const re of meta) {
    if (re.test(t)) {
      strippedMeta = true;
      t = t.replace(re, " ");
    }
  }
  t = t.replace(/\s+/g, " ").replace(/^[,.\s]+/, "").trim();
  t = t.replace(/\bsearchings\b/gi, "searching");
  t = t.replace(/\bcontrol released of\b/gi, "controlled release of");
  return { facts: t, strippedMeta };
}

function paragraphsFromFacts(facts: string): string[] {
  const chunks = facts
    .split(/\s+(?:however|needless to say|also),?\s+/i)
    .map((c) => c.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const parts = chunks.length > 1 ? chunks : facts.split(/(?<=[.!?])\s+/);
  return parts
    .map((s) => {
      const t = s.replace(/\s+/g, " ").trim().replace(/^[.,\s]+/, "");
      if (!t) return "";
      const capped = capFirst(t);
      return /[.!?]$/.test(capped) ? capped : `${capped.replace(/[,;:]+$/, "")}.`;
    })
    .filter(Boolean);
}

function joinBodyParagraphs(sentences: string[]): string[] {
  if (sentences.length <= 2) return [sentences.join(" ")];
  const out: string[] = [];
  for (let i = 0; i < sentences.length; i += 2) {
    out.push(sentences.slice(i, i + 2).join(" "));
    if (i + 2 < sentences.length) out.push("");
  }
  return out;
}

function userAskedToRemindRecipient(source: string): boolean {
  return (
    /\b(reminder e-?mail|remind(?:ing)? (?:him|her|them|[A-Z][a-z]+)|draft a (?:mail|email) reminding)\b/i.test(
      source,
    ) || /\bplease release the payment\b/i.test(source)
  );
}

function subjectFromFacts(facts: string, source: string): string {
  if (!facts) return "Follow up";
  if (/\brelease the payment/i.test(facts) && /\b(invoice|terminate)\b/i.test(facts)) {
    return "Reminder: release payment and close invoice";
  }
  const firstSent = (facts.split(/[.!?]/)[0] ?? facts).trim();
  let s = firstSent
    .replace(/^(please\s+)/i, "")
    .replace(/^(that\s+)/i, "")
    .replace(/^(i(?:'m| am| have|'ve)\s+)/i, "");
  const words = s.split(/\s+/).filter(Boolean).slice(0, 8);
  while (words.length && /^(i'?m|a|an|the|and|also|for|to)$/i.test(words[words.length - 1] ?? "")) {
    words.pop();
  }
  let title = capFirst(words.join(" ").replace(/[.,;:]+$/, ""));
  if (!title) title = "Follow up";
  if (userAskedToRemindRecipient(source) && !/^reminder:/i.test(title)) {
    return `Reminder: ${title}`.slice(0, 90);
  }
  return title.slice(0, 90);
}

function stripGreetingAndSign(body: string): string {
  return body
    .replace(/^Hi [^,\n]+,\s*/i, "")
    .replace(/\n[A-Z][a-zA-Z]+(?:\s+[A-Z][a-zA-Z]+)?\s*$/, "")
    .replace(/\nThanks\s*$/i, "")
    .trim();
}

function compactForCompare(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function subjectLooksTruncated(subject: string): boolean {
  const t = subject.trim();
  if (!t) return false;
  if (/\b(i'?m|and also|which i'?m|answer f)$/i.test(t)) return true;
  const last = t.split(/\s+/).pop() ?? "";
  return last.length === 1 && /[a-z]/i.test(last);
}

function fixGreetingPunctuation(body: string): string {
  return body.replace(/^Hi ([^,\n]+?)[.,;:]+,/m, "Hi $1,");
}

function ensureGreetingName(body: string, toHint: string): string {
  const first = personFirstName(toHint);
  if (!first) return body;
  if (/^Hi /i.test(body)) return body.replace(/^Hi [^,\n]+,/, `Hi ${first},`);
  return `Hi ${first},\n\n${body}`;
}

function isThinEmailAbout(about: string, toHint: string | null): boolean {
  const a = about.replace(/\s+/g, " ").trim().toLowerCase();
  if (!a) return true;
  const hint = (toHint ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (hint && (a === hint || a === `to ${hint}` || a === `for ${hint}`)) return true;
  if (/^(to|for)\s+[\w .'-]{1,40}$/i.test(about) && about.split(/\s+/).length <= 4) return true;
  return false;
}

/** Notify someone about an appointment — not a calendar hold. */
export function looksLikeAppointmentNotify(text: string): boolean {
  const t = text.trim();
  if (/\badd\b/i.test(t) && /\bcalendar\b/i.test(t)) return false;
  if (/\bblock\b/i.test(t) && /\bcalendar\b/i.test(t)) return false;
  if (/\bcalendar invite\b/i.test(t)) return false;
  return (
    /\bappointment\b/i.test(t) &&
    /\b(send|mail|email|remind|forward)\b/i.test(t)
  );
}

export function latestEmailToHintFromChat(chat: string | null | undefined): string | null {
  if (!chat?.trim()) return null;
  const lines = chat.split(/\n/).reverse();
  for (const line of lines) {
    const body = line.replace(/^(?:User|Amilo):\s*/i, "").trim();
    if (!body) continue;
    const ask = parseEmailComposeAsk(body);
    if (ask?.toHint) return ask.toHint;
  }
  return null;
}

export function extractPlaceAddressFromChat(
  chat: string | null | undefined,
  venueHint: string,
): string | null {
  if (!chat?.trim() || !venueHint.trim()) return null;
  const tokens = venueHint
    .replace(/[^\w\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .slice(0, 3);
  if (!tokens.length) return null;
  const re = new RegExp(tokens.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*"), "i");
  for (const line of chat.split(/\n/)) {
    if (!re.test(line)) continue;
    const paren = line.match(/\(([^)]{8,90})\)/);
    const sector = line.match(/Sector\s+\d+[A-Z]?/i)?.[0];
    if (paren) {
      const addr = (paren[1] ?? "").trim();
      if (sector && !new RegExp(sector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i").test(addr)) {
        return `${sector}, ${addr}`;
      }
      return addr;
    }
    const sco = line.match(/SCO[^,.\n]{3,70}/i)?.[0]?.trim();
    if (sco) return [sector, sco].filter(Boolean).join(", ");
  }
  return null;
}

export function cleanAppointmentVenue(title: string): string {
  const cleaned = title
    .replace(/\btomorrow'?s?\b/gi, "")
    .replace(/\bappointment\s+(?:at|for)?\b/gi, "")
    .replace(/\balong with address details\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "appointment";
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function composeAppointmentReminder(opts: {
  recipientFirst: string | null;
  venue: string;
  whenLabel: string;
  address?: string | null;
  userName?: string;
}): { subject: string; body: string } {
  const venue = opts.venue.replace(/\s+/g, " ").trim() || "appointment";
  const when = opts.whenLabel.replace(/\s+/g, " ").trim();
  const subject = `Reminder: ${venue}${when ? ` — ${when}` : ""}`.slice(0, 90);
  const body = [
    opts.recipientFirst ? `Hi ${opts.recipientFirst},` : "Hi,",
    "",
    `Reminder: ${venue}${when ? ` ${when}` : ""}.`,
    opts.address ? `Address: ${opts.address}` : null,
    "",
    opts.userName?.trim() || "Thanks",
  ]
    .filter((line) => line !== null)
    .join("\n");
  return { subject, body };
}

export function formatEmailDraftCopy(payload: Record<string, unknown>): string {
  const to = String(payload.to ?? "").trim();
  const subject = String(payload.subject ?? "").trim();
  const body = String(payload.body ?? payload.body_draft ?? "").trim();
  return [
    to.includes("@") ? `To: ${to}` : "To: (need recipient email)",
    subject ? `Subject: ${subject}` : null,
    body || "(empty body)",
  ]
    .filter(Boolean)
    .join("\n");
}

export function emailDraftIntro(opts: {
  mode: EmailComposeMode;
  to?: string;
  recipientLabel?: string;
  rewroteFromNotes?: boolean;
}): string {
  const hasTo = Boolean(opts.to?.includes("@"));
  const who = cleanPersonLabel(opts.recipientLabel) || "the recipient";
  if (!hasTo) {
    return [
      `Draft — need ${who}'s email.`,
      "Reply with the address. Then send when you want it in Gmail, edit <change>, or cancel.",
    ].join("\n");
  }
  if (opts.mode === "draft") {
    return [
      opts.rewroteFromNotes
        ? "Rewrote your notes into a mail (not sent)."
        : "Draft ready (not sent).",
      "Reply send to send via Gmail, edit <change>, or cancel.",
    ].join("\n");
  }
  return [
    opts.rewroteFromNotes ? "Rewrote your notes into a mail." : "Email ready to send.",
    "Reply yes to send via Gmail, cancel to drop, or edit <change>.",
  ].join("\n");
}

export function looksLikeFakeDraftAck(text: string): boolean {
  const t = text.trim();
  if (/^draft ready\b/i.test(t)) return true;
  if (/email ready to send/i.test(t) && t.length < 280) return true;
  if (/reply yes to send/i.test(t) && !/^to:/im.test(t)) return true;
  return false;
}

export function isDraftOnlyPayload(payload: Record<string, unknown>): boolean {
  return payload.draftOnly === true || payload.mode === "draft";
}

function personFirstName(hint: string | null): string | null {
  const cleaned = cleanPersonLabel(hint);
  if (!cleaned) return null;
  const first = cleaned.split(/\s+/)[0] ?? "";
  if (first.length < 2 || /^(the|a|an|them)$/i.test(first)) return null;
  return first.replace(/[.,;:]+$/g, "");
}

function capFirst(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
