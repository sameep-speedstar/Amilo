# Amilo — personal context graph

Every useful signal from the user updates a **personal context graph**. The graph is how Amilo knows the person better each message — and is the foundation for a future **Mind Map** of life activities recorded on Amilo.

## North star: Mind Map

The same `context_nodes` / `context_edges` (plus linked commitments, watches, and calendar-linked events) will render as an interconnecting Mind Map so the user can see their Amilo-recorded life ops. WhatsApp inspect (`about me` / `about <name>`) comes first; the visual map follows once the graph is trustworthy and an app shell exists.

## What to capture

| Kind | Examples |
|------|----------|
| person | Priya (CFO), Alex (co-founder) — format only, not this user's facts |
| org | Acme, Northwind |
| place | Mumbai office |
| topic | ICICI margin, Series A |
| preference | mornings for deep work, WhatsApp over email |
| schedule | School pickup weekdays 16:00–16:30, Gym, Golf — personal protected windows **not** on Google Calendar |
| constraint | no meetings before 10 (non-timed / soft rules) |
| goal | close Q3 budget, ship Amilo WA |

Prefer typed **edges** over stuffing relations into attrs. Important CoS edge: `waiting_on` (user → person) when the user arms a watch.

For timed recurring “don’t book me” windows, use **`schedule`** (attrs: `days`, `startHm`, `endHm`; optional hold: `holdUntilIso`, `autoDecline`). Do not invent Google Calendar events for gym/pickup/golf unless the user asks to put them on the calendar.

## Edge relations (examples)

`works_with`, `reports_to`, `family_of`, `cares_about`, `blocks`, `prefers`, `owns`, `decides`, `waiting_on`

## Rules

1. Extract only **durable** facts — not one-off chatter. Prefer `preference`, `schedule`, `constraint`, and `goal` when the user states lasting work/life ops facts (still no emotional/companion diary).
2. Prefer upsert by label (case-insensitive) over duplicate nodes.
3. Confidence 0–1; lower when inferred, higher when explicit ("Priya is my CFO").
4. Graph is **silent context** in normal replies — never perform memory ("as you told me…"). **Exception:** when the user explicitly inspects (`about me`, `about <name>`, `memory`), answer with stored facts only.
5. Wrong or superseded facts: lower confidence or supersede via a new observation; do not argue with the user. Users can `forget <name>` or `forget <name> <attr>`.
6. Return graph updates in the same JSON response as the reply intent (single model call).

## Output shape (for the brain)

```json
{
  "intent": { "type": "reply_text", "text": "…" },
  "graphUpdates": [
    {
      "op": "upsert_node",
      "kind": "person",
      "label": "Priya",
      "attrs": { "role": "CFO" },
      "confidence": 0.95
    },
    {
      "op": "upsert_edge",
      "fromLabel": "user",
      "toLabel": "Priya",
      "rel": "works_with",
      "confidence": 0.9
    }
  ]
}
```

`fromLabel: "user"` means the Amilo user themselves (synthetic node).
