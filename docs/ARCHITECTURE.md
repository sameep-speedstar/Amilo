# Architecture

## Goals

1. Protect user attention (high IQ, low volume).
2. WhatsApp Business Cloud API native (templates + 24h window).
3. **Swappable IQ brain** via `BrainPort` (Grok today; Cursor cloud reserved for heavy jobs).
4. Multi-platform later without rewriting domain IQ.
5. **Personal context graph** is Amilo-owned and per-user (never mixed across tenants).

## Hexagonal layout

```
WhatsApp adapter ──┐
Telegram (later) ──┼──► Orchestrator ──► BrainPort ──► Grok (default)
Web / app (later) ─┘         │                    └─► Cursor / others (later)
                             ├── Domain (users, events, commitments, context graph)
                             └── Confirm-before-write → Google APIs
```

Life-ops **research** (movies / dining / flights) = Grok session + web search + deep links.  
**Booking automation** parked until [partner APIs](./BOOKING_PARTNER_APIS.md). Browser booking is off by default.

## Packages

| Package | Responsibility |
|---------|----------------|
| `@amilo/brain-contract` | `BrainPort` + DTOs |
| `@amilo/brain-grok` | xAI Responses + web search; per-user `grok_response_id` |
| `@amilo/brain-cursor` | Cursor `Agent.create` / `resume` (heavy jobs) |
| `@amilo/core` | Channel-blind types + `handleInbound` |
| `@amilo/channels-whatsapp` | Signature verify, 24h gate, template send |
| `@amilo/db` | Drizzle schema (multi-tenant) |
| `@amilo/api` | Hono HTTP surface |

## Parked: multi-model router

See **[MODEL_ROUTER.md](./MODEL_ROUTER.md)** — divide load by query depth / cost across Grok, Claude, Muse, open-source later. Not immediate; architecture allows it via `BrainPort` adapters + a future `BrainRouter`.

## Cursor cloud pattern

- One durable agent per user (`users.cursor_agent_id`) when Cursor is the brain.
- Cloud `repos: [{ url: Amilo repo }]` so the VM has `brain/*.md`.
- Standing commands bypass the brain (latency + cost).

## Grok chat pattern (default)

- One xAI Responses session per user (`users.grok_response_id`, ~30d server retention).
- Silent context graph + recent chat injected every turn.
- Research asks force web search; booking claims forbidden until partner APIs.

## Latency posture

Prefer fast models for chat; research may take longer (web tools). Mitigations: standing-command bypass, never block Meta webhook ACK (always 200 then process).

## Separation from LifeOS

| | LifeOS (control) | Amilo (this repo) |
|--|------------------|-------------------|
| Channel | Telegram | WhatsApp |
| Brain | Claude / Vertex | Grok (BrainPort); Cursor optional |
| Repo | productSpeed/lifeos | sameep-speedstar/Amilo |
| DB | LifeOS Supabase | **Separate** Postgres |
