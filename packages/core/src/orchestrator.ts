import type { BrainPort, GraphUpdate } from "@amilo/brain-contract";
import type { ChannelPort, InboundMessage, OutboundMessage } from "./channel.js";

const STANDING: Record<string, string> = {
  help: [
    "Commands:",
    "pause / resume — stop or restart Amilo",
    "connect google <label> — link an account (personal, work, …)",
    "google — list linked accounts",
    "disconnect google <label|all> — unlink (Telegram LifeOS untouched)",
    "sync — pull mail + today's calendar from all linked accounts",
    "brief / morning — on-demand briefing",
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
  syncGoogle?: (
    userId: string,
  ) => Promise<{ mail: number; calendar: number; accounts: number }>;
  isGoogleConnected?: (userId: string) => Promise<boolean>;
  getBriefingContext?: (userId: string) => Promise<{
    openCommitmentsSummary: string;
    calendarToday: string;
    recentMail: string;
    timezone: string;
  }>;
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
  if (lower === "hi" || lower === "hello" || lower === "/start") {
    const name = await deps.resolveUserName(msg.userId);
    return [
      {
        text: [
          `Hi${name ? ` ${name}` : ""} — I'm Amilo, your chief of staff.`,
          "",
          "I watch your inbox and calendar, surface only what needs you,",
          "and keep you on your commitments.",
          "",
          'Link mail with "connect google personal" (add work / more labels as needed), or help.',
        ].join("\n"),
      },
    ];
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

  if (lower === "sync") {
    if (!deps.syncGoogle) {
      return [{ text: "Sync isn't wired yet." }];
    }
    try {
      const r = await deps.syncGoogle(msg.userId);
      return [
        {
          text: `Synced ${r.accounts} account(s) — ${r.mail} mail, ${r.calendar} calendar events today. Send brief for a digest.`,
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
    try {
      await deps.syncGoogle(msg.userId);
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
    const draft = await deps.brain.brief(
      {
        userId: msg.userId,
        name: name || "there",
        timezone: ctx.timezone,
        vipList: [],
        ignoredPatterns: [],
        openCommitmentsSummary: ctx.openCommitmentsSummary,
        calendarToday: ctx.calendarToday,
        contextGraphSummary: deps.getContextGraphSummary
          ? await deps.getContextGraphSummary(msg.userId)
          : "none yet",
      },
      kind,
    );
    const body =
      draft.bodyText?.trim() ||
      [draft.headline, ...draft.items.map((i) => `${i.rank}. ${i.title} — ${i.reason}`)]
        .filter(Boolean)
        .join("\n");
    const mailHint =
      ctx.recentMail && ctx.recentMail !== "none yet"
        ? `\n\nRecent mail signals:\n${ctx.recentMail.split("\n").slice(0, 8).join("\n")}`
        : "";
    const textOut = `${body}${mailHint}`.slice(0, 3500);
    return [{ text: textOut || "Nothing urgent surfaced — you're clear." }];
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
        timezone: "Asia/Kolkata",
      };

  const result = await deps.brain.interpret(
    {
      userId: msg.userId,
      name: name || "there",
      timezone: briefCtx.timezone,
      vipList: [],
      ignoredPatterns: [],
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
    default:
      return [
        {
          text: "Got it — that action type lands in a later milestone. For now try help.",
        },
      ];
  }
}
