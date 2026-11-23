const Database = require("better-sqlite3");

const db = new Database("art-gallery.db");

try {
    db.pragma("foreign_keys = ON");

    const migrate = db.transaction(() => {
        const current = db.prepare(`
            SELECT sql
            FROM sqlite_master
            WHERE type = 'table' AND name = 'shop_payments'
        `).get();

        if (!current) {
            throw new Error("shop_payments table does not exist.");
        }

        if (current.sql.includes("'modem'")) {
            console.log("Migration already applied. No changes needed.");
            return;
        }

        const before = db.prepare(
            "SELECT COUNT(*) AS total FROM shop_payments"
        ).get().total;

        db.exec(`
            CREATE TABLE shop_payments_new (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                order_id INTEGER NOT NULL UNIQUE,
                provider TEXT NOT NULL DEFAULT 'wave'
                    CHECK (provider IN ('wave', 'modem')),
                provider_reference TEXT UNIQUE,
                payment_status TEXT NOT NULL DEFAULT 'pending'
                    CHECK (payment_status IN (
                        'pending', 'paid', 'failed', 'cancelled', 'refunded'
                    )),
                amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
                currency TEXT NOT NULL DEFAULT 'GMD'
                    CHECK (currency = 'GMD'),
                verified_at TEXT,
                created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (order_id) REFERENCES shop_orders(id)
            );

            INSERT INTO shop_payments_new (
                id, order_id, provider, provider_reference,
                payment_status, amount_minor, currency,
                verified_at, created_at
            )
            SELECT
                id, order_id, provider, provider_reference,
                payment_status, amount_minor, currency,
                verified_at, created_at
            FROM shop_payments;

            DROP TABLE shop_payments;
            ALTER TABLE shop_payments_new RENAME TO shop_payments;
        `);

        const after = db.prepare(
            "SELECT COUNT(*) AS total FROM shop_payments"
        ).get().total;

        if (before !== after) {
            throw new Error("Payment record count changed. Rolling back.");
        }

        const violations = db.pragma("foreign_key_check");
        if (violations.length) {
            throw new Error("Foreign key check failed. Rolling back.");
        }

        console.log("Payment table migration completed.");
        console.log("Payment records preserved:", after);
    });

    migrate();

    console.log("New provider restriction:",
        db.prepare(`
            SELECT sql FROM sqlite_master
            WHERE type = 'table' AND name = 'shop_payments'
        `).get().sql
    );

    console.log("Current payment records:",
        db.prepare(`
            SELECT id, order_id, provider, amount_minor,
                   currency, payment_status
            FROM shop_payments
        `).all()
    );
} catch (error) {
    console.error("Migration failed:", error.message);
    process.exitCode = 1;
} finally {
    db.close();
}
