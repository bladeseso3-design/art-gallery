
document.addEventListener("DOMContentLoaded", () => {
    const adminEmail = document.getElementById("adminEmail");
    const dashboardStatus = document.getElementById("dashboardStatus");
    const systemMessage = document.getElementById("systemMessage");
    const logoutButton = document.getElementById("logoutButton");

    // Display an error without exposing sensitive server information.
    function showError(message) {
        dashboardStatus.textContent = "Unable to load";
        systemMessage.textContent = message;
    }

    // Verify administrator access before loading dashboard information.
    async function initializeDashboard() {
        try {
            const accessResponse = await fetch("/api/admin/access", {
                method: "GET",
                credentials: "same-origin"
            });

            if (accessResponse.status === 401 ||
                accessResponse.status === 403) {
                window.location.replace("./login.html");
                return;
            }

            if (!accessResponse.ok) {
                throw new Error("Administrator access verification failed.");
            }

            const accessData = await accessResponse.json();

            if (!accessData.authorized || !accessData.admin) {
                window.location.replace("./login.html");
                return;
            }

            adminEmail.textContent = accessData.admin.email;

            await loadDashboardStatistics();

        } catch (error) {
            console.error("Admin dashboard access error:", error);
            showError("Could not verify administrator access. Please refresh the page.");
        }
    }

    // Load real statistics from the protected dashboard endpoint.
    async function loadDashboardStatistics() {
        try {
            const response = await fetch("/api/admin/dashboard/stats", {
                method: "GET",
                credentials: "same-origin"
            });

            if (response.status === 401 ||
                response.status === 403) {
                window.location.replace("./login.html");
                return;
            }

            if (!response.ok) {
                throw new Error("Dashboard statistics could not be retrieved.");
            }

            const data = await response.json();

            if (!data.success || !data.statistics) {
                throw new Error("The server returned an invalid statistics response.");
            }

            const stats = data.statistics;

            // User statistics.
            document.getElementById("totalUsers").textContent =
                stats.users.total;

            document.getElementById("verifiedUsers").textContent =
                `${stats.users.verified} verified accounts`;

            // Artwork statistics.
            document.getElementById("totalArtworks").textContent =
                stats.artworks.total;

            // Competition statistics.
            document.getElementById("totalCompetitions").textContent =
                stats.competitions.total;

            document.getElementById("competitionDetails").textContent =
                `${stats.competitions.open} open · ` +
                `${stats.competitions.closed} closed · ` +
                `${stats.competitions.finished} finished`;

            // Voting statistics.
            document.getElementById("totalVotes").textContent =
                stats.votes.total;

            // Shop statistics.
            document.getElementById("totalOrders").textContent =
                stats.orders.total;

            document.getElementById("pendingOrders").textContent =
                `${stats.orders.pending} pending orders`;

            dashboardStatus.textContent = "Database connected";

            systemMessage.textContent =
                "Administrator access verified. Dashboard statistics loaded successfully.";

        } catch (error) {
            console.error("Dashboard statistics error:", error);
            showError("Unable to load database statistics. Please try again.");
        }
    }

    // Use the existing authentication logout endpoint.
    logoutButton.addEventListener("click", async () => {
        logoutButton.disabled = true;
        logoutButton.textContent = "Signing out...";

        try {
            const response = await fetch("/api/auth/logout", {
                method: "POST",
                credentials: "same-origin"
            });

            if (!response.ok) {
                throw new Error("Sign out request failed.");
            }

            window.location.replace("./login.html");

        } catch (error) {
            console.error("Admin logout error:", error);

            logoutButton.disabled = false;
            logoutButton.textContent = "Sign Out";

            systemMessage.textContent =
                "Sign out failed. Please try again.";
        }
    });

    
    // Dashboard and management section navigation.
    const dashboardSection = document.getElementById("dashboard");
const usersSection = document.getElementById("users");
const artworksSection = document.getElementById("artworks");
const competitionsSection = document.getElementById("competitions");
    const pageTitle = document.querySelector(".admin-header h1");
    const pageDescription = document.querySelector(".header-description");

    const navigationLinks = document.querySelectorAll(".nav-link");

   

function showSection(sectionName) {
    const showingUsers = sectionName === "users";
    const showingArtworks = sectionName === "artworks";
    const showingCompetitions = sectionName === "competitions";
    const showingDashboard = sectionName === "dashboard";

    dashboardSection.hidden = !showingDashboard;
    usersSection.hidden = !showingUsers;
    artworksSection.hidden = !showingArtworks;
    competitionsSection.hidden = !showingCompetitions;

    if (showingUsers) {
        pageTitle.textContent = "User Management";
        pageDescription.textContent =
            "View and monitor registered gallery accounts.";
    } else if (showingArtworks) {
        pageTitle.textContent = "Artwork Management";
        pageDescription.textContent =
            "View and manage registered gallery artworks.";
    } else if (showingCompetitions) {
        pageTitle.textContent = "Competition Management";
        pageDescription.textContent =
            "Create and manage monthly gallery competitions.";
    } else {
        pageTitle.textContent = "Dashboard";
        pageDescription.textContent =
            "Overview of your art gallery platform.";
    }

    navigationLinks.forEach(link => {
        link.classList.toggle(
            "active",
            link.getAttribute("href") === `#${sectionName}`
        );
    });

    if (showingUsers) {
        loadUsers();
    }

    if (showingArtworks) {
        loadArtworks();
    }

    if (showingCompetitions) {
        loadCompetitions();
    }
}


           
    navigationLinks.forEach(link => {
        link.addEventListener("click", event => {
            const sectionName = link.getAttribute("href").substring(1);
if (
    sectionName === "dashboard" ||
    sectionName === "users" ||
    sectionName === "artworks" ||
    sectionName === "competitions"
) {
                event.preventDefault();
                showSection(sectionName);
            } else {
                event.preventDefault();
                systemMessage.textContent =
                    "This management section is not available yet.";
            }
        });
    });

    // Retrieve and display registered user accounts.
    let registeredUsers = [];

    async function loadUsers() {
        const tableBody = document.getElementById("usersTableBody");
        const userCount = document.getElementById("userCount");
        const usersMessage = document.getElementById("usersMessage");
        const refreshButton = document.getElementById("refreshUsers");

        usersMessage.textContent = "Loading registered accounts...";
        userCount.textContent = "Loading...";
        refreshButton.disabled = true;

        try {
            const response = await fetch("/api/admin/users", {
                method: "GET",
                credentials: "same-origin"
            });

            if (response.status === 401 || response.status === 403) {
                window.location.replace("./login.html");
                return;
            }

            if (!response.ok) {
                throw new Error("Unable to retrieve user accounts.");
            }

            const data = await response.json();

            if (!data.success || !Array.isArray(data.users)) {
                throw new Error("Invalid user data received.");
            }

            registeredUsers = data.users;

            renderUsers(registeredUsers);

            userCount.textContent = `${data.total} accounts`;
            usersMessage.textContent =
                "Registered accounts retrieved successfully.";

        } catch (error) {
            console.error("User management error:", error);
            tableBody.replaceChildren();
            userCount.textContent = "Unavailable";
            usersMessage.textContent =
                "Unable to load registered users. Please try again.";

        } finally {
            refreshButton.disabled = false;
        }
    }

    // Render user records safely without inserting HTML from the server.
    function renderUsers(users) {
        const tableBody = document.getElementById("usersTableBody");
        const usersMessage = document.getElementById("usersMessage");

        tableBody.replaceChildren();

        if (users.length === 0) {
            usersMessage.textContent = "No matching user accounts found.";
            return;
        }

        users.forEach(user => {
            const row = document.createElement("tr");

            const idCell = document.createElement("td");
            idCell.textContent = user.id;

            const emailCell = document.createElement("td");
            emailCell.textContent = user.email;

            const verificationCell = document.createElement("td");
            const verificationBadge = document.createElement("span");

            verificationBadge.className = user.emailVerified
                ? "account-status verified"
                : "account-status unverified";

            verificationBadge.textContent = user.emailVerified
                ? "Verified"
                : "Unverified";

            verificationCell.appendChild(verificationBadge);

            const roleCell = document.createElement("td");
            const roleBadge = document.createElement("span");

            roleBadge.className = user.role === "admin"
                ? "account-role admin"
                : "account-role user";

            roleBadge.textContent = user.role;
            roleCell.appendChild(roleBadge);

            const dateCell = document.createElement("td");
            dateCell.textContent = user.createdAt || "Not available";

            row.append(
                idCell,
                emailCell,
                verificationCell,
                roleCell,
                dateCell
            );

            tableBody.appendChild(row);
        });
    }
// Store artwork records retrieved from the server.
let registeredArtworks = [];

// Retrieve all artworks for the administrator.
async function loadArtworks() {
    const tableBody = document.getElementById("artworksTableBody");
    const artworkCount = document.getElementById("artworkCount");
    const artworksMessage = document.getElementById("artworksMessage");
    const refreshButton = document.getElementById("refreshArtworks");

    artworksMessage.textContent = "Loading artworks...";
    artworkCount.textContent = "Loading...";
    refreshButton.disabled = true;

    try {
        const response = await fetch("/api/admin/artworks", {
            method: "GET",
            credentials: "same-origin"
        });

        if (response.status === 401 || response.status === 403) {
            window.location.replace("./login.html");
            return;
        }

        if (!response.ok) {
            throw new Error("Unable to retrieve artworks.");
        }

        const data = await response.json();

        if (!data.success || !Array.isArray(data.artworks)) {
            throw new Error("Invalid artwork data received.");
        }

        registeredArtworks = data.artworks;

        renderArtworks(registeredArtworks);

        artworkCount.textContent = `${data.total} artworks`;
        artworksMessage.textContent =
            "Artwork records retrieved successfully.";

    } catch (error) {
        console.error("Artwork management error:", error);
        tableBody.replaceChildren();
        artworkCount.textContent = "Unavailable";
        artworksMessage.textContent =
            "Unable to load artworks. Please try again.";

    } finally {
        refreshButton.disabled = false;
    }
}

// Display artwork records safely in the management table.
function renderArtworks(artworks) {
    const tableBody = document.getElementById("artworksTableBody");
    const artworkCount = document.getElementById("artworkCount");
    const artworksMessage = document.getElementById("artworksMessage");

    tableBody.replaceChildren();
    artworkCount.textContent = `${artworks.length} matching artworks`;

    if (artworks.length === 0) {
        artworksMessage.textContent = "No matching artworks found.";
        return;
    }

    artworks.forEach(artwork => {
        const row = document.createElement("tr");

        const values = [
            artwork.id,
            artwork.title,
            artwork.artist,
            artwork.year,
            artwork.votes
        ];

        values.forEach(value => {
            const cell = document.createElement("td");
            cell.textContent = value ?? "Not available";
            row.appendChild(cell);
        });

        const priceCell = document.createElement("td");
        priceCell.textContent = artwork.shop
            ? `${artwork.shop.currency} ${Number(artwork.shop.price).toLocaleString("en-GM")}`
            : "Not listed";

        const stockCell = document.createElement("td");
        stockCell.textContent = artwork.shop
            ? artwork.shop.stockStatus
            : "Not listed";

        row.append(priceCell, stockCell);

// Add an Edit button for this artwork.
const actionsCell = document.createElement("td");

const editButton = document.createElement("button");
editButton.type = "button";
editButton.className = "action-button";
editButton.textContent = "Edit";

editButton.addEventListener("click", () => {
    openArtworkEditor(artwork);
});

actionsCell.appendChild(editButton);
row.appendChild(actionsCell);
        tableBody.appendChild(row);
    });

    artworksMessage.textContent =
        "Artwork records retrieved successfully.";
}

// Open the artwork editing form.
function openArtworkEditor(artwork) {
    document.getElementById("editArtworkId").value = artwork.id;
    document.getElementById("editArtworkTitle").value = artwork.title;
    document.getElementById("editArtworkArtist").value = artwork.artist;
    document.getElementById("editArtworkYear").value = artwork.year;

    document.getElementById("artworkEditMessage").textContent = "";

    artworksSection.hidden = true;
    document.getElementById("artworkEditSection").hidden = false;

    pageTitle.textContent = "Edit Artwork";
    pageDescription.textContent =
        `Update the details for artwork #${artwork.id}.`;
}

// Return to the artwork collection.
function closeArtworkEditor() {
    document.getElementById("artworkEditSection").hidden = true;
    artworksSection.hidden = false;

    pageTitle.textContent = "Artwork Management";
    pageDescription.textContent =
        "View and manage registered gallery artworks.";
}

// Cancel artwork editing.
document.getElementById("cancelArtworkEdit").addEventListener(
    "click",
    closeArtworkEditor
);

// Save updated artwork information.
document.getElementById("artworkEditForm").addEventListener(
    "submit",
    async event => {
        event.preventDefault();

        const artworkId =
            document.getElementById("editArtworkId").value;

        const message =
            document.getElementById("artworkEditMessage");

        const saveButton =
            event.currentTarget.querySelector('button[type="submit"]');

        const updatedArtwork = {
            title: document.getElementById("editArtworkTitle").value.trim(),
            artist: document.getElementById("editArtworkArtist").value.trim(),
            year: Number(document.getElementById("editArtworkYear").value)
        };

        if (
            !updatedArtwork.title ||
            !updatedArtwork.artist ||
            !Number.isInteger(updatedArtwork.year) ||
            updatedArtwork.year < 1000 ||
            updatedArtwork.year > 9999
        ) {
            message.textContent = "Please enter valid artwork details.";
            return;
        }

        saveButton.disabled = true;
        saveButton.textContent = "Saving...";

        try {
            const response = await fetch(
                `/api/admin/artworks/${artworkId}`,
                {
                    method: "PUT",
                    credentials: "same-origin",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify(updatedArtwork)
                }
            );

            if (response.status === 401 || response.status === 403) {
                window.location.replace("./login.html");
                return;
            }

            const data = await response.json();

            if (!response.ok || !data.success) {
                throw new Error(data.error || "Unable to update artwork.");
            }

            message.textContent = "Artwork updated successfully.";

            await loadArtworks();
            closeArtworkEditor();

        } catch (error) {
            console.error("Artwork update error:", error);
            message.textContent =
                error.message || "Unable to save artwork changes.";

        } finally {
            saveButton.disabled = false;
            saveButton.textContent = "Save Changes";
        }
    }
);


// Search artworks by ID, title or artist.
document.getElementById("artworkSearch").addEventListener("input", event => {
    const searchTerm = event.target.value.trim().toLowerCase();

    const filteredArtworks = registeredArtworks.filter(artwork =>
        String(artwork.id).includes(searchTerm) ||
        artwork.title.toLowerCase().includes(searchTerm) ||
        artwork.artist.toLowerCase().includes(searchTerm)
    );

    renderArtworks(filteredArtworks);
});

// Refresh the artwork list.
document.getElementById("refreshArtworks").addEventListener("click", () => {
    loadArtworks();
});

    // Search users by account ID or email.
    document.getElementById("userSearch").addEventListener("input", event => {
        const searchTerm = event.target.value.trim().toLowerCase();

        const filteredUsers = registeredUsers.filter(user =>
            String(user.id).includes(searchTerm) ||
            user.email.toLowerCase().includes(searchTerm)
        );

        renderUsers(filteredUsers);
    });

    // Refresh button.
    document.getElementById("refreshUsers").addEventListener("click", () => {
        loadUsers();
    });

// Store the competition currently being managed.
let selectedCompetitionId = null;
let availableCompetitionArtworks = [];
let selectedCompetitionArtworkIds = new Set();


// Retrieve monthly competitions from the backend.
async function loadCompetitions() {
    const tableBody = document.getElementById("competitionsTableBody");
    const count = document.getElementById("competitionCount");
    const message = document.getElementById("competitionsMessage");
    const refreshButton = document.getElementById("refreshCompetitions");

    message.textContent = "Loading competitions...";
    count.textContent = "Loading...";
    refreshButton.disabled = true;

    try {
        const response = await fetch("/api/admin/competitions", {
            method: "GET",
            credentials: "same-origin"
        });

        if (response.status === 401 || response.status === 403) {
            window.location.replace("./login.html");
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Unable to retrieve competitions.");
        }

        tableBody.replaceChildren();

        count.textContent = `${data.total} monthly competitions`;

        if (data.competitions.length === 0) {
            message.textContent = "No monthly competitions have been created yet.";
            return;
        }

        message.textContent = "";

        data.competitions.forEach(competition => {
            const row = document.createElement("tr");

            const titleCell = document.createElement("td");
            titleCell.textContent = competition.name;

            const statusCell = document.createElement("td");
            statusCell.textContent = competition.display_status;

            const startCell = document.createElement("td");
            startCell.textContent = competition.start_at
                ? new Date(competition.start_at).toLocaleString()
                : "Not scheduled";

            const endCell = document.createElement("td");
            endCell.textContent = competition.end_at
                ? new Date(competition.end_at).toLocaleString()
                : "Not scheduled";

            const artworkCell = document.createElement("td");
            artworkCell.textContent = competition.artwork_count;

            const actionCell = document.createElement("td");

            const manageButton = document.createElement("button");
manageButton.type = "button";
manageButton.textContent = "Manage";

manageButton.addEventListener("click", () => {
    openCompetitionArtworkManager(competition.id);
});

actionCell.appendChild(manageButton);
// Show Results for published competitions.
if (competition.published_at) {
    const resultsButton = document.createElement("button");
    resultsButton.type = "button";
    resultsButton.textContent = "Results";
    resultsButton.className = "action-button";

    resultsButton.addEventListener("click", () => {
        loadCompetitionResults(competition.id, competition.name);
    });

    actionCell.appendChild(resultsButton);
}

// Show Publish button only for draft competitions.
if (competition.display_status === "draft") {
    const publishButton = document.createElement("button");
    publishButton.type = "button";
    publishButton.textContent = "Publish";
    publishButton.className = "action-button";

    publishButton.addEventListener("click", () => {
        publishCompetition(competition.id, competition.name);
    });

    actionCell.appendChild(publishButton);
}
  // Show Archive button only for completed competitions.
if (competition.display_status === "finished") {
    const archiveButton = document.createElement("button");
    archiveButton.type = "button";
    archiveButton.textContent = "Archive";
    archiveButton.className = "action-button";

    archiveButton.addEventListener("click", () => {
        archiveCompetition(competition.id, competition.name);
    });

    actionCell.appendChild(archiveButton);
}

            row.append(
                titleCell,
                statusCell,
                startCell,
                endCell,
                artworkCell,
                actionCell
            );

            tableBody.appendChild(row);
        });

    } catch (error) {
        console.error("Competition loading error:", error);
        message.textContent =
            error.message || "Unable to load competitions.";

    } finally {
        refreshButton.disabled = false;
    }
}


// Create a new monthly competition.
document.getElementById("competitionCreateForm").addEventListener("submit", async event => {
    event.preventDefault();

    const name = document.getElementById("competitionName").value.trim();
    const description = document.getElementById("competitionDescription").value.trim();
    const startAt = document.getElementById("competitionStart").value;
    const endAt = document.getElementById("competitionEnd").value;

    const message = document.getElementById("competitionCreateMessage");
    const createButton = document.getElementById("createCompetitionButton");

    if (!name || !startAt || !endAt) {
        message.textContent = "Please complete all required fields.";
        return;
    }

    if (new Date(endAt) <= new Date(startAt)) {
        message.textContent = "The closing date must be after the opening date.";
        return;
    }

    createButton.disabled = true;
    createButton.textContent = "Creating...";

    try {
        const response = await fetch("/api/admin/competitions", {
            method: "POST",
            credentials: "same-origin",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                name,
                description,
                startAt,
                endAt
            })
        });

        if (response.status === 401 || response.status === 403) {
            window.location.replace("./login.html");
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Unable to create competition.");
        }

        message.textContent = "Competition created successfully as a draft.";

        event.target.reset();

        await loadCompetitions();

    } catch (error) {
        console.error("Competition creation error:", error);
        message.textContent =
            error.message || "Unable to create competition.";

    } finally {
        createButton.disabled = false;
        createButton.textContent = "Create Competition";
    }
});


