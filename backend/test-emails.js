// Sends a sample of each transactional email so we can preview the templates.
// Usage: node test-emails.js recipient@example.com [type]
//   type = verify | welcome | reset | all (default: all)
//
// Uses the SAME templates as the live backend by extracting them from server.js
// would be brittle — instead this file re-renders the same HTML so a designer
// can preview without needing the database.

require('dotenv').config();
const nodemailer = require('nodemailer');

const recipient = process.argv[2];
const type = (process.argv[3] || 'all').toLowerCase();
if (!recipient) {
    console.error('Usage: node test-emails.js <recipient-email> [verify|welcome|reset|all]');
    process.exit(1);
}

const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: process.env.SMTP_SECURE === 'true' || parseInt(process.env.SMTP_PORT || '587', 10) === 465,
    requireTLS: process.env.SMTP_REQUIRE_TLS === 'true',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

const EMAIL_FROM = process.env.SMTP_FROM || '"Jump Vault Retro" <no-reply@thejumpvault.com>';

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// --- Templates (kept in sync with backend/server.js) ---

function verificationHtml(firstName, email, verificationUrl, expiresInHours) {
    const safeFirstName = escapeHtml(firstName || 'there');
    const safeEmail = escapeHtml(email);
    const safeUrl = escapeHtml(verificationUrl);
    return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 0;">
    <tr><td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
            <tr><td style="background:#001489;padding:28px 36px;">
                <span style="color:#fff;font-size:20px;font-weight:700;">&#9646; Jump Vault Retro</span>
            </td></tr>
            <tr><td style="padding:36px;">
                <h1 style="margin:0 0 12px;color:#001489;font-size:24px;">Confirm your email</h1>
                <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 18px;">Hi ${safeFirstName}, confirm this email address to finish creating your Jump Vault Retro account.</p>
                <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">Account email: <strong>${safeEmail}</strong></p>
                <p style="margin:0 0 28px;"><a href="${safeUrl}" style="display:inline-block;background:#001489;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Confirm Email</a></p>
                <p style="color:#666;font-size:13px;line-height:1.5;margin:0 0 12px;">This link expires in ${expiresInHours} hours. If the button does not work, paste this link into your browser:</p>
                <p style="color:#001489;font-size:12px;line-height:1.5;word-break:break-all;margin:0 0 22px;">${safeUrl}</p>
                <p style="color:#888;font-size:13px;margin:0;">If you did not create this account, you can ignore this email.</p>
            </td></tr>
            <tr><td style="background:#f4f6fa;padding:18px 36px;text-align:center;">
                <span style="color:#aaa;font-size:12px;">&copy; ${new Date().getFullYear()} The Jump Vault. All rights reserved.</span>
            </td></tr>
        </table>
    </td></tr>
</table>
</body>
</html>`;
}

function welcomeHtml(firstName, email) {
    const safeFirstName = escapeHtml(firstName);
    const safeEmail = escapeHtml(email);
    return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 0;">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <tr><td style="background:#001489;padding:28px 36px;">
        <span style="color:#fff;font-size:20px;font-weight:700;">&#9646; Jump Vault Retro</span>
      </td></tr>
      <tr><td style="padding:36px;">
        <h1 style="margin:0 0 12px;color:#001489;font-size:24px;">Welcome, ${safeFirstName}!</h1>
        <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">Your account has been created. You can now sign in and access your team's retro boards.</p>
        <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 28px;">Sign in with your email address: <strong>${safeEmail}</strong></p>
        <p style="color:#888;font-size:13px;margin:0;">If you didn't create this account, please contact your team administrator.</p>
      </td></tr>
      <tr><td style="background:#f4f6fa;padding:18px 36px;text-align:center;">
        <span style="color:#aaa;font-size:12px;">&copy; ${new Date().getFullYear()} The Jump Vault. All rights reserved.</span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;
}

function resetHtml(email, resetUrl, expiryMinutes) {
    const safeEmail = escapeHtml(email);
    const safeUrl = escapeHtml(resetUrl);
    return `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 0;">
    <tr><td align="center">
        <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
            <tr><td style="background:#001489;padding:28px 36px;">
                <span style="color:#fff;font-size:20px;font-weight:700;">&#9646; Jump Vault Retro</span>
            </td></tr>
            <tr><td style="padding:36px;">
                <h1 style="margin:0 0 12px;color:#001489;font-size:24px;">Password reset requested</h1>
                <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 16px;">A password reset was requested for <strong>${safeEmail}</strong>.</p>
                <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">Use the link below to open the secure password reset page and set a new password.</p>
                <p style="margin:0 0 28px;"><a href="${safeUrl}" style="display:inline-block;background:#001489;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Reset Password</a></p>
                <p style="color:#666;font-size:13px;line-height:1.5;margin:0 0 12px;">This link expires in ${expiryMinutes} minutes. If the button does not work, paste this link into your browser:</p>
                <p style="color:#001489;font-size:12px;line-height:1.5;word-break:break-all;margin:0 0 22px;">${safeUrl}</p>
                <p style="color:#888;font-size:13px;margin:0;">If you did not request this, you can ignore this email.</p>
            </td></tr>
            <tr><td style="background:#f4f6fa;padding:18px 36px;text-align:center;">
                <span style="color:#aaa;font-size:12px;">&copy; ${new Date().getFullYear()} The Jump Vault. All rights reserved.</span>
            </td></tr>
        </table>
    </td></tr>
</table>
</body>
</html>`;
}

async function sendOne(subject, html) {
    const info = await transporter.sendMail({ from: EMAIL_FROM, to: recipient, subject, html });
    console.log(`  ${subject} -> ${info.response}`);
}

(async () => {
    console.log(`Sending preview emails to ${recipient} (type=${type})`);
    const mockUrl = 'https://retroboard.thejumpvault.com/?verify=PREVIEW-TOKEN-1234567890';
    const mockResetUrl = 'https://retroboard.thejumpvault.com/?reset=PREVIEW-RESET-1234567890';
    try {
        if (type === 'all' || type === 'verify') {
            await sendOne('Confirm your Jump Vault Retro account', verificationHtml('Alex', recipient, mockUrl, 48));
        }
        if (type === 'all' || type === 'welcome') {
            await sendOne('Welcome to Jump Vault Retro!', welcomeHtml('Alex', recipient));
        }
        if (type === 'all' || type === 'reset') {
            await sendOne('Reset your Jump Vault Retro password', resetHtml(recipient, mockResetUrl, 30));
        }
        console.log('Done.');
    } catch (err) {
        console.error('Failed:', err.message);
        process.exit(1);
    }
})();
