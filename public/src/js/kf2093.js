import { _c3y, _a6t } from "/app/main.mjs";
import { initPerformance } from "/src/js/ao2588.js";
import { mountLoader } from "/src/js/fo7942.js";
import { wireHoverPrefetch, prefetchedUrl } from "/src/js/gs9147.js";
import { listCloaks, applyCloak, restoreCloak, reset as resetCloak } from "/src/js/mp4275.js";

const frameStack = document.getElementById("frameStack");

function ensureTabIframe(tab) {
    if (!tab) return null;
    if (tab._iframeId) {
        const existing = document.getElementById(tab._iframeId);
        if (existing) return existing;
    }
    const id = "frame-" + tab.id;
    let el = document.getElementById(id);
    if (!el) {
        el = document.createElement("iframe");
        el.id = id;
        el.className = "tab-frame";
        el.title = "Nocturne";
        frameStack.appendChild(el);
    }
    tab._iframeId = id;
    return el;
}

function getActiveFrame() {
    return ensureTabIframe(activeTab());
}

function showActiveFrame(visible) {
    document.querySelectorAll(".tab-frame.active").forEach(f => {
        if (f.id !== "frame-" + (activeTabId || "")) {
            f.classList.remove("active", "visible");
        }
    });
    const f = getActiveFrame();
    if (!f) return;
    f.classList.add("active");
    f.classList.toggle("visible", !!visible);
}

const frame = new Proxy({}, {
    get(_, prop) {
        const f = getActiveFrame();
        if (!f) return undefined;
        const v = f[prop];
        return typeof v === "function" ? v.bind(f) : v;
    },
    set(_, prop, value) {
        const f = getActiveFrame();
        if (!f) return false;
        f[prop] = value;
        return true;
    }
});
const toolbar = document.getElementById("toolbar");
const homePage = document.getElementById("homePage");
const errorPage = document.getElementById("errorPage");
const errDetail = document.getElementById("errDetail");

const searchForm = document.getElementById("searchForm");
const searchHome = document.getElementById("searchHome");
const searchSuggest = document.getElementById("searchSuggest");
const urlBar = document.getElementById("urlBar");
const navRail = document.getElementById("navRail");

const settingsPanel = document.getElementById("settingsPanel");
const dockHome = document.getElementById("dockHome");
const dockSettings = document.getElementById("dockSettings");

const fxToggle = document.getElementById("fxToggle");
const cloakSelect = document.getElementById("cloakSelect");
const engineSelect = document.getElementById("engineSelect");

const btnBack = document.getElementById("btnBack");
const btnFwd  = document.getElementById("btnFwd");

(function shimUrlBar() {
    const el = urlBar;
    if (!el || el.tagName !== "DIV") return;
    Object.defineProperty(el, "value", {
        get() { return this.textContent || ""; },
        set(v) { this.textContent = String(v == null ? "" : v); },
        configurable: true
    });
    Object.defineProperty(el, "placeholder", {
        get() { return this.getAttribute("data-placeholder") || ""; },
        set(v) { this.setAttribute("data-placeholder", String(v == null ? "" : v)); },
        configurable: true
    });
    el.select = function() {
        try {
            const range = document.createRange();
            range.selectNodeContents(this);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
        } catch {}
    };
    el.addEventListener("paste", e => {
        e.preventDefault();
        const text = (e.clipboardData || window.clipboardData)?.getData("text") || "";
        const cleaned = text.replace(/[\r\n]+/g, " ").trim();
        document.execCommand("insertText", false, cleaned);
    });
    el.addEventListener("drop", e => e.preventDefault());
})();

const loader = mountLoader(document.getElementById("lineLoader"));

const ENGINES = {
    duckduckgo: { label: "DuckDuckGo", url: q => "https://duckduckgo.com/?q=" + encodeURIComponent(q) },
    google:     { label: "Google",     url: q => "https://www.google.com/search?q=" + encodeURIComponent(q) },
    bing:       { label: "Bing",       url: q => "https://www.bing.com/search?q=" + encodeURIComponent(q) },
    brave:      { label: "Brave",      url: q => "https://search.brave.com/search?q=" + encodeURIComponent(q) },
    startpage:  { label: "Startpage",  url: q => "https://www.startpage.com/do/search?q=" + encodeURIComponent(q) }
};

const BLOCKED_DOMAINS = [
    "fmovies.to", "fmovies.wtf", "fmoviesz.to", "123movies.net",
    "123moviesfree.net", "putlocker.sb", "putlockers.so",
    "gomovies.sx", "gomovies.to", "soap2day.to", "soap2day.rs", "soap2day.tf",
    "vumoo.mx", "himovies.to", "watchseries.video", "bmovies.to",
    "9anime.to", "9anime.tv", "zoro.to", "aniwatch.to",
    "gogoanime.io", "gogoanime.tv", "gogoanime.so",
    "bflix.to", "dopebox.to", "lookmovie.io", "lookmovie2.to", "sflix.to",
    "thepiratebay.org", "thepiratebay.se", "1337x.to", "1337x.tw", "1337x.st",
    "rarbg.to", "rarbgprx.org", "yts.mx", "yts.rs", "yts.am",
    "limetorrents.com", "limetorrents.info", "torrentgalaxy.to",
    "fitgirl-repacks.site", "nyaa.si", "sukebei.nyaa.si",
    "kickasstorrents.to", "kickass.sx", "kat.cr", "extratorrent.cc",
    "eztv.re", "eztv.ag",
    "cracked.to", "cracked.io", "nulled.to", "nulled.io", "warez-bb.org",
    "skidrow-games.net", "crackwatch.com",
    "bestgore.com", "documentingreality.com", "kaotic.com", "theync.com",
    "vidmax.com", "liveleak.com",
    "silkroadmarket.org", "dreammarket.to", "darkfailllnkf4vf.onion",
    "4chan.org", "8kun.top", "kiwifarms.net", "rumble.com", "telegram.org"
];

const BLOCKED_KEYWORDS = [
    "cocaine", "heroin", "fentanyl", "methamphetamine", "meth",
    "mdma", "ecstasy", "molly", "lsd", "dmt", "ketamine",
    "crystal meth", "crack cocaine",
    "pirate bay", "piratebay", "1337x", "yts.mx", "fmovies", "123movies",
    "warez", "nulled", "keygen", "serial key",
    "silk road", "darknet market", "dark web market",
    "neilkohlitest", "inappropriate"
];

