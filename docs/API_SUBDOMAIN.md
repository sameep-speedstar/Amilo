# Dedicated API subdomain: `api.amilo.io`

Marketing / privacy stay on `www.amilo.io`.  
WhatsApp webhooks + Amilo API live on **`api.amilo.io`**.

Privacy (already live): https://www.amilo.io/privacy

## Target URLs

| Purpose | URL |
|---------|-----|
| Health | `https://api.amilo.io/health` |
| Meta webhook | `https://api.amilo.io/webhooks/whatsapp` |
| Azure default (before DNS) | `https://amilo-api.azurewebsites.net/webhooks/whatsapp` |

LifeOS Telegram bot stays on `amilo-app` — this is a **separate** App Service: `amilo-api`.

## 1. Deploy the API (Azure)

From this repo root (with `.env` filled):

```bash
chmod +x deploy_azure.sh
./deploy_azure.sh
```

Creates/updates:

- ACR image `amiloacr.azurecr.io/amilo-wa:<sha>`
- App Service `amilo-api` on plan `amilo-plan` (shared with LifeOS; separate container)

## 2. Cloudflare DNS (you do this in the dashboard)

`amilo.io` is already on Cloudflare. Add:

| Type | Name | Content | Proxy status |
|------|------|---------|--------------|
| CNAME | `api` | `amilo-api.azurewebsites.net` | **DNS only** (grey cloud) first |

Wait 1–2 minutes for propagation (`dig api.amilo.io`).

## 3. Bind custom domain + free cert (Azure)

```bash
az webapp config hostname add \
  --webapp-name amilo-api \
  --resource-group rg-lifeos \
  --hostname api.amilo.io

az webapp config ssl bind \
  --name amilo-api \
  --resource-group rg-lifeos \
  --certificate-thumbprint "$(az webapp config ssl create \
      --name amilo-api \
      --resource-group rg-lifeos \
      --hostname api.amilo.io \
      --query thumbprint -o tsv)" \
  --ssl-type SNI
```

If hostname add asks for domain verification, Cloudflare may need a TXT record Azure prints — add it under DNS, wait, retry.

After HTTPS works on `api.amilo.io`, you may turn the Cloudflare proxy **orange** (Proxied) if you want CF WAF — use SSL mode **Full (strict)**.

## 4. Meta webhook

In Meta → WhatsApp → Production setup → Configure Webhooks:

- **Callback URL:** `https://api.amilo.io/webhooks/whatsapp`
- **Verify token:** same as `WABA_VERIFY_TOKEN` in `.env`
- Subscribe to: `messages`

Click **Verify and save**.

## 5. Smoke checks

```bash
curl -s https://api.amilo.io/health
# {"ok":true,"service":"amilo",...}
```

## Notes

- Do **not** point `www.amilo.io/webhooks/...` at the API unless you also configure a Cloudflare Worker/Page Rule — subdomain is cleaner.
- App must be **published** in Meta for production message delivery (dashboard warns while unpublished).
- Templates (`morning_update`, `evening_wrap`, `priority_update`) must be **Approved** before template sends work; free-form still works inside the 24h window after a user messages you.
