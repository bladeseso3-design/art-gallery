"use strict";

document.addEventListener("DOMContentLoaded", () => {
    const loginTab = document.getElementById("login-tab");
    const registerTab = document.getElementById("register-tab");

    const loginPanel = document.getElementById("login-panel");
    const registerPanel = document.getElementById("register-panel");

    const loginForm = document.getElementById("login-form");
    const registerForm = document.getElementById("register-form");
    const messageBox = document.getElementById("auth-message");

    if (
        !loginTab ||
        !registerTab ||
        !loginPanel ||
        !registerPanel ||
        !loginForm ||
        !registerForm ||
        !messageBox
    ) {
        console.error("Authentication page elements are missing.");
        return;
    }

    function showMessage(message, type = "") {
        messageBox.textContent = message;
        messageBox.className = "auth-message";

        if (type) {
            messageBox.classList.add(type);
        }
    }

    function switchTab(tab) {
        const showLogin = tab === "login";

        loginPanel.hidden = !showLogin;
        registerPanel.hidden = showLogin;

        loginTab.classList.toggle("active", showLogin);
        registerTab.classList.toggle("active", !showLogin);

        loginTab.setAttribute("aria-selected", String(showLogin));
        registerTab.setAttribute("aria-selected", String(!showLogin));

        showMessage("");
    }

    function getSafeReturnTo() {
        const requested = new URLSearchParams(
            window.location.search
        ).get("returnTo");

        if (!requested) {
            return "./shop.html";
        }

        try {
            const destination = new URL(
                requested,
                window.location.origin
            );

            if (destination.origin !== window.location.origin) {
                return "./shop.html";
            }

            if (destination.pathname === "/shop.html") {
                return "./shop.html";
            }

            if (destination.pathname === "/checkout.html") {
                const artworkId = destination.searchParams.get("artworkId");

                if (!/^[1-9]\d*$/.test(artworkId || "")) {
                    return "./shop.html";
                }

                return (
                    "./checkout.html?artworkId=" +
                    encodeURIComponent(artworkId)
                );
            }
        } catch (error) {
            console.error("Invalid return destination:", error);
        }

        return "./shop.html";
    }

    async function sendRequest(url, data) {
        const response = await fetch(url, {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify(data)
        });

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
            throw new Error(
                result.message || "The request could not be completed."
            );
        }

        return result;
    }

    function setFormLoading(form, loading) {
        const button = form.querySelector(
            'button[type="submit"]'
        );

        if (!button) return;

        if (loading) {
            button.dataset.originalText = button.textContent.trim();
            button.disabled = true;
            button.textContent = "Please wait...";
        } else {
            button.disabled = false;

            if (button.dataset.originalText) {
                button.textContent = button.dataset.originalText;
                delete button.dataset.originalText;
            }
        }
    }

    loginTab.addEventListener("click", () => {
        switchTab("login");
    });

    registerTab.addEventListener("click", () => {
        switchTab("register");
    });

    loginForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document
            .getElementById("login-email")
            .value.trim();

        const password = document.getElementById(
            "login-password"
        ).value;

        showMessage("Signing in...");
        setFormLoading(loginForm, true);

        try {
            await sendRequest("/api/auth/login", {
                email,
                password
            });

            showMessage("Login successful. Redirecting...", "success");

            window.location.assign(getSafeReturnTo());
        } catch (error) {
            showMessage(error.message, "error");
        } finally {
            setFormLoading(loginForm, false);
        }
    });

    registerForm.addEventListener("submit", async (event) => {
        event.preventDefault();

        const email = document
            .getElementById("register-email")
            .value.trim();

        const password = document.getElementById(
            "register-password"
        ).value;

        if (password.length < 12) {
            showMessage(
                "Your password must contain at least 12 characters.",
                "error"
            );
            return;
        }

        showMessage("Creating your account...");
        setFormLoading(registerForm, true);

        try {
            const result = await sendRequest(
                "/api/auth/register",
                {
                    email,
                    password
                }
            );

            registerForm.reset();
            switchTab("login");

            showMessage(
                (result.message || "Account created successfully.") +
                " Development verification: check the backend " +
                "terminal for the verification link. Open it within " +
                "30 minutes. The current backend does not send " +
                "verification emails.",
                "success"
            );
        } catch (error) {
            showMessage(error.message, "error");
        } finally {
            setFormLoading(registerForm, false);
        }
    });
});
