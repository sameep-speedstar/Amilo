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
  /**
   * Model for live research (movies/dining/flights). Prefer a reasoning / agentic
   * Grok so web_search can dig like grok.com. Default: grok-4-1-fast-reasoning.
   */
  researchModel?: string;
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

/** Balanced `{…}` / `[…]` slice from openIdx (string-aware). */
function sliceBalanced(raw: string, openIdx: number): string | null {
  const open = raw[openIdx];
  const close = open === "{" ? "}" : open === "[" ? "]" : null;
  if (!close) return null;
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let i = openIdx; i < raw.length; i++) {
    const ch = raw[i]!;
    if (inString) {
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return raw.slice(openIdx, i + 1);
    }
  }
  return null;
}

function isUsefulBrainJson(parsed: unknown): boolean {
  if (Array.isArray(parsed)) {
    // Skip web_search citation footnotes: [1], [1,2], [[1]], [[1],[2]]
    const isNumFootnote = (x: unknown): boolean =>
      typeof x === "number" ||
      (Array.isArray(x) && x.length > 0 && x.every((y) => typeof y === "number"));
    if (parsed.length > 0 && parsed.every(isNumFootnote)) return false;
    // Triage / borderline: array of objects only
    return parsed.every((x) => x !== null && typeof x === "object" && !Array.isArray(x));
  }
  return parsed !== null && typeof parsed === "object";
}

/**
 * Pull the brain contract JSON out of model text.
 * Web_search often prefixes citation markers ([1], [1,2]) before the real object —
 * never treat those as the payload (that caused "non-whitespace after JSON at position 5").
 */
export function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  let raw = (fenced?.[1] ?? text).trim();
  // Models sometimes wrap JSON in **bold**
  raw = raw.replace(/^\*+/, "").replace(/\*+$/, "").trim();

  const tryParse = (slice: string): T | undefined => {
    try {
      const parsed = JSON.parse(slice) as unknown;
      if (!isUsefulBrainJson(parsed)) return undefined;
      return parsed as T;
    } catch {
      return undefined;
    }
  };

  // Prefer the object that contains "intent" (interpret contract).
  const intentKey = raw.search(/"intent"\s*:/);
  if (intentKey >= 0) {
    const brace = raw.lastIndexOf("{", intentKey);
    if (brace >= 0) {
      const slice = sliceBalanced(raw, brace);
      if (slice) {
        const hit = tryParse(slice);
        if (hit !== undefined) return hit;
      }
    }
  }

  // Scan every balanced value; prefer objects with intent, then any useful JSON.
  let fallback: T | undefined;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "{" && ch !== "[") continue;
    const slice = sliceBalanced(raw, i);
    if (!slice) continue;
    const hit = tryParse(slice);
    if (hit === undefined) continue;
    if (hit && typeof hit === "object" && !Array.isArray(hit) && "intent" in (hit as object)) {
      return hit;
    }
    fallback ??= hit;
  }
  if (fallback !== undefined) return fallback;

  throw new Error("Grok brain returned no JSON");
}

/** Strip citation footnotes / JSON blobs to recover readable prose for WA. */
export function extractProseCandidate(text: string): string {
  let t = text
    .replace(/```(?:json)?\s*[\s\S]*?```/g, " ")
    .replace(/\[\[[0-9,\s]+\]\](?:\([^)]*\))?/g, "")
    .replace(/\[([0-9,\s]+)\](?:\([^)]*\))?/g, "")
    .replace(/https?:\/\/\S+/g, (url) => url.replace(/[),.]+$/, ""));
  // Drop a trailing/leading intent JSON object if present
  const intentAt = t.search(/\{\s*"intent"\s*:/);
  if (intentAt >= 0) {
    const before = t.slice(0, intentAt).trim();
    const afterBrace = t.slice(intentAt);
    const slice = sliceBalanced(afterBrace, 0);
    const after = slice ? afterBrace.slice(slice.length).trim() : "";
    t = [before, after].filter(Boolean).join("\n");
  }
  return t
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[^\S\n]{2,}/g, " ")
    .trim()
    .slice(0, 900);
}

