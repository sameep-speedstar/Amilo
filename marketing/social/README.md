# Social pipeline — X @Amilo_io · Instagram @amilo.io

The live multi-product publisher is **Studio** at `/studio` on the API (admin login). Paste a plan, drop visuals or build a WhatsApp mockup, save handle keys, and the worker posts when due.

This folder still holds the original Amilo mockup JSON and the CLI (`npm run social:render` / `social:post`) if you want files on disk instead of the webapp.

Renders WhatsApp-style conversation mockups (or your redacted Amilo screenshots), then posts them.

```
npm run social:render                 # all mockups → marketing/social/out/
npm run social:render -- --id ig-01   # one post
npm run social:post                   # dry-run whatever is due today (IST)
npm run social:post -- --id x-01      # dry-run one post
npm run social:post -- --live --id x-01
npm run social:post -- --live --today --stories
```

Drop a real screenshot at `marketing/social/inbox/<post-id>/01.png`. After names, amounts, and other people's mail are gone, add an empty `READY` file in that folder. Render prefers inbox over the mockup.

## Credentials (`.env`)

X (OAuth 1.0a user context, write + media):

```
X_API_KEY=
X_API_SECRET=
X_ACCESS_TOKEN=
X_ACCESS_SECRET=
```

Instagram (Business/Creator account linked to a Facebook Page; long-lived Page token):

```
IG_USER_ID=
IG_ACCESS_TOKEN=
AZURE_STORAGE_ACCOUNT=amilostaticweb
SOCIAL_PUBLIC_BASE=https://amilo.io
```

Instagram cannot take a local file. Live IG posts upload PNGs to Azure `$web/social-tmp/` so Meta can fetch `https://amilo.io/social-tmp/…`. You must be logged in with `az`. X uploads from disk and does not need Azure.

`marketing/social/posted.json` is the ledger so a post is not sent twice. `--force` republishes.
