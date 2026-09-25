(function () {
    var hn = location.hostname;
    if (hn === "nocturne.lol" || hn.indexOf("cloudfront") !== -1) return;
    var CF = "https://d27jvgogyihpmk.cloudfront.net";
    var prev = window.fetch.bind(window);
    window.fetch = function (u, o) {
        if (typeof u === "string") {
            if (u.indexOf("https://nocturne.lol/api/") === 0) u = CF + u.slice("https://nocturne.lol".length);
            else if (u.indexOf("/api/") === 0) u = CF + u;
        }
        var isApi = typeof u === "string" && u.indexOf("/api/") !== -1;
        if (isApi) {
            o = Object.assign({}, o || {});
            var h = new Headers(o.headers || {});
            try {
                var s = localStorage.getItem("noc-session");
                if (s && !h.has("X-Noc-Session")) h.set("X-Noc-Session", s);
            } catch (e) {}
            o.headers = h;
        }
        return prev(u, o);
    };
})();

const $ = id => document.getElementById(id);

const HISTORY_KEY = "nocturne-ai-chat";
const MODEL_KEY = "nocturne-ai-model-groq";
const EFFORT_KEY = "nocturne-ai-effort";

const EFFORT_BY_LEVEL = { off: "low", normal: "medium", extended: "high" };
const LEVEL_BY_EFFORT = { low: "off", medium: "normal", high: "extended" };

const EMPTY_TITLES = [
    "What's on your mind?",
    "How can I help?",
    "Got a question?",
    "What are we exploring today?",
    "Ready when you are.",
    "Where do we start?",
    "What do you want to know?",
    "Ask me anything.",
    "What can I help you build?",
    "Curious about something?",
    "Let's figure it out.",
    "What are you working on?",
    "Throw me a question.",
    "Need a hand with something?",
    "What should we dive into?",
    "Stuck on something?",
    "Let's get into it.",
    "What's the task?",
    "Ask away.",
    "What are you thinking about?",
    "How can I make this easier?",
    "What do you need?",
    "Let's make something.",
    "Bring me a problem to solve.",
    "Pick my brain.",
    "What's the mission?"
];

const QUICK_CHIPS = [
    { prompt: "Explain what quantum computing is in simple terms", title: "Explain quantum computing", sub: "in simple terms", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1.5"/><path d="M20.2 20.2c2.04-2.03.02-7.36-4.5-11.9-4.54-4.52-9.87-6.54-11.9-4.5-2.04 2.03-.02 7.36 4.5 11.9 4.54 4.52 9.87 6.54 11.9 4.5Z"/><path d="M15.7 15.7c4.52-4.54 6.54-9.87 4.5-11.9-2.03-2.04-7.36-.02-11.9 4.5-4.52 4.54-6.54 9.87-4.5 11.9 2.03 2.04 7.36.02 11.9-4.5Z"/></svg>' },
    { prompt: "Write a Python script that fetches JSON from an API endpoint and parses it", title: "Python JSON parser", sub: "from an API endpoint", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 18 22 12 16 6"/><polyline points="8 6 2 12 8 18"/></svg>' },
    { prompt: "Give me some creative startup ideas in the AI space", title: "Creative startup ideas", sub: "in the AI space", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M15.09 14c.18-.98.65-1.74 1.41-2.5A4.65 4.65 0 0 0 18 8 6 6 0 0 0 6 8c0 1 .23 2.23 1.5 3.5A4.61 4.61 0 0 1 8.91 14"/></svg>' },
    { prompt: "Write a dark sci-fi short story about a rogue AI", title: "Dark sci-fi story", sub: "about a rogue AI", icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16.01"/><line x1="16" y1="16" x2="16" y2="16.01"/></svg>' }
];

function timeGreeting() {
    const h = new Date().getHours();
    if (h < 5) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 22) return "Good evening";
    return "Good night";
}
function displayName() {
    const n = (state.username || "").trim();
    return n ? n.charAt(0).toUpperCase() + n.slice(1) : "";
}

function signedInPrompts() {
    const n = displayName();
    const t = n ? ", " + n : "";
    return [
        "What's on your mind today" + t + "?",
        "Ask me anything" + t + "…",
        "Where should we start" + t + "?",
        "What are we exploring today" + t + "?",
        "Need a hand with something" + t + "?",
        "What can I help with" + t + "?",
        "What are you working on" + t + "?",
        "Throw me a question" + t + "…"
    ];
}

function emptyTitleInitial() {
    const n = displayName();
    if (state.authed && n) return escapeHtml(timeGreeting() + ", " + n);
    return "What can I help<br>you with today?";
}

function buildEmptyState() {
    const cards = QUICK_CHIPS.map(c =>
        `<button class="quick-chip cai-card" data-prompt="${c.prompt.replace(/"/g, '&quot;')}">` +
        `<span class="cai-card-ic">${c.icon}</span>` +
        `<span class="cai-card-t">${c.title}</span>` +
        `<span class="cai-card-s">${c.sub}</span></button>`).join("");
    return `<div class="empty-state cai-empty">
        <div class="cai-empty-title" id="emptyTitle"><span class="cai-empty-line">${emptyTitleInitial()}</span></div>
        <div class="cai-cards">${cards}</div>
    </div>`;
}

function reduceMotionOn() {
    try {
        if (document.documentElement.classList.contains("reduce-motion")) return true;
        return localStorage.getItem("nocturne-reduce-motion") === "1";
    } catch (e) { return false; }
}

function resetRotatingText() {
    document.querySelectorAll(".cai-empty-line, #aiPh .cai-ph-txt").forEach(el => {
        el.style.transition = "none";
        el.style.opacity = "1";
        el.style.transform = "none";
        el.style.filter = "none";
    });
}

function unblurRecompose() {
    const h = document.documentElement;
    h.classList.add("noc-bfx");
    void document.body.offsetWidth;
    requestAnimationFrame(() => requestAnimationFrame(() => h.classList.remove("noc-bfx")));
}
if (!window.__aiRotVisGuard) {
    window.__aiRotVisGuard = true;
    const onShown = () => { if (document.hidden) return; resetRotatingText(); unblurRecompose(); };
    document.addEventListener("visibilitychange", onShown);
    window.addEventListener("pageshow", onShown);
}

let _emptyTitleTimer = null;

function startEmptyTitleRotation() {

    if (state.authed && displayName()) return;
    if (_emptyTitleTimer) { clearInterval(_emptyTitleTimer); _emptyTitleTimer = null; }
    if (reduceMotionOn()) return;
    _emptyTitleTimer = setInterval(() => {
        const host = document.getElementById("emptyTitle");
        const el = host && host.querySelector(".cai-empty-line");
        if (!el) { clearInterval(_emptyTitleTimer); _emptyTitleTimer = null; return; }
        if (document.hidden) return;
        const current = el.textContent.trim();
        const pool = EMPTY_TITLES.filter(t => t !== current);
        const next = pool[Math.floor(Math.random() * pool.length)] || current;
        const EASE = "var(--ease, cubic-bezier(0.22, 1, 0.36, 1))";

        el.style.opacity = "1";
        el.style.transform = "translateY(0)";
        el.style.filter = "blur(0)";
        el.style.animation = "none";
        void el.offsetWidth;

        el.style.transition = "opacity 0.34s " + EASE + ", transform 0.34s " + EASE + ", filter 0.34s " + EASE;
        el.style.opacity = "0";
        el.style.transform = "translateY(-12px)";
        el.style.filter = "blur(5px)";
        setTimeout(() => {
            el.textContent = next;

            el.style.transition = "none";
            el.style.opacity = "0";
            el.style.transform = "translateY(12px)";
            el.style.filter = "blur(5px)";
            void el.offsetWidth;

            requestAnimationFrame(() => requestAnimationFrame(() => {
                el.style.transition = "opacity 0.46s " + EASE + ", transform 0.46s " + EASE + ", filter 0.46s " + EASE;
                el.style.opacity = "1";
                el.style.transform = "translateY(0)";
                el.style.filter = "blur(0)";
            }));
        }, 360);
    }, 5000);
}

async function fetchUsername() {
    if (!state.authed) { state.username = ""; return; }
    try {
        const me = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" }).then(r => r.json());
        state.username = (me && me.authenticated && me.user && me.user.username) || "";
    } catch (e) { state.username = ""; }
}

function setupInputPlaceholder() {
    const input = $("input");
    const bar = input && input.closest(".cai-inputbar");
    if (!input || !bar) return;
    if (!bar._phSync) {
        bar._phSync = () => bar.classList.toggle("has-text", input.value.length > 0);
        input.addEventListener("input", bar._phSync);
    }
    bar._phSync();
    if (state.authed && displayName()) {
        input.placeholder = "";
        bar.classList.add("ph-custom");
        startPlaceholderRotation();
    } else {
        bar.classList.remove("ph-custom");
    }
}

function startPlaceholderRotation() {
    if (_emptyTitleTimer) { clearInterval(_emptyTitleTimer); _emptyTitleTimer = null; }
    const txt = document.querySelector("#aiPh .cai-ph-txt");
    if (!txt) return;
    const prompts = signedInPrompts();
    let i = 0;
    txt.textContent = prompts[0];

    txt.style.transition = "none"; txt.style.opacity = "1"; txt.style.transform = "none"; txt.style.filter = "none";
    const motion = !reduceMotionOn();
    const EASE = "var(--ease, cubic-bezier(0.22, 1, 0.36, 1))";
    _emptyTitleTimer = setInterval(() => {
        const t = document.querySelector("#aiPh .cai-ph-txt");
        if (!t) { clearInterval(_emptyTitleTimer); _emptyTitleTimer = null; return; }
        if (document.hidden) return;
        i = (i + 1) % prompts.length;
        const next = prompts[i];
        if (!motion) { t.textContent = next; return; }
        t.style.transition = "opacity 0.32s " + EASE + ", transform 0.32s " + EASE + ", filter 0.32s " + EASE;
        t.style.opacity = "0";
        t.style.transform = "translateY(-7px)";
        t.style.filter = "blur(4px)";
        setTimeout(() => {
            t.textContent = next;
            t.style.transition = "none";
            t.style.opacity = "0";
            t.style.transform = "translateY(7px)";
            t.style.filter = "blur(4px)";
            void t.offsetWidth;
            requestAnimationFrame(() => requestAnimationFrame(() => {
                t.style.transition = "opacity 0.42s " + EASE + ", transform 0.42s " + EASE + ", filter 0.42s " + EASE;
                t.style.opacity = "1";
                t.style.transform = "translateY(0)";
                t.style.filter = "blur(0)";
            }));
        }, 330);
    }, 5000);
}

const state = {
    history: [],
    busy: false,
    abortCtrl: null,
    queued: [],
    model: localStorage.getItem(MODEL_KEY) || "navy:gpt-5.4-mini",
    models: [],
    level: EFFORT_BY_LEVEL[localStorage.getItem(EFFORT_KEY)] ? localStorage.getItem(EFFORT_KEY) : "normal",
    authed: false,
    username: "",
    chatId: null,
    chats: [],
    search: ""
};

function loadHistory() {
    try { state.history = JSON.parse(localStorage.getItem(HISTORY_KEY) || "[]"); }
    catch { state.history = []; }
}

let _saveTimer = null;
function saveHistory() {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(-60))); } catch {}
    if (!state.authed || !state.history.length) return;
    clearTimeout(_saveTimer);
    _saveTimer = setTimeout(async () => {
        try {
            if (!state.chatId) {
                const r = await fetch("/api/ai/chats", {
                    method: "POST", credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messages: state.history.slice(-200), model: state.model })
                });
                if (r.ok) { const data = await r.json(); state.chatId = data.id; await refreshChatList(); }
            } else {
                await fetch(`/api/ai/chats/${state.chatId}`, {
                    method: "PUT", credentials: "same-origin",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ messages: state.history.slice(-200), model: state.model })
                });
                refreshChatList();
            }
        } catch {}
    }, 600);
}

