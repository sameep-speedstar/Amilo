# Amilo marketing site (amilo.io)

Static HTML for the public brand site. Invite forms post to `https://api.amilo.io/access-requests`.

## Deploy

Preview (Azure static): `https://amilostaticweb.z29.web.core.windows.net/`

```bash
# from repo root
az storage blob upload-batch -d '$web' -s site \
  --account-name amilostaticweb --auth-mode login --overwrite
```

Point Cloudflare `amilo.io` / `www` origin at that static host (or upload `index.html` + `invite.html` to the existing CF Pages project).
