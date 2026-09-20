export type DraftPiece = {
  hook: string;
  body: string;
  hashtags: string[];
  copy: string;
};

export type StudioDraft = {
  label: string;
  hook: string;
  x: DraftPiece;
  instagram: DraftPiece;
};

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const brace = raw.indexOf("{");
  const bracket = raw.indexOf("[");
  const start =
    brace >= 0 && (bracket < 0 || brace < bracket) ? brace : bracket;
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start < 0 || end < 0 || end < start) {
    throw new Error("Draft model returned no JSON");
  }
  return JSON.parse(raw.slice(start, end + 1)) as unknown;
}

function cleanTags(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    const t = String(item ?? "")
      .replace(/^#+/, "")
      .replace(/\s+/g, "")
      .trim();
    if (t && !out.some((x) => x.toLowerCase() === t.toLowerCase())) out.push(t);
  }
  return out.slice(0, 5);
}

export function assembleCopy(piece: { hook: string; body: string; hashtags: string[] }): string {
  const tags = piece.hashtags.map((h) => (h.startsWith("#") ? h : `#${h}`));
  return [piece.hook.trim(), piece.body.trim(), tags.join(" ")].filter(Boolean).join("\n\n");
}

function asPiece(raw: unknown, fallbackHook: string): DraftPiece {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const hook = String(obj.hook ?? fallbackHook ?? "").trim();
  const body = String(obj.body ?? obj.text ?? obj.copy ?? "").trim();
  const hashtags = cleanTags(obj.hashtags);
  const piece = { hook, body, hashtags };
  return { ...piece, copy: assembleCopy(piece) };
}

export function parseStudioDrafts(raw: unknown): StudioDraft[] {
  const root = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(raw)
    ? raw
    : Array.isArray((root as { options?: unknown }).options)
      ? (root as { options: unknown[] }).options
      : Array.isArray((root as { drafts?: unknown }).drafts)
        ? (root as { drafts: unknown[] }).drafts
        : [];
  const out: StudioDraft[] = [];
  for (const [i, item] of list.entries()) {
    if (!item || typeof item !== "object") continue;
    const o = item as Record<string, unknown>;
    const hook = String(o.hook ?? "").trim();
    const x = asPiece(o.x ?? o.twitter, hook);
    const instagram = asPiece(o.instagram ?? o.ig, hook);
    if (!x.body && !instagram.body) continue;
    const label =
      String(o.label ?? "").trim() || hook || `Option ${String.fromCharCode(65 + i)}`;
    out.push({
      label,
      hook: hook || x.hook || instagram.hook,
      x,
      instagram,
    });
  }
  if (out.length === 0) throw new Error("No usable drafts in model response");
  return out.slice(0, 3);
}

const VOICE = `You write social drafts for Speedstar products, starting with Amilo.

Voice: warm, wry, direct. Never chirpy, never hype, never "excited to announce."
Amilo is a WhatsApp-native AI chief of staff. Confirm-before-write. Invite-only. CTA is amilo.io — on Instagram say "Link in bio." or "Invite-only." On X, prefer no URL (X charges 13× for links); "Invite-only." is enough unless the user asked for a link.

Never invent live inboxes, real names, or private screenshots.
Hashtags: sparse. X: usually none, max 2 if they earn the line. Instagram: 3–5, not #AI #fyp #productivity spam. Brand may use #Amilo.

X body: one post, under 250 characters if possible. Only thread (1/ 2/) if the idea needs beats.
Instagram body: slightly longer caption, still tight — a few short paragraphs, not a blog.

Each option must be a distinct angle, not a paraphrase.`;

export async function suggestStudioDrafts(opts: {
  apiKey: string;
  model: string;
  idea: string;
  productName: string;
  tagline?: string;
}): Promise<StudioDraft[]> {
  const idea = opts.idea.trim();
  if (!idea) throw new Error("Describe the idea first");
  const user = [
    `Product: ${opts.productName}`,
    opts.tagline ? `Tagline: ${opts.tagline}` : "",
    `Idea / concept:\n${idea}`,
    "",
    "Return ONLY JSON:",
    `{ "options": [ { "label": "short angle name", "hook": "shared one-line hook", "x": { "hook": "...", "body": "...", "hashtags": [] }, "instagram": { "hook": "...", "body": "...", "hashtags": ["Amilo"] } } ] }`,
    "Exactly 3 options.",
  ]
    .filter(Boolean)
    .join("\n");

  const res = await fetch("https://api.x.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      temperature: 0.65,
      max_tokens: 2500,
      messages: [
        { role: "system", content: VOICE },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Draft model ${res.status}: ${body.slice(0, 280)}`);
  }
  const json = (await res.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const content = json.choices?.[0]?.message?.content;
  if (!content) throw new Error("Draft model returned empty content");
  return parseStudioDrafts(extractJson(content));
}
