const { io } = require('socket.io-client');

const BASE_URL = String(process.env.SMOKE_BASE_URL || 'http://localhost:5000').replace(/\/$/, '');
const API_URL = `${BASE_URL}/api`;
const VERIFY_FALLBACK_KEY = String(process.env.SMOKE_VERIFY_FALLBACK_KEY || '');
const RESET_FALLBACK_KEY = String(process.env.SMOKE_RESET_FALLBACK_KEY || '');
const EXISTING_EMAIL = String(process.env.SMOKE_EXISTING_EMAIL || '').trim().toLowerCase();
const EXISTING_PASSWORD = String(process.env.SMOKE_EXISTING_PASSWORD || '');

function nowTs() {
  return new Date().toISOString();
}

function log(step, message) {
  console.log(`[${nowTs()}] [${step}] ${message}`);
}

function landingPadsCaptcha() {
  const now = Date.now();
  return {
    type: 'landing-pads',
    token: `landing-pads:smoke:${now}:${Math.random().toString(36).slice(2, 14)}`,
    answer: 'complete',
    rounds: 5,
    startedAt: now - 3000,
    completedAt: now - 1000,
  };
}

async function httpJson(path, { method = 'GET', token, body, headers = {} } = {}) {
  const finalHeaders = { ...headers };
  if (body !== undefined) finalHeaders['content-type'] = 'application/json';
  if (token) finalHeaders.authorization = `Bearer ${token}`;

  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: res.status, ok: res.ok, data: json };
}

function parseTokenFromUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.searchParams.get('reset') || parsed.searchParams.get('verify') || '';
  } catch {
    return '';
  }
}

async function expectOk(label, promise) {
  const out = await promise;
  if (!out.ok) {
    const err = `${label} failed (${out.status}): ${JSON.stringify(out.data)}`;
    throw new Error(err);
  }
  return out.data;
}

async function login(email, password) {
  const payload = {
    email,
    password,
    captcha: {
      type: 'landing-pads-session',
      token: `landing-pads-session:smoke:${Date.now()}`,
      answer: 'complete',
      rounds: 5,
      completedAt: Date.now(),
    },
  };

  const out = await httpJson('/auth/login', { method: 'POST', body: payload });
  if (!out.ok) {
    throw new Error(`login failed (${out.status}): ${JSON.stringify(out.data)}`);
  }
  return out.data;
}

async function runRealtimeCheck(token, boardId) {
  log('realtime', `connecting socket for board ${boardId}`);
  const socket = io(BASE_URL, {
    auth: { token },
    transports: ['websocket'],
    timeout: 8000,
    reconnection: false,
  });

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('socket connect timeout')), 8000);
    socket.once('connect', () => {
      clearTimeout(timer);
      resolve();
    });
    socket.once('connect_error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });

  socket.emit('join:board', boardId);

  const updatePromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('board:update timeout')), 10000);
    socket.on('board:update', (payload) => {
      if (Number(payload?.boardId) === Number(boardId)) {
        clearTimeout(timer);
        resolve(payload);
      }
    });
    socket.on('socket:error', (payload) => {
      clearTimeout(timer);
      reject(new Error(`socket:error ${JSON.stringify(payload)}`));
    });
  });

  await expectOk('create column', httpJson('/columns', {
    method: 'POST',
    token,
    body: { board_id: boardId, name: `Smoke Column ${Date.now()}`, position: 999 },
  }));

  const payload = await updatePromise;
  socket.disconnect();
  log('realtime', `received board:update with ${Array.isArray(payload?.columns) ? payload.columns.length : 0} columns`);
}

async function main() {
  log('smoke', `starting against ${BASE_URL}`);

  let email = EXISTING_EMAIL;
  let password = EXISTING_PASSWORD;

  if (!email || !password) {
    const stamp = Date.now();
    email = `smoke+${stamp}@example.com`;
    password = `SmokePass!${String(stamp).slice(-6)}`;
    const registerBody = {
      firstName: 'Smoke',
      lastName: 'Test',
      email,
      password,
      company: 'Smoke QA Inc',
      department: 'QA',
      lead: 'Smoke Lead',
      captcha: landingPadsCaptcha(),
    };

    log('register', `creating user ${email}`);
    const registerRes = await httpJson('/auth/register', { method: 'POST', body: registerBody });
    if (!registerRes.ok) {
      throw new Error(`register failed (${registerRes.status}): ${JSON.stringify(registerRes.data)}`);
    }

    let verifyToken = String(registerRes.data?.verificationToken || '');
    if (!verifyToken) {
      const headers = VERIFY_FALLBACK_KEY ? { 'x-verify-fallback-key': VERIFY_FALLBACK_KEY } : {};
      const resendRes = await httpJson('/auth/resend-verification', {
        method: 'POST',
        headers,
        body: { email },
      });
      if (resendRes.ok) {
        verifyToken = String(resendRes.data?.verificationToken || parseTokenFromUrl(resendRes.data?.verificationUrl || ''));
      }
    }

    if (verifyToken) {
      log('verify', 'confirming email token');
      await expectOk('verify email', httpJson('/auth/verify-email', {
        method: 'POST',
        body: { token: verifyToken },
      }));
    } else {
      log('verify', 'verification token unavailable; continuing with existing flow if already verified');
    }
  }

  log('login', `logging in as ${email}`);
  let loginOut = await login(email, password);
  let token = loginOut.token;

  log('auth', 'checking /auth/me');
  await expectOk('auth me', httpJson('/auth/me', { method: 'GET', token }));

  log('reset', 'requesting password reset');
  const resetReqHeaders = RESET_FALLBACK_KEY ? { 'x-reset-fallback-key': RESET_FALLBACK_KEY } : {};
  const resetRequest = await expectOk('request reset', httpJson('/auth/request-password-reset', {
    method: 'POST',
    headers: resetReqHeaders,
    body: { email },
  }));

  let resetToken = String(resetRequest?.resetToken || parseTokenFromUrl(resetRequest?.resetUrl || ''));
  if (resetToken) {
    const newPassword = `${password}A!`;
    log('reset', 'submitting reset-password');
    await expectOk('reset password', httpJson('/auth/reset-password', {
      method: 'POST',
      body: { token: resetToken, newPassword },
    }));

    password = newPassword;
    loginOut = await login(email, password);
    token = loginOut.token;
    log('reset', 'verified login after password reset');
  } else {
    log('reset', 'reset token unavailable; provide SMOKE_RESET_FALLBACK_KEY and backend fallback support to fully validate this step');
  }

  const boardsOut = await expectOk('list boards', httpJson('/boards', { method: 'GET', token }));
  const boards = Array.isArray(boardsOut) ? boardsOut : [];
  let board = boards.find((b) => Number(b.owner_user_id) === Number(loginOut?.user?.id));

  if (!board) {
    log('boards', 'creating dedicated smoke board');
    board = await expectOk('create board', httpJson('/boards', {
      method: 'POST',
      token,
      body: { name: `Smoke Board ${Date.now()}`, department: 'QA' },
    }));
  }

  await runRealtimeCheck(token, board.id);
  log('smoke', 'all critical smoke checks passed');
}

main().catch((err) => {
  console.error(`[${nowTs()}] [smoke] FAILED: ${err.message}`);
  process.exit(1);
});
