
require("dotenv").config({ path: require("path").join(__dirname, ".env") });

const express = require("express");
const ModemPay = require("modem-pay").default;
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
const modemPay = process.env.MODEM_SECRET_KEY
    ? new ModemPay(process.env.MODEM_SECRET_KEY, { maxRetries: 0, timeout: 60000 })
    : null;
const scrypt = promisify(crypto.scrypt);

const SESSION_SECRET = process.env.SESSION_SECRET;

if (!SESSION_SECRET || SESSION_SECRET.length < 32) {
    throw new Error(
        "SESSION_SECRET is missing or too short. Check backend/.env."
    );
}

app.disable("x-powered-by");
app.post("/webhooks/modempay", express.raw({
    type: "application/json",
    limit: "32kb"
}), (req, res) => {
    const webhookSecret = process.env.MODEM_WEBHOOK_SECRET;

    if (!webhookSecret || !modemPay) {
        return res.status(503).json({
            error: "Modem Pay webhook is not configured."
        });
    }

    if (!Buffer.isBuffer(req.body)) {
        return res.status(400).json({
            error: "Invalid webhook request body."
        });
    }

    const signature = req.get("x-modem-signature");

    if (!signature) {
        return res.status(400).json({
            error: "Missing webhook signature."
        });
    }

    let verifiedEvent;

    try {
        verifiedEvent = modemPay.webhooks.composeEventDetails(
            req.body.toString("utf8"),
            signature,
            webhookSecret
        );
    } catch (error) {
        console.warn("Modem Pay webhook signature verification failed.");

        return res.status(400).json({
            error: "Invalid webhook signature."
        });
    }

    if (verifiedEvent.event !== "charge.succeeded") {
        return res.status(200).json({
            received: true,
            ignored: true
        });
    }

    const payment = verifiedEvent.payload;

    if (
        !payment ||
        payment.type !== "payment" ||
        payment.status !== "completed" ||
        payment.test_mode !== true ||
        typeof payment.payment_intent_id !== "string" ||
        !payment.payment_intent_id ||
        !Number.isSafeInteger(payment.amount) ||
        payment.amount <= 0 ||
        payment.currency !== "GMD" ||
        !payment.metadata ||
        typeof payment.metadata.order_id !== "string"
    ) {
        return res.status(400).json({
            error: "Payment event details are incomplete or invalid."
        });
    }

    const order = db.prepare(`
        SELECT
            p.id AS payment_id,
            p.order_id,
            p.provider_reference,
            p.payment_status,
            p.amount_minor,
            p.currency AS payment_currency,
            o.order_reference,
            o.order_status,
            o.total_minor,
            o.currency AS order_currency,
            (
                SELECT COUNT(*)
                FROM shop_order_items i
                WHERE i.order_id = p.order_id
            ) AS item_count,
            (
                SELECT artwork_id
                FROM shop_order_items i
                WHERE i.order_id = p.order_id
                ORDER BY i.id
                LIMIT 1
            ) AS artwork_id,
            (
                SELECT quantity
                FROM shop_order_items i
                WHERE i.order_id = p.order_id
                ORDER BY i.id
                LIMIT 1
            ) AS quantity,
            (
                SELECT stock_status
                FROM shop_products sp
                WHERE sp.artwork_id = (
                    SELECT artwork_id
                    FROM shop_order_items i
                    WHERE i.order_id = p.order_id
                    ORDER BY i.id
                    LIMIT 1
                )
            ) AS stock_status
        FROM shop_payments p
        JOIN shop_orders o ON o.id = p.order_id
        WHERE p.provider = 'modem'
          AND p.provider_reference = ?
    `).get(payment.payment_intent_id);

    if (!order) {
        console.error("Modem Pay payment intent did not match a gallery order.");

        return res.status(500).json({
            error: "Payment order match is pending."
        });
    }

    if (
        String(order.order_id) !== payment.metadata.order_id ||
        (
            payment.metadata.order_reference &&
            payment.metadata.order_reference !== order.order_reference
        ) ||
        payment.amount !== order.amount_minor ||
        payment.amount !== order.total_minor ||
        payment.currency !== order.payment_currency ||
        payment.currency !== order.order_currency
    ) {
        console.error("Modem Pay payment details did not match the gallery order.");

        return res.status(400).json({
            error: "Payment details do not match the gallery order."
        });
    }

    if (
        order.payment_status === "paid" &&
        order.order_status === "confirmed" &&
        order.stock_status === "sold"
    ) {
        return res.status(200).json({
            received: true,
            duplicate: true
        });
    }

    if (
        order.payment_status !== "pending" ||
        order.order_status !== "pending" ||
        order.stock_status !== "reserved" ||
        order.item_count !== 1 ||
        order.quantity !== 1
    ) {
        console.error("Modem Pay order is not in an eligible confirmation state.");

        return res.status(409).json({
            error: "Gallery order cannot be confirmed in its current state."
        });
    }

    try {
        const confirmOrder = db.transaction(() => {
            const paymentUpdate = db.prepare(`
                UPDATE shop_payments
                SET payment_status = 'paid',
                    verified_at = CURRENT_TIMESTAMP
                WHERE id = ?
                  AND provider = 'modem'
                  AND provider_reference = ?
                  AND payment_status = 'pending'
            `).run(order.payment_id, payment.payment_intent_id);

            if (paymentUpdate.changes !== 1) {
                throw new Error("Payment state changed before confirmation.");
            }

            const orderUpdate = db.prepare(`
                UPDATE shop_orders
                SET order_status = 'confirmed'
                WHERE id = ?
                  AND order_status = 'pending'
            `).run(order.order_id);

            if (orderUpdate.changes !== 1) {
                throw new Error("Order state changed before confirmation.");
            }

            const stockUpdate = db.prepare(`
                UPDATE shop_products
                SET stock_status = 'sold',
                    updated_at = CURRENT_TIMESTAMP
                WHERE artwork_id = ?
                  AND stock_status = 'reserved'
            `).run(order.artwork_id);

            if (stockUpdate.changes !== 1) {
                throw new Error("Artwork reservation changed before confirmation.");
            }
        });

        confirmOrder();
    } catch (error) {
        console.error("Modem Pay order confirmation failed.");

        return res.status(500).json({
            error: "Payment confirmation could not be completed."
        });
    }

    console.log("Modem Pay payment verified and gallery order confirmed.");

    return res.status(200).json({
        received: true,
        confirmed: true
    });
});

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

    if (
        !/^[a-f0-9]{32}$/i.test(salt) ||
        !/^[a-f0-9]{128}$/i.test(storedKeyHex)
    ) {
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
            error: "Please log in before continuing."
        });
    }

    next();
}

