import type { BrainPort, GraphUpdate } from "@amilo/brain-contract";
import type { ChannelPort, InboundMessage, OutboundMessage } from "./channel.js";
import type { OnboardingState } from "./onboardingGuide.js";
import {
  composeEmailDraft,
  emailDraftIntro,
  emailDraftNeedsRewrite,
  formatEmailDraftCopy,
  isDraftOnlyPayload,
  isPersistableContactLabel,
  cleanPersonLabel,
  isSendDraftAsk,
  isShowDraftAsk,
  parseBareEmail,
  parseEmailComposeAsk,
  polishEmailDraftPayload,
  rewriteSpokenEmailDirections,
  pickGmailSendAccount,
  isEmailRewriteDirection,
  looksLikeAppointmentNotify,
  extractPlaceAddressFromChat,
  cleanAppointmentVenue,
  composeAppointmentReminder,
  latestEmailToHintFromChat,
  type EmailComposeAsk,
} from "./emailDraft.js";
import {
  extractInviteeNames,
  isCalendarInviteIntent,
  parseForwardToCalendar,
} from "./forwardParse.js";
import {
  classifyVendorHandoffKind,
  cleanBookVenueName,
  resolveActiveDomain,
  extractLifeOpsDiningContext,
  formatMoneyCapNote,
  formatLifeOpsOptionLines,
  sanitizeLifeOpsReplyText,
  isBookPlatformOnly,
  isVendorBookOrReserveAsk,
  isWhenPartyFollowUp,
  isWeakLifeOpsHandoffSummary,
  looksLikeCalendarBookingAsk,
  vendorBookingUnavailableReply,
  latestDiningThread,
  preferLifeOpsNumberPick,
  optionPickSource,
  classifyOptionListKind,
  coerceOptionPick,
  mergeLifeOpsIntoCalendarText,
  lifeOpsCalendarInheritance,
  parseInboxErrandDraftAsk,
  parseLifeOpsHandoffIntent,
  parseLifeOpsOptionPick,
  parseLifeOpsResearchIntent,
  parseMoneyCapInr,
  parseCabProvider,
  resolveListedOptionVenue,
  resolveListedOptionMapsUrl,
  diningPickAckReply,
  isDiningCalendarBlockAffirm,
  shortMapsSearchUrl,
  looksLikeMovieTicketAsk,
  isPoisonContextVenue,
  isLifeOpsResearchShortlist,
  scopeRecentChatForResearch,
  type LifeOpsResearchIntent,
} from "./lifeOps.js";
import {
  looksLikeFactualMarketText,
  outboundTextsFromReply,
  sanitizeFactualReplyText,
} from "./factualGuard.js";
import {
  DELETE_MENU,
  HOW_IT_WORKS,
  STANDING_HELP,
  WHAT_I_DO,
  welcomeMessages,
  isAboutMeCommand,
  isCapabilitiesCommand,
  isClearMemoryCommand,
  isClearMemoryConfirmCommand,
  isDeleteMenuCommand,
  isDeletePendingCommand,
  isGreetingCommand,
  isSkipOnboardingCommand,
  parseDisplayNameReply,
  parseVipCommand,
  isTrainingTipCommand,
  isHelpCommand,
  isHowItWorksCommand,
  isStatusCommand,
  isCompletedListCommand,
  isHandledListCommand,
  parseAboutPersonCommand,
  parseCancelWatchCommand,
  parseCommitmentCloseCommand,
  parseForgetCommand,
  parseScheduleDayQuery,
  parseWaitingOnCommand,
  isGoogleListCommand,
  parseConnectGoogleCommand,
  parseConnectUberCommand,
  parseUberBookAsk,
  parseDisconnectGoogleCommand,
  parseSyncCommand,
  parseMailLookup,
  parseMailLookbackDays,
  isLookbackOnlyMessage,
  parseWaitingForMail,
  formatMailWorkingSet,
  isMailWorkingSetFresh,
  looksLikeInventedMailMiss,
  mailLookupFromChatSummary,
  mailSearchTokens,
  isBareAffirmative,
  pendingMailSearchFromChat,
  briefNumberListTarget,
  type MailWorkingSet,
  type MailWorkingHit,
} from "./standingCommands.js";
import {
  isPlacesListCommand,
  parseOriginCorrection,
  parsePlaceSetCommand,
  parsePlaceSetCommands,
  extractEventLocation,
  extractMapsShareUrl,
  refersToSharedPlace,
} from "./travel.js";
import {
  formatLocalHm,
  formatLocalIsoWall,
  formatLocalWhenFriendly,
  formatLocalDateLong,
  isTimezoneAffirmative,
  isReminderAsk,
  localDayBoundsUtc,
  parseCalendarCreateHint,
  mergeCalendarFollowUp,
  isAddToTheirCalendarAsk,
  latestCalendarHintLineFromChat,
  parseHmInput,
  parseIsoDate,
  parseReminderMessage,
  parseTimezoneUpdateMessage,
  formatCalendarProposalSummary,
  timezoneFriendlyLabel,
  type ReminderKind,
  type ReminderSpec,
} from "./time.js";
import {
  formatScheduleAck,
  holdUntilIsoForHm,
  matchScheduleLabel,
  parseScheduleAttrs,
  parseScheduleIntent,
} from "./schedules.js";

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
  if (/^summarize\s+(my\s+)?(emails?|mail|inbox)\b/.test(t)) return true;
  if (/^(email|mail)\s+summary$/.test(t)) return true;
  return false;
}

function strPayload(v: unknown): string {
  return v == null ? "" : String(v).trim();
}

function titleCaseScheduleHint(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase())
    .slice(0, 80);
}

/** Sanitize account label: personal|work|custom slug. */
export function normalizeGoogleLabel(raw: string): string {
  const s = raw.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!s) return "personal";
  return s.slice(0, 40);
}

function formatGoogleAccountLines(
  accounts: Array<{ label: string; email: string | null }>,
): string[] {
  return accounts.map((a) => `- ${a.label}: ${a.email ?? "(pending)"}`);
}

async function replyGoogleList(
  userId: string,
  deps: OrchestratorDeps,
): Promise<OutboundMessage[]> {
  if (!deps.listGoogleAccounts) {
    return [{ text: "Google listing isn't wired yet." }];
  }
  const accounts = await deps.listGoogleAccounts(userId);
  if (!accounts.length) {
    return [
      {
        text: "No Google accounts linked. Try: connect google personal\nThen: connect google work",
      },
    ];
  }
  return [
    {
      text: [
        "Linked Google accounts:",
        ...formatGoogleAccountLines(accounts),
        "",
        "Add another: connect google <label>",
        "Remove one: disconnect google <label>",
      ].join("\n"),
    },
  ];
}

