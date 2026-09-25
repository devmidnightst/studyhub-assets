const KEY = {
    done:     "nocturne-onboarded",
    accent:   "nocturne-accent",
    bgTheme:  "nocturne-bg-theme",
    bgFx:     "nocturne-bgfx",
    engine:   "nocturne-engine",
    cloak:    "nocturne-cloak",
    autoAb:   "nocturne-auto-ab",
    island:   "nocturne-island",
    perf:     "nocturne-perf-tier"
};

const PERF_TIERS = [
    { id: "low",    name: "Low",    sub: "Older or low-power devices",      detail: "No animations, no background effects — fastest & lightest" },
    { id: "medium", name: "Medium", sub: "Most laptops and phones",         detail: "Keeps normal motion, drops the heaviest background effects" },
    { id: "high",   name: "High",   sub: "Modern or high-end hardware",     detail: "Everything on — full backdrop, particles, animations" }
];

const ACCENTS = [
    { id: "lavender", color: "#b8b0da", glow: "rgba(184, 176, 218, 0.5)" },
    { id: "mint",     color: "#9bdab0", glow: "rgba(155, 218, 176, 0.45)" },
    { id: "sky",      color: "#95c8e0", glow: "rgba(149, 200, 224, 0.45)" },
    { id: "rose",     color: "#e0a8c4", glow: "rgba(224, 168, 196, 0.45)" },
    { id: "amber",    color: "#e0c490", glow: "rgba(224, 196, 144, 0.45)" },
    { id: "mono",     color: "#cfcadf", glow: "rgba(207, 202, 223, 0.45)" }
];

const BG_THEMES = [
    { id: "stars",  label: "Starfield", className: "stars"  },
    { id: "aurora", label: "Aurora",    className: "aurora" },
    { id: "nebula", label: "Nebula",    className: "nebula" },
    { id: "ocean",  label: "Ocean",     className: "ocean"  },
    { id: "sunset", label: "Sunset",    className: "sunset" },
    { id: "mono",   label: "Mono",      className: "mono"   },
    { id: "embers", label: "Embers",    className: "embers" },
    { id: "miku",   label: "Miku",      className: "miku"   },
    { id: "teto",   label: "Teto",      className: "teto"   },
    { id: "off",    label: "Off",       className: "off"    }
];

try { window.NOCTURNE_BG_THEMES = BG_THEMES; } catch {}

const ENGINES = [
    { id: "duckduckgo", name: "DuckDuckGo", sub: "Default engine, most private",  letter: "D", domain: "duckduckgo.com" },
    { id: "google",     name: "Google",    sub: "Familiar results if you use google",       letter: "G", domain: "google.com" },
    { id: "bing",       name: "Bing",      sub: "ew who uses this",       letter: "B", domain: "bing.com", logo: "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect x='7.4' y='3.4' width='3.4' height='18.2' rx='1.7' fill='%2300a4ef'/><circle cx='14.3' cy='16.8' r='5.4' fill='none' stroke='%2300a4ef' stroke-width='3.3'/></svg>" },
    { id: "brave",      name: "Brave",     sub: "Independent index",      letter: "B", domain: "brave.com" },
    { id: "startpage",  name: "Startpage", sub: "Google, but private",letter: "S", domain: "startpage.com" }
];

const CLOAKS = [
    { id: "",          name: "Off",              sub: "Show Nocturne tab",        letter: "-" },
    { id: "classroom", name: "Google Classroom", sub: "Class dashboard",          letter: "C" },
    { id: "docs",      name: "Google Docs",      sub: "Document tab",             letter: "D" },
    { id: "drive",     name: "Google Drive",     sub: "My Drive",                 letter: "D" },
    { id: "khan",      name: "Khan Academy",     sub: "Learning",                 letter: "K" },
    { id: "gmail",     name: "Gmail",            sub: "Inbox (1)",                letter: "G" }
];

const CLOAK_TITLES = {
    classroom: "Google Classroom",
    docs:      "Google Docs",
    drive:     "My Drive - Google Drive",
    khan:      "Khan Academy",
    gmail:     "Inbox (1) - Gmail"
};

const CLOAK_ICONS = {
    classroom: "https://ssl.gstatic.com/classroom/favicon.ico",
    docs:      "https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico",
    drive:     "https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_32dp.png",
    khan:      "https://www.khanacademy.org/favicon.ico",
    gmail:     "https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico"
};

