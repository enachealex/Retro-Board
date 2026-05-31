#!/usr/bin/env node
/** List which users can sign in with a password vs need setup. */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const mysql = require('mysql2/promise');

(async () => {
    const pool = await mysql.createPool({
        host: process.env.DB_HOST || '127.0.0.1',
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'retro_board',
    });
    const [rows] = await pool.query(
        `SELECT email,
                (password_hash IS NOT NULL AND TRIM(password_hash) <> '') AS can_password_login,
                (email_verified_at IS NOT NULL) AS verified
         FROM users ORDER BY email`
    );
    console.log('\nEmail                          | Password login | Verified');
    console.log('-------------------------------|----------------|----------');
    for (const row of rows) {
        const email = String(row.email).padEnd(30);
        const pw = row.can_password_login ? 'yes' : 'NO — use Forgot password';
        const ver = row.verified ? 'yes' : 'no';
        console.log(`${email} | ${pw.padEnd(14)} | ${ver}`);
    }
    await pool.end();
})();
