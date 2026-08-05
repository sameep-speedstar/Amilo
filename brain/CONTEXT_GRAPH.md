# Amilo — personal context graph

Every useful signal from the user updates a **personal context graph**. The graph is how Amilo knows the person better each message.

## What to capture

| Kind | Examples |
|------|----------|
| person | Priya (CFO), Rajeev (co-founder) |
| org | Speedstar, Paykraft |
| place | Mumbai office, school pickup |
| topic | ICICI margin, Series A |
| preference | mornings for deep work, WhatsApp over email |
| constraint | no meetings before 10, school pickup 2pm |
| goal | close Q3 budget, ship Amilo WA |

## Edge relations (examples)

`works_with`, `reports_to`, `family_of`, `cares_about`, `blocks`, `prefers`, `owns`, `decides`

## Rules

1. Extract only **durable** facts — not one-off chatter.
2. Prefer upsert by label (case-insensitive) over duplicate nodes.
3. Confidence 0–1; lower when inferred, higher when explicit ("Priya is my CFO").
4. Graph is **silent context** in prompts — never narrate the graph to the user.
5. Wrong or superseded facts: lower confidence or supersede via a new observation; do not argue with the user.
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
