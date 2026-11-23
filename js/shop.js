"use strict";

const SHOP_API = "/api/shop/products";

const artworkImages = {
    1: "featured-exhibition.jpg.jpg",
    2: "artwork-10.jpg",
    3: "artwork-11.jpg.jpg",
    4: "artwork-2.jpg.jpg",
    5: "artwork-3.jpg.jpg",
    6: "artwork-6.jpg",
    7: "artwork-7.jpg",
    8: "artwork-8.jpg",
    9: "artwork-9.jpg",
    10: "artwork-12.jpg.jpg"
};

const productsContainer = document.getElementById("shop-products");
const shopMessage = document.getElementById("shop-message");
const shopCount = document.getElementById("shop-count");

function formatPrice(price, currency) {
    return `${currency} ${Number(price).toLocaleString("en-GM")}`;
}

function createProductCard(product) {
    const card = document.createElement("article");
    card.className = "shop-card";

    const image = document.createElement("img");
    image.src = `./images/${artworkImages[product.id] || ""}`;
    image.alt = `${product.title} by ${product.artist}`;
    image.loading = "lazy";
    image.onerror = () => {
        image.alt = "Artwork image unavailable";
        image.style.display = "none";
    };

    const details = document.createElement("div");
    details.className = "shop-card-details";

    const title = document.createElement("h3");
    title.textContent = product.title;

    const artist = document.createElement("p");
    artist.className = "shop-artist";
    artist.textContent = product.artist;

    const year = document.createElement("p");
    year.className = "shop-year";
    year.textContent = String(product.year);

    const price = document.createElement("p");
    price.className = "shop-price";
    price.textContent = formatPrice(product.price, product.currency);

    const availability = document.createElement("p");
    availability.className = "shop-stock";
    availability.textContent =
        product.stockStatus === "available" ? "Available" : "Unavailable";

    const buyButton = document.createElement("button");
    buyButton.type = "button";
    buyButton.className = "shop-buy-button";
    buyButton.textContent = "Buy artwork";
    buyButton.disabled = product.stockStatus !== "available";

    buyButton.addEventListener("click", () => {
        if (product.stockStatus === "available") {
            const checkoutUrl =
                `./checkout.html?artworkId=${encodeURIComponent(product.id)}`;

            window.location.href =
                `./login.html?returnTo=${encodeURIComponent(checkoutUrl)}`;
        }
    });

    details.append(title, artist, year, price, availability, buyButton);
    const imageWrapper = document.createElement("div");
imageWrapper.className = "shop-card-image";
imageWrapper.appendChild(image);

card.append(imageWrapper, details);
    return card;
}

async function loadShopProducts() {
    productsContainer.replaceChildren();
    shopMessage.textContent = "Loading available artworks...";
    shopCount.textContent = "Loading artworks...";

    try {
        const response = await fetch(SHOP_API, {
            method: "GET",
            headers: {
                "Accept": "application/json"
            },
            credentials: "same-origin"
        });

        if (!response.ok) {
            throw new Error("Unable to retrieve the shop catalogue.");
        }

        const data = await response.json();

        if (!Array.isArray(data.products)) {
            throw new Error("The shop returned an unexpected response.");
        }

        shopCount.textContent =
            `${data.products.length} artworks available`;

        if (data.products.length === 0) {
            shopMessage.textContent = "No artworks are currently available.";
            return;
        }

        const fragment = document.createDocumentFragment();

        data.products.forEach(product => {
            fragment.appendChild(createProductCard(product));
        });

        productsContainer.appendChild(fragment);
        shopMessage.textContent = "";

    } catch (error) {
        console.error("Shop catalogue error:", error);
        shopCount.textContent = "Catalogue unavailable";
        shopMessage.textContent =
            "We could not load the artworks. Please refresh the page and try again.";
    }
}

loadShopProducts();


