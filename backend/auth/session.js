const crypto = require('crypto');
const jwt = require('jsonwebtoken');

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        console.error('FATAL: JWT_SECRET environment variable is not set. Exiting.');
        process.exit(1);
    }
    return secret;
}

function normalizeAuthUserId(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) return value;
    const parsed = Number.parseInt(String(value), 10);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
    return null;
}

function verifyJwtDetailed(token, secret = getJwtSecret()) {
    try {
        return { payload: jwt.verify(token, secret), errorCode: null };
    } catch (err) {
        if (err?.name === 'TokenExpiredError') return { payload: null, errorCode: 'TOKEN_EXPIRED' };
        return { payload: null, errorCode: 'TOKEN_INVALID' };
    }
}

function verifyJwt(token, secret = getJwtSecret()) {
    return verifyJwtDetailed(token, secret).payload;
}

function tokenErrorMessage(code) {
    if (code === 'TOKEN_EXPIRED') return 'Your session expired. Please sign in again.';
    if (code === 'MISSING_TOKEN') return 'Unauthorized';
    return 'Invalid or expired token';
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
    if (!password || typeof stored !== 'string') return false;
    const sep = stored.indexOf(':');
    if (sep <= 0) return false;
    const salt = stored.slice(0, sep);
    const hash = stored.slice(sep + 1);
    if (!salt || !/^[0-9a-f]+$/i.test(hash)) return false;
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

/** @deprecated Use verifyJwtDetailed in server middleware instead */
function authMiddleware(req, res, next) {
    const authHeader = req.headers['authorization'];
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized', code: 'MISSING_TOKEN' });
    }
    const { payload, errorCode } = verifyJwtDetailed(authHeader.slice(7));
    if (!payload) {
        return res.status(401).json({ error: tokenErrorMessage(errorCode), code: errorCode || 'TOKEN_INVALID' });
    }
    const userId = normalizeAuthUserId(payload.sub);
    if (!userId) {
        return res.status(401).json({ error: tokenErrorMessage('TOKEN_INVALID'), code: 'TOKEN_INVALID' });
    }
    req.user = { ...payload, sub: userId, id: userId };
    next();
}

module.exports = {
    normalizeAuthUserId,
    verifyJwt,
    verifyJwtDetailed,
    tokenErrorMessage,
    hashPassword,
    verifyPassword,
    authMiddleware,
};
