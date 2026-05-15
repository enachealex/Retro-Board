const express = require('express');
const cors = require('cors');
const compression = require('compression');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const sql = process.env.DB_DRIVER === 'msnodesqlv8' ? require('mssql/msnodesqlv8') : require('mssql');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
require('dotenv').config();

// --- SSL Configuration ---
const SSL_KEY_PATH = path.join(__dirname, 'certs', 'server.key');
const SSL_CERT_PATH = path.join(__dirname, 'certs', 'server.cert');
const sslAvailable = fs.existsSync(SSL_KEY_PATH) && fs.existsSync(SSL_CERT_PATH);
const SSL_PORT = parseInt(process.env.SSL_PORT || '5443');

// --- Email (nodemailer) ---
const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp-mail.outlook.com',
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: false,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    tls: process.env.SMTP_INSECURE_TLS === 'true' ? { rejectUnauthorized: false } : undefined
});

async function sendWelcomeEmail(firstName, email) {
    try {
        await emailTransporter.sendMail({
                        from: process.env.SMTP_FROM || '"Vault Jump Retro" <no-reply@thejumpvault.com>',
            to: email,
                        subject: 'Welcome to RetroBoard!',
            html: `
<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f6fa;font-family:Arial,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f6fa;padding:40px 0;">
  <tr><td align="center">
    <table width="520" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.08);">
      <tr><td style="background:#001489;padding:28px 36px;">
                <span style="color:#fff;font-size:20px;font-weight:700;">&#9646; RetroBoard</span>
      </td></tr>
      <tr><td style="padding:36px;">
        <h1 style="margin:0 0 12px;color:#001489;font-size:24px;">Welcome, ${firstName}!</h1>
        <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">Your account has been created. You can now sign in and access your team's retrospective boards.</p>
        <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 28px;">Sign in with your email address: <strong>${email}</strong></p>
        <p style="color:#888;font-size:13px;margin:0;">If you didn't create this account, please contact your team administrator.</p>
      </td></tr>
      <tr><td style="background:#f4f6fa;padding:18px 36px;text-align:center;">
                <span style="color:#aaa;font-size:12px;">&copy; ${new Date().getFullYear()} The Jump Vault. All rights reserved.</span>
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

// --- Admin email allowlist ---
const DEFAULT_ADMIN_EMAILS = [
    'nrobertson@openeye.net',
    'gduncan@openeye.net',
    'brogers@openeye.net',
    'dridge@openeye.net',
    'jpuhlman@openeye.net',
    'jezetta@openeye.net',
    'dsmith@openeye.net',
    'smontgomery@openeye.net',
    'arcox@openeye.net',
    'anhumphrey@openeye.net',
    'rbarnes@openeye.net',
    'swinter@openeye.net',
    'zsteele@openeye.net',
    'nelliott@openeye.net',
    'dschafer@openeye.net',
    'gfoster@openeye.net',
    'g@openeye.net',
];
let ADMIN_EMAILS = [...DEFAULT_ADMIN_EMAILS];

const reloadAdminEmails = async () => {
    try {
        const result = await pool.request().query('SELECT email FROM admin_emails');
        ADMIN_EMAILS = result.recordset.map(r => r.email.toLowerCase());
    } catch (e) { /* Table may not exist yet */ }
};

const DEFAULT_MASTER_EMAILS = [
    { email: 'dridge@openeye.net', department: 'QA' },
    { email: 'jpuhlman@openeye.net', department: 'QA' },
    { email: 'adunn@openeye.net', department: 'SE' },
    { email: 'nestrada@openeye.net', department: 'SE' },
];
let MASTER_EMAILS = DEFAULT_MASTER_EMAILS.map(m => m.email);
let MASTER_DEPT_MAP = Object.fromEntries(DEFAULT_MASTER_EMAILS.map(m => [m.email, m.department]));

// Overlord role is deprecated; keep empty to avoid new overlord assignments.
const DEFAULT_OVERLORD_EMAILS = [];
let OVERLORD_EMAILS = [...DEFAULT_OVERLORD_EMAILS];

const reloadMasterEmails = async () => {
    try {
        const result = await pool.request().query('SELECT email, department FROM master_emails');
        MASTER_EMAILS = result.recordset.map(r => r.email.toLowerCase());
        MASTER_DEPT_MAP = Object.fromEntries(result.recordset.map(r => [r.email.toLowerCase(), r.department]));
    } catch (e) { /* Table may not exist yet */ }
};

const reloadOverlordEmails = async () => {
    try {
        const result = await pool.request().query('SELECT email FROM overlord_emails');
        OVERLORD_EMAILS = result.recordset.map(r => r.email.toLowerCase());
    } catch (e) { /* Table may not exist yet */ }
};

const VALID_DEPARTMENTS = ['QA', 'SE', 'SDET'];

const LEADS_BY_DEPT = {
    QA:   ['Nathan Robertson', 'Gabe Duncan', 'Brett Rogers', 'John Ezetta'],
    SE:   ['Dave Smith', 'Sean Montgomery', 'Aric Cox', 'J.R. Humphrey', 'Roxanne Barnes', 'Sam Winter', 'Zak Steele', 'Nate Elliot', 'Damon Schafer'],
    SDET: ['Griffin Foster'],
};

const LEAD_DEFAULT_COLUMNS = [
    'Rules',
    'Ice Breaker',
    'Gripes',
    'Needs Improvement',
    'Went Well',
    'Wins/Shoutouts',
    'Action Items',
];

// --- Auth Helpers ---
if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set. Exiting.');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '7d';

function buildUserToken(user) {
    return jwt.sign({
        sub: user.id,
        username: user.username,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        display_name: user.display_name,
        email: user.email,
        department: user.department,
        lead: user.lead || null,
        is_admin: user.is_admin === 1 || user.is_admin === true,
        is_master: user.is_master === 1 || user.is_master === true,
        is_overlord: user.is_overlord === 1 || user.is_overlord === true,
    }, JWT_SECRET, { expiresIn: JWT_EXPIRY });
}
function buildUserPublic(user) {
    return {
        id: user.id,
        username: user.username,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        display_name: user.display_name,
        email: user.email,
        department: user.department,
        lead: user.lead || null,
        is_admin: user.is_admin === 1 || user.is_admin === true,
        is_master: user.is_master === 1 || user.is_master === true,
        is_overlord: user.is_overlord === 1 || user.is_overlord === true
    };
}
function verifyJwt(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch { return null; }
}
async function getCurrentUserForAuth(userId) {
    const result = await pool.request()
        .input('id', sql.Int, userId)
        .query('SELECT id, username, first_name, last_name, display_name, email, department, [lead], is_admin, is_master, is_overlord FROM users WHERE id = @id');
    return result.recordset[0] || null;
}
async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, derived) => {
            if (err) reject(err);
            else resolve(`${salt}:${derived.toString('hex')}`);
        });
    });
}
async function verifyPassword(password, stored) {
    const [salt, hash] = stored.split(':');
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, derived) => {
            if (err) reject(err);
            else {
                try {
                    resolve(crypto.timingSafeEqual(Buffer.from(hash, 'hex'), derived));
                } catch { resolve(false); }
            }
        });
    });
}

const CAPTCHA_TTL_MS = Number.parseInt(process.env.CAPTCHA_TTL_MS || '120000', 10);
const CAPTCHA_LENGTH = 6;
const CAPTCHA_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const usedCaptchaNonces = new Map();
const LANDING_PADS_REQUIRED_STREAK = 5;
const LANDING_PADS_TTL_MS = Number.parseInt(process.env.LANDING_PADS_TTL_MS || '600000', 10);
const usedLandingPadTokens = new Map();

function cleanupCaptchaNonces(now = Date.now()) {
    for (const [nonce, expiresAt] of usedCaptchaNonces.entries()) {
        if (expiresAt <= now) usedCaptchaNonces.delete(nonce);
    }
}

function normalizeCaptchaAnswer(answer) {
    return String(answer || '').replace(/\s+/g, '').toUpperCase();
}

function cleanupLandingPadTokens(now = Date.now()) {
    for (const [token, expiresAt] of usedLandingPadTokens.entries()) {
        if (expiresAt <= now) usedLandingPadTokens.delete(token);
    }
}

function verifyLandingPadsOrThrow(captcha) {
    const token = String(captcha?.token || '');
    const answer = String(captcha?.answer || '').toLowerCase();
    const rounds = Number(captcha?.rounds || 0);
    const startedAt = Number(captcha?.startedAt || 0);
    const completedAt = Number(captcha?.completedAt || 0);
    const now = Date.now();
    cleanupLandingPadTokens(now);

    if (captcha?.type !== 'landing-pads' || answer !== 'complete' || rounds < LANDING_PADS_REQUIRED_STREAK) {
        const err = new Error('Security check is required.');
        err.status = 400;
        throw err;
    }
    if (!/^landing-pads:[A-Za-z0-9._:-]{12,160}$/.test(token)) {
        const err = new Error('Security check is invalid. Please try again.');
        err.status = 400;
        throw err;
    }
    if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt || now - completedAt > LANDING_PADS_TTL_MS) {
        const err = new Error('Security check expired. Please try again.');
        err.status = 400;
        throw err;
    }
    if (usedLandingPadTokens.has(token)) {
        const err = new Error('Security check was already used. Please try again.');
        err.status = 400;
        throw err;
    }
    usedLandingPadTokens.set(token, now + LANDING_PADS_TTL_MS);
}

function createCaptchaCode() {
    let code = '';
    for (let i = 0; i < CAPTCHA_LENGTH; i++) {
        code += CAPTCHA_CHARS[crypto.randomInt(0, CAPTCHA_CHARS.length)];
    }
    return code;
}

function createCaptchaAnswerHash(nonce, expiresAt, answer) {
    return crypto
        .createHmac('sha256', `${JWT_SECRET}:captcha-answer`)
        .update(`${nonce}:${expiresAt}:${normalizeCaptchaAnswer(answer)}`)
        .digest('base64url');
}

function signCaptchaPayload(payload) {
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
    return `${body}.${signature}`;
}

function parseCaptchaToken(token) {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature) return null;
    const expected = crypto.createHmac('sha256', JWT_SECRET).update(body).digest('base64url');
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expected);
    if (sigBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(sigBuffer, expectedBuffer)) return null;
    try {
        return JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    } catch {
        return null;
    }
}

function renderCaptchaSvg(code) {
    const width = 224;
    const height = 78;
    const chars = code.split('').map((char, index) => {
        const x = 24 + index * 31 + crypto.randomInt(-3, 4);
        const y = 48 + crypto.randomInt(-8, 9);
        const rotation = crypto.randomInt(-18, 19);
        const color = ['#001489', '#0b4f6c', '#5c2d91', '#1f7a5c'][crypto.randomInt(0, 4)];
        return `<text x="${x}" y="${y}" transform="rotate(${rotation} ${x} ${y})" fill="${color}" font-size="34" font-family="Arial, Helvetica, sans-serif" font-weight="800">${char}</text>`;
    }).join('');
    const lines = Array.from({ length: 10 }, () => {
        const x1 = crypto.randomInt(0, width);
        const y1 = crypto.randomInt(0, height);
        const x2 = crypto.randomInt(0, width);
        const y2 = crypto.randomInt(0, height);
        const opacity = (crypto.randomInt(18, 42) / 100).toFixed(2);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#001489" stroke-width="1.4" opacity="${opacity}" />`;
    }).join('');
    const dots = Array.from({ length: 44 }, () => {
        const cx = crypto.randomInt(0, width);
        const cy = crypto.randomInt(0, height);
        const radius = crypto.randomInt(1, 3);
        const opacity = (crypto.randomInt(18, 48) / 100).toFixed(2);
        return `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="#00A3FF" opacity="${opacity}" />`;
    }).join('');
    const wave = `M 6 ${crypto.randomInt(30, 48)} C 54 ${crypto.randomInt(2, 28)}, 92 ${crypto.randomInt(54, 74)}, 132 ${crypto.randomInt(24, 52)} S 194 ${crypto.randomInt(8, 68)}, 218 ${crypto.randomInt(32, 56)}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Security challenge"><rect width="100%" height="100%" rx="8" fill="#f4f7fb"/><path d="${wave}" fill="none" stroke="#ff8a00" stroke-width="3" opacity="0.55"/>${dots}${lines}${chars}</svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`;
}

function createCaptchaChallenge() {
    cleanupCaptchaNonces();
    const code = createCaptchaCode();
    const nonce = crypto.randomBytes(18).toString('base64url');
    const expiresAt = Date.now() + CAPTCHA_TTL_MS;
    const token = signCaptchaPayload({
        v: 1,
        nonce,
        expiresAt,
        answerHash: createCaptchaAnswerHash(nonce, expiresAt, code),
    });
    return { token, image: renderCaptchaSvg(code), expiresAt, expiresInSeconds: Math.floor(CAPTCHA_TTL_MS / 1000) };
}

function verifyCaptchaOrThrow(captcha) {
    if (captcha?.type === 'landing-pads') {
        verifyLandingPadsOrThrow(captcha);
        return;
    }

    const token = captcha?.token;
    const answer = normalizeCaptchaAnswer(captcha?.answer);
    if (!token || !answer) {
        const err = new Error('Security check is required.');
        err.status = 400;
        throw err;
    }
    const payload = parseCaptchaToken(token);
    const now = Date.now();
    cleanupCaptchaNonces(now);
    if (!payload || payload.v !== 1 || !payload.nonce || !payload.expiresAt || !payload.answerHash) {
        const err = new Error('Security check is invalid. Please reload it.');
        err.status = 400;
        throw err;
    }
    if (Number(payload.expiresAt) <= now) {
        const err = new Error('Security check expired. Please reload it.');
        err.status = 400;
        throw err;
    }
    if (usedCaptchaNonces.has(payload.nonce)) {
        const err = new Error('Security check was already used. Please reload it.');
        err.status = 400;
        throw err;
    }
    usedCaptchaNonces.set(payload.nonce, Number(payload.expiresAt));
    const expected = createCaptchaAnswerHash(payload.nonce, payload.expiresAt, answer);
    const expectedBuffer = Buffer.from(expected);
    const actualBuffer = Buffer.from(payload.answerHash);
    if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
        const err = new Error('Security check was incorrect. Please try a new one.');
        err.status = 400;
        throw err;
    }
}
async function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const payload = verifyJwt(authHeader.slice(7));
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });

    try {
        const currentUser = await getCurrentUserForAuth(payload.sub);
        if (!currentUser) return res.status(401).json({ error: 'User no longer exists' });
        req.user = {
            ...payload,
            ...buildUserPublic(currentUser),
            sub: currentUser.id,
            id: currentUser.id,
        };
    } catch (error) {
        console.error('Auth refresh error:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
    next();
}

const PORT = process.env.PORT || 5000;

// --- MS SQL Connection Pool ---
const DB_NAME = process.env.DB_NAME || 'retro_board';

const mssqlConfig = (() => {
    if (process.env.DB_DRIVER === 'msnodesqlv8' && !process.env.DB_USER) {
        // Windows Auth via msnodesqlv8 using ODBC connection string
        const server = (process.env.DB_HOST || 'localhost').replace(/^lpc:/, '');
        return `Driver={ODBC Driver 17 for SQL Server};Server=lpc:${server};Database=${DB_NAME};Trusted_Connection=Yes;`;
    }
    const cfg = {
        server: process.env.DB_HOST || 'localhost',
        database: DB_NAME,
        options: {
            encrypt: true,
            trustServerCertificate: process.env.DB_TRUST_CERT !== 'false',
        },
        pool: { max: 10, min: 0, idleTimeoutMillis: 60000 },
    };
    if (process.env.DB_USER) {
        cfg.user = process.env.DB_USER;
        cfg.password = process.env.DB_PASSWORD || '';
    }
    return cfg;
})();

let pool;

// --- CORS ---
const REQUIRED_PUBLIC_ORIGINS = [
    'https://retroboard.thejumpvault.com',
    'https://enachealex.github.io',
    'https://thejumpvault.com',
    'https://www.thejumpvault.com',
];

const CORS_ORIGINS = Array.from(new Set([
    ...(process.env.CORS_ORIGINS
        ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
        : [
            'http://localhost:5173', 'http://localhost:5174', 'http://localhost:5000',
            'http://192.168.1.48', 'http://192.168.1.48:5000',
            'https://localhost:5443', 'https://192.168.1.48:5443'
          ]),
    ...REQUIRED_PUBLIC_ORIGINS,
]));

const corsOptions = { origin: CORS_ORIGINS, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] };