/*
 * Automatically synchronize published competition statuses
 * with their scheduled opening and closing dates.
 *
 * Legacy competitions without published_at are not modified.
 */

function syncScheduledCompetitions() {
    const now = new Date().toISOString();

    db.prepare(`
        UPDATE competitions
        SET status = CASE
            WHEN end_at <= ? THEN 'finished'
            WHEN start_at <= ? THEN 'open'
            ELSE 'closed'
        END,
        updated_at = ?
        WHERE published_at IS NOT NULL
          AND archived_at IS NULL
          AND start_at IS NOT NULL
          AND end_at IS NOT NULL
          AND status <> CASE
              WHEN end_at <= ? THEN 'finished'
              WHEN start_at <= ? THEN 'open'
              ELSE 'closed'
          END
    `).run(now, now, now, now, now);
}


// Require a verified account with administrator privileges.
function requireAdmin(req, res, next) {
    if (!req.session.userId) {
        return res.status(401).json({
            error: "Please log in before accessing the admin panel."
        });
    }

    const user = db.prepare(`
        SELECT id, email, email_verified, role
        FROM users
        WHERE id = ?
    `).get(req.session.userId);

    if (!user || user.email_verified !== 1 || user.role !== "admin") {
        return res.status(403).json({
            error: "Administrator access denied."
        });
    }

    req.adminUser = {
        id: user.id,
        email: user.email
    };

    next();
}

// Health check.
app.get("/api/health", (req, res) => {
    res.json({
        message: "Art Gallery Backend is running!",
        status: "Development"
    });
});

// List existing artwork and competition vote totals.
app.get("/api/artworks", (req, res) => {
    const artworks = db.prepare(`
SELECT id, title, artist, year, votes
FROM artworks
WHERE id IN (1, 2, 3)
ORDER BY id
            `).all();

    res.json({ count: artworks.length, artworks });
});
// Public competition status for the competition page.
app.get("/api/competition/status", (req, res) => {
    const competition = db.prepare(`
        SELECT status
        FROM competitions
        WHERE name = ?
    `).get("main");

    if (!competition) {
        return res.status(404).json({
            error: "Competition is not configured."
        });
    }

    res.json({ status: competition.status });
});

// Public shop catalogue: available original artworks only.
// This route does not create orders or process payments.
app.get("/api/shop/products", (req, res) => {
    try {
        const products = db.prepare(`
            SELECT
                p.artwork_id AS id,
                a.title,
                a.artist,
                a.year,
                p.price_minor,
                p.currency,
                p.stock_status
            FROM shop_products p
            JOIN artworks a ON a.id = p.artwork_id
            WHERE p.stock_status = 'available'
            ORDER BY p.artwork_id
        `).all();

        res.json({
            count: products.length,
            products: products.map((product) => ({
                id: product.id,
                title: product.title,
                artist: product.artist,
                year: product.year,
                price: product.price_minor,
                currency: product.currency,
                stockStatus: product.stock_status
            }))
        });
    } catch (error) {
        console.error("Could not load shop products:", error.message);

        res.status(500).json({
            error: "Unable to load shop products."
        });

    }

});

