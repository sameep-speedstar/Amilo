# Commitments

Commitments are first-class in Amilo (table `commitments`), not buried in email metadata.

A commitment is something the user owes the world or the world owes the user that should survive until done/dropped:

- Meeting with a real person at a real time
- Payment / filing with a deadline
- Explicit promise the user made ("I'll send the deck tomorrow")
- Appointment extracted from a confirmation email (use the **appointment time**, not the email arrival time)
- **Waiting on** someone (`waiting on Rajeev for board deck`) — opens a commitment + CoS watch

## Lifecycle

`open` → `done` | `dropped` | `snoozed`

Evening/morning follow-through: at most **two touches**, then park. Never nag.

Watcher alerts (reply detected / stall) count as a touch. See `WATCHERS.md`. Closing `done` / `drop` cancels linked open watches.

## Agent rules

- When triaging, open commitments are silent context that raise the bar for competing noise.
- When the user says something is done, close it — do not resurface as urgent next cycle.
- Brief **mail** priorities closed with `done 1` / `done <label>` stay suppressed until **new mail arrives on the same Gmail thread**.
- Prefer linking a commitment to a source event when one exists.
- `waiting_on` edges on the context graph mark open waits for the future Mind Map.
