# RetroBoard operations runbook

Quick reference when the site is down or degraded.

## Architecture

| Piece | Process / path |
|-------|----------------|
| API | `pm2` → `retroboard-backend` → `~/RetroBoard/backend/server.js` |
| App UI (LAN) | `retroboard-frontend` |
| Public static | `retroboard-public` / `retroboard.thejumpvault.com` |
| Database | MySQL `retro_board` on host |
| Backups | `~/RetroBoard/backend/backups/retro_board-YYYY-MM-DD.sql.gz` |

## Cloudflare Access blocking the API

If clients see `{ "message": "Unauthorized", "request_id": "..." }` on `https://api.thejumpvault.com`, see [CLOUDFLARE-API-ACCESS.md](./CLOUDFLARE-API-ACCESS.md).

## Health checks

```bash
curl -s http://127.0.0.1:5000/api/health | jq .
curl -s "http://127.0.0.1:5000/api/health?detailed=1" | jq .
pm2 status
```

External monitor (optional): `GET https://api.thejumpvault.com/api/health` every 5 minutes.

## Restart order (safe)

```bash
cd ~/RetroBoard/backend
pm2 restart retroboard-backend --update-env
pm2 restart retroboard-frontend
pm2 restart retroboard-public
pm2 logs retroboard-backend --lines 50
```

If MySQL is down, fix MySQL first, then restart the backend.

## Common failures

| Symptom | Likely cause | Action |
|---------|--------------|--------|
| Login 401 for everyone | `JWT_SECRET` changed | Users re-login; keep `JWT_SECRET` stable |
| Login blocked in browser | CORS | Ensure origin is `retroboard.thejumpvault.com` (not main marketing site) |
| “Confirm email” | `email_verified_at` null or SMTP down | Verify user in DB or fix SMTP |
| Socket won’t connect | Invalid/expired token | Re-login |
| API 503 on `/api/health` | MySQL down | `sudo systemctl status mysql` (or mariadb), restore service |

## Manual MySQL backup

```bash
cd ~/RetroBoard/backend
node scripts/backup-mysql.js
ls -lh backups/
```

## Restore from backup

```bash
cd ~/RetroBoard/backend
pm2 stop retroboard-backend
gunzip -c backups/retro_board-YYYY-MM-DD.sql.gz | mysql -h127.0.0.1 -u"$DB_USER" -p"$DB_PASSWORD" retro_board
pm2 start retroboard-backend
```

Replace the date and credentials. Test on a copy first if unsure.

## Email alerts

- **Recipient:** `HEALTH_REPORT_TO` / `ALERT_EMAIL_TO` in `.env`
- **Weekly health metrics:** Wednesday **12:00 PM Pacific** (`America/Los_Angeles`)
- **Site-down alert (immediate):** email when `/api/health` fails — checked every 15 minutes (60-minute cooldown between repeat DOWN emails)
- **Failed login:** one email per failed sign-in attempt (`[RetroBoard Login]` subject)

Scripts:

- `node scripts/weekly-health-report.js` — weekly summary + 7-day incident counts
- `node scripts/issue-alert-monitor.js` — site-down emails only

Incident log: `logs/security-events.jsonl`

Test manually:

```bash
cd ~/RetroBoard/backend
node scripts/weekly-health-report.js
```

If email fails, read `logs/health-report.log` and fix SMTP (`SMTP_USER` / Gmail app password).

## Install / update cron jobs

```bash
cd ~/RetroBoard/backend
chmod +x scripts/install-ops-cron.sh
./scripts/install-ops-cron.sh
crontab -l
```

| Schedule | Job |
|----------|-----|
| Daily 02:00 (server local) | MySQL backup (7-day retention) |
| Wednesday 12:00 Pacific | Weekly health email |
| Every 15 min | Health ping + site-down alert monitor |

## Deploy code from dev machine

```bash
scp -i ~/.ssh/discordmusic_auto -r backend/lib backend/scripts backend/server.js backend/config/cors.js \
  romokid64@192.168.1.48:~/RetroBoard/backend/
ssh -i ~/.ssh/discordmusic_auto romokid64@192.168.1.48 \
  "cd ~/RetroBoard/backend && pm2 restart retroboard-backend --update-env"
```

## Logs

```bash
pm2 logs retroboard-backend --lines 100
grep SECURITY ~/.pm2/logs/retroboard-backend-error.log | tail -20
tail -f ~/RetroBoard/backend/logs/health-ping.log
```
