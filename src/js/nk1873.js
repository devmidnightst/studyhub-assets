const $ = id => document.getElementById(id);

const PREFS = {
    bgImage:       "nocturne-bg-image",
    bgOpacity:     "nocturne-bg-opacity",
    bgBlur:        "nocturne-bg-blur",
    bgFx:          "nocturne-bgfx",
    bgTheme:       "nocturne-bg-theme",
    accent:        "nocturne-accent",
    font:          "nocturne-font",
    fontStack:     "nocturne-font-stack",
    fontCss:       "nocturne-font-css",
    uiScale:       "nocturne-ui-scale",
    reduceMotion:  "nocturne-reduce-motion",
    island:        "nocturne-island",
    searchEngine:  "nocturne-engine",
    cloak:         "nocturne-cloak",
    autoAb:        "nocturne-auto-ab",
    floodSites:    "nocturne-flood-sites",
    debug:         "nocturne-debug",
    adCooldown:    "cherri_adCooldownMin"
};

const FLOOD_DEFAULTS = [
    "https://www.khanacademy.org",
    "https://en.wikipedia.org",
    "https://quizlet.com",
    "https://www.britannica.com",
    "https://scholar.google.com",
    "https://www.coursera.org",
    "https://www.edx.org",
    "https://www.bbc.co.uk/bitesize",
    "https://www.ixl.com",
    "https://www.wolframalpha.com",
    "https://www.nationalgeographic.com",
    "https://www.nasa.gov",
    "https://www.desmos.com",
    "https://www.gutenberg.org",
    "https://www.duolingo.com"
];

const BG_THEMES = [
    { id: "stars",  label: "Starfield" },
    { id: "aurora", label: "Aurora"    },
    { id: "nebula", label: "Nebula"    },
    { id: "ocean",  label: "Ocean"     },
    { id: "sunset", label: "Sunset"    },
    { id: "mono",   label: "Mono"      },
    { id: "embers", label: "Embers"    },
    { id: "miku",   label: "Miku"      },
    { id: "teto",   label: "Teto"      },
    { id: "off",    label: "Off"       }
];

const FONTS = [
    { id: "inter",         label: "Inter (default)",     stack: "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", css: "" },
    { id: "poppins",       label: "Poppins",             stack: "'Poppins', sans-serif",            css: "Poppins:wght@400;500;600;700" },
    { id: "outfit",        label: "Outfit",              stack: "'Outfit', sans-serif",             css: "Outfit:wght@400;500;600;700" },
    { id: "sora",          label: "Sora",                stack: "'Sora', sans-serif",               css: "Sora:wght@400;500;600;700" },
    { id: "space-grotesk", label: "Space Grotesk",       stack: "'Space Grotesk', sans-serif",      css: "Space+Grotesk:wght@400;500;600;700" },
    { id: "dm-sans",       label: "DM Sans",             stack: "'DM Sans', sans-serif",            css: "DM+Sans:wght@400;500;600;700" },
    { id: "manrope",       label: "Manrope",             stack: "'Manrope', sans-serif",            css: "Manrope:wght@400;500;600;700" },
    { id: "jakarta",       label: "Plus Jakarta Sans",   stack: "'Plus Jakarta Sans', sans-serif",  css: "Plus+Jakarta+Sans:wght@400;500;600;700" },
    { id: "lexend",        label: "Lexend",              stack: "'Lexend', sans-serif",             css: "Lexend:wght@400;500;600;700" },
    { id: "nunito",        label: "Nunito",              stack: "'Nunito', sans-serif",             css: "Nunito:wght@400;500;600;700" },
    { id: "quicksand",     label: "Quicksand",           stack: "'Quicksand', sans-serif",          css: "Quicksand:wght@400;500;600;700" },
    { id: "montserrat",    label: "Montserrat",          stack: "'Montserrat', sans-serif",         css: "Montserrat:wght@400;500;600;700" },
    { id: "rubik",         label: "Rubik",               stack: "'Rubik', sans-serif",              css: "Rubik:wght@400;500;600;700" },
    { id: "figtree",       label: "Figtree",             stack: "'Figtree', sans-serif",            css: "Figtree:wght@400;500;600;700" },
    { id: "onest",         label: "Onest",               stack: "'Onest', sans-serif",              css: "Onest:wght@400;500;600;700" },
    { id: "jetbrains",     label: "JetBrains Mono",      stack: "'JetBrains Mono', ui-monospace, monospace", css: "JetBrains+Mono:wght@400;500;600;700" }
];

