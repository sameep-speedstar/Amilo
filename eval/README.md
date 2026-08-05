# Eval harness (M5)

Golden fixtures in `fixtures.json` score Cursor brain vs Claude/LifeOS.

M0 ships fixtures only. M5 adds a runner that:

1. Calls `@amilo/brain-cursor` triage on each fixture
2. Optionally calls LifeOS scoring API / recorded Claude outputs
3. Emits precision/recall on `needs_attention` and median latency / $

North-star: **false-priority rate** (dismisses) and **briefing reply rate**.
