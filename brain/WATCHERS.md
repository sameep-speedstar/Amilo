# CoS watchers

Amilo watches **workday obligations**, not the whole internet. Background alerts are chief-of-staff shaped.

## Kinds

| Kind | Arms when | Fires when |
|------|-----------|------------|
| `awaiting_reply` | `waiting on <person> for <thing>` | Inbound Gmail from that person's email after arm time |
| `commitment_stall` | Reminder / commitment with `due_at` | Due within ~4h or overdue |

## Rules

1. Max **2 watcher pushes per user per day** (counts toward attention discipline).
2. Respect **quiet hours**.
3. Outside the WhatsApp 24h window, use `priority_update` template.
4. Closing the linked commitment (`done` / `drop`) cancels open watches.
5. User can `cancel watch <hint>`.
6. Prefer a watch alert over a duplicate due-reminder when both exist.

## Anti-goals (do not build)

- Bank / subscription / junk-fee monitors
- Flight/hotel price hunting as a product surface
- Shopping agents, dating coach, life-coach check-ins
- Folk-style companion “watch everything” breadth

## Graph link

Arming `waiting on` upserts a person node and `user --waiting_on--> person` so the future Mind Map can show open waits as first-class edges. See `CONTEXT_GRAPH.md`.
