# Cloudflare Access and `api.thejumpvault.com`

## Symptom

Browser or API calls to `https://api.thejumpvault.com/...` return:

```json
{
  "message": "Unauthorized",
  "request_id": "..."
}
```

HTTP **401** with `request_id` is **Cloudflare Access**, not RetroBoard. The Express API returns `{ "error": "..." }` instead.

Forgot password, login, and health checks all fail from the public site until this is fixed.

## What we fixed on the server

The user tunnel config `~/.cloudflared/config.yml` points `api.thejumpvault.com` at **port 5000** (RetroBoard).

**Remaining cause of flaky 401:** a second connector as **root** via `/etc/cloudflared/config.yml` still registers the same tunnel (`8b0f2567-…`) but routes `api.thejumpvault.com` to **port 8000**. Local check:

```bash
curl -s http://127.0.0.1:5000/api/health   # ok: true
curl -s http://127.0.0.1:8000/api/health   # {"message":"Unauthorized","request_id":"..."}
```

Cloudflare load-balances across connectors, so `https://api.thejumpvault.com/api/health` alternates between **200** and **401** until the root service is stopped or updated.

Also stop duplicate user processes: `pm2 stop retroboard-public` (quick tunnel). Only `cloudflared-named-tunnel` should run the RetroBoard config.

**Fix (requires sudo on the server):**

```bash
sudo systemctl stop cloudflared
# Edit /etc/cloudflared/config.yml — same tunnel ID, both hostnames → http://127.0.0.1:5000
sudo systemctl start cloudflared   # only if you still want the root-managed connector
```

Or leave root `cloudflared` stopped and rely on PM2 `cloudflared-named-tunnel` only.

You still need the Cloudflare dashboard steps below so public hostnames are on **retroboard-api**, not the down **retroboard** tunnel, and Access is off per route.

## Fix in Cloudflare (required)

See [CLOUDFLARE-FREE.md](./CLOUDFLARE-FREE.md) for the full checklist. Summary:

1. **Networks → Tunnels → retroboard-api** (running): published routes for `api.thejumpvault.com` and `retroboard.thejumpvault.com` → `http://127.0.0.1:5000`, **Access off**.
2. **Networks → Tunnels → retroboard** (down): delete any published routes; migrate hostnames to **retroboard-api**.
3. **DNS**: `api` and `retroboard` CNAME → `8b0f2567-0357-4945-bde9-b21f52aef458.cfargotunnel.com`.
4. **Access → Applications**: delete any app for these hostnames if listed (optional; empty list is OK if step 1 has Access off per route).

## Verify RetroBoard itself

On the server (bypasses Cloudflare):

```bash
curl -s http://127.0.0.1:5000/api/health
curl -s -X POST http://127.0.0.1:5000/api/auth/request-password-reset \
  -H 'Content-Type: application/json' \
  -d '{"email":"your@email.com"}'
```

Both should succeed without Cloudflare’s `request_id` JSON.

## Frontend API URL

Production builds use `VITE_API_BASE_URL=https://api.thejumpvault.com` (see `.github/workflows/deploy-pages.yml`). After Access is fixed, redeploy is not required unless you change the hostname.
