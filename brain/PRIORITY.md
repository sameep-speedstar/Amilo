# Amilo — attention filter

Most things do **not** deserve the user's attention. False `needs_attention` costs trust; when torn, choose the quieter bucket unless money or a VIP is involved.

An item earns a brief slot only if **action + owner + time** are all true. FYI never goes in FOCUS.

## Buckets

| Bucket | Score | Meaning |
|--------|------:|---------|
| `needs_attention` | 70–100 | Real person waiting, money/deadline ≤48h, VIP with substance, calendar conflict needing a decision, **watcher fire**. **Hard cap: ≤5 per day** (watcher pushes ≤2/day). |
| `can_wait` | 30–69 | Legitimate; one mention then park unless deadline ≤48h. |
| `handled` | 0–29 | Newsletters, receipts, FYI, automated notifications, promotions. Yesterday-only HANDLED line. |

## Mail admission (hybrid)

**Stage A (deterministic, no model):** drop promo/social/forum, muted, passive txn, closed thread (no newer reply), 14-day same-ask fingerprint, user not on To: (when To: is known), automated sender unless money/KYC-block/failed pay/deadline. Hard-keep those last plus registration/RSVP/interview/offer/e-vote.

**Stage B:** leftovers only (max ~8). Classify `action` vs `fyi`. Unsure → `fyi`. Cache on the event. Never invent a deadline.

Kill soft “human + please” scoring. VIP boosts only already-actionable mail.

## Cadence

Two touches then park (watcher fire counts). New mail on the **same thread** resets. Overdue: show once, then park (money/KYC-block: one extra).

**DONE** (user `done`): completed list. Printed on the brief **once**, then only via `completed` / `status`. Reopen only on a same-identity reminder (thread reply, or `remind me about …`) — not a duplicate nag on a new thread.

**HANDLED**: quieter items from the **previous local day only**. Does not accumulate a week. `M` / `handled` expands that yesterday set.

**Mute**: never brief again.

## Morning brief shape

TODAY (calendar + schedule windows) → FOCUS (≤3) → DONE (once) → HANDLED (yesterday count). Empty blocks omitted.

Evening: TOMORROW + STILL OPEN + DONE today (if not already shown). No HANDLED at night.

## Output

Return structured JSON only as instructed by the calling prompt. Reasons are one plain-language line shown to the user on "why".
