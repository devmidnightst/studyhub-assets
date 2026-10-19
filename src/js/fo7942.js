const PEGTOP_PATH = "M63,37c-6.7-4-4-27-13-27s-6.3,23-13,27-27,4-27,13,20.3,9,27,13,4,27,13,27,6.3-23,13-27,27-4,27-13-20.3-9-27-13Z";

function pegtopSvg(id) {
    return `<svg id="${id}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 100 100">
        <defs>
            <filter id="${id}-shine"><feGaussianBlur stdDeviation="3"/></filter>
            <mask id="${id}-mask"><path d="${PEGTOP_PATH}" fill="white"/></mask>
            <radialGradient id="${id}-g1" cx="50" cy="66" fx="50" fy="66" r="30" gradientTransform="translate(0 35) scale(1 0.5)" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="black" stop-opacity="0.3"/><stop offset="50%" stop-color="black" stop-opacity="0.1"/><stop offset="100%" stop-color="black" stop-opacity="0"/>
            </radialGradient>
            <radialGradient id="${id}-g2" cx="55" cy="20" fx="55" fy="20" r="30" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="white" stop-opacity="0.3"/><stop offset="50%" stop-color="white" stop-opacity="0.1"/><stop offset="100%" stop-color="white" stop-opacity="0"/>
            </radialGradient>
            <radialGradient id="${id}-g3" cx="85" cy="50" fx="85" fy="50" xlink:href="#${id}-g2"/>
            <radialGradient id="${id}-g4" cx="50" cy="58" fx="50" fy="58" r="60" gradientTransform="translate(0 47) scale(1 0.2)" xlink:href="#${id}-g3"/>
            <linearGradient id="${id}-g5" x1="50" y1="90" x2="50" y2="10" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="black" stop-opacity="0.2"/><stop offset="40%" stop-color="black" stop-opacity="0"/>
            </linearGradient>
        </defs>
        <g>
            <path d="${PEGTOP_PATH}" fill="currentColor"/>
            <path d="${PEGTOP_PATH}" fill="url(#${id}-g1)"/>
            <path d="${PEGTOP_PATH}" fill="none" stroke="white" opacity="0.3" stroke-width="3" filter="url(#${id}-shine)" mask="url(#${id}-mask)"/>
            <path d="${PEGTOP_PATH}" fill="url(#${id}-g2)"/>
            <path d="${PEGTOP_PATH}" fill="url(#${id}-g3)"/>
            <path d="${PEGTOP_PATH}" fill="url(#${id}-g4)"/>
            <path d="${PEGTOP_PATH}" fill="url(#${id}-g5)"/>
        </g>
    </svg>`;
}

export function pegtopHTML(text = "Loading your content") {
    return `<div class="pegtop-stack">
        <div class="loader">${pegtopSvg("pegtopone")}${pegtopSvg("pegtoptwo")}${pegtopSvg("pegtopthree")}</div>
        <div class="pegtop-text">${text}</div>
    </div>`;
}

class PegtopLoader {
    constructor(el) {
        this.el = el;
        if (el && !el.querySelector(".pegtop-stack")) {
            el.innerHTML = pegtopHTML("Loading your content");
        }
        this.textEl = el ? el.querySelector(".pegtop-text") : null;
        this.visible = false;
    }

    setText(text) {
        if (this.textEl && text) this.textEl.textContent = text;
    }

    start() {
        if (!this.el) return;
        this.el.classList.remove("finishing");
        this.el.classList.add("visible");
        this.visible = true;
        this.setText("Loading your content");
    }

    stage(_name) {}

    finish() {
        if (!this.el || !this.visible) return;
        this.el.classList.add("finishing");
        setTimeout(() => {
            this.el.classList.remove("visible", "finishing");
            this.visible = false;
        }, 350);
    }

    fail() {
        if (!this.el) return;
        this.el.classList.remove("visible", "finishing");
        this.visible = false;
    }
}

export function mountLoader(root) {
    return new PegtopLoader(root);
}