const state = {
    step: 0,
    accent: localStorage.getItem(KEY.accent) || "#b8b0da",
    bgTheme: localStorage.getItem(KEY.bgTheme) || "stars",
    engine: localStorage.getItem(KEY.engine) || "duckduckgo",
    cloak: localStorage.getItem(KEY.cloak) || "",
    autoAb: localStorage.getItem(KEY.autoAb) === "1",
    islandOn: localStorage.getItem(KEY.island) !== "off",
    perf: localStorage.getItem(KEY.perf) || document.documentElement.dataset.perfTier || "high"
};

function shade(hex, percent) {
    const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
    if (!m) return hex;
    let r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const f = 1 + percent / 100;
    r = Math.max(0, Math.min(255, Math.round(r * f)));
    g = Math.max(0, Math.min(255, Math.round(g * f)));
    b = Math.max(0, Math.min(255, Math.round(b * f)));
    return "#" + r.toString(16).padStart(2,"0") + g.toString(16).padStart(2,"0") + b.toString(16).padStart(2,"0");
}

function applyAccent(color) {
    document.documentElement.style.setProperty("--accent", color);
    document.documentElement.style.setProperty("--accent-2", shade(color, -25));
}

function applyBgTheme(theme) {
    const canvas = document.getElementById("bgCanvas");
    let aurora = document.getElementById("bgAurora");
    if (!aurora) {
        aurora = document.createElement("div");
        aurora.id = "bgAurora";
        document.body.insertBefore(aurora, document.body.firstChild);
    }

    const knownThemes = ["aurora", "nebula", "ocean", "sunset", "mono", "embers"];
    for (const t of knownThemes) aurora.classList.remove("theme-" + t);

    if (theme === "stars") {
        if (canvas) canvas.style.display = "";
        aurora.classList.remove("active");
        window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: true }));
        localStorage.setItem(KEY.bgFx, "1");
    } else if (theme === "off") {
        if (canvas) canvas.style.display = "none";
        aurora.classList.remove("active");
        window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: false }));
        localStorage.setItem(KEY.bgFx, "0");
    } else if (knownThemes.includes(theme)) {
        if (canvas) canvas.style.display = "none";
        aurora.classList.add("theme-" + theme);
        aurora.classList.add("active");
        window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: false }));
        localStorage.setItem(KEY.bgFx, "0");
    } else if (theme === "miku" || theme === "teto") {

        if (canvas) canvas.style.display = "none";
        aurora.classList.remove("active");
        window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: false }));
        localStorage.setItem(KEY.bgFx, "0");
    }

    try { window.dispatchEvent(new CustomEvent("nocturne:bgtheme", { detail: theme })); } catch {}
}

try { window.applyBgTheme = applyBgTheme; } catch {}

// Shared with the early bootstrap script in index.html and the in-app Settings
// modal's perfSelect (app.js) — all three read/write "nocturne-perf-tier".
function applyPerfTier(tier) {
    const html = document.documentElement;
    html.dataset.perfTier = tier;
    html.classList.toggle("perf-lite", tier === "low" || tier === "medium");
    html.classList.toggle("perf-min", tier === "low");
}

function _scaleLive(v) {
    document.documentElement.style.fontSize = (16 * (parseInt(v, 10) || 100) / 100) + "px";
}
function _bgImageLive() {
    const dataUrl = localStorage.getItem("nocturne-bg-image") || "";
    let el = document.getElementById("__nocturneBg");
    if (!dataUrl) { if (el) el.remove(); return; }
    if (!el) {
        el = document.createElement("div");
        el.id = "__nocturneBg";
        el.style.cssText = "position:fixed;inset:0;z-index:0;pointer-events:none;background-position:center;background-size:cover;background-repeat:no-repeat;transition:opacity .2s,filter .2s";
        document.body.insertBefore(el, document.body.firstChild);
    }
    el.style.backgroundImage = `url("${dataUrl}")`;
    el.style.opacity = (parseInt(localStorage.getItem("nocturne-bg-opacity"), 10) || 100) / 100;
    el.style.filter = `blur(${parseInt(localStorage.getItem("nocturne-bg-blur"), 10) || 0}px)`;
}

