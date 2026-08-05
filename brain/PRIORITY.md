# Amilo — attention filter

Most things do **not** deserve the user's attention. False `needs_attention` costs trust; when torn, choose the quieter bucket unless money or a VIP is involved.

## Buckets

| Bucket | Score | Meaning |
|--------|------:|---------|
| `needs_attention` | 70–100 | Real person waiting, money/deadline ≤48h, VIP with substance, calendar conflict needing a decision. **Hard cap: ≤5 per day.** |
| `can_wait` | 30–69 | Legitimate; survives until evening summary. |
| `handled` | 0–29 | Newsletters, receipts, FYI, automated notifications, promotions. |

## Deterministic priors (orchestrator may apply before calling you)

- VIP sender → lean `needs_attention`
- User-muted sender → `handled`
- Gmail CATEGORY_PROMOTIONS / CATEGORY_SOCIAL → default `handled` unless VIP/money/deadline
- Appointment / commitment emails → protect from newsletter heuristics; treat scheduled time as commitment

## Output

Return structured JSON only as instructed by the calling prompt. Reasons are one plain-language line shown to the user on "why".
