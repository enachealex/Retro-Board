#!/usr/bin/env node
/**
 * Send a one-off sample notification (run after SMTP is configured in .env).
 *   node scripts/send-sample-email.js
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sendReportEmail, parseReportRecipients, verifySmtp } = require('../lib/mail');

async function main() {
    const to = parseReportRecipients();
    if (!to.length) throw new Error('Set HEALTH_REPORT_TO in .env');

    const smtp = await verifySmtp();
    if (!smtp.ok) throw new Error(`SMTP not ready: ${smtp.error}`);

    const now = new Date().toISOString();
    await sendReportEmail({
        subject: '[RetroBoard] Sample notification test',
        text: [
            'This is a sample RetroBoard notification.',
            '',
            'If you received this, SMTP is working.',
            '',
            'Configured alerts:',
            '- [RetroBoard DOWN] — API/site unhealthy (immediate)',
            '- [RetroBoard Login] — each failed sign-in attempt',
            '- Weekly health — Wednesdays 12:00 PM Pacific',
            '',
            `Sent at: ${now}`,
        ].join('\n'),
        html: `<p><strong>Sample RetroBoard notification</strong></p>
<p>If you received this, SMTP is working.</p>
<ul>
<li><strong>[RetroBoard DOWN]</strong> — API/site unhealthy</li>
<li><strong>[RetroBoard Login]</strong> — each failed sign-in</li>
<li><strong>Weekly health</strong> — Wed 12:00 PM Pacific</li>
</ul>
<p style="color:#666;font-size:12px;">Sent at ${now}</p>`,
    });

    console.log(`Sample email sent to ${to.join(', ')}`);
}

main().catch((err) => {
    console.error('Failed:', err.message);
    if (/SMTP_USER|SMTP_PASS|not configured/i.test(err.message)) {
        console.error('');
        console.error('Fix: edit backend/.env and set SMTP_USER + SMTP_PASS (Gmail app password).');
        console.error('Or run: bash scripts/setup-smtp-env.sh');
        console.error('Guide: https://myaccount.google.com/apppasswords');
    }
    process.exit(1);
});
