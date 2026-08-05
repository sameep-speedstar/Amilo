/** Product domain types — commitments are first-class, not email meta. */

export type UserStatus = "active" | "paused" | "deleted";

export interface User {
  id: string;
  phoneE164: string;
  name: string | null;
  assistantName: string;
  timezone: string;
  status: UserStatus;
  /** Durable Cursor cloud agent id (`bc-…`), set on first brain turn. */
  cursorAgentId: string | null;
  prefs: Record<string, unknown>;
  createdAt: Date;
}

export type CommitmentStatus = "open" | "done" | "dropped" | "snoozed";

export interface Commitment {
  id: string;
  userId: string;
  title: string;
  status: CommitmentStatus;
  dueAt: Date | null;
  sourceEventId: string | null;
  reason: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
}

export type AttentionBucket = "needs_attention" | "can_wait" | "handled";

export interface EventRecord {
  id: string;
  userId: string;
  source: "gmail" | "calendar" | "note" | "manual";
  sourceId: string;
  actor: string | null;
  title: string | null;
  snippet: string | null;
  kind: string | null;
  priority: AttentionBucket | null;
  score: number | null;
  reason: string | null;
  meta: Record<string, unknown>;
  occursAt: Date | null;
  createdAt: Date;
}
