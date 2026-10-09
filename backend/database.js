
const Database = require("better-sqlite3");
const path = require("path");

// Store the database inside the backend folder.
const dbPath = path.join(__dirname, "art-gallery.db");
const db = new Database(dbPath);

// Enable foreign-key checks.
db.pragma("foreign_keys = ON");

// Create the artwork table.
db.exec(`
    CREATE TABLE IF NOT EXISTS artworks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        year INTEGER NOT NULL,
        votes INTEGER NOT NULL DEFAULT 0
    );
`);

// Add the initial artwork records only if they don't exist.
const insertArtwork = db.prepare(`
    INSERT OR IGNORE INTO artworks (id, title, artist, year, votes)
    VALUES (?, ?, ?, ?, 0)
`);

const initialArtworks = [
    [1, "The Beginning", "Mantana Art", 2026],
    [2, "Just Classical", "Seso Blade", 2026],
    [3, "The Eye Is the Window to the Soul", "Blade", 2026]
];

const addInitialArtworks = db.transaction(() => {
    for (const artwork of initialArtworks) {
        insertArtwork.run(...artwork);
    }
});

addInitialArtworks();

module.exports = db;