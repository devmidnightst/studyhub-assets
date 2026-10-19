const WELCOME_KEY = "nocturne-welcome-shown-v1";

export function initWelcome() {
    const welcomeBanner = document.getElementById("welcomeBanner");
    const okBtn = document.querySelector(".welcome-ok-btn");

    if (!welcomeBanner || !okBtn) return;

    const hasShownWelcome = localStorage.getItem(WELCOME_KEY) === "true";

    if (hasShownWelcome) {
        welcomeBanner.classList.add("hidden");
        return;
    }

    function closeWelcome() {
        welcomeBanner.style.animation = "slideDown 0.3s var(--ease) reverse forwards";
        setTimeout(() => {
            welcomeBanner.classList.add("hidden");
            localStorage.setItem(WELCOME_KEY, "true");
        }, 300);
    }

    okBtn.addEventListener("click", closeWelcome);
}
