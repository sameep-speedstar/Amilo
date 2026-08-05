# Amilo

WhatsApp-native AI chief of staff. Cuts noise, protects attention, keeps you on commitments.

**Runtime brain:** [Cursor Agent SDK](https://cursor.com/docs/sdk/typescript) (cloud)  
**Channel (v1):** WhatsApp Business Cloud API (WABA)  
**Control bot (separate):** Claude on Telegram lives in `productSpeed/lifeos` — do not merge

## Why this repo exists

LifeOS proved the product on Telegram + Claude. This codebase rebuilds Amilo **WABA-first** with a swappable brain port, a first-class commitment graph, and an architecture that can ship as a multi-platform app later — without the LifeOS god-object router.

## Monorepo

| Path | Role |
|------|------|
| `apps/api` | Hono HTTP — webhooks, OAuth, health, internal tools API |
| `packages/core` | Domain: users, events, commitments, orchestrator ports |
| `packages/db` | Drizzle schema + migrations |
| `packages/channels-whatsapp` | WABA adapter (24h window + templates ONLY here) |
| `packages/brain-contract` | `BrainPort` interface |
| `packages/brain-cursor` | Cursor cloud agent + MCP wiring |
| `brain/` | High-IQ frame docs cloned into cloud agent VMs |
| `eval/` | Golden fixtures for Cursor vs Claude A/B |
| `docs/` | Architecture, WABA templates, launch |

Privacy policy: https://www.amilo.io/privacy  
API (production): https://api.amilo.io — see [docs/API_SUBDOMAIN.md](docs/API_SUBDOMAIN.md)

## Quick start

```bash
cp .env.example .env
docker compose up -d
npm install
npm run build
npm run dev
```

`GET /health` → `{ "ok": true, "service": "amilo" }`

## Milestones

- **M0** — Bootstrap (this skeleton) + submit WABA templates
- **M1** — WhatsApp webhook round-trip (parse → orchestrator → send)
- **M2** — Multi-tenant domain + standing commands
- **M3** — Cursor brain (durable per-user agents + MCP)
- **M4** — Google sync + morning/evening briefings
- **M5** — Confirm-before-write + A/B eval
- **M6** — App-ready shell (onboarding web, second channel)

## Non-negotiables

1. Channel-blind core — no WhatsApp types in domain/brain
2. Multi-tenant always — every content row has `user_id`
3. Confirm before write — no Google writes without audited confirmation
4. WABA window/template logic only in `packages/channels-whatsapp`
5. No WhatsApp Web / Baileys — Cloud API only
6. User-facing brand is **Amilo**

## Templates

See [docs/WABA_TEMPLATES.md](docs/WABA_TEMPLATES.md) — submit in Meta Business Manager before coding blocks on outbound briefings.
