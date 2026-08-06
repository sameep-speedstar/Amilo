export interface GmailMessage {
  id: string;
  threadId: string;
  from: string;
  subject: string;
  snippet: string;
  labelIds: string[];
  date?: string;
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
