"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const ARTWORK_API = "/api/shop/products";
    const ACCOUNT_API = "/api/auth/me";
    const ORDER_API = "/api/shop/orders";

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

    const checkoutMessage = document.getElementById("checkout-message");
    const productContainer = document.getElementById("checkout-product");
    const checkoutForm = document.getElementById("checkout-form");
    const submitButton = document.getElementById("place-order-button");
    const fulfilmentSelect = document.getElementById("fulfilment-method");
    const addressGroup = document.getElementById("delivery-address-group");
    const addressInput = document.getElementById("delivery-address");
    const confirmation = document.getElementById("checkout-confirmation");

    let selectedProduct = null;
    let orderSubmitted = false;

    const artworkId = new URLSearchParams(
        window.location.search
    ).get("artworkId");

    function showMessage(message, type = "") {
        checkoutMessage.textContent = message;
        checkoutMessage.className = "checkout-message";

        if (type) {
            checkoutMessage.classList.add(type);
        }
    }

    function formatPrice(price, currency) {
        return `${currency} ${Number(price).toLocaleString("en-GM")}`;
    }

    function createTextElement(tag, className, value) {
        const element = document.createElement(tag);

        if (className) {
            element.className = className;
        }

        element.textContent = value;
        return element;
    }

    async function getResponse(response) {
        const data = await response.json().catch(() => ({}));

        return {
            ok: response.ok,
            status: response.status,
            data
        };
    }

    function redirectToLogin() {
        const currentCheckout =
            `./checkout.html?artworkId=${encodeURIComponent(artworkId)}`;

        window.location.assign(
            `./login.html?returnTo=${encodeURIComponent(currentCheckout)}`
        );
    }

    async function checkAccount() {
        const response = await fetch(ACCOUNT_API, {
            method: "GET",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json"
            }
        });

        if (response.status === 401) {
            redirectToLogin();
            return false;
        }

        const result = await getResponse(response);

        if (!result.ok) {
            throw new Error(
                result.data.message || "Unable to verify your account."
            );
        }

        if (!result.data.user || !result.data.user.emailVerified) {
            showMessage(
                "Your account must have a verified email address before placing an order.",
                "error"
            );
            return false;
        }

        return true;
    }

    function displayProduct(product) {
        productContainer.replaceChildren();

        const imageName = artworkImages[product.id];

        if (imageName) {
            const image = document.createElement("img");
            image.src = `./images/${imageName}`;
            image.alt = `${product.title} by ${product.artist}`;
            image.onerror = () => {
                image.alt = "Artwork image unavailable";
                image.style.display = "none";
            };

            productContainer.appendChild(image);
        }

        productContainer.append(
            createTextElement("h3", "", product.title),
            createTextElement("p", "", `Artist: ${product.artist}`),
            createTextElement("p", "", `Year: ${product.year}`),
            createTextElement(
                "p",
                "checkout-price",
                formatPrice(product.price, product.currency)
            ),
            createTextElement("p", "", "Availability: Available")
        );
    }

    async function loadSelectedProduct() {
        if (!/^[1-9]\d*$/.test(artworkId || "")) {
            throw new Error("Invalid artwork selection. Please return to the shop.");
        }

        const response = await fetch(ARTWORK_API, {
            method: "GET",
            credentials: "same-origin",
            headers: {
                "Accept": "application/json"
            }
        });

        const result = await getResponse(response);

        if (!result.ok) {
            throw new Error(
                result.data.message || "Unable to load the artwork catalogue."
            );
        }

        if (!Array.isArray(result.data.products)) {
            throw new Error("The shop returned an unexpected response.");
        }

        selectedProduct = result.data.products.find(
            product => Number(product.id) === Number(artworkId)
        );

        if (!selectedProduct) {
            throw new Error("The selected artwork could not be found.");
        }

        if (selectedProduct.stockStatus !== "available") {
            throw new Error("This artwork is no longer available.");
        }

        displayProduct(selectedProduct);
        submitButton.disabled = false;
    }

    function updateFulfilmentFields() {
        const isDelivery = fulfilmentSelect.value === "delivery";

        addressGroup.hidden = !isDelivery;
        addressInput.required = isDelivery;

        if (!isDelivery) {
            addressInput.value = "";
        }
    }

    function showConfirmation(order) {
        confirmation.replaceChildren();

        confirmation.appendChild(
            createTextElement("h2", "", "Your order has been received.")
        );

        confirmation.appendChild(
            createTextElement(
                "p",
                "",
                "Your order is pending payment verification. It is not yet confirmed as paid."
            )
        );

        confirmation.appendChild(
            createTextElement(
                "p",
                "",
                `Order reference: ${order.orderReference || "Unavailable"}`
            )
        );

        confirmation.appendChild(
            createTextElement(
                "p",
                "",
                `Artwork: ${order.artworkTitle || selectedProduct.title}`
            )
        );

        confirmation.appendChild(
            createTextElement(
                "p",
                "",
                `Amount: ${formatPrice(
                    order.amount ?? selectedProduct.price,
                    order.currency || selectedProduct.currency
                )}`
            )
        );

        const instructions = order.paymentInstructions;

        if (instructions) {
            confirmation.appendChild(
                createTextElement("h3", "", "Wave payment instructions")
            );

            confirmation.appendChild(
                createTextElement(
                    "p",
                    "",
                    `Recipient number: ${instructions.recipientNumber || "Contact the gallery"}`
                )
            );

            confirmation.appendChild(
                createTextElement(
                    "p",
                    "payment-reference",
                    `Payment reference: ${order.orderReference}`
                )
            );

            confirmation.appendChild(
                createTextElement(
                    "p",
                    "",
                    instructions.message ||
                    "Keep your Wave transaction receipt. Payment must be verified by the gallery."
                )
            );
        } else {
            confirmation.appendChild(
                createTextElement(
                    "p",
                    "",
                    "Contact the gallery for payment instructions. Do not assume payment has been received."
                )
            );
        }

        confirmation.appendChild(
            createTextElement(
                "p",
                "",
                "Keep your order reference and payment receipt until the gallery confirms your payment."
            )
        );

        const shopLink = document.createElement("a");
        shopLink.href = "./shop.html";
        shopLink.textContent = "Return to the gallery shop";

        confirmation.appendChild(shopLink);
        confirmation.hidden = false;

        checkoutForm.hidden = true;
        showMessage("Order created. Payment is still pending.", "success");
    }

    fulfilmentSelect.addEventListener(
        "change",
        updateFulfilmentFields
    );

    checkoutForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        if (orderSubmitted || !selectedProduct) {
            return;
        }

        const customerName = document
            .getElementById("customer-name")
            .value.trim();

        const fulfilmentMethod = fulfilmentSelect.value;

        const deliveryAddress = addressInput.value.trim();

        const paymentMethod = document.querySelector('input[name="paymentMethod"]:checked')?.value;

        if (!["modem", "wave"].includes(paymentMethod)) {
            showMessage("Please choose a valid payment method.", "error");
            return;
        }

        if (!customerName || customerName.length > 120) {
            showMessage("Please enter a valid full name.", "error");
            return;
        }

        if (!["delivery", "collection"].includes(fulfilmentMethod)) {
            showMessage("Please select a fulfilment method.", "error");
            return;
        }

        if (
            fulfilmentMethod === "delivery" &&
            (!deliveryAddress || deliveryAddress.length > 500)
        ) {
            showMessage("Please enter a valid delivery address.", "error");
            return;
        }

        submitButton.disabled = true;
        submitButton.textContent = "Submitting order...";
        showMessage("Submitting your order...");

        try {
            const response = await fetch(ORDER_API, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "Accept": "application/json"
                },
                body: JSON.stringify({
                    artworkId: Number(artworkId),
                    paymentMethod,
                    customerName,
                    fulfilmentMethod,
                    deliveryAddress:
                        fulfilmentMethod === "delivery"
                            ? deliveryAddress
                            : ""
                })
            });

            const result = await getResponse(response);

            if (response.status === 401) {
                redirectToLogin();
                return;
            }

            if (!result.ok) {
                if (response.status >= 500) {
                    orderSubmitted = true;
                }

                throw new Error(
                    result.data.error ||
                    result.data.message ||
                    "Your order could not be created."
                );
            }

            if (!result.data.order) {
                orderSubmitted = true;
                throw new Error(
                    "The server response did not contain an order confirmation. Contact the gallery before trying again."
                );
            }

            const order = result.data.order;

            if (paymentMethod === "modem") {
                let paymentUrl;

                try {
                    paymentUrl = new URL(order.paymentLink);

                    if (
                        paymentUrl.protocol !== "https:" ||
                        ![
                            "pay.modempay.com",
                            "test.checkout.modempay.com"
                        ].includes(paymentUrl.hostname)
                    ) {
                        throw new Error("Untrusted payment link.");
                    }
                } catch {
                    orderSubmitted = true;
                    showConfirmation(order);
                    showMessage(
                        "Your order was created, but its payment link could not be verified. Contact the gallery with your order reference. Do not submit again.",
                        "error"
                    );
                    submitButton.disabled = true;
                    return;
                }

                orderSubmitted = true;
                submitButton.disabled = true;
                submitButton.textContent = "Opening Modem Pay...";
                showMessage("Order created. Redirecting to Modem Pay...", "success");
                window.location.assign(paymentUrl.toString());
                return;
            }

            orderSubmitted = true;
            showConfirmation(order);

        } catch (error) {
            showMessage(error.message, "error");

            if (orderSubmitted) {
                submitButton.disabled = true;
                submitButton.textContent = "Contact the gallery";
            } else {
                submitButton.disabled = false;
                submitButton.textContent = "Place order";
            }
        }
    });

    async function initialiseCheckout() {
        submitButton.disabled = true;
        addressGroup.hidden = true;

        try {
            const authenticated = await checkAccount();

            if (!authenticated) {
                return;
            }

            await loadSelectedProduct();

        } catch (error) {
            console.error("Checkout initialisation error:", error);
            showMessage(error.message, "error");
            submitButton.disabled = true;
        }
    }

    initialiseCheckout();
});
