#!/usr/bin/env bash
# Promote a staging-smoked image tag to production (amilo-api).
#
# Usage:
#   ./deploy_prod.sh <sha>          # required: tag already pushed (and preferably :staging)
#   ALLOW_DIRTY=1 ./deploy_prod.sh  # optional override — still requires IMAGE_TAG
#
# Default: refuses dirty git tree and refuses tags that were never pushed to ACR.
# Does not rebuild — promotes an existing ACR tag so staging and prod run the same bits.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"
# shellcheck disable=SC1091
source "$ROOT/deploy_common.sh"

APP_NAME="amilo-api"
ENV_FILE="${ENV_FILE:-.env}"
DB_FILE="${DB_FILE:-.env.azure.db}"

IMAGE_TAG="${1:-}"
if [[ -z "$IMAGE_TAG" ]]; then
  echo "Usage: ./deploy_prod.sh <image-tag>" >&2
  echo "  Promote a tag already built via ./deploy_staging.sh (e.g. abc1234)." >&2
  exit 1
fi

if [[ "${ALLOW_DIRTY:-}" != "1" ]]; then
  if [[ -n "$(git status --porcelain)" ]]; then
    echo "Working tree is dirty. Commit/stash, smoke on staging, then promote." >&2
    echo "Or set ALLOW_DIRTY=1 to override (still uses the given tag, not a rebuild)." >&2
    exit 1
  fi
fi

amilo_load_env_files "$ENV_FILE" "$DB_FILE"
export AMILO_ENV=production
export PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-https://api.amilo.io}"
export GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-https://api.amilo.io/oauth/google/callback}"

ACR_LOGIN_SERVER="$(amilo_acr_login_server)"

if ! amilo_image_exists "$IMAGE_TAG"; then
  echo "ACR has no ${AMILO_IMAGE_NAME}:${IMAGE_TAG}. Deploy staging first." >&2
  exit 1
fi

if ! amilo_image_exists "staging"; then
  echo "Warning: :staging tag missing — prefer smoke via ./deploy_staging.sh before promote." >&2
fi

echo "== Promote ${AMILO_IMAGE_NAME}:${IMAGE_TAG} → ${APP_NAME} (no rebuild) =="
amilo_ensure_webapp "$APP_NAME" "${ACR_LOGIN_SERVER}/${AMILO_IMAGE_NAME}:${IMAGE_TAG}"
# Also retag :latest for ops convenience (same digest as smoked sha).
az acr import --name "$AMILO_ACR_NAME" --source "${ACR_LOGIN_SERVER}/${AMILO_IMAGE_NAME}:${IMAGE_TAG}" \
  --image "${AMILO_IMAGE_NAME}:latest" --force >/dev/null 2>&1 || true

amilo_apply_container_and_settings "$APP_NAME" "$IMAGE_TAG" "$ACR_LOGIN_SERVER"

HOST="$(az webapp show --name "$APP_NAME" --resource-group "$AMILO_RESOURCE_GROUP" --query defaultHostName -o tsv)"
echo
echo "Production promoted: https://${HOST}/health"
echo "Public: https://api.amilo.io/health"
echo "Image: ${ACR_LOGIN_SERVER}/${AMILO_IMAGE_NAME}:${IMAGE_TAG}"
echo
echo "Smoke checklist: Hi Amilo · sync/brief · calendar yes · reminder · one invite (no duplicate)"
