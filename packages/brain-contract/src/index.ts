/** Swappable IQ brain — Cursor cloud today, anything else later. */

export type AttentionBucket = "needs_attention" | "can_wait" | "handled";

export interface TriageEventInput {
  eventId: string;
  source: "gmail" | "calendar" | "note" | "manual";
  actor?: string;
  title?: string;
  snippet?: string;
  kind?: string;
  meta?: Record<string, unknown>;
}

export interface TriageResult {
  eventId: string;
  bucket: AttentionBucket;
  score: number;
  reason: string;
}

export interface BriefingItem {
  rank: number;
  title: string;
  reason: string;
  eventId?: string;
  commitmentId?: string;
}

export interface BriefingDraft {
  kind: "am" | "pm" | "catchup";
  headline: string;
  items: BriefingItem[];
  handledQuietly: number;
  bodyText: string;
}

export interface InterpretResult {
  /** Structured intent the orchestrator understands — never free-form side effects. */
  intent:
    | { type: "reply_text"; text: string }
    | { type: "detail"; itemIndex: number }
    | { type: "close_loop"; refs: string[] }
    | { type: "dismiss"; refs: string[] }
    | { type: "propose_action"; summary: string; action: Record<string, unknown> }
    | { type: "noop" };
}

export interface BrainUserContext {
  userId: string;
  name: string;
  timezone: string;
  vipList: string[];
  ignoredPatterns: string[];
  openCommitmentsSummary: string;
  calendarToday: string;
}

export interface BrainPort {
  triage(ctx: BrainUserContext, events: TriageEventInput[]): Promise<TriageResult[]>;
  brief(ctx: BrainUserContext, kind: BriefingDraft["kind"]): Promise<BriefingDraft>;
  interpret(ctx: BrainUserContext, message: string): Promise<InterpretResult>;
}
