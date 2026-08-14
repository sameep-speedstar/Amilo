# Beta onboarding (invite + allowlist)

Friends join Amilo by scanning a QR or opening an invite link. That lands on `api.amilo.io`, allowlists their WhatsApp number, then opens WhatsApp (`wa.me`) with a prefilled **Hi Amilo**.

## Admin

1. Set `ADMIN_TOKEN` (e.g. `openssl rand -hex 24`) and `WABA_DISPLAY_PHONE` (business number E.164).
2. Open `https://api.amilo.io/admin?token=<ADMIN_TOKEN>`.
3. **Add phone** to allowlist, and/or **Create invite**:
   - With phone → friend is allowlisted immediately; link/QR opens WhatsApp.
   - Without phone → friend enters their number once, then WhatsApp opens.
4. Share `/i/<token>` or `/i/<token>/qr`.

Env `ALLOWED_PHONES` still works alongside the DB allowlist.

## Caps / cost

Each brain turn (and STT) is metered in `usage_events`. Defaults:

- `USAGE_DAY_CAP=40`
- `USAGE_WEEK_CAP=150`

Over-cap users get a short WhatsApp message instead of a brain reply. Weekly cost rollup is on the admin page.

## Meta Dev mode

If the WhatsApp app is still in Development, also add the friend’s number as a Meta test recipient. Allowlist alone is not enough until the app is Live.
