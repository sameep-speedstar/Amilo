#!/usr/bin/env bash
# Deploy Amilo WhatsApp API (this repo) to Azure App Service.
# Separate from LifeOS Telegram (`amilo-app`) — shared ACR + plan, different
# image/app so the Claude bot stays untouched.
#
# After first deploy, point Cloudflare DNS:
#   api.amilo.io  CNAME  amilo-api.azurewebsites.net
# See docs/API_SUBDOMAIN.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

RESOURCE_GROUP="rg-lifeos"
ACR_NAME="amiloacr"
PLAN_NAME="amilo-plan"
APP_NAME="amilo-api"
IMAGE_NAME="amilo-wa"

if [[ ! -f .env ]]; then
  echo ".env not found — copy .env.example and fill WABA_* values." >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
if [[ -f .env.azure.db ]]; then
  # Production Postgres URL (overrides local docker DATABASE_URL)
  # shellcheck disable=SC1091
  source .env.azure.db
fi
set +a

if [[ -z "${DATABASE_URL:-}" || "$DATABASE_URL" == *"localhost"* ]]; then
  echo "DATABASE_URL must point at Azure Postgres (.env.azure.db). Aborting." >&2
  exit 1
fi

REQUIRED_VARS=(
  WABA_VERIFY_TOKEN
  WABA_APP_SECRET
  WABA_ACCESS_TOKEN
  WABA_PHONE_NUMBER_ID
)

for var in "${REQUIRED_VARS[@]}"; do
  if [[ -z "${!var:-}" || "${!var}" == "change-me" ]]; then
    echo "$var is missing or still a placeholder in .env — aborting." >&2
    exit 1
  fi
done

IMAGE_TAG="$(git rev-parse --short HEAD)"
ACR_LOGIN_SERVER="$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" \
  --query loginServer -o tsv)"

echo "== Build + push ${IMAGE_NAME}:${IMAGE_TAG} (ACR Tasks) =="
az acr build --registry "$ACR_NAME" --resource-group "$RESOURCE_GROUP" \
  --build-arg GIT_SHA="${IMAGE_TAG}" \
  --image "${IMAGE_NAME}:${IMAGE_TAG}" --image "${IMAGE_NAME}:latest" .

echo "== Ensure web app ${APP_NAME} =="
if ! az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null 2>&1; then
  az webapp create --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
    --plan "$PLAN_NAME" \
    --deployment-container-image-name "${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}"
  az webapp identity assign --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null
fi

PRINCIPAL_ID="$(az webapp identity show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --query principalId -o tsv)"
ACR_ID="$(az acr show --name "$ACR_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)"
az role assignment create --assignee "$PRINCIPAL_ID" --scope "$ACR_ID" \
  --role AcrPull >/dev/null 2>&1 || true

echo "== Container + Always On =="
az webapp config container set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --docker-custom-image-name "${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}" \
  --docker-registry-server-url "https://${ACR_LOGIN_SERVER}" >/dev/null
