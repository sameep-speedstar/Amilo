/** Pure helpers for CoS watch evaluation (unit-tested). */

export const WATCHER_DAILY_CAP = 2;
export const COMMITMENT_STALL_LEAD_MS = 4 * 3600_000;

export function emailMatchesWatch(
  watchEmail: string | null | undefined,
  actor: string | null | undefined,
  metaFrom?: string | null,
): boolean {
  const email = (watchEmail ?? "").trim().toLowerCase();
  if (!email.includes("@")) return false;
  const a = (actor ?? "").toLowerCase();
  const f = (metaFrom ?? "").toLowerCase();
  return a.includes(email) || f.includes(email) || a === email;
}

export function isCommitmentStallDue(
  dueAt: Date | null | undefined,
  now: Date,
  leadMs: number = COMMITMENT_STALL_LEAD_MS,
): boolean {
  if (!dueAt) return false;
  return dueAt.getTime() <= now.getTime() + leadMs;
}

export function buildAwaitingReplyAlert(opts: {
  personLabel: string;
  mailTitle: string | null;
}): string {
  const who = opts.personLabel.trim() || "They";
  const title = (opts.mailTitle ?? "new mail").trim().slice(0, 120);
  return `${who} replied — ${title}. Chase or mark done?`;
}

export function buildCommitmentStallAlert(opts: {
  title: string;
  personLabel?: string | null;
}): string {
  const who = opts.personLabel?.trim();
  const base = `Due soon: ${opts.title.trim().slice(0, 160)}`;
  return who ? `${base} (waiting on ${who}). Chase or done?` : `${base}. Chase or done?`;
}

export function underWatcherDailyCap(alertsSentToday: number, cap = WATCHER_DAILY_CAP): boolean {
  return alertsSentToday < cap;
}