const ENGINES = {
    duckduckgo: "DuckDuckGo",
    google:     "Google",
    bing:       "Bing",
    brave:      "Brave",
    startpage:  "Startpage"
};

const CLOAKS = [
    { id: "", label: "Off" },
    { id: "google",     label: "Google" },
    { id: "classroom",  label: "Google Classroom" },
    { id: "drive",      label: "Google Drive" },
    { id: "docs",       label: "Google Docs" },
    { id: "kahoot",     label: "Kahoot!" },
    { id: "khan",       label: "Khan Academy" },
    { id: "wikipedia",  label: "Wikipedia" },
    { id: "newtab",     label: "New Tab" }
];

function get(key, dflt) {
    const v = localStorage.getItem(key);
    return v == null ? dflt : v;
}
function set(key, value) {
    if (value == null || value === "") localStorage.removeItem(key);
    else localStorage.setItem(key, String(value));
}

function applyAccent(color) {
    if (!color) {
        document.documentElement.style.removeProperty("--accent");
        document.documentElement.style.removeProperty("--accent-2");
        return;
    }
    document.documentElement.style.setProperty("--accent", color);
    const darker = shadeColor(color, -25);
    document.documentElement.style.setProperty("--accent-2", darker);
}

function shadeColor(hex, percent) {
    const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
    if (!m) return hex;
    let r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const f = (1 + percent / 100);
    r = Math.max(0, Math.min(255, Math.round(r * f)));
    g = Math.max(0, Math.min(255, Math.round(g * f)));
    b = Math.max(0, Math.min(255, Math.round(b * f)));
    return "#" + r.toString(16).padStart(2,"0") + g.toString(16).padStart(2,"0") + b.toString(16).padStart(2,"0");
}

function applyBgImage(dataUrl, opacity, blur) {
    let el = document.getElementById("__nocturneBg");
    if (!dataUrl) {
        if (el) el.remove();
        return;
    }
    if (!el) {
        el = document.createElement("div");
        el.id = "__nocturneBg";
        el.style.cssText = "position:fixed;inset:0;z-index:0;pointer-events:none;background-position:center;background-size:cover;background-repeat:no-repeat;transition:opacity 0.2s,filter 0.2s";
        document.body.insertBefore(el, document.body.firstChild);
    }
    el.style.backgroundImage = `url("${dataUrl}")`;
    el.style.opacity = (parseInt(opacity, 10) || 100) / 100;
    el.style.filter = `blur(${parseInt(blur, 10) || 0}px)`;
}

function applyFont(stack, cssFamily) {
    if (!stack) {
        document.documentElement.style.removeProperty("--font");
        return;
    }
    if (cssFamily && !document.getElementById("nocFontLink")) {
        const l = document.createElement("link");
        l.id = "nocFontLink"; l.rel = "stylesheet";
        l.href = "https://fonts.googleapis.com/css2?family=" + cssFamily + "&display=swap";
        document.head.appendChild(l);
    } else if (cssFamily) {
        document.getElementById("nocFontLink").href = "https://fonts.googleapis.com/css2?family=" + cssFamily + "&display=swap";
    }
    document.documentElement.style.setProperty("--font", stack);
}

function applyUiScale(percent) {
    const v = parseInt(percent, 10) || 100;
    document.documentElement.style.fontSize = (16 * v / 100) + "px";
}

