import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type {
  BrainPort,
  BrainUserContext,
  BriefingDraft,
  ContextNodeKind,
  GraphUpdate,
  InterpretResult,
  TriageEventInput,
  TriageResult,
} from "@amilo/brain-contract";

export interface GrokSessionStore {
  get: (userId: string) => Promise<string | null>;
  set: (userId: string, responseId: string | null) => Promise<void>;
}

export interface GrokBrainConfig {
  apiKey: string;
  /** Default: grok-4-1-fast-non-reasoning (low-latency WhatsApp chat). */
  model?: string;
  /** Override OpenAI-compatible base URL (default https://api.x.ai/v1). */
  baseUrl?: string;
  /** Absolute path to repo `brain/` docs. Auto-resolved if omitted. */
  brainDir?: string;
  /** Per-user xAI previous_response_id — isolates A vs B sessions. */
  sessionStore?: GrokSessionStore;
  /** Enable live web_search on interpret (default true). */
  webSearch?: boolean;
}

const NODE_KINDS: ReadonlySet<string> = new Set([
  "person",
  "org",
  "place",
  "topic",
  "preference",
  "constraint",
  "goal",
  "schedule",
]);

function findBrainDir(explicit?: string): string {
  if (explicit && existsSync(explicit)) return explicit;
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    resolve(process.cwd(), "brain"),
    resolve(process.cwd(), "../../brain"),
    resolve(here, "../../../brain"),
    resolve(here, "../../../../brain"),
  ];
  for (const c of candidates) {
    if (existsSync(join(c, "PERSONA.md"))) return c;
  }
  throw new Error("brain/ docs not found (PERSONA.md) — copy brain/ into the image or set brainDir");
}