function isWeakReplyText(text: string): boolean {
  const t = text.trim();
  if (!t || t === "Got it." || /^Got it\b/i.test(t)) return true;
  if (isLegacyStubReply(t)) return true;
  return false;
}

/** Interpret path: parse contract JSON, or fall back to prose as reply_text. */
export function interpretFromModelText(text: string): InterpretResult {
  let interpreted: InterpretResult | undefined;
  try {
    interpreted = normalizeInterpret(extractJson<unknown>(text));
  } catch {
    interpreted = undefined;
  }

  if (interpreted) {
    const reply =
      interpreted.intent.type === "reply_text" ? interpreted.intent.text.trim() : "";
    const weak =
      interpreted.intent.type === "noop" ||
      (interpreted.intent.type === "reply_text" && isWeakReplyText(reply));
    if (!weak) return interpreted;

    const prose = extractProseCandidate(text);
    if (prose.length >= 12 && !isLegacyStubReply(prose)) {
      console.error(
        JSON.stringify({ event: "grok_prose_fallback", chars: prose.length, reason: "weak_json" }),
      );
      return normalizeInterpret({
        intent: { type: "reply_text", text: prose },
        graphUpdates: interpreted.graphUpdates ?? [],
      });
    }
    return interpreted;
  }

  const prose = extractProseCandidate(text);
  if (prose.length >= 12) {
    console.error(
      JSON.stringify({ event: "grok_prose_fallback", chars: prose.length, reason: "no_json" }),
    );
    return normalizeInterpret({
      intent: { type: "reply_text", text: prose },
      graphUpdates: [],
    });
  }
  throw new Error("Grok brain returned no JSON");
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

type ApiCfg = {
  apiKey: string;
  model: string;
  baseUrl: string;
  researchModel?: string;
};

/** Domain allow-lists for research web_search (max 5 per xAI). */
export function researchWebSearchDomains(message: string): string[] | null {
  const t = message.trim();
  if (!t) return null;
  if (
    /\b(movie|movies|film|films|cinema|showtimes?|pvr|inox|cinepolis|bookmyshow|theatre|theater|tickets?)\b/i.test(
      t,
    )
  ) {
    return ["bookmyshow.com", "in.bookmyshow.com", "pvrcinemas.com", "inoxmovies.com", "google.com"];
  }
  if (
    /\b(dinner|lunch|brunch|restaurant|dining|pub|pubs|cafe|café|zomato|eazydiner)\b/i.test(t)
  ) {
    return ["google.com", "maps.google.com", "tripadvisor.com", "timeout.com", "tripadvisor.in"];
  }
  if (/\b(flight|flights|hotel|hotels|train|indigo|airline)\b/i.test(t)) {
    return ["google.com", "makemytrip.com", "goibibo.com", "kayak.com", "skyscanner.co.in"];
  }
  if (/\b(uber|ola|cab|cabs|taxi|rapido)\b/i.test(t)) {
    return ["google.com", "uber.com", "olacabs.com", "maps.google.com"];
  }
  return null;
}

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
    /** When set, web_search is restricted to these domains (max 5). */
    webSearchAllowedDomains?: string[] | null;
    /** Override model for this call (research vs chat). */
    model?: string;
    /** Longer timeout for research digs (grok.com often takes 30–60s). */
    timeoutMs?: number;
    imageDataUrl?: string;
  },
): Promise<ResponsesResult> {
  type InputMsg = { role: string; content: string | Array<Record<string, unknown>> };
  const input: InputMsg[] = [];
  if (opts.system && !opts.previousResponseId) {
    input.push({ role: "system", content: opts.system });
  }
  if (opts.imageDataUrl) {
    input.push({
      role: "user",
      content: [
        { type: "input_text", text: opts.user },
        { type: "input_image", image_url: opts.imageDataUrl },
      ],
    });
  } else {
    input.push({ role: "user", content: opts.user });
  }

  const body: Record<string, unknown> = {
    model: opts.model ?? cfg.model,
    input,
    store: true,
    temperature: 0.3,
  };
  if (opts.previousResponseId) {
    body.previous_response_id = opts.previousResponseId;
  }
  if (opts.webSearch) {
    const domains = (opts.webSearchAllowedDomains ?? [])
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean)
      .slice(0, 5);
    body.tools = [
      domains.length
        ? { type: "web_search", filters: { allowed_domains: domains } }
        : { type: "web_search" },
    ];
  }

  const timeoutMs = opts.timeoutMs ?? 90_000;
  const res = await fetch(`${cfg.baseUrl.replace(/\/$/, "")}/responses`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
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
    "- Never reply with only an explore/list URL like bookmyshow.com/explore/movies-… — name real titles/venues from search when search returns them.",
    "- Research-only for dining/movies/cabs/flights: lettered shortlists from web_search. Dining venues → Google Maps only (never Zomato/EazyDiner/Dineout). Movies → include real BookMyShow movie/cinema URLs returned by web_search (…/movies/…/ET###### or cinema pages). Never invent ET codes or buytickets with XXXX. Amilo does not book or pay — browse links only.",
    "- Never invent venues, showtimes, flight numbers, fares, seats, or BookMyShow ET codes.",
    "- MOVIES / SHOWTIMES (hard rules): Dig with web_search (BookMyShow first). Only state a theatre + clock time if search explicitly lists that show. Prefer the exact BookMyShow movie or cinema URL from search results (like grok.com). If search is thin, say so — NEVER invent ET codes, buytickets with XXXX, or identical clocks at every theatre.",
    "- Never claim booked, paid, reserved, locked, ordered, or tickets held.",
    "- Browser / WhatsApp booking is OFF. If the user says book/reserve/buy tickets/table: do NOT propose_action life_ops_handoff and do NOT invent a booking or pay link. reply_text: short — Amilo cannot book or reserve yet — then offer to help find options (venues, showtimes, flights, cabs). Do not mention partner APIs.",
    "- Format reply_text for WhatsApp: one short headline, then LETTERED options `A) Name — detail` EACH ON ITS OWN LINE (newline before every A)/B)/C)). Never pack A) B) C) onto one line. Prefer A) B) C) over 1) 2) 3) so picks never collide with FOCUS mail. Never bare '- ' bullets for pickable lists. Same rule for movies, cabs, flights, dining, pubs — every pickable list.",
    "- DINING / PUBS (gold format — match this every time): `A) Name — Cuisine/type; vibe or rating if known from search; ~₹X for two. Maps: https://www.google.com/maps/search/?api=1&query=<Name>+<Area>` — one venue per line, 3–5 options. Include cuisine + price-for-two when search has INR. NEVER use $, $$, $$$, or $$ - $$$ price bands — India WhatsApp uses ₹ only (or omit / say mid-range|upscale). ALWAYS use a Google Maps search link (distance/travel time) — NEVER Zomato, EazyDiner, or Dineout URLs. Client / business / fine-dine asks: lead with upscale/fine-dining first (Oberoi, Michelin, rooftop client-worthy), not casual pubs unless asked. Family asks: family-friendly + mid price. Never invent ratings or ₹ — omit if search doesn't show them.",
    "- End pickable lists with ONE closing line only: `Reply with a letter to pick.` Then ask only for missing day/time/party (movies: day/time, not table for N). Never invent date/time/covers. Never append a second Reply line or booking-link promises.",
    "- NEVER put today's weekday/date in research replies unless the user said today/tonight/a date.",
    "- Keep domains separate: dinner replies must not reuse movie theatres/showtimes from Recent chat (and vice versa).",
    "- Dining OCCASION isolation (hard): client/business dinner ≠ dinner with wife/partner/family/friends. If this Message is a new occasion, ignore prior dining shortlists and constraints from a different occasion in Recent chat — answer only the current ask.",
    "- Research goal: shortlist options; Maps for dining; verified BookMyShow pages for movies/showtimes when search returns them. Amilo does not book or pay.",
    "- Rank options; dining research may use ~900–1200 chars so each lettered line can carry cuisine + ₹ + Maps. Other chat stays shorter. Lead with decision or next action.",
    "- When the user picks a letter/number (or name) but wants to book: state the booking limitation and offer more find help on that pick — do not propose handoff.",
    "- When the user says they already booked (movie/table), propose_action calendar_create for that block (use realistic duration, e.g. film ~2h).",
    "- Upsert durable prefs into graphUpdates (Friday dinners, movies, pubs, area) — silent context for next turns.",
    "- Never return propose_action type life_ops_research — answer in reply_text with live findings.",
    "- Never return propose_action type life_ops_handoff for dining/cab/movie/travel book/reserve — use reply_text with the limitation + find offer.",
    "- intent.text MUST contain the full answer (names, lettered options). Never empty text / noop after search.",
    "IMAGES: When an image is attached, read it (charts, screenshots, tickets). Answer from what is visible; say if unclear. Still return JSON with reply_text.",
    "After the user picks from YOUR lettered list: acknowledge the pick and ask only for missing params (day/time/party). Booking handoff is not built yet — if they say book/reserve, state that limitation and keep helping with research. Never invent ET codes or showtimes. Maps only for place links. Never claim reserved.",
    "graphUpdates: only durable facts; empty array if nothing new.",
    "Reply text: short, concrete, ranked; usually under 500 characters for chat; dining/search lists up to ~1200 so gold-format options fit; lettered picks (A) B) C)) for 2+ venues/films; no therapist mode; no sycophancy.",
    "When the user asks to mute/ignore/hide mail matching a phrase, return propose_action with action {\"type\":\"mute\",\"pattern\":\"...\"} (do not only say muted in reply_text).",
    "When the user asks to be reminded at a time, return propose_action with action {\"type\":\"remind\",\"title\":\"...\",\"dueAt\":\"ISO-8601 UTC\"}. Prefer letting the orchestrator parse times. Timed reminders write a 1-minute calendar nudge at that instant (allowed to overlap meetings). Date-only reminders (no clock) get a 1-minute calendar nudge at 09:00 that day plus a separate WhatsApp after that morning's brief — not FOCUS.",
    "When the user asks to add/change/cancel a calendar event, return propose_action with action {\"type\":\"calendar_create\"|\"calendar_update\"|\"calendar_cancel\",\"accountLabel\":\"personal\",\"title\":\"clean event title only\",\"start\":\"ISO-8601 with correct year from Now line\",\"end\":\"ISO-8601\",\"eventId\":\"from Calendar today [id:…] if present\",\"attendees\":[\"email@…\"]}. Do NOT claim it was written — orchestrator will ask for yes/cancel. Prefer ISO with offset for the user timezone. For cancel/update always include eventId from Calendar today when available, and title matching the event.",
    "Strip acknowledgements and instruction verbs from calendar titles: ignore Cool/Ok/Sure/Thanks; book/add/schedule are instructions not title words; 'book 1 hour with Rajeev at 1pm' → title like 'Meeting with Rajeev', start 1pm, end +1h.",
    "When the user asks to send a calendar invite / invite someone to a meeting, use calendar_create with attendees (emails). If Silent context graph has person email=…, use that — do not ask them to restate the email. Never use email_draft for calendar invites.",
    "When the user asks to send/email someone (not a calendar invite), return propose_action with action {\"type\":\"email_draft\",\"to\":\"...\",\"subject\":\"...\",\"body\":\"recipient-ready prose\"}. The user's words are DIRECTIONS, not the email. Strip 'tell him that', 'saying that', 'in this email I'm just checking', 'sound professional', and any test of whether Amilo rewrites. Put facts in the mail; keep test-talk off the email (the orchestrator can mention it on WhatsApp). Subject: ≤8 words, never a truncated transcript, never 'Reminder:' unless they asked to remind the recipient. Greeting: 'Hi Name,' with no extra punctuation. Resolve to= from context graph person email when only a name is given. If the address is unknown, still fill subject+body and put the name in to (do not invent an @ address). Never say \"draft ready\" or \"email ready to send\" in reply_text — that hides the body. graphUpdates person labels are 1–3 name tokens only — never a sentence.",
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
  const recent = sanitizeRecentChat(ctx.recentChatSummary);
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
    `Recent chat (oldest→newest):\n${recent ?? "none yet"}`,
  ];
  if (ctx.replyToSummary) {
    lines.push(`Reply-to (user quoted this message):\n${ctx.replyToSummary}`);
  }
  lines.push("", `Message:\n${message}`);
  return lines.join("\n");
}