// Refresh the monthly competition list.
document.getElementById("refreshCompetitions").addEventListener("click", () => {
    loadCompetitions();
});



// Open the artwork selection panel for a competition.
// Publish a draft monthly competition.
async function publishCompetition(competitionId, competitionName) {
    const confirmed = window.confirm(
        `Publish "${competitionName}"? Once published, its artwork selection cannot be changed.`
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(
            `/api/admin/competitions/${competitionId}/publish`,
            {
                method: "POST",
                credentials: "same-origin"
            }
        );

        if (response.status === 401 || response.status === 403) {
            window.location.replace("./login.html");
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || "Unable to publish competition."
            );
        }

        document.getElementById("competitionsMessage").textContent =
            `${competitionName} published successfully. Status: ${data.status}.`;

        await loadCompetitions();

    } catch (error) {
        console.error("Competition publishing error:", error);

        document.getElementById("competitionsMessage").textContent =
            error.message || "Unable to publish competition.";
    }
}
// Load and display results for a published competition.
async function loadCompetitionResults(competitionId, competitionName) {
    const panel = document.getElementById("competitionResultsPanel");
    const heading = document.getElementById("competitionResultsHeading");
    const message = document.getElementById("competitionResultsMessage");
    const tableBody = document.getElementById("competitionResultsTableBody");

    panel.hidden = false;
    heading.textContent = `${competitionName} Results`;
    message.textContent = "Loading competition results...";
    tableBody.replaceChildren();

    try {
        const response = await fetch(
            `/api/competitions/${competitionId}/results`,
            {
                method: "GET",
                credentials: "same-origin"
            }
        );

        if (response.status === 401 || response.status === 403) {
            window.location.replace("./login.html");
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(
                data.error || "Unable to load competition results."
            );
        }

        message.textContent =
            `Total artworks: ${data.total} | Total votes: ${data.totalVotes}`;

        if (!data.results || data.results.length === 0) {
            message.textContent = "No artwork results are available.";
            return;
        }

        data.results.forEach((artwork, index) => {
            const row = document.createElement("tr");

            const positionCell = document.createElement("td");
            positionCell.textContent = index + 1;

            const artworkCell = document.createElement("td");
            artworkCell.textContent = artwork.title;

            const artistCell = document.createElement("td");
            artistCell.textContent = artwork.artist;

            const votesCell = document.createElement("td");
            votesCell.textContent = artwork.votes;

            row.append(
                positionCell,
                artworkCell,
                artistCell,
                votesCell
            );

            tableBody.appendChild(row);
        });

    } catch (error) {
        console.error("Competition results loading error:", error);

        message.textContent =
            error.message || "Unable to load competition results.";
    }
}


