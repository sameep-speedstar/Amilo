# M0 launch notes

## Done in M0 / M1

- TypeScript monorepo scaffold
- `BrainPort` + Cursor cloud wiring (+ stub brain)
- WhatsApp signature verify + 24h send gate
- **M1:** webhook parse → allowlist → orchestrator → WhatsApp reply
- Drizzle schema: users, channels, events, commitments, message_log, audit_log
- Hono `/health`, webhook verify, live `api.amilo.io`
- High-IQ docs under `brain/`
- Eval fixture stub

## Not done (next)

- M2: Postgres repos + standing commands persisted
- M3: MCP tools + durable agent id in DB
- Template outbound once Meta approves `morning_update` / `evening_wrap` / `priority_update`

## Separate systems

Do **not** point this app at the LifeOS Supabase project. New DB when M2 lands.
Claude Telegram bot stays on `productSpeed/lifeos`.

Webhook: `https://api.amilo.io/webhooks/whatsapp`
