import type { BrainPort, GraphUpdate } from "@amilo/brain-contract";
import type { ChannelPort, InboundMessage, OutboundMessage } from "./channel.js";
import {
  formatLocalHm,
  isTimezoneAffirmative,
  parseReminderMessage,
  parseTimezoneUpdateMessage,
  timezoneFriendlyLabel,
} from "./time.js";

const STANDING: Record<string, string> = {
  help: [
    "Commands:",
    "pause / resume — stop or restart Amilo",
    "connect google <label> — link an account (personal, work, …)",
    "google — list linked accounts",
    "disconnect google <label|all> — unlink (Telegram LifeOS untouched)",
    "mute <phrase> — hide matching mail from sync/brief",
    "unmute <phrase> / mutes — manage muted phrases",
    "sync — pull mail + today's calendar from all linked accounts",
    "brief / morning / evening — on-demand briefing",
    "timezone — show or set your local time (travel: I'm in Dubai)",
    "remind me … at 12:30 — schedule a ping in your timezone",
    "help — show this message",
    "",
    "Talk normally for everything else.",
  ].join("\n"),
  pause: "Paused. Your data stays. Send resume when you want me back.",
  resume: "Back. Watching quietly again.",
};

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
}

function extractMutePatternFromMessage(message: string): string | null {
  const m = message.trim().match(
    /^(?:please\s+)?(?:mute|ignore|hide|don't show|do not show)\s+(.+?)(?:\s+emails?)?$/i,
  );
  if (!m?.[1]) return null;
  return m[1].replace(/^(the\s+|all\s+)/i, "").trim();
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

  if (lower === "help") {
    return [{ text: STANDING.help! }];
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

  // --- Timezone confirm / update (before other chat) ---
  const tzState = deps.getTimezoneState
    ? await deps.getTimezoneState(msg.userId)
    : { timezone: "Asia/Kolkata", tzConfirmed: true };

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
    isTimezoneAffirmative(text)
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

  if (lower === "hi" || lower === "hello" || lower === "/start") {
    const name = await deps.resolveUserName(msg.userId);
    const lines = [
      `Hi${name ? ` ${name}` : ""} — I'm Amilo, your chief of staff.`,
      "",
      "I watch your inbox and calendar, surface only what needs you,",
      "and keep you on your commitments.",
      "",
      'Link mail with "connect google personal" (add work / more labels as needed), or help.',
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

  const connectMatch = lower.match(/^(?:connect google|connect gmail)(?:\s+(\S+))?$/);
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

  if (lower === "brief" || lower === "morning" || lower === "evening") {
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
    const ctx = await deps.getBriefingContext(msg.userId);
    const kind = lower === "evening" ? "pm" : "am";
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

    // On-demand brief is always inside the 24h window (user just messaged).
    // Free-form keeps CALENDAR / MAIL bullets; WABA templates flatten newlines.
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
      return [{ text: `Noted — ${result.intent.summary || "I'll hold that for a later milestone."}` }];
    default:
      return [
        {
          text: "Got it — that action type lands in a later milestone. For now try help.",
        },
      ];
  }
}
