#!/usr/bin/env bash
# Deploy Amilo WhatsApp API to staging (amilo-api-staging).
# Builds amilo-wa:<sha> and tags :staging. Does not touch production.
#
# DNS (Cloudflare): api-staging.amilo.io → CNAME amilo-api-staging.azurewebsites.net
# Meta: dedicated staging WABA number → https://api-staging.amilo.io/webhooks/whatsapp
# See docs/API_SUBDOMAIN.md
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/deploy_common.sh"

APP_NAME="amilo-api-staging"
ENV_FILE="${ENV_FILE:-.env.staging}"
DB_FILE="${DB_FILE:-.env.azure.db.staging}"

amilo_load_env_files "$ENV_FILE" "$DB_FILE"
export AMILO_ENV=staging
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://api-staging.amilo.io}"
export GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-https://api-staging.amilo.io/oauth/google/callback}"

IMAGE_TAG="$(git rev-parse --short HEAD)"
ACR_LOGIN_SERVER="$(amilo_acr_login_server)"

echo "== Build + push ${AMILO_IMAGE_NAME}:${IMAGE_TAG} + :staging (ACR Tasks) =="
az acr build --registry "$AMILO_ACR_NAME" --resource-group "$AMILO_RESOURCE_GROUP" \
  --build-arg GIT_SHA="${IMAGE_TAG}" \
  --image "${AMILO_IMAGE_NAME}:${IMAGE_TAG}" \
  --image "${AMILO_IMAGE_NAME}:staging" .

echo "== Ensure web app ${APP_NAME} =="
amilo_ensure_webapp "$APP_NAME" "${ACR_LOGIN_SERVER}/${AMILO_IMAGE_NAME}:${IMAGE_TAG}"

echo "== Container + settings (${APP_NAME}) =="
amilo_apply_container_and_settings "$APP_NAME" "$IMAGE_TAG" "$ACR_LOGIN_SERVER"

HOST="$(az webapp show --name "$APP_NAME" --resource-group "$AMILO_RESOURCE_GROUP" --query defaultHostName -o tsv)"
echo
echo "Staging deployed: https://${HOST}/health"
echo "Public (after DNS): https://api-staging.amilo.io/health"
echo "Webhook: https://api-staging.amilo.io/webhooks/whatsapp"
echo "OAuth:   https://api-staging.amilo.io/oauth/google/callback"
echo
echo "Promote to prod only after WA smoke: ./deploy_prod.sh ${IMAGE_TAG}"
echo "Production was not touched."
