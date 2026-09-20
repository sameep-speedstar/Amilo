#!/usr/bin/env bash
# Deploy amilo-browser-agent to Azure Container Instances (credits-first).
# Usage: ./deploy_browser_agent_aci.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

RESOURCE_GROUP="${RESOURCE_GROUP:-rg-lifeos}"
ACR_NAME="${ACR_NAME:-amiloacr}"
LOCATION="${LOCATION:-centralindia}"
IMAGE_NAME="amilo-browser-agent"
APP_NAME="${APP_NAME:-amilo-browser-agent}"
DNS_LABEL="${DNS_LABEL:-amilo-browser-agent}"

ACR_LOGIN="$(az acr show -n "$ACR_NAME" -g "$RESOURCE_GROUP" --query loginServer -o tsv)"
az acr login -n "$ACR_NAME"

echo "Building $ACR_LOGIN/$IMAGE_NAME:latest"
az acr build -r "$ACR_NAME" -t "$IMAGE_NAME:latest" -f apps/browser-agent/Dockerfile .

# Pull credentials for ACI
ACR_USER="$(az acr credential show -n "$ACR_NAME" --query username -o tsv)"
ACR_PASS="$(az acr credential show -n "$ACR_NAME" --query passwords[0].value -o tsv)"

PROFILE_KEY="${BROWSER_PROFILE_KEY:-$(openssl rand -hex 32)}"
echo "BROWSER_PROFILE_KEY set (store in Key Vault for prod)."

# Delete existing group if present
az container delete -g "$RESOURCE_GROUP" -n "$APP_NAME" --yes 2>/dev/null || true

az container create \
  -g "$RESOURCE_GROUP" \
  -n "$APP_NAME" \
  --image "$ACR_LOGIN/$IMAGE_NAME:latest" \
  --registry-login-server "$ACR_LOGIN" \
  --registry-username "$ACR_USER" \
  --registry-password "$ACR_PASS" \
  --cpu 1 \
  --memory 2 \
  --ports 8090 \
  --dns-name-label "$DNS_LABEL" \
  --location "$LOCATION" \
  --environment-variables \
    BROWSER_AGENT_MODE=demo \
    PORT=8090 \
    BROWSER_PROFILE_KEY="$PROFILE_KEY" \
    BROWSER_PROFILE_DIR=/tmp/amilo-browser-profiles \
  -o table

FQDN="$(az container show -g "$RESOURCE_GROUP" -n "$APP_NAME" --query ipAddress.fqdn -o tsv)"
echo "Health: http://${FQDN}:8090/health"
echo "Note: WA booking runs in-process on amilo-api (demo mode) by default."
echo "      Point BROWSER_AGENT to this ACI when splitting the worker."