async function refreshChatList() {
    if (!state.authed) return;
    try {
        const r = await fetch("/api/ai/chats", { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (Array.isArray(data.chats)) {
            state.chats = data.chats;
            renderChatList();
        }
    } catch {}
}

function fmtChatTime(ts) {
    if (!ts) return "";
    const diff = Date.now() - ts;
    if (diff < 60_000) return "now";
    if (diff < 3600_000) return Math.floor(diff / 60_000) + "m";
    if (diff < 86400_000) return Math.floor(diff / 3600_000) + "h";
    return Math.floor(diff / 86400_000) + "d";
}

function escapeAttr(s) { return String(s || "").replace(/"/g, "&quot;"); }

function chatBucket(ts) {
    if (!ts) return "Older";
    const d = Date.now() - ts;
    if (d < 86400000) return "Today";
    if (d < 172800000) return "Yesterday";
    if (d < 604800000) return "Previous 7 days";
    return "Older";
}
function updateHeaderTitle() {
    const el = document.getElementById("chatTitle");
    if (!el) return;
    let title = "New Chat";
    if (state.chatId) {
        const c = state.chats.find(x => x.id === state.chatId);
        if (c && c.title) title = c.title;
    }
    el.textContent = title;
}
function chatItemHtml(c) {
    return `<div class="cs-item ${c.id === state.chatId ? "active" : ""}" data-chat-id="${c.id}">
        <span class="cs-item-title" title="${escapeAttr(c.title || "")}">${escapeHtml(c.title || "Untitled")}</span>
        <button class="cs-item-del" data-chat-del="${c.id}" aria-label="Delete chat">
            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
    </div>`;
}
function renderChatList() {
    const list = $("csList");
    if (!list) return;
    updateHeaderTitle();
    const q = (state.search || "").toLowerCase();
    let chats = q ? state.chats.filter(c => (c.title || "").toLowerCase().includes(q)) : state.chats;
    let html = "";

    if (!state.chatId && !q) html += `<div class="cs-item active"><span class="cs-item-title">New Chat</span></div>`;
    if (!chats.length && !html) {
        list.innerHTML = q
            ? `<div class="cs-empty">No chats match “${escapeHtml(state.search)}”.</div>`
            : (state.authed
                ? `<div class="cs-empty">No chats yet. Send a message to start one.</div>`
                : `<div class="cai-side-hint">Your chats show up here. <a href="/account.html">Sign in</a> to save them across devices.</div>`);
        return;
    }
    const order = ["Today", "Yesterday", "Previous 7 days", "Older"];
    const groups = {};
    for (const c of chats) (groups[chatBucket(c.updated_at)] ||= []).push(c);
    for (const g of order) {
        if (!groups[g]) continue;
        html += `<div class="cai-grouplabel">${g}</div>` + groups[g].map(chatItemHtml).join("");
    }
    list.innerHTML = html;
}

async function loadChatById(id) {
    if (!state.authed) return;
    if (state.busy && state.abortCtrl) state.abortCtrl.abort();
    try {
        const r = await fetch(`/api/ai/chats/${id}`, { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        state.chatId = data.id;
        state.history = Array.isArray(data.messages) ? data.messages : [];
        try { localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history.slice(-60))); } catch {}
        $("messages").innerHTML = "";
        for (const m of state.history) addMessage(m.role, m.content);
        renderChatList();
    } catch {}
}

async function loadServerHistory() {
    try {
        const r = await fetch("/api/ai/chats", { credentials: "same-origin", cache: "no-store" });
        if (!r.ok) return;
        const data = await r.json();
        if (data.authenticated) state.authed = true;
        else if (!hasSession()) state.authed = false;
        updateFreeHint();
        if (!state.authed) return;
        state.chats = Array.isArray(data.chats) ? data.chats : [];
        renderChatList();
        $("chatSidebar")?.classList.remove("hidden");
        if (state.chats.length) {
            const latest = state.chats[0];
            await loadChatById(latest.id);
        }
    } catch {}
}

function escapeHtml(s) {
    return String(s || "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
}

function utf8ToB64(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/=+$/, "");
}

function b64ToUtf8(s) {
    const padded = s + "===".slice((s.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

const NOC_C = "";
const NOC_T = "";

function renderMd(text) {
    const codeBlocks = [];
    let html = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const i = codeBlocks.push({ lang: (lang || "text").toLowerCase(), code: code.replace(/\n$/, "") }) - 1;
        return NOC_C + i + NOC_C;
    });

    const thinkBlocks = [];
    html = html.replace(/<think>([\s\S]*?)<\/think>/g, (_, inner) => {
        const i = thinkBlocks.push(inner.trim()) - 1;
        return NOC_T + i + NOC_T;
    });

    const NOC_M = "";
    const mathBlocks = [];
    html = html.replace(/\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)/g, (m, d1, d2, inl) => {
        const display = d1 !== undefined || d2 !== undefined;
        const tex = d1 !== undefined ? d1 : (d2 !== undefined ? d2 : inl);
        const i = mathBlocks.push({ tex, display }) - 1;
        return NOC_M + i + NOC_M;
    });

    html = escapeHtml(html);

    html = html.replace(/&lt;(\/?)(br|sub|sup|u|kbd|mark|small)\s*\/?&gt;/gi, (_, slash, tag) => "<" + slash + tag.toLowerCase() + ">");

    html = html.replace(/^(#{1,6})\s+(.+)$/gm, (m, hashes, content) => {
        const lvl = Math.min(6, hashes.length);
        return `<h${lvl}>${content.trim()}</h${lvl}>`;
    });

    html = html.replace(/^[\s]*(?:[-*_]\s*){3,}[\s]*$/gm, "<hr>");

    html = html.replace(/(^|\n)((?:\|[^\n]*\|\n?)+)/g, (m, lead, table) => {
        const lines = table.trim().split("\n");
        if (lines.length < 2) return m;
        const rows = lines.map(r => r.replace(/^\||\|$/g, "").split("|").map(c => c.trim()));
        const sep = rows[1];
        if (!sep || !sep.every(c => /^:?-+:?$/.test(c))) return m;
        const aligns = sep.map(c => {
            const l = c.startsWith(":"), r = c.endsWith(":");
            return l && r ? "center" : r ? "right" : l ? "left" : "";
        });
        const head = rows[0];
        const body = rows.slice(2);
        const th = head.map((c, i) => `<th${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${c}</th>`).join("");
        const trs = body.map(row => "<tr>" + row.map((c, i) => `<td${aligns[i] ? ` style="text-align:${aligns[i]}"` : ""}>${c}</td>`).join("") + "</tr>").join("");
        return lead + `<table><thead><tr>${th}</tr></thead><tbody>${trs}</tbody></table>`;
    });

    html = html.replace(/(?:^&gt;\s?.+(?:\n&gt;\s?.+)*)/gm, m => {
        const inner = m.replace(/^&gt;\s?/gm, "");
        return `<blockquote>${inner.replace(/\n/g, "<br>")}</blockquote>`;
    });

    html = html.replace(/(^|\n)((?:\d+\.\s+.+(?:\n {2,}.+)*\n?)+)/g, (m, lead, list) => {
        const items = list.trim().split(/\n(?=\d+\.\s+)/).map(it => `<li>${it.replace(/^\d+\.\s+/, "").replace(/\n {2,}/g, " ").trim()}</li>`).join("");
        return lead + `<ol>${items}</ol>`;
    });

    html = html.replace(/(^|\n)((?:[-*]\s+.+(?:\n {2,}.+)*\n?)+)/g, (m, lead, list) => {
        const items = list.trim().split(/\n(?=[-*]\s+)/).map(it => `<li>${it.replace(/^[-*]\s+/, "").replace(/\n {2,}/g, " ").trim()}</li>`).join("");
        return lead + `<ul>${items}</ul>`;
    });

    html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    html = html.replace(/(^|[^_\w])_([^_\n]+)_/g, "$1<em>$2</em>");
    html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');

    html = html.split(/\n{2,}/).map(p => {
        const trim = p.trim();
        if (!trim) return "";
        if (/^<(h\d|ul|ol|pre|blockquote|table|hr)/.test(trim)) return p;
        const onlyPlaceholderRe = new RegExp("^" + NOC_C + "\\d+" + NOC_C + "$|^" + NOC_T + "\\d+" + NOC_T + "$");
        if (onlyPlaceholderRe.test(trim)) return p;
        return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
    }).filter(Boolean).join("\n");

    html = html.replace(new RegExp(NOC_C + "(\\d+)" + NOC_C, "g"), (_, i) => {
        const b = codeBlocks[i];
        const enc = utf8ToB64(b.code);
        return `<div class="code-block"><div class="code-head"><span class="code-lang">${escapeHtml(b.lang)}</span><button class="code-copy" data-c="${enc}">Copy</button></div><pre><code>${escapeHtml(b.code)}</code></pre></div>`;
    });

    html = html.replace(new RegExp(NOC_T + "(\\d+)" + NOC_T, "g"), (_, i) => {
        const inner = thinkBlocks[i];
        if (!inner) return "";
        return `<details class="think"><summary>Reasoning</summary><div class="think-body">${escapeHtml(inner).replace(/\n/g, "<br>")}</div></details>`;
    });

    html = html.replace(new RegExp(NOC_M + "(\\d+)" + NOC_M, "g"), function (_, i) {
        var bm = mathBlocks[i];
        if (!bm) return "";
        var fallback = escapeHtml((bm.display ? "\\[" : "\\(") + bm.tex + (bm.display ? "\\]" : "\\)"));
        return '<span class="noc-math" data-d="' + (bm.display ? 1 : 0) + '" data-tex="' + utf8ToB64(bm.tex) + '">' + fallback + '</span>';
    });
    return html;
}

function typesetMath(container) {
    if (!container || typeof window.katex === "undefined") return;
    container.querySelectorAll(".noc-math:not(.tex-done)").forEach(function (el) {
        var tex = "";
        try { tex = b64ToUtf8(el.dataset.tex || ""); } catch (e) {}
        var display = el.dataset.d === "1";
        try {
            el.innerHTML = window.katex.renderToString(tex, { displayMode: display, throwOnError: false });
        } catch (e) {
            el.textContent = (display ? "\\[" : "\\(") + tex + (display ? "\\]" : "\\)");
        }
        el.classList.add("tex-done");
    });
}

function ensureMessagesContainer() {
    const m = $("messages");
    if (m.querySelector(".empty-state")) m.innerHTML = "";
    return m;
}

const AI_LOADER_HTML = '<div class="ai-loader" role="status" aria-label="Thinking">' + '<span class="ai-sq"></span>'.repeat(9) + '</div>';
function currentCompany() {
    const m = (state.models || []).find(x => x.id === state.model);
    return (m && m.company) || "Assistant";
}

const MSG_ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    cont: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>'
};

function messageActionsHtml(role, opts = {}) {
    if (role === "error") return "";
    let btns = `<button type="button" class="msg-act" data-act="copy" title="Copy" aria-label="Copy">${MSG_ICONS.copy}<span class="msg-act-label">Copy</span></button>`;
    if (role === "assistant") {
        btns += `<button type="button" class="msg-act msg-act-icon" data-act="like" title="Good response" aria-label="Good response">${MSG_ICONS.like}</button>`;
        btns += `<button type="button" class="msg-act msg-act-icon" data-act="report" title="Report" aria-label="Report">${MSG_ICONS.report}</button>`;
        if (opts.truncated) {
            btns += `<button type="button" class="msg-act msg-continue" data-act="continue" title="Continue the response">${MSG_ICONS.cont}<span class="msg-act-label">Continue</span></button>`;
        }
    }
    return `<div class="msg-actions">${btns}</div>`;
}

function attachActions(el, role, opts = {}) {
    const existing = el.querySelector(":scope > .msg-actions");
    if (existing) existing.remove();
    const html = messageActionsHtml(role, opts);
    if (html) el.insertAdjacentHTML("beforeend", html);
}

function removeStaleContinue() {
    document.querySelectorAll("#messages .msg-continue").forEach(b => b.remove());
}

function flashAct(btn, label) {
    const span = btn.querySelector(".msg-act-label");
    if (!span) return;
    if (btn._flashOrig === undefined) btn._flashOrig = span.textContent;
    span.textContent = label;
    btn.classList.add("ok");
    clearTimeout(btn._flashTimer);
    btn._flashTimer = setTimeout(() => {
        span.textContent = btn._flashOrig;
        btn.classList.remove("ok");
    }, 1400);
}

const THINK_CHEV = '<svg class="ai-think-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
function thinkBlockHtml() {
    return '<div class="ai-think">'
        + '<button type="button" class="ai-think-toggle" aria-expanded="false">'
        + '<span class="ai-think-label thinking">Thinking</span>'
        + THINK_CHEV
        + '</button>'
        + '<div class="ai-think-body"></div>'
        + '</div>';
}
function clearLoader(bubble) {
    const l = bubble.querySelector(":scope > .ai-loader");
    if (l) l.remove();
}
function ensureThink(bubble) {
    // :not([data-step]) — this is the FINAL answer's live reasoning trace, kept
    // distinct from the numbered extended-thinking step blocks below so it
    // always renders last (right before the answer), after all of those.
    let think = bubble.querySelector(":scope > .ai-think:not([data-step])");
    if (!think) {
        const answer = bubble.querySelector(":scope > .ai-answer");
        if (answer) answer.insertAdjacentHTML("beforebegin", thinkBlockHtml());
        else bubble.insertAdjacentHTML("beforeend", thinkBlockHtml());
        think = bubble.querySelector(":scope > .ai-think:not([data-step])");
    }
    return think;
}

// One block per extended-thinking step (thought or tool call), in arrival
// order, each addressable by its `step` index so later events for the same
// step update the existing block instead of creating a new one.
function ensureStepBlock(bubble, kind, step) {
    const cls = kind === "tool" ? "ai-tool" : "ai-think";
    let el = bubble.querySelector(`:scope > .${cls}[data-step="${step}"]`);
    if (el) return el;
    el = document.createElement("div");
    el.className = cls;
    el.dataset.step = String(step);
    const answer = bubble.querySelector(":scope > .ai-answer");
    if (answer) bubble.insertBefore(el, answer);
    else bubble.appendChild(el);
    return el;
}
function paintThought(bubble, step, label) {
    clearLoader(bubble);
    const el = ensureStepBlock(bubble, "think", step);
    if (!el.querySelector(".ai-think-toggle")) {
        el.innerHTML = '<button type="button" class="ai-think-toggle" aria-expanded="false">'
            + '<span class="ai-think-label thinking"></span>' + THINK_CHEV + '</button>'
            + '<div class="ai-think-body"></div>';
    }
    const lbl = el.querySelector(".ai-think-label");
    if (lbl) { lbl.textContent = "Thinking: " + label; lbl.classList.add("thinking"); }
}
function paintThoughtResult(bubble, step, label, text) {
    const el = ensureStepBlock(bubble, "think", step);
    const body = el.querySelector(".ai-think-body");
    if (body) body.textContent = text;
    const lbl = el.querySelector(".ai-think-label");
    if (lbl) { lbl.textContent = "Thought: " + label; lbl.classList.remove("thinking"); }
    el.classList.add("done");
}
function ensureAnswer(bubble) {
    let ans = bubble.querySelector(":scope > .ai-answer");
    if (!ans) {
        ans = document.createElement("div");
        ans.className = "ai-answer";
        bubble.appendChild(ans);
    }
    return ans;
}
function paintThink(bubble, reasoning, active) {
    clearLoader(bubble);
    const think = ensureThink(bubble);
    const body = think.querySelector(".ai-think-body");
    if (body && body.textContent !== reasoning) {
        body.textContent = reasoning;
        if (think.classList.contains("open")) body.scrollTop = body.scrollHeight;
    }
    const lbl = think.querySelector(".ai-think-label");
    if (lbl) {
        if (active) { lbl.classList.add("thinking"); lbl.textContent = "Thinking"; }
        else { think.classList.add("done"); lbl.classList.remove("thinking"); lbl.textContent = "Thoughts"; }
    }
}

// ── Tool-call chip (agentic web search) ──────────────────────────────────────
// Sits right below the Thoughts panel: a wrench that pulses while the search
// tool is running, settles once it's done, and expands on click to show the
// query + the sources reached. A separate compact "Sources" footer under the
// finished answer surfaces the same links without requiring a click.
const WRENCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 1 1 4 4 4 0 0 1-5 3.9L4.4 20.5a1.5 1.5 0 0 1-2.1-2.1L8.6 12a4 4 0 0 1 3.9-5 4 4 0 0 1 4 1l-3 3 .5 2.5 2.5.5 3-3z"/></svg>';
function renderToolSources(container, sources) {
    container.innerHTML = "";
    const safe = (sources || []).filter(u => /^https?:\/\//i.test(u)).slice(0, 8);
    if (!safe.length) { container.textContent = "No sources returned."; return; }
    const label = document.createElement("div");
    label.className = "ai-tool-sources-label";
    label.textContent = "Sources";
    container.appendChild(label);
    for (const u of safe) {
        let host = u;
        try { host = new URL(u).hostname.replace(/^www\./, ""); } catch {}
        const a = document.createElement("a");
        a.href = u; a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = u;
        a.className = "ai-tool-src";
        a.textContent = host;
        container.appendChild(a);
    }
}
function paintToolCall(bubble, step, query) {
    clearLoader(bubble);
    const tool = ensureStepBlock(bubble, "tool", step);
    if (!tool.querySelector(".ai-tool-toggle")) {
        tool.innerHTML = '<button type="button" class="ai-tool-toggle" aria-expanded="false">'
            + '<span class="ai-tool-icon">' + WRENCH_ICON + '</span>'
            + '<span class="ai-tool-label searching">Searching the web…</span>'
            + THINK_CHEV + '</button>'
            + '<div class="ai-tool-body"><div class="ai-tool-query"></div><div class="ai-tool-sources"></div></div>';
    }
    tool.classList.add("active");
    const q = tool.querySelector(".ai-tool-query");
    if (q) q.textContent = 'Query: "' + query + '"';
}
function paintToolResult(bubble, step, query, sources) {
    const tool = ensureStepBlock(bubble, "tool", step);
    tool.classList.remove("active");
    tool.classList.add("done");
    const lbl = tool.querySelector(".ai-tool-label");
    if (lbl) { lbl.textContent = "Tool called (Web Search)"; lbl.classList.remove("searching"); }
    const srcEl = tool.querySelector(".ai-tool-sources");
    if (srcEl) renderToolSources(srcEl, sources);
}
function paintToolError(bubble, step) {
    const tool = ensureStepBlock(bubble, "tool", step);
    tool.classList.remove("active");
    tool.classList.add("done", "error");
    const lbl = tool.querySelector(".ai-tool-label");
    if (lbl) { lbl.textContent = "Tool call failed (Web Search)"; lbl.classList.remove("searching"); }
}
function renderSourcesFooter(bubble, sources) {
    let footer = bubble.querySelector(":scope > .ai-sources-footer");
    const safe = (sources || []).filter(u => /^https?:\/\//i.test(u)).slice(0, 8);
    if (!safe.length) { if (footer) footer.remove(); return; }
    if (!footer) {
        footer = document.createElement("div");
        footer.className = "ai-sources-footer";
        bubble.appendChild(footer);
    }
    footer.innerHTML = "";
    const label = document.createElement("span");
    label.className = "ai-sources-footer-label";
    label.textContent = "Sources:";
    footer.appendChild(label);
    for (const u of safe) {
        let host = u;
        try { host = new URL(u).hostname.replace(/^www\./, ""); } catch {}
        const a = document.createElement("a");
        a.href = u; a.target = "_blank"; a.rel = "noopener noreferrer"; a.title = u;
        a.className = "ai-sources-footer-link";
        a.textContent = host;
        footer.appendChild(a);
    }
}
function addMessage(role, text, opts = {}) {
    const m = ensureMessagesContainer();
    const el = document.createElement("div");
    el.className = "msg " + role;
    el._raw = role === "user" ? userContentText(text) : (text || "");
    const label = role === "user" ? "You" : role === "error" ? "Error" : currentCompany();
    const body = role === "user" ? renderUserContent(text) : renderMd(text);
    el.innerHTML = `<div class="msg-role">${label}</div><div class="msg-bubble">${body}</div>`;
    if (opts.streaming) {
        el.querySelector(".msg-bubble").innerHTML = text ? body + `<span class="cursor"></span>` : AI_LOADER_HTML;
    } else {
        attachActions(el, role);
        typesetMath(el);
    }
    m.appendChild(el);
    m.scrollTop = m.scrollHeight;
    return el;
}

function setStatus(text, cls) {
    const t = $("statusTag");
    t.textContent = text;
    t.className = "status-tag" + (cls ? " " + cls : "");
    document.body.classList.toggle("ai-streaming", cls === "streaming");
    if (cls !== "streaming") {
        document.querySelectorAll(".msg.assistant.streaming").forEach(el => el.classList.remove("streaming"));
    }
}

function autoResize() {
    const t = $("input");
    t.style.height = "auto";
    t.style.height = Math.min(220, t.scrollHeight) + "px";
}

const FREE_LIMIT = 3;
const FREE_KEY = "nocturne-ai-free-used";
function hasSession() {
    try { return !!localStorage.getItem("noc-session"); } catch (e) { return false; }
}
function signedIn() { return !!(state.authed || hasSession()); }
function freeUsed() { return parseInt(localStorage.getItem(FREE_KEY) || "0", 10) || 0; }
function bumpFree() { if (signedIn()) return; try { localStorage.setItem(FREE_KEY, String(freeUsed() + 1)); } catch (e) {} updateFreeHint(); }
function gateActive() { return !signedIn() && freeUsed() >= FREE_LIMIT; }

const GATE_CHECK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>';
let _gateEl = null;
let _gateMode = "signup";
function buildGate() {
    if (_gateEl) return _gateEl;
    const el = document.createElement("div");
    el.className = "ai-gate";
    el.innerHTML =
        '<div class="ai-gate-card" role="dialog" aria-modal="true" aria-label="Create a free account">' +
        '<button class="ai-gate-x" type="button" aria-label="Close"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>' +
        '<div class="ai-gate-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3a4 4 0 0 0-4 4 4 4 0 0 0-2.6 7 4 4 0 0 0 2.6 7 4 4 0 0 0 8 0 4 4 0 0 0 2.6-7A4 4 0 0 0 16 7a4 4 0 0 0-4-4z"/><path d="M12 8v8M8 12h8"/></svg></div>' +
        '<h2 class="ai-gate-title">Keep the conversation going</h2>' +
        '<p class="ai-gate-sub">You have used your ' + FREE_LIMIT + ' free messages. Create a free account to keep chatting. It takes seconds and unlocks:</p>' +
        '<ul class="ai-gate-perks">' +
        '<li>' + GATE_CHECK + '<span>Unlimited messages</span></li>' +
        '<li>' + GATE_CHECK + '<span>Your chats saved to the cloud, synced across devices</span></li>' +
        '<li>' + GATE_CHECK + '<span>Pick up past conversations any time</span></li>' +
        '</ul>' +
        '<form class="ai-gate-form" autocomplete="on">' +
        '<input class="ai-gate-user" type="text" placeholder="Username" autocomplete="username" autocapitalize="off" autocorrect="off" spellcheck="false" maxlength="32">' +
        '<input class="ai-gate-pass" type="password" placeholder="Password" autocomplete="new-password" maxlength="200">' +
        '<cap-widget class="ai-gate-captcha" data-cap-api-endpoint="/api/captcha/" data-cap-disable-haptics></cap-widget>' +
        '<div class="ai-gate-err" role="alert"></div>' +
        '<button type="submit" class="ai-gate-submit">Create free account</button>' +
        '</form>' +
        '<button type="button" class="ai-gate-toggle">Already have an account? Sign in</button>' +
        '</div>';
    el.addEventListener("click", function (e) {
        if (e.target === el || e.target.closest(".ai-gate-x")) hideGate();
    });
    el.querySelector(".ai-gate-toggle").addEventListener("click", function () {
        setGateMode(_gateMode === "signup" ? "login" : "signup");
    });
    el.querySelector(".ai-gate-form").addEventListener("submit", function (e) {
        e.preventDefault();
        gateAuth(_gateMode);
    });
    document.body.appendChild(el);
    _gateEl = el;
    setGateMode("signup");
    return el;
}
function setGateMode(m) {
    _gateMode = m;
    if (!_gateEl) return;
    const c = _gateEl.querySelector(".ai-gate-card");
    const signup = m === "signup";
    c.querySelector(".ai-gate-title").textContent = signup ? "Keep the conversation going" : "Welcome back";
    c.querySelector(".ai-gate-sub").textContent = signup
        ? "You have used your " + FREE_LIMIT + " free messages. Create a free account to keep chatting. It is free and unlocks:"
        : "Sign in to keep chatting and sync your conversations.";
    c.querySelector(".ai-gate-perks").style.display = signup ? "" : "none";
    c.querySelector(".ai-gate-pass").setAttribute("autocomplete", signup ? "new-password" : "current-password");
    c.querySelector(".ai-gate-submit").textContent = signup ? "Create free account" : "Sign in";
    c.querySelector(".ai-gate-toggle").textContent = signup ? "Already have an account? Sign in" : "Need an account? Create one";
    c.querySelector(".ai-gate-err").textContent = "";
}
function showGate(reason) {
    const g = buildGate();
    if (reason === "image") {
        setGateMode("signup");
        const c = g.querySelector(".ai-gate-card");
        c.querySelector(".ai-gate-title").textContent = "Sign in to attach images";
        c.querySelector(".ai-gate-sub").textContent = "Image messages need a free account. Create one to attach images, and you also get:";
    }
    requestAnimationFrame(function () { g.classList.add("open"); });
    // Start solving now, so the token is usually ready by the time credentials are typed.
    primeGateCaptcha(g.querySelector(".ai-gate-card"));
    const u = g.querySelector(".ai-gate-user");
    if (u) setTimeout(function () { try { u.focus(); } catch (e) {} }, 90);
}
function hideGate() { if (_gateEl) _gateEl.classList.remove("open"); }
// Cap's <cap-widget> is a custom element from the deferred /cap.js, so it may not be upgraded
// yet when the gate is built. Wait for it, with a ceiling so a failed script load surfaces as a
// normal error instead of hanging the submit button.
function gateCapWidget(c) {
    const widget = c && c.querySelector(".ai-gate-captcha");
    if (!widget) return Promise.resolve(null);
    if (typeof widget.solve === "function") return Promise.resolve(widget);
    return Promise.race([
        customElements.whenDefined("cap-widget").then(function () { return widget; }),
        new Promise(function (resolve) { setTimeout(function () { resolve(null); }, 10000); })
    ]).then(function (w) { return w && typeof w.solve === "function" ? w : null; });
}

// Solve as soon as the gate opens and reuse the in-flight promise on submit, so this stays a
// one-click flow like the old auto-on-load captcha.
let _gateCapPending = null;
function primeGateCaptcha(c) {
    if (_gateCapPending) return _gateCapPending;
    _gateCapPending = gateCapWidget(c)
        .then(function (w) { return w && !w.token ? w.solve() : null; })
        .catch(function () {})
        .then(function () { _gateCapPending = null; });
    return _gateCapPending;
}
async function resetGateCaptcha(c) {
    const w = await gateCapWidget(c);
    if (!w) return;
    try { w.reset(); } catch (e) {}
    primeGateCaptcha(c);
}
async function getGateCaptchaToken(c) {
    const widget = c.querySelector(".ai-gate-captcha");
    if (!widget) return "";
    if (widget.token) return widget.token;
    await primeGateCaptcha(c);
    return widget.token || "";
}
async function gateAuth(modeKind) {
    if (!_gateEl) return;
    const c = _gateEl.querySelector(".ai-gate-card");
    const u = c.querySelector(".ai-gate-user").value.trim();
    const p = c.querySelector(".ai-gate-pass").value;
    const err = c.querySelector(".ai-gate-err");
    const btn = c.querySelector(".ai-gate-submit");
    err.textContent = "";
    if (!u || !p) { err.textContent = "Enter a username and password."; return; }
    btn.disabled = true;
    const origLabel = btn.textContent;
    btn.textContent = modeKind === "signup" ? "Creating account…" : "Signing in…";
    try {
        const captcha = await getGateCaptchaToken(c);
        if (!captcha) throw new Error("Captcha not ready yet — try again in a moment.");
        const r = await fetch("/api/auth/" + (modeKind === "signup" ? "signup" : "login"), {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, password: p, captcha: captcha })
        });
        const data = await r.json().catch(function () { return {}; });
        if (!r.ok) {
            // Tokens are single-use, so a failed attempt always needs a freshly solved one.
            resetGateCaptcha(c);
            throw new Error(data.error || ("HTTP " + r.status));
        }
        if (data.sessionToken) { try { localStorage.setItem("noc-session", data.sessionToken); } catch (_) {} }
        state.authed = true;
        try { localStorage.removeItem(FREE_KEY); } catch (e) {}
        hideGate();
        updateFreeHint();
        // Model access is tier-dependent, so re-read it now that we know who this is.
        try { await refreshModelConfig(); } catch (e) {}
        try { await loadServerHistory(); } catch (e) {}
        try { await fetchUsername(); } catch (e) {}
        setupInputPlaceholder();
        if (document.querySelector(".cai-empty")) { $("messages").innerHTML = buildEmptyState(); startEmptyTitleRotation(); }
        try { saveHistory(); } catch (e) {}

        setTimeout(function () { try { refreshChatList(); } catch (e) {} }, 2600);
        setTimeout(function () { try { refreshChatList(); } catch (e) {} }, 6500);
        const inp = $("input");
        if (inp && inp.value.trim() && !state.busy) {
            try { $("composer").requestSubmit($("sendBtn")); } catch (e) {}
        }
    } catch (e) {
        err.textContent = e.message || "Could not sign you in. Try again.";
    } finally {
        btn.disabled = false;
        btn.textContent = origLabel;
    }
}

function updateFreeHint() {
    const meter = document.getElementById("aiFreeMeter");
    document.body.classList.toggle("ai-authed", signedIn());
    if (!meter) return;
    if (signedIn()) { meter.hidden = true; return; }
    meter.hidden = false;
    const used = Math.min(FREE_LIMIT, freeUsed());
    const left = Math.max(0, FREE_LIMIT - used);
    const countEl = document.getElementById("aiFreeCount");
    const barEl = document.getElementById("aiFreeBar");
    const ctaEl = document.getElementById("aiFreeCta");
    const labelEl = meter.querySelector(".cai-free-label");
    if (countEl) countEl.textContent = used + " / " + FREE_LIMIT;
    if (barEl) barEl.style.width = (FREE_LIMIT ? (used / FREE_LIMIT) * 100 : 0) + "%";
    if (labelEl) labelEl.textContent = left > 0
        ? (left + " free message" + (left === 1 ? "" : "s") + " left")
        : "Free limit reached";
    meter.classList.toggle("is-spent", left === 0);
    if (ctaEl) {
        ctaEl.hidden = left > 0;
        ctaEl.onclick = function () { showGate(); };
    }
}

let _pendingImage = null;

function currentModelVision() {
    const m = (state.models || []).find(x => x.id === state.model);
    return !!(m && m.vision);
}

function currentModelReasoning() {
    const m = (state.models || []).find(x => x.id === state.model);
    return !!(m && m.reasoning);
}

function updateThinkLevel() {
    const box = $("thinkLevel");
    if (!box) return;
    const on = currentModelReasoning();
    box.classList.toggle("hidden", !on);
    if (!EFFORT_BY_LEVEL[state.level]) state.level = "normal";
    box.querySelectorAll(".tl-seg").forEach(seg => {
        seg.classList.toggle("active", seg.dataset.level === state.level);
    });
}

function setLevel(level) {
    if (!EFFORT_BY_LEVEL[level]) return;
    state.level = level;
    localStorage.setItem(EFFORT_KEY, level);
    updateThinkLevel();
}

function userContentText(content) {
    if (typeof content === "string") return content;
    if (Array.isArray(content)) return content.filter(p => p && p.type === "text").map(p => p.text || "").join("\n");
    return "";
}

function renderUserContent(content) {
    if (Array.isArray(content)) {
        let html = "";
        for (const part of content) {
            if (part && part.type === "image_url" && part.image_url && part.image_url.url) {
                html += '<img class="msg-img" src="' + escapeAttr(part.image_url.url) + '" alt="attached image" loading="lazy">';
            }
        }
        for (const part of content) {
            if (part && part.type === "text" && part.text) {
                html += '<div class="msg-usertext">' + escapeHtml(part.text).replace(/\n/g, "<br>") + '</div>';
            }
        }
        return html;
    }
    return escapeHtml(content || "").replace(/\n/g, "<br>");
}

function downscaleImage(file) {
    return new Promise(function (resolve, reject) {
        if (!file || !/^image\//.test(file.type)) { reject(new Error("Not an image")); return; }
        const reader = new FileReader();
        reader.onload = function () {
            const original = reader.result;
            const img = new Image();
            img.onload = function () {
                const MAX_DIM = 3000;
                const PASS_BYTES = 6.5 * 1024 * 1024;
                const w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;

                if (w <= MAX_DIM && h <= MAX_DIM && original.length <= PASS_BYTES) {
                    resolve(original);
                    return;
                }
                try {
                    const scale = Math.min(1, MAX_DIM / Math.max(w, h));
                    const nw = Math.max(1, Math.round(w * scale)), nh = Math.max(1, Math.round(h * scale));
                    const canvas = document.createElement("canvas");
                    canvas.width = nw; canvas.height = nh;
                    const ctx = canvas.getContext("2d");
                    ctx.imageSmoothingEnabled = true;
                    ctx.imageSmoothingQuality = "high";
                    ctx.drawImage(img, 0, 0, nw, nh);
                    let url = canvas.toDataURL("image/jpeg", 0.92);
                    if (url.length > 6.5 * 1024 * 1024) url = canvas.toDataURL("image/jpeg", 0.82);
                    if (url.length > 6.5 * 1024 * 1024) url = canvas.toDataURL("image/jpeg", 0.7);
                    resolve(url);
                } catch (e) { reject(e); }
            };
            img.onerror = function () { reject(new Error("Could not load image")); };
            img.src = original;
        };
        reader.onerror = function () { reject(new Error("Could not read file")); };
        reader.readAsDataURL(file);
    });
}

function renderImgPreview() {
    const wrap = $("imgPreview");
    if (!wrap) return;
    if (!_pendingImage) { wrap.hidden = true; wrap.innerHTML = ""; return; }
    wrap.hidden = false;
    wrap.innerHTML = '<div class="img-chip"><img src="' + _pendingImage.replace(/"/g, "&quot;") + '" alt="attachment"><button type="button" class="img-chip-x" aria-label="Remove image"><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>';
}

function clearPendingImage() {
    _pendingImage = null;
    renderImgPreview();
    const fi = $("imageInput");
    if (fi) fi.value = "";
    refreshSendEnabled();
}

function refreshSendEnabled() {
    $("sendBtn").disabled = state.busy || (!$("input").value.trim() && !_pendingImage);
}

function updateAttachState() {
    const b = $("attachBtn");
    if (!b) return;
    const ok = currentModelVision();
    b.classList.toggle("attach-off", !ok);
    b.title = ok ? "Attach image" : "This model can't read images - pick a vision model";
}

function imageHint(msg) {
    const t = $("statusTag");
    if (!t) return;
    const prev = t.textContent;
    setStatus(msg, "error");
    setTimeout(function () { if ($("statusTag").textContent === msg) setStatus("Ready"); }, 2800);
}

async function attachImageFile(file) {
    if (!state.authed) { showGate("image"); return; }
    if (!currentModelVision()) { imageHint("Pick a vision model (ChatGPT, Claude, Gemini, Grok, Llama 4) to attach images"); return; }
    if (!file) return;
    if (file.size > 12 * 1024 * 1024) { imageHint("Image too large (max 12MB)"); return; }
    try {
        _pendingImage = await downscaleImage(file);
        renderImgPreview();
        refreshSendEnabled();
        $("input").focus();
    } catch (e) {
        imageHint("Could not attach that image");
    }
}

async function streamChat(userText) {
    if (gateActive()) { showGate(); return; }
    let userContent = userText;
    if (_pendingImage) {
        userContent = [];
        if (userText) userContent.push({ type: "text", text: userText });
        userContent.push({ type: "image_url", image_url: { url: _pendingImage } });
        _pendingImage = null;
        renderImgPreview();
    }
    state.history.push({ role: "user", content: userContent });
    saveHistory();
    addMessage("user", userContent);
    if (!signedIn()) bumpFree();

    state.busy = true;
    $("sendBtn").disabled = true;
    setStatus("Thinking…", "streaming");

    const assistantEl = addMessage("assistant", "", { streaming: true });
    assistantEl.classList.add("streaming");
    const bubble = assistantEl.querySelector(".msg-bubble");

    state.abortCtrl = new AbortController();
    let acc = "";
    let reasoningAcc = "";
    let gotAnything = false;
    let finishReason = null;
    let renderTimer = null;
    let lastRenderAt = 0;
    let streamEnded = false;
    let toolSources = null;
    const messagesEl = $("messages");
    const paint = () => {
        if (reasoningAcc) paintThink(bubble, reasoningAcc, !acc);
        if (acc) {
            clearLoader(bubble);
            ensureAnswer(bubble).innerHTML = renderMd(acc) + `<span class="cursor"></span>`;
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
    };
    const scheduleRender = () => {
        if (renderTimer || streamEnded) return;
        const now = performance.now();
        const elapsed = now - lastRenderAt;
        const delay = elapsed >= 60 ? 0 : 60 - elapsed;
        renderTimer = setTimeout(() => {
            renderTimer = null;
            if (streamEnded) return;
            lastRenderAt = performance.now();
            paint();
        }, delay);
    };
    const finalizeRender = (text) => {
        streamEnded = true;
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        clearLoader(bubble);
        if (reasoningAcc) paintThink(bubble, reasoningAcc, false);
        const ans = ensureAnswer(bubble);
        ans.innerHTML = renderMd(text);
        typesetMath(ans);
        if (toolSources) renderSourcesFooter(bubble, toolSources);
        assistantEl._raw = text;
        messagesEl.scrollTop = messagesEl.scrollHeight;
    };

    try {
        console.log("[ai] sending", state.history.length, "messages, model:", state.model);
        const r = await fetch("/api/ai/chat", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: state.model,
                messages: state.history,
                temperature: 0.7,
                max_completion_tokens: 4096,
                reasoning_effort: EFFORT_BY_LEVEL[state.level] || "medium",
                level: state.level
            }),
            signal: state.abortCtrl.signal
        });
        console.log("[ai] response", r.status, r.headers.get("content-type"));

        if (!r.ok) {
            let msg = `HTTP ${r.status}`;
            try { const j = await r.json(); msg = j.error || msg; } catch {}
            throw new Error(msg);
        }
        if (!r.body) throw new Error("no response body");

        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6);
                if (payload === "[DONE]") continue;
                try {
                    const evt = JSON.parse(payload);
                    if (evt.type === "reasoning" && evt.text) {
                        reasoningAcc += evt.text;
                        scheduleRender();
                    } else if (evt.type === "delta" && evt.text) {
                        acc += evt.text;
                        gotAnything = true;
                        scheduleRender();
                    } else if (evt.type === "tool_call" && evt.tool === "web_search") {
                        paintToolCall(bubble, evt.step || 0, evt.query);
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    } else if (evt.type === "tool_result" && evt.tool === "web_search") {
                        toolSources = evt.sources || [];
                        paintToolResult(bubble, evt.step || 0, evt.query, evt.sources);
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    } else if (evt.type === "tool_error") {
                        paintToolError(bubble, evt.step || 0);
                    } else if (evt.type === "thought" && evt.label) {
                        paintThought(bubble, evt.step || 0, evt.label);
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    } else if (evt.type === "thought_result") {
                        paintThoughtResult(bubble, evt.step || 0, evt.label, evt.text || "");
                        messagesEl.scrollTop = messagesEl.scrollHeight;
                    } else if (evt.type === "sources") {
                        toolSources = evt.sources || toolSources;
                    } else if (evt.type === "done") {
                        if (evt.finish) finishReason = evt.finish;
                    } else if (evt.type === "error") {
                        throw new Error(evt.error || "stream error");
                    }
                } catch (e) {
                    if (!(e instanceof SyntaxError)) throw e;
                }
            }
        }

        finalizeRender(acc || "(empty response)");
        if (gotAnything) {
            state.history.push({ role: "assistant", content: acc });
            saveHistory();
        }
        removeStaleContinue();
        attachActions(assistantEl, "assistant", { truncated: finishReason === "length" });
        setStatus("Ready");
    } catch (e) {
        if (e.name === "AbortError") {
            finalizeRender(acc);
            ensureAnswer(bubble).innerHTML = renderMd(acc) + `<p><em>(stopped)</em></p>`;
            typesetMath(bubble);
            if (acc) state.history.push({ role: "assistant", content: acc });
            saveHistory();
            removeStaleContinue();
            attachActions(assistantEl, "assistant", { truncated: true });
            setStatus("Stopped");
        } else {
            streamEnded = true;
            if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
            console.error("[ai] streamChat error:", e);
            assistantEl.classList.remove("assistant");
            assistantEl.classList.add("error");
            const role = assistantEl.querySelector(".msg-role");
            if (role) role.textContent = "Error";
            bubble.innerHTML = renderMd("**Error:** " + (e.message || String(e)));
            setStatus("Failed", "error");
        }
    } finally {
        state.busy = false;
        state.abortCtrl = null;
        $("sendBtn").disabled = !$("input").value.trim();
        loadUsage();
        processQueue();
    }
}

