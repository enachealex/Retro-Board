const { sendReportEmail } = require('./mail');

const LOGIN_ALERT_TYPES = new Set(['auth_login_failed', 'auth_login_denied']);

function formatLoginAlert(event) {
    const lines = [
        `Time: ${event.ts || new Date().toISOString()}`,
        `Type: ${event.type}`,
        event.identity ? `Identity: ${event.identity}` : '',
        event.reason ? `Reason: ${event.reason}` : '',
        event.userId != null ? `User ID: ${event.userId}` : '',
        event.ip ? `IP: ${event.ip}` : '',
    ].filter(Boolean);

    const text = ['RetroBoard failed sign-in attempt', '', ...lines].join('\n');
    const html = `
<p><strong>RetroBoard failed sign-in attempt</strong></p>
<ul>
  ${lines.map((line) => `<li>${line.replace(/</g, '&lt;')}</li>`).join('')}
</ul>
<p style="color:#666;font-size:12px;">One email per failed attempt. Site-down alerts use a different subject line.</p>`;

    return { text, html };
}

async function sendLoginFailureAlert(event) {
    if (!LOGIN_ALERT_TYPES.has(event?.type)) return;
    const subject = `[RetroBoard Login] Failed sign-in — ${event.reason || event.type}`;
    const { text, html } = formatLoginAlert(event);
    await sendReportEmail({ subject, text, html });
}

function queueLoginFailureAlert(event) {
    void sendLoginFailureAlert(event).catch((err) => {
        console.error('[SECURITY] login alert email failed:', err.message);
    });
}

module.exports = {
    LOGIN_ALERT_TYPES,
    sendLoginFailureAlert,
    queueLoginFailureAlert,
};
