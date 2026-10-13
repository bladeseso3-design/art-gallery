
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const express = require("express");
const path = require("path");
const crypto = require("crypto");
const { promisify } = require("util");
const session = require("express-session");
const { rateLimit } = require("express-rate-limit");
const SqliteStore = require("better-sqlite3-session-store")(session);
const db = require("./database");

const app = express();
const PORT = Number(process.env.PORT) || 3000;
const galleryRoot = path.join(__dirname, "..");
const scrypt = promisify(crypto.scrypt);

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error("SESSION_SECRET is missing or too short. Check backend/.env.");
}

app.disable("x-powered-by");
app.use(express.json({ limit: "10kb" }));

// Persistent sessions stored in the existing SQLite database.
app.use(session({
    name: "art_gallery.sid",
    secret: SESSION_SECRET,
    store: new SqliteStore({
        client: db,
        expired: { clear: true, intervalMs: 900000 }
    }),
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge: 8 * 60 * 60 * 1000
    }
}));

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: {
        error: "Too many attempts. Please wait 15 minutes and try again."
    }
});

function hashToken(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
}

async function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString("hex");
    const derivedKey = await scrypt(password, salt, 64);

    return `scrypt$${salt}$${derivedKey.toString("hex")}`;
}

async function verifyPassword(password, storedHash) {
    const parts = storedHash.split("$");

    if (parts.length !== 3 || parts[0] !== "scrypt") {
        return false;
    }

    const [, salt, storedKeyHex] = parts;

    if (!/^[a-f0-9]{32}$/i.test(salt) ||
        !/^[a-f0-9]{128}$/i.test(storedKeyHex)) {
        return false;
    }

    const storedKey = Buffer.from(storedKeyHex, "hex");
    const suppliedKey = await scrypt(password, salt, 64);

    return crypto.timingSafeEqual(storedKey, suppliedKey);
}

function regenerateSession(req) {
    return new Promise((resolve, reject) => {
        req.session.regenerate((err) => err ? reject(err) : resolve());
    });
}

function saveSession(req) {
    return new Promise((resolve, reject) => {
        req.session.save((err) => err ? reject(err) : resolve());
    });
}

function requireLogin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            error: "Please log in before voting."
        });
    }

    next();
}

// Health check.
app.get("/api/health", (req, res) => {
    res.json({
        message: "Art Gallery Backend is running!",
        status: "Development"
    });
});

// List existing artwork without exposing private account data.
app.get("/api/artworks", (req, res) => {
    const artworks = db.prepare(`
        SELECT id, title, artist, year, votes
        FROM artworks
        ORDER BY id
    `).all();

    res.json({ count: artworks.length, artworks });
});

// Register an account. Verification is required before login.
app.post("/api/auth/register", authLimiter, async (req, res) => {
    const email = typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password = req.body?.password;

    if (email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({
            error: "Please provide a valid email address."
        });
    }

    if (typeof password !== "string" ||
        password.length < 12 ||
        Buffer.byteLength(password, "utf8") > 1024) {
        return res.status(400).json({
            error: "Password must be at least 12 characters and no more than 1024 bytes."
        });
    }

    const existing = db.prepare(
        "SELECT id FROM users WHERE email = ?"
    ).get(email);

    if (existing) {
        return res.status(409).json({
            error: "An account with this email already exists."
        });
    }

    const passwordHash = await hashPassword(password);
    const token = crypto.randomBytes(32).toString("hex");
    const tokenHash = hashToken(token);
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    db.prepare(`
        INSERT INTO users (
            email,
            password_hash,
            email_verified,
            email_verification_token_hash,
            email_verification_expires_at
        )
        VALUES (?, ?, 0, ?, ?)
    `).run(email, passwordHash, tokenHash, expiresAt);

    // Development only: do not send verification tokens to public responses.
    if (process.env.NODE_ENV !== "production") {
        console.log(
            "Development-only email verification URL:",
            `http://localhost:${PORT}/api/auth/verify?token=${token}`
        );
    }

    res.status(201).json({
        message: "Account created. Verify your email before logging in."
    });
});

// Verify an email using the one-time token.
app.get("/api/auth/verify", (req, res) => {
    const token = req.query.token;

    if (typeof token !== "string" ||
        !/^[a-f0-9]{64}$/i.test(token)) {
        return res.status(400).send("Invalid verification link.");
    }

    const user = db.prepare(`
        SELECT id
        FROM users
        WHERE email_verification_token_hash = ?
          AND email_verification_expires_at > ?
          AND email_verified = 0
    `).get(hashToken(token), new Date().toISOString());

    if (!user) {
        return res.status(400).send(
            "This verification link is invalid, expired, or already used."
        );
    }

    db.prepare(`
        UPDATE users
        SET email_verified = 1,
            email_verification_token_hash = NULL,
            email_verification_expires_at = NULL
        WHERE id = ?
    `).run(user.id);

    res.send("Email verified successfully. You can now log in to the Art Gallery.");
});