function checkBlocked(input) {
    const raw = (input || "").trim();
    if (!raw) return null;
    const lower = raw.toLowerCase();

    let host = "";
    try {
        const u = new URL(/^https?:\/\//i.test(raw) ? raw : "https://" + raw);
        host = u.hostname.replace(/^www\./, "");
    } catch {}
    if (host) {
        for (const d of BLOCKED_DOMAINS) {
            if (host === d || host.endsWith("." + d)) return "site";
        }
    }

    for (const k of BLOCKED_KEYWORDS) {
        const re = new RegExp("\\b" + k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "\\b", "i");
        if (re.test(lower)) return "keyword";
    }
    return null;
}

let currentEngine = localStorage.getItem("nocturne-engine") || "duckduckgo";
let lastURL = "";
let loadWatchdog = null;

const TABS_STORAGE = "nocturne-tabs";
const TABS_LAST = "nocturne-tabs-last";
const tabStripEl = document.getElementById("tabStrip");
const tabListEl = document.getElementById("tabList");
const tabAddBtn = document.getElementById("tabAdd");
let tabs = [];
let activeTabId = null;
let suppressTabSync = false;
let enteringTabId = null;
let activatingTabId = null;

function uid() { return Math.random().toString(36).slice(2, 10); }

function loadTabs() {
    try {
        const raw = localStorage.getItem(TABS_STORAGE);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed.tabs)) return;
        tabs = parsed.tabs.map(t => ({
            id: t.id || uid(),
            title: t.title || "",
            url: t.url || "",
            navStack: Array.isArray(t.navStack) ? t.navStack : (t.url ? [t.url] : []),
            navIndex: typeof t.navIndex === "number" ? t.navIndex : (t.url ? 0 : -1),
            ...(t._internal ? { _internal: true, _slug: t._slug || "" } : {})
        }));
        activeTabId = parsed.activeTabId || (tabs[0] && tabs[0].id) || null;
    } catch {}
}

function saveTabs() {
    try {
        const slim = tabs.map(({ _iframeId, ...rest }) => rest);
        localStorage.setItem(TABS_STORAGE, JSON.stringify({ tabs: slim, activeTabId }));
    } catch {}
}

function activeTab() { return tabs.find(t => t.id === activeTabId) || null; }

function ensureAtLeastOneTab() {
    if (tabs.length === 0) {
        const t = { id: uid(), title: "New tab", url: "", navStack: [], navIndex: -1 };
        tabs.push(t);
        activeTabId = t.id;
    }
}

function renderTabs() {
    if (!tabListEl) return;
    const showClose = tabs.length > 1;
    tabListEl.innerHTML = tabs.map(t => {
        const cls = ["tab-item"];
        if (t.id === activeTabId) cls.push("active");
        if (t.id === enteringTabId) cls.push("tab-enter");
        else if (t.id === activatingTabId) cls.push("tab-activate");
        const fav = t._internal
            ? `<img class="tab-favicon" src="${NOC_FAVICON}" alt="">`
            : t.url
            ? `<img class="tab-favicon" src="${faviconFor(t.url)}" alt="" loading="lazy" onerror="this.classList.add('tf-hide')">`
            : `<span class="tab-favicon tab-favicon-blank"></span>`;
        const close = showClose
            ? `<button class="tab-close" data-tab-close="${t.id}" aria-label="Close tab"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>`
            : "";
        return `
        <div class="${cls.join(" ")}" data-tab-id="${t.id}">
            ${fav}
            <span class="tab-title">${escapeHtml(t.title || (t.url ? hostFromUrl(t.url) : "New tab"))}</span>
            ${close}
        </div>`;
    }).join("");
    if (tabAddBtn) tabListEl.appendChild(tabAddBtn);
    tabStripEl?.classList.toggle("visible", tabs.length > 0);
    const focusTabId = enteringTabId || activatingTabId;
    if (focusTabId) {
        const el = tabListEl.querySelector(`[data-tab-id="${focusTabId}"]`);
        if (el && el.scrollIntoView) el.scrollIntoView({ behavior: "smooth", inline: "nearest", block: "nearest" });
    }
    enteringTabId = null;
    activatingTabId = null;
}

function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function hostFromUrl(u) {
    try { return new URL(u).hostname.replace(/^www\./, ""); } catch { return u; }
}

function faviconFor(u) {
    try {
        const h = new URL(u).hostname;
        return "https://www.google.com/s2/favicons?domain=" + encodeURIComponent(h) + "&sz=64";
    } catch { return ""; }
}

const NOC_FAVICON = "data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='9' fill='%230b0a14'/><circle cx='16' cy='16' r='9' fill='%23c9c1ff'/><circle cx='21' cy='14' r='8' fill='%230b0a14'/></svg>";

const PAGE_SLUGS = {
    g: { path: "/games.html", title: "Games" },
    games: { path: "/games.html", title: "Games" },
    apps: { path: "/apps.html", title: "Apps" },
    chat: { path: "/chat.html", title: "Chat" },
    vms: { path: "/vms.html", title: "VMs" },
    vm: { path: "/vms.html", title: "VMs" },
    ai: { path: "/ai.html", title: "AI" },
    movies: { path: "/films.html", title: "Movies" },
    films: { path: "/films.html", title: "Movies" },
    music: { path: "/music.html", title: "Music" },
    tools: { path: "/tools.html", title: "Tools" },
    code: { path: "/code.html", title: "Code" },
    editor: { path: "/code.html", title: "Code" },
    youtube: { path: "/youtube.html", title: "YouTube" },
    yt: { path: "/youtube.html", title: "YouTube" },
    settings: { path: "/settings.html", title: "Settings" },
    account: { path: "/account.html", title: "Account" },
    privacy: { path: "/privacy.html", title: "Privacy" },
    terms: { path: "/terms.html", title: "Terms" },
    dmca: { path: "/dmca.html", title: "DMCA" },
    legal: { path: "/legal.html", title: "Legal" },
    linkcheck: { path: "/linkcheck.html", title: "Link Checker" },
    links: { path: "/linkcheck.html", title: "Link Checker" }
};
function matchSlug(input) {
    const v = (input || "").trim().toLowerCase();
    if (!v.startsWith("/")) return null;
    const key = v.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.html$/, "");
    const cfg = PAGE_SLUGS[key];
    return cfg ? { slug: key, ...cfg } : null;
}

