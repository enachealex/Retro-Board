/**
 * Browser CORS allowlist for the RetroBoard API.
 *
 * Only origins that host the RetroBoard SPA and call this API should be listed.
 * Marketing / directory sites (e.g. thejumpvault.com) do not need API access.
 */

/** Always merged into the allowlist (RetroBoard app + known static deploys). */
const REQUIRED_APP_ORIGINS = [
    'https://retroboard.thejumpvault.com',
    'https://api.thejumpvault.com',
    'https://enachealex.github.io',
];

/** Local / LAN dev origins used when NODE_ENV is not production. */
const DEFAULT_DEV_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:5000',
    'https://localhost:5443',
    'http://192.168.1.48',
    'http://192.168.1.48:5173',
    'http://192.168.1.48:5000',
    'https://192.168.1.48:5443',
];

function parseEnvOrigins(raw) {
    return String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
}

function buildAllowedOrigins(options = {}) {
    const nodeEnv = options.nodeEnv || process.env.NODE_ENV || 'development';
    const envOrigins = parseEnvOrigins(process.env.CORS_ORIGINS);

    if (nodeEnv === 'production' && envOrigins.length === 0) {
        console.error('FATAL: CORS_ORIGINS must be set in production (RetroBoard app + LAN origins only). Exiting.');
        process.exit(1);
    }

    const base = envOrigins.length > 0
        ? envOrigins
        : (nodeEnv === 'production' ? [] : DEFAULT_DEV_ORIGINS);

    return Array.from(new Set([...base, ...REQUIRED_APP_ORIGINS]));
}

function createCorsOptions(allowedOrigins, logRejected) {
    const allowed = new Set(allowedOrigins);

    return {
        origin(origin, callback) {
            // Non-browser clients (curl, health checks, some proxies) omit Origin.
            if (!origin) return callback(null, true);
            if (allowed.has(origin)) return callback(null, true);
            if (typeof logRejected === 'function') {
                logRejected(origin);
            }
            return callback(new Error('Not allowed by CORS'));
        },
        methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'x-captcha-trust-token', 'x-reset-fallback-key', 'x-verify-fallback-key'],
        maxAge: 86400,
    };
}

module.exports = {
    REQUIRED_APP_ORIGINS,
    DEFAULT_DEV_ORIGINS,
    buildAllowedOrigins,
    createCorsOptions,
};