// --- Express + Socket.io Setup ---
const app = express();
const server = http.createServer(app);

server.keepAliveTimeout = 65000;
server.headersTimeout = 66000;

let httpsServer = null;
if (sslAvailable) {
    const sslOptions = {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH)
    };
    httpsServer = https.createServer(sslOptions, app);
}

const io = new Server(server, { cors: corsOptions });
if (httpsServer) {
    io.attach(httpsServer, { cors: corsOptions });
}

app.use(cors(corsOptions));
app.use(compression());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    immutable: true
}));

// --- Async GIF seeder ---
async function seedDefaultGifs() {
    const result = await pool.request().query('SELECT COUNT(*) as cnt FROM gifs WHERE is_default = 1');
    if (result.recordset[0].cnt > 0) return;
    console.log('Seeding default GIF library from Giphy (background)...');
    const giphyApiKey = 'GlVGYHkr3WSBnllca54iNt0yFbjz7L65';
    const categories = ['thumbs up', 'applause', 'celebration', 'funny', 'reaction', 'thank you', 'wow', 'facepalm', 'high five', 'thinking'];
    const seededUrls = new Set();
    for (const q of categories) {
        try {
            const giphyUrl = `https://api.giphy.com/v1/gifs/search?api_key=${encodeURIComponent(giphyApiKey)}&q=${encodeURIComponent(q)}&limit=10&rating=pg`;
            const resp = await fetch(giphyUrl);
            if (!resp.ok) continue;
            const json = await resp.json();
            if (!json.data) continue;
            for (const gif of json.data) {
                const original = gif.images?.original?.url || gif.images?.downsized?.url;
                const preview = gif.images?.fixed_height?.url || gif.images?.fixed_width?.url || original;
                const title = gif.title || '';
                if (original && !seededUrls.has(original)) {
                    seededUrls.add(original);
                    await pool.request()
                        .input('url', sql.NVarChar(sql.MAX), original)
                        .input('preview_url', sql.NVarChar(sql.MAX), preview)
                        .input('title', sql.NVarChar(255), title)
                        .query('INSERT INTO gifs (url, preview_url, title, is_default) VALUES (@url, @preview_url, @title, 1)');
                }
            }
        } catch (fetchErr) {
            console.warn(`Failed to fetch GIFs for "${q}":`, fetchErr.message);
        }
    }
    console.log(`Seeded ${seededUrls.size} default GIFs`);
}

