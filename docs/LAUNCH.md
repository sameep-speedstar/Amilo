# Launch notes

## Done in M0–M4

- TypeScript monorepo scaffold
- `BrainPort` + Grok chat (+ Cursor cloud reserved) + stub
- WhatsApp signature verify + 24h send gate
- **M1:** webhook parse → allowlist → orchestrator → WhatsApp reply
- **M2:** Postgres persistence (users, channels, message_log, webhook dedupe, pause)
- **M3:** Grok IQ + personal context graph
- **M4:** Google OAuth (shared client with LifeOS) + Gmail/Calendar sync + on-demand `brief`
- Azure Postgres `amilo-pg` + live `api.amilo.io`
- High-IQ docs under `brain/`

## Not done (next)

- Scheduled morning/evening template pushes (blocked on Meta template approval)
- M5: Confirm-before-write + A/B eval
- Template outbound once Meta approves `morning_update` / `evening_wrap` / `priority_update`

## Separate systems

Do **not** point this app at the LifeOS Supabase project.
Claude Telegram bot stays on `productSpeed/lifeos`.

Webhook: `https://api.amilo.io/webhooks/whatsapp`  
Google callback: `https://api.amilo.io/oauth/google/callback` (add this redirect URI to the shared OAuth client; never revoke on disconnect)