// Log in only after email verification.
app.post("/api/auth/login", authLimiter, async (req, res) => {
    const email = typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password = req.body?.password;

    if (typeof password !== "string" || password.length > 1024) {
        return res.status(400).json({
            error: "Please provide a valid email and password."
        });
    }

    const user = db.prepare(`
        SELECT id, email, password_hash, email_verified
        FROM users
        WHERE email = ?
    `).get(email);

    // Use a generic error for unknown email and incorrect password.
    if (!user || !(await verifyPassword(password, user.password_hash))) {
        return res.status(401).json({
            error: "Invalid email or password."
        });
    }

    if (user.email_verified !== 1) {
        return res.status(403).json({
            error: "Please verify your email before logging in."
        });
    }

    await regenerateSession(req);
    req.session.userId = user.id;
    await saveSession(req);

    res.json({
        message: "Login successful.",
        user: { id: user.id, email: user.email, emailVerified: true }
    });
});

// Return the current account without revealing its password hash.
app.get("/api/auth/me", (req, res) => {
    if (!req.session.userId) {
        return res.status(401).json({ error: "Not logged in." });
    }

    const user = db.prepare(`
        SELECT id, email, email_verified
        FROM users
        WHERE id = ?
    `).get(req.session.userId);

    if (!user) {
        return req.session.destroy(() => {
            res.clearCookie("art_gallery.sid");
            res.status(401).json({ error: "Account not found." });
        });
    }

    res.json({
        user: {
            id: user.id,
            email: user.email,
            emailVerified: user.email_verified === 1
        }
    });
});

// Log out and invalidate the session.
app.post("/api/auth/logout", (req, res, next) => {
    req.session.destroy((err) => {
        if (err) return next(err);

        res.clearCookie("art_gallery.sid", {
            httpOnly: true,
            sameSite: "lax",
            secure: process.env.NODE_ENV === "production"
        });

        res.json({ message: "Logged out successfully." });
    });
});

// Vote only when logged in, verified, and the competition is open.
app.post("/api/vote", requireLogin, (req, res) => {
    const artworkId = req.body?.artworkId;

    if (!Number.isSafeInteger(artworkId) || artworkId < 1) {
        return res.status(400).json({
            error: "Please provide a valid positive artworkId."
        });
    }

    const user = db.prepare(`
        SELECT id, email_verified
        FROM users
        WHERE id = ?
    `).get(req.session.userId);

    if (!user || user.email_verified !== 1) {
        return res.status(403).json({
            error: "A verified account is required to vote."
        });
    }

    const competition = db.prepare(`
        SELECT id, status
        FROM competitions
        WHERE name = ?
    `).get("main");

    if (!competition || competition.status !== "open") {
        return res.status(403).json({
            error: "Voting is currently closed."
        });
    }

    const artwork = db.prepare(
        "SELECT id FROM artworks WHERE id = ?"
    ).get(artworkId);

    if (!artwork) {
        return res.status(404).json({ error: "Artwork not found." });
    }

    try {
        const castVote = db.transaction(() => {
            db.prepare(`
                INSERT INTO votes (user_id, competition_id, artwork_id)
                VALUES (?, ?, ?)
            `).run(user.id, competition.id, artworkId);

            db.prepare(`
                UPDATE artworks
                SET votes = votes + 1
                WHERE id = ?
            `).run(artworkId);
        });

        castVote();

        const updated = db.prepare(`
            SELECT id, title, votes
            FROM artworks
            WHERE id = ?
        `).get(artworkId);

        res.status(201).json({
            message: "Vote recorded successfully.",
            ...updated
        });
    } catch (error) {
        if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
            return res.status(409).json({
                error: "You have already voted in this competition."
            });
        }

        throw error;
    }
});

// Show existing vote totals.
app.get("/api/results", (req, res) => {
    const results = db.prepare(`
        SELECT id, title, artist, votes
        FROM artworks
        ORDER BY votes DESC, id ASC
    `).all();

    res.json({ results });
});

// Serve the existing website without changing its files.
app.use(express.static(galleryRoot));

// Basic JSON error handling.
app.use((err, req, res, next) => {
    console.error("Request failed:", err.message);

    if (res.headersSent) {
        return next(err);
    }

    res.status(500).json({
        error: "An unexpected server error occurred."
    });
});

const server = app.listen(PORT, () => {
    console.log(`Art Gallery running at http://localhost:${PORT}`);
});

// Close resources cleanly when stopping the server.
function shutdown() {
    server.close(() => {
        db.close();
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);