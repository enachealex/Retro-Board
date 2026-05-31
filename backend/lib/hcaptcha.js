/**
 * hCaptcha server-side verification.
 * @see https://docs.hcaptcha.com/#verify-the-user-response-server-side
 */

const HCAPTCHA_VERIFY_URL = 'https://api.hcaptcha.com/siteverify';

function hcaptchaConfigured() {
    return Boolean(
        String(process.env.HCAPTCHA_SECRET || '').trim()
        && String(process.env.HCAPTCHA_SITE_KEY || '').trim()
    );
}

function getHcaptchaSiteKey() {
    return String(process.env.HCAPTCHA_SITE_KEY || '').trim();
}

async function verifyHcaptchaResponse(token, remoteip) {
    const secret = String(process.env.HCAPTCHA_SECRET || '').trim();
    if (!secret) {
        const err = new Error('hCaptcha is not configured on the server.');
        err.status = 503;
        throw err;
    }
    const response = String(token || '').trim();
    if (!response) {
        const err = new Error('Security check is required.');
        err.status = 400;
        throw err;
    }

    const body = new URLSearchParams({ secret, response });
    if (remoteip) body.set('remoteip', remoteip);

    let data;
    try {
        const res = await fetch(HCAPTCHA_VERIFY_URL, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body,
        });
        data = await res.json();
    } catch {
        const err = new Error('Security check could not be verified. Please try again.');
        err.status = 502;
        throw err;
    }

    if (!data?.success) {
        const err = new Error('Security check failed. Please try again.');
        err.status = 400;
        throw err;
    }
    return data;
}

module.exports = {
    hcaptchaConfigured,
    getHcaptchaSiteKey,
    verifyHcaptchaResponse,
};
