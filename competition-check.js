
document.addEventListener("DOMContentLoaded", async () => {
    const grid = document.querySelector(
        "#competition-entries .collection-grid"
    );

    const votingInfo = document.querySelector(
        "#voting-information .about-content"
    );

    const votingLabel = document.querySelector(
        "#voting-information > .eyebrow:last-child"
    );

    const artworkDetails = {
        1: {
            image: "./images/featured-exhibition.jpg.jpg",
            profile: "./mantana-art.html"
        },
        2: {
            image: "./images/artwork-10.jpg",
            profile: "./seso-blade.html"
        },
        3: {
            image: "./images/artwork-11.jpg.jpg",
            profile: "./blade.html"
        }
    };

    try {
        const [artworksResponse, statusResponse] = await Promise.all([
            fetch("/api/artworks"),
            fetch("/api/competition/status")
        ]);

        if (!artworksResponse.ok || !statusResponse.ok) {
            throw new Error("Could not load competition information.");
        }

        const { artworks } = await artworksResponse.json();
        const { status } = await statusResponse.json();
        const isOpen = status === "open";

        if (votingInfo) {
            votingInfo.querySelectorAll("p").forEach((paragraph, index) => {
                if (index === 0) {
                    paragraph.textContent = isOpen
                        ? "Voting is open. Sign in with a verified account to vote for an eligible artwork."
                        : "Voting is currently closed. The gallery will announce when the competition opens.";
                } else {
                    paragraph.textContent =
                        "Votes are recorded by the server. Each verified account may vote only once in this competition.";
                }
            });
        }

        if (votingLabel) {
            votingLabel.textContent = isOpen
                ? "VOTING OPEN"
                : "VOTING CLOSED";
        }

        if (!grid) {
            throw new Error("Competition entries container was not found.");
        }

        grid.replaceChildren();

        artworks.forEach((artwork) => {
            const details = artworkDetails[artwork.id];

            if (!details) {
                console.warn(
                    "No image/profile mapping for artwork ID:",
                    artwork.id
                );
                return;
            }

            const card = document.createElement("article");
            card.className = "art-card";

            const artworkLink = document.createElement("a");
            artworkLink.href = details.profile;

            const image = document.createElement("img");
            image.src = details.image;
            image.alt = `${artwork.title} by ${artwork.artist}`;
            image.loading = "lazy";

            artworkLink.appendChild(image);

            const title = document.createElement("h3");
            title.textContent = artwork.title;

            const artist = document.createElement("p");
            artist.textContent = `${artwork.artist} · ${artwork.year}`;

            const competitionNote = document.createElement("p");
            competitionNote.className = "competition-note";
            competitionNote.textContent = "Official competition entry";

            const profileLink = document.createElement("a");
            profileLink.className = "text-link";
            profileLink.href = details.profile;
            profileLink.textContent = "Explore artist";

            const voteCount = document.createElement("p");
            voteCount.className = "vote-count";
            voteCount.setAttribute("aria-live", "polite");
            voteCount.textContent = `Current votes: ${artwork.votes}`;

            const voteButton = document.createElement("button");
            voteButton.type = "button";
            voteButton.className = "button vote-button";
            voteButton.disabled = !isOpen;
            voteButton.textContent = isOpen
                ? "Vote for this artwork"
                : "Voting closed";

            const voteMessage = document.createElement("p");
            voteMessage.className = "vote-message";
            voteMessage.setAttribute("aria-live", "polite");

            voteButton.addEventListener("click", async () => {
                if (!isOpen || voteButton.disabled) return;

                voteButton.disabled = true;
                voteMessage.textContent = "Submitting your vote…";

                try {
                    const response = await fetch("/api/vote", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json"
                        },
                        credentials: "same-origin",
                        body: JSON.stringify({
                            artworkId: artwork.id
                        })
                    });

                    const result = await response.json();

                    if (!response.ok) {
                        throw new Error(
                            result.error || "Your vote could not be recorded."
                        );
                    }

                    voteCount.textContent =
                        `Current votes: ${result.votes}`;

                    voteMessage.textContent = result.message;
                    voteButton.textContent = "Vote recorded";
                } catch (error) {
                    voteMessage.textContent = error.message;
                    voteButton.disabled = false;
                }
            });

            card.append(
                artworkLink,
                title,
                artist,
                competitionNote,
                profileLink,
                voteCount,
                voteButton,
                voteMessage
            );

            grid.appendChild(card);
        });

    } catch (error) {
        console.error("Competition data error:", error);

        if (votingInfo) {
            const message = document.createElement("p");
            message.textContent =
                "Competition information could not be loaded. Please try again later.";
            votingInfo.appendChild(message);
        }
    }
});

