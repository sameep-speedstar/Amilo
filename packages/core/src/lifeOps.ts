/**
 * Life ops — research → options → confirm → handoff (never spend/send/book without yes).
 */

export type LifeOpsDomain = "travel" | "errand" | "home";

export type LifeOpsResearchIntent = {
  domain: LifeOpsDomain;
  query: string;
  moneyCapInr: number | null;
  options: LifeOpsOption[];
  summary: string;
};

export type LifeOpsOption = {
  id: string;
  label: string;
  detail: string;
  estInr: number | null;
};

export type LifeOpsHandoffIntent = {
  domain: LifeOpsDomain;
  channel: "email" | "calendar" | "vendor" | "note";
  summary: string;
  /** When channel is email — draft fields (still confirm before send). */
  email?: { toHint: string | null; subject: string; body: string };
  /** When channel is calendar — title/time hints. */
  calendar?: { title: string; whenHint: string };
  moneyCapInr: number | null;
};

const MONEY_CAP_RE =
  /(?:under|below|max(?:imum)?|cap(?:ped)?(?:\s+at)?|budget(?:\s+of)?|upto|up to)\s*(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d+)?)\s*(k|thousand)?/i;
const RUPEE_RE = /(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(k|thousand)?/i;

export function parseMoneyCapInr(text: string): number | null {
  const m = text.match(MONEY_CAP_RE) ?? text.match(RUPEE_RE);
  if (!m?.[1]) return null;
  let n = Number(String(m[1]).replace(/,/g, ""));
  if (!Number.isFinite(n) || n <= 0) return null;
  if (m[2]) n *= 1000;
  return Math.round(n);
}

export function formatMoneyCapNote(cap: number | null | undefined): string | null {
  if (cap == null || !(cap > 0)) return null;
  return `Money cap: ₹${cap.toLocaleString("en-IN")} — I will not spend or book above this without a fresh yes.`;
}

function domainFromText(t: string): LifeOpsDomain {
  if (
    /\b(flight|flights|hotel|hotels|train|trains|indigo|airbnb|booking\.com|airport|leave[- ]?by)\b/i.test(
      t,
    )
  ) {
    return "travel";
  }
  if (
    /\b(bill|subscription|return|refund|chase|invoice|appointment|renewal|cancel (my |the )?sub)\b/i.test(
      t,
    )
  ) {
    return "errand";
  }
  if (
    /\b(school|pti|vendor|plumber|electrician|handyman|reservation|restaurant|pickup|nanny|maid)\b/i.test(
      t,
    )
  ) {
    return "home";
  }
  return "travel";
}

/** Standing: find/research options — never books. */
export function parseLifeOpsResearchIntent(text: string): LifeOpsResearchIntent | null {
  const t = text.trim();
  if (!t || t.length > 800) return null;
  const asksResearch =
    /\b(find|research|look up|lookup|options? for|compare|cheapest|best)\b/i.test(t) ||
    /\b(flight|hotel|train)s?\b/i.test(t) &&
      /\b(to|from|under|for|tomorrow|next)\b/i.test(t);
  if (!asksResearch) return null;
  // Exclude pure calendar booking / already-have-ticket forwards.
  if (/\b(book (me |a |the )?(meeting|call|slot)|invite |add to calendar)\b/i.test(t)) {
    return null;
  }
  if (/pnr\s*:|boarding pass|e-?ticket|confirmation (number|code)/i.test(t)) {
    return null;
  }

  const domain = domainFromText(t);
  const moneyCapInr = parseMoneyCapInr(t);
  const query = t.replace(/\s+/g, " ").slice(0, 240);
  const options = buildResearchOptions(domain, query, moneyCapInr);
  const capNote = formatMoneyCapNote(moneyCapInr);
  const summary = [
    `Research (${domain}): ${query}`,
    ...options.map((o) => `${o.id}) ${o.label} — ${o.detail}`),
    capNote,
    "Reply yes to lock the shortlist (still no spend/book), or cancel.",
  ]
    .filter(Boolean)
    .join("\n");

  return { domain, query, moneyCapInr, options, summary };
}

export function buildResearchOptions(
  domain: LifeOpsDomain,
  query: string,
  moneyCapInr: number | null,
): LifeOpsOption[] {
  const cap = moneyCapInr;
  if (domain === "travel") {
    const dest =
      query.match(/\b(?:to|for)\s+([A-Za-z][A-Za-z .'-]{1,40}?)(?:\s+(?:under|below|on|from|tomorrow|next|this)\b|,|$)/i)?.[1]?.trim() ??
      "your destination";
    return [
      {
        id: "A",
        label: `Direct / early option → ${dest}`,
        detail: cap ? `aim under ₹${cap.toLocaleString("en-IN")}` : "earliest sensible departure",
        estInr: cap ? Math.round(cap * 0.85) : null,
      },
      {
        id: "B",
        label: `Value option → ${dest}`,
        detail: cap ? `stay under ₹${cap.toLocaleString("en-IN")}` : "best price/time tradeoff",
        estInr: cap ? Math.round(cap * 0.7) : null,
      },
      {
        id: "C",
        label: "Flexible / later",
        detail: "wider window if A/B miss the cap",
        estInr: null,
      },
    ];
  }
  if (domain === "errand") {
    return [
      {
        id: "A",
        label: "Chase / pay draft",
        detail: "email draft for your review — send only after yes",
        estInr: cap,
      },
      {
        id: "B",
        label: "Return / cancel path",
        detail: "portal steps + draft if needed",
        estInr: null,
      },
      {
        id: "C",
        label: "Hold + remind",
        detail: "calendar nudge; no money moved",
        estInr: null,
      },
    ];
  }
  return [
    {
      id: "A",
      label: "Hold on calendar",
      detail: "propose a block after your yes",
      estInr: null,
    },
    {
      id: "B",
      label: "Vendor / reservation handoff",
      detail: "draft message or call script — you confirm before send",
      estInr: cap,
    },
    {
      id: "C",
      label: "Family schedule memory",
      detail: "standing window only (no Google write until you ask)",
      estInr: null,
    },
  ];
}

/** Standing: hand off to vendor / reservation / chase after research or direct ask. */
export function parseLifeOpsHandoffIntent(text: string): LifeOpsHandoffIntent | null {
  const t = text.trim();
  if (!t || t.length > 800) return null;

  const wantsHandoff =
    /\b(hand ?off|handoff|chase|follow up|follow-up|book (the |a )?(table|reservation|plumber|electrician|vendor)|call the (plumber|electrician|vendor|restaurant)|reserve (a |the )?table)\b/i.test(
      t,
    ) ||
    /\b(return (this|the|my)|request (a )?refund|cancel (my |the )?subscription)\b/i.test(t);
  if (!wantsHandoff) return null;

  const domain = domainFromText(t);
  const moneyCapInr = parseMoneyCapInr(t);

  if (/\b(return|refund|chase|subscription|bill|invoice)\b/i.test(t)) {
    const about = t.replace(/\s+/g, " ").slice(0, 200);
    return {
      domain: "errand",
      channel: "email",
      moneyCapInr,
      summary: [
        `Handoff (errand email): ${about}`,
        formatMoneyCapNote(moneyCapInr),
        "Reply yes to open the draft (still not sent), cancel to drop.",
      ]
        .filter(Boolean)
        .join("\n"),
      email: {
        toHint: null,
        subject: /\breturn\b/i.test(t)
          ? "Return request"
          : /\brefund\b/i.test(t)
            ? "Refund request"
            : /\bsubscription\b/i.test(t)
              ? "Subscription cancellation"
              : "Follow-up",
        body: [
          "Hi,",
          "",
          `Following up on: ${about}`,
          "",
          "Please confirm next steps.",
          "",
          "Thanks",
        ].join("\n"),
      },
    };
  }

  if (/\b(table|reservation|restaurant)\b/i.test(t)) {
    return {
      domain: "home",
      channel: "vendor",
      moneyCapInr,
      summary: [
        `Handoff (reservation): ${t.replace(/\s+/g, " ").slice(0, 200)}`,
        formatMoneyCapNote(moneyCapInr),
        "Reply yes to proceed with the handoff note (no booking until you confirm again).",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  if (/\b(plumber|electrician|handyman|vendor)\b/i.test(t)) {
    return {
      domain: "home",
      channel: "vendor",
      moneyCapInr,
      summary: [
        `Handoff (vendor): ${t.replace(/\s+/g, " ").slice(0, 200)}`,
        formatMoneyCapNote(moneyCapInr),
        "Reply yes for the call/message script — I won't contact anyone without that.",
      ]
        .filter(Boolean)
        .join("\n"),
    };
  }

  return {
    domain,
    channel: "note",
    moneyCapInr,
    summary: [
      `Handoff (${domain}): ${t.replace(/\s+/g, " ").slice(0, 200)}`,
      formatMoneyCapNote(moneyCapInr),
      "Reply yes to lock the handoff plan (no spend/send yet), cancel to drop.",
    ]
      .filter(Boolean)
      .join("\n"),
  };
}

/** Inbox errand → prefer email_draft path with chase/return framing. */
export function parseInboxErrandDraftAsk(text: string): {
  mode: "draft" | "send";
  toHint: string | null;
  about: string;
  kind: "bill" | "return" | "subscription" | "appointment" | "chase";
} | null {
  const t = text.trim();
  if (!/\b(bill|subscription|return|refund|chase|appointment|renewal)\b/i.test(t)) {
    return null;
  }
  if (!/\b(draft|email|mail|send|chase|follow[- ]?up|cancel|return|refund)\b/i.test(t)) {
    return null;
  }
  let kind: "bill" | "return" | "subscription" | "appointment" | "chase" = "chase";
  if (/\breturn\b/i.test(t)) kind = "return";
  else if (/\brefund\b/i.test(t)) kind = "return";
  else if (/\bsubscription\b/i.test(t)) kind = "subscription";
  else if (/\bappointment\b/i.test(t)) kind = "appointment";
  else if (/\bbill\b/i.test(t)) kind = "bill";

  const email = t.match(/\b([\w.+-]+@[\w.-]+\.\w+)\b/)?.[1] ?? null;
  return {
    mode: /\bsend\b/i.test(t) && !/\bdraft\b/i.test(t) ? "send" : "draft",
    toHint: email,
    about: t.replace(/\s+/g, " ").slice(0, 240),
    kind,
  };
}

export function lifeOpsResearchConfirmMessage(payload: Record<string, unknown>): string {
  const domain = String(payload.domain ?? "travel");
  const query = String(payload.query ?? "your request");
  return [
    `Shortlist locked for ${domain}: ${query.slice(0, 120)}.`,
    "Still not booked / paid. Say e.g. handoff option A, draft the chase, or book after you pick.",
  ].join("\n");
}

export function lifeOpsHandoffConfirmMessage(payload: Record<string, unknown>): string {
  const channel = String(payload.channel ?? "note");
  if (channel === "email") {
    return "Handoff ready as an email draft next — say send when the draft looks right (or cancel).";
  }
  if (channel === "vendor") {
    return [
      "Handoff plan locked. Script:",
      String(payload.script ?? payload.summary ?? "Call/message the vendor with your preferred slot.").slice(
        0,
        400,
      ),
      "",
      "I did not contact anyone. Tell me when you've reached them, or ask me to draft an email.",
    ].join("\n");
  }
  return "Handoff plan locked — nothing spent or sent. Say what to do next.";
}