function frameTitle(f) {
    try {
        const doc = (f || getActiveFrame())?.contentDocument;
        const tt = doc && doc.title ? doc.title.trim() : "";
        return tt;
    } catch { return ""; }
}

function syncTabTitle(f) {
    const t = activeTab();
    if (!t || t._internal) return;
    const want = frameTitle(f) || (t.url ? hostFromUrl(t.url) : "New tab");
    if (!want || want === t.title) return;
    t.title = want;
    saveTabs();
    const el = tabListEl && tabListEl.querySelector(`[data-tab-id="${t.id}"] .tab-title`);
    if (el) el.textContent = want;
    else renderTabs();
}

function syncActiveTab(url) {
    if (suppressTabSync) return;
    const t = activeTab();
    if (!t) return;
    t.url = url || "";
    t.title = url ? hostFromUrl(url) : "New tab";
    if (!url) { delete t._internal; delete t._slug; }
    saveTabs();
    renderTabs();
}

function newTab() {
    const t = { id: uid(), title: "New tab", url: "", navStack: [], navIndex: -1 };
    tabs.push(t);
    activeTabId = t.id;
    enteringTabId = t.id;
    saveTabs();
    renderTabs();
    suppressTabSync = true;
    showHome(false);
    suppressTabSync = false;
}

function switchTab(id) {
    if (id === activeTabId) return;
    const t = tabs.find(x => x.id === id);
    if (!t) return;
    activeTabId = id;
    activatingTabId = id;
    saveTabs();
    renderTabs();
    suppressTabSync = true;
    presentTab(t);
    suppressTabSync = false;
}

function internalSlugFor(path) {
    const clean = (path || "").split("?")[0].split("#")[0];
    for (const [slug, cfg] of Object.entries(PAGE_SLUGS)) {
        if (cfg.path === clean) return "/" + slug;
    }
    return clean || "/";
}

function trackInternalNav(t, f) {
    if (!t || !t._internal) return;
    let path;
    try { path = f.contentWindow.location.pathname + f.contentWindow.location.search; }
    catch { return; }
    if (!path) return;
    if (t._navving) {
        t._navving = false;
    } else if (path !== t.navStack[t.navIndex]) {
        t.navStack = t.navStack.slice(0, t.navIndex + 1);
        t.navStack.push(path);
        t.navIndex = t.navStack.length - 1;
    }
    t.url = path;
    f.dataset.currentUrl = path;
    if (t.id === activeTabId) {
        urlBar.value = internalSlugFor(path);
        lastURL = path;
        updateNavButtons();
    }
    saveTabs();
}

function internalNavTo(t, path) {
    const f = ensureTabIframe(t);
    if (!f) return;
    t._navving = true;
    t.url = path;
    f.dataset.currentUrl = path;
    f.dataset.targetUrl = path;
    try { f.src = path; } catch { f.setAttribute("src", path); }
    urlBar.value = internalSlugFor(path);
    lastURL = path;
    saveTabs();
}

function presentInternal(t, f) {
    clearWatchdog();
    stopFrameUrlPoller();
    errorPage.classList.remove("visible");
    toolbar.classList.add("visible");
    homePage.style.display = "none";
    enterBrowsing();
    if (!Array.isArray(t.navStack) || !t.navStack.length) { t.navStack = [t.url]; t.navIndex = 0; }
    f.onload = () => trackInternalNav(t, f);
    const want = t.url;
    if (f.dataset.currentUrl !== want || !f.src || f.src === "about:blank") {
        f.dataset.targetUrl = want;
        f.dataset.currentUrl = want;
        try { f.src = want; } catch { f.setAttribute("src", want); }
    }
    urlBar.value = internalSlugFor(want);
    lastURL = want;
    try { loader.finish(); } catch {}
    showActiveFrame(true);
    updateNavButtons();
}

function openInternalTab(cfg) {

    hideRestoreChip();

    const existing = tabs.find(t => t._internal && (t.url || "").split("?")[0] === cfg.path);
    if (existing) { switchTab(existing.id); return; }

    const cur = activeTab();
    if (cur && !cur.url && !cur._internal) {
        cur._internal = true;
        cur._slug = cfg.slug;
        cur.title = cfg.title;
        cur.url = cfg.path;
        cur.navStack = [];
        cur.navIndex = -1;
        enteringTabId = cur.id;
        saveTabs();
        renderTabs();
        suppressTabSync = true;
        presentTab(cur);
        suppressTabSync = false;
        return;
    }
    const t = { id: uid(), title: cfg.title, url: cfg.path, _internal: true, _slug: cfg.slug, navStack: [], navIndex: -1 };
    tabs.push(t);
    activeTabId = t.id;
    enteringTabId = t.id;
    saveTabs();
    renderTabs();
    suppressTabSync = true;
    presentTab(t);
    suppressTabSync = false;
}

function openInternalByPath(rawPath) {
    const clean = (rawPath || "").split("?")[0].split("#")[0];
    if (!clean || clean === "/") return false;
    const existing = tabs.find(t => t._internal && (t.url || "").split("?")[0] === clean);
    if (existing) { switchTab(existing.id); return true; }
    const entry = Object.entries(PAGE_SLUGS).find(([, c]) => c.path === clean);
    if (entry) { openInternalTab({ slug: entry[0], ...entry[1] }); return true; }
    const base = clean.replace(/^\//, "").replace(/\.html$/, "") || "page";
    openInternalTab({ slug: "", path: clean, title: base.charAt(0).toUpperCase() + base.slice(1) });
    return true;
}
window.__nocOpenInternalPage = openInternalByPath;

window.__nocOpenUrl = function (raw, newTab) {
    const slug = matchSlug(raw);
    if (slug) { openInternalTab(slug); return; }
    moderatedSearch(raw, () => {
        const url = parseInput(raw);
        if (!url) return;
        if (newTab) loadInNewTab(url); else load(url);
    });
};

function presentTab(t) {
    if (!t) return;
    const f = ensureTabIframe(t);
    if (t._internal && t.url) {
        presentInternal(t, f);
        return;
    }
    if (t.url) {
        const alreadyLoaded = f.src && f.src !== "about:blank" && f.dataset.targetUrl === t.url;
        if (!alreadyLoaded) {
            load(t.url, false);
        } else {
            errorPage.classList.remove("visible");
            toolbar.classList.add("visible");
            homePage.style.display = "none";
            enterBrowsing();
            const displayUrl = f.dataset.currentUrl || t.url;
            urlBar.value = displayUrl;
            lastURL = displayUrl;
            showActiveFrame(true);
            stopFrameUrlPoller();
            startFrameUrlPoller();
            updateNavButtons();
        }
    } else {
        showHome(false);
    }
}

function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx < 0) return;
    const closing = tabs[idx];
    if (closing._iframeId) {
        const el = document.getElementById(closing._iframeId);
        if (el) el.remove();
    }
    tabs.splice(idx, 1);
    if (activeTabId === id) {
        activeTabId = (tabs[idx] || tabs[idx - 1] || tabs[0])?.id || null;
        activatingTabId = activeTabId;
        saveTabs();
        renderTabs();
        if (tabs.length === 0) {
            newTab();
        } else {
            const t = activeTab();
            suppressTabSync = true;
            presentTab(t);
            suppressTabSync = false;
        }
        return;
    }
    saveTabs();
    renderTabs();
}

