# Commitments

Commitments are first-class in Amilo (table `commitments`), not buried in email metadata.

A commitment is something the user owes the world or the world owes the user that should survive until done/dropped:

- Meeting with a real person at a real time
- Payment / filing with a deadline
- Explicit promise the user made ("I'll send the deck tomorrow")
- Appointment extracted from a confirmation email (use the **appointment time**, not the email arrival time)

## Lifecycle

`open` → `done` | `dropped` | `snoozed`

Evening/morning follow-through: at most **two touches**, then park. Never nag.

## Agent rules

- When triaging, open commitments are silent context that raise the bar for competing noise.
- When the user says something is done, close it — do not resurface as urgent next cycle.
- Prefer linking a commitment to a source event when one exists.