async function loadUsage() {
    try {
        const r = await fetch("/api/ai/usage", { credentials: "same-origin", cache: "no-store" });
        const d = await r.json();
        const box = $("aiUsageStats");
        if (!box) return;
        if (!d || !d.authenticated) { box.setAttribute("hidden", ""); return; }
        const fmt = n => Number(n || 0).toLocaleString();
        const dollars = micro => { const v = (Number(micro) || 0) / 1e6; return v > 0 && v < 0.01 ? "<$0.01" : "$" + v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
        if ($("usWeek")) $("usWeek").textContent = fmt(d.weekTokens);
        if ($("usAll")) $("usAll").textContent = fmt(d.allTokens);
        if ($("usCost")) $("usCost").textContent = dollars(d.allCostMicro);
        box.removeAttribute("hidden");
    } catch (e) {}
}

async function continueMessage(assistantEl) {
    if (state.busy) return;
    const bubble = assistantEl.querySelector(".msg-bubble");
    if (!bubble) return;
    const existing = assistantEl.querySelector(":scope > .msg-actions");
    if (existing) existing.remove();

    state.busy = true;
    $("sendBtn").disabled = true;
    setStatus("Continuing…", "streaming");
    assistantEl.classList.add("streaming");

    state.abortCtrl = new AbortController();
    const base = assistantEl._raw || "";
    const needsSpace = base.length > 0 && !/\s$/.test(base);
    let tail = "";
    let contReason = "";
    const baseReason = bubble.querySelector(":scope > .ai-think .ai-think-body")?.textContent || "";
    let finishReason = null;
    let streamEnded = false;
    let renderTimer = null;
    let lastRenderAt = 0;
    const messagesEl = $("messages");
    const join = (t) => {
        let out = base;
        if (needsSpace && t && !/^\s/.test(t) && !/^[.,;:!?)\]]/.test(t)) out += " ";
        return out + t;
    };
    const scheduleRender = () => {
        if (renderTimer || streamEnded) return;
        const now = performance.now();
        const elapsed = now - lastRenderAt;
        const delay = elapsed >= 60 ? 0 : 60 - elapsed;
        renderTimer = setTimeout(() => {
            renderTimer = null;
            if (streamEnded) return;
            lastRenderAt = performance.now();
            if (contReason) paintThink(bubble, baseReason + contReason, !tail);
            ensureAnswer(bubble).innerHTML = renderMd(join(tail)) + `<span class="cursor"></span>`;
            messagesEl.scrollTop = messagesEl.scrollHeight;
        }, delay);
    };
    const updateHistory = (text) => {
        for (let i = state.history.length - 1; i >= 0; i--) {
            if (state.history[i].role === "assistant") { state.history[i].content = text; break; }
        }
    };

    const reqMessages = state.history.concat([
        { role: "user", content: "Continue your previous answer from exactly where it stopped. Do not repeat any text you already wrote." }
    ]);

    try {
        const r = await fetch("/api/ai/chat", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                model: state.model,
                messages: reqMessages,
                temperature: 0.7,
                max_completion_tokens: 4096,
                reasoning_effort: EFFORT_BY_LEVEL[state.level] || "medium",
                level: state.level
            }),
            signal: state.abortCtrl.signal
        });
        if (!r.ok) {
            let msg = `HTTP ${r.status}`;
            try { const j = await r.json(); msg = j.error || msg; } catch {}
            throw new Error(msg);
        }
        if (!r.body) throw new Error("no response body");

        const reader = r.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() || "";
            for (const line of lines) {
                if (!line.startsWith("data: ")) continue;
                const payload = line.slice(6);
                if (payload === "[DONE]") continue;
                try {
                    const evt = JSON.parse(payload);
                    if (evt.type === "reasoning" && evt.text) {
                        contReason += evt.text;
                        scheduleRender();
                    } else if (evt.type === "delta" && evt.text) {
                        tail += evt.text;
                        scheduleRender();
                    } else if (evt.type === "done") {
                        if (evt.finish) finishReason = evt.finish;
                    } else if (evt.type === "error") {
                        throw new Error(evt.error || "stream error");
                    }
                } catch (err) {
                    if (!(err instanceof SyntaxError)) throw err;
                }
            }
        }

        streamEnded = true;
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        const joined = join(tail);
        if (contReason) paintThink(bubble, baseReason + contReason, false);
        ensureAnswer(bubble).innerHTML = renderMd(joined);
        typesetMath(bubble);
        assistantEl._raw = joined;
        updateHistory(joined);
        saveHistory();
        messagesEl.scrollTop = messagesEl.scrollHeight;
        removeStaleContinue();
        attachActions(assistantEl, "assistant", { truncated: finishReason === "length" });
        setStatus("Ready");
    } catch (e) {
        streamEnded = true;
        if (renderTimer) { clearTimeout(renderTimer); renderTimer = null; }
        const joined = join(tail);
        if (contReason) paintThink(bubble, baseReason + contReason, false);
        ensureAnswer(bubble).innerHTML = renderMd(joined);
        typesetMath(bubble);
        assistantEl._raw = joined;
        if (e.name === "AbortError") {
            updateHistory(joined);
            saveHistory();
            setStatus("Stopped");
        } else {
            console.error("[ai] continue error:", e);
            setStatus("Failed", "error");
        }
        removeStaleContinue();
        attachActions(assistantEl, "assistant", { truncated: true });
    } finally {
        assistantEl.classList.remove("streaming");
        state.busy = false;
        state.abortCtrl = null;
        $("sendBtn").disabled = !$("input").value.trim();
        processQueue();
    }
}

