# CoS watchers

Amilo watches **workday obligations**, not the whole internet. Background alerts are chief-of-staff shaped.

## Kinds

| Kind | Arms when | Fires when |
|------|-----------|------------|
| `awaiting_reply` | `waiting on <person> for <thing>` | Inbound Gmail from that person's email after arm time |
| `commitment_stall` | Reminder / commitment with `due_at` | Due within ~4h or overdue |
| `calendar_conflict` (inbound) | Always on when Google is connected | New invite (other organizer / needsAction) overlaps an existing timed block |

## Inbound calendar conflict

When someone books onto your calendar over an existing block (e.g. Pickup 4:00–4:30):

1. Watch worker live-scans Google every ~2 minutes.
2. Amilo WhatsApps you with the conflict and next free slot.
3. Reply:
   - **yes** / **accept** — RSVP accepted (overlap remains; you chose to keep both)
   - **alternate** — draft reschedule email to the organizer at the next free time (confirm with yes to send)
   - **decline** — RSVP declined; organizer notified

Deduped per event (`conflictAlertedAt`). Counts toward the daily watcher push cap. Quiet hours apply.

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
