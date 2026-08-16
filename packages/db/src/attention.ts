/** Attention-state + mail admission + brief cadence. No DB I/O. */

export type AttentionStatus = "open" | "parked" | "completed";

export type AttentionEntry = {
  status: AttentionStatus;
  touches: number;
  lastShownAt?: string;
  parkedAt?: string;
  completedAt?: string;
  shownInBriefAt?: string;
  deadline?: string;
  label?: string;
};

export type AttentionState = Record<string, AttentionEntry>;

export type MailAdmit = "keep" | "drop" | "borderline";

const FREE_MAILBOX = new Set([
  "gmail.com",
  "googlemail.com",
  "yahoo.com",
  "yahoo.co.in",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
]);

export function parseAttentionState(raw: unknown): AttentionState {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: AttentionState = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!k || !v || typeof v !== "object") continue;
    const o = v as Record<string, unknown>;
    const status = String(o.status ?? "open");
    if (status !== "open" && status !== "parked" && status !== "completed") continue;
    const touches = Number(o.touches);
    out[k] = {
      status,
      touches: Number.isFinite(touches) && touches > 0 ? touches : 0,
      ...(typeof o.lastShownAt === "string" && o.lastShownAt ? { lastShownAt: o.lastShownAt } : {}),
      ...(typeof o.parkedAt === "string" && o.parkedAt ? { parkedAt: o.parkedAt } : {}),
      ...(typeof o.completedAt === "string" && o.completedAt ? { completedAt: o.completedAt } : {}),
      ...(typeof o.shownInBriefAt === "string" && o.shownInBriefAt
        ? { shownInBriefAt: o.shownInBriefAt }
        : {}),
      ...(typeof o.deadline === "string" && o.deadline ? { deadline: o.deadline } : {}),
      ...(typeof o.label === "string" && o.label.trim()
        ? { label: o.label.trim().slice(0, 120) }
        : {}),
    };
  }
  return out;
}

export function trimAttentionState(state: AttentionState, cap = 80): AttentionState {
  const entries = Object.entries(state).sort((a, b) => {
    const ta = Date.parse(a[1].lastShownAt ?? a[1].completedAt ?? a[1].parkedAt ?? "0");
    const tb = Date.parse(b[1].lastShownAt ?? b[1].completedAt ?? b[1].parkedAt ?? "0");
    return tb - ta;
  });
  return Object.fromEntries(entries.slice(0, cap));
}

const FREE_NAME = /^"?([^"<]+?)"?\s*</;

/** Prefer org/display name when the mailbox is Gmail/Yahoo/etc. */
export function mailBriefOrgKey(actor: string): string {
  const email = (actor.match(/[\w.+-]+@[\w.-]+/)?.[0] ?? "").toLowerCase();
  const domain = email.includes("@") ? (email.split("@")[1] ?? "") : "";
  if (domain && !FREE_MAILBOX.has(domain)) return domain;
  const named = actor.match(FREE_NAME)?.[1]?.trim();
  const raw = (named || actor.split("@")[0] || actor).toLowerCase();
  return raw.replace(/[^a-z0-9]+/g, " ").trim().slice(0, 40) || domain || "mail";
}

export function userIsOnTo(toHeader: string | null | undefined, userEmails: string[]): boolean | null {
  const to = (toHeader ?? "").trim().toLowerCase();
  if (!to) return null;
  const emails = userEmails.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
  if (!emails.length) return null;
  return emails.some((e) => to.includes(e));
}

export function isAutomatedSender(actor: string): boolean {
  const a = actor.toLowerCase();
  return (
    /no-?reply|do-?not-?reply|donotreply|mailer-daemon|newsletter/.test(a) ||
    /\b(alerts?|notify|notification|updates|noreply|ereport|freetier)@/.test(a)
  );
}

export type CadenceOpts = {
  now: Date;
  kind: "am" | "pm";
  deadline?: Date | null;
  moneyOrKyc?: boolean;
  newMailOnThread?: boolean;
  watcherFiredToday?: boolean;
};