function animateCloseTab(id) {
    const el = tabListEl && tabListEl.querySelector(`[data-tab-id="${id}"]`);
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (!el || reduce || tabs.length <= 1) { closeTab(id); return; }
    el.classList.add("tab-closing");
    let done = false;
    const finish = () => { if (done) return; done = true; closeTab(id); };
    el.addEventListener("animationend", finish, { once: true });
    setTimeout(finish, 300);
}

tabAddBtn?.addEventListener("click", () => newTab());
tabListEl?.addEventListener("click", e => {
    const closeBtn = e.target.closest("[data-tab-close]");
    if (closeBtn) {
        e.stopPropagation();
        animateCloseTab(closeBtn.dataset.tabClose);
        return;
    }
    const item = e.target.closest("[data-tab-id]");
    if (item) switchTab(item.dataset.tabId);
});

document.addEventListener("click", e => {
    const a = e.target.closest("a[href]");
    if (!a) return;
    if (a.getAttribute("target") === "_blank" || a.dataset.noOverlay === "1") return;
    const href = a.getAttribute("href");
    if (!href || href === "/" || href.startsWith("http")) return;
    const slug = matchSlug(href);
    if (slug) {
        e.preventDefault();
        openInternalTab(slug);
    }
});

function mapStoredTabs(arr) {
    return (Array.isArray(arr) ? arr : []).map(t => ({
        id: t.id || uid(),
        title: t.title || "",
        url: t.url || "",
        navStack: Array.isArray(t.navStack) ? t.navStack : (t.url ? [t.url] : []),
        navIndex: typeof t.navIndex === "number" ? t.navIndex : (t.url ? 0 : -1),
        ...(t._internal ? { _internal: true, _slug: t._slug || "" } : {})
    }));
}

function snapshotRestorable(parsed) {
    if (!parsed || !Array.isArray(parsed.tabs)) return false;
    if (parsed.tabs.length > 1) return true;
    return parsed.tabs.some(t => t && (t.url || t._internal));
}

let _restoreAvailable = false;
function initTabsFresh() {

    let prev = null;
    try { prev = JSON.parse(localStorage.getItem(TABS_STORAGE) || "null"); } catch {}
    if (snapshotRestorable(prev)) {
        try { localStorage.setItem(TABS_LAST, JSON.stringify(prev)); } catch {}
    }
    let last = null;
    try { last = JSON.parse(localStorage.getItem(TABS_LAST) || "null"); } catch {}
    _restoreAvailable = snapshotRestorable(last);
    tabs = [];
    activeTabId = null;
    ensureAtLeastOneTab();
    saveTabs();
}

let _restoreChip = null;
function buildRestoreChip() {
    if (_restoreChip) return _restoreChip;
    const wrap = document.createElement("div");
    wrap.className = "noc-restore-chip";
    wrap.innerHTML =
        '<button type="button" class="nrc-main"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg><span>Restore last state</span></button>' +
        '<button type="button" class="nrc-x" aria-label="Dismiss"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>';
    wrap.querySelector(".nrc-main").addEventListener("click", restoreLastState);
    wrap.querySelector(".nrc-x").addEventListener("click", dismissRestore);
    document.body.appendChild(wrap);
    _restoreChip = wrap;
    return wrap;
}
function showRestoreChip() {
    const c = buildRestoreChip();
    requestAnimationFrame(() => c.classList.add("visible"));
}
function hideRestoreChip() {
    if (_restoreChip) _restoreChip.classList.remove("visible");
}
function dismissRestore() {
    try { localStorage.removeItem(TABS_LAST); } catch {}
    _restoreAvailable = false;
    hideRestoreChip();
}
function restoreLastState() {
    let last = null;
    try { last = JSON.parse(localStorage.getItem(TABS_LAST) || "null"); } catch {}
    if (!snapshotRestorable(last)) { dismissRestore(); return; }
    document.querySelectorAll(".tab-frame").forEach(f => f.remove());
    tabs = mapStoredTabs(last.tabs);
    activeTabId = (last.activeTabId && tabs.some(t => t.id === last.activeTabId)) ? last.activeTabId : ((tabs[0] && tabs[0].id) || null);
    ensureAtLeastOneTab();
    saveTabs();
    renderTabs();
    const t = activeTab();
    suppressTabSync = true;
    if (t && (t.url || t._internal)) presentTab(t);
    else showHome(false);
    suppressTabSync = false;
    dismissRestore();
}

initTabsFresh();
renderTabs();
let slowToastTimer = null;
let slowCountdownTimer = null;
const slowToast = document.getElementById("slowToast");
const slowCountdown = document.getElementById("stCountdown");
const slowRetryBtn = document.getElementById("stRetry");

function hideSlowToast() {
    if (slowToastTimer) { clearTimeout(slowToastTimer); slowToastTimer = null; }
    if (slowCountdownTimer) { clearInterval(slowCountdownTimer); slowCountdownTimer = null; }
    if (slowToast) slowToast.classList.remove("visible");
}

