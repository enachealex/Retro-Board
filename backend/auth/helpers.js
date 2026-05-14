const crypto = require('crypto');
const jwt = require('jsonwebtoken');

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

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    return new Promise((resolve, reject) => {
        crypto.scrypt(password, salt, 64, (err, derived) => {
            if (err) reject(err);
            else resolve(salt + ':' + derived.toString('hex'));
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
    next();
}

module.exports = { buildUserToken, buildUserPublic, verifyJwt, hashPassword, verifyPassword, authMiddleware };
