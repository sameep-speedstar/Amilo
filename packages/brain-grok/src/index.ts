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

export interface GrokBrainConfig {
  apiKey: string;
  /** Default: grok-4-1-fast-non-reasoning (low-latency WhatsApp chat). */
  model?: string;
  /** Override OpenAI-compatible base URL (default https://api.x.ai/v1). */
  baseUrl?: string;
  /** Absolute path to repo `brain/` docs. Auto-resolved if omitted. */
  brainDir?: string;
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
  const raw = (fenced?.[1] ?? text).trim();
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

async function chatCompletion(
  cfg: Required<Pick<GrokBrainConfig, "apiKey" | "model" | "baseUrl">>,
  system: string,
  user: string,
): Promise<string> {
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
    "graphUpdates: only durable facts; empty array if nothing new.",
    "Reply text: short, concrete, ranked; usually under 500 characters; no therapist mode; no sycophancy.",
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
    "Use Recent chat for continuity across turns; do not re-ask what was just discussed.",
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
 * Grok BrainPort — single chat completion returns reply intent + graph deltas.
 */
export function createGrokBrain(cfg: GrokBrainConfig): BrainPort {
  const brainDir = findBrainDir(cfg.brainDir);
  const docs = loadDocs(brainDir);
  const system = buildSystemPrompt(docs);
  const api = {
    apiKey: cfg.apiKey,
    model: cfg.model ?? "grok-4-1-fast-non-reasoning",
    baseUrl: cfg.baseUrl ?? "https://api.x.ai/v1",
  };

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
      const text = await chatCompletion(api, system, buildUserPayload(ctx, message));
      return normalizeInterpret(extractJson<unknown>(text));
    },
  };
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