/*
 * Create an artwork order.
 * Requires a logged-in, verified account.
 * Payment remains pending until Wave confirms it.
 */
app.post("/api/shop/orders", requireLogin, async (req, res) => {
    const paymentMethod = req.body?.paymentMethod;

    if (!["modem", "wave"].includes(paymentMethod)) {
        return res.status(400).json({
            error: "Choose Modem Pay or Manual Wave."
        });
    }

    if (paymentMethod === "wave" && !process.env.WAVE_PAYMENT_NUMBER) {
        return res.status(503).json({
            error: "Manual Wave payments are temporarily unavailable."
        });
    }

    if (paymentMethod === "modem" && !modemPay) {
        return res.status(503).json({
            error: "Modem Pay is temporarily unavailable."
        });
    }
    const artworkId = req.body?.artworkId;
    const customerName = typeof req.body?.customerName === "string"
        ? req.body.customerName.trim()
        : "";
    const fulfilmentMethod = req.body?.fulfilmentMethod;
    const deliveryAddress =
        typeof req.body?.deliveryAddress === "string"
            ? req.body.deliveryAddress.trim()
            : "";

    if (!Number.isSafeInteger(artworkId) || artworkId < 1) {
        return res.status(400).json({
            error: "A valid artworkId is required."
        });
    }

    if (!customerName || customerName.length > 120) {
        return res.status(400).json({
            error: "Customer name is required and must be at most 120 characters."
        });
    }

    if (!["delivery", "collection"].includes(fulfilmentMethod)) {
        return res.status(400).json({
            error: "Choose delivery or collection."
        });
    }

    if (
        fulfilmentMethod === "delivery" &&
        (!deliveryAddress || deliveryAddress.length > 500)
    ) {
        return res.status(400).json({
            error: "A delivery address is required (maximum 500 characters)."
        });
    }

    try {
        const user = db.prepare(`
            SELECT id, email, email_verified
            FROM users
            WHERE id = ?
        `).get(req.session.userId);

        if (!user || user.email_verified !== 1) {
            return res.status(403).json({
                error: "Please verify your email before placing an order."
            });
        }

        const createOrder = db.transaction(() => {
            // Release reservations from unpaid orders older than 30 minutes.
            const expiredOrders = db.prepare(`
                SELECT o.id
                FROM shop_orders o
                JOIN shop_payments p ON p.order_id = o.id
                WHERE o.order_status = 'pending'
                  AND p.payment_status = 'pending'
                  AND p.provider = 'wave'
                  AND o.created_at < datetime('now', '-30 minutes')
            `).all();

            const releaseArtwork = db.prepare(`
                UPDATE shop_products
                SET stock_status = 'available',
                    updated_at = CURRENT_TIMESTAMP
                WHERE artwork_id IN (
                    SELECT artwork_id
                    FROM shop_order_items
                    WHERE order_id = ?
                )
                  AND stock_status = 'reserved'
            `);

            for (const expired of expiredOrders) {
                releaseArtwork.run(expired.id);

                db.prepare(`
                    UPDATE shop_payments
                    SET payment_status = 'cancelled'
                    WHERE order_id = ?
                      AND payment_status = 'pending'
                `).run(expired.id);

                db.prepare(`
                    UPDATE shop_orders
                    SET order_status = 'cancelled'
                    WHERE id = ?
                      AND order_status = 'pending'
                `).run(expired.id);
            }

            // Read the authoritative price and artwork details from SQLite.
            const product = db.prepare(`
                SELECT
                    p.artwork_id,
                    p.price_minor,
                    p.currency,
                    a.title,
                    a.artist
                FROM shop_products p
                JOIN artworks a ON a.id = p.artwork_id
                WHERE p.artwork_id = ?
                  AND p.stock_status = 'available'
            `).get(artworkId);

            if (!product) {
                const error = new Error(
                    "This artwork is unavailable or does not exist."
                );
                error.status = 409;
                throw error;
            }

            const orderReference =
                "AG-" + crypto.randomBytes(12).toString("hex").toUpperCase();

            const orderResult = db.prepare(`
                INSERT INTO shop_orders (
                    order_reference,
                    user_id,
                    customer_name,
                    customer_email,
                    fulfilment_method,
                    delivery_address,
                    currency,
                    total_minor
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                orderReference,
                user.id,
                customerName,
                user.email,
                fulfilmentMethod,
                fulfilmentMethod === "delivery" ? deliveryAddress : null,
                product.currency,
                product.price_minor
            );

            const orderId = Number(orderResult.lastInsertRowid);

            db.prepare(`
                INSERT INTO shop_order_items (
                    order_id,
                    artwork_id,
                    artwork_title,
                    artist_name,
                    unit_price_minor,
                    quantity
                )
                VALUES (?, ?, ?, ?, ?, 1)
            `).run(
                orderId,
                product.artwork_id,
                product.title,
                product.artist,
                product.price_minor
            );

            // A new payment is pending, not paid.
            db.prepare(`
                INSERT INTO shop_payments (
                    order_id,
                    provider,
                    payment_status,
                    amount_minor,
                    currency
                )
                VALUES (?, ?, 'pending', ?, ?)
            `).run(
                orderId,
                paymentMethod,
                product.price_minor,
                product.currency
            );

            // Prevent two customers ordering the same original artwork.
            const reservation = db.prepare(`
                UPDATE shop_products
                SET stock_status = 'reserved',
                    updated_at = CURRENT_TIMESTAMP
                WHERE artwork_id = ?
                  AND stock_status = 'available'
            `).run(product.artwork_id);

            if (reservation.changes !== 1) {
                const error = new Error(
                    "This artwork has just become unavailable."
                );
                error.status = 409;
                throw error;
            }
        
            return {
                orderId,
                orderReference,
                artworkTitle: product.title,
                amount: product.price_minor,
                currency: product.currency,
                paymentStatus: "pending",
                paymentMethod
            };
        });

        const order = createOrder();
        if (paymentMethod === "modem") {
            let intentResponse;

            try {
                intentResponse = await modemPay.paymentIntents.create({
                    amount: order.amount,
                    currency: order.currency,
                    title: order.artworkTitle,
                    description: `Art Gallery order ${order.orderReference}`,
                    customer_name: customerName,
                    customer_email: user.email,
                    metadata: {
                        order_id: String(order.orderId),
                        order_reference: order.orderReference
                    }
                });
            } catch (paymentError) {
                console.error("Modem Pay intent creation failed.");

                return res.status(502).json({
                    error: "Your order was created, but its payment link could not be confirmed. Contact the gallery with order reference " + order.orderReference + " before trying again."
                });
            }

            if (
                !intentResponse?.status ||
                !intentResponse.data?.payment_intent_id ||
                !intentResponse.data?.payment_link
            ) {
                console.error("Modem Pay returned an incomplete payment intent.");

                return res.status(502).json({
                    error: "Your order was created, but Modem Pay did not return a complete payment link. Contact the gallery with order reference " + order.orderReference + "."
                });
            }

            let paymentUrl;

            try {
                paymentUrl = new URL(intentResponse.data.payment_link);
            } catch {
                return res.status(502).json({
                    error: "Your order was created, but Modem Pay returned an invalid checkout link. Contact the gallery with order reference " + order.orderReference + "."
                });
            }

            if (
                paymentUrl.protocol !== "https:" ||
                !["pay.modempay.com", "test.checkout.modempay.com"].includes(paymentUrl.hostname)
            ) {
                console.error("Modem Pay returned an untrusted checkout URL.");

                return res.status(502).json({
                    error: "Your order was created, but its checkout link failed security validation. Contact the gallery with order reference " + order.orderReference + "."
                });
            }

            const paymentReference = db.prepare(`
                UPDATE shop_payments
                SET provider_reference = ?
                WHERE order_id = ?
                  AND provider = 'modem'
                  AND payment_status = 'pending'
            `).run(
                intentResponse.data.payment_intent_id,
                order.orderId
            );

            if (paymentReference.changes !== 1) {
                console.error("Could not save Modem Pay reference for order:", order.orderReference);

                return res.status(502).json({
                    error: "Your order was created, but its payment reference could not be saved. Contact the gallery with order reference " + order.orderReference + "."
                });
            }

            order.paymentLink = paymentUrl.toString();
        }

        if (paymentMethod === "wave") {
            order.paymentInstructions = {
                recipientNumber: process.env.WAVE_PAYMENT_NUMBER,
                reference: order.orderReference,
                message: "Send the exact amount using Wave, then keep your transaction receipt. Your order remains pending until payment is verified."
            };
        }

             
        return res.status(201).json({
            message: "Order created. Payment has not yet been verified.",
            order
        });
    } catch (error) {
        if (error.status === 409) {
            return res.status(409).json({ error: error.message });
        }

        console.error("Could not create shop order:", error.message);

        return res.status(500).json({
            error: "Unable to create the order. Please try again."
        });
    }
});

// Register an account. Verification is required before login.
app.post("/api/auth/register", authLimiter, async (req, res) => {
    const email = typeof req.body?.email === "string"
        ? req.body.email.trim().toLowerCase()
        : "";

    const password = req.body?.password;

    if (
        email.length > 254 ||
        !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    ) {
        return res.status(400).json({
            error: "Please provide a valid email address."
        });
    }

    if (
        typeof password !== "string" ||
        password.length < 12 ||
        Buffer.byteLength(password, "utf8") > 1024
    ) {
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

    if (
        typeof token !== "string" ||
        !/^[a-f0-9]{64}$/i.test(token)
    ) {
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

    res.send(
        "Email verified successfully. You can now log in to the Art Gallery."
    );
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
        user: {
            id: user.id,
            email: user.email,
            emailVerified: true
        }
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

// Return administrator details only after server-side authorization.
app.get("/api/admin/access", requireAdmin, (req, res) => {
    res.json({
        authorized: true,
        admin: {
            id: req.adminUser.id,
            email: req.adminUser.email
        }
    });
});

// Return real database statistics for the admin dashboard.
app.get("/api/admin/dashboard/stats", requireAdmin, (req, res) => {
    try {
        const users = db.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN email_verified = 1 THEN 1 ELSE 0 END) AS verified
            FROM users
        `).get();

        const artworks = db.prepare(`
            SELECT COUNT(*) AS total
            FROM artworks
        `).get();

        const competitions = db.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN status = 'open' THEN 1 ELSE 0 END) AS open,
                SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END) AS closed,
                SUM(CASE WHEN status = 'finished' THEN 1 ELSE 0 END) AS finished
            FROM competitions
        `).get();

        const votes = db.prepare(`
            SELECT COUNT(*) AS total
            FROM votes
        `).get();

        const orders = db.prepare(`
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN order_status = 'pending' THEN 1 ELSE 0 END) AS pending
            FROM shop_orders
        `).get();

        res.json({
            success: true,
            statistics: {
                users: {
                    total: users.total,
                    verified: users.verified || 0
                },
                artworks: {
                    total: artworks.total
                },
                competitions: {
                    total: competitions.total,
                    open: competitions.open || 0,
                    closed: competitions.closed || 0,
                    finished: competitions.finished || 0
                },
                votes: {
                    total: votes.total
                },
                orders: {
                    total: orders.total,
                    pending: orders.pending || 0
                }
            }
        });
    } catch (error) {
        console.error("Admin dashboard statistics error:", error);

        res.status(500).json({
            error: "Unable to load dashboard statistics."
        });
    }
});


// Return registered user accounts for administrator management.
app.get("/api/admin/users", requireAdmin, (req, res) => {
    try {
        const users = db.prepare(`
            SELECT
                id,
                email,
                email_verified,
                role,
                created_at
            FROM users
            ORDER BY id DESC
        `).all();

        res.json({
            success: true,
            total: users.length,
            users: users.map(user => ({
                id: user.id,
                email: user.email,
                emailVerified: user.email_verified === 1,
                role: user.role,
                createdAt: user.created_at
            }))
        });

    } catch (error) {
        console.error("Admin user management error:", error);

        res.status(500).json({
            error: "Unable to retrieve registered users."
        });
    }
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


// Return all artworks and their shop information for administrators.
app.get("/api/admin/artworks", requireAdmin, (req, res) => {
    try {
        const artworks = db.prepare(`
            SELECT
                a.id,
                a.title,
                a.artist,
                a.year,
                a.votes,
                p.price_minor,
                p.currency,
                p.stock_status
            FROM artworks a
            LEFT JOIN shop_products p
                ON p.artwork_id = a.id
            ORDER BY a.id DESC
        `).all();

        res.json({
            success: true,
            total: artworks.length,
            artworks: artworks.map(artwork => ({
                id: artwork.id,
                title: artwork.title,
                artist: artwork.artist,
                year: artwork.year,
                votes: artwork.votes,
                shop: artwork.price_minor === null
                    ? null
                    : {
                        price: artwork.price_minor,
                        currency: artwork.currency,
                        stockStatus: artwork.stock_status
                    }
            }))
        });

    } catch (error) {
        console.error("Admin artwork management error:", error);

        res.status(500).json({
            error: "Unable to retrieve artworks."
        });
    }
});

// Update artwork details without changing votes or shop records.
app.put("/api/admin/artworks/:id", requireAdmin, (req, res) => {
    try {
        const artworkId = Number(req.params.id);
        const { title, artist, year } = req.body;

        if (!Number.isSafeInteger(artworkId) || artworkId < 1) {
            return res.status(400).json({
                error: "Invalid artwork ID."
            });
        }

        if (
            typeof title !== "string" ||
            typeof artist !== "string" ||
            !title.trim() ||
            !artist.trim() ||
            title.trim().length > 150 ||
            artist.trim().length > 100
        ) {
            return res.status(400).json({
                error: "Enter a valid artwork title and artist name."
            });
        }

        const artworkYear = Number(year);

        if (
            !Number.isInteger(artworkYear) ||
            artworkYear < 1000 ||
            artworkYear > 9999
        ) {
            return res.status(400).json({
                error: "Enter a valid four-digit artwork year."
            });
        }

        const existingArtwork = db.prepare(`
            SELECT id
            FROM artworks
            WHERE id = ?
        `).get(artworkId);

        if (!existingArtwork) {
            return res.status(404).json({
                error: "Artwork not found."
            });
        }

        db.prepare(`
            UPDATE artworks
            SET title = ?, artist = ?, year = ?
            WHERE id = ?
        `).run(
            title.trim(),
            artist.trim(),
            artworkYear,
            artworkId
        );

        res.json({
            success: true,
            message: "Artwork details updated successfully."
        });

    } catch (error) {
        console.error("Admin artwork update error:", error);

        res.status(500).json({
            error: "Unable to update artwork."
        });
    }
});

// Create a new monthly competition as an unpublished draft.
app.post("/api/admin/competitions", requireAdmin, (req, res) => {
    try {
        const { name, description, startAt, endAt } = req.body;

        if (
            typeof name !== "string" ||
            !name.trim() ||
            name.trim().length > 150
        ) {
            return res.status(400).json({
                error: "Enter a competition title of up to 150 characters."
            });
        }

        if (
            description !== undefined &&
            (typeof description !== "string" ||
             description.length > 2000)
        ) {
            return res.status(400).json({
                error: "Description must not exceed 2000 characters."
            });
        }

        const startDate = new Date(startAt);
        const endDate = new Date(endAt);

        if (
            typeof startAt !== "string" ||
            typeof endAt !== "string" ||
            !Number.isFinite(startDate.getTime()) ||
            !Number.isFinite(endDate.getTime())
        ) {
            return res.status(400).json({
                error: "Provide valid opening and closing dates."
            });
        }

        if (endDate <= startDate) {
            return res.status(400).json({
                error: "The closing date must be after the opening date."
            });
        }

        const competitionName = name.trim();

        const existing = db.prepare(`
            SELECT id
            FROM competitions
            WHERE name = ?
        `).get(competitionName);

        if (existing) {
            return res.status(409).json({
                error: "A competition with this title already exists."
            });
        }

        const result = db.prepare(`
            INSERT INTO competitions (
                name,
                description,
                status,
                start_at,
                end_at,
                created_at,
                updated_at
            )
            VALUES (?, ?, 'closed', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        `).run(
            competitionName,
            (description || "").trim(),
            startDate.toISOString(),
            endDate.toISOString()
        );

        res.status(201).json({
            success: true,
            message: "Competition draft created successfully.",
            competition: {
                id: Number(result.lastInsertRowid),
                name: competitionName,
                description: (description || "").trim(),
                status: "draft",
                start_at: startDate.toISOString(),
                end_at: endDate.toISOString()
            }
        });

    } catch (error) {
        console.error("Competition creation error:", error);

        res.status(500).json({
            error: "Unable to create competition."
        });
    }
});


// List monthly competitions for the administrator.
app.get("/api/admin/competitions", requireAdmin, (req, res) => {
    try {
        const competitions = db.prepare(`
            SELECT
                c.id,
                c.name,
                c.description,
                c.status,
                c.start_at,
                c.end_at,
                c.published_at,
                c.archived_at,
                c.created_at,
                c.updated_at,

                CASE
                    WHEN c.archived_at IS NOT NULL THEN 'archived'
                    WHEN c.published_at IS NULL THEN 'draft'
                    WHEN c.status = 'finished' THEN 'finished'
                    WHEN c.status = 'open' THEN 'open'
                    ELSE 'scheduled'
                END AS display_status,

                (
                    SELECT COUNT(*)
                    FROM competition_artworks ca
                    WHERE ca.competition_id = c.id
                ) AS artwork_count

            FROM competitions c
            WHERE c.name <> 'main'
            ORDER BY c.created_at DESC, c.id DESC
        `).all();

        res.json({
            success: true,
            total: competitions.length,
            competitions
        });

    } catch (error) {
        console.error("Admin competition listing error:", error);

        res.status(500).json({
            error: "Unable to retrieve competitions."
        });
    }
});


// Save the artworks selected for an unpublished competition.
app.put("/api/admin/competitions/:id/artworks", requireAdmin, (req, res) => {
    try {
        const competitionId = Number(req.params.id);
        const { artworkIds } = req.body;

        if (!Number.isSafeInteger(competitionId) || competitionId < 1) {
            return res.status(400).json({
                error: "Invalid competition ID."
            });
        }

        if (
            !Array.isArray(artworkIds) ||
            !artworkIds.every(id =>
                Number.isSafeInteger(id) && id > 0
            )
        ) {
            return res.status(400).json({
                error: "Provide a valid array of artwork IDs."
            });
        }

        if (new Set(artworkIds).size !== artworkIds.length) {
            return res.status(400).json({
                error: "Duplicate artwork IDs are not allowed."
            });
        }

        const competition = db.prepare(`
            SELECT id, name, published_at, archived_at
            FROM competitions
            WHERE id = ?
        `).get(competitionId);

        if (!competition || competition.name === "main") {
            return res.status(404).json({
                error: "Monthly competition not found."
            });
        }

        if (
            competition.published_at !== null ||
            competition.archived_at !== null
        ) {
            return res.status(409).json({
                error: "Artwork selection cannot be changed after publishing or archiving."
            });
        }

        if (artworkIds.length > 0) {
            const placeholders = artworkIds.map(() => "?").join(",");

            const existingArtworks = db.prepare(`
                SELECT id
                FROM artworks
                WHERE id IN (${placeholders})
            `).all(...artworkIds);

            if (existingArtworks.length !== artworkIds.length) {
                return res.status(400).json({
                    error: "One or more selected artworks do not exist."
                });
            }
        }

        const saveSelection = db.transaction(() => {
            db.prepare(`
                DELETE FROM competition_artworks
                WHERE competition_id = ?
            `).run(competitionId);

            const insertArtwork = db.prepare(`
                INSERT INTO competition_artworks (
                    competition_id,
                    artwork_id
                )
                VALUES (?, ?)
            `);

            for (const artworkId of artworkIds) {
                insertArtwork.run(competitionId, artworkId);
            }
        });

        saveSelection();

        res.json({
            success: true,
            message: "Competition artwork selection saved successfully.",
            competitionId,
            artworkIds,
            total: artworkIds.length
        });

    } catch (error) {
        console.error("Competition artwork selection error:", error);

        res.status(500).json({
            error: "Unable to save competition artwork selection."
        });
    }
});


// Retrieve the artworks selected for a monthly competition.
app.get("/api/admin/competitions/:id/artworks", requireAdmin, (req, res) => {
    try {
        const competitionId = Number(req.params.id);

        if (!Number.isSafeInteger(competitionId) || competitionId < 1) {
            return res.status(400).json({
                error: "Invalid competition ID."
            });
        }

        const competition = db.prepare(`
            SELECT id, name, description, status,
                   start_at, end_at, published_at, archived_at
            FROM competitions
            WHERE id = ? AND name <> 'main'
        `).get(competitionId);

        if (!competition) {
            return res.status(404).json({
                error: "Monthly competition not found."
            });
        }

        const artworks = db.prepare(`
            SELECT
                a.id,
                a.title,
                a.artist,
                a.year,
                a.votes
            FROM competition_artworks ca
            JOIN artworks a ON a.id = ca.artwork_id
            WHERE ca.competition_id = ?
            ORDER BY a.id
        `).all(competitionId);

        res.json({
            success: true,
            competition,
            total: artworks.length,
            artworks
        });

    } catch (error) {
        console.error("Competition artwork retrieval error:", error);

        res.status(500).json({
            error: "Unable to retrieve competition artworks."
        });
    }
});


// Publish a monthly competition after validating its configuration.
app.post("/api/admin/competitions/:id/publish", requireAdmin, (req, res) => {
    try {
        const competitionId = Number(req.params.id);

        if (!Number.isSafeInteger(competitionId) || competitionId < 1) {
            return res.status(400).json({
                error: "Invalid competition ID."
            });
        }

        const competition = db.prepare(`
            SELECT id, name, start_at, end_at, published_at, archived_at
            FROM competitions
            WHERE id = ?
        `).get(competitionId);

        if (!competition || competition.name === "main") {
            return res.status(404).json({
                error: "Monthly competition not found."
            });
        }

        if (competition.published_at !== null) {
            return res.status(409).json({
                error: "This competition has already been published."
            });
        }

        if (competition.archived_at !== null) {
            return res.status(409).json({
                error: "Archived competitions cannot be published."
            });
        }

        if (!competition.start_at || !competition.end_at) {
            return res.status(400).json({
                error: "Competition opening and closing dates are required."
            });
        }

        const startDate = new Date(competition.start_at);
        const endDate = new Date(competition.end_at);

        if (
            !Number.isFinite(startDate.getTime()) ||
            !Number.isFinite(endDate.getTime()) ||
            endDate <= startDate
        ) {
            return res.status(400).json({
                error: "Competition dates are invalid."
            });
        }

        const artworkCount = db.prepare(`
            SELECT COUNT(*) AS total
            FROM competition_artworks
            WHERE competition_id = ?
        `).get(competitionId).total;

        if (artworkCount < 1) {
            return res.status(400).json({
                error: "Select at least one artwork before publishing."
            });
        }

        const now = new Date().toISOString();

        const status =
            endDate <= new Date(now) ? "finished" :
            startDate <= new Date(now) ? "open" :
            "closed";

        db.prepare(`
            UPDATE competitions
            SET published_at = ?,
                status = ?,
                updated_at = ?
            WHERE id = ?
              AND published_at IS NULL
              AND archived_at IS NULL
        `).run(now, status, now, competitionId);

        res.json({
            success: true,
            message: "Competition published successfully.",
            competitionId,
            status
        });

    } catch (error) {
        console.error("Competition publishing error:", error);

        res.status(500).json({
            error: "Unable to publish competition."
        });
    }
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
`).get("main");    if (!competition || competition.status !== "open") {
        return res.status(403).json({
            error: "Voting is currently closed."
        });
    }
    const competitionArtworkIds = [1, 2, 3];

if (!competitionArtworkIds.includes(artworkId)) {
    return res.status(403).json({
        error: "This artwork is not part of the competition."
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
        WHERE id IN (1, 2, 3)
        ORDER BY votes DESC, id ASC
    `).all();

    res.json({ results });
});


// Archive a completed monthly competition without deleting its history.
app.post("/api/admin/competitions/:id/archive", requireAdmin, (req, res) => {
    try {
        const competitionId = Number(req.params.id);

        if (!Number.isSafeInteger(competitionId) || competitionId < 1) {
            return res.status(400).json({
                error: "Invalid competition ID."
            });
        }

        const competition = db.prepare(`
            SELECT id, name, status, published_at, archived_at, end_at
            FROM competitions
            WHERE id = ?
        `).get(competitionId);

        if (!competition || competition.name === "main") {
            return res.status(404).json({
                error: "Monthly competition not found."
            });
        }

        if (competition.archived_at !== null) {
            return res.status(409).json({
                error: "This competition is already archived."
            });
        }

        if (
            competition.published_at === null ||
            competition.status !== "finished" ||
            !competition.end_at ||
            new Date(competition.end_at).getTime() > Date.now()
        ) {
            return res.status(409).json({
                error: "Only completed competitions can be archived."
            });
        }

        const now = new Date().toISOString();

        db.prepare(`
            UPDATE competitions
            SET archived_at = ?,
                updated_at = ?
            WHERE id = ?
              AND archived_at IS NULL
        `).run(now, now, competitionId);

        res.json({
            success: true,
            message: "Competition archived successfully.",
            competitionId,
            archivedAt: now
        });

    } catch (error) {
        console.error("Competition archive error:", error);

        res.status(500).json({
            error: "Unable to archive competition."
        });
    }
});



// Return vote totals for one specific monthly competition.
app.get("/api/competitions/:id/results", (req, res) => {
    try {
        const competitionId = Number(req.params.id);

        if (!Number.isSafeInteger(competitionId) || competitionId < 1) {
            return res.status(400).json({
                error: "Invalid competition ID."
            });
        }

        const competition = db.prepare(`
            SELECT id, name, status, published_at, archived_at
            FROM competitions
            WHERE id = ?
              AND name <> 'main'
              AND published_at IS NOT NULL
        `).get(competitionId);

        if (!competition) {
            return res.status(404).json({
                error: "Published monthly competition not found."
            });
        }

        const results = db.prepare(`
            SELECT
                a.id,
                a.title,
                a.artist,
                a.year,
                COUNT(v.id) AS votes
            FROM competition_artworks ca
            JOIN artworks a
                ON a.id = ca.artwork_id
            LEFT JOIN votes v
                ON v.artwork_id = a.id
               AND v.competition_id = ca.competition_id
            WHERE ca.competition_id = ?
            GROUP BY a.id, a.title, a.artist, a.year
            ORDER BY votes DESC, a.id ASC
        `).all(competitionId);

        res.json({
            success: true,
            competition,
            total: results.length,
            totalVotes: results.reduce(
                (sum, artwork) => sum + artwork.votes,
                0
            ),
            results
        });

    } catch (error) {
        console.error("Competition results error:", error);

        res.status(500).json({
            error: "Unable to retrieve competition results."
        });
    }
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

    // Synchronize competition statuses when the server starts.
    try {
        syncScheduledCompetitions();
    } catch (error) {
        console.error("Competition scheduling error:", error.message);
    }
});

// Check scheduled competitions every 30 seconds.
const competitionScheduler = setInterval(() => {
    try {
        syncScheduledCompetitions();
    } catch (error) {
        console.error("Competition scheduling error:", error.message);
    }
}, 30000);

// Close resources cleanly when stopping the server.
function shutdown() {
    clearInterval(competitionScheduler);

    server.close(() => {
        db.close();
        process.exit(0);
    });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
