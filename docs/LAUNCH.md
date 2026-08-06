# Launch notes

## Done in M0–M4.2

- TypeScript monorepo scaffold
- `BrainPort` + Grok chat (+ Cursor cloud reserved) + stub
- WhatsApp signature verify + 24h send gate
- **M1:** webhook parse → allowlist → orchestrator → WhatsApp reply
- **M2:** Postgres persistence (users, channels, message_log, webhook dedupe, pause)
- **M3:** Grok IQ + personal context graph
- **M4:** Google OAuth (shared client with LifeOS) + Gmail/Calendar sync + on-demand `brief`
- **M4.1:** India-correct clocks, timezone onboard/travel update, due reminders
- **M4.2:** Scheduled morning/evening WABA templates (`morning_update` / `evening_wrap`) in user TZ + quiet hours prefs
- Azure Postgres `amilo-pg` + live `api.amilo.io`
- High-IQ docs under `brain/`

## Scheduled briefs notes

- Always sent as **templates** (works outside the 24h window).
- Template body params are flattened (no newlines) to satisfy Meta `#132018`.
- Defaults: morning `07:30`, evening `20:00`, quiet `22:00–07:00` local.
- Commands: `briefs`, `briefs on|off`, `brief morning 7:30`, `brief evening 8pm`, `quiet hours 22:00-07:00`.
- On-demand `brief` / `morning` / `evening` remain free-form inside the 24h window.

## Not done (next)

- M5: Confirm-before-write + A/B eval

## Separate systems

Do **not** point this app at the LifeOS Supabase project.
Claude Telegram bot stays on `productSpeed/lifeos` (`amilo-app` image); WhatsApp Amilo is `amilo-api` / `amilo-wa` only.

Webhook: `https://api.amilo.io/webhooks/whatsapp`  
Google callback: `https://api.amilo.io/oauth/google/callback` (add this redirect URI to the shared OAuth client; never revoke on disconnect)
