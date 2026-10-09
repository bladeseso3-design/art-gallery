
const express = require("express");
const path = require("path");
const db = require("./database");

const app = express();
const PORT = 3000;
const galleryRoot = path.join(__dirname, "..");

app.use(express.json({ limit: "10kb" }));

// Serve the existing gallery locally without changing its files.
app.use(express.static(galleryRoot));

app.get("/api/health", (req, res) => {
    res.json({
        message: "Art Gallery Backend is running!",
        status: "Development"
    });
});

// Read artwork records from SQLite.
app.get("/api/artworks", (req, res) => {
    const artworks = db.prepare(`
        SELECT id, title, artist, year, votes
        FROM artworks
        ORDER BY id
    `).all();

    res.json({
        count: artworks.length,
        artworks
    });
});

// Record a prototype vote.
// Do not expose this unauthenticated route publicly.
app.post("/api/vote", (req, res) => {
    const artworkId = req.body?.artworkId;

    if (!Number.isSafeInteger(artworkId) || artworkId < 1) {
        return res.status(400).json({
            error: "Please provide a valid positive artworkId."
        });
    }

    const artwork = db.prepare(
        "SELECT id, title FROM artworks WHERE id = ?"
    ).get(artworkId);

    if (!artwork) {
        return res.status(404).json({
            error: "Artwork not found."
        });
    }

    db.prepare(
        "UPDATE artworks SET votes = votes + 1 WHERE id = ?"
    ).run(artworkId);

    const updated = db.prepare(
        "SELECT id, title, votes FROM artworks WHERE id = ?"
    ).get(artworkId);

    res.json({
        message: "Prototype vote recorded.",
        ...updated
    });
});

// Show vote totals.
app.get("/api/results", (req, res) => {
    const results = db.prepare(`
        SELECT id, title, artist, votes
        FROM artworks
        ORDER BY votes DESC, id ASC
    `).all();

    res.json({ results });
});

app.listen(PORT, () => {
    console.log(`Art Gallery running at http://localhost:${PORT}`);
});