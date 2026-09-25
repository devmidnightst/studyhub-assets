(function applyGlobalPrefs() {
    try {
        const accent = localStorage.getItem("nocturne-accent");
        if (accent) {
            document.documentElement.style.setProperty("--accent", accent);
            const m = accent.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
            if (m) {
                const r = Math.max(0, Math.round(parseInt(m[1], 16) * 0.75));
                const g = Math.max(0, Math.round(parseInt(m[2], 16) * 0.75));
                const b = Math.max(0, Math.round(parseInt(m[3], 16) * 0.75));
                document.documentElement.style.setProperty("--accent-2",
                    "#" + r.toString(16).padStart(2,"0") + g.toString(16).padStart(2,"0") + b.toString(16).padStart(2,"0"));
            }
        }
        const scale = parseInt(localStorage.getItem("nocturne-ui-scale") || "100", 10);
        if (scale && scale !== 100) {
            document.documentElement.style.fontSize = (16 * scale / 100) + "px";
            document.documentElement.style.zoom = scale / 100;
        }
        if (localStorage.getItem("nocturne-reduce-motion") === "1") {
            document.documentElement.classList.add("reduce-motion");
        }
        const perfPref = localStorage.getItem("nocturne-perf") || "auto";
        const lowEnd = (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
                       (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
        if (perfPref === "lite" || (perfPref !== "full" && lowEnd)) {
            document.documentElement.classList.add("perf-lite");
        }
        const bg = localStorage.getItem("nocturne-bg-image");
        if (bg) {
            const op = (parseInt(localStorage.getItem("nocturne-bg-opacity") || "100", 10) || 100) / 100;
            const bl = parseInt(localStorage.getItem("nocturne-bg-blur") || "0", 10) || 0;
            const apply = () => {
                if (document.getElementById("__nocturneBg")) return;
                const el = document.createElement("div");
                el.id = "__nocturneBg";
                el.style.cssText = `position:fixed;inset:0;z-index:0;pointer-events:none;background:center/cover no-repeat url("${bg}");opacity:${op};filter:blur(${bl}px)`;
                document.body.insertBefore(el, document.body.firstChild);
            };
            if (document.body) apply();
            else document.addEventListener("DOMContentLoaded", apply, { once: true });
        }
    } catch {}
})();

(function() {
    const dock = document.getElementById("dock");
    if (!dock || dock.dataset.docked === "1") return;
    dock.dataset.docked = "1";

    const ICONS = {
        home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z"/></svg>',
        games: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M6 11h4M8 9v4"/><path d="M15 12h.01"/><path d="M18 10h.01"/><rect x="2" y="6" width="20" height="12" rx="6"/></svg>',
        settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
        plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        apps: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
        chat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9a3 3 0 0 1-3 3H6l-3 3V5a3 3 0 0 1 3-3h5a3 3 0 0 1 3 3z"/><path d="M10 12v1a3 3 0 0 0 3 3h5l3 3v-8a3 3 0 0 0-3-3h-1"/></svg>',
        music: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
        editor: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="8 6 2 12 8 18"/><polyline points="16 6 22 12 16 18"/></svg>',

        tools: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.8 2.8 0 1 1-4-4z"/><path d="M14.7 6.3l3-3 4 4-3 3"/></svg>',
        ai: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.4 8.4 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.4 8.4 0 0 1-3.8-.9L3 21l1.9-5.7a8.4 8.4 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.4 8.4 0 0 1 3.8-.9h.5a8.5 8.5 0 0 1 8 8z"/><line x1="9" y1="10" x2="9" y2="14"/><line x1="12" y1="9" x2="12" y2="15"/><line x1="15" y1="11" x2="15" y2="13"/></svg>',
        account: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
        legal: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="3" x2="12" y2="21"/><path d="M5 7l7-2 7 2"/><path d="M2 11l3-4 3 4-3 4z"/><path d="M16 11l3-4 3 4-3 4z"/></svg>',
        linkcheck: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/></svg>'
    };

    const isHome = !!document.getElementById("settingsPanel");
    const settingsBtn = '<a class="dock-btn" data-path="/settings.html" href="/settings.html" aria-label="Settings">' + ICONS.settings + '</a>';
    const homeBtn = isHome
        ? '<button class="dock-btn" id="dockHome" data-path="/" aria-label="Home">' + ICONS.home + '</button>'
        : '<a class="dock-btn" data-path="/" href="/" aria-label="Home">' + ICONS.home + '</a>';

    dock.innerHTML = `
        ${homeBtn}
        <a class="dock-btn" data-path="/games.html" href="/games.html" aria-label="Games">${ICONS.games}</a>
        <a class="dock-btn" data-path="/apps.html" href="/apps.html" aria-label="Apps">${ICONS.apps}</a>
        <a class="dock-btn" data-path="/chat.html" href="/chat.html" aria-label="Chat">${ICONS.chat}</a>
        <a class="dock-btn" data-path="/music.html" href="/music.html" aria-label="Music">${ICONS.music}</a>
        <a class="dock-btn" data-path="/linkcheck.html" href="/linkcheck.html" aria-label="Link Checker">${ICONS.linkcheck}</a>
        <a class="dock-btn" data-path="/legal.html" href="/legal.html" aria-label="Legal">${ICONS.legal}</a>
        ${settingsBtn}`;

    const path = location.pathname.replace(/\/$/, "") || "/";
    dock.querySelectorAll("[data-path]").forEach(el => {
        const p = el.dataset.path;
        const match = (p === "/" && (path === "/" || path === "/index.html")) ||
                      p === path ||
                      (p !== "/" && path === p);
        if (match) el.classList.add("active");
    });
})();

(function nocturneOverlayRouter() {
    if (window.__nocOverlayInstalled) return;
    window.__nocOverlayInstalled = true;

    const INTERNAL_PAGE_RE = /^\/(?:games|apps|chat|vms|films|music|account|tools|code|ai|linkcheck|legal|settings|onboarding|support|dmca|terms|privacy|404)\.html(?:[?#].*)?$/i;

    function ensureOverlay() {
        let overlay = document.getElementById("__nocOverlay");
        if (overlay) return overlay;
        overlay = document.createElement("div");
        overlay.id = "__nocOverlay";
        overlay.style.cssText = "position:fixed;inset:0;z-index:2147483600;background:#05060d;display:none";
        const frame = document.createElement("iframe");
        frame.id = "__nocOverlayFrame";
        frame.setAttribute("allow", "fullscreen; clipboard-read; clipboard-write; autoplay");
        frame.setAttribute("allowfullscreen", "true");
        frame.style.cssText = "width:100%;height:100%;border:0;display:block;background:#05060d";
        overlay.appendChild(frame);
        (document.body || document.documentElement).appendChild(overlay);
        return overlay;
    }

    function openOverlay(href) {
        const overlay = ensureOverlay();
        const frame = overlay.querySelector("iframe");
        try { frame.src = href; } catch { frame.setAttribute("src", href); }
        overlay.style.display = "block";
        try { document.documentElement.style.overflow = "hidden"; } catch {}
        try { document.body && document.body.classList.add("noc-overlay-open"); } catch {}
    }

    function closeOverlay() {
        const overlay = document.getElementById("__nocOverlay");
        if (!overlay) return false;
        if (overlay.style.display === "none") return false;
        overlay.style.display = "none";
        const frame = overlay.querySelector("iframe");
        if (frame) { try { frame.src = "about:blank"; } catch {} }
        try { document.documentElement.style.overflow = ""; } catch {}
        try { document.body && document.body.classList.remove("noc-overlay-open"); } catch {}
        return true;
    }

    function shouldIntercept(link) {
        if (!link) return false;
        if (link.target && link.target !== "" && link.target !== "_self") return false;
        if (link.hasAttribute("download")) return false;
        if (link.dataset && link.dataset.noOverlay === "1") return false;
        const href = link.getAttribute("href");
        if (!href) return false;
        if (href.startsWith("#")) return false;
        if (/^[a-z][a-z0-9+.-]*:/i.test(href) && !href.startsWith(location.origin)) return false;
        let path = href;
        try {
            const u = new URL(href, location.href);
            if (u.origin !== location.origin) return false;
            path = u.pathname + u.search + u.hash;
        } catch {}
        return INTERNAL_PAGE_RE.test(path);
    }

    document.addEventListener("click", function(e) {
        if (e.defaultPrevented) return;
        if (e.button !== 0) return;
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        if (document.documentElement.classList.contains("noc-embedded")) return;
        const link = e.target.closest && e.target.closest("a[href]");
        if (!shouldIntercept(link)) return;
        e.preventDefault();
        const u = new URL(link.getAttribute("href"), location.href);
        const path = u.pathname + u.search + u.hash;
        if (typeof window.__nocOpenInternalPage === "function" && window.__nocOpenInternalPage(path)) return;
        openOverlay(path);
    }, true);

    document.addEventListener("keydown", function(e) {
        if (e.key === "Escape") closeOverlay();
    });

    window.addEventListener("message", function(e) {
        if (!e.data) return;
        if (e.data === "nocturne:close-overlay" || (e.data && e.data.type === "nocturne:close-overlay")) {
            closeOverlay();
        }
    });

    window.__nocOpenOverlay = openOverlay;
    window.__nocCloseOverlay = closeOverlay;
})();
