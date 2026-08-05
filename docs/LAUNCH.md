# M0 launch notes

## Done in M0

- TypeScript monorepo scaffold
- `BrainPort` + Cursor cloud wiring (+ stub brain)
- WhatsApp signature verify + 24h send gate (skeleton)
- Drizzle schema: users, channels, events, commitments, message_log, audit_log
- Hono `/health`, webhook verify challenge, `/dev/chat` harness
- High-IQ docs under `brain/`
- Eval fixture stub

## Not done (next)

- M1: full webhook parse → orchestrator → outbound send
- M2: Postgres repos + standing commands persisted
- M3: MCP tools + durable agent id in DB
- Submit WABA templates (human in Meta UI) — [WABA_TEMPLATES.md](./WABA_TEMPLATES.md)

## Separate systems

Do **not** point this app at the LifeOS Supabase project. New DB when M2 lands.
Claude Telegram bot stays on `productSpeed/lifeos`.