// Sending while a reply is still streaming used to be wired up as "stop this
// response" — but Enter-to-submit reaches the form via requestSubmit(), which
// (per spec) ignores the submit button's `disabled` state that's meant to block
// this. So any Enter press during a reply — easy to do now that a search-tool
// turn takes a few seconds longer — silently killed the in-flight response and
// showed "(stopped)" instead of the answer. Queue it instead: the message waits
// and is sent automatically the moment the current reply finishes.
function refreshQueueBadge() {
    const t = $("statusTag");
    if (!t) return;
    const base = t.textContent.replace(/\s*·\s*\d+ queued$/, "");
    t.textContent = base + (state.queued.length ? ` · ${state.queued.length} queued` : "");
}
function processQueue() {
    if (state.busy || !state.queued.length) return;
    const next = state.queued.shift();
    refreshQueueBadge();
    _pendingImage = next.image || null;
    if (_pendingImage) renderImgPreview();
    streamChat(next.text);
}

$("composer").addEventListener("submit", e => {
    e.preventDefault();
    const text = $("input").value.trim();
    if (state.busy) {
        if (!text && !_pendingImage) return;
        if (gateActive()) { showGate(); return; }
        state.queued.push({ text, image: _pendingImage });
        _pendingImage = null;
        renderImgPreview();
        $("input").value = "";
        autoResize();
        refreshQueueBadge();
        return;
    }
    if (!text && !_pendingImage) return;
    if (gateActive()) { showGate(); return; }
    $("input").value = "";
    autoResize();
    $("sendBtn").disabled = true;
    streamChat(text);
});

