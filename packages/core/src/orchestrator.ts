import type { BrainPort, GraphUpdate } from "@amilo/brain-contract";
import type { ChannelPort, InboundMessage, OutboundMessage } from "./channel.js";
import {
  extractInviteeNames,
  isCalendarInviteIntent,
  parseForwardToCalendar,
} from "./forwardParse.js";
import {
  DELETE_MENU,
  HOW_IT_WORKS,
  STANDING_HELP,
  isAboutMeCommand,
  isClearMemoryCommand,
  isClearMemoryConfirmCommand,
  isDeleteMenuCommand,
  isDeletePendingCommand,
  isHelpCommand,
  isHowItWorksCommand,
  isStatusCommand,
  parseCommitmentCloseCommand,
  parseForgetCommand,
} from "./standingCommands.js";
import {
  isPlacesListCommand,
  parseOriginCorrection,
  parsePlaceSetCommand,
  parsePlaceSetCommands,
  extractEventLocation,
} from "./travel.js";
import {
  formatLocalHm,
  formatLocalIsoWall,
  isTimezoneAffirmative,
  parseCalendarCreateHint,
  parseHmInput,
  parseIsoDate,
  parseReminderMessage,
  parseTimezoneUpdateMessage,
  formatCalendarProposalSummary,
  timezoneFriendlyLabel,
} from "./time.js";

const STANDING: Record<string, string> = {
  help: STANDING_HELP,
  pause: "Paused. Your data stays. Send resume when you want me back.",
  resume: "Back. Watching quietly again.",
};

/** On-demand briefing intent — exact commands + natural phrasing. */
export function isBriefRequest(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/\s+/g, " ");
  if (!t) return false;
  if (t === "brief" || t === "briefing" || t === "morning" || t === "evening") return true;
  // Avoid "briefly explain…"
  if (/\bbriefly\b/.test(t)) return false;
  if (
    /\b(morning update|evening wrap|daily brief(ing)?|my brief(ing)?)\b/.test(t)
  ) {
    return true;
  }
  if (
    /\b(latest|today'?s|this morning'?s|this evening'?s)\s+(brief|briefing)\b/.test(t)
  ) {
    return true;
  }
  if (/\b(brief|briefing)\s+(please|now|today)\b/.test(t)) return true;
  if (
    /^(send|give|show|get|pull)\s+(me\s+)?(a\s+|the\s+|my\s+|latest\s+)?(brief|briefing)\b/.test(
      t,
    )
  ) {
    return true;
  }
  // Bare "brief please" / "briefing please"
  if (/^(the\s+)?(brief|briefing)(\s+please)?$/.test(t)) return true;
  return false;
}

function strPayload(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

/** Sanitize account label: personal|work|custom slug. */
export function normalizeGoogleLabel(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) return "personal";
  return s.slice(0, 40);
}

export interface OrchestratorDeps {
  brain: BrainPort;
  channel: ChannelPort;
  resolveUserName: (userId: string) => Promise<string>;
  isPaused: (userId: string) => Promise<boolean>;
  setPaused: (userId: string, paused: boolean) => Promise<void>;
  getContextGraphSummary?: (userId: string) => Promise<string>;
  /** Explicit "about me" / memory dump for the user. */
  getAboutMeSummary?: (userId: string) => Promise<string>;
  forgetContextLabel?: (
    userId: string,
    label: string,
  ) => Promise<{ deleted: boolean; label: string }>;
  clearContextMemory?: (
    userId: string,
  ) => Promise<{ nodes: number; edges: number }>;
  /** Travel places + leave-by origin correction. */
  setPlace?: (opts: {
    userId: string;
    label: string;
    address: string;
  }) => Promise<{ ok: boolean; message: string }>;
  listPlacesText?: (userId: string) => Promise<string>;
  correctTravelOrigin?: (
    userId: string,
    correctionText: string,
  ) => Promise<string>;
  resolveCommitment?: (
    userId: string,
    opts: {
      titleHint: string;
      status: "done" | "dropped" | "snoozed";
      snoozeUntil?: Date;
    },
  ) => Promise<
    | { ok: true; title: string; status: string }
    | { ok: false; reason: "none" | "ambiguous"; matches: string[] }
  >;
  /** Open commitments text for status. */
  getOpenCommitmentsSummary?: (userId: string) => Promise<string>;
  /** Recent WhatsApp turns for multi-turn continuity. */
  getRecentChatSummary?: (
    userId: string,
    opts?: { excludeMessageId?: string },
  ) => Promise<string>;
  applyGraphUpdates?: (opts: {
    userId: string;
    userName: string;
    message: string;
    updates: GraphUpdate[];
    sourceMessageId?: string;
  }) => Promise<void>;
  /** Google OAuth + sync hooks (M4 multi-account). */
  getGoogleAuthUrl?: (userId: string, label: string) => Promise<string | null>;
  listGoogleAccounts?: (
    userId: string,
  ) => Promise<Array<{ label: string; email: string | null }>>;
  disconnectGoogle?: (
    userId: string,
    label: string | "all",
  ) => Promise<{ deleted: number; labels: string[] }>;
  syncGoogle?: (userId: string) => Promise<{
    mail: number;
    skippedPromo: number;
    skippedMuted: number;
    calendar: number;
    accounts: number;
  }>;
  isGoogleConnected?: (userId: string) => Promise<boolean>;
  getBriefingContext?: (userId: string) => Promise<{
    openCommitmentsSummary: string;
    calendarToday: string;
    recentMail: string;
    timezone: string;
    ignoredPatterns: string[];
    vipList: string[];
  }>;
  /** Build curated brief + store 1/2/3 detail items. */
  buildPriorityBrief?: (
    userId: string,
    kind?: "am" | "pm",
  ) => Promise<{
    digestText: string;
    items: Array<{ index: number; label: string; detail: string }>;
    calendarCount: number;
    commitmentCount: number;
  }>;
  getLastBriefItems?: (userId: string) => Promise<{
    items: Array<{ index: number; label: string; detail: string }>;
    more: string | null;
  }>;
  /** Approved WABA template names for briefings (channel-blind names). */
  briefingTemplates?: {
    morning: string;
    evening: string;
    languageCode: string;
  };
  addMutedPattern?: (userId: string, pattern: string) => Promise<string[]>;
  removeMutedPattern?: (userId: string, pattern: string) => Promise<string[]>;
  listMutedPatterns?: (userId: string) => Promise<string[]>;
  /** Timezone + reminders. */
  getTimezoneState?: (userId: string) => Promise<{
    timezone: string;
    tzConfirmed: boolean;
  }>;
  setTimezone?: (
    userId: string,
    timezone: string,
    confirmed: boolean,
  ) => Promise<void>;
  confirmTimezone?: (userId: string) => Promise<void>;
  createReminders?: (
    userId: string,
    items: Array<{ title: string; dueAt: Date }>,
  ) => Promise<Array<{ title: string; dueAt: Date }>>;
  getBriefSchedule?: (userId: string) => Promise<{
    enabled: boolean;
    morningHm: string;
    eveningHm: string;
    quietStartHm: string;
    quietEndHm: string;
    timezone: string;
  }>;
  setBriefsEnabled?: (userId: string, enabled: boolean) => Promise<void>;
  setBriefSlot?: (
    userId: string,
    slot: "morning" | "evening",
    hm: string,
  ) => Promise<void>;
  setQuietHours?: (
    userId: string,
    startHm: string,
    endHm: string,
  ) => Promise<void>;
  /** Confirm-before-write (M5). */
  getOpenPending?: (userId: string) => Promise<{
    id: string;
    kind: string;
    summary: string;
    payload: Record<string, unknown>;
  } | null>;
  /** Resolve Google calendar event id from synced events (cancel/update). */
  resolveCalendarEvent?: (
    userId: string,
    opts: {
      timezone: string;
      titleHint?: string;
      aroundHm?: string;
      hintText?: string;
    },
  ) => Promise<
    Array<{
      eventId: string;
      title: string;
      occursAt: Date | null;
      accountLabel: string;
      startIso: string | null;
      endIso: string | null;
    }>
  >;
  /** Overlap check + next free slot for calendar_create proposals. */
  checkCalendarConflict?: (
    userId: string,
    opts: { startIso: string; endIso: string; timezone: string },
  ) => Promise<{
    clear: boolean;
    conflictNote: string | null;
    suggested: { startIso: string; endIso: string } | null;
    conflictTitle: string | null;
  }>;
  /** Resolve stored person email by name (context graph + seeds). */
  resolveContactEmail?: (
    userId: string,
    nameHint: string,
  ) => Promise<{ label: string; email: string } | null>;
  /** Persist person email when learned from drafts / edits. */
  rememberContactEmail?: (
    userId: string,
    opts: { label: string; email: string },
  ) => Promise<void>;
  createPending?: (opts: {
    userId: string;
    kind: string;
    summary: string;
    payload: Record<string, unknown>;
  }) => Promise<{ id: string; kind: string; summary: string }>;
  confirmPending?: (userId: string) => Promise<{ ok: boolean; message: string }>;
  rejectPending?: (userId: string) => Promise<{ ok: boolean; message: string }>;
  editPending?: (
    userId: string,
    patch: Record<string, unknown>,
    summary?: string,
  ) => Promise<{ ok: boolean; message: string }>;
  logEval?: (userId: string, note: string) => Promise<void>;
}

