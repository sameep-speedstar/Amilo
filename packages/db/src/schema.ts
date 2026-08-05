import {
  boolean,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
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

export const channels = pgTable("channels", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  kind: varchar("kind", { length: 20 }).notNull(),
  address: varchar("address", { length: 200 }).notNull(),
  isPrimary: boolean("is_primary").notNull().default(false),
  prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
});

export const events = pgTable("events", {
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
});

/** First-class commitments — not buried in events.meta. */
export const commitments = pgTable("commitments", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  status: varchar("status", { length: 20 }).notNull().default("open"),
  dueAt: timestamp("due_at", { withTimezone: true }),
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
