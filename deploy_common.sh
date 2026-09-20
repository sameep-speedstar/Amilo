#!/usr/bin/env bash
# Shared Azure deploy helpers for Amilo WhatsApp API (staging + production).
# Sourced by deploy_staging.sh / deploy_prod.sh — not run directly.
set -euo pipefail

AMILO_RESOURCE_GROUP="${AMILO_RESOURCE_GROUP:-rg-lifeos}"
AMILO_ACR_NAME="${AMILO_ACR_NAME:-amiloacr}"
AMILO_PLAN_NAME="${AMILO_PLAN_NAME:-amilo-plan}"
AMILO_IMAGE_NAME="${AMILO_IMAGE_NAME:-amilo-wa}"

amilo_require_var() {
  local var="$1"
  if [[ -z "${!var:-}" || "${!var}" == "change-me" ]]; then
    echo "$var is missing or still a placeholder — aborting." >&2
    exit 1
  fi
}

amilo_load_env_files() {
  local env_file="$1"
  local db_file="$2"
  if [[ ! -f "$env_file" ]]; then
    echo "$env_file not found — copy the matching .example and fill values." >&2
    exit 1
  fi
  set -a
  # shellcheck disable=SC1090
  source "$env_file"
  if [[ -f "$db_file" ]]; then
    # shellcheck disable=SC1090
    source "$db_file"
  fi
  set +a
  if [[ -z "${DATABASE_URL:-}" || "$DATABASE_URL" == *"localhost"* ]]; then
    echo "DATABASE_URL must point at Azure Postgres ($db_file). Aborting." >&2
    exit 1
  fi
  local required=(
    WABA_VERIFY_TOKEN
    WABA_APP_SECRET
    WABA_ACCESS_TOKEN
    WABA_PHONE_NUMBER_ID
  )
  local var
  for var in "${required[@]}"; do
    amilo_require_var "$var"
  done
}

amilo_acr_login_server() {
  az acr show --name "$AMILO_ACR_NAME" --resource-group "$AMILO_RESOURCE_GROUP" \
    --query loginServer -o tsv
}

amilo_ensure_webapp() {
  local app_name="$1"
  local image_ref="$2"
  if ! az webapp show --name "$app_name" --resource-group "$AMILO_RESOURCE_GROUP" >/dev/null 2>&1; then
    az webapp create --name "$app_name" --resource-group "$AMILO_RESOURCE_GROUP" \
      --plan "$AMILO_PLAN_NAME" \
      --deployment-container-image-name "$image_ref"
    az webapp identity assign --name "$app_name" --resource-group "$AMILO_RESOURCE_GROUP" >/dev/null
  fi
  local principal_id
  principal_id="$(az webapp identity show --name "$app_name" --resource-group "$AMILO_RESOURCE_GROUP" \
    --query principalId -o tsv)"
  local acr_id
  acr_id="$(az acr show --name "$AMILO_ACR_NAME" --resource-group "$AMILO_RESOURCE_GROUP" --query id -o tsv)"
  az role assignment create --assignee "$principal_id" --scope "$acr_id" \
    --role AcrPull >/dev/null 2>&1 || true
}

amilo_apply_container_and_settings() {
  local app_name="$1"
  local image_tag="$2"
  local acr_login_server="$3"
  local image_ref="${acr_login_server}/${AMILO_IMAGE_NAME}:${image_tag}"

  az webapp config container set --name "$app_name" --resource-group "$AMILO_RESOURCE_GROUP" \
    --docker-custom-image-name "$image_ref" \
    --docker-registry-server-url "https://${acr_login_server}" >/dev/null
  az webapp config set --name "$app_name" --resource-group "$AMILO_RESOURCE_GROUP" \
    --always-on true --linux-fx-version "DOCKER|${image_ref}" >/dev/null
  az webapp config appsettings set --name "$app_name" --resource-group "$AMILO_RESOURCE_GROUP" \
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
      PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}" \
      GOOGLE_CLIENT_ID="${GOOGLE_CLIENT_ID:-}" \
      GOOGLE_CLIENT_SECRET="${GOOGLE_CLIENT_SECRET:-}" \
      GOOGLE_REDIRECT_URI="${GOOGLE_REDIRECT_URI:-}" \
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
      AMILO_ENV="${AMILO_ENV:-}" \
      GIT_SHA="${image_tag}" \
      DOCKER_ENABLE_CI=true \
      WEBSITE_PULL_IMAGE_OVER_VNET=false \
    >/dev/null

  az webapp config appsettings set --name "$app_name" --resource-group "$AMILO_RESOURCE_GROUP" \
    --settings \
      "DOCKER_REGISTRY_SERVER_URL=https://${acr_login_server}" \
    >/dev/null
  az resource update --ids "$(az webapp show -g "$AMILO_RESOURCE_GROUP" -n "$app_name" --query id -o tsv)/config/web" \
    --set properties.acrUseManagedIdentityCreds=true >/dev/null 2>&1 || true

  az webapp restart --name "$app_name" --resource-group "$AMILO_RESOURCE_GROUP" >/dev/null
}

amilo_image_exists() {
  local tag="$1"
  az acr repository show-tags --name "$AMILO_ACR_NAME" --repository "$AMILO_IMAGE_NAME" \
    --query "[?@=='${tag}']" -o tsv 2>/dev/null | grep -qx "$tag"
}
