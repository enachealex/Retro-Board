/**
 * Single source for product / company display names (backend).
 * Override via APP_NAME and COMPANY_NAME in .env
 */
const APP_NAME = process.env.APP_NAME || 'Jump Vault Retro';
const COMPANY_NAME = process.env.COMPANY_NAME || 'The Jump Vault';

function emailFromAddress(smtpUser) {
    if (process.env.SMTP_FROM) return process.env.SMTP_FROM;
    const fromUser = smtpUser || 'no-reply@thejumpvault.com';
    return `"${APP_NAME}" <${fromUser}>`;
}

module.exports = {
    APP_NAME,
    COMPANY_NAME,
    emailFromAddress,
};