// Archive a completed monthly competition without deleting its records.
async function archiveCompetition(competitionId, competitionName) {
    const confirmed = window.confirm(
        `Archive "${competitionName}"? Its records and voting history will be preserved.`
    );

    if (!confirmed) {
        return;
    }

    try {
        const response = await fetch(
            `/api/admin/competitions/${competitionId}/archive`,
            {
                method: "POST",
                credentials: "same-origin"
            }
        );

        if (response.status === 401 || response.status === 403) {
            window.location.replace("./login.html");
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Unable to archive competition.");
        }

        document.getElementById("competitionsMessage").textContent =
            `${competitionName} archived successfully. Its records have been preserved.`;

        await loadCompetitions();

    } catch (error) {
        console.error("Competition archive error:", error);

        document.getElementById("competitionsMessage").textContent =
            error.message || "Unable to archive competition.";
    }
}


async function openCompetitionArtworkManager(competitionId) {
    const panel = document.getElementById("competitionArtworkPanel");
    const choices = document.getElementById("competitionArtworkChoices");
    const heading = document.getElementById("competitionArtworkHeading");
    const description = document.getElementById("competitionArtworkDescription");
    const message = document.getElementById("competitionArtworkMessage");
    const saveButton = document.getElementById("saveCompetitionArtworks");

    selectedCompetitionId = competitionId;
    selectedCompetitionArtworkIds = new Set();

    panel.hidden = false;
    choices.replaceChildren();
    message.textContent = "Loading artworks...";
    saveButton.disabled = true;

    try {
        const [artworkResponse, selectionResponse] = await Promise.all([
            fetch("/api/admin/artworks", {
                credentials: "same-origin"
            }),
            fetch(`/api/admin/competitions/${competitionId}/artworks`, {
                credentials: "same-origin"
            })
        ]);

        if (
            artworkResponse.status === 401 ||
            artworkResponse.status === 403 ||
            selectionResponse.status === 401 ||
            selectionResponse.status === 403
        ) {
            window.location.replace("./login.html");
            return;
        }

        const artworkData = await artworkResponse.json();
        const selectionData = await selectionResponse.json();

        if (!artworkResponse.ok || !artworkData.success) {
            throw new Error(artworkData.error || "Unable to load available artworks.");
        }

        if (!selectionResponse.ok || !selectionData.success) {
            throw new Error(selectionData.error || "Unable to load selected artworks.");
        }

        availableCompetitionArtworks = artworkData.artworks;

        selectionData.artworks.forEach(artwork => {
            selectedCompetitionArtworkIds.add(artwork.id);
        });

        const competition = selectionData.competition;
        const isPublished = competition.published_at !== null;

        heading.textContent = `Artworks: ${competition.name}`;
        description.textContent = isPublished
            ? "This competition is published. Its artwork selection is locked."
            : "Select the artworks that will participate in this competition.";

        choices.replaceChildren();

        if (availableCompetitionArtworks.length === 0) {
            message.textContent = "No artworks are available.";
            return;
        }

        availableCompetitionArtworks.forEach(artwork => {
            const label = document.createElement("label");
            label.className = "competition-artwork-choice";

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = artwork.id;
            checkbox.checked = selectedCompetitionArtworkIds.has(artwork.id);
            checkbox.disabled = isPublished;

            checkbox.addEventListener("change", () => {
                if (checkbox.checked) {
                    selectedCompetitionArtworkIds.add(artwork.id);
                } else {
                    selectedCompetitionArtworkIds.delete(artwork.id);
                }
            });

            const details = document.createElement("span");
            details.textContent =
                `${artwork.title} — ${artwork.artist} (${artwork.year})`;

            label.append(checkbox, details);
            choices.appendChild(label);
        });

        message.textContent =
            `${selectedCompetitionArtworkIds.size} artwork(s) selected.`;

        saveButton.disabled = isPublished;

    } catch (error) {
        console.error("Competition artwork loading error:", error);
        message.textContent =
            error.message || "Unable to load competition artworks.";
    }
}


