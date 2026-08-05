# Launch notes

## Done in M0 / M1 / M2

- TypeScript monorepo scaffold
- `BrainPort` + Cursor cloud wiring (+ stub brain)
- WhatsApp signature verify + 24h send gate
- **M1:** webhook parse → allowlist → orchestrator → WhatsApp reply
- **M2:** Postgres persistence (users, channels, message_log, webhook dedupe, pause)
- Azure Postgres `amilo-pg` + live `api.amilo.io`
- High-IQ docs under `brain/`

## Not done (next)

- M3: Cursor brain MCP tools (agent id column ready)
- M4: Google sync + briefings (blocked on template approval for proactive outbound)
- Template outbound once Meta approves `morning_update` / `evening_wrap` / `priority_update`

## Separate systems

Do **not** point this app at the LifeOS Supabase project.
Claude Telegram bot stays on `productSpeed/lifeos`.

Webhook: `https://api.amilo.io/webhooks/whatsapp`
