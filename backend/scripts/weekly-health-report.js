#!/usr/bin/env node
/**
 * Weekly RetroBoard health report — emailed to HEALTH_REPORT_TO.
 * Cron example: 0 9 * * 1 cd /home/romokid64/RetroBoard/backend && node scripts/weekly-health-report.js >> logs/health-report.log 2>&1
 */
const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { buildHealthReport, BACKUP_DIR } = require('../lib/health');
const { readSecurityEvents, summarizeEvents } = require('../lib/security-event-log');
const {
    readAuditEvents,
    summarizeAuditEvents,
    formatAuditSummaryText,
    formatAuditSummaryHtml,
} = require('../lib/audit-log');
const { APP_NAME } = require('../config/branding');
const { sendReportEmail, verifySmtp, parseReportRecipients } = require('../lib/mail');

const INCIDENT_LOOKBACK_DAYS = Number.parseInt(process.env.HEALTH_INCIDENT_DAYS || '7', 10);

const API_BASE_URL = process.env.HEALTH_CHECK_URL || 'http://127.0.0.1:5000';
const LOG_DIR = path.join(__dirname, '..', 'logs');

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function formatCheckLines(report) {
    const lines = [];
    for (const [name, check] of Object.entries(report.checks || {})) {
        const status = check?.ok === false ? 'FAIL' : 'OK';
        const detail = check?.error
            || (check?.latest ? `latest ${check.latest.name} (${check.latestAgeHours}h ago)` : '')
            || (check?.latencyMs != null ? `${check.latencyMs}ms` : '')
            || (check?.processes ? check.processes.map((p) => `${p.name}:${p.status}`).join(', ') : '')
            || (check?.usePercent != null ? `${check.usePercent}% used` : '')
            || '';
        lines.push(`  ${name}: ${status}${detail ? ` — ${detail}` : ''}`);
    }
    return lines.join('\n');
}

function formatIncidentSummary(incidentSummary) {
    if (!incidentSummary.total) return '  (none in lookback period)';
    return Object.entries(incidentSummary.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `  ${type}: ${count}`)
        .join('\n');
}

function recentSecurityEvents(limit = 8) {
    const candidates = [
        path.join(process.env.HOME || '', '.pm2/logs/retroboard-backend-error.log'),
        path.join(__dirname, '..', 'logs', 'error.log'),
    ];
    for (const file of candidates) {
        if (!fs.existsSync(file)) continue;
        try {
            const tail = fs.readFileSync(file, 'utf8').split('\n').slice(-200);
            return tail
                .filter((line) => line.includes('[SECURITY]'))
                .slice(-limit)
                .map((line) => line.replace(/^\d+\|retroboa \| /, '').trim());
        } catch {
            // try next file
        }
    }
    return [];
}

