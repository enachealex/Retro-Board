#!/usr/bin/env node
/**
 * Immediate email only when the API is down / unhealthy.
 * Failed logins are emailed separately (one per attempt) from the API process.
 * Cron: every 15 minutes (see install-ops-cron.sh).
 */
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { fetchApiHealth } = require('../lib/health');
const { sendReportEmail, parseReportRecipients } = require('../lib/mail');

const STATE_FILE = path.join(__dirname, '..', 'logs', 'issue-alert-state.json');
const COOLDOWN_MINUTES = Number.parseInt(process.env.ALERT_COOLDOWN_MINUTES || '60', 10);
const API_BASE_URL = process.env.HEALTH_CHECK_URL || 'http://127.0.0.1:5000';

function loadState() {
    try {
        return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    } catch {
        return { lastDownAlertAt: 0, lastOkAt: Date.now() };
    }
}

function saveState(state) {
    fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
    fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;');
}

async function main() {
    const recipients = parseReportRecipients();
    if (!recipients.length) {
        throw new Error('Set HEALTH_REPORT_TO or ALERT_EMAIL_TO in .env');
    }

    const health = await fetchApiHealth(API_BASE_URL);
    const state = loadState();

    if (health.ok) {
        state.lastOkAt = Date.now();
        saveState(state);
        console.log(`[${new Date().toISOString()}] site health ok (${health.latencyMs}ms)`);
        process.exit(0);
    }

    const sinceLastAlert = Date.now() - Number(state.lastDownAlertAt || 0);
    if (sinceLastAlert < COOLDOWN_MINUTES * 60000) {
        console.log(`[${new Date().toISOString()}] site down — alert suppressed (${COOLDOWN_MINUTES}m cooldown)`);
        process.exit(2);
    }

    const subject = '[RetroBoard DOWN] API health check failed';
    const detail = health.error || `HTTP ${health.status}` || 'unknown';
    const text = [
        subject,
        `Time: ${new Date().toISOString()}`,
        `URL: ${health.url}`,
        `Detail: ${detail}`,
        '',
        'The backend may be stopped, MySQL may be down, or the process is not responding.',
        'See RUNBOOK.md — restart: pm2 restart retroboard-backend',
    ].join('\n');

    const html = `
<h2 style="color:#b42318;">RetroBoard is down</h2>
<p><strong>Time:</strong> ${escapeHtml(new Date().toISOString())}<br>
<strong>URL:</strong> ${escapeHtml(health.url)}<br>
<strong>Detail:</strong> ${escapeHtml(detail)}</p>
<p>Check PM2 and MySQL on the host.</p>`;

    try {
        await sendReportEmail({ subject, text, html });
        state.lastDownAlertAt = Date.now();
        saveState(state);
        console.log(`[${new Date().toISOString()}] down alert sent to ${recipients.join(', ')}`);
        process.exit(2);
    } catch (err) {
        const out = path.join(__dirname, '..', 'logs', `down-alert-${Date.now()}.json`);
        fs.writeFileSync(out, JSON.stringify({ health, error: err.message }, null, 2));
        console.error(`[${new Date().toISOString()}] down alert email failed: ${err.message}`);
        process.exit(1);
    }
}

main().catch((err) => {
    console.error(`issue alert monitor failed: ${err.message}`);
    process.exit(1);
});
