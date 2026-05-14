require('dotenv').config();
const mysql = require('mysql2/promise');

(async () => {
    const p = await mysql.createPool({
        host: 'localhost', user: 'root', password: '', database: 'retro_board'
    });

    // Save existing boards (exclude overflow junk)
    const [boards] = await p.query('SELECT * FROM boards WHERE id < 2147483647 ORDER BY id');
    console.log('Saving', boards.length, 'boards:', boards.map(b => `${b.id}: ${b.name}`));

    await p.query('SET FOREIGN_KEY_CHECKS = 0');
    await p.query('DROP TABLE boards');
    await p.query(`CREATE TABLE boards (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        department ENUM('OWS','Apex','QA','SE') NOT NULL DEFAULT 'QA',
        bg_image TEXT DEFAULT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )`);

    for (const b of boards) {
        await p.query(
            'INSERT INTO boards (id, name, department, bg_image, created_at) VALUES (?,?,?,?,?)',
            [b.id, b.name, b.department, b.bg_image, b.created_at]
        );
    }
    await p.query('SET FOREIGN_KEY_CHECKS = 1');

    const [ai] = await p.query(
        'SELECT AUTO_INCREMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',
        ['retro_board', 'boards']
    );
    console.log('AUTO_INCREMENT now:', ai[0].AUTO_INCREMENT);
    await p.end();
})();