function applyReduceMotion(on) {
    document.documentElement.classList.toggle("reduce-motion", !!on);
}

function applyAll() {
    applyAccent(get(PREFS.accent, ""));
    applyFont(get(PREFS.fontStack, ""), get(PREFS.fontCss, ""));
    applyBgImage(get(PREFS.bgImage, ""), get(PREFS.bgOpacity, "100"), get(PREFS.bgBlur, "0"));
    applyUiScale(get(PREFS.uiScale, "100"));
    applyReduceMotion(get(PREFS.reduceMotion, "0") === "1");
}

(function bootBackground() {
    const bgFx = get(PREFS.bgFx, "1");
    if (bgFx === "0") {
        const c = document.getElementById("bgCanvas");
        if (c) c.style.display = "none";
    }
    applyAll();
})();

const engineSelect = $("engineSelect");
Object.entries(ENGINES).forEach(([id, label]) => {
    const opt = document.createElement("option");
    opt.value = id; opt.textContent = label;
    engineSelect.appendChild(opt);
});
engineSelect.value = get(PREFS.searchEngine, "duckduckgo");
engineSelect.addEventListener("change", () => set(PREFS.searchEngine, engineSelect.value));

const fontSelect = $("fontSelect");
if (fontSelect) {
    FONTS.forEach(f => {
        const opt = document.createElement("option");
        opt.value = f.id; opt.textContent = f.label;
        fontSelect.appendChild(opt);
    });
    fontSelect.value = get(PREFS.font, "inter");
    fontSelect.addEventListener("change", () => {
        const font = FONTS.find(f => f.id === fontSelect.value) || FONTS[0];
        if (font.id === "inter") {
            set(PREFS.font, "inter");
            set(PREFS.fontStack, "");
            set(PREFS.fontCss, "");
            applyFont("", "");
        } else {
            set(PREFS.font, font.id);
            set(PREFS.fontStack, font.stack);
            set(PREFS.fontCss, font.css);
            applyFont(font.stack, font.css);
        }
    });
}

const cloakSelect = $("cloakSelect");
CLOAKS.forEach(c => {
    const opt = document.createElement("option");
    opt.value = c.id; opt.textContent = c.label;
    cloakSelect.appendChild(opt);
});
cloakSelect.value = get(PREFS.cloak, "");
cloakSelect.addEventListener("change", () => {
    set(PREFS.cloak, cloakSelect.value);
});

const debugToggle = $("debugToggle");
debugToggle.checked = get(PREFS.debug, "0") === "1";
debugToggle.addEventListener("change", () => {
    set(PREFS.debug, debugToggle.checked ? "1" : "0");
    window.dispatchEvent(new CustomEvent("nocturne:debug", { detail: debugToggle.checked }));
});

const fxToggle = $("fxToggle");
fxToggle.checked = get(PREFS.bgFx, "1") !== "0";
fxToggle.addEventListener("change", () => {
    const on = fxToggle.checked;
    set(PREFS.bgFx, on ? "1" : "0");
    const c = document.getElementById("bgCanvas");
    if (c) c.style.display = on ? "" : "none";
    window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: on }));
});

const reduceMotionToggle = $("reduceMotionToggle");
reduceMotionToggle.checked = get(PREFS.reduceMotion, "0") === "1";
reduceMotionToggle.addEventListener("change", () => {
    set(PREFS.reduceMotion, reduceMotionToggle.checked ? "1" : "0");
    applyReduceMotion(reduceMotionToggle.checked);
});

const islandToggle = $("islandToggle");
if (islandToggle) {
    islandToggle.checked = get(PREFS.island, "on") !== "off";
    islandToggle.addEventListener("change", () => {
        if (typeof window.__nocIslandSetEnabled === "function") {
            window.__nocIslandSetEnabled(islandToggle.checked);
        } else {
            set(PREFS.island, islandToggle.checked ? "on" : "off");
        }
    });
}

