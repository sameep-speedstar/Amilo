import { flattenWaTemplateParam } from "./time.js";

/** True when Meta template uses static bullet lines + one var per focus slot. */
export function isStructuredBriefTemplate(templateName: string): boolean {
  const n = templateName.trim().toLowerCase();
  return n.endsWith("_v2") || n.includes("_bullets") || n.endsWith("_focus");
}

export function padFocusTemplateSlots(
  items: Array<{ label: string }>,
  slots = 3,
  maxLen = 200,
): string[] {
  const out = items
    .slice(0, slots)
    .map((i) => flattenWaTemplateParam(i.label, maxLen));
  while (out.length < slots) out.push("—");
  return out;
}

/** One-line calendar / today summary for a single WABA body variable. */
export function flattenBriefLineList(lines: string[], empty = "—", max = 280): string {
  if (!lines.length) return empty;
  const joined = lines
    .slice(0, 4)
    .map((l) => l.replace(/^•\s*/, "").trim())
    .filter(Boolean)
    .join(" · ");
  const extra = lines.length > 4 ? ` (+${lines.length - 4})` : "";
  return flattenWaTemplateParam(`${joined}${extra}`, max);
}

/**
 * Morning `morning_update_v2` vars:
 * 1 name · 2 date · 3–5 focus · 6 footer (quieter / calendar / —)
 */
export function morningBriefTemplateVarsV2(opts: {
  name: string;
  dateLong: string;
  items: Array<{ label: string }>;
  quieterCount: number;
  calendarLines: string[];
}): string[] {
  const focus = padFocusTemplateSlots(opts.items);
  let footer = "—";
  if (opts.quieterCount > 0) {
    footer = `${opts.quieterCount} quieter yesterday. Reply M for more.`;
  } else if (opts.calendarLines.length) {
    footer = `Today: ${flattenBriefLineList(opts.calendarLines, "", 200)}`;
  }
  return [
    flattenWaTemplateParam(opts.name, 60),
    flattenWaTemplateParam(opts.dateLong, 80),
    ...focus,
    flattenWaTemplateParam(footer, 280),
  ];
}

/**
 * Evening `evening_wrap_v2` vars:
 * 1 name · 2 today · 3 tomorrow · 4–6 still-open focus
 */
export function eveningBriefTemplateVarsV2(opts: {
  name: string;
  todayLines: string[];
  calendarLines: string[];
  items: Array<{ label: string }>;
}): string[] {
  return [
    flattenWaTemplateParam(opts.name, 60),
    flattenBriefLineList(opts.todayLines),
    flattenBriefLineList(opts.calendarLines),
    ...padFocusTemplateSlots(opts.items),
  ];
}
