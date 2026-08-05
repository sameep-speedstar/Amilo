# Architecture

## Goals

1. Protect user attention (high IQ, low volume).
2. WhatsApp Business Cloud API native (templates + 24h window).
3. Cursor Agent SDK (cloud) as swappable brain.
4. Multi-platform later without rewriting domain IQ.

## Hexagonal layout

```
WhatsApp adapter ──┐
Telegram (later) ──┼──► Orchestrator ──► BrainPort ──► Cursor cloud
Web / app (later) ─┘         │
                             ├── Domain (users, events, commitments)
                             └── Confirm-before-write → Google APIs
```

## Packages

| Package | Responsibility |
|---------|----------------|
| `@amilo/brain-contract` | `BrainPort` + DTOs |
| `@amilo/brain-cursor` | Cursor `Agent.create` / `resume`, JSON extraction |
| `@amilo/core` | Channel-blind types + thin `handleInbound` |
| `@amilo/channels-whatsapp` | Signature verify, 24h gate, template send |
| `@amilo/db` | Drizzle schema (multi-tenant) |
| `@amilo/api` | Hono HTTP surface |

## Cursor cloud pattern

- One durable agent per user (`users.cursor_agent_id` = `bc-…`).
- Cloud `repos: [{ url: Amilo repo }]` so the VM has `brain/*.md`.
- Standing commands bypass the brain (latency + cost).
- MCP tools (M3) call back into `/internal/tools/*` for live user data.

## Latency posture

Cloud VMs have cold start. Mitigations: resume durable agents, stub/fast-path for commands, queue briefing jobs, never block Meta webhook ACK (always 200 then process async in M1+).

## Separation from LifeOS

| | LifeOS (control) | Amilo (this repo) |
|--|------------------|-------------------|
| Channel | Telegram | WhatsApp |
| Brain | Claude / Vertex | Cursor cloud |
| Repo | productSpeed/lifeos | sameep-speedstar/Amilo |
| DB | LifeOS Supabase | **Separate** Postgres |
