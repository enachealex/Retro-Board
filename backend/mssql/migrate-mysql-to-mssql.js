/**
 * migrate-mysql-to-mssql.js
 *
 * Export all data from the existing MySQL retro_board database and import it
 * into MS SQL Server, preserving IDs and relationships.
 *
 * Usage:
 *   1. Set environment variables (or edit the config objects below).
 *   2. Run schema.sql against your SQL Server database first.
 *   3. node migrate-mysql-to-mssql.js
 *
 * Environment variables:
 *   MYSQL_HOST, MYSQL_USER, MYSQL_PASSWORD, MYSQL_DB
 *   MSSQL_SERVER, MSSQL_USER, MSSQL_PASSWORD, MSSQL_DB
 */

const mysql = require('mysql2/promise');
const sql = require('mssql');
require('dotenv').config();

// ---- Config ----
const mysqlConfig = {
    host: process.env.MYSQL_HOST || process.env.DB_HOST || '127.0.0.1',
    user: process.env.MYSQL_USER || process.env.DB_USER || 'root',
    password: process.env.MYSQL_PASSWORD || process.env.DB_PASSWORD || '',
    database: process.env.MYSQL_DB || process.env.DB_NAME || 'retro_board',
};

const mssqlConfig = {
    server: process.env.MSSQL_SERVER || 'localhost',
    user: process.env.MSSQL_USER || 'sa',
    password: process.env.MSSQL_PASSWORD || '',
    database: process.env.MSSQL_DB || 'retro_board',
    options: {
        encrypt: true,
        trustServerCertificate: true, // dev only — remove in production
    },
};

// Tables in dependency order (parents before children)
const TABLES = [
    'users',
    'boards',
    'columns',
    'cards',
    'role_labels',
    'admin_emails',
    'master_emails',
    'board_members',
    'gifs',
];

// Column mappings: MySQL bool (TINYINT 0/1) → MSSQL BIT (true/false)
const BOOL_COLUMNS = {
    users: ['is_admin', 'is_master'],
    gifs: ['is_default'],
};

async function migrate() {
    console.log('Connecting to MySQL...');
    const mysqlConn = await mysql.createConnection(mysqlConfig);

    console.log('Connecting to MS SQL Server...');
    const mssqlPool = await sql.connect(mssqlConfig);

    for (const table of TABLES) {
        console.log(`\nMigrating: ${table}`);
        const sqlTable = table === 'columns' ? '[columns]' : table;

        // Read all rows from MySQL
        const [rows] = await mysqlConn.query(`SELECT * FROM \`${table}\``);
        console.log(`  Found ${rows.length} rows`);
        if (rows.length === 0) continue;

        // Enable IDENTITY_INSERT so we can preserve original IDs
        try {
            await mssqlPool.request().query(`SET IDENTITY_INSERT ${sqlTable} ON`);
        } catch { /* table may not have identity */ }

        const columns = Object.keys(rows[0]);

        for (const row of rows) {
            const request = mssqlPool.request();
            const paramNames = [];

            for (let i = 0; i < columns.length; i++) {
                const col = columns[i];
                let val = row[col];

                // Convert MySQL TINYINT booleans to proper booleans for BIT columns
                if (BOOL_COLUMNS[table]?.includes(col)) {
                    val = val ? true : false;
                }

                // Convert MySQL Date objects to JS Date for DATETIME2
                if (val instanceof Date) {
                    // already a Date, mssql driver handles it
                }

                // Null password_hash stays null
                if (val === null || val === undefined) {
                    val = null;
                }

                const paramName = `p${i}`;
                request.input(paramName, val);
                paramNames.push(`@${paramName}`);
            }

            const colList = columns.map(c => c === 'columns' ? '[columns]' : c === 'lead' ? '[lead]' : `[${c}]`).join(', ');
            const insertSql = `INSERT INTO ${sqlTable} (${colList}) VALUES (${paramNames.join(', ')})`;

            try {
                await request.query(insertSql);
            } catch (err) {
                // Skip duplicates (already migrated rows)
                if (err.number === 2627 || err.number === 2601) {
                    // Unique constraint violation — row already exists
                } else {
                    console.error(`  ERROR inserting into ${table}:`, err.message);
                    console.error(`  Row:`, JSON.stringify(row));
                }
            }
        }

        // Disable IDENTITY_INSERT and reseed the identity counter
        try {
            await mssqlPool.request().query(`SET IDENTITY_INSERT ${sqlTable} OFF`);
            // Reseed identity so new inserts continue after the max id
            const result = await mssqlPool.request().query(`SELECT MAX(id) as maxId FROM ${sqlTable}`);
            const maxId = result.recordset[0].maxId || 0;
            await mssqlPool.request().query(`DBCC CHECKIDENT ('${table}', RESEED, ${maxId})`);
        } catch { /* ignore */ }

        console.log(`  Done: ${rows.length} rows migrated`);
    }

    await mysqlConn.end();
    await mssqlPool.close();
    console.log('\nMigration complete!');
}

migrate().catch(err => {
    console.error('Migration failed:', err);
    process.exit(1);
});