// Close the artwork selection panel.
document.getElementById("cancelCompetitionArtwork").addEventListener("click", () => {
    document.getElementById("competitionArtworkPanel").hidden = true;
    selectedCompetitionId = null;
    selectedCompetitionArtworkIds.clear();
});

// Close the competition results panel.
document.getElementById("closeCompetitionResults").addEventListener("click", () => {
    document.getElementById("competitionResultsPanel").hidden = true;

    document.getElementById("competitionResultsTableBody").replaceChildren();

    document.getElementById("competitionResultsMessage").textContent = "";
});


// Save the selected artworks for the current competition.
document.getElementById("saveCompetitionArtworks").addEventListener("click", async () => {
    const message = document.getElementById("competitionArtworkMessage");
    const saveButton = document.getElementById("saveCompetitionArtworks");

    if (!selectedCompetitionId) {
        message.textContent = "Please select a competition first.";
        return;
    }

    saveButton.disabled = true;
    saveButton.textContent = "Saving...";

    try {
        const response = await fetch(
            `/api/admin/competitions/${selectedCompetitionId}/artworks`,
            {
                method: "PUT",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify({
                    artworkIds: Array.from(selectedCompetitionArtworkIds)
                })
            }
        );

        if (response.status === 401 || response.status === 403) {
            window.location.replace("./login.html");
            return;
        }

        const data = await response.json();

        if (!response.ok || !data.success) {
            throw new Error(data.error || "Unable to save selected artworks.");
        }

        message.textContent =
            `${selectedCompetitionArtworkIds.size} artwork(s) saved successfully.`;

        await loadCompetitions();

    } catch (error) {
        console.error("Competition artwork saving error:", error);
        message.textContent =
            error.message || "Unable to save selected artworks.";

    } finally {
        saveButton.disabled = false;
        saveButton.textContent = "Save Selected Artworks";
    }
});




    initializeDashboard();

});
