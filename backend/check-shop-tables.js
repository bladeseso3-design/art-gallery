const db = require("./database");

try {
    const tables = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
          AND name LIKE 'shop_%'
        ORDER BY name
    `).all();

    console.table(tables);
} finally {
    db.close();
}
