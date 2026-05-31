const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const pkg = require('../package.json');

const APP_VERSION = process.env.APP_VERSION || pkg.version || '1.0.0';
const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');

async function checkDatabase(pool) {
    if (!pool) return { ok: false, error: 'database pool not ready' };
    const started = Date.now();
    try {
        await pool.query('SELECT 1 AS ok');
        return { ok: true, latencyMs: Date.now() - started };
    } catch (err) {
        return { ok: false, error: err.message, latencyMs: Date.now() - started };
    }
}

async function getDatabaseStats(pool) {
    if (!pool) return null;
    try {
        const [[users]] = await pool.query('SELECT COUNT(*) AS total FROM users');
        const [[verified]] = await pool.query('SELECT COUNT(*) AS total FROM users WHERE email_verified_at IS NOT NULL');
        const [[boards]] = await pool.query('SELECT COUNT(*) AS total FROM boards');
        return {
            users: Number(users.total || 0),
            verifiedUsers: Number(verified.total || 0),
            boards: Number(boards.total || 0),
        };
    } catch {
        return null;
    }
}

function getBackupStatus() {
    const dir = BACKUP_DIR;
    if (!fs.existsSync(dir)) {
        return { ok: false, error: 'backup directory missing', directory: dir, files: [] };
    }
    const files = fs.readdirSync(dir)
        .filter((name) => /\.sql(\.gz)?$/i.test(name))
        .map((name) => {
            const full = path.join(dir, name);
            const stat = fs.statSync(full);
            return { name, bytes: stat.size, mtime: stat.mtime.toISOString() };
        })
        .sort((a, b) => b.mtime.localeCompare(a.mtime));
    const latest = files[0] || null;
    const ageHours = latest
        ? Math.round((Date.now() - new Date(latest.mtime).getTime()) / 3600000)
        : null;
    return {
        ok: !!latest && ageHours !== null && ageHours <= 48,
        directory: dir,
        latest,
        count: files.length,
        files: files.slice(0, 7),
        latestAgeHours: ageHours,
    };
}

function getDiskStatus(targetPath = BACKUP_DIR) {
    try {
        const out = execSync(`df -Pk ${JSON.stringify(targetPath)} 2>/dev/null | tail -1`, {
            encoding: 'utf8',
            timeout: 5000,
        });
        const parts = out.trim().split(/\s+/);
        if (parts.length < 6) return { ok: false, error: 'unexpected df output' };
        const totalKb = Number(parts[1]);
        const usedKb = Number(parts[2]);
        const availKb = Number(parts[3]);
        const usePct = Number(String(parts[4]).replace('%', ''));
        return {
            ok: usePct < 90,
            path: parts[parts.length - 1],
            totalGb: Math.round((totalKb / 1048576) * 10) / 10,
            usedGb: Math.round((usedKb / 1048576) * 10) / 10,
            availGb: Math.round((availKb / 1048576) * 10) / 10,
            usePercent: usePct,
        };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

function getPm2Status(processNames = ['retroboard-backend', 'retroboard-frontend', 'retroboard-public']) {
    try {
        const raw = execSync('pm2 jlist 2>/dev/null', { encoding: 'utf8', timeout: 10000 });
        const list = JSON.parse(raw);
        const wanted = new Set(processNames);
        const processes = list
            .filter((p) => wanted.has(p.name))
            .map((p) => ({
                name: p.name,
                status: p.pm2_env?.status || 'unknown',
                restarts: Number(p.pm2_env?.restart_time || 0),
                uptimeMs: Date.now() - Number(p.pm2_env?.pm_uptime || Date.now()),
                memoryMb: Math.round((Number(p.monit?.memory || 0) / 1048576) * 10) / 10,
            }));
        const ok = processes.length > 0 && processes.every((p) => p.status === 'online');
        return { ok, processes };
    } catch (err) {
        return { ok: false, error: err.message, processes: [] };
    }
}

async function fetchApiHealth(baseUrl) {
    const url = `${String(baseUrl).replace(/\/$/, '')}/api/health`;
    const started = Date.now();
    try {
        const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
        const body = await res.json().catch(() => ({}));
        return {
            ok: res.ok && body.ok === true,
            status: res.status,
            latencyMs: Date.now() - started,
            url,
            body,
        };
    } catch (err) {
        return { ok: false, url, latencyMs: Date.now() - started, error: err.message };
    }
}

async function buildHealthReport({ pool, includeStats = false, apiBaseUrl, includeOps = false }) {
    const database = await checkDatabase(pool);
    const checks = { database };
    const stats = includeStats ? await getDatabaseStats(pool) : undefined;

    if (includeOps) {
        checks.backups = getBackupStatus();
        checks.disk = getDiskStatus();
        checks.pm2 = getPm2Status();
        if (apiBaseUrl) checks.http = await fetchApiHealth(apiBaseUrl);
    }

    const ok = Object.values(checks).every((c) => c && c.ok !== false);

    return {
        ok,
        service: 'retroboard-api',
        version: APP_VERSION,
        timestamp: new Date().toISOString(),
        checks,
        ...(stats ? { stats } : {}),
    };
}

module.exports = {
    APP_VERSION,
    BACKUP_DIR,
    checkDatabase,
    getDatabaseStats,
    getBackupStatus,
    getDiskStatus,
    getPm2Status,
    fetchApiHealth,
    buildHealthReport,
};
