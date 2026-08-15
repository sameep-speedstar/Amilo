export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  labelIds: string[];
  date?: string;
  hasUnsubscribe?: boolean;
}

const NOISE_LABELS = new Set([
  "CATEGORY_PROMOTIONS",
  "CATEGORY_SOCIAL",
  "CATEGORY_FORUMS",
]);

const NEWSLETTER_KEYWORDS = [
  "unsubscribe",
  "newsletter",
  "view in browser",
  "% off",
  "sale ends",
  "limited time",
  "flash sale",
  "noreply-promo",
];

/** True when Gmail (or light heuristics) says this is promo/noise — skip for briefings. */
export function isPromotionalMail(m: GmailMessage): boolean {
  if (m.labelIds.some((l) => NOISE_LABELS.has(l))) return true;
  if (m.hasUnsubscribe) return true;
  const hay = `${m.from} ${m.subject} ${m.snippet}`.toLowerCase();
  return NEWSLETTER_KEYWORDS.some((k) => hay.includes(k));
}

const BASE = "https://gmail.googleapis.com/gmail/v1/users/me";
const METADATA_HEADERS = ["From", "To", "Subject", "Date", "List-Unsubscribe"];

async function gmailGet(
  accessToken: string,
  path: string,
  params?: Record<string, string | string[]>,
): Promise<Record<string, unknown>> {
  const url = new URL(`${BASE}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
      else url.searchParams.set(k, v);
    }
  }
  const res = await fetch(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) {
    const err = new Error(`Gmail ${res.status}: ${(await res.text()).slice(0, 300)}`);
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as Record<string, unknown>;
}

async function fetchMessage(accessToken: string, id: string): Promise<GmailMessage> {
  const data = await gmailGet(accessToken, `/messages/${id}`, {
    format: "metadata",
    metadataHeaders: METADATA_HEADERS,
  });
  const headersList = ((data.payload as { headers?: Array<{ name: string; value: string }> })
    ?.headers ?? []) as Array<{ name: string; value: string }>;
  const headers: Record<string, string> = {};
  for (const h of headersList) headers[h.name] = h.value;
  return {
    id: String(data.id),
    threadId: String(data.threadId ?? ""),
    from: headers.From ?? "",
    subject: headers.Subject ?? "(no subject)",
    snippet: String(data.snippet ?? ""),
    labelIds: Array.isArray(data.labelIds) ? data.labelIds.map(String) : [],
    ...(headers.Date ? { date: headers.Date } : {}),
    ...(headers["List-Unsubscribe"] ? { hasUnsubscribe: true } : {}),
  };
}

/** Recent mail (7d backfill) or incremental via historyId. Headers/snippet only. */
export async function listRecentGmail(
  accessToken: string,
  historyId: string | null,
): Promise<{ messages: GmailMessage[]; historyId: string }> {
  if (historyId) {
    try {
      return await incremental(accessToken, historyId);
    } catch (err) {
      const status = (err as Error & { status?: number }).status;
      if (status === 404) return backfill(accessToken);
      throw err;
    }
  }
  return backfill(accessToken);
}

async function backfill(
  accessToken: string,
): Promise<{ messages: GmailMessage[]; historyId: string }> {
  const listing = await gmailGet(accessToken, "/messages", {
    q: "newer_than:7d",
    maxResults: "40",
  });
  const ids = ((listing.messages as Array<{ id: string }> | undefined) ?? []).map((m) => m.id);
  const messages: GmailMessage[] = [];
  for (const id of ids.slice(0, 40)) {
    messages.push(await fetchMessage(accessToken, id));
  }
  const profile = await gmailGet(accessToken, "/profile");
  return { messages, historyId: String(profile.historyId) };
}

async function incremental(
  accessToken: string,
  historyId: string,
): Promise<{ messages: GmailMessage[]; historyId: string }> {
  const history = await gmailGet(accessToken, "/history", {
    startHistoryId: historyId,
    historyTypes: "messageAdded",
  });
  const ids = new Set<string>();
  for (const entry of (history.history as Array<Record<string, unknown>> | undefined) ?? []) {
    for (const rec of (entry.messagesAdded as Array<{ message?: { id?: string } }> | undefined) ??
      []) {
      if (rec.message?.id) ids.add(rec.message.id);
    }
  }
  const messages: GmailMessage[] = [];
  for (const id of [...ids].slice(0, 40)) {
    messages.push(await fetchMessage(accessToken, id));
  }
  return {
    messages,
    historyId: String(history.historyId ?? historyId),
  };
}

/** Live Gmail search (headers/snippet only). Caller supplies a full `q`. */
export async function searchGmail(
  accessToken: string,
  q: string,
  maxResults = 8,
): Promise<GmailMessage[]> {
  const listing = await gmailGet(accessToken, "/messages", {
    q: q.slice(0, 400),
    maxResults: String(Math.min(20, Math.max(1, maxResults))),
  });
  const ids = ((listing.messages as Array<{ id: string }> | undefined) ?? []).map((m) => m.id);
  const messages: GmailMessage[] = [];
  for (const id of ids.slice(0, maxResults)) {
    messages.push(await fetchMessage(accessToken, id));
  }
  return messages;
}

/** Send a plain-text email via Gmail API (requires gmail.send scope). */
export async function sendGmailMessage(
  accessToken: string,
  opts: { to: string; subject: string; body: string; from?: string },
): Promise<{ id: string; threadId: string }> {
  const to = opts.to.trim();
  const subject = opts.subject.trim() || "(no subject)";
  const body = opts.body ?? "";
  const lines = [
    `To: ${to}`,
    ...(opts.from ? [`From: ${opts.from}`] : []),
    `Subject: ${subject}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "",
    body,
  ];
  const raw = Buffer.from(lines.join("\r\n"), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const res = await fetch(`${BASE}/messages/send`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ raw }),
  });
  if (!res.ok) {
    throw new Error(`Gmail send ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const data = (await res.json()) as { id?: string; threadId?: string };
  return { id: String(data.id ?? ""), threadId: String(data.threadId ?? "") };
}
