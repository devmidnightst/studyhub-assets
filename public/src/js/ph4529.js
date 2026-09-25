
(function () {
    "use strict";

    if (window.__nocIslandMounted) return;

    try {
        if (window.self !== window.top) return;
        if (document.documentElement.classList.contains("noc-embedded")) return;
    } catch (e) {}
    var _page = (location.pathname.split("/").pop() || "").toLowerCase();
    var SKIP_PAGES = { "admin.html": 1, "screenshare.html": 1, "box-term.html": 1, "api.html": 1, "application.html": 1, "decoy.html": 1, "landing.html": 1, "onboarding.html": 1 };
    if (SKIP_PAGES[_page]) return;

    window.__nocIslandMounted = true;

    var IS_SHELL = !!document.getElementById("homePage");

    var IC = {
        dash:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/></svg>',
        travel: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polygon points="14.5 9.5 9.5 11 9.5 14.5 14.5 13 14.5 9.5" fill="currentColor" stroke="none"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2"/></svg>',
        music:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></svg>',
        ai:     '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3l1.9 4.6L18.5 9.5 13.9 11.4 12 16l-1.9-4.6L5.5 9.5l4.6-1.9z"/><path d="M18 15l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z"/></svg>',
        ext:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4a2 2 0 1 0-4 0v2H7a1 1 0 0 0-1 1v3H4a2 2 0 1 0 0 4h2v3a1 1 0 0 0 1 1h3v-2a2 2 0 1 1 4 0v2h3a1 1 0 0 0 1-1v-3h2a2 2 0 1 0 0-4h-2V7a1 1 0 0 0-1-1h-3z"/></svg>',
        home:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 10l9-7 9 7v10a2 2 0 0 1-2 2h-4v-6h-6v6H5a2 2 0 0 1-2-2z"/></svg>',
        play:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>',
        pause:  '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
        prev:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h2v14H6zM20 5v14l-11-7z"/></svg>',
        next:   '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 5h2v14h-2zM4 5l11 7-11 7z"/></svg>',
        shuffle:'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/></svg>',
        repeat: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11v-1a4 4 0 0 1 4-4h14"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v1a4 4 0 0 1-4 4H3"/></svg>',
        vol:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><path d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/></svg>',
        mute:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M11 5L6 9H2v6h4l5 4z"/><line x1="22" y1="9" x2="16" y2="15"/><line x1="16" y1="9" x2="22" y2="15"/></svg>',
        send:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/></svg>',
        search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.5" y2="16.5"/></svg>',
        globe:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>',
        plus:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>',
        moon:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
        shield: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/></svg>',
        users:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="3.2"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/></svg>',
        clock:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
        wifi:   '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0"/><circle cx="12" cy="19.5" r="0.6" fill="currentColor"/></svg>',
        chev:   '<svg class="nt-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>',
        cpu:    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="7" y="7" width="10" height="10" rx="1.5"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
        gauge:  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 14l4-4"/><path d="M4 18a8 8 0 1 1 16 0z"/></svg>'
    };
    var WMO_ICON = { 0:"☀️",1:"🌤️",2:"⛅",3:"☁️",45:"🌫️",48:"🌫️",51:"🌦️",53:"🌦️",55:"🌧️",61:"🌦️",63:"🌧️",65:"🌧️",71:"🌨️",73:"🌨️",75:"❄️",80:"🌦️",81:"🌧️",82:"⛈️",95:"⛈️",96:"⛈️",99:"⛈️" };
    var WMO_LABEL = { 0:"Clear",1:"Mainly clear",2:"Partly cloudy",3:"Overcast",45:"Fog",48:"Fog",51:"Drizzle",53:"Drizzle",55:"Drizzle",61:"Light rain",63:"Rain",65:"Heavy rain",71:"Light snow",73:"Snow",75:"Heavy snow",80:"Showers",81:"Showers",82:"Heavy showers",95:"Thunderstorm",96:"Thunderstorm",99:"Thunderstorm" };
    var MON = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var DAYS = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

    function el(tag, cls, html) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (html != null) e.innerHTML = html;
        return e;
    }
    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }
    function fmtTime(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var m = Math.floor(sec / 60), s = sec % 60;
        return m + ":" + (s < 10 ? "0" : "") + s;
    }

    var audio = el("audio");
    audio.id = "nocIslandAudio";
    audio.preload = "none";

    var TABS = [
        { id: "dashboard",   label: "Dashboard" },
        { id: "travel",      label: "Travel" },
        { id: "media",       label: "Media" },
        { id: "ai",          label: "AI" },
        { id: "ext",         label: "Extensions" },
        { id: "performance", label: "Perf" }
    ];
    var topEl = null, topNotch = null, topPanel = null, topBody = null, topInk = null;
    var topMode = "dashboard";
    var topPinned = false, topCloseT = null, topFadeT = null;
    var _bootMs = Date.now();
    var topRefs = {};
    var tabEls = {};

    function buildIsland() {
        topEl = el("div", "noc-top"); topEl.id = "nocTop"; topEl.setAttribute("data-open", "false");
        var zone = el("div"); zone.id = "nocTopZone";

        topNotch = el("div", "nt-notch");
        topNotch.innerHTML =
            '<span class="nt-time">--:--</span>' +
            '<span class="nt-dot"></span>' +
            '<span class="nt-np">Dashboard</span>' +
            '<span class="nt-eq"><i></i><i></i><i></i></span>' +
            IC.chev;

        topPanel = el("div", "nt-panel");
        topPanel.setAttribute("role", "dialog");
        var tabsEl = el("div", "nt-tabs");
        TABS.forEach(function (t) {
            var b = el("button", "nt-tab" + (t.id === topMode ? " active" : ""));
            b.type = "button"; b.textContent = t.label; b.setAttribute("data-tt", t.id);
            b.addEventListener("click", function () {
                if (topMode === t.id) return;
                topMode = t.id; renderTop(true);
            });
            tabEls[t.id] = b;
            tabsEl.appendChild(b);
        });
        topInk = el("div", "nt-ink");
        tabsEl.appendChild(topInk);
        topBody = el("div", "nt-body");
        topPanel.appendChild(tabsEl); topPanel.appendChild(topBody);

        topEl.appendChild(topNotch); topEl.appendChild(topPanel);
        document.body.appendChild(zone); document.body.appendChild(topEl);

        zone.addEventListener("mouseenter", function () { setHot(true); openTop(); });
        topEl.addEventListener("mouseenter", function () { clearTimeout(topCloseT); setHot(true); });
        topEl.addEventListener("mouseleave", function () { scheduleTopClose(); setHot(false); });
        topNotch.addEventListener("click", function () {
            topPinned = !topPinned;
            topNotch.classList.toggle("nt-pin", topPinned);
            if (topPinned) { setHot(true); openTop(); } else closeTop(true);
        });
        document.addEventListener("mousedown", function (e) {
            if (topPinned && !topEl.contains(e.target)) { topPinned = false; topNotch.classList.remove("nt-pin"); closeTop(true); }
        }, true);
        updateNotch();
    }

    function openTop(mode) {
        clearTimeout(topCloseT);
        if (mode && mode !== topMode) { topMode = mode; topEl.setAttribute("data-open", "true"); renderTop(true); return; }
        if (topEl.getAttribute("data-open") === "true") return;
        topEl.setAttribute("data-open", "true");
        renderTop(false);
    }
    function closeTop(force) {
        if (topPinned && !force) return;
        topEl.setAttribute("data-open", "false");
        stopPerf();
    }
    function scheduleTopClose() { clearTimeout(topCloseT); topCloseT = setTimeout(function () { closeTop(false); }, 320); }

    function setHot(on) {
        if (!topEl) return;
        clearTimeout(topFadeT);
        if (on) topEl.classList.add("nt-hot");
        else topFadeT = setTimeout(function () { topEl.classList.remove("nt-hot"); }, 400);
    }

    function setTab() {
        var active = null;
        TABS.forEach(function (t) {
            var on = t.id === topMode;
            tabEls[t.id].classList.toggle("active", on);
            if (on) active = tabEls[t.id];
        });
        if (topInk && active && active.offsetWidth) {
            var w = active.offsetWidth * 0.6;
            topInk.style.left = Math.round(active.offsetLeft + (active.offsetWidth - w) / 2) + "px";
            topInk.style.width = Math.round(w) + "px";
        }
    }

    function renderTop(animate) {
        if (!topBody) return;
        stopPerf();
        var oldH = animate ? topBody.getBoundingClientRect().height : 0;
        topBody.innerHTML = "";
        if (topMode === "dashboard") renderDash();
        else if (topMode === "travel") renderTravel();
        else if (topMode === "media") renderMedia();
        else if (topMode === "ai") renderAI();
        else if (topMode === "ext") renderExt();
        else if (topMode === "performance") renderPerf();
        setTab();
        if (!animate) return;
        topBody.style.transition = "none";
        topBody.style.height = "auto";
        var newH = topBody.getBoundingClientRect().height;
        if (Math.abs(newH - oldH) < 2) { topBody.style.height = ""; topBody.style.transition = ""; return; }
        topBody.style.height = oldH + "px";
        void topBody.offsetHeight;
        topBody.style.transition = "height 0.46s var(--nt-pop)";
        topBody.style.height = newH + "px";
        clearTimeout(topBody.__hT);
        topBody.__hT = setTimeout(function () { topBody.style.transition = ""; topBody.style.height = ""; }, 520);
    }

    document.addEventListener("keydown", function (e) {
        if (!topEl) return;
        if (e.key === "Escape" && topEl.getAttribute("data-open") === "true") {
            topPinned = false; topNotch.classList.remove("nt-pin"); closeTop(true); setHot(false);
        }

        if (e.altKey && (e.code === "Space" || e.key === " ")) {
            e.preventDefault();
            topPinned = true; topNotch.classList.add("nt-pin");
            setHot(true); openTop("travel");
        }
    });

    function islandEnabled() {
        try { return localStorage.getItem("nocturne-island") !== "off"; } catch (e) { return true; }
    }

    function mount() {
        document.body.appendChild(audio);
        var enabled = islandEnabled();
        document.documentElement.classList.toggle("noc-island-off", !enabled);

        if (!IS_SHELL && enabled) {
            var d = document.getElementById("dock");
            if (d) d.style.display = "none";
        }
        buildIsland();
        bootExtensions();
        restorePlayer();
        startClock();
        if (enabled) maybeShowHints();
    }

    window.__nocIslandSetEnabled = function (on) {
        on = !!on;
        try { localStorage.setItem("nocturne-island", on ? "on" : "off"); } catch (e) {}
        document.documentElement.classList.toggle("noc-island-off", !on);
        if (!on && topEl) {
            topPinned = false;
            topNotch && topNotch.classList.remove("nt-pin");
            topEl.setAttribute("data-open", "false");
            topEl.classList.remove("nt-hot");
            stopPerf();
        }
        if (!IS_SHELL) {
            var d = document.getElementById("dock");
            if (d) d.style.display = on ? "none" : "";
        }
        return on;
    };
    window.__nocIslandEnabled = islandEnabled;

    function goPage(pathOrUrl) {
        topPinned = false; closeTop(true);
        if (pathOrUrl === "/") { location.assign("/"); return; }
        if (typeof window.__nocOpenInternalPage === "function" && window.__nocOpenInternalPage(pathOrUrl)) return;
        if (typeof window.__nocOpenOverlay === "function") { window.__nocOpenOverlay(pathOrUrl); return; }
        location.assign(pathOrUrl);
    }
    function goWeb(input) {
        input = (input || "").trim();
        if (!input) return;
        topPinned = false; closeTop(true);
        if (typeof window.__nocOpenUrl === "function") { window.__nocOpenUrl(input); return; }

        try { sessionStorage.setItem("noc-island-travel", input); } catch (e) {}
        location.assign("/");
    }

    function renderDash() {
        topRefs = {};
        var grid = el("div", "nt-grid");

        var clock = el("div", "nt-card nt-clock");
        clock.innerHTML = '<div class="nt-card-label">Time</div><div class="nt-clock-time"></div><div class="nt-clock-date"></div>';
        topRefs.clockTime = clock.querySelector(".nt-clock-time");
        topRefs.clockDate = clock.querySelector(".nt-clock-date");
        grid.appendChild(clock);

        var weather = el("div", "nt-card");
        weather.innerHTML = '<div class="nt-card-label">Weather</div><div class="nt-weather"><div class="isl-spinner" style="margin:8px auto"></div></div>';
        grid.appendChild(weather);
        loadIslandWeather(weather.querySelector(".nt-weather"));

        var sys = el("div", "nt-card span");
        sys.innerHTML = '<div class="nt-card-label">Session</div>';
        sys.appendChild(sysRow(IC.moon, "Nocturne", "v2.0.0"));
        sys.appendChild(sysRow(IC.shield, "Engine", engineLabel()));
        var onlineRow = sysRow(IC.users, "Users online", "…"); sys.appendChild(onlineRow);
        var upRow = sysRow(IC.clock, "Session uptime", uptimeStr()); sys.appendChild(upRow);
        sys.appendChild(sysRow(IC.wifi, "Connection", connLabel()));
        topRefs.upRow = upRow.querySelector(".v");
        grid.appendChild(sys);
        fetch("/api/online", { cache: "no-store", credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (j) { var v = onlineRow.querySelector(".v"); if (v) v.textContent = (j.online != null ? j.online : "—") + " online"; })
            .catch(function () { var v = onlineRow.querySelector(".v"); if (v) v.textContent = "—"; });

        topBody.appendChild(grid);
        tickClock();
        if (topRefs._upTimer) clearInterval(topRefs._upTimer);
        topRefs._upTimer = setInterval(function () { if (topRefs.upRow) topRefs.upRow.textContent = uptimeStr(); }, 30000);
    }
    function sysRow(icon, k, v) {
        var r = el("div", "nt-sys-row");
        r.innerHTML = '<span class="k">' + icon + "<span>" + esc(k) + "</span></span><span class=\"v\">" + esc(v) + "</span>";
        return r;
    }
    function engineLabel() {
        try {
            var e = (localStorage.getItem("view-mode") || "exp").toLowerCase();
            return e === "std" ? "Standard" : "Experimental";
        } catch (e) { return "Experimental"; }
    }
    function connLabel() {
        var on = navigator.onLine ? "Online" : "Offline";
        try { var c = navigator.connection; if (c && c.effectiveType) return on + " · " + c.effectiveType.toUpperCase(); } catch (e) {}
        return on;
    }
    function uptimeStr() {
        var s = Math.floor((Date.now() - _bootMs) / 1000);
        var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
        if (h > 0) return "up " + h + "h " + m + "m";
        if (m > 0) return "up " + m + "m";
        return "just now";
    }
    function loadIslandWeather(host) {
        function paint(cur, city) {
            var code = cur.weather_code, isDay = cur.is_day !== 0;
            var ic = (!isDay && (code === 0 || code === 1)) ? "🌙" : (WMO_ICON[code] || "🌡️");
            host.innerHTML =
                '<div class="nt-weather-ic">' + ic + "</div>" +
                '<div class="nt-weather-main"><b>' + Math.round(cur.temperature_2m) + "°</b>" +
                "<span>" + esc(WMO_LABEL[code] || "—") + "</span>" +
                '<span class="nt-weather-loc">' + esc(city || "Your area") + "</span></div>";
        }
        try {
            var c = JSON.parse(localStorage.getItem("nocturne-weather") || "null");
            if (c && c.data && c.data.current) { paint(c.data.current, c.loc && c.loc.city); return; }
        } catch (e) {}
        var loc;
        fetch("https://get.geojs.io/v1/ip/geo.json", { cache: "no-store" })
            .then(function (r) { return r.json(); })
            .then(function (g) {
                loc = { lat: parseFloat(g.latitude), lon: parseFloat(g.longitude), city: g.city || g.region || "", cc: g.country_code || "" };
                var us = loc.cc === "US";
                var q = "latitude=" + loc.lat + "&longitude=" + loc.lon + "&current=temperature_2m,weather_code,is_day&temperature_unit=" + (us ? "fahrenheit" : "celsius") + "&timezone=auto";
                return fetch("https://api.open-meteo.com/v1/forecast?" + q, { cache: "no-store" });
            })
            .then(function (r) { return r.json(); })
            .then(function (j) { if (j && j.current) paint(j.current, loc && loc.city); else host.innerHTML = '<div class="nt-weather-loc">Weather unavailable</div>'; })
            .catch(function () { host.innerHTML = '<div class="nt-weather-loc">Weather unavailable</div>'; });
    }

    function startClock() { tickClock(); setInterval(tickClock, 1000); }
    function tickClock() {
        var d = new Date();
        var hh = String(d.getHours()).padStart(2, "0"), mm = String(d.getMinutes()).padStart(2, "0");
        if (topNotch) { var t = topNotch.querySelector(".nt-time"); if (t) t.textContent = hh + ":" + mm; }
        if (topRefs.clockTime) topRefs.clockTime.innerHTML = hh + ":" + mm + '<span class="sec">' + String(d.getSeconds()).padStart(2, "0") + "</span>";
        if (topRefs.clockDate) topRefs.clockDate.textContent = DAYS[d.getDay()] + ", " + MON[d.getMonth()] + " " + d.getDate();
    }
    function updateNotch() {
        if (!topNotch) return;
        var np = topNotch.querySelector(".nt-np"), eq = topNotch.querySelector(".nt-eq");
        if (mu.track) {
            np.textContent = mu.track.title || "Now playing";
            var playing = !audio.paused;
            np.classList.toggle("playing", playing);
            eq.classList.toggle("show", playing);
        } else {
            np.textContent = "Dashboard";
            np.classList.remove("playing");
            eq.classList.remove("show");
        }
    }

    var PAGES = [
        { path: "/", title: "Home", sub: "Start page", icon: IC.home },
        { path: "/games.html", title: "Games", sub: "Play browser games", icon: IC.ext },
        { path: "/apps.html", title: "Apps", sub: "Curated shortcuts", icon: IC.globe },
        { path: "/ai.html", title: "AI", sub: "Full assistant", icon: IC.ai },
        { path: "/chat.html", title: "Chat", sub: "Rooms & DMs", icon: IC.ai },
        { path: "/music.html", title: "Music", sub: "Streaming player", icon: IC.music },
        { path: "/films.html", title: "Movies", sub: "Watch films & TV", icon: IC.globe },
        { path: "/vms.html", title: "VMs", sub: "Cloud desktops", icon: IC.globe },
        { path: "/tools.html", title: "Tools", sub: "Utilities", icon: IC.ext },
        { path: "/code.html", title: "Code", sub: "Editor & runner", icon: IC.ext },
        { path: "/linkcheck.html", title: "Link Checker", sub: "Test filters", icon: IC.search },
        { path: "/settings.html", title: "Settings", sub: "Preferences", icon: IC.ext },
        { path: "/account.html", title: "Account", sub: "Sign in / profile", icon: IC.home }
    ];
    var SITES = [
        { url: "https://www.youtube.com", title: "YouTube" },
        { url: "https://www.google.com", title: "Google" },
        { url: "https://discord.com/app", title: "Discord" },
        { url: "https://www.reddit.com", title: "Reddit" },
        { url: "https://github.com", title: "GitHub" },
        { url: "https://x.com", title: "X / Twitter" },
        { url: "https://en.wikipedia.org", title: "Wikipedia" },
        { url: "https://www.spotify.com", title: "Spotify" }
    ];

    function renderTravel() {
        var wrap = el("div", "isl-mode nt-scroller");
        var input = el("input", "isl-input");
        input.type = "text";
        input.placeholder = "Surf away…";
        input.setAttribute("autocomplete", "off");
        input.setAttribute("spellcheck", "false");
        wrap.appendChild(input);

        var list = el("div", "isl-nav-list");
        wrap.appendChild(list);
        topBody.appendChild(wrap);

        function sec(t) { var s = el("div", "isl-nav-sec"); s.textContent = t; return s; }
        function paint(q) {
            q = (q || "").trim().toLowerCase();
            list.innerHTML = "";
            if (q) {
                var looksUrl = /\.[a-z]{2,}(\/|$|:)/i.test(q) || /^https?:\/\//i.test(q) || /^[a-z]+:\/\//i.test(q);
                var go = navItem(looksUrl ? IC.globe : IC.search,
                    looksUrl ? "Go to " + q : "Search the web",
                    looksUrl ? "Open page" : "\"" + q + "\"",
                    function () { goWeb(input.value); });
                go.classList.add("sel");
                list.appendChild(go);
            }
            var pages = PAGES.filter(function (p) { return !q || p.title.toLowerCase().indexOf(q) !== -1; });
            if (pages.length) {
                list.appendChild(sec("Pages"));
                pages.forEach(function (p) { list.appendChild(navItem(p.icon, p.title, p.sub, function () { goPage(p.path); })); });
            }
            var sites = SITES.filter(function (s) { return !q || s.title.toLowerCase().indexOf(q) !== -1; });
            if (sites.length && (!q || sites.length <= 8)) {
                list.appendChild(sec("Quick sites"));
                sites.forEach(function (s) { list.appendChild(navItem(IC.globe, s.title, s.url.replace(/^https?:\/\//, ""), function () { goWeb(s.url); })); });
            }
        }
        input.addEventListener("input", function () { paint(input.value); });
        input.addEventListener("keydown", function (e) {
            if (e.key === "Enter") { e.preventDefault(); if (input.value.trim()) goWeb(input.value); }
        });
        paint("");
        setTimeout(function () { try { input.focus(); } catch (e) {} }, 80);
    }
    function navItem(icon, title, sub, onClick) {
        var b = el("button", "isl-nav-item");
        b.type = "button";
        b.innerHTML = '<span class="isl-nav-ic">' + icon + '</span><span class="isl-nav-tx"><b>' + esc(title) + "</b>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</span>";
        b.addEventListener("click", onClick);
        return b;
    }

    var mu = {
        queue: [], index: -1, track: null,
        loop: 0,
        shuffle: false, view: "foryou", volume: 1, muted: false
    };
    try {
        mu.loop = parseInt(localStorage.getItem("noc-isl-loop") || "0", 10) || 0;
        mu.shuffle = localStorage.getItem("noc-isl-shuffle") === "1";
        mu.volume = Math.min(1, Math.max(0, parseFloat(localStorage.getItem("noc-isl-vol") || "1")));
        mu.muted = localStorage.getItem("noc-isl-muted") === "1";
    } catch (e) {}
    audio.volume = mu.volume;
    audio.muted = mu.muted;

    function trackArr(d) { return (d && (d.tracks || d.results || d.items || d.songs)) || []; }
    function trackArt(t) { return (t && (t.artwork || t.art || t.cover || t.thumbnail)) || ""; }
    function streamUrl(t) {
        if (!t) return "";
        if (t.stream || (t.url && /^https?:/.test(t.url))) return t.stream || t.url;
        return "/api/music/stream/" + encodeURIComponent(t.id);
    }

    var musicUI = null;
    function renderMedia() {
        var wrap = el("div", "isl-mode nt-media-wrap");
        var tabs = el("div", "isl-mu-tabs");
        [["foryou", "For You"], ["trending", "Trending"], ["search", "Search"]].forEach(function (t) {
            var b = el("button", "isl-mu-tab" + (mu.view === t[0] ? " active" : ""));
            b.type = "button"; b.textContent = t[1];
            b.addEventListener("click", function () { setView(t[0]); });
            tabs.appendChild(b);
        });
        wrap.appendChild(tabs);

        var searchBox = el("input", "isl-input");
        searchBox.type = "text"; searchBox.placeholder = "Search songs & artists…";
        searchBox.style.marginBottom = "8px";
        searchBox.style.display = mu.view === "search" ? "block" : "none";
        var searchT;
        searchBox.addEventListener("input", function () {
            clearTimeout(searchT);
            var q = searchBox.value.trim();
            searchT = setTimeout(function () { if (q) loadSearch(q); }, 350);
        });
        searchBox.addEventListener("keydown", function (e) { if (e.key === "Enter") { clearTimeout(searchT); if (searchBox.value.trim()) loadSearch(searchBox.value.trim()); } });
        wrap.appendChild(searchBox);

        var scroll = el("div", "nt-queue");
        wrap.appendChild(scroll);
        wrap.appendChild(buildPlayerDock());
        topBody.appendChild(wrap);
        musicUI = { listEl: scroll, tabsEl: tabs, searchBox: searchBox };

        if (!mu.queue.length || mu.view !== "search") loadView(mu.view);
        else renderQueue();
        syncPlayerDock();

        function setView(v) {
            mu.view = v;
            tabs.querySelectorAll(".isl-mu-tab").forEach(function (b, i) {
                b.classList.toggle("active", ["foryou", "trending", "search"][i] === v);
            });
            searchBox.style.display = v === "search" ? "block" : "none";
            if (v === "search") { scroll.innerHTML = '<div class="isl-empty">Type to search.</div>'; setTimeout(function () { try { searchBox.focus(); } catch (e) {} }, 40); }
            else loadView(v);
        }
    }

    function loadView(view) {
        if (!musicUI) return;
        musicUI.listEl.innerHTML = '<div class="isl-spinner"></div>';
        var url = view === "trending" ? "/api/music/trending?limit=40" : "/api/music/recommend?limit=40";
        fetch(url, { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                var arr = trackArr(d);
                if (!arr.length && view === "foryou") return fetch("/api/music/trending?limit=40", { credentials: "same-origin" }).then(function (r) { return r.json(); });
                return { tracks: arr };
            })
            .then(function (d) { setQueueFromResults(trackArr(d)); })
            .catch(function () { if (musicUI) musicUI.listEl.innerHTML = '<div class="isl-empty">Couldn’t load music.</div>'; });
    }
    function loadSearch(q) {
        if (!musicUI) return;
        musicUI.listEl.innerHTML = '<div class="isl-spinner"></div>';
        fetch("/api/music/search?q=" + encodeURIComponent(q) + "&limit=40", { credentials: "same-origin" })
            .then(function (r) { return r.json(); })
            .then(function (d) { setQueueFromResults(trackArr(d)); })
            .catch(function () { if (musicUI) musicUI.listEl.innerHTML = '<div class="isl-empty">Search failed.</div>'; });
    }
    function setQueueFromResults(arr) {
        mu.queue = arr || [];
        if (mu.track) { var i = mu.queue.findIndex(function (t) { return t.id === mu.track.id; }); mu.index = i; }
        renderQueue();
    }
    function renderQueue() {
        if (!musicUI) return;
        var host = musicUI.listEl;
        host.innerHTML = "";
        if (!mu.queue.length) { host.innerHTML = '<div class="isl-empty">Nothing here yet.</div>'; return; }
        mu.queue.forEach(function (t, i) {
            var row = el("div", "isl-track" + (mu.track && t.id === mu.track.id ? " playing" : ""));
            var art = trackArt(t);
            row.innerHTML =
                (art ? '<img class="isl-track-art" src="' + esc(art) + '" alt="" loading="lazy">' : '<div class="isl-track-art"></div>') +
                '<div class="isl-track-meta"><b>' + esc(t.title || "Unknown") + "</b><span>" + esc(t.artist || "") + "</span></div>";
            row.addEventListener("click", function () { playAt(i); });
            host.appendChild(row);
        });
    }

    function playAt(i) {
        if (i < 0 || i >= mu.queue.length) return;
        mu.index = i;
        mu.track = mu.queue[i];
        try { audio.src = streamUrl(mu.track); audio.play().catch(function () {}); } catch (e) {}
        persistPlayer();
        renderQueue();
        syncPlayerDock();
        syncMedia();
        reportHistory(mu.track);
    }
    function reportHistory(t) {
        if (!t) return;
        fetch("/api/music/history", {
            method: "POST", credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: t.id, title: t.title, artist: t.artist, genre: t.genre, artwork: trackArt(t), duration: t.duration })
        }).catch(function () {});
    }
    function togglePlay() {
        if (!mu.track) { if (mu.queue.length) playAt(0); return; }
        if (audio.paused) audio.play().catch(function () {}); else audio.pause();
    }
    function nextTrack(auto) {
        if (!mu.queue.length) return;
        if (mu.loop === 2 && auto) { audio.currentTime = 0; audio.play().catch(function () {}); return; }
        var n = mu.shuffle ? Math.floor(Math.random() * mu.queue.length) : mu.index + 1;
        if (n >= mu.queue.length) {
            if (mu.loop === 1) n = 0;
            else if (auto) return;
            else n = 0;
        }
        playAt(n);
    }
    function prevTrack() {
        if (!mu.queue.length) return;
        if (audio.currentTime > 3) { audio.currentTime = 0; return; }
        var p = mu.index - 1;
        if (p < 0) p = mu.loop === 1 ? mu.queue.length - 1 : 0;
        playAt(p);
    }

    var pd = null;
    function buildPlayerDock() {
        var wrap = el("div", "isl-player" + (mu.track ? "" : " empty"));
        var top = el("div", "isl-player-top");
        var art = el("img", "isl-player-art"); art.alt = "";
        var meta = el("div", "isl-player-meta");
        meta.innerHTML = "<b></b><span></span>";
        top.appendChild(art); top.appendChild(meta);

        var seek = el("div", "isl-seek");
        var tCur = el("div", "isl-seek-time"); tCur.textContent = "0:00";
        var track = el("div", "isl-bar-track");
        var fill = el("div", "isl-bar-fill"); track.appendChild(fill);
        var tEnd = el("div", "isl-seek-time end"); tEnd.textContent = "0:00";
        seek.appendChild(tCur); seek.appendChild(track); seek.appendChild(tEnd);
        track.addEventListener("click", function (e) {
            if (!audio.duration) return;
            var r = track.getBoundingClientRect();
            audio.currentTime = ((e.clientX - r.left) / r.width) * audio.duration;
        });

        var ctrls = el("div", "isl-controls");
        var bShuffle = cbtn(IC.shuffle, "Shuffle", function () { mu.shuffle = !mu.shuffle; persistPrefs(); syncPlayerDock(); });
        var bPrev = cbtn(IC.prev, "Previous", prevTrack);
        var bPlay = cbtn(IC.play, "Play / pause", togglePlay); bPlay.classList.add("play");
        var bNext = cbtn(IC.next, "Next", function () { nextTrack(false); });
        var bLoop = cbtn(IC.repeat, "Loop", function () { mu.loop = (mu.loop + 1) % 3; persistPrefs(); syncPlayerDock(); });
        var bVol = cbtn(IC.vol, "Mute", function () { mu.muted = !mu.muted; audio.muted = mu.muted; persistPrefs(); syncPlayerDock(); });
        [bShuffle, bPrev, bPlay, bNext, bLoop, bVol].forEach(function (b) { ctrls.appendChild(b); });

        wrap.appendChild(top); wrap.appendChild(seek); wrap.appendChild(ctrls);
        pd = { wrap: wrap, art: art, meta: meta, tCur: tCur, tEnd: tEnd, fill: fill, bPlay: bPlay, bShuffle: bShuffle, bLoop: bLoop, bVol: bVol };
        return wrap;
    }
    function cbtn(icon, label, fn) {
        var b = el("button", "isl-cbtn", icon);
        b.type = "button"; b.title = label; b.setAttribute("aria-label", label);
        b.addEventListener("click", fn);
        return b;
    }
    function syncPlayerDock() {
        if (!pd || !pd.wrap.isConnected) { pd = null; return; }
        pd.wrap.classList.toggle("empty", !mu.track);
        if (mu.track) {
            var a = trackArt(mu.track);
            pd.art.src = a || "";
            pd.art.style.visibility = a ? "visible" : "hidden";
            pd.meta.querySelector("b").textContent = mu.track.title || "Unknown";
            pd.meta.querySelector("span").textContent = mu.track.artist || "";
        }
        pd.bPlay.innerHTML = audio.paused ? IC.play : IC.pause;
        pd.bShuffle.classList.toggle("on", mu.shuffle);
        pd.bLoop.classList.toggle("on", mu.loop > 0);
        pd.bLoop.innerHTML = IC.repeat + (mu.loop === 2 ? '<span class="isl-loopnum">1</span>' : "");
        pd.bVol.innerHTML = mu.muted ? IC.mute : IC.vol;
        pd.bVol.classList.toggle("on", mu.muted);
    }

    audio.addEventListener("timeupdate", function () {
        if (pd && pd.wrap.isConnected && audio.duration) {
            pd.fill.style.width = (audio.currentTime / audio.duration * 100) + "%";
            pd.tCur.textContent = fmtTime(audio.currentTime);
            pd.tEnd.textContent = fmtTime(audio.duration);
        }
    });
    audio.addEventListener("play", function () { syncPlayerDock(); syncMedia(); });
    audio.addEventListener("pause", function () { syncPlayerDock(); syncMedia(); });
    audio.addEventListener("ended", function () { nextTrack(true); });

    function persistPrefs() {
        try {
            localStorage.setItem("noc-isl-loop", String(mu.loop));
            localStorage.setItem("noc-isl-shuffle", mu.shuffle ? "1" : "0");
            localStorage.setItem("noc-isl-vol", String(mu.volume));
            localStorage.setItem("noc-isl-muted", mu.muted ? "1" : "0");
        } catch (e) {}
    }
    function persistPlayer() { try { localStorage.setItem("noc-isl-track", JSON.stringify(mu.track || null)); } catch (e) {} }
    function restorePlayer() {
        try {
            var t = JSON.parse(localStorage.getItem("noc-isl-track") || "null");
            if (t && t.id) { mu.track = t; syncMedia(); }
        } catch (e) {}
    }

    function syncMedia() {
        updateNotch();
        try {
            if ("mediaSession" in navigator && mu.track) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: mu.track.title || "", artist: mu.track.artist || "",
                    artwork: trackArt(mu.track) ? [{ src: trackArt(mu.track) }] : []
                });
                navigator.mediaSession.setActionHandler("play", togglePlay);
                navigator.mediaSession.setActionHandler("pause", togglePlay);
                navigator.mediaSession.setActionHandler("nexttrack", function () { nextTrack(false); });
                navigator.mediaSession.setActionHandler("previoustrack", prevTrack);
            }
        } catch (e) {}
    }

    var ai = { history: [], streaming: false, authed: false, anon: null, model: null, abort: null, ui: null };

    function renderAI() {
        var wrap = el("div", "isl-mode isl-ai nt-ai-wrap");
        var scroll = el("div", "isl-ai-scroll");
        wrap.appendChild(scroll);
        var quota = el("div", "isl-ai-quota");
        wrap.appendChild(quota);
        var form = el("div", "isl-ai-form");
        var ta = el("textarea", "isl-input isl-ai-ta");
        ta.rows = 1; ta.placeholder = "Ask anything…";
        var send = el("button", "isl-ai-send", IC.send);
        send.type = "button"; send.setAttribute("aria-label", "Send");
        form.appendChild(ta); form.appendChild(send);
        wrap.appendChild(form);
        topBody.appendChild(wrap);

        ai.ui = { scroll: scroll, quota: quota, ta: ta, send: send };

        function autolen() { ta.style.height = "auto"; ta.style.height = Math.min(96, ta.scrollHeight) + "px"; }
        function doSend() {
            var text = ta.value.trim();
            if (!text || ai.streaming) return;
            ta.value = ""; autolen();
            sendAI(text);
        }
        ta.addEventListener("input", autolen);
        ta.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); doSend(); } });
        send.addEventListener("click", doSend);

        renderAIHistory();
        refreshAIConfig();
        setTimeout(function () { try { ta.focus(); } catch (e) {} }, 80);
    }

    function refreshAIConfig() {
        var headers = { Accept: "application/json" };
        try { var sess = localStorage.getItem("noc-session"); if (sess) headers["X-Noc-Session"] = sess; } catch (e) {}
        fetch("/api/ai/config", { credentials: "same-origin", cache: "no-store", headers: headers })
            .then(function (r) { return r.json(); })
            .then(function (d) {
                ai.authed = !!(d && (d.isOwner || d.paid || d.credits || !d.anon));
                ai.model = d.defaultModel || null;
                ai.anon = ai.authed ? null : (d.anon || null);
                paintQuota();
            })
            .catch(function () {});
    }
    function paintQuota() {
        if (!ai.ui || !ai.ui.quota.isConnected) return;
        var q = ai.ui.quota;
        var signed = ai.authed;
        try { if (!signed && localStorage.getItem("noc-session")) signed = true; } catch (e) {}
        if (signed) { q.innerHTML = ""; updateBadge(null); return; }
        if (ai.anon) {
            var rem = ai.anon.remaining;
            q.innerHTML = 'Free preview — <b>' + rem + "/" + ai.anon.limit + '</b> prompts left. <a data-signin>Sign in</a> for more.';
            var a = q.querySelector("[data-signin]");
            if (a) a.addEventListener("click", function () { goPage("/account.html"); });
            updateBadge(rem);
        }
    }
    function updateBadge(n) {
        var b = tabEls.ai;
        if (!b) return;
        var old = b.querySelector(".isl-badge");
        if (n == null) { if (old) old.remove(); return; }
        if (!old) { old = el("span", "isl-badge"); b.appendChild(old); }
        old.textContent = n;
    }

    function renderAIHistory() {
        if (!ai.ui) return;
        var s = ai.ui.scroll;
        s.innerHTML = "";
        if (!ai.history.length) {
            s.innerHTML = '<div class="isl-ai-intro"><span class="spark">✦</span>Ask me anything — a quick question, a definition, a snippet of code. Your full chats live in the AI page.</div>';
            return;
        }
        ai.history.forEach(function (m) {
            var d = el("div", "isl-ai-msg " + (m.role === "user" ? "user" : "bot"));
            d.innerHTML = m.role === "user" ? esc(m.content) : renderMd(m.content);
            s.appendChild(d);
        });
        s.scrollTop = s.scrollHeight;
    }
    function renderMd(t) {
        var h = esc(t);
        h = h.replace(/`([^`]+)`/g, "<code>$1</code>");
        h = h.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        return h;
    }

    function sendAI(text) {
        ai.history.push({ role: "user", content: text });
        renderAIHistory();
        ai.streaming = true;
        if (ai.ui) ai.ui.send.disabled = true;

        var botEl = el("div", "isl-ai-msg bot");
        botEl.innerHTML = '<span class="isl-cursor"></span>';
        ai.ui.scroll.appendChild(botEl);
        ai.ui.scroll.scrollTop = ai.ui.scroll.scrollHeight;

        var acc = "";
        var ctrl = new AbortController();
        ai.abort = ctrl;

        fetch("/api/ai/chat", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: ai.model || undefined,
                messages: ai.history.map(function (m) { return { role: m.role, content: m.content }; }),
                temperature: 0.7,
                max_completion_tokens: 900
            }),
            signal: ctrl.signal
        }).then(function (r) {
            var remain = r.headers.get("X-Anon-Remaining");
            if (remain != null && ai.anon) { ai.anon.remaining = parseInt(remain, 10); paintQuota(); }
            if (!r.ok) {
                return r.json().then(function (j) {
                    var msg = j.error || ("HTTP " + r.status);
                    if (j.anonLimit || j.signInRequired) {
                        botEl.innerHTML = renderMd(msg) + '<div style="margin-top:8px"><button class="isl-btn primary" data-si>Sign in — free</button></div>';
                        var b = botEl.querySelector("[data-si]"); if (b) b.addEventListener("click", function () { goPage("/account.html"); });
                    } else botEl.innerHTML = renderMd("⚠ " + msg);
                    throw new Error("handled");
                }, function () { botEl.innerHTML = renderMd("⚠ HTTP " + r.status); throw new Error("handled"); });
            }
            var reader = r.body.getReader();
            var dec = new TextDecoder();
            var buf = "";
            function pump() {
                return reader.read().then(function (res) {
                    if (res.done) return;
                    buf += dec.decode(res.value, { stream: true });
                    var lines = buf.split("\n");
                    buf = lines.pop() || "";
                    lines.forEach(function (line) {
                        if (line.indexOf("data: ") !== 0) return;
                        var payload = line.slice(6);
                        if (payload === "[DONE]") return;
                        try {
                            var evt = JSON.parse(payload);
                            if (evt.type === "delta" && evt.text) {
                                acc += evt.text;
                                botEl.innerHTML = renderMd(acc) + '<span class="isl-cursor"></span>';
                                ai.ui.scroll.scrollTop = ai.ui.scroll.scrollHeight;
                            } else if (evt.type === "error") {
                                throw new Error(evt.error || "stream error");
                            }
                        } catch (e) { if (!(e instanceof SyntaxError)) throw e; }
                    });
                    return pump();
                });
            }
            return pump().then(function () {
                botEl.innerHTML = renderMd(acc || "(no response)");
                if (acc) ai.history.push({ role: "assistant", content: acc });
            });
        }).catch(function (e) {
            if (e && e.message === "handled") {  }
            else if (e && e.name === "AbortError") botEl.innerHTML = renderMd(acc || "(stopped)");
            else if (botEl.querySelector(".isl-cursor")) botEl.innerHTML = renderMd("⚠ " + ((e && e.message) || "Something went wrong."));
        }).then(function () {
            ai.streaming = false;
            ai.abort = null;
            if (ai.ui && ai.ui.send.isConnected) ai.ui.send.disabled = false;
        });
    }

    var BUILTINS = [
        { id: "dark", emoji: "🌙", name: "Dark Mode Everywhere", desc: "Force a dark theme on sites that don't have one.",
          css: "html{background:#0e0f16!important;filter:invert(1) hue-rotate(180deg)!important}html img,html video,html picture,html canvas,html svg image,html iframe,html [style*=\"background-image\"]{filter:invert(1) hue-rotate(180deg)!important}" },
        { id: "adhide", emoji: "🚫", name: "Ad & Cosmetic Hider", desc: "Hide common ad slots and sponsored blocks.",
          css: "[id*=\"google_ads\"],[id^=\"ad-\"],[id$=\"-ad\"],[class*=\"ad-slot\"],[class*=\"advert\"],[class*=\"sponsored\"],ins.adsbygoogle,iframe[src*=\"doubleclick\"],iframe[src*=\"/ads/\"],[data-ad],[aria-label=\"Ad\"]{display:none!important}" },
        { id: "cookies", emoji: "🍪", name: "Cookie Banner Zapper", desc: "Hide consent / cookie pop-ups.",
          css: "[id*=\"cookie\"i][class*=\"banner\"i],[class*=\"cookie-consent\"i],[id*=\"consent\"i][class*=\"popup\"i],[class*=\"gdpr\"i],#onetrust-banner-sdk,#onetrust-consent-sdk,.cc-window,.cmp-container,[aria-label*=\"cookie\"i]{display:none!important}html{overflow:auto!important}" },
        { id: "unsticky", emoji: "📌", name: "Un-stick Headers", desc: "Stop sticky bars from following you as you scroll.",
          css: "*{scroll-behavior:auto!important}[style*=\"position: fixed\"],[style*=\"position:fixed\"],[class*=\"sticky\"i],[class*=\"navbar-fixed\"i]{position:static!important}" },
        { id: "focus", emoji: "🎯", name: "Focus Mode", desc: "Desaturate the page to cut visual noise.",
          css: "html{filter:grayscale(0.85) contrast(1.02)!important}" }
    ];
    var ext = { on: {}, zoom: 100, scripts: [] };
    try {
        ext.on = JSON.parse(localStorage.getItem("noc-ext-on") || "{}") || {};
        ext.zoom = parseInt(localStorage.getItem("noc-ext-zoom") || "100", 10) || 100;
        ext.scripts = JSON.parse(localStorage.getItem("noc-ext-scripts") || "[]") || [];
    } catch (e) {}
    function saveExt() {
        try {
            localStorage.setItem("noc-ext-on", JSON.stringify(ext.on));
            localStorage.setItem("noc-ext-zoom", String(ext.zoom));
            localStorage.setItem("noc-ext-scripts", JSON.stringify(ext.scripts));
        } catch (e) {}
    }

    function renderExt() {
        var wrap = el("div", "isl-mode nt-scroller");
        var tabs = el("div", "isl-ext-tabs");
        var tGallery = el("button", "isl-mu-tab active"); tGallery.type = "button"; tGallery.textContent = "Gallery";
        var tScripts = el("button", "isl-mu-tab"); tScripts.type = "button"; tScripts.textContent = "Userscripts";
        var tCrx = el("button", "isl-mu-tab"); tCrx.type = "button"; tCrx.textContent = "Add-ons";
        tabs.appendChild(tGallery); tabs.appendChild(tScripts); tabs.appendChild(tCrx);
        wrap.appendChild(tabs);
        var pane = el("div"); wrap.appendChild(pane);
        topBody.appendChild(wrap);

        function activate(btn) { [tGallery, tScripts, tCrx].forEach(function (b) { b.classList.toggle("active", b === btn); }); }
        tGallery.addEventListener("click", function () { activate(tGallery); paintGallery(pane); });
        tScripts.addEventListener("click", function () { activate(tScripts); paintScripts(pane); });
        tCrx.addEventListener("click", function () { activate(tCrx); paintCrx(pane); });
        paintGallery(pane);
        if (!IS_SHELL) {
            var note = el("div", "isl-ai-quota");
            note.textContent = "Tip: extensions apply while you browse in the main window.";
            wrap.appendChild(note);
        }
    }

    function paintCrx(pane) {
        pane.innerHTML = "";
        var dz = el("div", "isl-ext-dropzone");
        dz.innerHTML = IC.ext + '<div><b>Install a Chrome extension</b><span>Drop a .crx or .zip file, or click to browse.</span></div>';
        var file = el("input"); file.type = "file"; file.accept = ".crx,.zip"; file.style.display = "none";
        dz.appendChild(file);
        var status = el("div", "isl-ext-status");
        dz.addEventListener("click", function () { file.click(); });
        ["dragover", "dragenter"].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.add("drag"); }); });
        ["dragleave", "drop"].forEach(function (t) { dz.addEventListener(t, function (e) { e.preventDefault(); dz.classList.remove("drag"); }); });
        dz.addEventListener("drop", function (e) {
            var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) installCrxFile(f);
        });
        file.addEventListener("change", function () {
            var f = file.files && file.files[0];
            if (f) installCrxFile(f);
            file.value = "";
        });
        pane.appendChild(dz);
        pane.appendChild(status);

        var list = el("div", "isl-crx-list");
        pane.appendChild(list);

        function installCrxFile(f) {
            status.textContent = "Installing " + f.name + "…";
            f.arrayBuffer().then(function (buf) {
                return import("/app/runtime/engine.mjs").then(function (m) { return m._x7i(buf, f.name); });
            }).then(function () {
                status.textContent = "";
                paintCrxList(list);
            }).catch(function (e) {
                status.textContent = "Couldn't install " + f.name + ": " + (e && e.message ? e.message : "unknown error");
            });
        }

        paintCrxList(list);
    }
    function paintCrxList(list) {
        import("/app/runtime/engine.mjs").then(function (m) {
            if (!m._a4s()) {
                list.innerHTML = "";
                list.appendChild(el("div", "isl-empty", "Extensions engine isn't available in this session — try reloading."));
                return;
            }
            var items = m._g3i();
            list.innerHTML = "";
            if (!items.length) { list.appendChild(el("div", "isl-empty", "No extensions installed yet.")); return; }
            items.forEach(function (ex) {
                var row = el("div", "isl-crx-item");
                var icon = ex.iconUrl ? '<img src="' + esc(ex.iconUrl) + '" alt="">' : '<span class="isl-crx-fallback">' + esc((ex.name || "?")[0].toUpperCase()) + "</span>";
                row.innerHTML = '<div class="isl-crx-icon">' + icon + '</div><div class="isl-ext-meta"><b>' + esc(ex.name) + "</b><span>" + esc(ex.version || "") + "</span></div>";
                var sw = el("label", "isl-switch");
                var inp = el("input"); inp.type = "checkbox"; inp.checked = !!ex.enabled;
                sw.appendChild(inp); sw.appendChild(el("span", "track")); sw.appendChild(el("span", "knob"));
                inp.addEventListener("change", function () {
                    inp.disabled = true;
                    m._s6e(ex.id, inp.checked).finally(function () { inp.disabled = false; });
                });
                var del = el("button", "isl-mini-x", "✕"); del.title = "Uninstall";
                del.addEventListener("click", function () {
                    if (!confirm("Uninstall " + (ex.name || "this extension") + "?")) return;
                    m._u2r(ex.id).then(function () { paintCrxList(list); });
                });
                row.appendChild(sw); row.appendChild(del);
                list.appendChild(row);
            });
        });
    }
    function paintGallery(pane) {
        pane.innerHTML = "";
        var zoomCard = el("div", "isl-ext-card");
        zoomCard.innerHTML = '<div class="isl-ext-emoji">🔍</div><div class="isl-ext-meta"><b>Page Zoom</b><span>Zoom level for proxied pages.</span></div>';
        var zc = el("div"); zc.style.cssText = "display:flex;align-items:center;gap:6px";
        var zMinus = el("button", "isl-btn", "−");
        var zVal = el("b"); zVal.style.cssText = "min-width:42px;text-align:center;font-size:12.5px"; zVal.textContent = ext.zoom + "%";
        var zPlus = el("button", "isl-btn", "+");
        zMinus.addEventListener("click", function () { ext.zoom = Math.max(50, ext.zoom - 10); zVal.textContent = ext.zoom + "%"; saveExt(); reinjectAll(); });
        zPlus.addEventListener("click", function () { ext.zoom = Math.min(200, ext.zoom + 10); zVal.textContent = ext.zoom + "%"; saveExt(); reinjectAll(); });
        zc.appendChild(zMinus); zc.appendChild(zVal); zc.appendChild(zPlus);
        zoomCard.appendChild(zc);
        pane.appendChild(zoomCard);

        BUILTINS.forEach(function (b) {
            var card = el("div", "isl-ext-card" + (ext.on[b.id] ? " on" : ""));
            card.innerHTML = '<div class="isl-ext-emoji">' + b.emoji + '</div><div class="isl-ext-meta"><b>' + esc(b.name) + "</b><span>" + esc(b.desc) + "</span></div>";
            var sw = el("label", "isl-switch");
            var inp = el("input"); inp.type = "checkbox"; inp.checked = !!ext.on[b.id];
            sw.appendChild(inp); sw.appendChild(el("span", "track")); sw.appendChild(el("span", "knob"));
            inp.addEventListener("change", function () { ext.on[b.id] = inp.checked; card.classList.toggle("on", inp.checked); saveExt(); reinjectAll(); });
            card.appendChild(sw);
            pane.appendChild(card);
        });
    }
    function paintScripts(pane) {
        pane.innerHTML = "";
        var add = el("button", "isl-btn primary", IC.plus + " New userscript");
        add.style.cssText = "width:100%;margin-bottom:10px";
        add.addEventListener("click", function () { editScript(pane, null); });
        pane.appendChild(add);

        if (!ext.scripts.length) { pane.appendChild(el("div", "isl-empty", "No userscripts yet. Paste your own JS to run it on matching sites.")); return; }
        ext.scripts.forEach(function (s, i) {
            var item = el("div", "isl-us-item");
            var row = el("div", "row");
            var sw = el("label", "isl-switch");
            var inp = el("input"); inp.type = "checkbox"; inp.checked = !!s.on;
            sw.appendChild(inp); sw.appendChild(el("span", "track")); sw.appendChild(el("span", "knob"));
            inp.addEventListener("change", function () { s.on = inp.checked; saveExt(); reinjectAll(); });
            var name = el("b"); name.textContent = s.name || "Untitled";
            var edit = el("button", "isl-btn", "Edit"); edit.addEventListener("click", function () { editScript(pane, i); });
            var del = el("button", "isl-mini-x", "✕"); del.title = "Delete";
            del.addEventListener("click", function () { ext.scripts.splice(i, 1); saveExt(); reinjectAll(); paintScripts(pane); });
            row.appendChild(sw); row.appendChild(name); row.appendChild(edit); row.appendChild(del);
            item.appendChild(row);
            item.appendChild(el("div", "match", "@match  " + esc(s.match || "*")));
            pane.appendChild(item);
        });
    }
    function editScript(pane, idx) {
        var s = idx == null ? { name: "", match: "*", code: "// Runs inside the proxied page.\n// Example:\n// document.body.style.border = '4px solid magenta';\n", on: true } : ext.scripts[idx];
        pane.innerHTML = "";
        var name = el("input", "isl-input"); name.placeholder = "Name"; name.value = s.name || ""; name.style.marginBottom = "8px";
        var match = el("input", "isl-input"); match.placeholder = "Match host (e.g. youtube.com or *)"; match.value = s.match || "*"; match.style.marginBottom = "8px";
        var code = el("textarea", "isl-input isl-textarea"); code.value = s.code || ""; code.spellcheck = false;
        code.style.minHeight = "150px";
        var actions = el("div"); actions.style.cssText = "display:flex;gap:8px;margin-top:10px";
        var save = el("button", "isl-btn primary", "Save"); save.style.flex = "1";
        var cancel = el("button", "isl-btn", "Cancel");
        actions.appendChild(cancel); actions.appendChild(save);
        pane.appendChild(name); pane.appendChild(match); pane.appendChild(code); pane.appendChild(actions);
        cancel.addEventListener("click", function () { paintScripts(pane); });
        save.addEventListener("click", function () {
            var obj = { name: name.value.trim() || "Untitled", match: match.value.trim() || "*", code: code.value, on: s.on !== false };
            if (idx == null) ext.scripts.push(obj); else ext.scripts[idx] = obj;
            saveExt(); reinjectAll(); paintScripts(pane);
        });
        setTimeout(function () { try { name.focus(); } catch (e) {} }, 40);
    }

    function frames() {
        var host = document.getElementById("frameStack");
        if (!host) return [];
        return Array.prototype.slice.call(host.querySelectorAll("iframe"));
    }
    function frameHost(f) {
        var u = (f.dataset && (f.dataset.currentUrl || f.dataset.targetUrl)) || "";
        if (!u || u.charAt(0) === "/") return null;
        try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return null; }
    }
    function matchHost(pattern, host) {
        pattern = (pattern || "*").trim().toLowerCase();
        if (pattern === "*" || pattern === "") return true;
        if (!host) return false;
        pattern = pattern.replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
        return host === pattern || host.indexOf(pattern) !== -1 || pattern.indexOf(host) !== -1;
    }
    function applyToFrame(f) {
        var doc;
        try { doc = f.contentDocument; } catch (e) { return; }
        if (!doc || !doc.head) return;
        var host = frameHost(f);
        try {
            doc.querySelectorAll("[data-noc-ext]").forEach(function (n) { n.remove(); });
            doc.documentElement.style.zoom = "";
        } catch (e) {}
        if (host === null) return;

        BUILTINS.forEach(function (b) {
            if (!ext.on[b.id] || !b.css) return;
            var st = doc.createElement("style");
            st.setAttribute("data-noc-ext", b.id);
            st.textContent = b.css;
            doc.head.appendChild(st);
        });
        if (ext.zoom && ext.zoom !== 100) {
            try { doc.documentElement.style.zoom = (ext.zoom / 100).toString(); } catch (e) {}
        }
        ext.scripts.forEach(function (s, i) {
            if (!s.on || !s.code) return;
            if (!matchHost(s.match, host)) return;
            try {
                var sc = doc.createElement("script");
                sc.setAttribute("data-noc-ext", "us" + i);
                sc.textContent = "(function(){try{" + s.code + "\n}catch(e){console.warn('[nocturne userscript]',e);}})();";
                (doc.body || doc.head).appendChild(sc);
            } catch (e) {}
        });
    }
    function reinjectAll() { frames().forEach(applyToFrame); }
    function hookFrame(f) {
        if (f.__nocExtHooked) return;
        f.__nocExtHooked = true;
        f.addEventListener("load", function () { setTimeout(function () { applyToFrame(f); }, 30); });
        setTimeout(function () { applyToFrame(f); }, 60);
    }
    function bootExtensions() {
        if (!IS_SHELL) return;
        var host = document.getElementById("frameStack");
        if (!host) return;
        frames().forEach(hookFrame);
        var obs = new MutationObserver(function (muts) {
            muts.forEach(function (m) {
                Array.prototype.forEach.call(m.addedNodes || [], function (n) {
                    if (n.tagName === "IFRAME") hookFrame(n);
                    else if (n.querySelectorAll) Array.prototype.forEach.call(n.querySelectorAll("iframe"), hookFrame);
                });
            });
        });
        obs.observe(host, { childList: true, subtree: true });
        window.__nocExtReinject = reinjectAll;
    }

    var perfRAF = null, perfPing = null, _frames = 0, _lastFps = 0, _fps = 0, _pingMs = null;
    function renderPerf() {
        var wrap = el("div", "nt-perf");
        var meters = el("div", "nt-meters");
        function meter(icon, id) {
            var m = el("div", "nt-meter");
            m.innerHTML = '<div class="nt-meter-track"><div class="nt-meter-fill" data-m="' + id + '"></div></div><div class="nt-meter-ico">' + icon + "</div>";
            return m;
        }
        meters.appendChild(meter(IC.gauge, "fps"));
        meters.appendChild(meter(IC.cpu, "mem"));
        meters.appendChild(meter(IC.wifi, "ping"));
        var stats = el("div", "nt-perf-stats");
        stats.innerHTML =
            perfStat("Frame rate", "fps", "fps") +
            perfStat("JS memory", "mem", "") +
            perfStat("Ping", "ping", "ms") +
            perfStat("CPU threads", "cpu", "") +
            perfStat("Worker", "sw", "") +
            perfStat("Engine", "eng", "");
        wrap.appendChild(meters); wrap.appendChild(stats);
        topBody.appendChild(wrap);
        setPerfStat("cpu", (navigator.hardwareConcurrency || "—") + "");
        setPerfStat("eng", engineLabel());
        try { setPerfStat("sw", (navigator.serviceWorker && navigator.serviceWorker.controller) ? "Active" : "Inactive"); } catch (e) { setPerfStat("sw", "—"); }
        startPerf();
    }
    function perfStat(label, id, unit) {
        return '<div class="nt-perf-stat"><span class="k">' + label + '</span><span class="v" data-s="' + id + '">—' + (unit ? ' <small>' + unit + "</small>" : "") + "</span></div>";
    }
    function setPerfStat(id, val) {
        if (!topBody) return;
        var e = topBody.querySelector('[data-s="' + id + '"]');
        if (!e) return;
        var small = e.querySelector("small");
        e.textContent = val;
        if (small) { e.appendChild(document.createTextNode(" ")); e.appendChild(small); }
    }
    function setMeter(id, pct, cls) {
        if (!topBody) return;
        var e = topBody.querySelector('[data-m="' + id + '"]');
        if (!e) return;
        e.style.height = Math.max(2, Math.min(100, pct)) + "%";
        e.className = "nt-meter-fill" + (cls ? " " + cls : "");
    }
    function startPerf() {
        stopPerf();
        _frames = 0; _lastFps = performance.now();
        function loop(t) {
            _frames++;
            if (t - _lastFps >= 500) { _fps = Math.round(_frames * 1000 / (t - _lastFps)); _frames = 0; _lastFps = t; paintPerf(); }
            perfRAF = requestAnimationFrame(loop);
        }
        perfRAF = requestAnimationFrame(loop);
        pingOnce();
        perfPing = setInterval(pingOnce, 4000);
    }
    function stopPerf() {
        if (perfRAF) { cancelAnimationFrame(perfRAF); perfRAF = null; }
        if (perfPing) { clearInterval(perfPing); perfPing = null; }
    }
    function pingOnce() {
        var t0 = performance.now();
        fetch("/ping", { cache: "no-store" })
            .then(function () { _pingMs = Math.round(performance.now() - t0); paintPerf(); })
            .catch(function () { _pingMs = null; paintPerf(); });
    }
    function paintPerf() {
        if (topMode !== "performance") return;
        setPerfStat("fps", _fps ? String(_fps) : "—");
        setMeter("fps", (_fps / 60) * 100, _fps < 24 ? "hot" : (_fps < 45 ? "warn" : ""));
        var mem = null, memPct = 0;
        try {
            if (performance.memory) {
                mem = performance.memory.usedJSHeapSize / 1048576;
                memPct = (performance.memory.usedJSHeapSize / performance.memory.jsHeapSizeLimit) * 100;
            }
        } catch (e) {}
        setPerfStat("mem", mem != null ? Math.round(mem) + " MB" : (navigator.deviceMemory ? "~" + navigator.deviceMemory + " GB" : "—"));
        setMeter("mem", mem != null ? memPct : 30, memPct > 80 ? "hot" : (memPct > 55 ? "warn" : ""));
        setPerfStat("ping", _pingMs != null ? String(_pingMs) : "—");
        setMeter("ping", _pingMs != null ? Math.min(100, (_pingMs / 300) * 100) : 0, _pingMs > 200 ? "hot" : (_pingMs > 90 ? "warn" : ""));
    }

    function maybeShowHints() {
        try { if (localStorage.getItem("noc-island-hinted") === "1") return; } catch (e) {}
        if (document.getElementById("onboarding")) {
            var iv = setInterval(function () { if (!document.getElementById("onboarding")) { clearInterval(iv); setTimeout(showHints, 900); } }, 1000);
            return;
        }
        setTimeout(showHints, 1400);
    }
    function showHints() {
        try { if (localStorage.getItem("noc-island-hinted") === "1") return; } catch (e) {}
        if (!topNotch) return;

        var nr = topNotch.getBoundingClientRect();
        var hint = el("div", "noc-hint from-top");
        hint.innerHTML = '<div class="noc-hint-title">' + IC.chev.replace("nt-chev", "") +
            'Your dynamic island</div>Hover the <b>top edge</b> for your dashboard, travel, music, <b>Pocket AI</b> and extensions.' +
            '<span class="noc-hint-x">Got it</span>';
        document.body.appendChild(hint);
        var cx = nr.left + nr.width / 2;
        hint.style.left = Math.round(cx - hint.offsetWidth / 2) + "px";
        hint.style.top = Math.round(Math.max(nr.bottom, 8) + 12) + "px";

        var pulse = el("div", "noc-hint-pulse");
        pulse.style.width = pulse.style.height = "48px";
        pulse.style.left = Math.round(cx - 24) + "px";
        pulse.style.top = Math.round(Math.max(nr.bottom - 6, 10) - 24) + "px";
        document.body.appendChild(pulse);

        setTimeout(function () { hint.classList.add("show"); pulse.classList.add("show"); }, 50);

        function dismiss() {
            try { localStorage.setItem("noc-island-hinted", "1"); } catch (e) {}
            hint.classList.remove("show");
            setTimeout(function () { hint.remove(); }, 400);
            pulse.remove();
            clearTimeout(autoT);
        }
        hint.addEventListener("click", dismiss);
        var autoT = setTimeout(dismiss, 18000);
    }

    window.__nocShowHints = function () {
        try { localStorage.removeItem("noc-island-hinted"); } catch (e) {}
        try { showHints(); } catch (e) { return String(e); }
    };

    if (document.body) mount();
    else document.addEventListener("DOMContentLoaded", mount, { once: true });

})();
