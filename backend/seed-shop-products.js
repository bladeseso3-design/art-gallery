const db = require("./database");

const products = [
    { artworkId: 1, priceMinor: 3000000 },
    { artworkId: 2, priceMinor: 3000000 },
    { artworkId: 3, priceMinor: 3000000 }
];

try {
    const addProduct = db.prepare(`
        INSERT INTO shop_products (artwork_id, price_minor, currency)
        VALUES (?, ?, 'GMD')
        ON CONFLICT(artwork_id) DO UPDATE SET
            price_minor = excluded.price_minor,
            currency = excluded.currency,
            updated_at = CURRENT_TIMESTAMP
    `);

    const getArtwork = db.prepare(
        "SELECT id FROM artworks WHERE id = ?"
    );

    const seedProducts = db.transaction(() => {
        for (const product of products) {
            if (!getArtwork.get(product.artworkId)) {
                throw new Error(
                    "Artwork ID " + product.artworkId + " does not exist."
                );
            }

            addProduct.run(product.artworkId, product.priceMinor);
        }
    });

    seedProducts();

    console.log("Shop products configured:");
    console.table(db.prepare(`
        SELECT
            p.artwork_id AS id,
            a.title,
            a.artist,
            p.price_minor / 100.0 AS price_GMD,
            p.stock_status
        FROM shop_products p
        JOIN artworks a ON a.id = p.artwork_id
        ORDER BY p.artwork_id
    `).all());
} finally {
    db.close();
}