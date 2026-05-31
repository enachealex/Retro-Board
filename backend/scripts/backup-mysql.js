#!/usr/bin/env node
/**
 * Nightly MySQL backup — keeps BACKUP_RETENTION_DAYS (default 7).
 * Cron example: 0 2 * * * cd /home/romokid64/RetroBoard/backend && node scripts/backup-mysql.js >> logs/backup.log 2>&1
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const BACKUP_DIR = process.env.BACKUP_DIR || path.join(__dirname, '..', 'backups');
const RETENTION_DAYS = Number.parseInt(process.env.BACKUP_RETENTION_DAYS || '7', 10);
const DB_HOST = process.env.DB_HOST || '127.0.0.1';
const DB_USER = process.env.DB_USER || 'root';
const DB_PASSWORD = process.env.DB_PASSWORD || '';
const DB_NAME = process.env.DB_NAME || 'retro_board';

function log(msg) {
    console.log(`[${new Date().toISOString()}] ${msg}`);
}

function pruneOldBackups() {
    if (!fs.existsSync(BACKUP_DIR)) return;
    const cutoff = Date.now() - RETENTION_DAYS * 86400000;
    for (const name of fs.readdirSync(BACKUP_DIR)) {
        if (!/\.sql(\.gz)?$/i.test(name)) continue;
        const full = path.join(BACKUP_DIR, name);
        const stat = fs.statSync(full);
        if (stat.mtimeMs < cutoff) {
            fs.unlinkSync(full);
            log(`pruned ${name}`);
        }
    }
}

function runBackup() {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 10);
    const sqlPath = path.join(BACKUP_DIR, `retro_board-${stamp}.sql`);
    const gzPath = `${sqlPath}.gz`;

    const args = [
        `-h${DB_HOST}`,
        `-u${DB_USER}`,
        `--single-transaction`,
        '--routines',
        '--triggers',
        DB_NAME,
    ];
    const env = { ...process.env, MYSQL_PWD: DB_PASSWORD };
    const dump = spawnSync('mysqldump', args, { env, encoding: 'buffer', maxBuffer: 64 * 1024 * 1024 });
    if (dump.status !== 0) {
        const err = (dump.stderr || dump.stdout || Buffer.alloc(0)).toString('utf8').trim();
        throw new Error(`mysqldump failed: ${err || `exit ${dump.status}`}`);
    }

    fs.writeFileSync(sqlPath, dump.stdout);
    const gzip = spawnSync('gzip', ['-f', sqlPath], { encoding: 'utf8' });
    if (gzip.status !== 0) {
        throw new Error(`gzip failed: ${gzip.stderr || gzip.status}`);
    }

    const sizeMb = (fs.statSync(gzPath).size / 1048576).toFixed(2);
    log(`backup ok ${path.basename(gzPath)} (${sizeMb} MB)`);
    pruneOldBackups();
}

try {
    runBackup();
    process.exit(0);
} catch (err) {
    log(`backup error: ${err.message}`);
    process.exit(1);
}
