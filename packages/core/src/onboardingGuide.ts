/**
 * Days 2–7 training tips: milestone-gated, one per local day by default.
 * User can ask "training tip" anytime to pull the next tip the same day.
 * Pure logic — no DB or channel calls; testable in isolation.
 */

export type OnboardingState = {
  startedAt: string | null;
  /** Local YYYY-MM-DD when guide started (user TZ). */
  startedLocalDay: string | null;
  guideComplete: boolean;
  skipped: boolean;
  completedMilestones: string[];
  lastTipLocalDay: string | null;
  lastTipId: string | null;
};

/** What the user has actually done — resolved from live data, not stored. */
export type OnboardingContext = {
  googleAccountCount: number;
  hasReceivedBrief: boolean;
  hasPlaces: boolean;
  tzConfirmed: boolean;
  hasReminder: boolean;
  hasWatch: boolean;
  hasMutedPattern: boolean;
  hasContextPerson: boolean;
};

export const MILESTONE_IDS = [
  "google",
  "google_multi",
  "brief",
  "cos_move",
  "mute",
  "memory",
  "wrap",
] as const;

export type MilestoneId = (typeof MILESTONE_IDS)[number];

export interface OnboardingTip {
  milestoneId: MilestoneId;
  tipNumber: number;
  text: string;
}

export type ResolveTipOpts = {
  /** User asked for a tip — ignore same-day cap and allow from Day 1. */
  onDemand?: boolean;
};

/** Check if a milestone is already satisfied by live context. */
function isMilestoneDone(
  id: MilestoneId,
  ctx: OnboardingContext,
  completed: string[],
): boolean {
  if (completed.includes(id)) return true;
  switch (id) {
    case "google":
      return ctx.googleAccountCount >= 1;
    case "google_multi":
      return ctx.googleAccountCount >= 2;
    case "brief":
      return ctx.hasReceivedBrief;
    case "cos_move":
      return ctx.hasReminder || ctx.hasWatch;
    case "mute":
      return ctx.hasMutedPattern;
    case "memory":
      return ctx.hasContextPerson;
    case "wrap":
      return false; // always delivered once
  }
}

/** Ordered milestone sequence for a given day, branched by Google status. */
function milestoneSequenceForDay(
  dayIndex: number,
  hasGoogle: boolean,
): MilestoneId | null {
  // Day 1 = welcome (handled separately). dayIndex 2..7 here.
  switch (dayIndex) {
    case 2:
      return hasGoogle ? "google_multi" : "google";
    case 3:
      return hasGoogle ? "brief" : "cos_move";
    case 4:
      return hasGoogle ? "cos_move" : "brief";
    case 5:
      return "mute";
    case 6:
      return "memory";
    case 7:
      return "wrap";
    default:
      return null;
  }
}

/** Body copy for each milestone (no Training tip prefix). */
function tipBody(id: MilestoneId): string {
  switch (id) {
    case "google":
      return [
        "Connect Google to unlock morning briefs + mail triage:",
        "connect google personal",
      ].join("\n");
    case "google_multi":
      return [
        "Amilo can connect multiple Google accounts — triage both and flag conflicts across calendars.",
        "Add your work inbox: connect google work",
      ].join("\n");
    case "brief":
      return [
        "Morning briefs arrive automatically. Need one right now?",
        "Just type: brief",
      ].join("\n");
    case "cos_move":
      return [
        "Two things a chief of staff never drops:",
        "• remind me Friday 3pm to call the bank",
        "• waiting on Rajeev for the board deck",
      ].join("\n");
    case "mute":
      return [
        "Noisy sender cluttering your brief? Silence them:",
        "mute ICICI",
        "Or close a stale item: done 1 / drop 1",
      ].join("\n");
    case "memory":
      return [
        "I remember people and facts quietly — only when you tell me.",
        "Try: Priya is my CFO",
        "Then: about Priya",
      ].join("\n");
    case "wrap":
      return [
        "You're set. Briefs fire morning and evening.",
        "Reminders, watches, calendar, email — just talk.",
        "",
        "Type Help anytime for the full command list.",
      ].join("\n");
  }
}

