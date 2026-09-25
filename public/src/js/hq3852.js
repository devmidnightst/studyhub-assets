// First-visit Discord chip. Shows ONCE (gated by a localStorage flag), AFTER the
// onboarding flow completes, promoting the community invite. Slides in, waits 3
// seconds, then slides out on its own. Reuses the .update-toast styles from
// notice.css (already linked on index.html) so it matches the existing chip.
(function () {
    "use strict";

    var SEEN_KEY = "nocturne-discord-chip-seen";
    var ONBOARDED_KEY = "nocturne-onboarded";
    var INVITE = "https://discord.gg/lanschool";
    var HOLD_MS = 3000;   // how long it stays before leaving

    // Only ever show it once per browser.
    try { if (localStorage.getItem(SEEN_KEY) === "1") return; } catch (e) { return; }

    function build() {
        var chip = document.createElement("div");
        chip.className = "update-toast";
        chip.id = "discordChip";
        chip.setAttribute("role", "status");
        chip.innerHTML =
            '<div class="ut-icon" aria-hidden="true">' +
              '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">' +
                '<path d="M20.32 4.37A19.8 19.8 0 0 0 15.4 2.9a13.7 13.7 0 0 0-.63 1.28 18.3 18.3 0 0 0-5.5 0A13.7 13.7 0 0 0 8.63 2.9 19.8 19.8 0 0 0 3.7 4.37 20.26 20.26 0 0 0 .2 18.06a19.9 19.9 0 0 0 6.06 3.06c.49-.67.92-1.38 1.3-2.12a12.9 12.9 0 0 1-2.05-.99c.17-.13.34-.26.5-.4a14.2 14.2 0 0 0 12.1 0c.16.14.33.27.5.4-.66.39-1.35.72-2.06.99.37.74.81 1.45 1.3 2.12a19.86 19.86 0 0 0 6.06-3.06 20.24 20.24 0 0 0-3.5-13.69ZM8.02 15.33c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43 1.2 0 2.17 1.1 2.15 2.43 0 1.33-.95 2.42-2.15 2.42Zm7.96 0c-1.18 0-2.15-1.09-2.15-2.42 0-1.34.95-2.43 2.15-2.43 1.2 0 2.17 1.1 2.15 2.43 0 1.33-.94 2.42-2.15 2.42Z"/>' +
              '</svg>' +
            '</div>' +
            '<div class="ut-body">' +
              '<div class="ut-title">Join our Discord</div>' +
              '<div class="ut-desc"><a href="' + INVITE + '" target="_blank" rel="noopener">discord.gg/lanschool</a> &mdash; Nitro giveaway &amp; more</div>' +
            '</div>' +
            '<button class="ut-close" type="button" aria-label="Dismiss">&times;</button>';
        return chip;
    }

    function show() {
        // Guard against a double-show (e.g. flag written between checks).
        try { if (localStorage.getItem(SEEN_KEY) === "1") return; } catch (e) { return; }
        if (document.getElementById("discordChip")) return;
        if (!document.body) return;

        var chip = build();
        document.body.appendChild(chip);

        var leaveTimer = null;
        var leave = function () {
            if (leaveTimer) { clearTimeout(leaveTimer); leaveTimer = null; }
            chip.classList.add("dismissing");
            setTimeout(function () { chip.remove(); }, 300);
        };

        // Mark seen as soon as it appears so a reload never re-shows it.
        try { localStorage.setItem(SEEN_KEY, "1"); } catch (e) {}

        // Clicking the close button (or the invite) dismisses early; otherwise it
        // leaves on its own after HOLD_MS.
        chip.querySelector(".ut-close").addEventListener("click", leave);
        chip.querySelector(".ut-desc a").addEventListener("click", function () { setTimeout(leave, 150); });

        // Slide in, hold, then slide out.
        setTimeout(function () {
            chip.classList.add("visible");
            leaveTimer = setTimeout(leave, HOLD_MS);
        }, 400);
    }

    // Fire only after onboarding. If the user has already onboarded, show shortly
    // after load; otherwise wait for the onboarding flow to finish.
    function start() {
        var onboarded = false;
        try { onboarded = localStorage.getItem(ONBOARDED_KEY) === "1"; } catch (e) {}
        if (onboarded) {
            setTimeout(show, 600);
        } else {
            window.addEventListener("nocturne:onboarded", function () { setTimeout(show, 400); }, { once: true });
        }
    }

    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", start);
    } else {
        start();
    }
})();