function scheduleSlowToast(timeoutMs) {
    hideSlowToast();
    if (!slowToast || !slowCountdown) return;
    slowToastTimer = setTimeout(() => {
        let remaining = Math.ceil((timeoutMs - 5000) / 1000);
        slowCountdown.textContent = remaining;
        slowToast.classList.add("visible");
        slowCountdownTimer = setInterval(() => {
            remaining -= 1;
            if (remaining <= 0) { hideSlowToast(); return; }
            slowCountdown.textContent = remaining;
        }, 1000);
    }, 5000);
}

if (slowRetryBtn) {
    slowRetryBtn.addEventListener("click", () => {
        hideSlowToast();
        if (lastURL) load(lastURL, false);
    });
}

function obfuscate(url) {
    try { return btoa(url).replace(/=+$/, ""); }
    catch { return btoa(encodeURIComponent(url)).replace(/=+$/, ""); }
}
function deobfuscate(s) {
    try { return atob(s); }
    catch { try { return decodeURIComponent(atob(s)); } catch { return null; } }
}

function clearWatchdog() {
    if (loadWatchdog) { clearTimeout(loadWatchdog); loadWatchdog = null; }
    hideSlowToast();
}

function showError(detail) {
    clearWatchdog();
    stopFrameUrlPoller();
    loader.fail();
    frame.classList.remove("visible");
    errorPage.classList.add("visible");
    if (errDetail && detail) errDetail.textContent = detail;
}

function decodeFrameUrl(frEl) {
    try {
        const win = (frEl || getActiveFrame())?.contentWindow;
        if (!win) return null;
        const href = win.location.href;
        const path = win.location.pathname;
        if (path.startsWith("/rw/")) {
            const enc = path.slice(4).split("/")[0];
            const padded = enc.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((enc.length + 3) % 4);
            try { return atob(padded); } catch { return null; }
        }
        if (path.startsWith(atob("L3ZpZXcv"))) {
            try {
                const enc = decodeURIComponent(path.slice(6).split("/")[0]);
                let out = "";
                for (let i = 0; i < enc.length; i++) {
                    out += i % 2 ? String.fromCharCode(enc.charCodeAt(i) ^ 2) : enc[i];
                }
                return out;
            } catch { return null; }
        }
        const _scj = window["__scram" + "jet"];
        if (_scj && typeof _scj["dec" + "odeUrl"] === "function") {
            try { return _scj["dec" + "odeUrl"](href); } catch { return null; }
        }
        return null;
    } catch { return null; }
}

const HISTORY_KEY = "nocturne-history";
const HISTORY_MAX = 600;
function recordHistory(url, title) {
    if (!url || !/^https?:\/\//i.test(url)) return;
    try {
        const list = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]");
        const now = Date.now();
        const last = list[0];
        if (last && last.url === url) {
            last.ts = now;
            if (title && title.length) last.title = title;
        } else {
            list.unshift({ url, title: title || "", ts: now });
            if (list.length > HISTORY_MAX) list.length = HISTORY_MAX;
        }
        localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch {}
}

function syncUrlBarFromFrame() {
    const f = getActiveFrame();
    const real = decodeFrameUrl(f);
    if (real) {
        urlBar.value = real;
        lastURL = real;
        if (f) f.dataset.currentUrl = real;
        recordHistory(real, frameTitle(f));
    }
}

let frameUrlPoller = null;
let lastSyncedHref = "";
function startFrameUrlPoller() {
    stopFrameUrlPoller();
    lastSyncedHref = "";
    frameUrlPoller = setInterval(() => {
        try {
            const f = getActiveFrame();
            const href = f?.contentWindow?.location.href;
            if (href && href !== lastSyncedHref) {
                lastSyncedHref = href;
                syncUrlBarFromFrame();
            }
            syncTabTitle(f);
        } catch {}
    }, 600);
}
function stopFrameUrlPoller() {
    if (frameUrlPoller) { clearInterval(frameUrlPoller); frameUrlPoller = null; }
}

function finishLoad() {
    finishLoadFor(getActiveFrame(), activeTab(), activeTabId);
}

function finishLoadFor(f, t, tabIdAtStart) {
    if (!f) return;
    if (activeTabId === tabIdAtStart) clearWatchdog();
    try {
        const doc = f.contentDocument;
        if (doc) {
            const body = (doc.body && doc.body.innerText) || "";
            if (body.startsWith(atob("UHJveHkgZXJyb3I6"))) {
                if (activeTabId === tabIdAtStart) return showError(body.slice(0, 160));
                return;
            }
            if (body.startsWith(atob("U2VydmljZSB3b3JrZXIgbm90IGFjdGl2ZQ=="))) {
                if (activeTabId === tabIdAtStart) return showError("Session expired. Reload to recover.");
                return;
            }
        }
    } catch {}
    if (t && t.url) f.dataset.targetUrl = t.url;
    if (activeTabId === tabIdAtStart) {
        syncUrlBarFromFrame();
        syncTabTitle(f);
        startFrameUrlPoller();
        loader.finish();
        showActiveFrame(true);
    }
}

let railIntroTimer = null;
function enterBrowsing() {
    const wasHome = !document.body.classList.contains("browsing");
    document.body.classList.add("browsing");
    const internal = !!(activeTab() && activeTab()._internal);
    document.body.classList.toggle("internal-active", internal);
    if (wasHome && navRail && !internal) {
        navRail.classList.add("intro");
        clearTimeout(railIntroTimer);
        railIntroTimer = setTimeout(() => navRail.classList.remove("intro"), 1100);
    }
}
function exitBrowsing() {
    document.body.classList.remove("browsing");
    document.body.classList.remove("internal-active");
    if (navRail) navRail.classList.remove("intro");
    clearTimeout(railIntroTimer);
}

function showHome(pushHistory = true) {
    clearWatchdog();
    stopFrameUrlPoller();
    loader.fail();
    document.querySelectorAll(".tab-frame").forEach(f => f.classList.remove("visible"));
    toolbar.classList.remove("visible");
    exitBrowsing();
    homePage.style.display = "";
    errorPage.classList.remove("visible");
    if (pushHistory) history.pushState(null, "", "/");
    const t = activeTab();
    if (t) {
        t.navStack = [];
        t.navIndex = -1;
    }
    updateNavButtons();
    syncActiveTab("");
}

function updateNavButtons() {
    const t = activeTab();
    const idx = t ? t.navIndex : -1;
    const len = t ? t.navStack.length : 0;
    btnBack.disabled = idx <= 0;
    btnFwd.disabled  = idx >= len - 1;
}

async function load(url, addToHistory = true) {
    try {
        clearWatchdog();
        hideRestoreChip();
        try { window.__nocBanner && window.__nocBanner(); } catch {}

        if (checkBlocked(url)) {
            toolbar.classList.remove("visible");
            homePage.style.display = "none";
            return showError("This page is blocked by Nocturne policy. See the Terms of Service.");
        }

        try {
            const parsed = new URL(url);
            if (parsed.hostname === "localhost" || parsed.origin === location.origin) {
                return showError("Cannot open local addresses.");
            }
        } catch {}

        const targetTab = activeTab();
        const targetFrame = ensureTabIframe(targetTab);
        const tabIdAtStart = targetTab ? targetTab.id : null;

        lastURL = url;
        errorPage.classList.remove("visible");
        if (errDetail) errDetail.textContent = "";

        toolbar.classList.add("visible");
        homePage.style.display = "none";
        enterBrowsing();
        showActiveFrame(false);

        if (addToHistory) {
            if (targetTab) {
                targetTab.navStack = targetTab.navStack.slice(0, targetTab.navIndex + 1);
                targetTab.navStack.push(url);
                targetTab.navIndex = targetTab.navStack.length - 1;
                saveTabs();
            }
        }
        updateNavButtons();
        urlBar.value = url;
        loader.start();
        syncActiveTab(url);

        let proxied = prefetchedUrl(url);
        if (!proxied) {
            try { proxied = await _c3y(url); }
            catch (err) { return showError(err.message); }
        }

        loader.stage("loading");

        let loaded = false;
        targetFrame.dataset.targetUrl = url;
        targetFrame.dataset.currentUrl = url;
        targetFrame.onload = () => {
            loaded = true;
            loader.stage("rendering");
            setTimeout(() => finishLoadFor(targetFrame, targetTab, tabIdAtStart), 60);
        };
        targetFrame.onerror = () => {
            if (activeTabId === tabIdAtStart) showError("Failed to load page.");
        };
        await _a6t(targetFrame, url, proxied);

        setTimeout(() => {
            if (!loaded && activeTabId === tabIdAtStart) showActiveFrame(true);
        }, 1500);

        const watchdogMs = 25000;
        scheduleSlowToast(watchdogMs);
        loadWatchdog = setTimeout(() => {
            if (loaded) return;
            clearWatchdog();
            hideSlowToast();
            loader.finish();
            if (activeTabId === tabIdAtStart) targetFrame.classList.add("visible");
        }, watchdogMs);
    } catch (err) {
        showError(err.message || "Unknown error");
    }
}

function parseInput(value) {
    const v = (value || "").trim();
    if (!v) return null;
    if (/^https?:\/\//i.test(v)) return v;
    if (!v.includes(" ") && (v.includes(".") || v.startsWith("localhost"))) return "https://" + v;
    return ENGINES[currentEngine].url(v);
}

async function serverModerationCheck(rawQuery) {
    try {
        const r = await fetch("/api/moderation/check", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ query: rawQuery })
        });
        if (!r.ok) return { blocked: false };
        return await r.json();
    } catch { return { blocked: false }; }
}