function formatTrainingTip(tipNumber: number, id: MilestoneId): string {
  const body = tipBody(id);
  if (id === "wrap") {
    return [`Training tip #${tipNumber}`, "", body].join("\n");
  }
  return [
    `Training tip #${tipNumber}`,
    "",
    body,
    "",
    "Ask training tip anytime for the next one.",
  ].join("\n");
}

/** Next tip number = tips already delivered + 1. */
export function nextTrainingTipNumber(state: OnboardingState): number {
  return state.completedMilestones.length + 1;
}

/** How many local days since onboarding started (1 = first day). */
export function onboardingDayIndex(
  startedLocalDayOrIso: string,
  nowLocalDay: string,
): number {
  const startDay = startedLocalDayOrIso.includes("T")
    ? startedLocalDayOrIso.slice(0, 10)
    : startedLocalDayOrIso.slice(0, 10);
  if (startDay === nowLocalDay) return 1;
  const diff = Math.floor(
    (new Date(nowLocalDay).getTime() - new Date(startDay).getTime()) /
      (24 * 3600_000),
  );
  return Math.max(1, diff + 1);
}

function pickNextMilestone(
  dayIndex: number,
  hasGoogle: boolean,
  ctx: OnboardingContext,
  completed: string[],
): MilestoneId | null {
  // On-demand on Day 1: start from Day-2 sequence.
  const startFrom = Math.max(2, dayIndex);
  let primary = milestoneSequenceForDay(startFrom, hasGoogle);
  if (primary === "brief" && !hasGoogle) {
    primary = startFrom <= 4 ? "cos_move" : "mute";
  }
  if (primary && !isMilestoneDone(primary, ctx, completed)) {
    return primary;
  }
  for (let d = startFrom + 1; d <= 7; d++) {
    let ms = milestoneSequenceForDay(d, hasGoogle);
    if (ms === "brief" && !hasGoogle) continue;
    if (ms && !isMilestoneDone(ms, ctx, completed)) return ms;
  }
  if (!completed.includes("wrap") && !isMilestoneDone("wrap", ctx, completed)) {
    return "wrap";
  }
  return null;
}

/**
 * Resolve the next training tip (if any).
 * Default: ≤1 tip / local day, Days 2–7.
 * onDemand: ignore day cap; allow from Day 1 if user asks.
 */
export function resolveOnboardingTip(
  state: OnboardingState,
  ctx: OnboardingContext,
  localDay: string,
  opts: ResolveTipOpts = {},
): OnboardingTip | null {
  if (!state.startedAt) return null;
  if (state.guideComplete || state.skipped) return null;
  if (!opts.onDemand && state.lastTipLocalDay === localDay) return null;

  const startDay = state.startedLocalDay ?? state.startedAt.slice(0, 10);
  const dayIndex = onboardingDayIndex(startDay, localDay);
  if (!opts.onDemand && (dayIndex < 2 || dayIndex > 7)) return null;
  // On-demand after week: still allow unfinished tips.
  if (opts.onDemand && dayIndex > 7 && state.completedMilestones.includes("wrap")) {
    return null;
  }

  const hasGoogle = ctx.googleAccountCount >= 1;
  const milestoneId = pickNextMilestone(
    dayIndex,
    hasGoogle,
    ctx,
    state.completedMilestones,
  );
  if (!milestoneId) return null;

  const tipNumber = nextTrainingTipNumber(state);
  return {
    milestoneId,
    tipNumber,
    text: formatTrainingTip(tipNumber, milestoneId),
  };
}

/**
 * After delivering a tip, produce the updated onboarding state.
 * Pure — caller persists the result.
 */
export function markTipDelivered(
  state: OnboardingState,
  tip: OnboardingTip,
  localDay: string,
): OnboardingState {
  const completed = [...new Set([...state.completedMilestones, tip.milestoneId])];
  const guideComplete = tip.milestoneId === "wrap";
  return {
    ...state,
    completedMilestones: completed,
    lastTipLocalDay: localDay,
    lastTipId: tip.milestoneId,
    guideComplete,
  };
}
