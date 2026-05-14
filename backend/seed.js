/**
 * seed.js — Reset and seed the RetroBoard database
 *
 * Usage:
 *   node seed.js           — Create tables and seed defaults (safe, idempotent)
 *   node seed.js --reset   — DROP all tables, recreate, and seed from scratch
 */
const mysql = require('mysql2/promise');
require('dotenv').config();

const { LEADS_BY_DEPT, LEAD_DEFAULT_COLUMNS: CONSTANTS_COLUMNS } = require('./config/constants');

const RESET = process.argv.includes('--reset');

const LEAD_DEFAULT_COLUMNS = CONSTANTS_COLUMNS;

// Derive ALL_LEADS from authoritative LEADS_BY_DEPT in constants.js
const ALL_LEADS = Object.entries(LEADS_BY_DEPT).flatMap(([dept, names]) =>
    names.map(name => ({ name, department: dept }))
);

async function main() {
    const pool = mysql.createPool({
        host: process.env.DB_HOST || 'localhost',
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: process.env.DB_NAME || 'retro_board',
        waitForConnections: true,
        connectionLimit: 5,
    });

    try {
        if (RESET) {
            console.log('⚠  --reset flag detected. Dropping all tables...');
            // Drop in correct order (foreign keys)
            await pool.query('SET FOREIGN_KEY_CHECKS = 0');
            await pool.query('DROP TABLE IF EXISTS cards');
            await pool.query('DROP TABLE IF EXISTS `columns`');
            await pool.query('DROP TABLE IF EXISTS boards');
            await pool.query('DROP TABLE IF EXISTS users');
            await pool.query('DROP TABLE IF EXISTS role_labels');
            await pool.query('SET FOREIGN_KEY_CHECKS = 1');
            console.log('   All tables dropped.');
        }

        // --- Create tables ---
        console.log('Creating tables...');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL UNIQUE,
                first_name VARCHAR(100) NOT NULL DEFAULT '',
                last_name VARCHAR(100) NOT NULL DEFAULT '',
                display_name VARCHAR(150) NOT NULL,
                email VARCHAR(255) NOT NULL UNIQUE,
                department ENUM('QA', 'SE', 'SDET') NOT NULL DEFAULT 'QA',
                \`lead\` VARCHAR(150) DEFAULT NULL,
                is_admin TINYINT(1) NOT NULL DEFAULT 0,
                is_master TINYINT(1) NOT NULL DEFAULT 0,
                password_hash VARCHAR(255) NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('   ✓ users');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS boards (
                id INT AUTO_INCREMENT PRIMARY KEY,
                name VARCHAR(255) NOT NULL,
                department ENUM('QA', 'SE', 'SDET') NOT NULL DEFAULT 'QA',
                bg_image TEXT DEFAULT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        console.log('   ✓ boards');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS \`columns\` (
                id INT AUTO_INCREMENT PRIMARY KEY,
                board_id INT NOT NULL,
                name VARCHAR(255) NOT NULL,
                position INT NOT NULL,
                FOREIGN KEY (board_id) REFERENCES boards(id) ON DELETE CASCADE
            )
        `);
        console.log('   ✓ columns');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS cards (
                id INT AUTO_INCREMENT PRIMARY KEY,
                column_id INT NOT NULL,
                content TEXT NOT NULL,
                position INT NOT NULL,
                created_by VARCHAR(255) DEFAULT NULL,
                deleted_at TIMESTAMP NULL DEFAULT NULL,
                FOREIGN KEY (column_id) REFERENCES \`columns\`(id) ON DELETE CASCADE
            )
        `);
        console.log('   ✓ cards');

        await pool.query(`
            CREATE TABLE IF NOT EXISTS role_labels (
                id INT AUTO_INCREMENT PRIMARY KEY,
                role_key VARCHAR(50) NOT NULL UNIQUE,
                label VARCHAR(100) NOT NULL
            )
        `);
        console.log('   ✓ role_labels');

        // --- Seed defaults ---
        console.log('Seeding defaults...');

        await pool.query(`INSERT IGNORE INTO role_labels (role_key, label) VALUES ('master', 'Iron Fist'), ('admin', 'Admin'), ('user', 'Member')`);
        console.log('   ✓ role_labels defaults');

        for (const lead of ALL_LEADS) {
            const boardName = `Retro - ${lead.name}`;
            const [existing] = await pool.query('SELECT id FROM boards WHERE name = ?', [boardName]);
            let boardId;
            if (existing.length === 0) {
                const [br] = await pool.query('INSERT INTO boards (name, department) VALUES (?, ?)', [boardName, lead.department]);
                boardId = br.insertId;
                console.log(`   ✓ Created board: ${boardName}`);
            } else {
                boardId = existing[0].id;
                console.log(`   – Board exists: ${boardName}`);
            }
            const [existingCols] = await pool.query('SELECT id FROM `columns` WHERE board_id = ?', [boardId]);
            if (existingCols.length === 0) {
                for (let i = 0; i < LEAD_DEFAULT_COLUMNS.length; i++) {
                    await pool.query('INSERT INTO `columns` (board_id, name, position) VALUES (?, ?, ?)', [boardId, LEAD_DEFAULT_COLUMNS[i], i]);
                }
                console.log(`     + Seeded ${LEAD_DEFAULT_COLUMNS.length} columns`);
            }
        }

        console.log('\nDone! Database is ready.');
    } catch (err) {
        console.error('Seed error:', err.message);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();
