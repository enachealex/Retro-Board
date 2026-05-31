# Security hardening roadmap

Goal: reduce risk to the app, API, database, and customer data. Implement in phases; verify each control.

## Already in place

- JWT auth with session version / logout-all
- hCaptcha on login/register
- Helmet CSP, CORS allowlist
- Rate limits on auth routes
- Security + audit JSONL logs; weekly health email
- MySQL backups (cron — verify restore)

## Phase 1 — Quick wins (next)

- [ ] **Cloudflare WAF** (free tier): rate limit `/api/auth/*`, block common attack paths
- [ ] **Secrets**: rotate any credential ever pasted in chat; only `.env` on server
- [ ] **DB user**: dedicated MySQL user with least privilege (no `DROP DATABASE`)
- [ ] **TLS only** in production; HSTS via Cloudflare
- [ ] **Dependency audit**: `npm audit` in CI for frontend/backend

## Phase 2 — Application

- [ ] **Argon2id** password hashing (replace scrypt over time with migration on login)
- [ ] **2FA** for master accounts (TOTP)
- [ ] **IP allowlist** optional for master admin routes
- [ ] **Encrypt sensitive columns** at rest (SMTP tokens, API keys) if stored in DB
- [ ] **Subscription / plan** gates to limit abuse surface

## Phase 3 — Operations

- [ ] Off-site backup copy (S3 or second machine)
- [ ] External uptime + synthetic login check
- [ ] Incident runbook and contact tree
- [ ] Quarterly restore drill

## Phase 4 — Compliance-oriented (if needed)

- Data export/delete for users (GDPR-style)
- Retention policy for logs and backups
- Penetration test before wide public launch

## Database protection

- No public MySQL port; bind `127.0.0.1` only
- Strong random `DB_PASSWORD`; separate read-only user for reporting if needed
- Application uses parameterized queries only (audit any raw SQL)