$("input").addEventListener("input", () => {
    autoResize();
    refreshSendEnabled();
});

$("input").addEventListener("keydown", e => {
    if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        if (typeof $("composer").requestSubmit === "function") {
            $("composer").requestSubmit($("sendBtn"));
        } else if (!$("sendBtn").disabled) {
            $("sendBtn").click();
        }
    }
});

$("newChatBtn").addEventListener("click", () => {
    if (state.busy && state.abortCtrl) state.abortCtrl.abort();
    state.history = [];
    state.chatId = null;
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    renderChatList();
    $("messages").innerHTML = buildEmptyState(true);
    startEmptyTitleRotation();
    setStatus("Ready");
});

document.addEventListener("click", e => {
    const chip = e.target.closest(".quick-chip");
    if (chip) {
        $("input").value = chip.dataset.prompt;
        autoResize();
        $("sendBtn").disabled = false;
        $("input").focus();
        return;
    }
    const thinkToggle = e.target.closest(".ai-think-toggle");
    if (thinkToggle) {
        const think = thinkToggle.closest(".ai-think");
        if (think) {
            const open = think.classList.toggle("open");
            thinkToggle.setAttribute("aria-expanded", open ? "true" : "false");
            if (open) {
                const body = think.querySelector(".ai-think-body");
                if (body) body.scrollTop = body.scrollHeight;
            }
        }
        return;
    }
    const toolToggle = e.target.closest(".ai-tool-toggle");
    if (toolToggle) {
        const tool = toolToggle.closest(".ai-tool");
        if (tool) {
            const open = tool.classList.toggle("open");
            toolToggle.setAttribute("aria-expanded", open ? "true" : "false");
        }
        return;
    }
    const act = e.target.closest(".msg-act");
    if (act) {
        const msg = act.closest(".msg");
        const kind = act.dataset.act;
        if (kind === "copy") {
            const raw = (msg && msg._raw != null) ? msg._raw : (msg?.querySelector(".msg-bubble")?.innerText || "");
            navigator.clipboard?.writeText(raw).then(() => flashAct(act, "Copied")).catch(() => {});
        } else if (kind === "like") {
            act.classList.toggle("active");
            if (act.classList.contains("active")) msg?.querySelector('.msg-act[data-act="report"]')?.classList.remove("active");
        } else if (kind === "report") {
            act.classList.toggle("active");
            if (act.classList.contains("active")) msg?.querySelector('.msg-act[data-act="like"]')?.classList.remove("active");
        } else if (kind === "continue") {
            if (msg) continueMessage(msg);
        }
        return;
    }
    const cpy = e.target.closest(".code-copy");
    if (cpy) {
        try {
            const code = b64ToUtf8(cpy.dataset.c);
            navigator.clipboard?.writeText(code).then(() => {
                const orig = cpy.textContent;
                cpy.textContent = "Copied";
                setTimeout(() => { cpy.textContent = orig; }, 1400);
            });
        } catch {}
    }
});