// --- Database Initialization ---
const initDb = async () => {
    try {
        // Tables are created by schema.sql — but ensure card_reactions exists
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'card_reactions')
            CREATE TABLE card_reactions (
                id INT IDENTITY(1,1) PRIMARY KEY,
                card_id INT NOT NULL,
                user_id INT NOT NULL,
                emoji NVARCHAR(20) NOT NULL,
                created_at DATETIME2 DEFAULT GETDATE(),
                CONSTRAINT UQ_card_reaction UNIQUE (card_id, user_id, emoji),
                CONSTRAINT FK_reaction_card FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
                CONSTRAINT FK_reaction_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Seed admin emails
        for (const e of DEFAULT_ADMIN_EMAILS) {
            const dept = ['nrobertson@openeye.net','gduncan@openeye.net','brogers@openeye.net','jezetta@openeye.net'].includes(e) ? 'QA'
                       : ['dsmith@openeye.net','smontgomery@openeye.net','arcox@openeye.net','anhumphrey@openeye.net','rbarnes@openeye.net','swinter@openeye.net','zsteele@openeye.net','nelliott@openeye.net','dschafer@openeye.net'].includes(e) ? 'SE'
                       : ['gfoster@openeye.net','g@openeye.net'].includes(e) ? 'SDET' : null;
            await pool.request()
                .input('email', sql.NVarChar(255), e)
                .input('dept', sql.NVarChar(10), dept)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM admin_emails WHERE email = @email)
                        INSERT INTO admin_emails (email, department) VALUES (@email, @dept)
                `);
        }
        await reloadAdminEmails();

        // Seed master emails (with department)
        for (const m of DEFAULT_MASTER_EMAILS) {
            await pool.request()
                .input('email', sql.NVarChar(255), m.email)
                .input('dept', sql.NVarChar(10), m.department)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM master_emails WHERE email = @email)
                        INSERT INTO master_emails (email, department) VALUES (@email, @dept)
                    ELSE
                        UPDATE master_emails SET department = @dept WHERE email = @email AND (department IS NULL OR department <> @dept)
                `);
        }
        await reloadMasterEmails();

        // Seed overlord emails
        for (const e of DEFAULT_OVERLORD_EMAILS) {
            await pool.request()
                .input('email', sql.NVarChar(255), e)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM overlord_emails WHERE email = @email)
                        INSERT INTO overlord_emails (email) VALUES (@email)
                `);
        }

        // Overlord role cleanup: clear any legacy overlord entries/flags.
        await pool.request().query(`DELETE FROM overlord_emails`);
        await pool.request().query(`UPDATE users SET is_overlord = 0 WHERE is_overlord = 1`);
        await reloadOverlordEmails();

        // Add is_overlord column if missing
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('users') AND name = 'is_overlord')
                ALTER TABLE users ADD is_overlord BIT NOT NULL DEFAULT 0
        `);

        // Add department column to master_emails if missing
        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('master_emails') AND name = 'department')
                ALTER TABLE master_emails ADD department NVARCHAR(10) NULL
        `);

        await pool.request().query(`
            IF NOT EXISTS (SELECT 1 FROM sys.columns WHERE object_id = OBJECT_ID('boards') AND name = 'owner_user_id')
                ALTER TABLE boards ADD owner_user_id INT NULL
        `);

        // Create overlord_emails table if missing
        await pool.request().query(`
            IF NOT EXISTS (SELECT * FROM sys.tables WHERE name = 'overlord_emails')
            CREATE TABLE overlord_emails (
                id INT IDENTITY(1,1) PRIMARY KEY,
                email NVARCHAR(255) NOT NULL,
                created_at DATETIME2 DEFAULT GETDATE(),
                CONSTRAINT UQ_overlord_emails UNIQUE (email)
            )
        `);

        // Seed default lead boards
        const allLeads = [
            { name: 'Nathan Robertson', department: 'QA' },
            { name: 'Gabe Duncan',       department: 'QA' },
            { name: 'Brett Rogers',      department: 'QA' },
            { name: 'John Ezetta',       department: 'QA' },
            { name: 'Dave Smith',        department: 'SE' },
            { name: 'Sean Montgomery',   department: 'SE' },
            { name: 'Aric Cox',          department: 'SE' },
            { name: 'J.R. Humphrey',     department: 'SE' },
            { name: 'Roxanne Barnes',    department: 'SE' },
            { name: 'Sam Winter',        department: 'SE' },
            { name: 'Zak Steele',        department: 'SE' },
            { name: 'Nate Elliot',       department: 'SE' },
            { name: 'Damon Schafer',     department: 'SE' },
            { name: 'Griffin Foster',    department: 'SDET' },
        ];
        for (const lead of allLeads) {
            const boardName = `Retro - ${lead.name}`;
            const existResult = await pool.request()
                .input('name', sql.NVarChar(255), boardName)
                .query('SELECT id FROM boards WHERE name = @name');

            let boardId;
            if (existResult.recordset.length === 0) {
                const insertResult = await pool.request()
                    .input('name', sql.NVarChar(255), boardName)
                    .input('dept', sql.NVarChar(10), lead.department)
                    .query('INSERT INTO boards (name, department) OUTPUT INSERTED.id VALUES (@name, @dept)');
                boardId = insertResult.recordset[0].id;
                console.log(`Seeded board: ${boardName}`);
            } else {
                boardId = existResult.recordset[0].id;
            }
            // Seed columns if missing
            const colResult = await pool.request()
                .input('boardId', sql.Int, boardId)
                .query('SELECT id FROM [columns] WHERE board_id = @boardId');
            if (colResult.recordset.length === 0) {
                for (let i = 0; i < LEAD_DEFAULT_COLUMNS.length; i++) {
                    await pool.request()
                        .input('boardId', sql.Int, boardId)
                        .input('name', sql.NVarChar(255), LEAD_DEFAULT_COLUMNS[i])
                        .input('pos', sql.Int, i)
                        .query('INSERT INTO [columns] (board_id, name, position) VALUES (@boardId, @name, @pos)');
                }
                console.log(`Restored default columns for board: ${boardName}`);
            }
        }

        // Pre-create placeholder admin accounts
        for (const lead of allLeads) {
            const [firstName, ...lastParts] = lead.name.split(' ');
            const lastName = lastParts.join(' ');
            const adminResult = await pool.request()
                .input('dept', sql.NVarChar(10), lead.department)
                .query('SELECT email FROM admin_emails WHERE department = @dept');
            const matchingEmail = adminResult.recordset.find(r => {
                const emailPrefix = r.email.split('@')[0].toLowerCase();
                return emailPrefix === `${firstName[0].toLowerCase()}${lastName.toLowerCase().replace(/\s/g, '')}` ||
                       emailPrefix === `${firstName.toLowerCase()}${lastName.toLowerCase().replace(/\s/g, '')}` ||
                       emailPrefix === `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/\s/g, '')}` ||
                       emailPrefix === firstName[0].toLowerCase();
            });
            if (matchingEmail) {
                const existUser = await pool.request()
                    .input('email', sql.NVarChar(255), matchingEmail.email)
                    .query('SELECT id FROM users WHERE email = @email');
                if (existUser.recordset.length === 0) {
                    const username = matchingEmail.email.split('@')[0];
                    await pool.request()
                        .input('username', sql.NVarChar(100), username)
                        .input('firstName', sql.NVarChar(100), firstName)
                        .input('lastName', sql.NVarChar(100), lastName)
                        .input('displayName', sql.NVarChar(150), lead.name)
                        .input('email', sql.NVarChar(255), matchingEmail.email)
                        .input('dept', sql.NVarChar(10), lead.department)
                        .query(`
                            IF NOT EXISTS (SELECT 1 FROM users WHERE email = @email)
                                INSERT INTO users (username, first_name, last_name, display_name, email, department, is_admin, is_master, password_hash)
                                VALUES (@username, @firstName, @lastName, @displayName, @email, @dept, 1, 0, NULL)
                        `);
                    console.log(`Pre-created placeholder admin account for ${lead.name} (${matchingEmail.email})`);
                }
            }
        }

        // Auto-seed board memberships for admins
        const adminsResult = await pool.request().query(
            'SELECT id, first_name, last_name, email, department, is_master FROM users WHERE is_admin = 1 AND is_master = 0 AND password_hash IS NOT NULL'
        );
        for (const admin of adminsResult.recordset) {
            const adminBoardName = `Retro - ${admin.first_name} ${admin.last_name}`;
            const boardResult = await pool.request()
                .input('name', sql.NVarChar(255), adminBoardName)
                .query('SELECT id FROM boards WHERE name = @name');
            if (boardResult.recordset.length > 0) {
                await pool.request()
                    .input('boardId', sql.Int, boardResult.recordset[0].id)
                    .input('userId', sql.Int, admin.id)
                    .query(`
                        IF NOT EXISTS (SELECT 1 FROM board_members WHERE board_id = @boardId AND user_id = @userId)
                            INSERT INTO board_members (board_id, user_id) VALUES (@boardId, @userId)
                    `);
            }
        }

        // Auto-seed board memberships for regular users
        const usersResult = await pool.request().query(
            'SELECT id, [lead], department FROM users WHERE is_admin = 0 AND is_master = 0 AND password_hash IS NOT NULL AND [lead] IS NOT NULL'
        );
        for (const u of usersResult.recordset) {
            const leadBoardName = `Retro - ${u.lead}`;
            const boardResult = await pool.request()
                .input('name', sql.NVarChar(255), leadBoardName)
                .query('SELECT id FROM boards WHERE name = @name');
            if (boardResult.recordset.length > 0) {
                await pool.request()
                    .input('boardId', sql.Int, boardResult.recordset[0].id)
                    .input('userId', sql.Int, u.id)
                    .query(`
                        IF NOT EXISTS (SELECT 1 FROM board_members WHERE board_id = @boardId AND user_id = @userId)
                            INSERT INTO board_members (board_id, user_id) VALUES (@boardId, @userId)
                    `);
            }
        }

        await pool.request().query(`
            UPDATE b SET owner_user_id = u.id
            FROM boards b
            INNER JOIN users u ON b.name = CONCAT('Retro - ', u.display_name)
            WHERE b.owner_user_id IS NULL
        `);
        await pool.request().query(`
            UPDATE b SET owner_user_id = x.user_id
            FROM boards b
            CROSS APPLY (
                SELECT TOP 1 bm.user_id FROM board_members bm WHERE bm.board_id = b.id ORDER BY bm.id ASC
            ) x
            WHERE b.owner_user_id IS NULL
        `);

        console.log("Database initialized with Multi-board capability (MS SQL Server)");

        // Seed default GIFs in background
        seedDefaultGifs().catch(err => console.warn('GIF seed failed (non-fatal):', err.message));
    } catch (error) {
        console.error("Error initializing database:", error);
    }
};

// --- Broadcast helpers ---
const broadcastBoardUpdate = async (boardId) => {
    try {
        const colResult = await pool.request()
            .input('boardId', sql.Int, boardId)
            .query('SELECT * FROM [columns] WHERE board_id = @boardId ORDER BY position ASC');
        const columns = colResult.recordset;
        let cards = [];
        if (columns.length > 0) {
            const columnIds = columns.map(c => c.id);
            // Build parameterized IN clause
            const inParams = columnIds.map((id, i) => `@cid${i}`).join(',');
            const req = pool.request();
            columnIds.forEach((id, i) => req.input(`cid${i}`, sql.Int, id));
            const cardResult = await req.query(`SELECT * FROM cards WHERE column_id IN (${inParams}) AND deleted_at IS NULL ORDER BY position ASC`);
            cards = cardResult.recordset;

            // Fetch reactions for all cards in this board
            if (cards.length > 0) {
                const cardIds = cards.map(c => c.id);
                const rInParams = cardIds.map((id, i) => `@rid${i}`).join(',');
                const rReq = pool.request();
                cardIds.forEach((id, i) => rReq.input(`rid${i}`, sql.Int, id));
                const reactResult = await rReq.query(`SELECT cr.card_id, cr.user_id, cr.emoji, u.display_name FROM card_reactions cr LEFT JOIN users u ON cr.user_id = u.id WHERE cr.card_id IN (${rInParams})`);
                const reactionsMap = {};
                for (const r of reactResult.recordset) {
                    if (!reactionsMap[r.card_id]) reactionsMap[r.card_id] = [];
                    reactionsMap[r.card_id].push({ user_id: r.user_id, emoji: r.emoji, display_name: r.display_name });
                }
                cards = cards.map(c => ({ ...c, reactions: reactionsMap[c.id] || [] }));
            }
        }
        io.to(`board:${boardId}`).emit('board:update', { boardId: parseInt(boardId), columns, cards });
    } catch (error) {
        console.error('Error broadcasting board update:', error);
    }
};

const broadcastBoardsUpdate = async () => {
    try {
        const result = await pool.request().query('SELECT id, name, department, owner_user_id, bg_image, created_at FROM boards ORDER BY created_at DESC');
        io.emit('boards:update', { boards: result.recordset });
    } catch (error) {
        console.error('Error broadcasting boards update:', error);
    }
};

async function getBoardForAuthMssql(boardId) {
    const result = await pool.request().input('id', sql.Int, boardId).query('SELECT * FROM boards WHERE id = @id');
    if (result.recordset.length === 0) {
        const err = new Error('Board not found');
        err.status = 404;
        throw err;
    }
    return result.recordset[0];
}

function sameDepartmentForBoard(user, board) {
    if (user.is_overlord) return true;
    if (user.is_master) return (MASTER_DEPT_MAP[user.email] || user.department) === board.department;
    return !board.department || board.department === user.department;
}

function isBoardOwnerMssql(user, board) {
    return Number(board.owner_user_id) === Number(user.id || user.sub);
}

async function assertBoardAccessMssql(user, boardId) {
    const board = await getBoardForAuthMssql(boardId);
    if (user.is_overlord || (user.is_master && sameDepartmentForBoard(user, board))) return board;
    if (user.is_admin || isBoardOwnerMssql(user, board)) return board;
    const result = await pool.request()
        .input('boardId', sql.Int, boardId)
        .input('userId', sql.Int, user.id || user.sub)
        .query('SELECT id FROM board_members WHERE board_id = @boardId AND user_id = @userId');
    if (result.recordset.length === 0) {
        const err = new Error('Access denied');
        err.status = 403;
        throw err;
    }
    return board;
}

async function assertBoardManagerMssql(user, boardId, message = 'Only board owners or admins can perform this action') {
    const board = await getBoardForAuthMssql(boardId);
    if (user.is_overlord || (user.is_master && sameDepartmentForBoard(user, board)) || user.is_admin || isBoardOwnerMssql(user, board)) return board;
    const err = new Error(message);
    err.status = 403;
    throw err;
}

// Track connected sockets by userId
const userSockets = new Map();

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);
    socket.on('register:user', (userId) => {
        if (!userId) return;
        socket.userId = userId;
        if (!userSockets.has(userId)) userSockets.set(userId, new Set());
        userSockets.get(userId).add(socket.id);
    });
    socket.on('join:board', (boardId) => { socket.join(`board:${boardId}`); });
    socket.on('leave:board', (boardId) => { socket.leave(`board:${boardId}`); });
    socket.on('disconnect', () => {
        console.log(`Client disconnected: ${socket.id}`);
        if (socket.userId && userSockets.has(socket.userId)) {
            userSockets.get(socket.userId).delete(socket.id);
            if (userSockets.get(socket.userId).size === 0) userSockets.delete(socket.userId);
        }
    });
});

// --- Helper: Create default board for a new admin ---
async function createDefaultAdminBoard(firstName, lastName, department, userId) {
    const boardName = `Retro - ${firstName} ${lastName}`;
    try {
        const insertResult = await pool.request()
            .input('name', sql.NVarChar(255), boardName)
            .input('dept', sql.NVarChar(10), department)
            .input('ownerUserId', sql.Int, userId || null)
            .query('INSERT INTO boards (name, department, owner_user_id) OUTPUT INSERTED.id VALUES (@name, @dept, @ownerUserId)');
        const boardId = insertResult.recordset[0].id;
        const templateColumns = [
            ['Ice Breaker', 0],
            ['Needs Improvements', 1],
            ['Went Well', 2],
            ['Action Items', 3],
        ];
        for (const [colName, pos] of templateColumns) {
            await pool.request()
                .input('boardId', sql.Int, boardId)
                .input('name', sql.NVarChar(255), colName)
                .input('pos', sql.Int, pos)
                .query('INSERT INTO [columns] (board_id, name, position) VALUES (@boardId, @name, @pos)');
        }
        if (userId) {
            await pool.request()
                .input('boardId', sql.Int, boardId)
                .input('userId', sql.Int, userId)
                .query(`
                    IF NOT EXISTS (SELECT 1 FROM board_members WHERE board_id = @boardId AND user_id = @userId)
                        INSERT INTO board_members (board_id, user_id) VALUES (@boardId, @userId)
                `);
        }
        console.log(`Created default board "${boardName}" (id=${boardId}) for new admin in ${department}`);
        broadcastBoardsUpdate();
    } catch (error) {
        console.error('Error creating default admin board:', error);
    }
}

// =====================================================================
// AUTH ROUTES
// =====================================================================

app.get('/api/auth/captcha', (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json(createCaptchaChallenge());
});

app.post('/api/auth/register', async (req, res) => {
    const { firstName, lastName, email, password, department, lead, role, captcha } = req.body;
    const emailLower = (email || '').toLowerCase();
    const isMasterEmail = MASTER_EMAILS.includes(emailLower);
    const isOverlordEmail = OVERLORD_EMAILS.includes(emailLower);

    let callerIsMaster = false;
    let callerIsOverlord = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
            callerIsMaster = !!payload.is_master;
            callerIsOverlord = !!payload.is_overlord;
        } catch (e) { /* treat as self-registration */ }
    }

    if (!email) return res.status(400).json({ error: 'Email is required' });
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
        return res.status(400).json({ error: 'A valid email address is required' });

    const isMasterAdd = (callerIsMaster || callerIsOverlord) && !password;

    if (!isMasterAdd) {
        if (!firstName || !lastName || !password)
            return res.status(400).json({ error: 'First name, last name, and password are required' });
        if (typeof firstName !== 'string' || firstName.trim().length < 1 || firstName.trim().length > 50)
            return res.status(400).json({ error: 'First name must be 1-50 characters' });
        if (typeof lastName !== 'string' || lastName.trim().length < 1 || lastName.trim().length > 50)
            return res.status(400).json({ error: 'Last name must be 1-50 characters' });
        if (typeof password !== 'string' || password.length < 6)
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
    } else if (firstName) {
        if (typeof firstName !== 'string' || firstName.trim().length < 1 || firstName.trim().length > 50)
            return res.status(400).json({ error: 'First name must be 1-50 characters' });
        if (!lastName || typeof lastName !== 'string' || lastName.trim().length < 1 || lastName.trim().length > 50)
            return res.status(400).json({ error: 'Last name must be 1-50 characters' });
    }

    const skipDeptLead = isMasterEmail || isOverlordEmail || (callerIsMaster && (role === 'master' || role === 'admin')) || (callerIsOverlord && (role === 'master' || role === 'admin' || role === 'overlord'));
    const skipLead = skipDeptLead;
    if (!isMasterAdd && !skipDeptLead && !department)
        return res.status(400).json({ error: 'department is required' });
    if (!isMasterAdd && !skipLead && !lead)
        return res.status(400).json({ error: 'lead is required' });
    if (!skipDeptLead && department) {
        if (!VALID_DEPARTMENTS.includes(department))
            return res.status(400).json({ error: 'Department must be QA, SE, or SDET' });
    }

    try {
        if (!isMasterAdd) verifyCaptchaOrThrow(captcha);

        const existResult = await pool.request()
            .input('email', sql.NVarChar(255), emailLower)
            .query('SELECT id, password_hash FROM users WHERE email = @email');

        // Pre-added placeholder — allow completion
        if (existResult.recordset.length > 0 && !isMasterAdd && existResult.recordset[0].password_hash === null) {
            const password_hash = await hashPassword(password);
            const first_name = firstName.trim();
            const last_name = lastName.trim();
            const display_name = `${first_name} ${last_name}`;
            await pool.request()
                .input('fn', sql.NVarChar(100), first_name)
                .input('ln', sql.NVarChar(100), last_name)
                .input('dn', sql.NVarChar(150), display_name)
                .input('ph', sql.NVarChar(255), password_hash)
                .input('dept', sql.NVarChar(10), department || null)
                .input('lead', sql.NVarChar(150), lead || null)
                .input('id', sql.Int, existResult.recordset[0].id)
                .query(`UPDATE users SET first_name = @fn, last_name = @ln, display_name = @dn, password_hash = @ph,
                        department = COALESCE(@dept, department), [lead] = COALESCE(@lead, [lead]) WHERE id = @id`);
            const updatedResult = await pool.request()
                .input('id', sql.Int, existResult.recordset[0].id)
                .query('SELECT * FROM users WHERE id = @id');
            const user = updatedResult.recordset[0];
            const token = buildUserToken(user);
            if (user.is_admin || user.is_master) {
                await createDefaultAdminBoard(first_name, last_name, user.department, user.id);
            }
            return res.status(200).json({ token, user: buildUserPublic(user) });
        }

        if (existResult.recordset.length > 0)
            return res.status(409).json({ error: 'An account with this email already exists' });

        let is_admin, is_master, is_overlord;
        if ((callerIsMaster || callerIsOverlord) && role && ['master', 'admin', 'user', 'overlord'].includes(role)) {
            // Only overlords can create other overlords
            is_overlord = (role === 'overlord' && callerIsOverlord) ? 1 : 0;
            is_master = role === 'master' ? 1 : 0;
            is_admin = role === 'admin' || role === 'master' || (role === 'overlord' && callerIsOverlord) ? 1 : 0;
        } else {
            is_admin = ADMIN_EMAILS.includes(emailLower) ? 1 : 0;
            is_master = MASTER_EMAILS.includes(emailLower) ? 1 : 0;
            is_overlord = OVERLORD_EMAILS.includes(emailLower) ? 1 : 0;
        }
        const finalDept = (department && VALID_DEPARTMENTS.includes(department)) ? department : 'QA';
        const finalLead = (role === 'admin' || role === 'master' || skipLead) ? null : (lead || null);

        const first_name = isMasterAdd ? (firstName ? firstName.trim() : emailLower.split('@')[0]) : firstName.trim();
        const last_name = isMasterAdd ? (lastName ? lastName.trim() : '') : lastName.trim();
        const display_name = (first_name + (last_name ? ` ${last_name}` : '')).trim();
        const baseUsername = emailLower.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 28);
        let username = baseUsername;
        let suffix = 1;
        while (true) {
            const check = await pool.request()
                .input('uname', sql.NVarChar(100), username)
                .query('SELECT id FROM users WHERE username = @uname');
            if (check.recordset.length === 0) break;
            username = `${baseUsername}_${suffix++}`;
        }
        const password_hash = isMasterAdd ? null : await hashPassword(password);

        const insertResult = await pool.request()
            .input('username', sql.NVarChar(100), username)
            .input('fn', sql.NVarChar(100), first_name)
            .input('ln', sql.NVarChar(100), last_name)
            .input('dn', sql.NVarChar(150), display_name)
            .input('email', sql.NVarChar(255), emailLower)
            .input('dept', sql.NVarChar(10), finalDept)
            .input('lead', sql.NVarChar(150), finalLead)
            .input('isAdmin', sql.Bit, is_admin)
            .input('isMaster', sql.Bit, is_master)
            .input('isOverlord', sql.Bit, is_overlord)
            .input('ph', sql.NVarChar(255), password_hash)
            .query(`INSERT INTO users (username, first_name, last_name, display_name, email, department, [lead], is_admin, is_master, is_overlord, password_hash)
                    OUTPUT INSERTED.id
                    VALUES (@username, @fn, @ln, @dn, @email, @dept, @lead, @isAdmin, @isMaster, @isOverlord, @ph)`);
        const newId = insertResult.recordset[0].id;
        const newUser = { id: newId, username, first_name, last_name, display_name, email: emailLower, department: finalDept, lead: finalLead, is_admin, is_master, is_overlord };
        const token = buildUserToken(newUser);

        if ((callerIsMaster || callerIsOverlord) && (role === 'admin' || role === 'master')) {
            try {
                await pool.request()
                    .input('email', sql.NVarChar(255), emailLower)
                    .input('dept', sql.NVarChar(10), finalDept)
                    .query(`IF NOT EXISTS (SELECT 1 FROM admin_emails WHERE email = @email) INSERT INTO admin_emails (email, department) VALUES (@email, @dept)`);
                await reloadAdminEmails();
            } catch (e) { /* ignore */ }
        }

        if ((is_admin || is_master || is_overlord) && password_hash) {
            await createDefaultAdminBoard(first_name, last_name, finalDept, newId);
        }

        if (finalLead && !is_admin && !is_master && !is_overlord) {
            const leadBoardName = `Retro - ${finalLead}`;
            const lb = await pool.request()
                .input('name', sql.NVarChar(255), leadBoardName)
                .query('SELECT id FROM boards WHERE name = @name');
            if (lb.recordset.length > 0) {
                await pool.request()
                    .input('boardId', sql.Int, lb.recordset[0].id)
                    .input('userId', sql.Int, newId)
                    .query(`IF NOT EXISTS (SELECT 1 FROM board_members WHERE board_id = @boardId AND user_id = @userId)
                            INSERT INTO board_members (board_id, user_id) VALUES (@boardId, @userId)`);
            }
        }

        sendWelcomeEmail(first_name, emailLower);
        res.status(201).json({ token, user: buildUserPublic(newUser) });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        console.error('Register error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    const { email, password, captcha } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password are required' });
    try {
        verifyCaptchaOrThrow(captcha);

        const result = await pool.request()
            .input('email', sql.NVarChar(255), email.trim().toLowerCase())
            .query('SELECT * FROM users WHERE email = @email');
        if (result.recordset.length === 0) return res.status(401).json({ error: 'Invalid email or password' });
        const user = result.recordset[0];

        const shouldBeAdmin = ADMIN_EMAILS.includes(user.email.toLowerCase()) ? 1 : 0;
        const shouldBeMaster = MASTER_EMAILS.includes(user.email.toLowerCase()) ? 1 : 0;
        const shouldBeOverlord = OVERLORD_EMAILS.includes(user.email.toLowerCase()) ? 1 : 0;
        if ((user.is_admin ? 1 : 0) !== shouldBeAdmin || (user.is_master ? 1 : 0) !== shouldBeMaster || (user.is_overlord ? 1 : 0) !== shouldBeOverlord) {
            await pool.request()
                .input('isAdmin', sql.Bit, shouldBeAdmin)
                .input('isMaster', sql.Bit, shouldBeMaster)
                .input('isOverlord', sql.Bit, shouldBeOverlord)
                .input('id', sql.Int, user.id)
                .query('UPDATE users SET is_admin = @isAdmin, is_master = @isMaster, is_overlord = @isOverlord WHERE id = @id');
            user.is_admin = shouldBeAdmin;
            user.is_master = shouldBeMaster;
            user.is_overlord = shouldBeOverlord;
        }
        if (!user.password_hash)
            return res.status(401).json({ error: 'Your account has been created but you need to register first. Click "Create an account" to set your name and password.' });
        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) return res.status(401).json({ error: 'Invalid email or password' });
        const token = buildUserToken(user);
        const password_weak = typeof password === 'string' && password.length < 6;
        res.json({ token, user: buildUserPublic(user), password_weak });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ user: buildUserPublic(req.user) });
});

app.patch('/api/auth/profile', authMiddleware, async (req, res) => {
    const { firstName, lastName } = req.body;
    if (!firstName?.trim() || !lastName?.trim()) return res.status(400).json({ error: 'First and last name are required' });
    const display_name = `${firstName.trim()} ${lastName.trim()}`;
    try {
        await pool.request()
            .input('fn', sql.NVarChar(100), firstName.trim())
            .input('ln', sql.NVarChar(100), lastName.trim())
            .input('dn', sql.NVarChar(150), display_name)
            .input('id', sql.Int, req.user.sub)
            .query('UPDATE users SET first_name = @fn, last_name = @ln, display_name = @dn WHERE id = @id');
        const result = await pool.request().input('id', sql.Int, req.user.sub).query('SELECT * FROM users WHERE id = @id');
        const token = buildUserToken(result.recordset[0]);
        res.json({ token, user: buildUserPublic(result.recordset[0]) });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/auth/password', authMiddleware, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Current and new password are required' });
    if (typeof newPassword !== 'string' || newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });
    try {
        const result = await pool.request().input('id', sql.Int, req.user.sub).query('SELECT * FROM users WHERE id = @id');
        if (!result.recordset.length) return res.status(404).json({ error: 'User not found' });
        const valid = await verifyPassword(currentPassword, result.recordset[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
        const password_hash = await hashPassword(newPassword);
        await pool.request().input('ph', sql.NVarChar(255), password_hash).input('id', sql.Int, req.user.sub)
            .query('UPDATE users SET password_hash = @ph WHERE id = @id');
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// USER MANAGEMENT
// =====================================================================

app.delete('/api/auth/account', authMiddleware, async (req, res) => {
    try {
        if (req.user.is_master || req.user.is_overlord) return res.status(403).json({ error: 'Master/Overlord accounts cannot be deleted.' });
        await pool.request().input('id', sql.Int, req.user.sub).query('DELETE FROM users WHERE id = @id');
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/users', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master && !req.user.is_admin) return res.status(403).json({ error: 'Access denied' });
    try {
        if (req.user.is_overlord) {
            const result = await pool.request().query(
                'SELECT id, username, first_name, last_name, display_name, email, department, [lead], is_admin, is_master, is_overlord, created_at FROM users ORDER BY department, [lead], display_name'
            );
            return res.json(result.recordset);
        }
        if (req.user.is_master) {
            const masterDept = MASTER_DEPT_MAP[req.user.email] || req.user.department;
            const result = await pool.request()
                .input('dept', sql.NVarChar(10), masterDept)
                .query('SELECT id, username, first_name, last_name, display_name, email, department, [lead], is_admin, is_master, is_overlord, created_at FROM users WHERE department = @dept ORDER BY [lead], display_name');
            return res.json(result.recordset);
        }
        const result = await pool.request()
            .input('dn', sql.NVarChar(150), req.user.display_name)
            .query('SELECT id, username, first_name, last_name, display_name, email, department, [lead], is_admin, is_master, is_overlord, created_at FROM users WHERE [lead] = @dn ORDER BY display_name');
        res.json(result.recordset);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/users/department/:dept', authMiddleware, async (req, res) => {
    const { dept } = req.params;
    if (!VALID_DEPARTMENTS.includes(dept)) return res.status(400).json({ error: 'Invalid department' });
    try {
        const result = await pool.request()
            .input('dept', sql.NVarChar(10), dept)
            .query('SELECT id, display_name FROM users WHERE department = @dept ORDER BY display_name');
        res.json(result.recordset);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/leads', async (req, res) => {
    try {
        const result = await pool.request().query(
            'SELECT display_name, department FROM users WHERE is_admin = 1 AND is_master = 0 ORDER BY display_name'
        );
        const grouped = {};
        for (const dept of VALID_DEPARTMENTS) grouped[dept] = [...(LEADS_BY_DEPT[dept] || [])];
        for (const r of result.recordset) {
            if (grouped[r.department] && !grouped[r.department].includes(r.display_name)) {
                grouped[r.department].push(r.display_name);
            }
        }
        for (const dept of VALID_DEPARTMENTS) grouped[dept].sort();
        res.json(grouped);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.patch('/api/users/:userId', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { userId } = req.params;
    const { department, lead, is_admin, is_master, first_name, last_name } = req.body;

    // Master toggle
    if (is_master !== undefined && department === undefined && is_admin === undefined) {
        if (parseInt(userId) === req.user.sub) return res.status(400).json({ error: 'You cannot change your own master status' });
        const val = is_master ? 1 : 0;
        try {
            const userResult = await pool.request()
                .input('id', sql.Int, userId)
                .query('SELECT email, department FROM users WHERE id = @id');
            if (userResult.recordset.length === 0) return res.status(404).json({ error: 'User not found' });
            const { email: userEmail, department: userDept } = userResult.recordset[0];
            if (val === 1) {
                await pool.request().input('id', sql.Int, userId).query('UPDATE users SET is_master = 1, is_admin = 0 WHERE id = @id');
                await pool.request()
                    .input('email', sql.NVarChar(255), userEmail)
                    .input('dept', sql.NVarChar(10), userDept || 'QA')
                    .query(`IF NOT EXISTS (SELECT 1 FROM master_emails WHERE email = @email) INSERT INTO master_emails (email, department) VALUES (@email, @dept)`);
            } else {
                await pool.request().input('id', sql.Int, userId).query('UPDATE users SET is_master = 0 WHERE id = @id');
                await pool.request()
                    .input('email', sql.NVarChar(255), userEmail)
                    .query('DELETE FROM master_emails WHERE email = @email');
            }
            await reloadMasterEmails();
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: error.message }); }
        return;
    }

    // Admin toggle
    if (is_admin !== undefined && department === undefined) {
        const val = is_admin ? 1 : 0;
        try {
            await pool.request()
                .input('isAdmin', sql.Bit, val)
                .input('id', sql.Int, userId)
                .query('UPDATE users SET is_admin = @isAdmin WHERE id = @id AND is_master = 0');
            const userResult = await pool.request()
                .input('id', sql.Int, userId)
                .query('SELECT first_name, last_name, display_name, department, email FROM users WHERE id = @id');
            if (userResult.recordset.length > 0) {
                const { first_name: fn, last_name: ln, display_name, department: userDept, email: userEmail } = userResult.recordset[0];
                if (val === 1) {
                    await pool.request()
                        .input('email', sql.NVarChar(255), userEmail)
                        .input('dept', sql.NVarChar(10), userDept || 'QA')
                        .query(`IF NOT EXISTS (SELECT 1 FROM admin_emails WHERE email = @email) INSERT INTO admin_emails (email, department) VALUES (@email, @dept)`);
                    await reloadAdminEmails();
                    const boardName = `Retro - ${display_name}`;
                    const existBoard = await pool.request()
                        .input('name', sql.NVarChar(255), boardName)
                        .query('SELECT id FROM boards WHERE name = @name');
                    if (existBoard.recordset.length === 0) {
                        await createDefaultAdminBoard(fn, ln, userDept || 'QA', parseInt(userId));
                    } else {
                        await pool.request()
                            .input('boardId', sql.Int, existBoard.recordset[0].id)
                            .input('userId', sql.Int, parseInt(userId))
                            .query(`IF NOT EXISTS (SELECT 1 FROM board_members WHERE board_id = @boardId AND user_id = @userId)
                                    INSERT INTO board_members (board_id, user_id) VALUES (@boardId, @userId)`);
                        broadcastBoardsUpdate();
                    }
                } else {
                    await pool.request()
                        .input('email', sql.NVarChar(255), userEmail)
                        .query('DELETE FROM admin_emails WHERE email = @email');
                    await reloadAdminEmails();
                }
            }
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: error.message }); }
        return;
    }

    if (!VALID_DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Invalid department' });
    try {
        const currentResult = await pool.request()
            .input('id', sql.Int, userId)
            .query('SELECT [lead] FROM users WHERE id = @id');
        const oldLead = currentResult.recordset.length > 0 ? currentResult.recordset[0].lead : null;

        if (first_name !== undefined && last_name !== undefined) {
            const fn = first_name.trim();
            const ln = last_name.trim();
            const displayName = [fn, ln].filter(Boolean).join(' ');
            await pool.request()
                .input('dept', sql.NVarChar(10), department)
                .input('lead', sql.NVarChar(150), lead)
                .input('fn', sql.NVarChar(100), fn)
                .input('ln', sql.NVarChar(100), ln)
                .input('dn', sql.NVarChar(150), displayName)
                .input('id', sql.Int, userId)
                .query('UPDATE users SET department = @dept, [lead] = @lead, first_name = @fn, last_name = @ln, display_name = @dn WHERE id = @id');
        } else {
            await pool.request()
                .input('dept', sql.NVarChar(10), department)
                .input('lead', sql.NVarChar(150), lead)
                .input('id', sql.Int, userId)
                .query('UPDATE users SET department = @dept, [lead] = @lead WHERE id = @id');
        }

        // Remove from old lead's board
        if (oldLead && oldLead !== lead) {
            const oldBoardName = `Retro - ${oldLead}`;
            const ob = await pool.request().input('name', sql.NVarChar(255), oldBoardName).query('SELECT id FROM boards WHERE name = @name');
            if (ob.recordset.length > 0) {
                await pool.request()
                    .input('boardId', sql.Int, ob.recordset[0].id)
                    .input('userId', sql.Int, userId)
                    .query('DELETE FROM board_members WHERE board_id = @boardId AND user_id = @userId');
            }
        }
        // Add to new lead's board
        if (lead) {
            const lb = await pool.request().input('name', sql.NVarChar(255), `Retro - ${lead}`).query('SELECT id FROM boards WHERE name = @name');
            if (lb.recordset.length > 0) {
                await pool.request()
                    .input('boardId', sql.Int, lb.recordset[0].id)
                    .input('userId', sql.Int, userId)
                    .query(`IF NOT EXISTS (SELECT 1 FROM board_members WHERE board_id = @boardId AND user_id = @userId)
                            INSERT INTO board_members (board_id, user_id) VALUES (@boardId, @userId)`);
            }
        }

        const targetSockets = userSockets.get(parseInt(userId));
        if (targetSockets) { for (const sid of targetSockets) io.to(sid).emit('boards:refresh'); }
        broadcastBoardsUpdate();
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/users/:userId', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { userId } = req.params;
    if (parseInt(userId) === req.user.sub) return res.status(400).json({ error: 'You cannot delete your own account' });
    try {
        await pool.request().input('id', sql.Int, userId).query('DELETE FROM users WHERE id = @id');
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// ADMIN / MASTER EMAIL MANAGEMENT
// =====================================================================

app.get('/api/admin-emails', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    try {
        const result = await pool.request().query('SELECT id, email, department, created_at FROM admin_emails ORDER BY department, email');
        res.json(result.recordset);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/admin-emails', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { email, department } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    const emailLower = email.toLowerCase().trim();
    try {
        await pool.request()
            .input('email', sql.NVarChar(255), emailLower)
            .input('dept', sql.NVarChar(10), department || null)
            .query('INSERT INTO admin_emails (email, department) VALUES (@email, @dept)');
        await reloadAdminEmails();
        await pool.request().input('email', sql.NVarChar(255), emailLower)
            .query('UPDATE users SET is_admin = 1 WHERE email = @email');
        res.status(201).json({ success: true, email: emailLower, department });
    } catch (error) {
        if (error.number === 2627) return res.status(409).json({ error: 'Email already in admin list' });
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/admin-emails/:id', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { department } = req.body;
    if (!department || !VALID_DEPARTMENTS.includes(department))
        return res.status(400).json({ error: `Valid department required (${VALID_DEPARTMENTS.join(', ')})` });
    try {
        await pool.request()
            .input('dept', sql.NVarChar(10), department)
            .input('id', sql.Int, req.params.id)
            .query('UPDATE admin_emails SET department = @dept WHERE id = @id');
        const emailResult = await pool.request().input('id', sql.Int, req.params.id).query('SELECT email FROM admin_emails WHERE id = @id');
        if (emailResult.recordset.length > 0) {
            await pool.request()
                .input('dept', sql.NVarChar(10), department)
                .input('email', sql.NVarChar(255), emailResult.recordset[0].email)
                .query('UPDATE users SET department = @dept WHERE email = @email');
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/admin-emails/:id', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    try {
        const emailResult = await pool.request().input('id', sql.Int, req.params.id).query('SELECT email FROM admin_emails WHERE id = @id');
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM admin_emails WHERE id = @id');
        await reloadAdminEmails();
        if (emailResult.recordset.length > 0) {
            await pool.request().input('email', sql.NVarChar(255), emailResult.recordset[0].email)
                .query('UPDATE users SET is_admin = 0 WHERE email = @email');
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/master-emails', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    try {
        const result = await pool.request().query('SELECT id, email, department, created_at FROM master_emails ORDER BY email');
        res.json(result.recordset);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/master-emails', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Valid email required' });
    const emailLower = email.toLowerCase().trim();
    try {
        const dept = req.body.department && ['QA', 'SE', 'SDET'].includes(req.body.department) ? req.body.department : null;
        await pool.request().input('email', sql.NVarChar(255), emailLower).input('dept', sql.NVarChar(10), dept)
            .query('INSERT INTO master_emails (email, department) VALUES (@email, @dept)');
        await reloadMasterEmails();
        await pool.request().input('email', sql.NVarChar(255), emailLower)
            .query('UPDATE users SET is_master = 1, is_admin = 1 WHERE email = @email');
        res.status(201).json({ success: true, email: emailLower });
    } catch (error) {
        if (error.number === 2627) return res.status(409).json({ error: 'Email already in master list' });
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/master-emails/:id', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    try {
        const emailResult = await pool.request().input('id', sql.Int, req.params.id).query('SELECT email FROM master_emails WHERE id = @id');
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM master_emails WHERE id = @id');
        await reloadMasterEmails();
        if (emailResult.recordset.length > 0) {
            await pool.request().input('email', sql.NVarChar(255), emailResult.recordset[0].email)
                .query('UPDATE users SET is_master = 0 WHERE email = @email');
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// ROLE LABELS
// =====================================================================

app.get('/api/role-labels', async (req, res) => {
    try {
        const result = await pool.request().query('SELECT role_key, label FROM role_labels ORDER BY id ASC');
        const labels = {};
        result.recordset.forEach(r => { labels[r.role_key] = r.label; });
        res.json(labels);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/role-labels', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Only masters can edit role labels' });
    const { labels } = req.body;
    if (!labels || typeof labels !== 'object') return res.status(400).json({ error: 'labels object required' });
    try {
        for (const [key, value] of Object.entries(labels)) {
            if (typeof value !== 'string' || !value.trim()) continue;
            await pool.request()
                .input('label', sql.NVarChar(100), value.trim())
                .input('key', sql.NVarChar(50), key)
                .query('UPDATE role_labels SET label = @label WHERE role_key = @key');
        }
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/role-labels', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Only masters can add role labels' });
    const { role_key, label } = req.body;
    if (!role_key || !label || typeof role_key !== 'string' || typeof label !== 'string')
        return res.status(400).json({ error: 'role_key and label required' });
    const key = role_key.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key || !label.trim()) return res.status(400).json({ error: 'Invalid role_key or label' });
    try {
        // MERGE for upsert (replaces INSERT ... ON DUPLICATE KEY UPDATE)
        await pool.request()
            .input('key', sql.NVarChar(50), key)
            .input('label', sql.NVarChar(100), label.trim())
            .query(`
                MERGE role_labels AS target
                USING (SELECT @key AS role_key, @label AS label) AS source
                ON target.role_key = source.role_key
                WHEN MATCHED THEN UPDATE SET label = source.label
                WHEN NOT MATCHED THEN INSERT (role_key, label) VALUES (source.role_key, source.label);
            `);
        res.status(201).json({ role_key: key, label: label.trim() });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/role-labels/:key', authMiddleware, async (req, res) => {
    if (!req.user.is_overlord && !req.user.is_master) return res.status(403).json({ error: 'Only masters can delete role labels' });
    const { key } = req.params;
    if (['master', 'admin', 'user'].includes(key)) return res.status(400).json({ error: 'Cannot delete built-in role labels' });
    try {
        await pool.request().input('key', sql.NVarChar(50), key).query('DELETE FROM role_labels WHERE role_key = @key');
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// BOARDS
// =====================================================================

app.get('/api/boards', authMiddleware, async (req, res) => {
    try {
        let boards;
        if (req.user.is_overlord) {
            const result = await pool.request().query('SELECT * FROM boards ORDER BY created_at DESC');
            boards = result.recordset;
        } else if (req.user.is_master) {
            const masterDept = MASTER_DEPT_MAP[req.user.email] || req.user.department;
            const result = await pool.request()
                .input('dept', sql.NVarChar(10), masterDept)
                .query('SELECT * FROM boards WHERE department = @dept ORDER BY created_at DESC');
            boards = result.recordset;
        } else if (req.user.is_admin) {
            const result = await pool.request().query('SELECT * FROM boards ORDER BY created_at DESC');
            boards = result.recordset;
        } else {
            const result = await pool.request()
                .input('userId', sql.Int, req.user.id)
                .query(`SELECT DISTINCT b.* FROM boards b
                        JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = @userId
                        ORDER BY b.created_at DESC`);
            boards = result.recordset;
        }
        res.json(boards);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/boards', authMiddleware, async (req, res) => {
    const { name, department, template } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    const boardDept = req.user.is_admin && department && VALID_DEPARTMENTS.includes(department)
        ? department
        : (VALID_DEPARTMENTS.includes(req.user.department) ? req.user.department : 'QA');
    try {
        if (!req.user.is_admin && !req.user.is_master && !req.user.is_overlord) {
            const ownedResult = await pool.request()
                .input('userId', sql.Int, req.user.id)
                .query('SELECT COUNT(*) AS count FROM boards WHERE owner_user_id = @userId');
            if (ownedResult.recordset[0].count >= 3) {
                return res.status(403).json({ error: 'Basic users can create up to 3 boards.' });
            }
        }
        const insertResult = await pool.request()
            .input('name', sql.NVarChar(255), name.trim())
            .input('dept', sql.NVarChar(10), boardDept)
            .input('ownerUserId', sql.Int, req.user.id)
            .query('INSERT INTO boards (name, department, owner_user_id) OUTPUT INSERTED.id VALUES (@name, @dept, @ownerUserId)');
        const insertId = insertResult.recordset[0].id;
        const defaultColumns = template === 'template'
            ? [['Ice Breaker', 0], ['Needs Improvements', 1], ['Went Well', 2], ['Action Items', 3]]
            : [['Went Well', 0], ['To Improve', 1], ['Action Items', 2]];
        for (const [colName, pos] of defaultColumns) {
            await pool.request()
                .input('boardId', sql.Int, insertId)
                .input('name', sql.NVarChar(255), colName)
                .input('pos', sql.Int, pos)
                .query('INSERT INTO [columns] (board_id, name, position) VALUES (@boardId, @name, @pos)');
        }
        await pool.request()
            .input('boardId', sql.Int, insertId)
            .input('userId', sql.Int, req.user.id)
            .query(`IF NOT EXISTS (SELECT 1 FROM board_members WHERE board_id = @boardId AND user_id = @userId)
                    INSERT INTO board_members (board_id, user_id) VALUES (@boardId, @userId)`);
        res.status(201).json({ id: insertId, name: name.trim(), department: boardDept, owner_user_id: req.user.id });
        broadcastBoardsUpdate();
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/boards/:id', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    try {
        await assertBoardManagerMssql(req.user, req.params.id, 'Only board owners or admins can rename boards');
        await pool.request().input('name', sql.NVarChar(255), name.trim()).input('id', sql.Int, req.params.id)
            .query('UPDATE boards SET name = @name WHERE id = @id');
        res.json({ success: true, id: Number(req.params.id), name: name.trim() });
        broadcastBoardsUpdate();
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/boards/:id', authMiddleware, async (req, res) => {
    try {
        await assertBoardManagerMssql(req.user, req.params.id, 'Only board owners or admins can delete boards');
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM boards WHERE id = @id');
        res.json({ success: true });
        broadcastBoardsUpdate();
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/boards/:id/bg', authMiddleware, async (req, res) => {
    const { bg_image } = req.body;
    try {
        await assertBoardManagerMssql(req.user, req.params.id, 'Only board owners or admins can change the board background');
        const value = bg_image && typeof bg_image === 'string' ? bg_image.trim() : null;
        await pool.request().input('bg', sql.NVarChar(sql.MAX), value).input('id', sql.Int, req.params.id)
            .query('UPDATE boards SET bg_image = @bg WHERE id = @id');
        res.json({ success: true, bg_image: value });
        broadcastBoardsUpdate();
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// BOARD MEMBERSHIP
// =====================================================================

app.get('/api/boards/:boardId/members', authMiddleware, async (req, res) => {
    const { boardId } = req.params;
    try {
        const result = await pool.request()
            .input('boardId', sql.Int, boardId)
            .query(`SELECT u.id, u.first_name, u.last_name, u.display_name, u.email, u.department, u.[lead], u.is_admin, u.is_master, u.is_overlord, bm.created_at AS added_at
                    FROM board_members bm JOIN users u ON u.id = bm.user_id WHERE bm.board_id = @boardId ORDER BY u.display_name`);
        res.json(result.recordset);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/boards/:boardId/members', authMiddleware, async (req, res) => {
    const { boardId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    try {
        const board = await assertBoardManagerMssql(req.user, boardId, 'Only board owners or admins can manage board members');
        const userResult = await pool.request().input('id', sql.Int, userId)
            .query('SELECT id, display_name, email, department FROM users WHERE id = @id');
        if (userResult.recordset.length === 0) return res.status(404).json({ error: 'User not found' });
        if (board.department && userResult.recordset[0].department !== board.department) {
            return res.status(403).json({ error: 'You can only add users from your department' });
        }
        await pool.request()
            .input('boardId', sql.Int, boardId)
            .input('userId', sql.Int, userId)
            .input('addedBy', sql.Int, req.user.id)
            .query(`IF NOT EXISTS (SELECT 1 FROM board_members WHERE board_id = @boardId AND user_id = @userId)
                    INSERT INTO board_members (board_id, user_id, added_by) VALUES (@boardId, @userId, @addedBy)`);
        res.status(201).json({ success: true, user: userResult.recordset[0] });
        broadcastBoardsUpdate();
        const targetSockets = userSockets.get(parseInt(userId));
        if (targetSockets) { for (const sid of targetSockets) io.to(sid).emit('boards:refresh'); }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/boards/:boardId/members/:userId', authMiddleware, async (req, res) => {
    const { boardId, userId } = req.params;
    try {
        const board = await assertBoardManagerMssql(req.user, boardId, 'Only board owners or admins can manage board members');
        if (Number(userId) === Number(board.owner_user_id)) return res.status(400).json({ error: 'Board owners cannot be removed from their own board' });
        await pool.request().input('boardId', sql.Int, boardId).input('userId', sql.Int, userId)
            .query('DELETE FROM board_members WHERE board_id = @boardId AND user_id = @userId');
        res.json({ success: true });
        broadcastBoardsUpdate();
        const targetSockets = userSockets.get(parseInt(userId));
        if (targetSockets) { for (const sid of targetSockets) io.to(sid).emit('boards:refresh'); }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/boards/:boardId/users', authMiddleware, async (req, res) => {
    const { boardId } = req.params;
    try {
        const result = await pool.request()
            .input('boardId', sql.Int, boardId)
            .query(`SELECT u.id, u.first_name, u.last_name, u.display_name, u.email, u.department, u.[lead], u.is_admin, u.is_master, u.is_overlord
                    FROM board_members bm JOIN users u ON u.id = bm.user_id WHERE bm.board_id = @boardId
                    ORDER BY u.is_overlord DESC, u.is_master DESC, u.is_admin DESC, u.display_name`);
        res.json(result.recordset);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// FILE UPLOADS
// =====================================================================

const cardImageUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            const mimeExts = { 'image/gif': '.gif', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp' };
            const ext = mimeExts[file.mimetype] || path.extname(file.originalname) || '.png';
            cb(null, `card_${Date.now()}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => { cb(null, /image\//.test(file.mimetype)); }
});

