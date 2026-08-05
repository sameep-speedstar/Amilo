# Eval harness

Golden fixtures in `fixtures.json` cover:

1. **Triage** (M5 runner) — attention buckets vs Grok/Cursor
2. **Interpret / IQ tone** (M3) — WhatsApp reply quality + silent graph deltas

## IQ fixtures (M3)

| id | Signal |
|----|--------|
| `vent-no-therapist` | Venting → no therapist register |
| `decision-advisor` | X or Y → tradeoffs + recommendation |
| `graph-cfo-silent` | “Priya is my CFO” → `graphUpdates` with person node; reply never performs memory |

Manual check (until runner lands):

```bash
# Local (needs XAI_API_KEY + DATABASE_URL)
curl -s localhost:8080/dev/chat -H 'content-type: application/json' \
  -d '{"text":"Priya is my CFO — she owns ICICI margin.","name":"Sameep"}'
```

North-star later: false-priority rate and briefing reply rate (M5).
