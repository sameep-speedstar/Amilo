/** Parse / format email compose asks so a draft always shows on WhatsApp. */

export type EmailComposeMode = "draft" | "send";

export type EmailComposeAsk = {
  mode: EmailComposeMode;
  toHint: string | null;
  about: string;
};

const EMAIL_RE = /\b([\w.+-]+@[\w.-]+\.\w+)\b/;

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

export function parseEmailComposeAsk(text: string): EmailComposeAsk | null {
  const t = text.trim();
  if (!/\b(e-?mails?|mails?)\b/i.test(t)) return null;
  if (/\bcalendar invite\b/i.test(t)) return null;
  const wantsDraft = /\b(help me draft|draft|compose|write)\b/i.test(t);
  const wantsSend = /\bsend\b/i.test(t);
  if (!wantsDraft && !wantsSend) return null;

  const mode: EmailComposeMode = wantsDraft ? "draft" : "send";
  const email = t.match(EMAIL_RE)?.[1] ?? null;
  let toHint = email;
  if (!toHint) {
    const named =
      t.match(/\b(?:e-?mail|mail)\s+to\s+(.+?)\s+(?:that|saying|about|re\b|:)/i) ||
      t.match(/\b(?:to|for)\s+(.+?)\s+(?:that|saying|about|re\b|:)/i);
    if (named?.[1]) {
      toHint =
        named[1]
          .replace(/\b(a |an |the )?(reminder )?e-?mails?\b/gi, "")
          .replace(/\b(send|draft|compose|write|help me)\b/gi, "")
          .replace(/^(to|for)\s+/i, "")
          .replace(/\s+/g, " ")
          .trim() || null;
    }
  }
  if (!toHint) {
    const tail = t.match(/\b(?:to|for)\s+([A-Za-z][\w .&'-]{1,60})$/);
    if (tail?.[1] && !/\b(email|mail)\b/i.test(tail[1])) toHint = tail[1].trim();
  }

  let about = "";
  const aboutMatch = t.match(/\b(?:that|saying|about)\s+(.+)$/is);
  if (aboutMatch?.[1]) {
    about = aboutMatch[1].replace(/\s+/g, " ").trim();
  }
  if (!about) {
    about = t
      .replace(
        /^(please\s+)?(help me\s+)?(to\s+)?(draft|compose|write|send)\s+(an?\s+)?(reminder\s+)?(e-?mail|mail)\b/i,
        "",
      )
      .replace(/\s+/g, " ")
      .trim();
  }

  return { mode, toHint, about };
}

export function composeEmailDraft(
  ask: EmailComposeAsk,
  userName?: string,
): { subject: string; body: string } {
  const about = ask.about.replace(/\s+/g, " ").trim();
  const subject = subjectFromAbout(about);
  const first = personFirstName(ask.toHint);
  const sentence = about ? `${capFirst(about.replace(/[.!?]+$/, ""))}.` : "Following up.";
  const sign = (userName ?? "").trim();
  const body = [first ? `Hi ${first},` : "Hi,", "", sentence, "", sign || "Thanks"].join("\n");
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
}): string {
  const hasTo = Boolean(opts.to?.includes("@"));
  if (!hasTo) {
    const who = opts.recipientLabel?.trim() || "the recipient";
    return [
      `Draft — need ${who}'s email.`,
      "Reply with the address. Then send when you want it in Gmail, edit <change>, or cancel.",
    ].join("\n");
  }
  if (opts.mode === "draft") {
    return [
      "Draft ready (not sent).",
      "Reply send to send via Gmail, edit <change>, or cancel.",
    ].join("\n");
  }
  return [
    "Email ready to send.",
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

function subjectFromAbout(about: string): string {
  if (!about) return "Follow up";
  if (/\brelease the payment/i.test(about) && /\b(invoice|terminate)\b/i.test(about)) {
    return "Reminder: release payment and close invoice";
  }
  const core = about.replace(/^(please\s+)/i, "").slice(0, 70);
  if (/\bremind/i.test(about)) return `Reminder: ${capFirst(core.replace(/\.$/, ""))}`;
  return capFirst(core.replace(/\.$/, ""));
}

function personFirstName(hint: string | null): string | null {
  if (!hint || hint.includes("@")) return null;
  const first = hint.trim().split(/\s+/)[0] ?? "";
  if (first.length < 2 || /^(the|a|an|them)$/i.test(first)) return null;
  return capFirst(first);
}

function capFirst(s: string): string {
  const t = s.trim();
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}