function loadDocs(brainDir: string): string {
  const files = ["PERSONA.md", "ADVISOR.md", "CONTEXT_GRAPH.md", "PRIORITY.md", "COMMITMENTS.md"];
  return files
    .map((f) => {
      const p = join(brainDir, f);
      if (!existsSync(p)) return "";
      return `--- ${f} ---\n${readFileSync(p, "utf8").trim()}`;
    })
    .filter(Boolean)
    .join("\n\n");
}

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced?.[1] ?? text).trim();
  // Models sometimes wrap JSON in **bold**
  raw = raw.replace(/^\*+/, "").replace(/\*+$/, "").trim();
  const start =
    raw.indexOf("{") >= 0 && (raw.indexOf("[") < 0 || raw.indexOf("{") < raw.indexOf("["))
      ? raw.indexOf("{")
      : raw.indexOf("[");
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start < 0 || end < 0) {
    throw new Error("Grok brain returned no JSON");
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

function sanitizeGraphUpdates(raw: unknown): GraphUpdate[] {
  if (!Array.isArray(raw)) return [];
  const out: GraphUpdate[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const u = item as Record<string, unknown>;
    if (u.op === "upsert_node") {
      const kind = String(u.kind ?? "");
      const label = String(u.label ?? "").trim();
      if (!NODE_KINDS.has(kind) || !label) continue;
      const node: GraphUpdate = {
        op: "upsert_node",
        kind: kind as ContextNodeKind,
        label,
      };
      if (u.attrs && typeof u.attrs === "object") {
        node.attrs = u.attrs as Record<string, unknown>;
      }
      if (typeof u.confidence === "number") node.confidence = u.confidence;
      out.push(node);
    } else if (u.op === "upsert_edge") {
      const fromLabel = String(u.fromLabel ?? "").trim();
      const toLabel = String(u.toLabel ?? "").trim();
      const rel = String(u.rel ?? "").trim();
      if (!fromLabel || !toLabel || !rel) continue;
      const edge: GraphUpdate = {
        op: "upsert_edge",
        fromLabel,
        toLabel,
        rel,
      };
      if (u.attrs && typeof u.attrs === "object") {
        edge.attrs = u.attrs as Record<string, unknown>;
      }
      if (typeof u.confidence === "number") edge.confidence = u.confidence;
      out.push(edge);
    }
  }
  return out;
}

function normalizeInterpret(parsed: unknown): InterpretResult {
  const obj = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  const intentRaw = (obj.intent && typeof obj.intent === "object" ? obj.intent : obj) as Record<
    string,
    unknown
  >;
  const type = String(intentRaw.type ?? "reply_text");
  let intent: InterpretResult["intent"];
  switch (type) {
    case "noop":
      intent = { type: "noop" };
      break;
    case "detail":
      intent = { type: "detail", itemIndex: Number(intentRaw.itemIndex ?? 0) };
      break;
    case "close_loop":
      intent = {
        type: "close_loop",
        refs: Array.isArray(intentRaw.refs) ? intentRaw.refs.map(String) : [],
      };
      break;
    case "dismiss":
      intent = {
        type: "dismiss",
        refs: Array.isArray(intentRaw.refs) ? intentRaw.refs.map(String) : [],
      };
      break;
    case "propose_action":
      intent = {
        type: "propose_action",
        summary: String(intentRaw.summary ?? ""),
        action:
          intentRaw.action && typeof intentRaw.action === "object"
            ? (intentRaw.action as Record<string, unknown>)
            : {},
      };
      break;
    case "reply_text":
    default: {
      const text = String(intentRaw.text ?? "").trim();
      intent = {
        type: "reply_text",
        text: text || "Got it.",
      };
      break;
    }
  }
  const graphUpdates = sanitizeGraphUpdates(obj.graphUpdates);
  if (graphUpdates.length) return { intent, graphUpdates };
  return { intent };
}

/** Pull assistant text from xAI Responses API payload. */
export function extractResponsesText(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  if (typeof p.output_text === "string" && p.output_text.trim()) return p.output_text.trim();
  const output = p.output;
  if (!Array.isArray(output)) return "";
  const chunks: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    if (o.type === "message" && Array.isArray(o.content)) {
      for (const c of o.content) {
        if (!c || typeof c !== "object") continue;
        const part = c as Record<string, unknown>;
        if (
          (part.type === "output_text" || part.type === "text") &&
          typeof part.text === "string"
        ) {
          chunks.push(part.text);
        }
      }
    }
  }
  return chunks.join("\n").trim();
}

type ApiCfg = Required<Pick<GrokBrainConfig, "apiKey" | "model" | "baseUrl">>;

/** Legacy chat/completions — triage / brief (no web tools). */
async function chatCompletion(cfg: ApiCfg, system: string, user: string): Promise<string> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: 0.3,
      max_tokens: 2000,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Grok API ${res.status}: ${body.slice(0, 400)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Grok API returned empty content");
  return content;
}

type ResponsesResult = { id: string; text: string };

/**
 * Stateful Responses API — per-user session via previous_response_id + optional web_search.
 */
async function responsesCompletion(
  cfg: ApiCfg,
  opts: {
    system?: string;
    user: string;
    previousResponseId?: string | null;
    webSearch?: boolean;
  },
): Promise<ResponsesResult> {
  const input: Array<{ role: string; content: string }> = [];
  if (opts.system && !opts.previousResponseId) {
    input.push({ role: "system", content: opts.system });
  }
  input.push({ role: "user", content: opts.user });

  const body: Record<string, unknown> = {
    model: cfg.model,
    input,
    store: true,
    temperature: 0.3,
  };
  if (opts.previousResponseId) {
    body.previous_response_id = opts.previousResponseId;
  }
  if (opts.webSearch) {
    body.tools = [{ type: "web_search" }];
  }

  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(`Grok Responses ${res.status}: ${errBody.slice(0, 500)}`);
  }
  const json = (await res.json()) as { id?: string };
  const text = extractResponsesText(json);
  const id = typeof json.id === "string" ? json.id : "";
  if (!text) throw new Error("Grok Responses returned empty content");
  if (!id) throw new Error("Grok Responses returned no id");
  return { id, text };
}

