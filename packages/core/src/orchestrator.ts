import type { BrainPort, GraphUpdate } from "@amilo/brain-contract";
import type { ChannelPort, InboundMessage, OutboundMessage } from "./channel.js";

const STANDING: Record<string, string> = {
  help: [
    "Commands:",
    "pause — stop everything, keep your data",
    "resume — start again",
    "delete my data — permanently erase your data",
    "help — show this message",
    "",
    "Talk normally for everything else — I'll keep you on what matters.",
  ].join("\n"),
  pause: "Paused. Your data stays. Send resume when you want me back.",
  resume: "Back. Watching quietly again.",
};

export interface OrchestratorDeps {
  brain: BrainPort;
  channel: ChannelPort;
  /** Resolve allowlisted / registered user; null = stranger (M1 lead capture). */
  resolveUserName: (userId: string) => Promise<string>;
  isPaused: (userId: string) => Promise<boolean>;
  setPaused: (userId: string, paused: boolean) => Promise<void>;
  /** Silent personal context for the brain. */
  getContextGraphSummary?: (userId: string) => Promise<string>;
  /** Persist graph deltas after interpret. */
  applyGraphUpdates?: (opts: {
    userId: string;
    userName: string;
    message: string;
    updates: GraphUpdate[];
    sourceMessageId?: string;
  }) => Promise<void>;
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
          "and keep you on your commitments. Everything else, I handle quietly.",
          "",
          'Send "help" anytime. Google connect lands in M4.',
        ].join("\n"),
      },
    ];
  }

  const name = await deps.resolveUserName(msg.userId);
  const contextGraphSummary = deps.getContextGraphSummary
    ? await deps.getContextGraphSummary(msg.userId)
    : "none yet";

  const result = await deps.brain.interpret(
    {
      userId: msg.userId,
      name: name || "there",
      timezone: "Asia/Kolkata",
      vipList: [],
      ignoredPatterns: [],
      openCommitmentsSummary: "none yet",
      calendarToday: "none yet",
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
      // Empty reply_text — still acknowledge so WhatsApp never goes dead-silent.
      return [
        {
          text: result.graphUpdates?.length
            ? "Got it."
            : "Got it — say more if you want me to act on that.",
        },
      ];
    }
    case "noop":
      // Chat path must not go silent; noop is for future push/idle jobs.
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
