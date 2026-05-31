# Free public access (no Zero Trust subscription)

RetroBoard does **not** require a paid Cloudflare Zero Trust plan. You only need:

- **Cloudflare Tunnel** (`cloudflared`) — free
- **DNS** on a domain you already own — free on Cloudflare

## Use the `retroboard-api` tunnel (not `retroboard`)

On the server you may see two tunnels in **Networks → Connectors → Cloudflare Tunnels**:

| Tunnel name | Typical ID | Use? |
|-------------|------------|------|
| **retroboard-api** | `8b0f2567-0357-4945-bde9-b21f52aef458` | **Yes** — this is the one PM2 runs |
| **retroboard** | `cabe60ab-33f5-45ed-87a0-cfb2821ea512` | **No** — old tunnel, no connector, ignore or delete |

**Only run one connector** for `retroboard-api`. Extra `cloudflared` processes (quick tunnels, duplicate PM2 jobs, or `/etc/cloudflared` as root) cause flaky 401/200 on `api.thejumpvault.com` when one config still points at **port 8000** instead of **5000**.

Server config that must stay in sync:

```yaml
# ~/.cloudflared/config.yml
tunnel: 8b0f2567-0357-4945-bde9-b21f52aef458
credentials-file: /home/romokid64/.cloudflared/8b0f2567-0357-4945-bde9-b21f52aef458.json

ingress:
  - hostname: retroboard.thejumpvault.com
    service: http://127.0.0.1:5000
  - hostname: api.thejumpvault.com
    service: http://127.0.0.1:5000
  - service: http_status:404
```

PM2 process: `cloudflared-named-tunnel` → `~/run-tunnel.sh` → `cloudflared tunnel --config ~/.cloudflared/config.yml run`.

Stop obsolete processes:

```bash
pm2 stop retroboard-public          # quick tunnel, not needed
pm2 save
# If root also runs cloudflared on the same tunnel, fix or disable it (requires sudo):
sudo systemctl stop cloudflared
sudo nano /etc/cloudflared/config.yml   # point api + retroboard hostnames to 127.0.0.1:5000, same tunnel ID
```

## Why you saw `Unauthorized` + `request_id`

That response is **Cloudflare Access** (an optional login wall), not RetroBoard. It often gets enabled by accident during setup. **Removing it costs nothing** — you are not required to buy Zero Trust to delete an Access application.

It can also appear when traffic hits **port 8000** (wrong backend) via an old tunnel connector or published route still targeting `http://127.0.0.1:8000`.

## Cloudflare dashboard checklist (free, no subscription)

Do this in [Cloudflare One](https://one.dash.cloudflare.com/) → **Networks** → **Connectors** → **Cloudflare Tunnels**:

### 1. `retroboard-api` (running) — keep these routes

Open **retroboard-api** → **Published application routes** (or **Public hostnames**):

| Public hostname | Service | Access |
|-----------------|---------|--------|
| `api.thejumpvault.com` | `http://127.0.0.1:5000` | **Off** / no “Protect with Access” |
| `retroboard.thejumpvault.com` | `http://127.0.0.1:5000` | **Off** |

Add or edit routes if missing. Save.

### 2. `retroboard` (down) — remove or migrate routes

Open the **retroboard** tunnel (`cabe60ab-…`). If any hostname (especially `api.thejumpvault.com`) is listed under **Published application routes**, **delete** those routes or move them to **retroboard-api** (step 1). You can delete the unused tunnel once nothing points at it.

### 3. DNS (Websites → thejumpvault.com → DNS)

| Name | Type | Target |
|------|------|--------|
| `api` | CNAME | `8b0f2567-0357-4945-bde9-b21f52aef458.cfargotunnel.com` (proxied) |
| `retroboard` | CNAME | same `…cfargotunnel.com` (proxied) — **not** GitHub Pages if you serve app from the tunnel |

From the server (one-time, overwrites existing CNAME):

```bash
TUNNEL_FORCE_PROVISIONING_DNS=true cloudflared tunnel route dns 8b0f2567-0357-4945-bde9-b21f52aef458 api.thejumpvault.com
TUNNEL_FORCE_PROVISIONING_DNS=true cloudflared tunnel route dns 8b0f2567-0357-4945-bde9-b21f52aef458 retroboard.thejumpvault.com
```

### 4. Access applications (optional cleanup)

**Access** → **Applications** — delete any app for `api.thejumpvault.com` or `retroboard.thejumpvault.com` if one appears later. An empty list is fine; protection may still be toggled per tunnel route in step 1.

## Recommended free setup (one hostname)

Serve the **app and API together** from your server on port `5000`:

| Public URL | What it does |
|------------|----------------|
| `https://retroboard.thejumpvault.com` | React app (static files) |
| `https://retroboard.thejumpvault.com/api/...` | RetroBoard API (login, boards, etc.) |

No separate `api.thejumpvault.com` hostname → no extra Access app to manage.

### Steps

1. **Tunnel config** (on server `~/.cloudflared/config.yml`):

   ```yaml
   ingress:
     - hostname: retroboard.thejumpvault.com
       service: http://127.0.0.1:5000
     - service: http_status:404
   ```

2. **Route DNS** (one-time, from server):

   ```bash
   cloudflared tunnel route dns retroboard-api retroboard.thejumpvault.com
   ```

3. **Remove Cloudflare Access** (if still enabled):
   - [one.dash.cloudflare.com](https://one.dash.cloudflare.com) → **Access** → **Applications**
   - Delete any app for `api.thejumpvault.com` or `retroboard.thejumpvault.com`
   - You do **not** need a paid plan to delete these

4. **Point DNS away from GitHub Pages** (if you use the one-hostname setup):
   - In Cloudflare **DNS**, set `retroboard` CNAME → `<tunnel-id>.cfargotunnel.com` (from tunnel route command)
   - Remove or pause the GitHub Pages custom domain for that hostname

5. **Build frontend** with API on the same host:

   ```bash
   VITE_API_BASE_URL=https://retroboard.thejumpvault.com npm run build
   ```

6. **Restart** tunnel and backend:

   ```bash
   pm2 restart cloudflared-named-tunnel retroboard-backend
   ```

7. **Test**:

   ```bash
   curl -s https://retroboard.thejumpvault.com/api/health
   ```

   Expect JSON with `"ok": true`, not `"message":"Unauthorized"`.

## Alternative free setup (GitHub Pages + API subdomain)

Keep the UI on **GitHub Pages** and API on `api.thejumpvault.com`:

1. Fix tunnel to port **5000** (not 8000) — already done on the server
2. **Delete** the Cloudflare Access application on `api.thejumpvault.com` (free)
3. Keep `VITE_API_BASE_URL=https://api.thejumpvault.com` in CI

Login and forgot-password only work after Access is removed.

## What stays free

| Item | Cost |
|------|------|
| `cloudflared` tunnel | $0 |
| Cloudflare DNS | $0 |
| Deleting Access apps | $0 |
| RetroBoard on your hardware | Your server only |

## LAN-only fallback

On your network you can always use `http://192.168.1.48:5000` (no Cloudflare involved).