function extractMutePatternFromMessage(message: string): string | null {
  const m = message.trim().match(
    /^(?:please\s+)?(?:mute|ignore|hide|don't show|do not show)\s+(.+?)(?:\s+emails?)?$/i,
  );
  if (!m?.[1]) return null;
  return m[1].replace(/^(the\s+|all\s+)/i, "").trim();
}

/** True when the user is starting a new action, not answering the open proposal. */
export function looksLikeNewActionIntent(
  message: string,
  timeZone: string,
  now: Date = new Date(),
): boolean {
  const t = message.trim();
  if (!t || t.length < 4) return false;
  if (/^(yes|y|yeah|yep|ok|okay|confirm|cancel|no|nope|edit)\b/i.test(t)) return false;
  if (isBriefRequest(t)) return true;
  if (
    /^(mute|unmute|sync|google|help|commands|pause|resume|briefs|status|pending|open|delete|forget|memory|about|done|drop|snooze|places|home|office)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    isHelpCommand(t) ||
    isStatusCommand(t) ||
    isAboutMeCommand(t) ||
    isHowItWorksCommand(t) ||
    parseCommitmentCloseCommand(t) ||
    parsePlaceSetCommands(t).length > 0 ||
    isPlacesListCommand(t)
  ) {
    return true;
  }
  if (extractMutePatternFromMessage(t)) return true;
  if (parseCalendarCreateHint(t, timeZone, now)) return true;
  if (parseForwardToCalendar(t, timeZone, now)) return true;
  if (isCalendarInviteIntent(t)) return true;
  if (parseReminderMessage(t, timeZone, now).length > 0) return true;
  if (/\b(send|draft)\b/i.test(t) && /\b(email|mail|invite)\b/i.test(t)) return true;
  if (/\bcalendar invite\b/i.test(t)) return true;
  if (/\binvite\b/i.test(t) && /@|\bspeedstar\b|\brajeev\b|\brajiv\b/i.test(t)) return true;
  return false;
}

function normalizeAttendeeEmail(raw: string): string {
  let to = raw.toLowerCase().trim();
  to = to.replace(/@speedstart\.ai$/i, "@speedstar.ai");
  if (/@speedstar\.ai$/i.test(to) && /^(rajiv|rajeev)@/i.test(to)) {
    to = "rajeev@speedstar.ai";
  }
  return to;
}

async function resolveAttendeesFromMessage(
  userId: string,
  message: string,
  deps: OrchestratorDeps,
  existing?: unknown,
): Promise<string[]> {
  const out = new Set<string>();
  if (Array.isArray(existing)) {
    for (const a of existing) {
      const e = normalizeAttendeeEmail(String(a));
      if (e.includes("@")) out.add(e);
    }
  } else if (typeof existing === "string" && existing.includes("@")) {
    out.add(normalizeAttendeeEmail(existing));
  }
  const emailInText = message.match(/\b([\w.+-]+@[\w.-]+\.\w+)\b/);
  if (emailInText?.[1]) out.add(normalizeAttendeeEmail(emailInText[1]));

  if (deps.resolveContactEmail) {
    for (const name of extractInviteeNames(message)) {
      const hit = await deps.resolveContactEmail(userId, name);
      if (hit?.email) out.add(normalizeAttendeeEmail(hit.email));
    }
  }
  // Known shorthand when name extract missed but message clearly targets Rajeev.
  if (!out.size && /\braj(ee|i)v\b/i.test(message) && deps.resolveContactEmail) {
    const hit = await deps.resolveContactEmail(userId, "Rajeev");
    if (hit?.email) out.add(normalizeAttendeeEmail(hit.email));
  }
  return [...out];
}

async function proposeCalendarCreatePending(
  msg: InboundMessage,
  deps: OrchestratorDeps,
  timeZone: string,
  payloadIn: Record<string, unknown>,
): Promise<OutboundMessage[]> {
  if (!deps.createPending) {
    return [{ text: "Calendar proposals aren't wired yet." }];
  }
  const payload: Record<string, unknown> = {
    accountLabel: "personal",
    ...payloadIn,
  };
  if (!payload.accountLabel) payload.accountLabel = "personal";

  let conflictNote: string | null = null;
  if (deps.checkCalendarConflict) {
    const startIso = String(payload.start ?? payload.startIso ?? "").trim();
    const endIso = String(payload.end ?? payload.endIso ?? "").trim();
    if (startIso && endIso) {
      try {
        const conflict = await deps.checkCalendarConflict(msg.userId, {
          startIso,
          endIso,
          timezone: timeZone,
        });
        conflictNote = conflict.conflictNote;
        if (!conflict.clear && conflict.suggested) {
          payload.start = conflict.suggested.startIso;
          payload.end = conflict.suggested.endIso;
          payload.startIso = conflict.suggested.startIso;
          payload.endIso = conflict.suggested.endIso;
          payload.conflictAdjusted = true;
          payload.originalStart = startIso;
          payload.originalEnd = endIso;
          if (conflict.conflictTitle) payload.conflictWith = conflict.conflictTitle;
        } else if (!conflict.clear) {
          payload.conflictWarning = true;
          if (conflict.conflictTitle) payload.conflictWith = conflict.conflictTitle;
        }
      } catch (err) {
        console.error(
          JSON.stringify({
            event: "calendar_conflict_check_failed",
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      }
    }
  }

  const attendees = Array.isArray(payload.attendees)
    ? payload.attendees.map((a) => String(a))
    : [];
  const summary = formatCalendarProposalSummary({
    kind: "calendar_create",
    title: String(payload.title ?? "event"),
    startIso: String(payload.start ?? payload.startIso ?? ""),
    endIso: String(payload.end ?? payload.endIso ?? ""),
    timeZone,
    attendees,
  });
  const pending = await deps.createPending({
    userId: msg.userId,
    kind: "calendar_create",
    summary,
    payload,
  });
  return [
    {
      text: [
        ...(conflictNote ? [conflictNote, ""] : []),
        `Proposed (${pending.kind}):`,
        pending.summary,
        "",
        "Reply yes to write to Google Calendar, cancel to drop.",
      ].join("\n"),
    },
  ];
}

/** Apply "edit …" patches to a pending payload (email to/subject, calendar title). */
export function applyPendingEditPatch(
  kind: string,
  payload: Record<string, unknown>,
  patchRaw: string,
): { payload: Record<string, unknown>; summaryHint: string } {
  let raw = patchRaw.trim().replace(/^<|>$/g, "").trim();
  const next = { ...payload };

  // Bare email or "to: email"
  const emailMatch =
    raw.match(/\bto\s*[:=]?\s*([\w.+-]+@[\w.-]+\.\w+)\b/i) ||
    raw.match(/\b([\w.+-]+@[\w.-]+\.\w+)\b/);
  if (emailMatch?.[1] && (kind === "email_draft" || /email|invite/i.test(kind))) {
    let to = emailMatch[1].toLowerCase();
    to = to.replace(/@speedstart\.ai$/i, "@speedstar.ai");
    if (/@speedstar\.ai$/i.test(to) && /^(rajiv|rajeev)@/i.test(to)) {
      to = "rajeev@speedstar.ai";
    }
    next.to = to;
    raw = raw.replace(emailMatch[0], "").trim();
  }

  const subjectMatch = raw.match(/\bsubject\s*[:=]\s*(.+)$/i);
  if (subjectMatch?.[1] && kind === "email_draft") {
    next.subject = subjectMatch[1].trim();
    raw = raw.replace(subjectMatch[0], "").trim();
  }

  const titleMatch = raw.match(/\btitle\s*[:=]\s*(.+)$/i);
  if (titleMatch?.[1] && kind.startsWith("calendar_")) {
    next.title = titleMatch[1].trim();
    raw = raw.replace(titleMatch[0], "").trim();
  }

  // Leftover free text on email drafts → body tweak note
  if (raw && kind === "email_draft" && !emailMatch && !subjectMatch) {
    if (/@/.test(raw)) {
      /* already handled */
    } else if (!next.to && /^[\w.+-]+@[\w.-]+\.\w+$/.test(raw)) {
      next.to = raw;
    } else {
      next.note = raw;
    }
  }

  const summaryHint =
    kind === "email_draft"
      ? `Email draft to ${String(next.to ?? "?")}: ${String(next.subject ?? "draft")}`
      : kind.startsWith("calendar_")
        ? `Create: ${String(next.title ?? "Event")}`
        : String(next.summary ?? "Updated proposal");

  return { payload: next, summaryHint };
}

function buildStructuredBrief(opts: {
  headline?: string;
  calendarToday: string;
  recentMail: string;
  openCommitmentsSummary: string;
  mutedCountHint?: string;
}): string {
  const lines: string[] = [];
  if (opts.headline?.trim()) lines.push(opts.headline.trim(), "");
  lines.push("CALENDAR");
  lines.push(opts.calendarToday === "none yet" ? "• none today" : opts.calendarToday);
  lines.push("");
  lines.push("MAIL");
  lines.push(opts.recentMail === "none yet" ? "• none needing you" : opts.recentMail);
  if (opts.openCommitmentsSummary && opts.openCommitmentsSummary !== "none yet") {
    lines.push("");
    lines.push("COMMITMENTS");
    lines.push(opts.openCommitmentsSummary);
  }
  if (opts.mutedCountHint) {
    lines.push("");
    lines.push(opts.mutedCountHint);
  }
  return lines.join("\n").trim();
}

function tzConfirmPrompt(timezone: string): string {
  const label = timezoneFriendlyLabel(timezone);
  return [
    `I guessed your local time as ${label} (${timezone}) from your phone number.`,
    "Reply yes to keep it, or say where you are (e.g. Dubai / I'm in London).",
    "You can change anytime when travelling.",
  ].join("\n");
}

async function scheduleRemindersReply(
  userId: string,
  timezone: string,
  items: Array<{ title: string; dueAt: Date }>,
  deps: OrchestratorDeps,
): Promise<OutboundMessage[]> {
  if (!deps.createReminders) {
    return [{ text: "Reminders aren't wired yet." }];
  }
  const saved = await deps.createReminders(userId, items);
  const lines = saved.map(
    (r) => `• ${formatLocalHm(r.dueAt, timezone)} — ${r.title}`,
  );
  return [
    {
      text: [
        saved.length === 1 ? "Reminder set:" : `${saved.length} reminders set:`,
        ...lines,
        `(${timezoneFriendlyLabel(timezone)})`,
      ].join("\n"),
    },
  ];
}

/**
 * Thin orchestrator — standing commands bypass the brain;
 * everything else goes through BrainPort. No channel-specific types here.
 */
export async function handleInbound(
  msg: InboundMessage,
  deps: OrchestratorDeps,
): Promise<OutboundMessage[]> {
  const text = msg.content.trim();
  const lower = text.toLowerCase();

  if (isHelpCommand(text)) {
    return [{ text: STANDING.help! }];
  }
  if (isHowItWorksCommand(text)) {
    return [{ text: HOW_IT_WORKS }];
  }
  if (lower === "pause") {
    await deps.setPaused(msg.userId, true);
    return [{ text: STANDING.pause! }];
  }
  if (lower === "resume") {
    await deps.setPaused(msg.userId, false);
    return [{ text: STANDING.resume! }];
  }
  if (await deps.isPaused(msg.userId)) {
    return [{ text: "I'm paused. Send resume to continue." }];
  }

  // Brief follow-ups: 1 / 2 / 3 / M (must not go to the LLM).
  if (/^[123]$/.test(lower) || lower === "m") {
    if (deps.getLastBriefItems) {
      const stored = await deps.getLastBriefItems(msg.userId);
      if (lower === "m") {
        if (stored.more?.trim()) {
          return [
            {
              text: ["More from your brief:", stored.more, "", "Reply 1–3 for a top item."].join(
                "\n",
              ),
            },
          ];
        }
        return [{ text: "Nothing more queued from the last brief." }];
      }
      const item = stored.items.find((i) => i.index === Number(lower));
      if (item) {
        return [{ text: `${item.index}) ${item.label}\n\n${item.detail}` }];
      }
      if (!stored.items.length) {
        return [{ text: "No brief items stored yet — send brief (or wait for the morning update)." }];
      }
      return [
        {
          text: `No item ${lower} in the last brief. Available: ${stored.items
            .map((i) => i.index)
            .join(", ")}.`,
        },
      ];
    }
  }

  // --- Pending confirm-before-write (prefer over timezone yes) ---
  const tzForPending = deps.getTimezoneState
    ? await deps.getTimezoneState(msg.userId)
    : { timezone: "Asia/Kolkata", tzConfirmed: true };

  const openPending = deps.getOpenPending
    ? await deps.getOpenPending(msg.userId)
    : null;

  if (openPending && deps.confirmPending && deps.rejectPending) {
    const isCancelKind = openPending.kind === "calendar_cancel";
    const affirm = isCancelKind
      ? /^(yes|y|yeah|yep|ok|okay|confirm|do it|go ahead|approved?|cancel( it| this| now)?)$/i.test(
          lower,
        )
      : /^(yes|y|yeah|yep|ok|okay|confirm|do it|go ahead|approved?)$/i.test(lower);
    const reject = isCancelKind
      ? /^(no|nope|keep( it)?|never ?mind|abort|drop|don't|dont)$/i.test(lower)
      : /^(cancel|no|nope|reject|don't|dont|never ?mind|abort)$/i.test(lower);

    if (affirm) {
      const r = await deps.confirmPending(msg.userId);
      return [{ text: r.ok ? r.message : `Couldn't complete: ${r.message}` }];
    }
    if (reject) {
      const r = await deps.rejectPending(msg.userId);
      return [
        {
          text: isCancelKind
            ? r.message?.replace(/^Cancelled/, "Kept") || "Kept — event not cancelled."
            : r.message || "Cancelled — nothing written.",
        },
      ];
    }
    const editMatch = text.match(/^edit\s+(.+)$/i);
    if (editMatch?.[1] && deps.editPending) {
      const patchRaw = editMatch[1].trim();
      const applied = applyPendingEditPatch(openPending.kind, {}, patchRaw);
      const r = await deps.editPending(msg.userId, applied.payload, applied.summaryHint);
      return [
        {
          text: r.ok
            ? `Updated proposal:\n${r.message}\n\n${
                isCancelKind
                  ? "Reply yes to cancel it on Google, or no to keep it."
                  : "Reply yes to confirm, cancel to drop."
              }`
            : r.message,
        },
      ];
    }
    // New clear intent supersedes the stuck proposal (LifeOS-style).
    // Status / memory / delete commands inspect state without dropping the proposal.
    const inspectOnly =
      isStatusCommand(text) ||
      isAboutMeCommand(text) ||
      isDeleteMenuCommand(text) ||
      isDeletePendingCommand(text) ||
      isClearMemoryCommand(text) ||
      isClearMemoryConfirmCommand(text) ||
      Boolean(parseForgetCommand(text)) ||
      Boolean(parsePlaceSetCommands(text).length) ||
      isPlacesListCommand(text) ||
      Boolean(parseOriginCorrection(text)) ||
      Boolean(parseCommitmentCloseCommand(text));
    if (inspectOnly) {
      // fall through
    } else if (looksLikeNewActionIntent(text, tzForPending.timezone)) {
      await deps.rejectPending(msg.userId);
      // fall through to normal routing
    } else {
      return [
        {
          text: [
            `Pending: ${openPending.summary}`,
            isCancelKind
              ? "Reply yes to cancel it on Google, or no to keep it."
              : "Reply yes to confirm, cancel to drop, or edit <change>.",
          ].join("\n"),
        },
      ];
    }
  }

  // --- Timezone confirm / update (before other chat) ---
  const tzState = tzForPending;

  // --- Standing discovery commands ---
  if (isStatusCommand(text)) {
    const lines: string[] = ["STATUS"];
    const pending = deps.getOpenPending
      ? await deps.getOpenPending(msg.userId)
      : openPending;
    if (pending) {
      lines.push(`Pending: ${pending.summary}`, "Reply yes to confirm, cancel to drop.");
    } else {
      lines.push("Pending: none");
    }
    if (deps.getOpenCommitmentsSummary) {
      const open = await deps.getOpenCommitmentsSummary(msg.userId);
      lines.push("", "OPEN", open === "none yet" ? "• none" : open);
    }
    if (deps.listGoogleAccounts) {
      const accounts = await deps.listGoogleAccounts(msg.userId);
      lines.push(
        "",
        "GOOGLE",
        accounts.length
          ? accounts.map((a) => `• ${a.label}: ${a.email ?? "(pending)"}`).join("\n")
          : '• none — connect google personal',
      );
    }
    if (deps.getTimezoneState) {
      lines.push("", `Timezone: ${timezoneFriendlyLabel(tzState.timezone)}`);
    }
    lines.push("", "Send help for all commands.");
    return [{ text: lines.join("\n") }];
  }

  if (isAboutMeCommand(text)) {
    if (!deps.getAboutMeSummary) {
      return [{ text: "Memory listing isn't wired yet." }];
    }
    const about = await deps.getAboutMeSummary(msg.userId);
    return [{ text: about }];
  }

  if (isDeletePendingCommand(text)) {
    if (!deps.rejectPending) {
      return [{ text: "Nothing to delete — pending isn't wired." }];
    }
    const pending = deps.getOpenPending
      ? await deps.getOpenPending(msg.userId)
      : openPending;
    if (!pending) {
      return [{ text: "No open proposal to delete." }];
    }
    const r = await deps.rejectPending(msg.userId);
    return [{ text: r.message || "Dropped — nothing written." }];
  }

  const forgetLabel = parseForgetCommand(text);
  if (forgetLabel) {
    if (!deps.forgetContextLabel) {
      return [{ text: "Forget isn't wired yet." }];
    }
    const r = await deps.forgetContextLabel(msg.userId, forgetLabel);
    return [
      {
        text: r.deleted
          ? `Forgot “${r.label}”.`
          : `Nothing stored as “${forgetLabel}”. Send about me to see what's saved.`,
      },
    ];
  }

  if (isClearMemoryConfirmCommand(text)) {
    if (!deps.clearContextMemory) {
      return [{ text: "Clear memory isn't wired yet." }];
    }
    const r = await deps.clearContextMemory(msg.userId);
    return [
      {
        text: `Cleared learned context (${r.nodes} facts, ${r.edges} links). Google + reminders kept.`,
      },
    ];
  }

  if (isClearMemoryCommand(text)) {
    return [
      {
        text: "This wipes learned people/facts (not Google or reminders). Reply clear memory yes to confirm.",
      },
    ];
  }

  if (isDeleteMenuCommand(text)) {
    return [{ text: DELETE_MENU }];
  }

  const placeSets = parsePlaceSetCommands(text);
  if (placeSets.length && deps.setPlace) {
    const lines: string[] = [];
    for (const placeSet of placeSets) {
      const r = await deps.setPlace({
        userId: msg.userId,
        label: placeSet.label,
        address: placeSet.address,
      });
      lines.push(r.message);
    }
    return [{ text: lines.join("\n") }];
  }
  if (placeSets.length && !deps.setPlace) {
    return [{ text: "Places aren't wired yet (need Google Maps key)." }];
  }

  if (isPlacesListCommand(text)) {
    if (!deps.listPlacesText) {
      return [{ text: "Places aren't wired yet." }];
    }
    return [{ text: await deps.listPlacesText(msg.userId) }];
  }

  const originCorrection = parseOriginCorrection(text);
  if (originCorrection && deps.correctTravelOrigin) {
    const reply = await deps.correctTravelOrigin(msg.userId, originCorrection);
    return [{ text: reply }];
  }

  const closeCmd = parseCommitmentCloseCommand(text);
  if (closeCmd && deps.resolveCommitment) {
    let snoozeUntil: Date | undefined;
    if (closeCmd.status === "snoozed" && closeCmd.snoozeRaw) {
      const hint = parseCalendarCreateHint(
        `book meeting ${closeCmd.snoozeRaw} at 9am`,
        tzState.timezone,
      );
      snoozeUntil = hint
        ? new Date(hint.startIso)
        : new Date(Date.now() + 24 * 3600_000);
    }
    const r = await deps.resolveCommitment(msg.userId, {
      titleHint: closeCmd.titleHint,
      status: closeCmd.status,
      ...(snoozeUntil ? { snoozeUntil } : {}),
    });
    if (r.ok) {
      const verb =
        r.status === "done" ? "Done" : r.status === "dropped" ? "Dropped" : "Snoozed";
      return [{ text: `${verb}: ${r.title}` }];
    }
    if (r.reason === "ambiguous") {
      return [
        {
          text: [
            "Which one?",
            ...r.matches.map((m) => `• ${m}`),
            "",
            "Reply done <exact title> or drop <exact title>.",
          ].join("\n"),
        },
      ];
    }
    return [{ text: `No open commitment matching “${closeCmd.titleHint}”. Send status to list.` }];
  }

  if (deps.setTimezone) {
    const tzUpdate = parseTimezoneUpdateMessage(text);
    if (tzUpdate) {
      await deps.setTimezone(msg.userId, tzUpdate, true);
      return [
        {
          text: `Timezone set to ${timezoneFriendlyLabel(tzUpdate)} (${tzUpdate}). Briefs and reminders use this.`,
        },
      ];
    }
  }

  if (
    deps.getTimezoneState &&
    deps.confirmTimezone &&
    !tzState.tzConfirmed &&
    isTimezoneAffirmative(text) &&
    !openPending
  ) {
    await deps.confirmTimezone(msg.userId);
    return [
      {
        text: `Locked in — ${timezoneFriendlyLabel(tzState.timezone)}. Change anytime with “I'm in Dubai” or timezone <place>.`,
      },
    ];
  }

  if (lower === "timezone" || lower === "tz" || lower === "time zone") {
    const label = timezoneFriendlyLabel(tzState.timezone);
    const confirm = tzState.tzConfirmed
      ? ""
      : "\nNot confirmed yet — reply yes, or say where you are.";
    return [
      {
        text: `Your timezone: ${label} (${tzState.timezone}).${confirm}\nTravel tip: “I'm in Dubai” or timezone Asia/Dubai`,
      },
    ];
  }

  const evalMatch = text.match(/^eval\s+log\s+(.+)$/i);
  if (evalMatch?.[1] && deps.logEval) {
    await deps.logEval(msg.userId, evalMatch[1].trim());
    return [{ text: "Logged for A/B eval." }];
  }

  // --- Scheduled briefs prefs ---
  if (deps.getBriefSchedule) {
    if (lower === "briefs" || lower === "brief schedule") {
      const s = await deps.getBriefSchedule(msg.userId);
      return [
        {
          text: [
            `Scheduled briefs: ${s.enabled ? "on" : "off"}`,
            `Morning ${s.morningHm} · Evening ${s.eveningHm} (${timezoneFriendlyLabel(s.timezone)})`,
            `Quiet hours ${s.quietStartHm}–${s.quietEndHm}`,
            "",
            "briefs on | briefs off",
            "brief morning 7:30 | brief evening 8pm",
            "quiet hours 22:00-07:00",
          ].join("\n"),
        },
      ];
    }
    if (lower === "briefs on" || lower === "briefs enable") {
      if (!deps.setBriefsEnabled) return [{ text: "Brief schedule isn't wired yet." }];
      await deps.setBriefsEnabled(msg.userId, true);
      return [{ text: "Scheduled morning/evening briefs are on." }];
    }
    if (lower === "briefs off" || lower === "briefs disable") {
      if (!deps.setBriefsEnabled) return [{ text: "Brief schedule isn't wired yet." }];
      await deps.setBriefsEnabled(msg.userId, false);
      return [{ text: "Scheduled briefs off. On-demand brief still works." }];
    }

    const slotMatch = text.match(/^brief\s+(morning|evening)\s+(.+)$/i);
    if (slotMatch?.[1] && slotMatch[2] && deps.setBriefSlot) {
      const hm = parseHmInput(slotMatch[2]);
      if (!hm) {
        return [{ text: "Couldn't parse that time. Try: brief morning 7:30" }];
      }
      const slot = slotMatch[1].toLowerCase() as "morning" | "evening";
      await deps.setBriefSlot(msg.userId, slot, hm);
      return [{ text: `${slot[0]!.toUpperCase()}${slot.slice(1)} brief set to ${hm} local time.` }];
    }

    const quietMatch = text.match(
      /^quiet\s+hours\s+(\S+)\s*(?:-|–|—|to)\s*(\S+)$/i,
    );
    if (quietMatch?.[1] && quietMatch[2] && deps.setQuietHours) {
      const startHm = parseHmInput(quietMatch[1]);
      const endHm = parseHmInput(quietMatch[2]);
      if (!startHm || !endHm) {
        return [{ text: "Couldn't parse quiet hours. Try: quiet hours 22:00-07:00" }];
      }
      await deps.setQuietHours(msg.userId, startHm, endHm);
      return [{ text: `Quiet hours set to ${startHm}–${endHm} local.` }];
    }
  }

  if (lower === "hi" || lower === "hello" || lower === "/start") {
    const name = await deps.resolveUserName(msg.userId);
    const lines = [
      `Hi${name ? ` ${name}` : ""} — I'm Amilo, your chief of staff.`,
      "",
      "I watch inbox + calendar, surface only what needs you,",
      "and confirm before any Google write.",
      "",
      "Start: connect google personal",
      "Then try: brief · status · about me · help",
    ];
    if (deps.getTimezoneState && !tzState.tzConfirmed) {
      lines.push("", tzConfirmPrompt(tzState.timezone));
    }
    return [{ text: lines.join("\n") }];
  }

  // Unconfirmed TZ: nudge once on first non-trivial message if they never said hi.
  if (
    deps.getTimezoneState &&
    !tzState.tzConfirmed &&
    !isTimezoneAffirmative(text) &&
    !parseTimezoneUpdateMessage(text) &&
    /remind|brief|sync|connect/i.test(text) === false &&
    text.length < 40
  ) {
    /* fall through — don't block short chat */
  }

  // --- Reminders (standing parse; reliable local times) ---
  const reminderSpecs = parseReminderMessage(text, tzState.timezone);
  if (reminderSpecs.length && deps.createReminders) {
    if (!tzState.tzConfirmed && deps.getTimezoneState) {
      const saved = await scheduleRemindersReply(
        msg.userId,
        tzState.timezone,
        reminderSpecs,
        deps,
      );
      return [
        ...saved,
        { text: tzConfirmPrompt(tzState.timezone) },
      ];
    }
    return scheduleRemindersReply(msg.userId, tzState.timezone, reminderSpecs, deps);
  }

  if (lower === "google" || lower === "google accounts" || lower === "list google") {
    if (!deps.listGoogleAccounts) {
      return [{ text: "Google listing isn't wired yet." }];
    }
    const accounts = await deps.listGoogleAccounts(msg.userId);
    if (!accounts.length) {
      return [
        {
          text: 'No Google accounts linked. Try: connect google personal\nThen: connect google work',
        },
      ];
    }
    return [
      {
        text: [
          "Linked Google accounts:",
          ...accounts.map((a) => `- ${a.label}: ${a.email ?? "(pending)"}`),
          "",
          'Add another: connect google <label>',
          "Remove one: disconnect google <label>",
        ].join("\n"),
      },
    ];
  }

  const connectMatch = lower.match(
    /^(?:connect google|connect gmail|reconnect google|reconnect gmail)(?:\s+(\S+))?$/,
  );
  if (connectMatch) {
    if (!deps.getGoogleAuthUrl) {
      return [{ text: "Google connect isn't configured on this server yet." }];
    }
    let label = connectMatch[1] ? normalizeGoogleLabel(connectMatch[1]) : "";
    if (!label) {
      const existing = deps.listGoogleAccounts
        ? await deps.listGoogleAccounts(msg.userId)
        : [];
      if (existing.some((a) => a.label === "personal")) {
        return [
          {
            text: [
              "You already have a personal Google link.",
              "Add another with a label, e.g.:",
              "  connect google work",
              "  connect google speedstar",
              "",
              'See linked accounts: google',
            ].join("\n"),
          },
        ];
      }
      label = "personal";
    }
    const url = await deps.getGoogleAuthUrl(msg.userId, label);
    if (!url) {
      return [
        {
          text: "Google OAuth isn't configured (missing client id/secret or encryption key).",
        },
      ];
    }
    return [
      {
        text: [
          `Tap to connect Gmail + Calendar as “${label}” (read-only for now):`,
          "",
          url,
          "",
          "Pick the right Google account in the browser. After connect, send sync or brief.",
          "Add more later with: connect google <other-label>",
        ].join("\n"),
      },
    ];
  }

  const disconnectMatch = lower.match(
    /^(?:disconnect google|disconnect gmail)(?:\s+(\S+))?$/,
  );
  if (disconnectMatch) {
    if (!deps.disconnectGoogle || !deps.listGoogleAccounts) {
      return [{ text: "Google disconnect isn't wired yet." }];
    }
    const arg = disconnectMatch[1];
    const accounts = await deps.listGoogleAccounts(msg.userId);
    if (!accounts.length) {
      return [{ text: "No Google account linked on Amilo WhatsApp." }];
    }
    if (!arg) {
      if (accounts.length === 1) {
        const only = accounts[0]!;
        const r = await deps.disconnectGoogle(msg.userId, only.label);
        return [
          {
            text: `Disconnected ${r.labels.join(", ") || only.label}. Telegram LifeOS is untouched.`,
          },
        ];
      }
      return [
        {
          text: [
            "Multiple accounts linked — say which:",
            ...accounts.map((a) => `- disconnect google ${a.label}  (${a.email ?? "?"})`),
            "- disconnect google all",
          ].join("\n"),
        },
      ];
    }
    if (arg === "all") {
      const r = await deps.disconnectGoogle(msg.userId, "all");
      return [
        {
          text: r.deleted
            ? `Disconnected ${r.deleted} account(s): ${r.labels.join(", ")}. Telegram LifeOS untouched.`
            : "No Google accounts to disconnect.",
        },
      ];
    }
    const label = normalizeGoogleLabel(arg);
    const r = await deps.disconnectGoogle(msg.userId, label);
    return [
      {
        text: r.deleted
          ? `Disconnected “${label}”. Telegram LifeOS untouched.`
          : `No account labeled “${label}”. Send: google`,
      },
    ];
  }

  if (lower === "mutes" || lower === "muted" || lower === "list mutes") {
    if (!deps.listMutedPatterns) {
      return [{ text: "Mute list isn't wired yet." }];
    }
    const list = await deps.listMutedPatterns(msg.userId);
    if (!list.length) {
      return [{ text: 'Nothing muted. Example: mute Credit Generation' }];
    }
    return [{ text: ["Muted phrases:", ...list.map((p) => `• ${p}`)].join("\n") }];
  }

  const unmuteMatch = text.match(/^unmute\s+(.+)$/i);
  if (unmuteMatch?.[1] && deps.removeMutedPattern) {
    const next = await deps.removeMutedPattern(msg.userId, unmuteMatch[1].trim());
    return [
      {
        text: next.length
          ? `Unmuted. Still muted:\n${next.map((p) => `• ${p}`).join("\n")}`
          : "Unmuted. Mute list is empty.",
      },
    ];
  }

  const muteStanding = text.match(/^mute\s+(.+)$/i);
  if (muteStanding?.[1] && deps.addMutedPattern) {
    const pattern = muteStanding[1].replace(/\s+emails?$/i, "").trim();
    const next = await deps.addMutedPattern(msg.userId, pattern);
    return [
      {
        text: [
          `Muted “${pattern}” — matching mail is hidden from sync/brief (including already synced).`,
          `Mute list: ${next.join(", ")}`,
          "Send brief to see the cleaned digest.",
        ].join("\n"),
      },
    ];
  }

  if (lower === "sync") {
    if (!deps.syncGoogle) {
      return [{ text: "Sync isn't wired yet." }];
    }
    try {
      const r = await deps.syncGoogle(msg.userId);
      return [
        {
          text: [
            `Synced ${r.accounts} account(s) — ${r.mail} mail kept, ${r.skippedPromo} promo filtered, ${r.skippedMuted} muted, ${r.calendar} calendar today.`,
            "Send brief for a digest.",
          ].join(" "),
        },
      ];
    } catch (err) {
      return [{ text: err instanceof Error ? err.message : String(err) }];
    }
  }

  // On-demand brief — same curated path for exact + natural phrasing.
  if (isBriefRequest(text)) {
    if (!deps.isGoogleConnected || !deps.getBriefingContext || !deps.syncGoogle) {
      return [{ text: "Briefings need Google sync — send: connect google personal" }];
    }
    const connected = await deps.isGoogleConnected(msg.userId);
    if (!connected) {
      return [{ text: "Google isn't connected. Send: connect google personal" }];
    }
    let skippedMuted = 0;
    let skippedPromo = 0;
    try {
      const syncResult = await deps.syncGoogle(msg.userId);
      skippedMuted = syncResult.skippedMuted;
      skippedPromo = syncResult.skippedPromo;
    } catch (err) {
      return [
        {
          text: `Sync failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ];
    }
    const name = await deps.resolveUserName(msg.userId);
    const kind =
      lower === "evening" || /\bevening\b/i.test(text) ? "pm" : "am";

    if (deps.buildPriorityBrief) {
      const brief = await deps.buildPriorityBrief(msg.userId, kind);
      const firstName = (name || "there").split(/\s+/)[0] || "there";
      const headline =
        kind === "pm"
          ? brief.calendarCount > 0
            ? `Evening wrap — ${brief.calendarCount} tomorrow`
            : brief.items.length > 0
              ? `Evening wrap — ${brief.items.length} still open`
              : `Evening wrap — ${firstName}`
          : brief.calendarCount > 0
            ? `Morning brief — ${brief.calendarCount} on calendar`
            : brief.items.length > 0
              ? `Morning brief — ${brief.items.length} priorit${brief.items.length === 1 ? "y" : "ies"}`
              : `Morning brief — clear calendar`;
      const quietBits = [
        skippedPromo ? `${skippedPromo} promo` : "",
        skippedMuted ? `${skippedMuted} muted` : "",
      ].filter(Boolean);
      const footer = quietBits.length ? `\nFiltered quietly: ${quietBits.join(", ")}.` : "";
      const textOut = `${headline}\n\n${brief.digestText}${footer}`.slice(0, 3500);
      return [{ text: textOut || "Nothing urgent — you're clear." }];
    }

    const ctx = await deps.getBriefingContext(msg.userId);
    let headline = kind === "pm" ? "Evening wrap" : "Morning priorities";
    try {
      const draft = await deps.brain.brief(
        {
          userId: msg.userId,
          name: name || "there",
          timezone: ctx.timezone,
          vipList: ctx.vipList,
          ignoredPatterns: ctx.ignoredPatterns,
          openCommitmentsSummary: ctx.openCommitmentsSummary,
          calendarToday: ctx.calendarToday,
          contextGraphSummary: deps.getContextGraphSummary
            ? await deps.getContextGraphSummary(msg.userId)
            : "none yet",
        },
        kind,
      );
      if (draft.headline?.trim()) headline = draft.headline.trim();
    } catch {
      /* structured body still works without Grok headline */
    }

    const quietBits = [
      skippedPromo ? `${skippedPromo} promo` : "",
      skippedMuted ? `${skippedMuted} muted` : "",
    ].filter(Boolean);
    const footer: string[] = [];
    if (quietBits.length) footer.push(`Filtered quietly: ${quietBits.join(", ")}.`);
    if (ctx.ignoredPatterns.length) footer.push(`Mutes: ${ctx.ignoredPatterns.join(", ")}`);

    const textOut = buildStructuredBrief({
      headline,
      calendarToday: ctx.calendarToday,
      recentMail: ctx.recentMail,
      openCommitmentsSummary: ctx.openCommitmentsSummary,
      ...(footer.length ? { mutedCountHint: footer.join("\n") } : {}),
    }).slice(0, 3500);

    return [{ text: textOut || "Nothing urgent — you're clear." }];
  }

  const name = await deps.resolveUserName(msg.userId);
  const contextGraphSummary = deps.getContextGraphSummary
    ? await deps.getContextGraphSummary(msg.userId)
    : "none yet";
  const recentChatSummary = deps.getRecentChatSummary
    ? await deps.getRecentChatSummary(msg.userId, {
        ...(msg.messageId ? { excludeMessageId: msg.messageId } : {}),
      })
    : undefined;
  const replyToSummary = msg.replyToContent
    ? `${msg.replyToDirection === "in" ? "User" : "Amilo"}: ${msg.replyToContent}`
    : msg.replyToMessageId
      ? "(user replied to a prior WhatsApp message we could not resolve from message_log)"
      : undefined;
  const briefCtx = deps.getBriefingContext
    ? await deps.getBriefingContext(msg.userId)
    : {
        openCommitmentsSummary: "none yet",
        calendarToday: "none yet",
        recentMail: "none yet",
        timezone: tzState.timezone,
        ignoredPatterns: [] as string[],
        vipList: [] as string[],
      };

  // Natural-language mute even if phrased conversationally (brain may only "say" muted).
  const nlMute = extractMutePatternFromMessage(text);
  if (nlMute && deps.addMutedPattern) {
    const next = await deps.addMutedPattern(msg.userId, nlMute);
    return [
      {
        text: [
          `Muted “${nlMute}” — matching mail is hidden from sync/brief.`,
          `Mute list: ${next.join(", ")}`,
          "Send sync then brief to refresh.",
        ].join("\n"),
      },
    ];
  }

  // Appointment / travel forwards → one confirm for calendar (skip soft "add to calendar?" chat).
  if (deps.createPending) {
    const forward = parseForwardToCalendar(text, briefCtx.timezone);
    if (forward) {
      return proposeCalendarCreatePending(msg, deps, briefCtx.timezone, {
        title: forward.title,
        start: forward.startIso,
        end: forward.endIso,
        startIso: forward.startIso,
        endIso: forward.endIso,
        ...(forward.description ? { description: forward.description } : {}),
        source: forward.source,
      });
    }
  }

  // Calendar invite by name — resolve stored email, propose calendar_create (not email draft).
  if (deps.createPending && isCalendarInviteIntent(text)) {
    const hint = parseCalendarCreateHint(text, briefCtx.timezone);
    if (hint) {
      const attendees = await resolveAttendeesFromMessage(msg.userId, text, deps);
      if (!attendees.length) {
        const names = extractInviteeNames(text);
        return [
          {
            text: names.length
              ? `I don't have an email for ${names.join(", ")} yet. Say e.g. invite ${names[0]} <email@domain> for that slot.`
              : "Who should I invite? Include a name I know, or an email address.",
          },
        ];
      }
      for (const email of attendees) {
        if (deps.rememberContactEmail) {
          const label =
            extractInviteeNames(text)[0] ??
            (email.startsWith("rajeev@") ? "Rajeev" : email.split("@")[0] ?? "Contact");
          await deps.rememberContactEmail(msg.userId, { label, email });
        }
      }
      const withName = extractInviteeNames(text)[0];
      const title =
        hint.title && !/^(busy|event|meeting)$/i.test(hint.title)
          ? hint.title
          : withName
            ? `Meeting with ${withName}`
            : "Meeting";
      return proposeCalendarCreatePending(msg, deps, briefCtx.timezone, {
        title,
        start: hint.startIso,
        end: hint.endIso,
        startIso: hint.startIso,
        endIso: hint.endIso,
        attendees,
      });
    }
  }

  const result = await deps.brain.interpret(
    {
      userId: msg.userId,
      name: name || "there",
      timezone: briefCtx.timezone,
      vipList: briefCtx.vipList,
      ignoredPatterns: briefCtx.ignoredPatterns,
      openCommitmentsSummary: briefCtx.openCommitmentsSummary,
      calendarToday: briefCtx.calendarToday,
      contextGraphSummary,
      ...(recentChatSummary ? { recentChatSummary } : {}),
      ...(replyToSummary ? { replyToSummary } : {}),
    },
    text,
  );

  if (deps.applyGraphUpdates && result.graphUpdates?.length) {
    await deps.applyGraphUpdates({
      userId: msg.userId,
      userName: name || "user",
      message: text,
      updates: result.graphUpdates,
      ...(msg.messageId ? { sourceMessageId: msg.messageId } : {}),
    });
  }

  // Persist mute from structured intents / preference graph nodes.
  if (deps.addMutedPattern) {
    let mutePattern: string | null = null;
    if (
      result.intent.type === "propose_action" &&
      String(result.intent.action.type ?? "").toLowerCase() === "mute"
    ) {
      mutePattern = String(
        result.intent.action.pattern ?? result.intent.action.phrase ?? "",
      ).trim();
    }
    if (!mutePattern && result.graphUpdates?.length) {
      for (const u of result.graphUpdates) {
        if (u.op !== "upsert_node" || u.kind !== "preference") continue;
        const attrs = u.attrs ?? {};
        if (attrs.mute === true || attrs.muted === true || attrs.action === "mute") {
          mutePattern = String(attrs.pattern ?? u.label).trim();
          break;
        }
      }
    }
    if (mutePattern) {
      const next = await deps.addMutedPattern(msg.userId, mutePattern);
      return [
        {
          text: [
            `Muted “${mutePattern}” — matching mail is hidden from sync/brief.`,
            `Mute list: ${next.join(", ")}`,
            "Send sync then brief to refresh.",
          ].join("\n"),
        },
      ];
    }
  }

  // Brain-proposed reminder (fallback if standing parse missed).
  if (
    result.intent.type === "propose_action" &&
    deps.createReminders &&
    /remind/i.test(String(result.intent.action.type ?? ""))
  ) {
    const action = result.intent.action;
    const dueIso = String(action.dueAt ?? action.at ?? "").trim();
    const title = String(action.title ?? action.summary ?? result.intent.summary ?? "Reminder").trim();
    let dueAt: Date | null = dueIso ? new Date(dueIso) : null;
    if (!dueAt || Number.isNaN(dueAt.getTime())) {
      const fromText = parseReminderMessage(text, briefCtx.timezone);
      if (fromText.length) {
        return scheduleRemindersReply(msg.userId, briefCtx.timezone, fromText, deps);
      }
    } else {
      return scheduleRemindersReply(
        msg.userId,
        briefCtx.timezone,
        [{ title, dueAt }],
        deps,
      );
    }
  }

  // Confirm-before-write proposals (calendar / email draft).
  if (result.intent.type === "propose_action" && deps.createPending) {
    const action = result.intent.action;
    const type = String(action.type ?? "").toLowerCase();
    const writeKinds = new Set([
      "calendar_create",
      "calendar_update",
      "calendar_cancel",
      "email_draft",
      "create_event",
      "update_event",
      "cancel_event",
      "send_email",
      "email",
      "draft_email",
    ]);
    if (writeKinds.has(type)) {
      let kind = type;
      if (type === "create_event") kind = "calendar_create";
      if (type === "update_event") kind = "calendar_update";
      if (type === "cancel_event") kind = "calendar_cancel";
      if (type === "send_email" || type === "email" || type === "draft_email") {
        kind = "email_draft";
      }

      const payload: Record<string, unknown> = { ...action };
      delete payload.type;
      if (!payload.accountLabel) payload.accountLabel = "personal";

      // Calendar invite phrased as email → real calendar create with attendees.
      if (kind === "email_draft" && isCalendarInviteIntent(text)) {
        const calHint = parseCalendarCreateHint(text, briefCtx.timezone);
        if (calHint || payload.start || payload.startIso) {
          kind = "calendar_create";
          if (calHint) {
            payload.title = calHint.title;
            payload.start = calHint.startIso;
            payload.end = calHint.endIso;
            payload.startIso = calHint.startIso;
            payload.endIso = calHint.endIso;
          }
          const invitees = await resolveAttendeesFromMessage(
            msg.userId,
            text,
            deps,
            payload.to ?? payload.attendees,
          );
          if (invitees.length) payload.attendees = invitees;
          delete payload.to;
          delete payload.subject;
          delete payload.body;
          delete payload.body_draft;
        }
      }

      // Normalize known contact / ASR typos on email drafts.
      if (kind === "email_draft") {
        const toRaw = strPayload(payload.to);
        if (toRaw) {
          payload.to = normalizeAttendeeEmail(toRaw);
        } else if (/\brajeev\b|\brajiv\b/i.test(text)) {
          const hit = deps.resolveContactEmail
            ? await deps.resolveContactEmail(msg.userId, "Rajeev")
            : { email: "rajeev@speedstar.ai", label: "Rajeev" };
          if (hit?.email) payload.to = hit.email;
        }
        if (strPayload(payload.to) && deps.rememberContactEmail) {
          const names = extractInviteeNames(text);
          await deps.rememberContactEmail(msg.userId, {
            label: names[0] ?? "Contact",
            email: strPayload(payload.to),
          });
        }
      }

      // Prefer local parse of the user message over model ISO (avoids wrong year/raw stamps).
      if (kind === "calendar_create") {
        const hint = parseCalendarCreateHint(text, briefCtx.timezone);
        if (hint) {
          payload.title = hint.title;
          payload.start = hint.startIso;
          payload.end = hint.endIso;
          payload.startIso = hint.startIso;
          payload.endIso = hint.endIso;
        }
        const loc = extractEventLocation(text);
        if (loc && !strPayload(payload.location)) payload.location = loc;
        const attendees = await resolveAttendeesFromMessage(
          msg.userId,
          text,
          deps,
          payload.attendees,
        );
        if (attendees.length) {
          payload.attendees = attendees;
          for (const email of attendees) {
            if (deps.rememberContactEmail) {
              const label =
                extractInviteeNames(text)[0] ??
                (email.startsWith("rajeev@") ? "Rajeev" : email.split("@")[0] ?? "Contact");
              await deps.rememberContactEmail(msg.userId, { label, email });
            }
          }
        }
      }

      let conflictNote: string | null = null;
      if (kind === "calendar_create" && deps.checkCalendarConflict) {
        const startIso = strPayload(payload.start) || strPayload(payload.startIso);
        const endIso = strPayload(payload.end) || strPayload(payload.endIso);
        if (startIso && endIso) {
          try {
            const conflict = await deps.checkCalendarConflict(msg.userId, {
              startIso,
              endIso,
              timezone: briefCtx.timezone,
            });
            conflictNote = conflict.conflictNote;
            if (!conflict.clear && conflict.suggested) {
              payload.start = conflict.suggested.startIso;
              payload.end = conflict.suggested.endIso;
              payload.startIso = conflict.suggested.startIso;
              payload.endIso = conflict.suggested.endIso;
              payload.conflictAdjusted = true;
              payload.originalStart = startIso;
              payload.originalEnd = endIso;
              if (conflict.conflictTitle) payload.conflictWith = conflict.conflictTitle;
            } else if (!conflict.clear) {
              payload.conflictWarning = true;
              if (conflict.conflictTitle) payload.conflictWith = conflict.conflictTitle;
            }
          } catch (err) {
            console.error(
              JSON.stringify({
                event: "calendar_conflict_check_failed",
                error: err instanceof Error ? err.message : String(err),
              }),
            );
          }
        }
      }

      // Resolve Google event id for cancel/update from synced calendar rows.
      if (
        (kind === "calendar_cancel" || kind === "calendar_update") &&
        !strPayload(payload.eventId) &&
        deps.resolveCalendarEvent
      ) {
        let titleHint = strPayload(payload.title) || undefined;
        if (!titleHint && kind === "calendar_cancel") {
          const cleaned = text
            .replace(
              /^(please\s+)?(cancel|delete|remove|drop)\s+(the\s+|my\s+|this\s+)?/i,
              "",
            )
            .replace(
              /\b(tomorrow'?s?|tomorow'?s?|tommorow'?s?|today'?s?|from\s+(?:the\s+)?calendar|on\s+(?:the\s+)?calendar)\b/gi,
              "",
            )
            .replace(/\s+/g, " ")
            .trim();
          if (cleaned.length >= 3) titleHint = cleaned;
        }
        const hintText = [text, msg.replyToContent, replyToSummary]
          .filter(Boolean)
          .join("\n");
        const matches = await deps.resolveCalendarEvent(msg.userId, {
          timezone: briefCtx.timezone,
          ...(titleHint ? { titleHint } : {}),
          hintText,
        });
        if (matches.length === 1) {
          const m = matches[0]!;
          payload.eventId = m.eventId;
          payload.title = m.title;
          if (m.startIso) {
            payload.start = m.startIso;
            payload.startIso = m.startIso;
          }
          if (m.endIso) {
            payload.end = m.endIso;
            payload.endIso = m.endIso;
          }
          if (m.accountLabel) payload.accountLabel = m.accountLabel;
        } else if (matches.length === 0) {
          return [
            {
              text: [
                "Couldn't match that to a synced calendar event.",
                "Send sync, then name the event (and time if needed), or reply to the brief line.",
              ].join("\n"),
            },
          ];
        } else {
          const lines = matches.slice(0, 5).map((m) => {
            const when = m.occursAt
              ? formatLocalHm(m.occursAt, briefCtx.timezone)
              : "?";
            return `• ${when} ${m.title}`;
          });
          return [
            {
              text: ["Which event?", ...lines, "", "Reply with the title (or time + title)."].join(
                "\n",
              ),
            },
          ];
        }
      }

      if (
        (kind === "calendar_cancel" || kind === "calendar_update") &&
        !strPayload(payload.eventId)
      ) {
        return [
          {
            text: "I need a specific event for that — reply to it in the brief, or say the title and time.",
          },
        ];
      }

      let summary: string;
      if (kind === "email_draft") {
        summary = `Email draft to ${String(payload.to ?? action.to ?? "?")}: ${String(payload.subject ?? action.subject ?? "(no subject)")}`;
      } else if (kind.startsWith("calendar_")) {
        const attendees = Array.isArray(payload.attendees)
          ? payload.attendees.map((a) => String(a))
          : [];
        summary = formatCalendarProposalSummary({
          kind,
          title: String(payload.title ?? action.title ?? "event"),
          startIso: String(payload.start ?? payload.startIso ?? action.start ?? action.startIso ?? ""),
          endIso: String(payload.end ?? payload.endIso ?? action.end ?? action.endIso ?? ""),
          timeZone: briefCtx.timezone,
          attendees,
        });
      } else {
        summary =
          result.intent.summary?.trim() ||
          String(action.summary ?? "").trim() ||
          "Proposed action";
      }

      const pending = await deps.createPending({
        userId: msg.userId,
        kind,
        summary,
        payload,
      });

      if (kind === "email_draft") {
        const body = String(action.body ?? action.body_draft ?? "").trim();
        const draftLines = [
          action.to ? `To: ${String(action.to)}` : null,
          action.subject ? `Subject: ${String(action.subject)}` : null,
          body || "(empty body)",
        ].filter(Boolean);
        return [
          {
            text: [
              "Email ready to send.",
              "Reply yes to send via Gmail, cancel to drop, or edit <change>.",
            ].join("\n"),
          },
          { text: draftLines.join("\n") },
        ];
      }

      if (kind === "calendar_cancel") {
        return [
          {
            text: [
              `Proposed cancel:`,
              pending.summary,
              "",
              "Reply yes to remove it from Google Calendar, or no to keep it.",
            ].join("\n"),
          },
        ];
      }

      return [
        {
          text: [
            ...(conflictNote ? [conflictNote, ""] : []),
            `Proposed (${pending.kind}):`,
            pending.summary,
            "",
            "Reply yes to write to Google Calendar, cancel to drop.",
          ].join("\n"),
        },
      ];
    }
  }

  switch (result.intent.type) {
    case "reply_text": {
      const reply = result.intent.text.trim();
      if (reply) return [{ text: reply }];
      return [
        {
          text: result.graphUpdates?.length
            ? "Got it."
            : "Got it — say more if you want me to act on that.",
        },
      ];
    }
    case "noop":
      return [
        {
          text: result.graphUpdates?.length
            ? "Got it."
            : "Got it — say more if you want me to act on that.",
        },
      ];
    case "propose_action":
      return [{ text: `Noted — ${result.intent.summary || "I'll hold that for now."}` }];
    default:
      return [
        {
          text: "Got it — that action type lands in a later milestone. For now try help.",
        },
      ];
  }
}