window.addEventListener("storage", (e) => {
    if (!e || !e.key) return;
    switch (e.key) {
        case KEY.bgTheme:
            if (e.newValue) applyBgTheme(e.newValue);
            break;
        case KEY.accent:
            applyAccent(e.newValue || "#b8b0da");
            break;
        case "nocturne-ui-scale":
            _scaleLive(e.newValue);
            break;
        case "nocturne-reduce-motion":
            document.documentElement.classList.toggle("reduce-motion", e.newValue === "1");
            break;
        case KEY.island:
            document.documentElement.classList.toggle("noc-island-off", e.newValue === "off");
            break;
        case KEY.perf:
            if (e.newValue) applyPerfTier(e.newValue);
            break;
        case "nocturne-bg-image":
        case "nocturne-bg-opacity":
        case "nocturne-bg-blur":
            _bgImageLive();
            break;
    }
});

function applyCloakLive(id) {
    const link = document.querySelector("link[rel='icon']") || (() => {
        const l = document.createElement("link"); l.rel = "icon"; document.head.appendChild(l); return l;
    })();
    if (!id) {
        document.title = "Nocturne";
        link.href = "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='%230b0a14'/><circle cx='16' cy='16' r='9' fill='%23c9c1ff'/><circle cx='21' cy='14' r='8' fill='%230b0a14'/></svg>";
    } else {
        if (CLOAK_TITLES[id]) document.title = CLOAK_TITLES[id];
        if (CLOAK_ICONS[id]) link.href = CLOAK_ICONS[id];
    }
    const sel = document.getElementById("cloakSelect");
    if (sel) sel.value = id || "";
}

function applyEngineLive(id) {
    window.dispatchEvent(new CustomEvent("nocturne:engine", { detail: id }));
    const sel = document.getElementById("engineSelect");
    if (sel) sel.value = id;
}

function buildOverlay() {
    const root = document.createElement("div");
    root.id = "onboarding";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Welcome to Nocturne");

    root.innerHTML = `
        <div class="ob-card">
            <div class="ob-head">
                <div class="ob-brand">
                    <span class="ob-brand-mark"></span>
                    <span>NOCTURNE</span>
                </div>
                <button class="ob-skip" data-action="skip">Skip setup</button>
            </div>

            <div class="ob-steps" id="obStepBar"></div>

            <div class="ob-stage" id="obStage"></div>

            <div class="ob-foot">
                <div class="ob-foot-left" id="obStepLabel">Step 1 of 6</div>
                <div class="ob-foot-right">
                    <button class="ob-btn" data-action="back">Back</button>
                    <button class="ob-btn primary" data-action="next">Continue</button>
                </div>
            </div>
        </div>
    `;
    return root;
}

function renderStepBar(root, total, current) {
    const bar = root.querySelector("#obStepBar");
    bar.innerHTML = "";
    for (let i = 0; i < total; i++) {
        const d = document.createElement("div");
        d.className = "ob-step-dot";
        if (i < current) d.classList.add("done");
        else if (i === current) d.classList.add("active");
        bar.appendChild(d);
    }
}

function welcomeStep() {
    return `
        <div class="ob-welcome-body">
            <div class="ob-welcome-orb"></div>
            <div class="ob-welcome-headline">Welcome to Nocturne</div>
            <div class="ob-welcome-tag">Set up your private browsing space. Pick an accent, a backdrop, and your search engine - takes about thirty seconds.</div>
        </div>
    `;
}

function accentStep() {
    const swatches = ACCENTS.map(a => `
        <div class="ob-swatch ${state.accent === a.color ? "selected" : ""}"
             data-accent="${a.color}"
             data-glow="${a.glow}"
             style="--swatch-color:${a.color};--swatch-glow:${a.glow}"
             role="button" tabindex="0" aria-label="${a.id}">
            <span class="ob-swatch-check">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </span>
        </div>
    `).join("");
    return `
        <div class="ob-title">Pick an accent</div>
        <div class="ob-sub">Sets the highlight color across the UI. You can change this later in Settings.</div>
        <div class="ob-grid cols-6">${swatches}</div>
    `;
}

function bgStep() {
    const tiles = BG_THEMES.map(t => `
        <div class="ob-tile ${state.bgTheme === t.id ? "selected" : ""}" data-bg="${t.id}" role="button" tabindex="0">
            <div class="ob-tile-preview ${t.className}"></div>
            <div class="ob-tile-label">${t.label}</div>
        </div>
    `).join("");
    return `
        <div class="ob-title">Choose your backdrop</div>
        <div class="ob-sub">Sets the ambient background behind the app. Any palette except Starfield saves a little CPU.</div>
        <div class="ob-grid cols-4">${tiles}</div>
    `;
}