az webapp config set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --always-on true --linux-fx-version "DOCKER|${ACR_LOGIN_SERVER}/${IMAGE_NAME}:${IMAGE_TAG}" >/dev/null
az webapp config appsettings set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --settings \
    WEBSITES_PORT=8080 \
    NODE_ENV=production \
    PORT=8080 \
    DATABASE_URL="${DATABASE_URL:-}" \
    ALLOWED_PHONES="${ALLOWED_PHONES:-}" \
    WABA_VERIFY_TOKEN="$WABA_VERIFY_TOKEN" \
    WABA_APP_SECRET="$WABA_APP_SECRET" \
    WABA_ACCESS_TOKEN="$WABA_ACCESS_TOKEN" \
    WABA_PHONE_NUMBER_ID="$WABA_PHONE_NUMBER_ID" \
    WABA_BUSINESS_ACCOUNT_ID="${WABA_BUSINESS_ACCOUNT_ID:-}" \
    WABA_TEMPLATE_MORNING="${WABA_TEMPLATE_MORNING:-morning_update}" \
    WABA_TEMPLATE_EVENING="${WABA_TEMPLATE_EVENING:-evening_wrap}" \
    WABA_TEMPLATE_ALERT="${WABA_TEMPLATE_ALERT:-priority_update}" \
    CURSOR_API_KEY="${CURSOR_API_KEY:-}" \
    CURSOR_MODEL="${CURSOR_MODEL:-composer-2.5}" \
    CURSOR_BRAIN_REPO="${CURSOR_BRAIN_REPO:-https://github.com/sameep-speedstar/Amilo}" \
    CURSOR_BRAIN_REF="${CURSOR_BRAIN_REF:-main}" \
    XAI_API_KEY="${XAI_API_KEY:-}" \
    GROK_MODEL="${GROK_MODEL:-grok-4-1-fast-non-reasoning}" \
    PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://api.amilo.io}" \
    GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
    GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
    GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-https://api.amilo.io/oauth/google/callback}" \
    TOKEN_ENCRYPTION_KEY="${TOKEN_ENCRYPTION_KEY:-}" \
    SARVAM_API_KEY="${SARVAM_API_KEY:-}" \
    SARVAM_MODEL="${SARVAM_MODEL:-saarika:v2.5}" \
    SARVAM_LANGUAGE_CODE="${SARVAM_LANGUAGE_CODE:-unknown}" \
    GOOGLE_MAPS_API_KEY="${GOOGLE_MAPS_API_KEY:-}" \
    ADMIN_TOKEN="${ADMIN_TOKEN:-}" \
    ADMIN_EMAIL="${ADMIN_EMAIL:-sameep@speedstar.ai}" \
    ADMIN_PASSWORD="${ADMIN_PASSWORD:-}" \
    ADMIN_PASSWORD_HASH="${ADMIN_PASSWORD_HASH:-}" \
    ADMIN_PASSWORD_SALT="${ADMIN_PASSWORD_SALT:-}" \
    WABA_DISPLAY_PHONE="${WABA_DISPLAY_PHONE:-}" \
    USAGE_DAY_CAP="${USAGE_DAY_CAP:-40}" \
    USAGE_WEEK_CAP="${USAGE_WEEK_CAP:-150}" \
    HOST_PHONE="${HOST_PHONE:-}" \
    USAGE_CAP_EXEMPT_PHONES="${USAGE_CAP_EXEMPT_PHONES:-}" \
    GIT_SHA="${IMAGE_TAG}" \
    DOCKER_ENABLE_CI=true \
    WEBSITE_PULL_IMAGE_OVER_VNET=false \
  >/dev/null

# ACR pull via managed identity (no admin creds)
az webapp config appsettings set --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" \
  --settings \
    "DOCKER_REGISTRY_SERVER_URL=https://${ACR_LOGIN_SERVER}" \
  >/dev/null
az resource update --ids "$(az webapp show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query id -o tsv)/config/web" \
  --set properties.acrUseManagedIdentityCreds=true >/dev/null 2>&1 || true

echo "== Restart =="
az webapp restart --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" >/dev/null

HOST="$(az webapp show --name "$APP_NAME" --resource-group "$RESOURCE_GROUP" --query defaultHostName -o tsv)"
echo
echo "Deployed: https://${HOST}/health"
echo "Webhook (Azure hostname): https://${HOST}/webhooks/whatsapp"
echo
echo "Next — Cloudflare DNS (see docs/API_SUBDOMAIN.md):"
echo "  Type: CNAME"
echo "  Name: api"
echo "  Target: ${HOST}"
echo "  Proxy: DNS only (grey cloud) until Azure cert binds, then can enable orange cloud"
echo
echo "Then Meta callback URL:"
echo "  https://api.amilo.io/webhooks/whatsapp"