/** Drop legacy Places/BMS-explore stub lines so the model cannot parrot them. */
export function sanitizeRecentChat(chat: string | null | undefined): string | undefined {
  if (!chat?.trim()) return undefined;
  const kept: string[] = [];
  for (const line of chat.split("\n")) {
    if (isLegacyStubReply(line)) continue;
    if (/explore\/movies-/i.test(line) && /BookMyShow|Paste the BookMyShow/i.test(line)) continue;
    kept.push(line);
  }
  const out = kept.join("\n").trim();
  return out || undefined;
}

/** Old Amilo Places short-circuit template — never accept as a live research answer. */
export function isLegacyStubReply(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (/Open BookMyShow for what's playing/i.test(t)) return true;
  if (/Paste the BookMyShow movie link or say shows for/i.test(t)) return true;
  if (/Live Places research isn't available/i.test(t)) return true;
  if (/explore\/movies-[a-z0-9-]+/i.test(t) && /I won't book until you say book/i.test(t)) return true;
  return false;
}

/**
 * Grok BrainPort — Responses API session per user + web search for live research.
 */
export function createGrokBrain(cfg: GrokBrainConfig): BrainPort {
  const brainDir = findBrainDir(cfg.brainDir);
  const docs = loadDocs(brainDir);
  const system = buildSystemPrompt(docs);
  const chatModel = cfg.model ?? "grok-4-1-fast-non-reasoning";
  const researchModel = cfg.researchModel ?? "grok-4-1-fast-reasoning";
  const api: ApiCfg = {
    apiKey: cfg.apiKey,
    model: chatModel,
    researchModel,
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
      const researchAsk = isLiveResearchAsk(message);
      const hasImage = Boolean(ctx.imageDataUrl);
      const cleanCtx: BrainUserContext = {
        ...ctx,
        recentChatSummary: sanitizeRecentChat(ctx.recentChatSummary) ?? "none yet",
      };
      // Research asks: always start a fresh Responses thread so we never inherit the
      // Places-era system prompt or parrot BMS explore stubs from chat history.
      let previousId: string | null = null;
      if ((researchAsk || hasImage) && store) {
        await store.set(ctx.userId, null);
      } else if (store) {
        previousId = await store.get(ctx.userId);
      }

      const userPayload = buildUserPayload(cleanCtx, message);
      const researchHint = researchAsk
        ? "\n\nRESEARCH MODE: Use web_search thoroughly (dig like grok.com — multiple sources). Name real films/venues/cabs from search. LETTERED options (`A) Name — detail`) EACH ON ITS OWN LINE — never pack A) B) C) on one line. Prefer letters over 1) 2) 3). DINING GOLD: `A) Name — Cuisine; vibe/rating if known; ~₹X for two. Maps: https://www.google.com/maps/search/?api=1&query=<Name>+<Area>` — NEVER Zomato/EazyDiner/Dineout; NEVER $/$$/$$$ bands (₹ only or mid-range/upscale words). Client/business → upscale first. Family → family-friendly. Never invent ₹/ratings. MOVIES: search title + city + theatre on BookMyShow. Only list theatre+time if search confirms. If web_search returns a real BookMyShow movie page (…/movies/<city>/<slug>/ET######) or cinema page, INCLUDE that exact URL — never invent ET codes or buytickets with XXXX. Prefer verified BMS browse links over Maps for showtimes. Amilo does not book/pay; research links help the user open the live page themselves. Never invent today's date. Never mix movie↔dinner or client↔wife occasions. End with ONE line: Reply with a letter to pick. Put FULL answer in intent.text."
        : hasImage
          ? "\n\nIMAGE MODE: An image is attached. Read it carefully and answer in intent.text. If the user only sent the image, briefly say what you see and ask what they need."
          : "";

      const searchDomains = researchAsk ? researchWebSearchDomains(message) : null;
      const run = async (prev: string | null, withSearch: boolean, payload: string) =>
        responsesCompletion(api, {
          ...(prev ? {} : { system }),
          user: payload + researchHint,
          previousResponseId: prev,
          webSearch: withSearch || researchAsk,
          ...(researchAsk
            ? {
                model: api.researchModel ?? api.model,
                timeoutMs: 150_000,
                ...(searchDomains ? { webSearchAllowedDomains: searchDomains } : {}),
              }
            : {}),
          ...(ctx.imageDataUrl ? { imageDataUrl: ctx.imageDataUrl } : {}),
        });

      let result: ResponsesResult;
      try {
        result = await run(previousId, webSearch || researchAsk, userPayload);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        // Domain filter may 400 on some accounts — retry research without domain filter.
        if (
          researchAsk &&
          searchDomains &&
          /tool|web_search|400|allowed_domains|filters/i.test(msg)
        ) {
          try {
            result = await responsesCompletion(api, {
              system,
              user: userPayload + researchHint,
              previousResponseId: null,
              webSearch: true,
              model: api.researchModel ?? api.model,
              timeoutMs: 150_000,
              ...(ctx.imageDataUrl ? { imageDataUrl: ctx.imageDataUrl } : {}),
            });
          } catch (errDomain) {
            const msgD = errDomain instanceof Error ? errDomain.message : String(errDomain);
            if (store) await store.set(ctx.userId, null);
            if (/tool|web_search|400/i.test(msgD)) {
              result = await run(null, false, userPayload);
            } else {
              const text = await chatCompletion(api, system, userPayload + researchHint);
              return interpretFromModelText(text);
            }
          }
        } else if (previousId && /404|not found|previous_response|invalid/i.test(msg)) {
          if (store) await store.set(ctx.userId, null);
          previousId = null;
          try {
            result = await run(null, webSearch || researchAsk, userPayload);
          } catch (err2) {
            const msg2 = err2 instanceof Error ? err2.message : String(err2);
            if ((webSearch || researchAsk) && /tool|web_search|400/i.test(msg2)) {
              result = await run(null, false, userPayload);
            } else {
              if (store) await store.set(ctx.userId, null);
              const text = await chatCompletion(api, system, userPayload + researchHint);
              return interpretFromModelText(text);
            }
          }
        } else if ((webSearch || researchAsk) && /tool|web_search|400/i.test(msg)) {
          result = await run(previousId, false, userPayload);
        } else {
          if (store) await store.set(ctx.userId, null);
          const text = await chatCompletion(api, system, userPayload + researchHint);
          return interpretFromModelText(text);
        }
      }

      let interpreted = interpretFromModelText(result.text);
      // Model parroted the BMS explore stub — hard retry with zero chat history + web search.
      if (
        researchAsk &&
        interpreted.intent.type === "reply_text" &&
        isLegacyStubReply(interpreted.intent.text)
      ) {
        console.error(
          JSON.stringify({ event: "grok_rejected_legacy_research_stub", userId: ctx.userId }),
        );
        if (store) await store.set(ctx.userId, null);
        const bareCtx: BrainUserContext = { ...cleanCtx, recentChatSummary: "none yet" };
        const barePayload = buildUserPayload(bareCtx, message);
        try {
          result = await run(null, true, barePayload);
          interpreted = interpretFromModelText(result.text);
        } catch {
          /* keep first interpreted */
        }
      }

      if (store) {
        await store.set(ctx.userId, result.id).catch(() => undefined);
      }
      return interpreted;
    },
  };
}

/** Open web research — movies, dining, flights, showtimes. */
export function isLiveResearchAsk(message: string): boolean {
  const t = message.trim();
  if (!t) return false;
  const stripped = t.replace(/\bbook\s*my\s*show\b/gi, "BMS");
  const movieTicket =
    /\b(tickets?|seats?)\b/i.test(t) ||
    /\b(movie|movies|film|films|cinema|showtimes?|pvr|inox|cinepolis|theatre|theater)\b/i.test(t);
  // Dining "book Katani" is a handoff. Movie "book two tickets for Mirzapur" is still research.
  if (/\b(book|buy|order|reserve)\b/i.test(stripped) && !movieTicket) {
    return false;
  }
  return (
    movieTicket ||
    /\b(dinner|lunch|brunch|pub|pubs|restaurant|flight|flights|playing|running|showing|what's\s+on|whats\s+on)\b/i.test(
      t,
    ) ||
    (/^(which|what)\b/i.test(t) && /\b(near|this\s+week|today|tonight)\b/i.test(t)) ||
    /\b(shows?\s+for|timings?)\b/i.test(t)
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
