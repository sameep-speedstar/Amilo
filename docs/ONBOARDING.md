# Beta onboarding (invite + allowlist)

Friends join Amilo by scanning a QR or opening an invite link. That lands on `api.amilo.io`, allowlists their WhatsApp number, then opens WhatsApp (`wa.me`) with a prefilled **Hi Amilo**.

Website interest form (`amilo.io/invite.html`) posts to the API; requests sit in admin until you approve.

## Days 1–7 activation guide

After first chat (`Hi Amilo` / what can you do), Amilo stamps `prefs.onboarding.startedAt` and runs a **milestone-gated** guide:

| Day | Tip |
|-----|-----|
| 1 | 3 short bubbles: hello+contact · what I do · connect Google |
| 2–7 | **Training tip #1…#6** — pushed ≤1/day (or ask `training tip` anytime) |

Rules:

- Tips labeled `Training tip #N`; ask `training tip` / `next tip` to pull the next one same day
- ≤1 automatic tip / local day; tips append under the morning brief when Google is linked
- No-Google users get a standalone tip mid-morning **inside** the WhatsApp 24h window only
- Google is suggested on Days 1–2 only — never nagged after
- `skip onboarding` exits the guide
- Collapse ahead if the user already completed milestones

## Admin login

1. Set `ADMIN_EMAIL=sameep@speedstar.ai` and `ADMIN_PASSWORD` (e.g. `openssl rand -base64 24`).
2. Open `https://api.amilo.io/admin` → sign in with that email + password.
3. Optional emergency: `ADMIN_TOKEN` still works as `?token=` / cookie (legacy).

## Admin tabs

| Tab | What |
|-----|------|
| Overview | Requests received · pending · this week · **active users** · conversion |
| Requests | Website form queue — Approve / Decline / Spam |
| Users | Allowlist phones |
| Invites | Manual invite QR/links |
| Usage | 7-day cost / interactions |

**Approve** allowlists the phone, creates a 14-day invite, and shows the share link. When they message Amilo, status flips to **active**.

## Website form → API

Point `invite.html` at:

```http
POST https://api.amilo.io/access-requests
Content-Type: application/json

{
  "name": "Priya Sharma",
  "phone": "+9198XXXXXXXX",
  "email": "priya@example.com",
  "source": "Friend",
  "detail": "optional note",
  "page": "https://amilo.io/invite.html",
  "company": ""
}
```

CORS allows `https://amilo.io` and `https://www.amilo.io`. Honeypot field `company` must be empty.

Replace (or dual-write alongside) the current Web3Forms submit.

**Live form endpoint:** `POST https://api.amilo.io/access-requests` (already wired in `site/`).

**Preview host (Azure static):** https://amilostaticweb.z29.web.core.windows.net/  
Point Cloudflare `amilo.io` / `www` at that static origin, or upload `site/index.html` + `site/invite.html` to the existing Pages project. Until then, production `amilo.io` still posts to Web3Forms.

## Caps / cost

Each brain turn (and STT) is metered in `usage_events`. Defaults:

- `USAGE_DAY_CAP=40` — resets at **local midnight** (user timezone, default IST)
- `USAGE_WEEK_CAP=150` — rolling 7 days

Host / operator phones are never capped: `ALLOWED_PHONES`, `HOST_PHONE`, `USAGE_CAP_EXEMPT_PHONES`, plus the product host number.

Over-cap users get a short WhatsApp message instead of a brain reply. Weekly cost rollup is on the Usage tab.

## LinkedIn / early-adopter beta

- Production (`api.amilo.io`) is the stable beta surface — invite form → admin approve → allowlist → `wa.me` **Hi Amilo**.
- LinkedIn CTA should point at `https://amilo.io` invite / QR (same path as friends).
- **Freeze:** life-ops and experimental work deploy to **staging** first (`./deploy_staging.sh`); promote with `./deploy_prod.sh <sha>` only after WA smoke.
- Monitor admin **Usage** after announce; day/week caps stay on.

## Meta Dev mode

If the WhatsApp app is still in Development, also add the friend’s number as a Meta test recipient. Allowlist alone is not enough until the app is Live.