const scaleRange = $("scaleRange");
scaleRange.value = get(PREFS.uiScale, "100");
$("scaleVal").textContent = scaleRange.value + "%";
scaleRange.addEventListener("input", () => {
    $("scaleVal").textContent = scaleRange.value + "%";
    set(PREFS.uiScale, scaleRange.value);
    applyUiScale(scaleRange.value);
});

const opacityRange = $("bgOpacityRange");
opacityRange.value = get(PREFS.bgOpacity, "100");
$("bgOpacityVal").textContent = opacityRange.value + "%";
opacityRange.addEventListener("input", () => {
    $("bgOpacityVal").textContent = opacityRange.value + "%";
    set(PREFS.bgOpacity, opacityRange.value);
    applyBgImage(get(PREFS.bgImage, ""), opacityRange.value, get(PREFS.bgBlur, "0"));
});

const blurRange = $("bgBlurRange");
blurRange.value = get(PREFS.bgBlur, "0");
$("bgBlurVal").textContent = blurRange.value + "px";
blurRange.addEventListener("input", () => {
    $("bgBlurVal").textContent = blurRange.value + "px";
    set(PREFS.bgBlur, blurRange.value);
    applyBgImage(get(PREFS.bgImage, ""), get(PREFS.bgOpacity, "100"), blurRange.value);
});

function paintBgPreview() {
    const dataUrl = get(PREFS.bgImage, "");
    const preview = $("bgPreview");
    if (dataUrl) {
        preview.classList.remove("empty");
        preview.style.backgroundImage = `url("${dataUrl}")`;
    } else {
        preview.classList.add("empty");
        preview.style.backgroundImage = "";
    }
}
paintBgPreview();

$("bgUploadBtn").addEventListener("click", () => $("bgUploadInput").click());
$("bgUploadInput").addEventListener("change", e => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
        alert("Image must be under 5 MB.");
        return;
    }
    const reader = new FileReader();
    reader.onload = ev => {
        const dataUrl = ev.target.result;
        set(PREFS.bgImage, dataUrl);
        applyBgImage(dataUrl, get(PREFS.bgOpacity, "100"), get(PREFS.bgBlur, "0"));
        paintBgPreview();
    };
    reader.readAsDataURL(file);
    e.target.value = "";
});

$("bgClearBtn").addEventListener("click", () => {
    set(PREFS.bgImage, "");
    applyBgImage("", 100, 0);
    paintBgPreview();
});

const accentPicker = $("accentPicker");
const currentAccent = get(PREFS.accent, "#b8b0da");
accentPicker.value = currentAccent;

function markSwatch(color) {
    document.querySelectorAll(".swatch").forEach(s => s.classList.toggle("selected", s.dataset.color.toLowerCase() === (color || "").toLowerCase()));
}
markSwatch(currentAccent);

document.querySelectorAll(".swatch").forEach(s => {
    s.addEventListener("click", () => {
        const color = s.dataset.color;
        set(PREFS.accent, color);
        applyAccent(color);
        markSwatch(color);
        accentPicker.value = color;
    });
});
accentPicker.addEventListener("input", () => {
    const color = accentPicker.value;
    set(PREFS.accent, color);
    applyAccent(color);
    markSwatch(color);
});

function reloadApp() {
    let w = window;
    try { if (window.top && window.top !== window) w = window.top; } catch (e) { w = window; }
    try { w.location.reload(); } catch (e) { window.location.reload(); }
}

$("resetEngineBtn").addEventListener("click", () => {
    if (!confirm("Reset state? This clears the active session and reloads.")) return;
    localStorage.setItem("nocturne-reset", "true");
    reloadApp();
});

$("resetAllBtn").addEventListener("click", () => {
    if (!confirm("Reset every Nocturne setting to default? You will not be signed out.")) return;
    Object.values(PREFS).forEach(k => localStorage.removeItem(k));
    location.reload();
});

