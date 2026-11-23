const db = require("./database");

db.exec(`
CREATE TABLE IF NOT EXISTS shop_products (
id INTEGER PRIMARY KEY AUTOINCREMENT,
artwork_id INTEGER NOT NULL UNIQUE,
price_minor INTEGER NOT NULL CHECK (price_minor > 0),
currency TEXT NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
stock_status TEXT NOT NULL DEFAULT 'available'
CHECK (stock_status IN ('available', 'reserved', 'sold')),
created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
FOREIGN KEY (artwork_id) REFERENCES artworks(id)
);

CREATE TABLE IF NOT EXISTS shop_orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_reference TEXT NOT NULL UNIQUE,
    user_id INTEGER,
    customer_name TEXT NOT NULL,
    customer_email TEXT NOT NULL,
    fulfilment_method TEXT NOT NULL
        CHECK (fulfilment_method IN ('delivery', 'collection')),
    delivery_address TEXT,
    currency TEXT NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
    total_minor INTEGER NOT NULL CHECK (total_minor > 0),
    order_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (order_status IN ('pending', 'confirmed', 'fulfilled', 'cancelled')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS shop_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL,
    artwork_id INTEGER NOT NULL,
    artwork_title TEXT NOT NULL,
    artist_name TEXT NOT NULL,
    unit_price_minor INTEGER NOT NULL CHECK (unit_price_minor > 0),
    quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity = 1),
    FOREIGN KEY (order_id) REFERENCES shop_orders(id),
    FOREIGN KEY (artwork_id) REFERENCES artworks(id)
);

CREATE TABLE IF NOT EXISTS shop_payments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL UNIQUE,
    provider TEXT NOT NULL DEFAULT 'wave' CHECK (provider IN ('wave', 'modem')),
    provider_reference TEXT UNIQUE,
    payment_status TEXT NOT NULL DEFAULT 'pending'
        CHECK (payment_status IN ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
    amount_minor INTEGER NOT NULL CHECK (amount_minor > 0),
    currency TEXT NOT NULL DEFAULT 'GMD' CHECK (currency = 'GMD'),
    verified_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (order_id) REFERENCES shop_orders(id)
);

`);

console.log("Shop database tables are ready.");

db.close();