async function replyDisconnectGoogle(
  userId: string,
  rawLabel: string | "all" | null,
  deps: OrchestratorDeps,
): Promise<OutboundMessage[]> {
  if (!deps.disconnectGoogle || !deps.listGoogleAccounts) {
    return [{ text: "Google disconnect isn't wired yet." }];
  }
  const accounts = await deps.listGoogleAccounts(userId);
  if (!accounts.length) {
    return [{ text: "No Google account linked on Amilo WhatsApp." }];
  }
  if (rawLabel == null) {
    if (accounts.length === 1) {
      return replyDisconnectGoogle(userId, accounts[0]!.label, deps);
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
  if (rawLabel === "all") {
    const r = await deps.disconnectGoogle(userId, "all");
    return [
      {
        text: r.deleted
          ? `Disconnected ${r.deleted} account(s): ${r.labels.join(", ")}. None left on Amilo. Telegram LifeOS untouched.`
          : "No Google accounts to disconnect.",
      },
    ];
  }
  const label = normalizeGoogleLabel(rawLabel);
  const r = await deps.disconnectGoogle(userId, label);
  const left = await deps.listGoogleAccounts(userId);
  if (!r.deleted) {
    return [
      {
        text: [
          `No account labeled “${label}”.`,
          left.length
            ? `Still linked:\n${formatGoogleAccountLines(left).join("\n")}`
            : "No Google accounts linked.",
        ].join("\n"),
      },
    ];
  }
  return [
    {
      text: [
        `Disconnected “${label}”. Telegram LifeOS untouched.`,
        left.length
          ? `Still linked:\n${formatGoogleAccountLines(left).join("\n")}`
          : "No Google accounts left on Amilo.",
      ].join("\n"),
    },
  ];
}

async function replySyncGoogle(
  userId: string,
  label: string | undefined,
  deps: OrchestratorDeps,
): Promise<OutboundMessage[]> {
  if (!deps.syncGoogle) {
    return [{ text: "Sync isn't wired yet." }];
  }
  try {
    const r = await deps.syncGoogle(userId, label ? { label } : undefined);
    const scope = label ? ` “${normalizeGoogleLabel(label)}”` : ` ${r.accounts} account(s)`;
    return [
      {
        text: [
          `Synced${scope} — ${r.mail} mail kept, ${r.skippedPromo} promo filtered, ${r.skippedMuted} muted, ${r.calendar} calendar today.`,
          "Send brief for a digest, or ask about a sender/subject.",
        ].join(" "),
      },
    ];
  } catch (err) {
    return [{ text: err instanceof Error ? err.message : String(err) }];
  }
}

function hitsToWorkingSet(
  query: string,
  lookbackDays: number,
  hits: Array<{
    from: string;
    to?: string;
    subject: string;
    snippet: string;
    date?: string;
    eventId?: string;
  }>,
): MailWorkingSet {
  return {
    query,
    lookbackDays,
    savedAt: new Date().toISOString(),
    hits: hits.slice(0, 5).map((h) => {
      const row: MailWorkingHit = {
        from: h.from,
        subject: h.subject,
        snippet: h.snippet,
      };
      if (h.to) row.to = h.to;
      if (h.date) row.date = h.date;
      if (h.eventId) row.eventId = h.eventId;
      return row;
    }),
  };
}

async function prepareMailFind(
  userId: string,
  opts: { query: string; lookbackDays: number },
  deps: OrchestratorDeps,
): Promise<{ hits: MailWorkingHit[]; early?: OutboundMessage[] }> {
  if (!deps.searchMail) {
    return {
      hits: [],
      early: [
        {
          text: "Mail search isn't wired yet. Send sync then brief — I only list what was synced.",
        },
      ],
    };
  }
  const r = await deps.searchMail(userId, opts);
  if (!r.connected) {
    return {
      hits: [],
      early: [{ text: "Google isn't connected. Send: connect google personal" }],
    };
  }
  const set = hitsToWorkingSet(opts.query, opts.lookbackDays, r.hits);
  if (deps.setMailWorkingSet) await deps.setMailWorkingSet(userId, set);
  if (!r.hits.length) {
    return {
      hits: [],
      early: [
        {
          text: `No mail matching “${opts.query}” in the last ${opts.lookbackDays} days.`,
        },
      ],
    };
  }
  return { hits: set.hits };
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
  getAboutPersonSummary?: (userId: string, nameHint: string) => Promise<string>;
  forgetContextLabel?: (
    userId: string,
    label: string,
  ) => Promise<{ deleted: boolean; label: string }>;
  forgetContextAttr?: (
    userId: string,
    label: string,
    attr: string,
  ) => Promise<{ ok: boolean; label: string; attr: string; reason?: string }>;
  clearContextMemory?: (
    userId: string,
  ) => Promise<{ nodes: number; edges: number }>;
  /** waiting on <person> for <thing> → commitment + watch. */
  createWaitingOnWatch?: (
    userId: string,
    opts: { person: string; thing: string },
  ) => Promise<{ ok: boolean; message: string }>;
  cancelWatchByHint?: (
    userId: string,
    hint: string,
  ) => Promise<{ cancelled: number; titles: string[] }>;
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
  /** Schedule memory (protected windows — not Google). */
  listScheduleNodes?: (
    userId: string,
  ) => Promise<Array<{ label: string; attrs: Record<string, unknown> }>>;
  upsertScheduleNode?: (
    userId: string,
    opts: { label: string; attrs: Record<string, unknown> },
  ) => Promise<{ label: string }>;
  clearScheduleHolds?: (
    userId: string,
    labelHint?: string | null,
  ) => Promise<{ cleared: number; labels: string[] }>;
  /** Google OAuth + sync hooks (M4 multi-account). */
  getGoogleAuthUrl?: (userId: string, label: string) => Promise<string | null>;
  /** Uber Rider OAuth — null if UBER_CLIENT_* unset. */
  getUberAuthUrl?: (userId: string) => Promise<string | null>;
  disconnectUber?: (userId: string) => Promise<string>;
  listGoogleAccounts?: (
    userId: string,
  ) => Promise<Array<{ label: string; email: string | null; scopes?: string }>>;
  disconnectGoogle?: (
    userId: string,
    label: string | "all",
  ) => Promise<{ deleted: number; labels: string[] }>;
  syncGoogle?: (
    userId: string,
    opts?: { label?: string },
  ) => Promise<{
    mail: number;
    skippedPromo: number;
    skippedMuted: number;
    calendar: number;
    accounts: number;
  }>;
  searchMail?: (
    userId: string,
    opts: { query: string; lookbackDays: number },
  ) => Promise<{
    hits: Array<{
      from: string;
      to?: string;
      subject: string;
      snippet: string;
      date?: string;
      eventId?: string;
    }>;
    searchedLive: boolean;
    connected: boolean;
  }>;
  getMailWorkingSet?: (userId: string) => Promise<MailWorkingSet | null>;
  setMailWorkingSet?: (userId: string, set: MailWorkingSet | null) => Promise<void>;
  isGoogleConnected?: (userId: string) => Promise<boolean>;
  getBriefingContext?: (userId: string) => Promise<{
    openCommitmentsSummary: string;
    calendarToday: string;
    calendarTomorrow?: string;
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
    items: Array<{
      index: number;
      label: string;
      detail: string;
      kind?: string;
      eventId?: string | null;
      threadId?: string | null;
      commitmentId?: string | null;
      fingerprint?: string | null;
    }>;
    more: string | null;
    moreLines: string[];
    numberContext: "focus" | "more";
  }>;
  setBriefNumberContext?: (
    userId: string,
    ctx: "focus" | "more",
  ) => Promise<void>;
  /** Detail for a quieter / More-list line (subject — actor). */
  getHandledMailDetail?: (
    userId: string,
    line: string,
  ) => Promise<string>;
  listCompleted?: (userId: string) => Promise<string[]>;
  listHandled?: (userId: string) => Promise<string[]>;
  closeBriefPriority?: (
    userId: string,
    opts: {
      kind?: string | null;
      eventId?: string | null;
      threadId?: string | null;
      commitmentId?: string | null;
      label?: string | null;
      fingerprint?: string | null;
      status?: "done" | "dropped";
    },
  ) => Promise<{ ok: boolean; message: string }>;
  /** Approved WABA template names for briefings (channel-blind names). */
  briefingTemplates?: {
    morning: string;
    evening: string;
    languageCode: string;
  };
  addMutedPattern?: (userId: string, pattern: string) => Promise<string[]>;
  removeMutedPattern?: (userId: string, pattern: string) => Promise<string[]>;
  listMutedPatterns?: (userId: string) => Promise<string[]>;
  addVipName?: (userId: string, name: string) => Promise<string[]>;
  listVipNames?: (userId: string) => Promise<string[]>;
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
    items: ReminderSpec[],
  ) => Promise<
    Array<{
      title: string;
      dueAt: Date;
      kind: ReminderKind;
      calendarOk?: boolean;
      fire?: "calendar" | "after_brief" | "soon";
    }>
  >;
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
  /** Live life-ops research (Places / flight links). Returns grounded text; never books. */
  researchLifeOps?: (
    userId: string,
    intent: LifeOpsResearchIntent,
  ) => Promise<{ text: string; options: Array<Record<string, unknown>> }>;
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
  /** Days 1–7 onboarding guide. */
  getOnboardingState?: (userId: string) => Promise<OnboardingState>;
  setOnboardingState?: (userId: string, state: OnboardingState) => Promise<void>;
  setUserDisplayName?: (userId: string, name: string) => Promise<void>;
  /** Append Days 2–7 tip under morning / on-demand brief when eligible. */
  maybeAppendOnboardingTip?: (userId: string, briefText: string) => Promise<string>;
  /** User asked for training tip — pull next tip ignoring same-day cap. */
  pullTrainingTip?: (userId: string) => Promise<string | null>;
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
  if (/^(yes|y|yeah|yep|ok|okay|confirm|cancel|no|nope|edit|alternate)\b/i.test(t)) return false;
  if (isEmailRewriteDirection(t)) return false;
  if (isAddToTheirCalendarAsk(t)) return true;
  if (isBriefRequest(t)) return true;
  if (
    /^(mute|unmute|sync|google|help|commands|pause|resume|briefs|status|pending|open|delete|forget|memory|about|done|drop|snooze|places|home|office|waiting|vip|training|tip)\b/i.test(
      t,
    )
  ) {
    return true;
  }
  if (
    isHelpCommand(t) ||
    isStatusCommand(t) ||
    isCompletedListCommand(t) ||
    isHandledListCommand(t) ||
    isAboutMeCommand(t) ||
    Boolean(parseAboutPersonCommand(t)) ||
    Boolean(parseWaitingOnCommand(t)) ||
    Boolean(parseCancelWatchCommand(t)) ||
    Boolean(parseScheduleDayQuery(t)) ||
    isHowItWorksCommand(t) ||
    isCapabilitiesCommand(t) ||
    isGreetingCommand(t) ||
    parseCommitmentCloseCommand(t) ||
    parsePlaceSetCommands(t).length > 0 ||
    isPlacesListCommand(t)
  ) {
    return true;
  }
  if (extractMutePatternFromMessage(t)) return true;
  if (parseCalendarCreateHint(t, timeZone, now)) return true;
  if (parseScheduleIntent(t)) return true;
  if (parseForwardToCalendar(t, timeZone, now)) return true;
  if (isCalendarInviteIntent(t)) return true;
  if (parseReminderMessage(t, timeZone, now).length > 0) return true;
  if (isReminderAsk(t)) return true;
  if (parseLifeOpsResearchIntent(t) || parseLifeOpsHandoffIntent(t)) return true;
  if (/\b(send|draft)\b/i.test(t) && /\b(email|mail|invite)\b/i.test(t)) return true;
  // Macro / markets / general IQ — never trapped behind a life-ops pending.
  if (
    /\b(yield|bond|gilt|ipo|nifty|sensex|stock|fed|rbi|inflation|cpi|gdp|earnings|market)\b/i.test(
      t,
    ) &&
    !/\b(dinner|lunch|movie|flight|uber|zomato|book)\b/i.test(t)
  ) {
    return true;
  }
  if (/\bcalendar invite\b/i.test(t)) return true;
  if (/\binvite\b/i.test(t) && /@|\bspeedstar\b|\brajeev\b|\brajiv\b/i.test(t)) return true;
  if (
    isGoogleListCommand(t) ||
    parseConnectGoogleCommand(t) ||
    parseConnectUberCommand(t) ||
    parseUberBookAsk(t) ||
    parseDisconnectGoogleCommand(t) ||
    parseSyncCommand(t)
  ) {
    return true;
  }
  if (parseMailLookup(t) || isLookbackOnlyMessage(t) || isBriefRequest(t)) return true;
  return false;
}

function normalizeAttendeeEmail(raw: string): string {
  return raw.toLowerCase().trim().replace(/@speedstart\.ai$/i, "@speedstar.ai");
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

/** Location from message, or maps link just shared when user says "this place". */
async function resolveCalendarLocation(
  userId: string,
  text: string,
  deps: OrchestratorDeps,
): Promise<string | null> {
  const direct = extractEventLocation(text) ?? extractMapsShareUrl(text);
  if (direct) return direct;
  if (!refersToSharedPlace(text) || !deps.getRecentChatSummary) return null;
  const summary = await deps.getRecentChatSummary(userId);
  return extractMapsShareUrl(summary);
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
  if (/^(it|that|this)$/i.test(String(payload.title ?? "").trim())) payload.title = "Busy";
  if (isPoisonContextVenue(String(payload.location ?? ""))) delete payload.location;
  if (isPoisonContextVenue(String(payload.title ?? ""))) {
    const stripped = String(payload.title).replace(/\s+at\s+.*$/i, "").trim();
    payload.title = stripped && !isPoisonContextVenue(stripped) ? stripped : "Busy";
  }

  let conflictNote: string | null = null;
  if (deps.checkCalendarConflict) {
    const startIso = String(payload.start ?? payload.startIso ?? "").trim();
    let endIso = String(payload.end ?? payload.endIso ?? "").trim();
    if (startIso && !endIso) {
      const startMs = Date.parse(startIso);
      if (!Number.isNaN(startMs)) {
        endIso = new Date(startMs + 60 * 60 * 1000).toISOString();
        payload.end = endIso;
        payload.endIso = endIso;
      }
    }
    if (startIso && endIso) {
      try {
        const conflict = await deps.checkCalendarConflict(msg.userId, {
          startIso,
          endIso,
          timezone: timeZone,
        });
        conflictNote = conflict.conflictNote;
        if (!conflict.clear) {
          // Keep the requested time — user chooses go-ahead vs alternate.
          payload.conflictWarning = true;
          if (conflict.conflictTitle) payload.conflictWith = conflict.conflictTitle;
          if (conflict.suggested) {
            payload.suggestedStart = conflict.suggested.startIso;
            payload.suggestedEnd = conflict.suggested.endIso;
          }
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
  const confirmHint = conflictNote
    ? "Reply yes to go ahead anyway, alternate for next free, or cancel."
    : payload.location
      ? "Reply yes to write to Google Calendar, cancel to drop. After it's on the calendar I'll send a leave-by travel advisory (travel time + buffer)."
      : "Reply yes to write to Google Calendar, cancel to drop.";
  return [
    {
      text: [
        ...(conflictNote ? [conflictNote, ""] : []),
        `Proposed (${pending.kind}):`,
        pending.summary,
        "",
        confirmHint,
      ].join("\n"),
    },
  ];
}

function emailDraftMode(payload: Record<string, unknown>, fallback: EmailComposeAsk | null): "draft" | "send" {
  if (isDraftOnlyPayload(payload)) return "draft";
  if (fallback?.mode === "draft") return "draft";
  return "send";
}

function emailDraftMessages(payload: Record<string, unknown>, mode: "draft" | "send"): OutboundMessage[] {
  return [
    {
      text: emailDraftIntro({
        mode,
        to: String(payload.to ?? ""),
        recipientLabel: String(payload.recipientLabel ?? ""),
        rewroteFromNotes: payload.rewroteFromNotes === true,
      }),
    },
    { text: formatEmailDraftCopy(payload) },
  ];
}

async function gmailSendFailOrGeneric(
  userId: string,
  message: string,
  deps: OrchestratorDeps,
  payload: Record<string, unknown>,
): Promise<OutboundMessage[]> {
  if (!/Gmail send isn't authorized/i.test(message) || !deps.getGoogleAuthUrl) {
    return [{ text: `Couldn't complete: ${message}` }];
  }
  const lead = await gmailSendAuthLeadIn(userId, deps, payload);
  if (lead) return [lead];
  return [{ text: `Couldn't complete: ${message}` }];
}

async function gmailSendAuthLeadIn(
  userId: string,
  deps: OrchestratorDeps,
  payload: Record<string, unknown>,
): Promise<OutboundMessage | null> {
  if (!deps.getGoogleAuthUrl) return null;
  const preferred = normalizeGoogleLabel(String(payload.accountLabel ?? "personal"));
  if (deps.listGoogleAccounts) {
    const accounts = await deps.listGoogleAccounts(userId);
    const sendAcct = pickGmailSendAccount(accounts, preferred);
    if (sendAcct) return null;
  }
  const url = await deps.getGoogleAuthUrl(userId, preferred);
  if (!url) return null;
  return {
    text: [
      "Gmail send isn't authorized on this Google link yet.",
      `Tap to grant Send email as “${preferred}”:`,
      "",
      url,
      "",
      "After Google says connected, reply yes again to send the draft.",
    ].join("\n"),
  };
}

async function withGmailSendAuthNotice(
  userId: string,
  deps: OrchestratorDeps,
  payload: Record<string, unknown>,
  messages: OutboundMessage[],
): Promise<OutboundMessage[]> {
  if (isDraftOnlyPayload(payload)) return messages;
  const lead = await gmailSendAuthLeadIn(userId, deps, payload);
  return lead ? [lead, ...messages] : messages;
}

async function proposeEmailComposePending(
  msg: InboundMessage,
  deps: OrchestratorDeps,
  ask: EmailComposeAsk,
  extras?: { to?: string; subject?: string; body?: string; userName?: string },
): Promise<OutboundMessage[]> {
  const toHint = ask.toHint && isPersistableContactLabel(ask.toHint) ? ask.toHint : ask.toHint;
  let to = extras?.to?.trim() || (ask.toHint?.includes("@") ? ask.toHint : "");
  if (!to && toHint && deps.resolveContactEmail) {
    const hit = await deps.resolveContactEmail(msg.userId, toHint);
    if (hit?.email) to = hit.email;
  }
  const composed = composeEmailDraft(ask, extras?.userName);
  const subject = extras?.subject?.trim() || composed.subject;
  const body = extras?.body?.trim() || composed.body;
  let accountLabel = "personal";
  if (deps.listGoogleAccounts) {
    const sendAcct = pickGmailSendAccount(await deps.listGoogleAccounts(msg.userId), "personal");
    if (sendAcct) accountLabel = sendAcct.label;
  }
  let payload: Record<string, unknown> = {
    accountLabel,
    to,
    subject,
    body,
    draftOnly: ask.mode === "draft",
    sourceDirections: ask.sourceText,
    rewroteFromNotes: !extras?.body,
    ...(toHint ? { recipientLabel: toHint } : {}),
  };
  if (!extras?.body) {
    payload = polishEmailDraftPayload(payload, {
      sourceText: ask.sourceText,
      ...(extras?.userName ? { userName: extras.userName } : {}),
      ...(toHint != null ? { toHint } : {}),
    });
    payload.draftOnly = ask.mode === "draft";
    payload.to = to;
    if (accountLabel) payload.accountLabel = accountLabel;
  }
  if (!deps.createPending) {
    return emailDraftMessages(payload, ask.mode);
  }
  await deps.createPending({
    userId: msg.userId,
    kind: "email_draft",
    summary: `Email draft to ${to || toHint || "?"}: ${String(payload.subject ?? subject)}`,
    payload,
  });
  const persistLabel = String(payload.recipientLabel ?? toHint ?? "");
  if (to && deps.rememberContactEmail && isPersistableContactLabel(persistLabel)) {
    await deps.rememberContactEmail(msg.userId, { label: persistLabel, email: to });
  }
  return withGmailSendAuthNotice(
    msg.userId,
    deps,
    payload,
    emailDraftMessages(payload, ask.mode),
  );
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
    next.to = normalizeAttendeeEmail(emailMatch[1]);
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

function recipientFirstFromDraft(payload: Record<string, unknown>): string | null {
  const cleaned = cleanPersonLabel(String(payload.recipientLabel ?? ""));
  if (cleaned) {
    const first = cleaned.split(/\s+/)[0] ?? "";
    if (first.length >= 2) return first;
  }
  const local = String(payload.to ?? "").split("@")[0] ?? "";
  if (/^[a-z]{3,}$/i.test(local)) return local.replace(/^\w/, (c) => c.toUpperCase());
  return null;
}

function rewriteEmailDraftFromDirection(opts: {
  payload: Record<string, unknown>;
  text: string;
  recentChat: string;
  timeZone: string;
  userName: string;
}): Record<string, unknown> {
  const next = { ...opts.payload };
  const now = new Date();
  const fromChat = latestCalendarHintLineFromChat(opts.recentChat, opts.timeZone, now);
  const hint =
    parseCalendarCreateHint(opts.text, opts.timeZone, now) ??
    (fromChat ? parseCalendarCreateHint(fromChat, opts.timeZone, now) : null);
  const hay = `${opts.text}\n${opts.recentChat}\n${String(next.subject ?? "")}\n${String(next.body ?? "")}`;
  const appointmentish =
    looksLikeAppointmentNotify(opts.text) || /\bappointment\b/i.test(hay);
  if (
    appointmentish &&
    (hint || looksLikeAppointmentNotify(opts.text) || isEmailRewriteDirection(opts.text))
  ) {
    const venue = cleanAppointmentVenue(hint?.title ?? "appointment");
    const whenLabel = hint
      ? `${formatLocalWhenFriendly(new Date(hint.startIso), opts.timeZone)}–${formatLocalHm(new Date(hint.endIso), opts.timeZone)}`
      : "tomorrow";
    const address = extractPlaceAddressFromChat(`${opts.recentChat}\n${opts.text}`, venue);
    const composed = composeAppointmentReminder({
      recipientFirst: recipientFirstFromDraft(next),
      venue,
      whenLabel,
      ...(address ? { address } : {}),
      userName: opts.userName,
    });
    next.subject = composed.subject;
    next.body = composed.body;
    next.draftOnly = false;
    return next;
  }
  const source = `${opts.recentChat}\n${opts.text}`.trim();
  const polished = polishEmailDraftPayload(next, {
    sourceText: source || opts.text,
    userName: opts.userName,
    toHint: String(next.recipientLabel ?? ""),
  });
  return polished;
}

function isAppointmentEmailAsk(text: string): boolean {
  return (
    looksLikeAppointmentNotify(text) &&
    !isCalendarInviteIntent(text) &&
    !isAddToTheirCalendarAsk(text)
  );
}

async function proposeAppointmentNotifyPending(
  msg: InboundMessage,
  deps: OrchestratorDeps,
  text: string,
  recentChat: string,
  timeZone: string,
  userName: string,
): Promise<OutboundMessage[]> {
  const now = new Date();
  const fromChat = latestCalendarHintLineFromChat(recentChat, timeZone, now);
  const hint =
    parseCalendarCreateHint(text, timeZone, now) ??
    (fromChat ? parseCalendarCreateHint(fromChat, timeZone, now) : null);
  const toHint =
    parseEmailComposeAsk(text)?.toHint ?? latestEmailToHintFromChat(recentChat);
  const venue = cleanAppointmentVenue(hint?.title ?? "appointment");
  const whenLabel = hint
    ? `${formatLocalWhenFriendly(new Date(hint.startIso), timeZone)}–${formatLocalHm(new Date(hint.endIso), timeZone)}`
    : "tomorrow";
  const address = extractPlaceAddressFromChat(`${recentChat}\n${text}`, venue);
  const first =
    toHint && !toHint.includes("@")
      ? toHint.split(/\s+/)[0]!.replace(/^\w/, (c) => c.toUpperCase())
      : null;
  const composed = composeAppointmentReminder({
    recipientFirst: first,
    venue,
    whenLabel,
    ...(address ? { address } : {}),
    userName,
  });
  return proposeEmailComposePending(
    msg,
    deps,
    { mode: "send", toHint, about: composed.subject, sourceText: text },
    { subject: composed.subject, body: composed.body, userName },
  );
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
  items: ReminderSpec[],
  deps: OrchestratorDeps,
): Promise<OutboundMessage[]> {
  if (!deps.createReminders) {
    return [{ text: "Reminders aren't wired yet." }];
  }
  const saved = await deps.createReminders(userId, items);
  const postBrief = saved.filter((r) => r.kind === "post_brief" && r.fire !== "soon");
  const soon = saved.filter((r) => r.fire === "soon");
  const timed = saved.filter((r) => r.kind === "timed");
  const lines: string[] = [];
  if (timed.length) {
    lines.push(timed.length === 1 ? "Reminder set:" : `${timed.length} reminders set:`);
    for (const r of timed) {
      const when = formatLocalWhenFriendly(r.dueAt, timezone);
      lines.push(
        r.calendarOk
          ? `• ${when} — ${r.title} (1 min on calendar)`
          : `• ${when} — ${r.title} (WhatsApp ping)`,
      );
    }
  }
  if (postBrief.length) {
    const day = formatLocalDateLong(postBrief[0]!.dueAt, timezone);
    lines.push(`I'll remind you after the morning brief on ${day}:`);
    for (const r of postBrief) {
      lines.push(
        r.calendarOk
          ? `• ${r.title} (1 min on calendar at 09:00)`
          : `• ${r.title}`,
      );
    }
  }
  if (soon.length) {
    lines.push("Morning brief already went — I'll ping you now:");
    for (const r of soon) {
      lines.push(
        r.calendarOk
          ? `• ${r.title} (1 min on calendar at 09:00)`
          : `• ${r.title}`,
      );
    }
  }
  lines.push(`(${timezoneFriendlyLabel(timezone)})`);
  return [{ text: lines.join("\n") }];
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
  if (isCapabilitiesCommand(text)) {
    if (deps.getOnboardingState && deps.setOnboardingState) {
      const ob = await deps.getOnboardingState(msg.userId);
      if (!ob.startedAt) {
        const tz = deps.getTimezoneState
          ? (await deps.getTimezoneState(msg.userId)).timezone
          : "Asia/Kolkata";
        const { day } = localDayBoundsUtc(tz);
        await deps.setOnboardingState(msg.userId, {
          ...ob,
          startedAt: new Date().toISOString(),
          startedLocalDay: day,
        });
      }
    }
    return [{ text: WHAT_I_DO }];
  }
  if (isHowItWorksCommand(text)) {
    return [{ text: HOW_IT_WORKS }];
  }
  if (isSkipOnboardingCommand(text)) {
    if (deps.getOnboardingState && deps.setOnboardingState) {
      const ob = await deps.getOnboardingState(msg.userId);
      await deps.setOnboardingState(msg.userId, {
        ...ob,
        skipped: true,
        guideComplete: true,
      });
    }
    return [{ text: "Onboarding guide off. Type Help anytime." }];
  }
  if (isTrainingTipCommand(text)) {
    if (!deps.pullTrainingTip) {
      return [{ text: "Training tips aren't wired yet." }];
    }
    const tip = await deps.pullTrainingTip(msg.userId);
    if (!tip) {
      return [
        {
          text: "No more training tips — you're through the guide. Type Help anytime.",
        },
      ];
    }
    return [{ text: tip }];
  }
  if (isGreetingCommand(text)) {
    const name = await deps.resolveUserName(msg.userId);
    if (deps.getOnboardingState && deps.setOnboardingState) {
      const ob = await deps.getOnboardingState(msg.userId);
      if (!ob.startedAt) {
        const tz = deps.getTimezoneState
          ? (await deps.getTimezoneState(msg.userId)).timezone
          : "Asia/Kolkata";
        const { day } = localDayBoundsUtc(tz);
        await deps.setOnboardingState(msg.userId, {
          ...ob,
          startedAt: new Date().toISOString(),
          startedLocalDay: day,
        });
      }
    }
    return welcomeMessages(name).map((t) => ({ text: t }));
  }

  const vipCmd = parseVipCommand(text);
  if (vipCmd) {
    if (vipCmd.op === "list") {
      if (!deps.listVipNames) return [{ text: "VIP list isn't wired yet." }];
      const list = await deps.listVipNames(msg.userId);
      return [
        {
          text: list.length
            ? ["VIP list:", ...list.map((n) => `• ${n}`)].join("\n")
            : 'No VIPs yet. Try: vip Priya',
        },
      ];
    }
    if (!deps.addVipName || !vipCmd.name) {
      return [{ text: 'Try: vip Priya' }];
    }
    const next = await deps.addVipName(msg.userId, vipCmd.name);
    return [
      {
        text: `VIP: ${vipCmd.name}. Now ${next.length} on the list.`,
      },
    ];
  }

  // Day-1 name reply: "call me Sameep" / "my name is …"
  const displayName = parseDisplayNameReply(text);
  if (displayName && deps.setUserDisplayName) {
    await deps.setUserDisplayName(msg.userId, displayName);
    return [{ text: `Got it — I'll call you ${displayName}.` }];
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

  // Brief follow-ups: 1 / 2 / 3 / M / quieter numbers (must not go to the LLM).
  // Option replies bind to the latest option list, or to a quoted WhatsApp message.
  if (/^\d{1,2}$/.test(lower) || lower === "m") {
    let recentForPick: string | undefined;
    if (deps.getRecentChatSummary) {
      recentForPick = await deps.getRecentChatSummary(msg.userId, {
        ...(msg.messageId ? { excludeMessageId: msg.messageId } : {}),
      });
    }
    const skipBriefForLifeOps =
      lower !== "m" &&
      preferLifeOpsNumberPick({
        text: lower,
        recentChat: recentForPick,
        ...(msg.replyToContent ? { replyToContent: msg.replyToContent } : {}),
      });
    const boundListKind = classifyOptionListKind(
      optionPickSource({
        recentChat: recentForPick,
        replyToContent: msg.replyToContent,
      }),
    );
    const bindToBrief =
      lower === "m" ||
      (!skipBriefForLifeOps &&
        (boundListKind === "brief_focus" ||
          boundListKind === "brief_more" ||
          (!recentForPick && !msg.replyToContent)));
    if (bindToBrief && deps.getLastBriefItems) {
      const stored = await deps.getLastBriefItems(msg.userId);
      if (lower === "m") {
        if (stored.more?.trim()) {
          if (deps.setBriefNumberContext) {
            await deps.setBriefNumberContext(msg.userId, "more");
          }
          const maxN = Math.min(stored.moreLines.length || 16, 20);
          return [
            {
              text: [
                "More from your brief:",
                stored.more,
                "",
                `Reply 1–${maxN} for that quieter item (or reply to this message with the number).`,
                "Type Help for anything else.",
              ].join("\n"),
            },
          ];
        }
        return [{ text: "Nothing more queued from the last brief." }];
      }

      const n = Number(lower);
      const list = briefNumberListTarget({
        ...(msg.replyToContent != null ? { replyToContent: msg.replyToContent } : {}),
        ...(msg.replyToScheduled != null ? { replyToScheduled: msg.replyToScheduled } : {}),
        ...(recentForPick != null ? { recentChat: recentForPick } : {}),
        numberContext: stored.numberContext,
      });
      const useMore = list === "more";

      if (useMore && stored.moreLines.length) {
        const label = stored.moreLines[n - 1];
        if (!label) {
          return [
            {
              text: `No quieter item ${n}. Available: 1–${stored.moreLines.length}.`,
            },
          ];
        }
        const detail = deps.getHandledMailDetail
          ? await deps.getHandledMailDetail(msg.userId, label)
          : label;
        return [{ text: `${n}) ${label}\n\n${detail}` }];
      }

      if (n < 1 || n > 3) {
        if (stored.moreLines.length && useMore) {
          return [
            {
              text: `No quieter item ${n}. Available: 1–${stored.moreLines.length}.`,
            },
          ];
        }
        return [
          {
            text: stored.items.length
              ? `FOCUS only has ${stored.items.map((i) => i.index).join(", ")}. Reply M for quieter mail.`
              : "No brief items stored yet — send brief (or wait for the morning update).",
          },
        ];
      }

      const item = stored.items.find((i) => i.index === n);
      if (item) {
        if (deps.setBriefNumberContext) {
          await deps.setBriefNumberContext(msg.userId, "focus");
        }
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

  if (isShowDraftAsk(text)) {
    if (openPending?.kind === "email_draft") {
      return emailDraftMessages(
        openPending.payload,
        emailDraftMode(openPending.payload, null),
      );
    }
    return [{ text: "No email draft pending. Ask me to draft one — it stays here until you say send." }];
  }

  if (openPending && deps.confirmPending && deps.rejectPending) {
    const isCancelKind = openPending.kind === "calendar_cancel";
    const isConflictKind = openPending.kind === "calendar_conflict";
    if (openPending.kind === "email_draft") {
      const bareTo = parseBareEmail(text);
      if (bareTo && deps.editPending) {
        const to = normalizeAttendeeEmail(bareTo);
        const nextPayload: Record<string, unknown> = { ...openPending.payload, to };
        const summary = `Email draft to ${to}: ${String(nextPayload.subject ?? "draft")}`;
        await deps.editPending(msg.userId, nextPayload, summary);
        const label = String(nextPayload.recipientLabel ?? "").trim();
        if (label && isPersistableContactLabel(label) && deps.rememberContactEmail) {
          await deps.rememberContactEmail(msg.userId, { label, email: to });
        }
        return emailDraftMessages(nextPayload, emailDraftMode(nextPayload, null));
      }
      if (isSendDraftAsk(text)) {
        if (!String(openPending.payload.to ?? "").includes("@")) {
          const who =
            cleanPersonLabel(String(openPending.payload.recipientLabel ?? "")) || "the recipient";
          return [{ text: `Need ${who}'s email before I can send.` }];
        }
        if (emailDraftNeedsRewrite(openPending.payload) && deps.editPending) {
          const source =
            String(openPending.payload.sourceDirections ?? "") ||
            (deps.getRecentChatSummary
              ? await deps.getRecentChatSummary(msg.userId, {
                  ...(msg.messageId ? { excludeMessageId: msg.messageId } : {}),
                })
              : "");
          const userName = deps.resolveUserName ? await deps.resolveUserName(msg.userId) : "";
          const nextPayload = polishEmailDraftPayload(openPending.payload, {
            sourceText: source || String(openPending.payload.body ?? ""),
            userName,
            toHint: String(openPending.payload.recipientLabel ?? ""),
          });
          const summary = `Email draft to ${String(nextPayload.to ?? "?")}: ${String(nextPayload.subject ?? "draft")}`;
          await deps.editPending(msg.userId, nextPayload, summary);
          return [
            {
              text: "This still looked like your notes — here's the rewrite. Say send if this is the one.",
            },
            ...emailDraftMessages(nextPayload, emailDraftMode(nextPayload, null)),
          ];
        }
        const r = await deps.confirmPending(msg.userId);
        if (r.ok) return [{ text: r.message }];
        return gmailSendFailOrGeneric(msg.userId, r.message, deps, openPending.payload);
      }
      if (
        deps.editPending &&
        (isEmailRewriteDirection(text) || looksLikeAppointmentNotify(text))
      ) {
        const recentChat = deps.getRecentChatSummary
          ? await deps.getRecentChatSummary(msg.userId, {
              ...(msg.messageId ? { excludeMessageId: msg.messageId } : {}),
            })
          : "";
        const userName = deps.resolveUserName ? await deps.resolveUserName(msg.userId) : "";
        const nextPayload = rewriteEmailDraftFromDirection({
          payload: openPending.payload,
          text,
          recentChat,
          timeZone: tzForPending.timezone,
          userName,
        });
        if (deps.listGoogleAccounts) {
          const sendAcct = pickGmailSendAccount(
            await deps.listGoogleAccounts(msg.userId),
            String(nextPayload.accountLabel ?? "personal"),
          );
          if (sendAcct) nextPayload.accountLabel = sendAcct.label;
        }
        const summary = `Email draft to ${String(nextPayload.to ?? "?")}: ${String(nextPayload.subject ?? "draft")}`;
        await deps.editPending(msg.userId, nextPayload, summary);
        return withGmailSendAuthNotice(
          msg.userId,
          deps,
          nextPayload,
          emailDraftMessages(nextPayload, emailDraftMode(nextPayload, null)),
        );
      }
      if (isAddToTheirCalendarAsk(text) && deps.createPending) {
        const recentChat = deps.getRecentChatSummary
          ? await deps.getRecentChatSummary(msg.userId, {
              ...(msg.messageId ? { excludeMessageId: msg.messageId } : {}),
            })
          : "";
        const calText = mergeCalendarFollowUp(text, recentChat, tzForPending.timezone);
        const hint =
          parseCalendarCreateHint(calText, tzForPending.timezone) ??
          (latestCalendarHintLineFromChat(recentChat, tzForPending.timezone)
            ? parseCalendarCreateHint(
                latestCalendarHintLineFromChat(recentChat, tzForPending.timezone)!,
                tzForPending.timezone,
              )
            : null);
        if (!hint) {
          return [{ text: "When should I put it on the calendar — a day and time?" }];
        }
        const to = String(openPending.payload.to ?? "");
        const attendees = to.includes("@") ? [normalizeAttendeeEmail(to)] : [];
        await deps.rejectPending(msg.userId);
        const venue = cleanAppointmentVenue(hint.title);
        return proposeCalendarCreatePending(msg, deps, tzForPending.timezone, {
          title: venue,
          start: hint.startIso,
          end: hint.endIso,
          startIso: hint.startIso,
          endIso: hint.endIso,
          ...(attendees.length ? { attendees } : {}),
        });
      }
    }
    const affirm = isCancelKind
      ? /^(yes|y|yeah|yep|ok|okay|confirm|do it|go ahead|approved?|cancel( it| this| now)?)$/i.test(
          lower,
        )
      : /^(yes|y|yeah|yep|ok|okay|confirm|do it|go ahead|approved?|keep|accept)$/i.test(
          lower,
        );
    const reject = isCancelKind
      ? /^(no|nope|keep( it)?|never ?mind|abort|drop|don't|dont)$/i.test(lower)
      : isConflictKind
        ? /^(decline|reject|cancel|no|nope|don't|dont|never ?mind|abort)$/i.test(lower)
        : /^(cancel|no|nope|reject|don't|dont|never ?mind|abort)$/i.test(lower);

    if (affirm) {
      if (openPending.kind === "email_draft" && isDraftOnlyPayload(openPending.payload)) {
        return [
          {
            text: "Not sent. Say send to deliver via Gmail, edit <change>, or cancel.",
          },
          { text: formatEmailDraftCopy(openPending.payload) },
        ];
      }
      if (
        openPending.kind === "email_draft" &&
        emailDraftNeedsRewrite(openPending.payload) &&
        deps.editPending
      ) {
        const source =
          String(openPending.payload.sourceDirections ?? "") ||
          (deps.getRecentChatSummary
            ? await deps.getRecentChatSummary(msg.userId, {
                ...(msg.messageId ? { excludeMessageId: msg.messageId } : {}),
              })
            : "");
        const userName = deps.resolveUserName ? await deps.resolveUserName(msg.userId) : "";
        const nextPayload = polishEmailDraftPayload(openPending.payload, {
          sourceText: source || String(openPending.payload.body ?? ""),
          userName,
          toHint: String(openPending.payload.recipientLabel ?? ""),
        });
        if (deps.listGoogleAccounts) {
          const sendAcct = pickGmailSendAccount(
            await deps.listGoogleAccounts(msg.userId),
            String(nextPayload.accountLabel ?? "personal"),
          );
          if (sendAcct) nextPayload.accountLabel = sendAcct.label;
        }
        const summary = `Email draft to ${String(nextPayload.to ?? "?")}: ${String(nextPayload.subject ?? "draft")}`;
        await deps.editPending(msg.userId, nextPayload, summary);
        return [
          {
            text: "This still looked like your notes — here's the rewrite. Reply yes to send, or edit <change>.",
          },
          ...emailDraftMessages(nextPayload, emailDraftMode(nextPayload, null)),
        ];
      }
      if (openPending.kind === "email_draft" && deps.listGoogleAccounts && deps.editPending) {
        const sendAcct = pickGmailSendAccount(
          await deps.listGoogleAccounts(msg.userId),
          String(openPending.payload.accountLabel ?? "personal"),
        );
        if (sendAcct && sendAcct.label !== String(openPending.payload.accountLabel ?? "")) {
          const nextPayload: Record<string, unknown> = {
            ...openPending.payload,
            accountLabel: sendAcct.label,
          };
          await deps.editPending(
            msg.userId,
            nextPayload,
            `Email draft to ${String(nextPayload.to ?? "?")}: ${String(nextPayload.subject ?? "draft")}`,
          );
        }
      }
      const r = await deps.confirmPending(msg.userId);
      if (r.ok) return [{ text: r.message }];
      return gmailSendFailOrGeneric(msg.userId, r.message, deps, openPending.payload);
    }
    const wantAlternate =
      (openPending.kind === "calendar_create" || isConflictKind) &&
      /^(alternate|propose alternate|next free|suggest(ed)?( time)?|reschedule)$/i.test(
        lower,
      );
    if (wantAlternate && isConflictKind && deps.createPending) {
      const sugStart = String(openPending.payload.suggestedStart ?? "").trim();
      const sugEnd = String(openPending.payload.suggestedEnd ?? "").trim();
      const organizer = String(openPending.payload.organizerEmail ?? "").trim();
      const title = String(openPending.payload.title ?? "the meeting").trim();
      if (!sugStart || !sugEnd) {
        return [
          {
            text: "No alternate slot on file. Say a time to propose, or decline.",
          },
        ];
      }
      if (!organizer.includes("@")) {
        return [
          {
            text: [
              `Next free: ${formatLocalWhenFriendly(new Date(sugStart), tzForPending.timezone)}–${formatLocalHm(new Date(sugEnd), tzForPending.timezone)}.`,
              "I don't have the organizer email to draft a reschedule — reply to them directly, or decline.",
            ].join("\n"),
          },
        ];
      }
      const when = formatLocalWhenFriendly(new Date(sugStart), tzForPending.timezone);
      const endHm = formatLocalHm(new Date(sugEnd), tzForPending.timezone);
      const body = [
        `Hi — can we move “${title}” to ${when}–${endHm}?`,
        "I have a conflict at the original time.",
        "",
        "Thanks",
      ].join("\n");
      await deps.createPending({
        userId: msg.userId,
        kind: "email_draft",
        summary: `Email draft to ${organizer}: Reschedule ${title}`,
        payload: {
          accountLabel: String(openPending.payload.accountLabel ?? "personal"),
          to: organizer,
          subject: `Reschedule: ${title}`,
          body,
        },
      });
      return [
        {
          text: [
            "Email ready to send.",
            "Reply yes to send via Gmail, cancel to drop, or edit <change>.",
          ].join("\n"),
        },
        {
          text: [`To: ${organizer}`, `Subject: Reschedule: ${title}`, body].join("\n"),
        },
      ];
    }
    if (wantAlternate && openPending.kind === "calendar_create" && deps.editPending) {
      const sugStart = String(openPending.payload.suggestedStart ?? "").trim();
      const sugEnd = String(openPending.payload.suggestedEnd ?? "").trim();
      if (!sugStart || !sugEnd) {
        return [
          {
            text: "No alternate slot on file for this proposal. Say a new time, or cancel.",
          },
        ];
      }
      const nextPayload: Record<string, unknown> = {
        ...openPending.payload,
        start: sugStart,
        end: sugEnd,
        startIso: sugStart,
        endIso: sugEnd,
        conflictAdjusted: true,
        conflictWarning: false,
      };
      delete nextPayload.suggestedStart;
      delete nextPayload.suggestedEnd;
      const attendees = Array.isArray(nextPayload.attendees)
        ? nextPayload.attendees.map((a) => String(a))
        : [];
      const summary = formatCalendarProposalSummary({
        kind: "calendar_create",
        title: String(nextPayload.title ?? "event"),
        startIso: sugStart,
        endIso: sugEnd,
        timeZone: tzForPending.timezone,
        attendees,
      });
      const r = await deps.editPending(msg.userId, nextPayload, summary);
      return [
        {
          text: r.ok
            ? [
                "Switched to next free slot:",
                summary,
                "",
                "Reply yes to write to Google Calendar, cancel to drop.",
              ].join("\n")
            : r.message,
        },
      ];
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
      const applied = applyPendingEditPatch(openPending.kind, openPending.payload, patchRaw);
      const r = await deps.editPending(msg.userId, applied.payload, applied.summaryHint);
      if (openPending.kind === "email_draft" && r.ok) {
        return emailDraftMessages(applied.payload, emailDraftMode(applied.payload, null));
      }
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
      isShowDraftAsk(text) ||
      isAboutMeCommand(text) ||
      Boolean(parseAboutPersonCommand(text)) ||
      Boolean(parseWaitingOnCommand(text)) ||
      Boolean(parseCancelWatchCommand(text)) ||
      Boolean(parseScheduleDayQuery(text)) ||
      isDeleteMenuCommand(text) ||
      isDeletePendingCommand(text) ||
      isClearMemoryCommand(text) ||
      isClearMemoryConfirmCommand(text) ||
      Boolean(parseForgetCommand(text)) ||
      Boolean(parsePlaceSetCommands(text).length) ||
      isPlacesListCommand(text) ||
      Boolean(parseOriginCorrection(text)) ||
      Boolean(parseCommitmentCloseCommand(text)) ||
      Boolean(parseConnectGoogleCommand(text));
    if (inspectOnly) {
      // fall through
    } else if (
      (openPending.kind === "life_ops_research" || openPending.kind === "life_ops_handoff") &&
      parseLifeOpsOptionPick(text)
    ) {
      await deps.rejectPending(msg.userId);
      // Letter pick from Grok findings — continue routing.
    } else if (looksLikeNewActionIntent(text, tzForPending.timezone)) {
      await deps.rejectPending(msg.userId);
      // fall through to normal routing
    } else {
      if (openPending.kind === "email_draft") {
        return [
          { text: `Pending: ${openPending.summary}` },
          ...emailDraftMessages(openPending.payload, emailDraftMode(openPending.payload, null)),
        ];
      }
      return [
        {
          text: [
            `Pending: ${openPending.summary}`,
            isCancelKind
              ? "Reply yes to cancel it on Google, or no to keep it."
              : openPending.kind === "calendar_conflict"
                ? "Reply yes to accept, alternate to propose next free, or decline."
                : openPending.kind === "calendar_create" &&
                    Boolean(openPending.payload.conflictWarning)
                  ? "Reply yes to go ahead anyway, alternate for next free, cancel to drop, or edit <change>."
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
    if (deps.listCompleted) {
      const done = await deps.listCompleted(msg.userId);
      if (done.length) {
        lines.push("", "COMPLETED", ...done.slice(0, 5).map((d) => `• ${d}`));
      }
    }
    lines.push("", 'Type Help for anything else.');
    return [{ text: lines.join("\n") }];
  }

  if (isCompletedListCommand(text)) {
    if (!deps.listCompleted) return [{ text: "Completed list isn't wired yet." }];
    const done = await deps.listCompleted(msg.userId);
    return [
      {
        text: done.length
          ? ["COMPLETED", ...done.map((d) => `• ${d}`)].join("\n")
          : "Nothing marked done yet. After a brief, say done 1.",
      },
    ];
  }

  if (isHandledListCommand(text)) {
    if (!deps.listHandled) return [{ text: "Handled list isn't wired yet." }];
    const rows = await deps.listHandled(msg.userId);
    return [
      {
        text: rows.length
          ? ["HANDLED yesterday", ...rows.map((d) => `• ${d}`)].join("\n")
          : "No quieter mail stored for yesterday.",
      },
    ];
  }

  const scheduleDay = parseScheduleDayQuery(text);
  if (scheduleDay && deps.getBriefingContext) {
    if (deps.syncGoogle) {
      try {
        await deps.syncGoogle(msg.userId);
      } catch (err) {
        return [
          {
            text: `Sync failed: ${err instanceof Error ? err.message : String(err)}`,
          },
        ];
      }
    }
    const ctx = await deps.getBriefingContext(msg.userId);
    const block =
      scheduleDay === "tomorrow"
        ? (ctx.calendarTomorrow ?? "none yet")
        : ctx.calendarToday;
    const label = scheduleDay === "tomorrow" ? "Tomorrow" : "Today";
    if (!block || block === "none yet") {
      return [{ text: `${label}: nothing on the calendar yet.` }];
    }
    return [{ text: `${label}:\n${block}` }];
  }

  if (isAboutMeCommand(text)) {
    if (!deps.getAboutMeSummary) {
      return [{ text: "Memory listing isn't wired yet." }];
    }
    const about = await deps.getAboutMeSummary(msg.userId);
    return [{ text: about }];
  }

  const aboutPerson = parseAboutPersonCommand(text);
  if (aboutPerson) {
    if (!deps.getAboutPersonSummary) {
      return [{ text: "Person lookup isn't wired yet." }];
    }
    return [{ text: await deps.getAboutPersonSummary(msg.userId, aboutPerson) }];
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

  const forgetCmd = parseForgetCommand(text);
  if (forgetCmd) {
    if (forgetCmd.attr) {
      if (!deps.forgetContextAttr) {
        return [{ text: "Fact-level forget isn't wired yet." }];
      }
      const r = await deps.forgetContextAttr(msg.userId, forgetCmd.label, forgetCmd.attr);
      if (r.ok) {
        return [{ text: `Forgot ${r.attr} on “${r.label}”.` }];
      }
      if (r.reason === "attr") {
        return [
          {
            text: `No “${forgetCmd.attr}” on “${r.label}”. Send about ${forgetCmd.label} to see attrs.`,
          },
        ];
      }
      return [
        {
          text: `Nothing stored as “${forgetCmd.label}”. Send about me to see what's saved.`,
        },
      ];
    }
    if (!deps.forgetContextLabel) {
      return [{ text: "Forget isn't wired yet." }];
    }
    const r = await deps.forgetContextLabel(msg.userId, forgetCmd.label);
    return [
      {
        text: r.deleted
          ? `Forgot “${r.label}”.`
          : `Nothing stored as “${forgetCmd.label}”. Send about me to see what's saved.`,
      },
    ];
  }

  const waitingOn = parseWaitingOnCommand(text);
  if (waitingOn) {
    if (!deps.createWaitingOnWatch) {
      return [{ text: "Watches aren't wired yet." }];
    }
    const r = await deps.createWaitingOnWatch(msg.userId, waitingOn);
    return [{ text: r.message }];
  }

  const cancelWatchHint = parseCancelWatchCommand(text);
  if (cancelWatchHint) {
    if (!deps.cancelWatchByHint) {
      return [{ text: "Watches aren't wired yet." }];
    }
    const r = await deps.cancelWatchByHint(msg.userId, cancelWatchHint);
    if (!r.cancelled) {
      return [{ text: `No open watch matching “${cancelWatchHint}”.` }];
    }
    return [
      {
        text:
          r.cancelled === 1
            ? `Cancelled watch: ${r.titles[0]}`
            : `Cancelled ${r.cancelled} watches:\n${r.titles.map((t) => `• ${t}`).join("\n")}`,
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

  // --- Schedule memory (standing / extend-hold / cancel hold) ---
  const scheduleIntent = parseScheduleIntent(text);
  if (scheduleIntent && (deps.upsertScheduleNode || deps.clearScheduleHolds || deps.listScheduleNodes)) {
    const tz = tzState.timezone;
    if (scheduleIntent.type === "cancel_hold") {
      if (!deps.clearScheduleHolds) {
        return [{ text: "Schedule holds aren't wired yet." }];
      }
      const r = await deps.clearScheduleHolds(msg.userId, scheduleIntent.labelHint);
      if (!r.cleared) {
        return [{ text: "No active hold to clear." }];
      }
      return [
        {
          text:
            r.labels.length === 1
              ? `Hold lifted on ${r.labels[0]}.`
              : `Hold lifted on ${r.labels.join(", ")}.`,
        },
      ];
    }
    if (scheduleIntent.type === "standing" && deps.upsertScheduleNode) {
      await deps.upsertScheduleNode(msg.userId, {
        label: scheduleIntent.label,
        attrs: {
          days: scheduleIntent.days,
          startHm: scheduleIntent.startHm,
          endHm: scheduleIntent.endHm,
        },
      });
      return [
        {
          text: formatScheduleAck({
            label: scheduleIntent.label,
            startHm: scheduleIntent.startHm,
            endHm: scheduleIntent.endHm,
            days: scheduleIntent.days,
            timeZone: tz,
          }),
        },
      ];
    }
    if (scheduleIntent.type === "extend_hold" && deps.upsertScheduleNode && deps.listScheduleNodes) {
      const nodes = await deps.listScheduleNodes(msg.userId);
      const hit = matchScheduleLabel(nodes, scheduleIntent.labelHint);
      const holdIso = holdUntilIsoForHm(scheduleIntent.untilHm, tz);
      if (!holdIso) {
        return [{ text: "Couldn't parse the hold time. Try: extend school pickup till 5pm." }];
      }
      const label = hit?.label ?? titleCaseScheduleHint(scheduleIntent.labelHint);
      const existing = hit ? parseScheduleAttrs(hit.attrs) : null;
      const startHm = existing?.startHm ?? "16:00";
      const endHm = scheduleIntent.untilHm;
      const days = existing?.days ?? "weekdays";
      await deps.upsertScheduleNode(msg.userId, {
        label,
        attrs: {
          days,
          startHm,
          endHm,
          holdUntilIso: holdIso,
          autoDecline: scheduleIntent.autoDecline,
        },
      });
      return [
        {
          text: formatScheduleAck({
            label,
            startHm,
            endHm,
            days,
            holdUntilIso: holdIso,
            autoDecline: scheduleIntent.autoDecline,
            timeZone: tz,
          }),
        },
      ];
    }
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
  if (closeCmd) {
    const closeItem = async (item: {
      kind?: string;
      eventId?: string | null;
      threadId?: string | null;
      commitmentId?: string | null;
      fingerprint?: string | null;
      label: string;
    }) => {
      if (!deps.closeBriefPriority) return { ok: false, message: "Close isn't wired." };
      return deps.closeBriefPriority(msg.userId, {
        kind: item.kind ?? null,
        eventId: item.eventId ?? null,
        threadId: item.threadId ?? null,
        commitmentId: item.commitmentId ?? null,
        fingerprint: item.fingerprint ?? null,
        label: item.label,
        status: closeCmd.status === "snoozed" ? "done" : closeCmd.status,
      });
    };

    // done / that's done → close the only brief priority, or ask which
    if (!closeCmd.titleHint) {
      if (deps.getLastBriefItems && deps.closeBriefPriority) {
        const stored = await deps.getLastBriefItems(msg.userId);
        if (stored.items.length === 1 && stored.items[0]) {
          const r = await closeItem(stored.items[0]);
          return [{ text: r.message }];
        }
        if (stored.items.length > 1) {
          return [
            {
              text: [
                "Which one?",
                ...stored.items.map((i) => `${i.index}) ${i.label}`),
                "",
                "Reply done 1 / done 2 / done 3.",
              ].join("\n"),
            },
          ];
        }
      }
      return [
        {
          text: "Nothing on the last brief to mark done. Say done 1 after a brief, or done <title>.",
        },
      ];
    }

    // done 1 / done 2 / done 3 → close last brief priority by index
    const idxMatch = closeCmd.titleHint.match(/^([123])$/);
    if (idxMatch && deps.closeBriefPriority && deps.getLastBriefItems) {
      const stored = await deps.getLastBriefItems(msg.userId);
      const item = stored.items.find((i) => i.index === Number(idxMatch[1]));
      if (!item) {
        return [
          {
            text: stored.items.length
              ? `No item ${idxMatch[1]} in the last brief. Available: ${stored.items
                  .map((i) => i.index)
                  .join(", ")}.`
              : "No brief items stored yet — send brief first.",
          },
        ];
      }
      const r = await closeItem(item);
      return [{ text: r.message }];
    }

    if (deps.resolveCommitment) {
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
    }

    // Mail / brief priority by label (after commitment miss).
    if (
      deps.closeBriefPriority &&
      (closeCmd.status === "done" || closeCmd.status === "dropped")
    ) {
      // Prefer matching a stored brief item label first.
      if (deps.getLastBriefItems) {
        const stored = await deps.getLastBriefItems(msg.userId);
        const needle = closeCmd.titleHint.toLowerCase();
        const item = stored.items.find(
          (i) =>
            i.label.toLowerCase().includes(needle) ||
            needle.includes(i.label.toLowerCase().slice(0, 24)),
        );
        if (item) {
          const r = await closeItem(item);
          if (r.ok) return [{ text: r.message }];
        }
      }
      const r = await deps.closeBriefPriority(msg.userId, {
        kind: "mail",
        label: closeCmd.titleHint,
        status: closeCmd.status,
      });
      if (r.ok) return [{ text: r.message }];
      return [{ text: r.message }];
    }

    return [
      {
        text: `No open commitment matching “${closeCmd.titleHint}”. Send status to list, or done 1 after a brief.`,
      },
    ];
  }

  const waitingMail = parseWaitingForMail(text);
  const mailLookup =
    parseMailLookup(text) ??
    (waitingMail
      ? { query: waitingMail.query, lookbackDays: waitingMail.lookbackDays }
      : null);

  // Bare "yes" after Amilo offered to search mail → actually search.
  if (
    !mailLookup &&
    !openPending &&
    isBareAffirmative(text) &&
    deps.searchMail &&
    deps.getRecentChatSummary
  ) {
    const summaryForYes = await deps.getRecentChatSummary(msg.userId, {
      ...(msg.messageId ? { excludeMessageId: msg.messageId } : {}),
    });
    const pendingSearch = pendingMailSearchFromChat(summaryForYes);
    if (pendingSearch) {
      const prepared = await prepareMailFind(msg.userId, pendingSearch, deps);
      if (prepared.early && !prepared.hits.length) return prepared.early;
      if (prepared.hits.length) {
        const lines = prepared.hits.slice(0, 5).map((h, i) => {
          const when = h.date ? ` (${h.date})` : "";
          return `${i + 1}) ${h.subject} — ${h.from}${when}`;
        });
        return [
          {
            text: [
              `Found ${prepared.hits.length} for “${pendingSearch.query}”:`,
              ...lines,
              "",
              "Reply with a number for detail, or say summarize.",
            ].join("\n"),
          },
        ];
      }
    }
  }

  if (mailLookup && deps.searchMail) {
    const prepared = await prepareMailFind(msg.userId, mailLookup, deps);
    if (prepared.early) {
      if (waitingMail && !prepared.hits.length && deps.createWaitingOnWatch) {
        const w = await deps.createWaitingOnWatch(msg.userId, {
          person: mailLookup.query,
          thing: "email",
        });
        const first = prepared.early[0];
        const noneText = first && "text" in first ? first.text : "";
        return [{ text: `${noneText} ${w.message}`.trim() }];
      }
      return prepared.early;
    }
    // Hits saved as working set — fall through to the brain for yes + CTAs.
  } else if (isLookbackOnlyMessage(text) && deps.searchMail && deps.getMailWorkingSet) {
    const stored = await deps.getMailWorkingSet(msg.userId);
    const prior =
      stored && isMailWorkingSetFresh(stored)
        ? stored
        : deps.getRecentChatSummary
          ? mailLookupFromChatSummary(
              await deps.getRecentChatSummary(msg.userId, {
                ...(msg.messageId ? { excludeMessageId: msg.messageId } : {}),
              }),
            )
          : null;
    if (prior) {
      const days = parseMailLookbackDays(text) ?? prior.lookbackDays;
      const prepared = await prepareMailFind(
        msg.userId,
        { query: prior.query, lookbackDays: days },
        deps,
      );
      if (prepared.early) return prepared.early;
    }
  }

  if (deps.setTimezone) {
    const tzUpdate = parseTimezoneUpdateMessage(text);
    if (tzUpdate) {
      await deps.setTimezone(msg.userId, tzUpdate, true);
      const tzLine = `Timezone set to ${timezoneFriendlyLabel(tzUpdate)} (${tzUpdate}). Briefs and reminders use this.`;
      return [{ text: tzLine }];
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
  if (isReminderAsk(text) && deps.createReminders && !reminderSpecs.length) {
    return [
      {
        text: "When should I remind you — a time (1 min on calendar, even over a meeting), or just a day (I'll ping after that morning brief)?",
      },
    ];
  }

  if (isGoogleListCommand(text)) {
    return replyGoogleList(msg.userId, deps);
  }

  const connectCmd = parseConnectGoogleCommand(text);
  if (connectCmd) {
    if (!deps.getGoogleAuthUrl) {
      return [{ text: "Google connect isn't configured on this server yet." }];
    }
    let label = connectCmd.rawLabel ? normalizeGoogleLabel(connectCmd.rawLabel) : "";
    if (!label) {
      const existing = deps.listGoogleAccounts
        ? await deps.listGoogleAccounts(msg.userId)
        : [];
      if (connectCmd.kind === "connect" && existing.some((a) => a.label === "personal")) {
        return [
          {
            text: [
              "You already have a personal Google link.",
              "Reconnect it (grants send if missing): reconnect google personal",
              "Or add another: connect google work",
              "",
              "See linked accounts: google",
            ].join("\n"),
          },
        ];
      }
      label = existing[0]?.label || "personal";
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
          connectCmd.kind === "reconnect"
            ? `Tap to reconnect Gmail + Calendar as “${label}” (must allow Send email):`
            : `Tap to connect Gmail + Calendar as “${label}” (read, send, calendar):`,
          "",
          url,
          "",
          "Pick the right Google account in the browser. After connect, reply yes if a draft is waiting, or send sync.",
        ].join("\n"),
      },
    ];
  }

  const uberCmd = parseConnectUberCommand(text);
  if (uberCmd) {
    if (uberCmd.kind === "disconnect") {
      if (!deps.disconnectUber) {
        return [{ text: "Uber unlink isn't configured on this server yet." }];
      }
      return [{ text: await deps.disconnectUber(msg.userId) }];
    }
    if (!deps.getUberAuthUrl) {
      return [{ text: "Uber connect isn't configured (set UBER_CLIENT_ID / UBER_CLIENT_SECRET)." }];
    }
    const url = await deps.getUberAuthUrl(msg.userId);
    if (!url) {
      return [{ text: "Uber OAuth isn't configured on this server yet." }];
    }
    return [
      {
        text: [
          uberCmd.kind === "reconnect"
            ? "Tap to reconnect Uber (ride quotes + book after you confirm):"
            : "Tap to connect Uber (ride quotes + book after you confirm):",
          "",
          url,
          "",
          "After connect: book Uber to <place>. Pickup uses your saved home/office.",
        ].join("\n"),
      },
    ];
  }

  const disconnectCmd = parseDisconnectGoogleCommand(text);
  if (disconnectCmd) {
    return replyDisconnectGoogle(msg.userId, disconnectCmd.rawLabel, deps);
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

  const syncCmd = parseSyncCommand(text);
  if (syncCmd) {
    return replySyncGoogle(msg.userId, syncCmd.label, deps);
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
      let textOut = `${headline}\n\n${brief.digestText}${footer}`;
      if (kind === "am" && deps.maybeAppendOnboardingTip) {
        textOut = await deps.maybeAppendOnboardingTip(msg.userId, textOut);
      }
      textOut = textOut.slice(0, 3500);
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
          ...(ctx.calendarTomorrow ? { calendarTomorrow: ctx.calendarTomorrow } : {}),
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
        calendarTomorrow: "none yet",
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

  // Life-ops research (movies/dining/flights) → Grok session + web search + this user's
  // context graph. Deterministic Places/scrape short-circuit retired.
  // Option pick / book / reserve: find-only — never invent a book/pay handoff pending.
  {
    const pickIdRaw = parseLifeOpsOptionPick(text);
    if (pickIdRaw) {
      const source = optionPickSource({
        recentChat: recentChatSummary,
        replyToContent: msg.replyToContent,
      });
      const pickId = coerceOptionPick(pickIdRaw, source) ?? pickIdRaw;
      const listKind = classifyOptionListKind(source);
      const venue = source ? resolveListedOptionVenue(source, pickId) : null;

      if (venue && (listKind === "travel" || listKind === "cab" || listKind === "movie")) {
        return [
          {
            text: [
              `Got it — ${venue}.`,
              vendorBookingUnavailableReply({
                venueHint: venue,
                vendorKind: listKind,
              }),
            ].join("\n"),
          },
        ];
      }

      if (venue && listKind === "dining" && !isBookPlatformOnly(venue)) {
        const diningCtx = extractLifeOpsDiningContext(
          recentChatSummary,
          text,
          msg.replyToContent,
        );
        const mapsUrl = resolveListedOptionMapsUrl(source, pickId, venue);
        return [
          {
            text: diningPickAckReply({
              venue,
              mapsUrl,
              whenHint: diningCtx?.whenHint ?? null,
              partySize: diningCtx?.partySize ?? null,
            }),
          },
        ];
      }
    }
  }

  // Soft yes to "Shall I block your calendar?" after a dining pick (venue + when known).
  if (
    deps.createPending &&
    isDiningCalendarBlockAffirm(text) &&
    /Shall I block your calendar/i.test(recentChatSummary ?? "")
  ) {
    const diningCtx = extractLifeOpsDiningContext(
      recentChatSummary,
      text,
      msg.replyToContent,
    );
    if (diningCtx?.venue && diningCtx.whenHint) {
      const calText = mergeCalendarFollowUp(
        mergeLifeOpsIntoCalendarText(
          `block calendar Dinner at ${diningCtx.venue} ${diningCtx.whenHint}`,
          recentChatSummary,
        ),
        recentChatSummary,
        briefCtx.timezone,
      );
      const hint = parseCalendarCreateHint(calText, briefCtx.timezone);
      if (hint) {
        const location =
          (await resolveCalendarLocation(msg.userId, calText, deps)) ??
          diningCtx.venue;
        return proposeCalendarCreatePending(msg, deps, briefCtx.timezone, {
          title:
            diningCtx.vibe === "pub"
              ? `Drinks at ${diningCtx.venue}`
              : `Dinner at ${diningCtx.venue}`,
          start: hint.startIso,
          end: hint.endIso,
          startIso: hint.startIso,
          endIso: hint.endIso,
          location,
        });
      }
    }
  }

  // Vendor book/reserve: state limitation + offer find. No final pay/confirm link.
  // Calendar "book meeting" and errand email handoffs stay on their own paths.
  {
    const activeDomain = resolveActiveDomain({
      text,
      ...(recentChatSummary != null ? { recentChat: recentChatSummary } : {}),
      ...(msg.replyToContent != null ? { replyToContent: msg.replyToContent } : {}),
      ...(openPending != null ? { openPending } : {}),
    });

    if (
      isWhenPartyFollowUp(text) &&
      !parseLifeOpsHandoffIntent(text) &&
      (activeDomain === "dining" || activeDomain === null) &&
      !looksLikeMovieTicketAsk(text) &&
      !looksLikeCalendarBookingAsk(text)
    ) {
      const diningCtx = extractLifeOpsDiningContext(
        recentChatSummary,
        text,
        msg.replyToContent,
      );
      const diningLocked =
        activeDomain === "dining" ||
        Boolean(diningCtx?.venue && latestDiningThread(recentChatSummary));
      if (
        diningLocked &&
        diningCtx?.venue &&
        diningCtx.whenHint &&
        !isBookPlatformOnly(diningCtx.venue)
      ) {
        const mapsUrl = shortMapsSearchUrl(
          diningCtx.venue,
          diningCtx.area ?? null,
        );
        return [
          {
            text: diningPickAckReply({
              venue: diningCtx.venue,
              mapsUrl,
              whenHint: diningCtx.whenHint,
              partySize: diningCtx.partySize,
            }),
          },
        ];
      }
    }

    if (isVendorBookOrReserveAsk(text) && !looksLikeCalendarBookingAsk(text)) {
      const vendorKind = classifyVendorHandoffKind(
        text,
        recentChatSummary,
        msg.replyToContent,
      );
      const handoff = parseLifeOpsHandoffIntent(text);
      const diningCtx =
        vendorKind === "dining" || activeDomain === "dining"
          ? extractLifeOpsDiningContext(recentChatSummary, text, msg.replyToContent)
          : null;
      const venueHint =
        (handoff?.venueHint && !isBookPlatformOnly(handoff.venueHint)
          ? cleanBookVenueName(handoff.venueHint) ?? handoff.venueHint
          : null) ??
        diningCtx?.venue ??
        parseCabProvider(text) ??
        null;
      const kindForReply =
        vendorKind !== "other"
          ? vendorKind
          : activeDomain === "dining" ||
              activeDomain === "cab" ||
              activeDomain === "movie" ||
              activeDomain === "travel"
            ? activeDomain
            : null;
      return [
        {
          text: vendorBookingUnavailableReply({
            venueHint,
            vendorKind: kindForReply,
          }),
        },
      ];
    }

    // Catch any remaining vendor handoff intent (locked domain) without calendar confusion.
    const handoff = parseLifeOpsHandoffIntent(text);
    if (handoff && handoff.channel === "vendor" && !looksLikeCalendarBookingAsk(text)) {
      const vendorKind = classifyVendorHandoffKind(
        text,
        recentChatSummary,
        msg.replyToContent,
      );
      return [
        {
          text: vendorBookingUnavailableReply({
            venueHint:
              (handoff.venueHint && !isBookPlatformOnly(handoff.venueHint)
                ? cleanBookVenueName(handoff.venueHint) ?? handoff.venueHint
                : null) ?? null,
            vendorKind,
          }),
        },
      ];
    }

    if (deps.createPending) {
      const errand = parseInboxErrandDraftAsk(text);
      if (errand) {
        return proposeEmailComposePending(
          msg,
          deps,
          {
            mode: errand.mode,
            toHint: errand.toHint,
            about: errand.about,
            sourceText: text,
          },
          { userName: name },
        );
      }

      if (isAppointmentEmailAsk(text)) {
        return proposeAppointmentNotifyPending(
          msg,
          deps,
          text,
          recentChatSummary ?? "",
          briefCtx.timezone,
          name,
        );
      }
    }
  }

  // Calendar invite by name — resolve stored email, propose calendar_create (not email draft).
  {
    const calText = mergeCalendarFollowUp(
      mergeLifeOpsIntoCalendarText(text, recentChatSummary),
      recentChatSummary,
      briefCtx.timezone,
    );
    if (deps.createPending && isCalendarInviteIntent(calText)) {
      const hint = parseCalendarCreateHint(calText, briefCtx.timezone);
      if (hint) {
        const attendees = await resolveAttendeesFromMessage(msg.userId, calText, deps);
        if (!attendees.length) {
          const names = extractInviteeNames(calText);
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
              extractInviteeNames(calText)[0] ??
              (email.startsWith("rajeev@") ? "Rajeev" : email.split("@")[0] ?? "Contact");
            await deps.rememberContactEmail(msg.userId, { label, email });
          }
        }
        const withName = extractInviteeNames(calText)[0];
        const diningCtx = lifeOpsCalendarInheritance(text, recentChatSummary);
        const title =
          hint.title && !/^(busy|event|meeting)$/i.test(hint.title)
            ? hint.title
            : diningCtx?.venue
              ? `${diningCtx.vibe === "pub" ? "Drinks" : "Dinner"} at ${diningCtx.venue}${withName ? ` · ${withName}` : ""}`
              : withName
                ? `Meeting with ${withName}`
                : "Meeting";
        const location =
          (await resolveCalendarLocation(msg.userId, calText, deps)) ??
          diningCtx?.venue ??
          null;
        return proposeCalendarCreatePending(msg, deps, briefCtx.timezone, {
          title,
          start: hint.startIso,
          end: hint.endIso,
          startIso: hint.startIso,
          endIso: hint.endIso,
          attendees,
          ...(location ? { location } : {}),
        });
      }
    }
  }

  // Standing calendar block / meeting (before brain — avoids wrong "tomorrow" invents).
  if (deps.createPending) {
    const calText = mergeCalendarFollowUp(
      mergeLifeOpsIntoCalendarText(text, recentChatSummary),
      recentChatSummary,
      briefCtx.timezone,
    );
    const hint = parseCalendarCreateHint(calText, briefCtx.timezone);
    if (hint && !isAppointmentEmailAsk(calText) && !isAppointmentEmailAsk(text)) {
      const diningCtx = lifeOpsCalendarInheritance(text, recentChatSummary);
      const location =
        (await resolveCalendarLocation(msg.userId, calText, deps)) ??
        diningCtx?.venue ??
        null;
      const attendees = await resolveAttendeesFromMessage(msg.userId, calText, deps);
      const withName = extractInviteeNames(calText)[0];
      const title =
        diningCtx?.venue && /^(busy|event|meeting|calendar)$/i.test(hint.title.trim())
          ? `${diningCtx.vibe === "pub" ? "Drinks" : "Dinner"} at ${diningCtx.venue}`
          : hint.title && !/^(busy|event)$/i.test(hint.title) && !/^it$/i.test(hint.title)
            ? hint.title
            : withName
              ? `Meeting with ${withName}`
              : hint.title;
      return proposeCalendarCreatePending(msg, deps, briefCtx.timezone, {
        title,
        start: hint.startIso,
        end: hint.endIso,
        startIso: hint.startIso,
        endIso: hint.endIso,
        ...(attendees.length ? { attendees } : {}),
        ...(location ? { location } : {}),
      });
    }
  }

  const googleAccounts = deps.listGoogleAccounts
    ? await deps.listGoogleAccounts(msg.userId)
    : [];
  const googleAccountsSummary = googleAccounts.length
    ? googleAccounts.map((a) => `${a.label}=${a.email ?? "pending"}`).join(" · ")
    : "none";

  const storedMailSet = deps.getMailWorkingSet
    ? await deps.getMailWorkingSet(msg.userId)
    : null;
  const mailWorkingSetText =
    storedMailSet && isMailWorkingSetFresh(storedMailSet)
      ? formatMailWorkingSet(storedMailSet)
      : undefined;

  const scopedRecentChat = recentChatSummary
    ? scopeRecentChatForResearch(recentChatSummary, text)
    : null;

  const interpretCtx = {
    userId: msg.userId,
    name: name || "there",
    timezone: briefCtx.timezone,
    vipList: briefCtx.vipList,
    ignoredPatterns: briefCtx.ignoredPatterns,
    openCommitmentsSummary: briefCtx.openCommitmentsSummary,
    calendarToday: briefCtx.calendarToday,
    ...(briefCtx.calendarTomorrow
      ? { calendarTomorrow: briefCtx.calendarTomorrow }
      : {}),
    contextGraphSummary,
    ...(scopedRecentChat ? { recentChatSummary: scopedRecentChat } : {}),
    ...(replyToSummary ? { replyToSummary } : {}),
    recentMail: briefCtx.recentMail,
    googleAccountsSummary,
    ...(mailWorkingSetText ? { mailWorkingSet: mailWorkingSetText } : {}),
    ...(msg.imageDataUrl ? { imageDataUrl: msg.imageDataUrl } : {}),
  };

  let result = await deps.brain.interpret(interpretCtx, text);

  if (result.intent.type === "propose_action") {
    const brainType = String(result.intent.action.type ?? "").toLowerCase();
    if (/disconnect|unlink/.test(brainType)) {
      const raw =
        String(result.intent.action.label ?? result.intent.action.accountLabel ?? "").trim() ||
        null;
      return replyDisconnectGoogle(
        msg.userId,
        raw ? (raw.toLowerCase() === "all" ? "all" : raw) : null,
        deps,
      );
    }
    if (brainType === "sync" || brainType === "sync_google") {
      const label = String(result.intent.action.label ?? result.intent.action.accountLabel ?? "").trim();
      return replySyncGoogle(msg.userId, label || undefined, deps);
    }
    if (brainType === "connect" || brainType === "connect_google") {
      return [
        {
          text: "I won't invent a Google connect. Send: connect google personal (or another label).",
        },
      ];
    }
    if (
      brainType === "search_mail" ||
      brainType === "find_mail"
    ) {
      const q = String(result.intent.action.query ?? result.intent.action.q ?? text).trim();
      const parsed = parseMailLookup(q) ?? parseMailLookup(text);
      const tokens = mailSearchTokens(q);
      const query = parsed?.query || (tokens.length ? q : mailLookupFromChatSummary(recentChatSummary)?.query);
      if (query) {
        const prepared = await prepareMailFind(
          msg.userId,
          { query, lookbackDays: parsed?.lookbackDays ?? 14 },
          deps,
        );
        if (prepared.early && !prepared.hits.length) return prepared.early;
        if (prepared.hits.length) {
          result = await deps.brain.interpret(
            {
              ...interpretCtx,
              mailWorkingSet: formatMailWorkingSet(
                hitsToWorkingSet(query, parsed?.lookbackDays ?? 14, prepared.hits),
              ),
            },
            text,
          );
        }
      }
    }
  }

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
      const fromText = parseReminderMessage(text, briefCtx.timezone);
      if (fromText.length) {
        return scheduleRemindersReply(msg.userId, briefCtx.timezone, fromText, deps);
      }
      return scheduleRemindersReply(
        msg.userId,
        briefCtx.timezone,
        [{ title, dueAt, kind: "timed" }],
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
      "life_ops_research",
      "life_ops_handoff",
      "create_event",
      "update_event",
      "cancel_event",
      "send_email",
      "email",
      "draft_email",
      "research",
      "handoff",
    ]);
    if (writeKinds.has(type)) {
      let kind = type;
      if (type === "create_event") kind = "calendar_create";
      if (type === "update_event") kind = "calendar_update";
      if (type === "cancel_event") kind = "calendar_cancel";
      if (type === "send_email" || type === "email" || type === "draft_email") {
        kind = "email_draft";
      }
      if (type === "research") kind = "life_ops_research";
      if (type === "handoff") kind = "life_ops_handoff";

      const payload: Record<string, unknown> = { ...action };
      delete payload.type;
      if (!payload.accountLabel) payload.accountLabel = "personal";
      if (kind === "email_draft" && deps.listGoogleAccounts) {
        const sendAcct = pickGmailSendAccount(
          await deps.listGoogleAccounts(msg.userId),
          String(payload.accountLabel),
        );
        if (sendAcct) payload.accountLabel = sendAcct.label;
      }

      // Domain mismatch: never accept Zomato/dining handoff for a movie ticket ask.
      // Vendor book/pay handoffs are retired until partner APIs — state limitation instead.
      if (kind === "life_ops_handoff") {
        const askDomain = resolveActiveDomain({
          text,
          ...(recentChatSummary != null ? { recentChat: recentChatSummary } : {}),
          ...(msg.replyToContent != null ? { replyToContent: msg.replyToContent } : {}),
          ...(openPending != null ? { openPending } : {}),
        });
        const scriptBlob = [
          String(payload.script ?? ""),
          String(payload.summary ?? ""),
          String(action.summary ?? ""),
        ].join("\n");
        const looksDiningScript =
          /zomato|dineout|eazydiner|table for/i.test(scriptBlob) &&
          !/bookmyshow|showtimes?/i.test(scriptBlob);
        if (
          (askDomain === "movie" || looksLikeMovieTicketAsk(text)) &&
          (looksDiningScript || String(payload.vendorKind ?? "").toLowerCase() === "dining")
        ) {
          return [
            {
              text: "That looked like a movie ticket ask — I’ll research showtimes instead of restaurant links. Ask again with the film + city (or theatre).",
            },
          ];
        }
        if (looksLikeMovieTicketAsk(text) || askDomain === "movie") {
          payload.vendorKind = "movie";
        }
        const handoffSummary = String(payload.summary ?? action.summary ?? "").trim();
        if (isWeakLifeOpsHandoffSummary(handoffSummary) && !String(payload.script ?? "").trim()) {
          return [
            {
              text: vendorBookingUnavailableReply({
                vendorKind:
                  askDomain === "dining" ||
                  askDomain === "cab" ||
                  askDomain === "movie" ||
                  askDomain === "travel"
                    ? askDomain
                    : null,
              }),
            },
          ];
        }
        const vkRaw = String(payload.vendorKind ?? "").toLowerCase();
        const vk =
          vkRaw === "dining" || vkRaw === "cab" || vkRaw === "movie" || vkRaw === "travel"
            ? vkRaw
            : askDomain === "dining" ||
                askDomain === "cab" ||
                askDomain === "movie" ||
                askDomain === "travel"
              ? askDomain
              : classifyVendorHandoffKind(text, recentChatSummary, msg.replyToContent);
        if (
          !looksLikeCalendarBookingAsk(text) &&
          (vk === "dining" ||
            vk === "cab" ||
            vk === "movie" ||
            vk === "travel" ||
            /zomato|dineout|eazydiner|bookmyshow|m\.uber|ola\.cabs/i.test(scriptBlob))
        ) {
          return [
            {
              text: vendorBookingUnavailableReply({
                venueHint: String(payload.venueHint ?? "").trim() || null,
                vendorKind: vk === "other" ? null : vk,
              }),
            },
          ];
        }
      }

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
        const composeAsk = !isCalendarInviteIntent(text) ? parseEmailComposeAsk(text) : null;
        const toRaw = strPayload(payload.to);
        if (toRaw) {
          payload.to = normalizeAttendeeEmail(toRaw);
        } else if (deps.resolveContactEmail) {
          const names = [
            ...(composeAsk?.toHint && !composeAsk.toHint.includes("@") ? [composeAsk.toHint] : []),
            ...extractInviteeNames(text),
          ];
          for (const n of names) {
            const hit = await deps.resolveContactEmail(msg.userId, n);
            if (hit?.email) {
              payload.to = hit.email;
              payload.recipientLabel = n;
              break;
            }
          }
        }
        if (composeAsk?.toHint && !strPayload(payload.recipientLabel)) {
          payload.recipientLabel = composeAsk.toHint;
        }
        if (composeAsk?.mode === "draft") payload.draftOnly = true;
        const polished = polishEmailDraftPayload(payload, {
          sourceText: text,
          userName: name,
          toHint: composeAsk?.toHint ?? strPayload(payload.recipientLabel),
        });
        Object.assign(payload, polished);
        if (strPayload(payload.to) && deps.rememberContactEmail) {
          const names = [
            ...(composeAsk?.toHint && !composeAsk.toHint.includes("@") ? [composeAsk.toHint] : []),
            ...extractInviteeNames(text),
          ].map((n) => cleanPersonLabel(n) ?? n);
          const label = names.find((n) => isPersistableContactLabel(n));
          if (label) {
            await deps.rememberContactEmail(msg.userId, {
              label,
              email: strPayload(payload.to),
            });
          }
        }
      }

      // Prefer local parse of the user message over model ISO (avoids wrong year/raw stamps).
      if (kind === "calendar_create") {
        const inheritCtx = lifeOpsCalendarInheritance(text, recentChatSummary);
        const calText = mergeLifeOpsIntoCalendarText(text, recentChatSummary);
        const hint = parseCalendarCreateHint(calText, briefCtx.timezone);
        if (hint) {
          payload.title =
            inheritCtx?.venue && /^(busy|event|meeting|calendar)$/i.test(hint.title.trim())
              ? `${inheritCtx.vibe === "pub" ? "Drinks" : "Dinner"} at ${inheritCtx.venue}`
              : hint.title;
          payload.start = hint.startIso;
          payload.end = hint.endIso;
          payload.startIso = hint.startIso;
          payload.endIso = hint.endIso;
        }
        const ownLoc = extractEventLocation(text);
        const sharedLoc = refersToSharedPlace(text)
          ? await resolveCalendarLocation(msg.userId, text, deps)
          : null;
        const loc = ownLoc || sharedLoc || inheritCtx?.venue || null;
        if (loc) payload.location = loc;
        else delete payload.location;
        const attendees = await resolveAttendeesFromMessage(
          msg.userId,
          calText,
          deps,
          payload.attendees,
        );
        if (attendees.length) {
          payload.attendees = attendees;
          for (const email of attendees) {
            if (deps.rememberContactEmail) {
              const label =
                extractInviteeNames(calText)[0] ??
                (email.startsWith("rajeev@") ? "Rajeev" : email.split("@")[0] ?? "Contact");
              await deps.rememberContactEmail(msg.userId, { label, email });
            }
          }
        }
      }

      // life_ops_research propose_action retired — prefer reply_text + web search.
      if (kind === "life_ops_research") {
        const reply = String(payload.summary ?? payload.query ?? "").trim();
        return [
          {
            text:
              reply ||
              "Ask me as a normal question — e.g. which Hindi movies are playing near Arekere.",
          },
        ];
      }

      let conflictNote: string | null = null;
      if (kind === "calendar_create" && deps.checkCalendarConflict) {
        const startIso = strPayload(payload.start) || strPayload(payload.startIso);
        let endIso = strPayload(payload.end) || strPayload(payload.endIso);
        if (startIso && !endIso) {
          const startMs = Date.parse(startIso);
          if (!Number.isNaN(startMs)) {
            endIso = new Date(startMs + 60 * 60 * 1000).toISOString();
            payload.end = endIso;
            payload.endIso = endIso;
          }
        }
        if (startIso && endIso) {
          try {
            const conflict = await deps.checkCalendarConflict(msg.userId, {
              startIso,
              endIso,
              timezone: briefCtx.timezone,
            });
            conflictNote = conflict.conflictNote;
            if (!conflict.clear) {
              // Keep requested time; user picks go-ahead vs alternate.
              payload.conflictWarning = true;
              if (conflict.conflictTitle) payload.conflictWith = conflict.conflictTitle;
              if (conflict.suggested) {
                payload.suggestedStart = conflict.suggested.startIso;
                payload.suggestedEnd = conflict.suggested.endIso;
              }
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
      } else if (kind === "life_ops_research" || kind === "life_ops_handoff") {
        const standingHandoff =
          kind === "life_ops_handoff" ? parseLifeOpsHandoffIntent(text) : null;
        const brainSummary =
          result.intent.summary?.trim() || String(action.summary ?? "").trim();
        // Reject empty "life ops" handoffs from the model — prefer standing parse or skip.
        if (
          kind === "life_ops_handoff" &&
          isWeakLifeOpsHandoffSummary(brainSummary) &&
          !standingHandoff
        ) {
          return [
            {
              text: "What should I hand off? Say e.g. Book Uber, or Book Katani Dhaba Fri 8pm.",
            },
          ];
        }
        const cap = formatMoneyCapNote(
          typeof payload.moneyCapInr === "number"
            ? payload.moneyCapInr
            : parseMoneyCapInr(text),
        );
        summary = [
          !isWeakLifeOpsHandoffSummary(brainSummary)
            ? brainSummary
            : standingHandoff?.summary?.trim() ||
              `${kind}: ${String(payload.query ?? payload.domain ?? "life ops")}`,
          cap,
        ]
          .filter(Boolean)
          .join("\n");
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
        return withGmailSendAuthNotice(
          msg.userId,
          deps,
          payload,
          emailDraftMessages(payload, emailDraftMode(payload, parseEmailComposeAsk(text))),
        );
      }

      if (kind === "life_ops_research" || kind === "life_ops_handoff") {
        return [
          {
            text: [
              `Proposed (${pending.kind}):`,
              pending.summary,
              "",
              "Nothing booked, spent, or sent yet. Reply yes to lock, cancel to drop.",
            ].join("\n"),
          },
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
            conflictNote && kind === "calendar_create"
              ? "Reply yes to go ahead anyway, alternate for next free, or cancel."
              : "Reply yes to write to Google Calendar, cancel to drop.",
          ].join("\n"),
        },
      ];
    }
  }

  const brainSaid = result.intent.type === "reply_text" ? result.intent.text.trim() : "";
  if (
    deps.searchMail &&
    looksLikeInventedMailMiss(brainSaid) &&
    !(storedMailSet && isMailWorkingSetFresh(storedMailSet) && storedMailSet.hits.length)
  ) {
    const parsed = parseMailLookup(text);
    const tokens = mailSearchTokens(text);
    const query =
      parsed?.query ||
      (tokens.length ? tokens.join(" ") : mailLookupFromChatSummary(recentChatSummary)?.query);
    if (query) {
      const prepared = await prepareMailFind(
        msg.userId,
        { query, lookbackDays: parsed?.lookbackDays ?? 14 },
        deps,
      );
      if (prepared.early && !prepared.hits.length) return prepared.early;
      if (prepared.hits.length) {
        result = await deps.brain.interpret(
          {
            ...interpretCtx,
            mailWorkingSet: formatMailWorkingSet(
              hitsToWorkingSet(query, parsed?.lookbackDays ?? 14, prepared.hits),
            ),
          },
          text,
        );
      }
    }
  }

  switch (result.intent.type) {
    case "reply_text": {
      const composeAsk = !isCalendarInviteIntent(text) ? parseEmailComposeAsk(text) : null;
      if (composeAsk && deps.createPending) {
        return proposeEmailComposePending(msg, deps, composeAsk, { userName: name });
      }
      const replyRaw = sanitizeLifeOpsReplyText(result.intent.text.trim(), {
        ...(recentChatSummary != null ? { recentChat: recentChatSummary } : {}),
      });
      const replyFactual =
        looksLikeFactualMarketText(text) ||
        looksLikeFactualMarketText(replyRaw) ||
        looksLikeFactualMarketText(msg.replyToContent) ||
        Boolean(msg.imageDataUrl)
          ? sanitizeFactualReplyText(replyRaw, {
              userText: text,
              ...(recentChatSummary != null ? { recentChat: recentChatSummary } : {}),
              ...(msg.replyToContent != null ? { replyToContent: msg.replyToContent } : {}),
              timeZone: briefCtx.timezone,
            })
          : replyRaw;
      const reply = replyFactual;
      // Bare option picks never re-wrap as a new research list — handoff path owns those.
      // Never wrap macro/IQ numbered lists (bond yields, IPO facts) as life_ops_research.
      const isBareOptionPick = Boolean(parseLifeOpsOptionPick(text));
      const userLifeOpsAsk =
        looksLikeMovieTicketAsk(text) || Boolean(parseLifeOpsResearchIntent(text));
      if (
        reply &&
        deps.createPending &&
        !isBareOptionPick &&
        userLifeOpsAsk &&
        isLifeOpsResearchShortlist(reply)
      ) {
        const listKind = classifyOptionListKind(reply);
        await deps.createPending({
          userId: msg.userId,
          kind: "life_ops_research",
          summary: reply.slice(0, 480),
          payload: {
            domain: listKind === "travel" ? "travel" : "home",
            query: text,
            findings: reply,
            vendorKind: listKind,
          },
        });
        // Show Grok findings as normal chat — do not label Proposed (life_ops_research).
        // Do not append a second "Reply with a letter…" footer (Grok already ends with one).
        return outboundTextsFromReply(reply);
      }
      if (reply) return outboundTextsFromReply(reply);
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
