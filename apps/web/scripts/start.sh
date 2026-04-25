#!/bin/sh
set -eu

CONFIG_DIR="apps/web/dist"
CONFIG_FILE="${CONFIG_DIR}/config.js"

API_BASE_URL="${API_BASE_URL:-http://localhost:3001}"

echo "Writing runtime config (API_BASE_URL=${API_BASE_URL})..."

cat > "${CONFIG_FILE}" <<JSEOF
window.__RSS_BOI_CONFIG__ = {
  apiBaseUrl: "${API_BASE_URL}",
};
JSEOF

exec pnpm --filter @rss-boi/web preview