const COMPANY_ORDER = ["Nocturne", "ChatGPT", "Claude", "Gemini", "Grok", "DeepSeek", "Perplexity", "Llama", "Mistral", "Qwen", "Kimi", "Nemotron", "MiMo", "Cohere"];
// Applies a /api/ai/config payload to the model picker. Free plans ship a single
// model, so the select is locked; paid plans get the full list back. Kept
// reversible (rather than swapping the node out) so signing in mid-session can
// unlock the picker without a page reload.
function applyModelConfig(cfg) {
    state.models = cfg.models || [{ id: "navy:gpt-5.4-mini", label: "ChatGPT 5.4 mini" }];
    const ids = state.models.map(m => m.id);
    if (cfg.modelLocked || !ids.includes(state.model)) state.model = cfg.defaultModel || ids[0];
    try { localStorage.setItem(MODEL_KEY, state.model); } catch (e) {}
    const sel = $("modelSelect");
    if (sel) {
        sel.innerHTML = buildModelOptions(state.models, state.model);
        sel.disabled = !!cfg.modelLocked;   // nocturne-select mirrors this onto the visible trigger
        sel.title = cfg.modelLocked ? "Upgrade to choose from the full model lineup" : "Model";
    }
    $("modelTag").textContent = state.model;
}
async function refreshModelConfig() {
    try {
        const r = await fetch("/api/ai/config", { cache: "no-store", credentials: "same-origin" });
        if (r.ok) applyModelConfig(await r.json());
    } catch (e) {}
}
function buildModelOptions(models, currentId) {
    const groups = {};
    for (const m of models) (groups[m.company || "Other"] ||= []).push(m);
    const cos = Object.keys(groups).sort((a, b) => {
        const ia = COMPANY_ORDER.indexOf(a), ib = COMPANY_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return cos.map(c => {
        const opts = groups[c].map(m => `<option value="${m.id}" ${m.id === currentId ? "selected" : ""}>${m.label || m.id}</option>`).join("");
        return `<optgroup label="${c}">${opts}</optgroup>`;
    }).join("");
}

$("modelSelect").addEventListener("change", () => {
    state.model = $("modelSelect").value;
    localStorage.setItem(MODEL_KEY, state.model);
    $("modelTag").textContent = state.model;
    updateAttachState();
    updateThinkLevel();
});

$("thinkLevel")?.addEventListener("click", e => {
    const seg = e.target.closest(".tl-seg");
    if (seg && seg.dataset.level) setLevel(seg.dataset.level);
});

$("attachBtn")?.addEventListener("click", () => {
    if (!state.authed) { showGate("image"); return; }
    if (!currentModelVision()) { imageHint("Pick a vision model (ChatGPT, Claude, Gemini, Grok, Llama 4) to attach images"); return; }
    $("imageInput").click();
});
$("imageInput")?.addEventListener("change", function () {
    const f = this.files && this.files[0];
    if (f) attachImageFile(f);
});
$("imgPreview")?.addEventListener("click", e => {
    if (e.target.closest(".img-chip-x")) clearPendingImage();
});
$("input").addEventListener("paste", e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const it of items) {
        if (it.type && it.type.indexOf("image/") === 0) {
            const f = it.getAsFile();
            if (f) { e.preventDefault(); attachImageFile(f); break; }
        }
    }
});

