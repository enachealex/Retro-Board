#!/usr/bin/env bash
# Append SMTP settings to backend/.env if missing (edit SMTP_USER and SMTP_PASS after running).
set -eu
ENV_FILE="$(cd "$(dirname "$0")/.." && pwd)/.env"

if grep -q '^SMTP_USER=' "$ENV_FILE" 2>/dev/null; then
  echo "SMTP_USER already exists in $ENV_FILE — edit SMTP_USER and SMTP_PASS there."
  exit 0
fi

cat >> "$ENV_FILE" << 'EOF'

# --- SMTP (required for alerts; use a Gmail App Password) ---
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_REQUIRE_TLS=true
SMTP_SECURE=false
SMTP_USER=
SMTP_PASS=
SMTP_FROM="Jump Vault Retro" <vaultjump.noreply@gmail.com>
EOF

echo "Added SMTP block to $ENV_FILE"
echo "Edit SMTP_USER and SMTP_PASS (Gmail app password), then run: node scripts/send-sample-email.js"
