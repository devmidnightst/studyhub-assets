!function () {
    "use strict";
    var root = document.documentElement;
    var KEY = "nocturne-sidebar";
    var strip = document.getElementById("tabStrip");
    var btn = document.getElementById("sbToggle");
    var fab = document.getElementById("sbFab");
    var scrim = document.getElementById("sbScrim");
    if (!strip || !btn) return;

    var mobile = matchMedia("(max-width: 720px)");
    function motion() { return window.__nocMotion || null; }
    function isCollapsed() { return root.dataset.sb === "collapsed"; }

    /* ---------- collapse / expand ---------- */

    function sync() {
        var c = isCollapsed();
        btn.setAttribute("aria-expanded", String(!c));
        btn.setAttribute("aria-label", c ? "Expand sidebar" : "Collapse sidebar");
        btn.dataset.tip = c ? "Expand sidebar" : "Collapse sidebar";
    }

    function setCollapsed(c) {
        // read the live width first, so an interrupted animation continues from where it is
        var from = parseFloat(getComputedStyle(root).getPropertyValue("--sb-w")) || (isCollapsed() ? 56 : 232);
        if (c) root.dataset.sb = "collapsed"; else delete root.dataset.sb;
        try { localStorage.setItem(KEY, c ? "collapsed" : "expanded"); } catch (e) {}
        var m = motion();
        if (m) m.sidebarWidth(from, c ? 56 : 232); else root.style.removeProperty("--sb-w");
        sync();
        hideTip();
        closeMore(true);
    }

    function openDrawer() { root.setAttribute("data-sb-open", ""); }
    function closeDrawer() { root.removeAttribute("data-sb-open"); }

    btn.addEventListener("click", function () {
        if (mobile.matches) closeDrawer(); else setCollapsed(!isCollapsed());
    });
    if (fab) fab.addEventListener("click", openDrawer);
    if (scrim) scrim.addEventListener("click", closeDrawer);

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && root.hasAttribute("data-sb-open")) { closeDrawer(); return; }
        if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "b") {
            e.preventDefault();
            if (mobile.matches) { root.hasAttribute("data-sb-open") ? closeDrawer() : openDrawer(); }
            else setCollapsed(!isCollapsed());
        }
    });

    strip.addEventListener("click", function (e) {
        if (mobile.matches && e.target.closest(".tab-item, .sb-item, .sb-brand, .tab-add, .sb-app, .sb-pin")) closeDrawer();
    });
    mobile.addEventListener("change", closeDrawer);

    /* ---------- applications ---------- */

    function ico(inner) {
        return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + inner + "</svg>";
    }
    var APPS = [
        { id: "apps", label: "Apps", href: "/apps.html", icon: ico('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/>') },
        { id: "ai", label: "AI", href: "/ai.html", icon: ico('<path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/><path d="M20 3v4"/><path d="M22 5h-4"/><path d="M4 17v2"/><path d="M5 18H3"/>') },
        { id: "code", label: "Code", href: "/code.html", icon: ico('<polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/>') },
        { id: "tools", label: "Tools", href: "/tools.html", icon: ico('<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>') },
        { id: "vms", label: "VMs", href: "/vms.html", icon: ico('<rect x="2" y="3" width="20" height="14"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>') },
        { id: "movies", label: "Movies", href: "/films.html", icon: ico('<rect x="3" y="4" width="18" height="16"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="3" y1="15" x2="21" y2="15"/><line x1="8" y1="4" x2="8" y2="20"/><line x1="16" y1="4" x2="16" y2="20"/>') },
        { id: "music", label: "Music", href: "/music.html", icon: ico('<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>') },
        { id: "youtube", label: "YouTube", href: "/youtube.html", icon: ico('<rect x="2.5" y="5" width="19" height="14"/><path d="m10 15 5-3-5-3z"/>') },
        { id: "games", label: "Games", href: "/games.html", icon: ico('<path d="M6 11h4M8 9v4"/><path d="M15 12h.01"/><path d="M18 10h.01"/><rect x="2" y="6" width="20" height="12"/>') },
        { id: "chat", label: "Chat", href: "/chat.html", icon: ico('<path d="M21 4H3v13h5v4l5-4h8z"/>') },
        { id: "voice", label: "Voice", href: "/voice.html", icon: ico('<rect x="9" y="1" width="6" height="11"/><path d="M5 10a7 7 0 0 0 14 0"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="8" y1="23" x2="16" y2="23"/>') },
        { id: "linkcheck", label: "Link checker", href: "/linkcheck.html", icon: ico('<path d="M12 2 4 5v6c0 5 3.4 9.4 8 11 4.6-1.6 8-6 8-11V5z"/><path d="m9 12 2 2 4-4"/>') }
    ];
    var BY_ID = {};
    APPS.forEach(function (a) { BY_ID[a.id] = a; });
    var PIN_ICON = ico('<path d="M12 17v5"/><path d="M9 10.76V6h6v4.76L17 14H7z"/><path d="M8 6V3h8v3"/>');

    var USE_KEY = "nocturne-app-usage", PIN_KEY = "nocturne-app-pins";
    function load(k, d) { try { var v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch (e) { return d; } }
    function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

    var usage = load(USE_KEY, {});
    var pinned = (load(PIN_KEY, []) || []).filter(function (id) { return BY_ID[id]; }).slice(0, 10);

    var pinsEl = document.getElementById("sbPins");
    var listEl = document.getElementById("sbAppList");
    var moreBtn = document.getElementById("sbMoreBtn");
    var moreCount = document.getElementById("sbMoreCount");
    var moreEl = document.getElementById("sbMore");
    var appsEl = document.getElementById("sbApps");
    var head = strip.querySelector(".sb-head");
    var foot = strip.querySelector(".sb-foot");

    var ROW = 36;          // 34px row + 2px gap
    var TAB_MIN = 150;     // space the tab list is always allowed to keep
    var CHROME = 44;       // apps label and section padding

    function appRow(a, menu) {
        return '<div class="sb-app-row"><a class="sb-app" href="' + a.href + '" data-app="' + a.id + '" data-tip="' + a.label + '"' +
            (menu ? ' role="menuitem"' : "") + ">" + a.icon + '<span class="sb-app-label">' + a.label + "</span></a>" +
            '<button type="button" class="sb-pin-btn" tabindex="-1" aria-hidden="true" data-pin="' + a.id + '" title="Pin to top">' + PIN_ICON + "</button></div>";
    }

    function renderPins() {
        if (!pinsEl) return;
        pinsEl.hidden = pinned.length === 0;
        pinsEl.innerHTML = pinned.map(function (id) {
            var a = BY_ID[id];
            return '<a class="sb-pin" href="' + a.href + '" data-app="' + a.id + '" data-tip="' + a.label + '" aria-label="' + a.label + '">' + a.icon + "</a>";
        }).join("");
    }

    var FEATURED = ["ai", "vms", "music", "games", "chat"];
    function ranked() {
        return APPS.filter(function (a) { return pinned.indexOf(a.id) < 0; })
            .map(function (a, i) { return { a: a, i: i, n: usage[a.id] || 0 }; })
            .sort(function (x, y) {
                var xi = FEATURED.indexOf(x.a.id), yi = FEATURED.indexOf(y.a.id);
                if (xi < 0) xi = FEATURED.length;
                if (yi < 0) yi = FEATURED.length;
                return xi - yi || y.n - x.n || x.i - y.i;
            })
            .map(function (r) { return r.a; });
    }

    var hiddenApps = [];

    function layoutApps() {
        if (!listEl) return;
        var rest = ranked();
        var avail = strip.clientHeight - (head ? head.offsetHeight : 0) - (pinsEl && !pinsEl.hidden ? pinsEl.offsetHeight : 0) -
            (foot ? foot.offsetHeight : 0) - TAB_MIN - CHROME;
        var capacity = Math.floor((avail + 2) / ROW);
        var show = Math.min(5, capacity >= rest.length ? rest.length : Math.max(0, capacity - 1));
        var visible = rest.slice(0, show);
        hiddenApps = rest.slice(show);
        var order = APPS.filter(function (a) { return visible.indexOf(a) >= 0; });
        var html = order.map(function (a) { return appRow(a, false); }).join("");
        if (listEl.dataset.sig !== html) { listEl.dataset.sig = html; listEl.innerHTML = html; }
        if (moreBtn) {
            moreBtn.hidden = hiddenApps.length === 0;
            if (moreCount) moreCount.textContent = hiddenApps.length ? String(hiddenApps.length) : "";
            moreBtn.dataset.tip = "More apps";
        }
        if (!hiddenApps.length) closeMore(true);
    }

    var layoutRaf = 0;
    function scheduleLayout() {
        if (layoutRaf) return;
        layoutRaf = requestAnimationFrame(function () { layoutRaf = 0; layoutApps(); });
    }

    function refresh() { renderPins(); layoutApps(); }

    /* ---------- more menu ---------- */

    var moreOpen = false;

    function placeMore() {
        var r = moreBtn.getBoundingClientRect();
        var s = strip.getBoundingClientRect();
        moreEl.style.left = Math.round(s.right + 6) + "px";
        moreEl.style.bottom = Math.max(12, Math.round(innerHeight - r.bottom)) + "px";
        moreEl.style.maxHeight = Math.max(120, Math.round(r.bottom - 12)) + "px";
    }

    function moreItems() { return Array.prototype.slice.call(moreEl.querySelectorAll(".sb-app")); }

    function onMoreKey(e) {
        if (e.key === "Escape") { e.preventDefault(); closeMore(false, true); return; }
        if (e.key === "Tab") { closeMore(true); return; }
        var items = moreItems();
        var i = items.indexOf(document.activeElement);
        var n = -1;
        if (e.key === "ArrowDown") n = (i + 1) % items.length;
        else if (e.key === "ArrowUp") n = (i - 1 + items.length) % items.length;
        else if (e.key === "Home") n = 0;
        else if (e.key === "End") n = items.length - 1;
        if (n >= 0) { e.preventDefault(); items[n].focus(); }
    }
    function onMoreDown(e) {
        if (!moreEl.contains(e.target) && !moreBtn.contains(e.target)) closeMore(true);
    }

    function openMore() {
        if (moreOpen || !hiddenApps.length) return;
        moreOpen = true;
        moreEl.innerHTML = hiddenApps.map(function (a) { return appRow(a, true); }).join("");
        placeMore();
        var m = motion();
        if (m) m.reveal(moreEl); else moreEl.hidden = false;
        moreBtn.setAttribute("aria-expanded", "true");
        document.addEventListener("keydown", onMoreKey, true);
        document.addEventListener("mousedown", onMoreDown, true);
        window.addEventListener("resize", onMoreResize);
        window.addEventListener("blur", onMoreResize);   // a click inside a page frame never reaches this document
        var first = moreEl.querySelector(".sb-app");
        if (first) first.focus();
    }
    function onMoreResize() { closeMore(true); }

    function closeMore(skipFocus, restoreFocus) {
        if (!moreOpen) return;
        moreOpen = false;
        moreBtn.setAttribute("aria-expanded", "false");
        document.removeEventListener("keydown", onMoreKey, true);
        document.removeEventListener("mousedown", onMoreDown, true);
        window.removeEventListener("resize", onMoreResize);
        window.removeEventListener("blur", onMoreResize);
        var m = motion();
        if (m) m.conceal(moreEl); else moreEl.hidden = true;
        if (restoreFocus && !skipFocus) moreBtn.focus();
    }

    if (moreBtn) moreBtn.addEventListener("click", function () { moreOpen ? closeMore(false, true) : openMore(); });

    /* ---------- pinning, usage, context menu ---------- */

    function togglePin(id) {
        var i = pinned.indexOf(id);
        if (i >= 0) pinned.splice(i, 1);
        else if (pinned.length < 10) pinned.push(id);
        save(PIN_KEY, pinned);
        closeMore(true);
        refresh();
    }

    function onAppClick(e) {
        var pin = e.target.closest("[data-pin]");
        if (pin) { e.preventDefault(); e.stopPropagation(); togglePin(pin.dataset.pin); return; }
        var a = e.target.closest("[data-app]");
        if (!a) return;
        usage[a.dataset.app] = (usage[a.dataset.app] || 0) + 1;
        save(USE_KEY, usage);
        if (moreOpen) closeMore(true);
    }
    strip.addEventListener("click", onAppClick, true);
    moreEl.addEventListener("click", onAppClick, true);

    var ctxMenu = null, ctxOff = null;
    function closeCtx() {
        if (ctxOff) ctxOff();
        ctxOff = null;
        if (ctxMenu) ctxMenu.remove();
        ctxMenu = null;
    }
    function onAppContext(e) {
        var a = e.target.closest("[data-app]");
        if (!a) return;
        e.preventDefault();
        closeCtx();
        var id = a.dataset.app, isPinned = pinned.indexOf(id) >= 0;
        var m = document.createElement("div");
        m.className = "tab-menu";
        m.setAttribute("role", "menu");
        var b = document.createElement("button");
        b.type = "button";
        b.setAttribute("role", "menuitem");
        b.textContent = isPinned ? "Unpin from top" : "Pin to top";
        b.disabled = !isPinned && pinned.length >= 10;
        b.addEventListener("click", function () { closeCtx(); togglePin(id); });
        m.appendChild(b);
        document.body.appendChild(m);
        var x = e.clientX, y = e.clientY;
        if (!x && !y) { var r = a.getBoundingClientRect(); x = r.left + 16; y = r.bottom; }
        var rr = m.getBoundingClientRect();
        m.style.left = Math.max(8, Math.min(x, innerWidth - rr.width - 8)) + "px";
        m.style.top = Math.max(8, Math.min(y, innerHeight - rr.height - 8)) + "px";
        b.focus();
        ctxMenu = m;
        var down = function (ev) { if (!m.contains(ev.target)) closeCtx(); };
        var key = function (ev) { if (ev.key === "Escape") { ev.preventDefault(); closeCtx(); a.focus(); } };
        document.addEventListener("mousedown", down, true);
        document.addEventListener("keydown", key, true);
        window.addEventListener("blur", closeCtx);
        ctxOff = function () { document.removeEventListener("mousedown", down, true); document.removeEventListener("keydown", key, true); window.removeEventListener("blur", closeCtx); };
    }
    strip.addEventListener("contextmenu", onAppContext);
    moreEl.addEventListener("contextmenu", onAppContext);

    /* ---------- tooltips ---------- */

    var tip = document.createElement("div");
    tip.className = "sb-tip";
    tip.setAttribute("role", "tooltip");
    document.body.appendChild(tip);
    var tipFor = null, tipTimer = 0;

    function hideTip() { clearTimeout(tipTimer); tipFor = null; tip.classList.remove("visible"); }

    function showTip(el) {
        var title = el.querySelector(".tab-title");
        var text = (title && title.textContent) || el.dataset.tip;
        if (!text || mobile.matches) return;
        var needed = isCollapsed() || el.classList.contains("tab-pin") || el.classList.contains("sb-pin") || el.hasAttribute("data-tip-always");
        if (!needed && title) needed = title.scrollWidth > title.clientWidth;
        if (!needed) return;
        tip.textContent = text;
        tip.style.left = "0px";
        tip.style.top = "0px";
        tip.classList.add("visible");
        var r = el.getBoundingClientRect();
        var t = tip.getBoundingClientRect();
        tip.style.left = Math.round(r.right + 10) + "px";
        tip.style.top = Math.round(Math.max(6, Math.min(innerHeight - t.height - 6, r.top + (r.height - t.height) / 2))) + "px";
    }

    strip.addEventListener("mouseover", function (e) {
        var el = e.target.closest("[data-tip]");
        if (!el || el === tipFor) return;
        hideTip();
        tipFor = el;
        tipTimer = setTimeout(function () { showTip(el); }, 320);
    });
    strip.addEventListener("mouseout", function (e) {
        var el = e.target.closest("[data-tip]");
        if (el && el.contains(e.relatedTarget)) return;
        hideTip();
    });
    strip.addEventListener("focusin", function (e) {
        var el = e.target.closest("[data-tip]");
        if (el) { tipFor = el; showTip(el); }
    });
    strip.addEventListener("focusout", hideTip);
    strip.addEventListener("click", hideTip);
    strip.addEventListener("dragstart", hideTip);
    strip.addEventListener("contextmenu", hideTip);

    /* ---------- boot ---------- */

    refresh();
    sync();
    if (window.ResizeObserver) new ResizeObserver(scheduleLayout).observe(strip);
    else window.addEventListener("resize", scheduleLayout);
}();