async function fetchAiConfig() {
    const headers = { Accept: "application/json" };
    try {
        const s = localStorage.getItem("noc-session");
        if (s) headers["X-Noc-Session"] = s;
    } catch (e) {}
    const rel = "/api/ai/config";
    const urls = [
        "https://d27jvgogyihpmk.cloudfront.net" + rel,
        "https://nocturne.lol" + rel
    ];
    if (location.hostname === "nocturne.lol" || location.hostname.indexOf("cloudfront") !== -1) urls.unshift(rel);
    let last = "config fetch failed";
    for (let attempt = 0; attempt < 2; attempt++) {
        const seen = new Set();
        for (const url of urls) {
            if (seen.has(url)) continue;
            seen.add(url);
            try {
                const r = await fetch(url, { cache: "no-store", credentials: "omit", headers });
                const raw = await r.text();
                let cfg = null;
                try { cfg = JSON.parse(raw); } catch (e) {}
                if (r.ok && cfg && typeof cfg.configured === "boolean") return cfg;
                last = "config fetch failed (" + r.status + ")";
            } catch (e) {
                last = e.message || last;
            }
        }
        const sw = navigator.serviceWorker;
        const regs = sw ? await sw.getRegistrations() : [];
        if (attempt === 0 && sw && (sw.controller || regs.length) && !sessionStorage.getItem("noc-ai-sw-reload")) {
            sessionStorage.setItem("noc-ai-sw-reload", "1");
            await Promise.all(regs.map(reg => reg.unregister()));
            location.reload();
            await new Promise(() => {});
        }
    }
    throw new Error(last);
}

