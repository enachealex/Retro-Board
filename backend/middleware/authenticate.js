const {
    normalizeAuthUserId,
    verifyJwtDetailed,
    tokenErrorMessage,
} = require('../auth/session');
const { isSessionTokenValid } = require('../auth/tokens');

function createAuthenticateMiddleware({ pool, jwtSecret, getCurrentUserForAuth, buildUserPublic }) {
    return async function authMiddleware(req, res, next) {
        const authHeader = req.headers['authorization'];
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized', code: 'MISSING_TOKEN' });
        }
        const { payload, errorCode } = verifyJwtDetailed(authHeader.slice(7), jwtSecret);
        if (!payload) {
            return res.status(401).json({
                error: tokenErrorMessage(errorCode),
                code: errorCode || 'TOKEN_INVALID',
            });
        }
        const userId = normalizeAuthUserId(payload.sub);
        if (!userId) {
            return res.status(401).json({ error: tokenErrorMessage('TOKEN_INVALID'), code: 'TOKEN_INVALID' });
        }

        try {
            const currentUser = await getCurrentUserForAuth(userId);
            if (!currentUser) return res.status(401).json({ error: 'User no longer exists', code: 'USER_NOT_FOUND' });
            if (!isSessionTokenValid(payload, currentUser)) {
                return res.status(401).json({
                    error: 'Your session was ended on another device. Please sign in again.',
                    code: 'SESSION_REVOKED',
                });
            }
            if (!currentUser.email_verified_at) {
                return res.status(403).json({
                    error: 'Please confirm your email before continuing.',
                    code: 'EMAIL_NOT_VERIFIED',
                });
            }
            req.authDbUser = currentUser;
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
    };
}

module.exports = { createAuthenticateMiddleware };
