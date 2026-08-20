# Commitments

Commitments are first-class in Amilo (table `commitments`), not buried in email metadata.

A commitment is something the user owes the world or the world owes the user that should survive until done/dropped:

- Meeting with a real person at a real time
- Payment / filing with a deadline
- Explicit promise the user made ("I'll send the deck tomorrow")
- Appointment extracted from a confirmation email (use the **appointment time**, not the email arrival time)
- **Waiting on** someone (`waiting on Rajeev for board deck`) — opens a commitment + CoS watch

## Lifecycle

`open` → `done` | `dropped` | `snoozed` | (system) `parked`

Evening/morning follow-through: at most **two touches**, then park. Never nag. Watcher alerts count as a touch. See `WATCHERS.md`. Closing `done` / `drop` cancels linked open watches.

User `done` → **completed** (not parked). Completed stays off FOCUS until a reminder on the same identity (thread reply or `remind me about …`). Duplicate nags on a new thread do not reopen. Each completed item is printed on a brief **once**, then only via `completed` / `status`.

**Remind me (user-asked):**
- Time (and optional date) → 1-minute Google Calendar nudge at that instant, even if a meeting already occupies the slot. WhatsApp ping at due time. Not a FOCUS item.
- Date only (no clock) → 1-minute Google Calendar nudge at **09:00** that day (overlaps meetings), plus a separate WhatsApp after that morning's brief.
- No when → ask for a time or a day.

## Agent rules

- When triaging, open commitments are silent context that raise the bar for competing noise.
- When the user says something is done, close it — do not resurface as urgent next cycle.
- Prefer linking a commitment to a source event when one exists.
- `waiting_on` edges on the context graph mark open waits for the future Mind Map.
