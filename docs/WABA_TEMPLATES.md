# WABA templates — submit checklist

Submit in **Meta Business Manager → WhatsApp Manager → Message Templates**.  
Category: **Utility**. Language: **English**.

**Status**

| Role | Meta template name | Notes |
|------|--------------------|--------|
| Morning (legacy) | `morning_update` | Single `{{3}}` blob — flattens to one line (no real bullets) |
| Evening (legacy) | `evening_wrap` | Single `{{2}}` blob — same limitation |
| Alert | `priority_update` | Live |
| Morning (bullets) | `morning_update_v2` | **Submit this** — static FOCUS lines + one var per item |
| Evening (bullets) | `evening_wrap_v2` | **Submit this** — TODAY / TOMORROW / STILL OPEN |

After `*_v2` are Approved, set:

```
WABA_TEMPLATE_MORNING=morning_update_v2
WABA_TEMPLATE_EVENING=evening_wrap_v2
```

Code auto-detects `_v2` / `_bullets` / `_focus` suffix and fills six body variables.

Inside the WhatsApp **24h window**, Amilo sends free-form text with real newlines (preferred). Templates are only for outside-window scheduled briefs.

---

## 1. `morning_update` (legacy — live)

**Body**

```
Good morning, {{1}} — {{2}}.

{{3}}

Reply 1, 2 or 3 for details, M for more, or send a voice note.
```

**App usage:** Fallback when `WABA_TEMPLATE_MORNING` is still `morning_update`. `{{3}}` is flattened (Meta forbids newlines inside variables).

---

## 1b. `morning_update_v2` (submit)

**Body** — bullets are static; each focus slot is its own variable (no newlines inside vars):

```
Good morning, {{1}} — {{2}}.

FOCUS
1) {{3}}
2) {{4}}
3) {{5}}

{{6}}

Reply 1, 2 or 3 for details, M for more, or send a voice note.
```

**Sample**

- `{{1}}` = `Sameep`
- `{{2}}` = `Thursday 3 September`
- `{{3}}` = `Escrow addendum — Yogish`
- `{{4}}` = `KYC update — OneCard`
- `{{5}}` = `—`
- `{{6}}` = `6 quieter yesterday. Reply M for more.`

Empty focus slots use an em dash (`—`).

---

## 2. `evening_wrap` (legacy — live)

**Body**

```
Evening wrap, {{1}}.

{{2}}

Anything to capture before tomorrow? Send a voice note.
```

---

## 2b. `evening_wrap_v2` (submit)

**Body**

```
Evening wrap, {{1}}.

TODAY
{{2}}

TOMORROW
{{3}}

STILL OPEN
1) {{4}}
2) {{5}}
3) {{6}}

Anything to capture before tomorrow? Send a voice note.
```

**Sample**

- `{{1}}` = `Sameep`
- `{{2}}` = `10:30 Esaas TSP · 16:00 Board prep`
- `{{3}}` = `09:00 Standup · 14:00 Client call`
- `{{4}}` = `Send revised deck to Ameya`
- `{{5}}` = `—`
- `{{6}}` = `—`

`{{2}}` / `{{3}}` stay single-line summaries (Meta variable rule). Vertical layout comes from the static TODAY / TOMORROW / STILL OPEN headings.

---

## 3. `priority_update`

**Body**

```
{{1}}, this needs you: {{2}}

Reply 1 to act, 2 to snooze to this evening, 3 to ignore.
```

**App usage:** Free-form inside 24h window; this template only when the window is closed.

---

## Review risk

Meta Utility is meant for transactional content. Proactive AI briefings may bounce to Marketing or request revision. If rejected:

1. Tighten body to sound more like an account/status update.
2. Keep focus slots as separate short variables (survives review better than one giant blob with fake newlines).
3. Re-submit; free-form on-demand `brief` still works inside 24h.

---

## After approval

Set template names in Azure / `.env` to match Meta exactly:

```
WABA_TEMPLATE_MORNING=morning_update_v2
WABA_TEMPLATE_EVENING=evening_wrap_v2
WABA_TEMPLATE_ALERT=priority_update
```

## Founder checklist

- [x] Create `morning_update` (Utility / EN)
- [x] Create `evening_wrap` (Utility / EN)
- [x] Create `priority_update` (Utility / EN)
- [ ] Create `morning_update_v2` (Utility / EN) — bullets
- [ ] Create `evening_wrap_v2` (Utility / EN) — bullets
- [ ] Wait for Approved → flip env vars + redeploy
- [x] Deploy API + bind `api.amilo.io`
- [x] Point Meta webhook to `https://api.amilo.io/webhooks/whatsapp`
