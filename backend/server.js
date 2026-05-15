const express = require('express');
const cors = require('cors');
const compression = require('compression');
const http = require('http');
const https = require('https');
const { Server } = require('socket.io');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const mysql = require('mysql2/promise');
const multer = require('multer');
const nodemailer = require('nodemailer');
const path = require('path');
const fs = require('fs');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
require('dotenv').config();
const { DEFAULT_COMPANY, VALID_DEPARTMENTS, LEADS_BY_DEPT, LEAD_DEFAULT_COLUMNS, DEFAULT_ADMIN_EMAILS, DEFAULT_ADMIN_EMAILS_RAW, DEFAULT_MASTER_EMAILS, GIPHY_API_KEY } = require('./config/constants');

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
    tls: { rejectUnauthorized: process.env.SMTP_INSECURE_TLS !== 'true' }
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

async function sendPasswordResetEmail(email, resetUrl) {
        try {
                await emailTransporter.sendMail({
                        from: process.env.SMTP_FROM || '"Vault Jump Retro" <no-reply@thejumpvault.com>',
                        to: email,
                        subject: 'Reset your RetroBoard password',
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
                <h1 style="margin:0 0 12px;color:#001489;font-size:24px;">Password reset requested</h1>
                <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 20px;">A password reset was requested for your account.</p>
                <p style="color:#444;font-size:15px;line-height:1.6;margin:0 0 24px;">Use the link below to set a new password:</p>
                <p style="margin:0 0 28px;"><a href="${resetUrl}" style="display:inline-block;background:#001489;color:#fff;text-decoration:none;padding:12px 18px;border-radius:8px;font-weight:600;">Reset Password</a></p>
                <p style="color:#888;font-size:13px;margin:0;">If you did not request this, you can ignore this email.</p>
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
                console.log(`Password reset email sent to ${email}`);
        } catch (err) {
                console.error('Failed to send password reset email:', err.message);
                throw err; // propagate so the caller can report the failure
        }
}

// --- Admin email allowlist ---
let ADMIN_EMAILS = [...DEFAULT_ADMIN_EMAILS];

// Reload admin emails from DB (source of truth)
const reloadAdminEmails = async () => {
    try {
        const [rows] = await pool.query('SELECT email FROM admin_emails');
        ADMIN_EMAILS = rows.map(r => r.email.toLowerCase());
    } catch (e) {
        // Table may not exist yet on first run
    }
};

// --- Master email allowlist ---
let MASTER_EMAILS = [...DEFAULT_MASTER_EMAILS];

// Reload master emails from DB (source of truth)
const reloadMasterEmails = async () => {
    try {
        const [rows] = await pool.query('SELECT email FROM master_emails');
        MASTER_EMAILS = rows.map(r => r.email.toLowerCase());
    } catch (e) {
        // Table may not exist yet on first run
    }
};

// Masters can see all boards and manage users; dept/lead not required for them

// --- Auth Helpers ---
if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set. Exiting.');
    process.exit(1);
}
if (process.env.JWT_SECRET.length < 32) {
    console.error('FATAL: JWT_SECRET must be at least 32 characters. Exiting.');
    process.exit(1);
}
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '7d';
const RESET_TOKEN_EXPIRY_MINUTES = parseInt(process.env.RESET_TOKEN_EXPIRY_MINUTES || '30', 10);

function createRandomToken(size = 32) {
    return crypto.randomBytes(size).toString('hex');
}

const INVITE_LINK_TIMEZONE = 'America/Los_Angeles';

function getPacificDateParts(dateInput = new Date()) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: INVITE_LINK_TIMEZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
    }).formatToParts(new Date(dateInput));

    const year = Number(parts.find(p => p.type === 'year')?.value);
    const month = Number(parts.find(p => p.type === 'month')?.value);
    const day = Number(parts.find(p => p.type === 'day')?.value);
    return { year, month, day };
}

function getPacificDayKey(dateInput = new Date()) {
    const { year, month, day } = getPacificDateParts(dateInput);
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function getTimeZoneOffsetMinutes(dateInput, timeZone) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'shortOffset',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).formatToParts(new Date(dateInput));

    const offsetToken = parts.find(p => p.type === 'timeZoneName')?.value || 'GMT+0';
    const match = offsetToken.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i);
    if (!match) return 0;

    const sign = match[1] === '-' ? -1 : 1;
    const hours = Number(match[2] || 0);
    const minutes = Number(match[3] || 0);
    return sign * ((hours * 60) + minutes);
}

function getNextPacificMidnightUtc(dateInput = new Date()) {
    const { year, month, day } = getPacificDateParts(dateInput);
    const utcGuess = new Date(Date.UTC(year, month - 1, day + 1, 0, 0, 0));
    const offsetMinutes = getTimeZoneOffsetMinutes(utcGuess, INVITE_LINK_TIMEZONE);
    return new Date(utcGuess.getTime() - (offsetMinutes * 60000));
}

async function getOrCreateDailyBoardInviteLink(boardId, inviterUserId) {
    const [rows] = await pool.query(
        `SELECT id, token, created_at, expires_at
         FROM board_invites
         WHERE board_id = ?
           AND status = 'PENDING'
           AND invitee_user_id IS NULL
           AND invitee_email IS NULL
         ORDER BY created_at DESC
         LIMIT 25`,
        [boardId]
    );

    const now = new Date();
    const todayPacificKey = getPacificDayKey(now);

    for (const row of rows) {
        if (getPacificDayKey(row.created_at) !== todayPacificKey) continue;
        if (row.expires_at && new Date(row.expires_at) <= now) continue;
        return {
            token: row.token,
            expiresAt: row.expires_at || getNextPacificMidnightUtc(now),
        };
    }

    const token = createRandomToken(24);
    const expiresAt = getNextPacificMidnightUtc(now);
    await pool.query(
        `INSERT INTO board_invites (board_id, inviter_user_id, invitee_user_id, invitee_email, token, expires_at)
         VALUES (?, ?, NULL, NULL, ?, ?)`,
        [boardId, inviterUserId, token, expiresAt]
    );

    return { token, expiresAt };
}

function buildUserToken(user) {
    return jwt.sign({
        sub: user.id,
        username: user.username,
        first_name: user.first_name || '',
        last_name: user.last_name || '',
        display_name: user.display_name,
        email: user.email,
        company: user.company || '',
        department: user.department,
        lead: user.lead || null,
        is_admin: user.is_admin === 1 || user.is_admin === true,
        is_master: user.is_master === 1 || user.is_master === true,
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
        company: user.company || '',
        department: user.department,
        lead: user.lead || null,
        is_admin: user.is_admin === 1 || user.is_admin === true,
        is_master: user.is_master === 1 || user.is_master === true
    };
}
function verifyJwt(token) {
    try {
        return jwt.verify(token, JWT_SECRET);
    } catch { return null; }
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
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const payload = verifyJwt(authHeader.slice(7));
    if (!payload) return res.status(401).json({ error: 'Invalid or expired token' });
    req.user = payload;
    // Normalize: JWT stores user id as 'sub', but many endpoints reference 'id'
    if (req.user.sub !== undefined && req.user.id === undefined) {
        req.user.id = req.user.sub;
    }
    next();
}

const PORT = process.env.PORT || 5000;

// --- MySQL Connection Pool (promise-based) ---
const DB_NAME = process.env.DB_NAME || 'retro_board';

async function createPool() {
    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const bootstrapConn = await mysql.createConnection({
        host: dbHost,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
    });
    await bootstrapConn.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\``);
    await bootstrapConn.end();

    return mysql.createPool({
        host: dbHost,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        idleTimeout: 60000
    });
}

let pool;

// --- CORS Origins ---
const NODE_ENV = process.env.NODE_ENV || 'development';
const REQUIRED_PUBLIC_ORIGINS = [
        'https://retroboard.thejumpvault.com',
        'https://thejumpvault.com',
        'https://www.thejumpvault.com',
];

const CORS_ORIGINS = Array.from(new Set([
        ...(process.env.CORS_ORIGINS
                ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()).filter(Boolean)
                : NODE_ENV === 'production'
                    ? (() => { console.error('FATAL: CORS_ORIGINS must be set in production. Exiting.'); process.exit(1); })()
                    : [
                            'http://localhost:5173', 'http://localhost:5000', 'https://localhost:5443',
                            'http://192.168.1.48', 'http://192.168.1.48:5000', 'https://192.168.1.48:5443',
                        ]),
        ...REQUIRED_PUBLIC_ORIGINS,
]));

const corsOptions = { origin: CORS_ORIGINS, methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] };

// --- Express + Socket.io Setup ---
const app = express();
const server = http.createServer(app);

// Tune HTTP keep-alive to reduce connection overhead
server.keepAliveTimeout = 65000;  // slightly above typical proxy/LB timeout (60s)
server.headersTimeout = 66000;    // must be greater than keepAliveTimeout

// HTTPS server (if certs exist)
let httpsServer = null;
if (sslAvailable) {
    const sslOptions = {
        key: fs.readFileSync(SSL_KEY_PATH),
        cert: fs.readFileSync(SSL_CERT_PATH)
    };
    httpsServer = https.createServer(sslOptions, app);
}

// Socket.io attaches to HTTP; also attach HTTPS if available
const io = new Server(server, { cors: corsOptions });
if (httpsServer) {
    io.attach(httpsServer, { cors: corsOptions });
}

app.use(cors(corsOptions));
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:', 'blob:', 'https://*.giphy.com', 'https://media*.giphy.com'],
            connectSrc: ["'self'", ...CORS_ORIGINS, 'wss:', 'ws:'],
            fontSrc: ["'self'", 'data:'],
            objectSrc: ["'none'"],
            frameSrc: ["'none'"],
            baseUri: ["'self'"],
            formAction: ["'self'"],
        },
    },
    crossOriginEmbedderPolicy: false,   // allow cross-origin images (Giphy)
    crossOriginResourcePolicy: { policy: 'cross-origin' }, // serve uploads to Electron/other origins
}));
app.use(compression());
app.use(express.json());

// --- Rate Limiters ---
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 15,                  // 15 attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many attempts, please try again later' },
});

const registerLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10,                  // 10 registrations per hour per IP
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many accounts created, please try again later' },
});

const passwordLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many password change attempts, please try again later' },
});

const adminMgmtLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 30,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
});
app.use('/uploads', express.static(path.join(__dirname, 'uploads'), {
    maxAge: '7d',
    etag: true,
    lastModified: true,
    immutable: true
}));

const FRONTEND_DIST_PATH = path.join(__dirname, '..', 'frontend', 'dist');

// Create tables if they don't exist
// --- Async GIF seeder (runs in background, does not block startup) ---
async function seedDefaultGifs() {
    const [gifCount] = await pool.query('SELECT COUNT(*) as cnt FROM gifs WHERE is_default = 1');
    if (gifCount[0].cnt > 0) return;
    console.log('Seeding default GIF library from Giphy (background)...');
    const giphyApiKey = GIPHY_API_KEY;
    if (!giphyApiKey) { console.warn('GIPHY_API_KEY not set, skipping GIF seed'); return; }
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
                    await pool.query('INSERT INTO gifs (url, preview_url, title, is_default) VALUES (?, ?, ?, 1)', [original, preview, title]);
                }
            }
        } catch (fetchErr) {
            console.warn(`Failed to fetch GIFs for "${q}":`, fetchErr.message);
        }
    }
    console.log(`Seeded ${seededUrls.size} default GIFs`);
}

