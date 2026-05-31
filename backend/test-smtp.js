// Quick SMTP smoke test.
// Usage: node test-smtp.js recipient@example.com
// Reads SMTP_* values from backend/.env.

require('dotenv').config();
const nodemailer = require('nodemailer');

const recipient = process.argv[2];
if (!recipient) {
    console.error('Usage: node test-smtp.js <recipient-email>');
    process.exit(1);
}

const host = process.env.SMTP_HOST;
const port = parseInt(process.env.SMTP_PORT || '587', 10);
const user = process.env.SMTP_USER;
const pass = process.env.SMTP_PASS;
const from = process.env.SMTP_FROM || user;

if (!host || !user || !pass) {
    console.error('Missing SMTP_HOST / SMTP_USER / SMTP_PASS in .env');
    process.exit(1);
}

const secure = process.env.SMTP_SECURE === 'true' || port === 465;
const requireTLS = process.env.SMTP_REQUIRE_TLS === 'true';

const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    requireTLS,
    auth: { user, pass },
    tls: process.env.SMTP_INSECURE_TLS === 'true' ? { rejectUnauthorized: false } : undefined,
});

(async () => {
    console.log(`SMTP host: ${host}:${port} (secure=${secure}, requireTLS=${requireTLS})`);
    console.log(`Auth user: ${user}`);
    console.log(`From:      ${from}`);
    console.log(`To:        ${recipient}`);
    console.log('Verifying connection...');
    try {
        await transporter.verify();
        console.log('Connection OK. Sending test message...');
        const info = await transporter.sendMail({
            from,
            to: recipient,
            subject: 'Jump Vault Retro SMTP test',
            text: 'This is a test message from the Jump Vault Retro backend SMTP test script. If you received this, SMTP is configured correctly.',
            html: '<p>This is a test message from the Jump Vault Retro backend SMTP test script.</p><p>If you received this, SMTP is configured correctly.</p>',
        });
        console.log('Sent. messageId:', info.messageId);
        console.log('Response:', info.response);
    } catch (err) {
        console.error('SMTP test failed:', err.message);
        if (err.code) console.error('Code:', err.code);
        if (err.response) console.error('Response:', err.response);
        process.exit(1);
    }
})();