$("aboutBlankBtn")?.addEventListener("click", () => {
    const w = window.open();
    if (!w) {
        alert("Popup blocked. Allow popups for Nocturne to use about:blank.");
        return;
    }
    try {
        w.document.open();
        w.document.write(`<!doctype html><html><head><title>about:blank</title><link rel="icon" href="data:,"><style>html,body{margin:0;padding:0;background:#05060d;height:100%;overflow:hidden}iframe{border:0;width:100vw;height:100vh;display:block}</style></head><body><iframe src="${location.origin}/?nocab=1" allow="clipboard-read; clipboard-write; fullscreen"></iframe></body></html>`);
        w.document.close();
    } catch {
        w.location = location.origin;
    }
});

const autoAbToggle = $("autoAbToggle");
if (autoAbToggle) {
    autoAbToggle.checked = get(PREFS.autoAb, "0") === "1";
    autoAbToggle.addEventListener("change", () => {
        set(PREFS.autoAb, autoAbToggle.checked ? "1" : "0");

        try { sessionStorage.removeItem("noc-ab-launched"); } catch (e) {}
    });
}

function getFloodSites() {
    try {
        const raw = localStorage.getItem(PREFS.floodSites);
        if (raw == null) return FLOOD_DEFAULTS.slice();
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? arr.filter(s => typeof s === "string" && s) : FLOOD_DEFAULTS.slice();
    } catch { return FLOOD_DEFAULTS.slice(); }
}
function saveFloodSites(arr) {
    try { localStorage.setItem(PREFS.floodSites, JSON.stringify(arr)); } catch (e) {}
}
function normalizeFloodUrl(raw) {
    let u = String(raw || "").trim();
    if (!u) return "";
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    try { return new URL(u).href.replace(/\/+$/, ""); } catch { return ""; }
}
function floodFavicon(url) {
    try { return "https://www.google.com/s2/favicons?domain=" + new URL(url).hostname + "&sz=64"; }
    catch { return ""; }
}
function renderFloodList() {
    const list = $("floodList");
    if (!list) return;
    const sites = getFloodSites();
    if (!sites.length) {
        list.innerHTML = '<div class="sp-flood-empty">No sites yet — add one above.</div>';
        return;
    }
    list.innerHTML = sites.map((s, i) =>
        '<div class="sp-flood-item">' +
        '<img class="sp-flood-fav" src="' + floodFavicon(s) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
        '<span class="sp-flood-url">' + s.replace(/^https?:\/\//, "") + '</span>' +
        '<button class="sp-flood-del" type="button" data-flood-del="' + i + '" aria-label="Remove" title="Remove">×</button>' +
        '</div>').join("");
}
if ($("floodList")) {
    renderFloodList();

    $("floodAdd")?.addEventListener("click", () => {
        const input = $("floodInput");
        const url = normalizeFloodUrl(input.value);
        if (!url) { input.focus(); return; }
        const sites = getFloodSites();
        if (!sites.includes(url)) { sites.push(url); saveFloodSites(sites); renderFloodList(); }
        input.value = "";
        input.focus();
    });
    $("floodInput")?.addEventListener("keydown", e => {
        if (e.key === "Enter") { e.preventDefault(); $("floodAdd").click(); }
    });
    $("floodList").addEventListener("click", e => {
        const btn = e.target.closest("[data-flood-del]");
        if (!btn) return;
        const i = parseInt(btn.dataset.floodDel, 10);
        const sites = getFloodSites();
        if (i >= 0 && i < sites.length) { sites.splice(i, 1); saveFloodSites(sites); renderFloodList(); }
    });

    $("floodBtn")?.addEventListener("click", () => {
        const sites = getFloodSites();
        if (!sites.length) { alert("Add some sites to the list first."); return; }
        const w = window.open("about:blank", "_blank");
        if (!w) { alert("Popup blocked. Allow popups for Nocturne to flood history."); return; }
        const btn = $("floodBtn");
        const orig = btn ? btn.textContent : "";
        if (btn) btn.disabled = true;
        let i = 0;
        const step = () => {
            if (i >= sites.length) {
                try { w.close(); } catch (e) {}
                if (btn) { btn.disabled = false; btn.textContent = orig; }
                return;
            }
            try { w.location.href = sites[i]; } catch (e) {}
            if (btn) btn.textContent = "Flooding " + (i + 1) + "/" + sites.length + "…";
            i++;
            setTimeout(step, 700);
        };
        step();
    });
}

function applyBgTheme(theme) {
    const canvas = document.getElementById("bgCanvas");
    let aurora = document.getElementById("bgAurora");
    if (!aurora) {
        aurora = document.createElement("div");
        aurora.id = "bgAurora";
        document.body.insertBefore(aurora, document.body.firstChild);
    }

    const known = ["aurora", "nebula", "ocean", "sunset", "mono", "embers"];
    for (const t of known) aurora.classList.remove("theme-" + t);

    if (theme === "stars") {
        if (canvas) canvas.style.display = "";
        aurora.classList.remove("active");
        window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: true }));
        set(PREFS.bgFx, "1");
    } else if (theme === "off") {
        if (canvas) canvas.style.display = "none";
        aurora.classList.remove("active");
        window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: false }));
        set(PREFS.bgFx, "0");
    } else if (known.includes(theme)) {
        if (canvas) canvas.style.display = "none";
        aurora.classList.add("theme-" + theme);
        aurora.classList.add("active");
        window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: false }));
        set(PREFS.bgFx, "0");
    } else if (theme === "miku" || theme === "teto") {

        if (canvas) canvas.style.display = "none";
        aurora.classList.remove("active");
        window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: false }));
        set(PREFS.bgFx, "0");
    }

    try { window.dispatchEvent(new CustomEvent("nocturne:bgtheme", { detail: theme })); } catch {}
}