const initDb = async () => {
    try {
        const defaultCompanySql = DEFAULT_COMPANY.replace(/'/g, "''");
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                first_name VARCHAR(100) NOT NULL DEFAULT '',
                last_name VARCHAR(100) NOT NULL DEFAULT '',
                display_name VARCHAR(150) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                company VARCHAR(150) NOT NULL DEFAULT '${defaultCompanySql}',
                department ENUM('OWS', 'Apex') NOT NULL DEFAULT 'OWS',
                \`lead\` VARCHAR(150) DEFAULT NULL,
                is_admin TINYINT(1) NOT NULL DEFAULT 0,
                is_master TINYINT(1) NOT NULL DEFAULT 0,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Migrations for existing users table
        const userMigrations = [
            `ALTER TABLE users ADD COLUMN email VARCHAR(255) NOT NULL DEFAULT '' AFTER display_name`,
            `ALTER TABLE users ADD COLUMN company VARCHAR(150) NOT NULL DEFAULT '${defaultCompanySql}' AFTER email`,
            `ALTER TABLE users ADD COLUMN department ENUM('OWS','Apex') NOT NULL DEFAULT 'OWS' AFTER email`,
            `ALTER TABLE users ADD COLUMN \`lead\` VARCHAR(150) DEFAULT NULL AFTER department`,
            `ALTER TABLE users ADD COLUMN is_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER \`lead\``,
            `ALTER TABLE users ADD COLUMN is_master TINYINT(1) NOT NULL DEFAULT 0 AFTER is_admin`,
            `ALTER TABLE users ADD COLUMN first_name VARCHAR(100) NOT NULL DEFAULT '' AFTER username`,
            `ALTER TABLE users ADD COLUMN last_name VARCHAR(100) NOT NULL DEFAULT '' AFTER first_name`,
        ];
        for (const sql of userMigrations) {
            try { await pool.query(sql); } catch (e) { /* column already exists */ }
        }

        // Expand department ENUM to include QA and SE
        try { await pool.query(`ALTER TABLE users MODIFY COLUMN department ENUM('OWS','Apex','QA','SE','SDET') NOT NULL DEFAULT 'QA'`); } catch (e) { /* ignore */ }
        // Migrate existing OWS/Apex users to QA
        try { await pool.query(`UPDATE users SET department = 'QA' WHERE department IN ('OWS','Apex')`); } catch (e) { /* ignore */ }
        // Add role_key for custom role label assignments
        try { await pool.query(`ALTER TABLE users ADD COLUMN role_key VARCHAR(50) DEFAULT NULL AFTER is_master`); } catch (e) { /* column already exists */ }

        // company lookup table used by registration dropdown
        await pool.query(`
            CREATE TABLE IF NOT EXISTS companies (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(150) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        await pool.query('INSERT IGNORE INTO companies (name) VALUES (?)', [DEFAULT_COMPANY]);
        await pool.query(`INSERT IGNORE INTO companies (name) SELECT DISTINCT company FROM users WHERE company IS NOT NULL AND company <> ''`);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS boards (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                company VARCHAR(150) NOT NULL DEFAULT '${defaultCompanySql}',
                department ENUM('OWS', 'Apex') NOT NULL DEFAULT 'OWS',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        try { await pool.query(`ALTER TABLE boards ADD COLUMN company VARCHAR(150) NOT NULL DEFAULT '${defaultCompanySql}' AFTER name`); } catch (e) { /* column already exists */ }
        // Migration for existing boards table
        try {
            await pool.query(`ALTER TABLE boards ADD COLUMN department ENUM('OWS','Apex') NOT NULL DEFAULT 'OWS' AFTER name`);
        } catch (e) { /* column already exists */ }
        // Expand boards department ENUM
        try { await pool.query(`ALTER TABLE boards MODIFY COLUMN department ENUM('OWS','Apex','QA','SE','SDET') NOT NULL DEFAULT 'QA'`); } catch (e) { /* ignore */ }
        // Migrate existing OWS/Apex boards to QA
        try { await pool.query(`UPDATE boards SET department = 'QA' WHERE department IN ('OWS','Apex')`); } catch (e) { /* ignore */ }
        // Expand admin_emails department ENUM
        try { await pool.query(`ALTER TABLE admin_emails MODIFY COLUMN department ENUM('OWS','Apex','QA','SE','SDET') DEFAULT NULL`); } catch (e) { /* ignore */ }
        try {
            await pool.query(`ALTER TABLE boards ADD COLUMN bg_image TEXT DEFAULT NULL`);
        } catch (e) { /* column already exists */ }

        await pool.query(`
            CREATE TABLE IF NOT EXISTS \`columns\` (
                id INT AUTO_INCREMENT PRIMARY KEY,
                board_id INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                position INT NOT NULL,
                FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
            )
        `);
        await pool.query(`
            CREATE TABLE IF NOT EXISTS cards (
                id INT AUTO_INCREMENT PRIMARY KEY,
                column_id INT NOT NULL,
                content TEXT NOT NULL,
                position INT NOT NULL,
                created_by VARCHAR(255) DEFAULT NULL,
                created_by_user_id INT DEFAULT NULL,
                deleted_at TIMESTAMP NULL DEFAULT NULL,
                FOREIGN KEY (column_id) REFERENCES \`columns\`(id) ON DELETE CASCADE,
                FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS card_reactions (
                id INT AUTO_INCREMENT PRIMARY KEY,
                card_id INT NOT NULL,
                user_id INT NOT NULL,
                emoji VARCHAR(20) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_card_user_emoji (card_id, user_id, emoji),
                FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Add created_by column if it doesn't exist (migration for existing tables)
        try {
            await pool.query(`ALTER TABLE cards ADD COLUMN created_by VARCHAR(255) DEFAULT NULL`);
        } catch (e) {
            // Column already exists, ignore
        }

        // Add created_by_user_id column (immutable user ID for ownership checks)
        try {
            await pool.query(`ALTER TABLE cards ADD COLUMN created_by_user_id INT DEFAULT NULL`);
            await pool.query(`ALTER TABLE cards ADD CONSTRAINT fk_cards_created_by_user FOREIGN KEY (created_by_user_id) REFERENCES users(id) ON DELETE SET NULL`);
        } catch (e) {
            // Column/constraint already exists, ignore
        }

        // Backfill created_by_user_id from created_by (display_name) for existing cards
        try {
            await pool.query(`UPDATE cards c JOIN users u ON c.created_by = u.display_name SET c.created_by_user_id = u.id WHERE c.created_by_user_id IS NULL AND c.created_by IS NOT NULL`);
        } catch (e) { /* ignore */ }

        // Add image_url column if it doesn't exist
        try {
            await pool.query(`ALTER TABLE cards ADD COLUMN image_url TEXT DEFAULT NULL`);
        } catch (e) {
            // Column already exists, ignore
        }

        // role_labels table — stores custom display names for each role tier, scoped by company
        await pool.query(`
            CREATE TABLE IF NOT EXISTS role_labels (
                id INT AUTO_INCREMENT PRIMARY KEY,
                company VARCHAR(150) NOT NULL DEFAULT '${defaultCompanySql}',
                role_key VARCHAR(50) NOT NULL,
                label VARCHAR(100) NOT NULL,
                UNIQUE KEY uniq_role_labels_company_role (company, role_key)
            )
        `);
        try { await pool.query(`ALTER TABLE role_labels ADD COLUMN company VARCHAR(150) NOT NULL DEFAULT '${defaultCompanySql}' AFTER id`); } catch (e) { /* column already exists */ }
        try { await pool.query("UPDATE role_labels SET company = ? WHERE company IS NULL OR company = ''", [DEFAULT_COMPANY]); } catch (e) { /* ignore */ }
        try { await pool.query(`ALTER TABLE role_labels DROP INDEX role_key`); } catch (e) { /* old unique index may not exist */ }
        try { await pool.query(`ALTER TABLE role_labels ADD UNIQUE KEY uniq_role_labels_company_role (company, role_key)`); } catch (e) { /* unique key may already exist */ }

        // Seed defaults per company (INSERT IGNORE keeps existing customisations)
        const [companyRows] = await pool.query('SELECT name FROM companies ORDER BY name');
        const roleLabelCompanies = companyRows.length > 0 ? companyRows.map(r => r.name) : [DEFAULT_COMPANY];
        for (const companyName of roleLabelCompanies) {
            await pool.query(
                `INSERT IGNORE INTO role_labels (company, role_key, label)
                 VALUES (?, 'master', 'Iron Fist'), (?, 'admin', 'Admin'), (?, 'user', 'Member')`,
                [companyName, companyName, companyName]
            );
        }

        // admin_emails table — stores dynamically added admin emails
        await pool.query(`
            CREATE TABLE IF NOT EXISTS admin_emails (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                department ENUM('QA','SE') DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Load admin emails from DB
        // Seed defaults into DB in a single batch (INSERT IGNORE preserves existing entries)
        if (DEFAULT_ADMIN_EMAILS.length > 0) {
            const adminValues = DEFAULT_ADMIN_EMAILS_RAW.map(e => {
                const email = Array.isArray(e) ? e[0] : e;
                const dept = Array.isArray(e) ? e[1] : null;
                return [email.toLowerCase(), dept];
            });
            await pool.query(
                'INSERT IGNORE INTO admin_emails (email, department) VALUES ' + adminValues.map(() => '(?, ?)').join(', '),
                adminValues.flat()
            );
        }
        await reloadAdminEmails();

        // master_emails table — stores dynamically added master emails
        await pool.query(`
            CREATE TABLE IF NOT EXISTS master_emails (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        // Load master emails from DB
        // Seed defaults into DB in a single batch (INSERT IGNORE preserves existing entries)
        if (DEFAULT_MASTER_EMAILS.length > 0) {
            await pool.query(
                'INSERT IGNORE INTO master_emails (email) VALUES ' + DEFAULT_MASTER_EMAILS.map(() => '(?)').join(', '),
                DEFAULT_MASTER_EMAILS
            );
        }
        await reloadMasterEmails();

        // Seed default lead boards (idempotent — only creates if name doesn't exist)
        const allLeads = [
            { name: 'Nathan Robertson', department: 'QA' },
            { name: 'Gabe Duncan',       department: 'QA' },
            { name: 'Brett Rogers',      department: 'QA' },
            { name: 'John Ezetta',       department: 'QA' },
            { name: 'Sean Montgomery',   department: 'SE' },
            { name: 'Griffin Foster',    department: 'SDET' },
            { name: 'Dave Smith',        department: 'SE' },
        ];
        for (const lead of allLeads) {
            const boardName = `Retro - ${lead.name}`;
            const [existing] = await pool.query('SELECT id FROM boards WHERE name = ?', [boardName]);
            let boardId;
            if (existing.length === 0) {
                const [br] = await pool.query('INSERT INTO boards (name, department) VALUES (?, ?)', [boardName, lead.department]);
                boardId = br.insertId;
                console.log(`Seeded board: ${boardName}`);
            } else {
                boardId = existing[0].id;
            }
            // Repair: seed any missing columns for boards that already exist but have none
            const [existingCols] = await pool.query('SELECT id FROM `columns` WHERE board_id = ?', [boardId]);
            if (existingCols.length === 0) {
                for (let i = 0; i < LEAD_DEFAULT_COLUMNS.length; i++) {
                    await pool.query('INSERT INTO `columns` (board_id, name, position) VALUES (?, ?, ?)', [boardId, LEAD_DEFAULT_COLUMNS[i], i]);
                }
                console.log(`Restored default columns for board: ${boardName}`);
            }
        }

        // Pre-create placeholder user accounts for all leads so they appear in /api/leads before registering
        for (const lead of allLeads) {
            const [nameParts] = [lead.name.split(' ')];
            const firstName = nameParts[0];
            const lastName = nameParts.slice(1).join(' ');
            // Find the admin email for this lead
            const [adminRow] = await pool.query('SELECT email FROM admin_emails WHERE department = ?', [lead.department]);
            const matchingEmail = adminRow.find(r => {
                const emailPrefix = r.email.split('@')[0].toLowerCase();
                return emailPrefix === `${firstName[0].toLowerCase()}${lastName.toLowerCase().replace(/\s/g, '')}` ||
                       emailPrefix === `${firstName.toLowerCase()}${lastName.toLowerCase().replace(/\s/g, '')}` ||
                       emailPrefix === `${firstName.toLowerCase()}.${lastName.toLowerCase().replace(/\s/g, '')}` ||
                       emailPrefix === firstName[0].toLowerCase();
            });
            if (matchingEmail) {
                const [existingUser] = await pool.query('SELECT id FROM users WHERE email = ?', [matchingEmail.email]);
                if (existingUser.length === 0) {
                    const username = matchingEmail.email.split('@')[0];
                    await pool.query(
                        'INSERT IGNORE INTO users (username, first_name, last_name, display_name, email, department, is_admin, is_master, password_hash) VALUES (?, ?, ?, ?, ?, ?, 1, 0, NULL)',
                        [username, firstName, lastName, lead.name, matchingEmail.email, lead.department]
                    );
                    console.log(`Pre-created placeholder admin account for ${lead.name} (${matchingEmail.email})`);
                }
            }
        }

        // board_members table — tracks per-board user membership
        await pool.query(`
            CREATE TABLE IF NOT EXISTS board_members (
                id INT AUTO_INCREMENT PRIMARY KEY,
                board_id INT NOT NULL,
                user_id INT NOT NULL,
                added_by INT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY unique_board_user (board_id, user_id),
                FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS board_invites (
                id INT AUTO_INCREMENT PRIMARY KEY,
                board_id INT NOT NULL,
                inviter_user_id INT NOT NULL,
                invitee_user_id INT DEFAULT NULL,
                invitee_email VARCHAR(255) DEFAULT NULL,
                token VARCHAR(128) NOT NULL UNIQUE,
                status ENUM('PENDING','ACCEPTED','DECLINED','CANCELED','EXPIRED') NOT NULL DEFAULT 'PENDING',
                expires_at DATETIME DEFAULT NULL,
                accepted_by_user_id INT DEFAULT NULL,
                decided_at DATETIME DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE,
                FOREIGN KEY (inviter_user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (invitee_user_id) REFERENCES users(id) ON DELETE SET NULL,
                FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS password_reset_tokens (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                token_hash VARCHAR(128) NOT NULL UNIQUE,
                expires_at DATETIME NOT NULL,
                used_at DATETIME DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        // Auto-seed: ensure all admins are members of their own lead board (Retro - {first} {last})
        const [allAdmins] = await pool.query('SELECT id, first_name, last_name, email, department, is_master FROM users WHERE is_admin = 1 AND is_master = 0 AND password_hash IS NOT NULL');
        for (const admin of allAdmins) {
            const adminBoardName = `Retro - ${admin.first_name} ${admin.last_name}`;
            const [adminBoard] = await pool.query('SELECT id FROM boards WHERE name = ?', [adminBoardName]);
            if (adminBoard.length > 0) {
                await pool.query('INSERT IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)', [adminBoard[0].id, admin.id]);
            }
        }

        // Auto-seed: ensure all regular users are members of their lead's board
        const [allUsers] = await pool.query('SELECT id, `lead`, department FROM users WHERE is_admin = 0 AND is_master = 0 AND password_hash IS NOT NULL AND `lead` IS NOT NULL');
        for (const u of allUsers) {
            const leadBoardName = `Retro - ${u.lead}`;
            const [leadBoard] = await pool.query('SELECT id FROM boards WHERE name = ?', [leadBoardName]);
            if (leadBoard.length > 0) {
                await pool.query('INSERT IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)', [leadBoard[0].id, u.id]);
            }
        }

        console.log("Database initialized with Multi-board capability");

        // --- GIF Library table ---
        await pool.query(`
            CREATE TABLE IF NOT EXISTS gifs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                url TEXT NOT NULL,
                preview_url TEXT DEFAULT NULL,
                title VARCHAR(255) DEFAULT '',
                added_by INT DEFAULT NULL,
                is_default TINYINT(1) DEFAULT 0,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);

        // --- Performance indexes ---
        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_cards_column_deleted ON cards (column_id, deleted_at)',
            'CREATE INDEX IF NOT EXISTS idx_columns_board ON `columns` (board_id, position)',
            'CREATE INDEX IF NOT EXISTS idx_boards_department ON boards (department)',
            'CREATE INDEX IF NOT EXISTS idx_boards_name ON boards (name)',
            'CREATE INDEX IF NOT EXISTS idx_gifs_default ON gifs (is_default)',
            'CREATE INDEX IF NOT EXISTS idx_card_reactions_card ON card_reactions (card_id)',
            // Frequently queried lookup columns
            'CREATE INDEX IF NOT EXISTS idx_users_email ON users (email)',
            'CREATE INDEX IF NOT EXISTS idx_users_company ON users (company)',
            'CREATE INDEX IF NOT EXISTS idx_board_invites_token ON board_invites (token)',
            'CREATE INDEX IF NOT EXISTS idx_password_reset_tokens_hash ON password_reset_tokens (token_hash)',
        ];
        for (const idx of indexes) {
            try { await pool.query(idx); } catch (e) { /* index may already exist */ }
        }

        // Seed default GIFs in the background (non-blocking) so server starts fast
        seedDefaultGifs().catch(err => console.warn('GIF seed failed (non-fatal):', err.message));
    } catch (error) {
        console.error("Error initializing database:", error);
    }
};

const withCardReactions = async (cards) => {
    if (!cards || cards.length === 0) return cards || [];

    const cardIds = cards.map(c => c.id);
    const [rows] = await pool.query(
        `SELECT cr.card_id, cr.user_id, cr.emoji, u.display_name
         FROM card_reactions cr
         LEFT JOIN users u ON cr.user_id = u.id
         WHERE cr.card_id IN (?)
         ORDER BY cr.id ASC`,
        [cardIds]
    );

    const byCard = new Map();
    for (const row of rows) {
        if (!byCard.has(row.card_id)) byCard.set(row.card_id, []);
        byCard.get(row.card_id).push({
            user_id: row.user_id,
            emoji: row.emoji,
            display_name: row.display_name,
        });
    }

    return cards.map(card => ({
        ...card,
        reactions: byCard.get(card.id) || [],
    }));
};

// Helper: broadcast updated board data to all connected clients
const broadcastBoardUpdate = async (boardId) => {
    try {
        const [columns] = await pool.query('SELECT * FROM `columns` WHERE board_id = ? ORDER BY position ASC', [boardId]);
        let cards = [];
        if (columns.length > 0) {
            const columnIds = columns.map(c => c.id);
            const [fetchedCards] = await pool.query(
                'SELECT * FROM cards WHERE column_id IN (?) AND deleted_at IS NULL ORDER BY position ASC',
                [columnIds]
            );
            cards = await withCardReactions(fetchedCards);
        }
        io.to(`board:${boardId}`).emit('board:update', { boardId: parseInt(boardId), columns, cards });
    } catch (error) {
        console.error('Error broadcasting board update:', error);
    }
};

const broadcastBoardsUpdate = async () => {
    try {
        // Emit the full list — each client filters to their own allowed boards on receipt
        const [boards] = await pool.query('SELECT id, name, company, department, bg_image, created_at FROM boards ORDER BY created_at DESC');
        io.emit('boards:update', { boards });
    } catch (error) {
        console.error('Error broadcasting boards update:', error);
    }
};

const getAppBaseUrl = () => {
    if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL;
    const firstOrigin = (CORS_ORIGINS && CORS_ORIGINS.length > 0) ? CORS_ORIGINS[0] : `http://localhost:${PORT}`;
    return firstOrigin.replace(/\/$/, '');
};

const getRequestBaseUrl = (req) => {
    if (process.env.APP_BASE_URL) return process.env.APP_BASE_URL.replace(/\/$/, '');

    const forwardedProtoRaw = String(req.headers['x-forwarded-proto'] || '').split(',')[0].trim();
    const forwardedHostRaw = String(req.headers['x-forwarded-host'] || '').split(',')[0].trim();
    const hostRaw = String(req.headers.host || '').split(',')[0].trim();

    const protocol = forwardedProtoRaw || req.protocol || 'http';
    const host = forwardedHostRaw || hostRaw;
    if (!host) return getAppBaseUrl();
    return `${protocol}://${host}`.replace(/\/$/, '');
};

// --- Board Authorization Helpers ---
// Throws an error with .status if the user is not a member of the board.
async function assertBoardAccess(userId, boardId, isMaster) {
    if (isMaster) return; // Masters can access any board
    const [rows] = await pool.query(
        'SELECT id FROM board_members WHERE board_id = ? AND user_id = ?',
        [boardId, userId]
    );
    if (rows.length === 0) {
        const err = new Error('Access denied');
        err.status = 403;
        throw err;
    }
}

// Throws if the user is not an admin/master, or not a member of the board.
async function assertBoardAdmin(userId, boardId, isAdmin, isMaster) {
    if (!isAdmin && !isMaster) {
        const err = new Error('Only admins can perform this action');
        err.status = 403;
        throw err;
    }
    await assertBoardAccess(userId, boardId, isMaster);
}

// Track connected sockets by userId for targeted events
const userSockets = new Map(); // userId -> Set<socketId>

io.on('connection', (socket) => {
    console.log(`Client connected: ${socket.id}`);

    // Register user socket mapping when client identifies itself
    socket.on('register:user', (userId) => {
        try {
            if (!userId) return;
            socket.userId = userId;
            if (!userSockets.has(userId)) userSockets.set(userId, new Set());
            userSockets.get(userId).add(socket.id);
        } catch (err) {
            console.error('socket register:user error:', err.message);
        }
    });

    // Room-based subscriptions: clients join only the board they are viewing
    socket.on('join:board', (boardId) => {
        try {
            socket.join(`board:${boardId}`);
        } catch (err) {
            console.error('socket join:board error:', err.message);
        }
    });
    socket.on('leave:board', (boardId) => {
        try {
            socket.leave(`board:${boardId}`);
        } catch (err) {
            console.error('socket leave:board error:', err.message);
        }
    });

    socket.on('disconnect', () => {
        try {
            console.log(`Client disconnected: ${socket.id}`);
            if (socket.userId && userSockets.has(socket.userId)) {
                userSockets.get(socket.userId).delete(socket.id);
                if (userSockets.get(socket.userId).size === 0) userSockets.delete(socket.userId);
            }
        } catch (err) {
            console.error('socket disconnect error:', err.message);
        }
    });
});

// --- Helper: Create default board for a new admin ---
async function createDefaultAdminBoard(firstName, lastName, company, department, userId) {
    const boardName = `Retro - ${firstName} ${lastName}`;
    try {
        const [result] = await pool.query('INSERT INTO boards (name, company, department) VALUES (?, ?, ?)', [boardName, company || DEFAULT_COMPANY, department]);
        const boardId = result.insertId;
        const templateColumns = [
            ['Ice Breaker', 0],
            ['Needs Improvements', 1],
            ['Went Well', 2],
            ['Action Items', 3],
        ];
        for (const [colName, pos] of templateColumns) {
            await pool.query('INSERT INTO `columns` (board_id, name, position) VALUES (?, ?, ?)', [boardId, colName, pos]);
        }
        // Auto-add the admin as a member of their own board
        if (userId) {
            await pool.query('INSERT IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)', [boardId, userId]);
        }
        console.log(`Created default board "${boardName}" (id=${boardId}) for new admin in ${department}`);
        broadcastBoardsUpdate();
    } catch (error) {
        console.error('Error creating default admin board:', error);
    }
}

// --- Auth Routes ---

app.post('/api/auth/register', registerLimiter, async (req, res) => {
    const { firstName, lastName, email, password, company, department, lead, role, inviteToken } = req.body;
    const emailLower = (email || '').toLowerCase();
    const isMasterEmail = MASTER_EMAILS.includes(emailLower);

    // Check if the caller is an authenticated master (for role override)
    let callerIsMaster = false;
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
        try {
            const payload = jwt.verify(authHeader.slice(7), JWT_SECRET);
            callerIsMaster = !!payload.is_master;
        } catch (e) { /* not authenticated or invalid — treat as self-registration */ }
    }

    if (!email) {
        return res.status(400).json({ error: 'Email is required' });
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'A valid email address is required' });
    }

    // Master-initiated add: email + role, optionally with firstName/lastName (for admins)
    const isMasterAdd = callerIsMaster && !password;

    if (!isMasterAdd) {
        if (!firstName || !lastName || !password) {
            return res.status(400).json({ error: 'First name, last name, and password are required' });
        }
        if (typeof firstName !== 'string' || firstName.trim().length < 1 || firstName.trim().length > 50) {
            return res.status(400).json({ error: 'First name must be 1-50 characters' });
        }
        if (typeof lastName !== 'string' || lastName.trim().length < 1 || lastName.trim().length > 50) {
            return res.status(400).json({ error: 'Last name must be 1-50 characters' });
        }
        if (typeof password !== 'string' || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
    } else if (firstName) {
        // Master adding an admin with name provided
        if (typeof firstName !== 'string' || firstName.trim().length < 1 || firstName.trim().length > 50) {
            return res.status(400).json({ error: 'First name must be 1-50 characters' });
        }
        if (!lastName || typeof lastName !== 'string' || lastName.trim().length < 1 || lastName.trim().length > 50) {
            return res.status(400).json({ error: 'Last name must be 1-50 characters' });
        }
    }

    // Masters do not need a department or lead
    // Also skip when an authenticated master is creating a master-role user or an admin
    const skipDeptLead = isMasterEmail || (callerIsMaster && (role === 'master' || role === 'admin'));
    const skipLead = skipDeptLead;
    if (!isMasterAdd && (!company || !String(company).trim())) {
        return res.status(400).json({ error: 'company is required' });
    }
    if (!skipDeptLead && department) {
        if (!VALID_DEPARTMENTS.includes(department)) {
            return res.status(400).json({ error: 'Department must be QA, SE, or SDET' });
        }
    }

    try {
        let inviteRecord = null;
        if (!isMasterAdd && inviteToken && typeof inviteToken === 'string' && inviteToken.trim()) {
            const [inviteRows] = await pool.query(
                `SELECT bi.*, b.name AS board_name, b.company AS board_company
                 FROM board_invites bi
                 JOIN boards b ON b.id = bi.board_id
                 WHERE bi.token = ? AND bi.status = 'PENDING' AND (bi.expires_at IS NULL OR bi.expires_at > NOW())
                 LIMIT 1`,
                [inviteToken.trim()]
            );
            if (inviteRows.length === 0) {
                return res.status(400).json({ error: 'This invite is invalid or expired.' });
            }
            inviteRecord = inviteRows[0];
            if (inviteRecord.invitee_email && inviteRecord.invitee_email.toLowerCase() !== emailLower) {
                return res.status(400).json({ error: 'This invite was created for a different email address.' });
            }
        }

        const [existingEmail] = await pool.query('SELECT id, password_hash FROM users WHERE email = ?', [emailLower]);

        // If user was pre-added by a master (null password_hash), allow self-registration to complete the account
        if (existingEmail.length > 0 && !isMasterAdd && existingEmail[0].password_hash === null) {
            const password_hash = await hashPassword(password);
            const first_name = firstName.trim();
            const last_name = lastName.trim();
            const display_name = `${first_name} ${last_name}`;
            await pool.query(
                'UPDATE users SET first_name = ?, last_name = ?, display_name = ?, password_hash = ?, company = COALESCE(?, company), department = COALESCE(?, department), `lead` = COALESCE(?, `lead`) WHERE id = ?',
                [first_name, last_name, display_name, password_hash, company || null, department || null, lead || null, existingEmail[0].id]
            );
            const [updated] = await pool.query('SELECT * FROM users WHERE id = ?', [existingEmail[0].id]);
            const user = updated[0];
            const token = buildUserToken(user);

            // Create default board for newly completed admin accounts
            if (user.is_admin || user.is_master) {
                await createDefaultAdminBoard(first_name, last_name, user.company, user.department, user.id);
            }

            if (inviteRecord) {
                await pool.query('UPDATE board_invites SET invitee_user_id = ? WHERE id = ?', [user.id, inviteRecord.id]);
                await pool.query('INSERT IGNORE INTO board_members (board_id, user_id, added_by) VALUES (?, ?, ?)', [inviteRecord.board_id, user.id, inviteRecord.inviter_user_id]);
                await pool.query('UPDATE board_invites SET status = \'ACCEPTED\', accepted_by_user_id = ?, decided_at = NOW() WHERE id = ?', [user.id, inviteRecord.id]);
            }

            return res.status(200).json({ token, user: buildUserPublic(user), redirectBoardId: inviteRecord?.board_id || null });
        }

        if (existingEmail.length > 0) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        // Role assignment: masters can override via the role param
        let is_admin, is_master;
        if (callerIsMaster && role && ['master', 'admin', 'user'].includes(role)) {
            is_master = role === 'master' ? 1 : 0;
            is_admin = role === 'admin' || role === 'master' ? 1 : 0;
        } else {
            is_admin = ADMIN_EMAILS.includes(emailLower) ? 1 : 0;
            is_master = MASTER_EMAILS.includes(emailLower) ? 1 : 0;
        }
        const finalDept = (department && VALID_DEPARTMENTS.includes(department)) ? department : 'QA';
        const finalLead = (role === 'admin' || role === 'master' || skipLead) ? null : (lead || null);
        const finalCompany = String(company || inviteRecord?.board_company || DEFAULT_COMPANY).trim();

        // For master-initiated adds: use provided name or derive from email
        const first_name = isMasterAdd ? (firstName ? firstName.trim() : emailLower.split('@')[0]) : firstName.trim();
        const last_name = isMasterAdd ? (lastName ? lastName.trim() : '') : lastName.trim();
        const display_name = (first_name + (last_name ? ` ${last_name}` : '')).trim();
        // Auto-generate a unique username from email prefix.
        // Rather than a check-then-insert (TOCTOU race), we attempt the INSERT directly
        // and retry with a numeric suffix if the DB rejects it with ER_DUP_ENTRY.
        const password_hash = isMasterAdd ? null : await hashPassword(password);
        const baseUsername = emailLower.split('@')[0].replace(/[^a-z0-9_]/g, '_').slice(0, 28);
        let username = baseUsername;
        let suffix = 1;
        let result;
        while (true) {
            try {
                [result] = await pool.query(
                    'INSERT INTO users (username, first_name, last_name, display_name, email, company, department, `lead`, is_admin, is_master, password_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [username, first_name, last_name, display_name, emailLower, finalCompany, finalDept, finalLead, is_admin, is_master, password_hash]
                );
                break; // INSERT succeeded
            } catch (insertErr) {
                if (insertErr.code === 'ER_DUP_ENTRY') {
                    if (insertErr.message.includes('username')) {
                        username = `${baseUsername}_${suffix++}`;
                        continue; // retry with a new suffix
                    }
                    if (insertErr.message.includes('email')) {
                        return res.status(409).json({ error: 'An account with this email already exists.' });
                    }
                }
                throw insertErr; // unexpected error — rethrow to outer catch
            }
        }
        const newUser = { id: result.insertId, username, first_name, last_name, display_name, email: emailLower, company: finalCompany, department: finalDept, lead: finalLead, is_admin, is_master };
        const token = buildUserToken(newUser);

        await pool.query('INSERT IGNORE INTO companies (name) VALUES (?)', [finalCompany]);

        // Auto-add to admin_emails table when creating admin/master users
        if (callerIsMaster && (role === 'admin' || role === 'master')) {
            try {
                await pool.query('INSERT IGNORE INTO admin_emails (email, department) VALUES (?, ?)', [emailLower, finalDept]);
                await reloadAdminEmails();
            } catch (e) { /* ignore duplicates */ }
        }

        // Create default board for new admin/master accounts (only if account is fully registered with password)
        if ((is_admin || is_master) && password_hash) {
            await createDefaultAdminBoard(first_name, last_name, finalCompany, finalDept, result.insertId);
        }

        // Auto-add regular user to their lead's board
        if (finalLead && !is_admin && !is_master) {
            const leadBoardName = `Retro - ${finalLead}`;
            const [leadBoard] = await pool.query('SELECT id FROM boards WHERE name = ?', [leadBoardName]);
            if (leadBoard.length > 0) {
                await pool.query('INSERT IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)', [leadBoard[0].id, result.insertId]);
            }
        }

        if (inviteRecord) {
            await pool.query('UPDATE board_invites SET invitee_user_id = ? WHERE id = ?', [result.insertId, inviteRecord.id]);
            await pool.query('INSERT IGNORE INTO board_members (board_id, user_id, added_by) VALUES (?, ?, ?)', [inviteRecord.board_id, result.insertId, inviteRecord.inviter_user_id]);
            await pool.query('UPDATE board_invites SET status = \'ACCEPTED\', accepted_by_user_id = ?, decided_at = NOW() WHERE id = ?', [result.insertId, inviteRecord.id]);
        }

        // Send welcome email (non-blocking)
        sendWelcomeEmail(first_name, emailLower);
        res.status(201).json({ token, user: buildUserPublic(newUser), redirectBoardId: inviteRecord?.board_id || null });
    } catch (error) {
        console.error('Register error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
        return res.status(400).json({ error: 'email and password are required' });
    }
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE email = ?', [email.trim().toLowerCase()]);
        if (rows.length === 0) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const user = rows[0];
        // Re-sync admin/master status on every login in case email list changed
        const shouldBeAdmin = ADMIN_EMAILS.includes(user.email.toLowerCase()) ? 1 : 0;
        const shouldBeMaster = MASTER_EMAILS.includes(user.email.toLowerCase()) ? 1 : 0;
        if (user.is_admin !== shouldBeAdmin || user.is_master !== shouldBeMaster) {
            await pool.query('UPDATE users SET is_admin = ?, is_master = ? WHERE id = ?', [shouldBeAdmin, shouldBeMaster, user.id]);
            user.is_admin = shouldBeAdmin;
            user.is_master = shouldBeMaster;
        }
        if (!user.password_hash) {
            return res.status(401).json({ error: 'Your account has been created but you need to register first. Click "Create an account" to set your name and password.' });
        }
        const valid = await verifyPassword(password, user.password_hash);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const token = buildUserToken(user);
        // Flag weak passwords so the frontend can force an update
        const password_weak = typeof password === 'string' && password.length < 6;
        res.json({ token, user: buildUserPublic(user), password_weak });
    } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Internal server error' });
    }
});

app.get('/api/auth/me', authMiddleware, (req, res) => {
    res.json({ user: { id: req.user.sub, username: req.user.username, display_name: req.user.display_name, email: req.user.email, company: req.user.company || '', department: req.user.department, lead: req.user.lead || null, is_admin: req.user.is_admin, is_master: req.user.is_master || false } });
});

app.get('/api/companies', async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT name FROM companies ORDER BY name');
        res.json(rows.map(r => r.name));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/request-password-reset', authLimiter, async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });

    try {
        const [rows] = await pool.query('SELECT id, email FROM users WHERE email = ? LIMIT 1', [email]);
        if (rows.length === 0) {
            return res.json({ success: true });
        }

        const user = rows[0];
        const token = createRandomToken(24);
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE user_id = ? AND used_at IS NULL', [user.id]);
        await pool.query(
            'INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? MINUTE))',
            [user.id, tokenHash, RESET_TOKEN_EXPIRY_MINUTES]
        );

        const resetUrl = `${getAppBaseUrl()}/?reset=${encodeURIComponent(token)}`;
        try {
            await sendPasswordResetEmail(user.email, resetUrl);
        } catch {
            return res.status(502).json({ error: 'Failed to send reset email. Please check your SMTP configuration or try again later.' });
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/auth/reset-password', passwordLimiter, async (req, res) => {
    const token = String(req.body?.token || '').trim();
    const newPassword = String(req.body?.newPassword || '');
    if (!token || !newPassword) return res.status(400).json({ error: 'token and newPassword are required' });
    if (newPassword.length < 6) return res.status(400).json({ error: 'New password must be at least 6 characters' });

    try {
        const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
        const [rows] = await pool.query(
            `SELECT prt.id, prt.user_id
             FROM password_reset_tokens prt
             WHERE prt.token_hash = ? AND prt.used_at IS NULL AND prt.expires_at > NOW()
             LIMIT 1`,
            [tokenHash]
        );
        if (rows.length === 0) return res.status(400).json({ error: 'Invalid or expired reset link' });

        const password_hash = await hashPassword(newPassword);
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, rows[0].user_id]);
        await pool.query('UPDATE password_reset_tokens SET used_at = NOW() WHERE id = ?', [rows[0].id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Update own name
app.patch('/api/auth/profile', authMiddleware, async (req, res) => {
    const { firstName, lastName } = req.body;
    if (!firstName?.trim() || !lastName?.trim()) {
        return res.status(400).json({ error: 'First and last name are required' });
    }
    const display_name = `${firstName.trim()} ${lastName.trim()}`;
    try {
        await pool.query('UPDATE users SET first_name = ?, last_name = ?, display_name = ? WHERE id = ?',
            [firstName.trim(), lastName.trim(), display_name, req.user.sub]);
        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.sub]);
        const token = buildUserToken(rows[0]);
        res.json({ token, user: buildUserPublic(rows[0]) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Change own password
app.patch('/api/auth/password', authMiddleware, passwordLimiter, async (req, res) => {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) {
        return res.status(400).json({ error: 'Current and new password are required' });
    }
    if (typeof newPassword !== 'string' || newPassword.length < 6) {
        return res.status(400).json({ error: 'New password must be at least 6 characters' });
    }
    try {
        const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [req.user.sub]);
        if (!rows.length) return res.status(404).json({ error: 'User not found' });
        const valid = await verifyPassword(currentPassword, rows[0].password_hash);
        if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });
        const password_hash = await hashPassword(newPassword);
        await pool.query('UPDATE users SET password_hash = ? WHERE id = ?', [password_hash, req.user.sub]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- User Management Routes (masters only) ---

app.delete('/api/auth/account', authMiddleware, async (req, res) => {
    try {
        if (req.user.is_master) {
            return res.status(403).json({ error: 'Master accounts cannot be deleted. Contact another master to remove your account.' });
        }
        await pool.query('DELETE FROM users WHERE id = ?', [req.user.sub]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/users', authMiddleware, async (req, res) => {
    if (!req.user.is_master && !req.user.is_admin) return res.status(403).json({ error: 'Access denied' });
    try {
        const selectedCompany = String(req.query?.company || '').trim();
        const companyScope = selectedCompany || req.user.company || DEFAULT_COMPANY;
        if (req.user.is_master) {
            const [rows] = await pool.query(
                'SELECT id, username, first_name, last_name, display_name, email, company, department, `lead`, is_admin, is_master, role_key, created_at FROM users WHERE company = ? ORDER BY department, `lead`, display_name',
                [companyScope]
            );
            return res.json(rows);
        }
        // Admins/Leads: only return users on their team (matching lead = their display_name)
        const [rows] = await pool.query(
            'SELECT id, username, first_name, last_name, display_name, email, company, department, `lead`, is_admin, is_master, role_key, created_at FROM users WHERE company = ? ORDER BY display_name',
            [req.user.company || DEFAULT_COMPANY]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get users by department (for dynamic lead dropdown)
app.get('/api/users/department/:dept', authMiddleware, async (req, res) => {
    const { dept } = req.params;
    if (!VALID_DEPARTMENTS.includes(dept)) return res.status(400).json({ error: 'Invalid department' });
    try {
        const [rows] = await pool.query(
            'SELECT id, display_name FROM users WHERE department = ? AND company = ? ORDER BY display_name',
            [dept, req.user.company || DEFAULT_COMPANY]
        );
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get leads (admins) grouped by department — public (needed by registration page)
app.get('/api/leads', async (req, res) => {
    const company = String(req.query.company || '').trim();
    if (!company) return res.json({});
    try {
        const [rows] = await pool.query(
            'SELECT display_name, department FROM users WHERE is_admin = 1 AND is_master = 0 AND company = ? ORDER BY display_name',
            [company]
        );
        const grouped = {};
        for (const dept of VALID_DEPARTMENTS) grouped[dept] = [];
        for (const r of rows) {
            if (grouped[r.department]) grouped[r.department].push(r.display_name);
        }
        res.json(grouped);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/users/:userId', authMiddleware, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { userId } = req.params;
    const { department, lead, is_admin, is_master, first_name, last_name, role_key } = req.body;
    // Role key assignment only
    if (role_key !== undefined && department === undefined && is_admin === undefined && is_master === undefined) {
        try {
            const safeKey = role_key === null ? null : String(role_key).toLowerCase().replace(/[^a-z0-9_]/g, '').substring(0, 50);
            await pool.query('UPDATE users SET role_key = ? WHERE id = ?', [safeKey, userId]);
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: error.message }); }
        return;
    }
    // Master toggle
    if (is_master !== undefined && department === undefined && is_admin === undefined) {
        // Prevent demoting yourself
        if (parseInt(userId) === req.user.sub) return res.status(400).json({ error: 'You cannot change your own master status' });
        const val = is_master ? 1 : 0;
        try {
            // Promoting to master also clears is_admin; demoting leaves is_admin as-is
            if (val === 1) {
                await pool.query('UPDATE users SET is_master = 1, is_admin = 0 WHERE id = ?', [userId]);
            } else {
                await pool.query('UPDATE users SET is_master = 0 WHERE id = ?', [userId]);
            }
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: error.message }); }
        return;
    }
    // Admin toggle only
    if (is_admin !== undefined && department === undefined) {
        const val = is_admin ? 1 : 0;
        try {
            await pool.query('UPDATE users SET is_admin = ? WHERE id = ? AND is_master = 0', [val, userId]);
            const [userRows] = await pool.query('SELECT first_name, last_name, display_name, department, email FROM users WHERE id = ?', [userId]);
            if (userRows.length > 0) {
                const { first_name, last_name, display_name, department: userDept, email: userEmail } = userRows[0];
                if (val === 1) {
                    // Sync admin_emails table and in-memory list
                    await pool.query('INSERT IGNORE INTO admin_emails (email, department) VALUES (?, ?)', [userEmail, userDept || 'QA']);
                    await reloadAdminEmails();
                    // Auto-create their board if it doesn't exist
                    const boardName = `Retro - ${display_name}`;
                    const [existing] = await pool.query('SELECT id FROM boards WHERE name = ?', [boardName]);
                    if (existing.length === 0) {
                        await createDefaultAdminBoard(first_name, last_name, req.user.company || DEFAULT_COMPANY, userDept || 'QA', parseInt(userId));
                    } else {
                        // Board exists — just make sure the user is a member
                        await pool.query('INSERT IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)', [existing[0].id, parseInt(userId)]);
                        broadcastBoardsUpdate();
                    }
                } else {
                    // Demoted — remove from admin_emails and reload
                    await pool.query('DELETE FROM admin_emails WHERE email = ?', [userEmail]);
                    await reloadAdminEmails();
                }
            }
            res.json({ success: true });
        } catch (error) { res.status(500).json({ error: error.message }); }
        return;
    }
    if (!VALID_DEPARTMENTS.includes(department)) return res.status(400).json({ error: 'Invalid department' });
    // Lead can be any string (dynamically populated from registered users)
    try {
        // Fetch the user's current lead before updating, so we can remove them from the old lead's board
        const [currentUser] = await pool.query('SELECT `lead` FROM users WHERE id = ?', [userId]);
        const oldLead = currentUser.length > 0 ? currentUser[0].lead : null;

        const updates = ['UPDATE users SET department = ?, `lead` = ?'];
        const params = [department, lead];
        if (first_name !== undefined && last_name !== undefined) {
            const fn = first_name.trim();
            const ln = last_name.trim();
            const displayName = [fn, ln].filter(Boolean).join(' ');
            updates[0] = 'UPDATE users SET department = ?, `lead` = ?, first_name = ?, last_name = ?, display_name = ?';
            params.push(fn, ln, displayName);
        }
        params.push(userId);
        await pool.query(updates[0] + ' WHERE id = ?', params);

        // Remove user from old lead's board (if lead changed)
        if (oldLead && oldLead !== lead) {
            const oldBoardName = `Retro - ${oldLead}`;
            const [oldBoard] = await pool.query('SELECT id FROM boards WHERE name = ?', [oldBoardName]);
            if (oldBoard.length > 0) {
                await pool.query('DELETE FROM board_members WHERE board_id = ? AND user_id = ?', [oldBoard[0].id, userId]);
            }
        }

        // Auto-add user to their new lead's board
        if (lead) {
            const leadBoardName = `Retro - ${lead}`;
            const [leadBoard] = await pool.query('SELECT id FROM boards WHERE name = ?', [leadBoardName]);
            if (leadBoard.length > 0) {
                await pool.query('INSERT IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)', [leadBoard[0].id, userId]);
            }
        }

        // Notify the moved user so they see the board immediately
        const targetSockets = userSockets.get(parseInt(userId));
        if (targetSockets) {
            for (const sid of targetSockets) {
                io.to(sid).emit('boards:refresh');
            }
        }
        broadcastBoardsUpdate();
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/users/:userId', authMiddleware, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { userId } = req.params;
    // Prevent deleting yourself
    if (parseInt(userId) === req.user.sub) return res.status(400).json({ error: 'You cannot delete your own account' });
    try {
        await pool.query('DELETE FROM users WHERE id = ?', [userId]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Admin Email Management (Masters only) ---

app.get('/api/admin-emails', authMiddleware, adminMgmtLimiter, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    try {
        const [rows] = await pool.query('SELECT id, email, department, created_at FROM admin_emails ORDER BY department, email');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/admin-emails', authMiddleware, adminMgmtLimiter, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { email, department } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Valid email required' });
    }
    const emailLower = email.toLowerCase().trim();
    try {
        await pool.query('INSERT INTO admin_emails (email, department) VALUES (?, ?)', [emailLower, department || null]);
        await reloadAdminEmails();
        // If this user already exists, update them to admin
        await pool.query('UPDATE users SET is_admin = 1 WHERE email = ?', [emailLower]);
        res.status(201).json({ success: true, email: emailLower, department });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already in admin list' });
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/admin-emails/:id', authMiddleware, adminMgmtLimiter, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { department } = req.body;
    if (!department || !['QA', 'SE'].includes(department)) {
        return res.status(400).json({ error: 'Valid department required (QA or SE)' });
    }
    try {
        await pool.query('UPDATE admin_emails SET department = ? WHERE id = ?', [department, req.params.id]);
        // Also update the user's department if they exist
        const [rows] = await pool.query('SELECT email FROM admin_emails WHERE id = ?', [req.params.id]);
        if (rows.length > 0) {
            await pool.query('UPDATE users SET department = ? WHERE email = ?', [department, rows[0].email]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/admin-emails/:id', authMiddleware, adminMgmtLimiter, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    try {
        const [rows] = await pool.query('SELECT email FROM admin_emails WHERE id = ?', [req.params.id]);
        await pool.query('DELETE FROM admin_emails WHERE id = ?', [req.params.id]);
        await reloadAdminEmails();
        // Remove admin from the user
        if (rows.length > 0) {
            await pool.query('UPDATE users SET is_admin = 0 WHERE email = ?', [rows[0].email]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Master Email Management (Masters only) ---

app.get('/api/master-emails', authMiddleware, adminMgmtLimiter, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    try {
        const [rows] = await pool.query('SELECT id, email, created_at FROM master_emails ORDER BY email');
        res.json(rows);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/master-emails', authMiddleware, adminMgmtLimiter, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { email } = req.body;
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'Valid email required' });
    }
    const emailLower = email.toLowerCase().trim();
    try {
        await pool.query('INSERT INTO master_emails (email) VALUES (?)', [emailLower]);
        await reloadMasterEmails();
        // If this user already exists, update them to master + admin
        await pool.query('UPDATE users SET is_master = 1, is_admin = 1 WHERE email = ?', [emailLower]);
        res.status(201).json({ success: true, email: emailLower });
    } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email already in master list' });
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/master-emails/:id', authMiddleware, adminMgmtLimiter, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    try {
        const [rows] = await pool.query('SELECT email FROM master_emails WHERE id = ?', [req.params.id]);
        await pool.query('DELETE FROM master_emails WHERE id = ?', [req.params.id]);
        await reloadMasterEmails();
        // Remove master from the user
        if (rows.length > 0) {
            await pool.query('UPDATE users SET is_master = 0 WHERE email = ?', [rows[0].email]);
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Role Label Routes ---

app.get('/api/role-labels', async (req, res) => {
    try {
        const authHeader = req.headers['authorization'];
        let requester = null;
        if (authHeader && authHeader.startsWith('Bearer ')) {
            const payload = verifyJwt(authHeader.slice(7));
            if (payload) requester = payload;
        }

        const selectedCompany = String(req.query?.company || '').trim();
        const companyScope = requester?.is_master
            ? (selectedCompany || requester.company || DEFAULT_COMPANY)
            : (requester?.company || selectedCompany || DEFAULT_COMPANY);

        await pool.query(
            `INSERT IGNORE INTO role_labels (company, role_key, label)
             VALUES (?, 'master', 'Iron Fist'), (?, 'admin', 'Admin'), (?, 'user', 'Member')`,
            [companyScope, companyScope, companyScope]
        );

        const [rows] = await pool.query('SELECT role_key, label FROM role_labels WHERE company = ? ORDER BY id ASC', [companyScope]);
        const labels = {};
        rows.forEach(r => { labels[r.role_key] = r.label; });
        res.json(labels);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/role-labels', authMiddleware, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Only masters can edit role labels' });
    const { labels } = req.body; // { master: '...', admin: '...', user: '...' }
    if (!labels || typeof labels !== 'object') return res.status(400).json({ error: 'labels object required' });
    try {
        const selectedCompany = String(req.query?.company || req.body?.company || '').trim();
        const companyScope = selectedCompany || req.user.company || DEFAULT_COMPANY;

        for (const [key, value] of Object.entries(labels)) {
            if (typeof value !== 'string' || !value.trim()) continue;
            await pool.query(
                `INSERT INTO role_labels (company, role_key, label)
                 VALUES (?, ?, ?)
                 ON DUPLICATE KEY UPDATE label = VALUES(label)`,
                [companyScope, key, value.trim()]
            );
        }
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/role-labels', authMiddleware, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Only masters can add role labels' });
    const { role_key, label } = req.body;
    if (!role_key || !label || typeof role_key !== 'string' || typeof label !== 'string') {
        return res.status(400).json({ error: 'role_key and label required' });
    }
    const key = role_key.trim().toLowerCase().replace(/\s+/g, '_');
    if (!key || !label.trim()) return res.status(400).json({ error: 'Invalid role_key or label' });
    try {
        const selectedCompany = String(req.query?.company || req.body?.company || '').trim();
        const companyScope = selectedCompany || req.user.company || DEFAULT_COMPANY;
        await pool.query(
            `INSERT INTO role_labels (company, role_key, label)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE label = VALUES(label)`,
            [companyScope, key, label.trim()]
        );
        res.status(201).json({ role_key: key, label: label.trim() });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/role-labels/:key', authMiddleware, async (req, res) => {
    if (!req.user.is_master) return res.status(403).json({ error: 'Only masters can delete role labels' });
    const { key } = req.params;
    if (['master', 'admin', 'user'].includes(key)) {
        return res.status(400).json({ error: 'Cannot delete built-in role labels' });
    }
    try {
        const selectedCompany = String(req.query?.company || '').trim();
        const companyScope = selectedCompany || req.user.company || DEFAULT_COMPANY;
        await pool.query('DELETE FROM role_labels WHERE company = ? AND role_key = ?', [companyScope, key]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Board Routes ---

app.get('/api/boards', authMiddleware, async (req, res) => {
    try {
        let boards;
        const selectedCompany = String(req.query?.company || '').trim();
        const companyScope = selectedCompany || req.user.company || DEFAULT_COMPANY;
        if (req.user.is_master) {
            // Masters can select which company to view
            [boards] = await pool.query('SELECT * FROM boards WHERE company = ? ORDER BY created_at DESC', [companyScope]);
        } else {
            // Admins and regular users only see boards they are explicitly added to
            [boards] = await pool.query(
                `SELECT DISTINCT b.* FROM boards b
                 JOIN board_members bm ON bm.board_id = b.id AND bm.user_id = ?
                 WHERE b.company = ?
                 ORDER BY b.created_at DESC`,
                [req.user.id, req.user.company || DEFAULT_COMPANY]
            );
        }
        res.json(boards);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/boards', authMiddleware, async (req, res) => {
    const { name, department, template } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    // Board department defaults to the creating user's department (admins can specify)
    const boardDept = req.user.is_admin && department && VALID_DEPARTMENTS.includes(department)
        ? department
        : (VALID_DEPARTMENTS.includes(req.user.department) ? req.user.department : 'QA');
    try {
        const [result] = await pool.query('INSERT INTO boards (name, company, department) VALUES (?, ?, ?)', [name.trim(), req.user.company || DEFAULT_COMPANY, boardDept]);
        const insertId = result.insertId;
        const defaultColumns = template === 'template'
            ? [
                ['Ice Breaker', 0],
                ['Needs Improvements', 1],
                ['Went Well', 2],
                ['Action Items', 3],
              ]
            : [
                ['Went Well', 0],
                ['To Improve', 1],
                ['Action Items', 2],
              ];
        for (const [colName, pos] of defaultColumns) {
            await pool.query('INSERT INTO `columns` (board_id, name, position) VALUES (?, ?, ?)', [insertId, colName, pos]);
        }

        const board = { id: insertId, name: name.trim(), company: req.user.company || DEFAULT_COMPANY, department: boardDept };
        // Auto-add the creating user as a board member
        await pool.query('INSERT IGNORE INTO board_members (board_id, user_id) VALUES (?, ?)', [insertId, req.user.id]);
        res.status(201).json(board);
        broadcastBoardsUpdate();
    } catch (error) {
        console.error('POST /api/boards error:', error.message, error.code, error.sqlMessage || '');
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/boards/:id', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name || typeof name !== 'string') return res.status(400).json({ error: 'name required' });
    if (!req.user.is_admin && !req.user.is_master) return res.status(403).json({ error: 'Only admins can rename boards' });
    try {
        const [boardRows] = await pool.query('SELECT * FROM boards WHERE id = ?', [req.params.id]);
        if (boardRows.length === 0) return res.status(404).json({ error: 'Board not found' });
        if (!req.user.is_master) {
            const [membership] = await pool.query('SELECT id FROM board_members WHERE board_id = ? AND user_id = ?', [req.params.id, req.user.id]);
            if (membership.length === 0) return res.status(403).json({ error: 'Access denied' });
        }
        await pool.query('UPDATE boards SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
        res.json({ success: true, id: Number(req.params.id), name: name.trim() });
        broadcastBoardsUpdate();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/boards/:id', authMiddleware, async (req, res) => {
    if (!req.user.is_admin && !req.user.is_master) return res.status(403).json({ error: 'Only admins can delete boards' });
    try {
        if (!req.user.is_master) {
            const [membership] = await pool.query('SELECT id FROM board_members WHERE board_id = ? AND user_id = ?', [req.params.id, req.user.id]);
            if (membership.length === 0) return res.status(403).json({ error: 'Access denied' });
        }
        await pool.query('DELETE FROM boards WHERE id = ?', [req.params.id]);
        res.json({ success: true });
        broadcastBoardsUpdate();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/boards/:id/bg', authMiddleware, async (req, res) => {
    if (!req.user.is_admin && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    const { bg_image } = req.body; // null to clear, string URL to set
    try {
        const [boardRows] = await pool.query('SELECT * FROM boards WHERE id = ?', [req.params.id]);
        if (boardRows.length === 0) return res.status(404).json({ error: 'Board not found' });
        if (!req.user.is_master) {
            const [membership] = await pool.query('SELECT id FROM board_members WHERE board_id = ? AND user_id = ?', [req.params.id, req.user.id]);
            if (membership.length === 0) return res.status(403).json({ error: 'Access denied' });
        }
        const value = bg_image && typeof bg_image === 'string' ? bg_image.trim() : null;
        await pool.query('UPDATE boards SET bg_image = ? WHERE id = ?', [value, req.params.id]);
        res.json({ success: true, bg_image: value });
        broadcastBoardsUpdate();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Board Membership Routes ---

// Get members of a board
app.get('/api/boards/:boardId/members', authMiddleware, async (req, res) => {
    const { boardId } = req.params;
    try {
        await assertBoardAccess(req.user.id, boardId, req.user.is_master);
        const [rows] = await pool.query(
            `SELECT u.id, u.first_name, u.last_name, u.display_name, u.email, u.company, u.department, u.\`lead\`, u.is_admin, u.is_master, bm.created_at AS added_at
             FROM board_members bm
             JOIN users u ON u.id = bm.user_id
             WHERE bm.board_id = ? AND u.company = ?
             ORDER BY u.display_name`,
            [boardId, req.user.company || DEFAULT_COMPANY]
        );
        res.json(rows);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Add a member to a board (admin+ only, must be a member of the board)
app.post('/api/boards/:boardId/members', authMiddleware, async (req, res) => {
    if (!req.user.is_admin && !req.user.is_master) return res.status(403).json({ error: 'Only admins can manage board members' });
    const { boardId } = req.params;
    const { userId } = req.body;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    try {
        const [boardRows] = await pool.query('SELECT * FROM boards WHERE id = ?', [boardId]);
        if (boardRows.length === 0) return res.status(404).json({ error: 'Board not found' });
        if (!req.user.is_master) {
            const [membership] = await pool.query('SELECT id FROM board_members WHERE board_id = ? AND user_id = ?', [boardId, req.user.id]);
            if (membership.length === 0) return res.status(403).json({ error: 'Access denied' });
        }
        const [userRows] = await pool.query('SELECT id, display_name, email, department FROM users WHERE id = ?', [userId]);
        if (userRows.length === 0) return res.status(404).json({ error: 'User not found' });
        if ((userRows[0].company || DEFAULT_COMPANY) !== (req.user.company || DEFAULT_COMPANY)) {
            return res.status(403).json({ error: 'You can only add users from your company' });
        }
        await pool.query('INSERT IGNORE INTO board_members (board_id, user_id, added_by) VALUES (?, ?, ?)', [boardId, userId, req.user.id]);
        res.status(201).json({ success: true, user: userRows[0] });
        broadcastBoardsUpdate();
        // Also emit a targeted refresh to the added user so they see the board immediately
        const targetSockets = userSockets.get(parseInt(userId));
        if (targetSockets) {
            for (const sid of targetSockets) {
                io.to(sid).emit('boards:refresh');
            }
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Remove a member from a board (admin+ only, must be a member of the board)
app.delete('/api/boards/:boardId/members/:userId', authMiddleware, async (req, res) => {
    if (!req.user.is_admin && !req.user.is_master) return res.status(403).json({ error: 'Only admins can manage board members' });
    const { boardId, userId } = req.params;
    try {
        const [boardRows] = await pool.query('SELECT * FROM boards WHERE id = ?', [boardId]);
        if (boardRows.length === 0) return res.status(404).json({ error: 'Board not found' });
        if (!req.user.is_master) {
            const [membership] = await pool.query('SELECT id FROM board_members WHERE board_id = ? AND user_id = ?', [boardId, req.user.id]);
            if (membership.length === 0) return res.status(403).json({ error: 'Access denied' });
        }
        await pool.query('DELETE FROM board_members WHERE board_id = ? AND user_id = ?', [boardId, userId]);
        res.json({ success: true });
        broadcastBoardsUpdate();
        // Notify the removed user so their board list updates immediately
        const targetSockets = userSockets.get(parseInt(userId));
        if (targetSockets) {
            for (const sid of targetSockets) {
                io.to(sid).emit('boards:refresh');
            }
        }
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Get all users who have access to a board (lead users, explicit members, admins of that dept, masters)
// Get all users who are members of a board (matches Board Members panel)
app.get('/api/boards/:boardId/users', authMiddleware, async (req, res) => {
    const { boardId } = req.params;
    try {
        await assertBoardAccess(req.user.id, boardId, req.user.is_master);
        const [rows] = await pool.query(
            `SELECT u.id, u.first_name, u.last_name, u.display_name, u.email, u.company, u.department, u.\`lead\`, u.is_admin, u.is_master,
                    0 AS is_pending, NULL AS invite_token
             FROM board_members bm
             JOIN users u ON u.id = bm.user_id
             WHERE bm.board_id = ? AND u.company = ?
             ORDER BY u.is_master DESC, u.is_admin DESC, u.display_name`,
            [boardId, req.user.company || DEFAULT_COMPANY]
        );

        const [pendingRows] = await pool.query(
            `SELECT bi.id, bi.token, COALESCE(u.display_name, bi.invitee_email) AS display_name, COALESCE(u.email, bi.invitee_email) AS email,
                    COALESCE(u.company, ?) AS company
             FROM board_invites bi
             LEFT JOIN users u ON u.id = bi.invitee_user_id
             WHERE bi.board_id = ? AND bi.status = 'PENDING'
             ORDER BY bi.created_at DESC`,
            [req.user.company || DEFAULT_COMPANY, boardId]
        );

        const pendingUsers = pendingRows
            .filter(p => (p.company || req.user.company || DEFAULT_COMPANY) === (req.user.company || DEFAULT_COMPANY))
            .map((p, idx) => ({
                id: `pending-${p.id}-${idx}`,
                display_name: p.display_name || 'Pending User',
                email: p.email || '',
                company: p.company || req.user.company || DEFAULT_COMPANY,
                is_pending: 1,
                invite_token: p.token,
                is_admin: 0,
                is_master: 0,
            }));

        res.json([...rows, ...pendingUsers]);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// --- Card image upload ---
const cardImageUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(__dirname, 'uploads');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => {
            // Derive extension from MIME type so pasted GIFs keep .gif
            const mimeExts = { 'image/gif': '.gif', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/svg+xml': '.svg', 'image/bmp': '.bmp' };
            const ext = mimeExts[file.mimetype] || path.extname(file.originalname) || '.png';
            cb(null, `card_${Date.now()}${ext}`);
        }
    }),
    limits: { fileSize: 10 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        cb(null, /image\//.test(file.mimetype));
    }
});

app.post('/api/upload', authMiddleware, cardImageUpload.single('image'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    const url = `/uploads/${req.file.filename}`;
    res.json({ url });
});

app.post('/api/boards/:id/bg-upload', authMiddleware, multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        const mimeExts = { 'image/gif': '.gif', 'image/png': '.png', 'image/jpeg': '.jpg', 'image/webp': '.webp', 'image/bmp': '.bmp' };
        const ext = mimeExts[file.mimetype] || '.jpg';
        cb(null, `bg_${Date.now()}${ext}`);
    }
}), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    cb(null, /image\//.test(file.mimetype));
}}).single('bg'), async (req, res) => {
    if (!req.user.is_admin && !req.user.is_master) return res.status(403).json({ error: 'Access denied' });
    if (!req.file) return res.status(400).json({ error: 'No image provided' });
    const url = `/uploads/${req.file.filename}`;
    try {
        const [boardRows] = await pool.query('SELECT * FROM boards WHERE id = ?', [req.params.id]);
        if (boardRows.length === 0) return res.status(404).json({ error: 'Board not found' });
        if (!req.user.is_master) {
            const [membership] = await pool.query('SELECT id FROM board_members WHERE board_id = ? AND user_id = ?', [req.params.id, req.user.id]);
            if (membership.length === 0) return res.status(403).json({ error: 'Access denied' });
        }
        await pool.query('UPDATE boards SET bg_image = ? WHERE id = ?', [url, req.params.id]);
        res.json({ success: true, url });
        broadcastBoardsUpdate();
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/boards/:boardId', authMiddleware, async (req, res) => {
    const { boardId } = req.params;
    try {
        // Verify the user has access to this board
        const [boardRows] = await pool.query('SELECT * FROM boards WHERE id = ?', [boardId]);
        if (boardRows.length === 0) return res.status(404).json({ error: 'Board not found' });
        const board = boardRows[0];
        if (req.user.is_master) {
            // Masters access any board
        } else {
            // Admins and members: must be an explicit board member
            const [membership] = await pool.query('SELECT id FROM board_members WHERE board_id = ? AND user_id = ?', [boardId, req.user.id]);
            if (membership.length === 0) return res.status(403).json({ error: 'Access denied' });
        }

        const [columns] = await pool.query('SELECT * FROM `columns` WHERE board_id = ? ORDER BY position ASC', [boardId]);

        let cards = [];
        if (columns.length > 0) {
            const columnIds = columns.map(c => c.id);
            const [fetchedCards] = await pool.query(
                'SELECT * FROM cards WHERE column_id IN (?) AND deleted_at IS NULL ORDER BY position ASC',
                [columnIds]
            );
            cards = await withCardReactions(fetchedCards);
        }
        res.json({ columns, cards });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Column Routes ---

app.post('/api/columns', authMiddleware, async (req, res) => {
    const { board_id, name, position } = req.body;
    if (!board_id || !name) return res.status(400).json({ error: 'board_id and name required' });
    try {
        await assertBoardAccess(req.user.id, board_id, req.user.is_master);
        const [result] = await pool.query(
            'INSERT INTO `columns` (board_id, name, position) VALUES (?, ?, ?)',
            [board_id, name.trim(), position || 0]
        );
        const column = { id: result.insertId, board_id, name: name.trim(), position: position || 0 };
        res.status(201).json(column);
        broadcastBoardUpdate(Number(board_id));
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.patch('/api/columns/reorder', authMiddleware, async (req, res) => {
    const updates = Array.isArray(req.body?.columns) ? req.body.columns : null;
    if (!updates || updates.length === 0) return res.status(400).json({ error: 'columns array required' });

    try {
        const columnIds = updates.map(c => Number(c.id)).filter(Number.isFinite);
        if (columnIds.length !== updates.length) {
            return res.status(400).json({ error: 'Invalid column ids' });
        }

        const [rows] = await pool.query('SELECT id, board_id FROM `columns` WHERE id IN (?)', [columnIds]);
        if (rows.length !== columnIds.length) {
            return res.status(404).json({ error: 'One or more columns not found' });
        }

        const boardIds = [...new Set(rows.map(r => r.board_id))];
        for (const boardId of boardIds) {
            await assertBoardAdmin(req.user.id, boardId, req.user.is_admin, req.user.is_master);
        }

        for (const update of updates) {
            const colId = Number(update.id);
            const position = Number(update.position);
            if (!Number.isFinite(position)) continue;
            await pool.query('UPDATE `columns` SET position = ? WHERE id = ?', [position, colId]);
        }

        res.json({ success: true });
        for (const boardId of boardIds) {
            broadcastBoardUpdate(boardId);
        }
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// --- Board Invite Routes ---

app.get('/api/boards/:boardId/pending-invites', authMiddleware, async (req, res) => {
    const { boardId } = req.params;
    try {
        await assertBoardAccess(req.user.id, boardId, req.user.is_master);
        const [rows] = await pool.query(
            `SELECT bi.id, bi.token, bi.invitee_email, bi.created_at,
                    u.id AS invitee_user_id, u.display_name
             FROM board_invites bi
             LEFT JOIN users u ON u.id = bi.invitee_user_id
             WHERE bi.board_id = ?
               AND bi.status = 'PENDING'
               AND (bi.invitee_user_id IS NOT NULL OR bi.invitee_email IS NOT NULL)
             ORDER BY bi.created_at DESC`,
            [boardId]
        );
        res.json(rows);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/boards/:boardId/invites', authMiddleware, async (req, res) => {
    if (!req.user.is_admin && !req.user.is_master) return res.status(403).json({ error: 'Only admins can create invites' });
    const { boardId } = req.params;
    const { userId, email } = req.body || {};

    try {
        await assertBoardAdmin(req.user.id, boardId, req.user.is_admin, req.user.is_master);

        let inviteeEmail = email ? String(email).trim().toLowerCase() : null;
        let inviteeUserId = userId ? Number(userId) : null;

        if (inviteeUserId) {
            const [targetRows] = await pool.query('SELECT id, email, company FROM users WHERE id = ?', [inviteeUserId]);
            if (targetRows.length === 0) return res.status(404).json({ error: 'User not found' });
            if ((targetRows[0].company || DEFAULT_COMPANY) !== (req.user.company || DEFAULT_COMPANY)) {
                return res.status(403).json({ error: 'You can only invite users from your company' });
            }
            inviteeEmail = targetRows[0].email;
        }

        if (!inviteeUserId && !inviteeEmail) {
            return res.status(400).json({ error: 'userId or email is required' });
        }

        const token = createRandomToken(24);
        const dailyLink = await getOrCreateDailyBoardInviteLink(Number(boardId), req.user.id);
        await pool.query(
            `INSERT INTO board_invites (board_id, inviter_user_id, invitee_user_id, invitee_email, token, expires_at)
             VALUES (?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 14 DAY))`,
            [boardId, req.user.id, inviteeUserId, inviteeEmail, token]
        );

        const [boardRows] = await pool.query('SELECT name FROM boards WHERE id = ? LIMIT 1', [boardId]);
        const inviteUrl = `${getRequestBaseUrl(req)}/?invite=${encodeURIComponent(dailyLink.token)}`;

        res.status(201).json({
            success: true,
            token,
            inviteUrl,
            inviteUrlExpiresAt: dailyLink.expiresAt,
            boardName: boardRows[0]?.name || 'Retro Board',
            email: inviteeEmail,
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/boards/:boardId/invite-link', authMiddleware, async (req, res) => {
    if (!req.user.is_admin && !req.user.is_master) return res.status(403).json({ error: 'Only admins can access invite link' });
    const { boardId } = req.params;
    try {
        await assertBoardAdmin(req.user.id, boardId, req.user.is_admin, req.user.is_master);
        const dailyLink = await getOrCreateDailyBoardInviteLink(Number(boardId), req.user.id);
        const [boardRows] = await pool.query('SELECT name FROM boards WHERE id = ? LIMIT 1', [boardId]);
        res.json({
            token: dailyLink.token,
            inviteUrl: `${getRequestBaseUrl(req)}/?invite=${encodeURIComponent(dailyLink.token)}`,
            inviteUrlExpiresAt: dailyLink.expiresAt,
            boardName: boardRows[0]?.name || 'Retro Board',
            timeZone: 'PDT',
        });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/boards/:boardId/invites/:inviteId', authMiddleware, async (req, res) => {
    if (!req.user.is_admin && !req.user.is_master) return res.status(403).json({ error: 'Only admins can cancel invites' });
    const { boardId, inviteId } = req.params;
    try {
        await assertBoardAdmin(req.user.id, boardId, req.user.is_admin, req.user.is_master);
        await pool.query(
            `UPDATE board_invites
             SET status = 'CANCELED', decided_at = NOW()
             WHERE id = ? AND board_id = ? AND status = 'PENDING'`,
            [inviteId, boardId]
        );
        res.json({ success: true });
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/invites/:token', async (req, res) => {
    const token = String(req.params.token || '').trim();
    if (!token) return res.status(400).json({ error: 'Invite token is required' });

    try {
        const [rows] = await pool.query(
            `SELECT bi.id, bi.status, bi.expires_at, bi.invitee_email, bi.invitee_user_id, b.id AS board_id, b.name AS board_name, b.company
             FROM board_invites bi
             JOIN boards b ON b.id = bi.board_id
             WHERE bi.token = ?
             LIMIT 1`,
            [token]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Invite not found' });

        const invite = rows[0];
        const expired = invite.expires_at && new Date(invite.expires_at) < new Date();
        res.json({
            id: invite.id,
            boardId: invite.board_id,
            boardName: invite.board_name,
            company: invite.company,
            inviteeEmail: invite.invitee_email,
            status: expired && invite.status === 'PENDING' ? 'EXPIRED' : invite.status,
            token,
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/invites/me/pending', authMiddleware, async (req, res) => {
    try {
        const [rows] = await pool.query(
            `SELECT bi.id, bi.token, bi.invitee_email, bi.created_at, bi.expires_at,
                    b.id AS board_id, b.name AS board_name
             FROM board_invites bi
             JOIN boards b ON b.id = bi.board_id
             WHERE bi.status = 'PENDING'
               AND b.company = ?
               AND (bi.expires_at IS NULL OR bi.expires_at > NOW())
               AND (
                    bi.invitee_user_id = ?
                    OR (bi.invitee_email IS NOT NULL AND LOWER(bi.invitee_email) = LOWER(?))
               )
             ORDER BY bi.created_at DESC`,
            [req.user.company || DEFAULT_COMPANY, req.user.id, String(req.user.email || '')]
        );
        res.json(rows.map(r => ({
            id: r.id,
            token: r.token,
            boardId: r.board_id,
            boardName: r.board_name,
            inviteeEmail: r.invitee_email,
            createdAt: r.created_at,
            expiresAt: r.expires_at,
            status: 'PENDING',
        })));
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/invites/:token/respond', authMiddleware, async (req, res) => {
    const token = String(req.params.token || '').trim();
    const decision = String(req.body?.decision || '').toLowerCase();
    if (!token || !['accept', 'decline'].includes(decision)) {
        return res.status(400).json({ error: 'token and valid decision are required' });
    }

    try {
        const [rows] = await pool.query(
            `SELECT bi.*, b.name AS board_name, b.company AS board_company
             FROM board_invites bi
             JOIN boards b ON b.id = bi.board_id
             WHERE bi.token = ?
             LIMIT 1`,
            [token]
        );
        if (rows.length === 0) return res.status(404).json({ error: 'Invite not found' });

        const invite = rows[0];
        if (invite.status !== 'PENDING') return res.status(400).json({ error: `Invite is already ${invite.status.toLowerCase()}` });
        if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
            await pool.query('UPDATE board_invites SET status = \'EXPIRED\', decided_at = NOW() WHERE id = ?', [invite.id]);
            return res.status(400).json({ error: 'Invite is expired' });
        }

        if ((invite.board_company || DEFAULT_COMPANY) !== (req.user.company || DEFAULT_COMPANY)) {
            return res.status(403).json({ error: 'Invite is for a different company' });
        }
        if (invite.invitee_user_id && invite.invitee_user_id !== req.user.id) {
            return res.status(403).json({ error: 'Invite is for a different user' });
        }
        if (invite.invitee_email && invite.invitee_email.toLowerCase() !== String(req.user.email || '').toLowerCase()) {
            return res.status(403).json({ error: 'Invite is for a different email address' });
        }

        if (decision === 'accept') {
            await pool.query('INSERT IGNORE INTO board_members (board_id, user_id, added_by) VALUES (?, ?, ?)', [invite.board_id, req.user.id, invite.inviter_user_id]);
            await pool.query('UPDATE board_invites SET status = \'ACCEPTED\', accepted_by_user_id = ?, decided_at = NOW() WHERE id = ?', [req.user.id, invite.id]);
            broadcastBoardsUpdate();
            const targetSockets = userSockets.get(req.user.id);
            if (targetSockets) {
                for (const sid of targetSockets) io.to(sid).emit('boards:refresh');
            }
            return res.json({ success: true, status: 'ACCEPTED', boardId: invite.board_id, boardName: invite.board_name });
        }

        await pool.query('UPDATE board_invites SET status = \'DECLINED\', decided_at = NOW() WHERE id = ?', [invite.id]);
        return res.json({ success: true, status: 'DECLINED', boardName: invite.board_name });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/columns/:id', authMiddleware, async (req, res) => {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    try {
        const [cols] = await pool.query('SELECT * FROM `columns` WHERE id = ?', [req.params.id]);
        if (cols.length === 0) return res.status(404).json({ error: 'Column not found' });
        await assertBoardAccess(req.user.id, cols[0].board_id, req.user.is_master);
        await pool.query('UPDATE `columns` SET name = ? WHERE id = ?', [name.trim(), req.params.id]);
        const [updated] = await pool.query('SELECT * FROM `columns` WHERE id = ?', [req.params.id]);
        res.json(updated[0] || { success: true, id: req.params.id, name: name.trim() });
        broadcastBoardUpdate(cols[0].board_id);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.delete('/api/columns/:id', authMiddleware, async (req, res) => {
    try {
        const [cols] = await pool.query('SELECT board_id FROM `columns` WHERE id = ?', [req.params.id]);
        if (cols.length === 0) return res.status(404).json({ error: 'Column not found' });
        await assertBoardAdmin(req.user.id, cols[0].board_id, req.user.is_admin, req.user.is_master);
        await pool.query('DELETE FROM `columns` WHERE id = ?', [req.params.id]);
        res.json({ success: true });
        broadcastBoardUpdate(cols[0].board_id);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// --- Card Routes ---

app.post('/api/cards', authMiddleware, async (req, res) => {
    const { column_id, content, position, image_url } = req.body;
    if (!column_id || (content === undefined && !image_url)) return res.status(400).json({ error: 'column_id and content or image_url required' });
    try {
        // Resolve board_id from column and verify membership
        const [cols] = await pool.query('SELECT board_id FROM `columns` WHERE id = ?', [column_id]);
        if (cols.length === 0) return res.status(404).json({ error: 'Column not found' });
        await assertBoardAccess(req.user.id, cols[0].board_id, req.user.is_master);
        // Derive ownership server-side from the authenticated user
        const createdByUserId = req.user.id;
        const createdByName = req.user.display_name || null;
        const [result] = await pool.query(
            'INSERT INTO cards (column_id, content, position, created_by, created_by_user_id, image_url) VALUES (?, ?, ?, ?, ?, ?)',
            [column_id, content, position || 0, createdByName, createdByUserId, image_url || null]
        );
        const card = { id: result.insertId, column_id, content, position: position || 0, created_by: createdByName, created_by_user_id: createdByUserId, image_url: image_url || null, deleted_at: null };
        res.status(201).json(card);
        broadcastBoardUpdate(cols[0].board_id);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.put('/api/cards/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    const { column_id, position, content } = req.body;
    try {
        const [existing] = await pool.query(
            'SELECT ca.*, c.board_id FROM cards ca JOIN `columns` c ON ca.column_id = c.id WHERE ca.id = ?', [id]
        );
        if (!existing.length) return res.status(404).json({ error: 'Card not found' });

        // Verify the user is a member of the board this card belongs to
        await assertBoardAccess(req.user.id, existing[0].board_id, req.user.is_master);

        // Only card owner, admins, or masters can move/edit cards
        if ((column_id !== undefined || position !== undefined) && !req.user.is_admin && !req.user.is_master && existing[0].created_by_user_id !== req.user.id) {
            return res.status(403).json({ error: 'You can only move your own cards' });
        }

        // Build a single UPDATE with all provided fields
        const sets = [];
        const params = [];
        if (content !== undefined)   { sets.push('content = ?');   params.push(content); }
        if (column_id !== undefined)  { sets.push('column_id = ?'); params.push(column_id); }
        if (position !== undefined)   { sets.push('position = ?');  params.push(position); }
        if (req.body.image_url !== undefined) { sets.push('image_url = ?'); params.push(req.body.image_url); }

        if (sets.length > 0) {
            params.push(id);
            await pool.query(`UPDATE cards SET ${sets.join(', ')} WHERE id = ?`, params);
        }

        const [rows] = await pool.query('SELECT * FROM cards WHERE id = ?', [id]);
        res.json(rows[0] || { success: true });

        // Broadcast to the board room (use original board_id; if column changed, also notify new board)
        broadcastBoardUpdate(existing[0].board_id);
        if (column_id !== undefined && column_id !== existing[0].column_id) {
            const [newCol] = await pool.query('SELECT board_id FROM `columns` WHERE id = ?', [column_id]);
            if (newCol.length > 0 && newCol[0].board_id !== existing[0].board_id) {
                broadcastBoardUpdate(newCol[0].board_id);
            }
        }
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

app.post('/api/cards/:id/reactions', authMiddleware, async (req, res) => {
    const cardId = Number(req.params.id);
    const emoji = String(req.body?.emoji || '').trim();

    if (!cardId || !emoji || emoji.length > 20) {
        return res.status(400).json({ error: 'Valid emoji is required' });
    }

    try {
        const [cardRows] = await pool.query(
            'SELECT ca.id, c.board_id FROM cards ca JOIN `columns` c ON ca.column_id = c.id WHERE ca.id = ? AND ca.deleted_at IS NULL',
            [cardId]
        );
        if (cardRows.length === 0) return res.status(404).json({ error: 'Card not found' });

        const boardId = cardRows[0].board_id;
        await assertBoardAccess(req.user.id, boardId, req.user.is_master);

        const [existing] = await pool.query(
            'SELECT id FROM card_reactions WHERE card_id = ? AND user_id = ? AND emoji = ?',
            [cardId, req.user.id, emoji]
        );

        if (existing.length > 0) {
            await pool.query('DELETE FROM card_reactions WHERE card_id = ? AND user_id = ? AND emoji = ?', [cardId, req.user.id, emoji]);
            res.json({ action: 'removed' });
        } else {
            await pool.query('INSERT INTO card_reactions (card_id, user_id, emoji) VALUES (?, ?, ?)', [cardId, req.user.id, emoji]);
            res.json({ action: 'added' });
        }

        broadcastBoardUpdate(boardId);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Card deletion: only card owner, admins, or masters can delete
app.delete('/api/cards/:id', authMiddleware, async (req, res) => {
    const { id } = req.params;
    try {
        const [cardCols] = await pool.query(
            'SELECT ca.*, c.board_id FROM cards ca JOIN `columns` c ON ca.column_id = c.id WHERE ca.id = ?', [id]
        );
        if (!cardCols.length) return res.status(404).json({ error: 'Card not found' });
        const card = cardCols[0];

        // Verify board membership
        await assertBoardAccess(req.user.id, card.board_id, req.user.is_master);

        if (!req.user.is_admin && !req.user.is_master && card.created_by_user_id !== req.user.id) {
            return res.status(403).json({ error: 'You can only delete your own cards' });
        }
        await pool.query('UPDATE cards SET deleted_at = CURRENT_TIMESTAMP WHERE id = ?', [id]);
        res.json({ success: true });
        broadcastBoardUpdate(card.board_id);
    } catch (error) {
        if (error.status) return res.status(error.status).json({ error: error.message });
        res.status(500).json({ error: error.message });
    }
});

// Clean up soft-deleted cards older than a week (runs once an hour)
setInterval(async () => {
    try {
        await pool.query('DELETE FROM cards WHERE deleted_at < DATE_SUB(NOW(), INTERVAL 1 WEEK)');
    } catch (error) {
        console.error("Cleanup error:", error);
    }
}, 3600000);

// --- GIF Library Routes ---

// Get all GIFs (with optional search)
app.get('/api/gifs', authMiddleware, async (req, res) => {
    const { search, page = 1, limit = 50, filter } = req.query;
    const offset = (Math.max(1, parseInt(page)) - 1) * parseInt(limit);
    try {
        let rows, countRows;
        let where = '';
        const params = [];
        if (filter === 'custom') {
            where += ' AND is_default = 0';
        } else if (filter === 'mine') {
            where += ' AND is_default = 0 AND added_by = ?';
            params.push(req.user.id);
        } else if (filter === 'default') {
            where += ' AND is_default = 1';
        }
        if (search && search.trim()) {
            where += ' AND title LIKE ?';
            params.push(`%${search.trim()}%`);
        }
        const countSql = `SELECT COUNT(*) as total FROM gifs WHERE 1=1${where}`;
        const dataSql = `SELECT * FROM gifs WHERE 1=1${where} ORDER BY is_default DESC, created_at DESC LIMIT ? OFFSET ?`;
        [countRows] = await pool.query(countSql, params);
        [rows] = await pool.query(dataSql, [...params, parseInt(limit), offset]);
        res.json({ gifs: rows, total: countRows[0].total, page: parseInt(page), limit: parseInt(limit) });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Add a GIF to the library (any authenticated user)
app.post('/api/gifs', authMiddleware, async (req, res) => {
    const { url, title } = req.body;
    if (!url || typeof url !== 'string') return res.status(400).json({ error: 'url is required' });
    if (!title || !title.trim()) return res.status(400).json({ error: 'Name is required' });
    const trimmedUrl = url.trim();
    // Validate URL format
    try {
        const parsed = new URL(trimmedUrl);
        if (!/^https?:$/.test(parsed.protocol)) return res.status(400).json({ error: 'URL must be http or https' });
    } catch { return res.status(400).json({ error: 'Invalid URL' }); }
    try {
        const [result] = await pool.query(
            'INSERT INTO gifs (url, preview_url, title, added_by, is_default) VALUES (?, ?, ?, ?, 0)',
            [trimmedUrl, trimmedUrl, (title || '').slice(0, 255), req.user.id]
        );
        res.status(201).json({ id: result.insertId, url: trimmedUrl, preview_url: trimmedUrl, title: title || '', added_by: req.user.id, is_default: 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Upload a GIF file to the library
app.post('/api/gifs/upload', authMiddleware, multer({ storage: multer.diskStorage({
    destination: (req, file, cb) => {
        const dir = path.join(__dirname, 'uploads', 'gifs');
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        cb(null, dir);
    },
    filename: (req, file, cb) => {
        cb(null, `gif_${Date.now()}.gif`);
    }
}), limits: { fileSize: 20 * 1024 * 1024 }, fileFilter: (req, file, cb) => {
    cb(null, /image\//.test(file.mimetype));
}}).single('gif'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file provided' });
    const gifUrl = `/uploads/gifs/${req.file.filename}`;
    const title = (req.body.title || '').trim();
    if (!title) return res.status(400).json({ error: 'Name is required' });
    try {
        const [result] = await pool.query(
            'INSERT INTO gifs (url, preview_url, title, added_by, is_default) VALUES (?, ?, ?, ?, 0)',
            [gifUrl, gifUrl, title, req.user.id]
        );
        res.status(201).json({ id: result.insertId, url: gifUrl, preview_url: gifUrl, title, added_by: req.user.id, is_default: 0 });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Delete a GIF from the library (admin/master, or the user who added it)
app.delete('/api/gifs/:id', authMiddleware, async (req, res) => {
    try {
        const [rows] = await pool.query('SELECT * FROM gifs WHERE id = ?', [req.params.id]);
        if (rows.length === 0) return res.status(404).json({ error: 'GIF not found' });
        const gif = rows[0];
        if (!req.user.is_admin && !req.user.is_master && gif.added_by !== req.user.id) {
            return res.status(403).json({ error: 'You can only delete GIFs you added' });
        }
        // If it's a local file, clean it up
        if (gif.url.startsWith('/uploads/')) {
            const filePath = path.join(__dirname, gif.url);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        await pool.query('DELETE FROM gifs WHERE id = ?', [req.params.id]);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- Frontend static hosting (single-origin web deployment) ---
if (fs.existsSync(FRONTEND_DIST_PATH)) {
    app.use(express.static(FRONTEND_DIST_PATH));
    app.get(/^\/(?!api\/|uploads\/|socket\.io\/).*/, (req, res) => {
        return res.sendFile(path.join(FRONTEND_DIST_PATH, 'index.html'));
    });
}

// --- Start Server (auto-create DB + verify connection) ---
(async () => {
    try {
        pool = await createPool();
        console.log('MySQL connected');
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
        console.error('Failed to connect to MySQL:', err.message);
        process.exit(1);
    }
})();