/** Whether this identity may occupy a FOCUS slot. */
export function shouldShowInFocus(entry: AttentionEntry | undefined, opts: CadenceOpts): boolean {
  if (opts.watcherFiredToday) return false;
  if (entry?.status === "completed" && !opts.newMailOnThread) return false;
  if (opts.newMailOnThread) return true;

  const touches = entry?.touches ?? 0;
  const parked = entry?.status === "parked";
  const deadline = opts.deadline ?? (entry?.deadline ? new Date(entry.deadline) : null);
  const msLeft = deadline && !Number.isNaN(deadline.getTime()) ? deadline.getTime() - opts.now.getTime() : null;
  const overdue = msLeft != null && msLeft < 0;
  const within48h = msLeft != null && msLeft >= 0 && msLeft <= 48 * 3600_000;
  const todayish = msLeft != null && msLeft >= 0 && msLeft <= 18 * 3600_000;

  if (overdue) {
    if (touches >= (opts.moneyOrKyc ? 2 : 1) || parked) return false;
    return true;
  }
  if (parked) return false;
  if (touches >= 2 && !within48h) return false;
  if (deadline && msLeft != null && msLeft > 7 * 86_400_000 && touches >= 1) return false;
  if (deadline && msLeft != null && msLeft > 2 * 86_400_000 && touches >= 1 && !within48h) {
    return false;
  }
  if (!deadline && touches >= 1) return false;
  if (opts.kind === "pm" && !within48h && !todayish && !deadline && touches >= 1) return false;
  return true;
}

export function markShown(
  state: AttentionState,
  id: string,
  opts: { now: Date; label?: string; deadline?: Date | null },
): AttentionState {
  const prev = state[id] ?? { status: "open" as const, touches: 0 };
  if (prev.status === "completed") return state;
  const touches = prev.touches + 1;
  const next: AttentionEntry = {
    ...prev,
    status: touches >= 2 ? "parked" : "open",
    touches,
    lastShownAt: opts.now.toISOString(),
    ...(opts.label ? { label: opts.label.slice(0, 120) } : {}),
    ...(opts.deadline ? { deadline: opts.deadline.toISOString() } : {}),
    ...(touches >= 2 ? { parkedAt: opts.now.toISOString() } : {}),
  };
  return trimAttentionState({ ...state, [id]: next });
}

export function markCompleted(
  state: AttentionState,
  id: string,
  opts: { now: Date; label?: string },
): AttentionState {
  const prev = state[id] ?? { status: "open" as const, touches: 0 };
  return trimAttentionState({
    ...state,
    [id]: {
      ...prev,
      status: "completed",
      completedAt: opts.now.toISOString(),
      ...(opts.label ? { label: opts.label.slice(0, 120) } : {}),
    },
  });
}

export function markDoneShown(state: AttentionState, ids: string[], now: Date): AttentionState {
  const next = { ...state };
  const iso = now.toISOString();
  for (const id of ids) {
    const prev = next[id];
    if (!prev || prev.status !== "completed") continue;
    next[id] = { ...prev, shownInBriefAt: iso };
  }
  return trimAttentionState(next);
}

export function reopenIfReminded(state: AttentionState, id: string): AttentionState {
  const prev = state[id];
  if (!prev || prev.status !== "completed") return state;
  const { completedAt: _c, shownInBriefAt: _s, ...rest } = prev;
  return { ...state, [id]: { ...rest, status: "open", touches: 0 } };
}

/** Completed items not yet printed on a brief, newest first. */
export function unshownCompleted(
  state: AttentionState,
  sinceIso?: string | null,
): Array<{ id: string; label: string; completedAt: string }> {
  const since = sinceIso ? Date.parse(sinceIso) : 0;
  const rows: Array<{ id: string; label: string; completedAt: string }> = [];
  for (const [id, e] of Object.entries(state)) {
    if (e.status !== "completed" || e.shownInBriefAt || !e.completedAt) continue;
    const at = Date.parse(e.completedAt);
    if (Number.isNaN(at)) continue;
    if (since && at < since) continue;
    rows.push({ id, label: e.label || id, completedAt: e.completedAt });
  }
  rows.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  return rows.slice(0, 8);
}

export function recentCompleted(
  state: AttentionState,
  limit = 12,
): Array<{ id: string; label: string; completedAt: string }> {
  const rows: Array<{ id: string; label: string; completedAt: string }> = [];
  for (const [id, e] of Object.entries(state)) {
    if (e.status !== "completed" || !e.completedAt) continue;
    rows.push({ id, label: e.label || id, completedAt: e.completedAt });
  }
  rows.sort((a, b) => Date.parse(b.completedAt) - Date.parse(a.completedAt));
  return rows.slice(0, limit);
}