const bgThemeSelect = $("bgThemeSelect");
if (bgThemeSelect) {
    bgThemeSelect.innerHTML = BG_THEMES.map(t => `<option value="${t.id}">${t.label}</option>`).join("");
    const currentTheme = get(PREFS.bgTheme, "stars");
    bgThemeSelect.value = currentTheme;
    bgThemeSelect.addEventListener("change", () => {
        const v = bgThemeSelect.value;
        set(PREFS.bgTheme, v);
        applyBgTheme(v);
        if (fxToggle) fxToggle.checked = (v === "stars");
    });
}

const _initialTheme = get(PREFS.bgTheme, null);
if (_initialTheme && _initialTheme !== "stars") {
    applyBgTheme(_initialTheme);
}
if (fxToggle) {
    const t = get(PREFS.bgTheme, "stars");
    fxToggle.checked = (t === "stars" && get(PREFS.bgFx, "1") !== "0");
}

const _origFxHandler = fxToggle.onchange;
fxToggle.addEventListener("change", () => {
    const on = fxToggle.checked;
    if (on) {
        applyBgTheme("stars");
        set(PREFS.bgTheme, "stars");
        if (bgThemeSelect) bgThemeSelect.value = "stars";
    } else {
        const cur = get(PREFS.bgTheme, "stars");
        if (cur === "stars") {
            applyBgTheme("off");
            set(PREFS.bgTheme, "off");
            if (bgThemeSelect) bgThemeSelect.value = "off";
        }
    }
});