async function moderatedSearch(raw, onAllowed) {
    if (checkBlocked(raw)) {
        return showError("This search is blocked by Nocturne policy. See the Terms of Service.");
    }
    const check = await serverModerationCheck(raw);
    if (check.blocked) {
        return showError(check.reason || "Search blocked by policy.");
    }
    onAllowed();
}

searchForm.addEventListener("submit", async e => {
    e.preventDefault();
    const raw = searchHome.value;
    const slug = matchSlug(raw);
    if (slug) { searchHome.value = ""; openInternalTab(slug); return; }
    const newTabKey = e.submitter && (e.submitter.dataset?.newTab === "1");
    moderatedSearch(raw, () => {
        const url = parseInput(raw);
        if (!url) return;
        searchHome.value = "";
        if (newTabKey) loadInNewTab(url); else load(url);
    });
});

searchHome.addEventListener("keydown", e => {
    if (e.key !== "Enter" || !(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const raw = searchHome.value;
    const slug = matchSlug(raw);
    if (slug) { searchHome.value = ""; openInternalTab(slug); return; }
    moderatedSearch(raw, () => {
        const url = parseInput(raw);
        if (!url) return;
        searchHome.value = "";
        loadInNewTab(url);
    });
});

(function initSearchSuggest() {
    if (!searchHome || !searchSuggest || !searchForm) return;
    const SEARCH_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="7" cy="7" r="5"></circle><line x1="13" y1="13" x2="10.5" y2="10.5"></line></svg>';
    const LINK_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>';
    let debounceTimer = null, seq = 0, items = [], activeIndex = -1;

    const looksLikeUrl = v => /^https?:\/\//i.test(v) || (!v.includes(" ") && v.includes("."));

    function close() {
        searchSuggest.classList.remove("open");
        searchSuggest.innerHTML = "";
        items = []; activeIndex = -1;
        searchHome.setAttribute("aria-expanded", "false");
    }

    function setActive(i) {
        activeIndex = i;
        [...searchSuggest.children].forEach((el, idx) => el.classList.toggle("active", idx === i));
        const el = searchSuggest.children[i];
        if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }

    function choose(q) {
        searchHome.value = q;
        close();
        if (searchForm.requestSubmit) searchForm.requestSubmit();
        else searchForm.dispatchEvent(new Event("submit", { cancelable: true }));
    }

    function render(list, q) {
        const seen = new Set(), entries = [];
        if (looksLikeUrl(q)) { entries.push({ q, icon: LINK_ICON, label: q }); seen.add(q.toLowerCase()); }
        for (const s of list) {
            if (typeof s !== "string" || seen.has(s.toLowerCase())) continue;
            seen.add(s.toLowerCase());
            entries.push({ q: s, icon: SEARCH_ICON, label: s });
        }
        if (!entries.length) { close(); return; }
        items = entries;
        searchSuggest.innerHTML = entries.map(e =>
            `<button type="button" class="suggest-item" data-q="${e.q.replace(/"/g, "&quot;")}"><span class="si-icon">${e.icon}</span><span class="si-text">${escapeHtml(e.label)}</span></button>`
        ).join("");
        activeIndex = -1;
        searchSuggest.classList.add("open");
        searchHome.setAttribute("aria-expanded", "true");
    }

    async function fetchSuggest(q) {
        const my = ++seq;
        try {
            const r = await fetch("/api/suggest?q=" + encodeURIComponent(q));
            const data = await r.json();
            if (my !== seq || searchHome.value.trim() !== q) return;
            render(Array.isArray(data.suggestions) ? data.suggestions : [], q);
        } catch {}
    }

    searchHome.addEventListener("input", () => {
        const q = searchHome.value.trim();
        clearTimeout(debounceTimer);
        if (!q) { close(); return; }
        debounceTimer = setTimeout(() => fetchSuggest(q), 130);
    });

    searchHome.addEventListener("keydown", e => {
        if (!searchSuggest.classList.contains("open") || !items.length) return;
        if (e.key === "ArrowDown") { e.preventDefault(); setActive((activeIndex + 1) % items.length); }
        else if (e.key === "ArrowUp") { e.preventDefault(); setActive((activeIndex - 1 + items.length) % items.length); }
        else if (e.key === "Enter" && activeIndex >= 0 && items[activeIndex]) { e.preventDefault(); choose(items[activeIndex].q); }
        else if (e.key === "Escape") { close(); }
    });

    searchSuggest.addEventListener("mousedown", e => {
        const btn = e.target.closest(".suggest-item");
        if (!btn) return;
        e.preventDefault();
        choose(btn.dataset.q);
    });

    searchHome.addEventListener("blur", () => setTimeout(close, 130));
    searchHome.addEventListener("focus", () => { const q = searchHome.value.trim(); if (q) fetchSuggest(q); });
    searchForm.addEventListener("submit", () => close());
})();

urlBar.addEventListener("keydown", e => {
    if (e.key !== "Enter") return;
    const raw = urlBar.value;
    const slug = matchSlug(raw);
    if (slug) { e.preventDefault(); openInternalTab(slug); return; }
    const inNewTab = e.ctrlKey || e.metaKey;
    moderatedSearch(raw, () => {
        const url = parseInput(raw);
        if (!url) return;
        if (inNewTab) loadInNewTab(url); else load(url);
    });
});

document.addEventListener("keydown", e => {
    if (e.altKey && e.key.toLowerCase() === "t") {
        e.preventDefault();
        newTab();
    }
});

btnBack.addEventListener("click", () => {
    const t = activeTab();
    if (!t || t.navIndex <= 0) return;
    t.navIndex--;
    updateNavButtons();
    if (t._internal) internalNavTo(t, t.navStack[t.navIndex]);
    else load(t.navStack[t.navIndex], false);
});
btnFwd.addEventListener("click", () => {
    const t = activeTab();
    if (!t || t.navIndex >= t.navStack.length - 1) return;
    t.navIndex++;
    updateNavButtons();
    if (t._internal) internalNavTo(t, t.navStack[t.navIndex]);
    else load(t.navStack[t.navIndex], false);
});
document.getElementById("btnReload").addEventListener("click", () => { if (lastURL) load(lastURL, false); });
document.getElementById("btnFullscreen").addEventListener("click", () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else frame.requestFullscreen?.();
});

document.getElementById("btnShareScreen")?.addEventListener("click", () => {
    const w = 1000, h = 640;
    const left = Math.max(0, (window.screen.width || 1280) - w - 40);
    window.open("/screenshare.html", "nocturneVision", `width=${w},height=${h},left=${left},top=70`);
});

document.getElementById("retryBtn").addEventListener("click", () => { if (lastURL) load(lastURL, false); });
document.getElementById("homeFromErrorBtn").addEventListener("click", () => showHome());

if (dockHome) dockHome.addEventListener("click", () => showHome());
if (dockSettings) {
    dockSettings.addEventListener("click", e => {
        e.stopPropagation();
        settingsPanel.classList.toggle("open");
    });
}

const settingsCloseBtn = document.getElementById("settingsClose");
if (settingsCloseBtn) {
    settingsCloseBtn.addEventListener("click", () => settingsPanel.classList.remove("open"));
}

if (settingsPanel) {
    settingsPanel.addEventListener("click", e => {
        if (e.target === settingsPanel) settingsPanel.classList.remove("open");
    });
}

document.querySelectorAll("#settingsNav .settings-nav-item").forEach(btn => {
    btn.addEventListener("click", () => {
        const target = btn.dataset.pane;
        document.querySelectorAll("#settingsNav .settings-nav-item")
            .forEach(b => b.classList.toggle("active", b === btn));
        document.querySelectorAll(".settings-pane")
            .forEach(p => p.classList.toggle("active", p.dataset.pane === target));
    });
});

function _applyBgTheme(theme) {
    if (typeof window.applyBgTheme === "function") {
        window.applyBgTheme(theme);
    } else {
        window.dispatchEvent(new CustomEvent("nocturne:bgtheme", { detail: theme }));
        localStorage.setItem("nocturne-bg-theme", theme);
    }
}

fxToggle.addEventListener("change", () => {
    const on = fxToggle.checked;
    if (on) {
        _applyBgTheme("stars");
        localStorage.setItem("nocturne-bg-theme", "stars");
    } else {
        const cur = localStorage.getItem("nocturne-bg-theme") || "stars";
        if (cur === "stars") {
            _applyBgTheme("off");
            localStorage.setItem("nocturne-bg-theme", "off");
        } else {
            window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: false }));
        }
    }
    if (bgThemeSelect) bgThemeSelect.value = localStorage.getItem("nocturne-bg-theme") || "stars";
});

