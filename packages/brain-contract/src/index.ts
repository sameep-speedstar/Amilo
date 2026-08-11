/** Swappable IQ brain — Grok for chat; Cursor cloud reserved for heavy jobs. */

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

export type ContextNodeKind =
  | "person"
  | "org"
  | "place"
  | "topic"
  | "preference"
  | "constraint"
  | "goal";

export interface GraphNodeUpdate {
  op: "upsert_node";
  kind: ContextNodeKind;
  label: string;
  attrs?: Record<string, unknown>;
  confidence?: number;
}

export interface GraphEdgeUpdate {
  op: "upsert_edge";
  fromLabel: string;
  toLabel: string;
  rel: string;
  attrs?: Record<string, unknown>;
  confidence?: number;
}

export type GraphUpdate = GraphNodeUpdate | GraphEdgeUpdate;

export interface InterpretResult {
  /** Structured intent the orchestrator understands — never free-form side effects. */
  intent:
    | { type: "reply_text"; text: string }
    | { type: "detail"; itemIndex: number }
    | { type: "close_loop"; refs: string[] }
    | { type: "dismiss"; refs: string[] }
    | { type: "propose_action"; summary: string; action: Record<string, unknown> }
    | { type: "noop" };
  /** Personal context graph deltas from this turn (optional). */
  graphUpdates?: GraphUpdate[];
}

export interface BrainUserContext {
  userId: string;
  name: string;
  timezone: string;
  vipList: string[];
  ignoredPatterns: string[];
  openCommitmentsSummary: string;
  calendarToday: string;
  /** Tomorrow's calendar lines (absolute dates). Empty/"none yet" must not reuse today. */
  calendarTomorrow?: string;
  /** Compact silent context from the personal graph. */
  contextGraphSummary?: string;
  /** Last few WhatsApp turns (user + Amilo), newest last. */
  recentChatSummary?: string;
  /** When the user quoted/replied to a specific message. */
  replyToSummary?: string;
}

export interface BrainPort {
  triage(ctx: BrainUserContext, events: TriageEventInput[]): Promise<TriageResult[]>;
  brief(ctx: BrainUserContext, kind: BriefingDraft["kind"]): Promise<BriefingDraft>;
  interpret(ctx: BrainUserContext, message: string): Promise<InterpretResult>;
}