const HISTORY_KEY = "nocturne-history";
function histLoad() { try { return JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); } catch { return []; } }
function histSave(list) { try { localStorage.setItem(HISTORY_KEY, JSON.stringify(list)); } catch {} }
function histHost(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; } }
function histFavicon(u) { return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(histHost(u)) + "&sz=64"; }
function histEscape(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function histRelTime(ts) {
    const d = Date.now() - ts;
    if (d < 60000) return "just now";
    const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), days = Math.floor(d / 86400000);
    if (m < 60) return m + "m ago";
    if (h < 24) return h + "h ago";
    if (days === 1) return "yesterday";
    if (days < 7) return days + "d ago";
    try { return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; }
}
function openHistUrl(url) {
    try {
        if (window.parent && window.parent !== window && typeof window.parent.__nocOpenUrl === "function") {
            window.parent.__nocOpenUrl(url, true);
            return;
        }
    } catch {}
    try { window.top.location.href = "/"; } catch { location.href = url; }
}
let histFilter = "";
function renderHistory() {
    const listEl = $("histList"), emptyEl = $("histEmpty");
    if (!listEl) return;
    const all = histLoad();
    const q = histFilter.trim().toLowerCase();
    const list = q ? all.filter(e => (e.url + " " + (e.title || "")).toLowerCase().includes(q)) : all;
    listEl.innerHTML = "";
    if (!list.length) {
        if (emptyEl) {
            emptyEl.style.display = "block";
            emptyEl.textContent = all.length ? "No matches." : "No history yet. Pages you visit will show up here.";
        }
        return;
    }
    if (emptyEl) emptyEl.style.display = "none";
    const frag = document.createDocumentFragment();
    for (const e of list) {
        const host = histHost(e.url);
        const title = e.title && e.title.trim() ? e.title.trim() : host;
        const item = document.createElement("div");
        item.className = "sp-hist-item";
        item.innerHTML =
            '<img class="sp-hist-fav" src="' + histFavicon(e.url) + '" alt="" loading="lazy" onerror="this.style.visibility=\'hidden\'">' +
            '<div class="sp-hist-text"><div class="sp-hist-title">' + histEscape(title) + '</div>' +
            '<div class="sp-hist-url">' + histEscape(e.url) + '</div></div>' +
            '<div class="sp-hist-time">' + histRelTime(e.ts) + '</div>' +
            '<button class="sp-hist-del" title="Remove" aria-label="Remove" type="button">&times;</button>';
        item.addEventListener("click", ev => {
            if (ev.target.closest(".sp-hist-del")) return;
            openHistUrl(e.url);
        });
        item.querySelector(".sp-hist-del").addEventListener("click", ev => {
            ev.stopPropagation();
            histSave(histLoad().filter(x => !(x.url === e.url && x.ts === e.ts)));
            renderHistory();
        });
        frag.appendChild(item);
    }
    listEl.appendChild(frag);
}
(function initHistory() {
    const search = $("histSearch"), clear = $("histClear");
    if (search) search.addEventListener("input", () => { histFilter = search.value; renderHistory(); });
    if (clear) clear.addEventListener("click", () => { if (histLoad().length) { histSave([]); renderHistory(); } });
})();

document.querySelectorAll("#spNav .sp-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
        const target = btn.dataset.pane;
        document.querySelectorAll("#spNav .sp-nav-item")
            .forEach(b => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".sp-pane")
            .forEach(p => p.classList.toggle("active", p.dataset.pane === target));
        try { history.replaceState(null, "", "#" + target); } catch {}
        const main = document.querySelector(".sp-main");
        if (main) main.scrollTop = 0;
        if (target === "history") renderHistory();
    });
});

const adCooldownRange = $("adCooldownRange");
if (adCooldownRange) {
    const saved = Math.min(10, Math.max(1, Number(get(PREFS.adCooldown, "2")) || 2));
    adCooldownRange.value = saved;
    $("adCooldownVal").textContent = saved + " min";
    adCooldownRange.addEventListener("input", () => {
        const v = Number(adCooldownRange.value);
        $("adCooldownVal").textContent = v + " min";
        set(PREFS.adCooldown, String(v));
    });
}

(function initFromHash() {
    const h = (location.hash || "").replace(/^#/, "");
    if (!h) return;
    const btn = document.querySelector(`#spNav .sp-nav-item[data-pane="${h}"]`);
    if (btn) btn.click();
})();