function buildSystemPrompt(docs: string): string {
  return [
    "You are Amilo's IQ brain for WhatsApp.",
    "Follow the documents below exactly. Product name is Amilo.",
    "",
    docs,
    "",
    "RESPONSE CONTRACT:",
    "Return ONLY valid JSON (no markdown fences) matching:",
    '{ "intent": { "type": "reply_text"|"propose_action", ... }, "graphUpdates": [ ... ] }',
    "For normal chat: use reply_text. Never use noop — silence looks like a broken bot.",
    "For calendar writes or email drafts: use propose_action (orchestrator confirms before any Google write).",
    "If the user only shared a durable fact, still reply with one short concrete ack (e.g. next useful question or a crisp confirmation) — do NOT perform memory ('as you told me').",
    "Never claim a Google write succeeded — and never say an event was cancelled/created/updated unless you returned propose_action (orchestrator confirms).",
    "LIFE OPS / SEARCH (movies, dining, pubs, flights, showtimes, 'what's on'):",
    "- ALWAYS use live web search for these. Do not reuse prior Amilo stub replies from Recent chat.",
    "- Never reply with only an explore/list URL like bookmyshow.com/explore/movies-… — name real titles/venues from search.",
    "- Prefer BookMyShow / Maps / airline / Zomato deep links to specific titles or places.",
    "- Never invent venues, showtimes, flight numbers, fares, or seats.",
    "- Never claim booked, paid, reserved, locked, ordered, or tickets held.",
    "- Browser / WhatsApp booking is OFF until partner APIs ship — end with a clear book link + one ask (e.g. Want showtimes near Arekere?).",
    "- Rank options; stay WhatsApp-short (usually under ~700 chars). Lead with decision or next action.",
    "- When the user says they already booked (movie/table), propose_action calendar_create for that block (use realistic duration, e.g. film ~2h).",
    "- Upsert durable prefs into graphUpdates (Friday dinners, movies, pubs, area) — silent context for next turns.",
    "- Never return propose_action type life_ops_research — answer in reply_text with live findings.",
    "For vendor call scripts after they pick a place (not a ticket purchase), propose_action {\"type\":\"life_ops_handoff\",...} is ok — still confirm-first; never claim reserved.",
    "graphUpdates: only durable facts; empty array if nothing new.",
    "Reply text: short, concrete, ranked; usually under 500 characters for chat, up to ~700 for search results; no therapist mode; no sycophancy.",
    "When the user asks to mute/ignore/hide mail matching a phrase, return propose_action with action {\"type\":\"mute\",\"pattern\":\"...\"} (do not only say muted in reply_text).",
    "When the user asks to be reminded at a time, return propose_action with action {\"type\":\"remind\",\"title\":\"...\",\"dueAt\":\"ISO-8601 UTC\"}. Prefer letting the orchestrator parse times. Timed reminders write a 1-minute calendar nudge at that instant (allowed to overlap meetings). Date-only reminders (no clock) get a 1-minute calendar nudge at 09:00 that day plus a separate WhatsApp after that morning's brief — not FOCUS.",
    "When the user asks to add/change/cancel a calendar event, return propose_action with action {\"type\":\"calendar_create\"|\"calendar_update\"|\"calendar_cancel\",\"accountLabel\":\"personal\",\"title\":\"clean event title only\",\"start\":\"ISO-8601 with correct year from Now line\",\"end\":\"ISO-8601\",\"eventId\":\"from Calendar today [id:…] if present\",\"attendees\":[\"email@…\"]}. Do NOT claim it was written — orchestrator will ask for yes/cancel. Prefer ISO with offset for the user timezone. For cancel/update always include eventId from Calendar today when available, and title matching the event.",
    "Strip acknowledgements and instruction verbs from calendar titles: ignore Cool/Ok/Sure/Thanks; book/add/schedule are instructions not title words; 'book 1 hour with Rajeev at 1pm' → title like 'Meeting with Rajeev', start 1pm, end +1h.",
    "When the user asks to send a calendar invite / invite someone to a meeting, use calendar_create with attendees (emails). If Silent context graph has person email=…, use that — do not ask them to restate the email. Never use email_draft for calendar invites.",
    "When the user asks to send/email someone (not a calendar invite), return propose_action with action {\"type\":\"email_draft\",\"to\":\"...\",\"subject\":\"...\",\"body\":\"full draft in user voice\"}. Orchestrator shows the draft. If they said send, yes sends via Gmail; if they only asked to draft, they must say send. Resolve to= from context graph person email when only a name is given. If the address is unknown, still fill subject+body and put the name in to (do not invent an @ address). Never say \"draft ready\" or \"email ready to send\" in reply_text — that hides the body.",
    "When the user states a recurring personal window they do NOT want on Google Calendar (school pickup, gym, golf), upsert graph kind schedule with attrs days/startHm/endHm — not calendar_create. Prefer schedule over constraint for timed windows.",
    "When the user extends a schedule or says don't book (e.g. pickup till 5), the orchestrator handles holds; still ack briefly if you reply.",
    "All times the user mentions are in their timezone (see User line). Never assume UTC.",
    "Calendar lines include absolute dates like 'Tue 11 Aug (today)' / '(tomorrow)'. Never move a (today) event into Tomorrow — if Calendar tomorrow is none yet, say tomorrow is clear. Prefer Calendar today/tomorrow over Recent chat if they disagree on day labels.",
    "When the user is deciding, use advisor framing (tradeoffs + recommendation).",
    "If Reply-to is set, the user quoted that exact prior message — treat it as the target event/item (cancel/update/remind/clarify THAT), not a vague guess from calendar alone.",
    "Use Recent chat + this Grok session for continuity; do not re-ask what was just discussed.",
    "Silent context graph is THIS user's only — never mix another person's prefs. Prefer graph prefs (Friday dinner vs movies) when ranking suggestions.",
    "Google accounts line is ground truth. Never say Google is disconnected/unlinked/not connected if that line lists accounts. Never claim disconnect/sync/send succeeded — return propose_action {type:disconnect|sync} or tell them the standing command.",
    "Mail working set (if present) is the only inbox ground truth for this thread. If it lists hits: say yes, name the mail, and extract the call-to-action for the user as the To: recipient so they need not open Gmail. Rank; one sharp block. If hits: none — say no matching mail. Never invent mail or an empty inbox. Follow-ups (action points, attachment, reply, schedule, remind) use this set — do not ask them to restate the sender. propose_action calendar_create / email_draft / remind only when they asked to act. If Mail working set is missing and they ask about a sender, return propose_action {type:search_mail, query:'...'}.",
    "Recent mail line is a brief skim only. Prefer Mail working set when both exist.",
  ].join("\n");
}

