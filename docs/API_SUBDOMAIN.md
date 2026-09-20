# Dedicated API subdomain: `api.amilo.io` (+ staging)

Marketing / privacy stay on `www.amilo.io`.  
WhatsApp webhooks + Amilo API live on **`api.amilo.io`** (production) and **`api-staging.amilo.io`** (staging).

Privacy (already live): https://www.amilo.io/privacy

## Target URLs

| Purpose | Production | Staging |
|---------|------------|---------|
| Health | `https://api.amilo.io/health` | `https://api-staging.amilo.io/health` |
| Meta webhook | `https://api.amilo.io/webhooks/whatsapp` | `https://api-staging.amilo.io/webhooks/whatsapp` |
| Google OAuth | `https://api.amilo.io/oauth/google/callback` | `https://api-staging.amilo.io/oauth/google/callback` |
| App Service | `amilo-api` | `amilo-api-staging` |
| Postgres DB | `amilo` on `amilo-pg` | `amilo_staging` on `amilo-pg` |
| Env files | `.env` + `.env.azure.db` | `.env.staging` + `.env.azure.db.staging` |
| Image tags | `amilo-wa:<sha>` (+ `:latest` on promote) | `amilo-wa:<sha>` + `:staging` |

LifeOS Telegram bot stays on `amilo-app` — this is a **separate** App Service family: `amilo-api` / `amilo-api-staging`.

**Do not** share one WABA phone number across staging and prod webhooks. Meta binds one callback URL per WABA app/number.

## 1. Deploy staging (default for new work)

```bash
# copy .env.staging.example → .env.staging; set staging WABA + ALLOWED_PHONES (founder only)
# DATABASE_URL in .env.azure.db.staging → …/amilo_staging?sslmode=require
chmod +x deploy_staging.sh deploy_prod.sh
./deploy_staging.sh
```

Creates/updates:

- ACR images `amiloacr.azurecr.io/amilo-wa:<sha>` and `:staging`
- App Service `amilo-api-staging` on plan `amilo-plan`

Migrate staging DB once (from repo root, with staging URL loaded):

```bash
set -a && source .env.azure.db.staging && set +a
npm run db:migrate
```

## 2. Promote to production (after WA smoke)

```bash
./deploy_prod.sh <sha>   # same tag already pushed by deploy_staging.sh
```

Prod deploy **does not rebuild**. It refuses a dirty tree by default and requires the tag to exist in ACR. Production beta users only get smoked images.

Legacy `./deploy_azure.sh` now redirects to this promote path (passes through args).

## 3. Cloudflare DNS

Production (already live):

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | `api` | `amilo-api.azurewebsites.net` | DNS only first |

Staging (add):

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| CNAME | `api-staging` | `amilo-api-staging.azurewebsites.net` | DNS only first |

```bash
# After DNS propagates — bind hostname + cert on staging
az webapp config hostname add \
  --webapp-name amilo-api-staging \
  --resource-group rg-lifeos \
  --hostname api-staging.amilo.io

az webapp config ssl bind \
  --name amilo-api-staging \
  --resource-group rg-lifeos \
  --certificate-thumbprint "$(az webapp config ssl create \
      --name amilo-api-staging \
      --resource-group rg-lifeos \
      --hostname api-staging.amilo.io \
      --query thumbprint -o tsv)" \
  --ssl-type SNI
```

Add staging redirect URI to the shared Google OAuth client:
`https://api-staging.amilo.io/oauth/google/callback`

## 4. Meta webhook (per environment)

**Production** (existing number):

- Callback: `https://api.amilo.io/webhooks/whatsapp`
- Verify token: `WABA_VERIFY_TOKEN` in `.env`

**Staging** (dedicated test / second number):

- Callback: `https://api-staging.amilo.io/webhooks/whatsapp`
- Verify token: staging `WABA_VERIFY_TOKEN` in `.env.staging`
- Subscribe: `messages`

## 5. Smoke checks

```bash
curl -s https://api-staging.amilo.io/health   # or Azure host before DNS
curl -s https://api.amilo.io/health
```

Staging WA: Hi Amilo · sync/brief · calendar yes · reminder · one invite (no duplicate) · life-ops research yes (no book claim).

Promote checklist (before `./deploy_prod.sh <sha>`): same smoke on staging, then prod health unchanged until promote completes.

## Notes

- Do **not** point `www.amilo.io/webhooks/...` at the API unless you also configure a Cloudflare Worker/Page Rule — subdomain is cleaner.
- App must be **published** in Meta for production message delivery (dashboard warns while unpublished).
- Templates (`morning_update`, `evening_wrap`, `priority_update`) must be **Approved** before template sends work; free-form still works inside the 24h window after a user messages you.
