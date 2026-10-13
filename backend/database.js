
const Database = require("better-sqlite3");
const path = require("path");

const dbPath = path.join(__dirname, "art-gallery.db");
const db = new Database(dbPath);

db.pragma("foreign_keys = ON");

// Keep the existing artwork table and its vote totals.
db.exec(`
    CREATE TABLE IF NOT EXISTS artworks (
        id INTEGER PRIMARY KEY,
        title TEXT NOT NULL,
        artist TEXT NOT NULL,
        year INTEGER NOT NULL,
        votes INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT NOT NULL COLLATE NOCASE UNIQUE,
        password_hash TEXT NOT NULL,
        email_verified INTEGER NOT NULL DEFAULT 0
            CHECK (email_verified IN (0, 1)),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS competitions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'closed'
            CHECK (status IN ('closed', 'open', 'finished')),
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS votes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        competition_id INTEGER NOT NULL,
        artwork_id INTEGER NOT NULL,
        created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

        FOREIGN KEY (user_id) REFERENCES users(id),
        FOREIGN KEY (competition_id) REFERENCES competitions(id),
        FOREIGN KEY (artwork_id) REFERENCES artworks(id),

        UNIQUE (user_id, competition_id)
    );
`);

// Insert initial artworks only if their IDs do not already exist.
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


/*
 * Safely add email-verification fields if they do not exist.
 * This also supports databases created with an earlier schema.
 */
const existingUserColumns = db
    .prepare("PRAGMA table_info(users)")
    .all()
    .map((column) => column.name);

if (!existingUserColumns.includes("email_verification_token_hash")) {
    db.exec(`
        ALTER TABLE users
        ADD COLUMN email_verification_token_hash TEXT
    `);
}

if (!existingUserColumns.includes("email_verification_expires_at")) {
    db.exec(`
        ALTER TABLE users
        ADD COLUMN email_verification_expires_at TEXT
    `);
}

addInitialArtworks();

// Create the initial competition as closed.
db.prepare(`
    INSERT OR IGNORE INTO competitions (name, status)
    VALUES (?, 'closed')
`).run("main");

module.exports = db;