function engineStep() {
    const engines = ENGINES.map(e => `
        <button class="ob-engine ${state.engine === e.id ? "selected" : ""}" data-engine="${e.id}">
            <span class="ob-engine-icon"><img src="${e.logo || `https://www.google.com/s2/favicons?domain=${e.domain}&sz=64`}" alt="" loading="lazy" onerror="this.parentNode.textContent='${e.letter}'"></span>
            <span class="ob-engine-meta">
                <span class="ob-engine-name">${e.name}</span>
                <span class="ob-engine-sub">${e.sub}</span>
            </span>
        </button>
    `).join("");
    return `
        <div class="ob-title">Default search engine</div>
        <div class="ob-sub">Used when you type something that isn't a URL.</div>
        <div class="ob-engines">${engines}</div>
    `;
}

function abStep() {
    const on = state.autoAb;
    return `
        <div class="ob-title">Cloak on arrival</div>
        <div class="ob-sub">Open Nocturne inside an <code>about:blank</code> tab automatically every time you visit, so the address bar gives nothing away. Your browser asks for one click to allow the pop-up. You can change this anytime in Settings &rsaquo; Browse.</div>
        <div class="ob-choices">
            <button class="ob-choice ${on ? "" : "selected"}" data-autoab="0" type="button">
                <span class="ob-choice-ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></svg>
                </span>
                <span class="ob-choice-meta"><span class="ob-choice-name">Off</span><span class="ob-choice-sub">Open Nocturne normally</span></span>
            </button>
            <button class="ob-choice ${on ? "selected" : ""}" data-autoab="1" type="button">
                <span class="ob-choice-ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 8h18"/><circle cx="6" cy="6" r="0.5" fill="currentColor"/></svg>
                </span>
                <span class="ob-choice-meta"><span class="ob-choice-name">On</span><span class="ob-choice-sub">Auto-open in about:blank</span></span>
            </button>
        </div>
    `;
}

function islandStep() {
    const I = {
        chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
        clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19a4.5 4.5 0 0 0 0-9 6 6 0 0 0-11.5 2A3.5 3.5 0 0 0 6 19z"/></svg>',
        gauge: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14l4-4"/><path d="M4 18a8 8 0 1 1 16 0z"/></svg>',
        travel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="14.5 9.5 9.5 11 9.5 14.5 14.5 13" fill="currentColor" stroke="none"/></svg>',
        music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
        ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>',
        ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4a2 2 0 1 0-4 0v2H7a1 1 0 0 0-1 1v3H4a2 2 0 1 0 0 4h2v3a1 1 0 0 0 1 1h3v-2a2 2 0 1 1 4 0v2h3a1 1 0 0 0 1-1v-3h2a2 2 0 1 0 0-4h-2V7a1 1 0 0 0-1-1h-3z"/></svg>'
    };
    const on = state.islandOn;
    return `
        <div class="ob-title">Meet your dynamic island</div>
        <div class="ob-sub">Nocturne has two glass control surfaces you can pull up anytime — no page reloads. Look for them once you're in.</div>
        <div class="ob-island-demo">
            <div class="obi">
                <div class="obi-h">${I.chev} Top dashboard</div>
                <div class="obi-row"><span class="d">${I.clock}</span> Clock &amp; calendar</div>
                <div class="obi-row"><span class="d">${I.cloud}</span> Weather &amp; session</div>
                <div class="obi-row"><span class="d">${I.gauge}</span> Media &amp; performance</div>
                <div class="obi-row" style="color:var(--fg-3);font-size:11px;margin-top:2px">↑ Hover the top edge to pop it down.</div>
            </div>
            <div class="obi">
                <div class="obi-h">${I.travel} Side island</div>
                <div class="obi-row"><span class="d">${I.travel}</span> Travel anywhere</div>
                <div class="obi-row"><span class="d">${I.music}</span> Music player</div>
                <div class="obi-row"><span class="d">${I.ai}</span> Pocket AI</div>
                <div class="obi-row"><span class="d">${I.ext}</span> Extensions</div>
            </div>
        </div>
        <div class="ob-sub" style="margin-top:14px">Want it?</div>
        <div class="ob-choices">
            <button class="ob-choice ${on ? "selected" : ""}" data-island="1" type="button">
                <span class="ob-choice-ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="14" rx="2"/><path d="M3 8h18"/><circle cx="6" cy="6" r="0.5" fill="currentColor"/></svg>
                </span>
                <span class="ob-choice-meta"><span class="ob-choice-name">Keep it on</span><span class="ob-choice-sub">Show the floating bars</span></span>
            </button>
            <button class="ob-choice ${on ? "" : "selected"}" data-island="0" type="button">
                <span class="ob-choice-ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M9 12h6"/></svg>
                </span>
                <span class="ob-choice-meta"><span class="ob-choice-name">Turn it off</span><span class="ob-choice-sub">Use the plain bottom dock instead</span></span>
            </button>
        </div>
    `;
}

function perfCardsHtml() {
    return PERF_TIERS.map(t => `
        <div class="ob-perf-card ${state.perf === t.id ? "selected" : ""}" data-perf="${t.id}" role="button" tabindex="0">
            <div class="ob-perf-name">${t.name}</div>
            <div class="ob-perf-sub">${t.sub}</div>
            <div class="ob-perf-detail">${t.detail}</div>
        </div>
    `).join("");
}

function perfStep() {
    return `
        <div class="ob-title">Performance</div>
        <div class="ob-sub">Choose how much visual flair Nocturne runs. You can change this later in Settings.</div>
        <div class="ob-grid cols-3 ob-perf-grid">${perfCardsHtml()}</div>
        <button class="ob-ai-detect" type="button" id="obPerfAi">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/></svg>
            <span id="obPerfAiLabel">Let AI pick for me</span>
        </button>
        <div class="ob-perf-ai-result" id="obPerfAiResult" hidden></div>
    `;
}

// Best-effort device fingerprint for the /api/perf/recommend endpoint — every
// field here is optional and already exposed to any page via standard browser
// APIs, so there's nothing sensitive being collected beyond what a normal
// analytics script would see.
function collectDeviceSpecs() {
    const nav = navigator;
    const specs = {
        cores: nav.hardwareConcurrency || null,
        memoryGB: nav.deviceMemory || null,
        platform: nav.platform || null,
        userAgent: nav.userAgent || null,
        screen: { w: screen.width, h: screen.height, dpr: window.devicePixelRatio || 1 },
        connection: null,
        gpu: null
    };
    try {
        const conn = nav.connection || nav.mozConnection || nav.webkitConnection;
        if (conn) specs.connection = { effectiveType: conn.effectiveType || null, downlinkMbps: conn.downlink || null, saveData: !!conn.saveData };
    } catch {}
    try {
        const c = document.createElement("canvas");
        const gl = c.getContext("webgl") || c.getContext("experimental-webgl");
        if (gl) {
            const ext = gl.getExtension("WEBGL_debug_renderer_info");
            if (ext) specs.gpu = { renderer: gl.getParameter(ext.UNMASKED_RENDERER_WEBGL), vendor: gl.getParameter(ext.UNMASKED_VENDOR_WEBGL) };
        }
    } catch {}
    return specs;
}

async function runPerfAiDetect(stepEl) {
    const btn = stepEl.querySelector("#obPerfAi");
    const label = stepEl.querySelector("#obPerfAiLabel");
    const resultEl = stepEl.querySelector("#obPerfAiResult");
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    const origLabel = label.textContent;
    label.textContent = "Analyzing your device…";
    resultEl.hidden = true;
    resultEl.className = "ob-perf-ai-result";
    try {
        const r = await fetch("/api/perf/recommend", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ specs: collectDeviceSpecs() })
        });
        const data = await r.json().catch(() => null);
        if (!r.ok || !data || !data.tier) throw new Error((data && data.error) || "no recommendation");
        state.perf = data.tier;
        localStorage.setItem(KEY.perf, state.perf);
        applyPerfTier(state.perf);
        stepEl.querySelectorAll(".ob-perf-card").forEach(c => c.classList.toggle("selected", c.dataset.perf === state.perf));
        resultEl.hidden = false;
        resultEl.innerHTML = `Recommended <strong style="text-transform:capitalize">${state.perf}</strong> — ${data.reason || "based on your device."}`
            + (data.searched ? ' <span class="ob-perf-searched">(researched your hardware online)</span>' : "");
        label.textContent = "Re-analyze";
    } catch (e) {
        resultEl.hidden = false;
        resultEl.className = "ob-perf-ai-result error";
        resultEl.textContent = "Couldn't reach the AI just now — pick a tier above instead.";
        label.textContent = origLabel;
    } finally {
        btn.disabled = false;
    }
}

function doneStep() {
    const accentName = ACCENTS.find(a => a.color === state.accent)?.id || "custom";
    const bgName = BG_THEMES.find(t => t.id === state.bgTheme)?.label || "-";
    const engName = ENGINES.find(e => e.id === state.engine)?.name || "-";
    return `
        <div class="ob-done">
            <div class="ob-done-tick">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12l5 5L20 7"/></svg>
            </div>
            <div class="ob-title" style="text-align:center">You're all set</div>
            <div class="ob-sub" style="text-align:center">Your preferences are saved - change anything later from Settings.</div>
            <div class="ob-summary">
                <div class="ob-summary-row"><span class="ob-summary-label">Accent</span><span class="ob-summary-value" style="text-transform:capitalize">${accentName}</span></div>
                <div class="ob-summary-row"><span class="ob-summary-label">Backdrop</span><span class="ob-summary-value">${bgName}</span></div>
                <div class="ob-summary-row"><span class="ob-summary-label">Search</span><span class="ob-summary-value">${engName}</span></div>
                <div class="ob-summary-row"><span class="ob-summary-label">Auto about:blank</span><span class="ob-summary-value">${state.autoAb ? "On" : "Off"}</span></div>
                <div class="ob-summary-row"><span class="ob-summary-label">Dynamic island</span><span class="ob-summary-value">${state.islandOn ? "On" : "Off"}</span></div>
                <div class="ob-summary-row"><span class="ob-summary-label">Performance</span><span class="ob-summary-value" style="text-transform:capitalize">${state.perf}</span></div>
            </div>
        </div>
    `;
}

const STEPS = [
    { id: "welcome", render: welcomeStep, canBack: false },
    { id: "accent",  render: accentStep,  canBack: true  },
    { id: "bg",      render: bgStep,      canBack: true  },
    { id: "engine",  render: engineStep,  canBack: true  },
    { id: "ab",      render: abStep,      canBack: true  },
    { id: "islands", render: islandStep,  canBack: true  },
    { id: "perf",    render: perfStep,    canBack: true  },
    { id: "done",    render: doneStep,    canBack: true  }
];

let _lastStep = -1;
let _exitTimer = null;
let _lastRenderAt = 0;
const FAST_CLICK_MS = 280;

function renderStep(root) {
    const stage = root.querySelector("#obStage");
    const step = STEPS[state.step];
    const direction = state.step >= _lastStep ? 1 : -1;
    _lastStep = state.step;

    if (_exitTimer) {
        clearTimeout(_exitTimer);
        _exitTimer = null;
    }
    stage.querySelectorAll(".ob-step:not(.active), .ob-step.exit-left, .ob-step.exit-right")
        .forEach(el => el.remove());

    const now = performance.now();
    const isFastClick = now - _lastRenderAt < FAST_CLICK_MS;
    _lastRenderAt = now;

    const oldEl = stage.querySelector(".ob-step");
    const newEl = document.createElement("div");
    newEl.className = "ob-step";
    newEl.style.setProperty("--enter-x", (direction * (isFastClick ? 14 : 26)) + "px");
    newEl.innerHTML = step.render();
    stage.appendChild(newEl);

    let cascadeTargets = [];
    if (!isFastClick) {
        const cascadeEase = "cubic-bezier(0.32, 0.72, 0, 1)";
        cascadeTargets = Array.from(newEl.querySelectorAll(".ob-swatch, .ob-tile, .ob-engine, .ob-cloak, .ob-choice, .ob-summary-row"));
        cascadeTargets.forEach((el, i) => {
            el.style.opacity = "0";
            el.style.transform = "translate3d(0, 8px, 0)";
            el.style.transition = `opacity 0.42s ${cascadeEase}, transform 0.42s ${cascadeEase}`;
            el.style.transitionDelay = (60 + i * 26) + "ms";
            el.style.willChange = "transform, opacity";
        });
    }

    requestAnimationFrame(() => {
        if (oldEl) {
            oldEl.classList.remove("active");
            oldEl.classList.add(direction > 0 ? "exit-left" : "exit-right");
            _exitTimer = setTimeout(() => {
                if (oldEl.parentNode) oldEl.remove();
                _exitTimer = null;
            }, isFastClick ? 220 : 320);
        }
        newEl.classList.add("active");
        if (cascadeTargets.length) {
            requestAnimationFrame(() => {
                cascadeTargets.forEach(el => {
                    el.style.opacity = "";
                    el.style.transform = "";
                });
                setTimeout(() => {
                    cascadeTargets.forEach(el => {
                        el.style.transition = "";
                        el.style.transitionDelay = "";
                        el.style.willChange = "";
                    });
                }, 900);
            });
        }
        wireStep(newEl);
    });

    renderStepBar(root, STEPS.length, state.step);
    root.querySelector("#obStepLabel").textContent = `Step ${state.step + 1} of ${STEPS.length}`;

    const backBtn = root.querySelector('[data-action="back"]');
    const nextBtn = root.querySelector('[data-action="next"]');
    backBtn.disabled = !step.canBack || state.step === 0;
    nextBtn.textContent = state.step === STEPS.length - 1 ? "Enter Nocturne" : "Continue";
}

function wireStep(stepEl) {
    stepEl.querySelectorAll("[data-accent]").forEach(el => {
        el.addEventListener("click", () => {
            state.accent = el.dataset.accent;
            localStorage.setItem(KEY.accent, state.accent);
            applyAccent(state.accent);
            stepEl.querySelectorAll(".ob-swatch").forEach(s => s.classList.toggle("selected", s.dataset.accent === state.accent));
        });
        el.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
        });
    });

    stepEl.querySelectorAll("[data-bg]").forEach(el => {
        el.addEventListener("click", () => {
            state.bgTheme = el.dataset.bg;
            localStorage.setItem(KEY.bgTheme, state.bgTheme);
            applyBgTheme(state.bgTheme);
            stepEl.querySelectorAll(".ob-tile").forEach(t => t.classList.toggle("selected", t.dataset.bg === state.bgTheme));
        });
        el.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
        });
    });

    stepEl.querySelectorAll("[data-engine]").forEach(el => {
        el.addEventListener("click", () => {
            state.engine = el.dataset.engine;
            localStorage.setItem(KEY.engine, state.engine);
            applyEngineLive(state.engine);
            stepEl.querySelectorAll(".ob-engine").forEach(b => b.classList.toggle("selected", b.dataset.engine === state.engine));
        });
    });

    stepEl.querySelectorAll("[data-cloak]").forEach(el => {
        el.addEventListener("click", () => {
            state.cloak = el.dataset.cloak;
            if (state.cloak) localStorage.setItem(KEY.cloak, state.cloak);
            else localStorage.removeItem(KEY.cloak);
            applyCloakLive(state.cloak);
            stepEl.querySelectorAll(".ob-cloak").forEach(b => b.classList.toggle("selected", b.dataset.cloak === state.cloak));
        });
    });

    stepEl.querySelectorAll("[data-autoab]").forEach(el => {
        el.addEventListener("click", () => {
            state.autoAb = el.dataset.autoab === "1";
            localStorage.setItem(KEY.autoAb, state.autoAb ? "1" : "0");
            stepEl.querySelectorAll(".ob-choice").forEach(b => b.classList.toggle("selected", (b.dataset.autoab === "1") === state.autoAb));
        });
    });

    stepEl.querySelectorAll("[data-island]").forEach(el => {
        el.addEventListener("click", () => {
            state.islandOn = el.dataset.island === "1";
            if (typeof window.__nocIslandSetEnabled === "function") window.__nocIslandSetEnabled(state.islandOn);
            else try { localStorage.setItem(KEY.island, state.islandOn ? "on" : "off"); } catch {}
            stepEl.querySelectorAll(".ob-choice").forEach(b => b.classList.toggle("selected", (b.dataset.island === "1") === state.islandOn));
        });
    });

    stepEl.querySelectorAll("[data-perf]").forEach(el => {
        el.addEventListener("click", () => {
            state.perf = el.dataset.perf;
            localStorage.setItem(KEY.perf, state.perf);
            applyPerfTier(state.perf);
            stepEl.querySelectorAll(".ob-perf-card").forEach(c => c.classList.toggle("selected", c.dataset.perf === state.perf));
        });
        el.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); el.click(); }
        });
    });
    const perfAiBtn = stepEl.querySelector("#obPerfAi");
    if (perfAiBtn) perfAiBtn.addEventListener("click", () => runPerfAiDetect(stepEl));
}

function finish(root) {
    localStorage.setItem(KEY.done, "1");
    localStorage.setItem(KEY.autoAb, state.autoAb ? "1" : "0");
    try { localStorage.setItem(KEY.island, state.islandOn ? "on" : "off"); } catch {}
    localStorage.setItem(KEY.perf, state.perf);
    applyAccent(state.accent);
    applyBgTheme(state.bgTheme);
    applyEngineLive(state.engine);
    applyCloakLive(state.cloak);
    applyPerfTier(state.perf);
    root.classList.remove("visible");
    root.classList.add("leaving");
    setTimeout(() => {
        root.remove();

        window.dispatchEvent(new CustomEvent("nocturne:onboarded", { detail: { ...state } }));
    }, 600);
}

function mount() {
    const params = new URLSearchParams(window.location.search);
    const forceOpen = params.get("onboard") === "1" || params.get("onboarding") === "1";
    if (!forceOpen && localStorage.getItem(KEY.done) === "1") {
        console.info("[onboarding] skipped (already onboarded). Force open: /?onboard=1");
        return;
    }
    if (forceOpen) {
        console.info("[onboarding] force-opened via URL param");
        localStorage.removeItem(KEY.done);
    }

    if (localStorage.getItem(KEY.accent)) applyAccent(localStorage.getItem(KEY.accent));
    if (localStorage.getItem(KEY.bgTheme)) applyBgTheme(localStorage.getItem(KEY.bgTheme));

    const root = buildOverlay();
    document.body.appendChild(root);

    renderStep(root);

    requestAnimationFrame(() => root.classList.add("visible"));

    root.addEventListener("click", e => {
        const action = e.target.closest("[data-action]")?.dataset.action;
        if (action === "skip") { finish(root); return; }
        if (action === "back") {
            if (state.step > 0) { state.step--; renderStep(root); }
            return;
        }
        if (action === "next") {
            if (state.step < STEPS.length - 1) { state.step++; renderStep(root); }
            else finish(root);
            return;
        }
    });

    document.addEventListener("keydown", e => {
        if (!document.getElementById("onboarding")) return;
        if (e.key === "Escape") { finish(root); }
        if (e.key === "ArrowRight" && state.step < STEPS.length - 1) {
            state.step++; renderStep(root);
        }
        if (e.key === "ArrowLeft" && state.step > 0) {
            state.step--; renderStep(root);
        }
    });
}

function openAboutBlankWrapper() {
    let w;
    try { w = window.open(); } catch (e) { w = null; }
    if (!w) return false;
    try {
        w.document.open();
        w.document.write('<!doctype html><html><head><title>about:blank</title><link rel="icon" href="data:,"><style>html,body{margin:0;padding:0;background:#05060d;height:100%;overflow:hidden}iframe{border:0;width:100vw;height:100vh;display:block}</style></head><body><iframe src="' + location.origin + '/?nocab=1" allow="clipboard-read; clipboard-write; fullscreen"></iframe></body></html>');
        w.document.close();
    } catch (e) {
        try { w.location = location.origin + "/?nocab=1"; } catch (e2) {}
    }
    return true;
}

function maybeAutoAboutBlank() {
    try {
        if (localStorage.getItem(KEY.autoAb) !== "1") return;
        if (window.self !== window.top) return;
        if (location.search.indexOf("nocab=1") !== -1) return;
        if (sessionStorage.getItem("noc-ab-launched") === "1") return;
        const cleanup = () => {
            document.removeEventListener("click", fire, true);
            document.removeEventListener("keydown", fire, true);
        };
        function fire() {
            if (sessionStorage.getItem("noc-ab-launched") === "1") { cleanup(); return; }
            if (!openAboutBlankWrapper()) return;
            sessionStorage.setItem("noc-ab-launched", "1");
            cleanup();
        }
        document.addEventListener("click", fire, true);
        document.addEventListener("keydown", fire, true);
    } catch (e) {}
}
maybeAutoAboutBlank();

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mount, { once: true });
} else {
    mount();
}