function buildUserPayload(ctx: BrainUserContext, message: string): string {
  const now = new Date();
  const localNow = new Intl.DateTimeFormat("en-GB", {
    timeZone: ctx.timezone,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(now);
  const lines = [
    `User: ${ctx.name} (${ctx.timezone})`,
    `Now (user local): ${localNow} — resolve "today"/"tomorrow"/times against THIS date, never invent another year.`,
    `VIPs: ${ctx.vipList.join(", ") || "none"}`,
    `Ignored: ${ctx.ignoredPatterns.join(", ") || "none"}`,
    `Open commitments: ${ctx.openCommitmentsSummary}`,
    `Calendar today: ${ctx.calendarToday}`,
    `Calendar tomorrow: ${ctx.calendarTomorrow ?? "none yet"}`,
    `Silent context graph:\n${ctx.contextGraphSummary ?? "none yet"}`,
    `Google accounts: ${ctx.googleAccountsSummary ?? "unknown"}`,
    `Recent mail:\n${ctx.recentMail ?? "none yet"}`,
    `Mail working set:\n${ctx.mailWorkingSet ?? "none yet"}`,
    `Recent chat (oldest→newest):\n${ctx.recentChatSummary ?? "none yet"}`,
  ];
  if (ctx.replyToSummary) {
    lines.push(`Reply-to (user quoted this message):\n${ctx.replyToSummary}`);
  }
  lines.push("", `Message:\n${message}`);
  return lines.join("\n");
}

/**
 * Grok BrainPort — Responses API session per user + web search for live research.
 */
export function createGrokBrain(cfg: GrokBrainConfig): BrainPort {
  const brainDir = findBrainDir(cfg.brainDir);
  const docs = loadDocs(brainDir);
  const system = buildSystemPrompt(docs);
  const api: ApiCfg = {
    apiKey: cfg.apiKey,
    model: cfg.model ?? "grok-4-1-fast-non-reasoning",
    baseUrl: cfg.baseUrl ?? "https://api.x.ai/v1",
  };
  const webSearch = cfg.webSearch !== false;
  const store = cfg.sessionStore;

  return {
    async triage(ctx: BrainUserContext, events: TriageEventInput[]): Promise<TriageResult[]> {
      const user = [
        "Triage these events. Return ONLY a JSON array of {eventId, bucket, score, reason}.",
        `User: ${ctx.name}`,
        `VIPs: ${ctx.vipList.join(", ") || "none"}`,
        `Open commitments: ${ctx.openCommitmentsSummary}`,
        `Events: ${JSON.stringify(events)}`,
      ].join("\n\n");
      const text = await chatCompletion(api, system, user);
      return extractJson<TriageResult[]>(text);
    },

    async brief(ctx: BrainUserContext, kind: BriefingDraft["kind"]): Promise<BriefingDraft> {
      const user = [
        "Compose a briefing draft. Return ONLY JSON: {kind, headline, items, handledQuietly, bodyText}.",
        `kind=${kind}`,
        `User: ${ctx.name}`,
        `Open commitments: ${ctx.openCommitmentsSummary}`,
        `Calendar today: ${ctx.calendarToday}`,
        `Calendar tomorrow: ${ctx.calendarTomorrow ?? "none yet"}`,
        "Gmail/Calendar sync is not live yet — be honest if data is empty. Cap 5 attention items.",
      ].join("\n\n");
      const text = await chatCompletion(api, system, user);
      return extractJson<BriefingDraft>(text);
    },

    async interpret(ctx: BrainUserContext, message: string): Promise<InterpretResult> {
      const userPayload = buildUserPayload(ctx, message);
      const researchAsk = isLiveResearchAsk(message);
      let previousId = store ? await store.get(ctx.userId) : null;
      // Stale sessions may still have the old “orchestrator does Places” system — reset on research.
      if (researchAsk && previousId && looksLikeLegacyResearchStub(ctx.recentChatSummary)) {
        if (store) await store.set(ctx.userId, null);
        previousId = null;
      }

      const run = async (prev: string | null, withSearch: boolean) =>
        responsesCompletion(api, {
          ...(prev ? {} : { system }),
          user: userPayload,
          previousResponseId: prev,
          webSearch: withSearch || researchAsk,
        });

      let result: ResponsesResult;
      try {
        result = await run(previousId, webSearch || researchAsk);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Stale session — start fresh
        if (previousId && /404|not found|previous_response|invalid/i.test(msg)) {
          if (store) await store.set(ctx.userId, null);
          previousId = null;
          try {
            result = await run(null, webSearch || researchAsk);
          } catch (err2) {
            const msg2 = err2 instanceof Error ? err2.message : String(err2);
            if ((webSearch || researchAsk) && /tool|web_search|400/i.test(msg2)) {
              result = await run(null, false);
            } else {
              if (store) await store.set(ctx.userId, null);
              const text = await chatCompletion(api, system, userPayload);
              return normalizeInterpret(extractJson<unknown>(text));
            }
          }
        } else if ((webSearch || researchAsk) && /tool|web_search|400/i.test(msg)) {
          result = await run(previousId, false);
        } else {
          if (store) await store.set(ctx.userId, null);
          const text = await chatCompletion(api, system, userPayload);
          return normalizeInterpret(extractJson<unknown>(text));
        }
      }

      if (store) {
        await store.set(ctx.userId, result.id).catch(() => undefined);
      }
      return normalizeInterpret(extractJson<unknown>(result.text));
    },
  };
}

/** Open web research — movies, dining, flights, showtimes. */
export function isLiveResearchAsk(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  if (/\b(book|buy|order|reserve)\b/i.test(t.replace(/\bbook\s*my\s*show\b/gi, "BMS"))) {
    // Explicit book may still want search first if "book" means research follow-up — keep false
    return false;
  }
  return (
    /\b(movie|movies|film|films|cinema|showtimes?|what's\s+on|whats\s+on|dinner|lunch|brunch|pub|pubs|restaurant|flight|flights|playing|running|showing)\b/i.test(
      t,
    ) ||
    (/^(which|what)\b/i.test(t) && /\b(near|this\s+week|today|tonight)\b/i.test(t)) ||
    /\b(shows?\s+for|timings?)\b/i.test(t)
  );
}

function looksLikeLegacyResearchStub(recentChat: string | null | undefined): boolean {
  if (!recentChat) return false;
  return /Open BookMyShow for what's playing|Live Places research isn't available|explore\/movies-/i.test(
    recentChat,
  );
}

export type BorderlineMail = {
  id: string;
  from: string;
  subject: string;
  snippet: string;
};

export type BorderlineVerdict = {
  id: string;
  bucket: "action" | "fyi";
  deadline?: string | null;
};

/** Stage B: leftovers only. Unsure → fyi. Never invent a deadline. */
export async function classifyBorderlineMail(
  cfg: GrokBrainConfig,
  items: BorderlineMail[],
): Promise<BorderlineVerdict[]> {
  if (!items.length) return [];
  const api = {
    apiKey: cfg.apiKey,
    model: cfg.model ?? "grok-4-1-fast-non-reasoning",
    baseUrl: cfg.baseUrl ?? "https://api.x.ai/v1",
  };
  const system = [
    "You classify leftover email for an executive morning brief.",
    "Return ONLY JSON array: [{id, bucket:\"action\"|\"fyi\", deadline: ISO or null}].",
    "action = user must do or decide something today/soon (pay, register, reply, vote, renew).",
    "fyi = statements, receipts, promo, admissions marketing, FYI circulars.",
    "If unsure → fyi. Never invent a deadline. Max one line of reasoning is not required.",
  ].join(" ");
  const text = await chatCompletion(api, system, JSON.stringify(items.slice(0, 8)));
  const raw = extractJson<unknown>(text);
  if (!Array.isArray(raw)) return items.map((i) => ({ id: i.id, bucket: "fyi" as const }));
  const out: BorderlineVerdict[] = [];
  for (const row of raw) {
    if (!row || typeof row !== "object") continue;
    const o = row as Record<string, unknown>;
    const id = String(o.id ?? "").trim();
    if (!id) continue;
    const bucket = o.bucket === "action" ? "action" : "fyi";
    const deadline = typeof o.deadline === "string" && o.deadline.trim() ? o.deadline.trim() : "";
    out.push(deadline ? { id, bucket, deadline } : { id, bucket });
  }
  return out.length ? out : items.map((i) => ({ id: i.id, bucket: "fyi" as const }));
}
