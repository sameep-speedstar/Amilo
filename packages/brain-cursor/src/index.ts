import { Agent, CursorAgentError } from "@cursor/sdk";
import type {
  BrainPort,
  BrainUserContext,
  BriefingDraft,
  InterpretResult,
  TriageEventInput,
  TriageResult,
} from "@amilo/brain-contract";

export interface CursorBrainConfig {
  apiKey: string;
  model: string;
  /** GitHub URL of this Amilo repo — cloud agent clones `brain/` IQ docs. */
  repoUrl: string;
  startingRef?: string;
  /**
   * Load / persist durable cloud agent ids (`bc-…`) per Amilo user.
   * Resume avoids cold VM when possible.
   */
  agentStore: {
    get(userId: string): Promise<string | null>;
    set(userId: string, agentId: string): Promise<void>;
  };
}

function extractJson<T>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = (fenced?.[1] ?? text).trim();
  const start = raw.indexOf("{") >= 0 && (raw.indexOf("[") < 0 || raw.indexOf("{") < raw.indexOf("["))
    ? raw.indexOf("{")
    : raw.indexOf("[");
  const end = Math.max(raw.lastIndexOf("}"), raw.lastIndexOf("]"));
  if (start < 0 || end < 0) {
    throw new Error("Cursor brain returned no JSON");
  }
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

async function runPrompt(
  cfg: CursorBrainConfig,
  userId: string,
  prompt: string,
): Promise<string> {
  const existing = await cfg.agentStore.get(userId);
  try {
    const agent = existing
      ? await Agent.resume(existing, { apiKey: cfg.apiKey, model: { id: cfg.model } })
      : await Agent.create({
          apiKey: cfg.apiKey,
          model: { id: cfg.model },
          cloud: {
            repos: [{ url: cfg.repoUrl, startingRef: cfg.startingRef ?? "main" }],
          },
        });

    if (!existing && agent.agentId) {
      await cfg.agentStore.set(userId, agent.agentId);
    }

    try {
      const run = await agent.send(prompt);
      const result = await run.wait();
      if (result.status === "error") {
        throw new Error(`Cursor run failed: ${result.id}`);
      }
      return result.result ?? "";
    } finally {
      await agent[Symbol.asyncDispose]();
    }
  } catch (err) {
    if (err instanceof CursorAgentError) {
      throw new Error(`Cursor agent startup failed: ${err.message}`);
    }
    throw err;
  }
}

/**
 * Cursor cloud BrainPort.
 * M0 ships the wiring; production IQ prompts live under /brain and are refined in M3.
 */
export function createCursorBrain(cfg: CursorBrainConfig): BrainPort {
  return {
    async triage(ctx: BrainUserContext, events: TriageEventInput[]): Promise<TriageResult[]> {
      const prompt = [
        "You are Amilo's attention filter. Read brain/PRIORITY.md and brain/PERSONA.md in this repo.",
        "Return ONLY a JSON array of {eventId, bucket, score, reason}.",
        `User: ${ctx.name} (${ctx.timezone})`,
        `VIPs: ${ctx.vipList.join(", ") || "none"}`,
        `Ignored: ${ctx.ignoredPatterns.join(", ") || "none"}`,
        `Open commitments: ${ctx.openCommitmentsSummary}`,
        `Calendar today: ${ctx.calendarToday}`,
        `Events: ${JSON.stringify(events)}`,
      ].join("\n\n");
      const text = await runPrompt(cfg, ctx.userId, prompt);
      return extractJson<TriageResult[]>(text);
    },

    async brief(ctx: BrainUserContext, kind: BriefingDraft["kind"]): Promise<BriefingDraft> {
      const prompt = [
        "You are Amilo composing a briefing. Read brain/PERSONA.md and brain/PRIORITY.md.",
        "Return ONLY JSON: {kind, headline, items, handledQuietly, bodyText}.",
        `kind=${kind}`,
        `User: ${ctx.name}`,
        `Open commitments: ${ctx.openCommitmentsSummary}`,
        `Calendar today: ${ctx.calendarToday}`,
        "Hard cap: at most 5 needs_attention items. Always state how many were handled quietly.",
      ].join("\n\n");
      const text = await runPrompt(cfg, ctx.userId, prompt);
      return extractJson<BriefingDraft>(text);
    },

    async interpret(ctx: BrainUserContext, message: string): Promise<InterpretResult> {
      const prompt = [
        "You are Amilo interpreting a user WhatsApp message. Read brain/PERSONA.md.",
        'Return ONLY JSON: {"intent": {...}} matching InterpretResult in packages/brain-contract.',
        "Prefer reply_text. Never claim you wrote to Google — propose_action only.",
        `User: ${ctx.name}`,
        `Message: ${message}`,
      ].join("\n\n");
      const text = await runPrompt(cfg, ctx.userId, prompt);
      return extractJson<InterpretResult>(text);
    },
  };
}

/** Dev/test brain — no Cursor calls. */
export function createStubBrain(): BrainPort {
  return {
    async triage(_ctx, events) {
      return events.map((e) => ({
        eventId: e.eventId,
        bucket: "can_wait" as const,
        score: 40,
        reason: "Stub brain — Cursor not configured",
      }));
    },
    async brief(_ctx, kind) {
      return {
        kind,
        headline: "Stub briefing",
        items: [],
        handledQuietly: 0,
        bodyText: "Cursor brain not configured yet.",
      };
    },
    async interpret(_ctx, message) {
      return {
        intent: {
          type: "reply_text",
          text: `Amilo (stub brain): I heard “${message.slice(0, 200)}”. Wire CURSOR_API_KEY to enable the real brain.`,
        },
      };
    },
  };
}
