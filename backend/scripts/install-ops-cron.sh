#!/usr/bin/env bash
# Install RetroBoard ops cron jobs for the current user.
set -eu

BACKEND_DIR="$(cd "$(dirname "$0")/.." && pwd)"
NODE_BIN="$(command -v node || true)"
if [[ -z "$NODE_BIN" ]]; then
  echo "node not found in PATH" >&2
  exit 1
fi

mkdir -p "$BACKEND_DIR/logs" "$BACKEND_DIR/backups"

MARKER="# retroboard-ops"
if crontab -l 2>/dev/null | grep -qF "$MARKER"; then
  crontab -l 2>/dev/null \
    | grep -vF "$MARKER" \
    | grep -v "scripts/backup-mysql.js" \
    | grep -v "scripts/weekly-health-report.js" \
    | grep -v "scripts/ping-health.js" \
    | grep -v "scripts/issue-alert-monitor.js" \
    | grep -v "^CRON_TZ=" \
    | crontab - || true
fi

(
  crontab -l 2>/dev/null || true
  echo "$MARKER"
  echo "CRON_TZ=America/Los_Angeles"
  echo "0 2 * * * cd $BACKEND_DIR && $NODE_BIN scripts/backup-mysql.js >> logs/backup.log 2>&1 $MARKER"
  echo "0 12 * * 3 cd $BACKEND_DIR && $NODE_BIN scripts/weekly-health-report.js >> logs/health-report.log 2>&1 $MARKER"
  echo "*/15 * * * * cd $BACKEND_DIR && $NODE_BIN scripts/ping-health.js >> logs/health-ping.log 2>&1 $MARKER"
  echo "*/15 * * * * cd $BACKEND_DIR && $NODE_BIN scripts/issue-alert-monitor.js >> logs/issue-alert.log 2>&1 $MARKER"
) | crontab -

echo "Installed cron jobs:"
crontab -l | grep -F "$MARKER" || true
echo ""
echo "Weekly health email: Wednesday 12:00 PM America/Los_Angeles"
echo "Site-down alert: API unhealthy (checked every 15 min, cooldown applies)"
echo "Failed login: one email per attempt (sent from API when login fails)"