app.post('/api/upload', authMiddleware, cardImageUpload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    res.json({ url: `/uploads/${req.file.filename}` });
});

app.post('/api/boards/:id/bg-upload', authMiddleware, multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.jpg';
        cb(null, `bg_${Date.now()}${ext}`);
    }
}), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    cb(null, /image\//.test(file.mimetype));
}}).single('bg'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    const url = `/uploads/${req.file.filename}`;
    try {
        await assertBoardManagerMssql(req.user, req.params.id, 'Only board owners or admins can change the board background');
        await pool.request().input('bg', sql.NVarChar(sql.MAX), url).input('id', sql.Int, req.params.id)
            .query('UPDATE boards SET bg_image = @bg WHERE id = @id');
        res.json({ success: true, url });
        broadcastBoardsUpdate();
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.get('/api/boards/:boardId', authMiddleware, async (req, res) => {
    const { boardId } = req.params;
    try {
        await assertBoardAccessMssql(req.user, boardId);
        const colResult = await pool.request().input('boardId', sql.Int, boardId)
            .query('SELECT * FROM [columns] WHERE board_id = @boardId ORDER BY position ASC');
        const columns = colResult.recordset;
        let cards = [];
        if (columns.length > 0) {
            const columnIds = columns.map(c => c.id);
            const inParams = columnIds.map((id, i) => `@cid${i}`).join(',');
            const req2 = pool.request();
            columnIds.forEach((id, i) => req2.input(`cid${i}`, sql.Int, id));
            const cardResult = await req2.query(`SELECT * FROM cards WHERE column_id IN (${inParams}) AND deleted_at IS NULL ORDER BY position ASC`);
            cards = cardResult.recordset;

            // Fetch reactions for all cards
            if (cards.length > 0) {
                const cardIds = cards.map(c => c.id);
                const rInParams = cardIds.map((id, i) => `@rid${i}`).join(',');
                const rReq = pool.request();
                cardIds.forEach((id, i) => rReq.input(`rid${i}`, sql.Int, id));
                const reactResult = await rReq.query(`SELECT cr.card_id, cr.user_id, cr.emoji, u.display_name FROM card_reactions cr LEFT JOIN users u ON cr.user_id = u.id WHERE cr.card_id IN (${rInParams})`);
                const reactionsMap = {};
                for (const r of reactResult.recordset) {
                    if (!reactionsMap[r.card_id]) reactionsMap[r.card_id] = [];
                    reactionsMap[r.card_id].push({ user_id: r.user_id, emoji: r.emoji, display_name: r.display_name });
                }
                cards = cards.map(c => ({ ...c, reactions: reactionsMap[c.id] || [] }));
            }
        }
        res.json({ columns, cards });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// COLUMNS
// =====================================================================

app.post('/api/columns', authMiddleware, async (req, res) => {
    const { board_id, name, position } = req.body;
    if (!board_id || !name) return res.status(400).json({ error: 'board_id and name required' });
    try {
        await assertBoardManagerMssql(req.user, board_id, 'Only board owners or admins can add columns');
        const result = await pool.request()
            .input('boardId', sql.Int, board_id)
            .input('name', sql.NVarChar(255), name.trim())
            .input('pos', sql.Int, position || 0)
            .query('INSERT INTO [columns] (board_id, name, position) OUTPUT INSERTED.id VALUES (@boardId, @name, @pos)');
        res.status(201).json({ id: result.recordset[0].id, board_id, name: name.trim(), position: position || 0 });
        broadcastBoardUpdate(board_id);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/columns/:id', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
        const colResult = await pool.request().input('id', sql.Int, req.params.id).query('SELECT board_id FROM [columns] WHERE id = @id');
        if (colResult.recordset.length === 0) return res.status(404).json({ error: 'Column not found' });
        await assertBoardManagerMssql(req.user, colResult.recordset[0].board_id, 'Only board owners or admins can update columns');
        await pool.request().input('name', sql.NVarChar(255), name.trim()).input('id', sql.Int, req.params.id)
            .query('UPDATE [columns] SET name = @name WHERE id = @id');
        const result = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM [columns] WHERE id = @id');
        res.json(result.recordset[0] || { success: true, id: req.params.id, name: name.trim() });
        if (result.recordset.length > 0) broadcastBoardUpdate(result.recordset[0].board_id);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Batch reorder columns
app.patch('/api/columns/reorder', authMiddleware, async (req, res) => {
    const { columns } = req.body; // [{ id, position }]
    if (!Array.isArray(columns) || columns.length === 0) return res.status(400).json({ error: 'columns array required' });
    try {
        // Get board_id from first column for broadcast
        const colResult = await pool.request().input('id', sql.Int, columns[0].id).query('SELECT board_id FROM [columns] WHERE id = @id');
        if (colResult.recordset.length === 0) return res.status(404).json({ error: 'Column not found' });
        const boardId = colResult.recordset[0].board_id;
        await assertBoardManagerMssql(req.user, boardId, 'Only board owners or admins can reorder columns');

        // Update each column's position
        await Promise.all(columns.map(({ id, position }) =>
            pool.request()
                .input('id', sql.Int, id)
                .input('pos', sql.Int, position)
                .query('UPDATE [columns] SET position = @pos WHERE id = @id')
        ));
        res.json({ success: true });
        broadcastBoardUpdate(boardId);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/columns/:id', authMiddleware, async (req, res) => {
    try {
        const colResult = await pool.request().input('id', sql.Int, req.params.id).query('SELECT board_id FROM [columns] WHERE id = @id');
        if (colResult.recordset.length === 0) return res.status(404).json({ error: 'Column not found' });
        await assertBoardManagerMssql(req.user, colResult.recordset[0].board_id, 'Only board owners or admins can delete columns');
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM [columns] WHERE id = @id');
        res.json({ success: true });
        broadcastBoardUpdate(colResult.recordset[0].board_id);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// CARDS
// =====================================================================

app.post('/api/cards', authMiddleware, async (req, res) => {
    const { column_id, content, position, created_by, image_url } = req.body;
    if (!column_id || (content === undefined && !image_url)) return res.status(400).json({ error: 'column_id and content or image_url required' });
    try {
        const colResult = await pool.request().input('colId', sql.Int, column_id).query('SELECT board_id FROM [columns] WHERE id = @colId');
        if (colResult.recordset.length === 0) return res.status(404).json({ error: 'Column not found' });
        await assertBoardAccessMssql(req.user, colResult.recordset[0].board_id);
        const result = await pool.request()
            .input('colId', sql.Int, column_id)
            .input('content', sql.NVarChar(sql.MAX), content)
            .input('pos', sql.Int, position || 0)
            .input('createdBy', sql.NVarChar(255), req.user.display_name || created_by || null)
            .input('imageUrl', sql.NVarChar(sql.MAX), image_url || null)
            .query('INSERT INTO cards (column_id, content, position, created_by, image_url) OUTPUT INSERTED.id VALUES (@colId, @content, @pos, @createdBy, @imageUrl)');
        const card = { id: result.recordset[0].id, column_id, content, position: position || 0, created_by: req.user.display_name || created_by || null, image_url: image_url || null, deleted_at: null, reactions: [] };
        res.status(201).json(card);
        if (colResult.recordset.length > 0) broadcastBoardUpdate(colResult.recordset[0].board_id);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.put('/api/cards/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { column_id, position, content } = req.body;
    try {
        const existResult = await pool.request()
            .input('id', sql.Int, id)
            .query('SELECT ca.*, c.board_id FROM cards ca JOIN [columns] c ON ca.column_id = c.id WHERE ca.id = @id');
        if (!existResult.recordset.length) return res.status(404).json({ error: 'Card not found' });
        const existing = existResult.recordset[0];
        const board = await assertBoardAccessMssql(req.user, existing.board_id);
        const canManageBoard = req.user.is_overlord || req.user.is_admin || isBoardOwnerMssql(req.user, board) || (req.user.is_master && sameDepartmentForBoard(req.user, board));

        if (!canManageBoard && existing.created_by !== req.user.display_name) {
            return res.status(403).json({ error: 'You can only edit your own cards' });
        }

        const sets = [];
        const request = pool.request();
        let paramIdx = 0;
        if (content !== undefined) { sets.push(`content = @s${paramIdx}`); request.input(`s${paramIdx}`, sql.NVarChar(sql.MAX), content); paramIdx++; }
        if (column_id !== undefined) { sets.push(`column_id = @s${paramIdx}`); request.input(`s${paramIdx}`, sql.Int, column_id); paramIdx++; }
        if (position !== undefined) { sets.push(`position = @s${paramIdx}`); request.input(`s${paramIdx}`, sql.Int, position); paramIdx++; }
        if (req.body.image_url !== undefined) { sets.push(`image_url = @s${paramIdx}`); request.input(`s${paramIdx}`, sql.NVarChar(sql.MAX), req.body.image_url); paramIdx++; }

        if (sets.length > 0) {
            request.input('id', sql.Int, id);
            await request.query(`UPDATE cards SET ${sets.join(', ')} WHERE id = @id`);
        }

        const updatedResult = await pool.request().input('id', sql.Int, id).query('SELECT * FROM cards WHERE id = @id');
        res.json(updatedResult.recordset[0] || { success: true });

        broadcastBoardUpdate(existing.board_id);
        if (column_id !== undefined && column_id !== existing.column_id) {
            const newColResult = await pool.request().input('colId', sql.Int, column_id).query('SELECT board_id FROM [columns] WHERE id = @colId');
            if (newColResult.recordset.length > 0 && newColResult.recordset[0].board_id !== existing.board_id) {
                broadcastBoardUpdate(newColResult.recordset[0].board_id);
            }
        }
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/cards/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const cardResult = await pool.request().input('id', sql.Int, id).query('SELECT ca.*, c.board_id FROM cards ca JOIN [columns] c ON ca.column_id = c.id WHERE ca.id = @id');
        if (!cardResult.recordset.length) return res.status(404).json({ error: 'Card not found' });
        const card = cardResult.recordset[0];
        const board = await assertBoardAccessMssql(req.user, card.board_id);
        const canManageBoard = req.user.is_overlord || req.user.is_admin || isBoardOwnerMssql(req.user, board) || (req.user.is_master && sameDepartmentForBoard(req.user, board));
        if (!canManageBoard && card.created_by !== req.user.display_name)
            return res.status(403).json({ error: 'You can only delete your own cards' });

        const colResult = await pool.request().input('id', sql.Int, id)
            .query('SELECT c.board_id FROM [columns] c JOIN cards ca ON ca.column_id = c.id WHERE ca.id = @id');
        await pool.request().input('id', sql.Int, id).query('UPDATE cards SET deleted_at = GETDATE() WHERE id = @id');
        res.json({ success: true });
        if (colResult.recordset.length > 0) broadcastBoardUpdate(colResult.recordset[0].board_id);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// Clean up soft-deleted cards older than a week
setInterval(async () => {
    try {
        await pool.request().query('DELETE FROM cards WHERE deleted_at < DATEADD(WEEK, -1, GETDATE())');
    } catch (error) {
        console.error("Cleanup error:", error);
    }
}, 3600000);

// =====================================================================
// CARD REACTIONS
// =====================================================================

app.post('/api/cards/:id/reactions', authMiddleware, async (req, res) => {
    const { emoji } = req.body;
    const cardId = parseInt(req.params.id);
    if (!emoji || typeof emoji !== 'string' || emoji.trim().length === 0 || emoji.trim().length > 20)
        return res.status(400).json({ error: 'Valid emoji is required' });
    try {
        // Check card exists
        const cardResult = await pool.request().input('id', sql.Int, cardId)
            .query('SELECT c.id, c.column_id, col.board_id FROM cards c JOIN [columns] col ON c.column_id = col.id WHERE c.id = @id AND c.deleted_at IS NULL');
        if (cardResult.recordset.length === 0) return res.status(404).json({ error: 'Card not found' });
        const boardId = cardResult.recordset[0].board_id;

        // Toggle: if exists remove, else add
        const existing = await pool.request()
            .input('cardId', sql.Int, cardId)
            .input('userId', sql.Int, req.user.id)
            .input('emoji', sql.NVarChar(20), emoji.trim())
            .query('SELECT id FROM card_reactions WHERE card_id = @cardId AND user_id = @userId AND emoji = @emoji');

        if (existing.recordset.length > 0) {
            await pool.request()
                .input('cardId', sql.Int, cardId)
                .input('userId', sql.Int, req.user.id)
                .input('emoji', sql.NVarChar(20), emoji.trim())
                .query('DELETE FROM card_reactions WHERE card_id = @cardId AND user_id = @userId AND emoji = @emoji');
            res.json({ action: 'removed' });
        } else {
            await pool.request()
                .input('cardId', sql.Int, cardId)
                .input('userId', sql.Int, req.user.id)
                .input('emoji', sql.NVarChar(20), emoji.trim())
                .query('INSERT INTO card_reactions (card_id, user_id, emoji) VALUES (@cardId, @userId, @emoji)');
            res.json({ action: 'added' });
        }
        broadcastBoardUpdate(boardId);
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// GIF LIBRARY
// =====================================================================

app.get('/api/gifs', authMiddleware, async (req, res) => {
    const { search, page = 1, limit = 50, filter } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    const limitNum = parseInt(limit);
    try {
        let where = '';
        const request = pool.request();
        let pIdx = 0;

        if (filter === 'custom') {
            where += ' AND is_default = 0';
        } else if (filter === 'mine') {
            where += ` AND is_default = 0 AND added_by = @filterUser`;
            request.input('filterUser', sql.Int, req.user.id);
        } else if (filter === 'default') {
            where += ' AND is_default = 1';
        }
        if (search && search.trim()) {
            where += ' AND title LIKE @search';
            request.input('search', sql.NVarChar(255), `%${search.trim()}%`);
        }

        // Count query (separate request to avoid input conflicts)
        const countReq = pool.request();
        if (filter === 'mine') countReq.input('filterUser', sql.Int, req.user.id);
        if (search && search.trim()) countReq.input('search', sql.NVarChar(255), `%${search.trim()}%`);
        const countResult = await countReq.query(`SELECT COUNT(*) as total FROM gifs WHERE 1=1${where}`);

        // Data query with OFFSET/FETCH
        request.input('offset', sql.Int, offset);
        request.input('limit', sql.Int, limitNum);
        const dataResult = await request.query(
            `SELECT * FROM gifs WHERE 1=1${where} ORDER BY is_default DESC, created_at DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY`
        );

        res.json({ gifs: dataResult.recordset, total: countResult.recordset[0].total, page: parseInt(page), limit: limitNum });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/gifs', authMiddleware, async (req, res) => {
    const { url, title } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Name is required' });
    const trimmedUrl = url.trim();
    try {
        const parsed = new URL(trimmedUrl);
        if (!/^https?:$/.test(parsed.protocol)) return res.status(400).json({ error: 'URL must be http or https' });
    } catch { return res.status(400).json({ error: 'Invalid URL' }); }
    try {
        const result = await pool.request()
            .input('url', sql.NVarChar(sql.MAX), trimmedUrl)
            .input('preview', sql.NVarChar(sql.MAX), trimmedUrl)
            .input('title', sql.NVarChar(255), (title || '').slice(0, 255))
            .input('addedBy', sql.Int, req.user.id)
            .query('INSERT INTO gifs (url, preview_url, title, added_by, is_default) OUTPUT INSERTED.id VALUES (@url, @preview, @title, @addedBy, 0)');
        res.status(201).json({ id: result.recordset[0].id, url: trimmedUrl, preview_url: trimmedUrl, title: title || '', added_by: req.user.id, is_default: 0 });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.post('/api/gifs/upload', authMiddleware, multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads', 'gifs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.gif';
        cb(null, `gif_${Date.now()}${ext}`);
    }
}), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    cb(null, /image\//.test(file.mimetype));
}}).single('gif'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const gifUrl = `/uploads/gifs/${req.file.filename}`;
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Name is required' });
    try {
        const result = await pool.request()
            .input('url', sql.NVarChar(sql.MAX), gifUrl)
            .input('preview', sql.NVarChar(sql.MAX), gifUrl)
            .input('title', sql.NVarChar(255), title)
            .input('addedBy', sql.Int, req.user.id)
            .query('INSERT INTO gifs (url, preview_url, title, added_by, is_default) OUTPUT INSERTED.id VALUES (@url, @preview, @title, @addedBy, 0)');
        res.status(201).json({ id: result.recordset[0].id, url: gifUrl, preview_url: gifUrl, title, added_by: req.user.id, is_default: 0 });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

app.delete('/api/gifs/:id', authMiddleware, async (req, res) => {
    try {
        const result = await pool.request().input('id', sql.Int, req.params.id).query('SELECT * FROM gifs WHERE id = @id');
        if (result.recordset.length === 0) return res.status(404).json({ error: 'GIF not found' });
        const gif = result.recordset[0];
        if (!req.user.is_admin && !req.user.is_master && !req.user.is_overlord && gif.added_by !== req.user.id)
            return res.status(403).json({ error: 'You can only delete GIFs you added' });
        if (gif.url.startsWith('/uploads/')) {
            const filePath = path.join(__dirname, gif.url);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await pool.request().input('id', sql.Int, req.params.id).query('DELETE FROM gifs WHERE id = @id');
        res.json({ success: true });
    } catch (error) { res.status(500).json({ error: error.message }); }
});

// =====================================================================
// START SERVER
// =====================================================================
(async () => {
    try {
        pool = await sql.connect(mssqlConfig);
        console.log('MS SQL Server connected');
        await initDb();
        server.listen(PORT, '0.0.0.0', () => {
            console.log(`RetroBoard API server running on http://0.0.0.0:${PORT}`);
        });
        if (httpsServer) {
            httpsServer.listen(SSL_PORT, '0.0.0.0', () => {
                console.log(`RetroBoard API server running on https://0.0.0.0:${SSL_PORT} (SSL)`);
            });
        }
    } catch (err) {
        console.error('Failed to connect to MS SQL Server:', err.message);
        process.exit(1);
    }
})();
