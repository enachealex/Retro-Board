const jwt = require('jsonwebtoken');

function getJwtExpiresIn(user) {
    const isMaster = user?.is_master === 1 || user?.is_master === true;
    if (isMaster) {
        return process.env.JWT_EXPIRY_MASTER || process.env.JWT_EXPIRY || '7d';
    }
    return process.env.JWT_EXPIRY_USER || '24h';
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
        email_verified: !!user.email_verified_at,
        is_admin: user.is_admin === 1 || user.is_admin === true,
        is_master: user.is_master === 1 || user.is_master === true,
    };
}

function buildUserToken(user, jwtSecret = process.env.JWT_SECRET) {
    if (!jwtSecret) throw new Error('JWT_SECRET is not configured');
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
        email_verified: !!user.email_verified_at,
        is_admin: user.is_admin === 1 || user.is_admin === true,
        is_master: user.is_master === 1 || user.is_master === true,
        sv: Number(user.session_version || 0),
    }, jwtSecret, { expiresIn: getJwtExpiresIn(user) });
}

function isSessionTokenValid(payload, user) {
    if (!payload || !user) return false;
    return Number(payload.sv ?? 0) === Number(user.session_version || 0);
}

module.exports = {
    getJwtExpiresIn,
    buildUserPublic,
    buildUserToken,
    isSessionTokenValid,
};
