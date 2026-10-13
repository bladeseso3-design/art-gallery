
const db = require("./database");

try {
    const tables = db.prepare(`
        SELECT name
        FROM sqlite_master
        WHERE type = 'table'
        AND name IN ('artworks', 'users', 'competitions', 'votes')
        ORDER BY name
    `).all();

    console.log("\nDATABASE TABLES:");
    console.table(tables);

    const artworks = db.prepare(`
        SELECT id, title, votes
        FROM artworks
        ORDER BY id
    `).all();

    console.log("\nEXISTING ARTWORKS AND VOTE TOTALS:");
    console.table(artworks);

    console.log("\nDatabase test completed.");
} catch (error) {
    console.error("Database test failed:", error.message);
    process.exitCode = 1;
} finally {
    db.close();
}