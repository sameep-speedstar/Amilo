# WABA templates — submit checklist

Submit in **Meta Business Manager → WhatsApp Manager → Message Templates**.  
Category: **Utility**. Language: **English**.

Status: Facebook Business approved + number added. Templates still need creation/approval.

---

## 1. `morning_briefing`

**Body**

```
Good morning, {{1}} — {{2}}.

{{3}}

Reply 1, 2 or 3 for details, M for more, or send a voice note.
```

**Sample**

- `{{1}}` = `Sameep`
- `{{2}}` = `Tuesday, 5 August`
- `{{3}}` = `You have 3 priorities today: [Work] Client call at 2pm needs prep. [Personal] Gift for Mom not ordered. [Work] Invoice #4021 needs reply. 12 items handled quietly.`

**App usage:** Always send morning briefings as this template (not free-form), for reliability outside the 24h window.

---

## 2. `evening_summary`

**Body**

```
Evening wrap, {{1}}.

{{2}}

Anything to capture before tomorrow? Send a voice note.
```

**Sample**

- `{{1}}` = `Sameep`
- `{{2}}` = `Today: closed the Q3 budget review, confirmed Friday flight. Tomorrow's first meeting is at 9am with design.`

---

## 3. `priority_alert`

**Body**

```
{{1}}, this needs you: {{2}}

Reply 1 to act, 2 to snooze to this evening, 3 to ignore.
```

**Sample**

- `{{1}}` = `Sameep`
- `{{2}}` = `your flight check-in closes in 40 minutes and you haven't checked in yet`

**App usage:** Free-form inside 24h window; this template only when the window is closed. Quiet hours suppress except VIP + money/deadline emergencies (M4+).

---

## Review risk

Meta Utility is meant for transactional content. Proactive AI briefings may bounce to Marketing or request revision. If rejected:

1. Tighten body to sound more like an account/status update.
2. Keep a single `{{3}}` body blob (survives review better than many variables).
3. Re-submit; Telegram control bot keeps founder loop unblocked.

## After approval

Set template names in env / config to match exactly (`morning_briefing`, `evening_summary`, `priority_alert`) — see `TEMPLATE_NAMES` in `@amilo/channels-whatsapp`.

## Founder checklist

- [ ] Create `morning_briefing` (Utility / EN)
- [ ] Create `evening_summary` (Utility / EN)
- [ ] Create `priority_alert` (Utility / EN)
- [ ] Wait for Approved
- [ ] Paste WABA tokens into `.env` (`WABA_ACCESS_TOKEN`, `WABA_PHONE_NUMBER_ID`, `WABA_APP_SECRET`, `WABA_VERIFY_TOKEN`)
- [ ] Point Meta webhook to `https://<host>/webhooks/whatsapp`
