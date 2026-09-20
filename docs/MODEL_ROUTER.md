# Model router (parked)

**Status:** architecture intent only — **not** in the near-term build queue.  
Ship when a second provider is real (Claude / Muse / open-source) or cost pressure needs tiering.

## Intent

Amilo must be able to **switch and split IQ load** across providers without rewriting WhatsApp or the orchestrator:

- Grok (default today — chat + web search)
- Claude, Muse, other hosted models
- Open-source / self-hosted later

Routing may use **query depth** and task type for **cost and latency** (shallow vs research vs CoS writes).

## Non-negotiables

1. **`BrainPort` stays the only orchestrator ↔ IQ boundary** (`interpret` / `triage` / `brief`).
2. Provider SDKs live in `@amilo/brain-*` adapters — never in `@amilo/core` or channel code.
3. **Per-user isolation:** sessions keyed by `userId` + `provider` (never share threads across users or mix A/B context graphs).
4. **Silent context graph** is always Amilo-owned and injected the same way regardless of model.
5. Confirm-before-write and calendar/email gates stay orchestrator-side.

## Target shape (when built)

```
Inbound → Orchestrator → BrainRouter → BrainPort adapter
                              │
                              ├─ depth / task classifier (cheap)
                              ├─ policy: default | research+web | heavy CoS | triage batch
                              └─ fallback up-tier on provider failure
```

| Tier (example) | When | Example |
|----------------|------|---------|
| Fast / cheap | Standing-adjacent chat, short ack | Small / non-reasoning |
| Research | Movies, dining, flights, “what’s on” | Grok + web_search (today) |
| Strong CoS | Ambiguous calendar/mail decisions | Claude / larger Grok |
| Batch | Overnight triage / brief jobs | Cheapest capable |

## Session store

Today: `users.grok_response_id` (xAI Responses).  
Later: generalize to `brain_sessions(user_id, provider, external_id, updated_at)` or prefs map — one row per provider so switching models does not corrupt continuity.

## Explicitly out of scope until un-parked

- Building Claude/Muse/local adapters
- Automatic A/B load split in prod
- Cost dashboards / token budgets

Default remains **single Grok brain** via env (`XAI_API_KEY` / `GROK_MODEL`) until this plan is picked up.