const bgThemeSelect = document.getElementById("bgThemeSelect");
if (bgThemeSelect) {
    const themes = (window.NOCTURNE_BG_THEMES) || [
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
    bgThemeSelect.innerHTML = themes.map(t => `<option value="${t.id}">${t.label}</option>`).join("");
    bgThemeSelect.value = localStorage.getItem("nocturne-bg-theme") || "stars";
    bgThemeSelect.addEventListener("change", () => {
        const v = bgThemeSelect.value;
        localStorage.setItem("nocturne-bg-theme", v);
        _applyBgTheme(v);
        if (fxToggle) fxToggle.checked = (v === "stars");
    });
}

const _currentBg = localStorage.getItem("nocturne-bg-theme") || "stars";
fxToggle.checked = (_currentBg === "stars");
if (_currentBg !== "stars") {
    window.dispatchEvent(new CustomEvent("nocturne:bgfx", { detail: false }));
}

const perfSelect = document.getElementById("perfSelect");
// Shared with onboarding.js (applyPerfLive) and the early bootstrap script in
// index.html — all three write/read the same "nocturne-perf-tier" key so the
// tier stays consistent whichever surface last changed it.
function _applyPerfTier(tier) {
    const html = document.documentElement;
    html.dataset.perfTier = tier;
    html.classList.toggle("perf-lite", tier === "low" || tier === "medium");
    html.classList.toggle("perf-min", tier === "low");
}
if (perfSelect) {
    perfSelect.value = document.documentElement.dataset.perfTier || localStorage.getItem("nocturne-perf-tier") || "high";
    perfSelect.addEventListener("change", () => {
        const v = perfSelect.value;
        localStorage.setItem("nocturne-perf-tier", v);
        _applyPerfTier(v);
    });
}

const debugToggle = document.getElementById("debugToggle");
if (debugToggle) {
    debugToggle.checked = localStorage.getItem("nocturne-debug") === "1";
    debugToggle.addEventListener("change", () => {
        window.dispatchEvent(new CustomEvent("nocturne:debug", { detail: debugToggle.checked }));
    });
}

const islandToggle = document.getElementById("islandToggle");
if (islandToggle) {
    islandToggle.checked = localStorage.getItem("nocturne-island") !== "off";
    islandToggle.addEventListener("change", () => {
        if (typeof window.__nocIslandSetEnabled === "function") {
            window.__nocIslandSetEnabled(islandToggle.checked);
        } else {
            try { localStorage.setItem("nocturne-island", islandToggle.checked ? "on" : "off"); } catch {}
        }
    });
}

for (const id in ENGINES) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = ENGINES[id].label;
    engineSelect.appendChild(opt);
}
engineSelect.value = currentEngine;
engineSelect.addEventListener("change", () => {
    currentEngine = engineSelect.value;
    localStorage.setItem("nocturne-engine", currentEngine);
});
window.addEventListener("nocturne:engine", e => {
    const id = e.detail;
    if (ENGINES[id]) {
        currentEngine = id;
        engineSelect.value = id;
    }
});

