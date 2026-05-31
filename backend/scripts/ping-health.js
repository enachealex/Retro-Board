#!/usr/bin/env node
/**
 * Lightweight health ping — exits non-zero on failure.
 * Optional alert webhook on failure (SECURITY_ALERT_WEBHOOK_URL).
 * Cron example: */15 * * * * cd .../backend && node scripts/ping-health.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { fetchApiHealth } = require('../lib/health');
const { recordSecurityEvent } = require('../lib/security-event-log');

const API_BASE_URL = process.env.HEALTH_CHECK_URL || 'http://127.0.0.1:5000';
const WEBHOOK = String(process.env.SECURITY_ALERT_WEBHOOK_URL || '').trim();

async function sendAlert(payload) {
    if (!WEBHOOK) return;
    try {
        const headers = { 'content-type': 'application/json' };
        if (process.env.SECURITY_ALERT_SECRET) {
            headers['x-security-alert-secret'] = process.env.SECURITY_ALERT_SECRET;
        }
        await fetch(WEBHOOK, { method: 'POST', headers, body: JSON.stringify(payload) });
    } catch (err) {
        console.error('alert webhook failed:', err.message);
    }
}

async function main() {
    const result = await fetchApiHealth(API_BASE_URL);
    if (result.ok) {
        console.log(`[${new Date().toISOString()}] health ok (${result.latencyMs}ms)`);
        process.exit(0);
    }
    const event = {
        ts: new Date().toISOString(),
        type: 'health_ping_failed',
        alert: true,
        url: result.url,
        status: result.status,
        error: result.error,
        body: result.body,
    };
    recordSecurityEvent(event);
    console.error(JSON.stringify(event));
    await sendAlert(event);
    process.exit(1);
}

main().catch((err) => {
    console.error(`health ping error: ${err.message}`);
    process.exit(1);
});
