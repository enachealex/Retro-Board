const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');
const EVENT_FILE = path.join(LOG_DIR, 'security-events.jsonl');

/** Event types scanned for issue alerts and weekly incident summaries. */
const TRACKED_EVENT_TYPES = new Set([
    'auth_login_failed',
    'auth_login_denied',
    'auth_login_cooldown',
    'auth_login_error',
    'captcha_failed',
    'socket_auth_failed',
    'socket_auth_error',
    'socket_board_join_denied',
    'socket_register_mismatch',
    'rate_limit_exceeded',
    'cors_rejected',
    'health_ping_failed',
]);

function recordSecurityEvent(event) {
    if (!event?.type || !TRACKED_EVENT_TYPES.has(event.type)) return;
    try {
        fs.mkdirSync(LOG_DIR, { recursive: true });
        fs.appendFileSync(EVENT_FILE, `${JSON.stringify(event)}\n`, 'utf8');
    } catch (err) {
        console.error('[SECURITY] failed to persist event:', err.message);
    }
}

function readSecurityEvents({ sinceMs = 0, maxLines = 5000 } = {}) {
    if (!fs.existsSync(EVENT_FILE)) return [];
    const raw = fs.readFileSync(EVENT_FILE, 'utf8');
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

function summarizeEvents(events) {
    const byType = {};
    const samples = {};
    for (const event of events) {
        const type = event.type || 'unknown';
        byType[type] = (byType[type] || 0) + 1;
        if (!samples[type]) {
            samples[type] = {
                ts: event.ts,
                identity: event.identity,
                reason: event.reason,
                email: event.email,
                userId: event.userId,
                boardId: event.boardId,
                origin: event.origin,
            };
        }
    }
    return { total: events.length, byType, samples };
}

module.exports = {
    EVENT_FILE,
    TRACKED_EVENT_TYPES,
    recordSecurityEvent,
    readSecurityEvents,
    summarizeEvents,
};