(async function boot() {
    try {
        const cfg = await fetchAiConfig();
        if (!cfg.configured) {
            $("setupNotice").classList.remove("hidden");
            return;
        }
        applyModelConfig(cfg);
        if (cfg && (cfg.isOwner || cfg.credits || cfg.paid || !cfg.anon)) state.authed = true;
        $("chatView").classList.remove("hidden");
        updateFreeHint();

        loadHistory();
        await loadServerHistory();
        await fetchUsername();
        setupInputPlaceholder();
        renderChatList();
        if (state.history.length) {
            $("messages").innerHTML = "";
            for (const m of state.history) addMessage(m.role, m.content);
        } else {
            $("messages").innerHTML = buildEmptyState();
            startEmptyTitleRotation();
        }

        autoResize();
        setStatus("Ready");
        updateFreeHint();
        updateAttachState();
        updateThinkLevel();
        loadUsage();
    } catch (e) {
        $("setupNotice").classList.remove("hidden");
        $("setupNotice").querySelector(".setup-desc").textContent = "Failed to reach the AI API: " + e.message;
    }
})();

window.addEventListener("load", function () { try { typesetMath(document.getElementById("messages")); } catch (e) {} });

document.getElementById("csList")?.addEventListener("click", async e => {
    const delBtn = e.target.closest("[data-chat-del]");
    if (delBtn) {
        e.stopPropagation();
        const id = parseInt(delBtn.dataset.chatDel, 10);
        if (!confirm("Delete this chat?")) return;
        try {
            await fetch(`/api/ai/chats/${id}`, { method: "DELETE", credentials: "same-origin" });
        } catch {}
        if (state.chatId === id) {
            state.chatId = null;
            state.history = [];
            try { localStorage.removeItem(HISTORY_KEY); } catch {}
            $("messages").innerHTML = buildEmptyState(false);
            startEmptyTitleRotation();
        }
        await refreshChatList();
        return;
    }
    const item = e.target.closest("[data-chat-id]");
    if (item) {
        const id = parseInt(item.dataset.chatId, 10);
        if (id !== state.chatId) loadChatById(id);
    }
});

document.getElementById("csClearAll")?.addEventListener("click", async () => {
    if (!confirm("Delete all chat history? This can't be undone.")) return;
    try { await fetch("/api/ai/chats", { method: "DELETE", credentials: "same-origin" }); } catch {}
    state.chatId = null;
    state.history = [];
    state.chats = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    $("messages").innerHTML = buildEmptyState(false);
    startEmptyTitleRotation();
    renderChatList();
});

document.getElementById("searchChats")?.addEventListener("input", function () {
    state.search = this.value.trim();
    renderChatList();
});

document.getElementById("deleteCurrentBtn")?.addEventListener("click", async () => {
    if (state.busy && state.abortCtrl) state.abortCtrl.abort();
    if (state.chatId) {
        if (!confirm("Delete this chat?")) return;
        try { await fetch(`/api/ai/chats/${state.chatId}`, { method: "DELETE", credentials: "same-origin" }); } catch {}
    }
    state.chatId = null;
    state.history = [];
    try { localStorage.removeItem(HISTORY_KEY); } catch {}
    $("messages").innerHTML = buildEmptyState();
    startEmptyTitleRotation();
    await refreshChatList();
    renderChatList();
    setStatus("Ready");
});

const SIDEBAR_COLLAPSED_KEY = "nocturne-ai-sidebar-collapsed";
function setSidebarCollapsed(collapsed) {
    const sb = document.getElementById("chatSidebar");
    const exp = document.getElementById("csExpand");
    if (!sb || !exp) return;
    sb.classList.toggle("collapsed", collapsed);
    exp.classList.toggle("hidden", !collapsed);
    try { localStorage.setItem(SIDEBAR_COLLAPSED_KEY, collapsed ? "1" : "0"); } catch {}
}
document.getElementById("csCollapse")?.addEventListener("click", () => setSidebarCollapsed(true));
document.getElementById("csExpand")?.addEventListener("click", () => setSidebarCollapsed(false));
if (localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "1") {
    setSidebarCollapsed(true);
}