cloakSelect.innerHTML = '<option value="">Off</option>' +
    listCloaks().map(c => `<option value="${c.id}">${c.title.replace(/"/g, "&quot;")}</option>`).join("");
cloakSelect.value = localStorage.getItem("nocturne-cloak") || "";
cloakSelect.addEventListener("change", () => {
    const v = cloakSelect.value;
    if (v) applyCloak(v); else resetCloak();
});
restoreCloak();

document.getElementById("resetEngineBtn").addEventListener("click", () => {
    localStorage.setItem("nocturne-reset", "true");
    location.reload();
});

function loadInNewTab(url) {
    const t = { id: uid(), title: hostFromUrl(url), url };
    tabs.push(t);
    activeTabId = t.id;
    enteringTabId = t.id;
    saveTabs();
    renderTabs();
    load(url, false);
}

document.querySelectorAll(".link-btn[data-url]").forEach(btn => {
    btn.addEventListener("click", e => {
        const url = btn.getAttribute("data-url");
        if (e.ctrlKey || e.metaKey || e.shiftKey) loadInNewTab(url);
        else load(url);
    });
    btn.addEventListener("auxclick", e => {
        if (e.button !== 1) return;
        e.preventDefault();
        loadInNewTab(btn.getAttribute("data-url"));
    });
});

wireHoverPrefetch();

document.addEventListener("keydown", e => {
    if (e.ctrlKey && e.key.toLowerCase() === "q") {
        e.preventDefault();
        window.location.replace("https://www.google.com");
        return;
    }
    if (e.ctrlKey && e.key.toLowerCase() === "l") {
        e.preventDefault();
        if (toolbar.classList.contains("visible")) { urlBar.focus(); urlBar.select(); }
        else searchHome.focus();
        return;
    }
    if (e.key === "Escape" && settingsPanel.classList.contains("open")) {
        settingsPanel.classList.remove("open");
    }
});

window.addEventListener("popstate", () => {
    const p = window.location.pathname;
    if (p.startsWith("/search/")) {
        const decoded = deobfuscate(p.slice(8));
        if (decoded) load(decoded, false);
    } else {
        showHome(false);
    }
});

function pathIsTabPage(p) {
    const clean = (p || "").split("?")[0].split("#")[0];
    return Object.values(PAGE_SLUGS).some(c => c.path === clean);
}

const initPath = window.location.pathname;
const initSlug = matchSlug(initPath);
const initShareMatch = initPath.match(/^\/s\/[^\/]+\/\d+$/);
if (initPath.startsWith("/search/")) {
    const decoded = deobfuscate(initPath.slice(8));
    if (decoded) load(decoded);
} else if (initSlug) {
    openInternalTab(initSlug);

    try { history.replaceState(null, "", "/" + initSlug.slug); } catch {}
} else if (initShareMatch) {
    openInternalTab({ slug: "", path: initPath, title: "Code" });
    try { history.replaceState(null, "", "/"); } catch {}
} else if (pathIsTabPage(initPath)) {
    openInternalByPath(initPath);
    try { history.replaceState(null, "", "/"); } catch {}
} else {
    showHome(false);
}

try {
    const _islandTravel = sessionStorage.getItem("noc-island-travel");
    if (_islandTravel) {
        sessionStorage.removeItem("noc-island-travel");
        setTimeout(() => { try { window.__nocOpenUrl(_islandTravel); } catch (e) {} }, 40);
    }
} catch (e) {}

updateNavButtons();
if (_restoreAvailable) showRestoreChip();
initPerformance();

const onlineCountEl = document.getElementById("onlineCount");
function fmtOnline(n) {
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
    if (n >= 10000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "K";
    return String(n);
}
async function pollOnline() {
    if (!onlineCountEl) return;
    try {
        const r = await fetch("/api/online", { cache: "no-store", credentials: "same-origin" });
        if (!r.ok) return;
        const j = await r.json();
        if (typeof j.online === "number") onlineCountEl.textContent = fmtOnline(j.online);
    } catch {}
}
pollOnline();
setInterval(pollOnline, 30000);
