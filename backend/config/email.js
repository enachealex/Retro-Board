const nodemailer = require('nodemailer');
const { APP_NAME, COMPANY_NAME, emailFromAddress } = require('./branding');

const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-mail.outlook.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    tls: process.env.SMTP_INSECURE_TLS === 'true' ? { rejectUnauthorized: false } : undefined
});

const EMAIL_FROM = emailFromAddress(process.env.SMTP_USER);

function escapeHtml(value) {
    return String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

async function sendWelcomeEmail(firstName, email) {
    try {
        const safeFirstName = escapeHtml(firstName);
        const safeEmail = escapeHtml(email);
        await emailTransporter.sendMail({
          from: EMAIL_FROM,
            to: email,
            subject: `Welcome to ${APP_NAME}!`,
            html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 0;">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <tr><td style="background:#001489;padding:28px 36px;">
        <span style="color:#fff;font-size:20px;font-weight:700;">&#9646; ${APP_NAME}</span>
      </td></tr>
      <tr><td style="padding:36px;">
        <h1 style="margin:0 0 12px;color:#001489;font-size:24px;">Welcome, ${safeFirstName}!</h1>
        <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">Your account has been created. You can now sign in and access your team's retro boards.</p>
        <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 28px;">Sign in with your email address: <strong>${safeEmail}</strong></p>
        <p style="color:#888;font-size:13px;margin:0;">If you didn't create this account, please contact your team administrator.</p>
      </td></tr>
      <tr><td style="background:#f4f6fa;padding:18px 36px;text-align:center;">
        <span style="color:#aaa;font-size:12px;">&copy; ${new Date().getFullYear()} ${COMPANY_NAME}. All rights reserved.</span>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`
        });
        console.log(`Welcome email sent to ${email}`);
    } catch (err) {
        console.error('Failed to send welcome email:', err.message);
    }
}

module.exports = { sendWelcomeEmail };
