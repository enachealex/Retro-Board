const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME || 'retro_board';

async function createPool() {
    if (!process.env.DB_USER) {
        console.error('FATAL: DB_USER environment variable is not set. Exiting.');
        process.exit(1);
    }
    if (process.env.DB_PASSWORD === undefined || process.env.DB_PASSWORD === '') {
        console.error('FATAL: DB_PASSWORD environment variable is not set. Exiting.');
        process.exit(1);
    }
    const dbHost = process.env.DB_HOST || '127.0.0.1';
    const bootstrapConn = await mysql.createConnection({
        host: dbHost,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
    });
    await bootstrapConn.query('CREATE DATABASE IF NOT EXISTS `' + DB_NAME + '`');
    await bootstrapConn.end();

    return mysql.createPool({
        host: dbHost,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        database: DB_NAME,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0,
        enableKeepAlive: true,
        keepAliveInitialDelay: 10000,
        idleTimeout: 60000
    });
}

module.exports = { createPool, DB_NAME };
