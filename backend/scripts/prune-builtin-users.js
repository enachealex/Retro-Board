#!/usr/bin/env node
/**
 * Keep only app head accounts; remove other seeded @openeye.net placeholders and extra admins.
 *
 * Usage (from backend/): node scripts/prune-builtin-users.js
 * Dry run: DRY_RUN=1 node scripts/prune-builtin-users.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

const KEEP_EMAILS = [
    'aenache@openeye.net',
    'enachealex1@gmail.com',
].map((e) => e.toLowerCase());

const DRY_RUN = process.env.DRY_RUN === '1' || process.env.DRY_RUN === 'true';

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'retro_board',
        waitForConnections: true,
        connectionLimit: 2,
    });

    try {
        const [users] = await pool.query(
            'SELECT id, email, username, is_admin, is_master FROM users ORDER BY email'
        );
        const toRemove = users.filter((u) => !KEEP_EMAILS.includes(String(u.email).toLowerCase()));

        console.log(`Keeping ${KEEP_EMAILS.length} head account(s): ${KEEP_EMAILS.join(', ')}`);
        console.log(`Users in DB: ${users.length}; will remove: ${toRemove.length}`);

        if (toRemove.length) {
            console.log('Remove:', toRemove.map((u) => u.email).join(', '));
        }

        if (DRY_RUN) {
            console.log('DRY_RUN=1 — no changes written.');
            return;
        }

        for (const email of KEEP_EMAILS) {
            await pool.query(
                'UPDATE users SET is_master = 1, is_admin = 1 WHERE LOWER(email) = ?',
                [email]
            );
        }

        const removeIds = toRemove.map((u) => u.id);
        if (removeIds.length) {
            const placeholders = removeIds.map(() => '?').join(',');
            await pool.query(`DELETE FROM board_members WHERE user_id IN (${placeholders})`, removeIds);
            await pool.query(`DELETE FROM users WHERE id IN (${placeholders})`, removeIds);
        }

        await pool.query(
            'DELETE FROM admin_emails WHERE LOWER(email) NOT IN (?, ?)',
            KEEP_EMAILS
        );
        await pool.query(
            'DELETE FROM master_emails WHERE LOWER(email) NOT IN (?, ?)',
            KEEP_EMAILS
        );
        for (const email of KEEP_EMAILS) {
            await pool.query('INSERT IGNORE INTO master_emails (email) VALUES (?)', [email]);
        }

        console.log('Done.');
    } finally {
        await pool.end();
    }
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
