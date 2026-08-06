import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

/** Every content table carries user_id — multi-tenant always. */

export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  phoneE164: varchar("phone_e164", { length: 20 }).notNull().unique(),
  name: varchar("name", { length: 200 }),
  assistantName: varchar("assistant_name", { length: 50 }).notNull().default("Amilo"),
  timezone: varchar("tz", { length: 50 }).notNull().default("Asia/Kolkata"),
  status: varchar("status", { length: 20 }).notNull().default("active"),
  cursorAgentId: text("cursor_agent_id"),
  prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const channels = pgTable(
  "channels",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 20 }).notNull(),
    address: varchar("address", { length: 200 }).notNull(),
    isPrimary: boolean("is_primary").notNull().default(false),
    prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
    /** Last inbound from this address — drives WhatsApp 24h window. */
    lastInboundAt: timestamp("last_inbound_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("channels_kind_address_uidx").on(t.kind, t.address)],
);

export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    source: varchar("source", { length: 20 }).notNull(),
    sourceId: varchar("source_id", { length: 500 }).notNull(),
    actor: varchar("actor", { length: 320 }),
    title: text("title"),
    snippet: text("snippet"),
    kind: varchar("kind", { length: 50 }),
    priority: varchar("priority", { length: 20 }),
    score: integer("score"),
    reason: text("reason"),
    meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
    occursAt: timestamp("occurs_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("events_user_source_source_id_uidx").on(t.userId, t.source, t.sourceId)],
);

/** First-class commitments — not buried in events.meta. */
export const commitments = pgTable("commitments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  dueAt: timestamp("due_at", { withTimezone: true }),
  /** Set when a due reminder was pushed to the user. */
  notifiedAt: timestamp("notified_at", { withTimezone: true }),
  sourceEventId: uuid("source_event_id").references(() => events.id, {
    onDelete: "set null",
  }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});

export const messageLog = pgTable("message_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
  channel: varchar("channel", { length: 20 }).notNull(),
  direction: varchar("direction", { length: 10 }).notNull(),
  kind: varchar("kind", { length: 40 }).notNull(),
  bodyRef: text("body_ref"),
  waTemplate: varchar("wa_template", { length: 80 }),
  cost: integer("cost"),
  meta: jsonb("meta").$type<Record<string, unknown>>().notNull().default({}),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

export const auditLog = pgTable("audit_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  action: varchar("action", { length: 80 }).notNull(),
  detail: jsonb("detail").$type<Record<string, unknown>>().notNull().default({}),
  confirmed: boolean("confirmed").notNull().default(false),
  ts: timestamp("ts", { withTimezone: true }).notNull().defaultNow(),
});

/** Meta webhook delivery dedupe (message ids). */
export const webhookDedupe = pgTable("webhook_dedupe", {
  id: varchar("id", { length: 200 }).primaryKey(),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Personal context graph — nodes. */
export const contextNodes = pgTable(
  "context_nodes",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: varchar("kind", { length: 40 }).notNull(),
    label: varchar("label", { length: 320 }).notNull(),
    attrs: jsonb("attrs").$type<Record<string, unknown>>().notNull().default({}),
    confidence: integer("confidence").notNull().default(80),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("context_nodes_user_kind_label_uidx").on(t.userId, t.kind, t.label)],
);

/** Personal context graph — edges. */
export const contextEdges = pgTable(
  "context_edges",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fromNodeId: uuid("from_node_id")
      .notNull()
      .references(() => contextNodes.id, { onDelete: "cascade" }),
    toNodeId: uuid("to_node_id")
      .notNull()
      .references(() => contextNodes.id, { onDelete: "cascade" }),
    rel: varchar("rel", { length: 80 }).notNull(),
    attrs: jsonb("attrs").$type<Record<string, unknown>>().notNull().default({}),
    confidence: integer("confidence").notNull().default(80),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("context_edges_user_from_to_rel_uidx").on(
      t.userId,
      t.fromNodeId,
      t.toNodeId,
      t.rel,
    ),
  ],
);

/** Append-only observations that produced graph updates. */
export const contextObservations = pgTable("context_observations", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  sourceMessageId: varchar("source_message_id", { length: 200 }),
  claim: text("claim").notNull(),
  linkedNodeIds: jsonb("linked_node_ids").$type<string[]>().notNull().default([]),
  linkedEdgeIds: jsonb("linked_edge_ids").$type<string[]>().notNull().default([]),
  raw: jsonb("raw").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Google OAuth tokens — Amilo Postgres only; never revoke on disconnect (shared client with LifeOS). */
export const googleAccounts = pgTable(
  "google_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 40 }).notNull().default("personal"),
    email: varchar("email", { length: 320 }),
    scopes: text("scopes").notNull().default(""),
    accessTokenEnc: text("access_token_enc").notNull(),
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    gmailHistoryId: varchar("gmail_history_id", { length: 80 }),
    calendarSyncToken: text("calendar_sync_token"),
    lastSyncAt: timestamp("last_sync_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("google_accounts_user_label_uidx").on(t.userId, t.label)],
);
