# Launch notes

## Done in M0–M5.5

- TypeScript monorepo scaffold
- `BrainPort` + Grok chat (+ Cursor cloud reserved) + stub
- WhatsApp signature verify + 24h send gate
- **M1:** webhook parse → allowlist → orchestrator → WhatsApp reply
- **M2:** Postgres persistence (users, channels, message_log, webhook dedupe, pause)
- **M3:** Grok IQ + personal context graph
- **M4:** Google OAuth (shared client with LifeOS) + Gmail/Calendar sync + on-demand `brief`
- **M4.1:** India-correct clocks, timezone onboard/travel update, due reminders
- **M4.2:** Scheduled morning/evening WABA templates in user TZ + quiet hours prefs
- **M5:** Confirm-before-write — calendar create/update/cancel after WhatsApp yes
- **M5.1:** Voice notes (Sarvam STT)
- **M5.2:** Travel intelligence — places, leave-by, travel conflicts, departure alerts (Maps)
- **M5.3:** Gmail send after yes (`gmail.send` + reconnect)
- **M5.4:** Commitment close — done / drop / snooze
- **M5.5:** Context graph inspect + CoS watchers
  - `about me` / `about <name>` / `forget <name>` / `forget <name> <attr>`
  - `waiting on <person> for <thing>` → commitment + `awaiting_reply` watch + `waiting_on` graph edge
  - `cancel watch <hint>`; watchWorker (reply detect + commitment stall, quiet hours, ≤2/day)
  - Docs name **Mind Map** as destination (visual life map after graph dogfood + M6 shell)
- **Beta onboarding:** invite link/QR → WhatsApp; admin allowlist + usage caps (see `docs/ONBOARDING.md`)
- Azure Postgres `amilo-pg` + live `api.amilo.io`
- High-IQ docs under `brain/`

## M5 confirm-before-write

- Pending proposals in `pending_actions` (expire ~2h); reply **yes** / **cancel** / **edit …**
- Calendar writes use existing `calendar.events` scope
- Email: **send** after yes when `gmail.send` granted; otherwise reconnect prompt
- Audit: `audit_log`; light A/B: `eval_events` + `eval log <note>`

## Travel notes

- Set places: `home is <address>` / `office is <address>` (multi-line in one message supported)
- Requires `GOOGLE_MAPS_API_KEY`; Routes capped ~200/day; geocode cache permanent
- Briefs show leave-by + haversine travel conflicts (no Routes on render)

## Watcher notes

- CoS only — see `brain/WATCHERS.md`. No bank/price/life-coach monitors.
- Reply watches need a person email on the context graph (`Rajeev's email is …` or known seed).

## Scheduled briefs notes

- Always sent as **templates** (works outside the 24h window).
- Template body params are flattened (no newlines) to satisfy Meta `#132018`.
- Defaults: morning `07:30`, evening `20:00`, quiet `22:00–07:00` local.

## Not done (next)

- M6: App-ready shell (richer onboarding web, second channel)
- Mind Map UI over context graph + commitments/events
- Stronger A/B scoring harness vs Claude Telegram

## Separate systems

Do **not** point this app at the LifeOS Supabase project.
Claude Telegram bot stays on `productSpeed/lifeos` (`amilo-app` image); WhatsApp Amilo is `amilo-api` / `amilo-wa` only.

Webhook: `https://api.amilo.io/webhooks/whatsapp`  
Google callback: `https://api.amilo.io/oauth/google/callback` (add this redirect URI to the shared OAuth client; never revoke on disconnect)
