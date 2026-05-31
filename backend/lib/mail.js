const nodemailer = require('nodemailer');

function createMailTransport() {
    const SMTP_PORT = Number.parseInt(process.env.SMTP_PORT || '587', 10);
    const SMTP_SECURE = process.env.SMTP_SECURE
        ? process.env.SMTP_SECURE === 'true'
        : SMTP_PORT === 465;
    const SMTP_INSECURE_TLS = process.env.SMTP_INSECURE_TLS === 'true';
    const SMTP_REQUIRE_TLS = process.env.SMTP_REQUIRE_TLS === 'true';

    return nodemailer.createTransport({
        host: process.env.SMTP_HOST || 'smtp-mail.outlook.com',
        port: SMTP_PORT,
        secure: SMTP_SECURE,
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
        requireTLS: SMTP_REQUIRE_TLS,
        tls: SMTP_INSECURE_TLS ? { rejectUnauthorized: false } : undefined,
    });
}

function getEmailFrom() {
    return process.env.SMTP_FROM
        || (process.env.SMTP_USER ? `"Jump Vault Retro" <${process.env.SMTP_USER}>` : '"Jump Vault Retro" <no-reply@thejumpvault.com>');
}

function parseReportRecipients() {
    const raw = String(process.env.ALERT_EMAIL_TO || process.env.HEALTH_REPORT_TO || '').trim();
    if (raw) {
        return raw.split(/[,;]+/).map((s) => s.trim()).filter(Boolean);
    }
    try {
        const { DEFAULT_MASTER_EMAILS } = require('../config/constants');
        return (DEFAULT_MASTER_EMAILS || []).slice(0, 5);
    } catch {
        return [];
    }
}

async function verifySmtp() {
    if (!process.env.SMTP_USER || !process.env.SMTP_PASS) {
        return { ok: false, error: 'SMTP_USER/SMTP_PASS not configured' };
    }
    try {
        await createMailTransport().verify();
        return { ok: true };
    } catch (err) {
        return { ok: false, error: err.message };
    }
}

async function sendReportEmail({ subject, text, html }) {
    const to = parseReportRecipients();
    if (!to.length) {
        throw new Error('HEALTH_REPORT_TO (or DEFAULT_MASTER_EMAILS) is not set');
    }
    const transporter = createMailTransport();
    await transporter.sendMail({
        from: getEmailFrom(),
        to: to.join(', '),
        subject,
        text,
        html,
    });
    return { to };
}

module.exports = {
    createMailTransport,
    getEmailFrom,
    parseReportRecipients,
    verifySmtp,
    sendReportEmail,
};