function buildEmailBodies(report, smtp, securityLines, incidentSummary, auditSummary) {
    const overall = report.ok ? 'Healthy' : 'Needs attention';
    const text = [
        `RetroBoard weekly health report — ${overall}`,
        `Generated: ${report.timestamp}`,
        `Version: ${report.version}`,
        '',
        'Checks:',
        formatCheckLines(report),
        '',
        report.stats ? `Users: ${report.stats.users} (${report.stats.verifiedUsers} verified), Boards: ${report.stats.boards}` : '',
        '',
        `Incidents (last ${INCIDENT_LOOKBACK_DAYS} days, ${incidentSummary.total} total):`,
        formatIncidentSummary(incidentSummary),
        '',
        `SMTP: ${smtp.ok ? 'OK' : `FAIL — ${smtp.error}`}`,
        '',
        securityLines.length ? 'Recent security log lines:' : '',
        ...securityLines,
        '',
        `Audit log (last ${INCIDENT_LOOKBACK_DAYS} days, ${auditSummary.total} events):`,
        formatAuditSummaryText(auditSummary),
        '',
        `Backups directory: ${BACKUP_DIR}`,
        `API probe: ${API_BASE_URL}/api/health`,
    ].filter(Boolean).join('\n');

    const checksHtml = Object.entries(report.checks || {}).map(([name, check]) => {
        const ok = check?.ok !== false;
        const detail = check?.error
            || check?.latest?.name
            || (check?.processes && check.processes.map((p) => `${p.name} (${p.status})`).join(', '))
            || (check?.usePercent != null ? `${check.usePercent}% disk used` : '')
            || (check?.latencyMs != null ? `${check.latencyMs} ms` : '')
            || '';
        return `<tr><td>${escapeHtml(name)}</td><td style="color:${ok ? '#1f7a5c' : '#b42318'}">${ok ? 'OK' : 'FAIL'}</td><td>${escapeHtml(detail)}</td></tr>`;
    }).join('');

    const html = `
<!DOCTYPE html>
<html><body style="font-family:Arial,sans-serif;color:#222;max-width:640px;">
  <h2 style="color:#001489;">${escapeHtml(APP_NAME)} weekly health report</h2>
  <p><strong>Overall:</strong> ${escapeHtml(overall)}<br>
  <strong>Time:</strong> ${escapeHtml(report.timestamp)}<br>
  <strong>Version:</strong> ${escapeHtml(report.version)}</p>
  ${report.stats ? `<p><strong>Users:</strong> ${report.stats.users} (${report.stats.verifiedUsers} verified)<br>
  <strong>Boards:</strong> ${report.stats.boards}</p>` : ''}
  <table cellpadding="8" cellspacing="0" border="1" style="border-collapse:collapse;width:100%;font-size:14px;">
    <tr style="background:#f4f7fb;"><th>Check</th><th>Status</th><th>Detail</th></tr>
    ${checksHtml}
    <tr><td>smtp</td><td style="color:${smtp.ok ? '#1f7a5c' : '#b42318'}">${smtp.ok ? 'OK' : 'FAIL'}</td><td>${escapeHtml(smtp.error || '')}</td></tr>
  </table>
  <h3>Incidents (last ${INCIDENT_LOOKBACK_DAYS} days)</h3>
  <pre style="background:#f8f8f8;padding:12px;font-size:12px;">${escapeHtml(formatIncidentSummary(incidentSummary))}</pre>
  ${securityLines.length ? `<h3>Recent security log lines</h3><pre style="background:#f8f8f8;padding:12px;font-size:12px;overflow:auto;">${escapeHtml(securityLines.join('\n'))}</pre>` : ''}
  <h3>Audit log (last ${INCIDENT_LOOKBACK_DAYS} days)</h3>
  ${formatAuditSummaryHtml(auditSummary)}
  <p style="color:#666;font-size:12px;">Automated report from ${escapeHtml(API_BASE_URL)}</p>
</body></html>`;

    return { text, html };
}

async function main() {
    fs.mkdirSync(LOG_DIR, { recursive: true });
    const recipients = parseReportRecipients();
    if (!recipients.length) {
        throw new Error('Set HEALTH_REPORT_TO in backend/.env (comma-separated emails)');
    }

    let pool;
    try {
        pool = await mysql.createPool({
            host: process.env.DB_HOST || '127.0.0.1',
            user: process.env.DB_USER || 'root',
            password: process.env.DB_PASSWORD || '',
            database: process.env.DB_NAME || 'retro_board',
            connectionLimit: 2,
        });

        const report = await buildHealthReport({
            pool,
            includeStats: true,
            apiBaseUrl: API_BASE_URL,
            includeOps: true,
        });
        const smtp = await verifySmtp();
        const securityLines = recentSecurityEvents();
        const sinceMs = Date.now() - INCIDENT_LOOKBACK_DAYS * 86400000;
        const incidentSummary = summarizeEvents(readSecurityEvents({ sinceMs, maxLines: 20000 }));
        const auditSummary = summarizeAuditEvents(readAuditEvents({ sinceMs, maxLines: 20000 }));
        const overallOk = report.ok && smtp.ok;
        const subject = overallOk
            ? `[${APP_NAME}] Weekly health OK — ${new Date().toLocaleDateString('en-US')}`
            : `[${APP_NAME}] Weekly health needs attention — ${new Date().toLocaleDateString('en-US')}`;

        const { text, html } = buildEmailBodies(report, smtp, securityLines, incidentSummary, auditSummary);
        const reportPath = path.join(LOG_DIR, `health-report-${new Date().toISOString().slice(0, 10)}.json`);
        fs.writeFileSync(reportPath, JSON.stringify({ report, smtp, recipients, subject }, null, 2));
        console.log(`[${new Date().toISOString()}] report saved ${reportPath}`);

        try {
            const sent = await sendReportEmail({ subject, text, html });
            console.log(`[${new Date().toISOString()}] email sent to ${sent.to.join(', ')} (overall=${overallOk ? 'ok' : 'warn'})`);
        } catch (mailErr) {
            console.error(`[${new Date().toISOString()}] email failed: ${mailErr.message}`);
            console.error(`[${new Date().toISOString()}] read ${reportPath} or fix SMTP in .env`);
            process.exit(overallOk ? 1 : 2);
        }
        process.exit(overallOk ? 0 : 2);
    } finally {
        if (pool) await pool.end();
    }
}

main().catch((err) => {
    console.error(`[${new Date().toISOString()}] weekly report failed:`, err.message);
    process.exit(1);
});
