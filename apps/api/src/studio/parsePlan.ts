export const STUDIO_CHANNELS = ["x", "instagram", "linkedin"] as const;
export type StudioChannel = (typeof STUDIO_CHANNELS)[number];

export type ParsedPlanItem = {
  date: string;
  time: string;
  hook: string;
  copy: Partial<Record<StudioChannel, string>>;
};

const CHANNEL_ALIASES: Record<string, StudioChannel> = {
  x: "x",
  twitter: "x",
  tweet: "x",
  ig: "instagram",
  instagram: "instagram",
  insta: "instagram",
  li: "linkedin",
  linkedin: "linkedin",
};

export function normalizeChannel(raw: string): StudioChannel | null {
  return CHANNEL_ALIASES[raw.trim().toLowerCase()] ?? null;
}

export function zonedLocalToUtc(date: string, hm: string, timeZone: string): Date {
  const asUtc = new Date(`${date}T${hm}:00Z`);
  if (Number.isNaN(asUtc.getTime())) throw new Error(`Bad datetime ${date} ${hm}`);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(asUtc);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asIfUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return new Date(asUtc.getTime() - (asIfUtc - asUtc.getTime()));
}

function isDate(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function parseJsonPlan(raw: string): ParsedPlanItem[] | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[") && !trimmed.startsWith("{")) return null;
  let data: unknown;
  try {
    data = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const rows = Array.isArray(data) ? data : [data];
  const out: ParsedPlanItem[] = [];
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    const date = String(r.date ?? "").slice(0, 10);
    if (!isDate(date)) continue;
    const time = typeof r.time === "string" && /^\d{2}:\d{2}$/.test(r.time) ? r.time : "09:30";
    const hook = String(r.hook ?? r.title ?? "").trim();
    const copy: ParsedPlanItem["copy"] = {};
    const copyObj =
      r.copy && typeof r.copy === "object" ? (r.copy as Record<string, unknown>) : null;
    if (copyObj) {
      for (const [k, v] of Object.entries(copyObj)) {
        const ch = normalizeChannel(k);
        if (ch && typeof v === "string" && v.trim()) copy[ch] = v.trim();
      }
    }
    const platforms = Array.isArray(r.platforms)
      ? r.platforms.map((p) => normalizeChannel(String(p))).filter((p): p is StudioChannel => Boolean(p))
      : [];
    const body = typeof r.text === "string" ? r.text.trim() : typeof r.caption === "string" ? r.caption.trim() : "";
    if (platforms.length && body) {
      for (const p of platforms) copy[p] = copy[p] ?? body;
    }
    if (Object.keys(copy).length === 0 && body) copy.x = body;
    if (Object.keys(copy).length === 0) continue;
    out.push({ date, time, hook: hook || body.slice(0, 80), copy });
  }
  return out;
}

function parseBlocks(raw: string): ParsedPlanItem[] {
  const chunks = raw
    .split(/\n(?=#{1,3}\s+\d{4}-\d{2}-\d{2}|\d{4}-\d{2}-\d{2}\s*[|—-])/)
    .map((c) => c.trim())
    .filter(Boolean);
  const items: ParsedPlanItem[] = [];

  for (const chunk of chunks.length ? chunks : [raw.trim()]) {
    const pipe = chunk.match(
      /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\s*[|—-]\s*([a-zA-Z]+)\s*[|—-]\s*([\s\S]+)$/,
    );
    if (pipe) {
      const ch = normalizeChannel(pipe[3] ?? "");
      const copyText = (pipe[4] ?? "").trim();
      if (!ch || !copyText) continue;
      items.push({
        date: pipe[1]!,
        time: pipe[2] ?? "09:30",
        hook: copyText.split("\n")[0]!.slice(0, 90),
        copy: { [ch]: copyText },
      });
      continue;
    }

    const heading = chunk.match(
      /^#{1,3}\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?(?:\s+[—|-]\s*(.+))?/,
    );
    if (heading) {
      const date = heading[1]!;
      const time = heading[2] ?? "09:30";
      const rest = chunk.slice(heading[0].length).trim();
      const copy: ParsedPlanItem["copy"] = {};
      if (/^#{2,3}\s+/m.test(rest)) {
        for (const sec of rest.split(/^(?=#{2,3}\s+)/m)) {
          const m = sec.match(/^#{2,3}\s+([a-zA-Z]+)\s*\n([\s\S]+)/);
          if (!m) continue;
          const ch = normalizeChannel(m[1] ?? "");
          if (ch) copy[ch] = m[2]!.trim();
        }
      } else if (rest) {
        const hinted = normalizeChannel(heading[3] ?? "");
        if (hinted) copy[hinted] = rest;
        else copy.x = rest;
      }
      if (Object.keys(copy).length === 0) continue;
      const first = Object.values(copy)[0] ?? "";
      items.push({
        date,
        time,
        hook: (heading[3] ?? first.split("\n")[0] ?? "").slice(0, 90),
        copy,
      });
    }
  }

  if (items.length === 0) {
    for (const line of raw.split(/\n+/)) {
      const pipe = line.match(
        /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?\s*[|—-]\s*([a-zA-Z]+)\s*[|—-]\s*(.+)$/,
      );
      if (!pipe) continue;
      const ch = normalizeChannel(pipe[3] ?? "");
      if (!ch) continue;
      items.push({
        date: pipe[1]!,
        time: pipe[2] ?? "09:30",
        hook: pipe[4]!.slice(0, 90),
        copy: { [ch]: pipe[4]!.trim() },
      });
    }
  }
  return items;
}

/** Merge items that share date+time into one post with multiple channel copies. */
function mergeItems(items: ParsedPlanItem[]): ParsedPlanItem[] {
  const map = new Map<string, ParsedPlanItem>();
  for (const item of items) {
    const key = `${item.date}T${item.time}`;
    const cur = map.get(key);
    if (!cur) {
      map.set(key, { ...item, copy: { ...item.copy } });
      continue;
    }
    cur.copy = { ...cur.copy, ...item.copy };
    if (!cur.hook) cur.hook = item.hook;
  }
  return [...map.values()];
}

export function parsePlan(raw: string): ParsedPlanItem[] {
  const json = parseJsonPlan(raw);
  if (json && json.length) return mergeItems(json);
  return mergeItems(parseBlocks(raw));
}
