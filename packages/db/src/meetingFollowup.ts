/**
 * Evening brief: which meetings already happened today, and clear
 * description action lines to carry into tomorrow's commitments.
 */

export type AttendedMeetingInput = {
  id: string;
  title: string | null;
  occursAt: Date | null;
  meta: Record<string, unknown> | null;
};

/** True when the event already ended today and was not declined/cancelled. */
export function isAttendedMeeting(
  e: AttendedMeetingInput,
  now: Date,
  dayStart: Date,
  dayEnd: Date,
): boolean {
  if (!e.occursAt) return false;
  if (e.occursAt < dayStart || e.occursAt > dayEnd) return false;
  if (e.occursAt > now) return false;
  const meta = e.meta ?? {};
  if (String(meta.status ?? "") === "cancelled") return false;
  if (String(meta.selfResponseStatus ?? "").toLowerCase() === "declined") return false;
  if (meta.allDay === true) return false;
  const endIso = meta.end;
  const end =
    typeof endIso === "string" && endIso
      ? new Date(endIso)
      : new Date(e.occursAt.getTime() + 60 * 60 * 1000);
  if (Number.isNaN(end.getTime())) return false;
  return end.getTime() <= now.getTime();
}

/**
 * Pull only explicit action lines from a calendar description.
 * Quiet when the notes are free-form — no invented follow-ups.
 */
export function extractMeetingActionItems(description: string | null | undefined): string[] {
  if (!description?.trim()) return [];
  const lines = description
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\r/g, "")
    .split(/\n|;/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const out: string[] = [];
  let inActionSection = false;

  for (const raw of lines) {
    const line = raw.replace(/^[\s•\-–—*◦]+/, "").trim();
    if (!line) continue;

    if (/^action(?:\s*items?)?\s*:?\s*$/i.test(line) || /^next\s*steps?\s*:?\s*$/i.test(line)) {
      inActionSection = true;
      continue;
    }
    if (inActionSection && /^(agenda|notes|attendees|discussion|summary)\b/i.test(line)) {
      inActionSection = false;
      continue;
    }

    const checkbox = line.match(/^\[(?: |x|X)?\]\s*(.+)$/);
    if (checkbox?.[1]) {
      pushAction(out, checkbox[1]);
      continue;
    }

    const labeled = line.match(
      /^(?:action(?:\s*items?)?|todos?|follow[\s-]?ups?|next\s*steps?)\s*[:\-–]\s*(.+)$/i,
    );
    if (labeled?.[1]) {
      pushAction(out, labeled[1]);
      inActionSection = false;
      continue;
    }

    if (inActionSection && line.length >= 8) {
      pushAction(out, line);
    }
  }

  return [...new Set(out)].slice(0, 5);
}

function pushAction(out: string[], text: string): void {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 120);
  if (t.length < 8) return;
  if (/^(none|n\/a|na|tbd|nil)\.?$/i.test(t)) return;
  out.push(t);
}

/** Collapse mail vs calendar labels for the same meeting into one FOCUS slot. */
export function focusDedupeKey(label: string): string {
  return label
    .toLowerCase()
    .replace(/^overdue:\s*/i, "")
    .replace(/^\d{1,2}:\d{2}\s+/, "")
    .replace(/\s*[—–-]\s*[^—–-]+$/u, "")
    .replace(/^(re|fwd|fw):\s*/gi, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 64);
}

/** True when two FOCUS labels are the same meeting / thread under different wrappers. */
export function focusLabelsMatch(a: string, b: string): boolean {
  const ka = focusDedupeKey(a);
  const kb = focusDedupeKey(b);
  if (!ka || !kb) return false;
  if (ka === kb) return true;
  if (ka.length >= 12 && kb.length >= 12 && (ka.includes(kb) || kb.includes(ka))) {
    return true;
  }
  return false;
}

/** Stable short label for evening TODAY section. */
export function attendedMeetingLabel(
  title: string | null | undefined,
  whenHm: string,
): string {
  const t = (title ?? "Meeting").trim().slice(0, 70) || "Meeting";
  return `${whenHm} ${t}`;
}
