const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const AUDIT_FILE = path.join(LOG_DIR, 'audit-events.jsonl');
const MAX_FILE_BYTES = Number.parseInt(process.env.AUDIT_LOG_MAX_BYTES || String(5 * 1024 * 1024), 10);

function recordAuditEvent(event) {
    if (!event?.type) return;
    const row = {
        ts: new Date().toISOString(),
        ...event,
    };
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        if (fs.existsSync(AUDIT_FILE)) {
            const stat = fs.statSync(AUDIT_FILE);
            if (stat.size > MAX_FILE_BYTES) {
                const rotated = `${AUDIT_FILE}.${Date.now()}.bak`;
                fs.renameSync(AUDIT_FILE, rotated);
            }
        }
        fs.appendFileSync(AUDIT_FILE, `${JSON.stringify(row)}\n`, 'utf8');
    } catch (err) {
        console.error('[AUDIT] failed to persist event:', err.message);
    }
}

function readAuditEvents({ sinceMs = 0, maxLines = 5000 } = {}) {
    if (!fs.existsSync(AUDIT_FILE)) return [];
    const raw = fs.readFileSync(AUDIT_FILE, 'utf8');
    const lines = raw.split('\n').filter(Boolean).slice(-maxLines);
    const events = [];
    for (const line of lines) {
        try {
            const event = JSON.parse(line);
            const ts = Date.parse(event.ts || '');
            if (Number.isFinite(ts) && ts >= sinceMs) events.push(event);
        } catch {
            // skip malformed line
        }
    }
    return events;
}

function summarizeAuditEvents(events) {
    const byType = {};
    const recent = [];
    for (const event of events) {
        const type = event.type || 'unknown';
        byType[type] = (byType[type] || 0) + 1;
        recent.push({
            ts: event.ts,
            type,
            actorEmail: event.actorEmail,
            actorId: event.actorId,
            target: event.target,
            detail: event.detail,
        });
    }
    recent.sort((a, b) => Date.parse(b.ts) - Date.parse(a.ts));
    return {
        total: events.length,
        byType,
        recent: recent.slice(0, 25),
    };
}

function formatAuditSummaryText(summary) {
    if (!summary.total) return '  (none in lookback period)';
    const lines = Object.entries(summary.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `  ${type}: ${count}`);
    for (const row of summary.recent.slice(0, 12)) {
        const who = row.actorEmail || row.actorId || 'system';
        const target = row.target ? ` → ${row.target}` : '';
        const detail = row.detail ? ` (${row.detail})` : '';
        lines.push(`  ${row.ts}  ${row.type}  ${who}${target}${detail}`);
    }
    return lines.join('\n');
}

function formatAuditSummaryHtml(summary) {
    if (!summary.total) return '<p><em>No audit events in lookback period.</em></p>';
    const counts = Object.entries(summary.byType)
        .sort((a, b) => b[1] - a[1])
        .map(([type, count]) => `<li>${type}: ${count}</li>`)
        .join('');
    const rows = summary.recent.slice(0, 15).map((row) => {
        const who = row.actorEmail || row.actorId || 'system';
        const target = row.target ? ` → ${row.target}` : '';
        const detail = row.detail ? ` (${row.detail})` : '';
        return `<tr><td>${row.ts}</td><td>${row.type}</td><td>${who}${target}${detail}</td></tr>`;
    }).join('');
    return `
  <p><strong>Total:</strong> ${summary.total}</p>
  <ul>${counts}</ul>
  <table cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse;font-size:12px;width:100%;">
    <tr style="background:#f4f7fb;"><th>Time (UTC)</th><th>Action</th><th>Detail</th></tr>
    ${rows}
  </table>`;
}

module.exports = {
    AUDIT_FILE,
    recordAuditEvent,
    readAuditEvents,
    summarizeAuditEvents,
    formatAuditSummaryText,
    formatAuditSummaryHtml,
};
