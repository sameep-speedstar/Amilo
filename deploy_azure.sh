#!/usr/bin/env bash
# Legacy entrypoint — production is promote-only from a staging-smoked tag.
# Prefer: ./deploy_staging.sh  then  ./deploy_prod.sh <sha>
set -euo pipefail
ROOT="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT"

if [[ "${1:-}" == "" ]]; then
  echo "Production deploys promote a smoked image — they do not rebuild from a dirty tree." >&2
  echo "" >&2
  echo "  1) ./deploy_staging.sh" >&2
  echo "  2) WA smoke on staging number" >&2
  echo "  3) ./deploy_prod.sh \$(git rev-parse --short HEAD)" >&2
  echo "" >&2
  echo "Or pass a tag: ./deploy_azure.sh <sha>" >&2
  exit 1
fi

exec "$ROOT/deploy_prod.sh" "$@"
