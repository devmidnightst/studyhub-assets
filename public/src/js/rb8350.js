(function () {
    "use strict";

    const $ = id => document.getElementById(id);
    const streamEl = $("stream"), roomListEl = $("roomList"), dmListEl = $("dmList"), roomsEl = $("rooms");
    const composer = $("composer"), input = $("chatInput"), sendBtn = $("sendBtn");
    const notice = $("notice"), gate = $("gate"), toastEl = $("toast"), charCount = $("charCount");
    const onlineCount = $("onlineCount"), ctxMenu = $("ctxMenu");
    const composeCtx = $("composeCtx"), ccLabel = $("ccLabel"), ccText = $("ccText");
    const convoBar = $("convoBar"), dmTotalEl = $("dmTotal");

    const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';
    const I = {
        reply: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 17 4 12 9 7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>',
        edit: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.1 2.1 0 0 1 3 3L12 15l-4 1 1-4z"/></svg>',
        forward: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>',
        trash: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
        smile: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M8 14s1.5 2 4 2 4-2 4-2"/><line x1="9" y1="9" x2="9.01" y2="9"/><line x1="15" y1="9" x2="15.01" y2="9"/></svg>',
        dots: '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.7"/><circle cx="12" cy="12" r="1.7"/><circle cx="19" cy="12" r="1.7"/></svg>',
        fwdLabel: '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 17 20 12 15 7"/><path d="M4 18v-2a4 4 0 0 1 4-4h12"/></svg>'
    };
    const ROOM_KEY = "nocturne:chatroom";
    const GROUP_GAP_MS = 5 * 60 * 1000, DAY_MS = 24 * 60 * 60 * 1000;

    const state = {
        rooms: [], room: "general", streamRoom: null,
        mode: "room", dm: null, gems: 0,
        me: { username: null, userId: null, avatar: null },
        maxLen: 1000, reactionEmojis: ["\u{1F44D}", "❤️", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F525}", "\u{1F389}", "\u{1F44E}"],
        seen: new Set(), lastId: 0, es: null, pollTimer: 0,
        lastMsg: null, lastDay: null, replyingTo: null, editingId: null,
        giphy: false, dmFilter: { off: false, pendingFromMe: false, pendingFromOther: false }, notif: false
    };
    const msgEls = new Map(), msgData = new Map(), msgReactions = new Map(), reactedByMe = new Map();
    const dmThreads = new Map();

    function paintGemBal() {
        let el = document.getElementById('gemBal');
        if (!el) {
            el = document.createElement('span');
            el.id = 'gemBal';
            el.className = 'ge-bal';
            const chip = document.getElementById('onlineChip');
            if (chip) chip.parentNode.insertBefore(el, chip);
        }
        el.innerHTML = '<span class="ge-ico">💎</span>' + (state.gems || 0).toLocaleString();
    }

    function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
    function fmtTime(ts) { try { return new Date(ts).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); } catch { return ""; } }
    function dayKey(ts) { const d = new Date(ts); return d.getFullYear() + "-" + d.getMonth() + "-" + d.getDate(); }
    function fmtDay(ts) {
        const d = new Date(ts), now = new Date();
        const diff = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() - new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
        if (diff === 0) return "Today";
        if (diff === DAY_MS) return "Yesterday";
        try { return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" }); } catch { return d.toDateString(); }
    }
    function colorFor(name) { let h = 0; const s = String(name || "?"); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return `linear-gradient(135deg, hsl(${h} 62% 72%), hsl(${(h + 40) % 360} 60% 60%))`; }
    function initial(name) { return String(name || "?").trim().charAt(0).toUpperCase() || "?"; }
    function isMine(m) { return state.me.userId != null && m.userId === state.me.userId; }
    function keyUser(m) { return m.userId == null ? "@" + m.username : m.userId; }
    function avInto(el, name, avatar) { el.style.background = colorFor(name); if (avatar) el.innerHTML = '<img src="' + esc(avatar) + '" alt="">'; else el.textContent = initial(name); }
    function nearBottom() { return streamEl.scrollHeight - streamEl.scrollTop - streamEl.clientHeight < 130; }
    function scrollToBottom(force) {
        if (!force && !nearBottom()) return;
        const pin = () => { streamEl.scrollTop = streamEl.scrollHeight; };
        pin();
        requestAnimationFrame(pin);
        setTimeout(pin, 80);
    }
    function dmToMsg(m) { return { id: m.id, userId: m.senderId, username: m.username, avatar: m.avatar, text: m.text, ts: m.ts, edited: m.edited, deleted: m.deleted, replyTo: m.replyTo, reactions: {}, fwd: null }; }
    function inOpenDm(otherId) { return state.mode === "dm" && state.dm && state.dm.otherId === otherId; }

    let toastTimer = 0;
    function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.classList.remove("show"), 2800); }

    function resetStream() { streamEl.innerHTML = ""; state.lastMsg = null; state.lastDay = null; msgEls.clear(); msgData.clear(); msgReactions.clear(); reactedByMe.clear(); }
    function showEmpty(html) { streamEl.innerHTML = '<div class="stream-empty">' + html + "</div>"; }
    function removeEmpty() { const e = streamEl.querySelector(".stream-empty"); if (e) { e.remove(); state.lastMsg = null; } }
    function ensureDay(ts) {
        const dk = dayKey(ts); if (dk === state.lastDay) return;
        const div = document.createElement("div"); div.className = "day-divider"; div.innerHTML = "<span>" + esc(fmtDay(ts)) + "</span>";
        streamEl.appendChild(div); state.lastDay = dk; state.lastMsg = null;
    }
    const GIF_RE = /^https:\/\/[\w.-]*\.giphy\.com\/\S+$/i;
    const URL_G = /\bhttps?:\/\/[^\s<]+/gi;
    function isImageUrl(u) { return /\.(?:png|jpe?g|gif|webp|avif|bmp)(?:[?#]|$)/i.test(u); }
    const MENTION_G = /@([a-zA-Z0-9_-]{3,32}|everyone|here)/g;

    function appendMentionText(parent, str) {
        let last = 0, m; MENTION_G.lastIndex = 0;
        const myName = (state.me && state.me.username || "").toLowerCase();
        while ((m = MENTION_G.exec(str))) {
            if (m.index > last) parent.appendChild(document.createTextNode(str.slice(last, m.index)));
            const nm = m[1].toLowerCase();
            const span = document.createElement("span");
            span.className = "mention" + ((nm === "everyone" || nm === "here") ? " mention-all" : "");
            if (myName && (nm === myName || nm === "everyone" || nm === "here")) span.classList.add("mention-me");
            span.textContent = m[0];
            parent.appendChild(span);
            last = m.index + m[0].length;
        }
        if (last < str.length) parent.appendChild(document.createTextNode(str.slice(last)));
    }
    function setText(txtEl, m) {
        txtEl.style.display = ""; txtEl.innerHTML = "";
        if (m.deleted) { txtEl.textContent = "message deleted"; return; }
        const text = m.text || "", trimmed = text.trim();

        if (!/\s/.test(trimmed) && (GIF_RE.test(trimmed) || isImageUrl(trimmed))) { txtEl.style.display = "none"; return; }
        let last = 0, mm; URL_G.lastIndex = 0;
        while ((mm = URL_G.exec(text))) {
            if (mm.index > last) appendMentionText(txtEl, text.slice(last, mm.index));
            const a = document.createElement("a"); a.href = mm[0]; a.textContent = mm[0]; a.target = "_blank"; a.rel = "noopener noreferrer"; a.className = "msg-link"; txtEl.appendChild(a);
            last = mm.index + mm[0].length;
        }
        if (last < text.length) appendMentionText(txtEl, text.slice(last));
        if (m.edited) { const s = document.createElement("span"); s.className = "edited"; s.textContent = "(edited)"; txtEl.append(" ", s); }
    }
    function mediaImg(url, isGif) {
        const img = document.createElement("img"); img.className = isGif ? "msg-gif" : "msg-img"; img.src = url; img.alt = isGif ? "GIF" : "image"; img.loading = "lazy";
        img.onclick = () => openMediaViewer(url, isGif);
        return img;
    }
    const unfurlCache = new Map();
    async function unfurlInto(url, box) {
        const card = document.createElement("a"); card.className = "link-card"; card.href = url; card.target = "_blank"; card.rel = "noopener noreferrer"; card.style.display = "none";
        box.appendChild(card);
        let data = unfurlCache.get(url);
        if (data === undefined) {
            try { const r = await fetch("/api/chat/unfurl?url=" + encodeURIComponent(url), { credentials: "same-origin" }); data = r.ok ? await r.json() : null; } catch { data = null; }
            unfurlCache.set(url, data);
        }
        if (!card.isConnected || !data || !data.ok || (!data.title && !data.image)) { card.remove(); return; }
        let host = url; try { host = new URL(url).hostname.replace(/^www\./, ""); } catch {}
        card.innerHTML = (data.image ? '<div class="lc-img"></div>' : "") + '<div class="lc-body"><div class="lc-site"></div><div class="lc-title"></div><div class="lc-desc"></div></div>';
        if (data.image) card.querySelector(".lc-img").style.backgroundImage = 'url("' + data.image.replace(/"/g, "%22") + '")';
        card.querySelector(".lc-site").textContent = data.siteName || host;
        card.querySelector(".lc-title").textContent = data.title || url;
        const desc = card.querySelector(".lc-desc"); if (data.description) desc.textContent = data.description; else desc.remove();
        card.style.display = "flex";
    }
    function renderEmbeds(box, m) {
        box.innerHTML = "";
        if (m.deleted) return;
        const urls = (m.text || "").match(URL_G) || [];
        const seen = new Set(); let count = 0;
        for (const url of urls) {
            if (seen.has(url) || count >= 4) continue; seen.add(url); count++;
            if (GIF_RE.test(url)) box.appendChild(mediaImg(url, true));
            else if (isImageUrl(url)) box.appendChild(mediaImg(url, false));
            else unfurlInto(url, box);
        }
    }
    function renderMsgBody(el, m) {
        setText(el.querySelector(".msg-text"), m);
        const box = el.querySelector(".msg-embeds"); if (box) renderEmbeds(box, m);
    }
    function buildReply(rt) {
        const r = document.createElement("div"); r.className = "msg-reply"; r.dataset.jump = rt.id;
        r.innerHTML = '<b>' + esc(rt.username) + '</b><span class="rt">' + (rt.deleted ? "<i>deleted message</i>" : esc(rt.text || "")) + "</span>";
        return r;
    }
    function buildMessage(m) {
        const el = document.createElement("div");
        el.className = "msg" + (isMine(m) ? " own" : "") + (m.deleted ? " deleted" : "");
        el.dataset.id = m.id; el.dataset.user = keyUser(m);
        const av = document.createElement("div"); av.className = "msg-avatar"; avInto(av, m.username, m.avatar);
        const main = document.createElement("div"); main.className = "msg-main";
        const head = document.createElement("div"); head.className = "msg-head";
        const nameStyle = m.roleColor ? ' style="color:' + esc(m.roleColor) + '"' : '';
        const badge = m.role ? '<span class="msg-role" style="' + (m.roleColor ? 'color:' + esc(m.roleColor) + ';border-color:' + esc(m.roleColor) + '55' : '') + '">' + esc(m.role) + '</span>' : '';
        head.innerHTML = '<span class="msg-name"' + nameStyle + '>' + esc(m.username) + '</span>' + badge + '<span class="msg-time">' + esc(fmtTime(m.ts)) + "</span>";
        main.appendChild(head);
        if (m.fwd) { const f = document.createElement("div"); f.className = "msg-fwd"; f.innerHTML = I.fwdLabel + " Forwarded from <b>" + esc(m.fwd.username) + "</b> in #" + esc(m.fwd.room); main.appendChild(f); }
        if (m.replyTo) main.appendChild(buildReply(m.replyTo));
        const txt = document.createElement("div"); txt.className = "msg-text"; setText(txt, m); main.appendChild(txt);
        const embeds = document.createElement("div"); embeds.className = "msg-embeds"; renderEmbeds(embeds, m); main.appendChild(embeds);
        const reacts = document.createElement("div"); reacts.className = "msg-reactions"; main.appendChild(reacts);
        if (!m.deleted) {
            const acts = document.createElement("div"); acts.className = "msg-actions";
            acts.innerHTML = '<button class="msg-act" data-act="react" title="React" aria-label="React">' + I.smile + '</button><button class="msg-act" data-act="reply" title="Reply" aria-label="Reply">' + I.reply + '</button><button class="msg-act" data-act="more" title="More" aria-label="More">' + I.dots + "</button>";
            el.appendChild(acts);
        }
        el.appendChild(av); el.appendChild(main);
        msgEls.set(m.id, el); msgData.set(m.id, m);
        renderReactions(m.id);
        return el;
    }
    function seedReactions(m) {
        const counts = {}, mine = new Set(), rx = m.reactions || {};
        for (const e in rx) { counts[e] = rx[e].count; if (rx[e].me) mine.add(e); }
        msgReactions.set(m.id, counts); reactedByMe.set(m.id, mine);
    }
    function renderReactions(id) {
        const el = msgEls.get(id); if (!el) return;
        const box = el.querySelector(".msg-reactions"); if (!box) return;
        const counts = msgReactions.get(id) || {}, mine = reactedByMe.get(id) || new Set();
        box.innerHTML = "";
        let any = false;
        for (const emoji of Object.keys(counts)) {
            if (!counts[emoji]) continue;
            any = true;
            const pill = document.createElement("button");
            pill.className = "reaction" + (mine.has(emoji) ? " me" : "");
            pill.dataset.react = emoji; pill.dataset.id = id;
            pill.innerHTML = "<span>" + emoji + '</span><span class="rc">' + counts[emoji] + "</span>";
            box.appendChild(pill);
        }
        if (any && state.mode === "room") {
            const add = document.createElement("button");
            add.className = "reaction-add"; add.type = "button"; add.dataset.reactAdd = id;
            add.title = "Add reaction"; add.setAttribute("aria-label", "Add reaction");
            add.innerHTML = I.smile;
            box.appendChild(add);
        }
    }
    function appendMessage(m) {
        if (state.seen.has(m.id)) return;
        state.seen.add(m.id);
        if (m.id > state.lastId) state.lastId = m.id;
        removeEmpty(); ensureDay(m.ts);
        const grouped = state.lastMsg && state.lastMsg.user === keyUser(m) && (m.ts - state.lastMsg.ts) < GROUP_GAP_MS && !m.fwd && !m.replyTo;
        seedReactions(m);
        const el = buildMessage(m);
        if (grouped) el.classList.add("grouped");
        if (document.hidden) el.style.animation = "none";
        streamEl.appendChild(el);
        state.lastMsg = { user: keyUser(m), ts: m.ts };
    }
    function flash(id) {
        const el = msgEls.get(id); if (!el) return;
        el.scrollIntoView({ block: "center" });
        el.style.transition = "background 0.3s"; el.style.background = "color-mix(in srgb, var(--accent) 22%, transparent)";
        setTimeout(() => { el.style.background = ""; }, 700);
    }
    function onEdit(d) { const m = msgData.get(d.id); if (!m) return; m.text = d.text; m.edited = true; const el = msgEls.get(d.id); if (el) renderMsgBody(el, m); }
    function onDelete(id) {
        const m = msgData.get(id), el = msgEls.get(id);
        if (m) { m.deleted = true; m.text = null; }
        if (el) { el.classList.add("deleted"); setText(el.querySelector(".msg-text"), { deleted: true }); const a = el.querySelector(".msg-actions"); if (a) a.remove(); const r = el.querySelector(".msg-reactions"); if (r) r.innerHTML = ""; const emb = el.querySelector(".msg-embeds"); if (emb) emb.innerHTML = ""; }
        msgReactions.delete(id); reactedByMe.delete(id);
    }
    function onReact(d) { msgReactions.set(d.id, d.counts || {}); renderReactions(d.id); }
    function onAvatar(d) {
        if (state.me.userId === d.userId) { state.me.avatar = d.avatar; paintMe(); }
        msgEls.forEach((el, id) => { const m = msgData.get(id); if (m && m.userId === d.userId) { m.avatar = d.avatar; avInto(el.querySelector(".msg-avatar"), m.username, d.avatar); } });
        const t = dmThreads.get(d.userId); if (t) { t.avatar = d.avatar; renderThreads(); }
        if (state.mode === "dm" && state.dm && state.dm.otherId === d.userId) { state.dm.avatar = d.avatar; paintConvoBar(); }
    }

    function clearNotice() { notice.className = "chat-notice"; notice.innerHTML = ""; }
    function showNotice(kind, headHtml, bodyHtml, metaHtml) {
        notice.className = "chat-notice show " + kind;
        notice.innerHTML = '<div class="cn-head">' + headHtml + '<button class="cn-x" type="button" aria-label="Dismiss">&times;</button></div><div class="cn-body">' + bodyHtml + "</div>" + (metaHtml ? '<div class="cn-meta">' + metaHtml + "</div>" : "");
        notice.querySelector(".cn-x").onclick = clearNotice;
    }
    function showBlocked(data) {
        const warn = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>';
        if (data.support) {
            const heart = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z"/></svg>';
            showNotice("support", heart + "You're not alone", esc(data.support));
        } else {
            const cat = data.category && data.category !== "none" ? data.category.replace(/_/g, " ") : "unsafe content";
            showNotice("block", warn + "Message not sent", esc(data.reason || "This message was flagged."), "Flagged as <b>" + esc(cat) + "</b> &middot; risk " + (data.score | 0) + "/100");
        }
    }

    async function loadMessages() {
        clearTyping();
        const url = state.mode === "dm"
            ? "/api/dm/with/" + state.dm.otherId + "/messages?limit=60"
            : "/api/chat/messages?room=" + encodeURIComponent(state.room) + "&limit=60";
        try {
            const r = await fetch(url, { credentials: "same-origin" });
            if (r.status === 401) { showGate(); return; }
            const data = await r.json();
            resetStream(); state.seen.clear(); state.lastId = 0;
            const msgs = (data.messages || []).map(m => state.mode === "dm" ? dmToMsg(m) : m);
            if (!msgs.length) {
                if (state.mode === "dm") showEmpty('<div class="se-ico">&#9993;</div><div class="se-title">No messages yet</div><div class="se-sub">Say hi to ' + esc(state.dm.username) + ".</div>");
                else showEmpty('<div class="se-ico">&#128172;</div><div class="se-title">No messages yet</div><div class="se-sub">Be the first to say something in #' + esc(state.room) + ".</div>");
            } else { msgs.forEach(appendMessage); scrollToBottom(true); }
            if (state.mode === "dm") {
                const t = dmThreads.get(state.dm.otherId); if (t && t.unread) { t.unread = 0; renderThreads(); refreshDmTotal(); }
                if (data.filter) { state.dmFilter = data.filter; applyFilterUI(); }
            } else { loadGiveaways(); }
        } catch { toast("Couldn't load messages."); }
    }

    function stopStream() { if (state.es) { try { state.es.close(); } catch {} state.es = null; } if (state.pollTimer) { clearInterval(state.pollTimer); state.pollTimer = 0; } }
    function connectStream() {
        stopStream();
        state.streamRoom = state.room;
        let es;
        try { es = new EventSource("/api/chat/stream?room=" + encodeURIComponent(state.room)); } catch { startPolling(); return; }
        state.es = es;
        es.onmessage = ev => {
            let d; try { d = JSON.parse(ev.data); } catch { return; }
            if (d.type === "message") { if (state.mode === "room" && d.message && d.message.room === state.room) { appendMessage(d.message); scrollToBottom(true); } }
            else if (d.type === "edit") { if (state.mode === "room") onEdit(d); }
            else if (d.type === "delete") { if (state.mode === "room") onDelete(d.id); }
            else if (d.type === "react") { if (state.mode === "room") onReact(d); }
            else if (d.type === "system") { if (state.mode === "room") appendSystemLine(d.text); }
            else if (d.type === "purge") onPurge(d);
            else if (d.type === "giveaway") appendGiveawayCard(d.gw);
            else if (d.type === "giveaway-update") updateGiveaway(d.id, { entries: d.entries });
            else if (d.type === "giveaway-end") updateGiveaway(d.id, { status: "ended", winner: d.winner });
            else if (d.type === "game") { appendGameCard(d); return; }
            else if (d.type === "avatar") onAvatar(d);
            else if (d.type === "dm") onDm(d);
            else if (d.type === "dm-edit") { if (inOpenDm(d.otherId)) onEdit({ id: d.id, text: d.text }); }
            else if (d.type === "dm-delete") { if (inOpenDm(d.otherId)) onDelete(d.id); }
            else if (d.type === "dm-filter") { if (inOpenDm(d.otherId)) { state.dmFilter = d.filter || state.dmFilter; applyFilterUI(); if (d.action === "accept-off") toast("Profanity filter turned off for this chat."); else if (d.action === "on" || d.action === "decline-off") toast("Profanity filter is on for this chat."); } }
            else if (d.type === "presence") onPresence(d);
            else if (d.type === "typing") onTyping(d);
            else if (d.type === "mention") onMention(d);
        };
        es.onerror = () => { if (!state.pollTimer) startPolling(); };
    }
    function startPolling() {
        if (state.pollTimer) return;
        state.pollTimer = setInterval(async () => {
            if (state.mode !== "room") return;
            try {
                const r = await fetch("/api/chat/messages?room=" + encodeURIComponent(state.room) + "&after=" + state.lastId, { credentials: "same-origin" });
                if (!r.ok) return;
                const data = await r.json();
                if (data.messages && data.messages.length) { data.messages.forEach(appendMessage); scrollToBottom(true); }
            } catch {}
        }, 3500);
    }

    function onDm(d) {
        const m = d.message, otherId = d.otherId, mine = state.me.userId === m.senderId;

        let t = dmThreads.get(otherId);
        const preview = m.deleted ? "message deleted" : (GIF_RE.test((m.text || "").trim()) ? "GIF" : (m.text || ""));
        if (!t) { t = { otherId, username: mine ? (state.dm && state.dm.otherId === otherId ? state.dm.username : "user") : m.username, avatar: mine ? null : m.avatar, lastText: preview, lastTs: m.ts, unread: 0 }; dmThreads.set(otherId, t); }
        else { t.lastText = preview; t.lastTs = m.ts; if (!mine) t.avatar = m.avatar; }
        if (inOpenDm(otherId)) {
            appendMessage(dmToMsg(m)); scrollToBottom(true);
            t.unread = 0;
            if (!mine) { try { fetch("/api/dm/with/" + otherId + "/read", { method: "POST", credentials: "same-origin" }); } catch {} }
        } else if (!mine) { t.unread = (t.unread || 0) + 1; }
        if (!mine) maybeNotify(m, t.username);
        renderThreads(); refreshDmTotal();
    }
    function refreshDmTotal() {
        let n = 0; dmThreads.forEach(t => n += (t.unread || 0));
        if (n > 0) { dmTotalEl.textContent = n > 99 ? "99+" : n; dmTotalEl.hidden = false; } else dmTotalEl.hidden = true;
    }

    var _ck = (function(){
        var _h = function(s){var h=0;for(var i=0;i<s.length;i++){h=((h<<5)-h)+s.charCodeAt(i);h|=0;}return h;};
        var _b = "MzQ0NjkwNywxMDY4NTQyMjgsMTU5NjcyMzUxOSwtMzkyMzA0OTk4LDcyMzc3Mzc3MywxMTM3NjYsMTk4OTYzNTE1NiwtOTA1NjQ4ODM4LDE1NDk4MzEyMzksMTk4OTMwMzc3OSwzNTI2ODY3LC0xMjIwODY4MzczLDMzOTA4MDYsMzM5MjY0OCwxMDUxNzIyMDMsLTEwMzQ2MjUwMDcsMTA0NTgzMDk1LDkzOTIxNjgzLDY0NDE3NzgzLDM1NjAzNzIsLTEzMDcwMDYyMDYsLTIwODQyODA1LDY5MjgwMTc3NCwtNjY4ODcyODE2LC0xNzM4MjcyNTY1LC0xNTU4MDc4NTc0LDE4MjAyMTk4NTAsMjMyNzU5MjA4LDE1NTA2ODAyMzAsMzcwMTQ3NCwzNzIwNzg3LC0xNDE4NzgyNDczLDk2MzIzMzk4LDMzNTE1NzQsOTU1ODcxNTQsMTEwNTczODI2NSwxNDkzMjAwNTQ2LC0xMDA4Njg0Nzc3LC0xNTgwNjgwNjM4LDEzODQzMzcwNjEsMTM4NDMzNzAyMywxMDExNDEsLTEwODAwMDIwNDEsMTEyMjM1NTEyNSwxMTIyMTc3Mjk2LC0xMzQ5Mjc0MTkxLDE1NDM4NTcxOTgsNjM1NDYyMDQsMzAxOTI5MiwtMTI3ODE3MTQwNCwxMTEyODg4MjA1LC05MDcwMTQwMCwxODMyMTg2MTk5LDE5MzU0NDA5ODcsLTgxMDUxMTEzNCwtMjIwMjg5NzA0LDU0OTQxNTY1OSwtMjA2ODU2MTU1NiwtNjg4NjM5ODk5LC0xODc1NDQ5NzYsMTUxMTc3Mzg1OCwxMDI0MTI3ODM5LC0xMTQxNjk1MzMyLDMwNDU5NTcsLTEwODAzMjY5MTMsLTE2OTA0MTg3MzYsMzY4NDQ3MCwtNjIzODIyODcwLDEwODM2NzIyMTMsLTk5MTg2OTY3MCwxMTA3MTEzNDgsLTYzMzAyMDM5MSwtMTUzODkyNzg1OSwtMTE4MTgyMTQxMiwxOTMwNDg5NTA0LDMwMTk4MTMsLTEzNjQyMDU5LC0xODYyMzczMjY4LC0xMzM3NTQyODA0LDcxMTg4MDEzNCwtOTE5ODc2MDAzLDMwNjIzODQsMTc1MDI2NzEyNywxNjE5MDE0MjkyLDE5MTUyNTYwMjUsLTEyMjQ1NzI2NjAsMTc3MjI5MDA0Myw5NzE5NTEzMCwtMTczMTg1ODU2MiwyMTAxMDE5OTQ5LC0xODkwMzAzMjY4LDk2NDMwMTcz";
        var _s; try{_s=new Set(atob(_b).split(",").map(Number));}catch(e){_s=new Set();}
        return function(t){
            if(!t)return false;
            var n=t.replace(/0/g,"o").replace(/1/g,"i").replace(/3/g,"e").replace(/4/g,"a").replace(/5/g,"s").replace(/\$/g,"s").replace(/@/g,"a").replace(/\+/g,"t").toLowerCase();
            var w=n.match(/[a-z]+/g);
            if(!w)return false;
            for(var i=0;i<w.length;i++){if(_s.has(_h(w[i])))return true;}
            return false;
        };
    })();

    let sending = false;
    function setSending(on) { sending = on; sendBtn.classList.toggle("busy", on); sendBtn.innerHTML = on ? '<span class="spin"></span>' : SEND_ICON; if (!on) syncSendState(); }
    function isOwner() { return !!(state.me && state.me.perm === "owner"); }
    function canRunCommands() { return !!(state.me && state.me.userId); }
    async function submit() {
        if (sending) return;
        const text = input.value.trim(); if (!text) return;
        if (state.mode === "room" && text[0] === "/" && canRunCommands()) {
            input.value = ""; autoGrow(); updateCount(); syncSendState();
            await runCommand(text);
            return;
        }
        setSending(true); sendBtn.disabled = true;
        try { if (state.editingId != null) await doEdit(text); else await doSend(text); }
        catch { toast("Network error - try again."); }
        finally { setSending(false); input.focus(); }
    }
    async function doSend(text) {
        if (!isOwner() && _ck(text)) { toast("That message contains blocked content."); return; }
        let url, body;
        if (state.mode === "dm") { url = "/api/dm/with/" + state.dm.otherId + "/send"; body = { text }; }
        else { url = "/api/chat/send"; body = { room: state.room, text }; }
        if (state.replyingTo) body.replyTo = state.replyingTo.id;
        const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
        const data = await r.json().catch(() => ({}));
        if (r.status === 401) { showGate(); return; }
        if (r.status === 429) { toast(data.error || "Slow down a moment."); return; }
        if (!r.ok) { toast(data.error || "Couldn't send."); return; }
        if (data.timeout) { showTimeoutNotice(data); input.focus(); return; }
        if (data.blocked) { showBlocked(data); input.focus(); return; }
        clearNotice(); cancelReply(); input.value = ""; autoGrow(); updateCount();
        if (data.message) {
            if (state.mode === "dm") { appendMessage(dmToMsg(data.message)); bumpThreadLocal(state.dm.otherId, data.message.text); }
            else appendMessage(data.message);
            scrollToBottom(true);
        }
    }

    function fmtDur(ms) {
        const s = Math.max(0, Math.round(ms / 1000));
        if (s < 60) return s + "s";
        const m = Math.floor(s / 60), ss = s % 60;
        if (m < 60) return m + "m" + (ss ? " " + ss + "s" : "");
        const h = Math.floor(m / 60), mm = m % 60;
        if (h < 24) return h + "h" + (mm ? " " + mm + "m" : "");
        return Math.floor(h / 24) + "d";
    }
    function openCrashPanel(seed) {
        let overlay = document.getElementById("crashOverlay");
        if (overlay) overlay.remove();
        overlay = document.createElement("div");
        overlay.id = "crashOverlay";
        overlay.className = "crash-overlay";
        overlay.innerHTML = '<div class="crash-panel" role="dialog" aria-label="Crash">'
            + '<header class="crash-top"><div><div class="crash-kicker">Crash</div><div class="crash-title">Cash out before it crashes</div></div><button type="button" class="crash-x" aria-label="Close">&times;</button></header>'
            + '<div class="crash-stage"><canvas class="crash-graph" width="640" height="280"></canvas><div class="crash-readout"><b class="crash-live">1.00x</b><span class="crash-sub">waiting</span></div></div>'
            + '<div class="crash-history"></div>'
            + '<div class="crash-controls">'
            + '<label>Bet<input class="crash-bet" inputmode="numeric" placeholder="100"></label>'
            + '<label>Auto<input class="crash-auto" inputmode="decimal" placeholder="2.00"></label>'
            + '<button type="button" class="crash-go">Start</button>'
            + '<button type="button" class="crash-out" disabled>Cash out</button>'
            + '</div>'
            + '<div class="crash-fair">'
            + '<div class="crash-fair-title">Provably fair · max 25.00x</div>'
            + '<label>Client seed<input class="crash-cseed" maxlength="32" spellcheck="false"></label>'
            + '<div class="crash-meta"><span class="crash-hash"></span><span class="crash-nonce"></span></div>'
            + '<p class="crash-formula">HMAC-SHA256(server seed, client seed:nonce). The first 52 bits pick the point. One hash in twenty crashes at 1.00x. The point is capped at 25.00x. The hash is locked before the round, and the server seed is shown after it ends.</p>'
            + '<div class="crash-reveal" hidden></div>'
            + '</div></div>';
        document.body.appendChild(overlay);
        overlay.addEventListener("click", e => { if (e.target === overlay) overlay.remove(); });
        overlay.querySelector(".crash-x").onclick = () => overlay.remove();

        const live = overlay.querySelector(".crash-live");
        const sub = overlay.querySelector(".crash-sub");
        const canvas = overlay.querySelector(".crash-graph");
        const ctx = canvas.getContext("2d");
        const betEl = overlay.querySelector(".crash-bet");
        const autoEl = overlay.querySelector(".crash-auto");
        const seedEl = overlay.querySelector(".crash-cseed");
        const go = overlay.querySelector(".crash-go");
        const out = overlay.querySelector(".crash-out");
        const hashEl = overlay.querySelector(".crash-hash");
        const nonceEl = overlay.querySelector(".crash-nonce");
        const histEl = overlay.querySelector(".crash-history");
        const revealEl = overlay.querySelector(".crash-reveal");
        let fair = (seed && seed.fair) || {};
        let active = (seed && seed.active) || null;
        let raf = 0;
        let points = [];
        let ended = false;
        const growth = () => Number(fair.growth) || 0.06;
        const maxM = () => Number(fair.max) || 25;
        const multAt = (elapsed) => {
            const raw = Math.exp(growth() * Math.max(0, elapsed) / 1000);
            return Math.min(maxM(), Math.floor(raw * 100) / 100);
        };
        function paintHistory(list) {
            histEl.innerHTML = "";
            (list || []).slice(-12).forEach(h => {
                const b = document.createElement("span");
                const p = Number(h.crashPoint) || 1;
                b.className = "crash-pill" + (p >= 10 ? " hot" : (p >= 2 ? " ok" : ""));
                b.textContent = p.toFixed(2) + "x";
                histEl.appendChild(b);
            });
        }
        function paintFair() {
            const hash = (active && active.serverSeedHash) || fair.serverSeedHash || "";
            hashEl.textContent = hash ? ("Server hash " + hash.slice(0, 18) + "…" + hash.slice(-6)) : "Server hash pending";
            nonceEl.textContent = "Nonce " + ((active && active.nonce != null) ? active.nonce : (fair.nonce != null ? fair.nonce : "—"));
            if (!active && fair.clientSeed && document.activeElement !== seedEl) seedEl.value = fair.clientSeed;
            paintHistory(fair.history);
        }
        function draw(mult, tone) {
            const w = canvas.width, h = canvas.height;
            ctx.clearRect(0, 0, w, h);
            ctx.fillStyle = "#07080f";
            ctx.fillRect(0, 0, w, h);
            ctx.strokeStyle = "rgba(200,195,230,0.12)";
            ctx.lineWidth = 1;
            for (let i = 1; i <= 4; i++) {
                const y = h - (h - 28) * (i / 4);
                ctx.beginPath(); ctx.moveTo(12, y); ctx.lineTo(w - 12, y); ctx.stroke();
            }
            if (points.length < 2) return;
            const maxY = Math.max(2, mult, ...points.map(p => p.m));
            ctx.beginPath();
            points.forEach((p, i) => {
                const x = 16 + (w - 32) * (i / (points.length - 1));
                const y = h - 16 - (h - 36) * ((p.m - 1) / (maxY - 1));
                if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            });
            ctx.strokeStyle = tone;
            ctx.lineWidth = 3;
            ctx.stroke();
        }
        function stopLoop() { if (raf) cancelAnimationFrame(raf); raf = 0; }
        function frame() {
            if (!active || ended) return;
            const m = multAt(Date.now() - active.startedAt);
            live.textContent = m.toFixed(2) + "x";
            sub.textContent = active.auto ? ("auto " + Number(active.auto).toFixed(2) + "x") : "rising";
            points.push({ m });
            if (points.length > 240) points.shift();
            draw(m, "#8ad6a0");
            out.disabled = m < 1.01;
            out.textContent = m >= 1.01 ? ("Cash out " + Math.floor(active.bet * m).toLocaleString()) : "Cash out";
            raf = requestAnimationFrame(frame);
        }
        function betValue() {
            const t = betEl.value.trim().toLowerCase();
            if (t === "all" || t === "max") return state.gems || 0;
            return parseInt(t, 10);
        }
        function showEnd(result) {
            if (!result || ended) return;
            ended = true;
            active = null;
            stopLoop();
            const point = Number(result.crashPoint) || 1;
            const shown = result.multiplier ? Number(result.multiplier) : point;
            live.textContent = shown.toFixed(2) + "x";
            live.className = "crash-live " + (result.won ? "win" : (result.push ? "push" : "loss"));
            sub.textContent = result.won ? "cashed out" : (result.push ? "stake returned" : ("crashed at " + point.toFixed(2) + "x"));
            draw(point, result.won ? "#8ad6a0" : "#ff8f8f");
            go.disabled = false;
            out.disabled = true;
            betEl.disabled = false;
            autoEl.disabled = false;
            seedEl.disabled = false;
            revealEl.hidden = false;
            const seedText = result.serverSeed || "";
            revealEl.innerHTML = '<div><b>Server seed</b> <code>' + esc(seedText) + '</code></div><div><b>HMAC</b> <code>' + esc(result.hmac || "") + '</code></div><div class="crash-check">Checking the hash…</div>';
            verifyRound(result).then(ok => {
                const el = revealEl.querySelector(".crash-check");
                if (!el) return;
                el.textContent = ok.ok ? ("Fair. This seed crashes at " + ok.point.toFixed(2) + "x.") : "The revealed seed does not match this crash point.";
            });
            if (result.nextServerSeedHash) {
                fair.serverSeedHash = result.nextServerSeedHash;
                fair.nonce = (Number(result.nonce) || 0) + 1;
            }
            fair.history = (fair.history || []).concat([{ crashPoint: point, won: !!result.won }]).slice(-12);
            paintFair();
            if (result.balance != null) { state.gems = result.balance; paintGemBal(); }
        }
        window.__crashSettle = showEnd;
        async function verifyRound(result) {
            try {
                const enc = new TextEncoder();
                const key = await crypto.subtle.importKey("raw", enc.encode(result.serverSeed), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
                const sig = await crypto.subtle.sign("HMAC", key, enc.encode(result.clientSeed + ":" + result.nonce));
                const hash = [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
                const hv = BigInt("0x" + hash.slice(0, 13));
                let point = 1;
                if (hv % 20n !== 0n) {
                    const e = 1n << 52n;
                    let raw = (100n * e - hv) / (e - hv);
                    if (raw > 2500n) raw = 2500n;
                    if (raw < 100n) raw = 100n;
                    point = Number(raw) / 100;
                }
                return { ok: hash === result.hmac && Math.abs(point - Number(result.crashPoint)) < 0.001, point };
            } catch { return { ok: false, point: 0 }; }
        }
        function begin(round, nextFair) {
            ended = false;
            active = round;
            if (nextFair) fair = { ...fair, ...nextFair, history: fair.history };
            points = [{ m: 1 }];
            live.className = "crash-live";
            live.textContent = "1.00x";
            revealEl.hidden = true;
            go.disabled = true;
            betEl.disabled = true;
            autoEl.disabled = true;
            seedEl.disabled = true;
            paintFair();
            stopLoop();
            raf = requestAnimationFrame(frame);
        }
        go.onclick = async () => {
            const bet = betValue();
            if (!(bet > 0)) { toast("Enter a bet."); return; }
            go.disabled = true;
            try {
                const r = await fetch("/api/chat/crash/start", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ room: state.room, bet, auto: autoEl.value.trim(), clientSeed: seedEl.value.trim() }) });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || !d.ok) { toast(d.error || "Couldn't start crash."); go.disabled = false; return; }
                if (d.balance != null) { state.gems = d.balance; paintGemBal(); }
                begin(d.round, d.fair);
            } catch { toast("Network error."); go.disabled = false; }
        };
        out.onclick = async () => {
            out.disabled = true;
            try {
                const r = await fetch("/api/chat/crash/cashout", { method: "POST", credentials: "same-origin" });
                const d = await r.json().catch(() => ({}));
                if (!r.ok || !d.ok) { toast(d.error || "Couldn't cash out."); if (active) out.disabled = false; return; }
                showEnd(d.result);
            } catch { toast("Network error."); if (active) out.disabled = false; }
        };
        paintFair();
        if (seed && seed.balance != null) { state.gems = seed.balance; paintGemBal(); }
        if (!betEl.value) betEl.value = "100";
        if (active && active.startedAt) begin(active, fair);
        const poll = setInterval(async () => {
            if (!document.body.contains(overlay)) { clearInterval(poll); if (window.__crashSettle === showEnd) window.__crashSettle = null; return; }
            try {
                const r = await fetch("/api/chat/crash", { credentials: "same-origin", cache: "no-store" });
                const d = await r.json().catch(() => ({}));
                if (!r.ok) return;
                if (d.fair) { fair = { ...fair, ...d.fair }; if (!active) paintFair(); }
                if (active && !d.active && d.last && d.last.id === active.id) showEnd(d.last);
            } catch {}
        }, 400);
    }

    const HIDE_GAMES_KEY = "nocturne-hide-gambling";
    const GAMBLE_GAMES = { coinflip: 1, slots: 1, dice: 1, blackjack: 1, roulette: 1, crash: 1 };
    function gamblingHidden() {
        try { return localStorage.getItem(HIDE_GAMES_KEY) === "1"; } catch { return false; }
    }
    function isOwnGame(d) {
        const me = state.me && state.me.userId;
        if (me == null || d.userId == null) return false;
        return String(d.userId) === String(me);
    }
    function applyGamblingHide() {
        const on = gamblingHidden();
        document.querySelectorAll(".game-card[data-gamble='1']").forEach(el => {
            if (el.dataset.own === "1") return;
            el.style.display = on ? "none" : "";
        });
    }
    function markGameCard(card, d) {
        if (!GAMBLE_GAMES[d.game]) return;
        card.dataset.gamble = "1";
        if (isOwnGame(d)) card.dataset.own = "1";
        else if (gamblingHidden()) card.style.display = "none";
    }
    async function runCommand(text) {
        const hideParts = text.trim().split(/\s+/);
        if (hideParts[0].toLowerCase() === "/hide") {
            const arg = (hideParts[1] || "").toLowerCase();
            const on = arg === "on" ? true : arg === "off" ? false : !gamblingHidden();
            try { localStorage.setItem(HIDE_GAMES_KEY, on ? "1" : "0"); } catch {}
            applyGamblingHide();
            toast(on ? "Other people's games are hidden." : "Other people's games are showing.");
            input.focus();
            return;
        }
        try {
            const r = await fetch("/api/chat/command", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ room: state.room, text }) });
            const d = await r.json().catch(() => ({}));
            if (r.status === 403) { toast(d.error || "No permission."); return; }
            if (d.panel) { openPanel(d); return; }
            if (d.crashPanel) { openCrashPanel(d.state || {}); return; }
            toast(d.ok ? (d.message || "Done.") : (d.error || "Command failed."));
        } catch { toast("Network error - try again."); }
        input.focus();
    }
    function openPanel(d) {
        let overlay = document.getElementById('panelOverlay');
        if (overlay) overlay.remove();
        overlay = document.createElement('div');
        overlay.id = 'panelOverlay';
        overlay.className = 'panel-overlay';
        overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
        
        const modal = document.createElement('div');
        modal.className = 'panel-modal';
        modal.style.position = 'relative';
        const cfg = d.config || {};
        const he = cfg.houseEdge || {};
        
        const stats = d.stats || {};
        const pct = (n, fallback) => {
            const v = Number(n);
            return (Number.isFinite(v) ? v : fallback) * 100;
        };
        const money = (n) => Number(n || 0).toLocaleString();
        modal.innerHTML = `
            <div class="panel-head">
                <div>
                    <h2>Economy</h2>
                    <p class="panel-sub">Gems, games, and chat roles</p>
                </div>
                <button class="panel-close" type="button" onclick="document.getElementById('panelOverlay')?.remove()" aria-label="Close">&times;</button>
            </div>
            <div class="panel-stats">
                <div><span>In circulation</span><b>${money(stats.totalGems)} 💎</b></div>
                <div><span>Max bet</span><b>${money(cfg.maxBet || 50000)}</b></div>
                <div><span>Games</span><b>${cfg.gamblingEnabled === false ? "Off" : "On"}</b></div>
            </div>

            <section class="panel-card">
                <h3>People</h3>
                <div class="panel-grid two">
                    <div class="panel-field"><label>Username</label><input id="pUser" placeholder="username" autocomplete="off"></div>
                    <div class="panel-field"><label>Action</label>
                        <select id="pAction"><option value="setgems">Set gems</option><option value="givegems">Give gems</option><option value="setrole">Set role</option><option value="setperm">Set permission</option><option value="timeout">Timeout</option><option value="untimeout">Remove timeout</option></select>
                    </div>
                    <div class="panel-field"><label>Value</label><input id="pValue" placeholder="amount, title, or 10m"></div>
                    <div class="panel-field"><label>Extra</label><input id="pExtra" placeholder="#color, rank, or reason"></div>
                </div>
                <div class="panel-actions"><button class="panel-btn" type="button" onclick="panelExec()">Apply</button></div>
            </section>

            <section class="panel-card">
                <h3>House edge</h3>
                <p class="panel-note">Coinflip uses this as the bias. Slots, dice, and blackjack trim the profit. Roulette keeps the wheel.</p>
                <div class="panel-grid">
                    <div class="panel-field"><label>Coinflip</label><div class="panel-suffix"><input id="heCoinflip" type="number" step="0.1" value="${pct(he.coinflip, 0.02)}" min="0" max="50"><i>%</i></div></div>
                    <div class="panel-field"><label>Slots</label><div class="panel-suffix"><input id="heSlots" type="number" step="0.1" value="${pct(he.slots, 0.05)}" min="0" max="50"><i>%</i></div></div>
                    <div class="panel-field"><label>Dice</label><div class="panel-suffix"><input id="heDice" type="number" step="0.1" value="${pct(he.dice, 0.03)}" min="0" max="50"><i>%</i></div></div>
                    <div class="panel-field"><label>Blackjack</label><div class="panel-suffix"><input id="heBlackjack" type="number" step="0.1" value="${pct(he.blackjack, 0.03)}" min="0" max="50"><i>%</i></div></div>
                    <div class="panel-field"><label>Roulette</label><div class="panel-suffix"><input id="heRoulette" type="number" step="0.1" value="${pct(he.roulette, 0.027)}" min="0" max="50"><i>%</i></div></div>
                </div>
                <div class="panel-actions"><button class="panel-btn" type="button" onclick="panelSaveHouse()">Save edge</button></div>
            </section>

            <section class="panel-card">
                <h3>Limits</h3>
                <div class="panel-grid two">
                    <div class="panel-field"><label>Max bet</label><input id="pMaxBet" type="number" value="${cfg.maxBet || 50000}"></div>
                    <div class="panel-field"><label>Beg amount</label><input id="pBegAmt" type="number" value="${cfg.begAmount || 15}"></div>
                </div>
                <div class="panel-toggles">
                    <label class="panel-toggle"><input type="checkbox" id="pGambling" ${cfg.gamblingEnabled !== false ? "checked" : ""}><span>Gambling</span></label>
                    <label class="panel-toggle"><input type="checkbox" id="pDaily" ${cfg.dailyEnabled !== false ? "checked" : ""}><span>Daily reward</span></label>
                </div>
                <div class="panel-actions"><button class="panel-btn" type="button" onclick="panelSaveSettings()">Save limits</button></div>
            </section>
        `;
        overlay.appendChild(modal);
        document.body.appendChild(overlay);
    }

    window.panelExec = async function() {
        const user = document.getElementById('pUser')?.value?.trim();
        const action = document.getElementById('pAction')?.value;
        const value = document.getElementById('pValue')?.value?.trim();
        const extra = document.getElementById('pExtra')?.value?.trim();
        if (!user) return toast('Enter a username.');
        let cmd = '';
        if (action === 'setgems') cmd = '/setgems @' + user + ' ' + value;
        else if (action === 'givegems') cmd = '/givegems @' + user + ' ' + value;
        else if (action === 'setrole') cmd = '/setrole @' + user + ' ' + value + (extra ? ' ' + extra : '');
        else if (action === 'setperm') cmd = '/setperm @' + user + ' ' + (value || 'member');
        else if (action === 'timeout') cmd = '/timeout @' + user + ' ' + (value || '10m') + (extra ? ' ' + extra : '');
        else if (action === 'untimeout') cmd = '/untimeout @' + user;
        if (!cmd) return;
        try {
            const r = await fetch('/api/chat/command', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ room: state.room, text: cmd }) });
            const d = await r.json();
            toast(d.message || d.error || 'Done.');
        } catch { toast('Error.'); }
    };

    window.panelSaveHouse = async function() {
        const edgeOf = (id) => {
            const n = parseFloat(document.getElementById(id)?.value);
            return (Number.isFinite(n) ? Math.min(50, Math.max(0, n)) : 0) / 100;
        };
        const he = {
            coinflip: edgeOf('heCoinflip'),
            slots: edgeOf('heSlots'),
            dice: edgeOf('heDice'),
            blackjack: edgeOf('heBlackjack'),
            roulette: edgeOf('heRoulette')
        };
        try {
            const r = await fetch('/api/chat/economy-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ houseEdge: he }) });
            const d = await r.json();
            if (d.ok) toast('House edge saved!');
            else toast(d.error || 'Failed to save house edge.');
        } catch { toast('Network error.'); }
    };

    window.panelSaveSettings = async function() {
        const maxBet = parseInt(document.getElementById('pMaxBet')?.value, 10) || 50000;
        const begAmount = parseInt(document.getElementById('pBegAmt')?.value, 10) || 15;
        const gamblingEnabled = document.getElementById('pGambling')?.checked ?? true;
        const dailyEnabled = document.getElementById('pDaily')?.checked ?? true;
        try {
            const r = await fetch('/api/chat/economy-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: JSON.stringify({ maxBet, begAmount, gamblingEnabled, dailyEnabled }) });
            const d = await r.json();
            if (d.ok) toast('Settings saved!');
            else toast(d.error || 'Failed to save settings.');
        } catch { toast('Network error.'); }
    };
    function showTimeoutNotice(data) {
        const left = Math.max(0, (data.until || 0) - Date.now());
        showNotice("blocked", "&#9203; You’re timed out", "You can’t send messages for about " + fmtDur(left) + (data.reason ? " &mdash; " + esc(data.reason) : "") + ".", "");
    }
    function onPurge(d) {
        if (state.mode !== "room") return;
        if (d.all) {
            streamEl.querySelectorAll(".msg").forEach(el => el.remove());
            msgEls.clear(); msgData.clear(); msgReactions.clear(); reactedByMe.clear(); state.lastMsg = null;
        } else if (Array.isArray(d.ids)) {
            d.ids.forEach(id => { const el = msgEls.get(id); if (el) el.remove(); msgEls.delete(id); msgData.delete(id); });
        }
    }
    function renderSysText(text) {
        const h = esc(String(text || ""));
        return h.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|\s)@([\w-]+)/g, "$1<span class=\"sys-at\">@$2</span>");
    }
    function appendSystemLine(text) {
        if (state.mode !== "room") return;
        removeEmpty();
        const near = nearBottom();
        const el = document.createElement("div");
        el.className = "chat-sys";
        if (document.hidden) el.style.animation = "none";
        el.innerHTML = renderSysText(text);
        streamEl.appendChild(el);
        scrollToBottom(near);
    }
    function appendGameCard(d) {
        removeEmpty();
        if (d.game === "crash") {
            const card = document.createElement("div");
            const outcome = d.won ? "win" : (d.push ? "push" : "loss");
            card.className = "game-card " + outcome;
            const at = (d.multiplier ? Number(d.multiplier) : Number(d.crashPoint)).toFixed(2) + "x";
            const verb = d.won ? "Cashed out" : (d.push ? "Stake back" : "Crashed");
            const amount = d.won ? ("+" + Number(d.payout || 0).toLocaleString() + " 💎") : (d.push ? (Number(d.bet || 0).toLocaleString() + " 💎 back") : ("−" + Number(d.bet || 0).toLocaleString() + " 💎"));
            card.innerHTML = '<div class="game-header"><span class="game-who">' + esc(d.username || "Someone") + '</span><span class="game-type">Crash</span></div><div class="crash-result"><div class="crash-mult ' + outcome + '">' + at + '</div><div class="crash-verb">' + verb + '</div></div><div class="game-result ' + (d.won ? "win" : (d.push ? "push" : "loss")) + '"><span class="game-verdict">' + (d.won ? "Won" : (d.push ? "Push" : "Lost")) + '</span><span class="game-amount">' + amount + '</span></div>';
            if (document.hidden) card.style.animation = "none";
            markGameCard(card, d);
            streamEl.appendChild(card);
            scrollToBottom(true);
            if (d.userId === state.me?.userId) {
                if (d.balance != null) { state.gems = d.balance; paintGemBal(); }
                if (typeof window.__crashSettle === "function") window.__crashSettle(d);
            }
            return;
        }
        const card = document.createElement('div');
        const outcome = d.phase === 'deal' ? 'live' : (d.won ? 'win' : (d.push ? 'push' : 'loss'));
        card.className = 'game-card ' + outcome;
        
        const header = '<div class="game-header"><span class="game-who">' + esc(d.username || 'Someone') + '</span><span class="game-type">' + gameLabel(d.game) + '</span></div>';
        let body = '';
        
        if (d.game === 'coinflip') {
            const landed = d.side === 'tails' ? 'Tails' : 'Heads';
            const called = String(d.call || d.side || 'heads').toLowerCase() === 'tails' ? 'Tails' : 'Heads';
            body = '<div class="cf-layout"><div class="coinflip-coin ' + (d.side === 'tails' ? 'tails' : 'heads') + '">' + (d.side === 'tails' ? 'T' : 'H') + '</div><div class="cf-copy"><div class="cf-side">' + landed + '</div><div class="cf-call">Called ' + esc(called) + '</div></div></div>';
        } else if (d.game === 'slots') {
            const jackpot = d.multiplier >= 25 ? ' jackpot' : '';
            body = '<div class="slots-display' + jackpot + '">' + (d.reels || []).map(s => '<div class="slots-reel"><span class="slots-symbol">' + s + '</span></div>').join('') + '</div>';
        } else if (d.game === 'dice') {
            body = '<div class="dice-display"><div class="dice-group"><div class="dice-label">' + esc(d.username || 'Player') + '</div><div class="dice-val">' + d.playerRoll + '</div></div><div class="dice-vs">vs</div><div class="dice-group"><div class="dice-label">House</div><div class="dice-val">' + d.houseRoll + '</div></div></div>';
        } else if (d.game === 'blackjack') {
            const pCards = (d.playerHand || []).map(c => {
                if (typeof c === 'string') return '<div class="bj-card">' + esc(c) + '</div>';
                return '<div class="bj-card' + (c.red ? ' red' : '') + '">' + esc(c.display) + '</div>';
            }).join('');
            const dCards = (d.dealerHand || []).map(c => {
                if (c === '?' || (c && c.hidden)) return '<div class="bj-card hidden">?</div>';
                if (typeof c === 'string') return '<div class="bj-card">' + esc(c) + '</div>';
                return '<div class="bj-card' + (c.red ? ' red' : '') + '">' + esc(c.display) + '</div>';
            }).join('');
            body = '<div class="bj-display">';
            body += '<div class="bj-hand"><span class="bj-hand-label">You</span>' + pCards + '<span class="bj-total">' + (d.playerTotal || '') + '</span></div>';
            body += '<div class="bj-hand"><span class="bj-hand-label">Dealer</span>' + dCards + '<span class="bj-total">' + (d.dealerTotal || '') + '</span></div>';
            if (d.phase === 'deal' && d.canHit && d.userId === state.me?.userId) {
                body += '<div class="bj-actions"><button onclick="bjAction(\'hit\')">Hit</button><button onclick="bjAction(\'stand\')">Stand</button></div>';
            }
            body += '</div>';
        } else if (d.game === 'roulette') {
            body = '<div class="roulette-display"><div class="roulette-wheel ' + d.color + '">' + d.number + '</div><div class="roulette-bet">Bet: ' + esc(d.betType) + '</div></div>';
        } else if (d.game === 'daily') {
            body = '<div class="daily-display"><div class="daily-amount ' + (d.tier || 'common') + '">+' + d.amount + ' 💎</div><div class="daily-tier ' + (d.tier || 'common') + '">' + esc(d.tierName || 'Common') + '</div></div>';
        } else if (d.game === 'leaderboard') {
            card.className = 'game-card lb';
            let rows = '';
            (d.entries || []).forEach(e => {
                const medal = e.rank === 1 ? ' gold' : e.rank === 2 ? ' silver' : e.rank === 3 ? ' bronze' : '';
                rows += '<div class="lb-row' + medal + '"><span class="lb-rank">' + e.rank + '</span><span class="lb-name">' + esc(e.username) + '</span><span class="lb-gems">' + Number(e.gems || 0).toLocaleString() + '</span></div>';
            });
            card.innerHTML = '<div class="game-header"><span>Gem leaderboard</span><span class="game-type">Top ' + (d.entries || []).length + '</span></div><div class="lb-list">' + (rows || '<div class="lb-empty">No gems yet</div>') + '</div>';
            if (document.hidden) card.style.animation = 'none';
            const stream = document.getElementById('stream');
            stream.appendChild(card);
            scrollToBottom(true);
            return;
        }
        
        let payoutHtml = '';
        if (d.game !== 'daily' && d.game !== 'leaderboard') {
            const bet = Number(d.bet || 0).toLocaleString();
            const payout = Number(d.payout || 0).toLocaleString();
            if (d.phase === 'deal') payoutHtml = '<div class="game-result live"><span class="game-verdict">In play</span><span class="game-amount">' + bet + ' 💎 on the table</span></div>';
            else if (d.won) payoutHtml = '<div class="game-result win"><span class="game-verdict">Won</span><span class="game-amount">+' + payout + ' 💎</span></div>';
            else if (d.push) payoutHtml = '<div class="game-result push"><span class="game-verdict">Push</span><span class="game-amount">' + bet + ' 💎 back</span></div>';
            else payoutHtml = '<div class="game-result loss"><span class="game-verdict">Lost</span><span class="game-amount">−' + bet + ' 💎</span></div>';
        }
        
        card.innerHTML = header + body + payoutHtml;
        if (document.hidden) card.style.animation = 'none';
        markGameCard(card, d);
        const stream = document.getElementById('stream');
        stream.appendChild(card);
        scrollToBottom(true);
        
        if (d.userId === state.me?.userId && d.balance != null) {
            state.gems = d.balance;
            paintGemBal();
        }
    }

    function gameLabel(g) {
        const labels = { coinflip: '🪙 Coinflip', slots: '🎰 Slots', dice: '🎲 Dice', blackjack: '🃏 Blackjack', roulette: '🎡 Roulette', crash: 'Crash', daily: '🎁 Daily Reward', leaderboard: '🏆 Leaderboard' };
        return labels[g] || g;
    }

    window.bjAction = async function(action) {
        const input = document.getElementById('chatInput');
        input.value = '/bj ' + action;
        const form = document.getElementById('composer');
        form?.dispatchEvent(new Event('submit', { bubbles: true }));
        input.value = '';
    };

    const gwCards = new Map();
    function giveawayCardHtml(gw) {
        const ended = gw.status === "ended" || (gw.endsAt && gw.endsAt <= Date.now());
        let foot;
        if (ended) foot = '<div class="gw-result">' + (gw.winner ? "&#127942; Winner: <b>@" + esc(gw.winner) + "</b>" : "Ended &mdash; no entries") + "</div>";
        else foot = '<button class="gw-join" type="button"' + (gw._joined ? " disabled" : "") + ">" + (gw._joined ? "Joined &#10003;" : "Join &#127881;") + "</button><span class=\"gw-time\" data-ends=\"" + (gw.endsAt || 0) + "\">" + (gw.endsAt ? "ends in " + fmtDur(gw.endsAt - Date.now()) : "") + "</span>";
        return '<div class="gw-top"><span class="gw-ico">&#127881;</span><div class="gw-info"><div class="gw-prize">' + esc(gw.prize) + '</div><div class="gw-host">Hosted by @' + esc(gw.host) + ' &middot; <span class="gw-entries">' + (gw.entries || 0) + "</span> entered</div></div></div><div class=\"gw-foot\">" + foot + "</div>";
    }
    function syncStickyGiveaway() {
        let sticky = document.getElementById("stickyGwBanner");
        if (state.mode !== "room") {
            if (sticky) sticky.remove();
            return;
        }
        let activeGw = null;
        for (const el of gwCards.values()) {
            const gw = el._gw;
            if (gw && gw.status === "open" && (!gw.endsAt || gw.endsAt > Date.now())) {
                activeGw = gw;
                break;
            }
        }
        if (!activeGw) {
            if (sticky) sticky.remove();
            return;
        }
        if (!sticky) {
            sticky = document.createElement("div");
            sticky.id = "stickyGwBanner";
            sticky.className = "gw-sticky";
            const main = document.querySelector(".chat-main");
            const stream = document.getElementById("stream");
            if (main && stream) main.insertBefore(sticky, stream);
            else if (stream) stream.prepend(sticky);
        }
        sticky._gw = activeGw;
        const ends = activeGw.endsAt || 0;
        const timeStr = ends ? (ends > Date.now() ? "ends in " + fmtDur(ends - Date.now()) : "ending…") : "";
        sticky.innerHTML = '<span class="gw-sticky-ico">&#127881;</span>' +
            '<div class="gw-sticky-info">' +
                '<div class="gw-sticky-prize">' + esc(activeGw.prize) + '</div>' +
                '<div class="gw-sticky-meta">Hosted by @' + esc(activeGw.host) + ' &middot; <span class="gw-sticky-entries">' + (activeGw.entries || 0) + '</span> entered &middot; <span class="gw-sticky-time" data-ends="' + ends + '">' + timeStr + '</span></div>' +
            '</div>' +
            '<button class="gw-sticky-btn" type="button"' + (activeGw._joined ? ' disabled' : '') + '>' + (activeGw._joined ? 'Joined &#10003;' : 'Join &#127881;') + '</button>';
        const btn = sticky.querySelector(".gw-sticky-btn");
        if (btn) btn.onclick = () => joinGiveaway(activeGw.id, sticky);
    }
    function paintGiveaway(el, gw) {
        el._gw = gw;
        el.innerHTML = giveawayCardHtml(gw);
        el.classList.toggle("ended", gw.status === "ended" || (gw.endsAt && gw.endsAt <= Date.now()));
        const btn = el.querySelector(".gw-join");
        if (btn) btn.onclick = () => joinGiveaway(gw.id, el);
        syncStickyGiveaway();
    }
    function appendGiveawayCard(gw) {
        if (!gw || state.mode !== "room" || (gw.room && gw.room !== state.room)) return;
        let el = gwCards.get(gw.id);
        if (!el) {
            removeEmpty();
            const near = nearBottom();
            el = document.createElement("div");
            el.className = "giveaway-card";
            if (document.hidden) el.style.animation = "none";
            streamEl.appendChild(el);
            gwCards.set(gw.id, el);
            paintGiveaway(el, gw);
            scrollToBottom(near);
        } else {
            paintGiveaway(el, { ...el._gw, ...gw });
        }
        syncStickyGiveaway();
    }
    async function joinGiveaway(id, sourceEl) {
        const btn = sourceEl ? sourceEl.querySelector(".gw-join, .gw-sticky-btn") : null;
        if (btn) { btn.disabled = true; btn.textContent = "Joining…"; }
        try {
            const r = await fetch("/api/chat/giveaway/" + id + "/join", { method: "POST", credentials: "same-origin" });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) {
                toast(d.error || "Couldn’t join.");
                const streamEl = gwCards.get(id);
                if (streamEl && streamEl._gw) paintGiveaway(streamEl, streamEl._gw);
                syncStickyGiveaway();
                return;
            }
            const streamEl = gwCards.get(id);
            if (streamEl && streamEl._gw) {
                paintGiveaway(streamEl, { ...streamEl._gw, _joined: true, entries: d.entries });
            } else {
                syncStickyGiveaway();
            }
        } catch {
            toast("Network error - try again.");
            const streamEl = gwCards.get(id);
            if (streamEl && streamEl._gw) paintGiveaway(streamEl, streamEl._gw);
            syncStickyGiveaway();
        }
    }
    function updateGiveaway(id, patch) {
        const el = gwCards.get(id); if (!el || !el._gw) return;
        paintGiveaway(el, { ...el._gw, ...patch });
        syncStickyGiveaway();
    }
    async function loadGiveaways() {
        gwCards.clear();
        syncStickyGiveaway();
        try {
            const r = await fetch("/api/chat/giveaways?room=" + encodeURIComponent(state.room), { credentials: "same-origin" });
            const d = await r.json().catch(() => ({}));
            (d.giveaways || []).forEach(appendGiveawayCard);
        } catch {}
    }
    setInterval(() => {
        if (document.hidden || state.mode !== "room") return;
        let anyOpen = false;
        gwCards.forEach(el => {
            if (!el._gw || el.classList.contains("ended")) return;
            anyOpen = true;
            const t = el.querySelector(".gw-time"); if (!t) return;
            const ends = +t.dataset.ends || 0;
            t.textContent = ends ? (ends > Date.now() ? "ends in " + fmtDur(ends - Date.now()) : "ending…") : "";
        });
        const stickyTime = document.querySelector(".gw-sticky-time");
        if (stickyTime) {
            const ends = +stickyTime.dataset.ends || 0;
            stickyTime.textContent = ends ? (ends > Date.now() ? "ends in " + fmtDur(ends - Date.now()) : "ending…") : "";
        }
        if (!anyOpen) syncStickyGiveaway();
    }, 1000);

    async function doEdit(text) {
        const id = state.editingId;
        const url = state.mode === "dm" ? "/api/dm/messages/" + id : "/api/chat/messages/" + id;
        const r = await fetch(url, { method: "PUT", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ text }) });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) { toast(data.error || "Couldn't edit."); return; }
        if (data.blocked) { showBlocked(data); return; }
        clearNotice(); cancelEdit(); input.value = ""; autoGrow(); updateCount();
        const newText = data.message ? data.message.text : data.text;
        onEdit({ id, text: newText });
    }
    async function toggleReact(id, emoji) {
        if (state.mode !== "room") return;
        try {
            const r = await fetch("/api/chat/messages/" + id + "/react", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ emoji }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { toast(d.error || "Couldn't react."); return; }
            msgReactions.set(id, d.counts || {});
            const set = reactedByMe.get(id) || new Set();
            if (d.added) set.add(emoji); else set.delete(emoji);
            reactedByMe.set(id, set); renderReactions(id);
        } catch { toast("Couldn't react."); }
    }
    async function doDelete(id) {
        const url = state.mode === "dm" ? "/api/dm/messages/" + id : "/api/chat/messages/" + id;
        try { const r = await fetch(url, { method: "DELETE", credentials: "same-origin" }); const d = await r.json().catch(() => ({})); if (!r.ok || !d.ok) { toast(d.error || "You can only delete your own messages."); return; } onDelete(id); }
        catch { toast("Couldn't delete."); }
    }
    async function forwardTo(id, room) {
        try {
            const r = await fetch("/api/chat/send", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ room, forwardOf: id }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { toast(d.error || "Couldn't forward."); return; }
            if (d.blocked) { toast("That message can't be forwarded."); return; }
            toast("Forwarded to #" + room);
            if (state.mode === "room" && room === state.room && d.message) { appendMessage(d.message); scrollToBottom(true); }
        } catch { toast("Couldn't forward."); }
    }
    function bumpThreadLocal(otherId, text) { const t = dmThreads.get(otherId); if (t) { t.lastText = text; t.lastTs = Date.now(); renderThreads(); } }

    function startReply(m) { cancelEdit(); state.replyingTo = { id: m.id, username: m.username, text: m.text || "" }; ccLabel.textContent = "Replying to " + m.username; ccText.textContent = m.text ? m.text.slice(0, 120) : ""; composeCtx.classList.add("show"); input.focus(); }
    function cancelReply() { state.replyingTo = null; if (state.editingId == null) composeCtx.classList.remove("show"); }
    function startEdit(m) { cancelReply(); state.editingId = m.id; ccLabel.textContent = "Editing message"; ccText.textContent = m.text ? m.text.slice(0, 120) : ""; composeCtx.classList.add("show"); input.value = m.text || ""; autoGrow(); updateCount(); syncSendState(); input.focus(); }
    function cancelEdit() { if (state.editingId != null) { state.editingId = null; input.value = ""; autoGrow(); updateCount(); syncSendState(); } if (!state.replyingTo) composeCtx.classList.remove("show"); }

    const typingBar = (() => {
        const el = document.createElement("div"); el.className = "typing-bar";
        const comp = document.querySelector(".chat-composer");
        if (comp) comp.insertBefore(el, comp.firstChild);
        return el;
    })();
    const typing = new Map();
    function renderTyping() {
        const names = state.mode === "room" ? [...typing.keys()] : [];
        if (!names.length) { typingBar.classList.remove("show"); typingBar.innerHTML = ""; return; }
        let txt;
        if (names.length === 1) txt = "<b>" + esc(names[0]) + "</b> is typing";
        else if (names.length === 2) txt = "<b>" + esc(names[0]) + "</b> and <b>" + esc(names[1]) + "</b> are typing";
        else if (names.length === 3) txt = "<b>" + esc(names[0]) + "</b>, <b>" + esc(names[1]) + "</b> and <b>" + esc(names[2]) + "</b> are typing";
        else txt = "Several people are typing";
        typingBar.innerHTML = '<span class="typing-dots"><i></i><i></i><i></i></span><span class="typing-txt">' + txt + "</span>";
        typingBar.classList.add("show");
    }
    function onTyping(d) {
        if (state.mode !== "room" || !d.username || d.username === state.me.username) return;
        clearTimeout(typing.get(d.username));
        typing.set(d.username, setTimeout(() => { typing.delete(d.username); renderTyping(); }, 5000));
        renderTyping();
    }
    function clearTyping() { typing.forEach(t => clearTimeout(t)); typing.clear(); renderTyping(); }
    let _lastTyping = 0;
    function pingTyping() {
        if (state.mode !== "room" || state.me.userId == null) return;
        const now = Date.now();
        if (now - _lastTyping < 2500) return;
        _lastTyping = now;
        try { fetch("/api/chat/typing", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ room: state.room }) }); } catch {}
    }
    input.addEventListener("input", () => { if (input.value) pingTyping(); });

    function buildCtx(m, reactOnly) {
        let html = "";
        if (state.mode === "room") html += '<div class="ctx-react">' + state.reactionEmojis.map(e => '<button data-emoji="' + esc(e) + '" type="button">' + e + "</button>").join("") + "</div>";
        if (!reactOnly) {
            const own = isMine(m);
            if (state.mode === "room") html += '<div class="ctx-sep"></div>';
            html += '<button class="ctx-item" data-act="reply" type="button">' + I.reply + " Reply</button>";
            if (own && !m.fwd) html += '<button class="ctx-item" data-act="edit" type="button">' + I.edit + " Edit</button>";
            if (state.mode === "room") html += '<button class="ctx-item" data-act="forward" type="button">' + I.forward + " Forward</button>";
            if (own || (state.me && state.me.canModerate)) html += '<div class="ctx-sep"></div><button class="ctx-item danger" data-act="delete" type="button">' + I.trash + " Delete</button>";
        }
        return html;
    }
    let ctxId = null;
    function openMenu(x, y, id, reactOnly) {
        const m = msgData.get(id); if (!m || m.deleted) return;
        if (reactOnly && state.mode !== "room") return;
        ctxId = id; ctxMenu.innerHTML = buildCtx(m, reactOnly); ctxMenu.classList.add("show");
        const rect = ctxMenu.getBoundingClientRect();
        ctxMenu.style.left = Math.max(8, Math.min(x, window.innerWidth - rect.width - 8)) + "px";
        ctxMenu.style.top = Math.max(8, Math.min(y, window.innerHeight - rect.height - 8)) + "px";
    }
    function closeMenu() { ctxMenu.classList.remove("show"); ctxId = null; }
    ctxMenu.addEventListener("click", e => {
        const id = ctxId;
        const emojiBtn = e.target.closest("[data-emoji]");
        if (emojiBtn) { closeMenu(); if (id != null) toggleReact(id, emojiBtn.dataset.emoji); return; }
        const item = e.target.closest("[data-act]"); if (!item || id == null) return;
        const m = msgData.get(id); closeMenu(); if (!m) return;
        const act = item.dataset.act;
        if (act === "reply") startReply(m); else if (act === "edit") startEdit(m); else if (act === "forward") openForward(id); else if (act === "delete") doDelete(id);
    });

    streamEl.addEventListener("contextmenu", e => { const row = e.target.closest(".msg"); if (!row) return; e.preventDefault(); openMenu(e.clientX, e.clientY, parseInt(row.dataset.id, 10), false); });
    streamEl.addEventListener("click", e => {
        const addR = e.target.closest(".reaction-add"); if (addR) { const rr = addR.getBoundingClientRect(); openMenu(rr.left, rr.bottom + 4, parseInt(addR.dataset.reactAdd, 10), true); return; }
        const pill = e.target.closest(".reaction"); if (pill) { toggleReact(parseInt(pill.dataset.id, 10), pill.dataset.react); return; }
        const jump = e.target.closest("[data-jump]"); if (jump) { flash(parseInt(jump.dataset.jump, 10)); return; }
        const act = e.target.closest(".msg-act");
        if (act) {
            const row = act.closest(".msg"); const id = parseInt(row.dataset.id, 10);
            if (act.dataset.act === "reply") { const m = msgData.get(id); if (m) startReply(m); return; }
            const r = act.getBoundingClientRect(); openMenu(r.left - 150, r.bottom + 4, id, act.dataset.act === "react"); return;
        }
        const who = e.target.closest(".msg-avatar, .msg-name");
        if (who) { const row = who.closest(".msg"); const m = msgData.get(parseInt(row.dataset.id, 10)); if (m) openProfileCard(m.userId); return; }
        if (roomsEl.classList.contains("open")) roomsEl.classList.remove("open");
    });
    document.addEventListener("click", e => { if (!ctxMenu.contains(e.target) && !e.target.closest(".msg-act")) closeMenu(); }, true);
    document.addEventListener("keydown", e => { if (e.key === "Escape") { closeMenu(); closeModals(); } });
    streamEl.addEventListener("scroll", closeMenu);
    window.addEventListener("resize", closeMenu);

    function renderRooms() {
        roomListEl.innerHTML = "";
        state.rooms.forEach(rm => {
            const b = document.createElement("button");
            b.className = "cr-room" + (state.mode === "room" && rm.id === state.room ? " active" : "");
            b.innerHTML = '<span class="cr-hash">#</span><span>' + esc(rm.label) + "</span>";
            b.onclick = () => selectRoom(rm.id);
            roomListEl.appendChild(b);
        });
    }
    function selectRoom(id) {
        roomsEl.classList.remove("open");
        const switchingMode = state.mode !== "room";
        state.mode = "room"; state.room = id;
        try { localStorage.setItem(ROOM_KEY, id); } catch {}
        const rm = state.rooms.find(r => r.id === id);
        input.placeholder = "Message #" + (rm ? rm.id : id);
        streamEl.classList.remove("dm-mode");
        clearNotice(); cancelReply(); cancelEdit(); paintConvoBar(); renderRooms(); renderThreads();
        loadMessages().then(() => { if (state.me.userId != null && (state.streamRoom !== id || switchingMode || !state.es)) connectStream(); });
    }

    function renderThreads() {
        const arr = [...dmThreads.values()].sort((a, b) => b.lastTs - a.lastTs);
        if (!arr.length) { dmListEl.innerHTML = '<div class="dm-empty">No conversations yet. Tap + to find people.</div>'; return; }
        dmListEl.innerHTML = "";
        arr.forEach(t => {
            const b = document.createElement("button");
            b.className = "dm-item" + (state.mode === "dm" && state.dm && state.dm.otherId === t.otherId ? " active" : "");
            const av = document.createElement("div"); av.className = "dm-av"; avInto(av, t.username, t.avatar);
            const meta = document.createElement("div"); meta.className = "dm-meta";
            meta.innerHTML = '<div class="dm-name">' + esc(t.username) + '</div><div class="dm-preview">' + (t.lastText ? esc(t.lastText) : "Start a conversation") + "</div>";
            b.appendChild(av); b.appendChild(meta);
            if (t.unread > 0) { const u = document.createElement("span"); u.className = "dm-badge"; u.textContent = t.unread > 99 ? "99+" : t.unread; b.appendChild(u); }
            b.onclick = () => openDm({ id: t.otherId, username: t.username, avatar: t.avatar });
            dmListEl.appendChild(b);
        });
    }
    function openDm(user) {
        roomsEl.classList.remove("open");
        state.mode = "dm"; state.dm = { otherId: user.id, username: user.username, avatar: user.avatar || null };
        state.dmFilter = { off: false, pendingFromMe: false, pendingFromOther: false };
        input.placeholder = "Message " + user.username;
        streamEl.classList.add("dm-mode");
        clearNotice(); cancelReply(); cancelEdit();
        if (!dmThreads.has(user.id)) { dmThreads.set(user.id, { otherId: user.id, username: user.username, avatar: user.avatar || null, lastText: null, lastTs: Date.now(), unread: 0 }); }
        paintConvoBar(); renderRooms(); renderThreads();
        loadMessages();
        if (state.me.userId != null && !state.es) connectStream();
    }
    function paintConvoBar() {
        if (state.mode === "dm" && state.dm) {
            convoBar.innerHTML = '<span class="cb-av"></span><span class="cb-name"></span><span class="cb-tag">&middot; direct message</span><span class="cb-actions" id="cbActions"></span>';
            convoBar.querySelector(".cb-name").textContent = state.dm.username;
            avInto(convoBar.querySelector(".cb-av"), state.dm.username, state.dm.avatar);
            convoBar.classList.add("show");
            applyFilterUI();
        } else {
            const rm = state.rooms.find(r => r.id === state.room);
            const lenient = rm && rm.lenient;
            convoBar.innerHTML = '<span class="cb-hash">#</span><span class="cb-name"></span><span class="cb-tag"></span>';
            convoBar.querySelector(".cb-name").textContent = rm ? rm.label : state.room;
            convoBar.querySelector(".cb-tag").textContent = lenient ? "· lighter filter — slurs still blocked" : "· everyone can see this channel";
            convoBar.classList.add("show");
            hideFilterPrompt();
        }
    }
    function ensureFilterPrompt() {
        let p = document.getElementById("filterPrompt");
        if (!p) { p = document.createElement("div"); p.id = "filterPrompt"; p.className = "filter-prompt"; p.style.display = "none"; streamEl.parentNode.insertBefore(p, streamEl); }
        return p;
    }
    function showFilterPrompt() {
        const p = ensureFilterPrompt();
        p.innerHTML = '<span class="fp-text"><b>' + esc(state.dm.username) + '</b> wants to turn off the profanity filter for this chat.</span><button class="fp-yes" data-filter="accept-off" type="button">Accept</button><button class="fp-no" data-filter="decline-off" type="button">Decline</button>';
        p.querySelectorAll("[data-filter]").forEach(b => b.onclick = () => filterAction(b.dataset.filter));
        p.style.display = "flex";
    }
    function hideFilterPrompt() { const p = document.getElementById("filterPrompt"); if (p) p.style.display = "none"; }
    function applyFilterUI() {
        const actions = document.getElementById("cbActions");
        if (!actions) return;
        const f = state.dmFilter;
        let btn;
        if (f.off) btn = '<button class="cb-btn on" data-filter="on" type="button">Filter: off</button>';
        else if (f.pendingFromMe) btn = '<button class="cb-btn" data-filter="on" type="button">Cancel request</button>';
        else btn = '<button class="cb-btn" data-filter="request-off" type="button">Turn off filter</button>';
        actions.innerHTML = btn;
        actions.querySelector("[data-filter]").onclick = e => filterAction(e.currentTarget.dataset.filter);
        if (f.pendingFromOther) showFilterPrompt(); else hideFilterPrompt();
    }
    async function filterAction(action) {
        if (state.mode !== "dm" || !state.dm) return;
        try {
            const r = await fetch("/api/dm/with/" + state.dm.otherId + "/filter", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ action }) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { toast(d.error || "Couldn't update filter."); return; }
            state.dmFilter = d.filter || state.dmFilter; applyFilterUI();
            if (action === "request-off") toast("Request sent — waiting for " + state.dm.username + " to accept.");
            else if (action === "accept-off") toast("Profanity filter turned off for this chat.");
            else if (action === "on") toast("Profanity filter is back on.");
        } catch { toast("Couldn't update filter."); }
    }

    const findModal = $("findModal"), findInput = $("findInput"), findResults = $("findResults");
    let findTimer = 0;
    function openFind() { if (state.me.userId == null) { showGate(); return; } findInput.value = ""; findResults.innerHTML = '<div class="find-empty">Type a username to search.</div>'; findModal.classList.add("show"); setTimeout(() => findInput.focus(), 30); }
    async function runSearch(q) {
        if (!q) { findResults.innerHTML = '<div class="find-empty">Type a username to search.</div>'; return; }
        try {
            const r = await fetch("/api/users/search?q=" + encodeURIComponent(q), { credentials: "same-origin" });
            const d = await r.json().catch(() => ({}));
            const users = d.users || [];
            if (!users.length) { findResults.innerHTML = '<div class="find-empty">No users found for "' + esc(q) + '".</div>'; return; }
            findResults.innerHTML = "";
            users.forEach(u => {
                const b = document.createElement("button"); b.className = "find-result"; b.type = "button";
                const av = document.createElement("div"); av.className = "find-av"; avInto(av, u.username, u.avatar);
                b.appendChild(av);
                const nm = document.createElement("span"); nm.className = "find-name"; nm.textContent = u.username; b.appendChild(nm);
                const go = document.createElement("span"); go.className = "find-go"; go.textContent = "Message"; b.appendChild(go);
                b.onclick = () => addAndOpen(u);
                findResults.appendChild(b);
            });
        } catch { findResults.innerHTML = '<div class="find-empty">Search failed - try again.</div>'; }
    }
    async function addAndOpen(user) {
        try { await fetch("/api/dm/add", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ username: user.username }) }); } catch {}
        findModal.classList.remove("show");
        openDm(user);
    }

    function autoGrow() {
        var sh = input.scrollHeight;
        if (sh > input.clientHeight || input.value === "") {
            input.style.height = "0";
            sh = input.scrollHeight;
        }
        input.style.height = Math.min(sh, 140) + "px";
        if (window.scrollY) window.scrollTo(0, 0);
    }
    function updateCount() { const n = input.value.length; if (n > state.maxLen - 100) { charCount.textContent = n + "/" + state.maxLen; charCount.classList.toggle("warn", n >= state.maxLen); } else { charCount.textContent = ""; charCount.classList.remove("warn"); } }
    function syncSendState() { if (!sending) sendBtn.disabled = input.value.trim().length === 0; }

    const profileModal = $("profileModal"), fwdModal = $("fwdModal"), profileView = $("profileView");
    const avatarPreview = $("avatarPreview"), avatarFile = $("avatarFile"), bannerFile = $("bannerFile"), bgFile = $("bgFile");
    const profileErr = $("profileErr"), peBanner = $("peBanner"), bgPreview = $("bgPreview"), pronounsInput = $("pronounsInput"), bioInput = $("bioInput");
    let pendingAvatar, pendingBanner, pendingBg;
    function paintMe() { const me = $("meAvatar"); avInto(me, state.me.username || "?", state.me.avatar); $("meName").textContent = state.me.username || "Profile"; }

    state.presence = new Map();
    let mentionBox = null;
    function statusDot(s) { return '<span class="pdot ' + (s || "offline") + '"></span>'; }

    function initPresenceUI() {
        const meRow = $("meName") ? $("meName").parentElement : null;
        if (meRow && !$("statusPick")) {
            const sel = document.createElement("select");
            sel.id = "statusPick"; sel.className = "status-pick"; sel.title = "Set your status";
            sel.innerHTML = '<option value="online">🟢 Online</option><option value="idle">🌙 Idle</option><option value="dnd">⛔ Do not disturb</option><option value="invisible">⚪ Invisible</option>';
            try { sel.value = localStorage.getItem("nocturne:chat-status") || "online"; } catch {}
            sel.addEventListener("change", () => {
                try { localStorage.setItem("nocturne:chat-status", sel.value); } catch {}
                fetch("/api/chat/status", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: sel.value }) }).catch(() => {});
            });
            meRow.appendChild(sel);
            if (sel.value !== "online") sel.dispatchEvent(new Event("change"));
        }
        if (roomsEl && !$("onlinePanel")) {
            const p = document.createElement("div");
            p.id = "onlinePanel"; p.className = "online-panel";
            p.innerHTML = '<div class="op-title">Online · <span id="opCount">0</span></div><div id="opList" class="op-list"></div>';
            roomsEl.appendChild(p);
        }
        refreshOnline();
    }
    async function refreshOnline() {
        try {
            const r = await fetch("/api/chat/online", { credentials: "same-origin" });
            const d = await r.json();
            paintOnline(d.online || []);
        } catch {}
    }
    function paintOnline(list) {
        const el = $("opList"); if (!el) return;
        const c = $("opCount"); if (c) c.textContent = list.length;
        el.innerHTML = list.map(u => '<div class="op-user">' + statusDot(u.status) + '<span class="op-name" style="' + (u.roleColor ? "color:" + esc(u.roleColor) : "") + '">' + esc(u.username) + "</span>" + (u.role ? '<span class="op-role">' + esc(u.role) + "</span>" : "") + "</div>").join("") || '<div class="op-empty">no one online</div>';
    }
    let presenceT = null;
    function onPresence(d) { clearTimeout(presenceT); presenceT = setTimeout(refreshOnline, 400); }
    function onMention(d) {
        const who = d.everyone ? (d.from + " pinged @everyone") : (d.from + " mentioned you");
        toast("\u{1F4AC} " + who + (d.preview ? ': "' + d.preview.slice(0, 40) + '"' : ""));
        if (state.notif && document.hidden && window.Notification && Notification.permission === "granted") {
            try { new Notification(who, { body: d.preview || "" }); } catch {}
        }
    }

    let mentionTimer = null;
    function closeMention() { if (mentionBox) mentionBox.style.display = "none"; }
    function mentionContext() {
        const v = input.value, pos = input.selectionStart;
        const m = /(^|\s)@([a-zA-Z0-9_-]*)$/.exec(v.slice(0, pos));
        if (!m) return null;
        return { query: m[2], start: pos - m[2].length - 1, end: pos };
    }
    function insertMention(name) {
        const ctx = mentionContext(); if (!ctx) return;
        const v = input.value;
        input.value = v.slice(0, ctx.start) + "@" + name + " " + v.slice(ctx.end);
        const np = ctx.start + name.length + 2;
        input.setSelectionRange(np, np); input.focus();
        closeMention(); autoGrow(); updateCount(); syncSendState();
    }
    function showMention(items) {
        if (!mentionBox) {
            mentionBox = document.createElement("div"); mentionBox.className = "mention-box";
            (composer || input.parentElement).appendChild(mentionBox);
            mentionBox.addEventListener("mousedown", e => { const it = e.target.closest("[data-m]"); if (it) { e.preventDefault(); insertMention(it.dataset.m); } });
        }
        mentionBox.innerHTML = items.map(it => it.special
            ? '<div class="mb-item mb-all" data-m="' + it.name + '">@' + it.name + '<span class="mb-sub">' + (it.name === "everyone" ? "notify everyone" : "notify those online") + "</span></div>"
            : '<div class="mb-item" data-m="' + esc(it.name) + '">@' + esc(it.name) + "</div>").join("");
        mentionBox.style.display = "block";
    }
    function onComposerInput() {
        const ctx = mentionContext();
        if (!ctx) { closeMention(); return; }
        closeEmoji();
        clearTimeout(mentionTimer);
        mentionTimer = setTimeout(async () => {
            const q = ctx.query.toLowerCase();
            let users = [];
            try { const r = await fetch("/api/users/search?q=" + encodeURIComponent(ctx.query), { credentials: "same-origin" }); const d = await r.json(); users = (d.users || d.results || d.matches || []).slice(0, 5); } catch {}
            const specials = [{ special: true, name: "everyone" }, { special: true, name: "here" }].filter(s => q === "" || s.name.startsWith(q));
            const items = [...specials, ...users.map(u => ({ name: u.username }))].slice(0, 7);
            if (!items.length) closeMention(); else showMention(items);
        }, 150);
    }
    input.addEventListener("input", onComposerInput);
    input.addEventListener("blur", () => setTimeout(closeMention, 160));

    const COMMANDS = [
        { name: "daily", args: "", desc: "Claim daily gems" },
        { name: "beg", args: "", desc: "Beg for 15 gems" },
        { name: "gift", args: "@user <amount>", desc: "Gift gems" },
        { name: "bal", args: "", desc: "Check balance" },
        { name: "lb", args: "", desc: "Leaderboard" },
        { name: "coinflip", args: "<bet|all> [heads|tails]", desc: "Flip a coin" },
        { name: "slots", args: "<bet|all>", desc: "Slot machine" },
        { name: "dice", args: "<bet|all>", desc: "Roll dice" },
        { name: "blackjack", args: "<bet|all>", desc: "Blackjack" },
        { name: "roulette", args: "<bet|all> <color|number>", desc: "Roulette" },
        { name: "crash", args: "<bet|all> [auto]", desc: "Crash — cash out before 25x" },
        { name: "hide", args: "", desc: "Hide other people's games" },
        { name: "timeout", args: "@user 10m [reason]", desc: "Mute a member for a while" },
        { name: "untimeout", args: "@user", desc: "Lift a member's timeout" },
        { name: "purge", args: "<n | all>", desc: "Delete recent messages" },
        { name: "giveaway", args: "<duration> <prize>", desc: "Start a giveaway" },
        { name: "gend", args: "[id]", desc: "End a giveaway & draw now" },
        { name: "panel", args: "", desc: "Open admin control panel" },
        { name: "setgems", args: "@user <amount>", desc: "Set user gem balance" },
        { name: "givegems", args: "@user <amount>", desc: "Give gems to user" },
        { name: "setrole", args: "@user <title> [#color]", desc: "Set user tag title & color" },
        { name: "setperm", args: "@user <admin|mod|member>", desc: "Set permission level" },
        { name: "help", args: "", desc: "List all commands" }
    ];
    let cmdBox = null, cmdItems = [], cmdActive = 0;
    function cmdOpen() { return !!(cmdBox && cmdBox.style.display === "block"); }
    function closeCmd() { if (cmdBox) cmdBox.style.display = "none"; cmdItems = []; }
    function cmdContext() {
        if (!canRunCommands() || state.mode !== "room") return null;
        const m = /^\/(\w*)$/.exec(input.value);
        return m ? { query: m[1].toLowerCase() } : null;
    }
    function paintCmdActive() { if (cmdBox) cmdBox.querySelectorAll(".cmd-item").forEach((el, i) => el.classList.toggle("active", i === cmdActive)); }
    function applyCmd(name) {
        input.value = "/" + name + " ";
        closeCmd(); input.focus();
        const np = input.value.length; try { input.setSelectionRange(np, np); } catch {}
        autoGrow(); updateCount(); syncSendState();
    }
    function renderCmd() {
        if (!cmdBox) {
            cmdBox = document.createElement("div"); cmdBox.className = "cmd-box";
            (composer || input.parentElement).appendChild(cmdBox);
            cmdBox.addEventListener("mousedown", e => { const it = e.target.closest("[data-c]"); if (it) { e.preventDefault(); applyCmd(it.dataset.c); } });
            cmdBox.addEventListener("mousemove", e => { const it = e.target.closest("[data-i]"); if (it) { cmdActive = +it.dataset.i; paintCmdActive(); } });
        }
        cmdBox.innerHTML = '<div class="cmd-head">Commands</div>' + cmdItems.map((c, i) =>
            '<div class="cmd-item' + (i === cmdActive ? " active" : "") + '" data-c="' + c.name + '" data-i="' + i + '"><span class="cmd-name"><span class="cmd-slash">/</span>' + c.name + (c.args ? ' <span class="cmd-args">' + esc(c.args) + "</span>" : "") + '</span><span class="cmd-desc">' + esc(c.desc) + "</span></div>").join("");
        cmdBox.style.display = "block";
    }
    function updateCmd() {
        const ctx = cmdContext();
        if (!ctx) { closeCmd(); return; }
        closeEmoji();
        cmdItems = COMMANDS.filter(c => c.name.startsWith(ctx.query));
        if (!cmdItems.length) { closeCmd(); return; }
        if (cmdActive >= cmdItems.length) cmdActive = 0;
        renderCmd();
    }
    function cmdKey(e) {
        if (!cmdOpen()) return false;
        if (e.key === "ArrowDown") { cmdActive = (cmdActive + 1) % cmdItems.length; paintCmdActive(); e.preventDefault(); return true; }
        if (e.key === "ArrowUp") { cmdActive = (cmdActive - 1 + cmdItems.length) % cmdItems.length; paintCmdActive(); e.preventDefault(); return true; }
        if (e.key === "Enter" || e.key === "Tab") { applyCmd((cmdItems[cmdActive] || cmdItems[0]).name); e.preventDefault(); return true; }
        if (e.key === "Escape") { closeCmd(); e.preventDefault(); return true; }
        return false;
    }
    input.addEventListener("input", updateCmd);
    input.addEventListener("blur", () => setTimeout(closeCmd, 160));

    const EMOJIS = [
        ["smile", "😄"], ["grin", "😁"], ["joy", "😂"], ["rofl", "🤣"], ["sob", "😭"], ["cry", "😢"],
        ["heart", "❤️"], ["heart_eyes", "😍"], ["smiling_face_with_hearts", "🥰"], ["kiss", "😘"], ["wink", "😉"],
        ["thumbsup", "👍"], ["thumbsdown", "👎"], ["fire", "🔥"], ["100", "💯"], ["skull", "💀"],
        ["wave", "👋"], ["pray", "🙏"], ["clap", "👏"], ["ok_hand", "👌"], ["muscle", "💪"],
        ["eyes", "👀"], ["thinking", "🤔"], ["flushed", "😳"], ["scream", "😱"], ["rage", "😡"],
        ["smirk", "😏"], ["unamused", "😒"], ["rolling_eyes", "🙄"], ["neutral_face", "😐"], ["expressionless", "😑"],
        ["sleeping", "😴"], ["yawning", "🥱"], ["cold_face", "🥶"], ["hot_face", "🥵"], ["melting", "🫠"],
        ["partying", "🥳"], ["tada", "🎉"], ["sparkles", "✨"], ["star", "⭐"], ["star2", "🌟"],
        ["sun", "☀️"], ["moon", "🌙"], ["cloud", "☁️"], ["snowflake", "❄️"], ["zap", "⚡"],
        ["white_check_mark", "✅"], ["x", "❌"], ["warning", "⚠️"], ["question", "❓"], ["exclamation", "❗"],
        ["poop", "💩"], ["clown", "🤡"], ["ghost", "👻"], ["alien", "👽"], ["robot", "🤖"],
        ["cat", "🐱"], ["dog", "🐶"], ["fox", "🦊"], ["frog", "🐸"], ["monkey", "🐵"], ["unicorn", "🦄"],
        ["pizza", "🍕"], ["hamburger", "🍔"], ["fries", "🍟"], ["cake", "🎂"], ["coffee", "☕"], ["beer", "🍺"],
        ["gem", "💎"], ["moneybag", "💰"], ["gift", "🎁"], ["crown", "👑"], ["trophy", "🏆"],
        ["rocket", "🚀"], ["car", "🚗"], ["airplane", "✈️"], ["notes", "🎵"], ["headphones", "🎧"],
        ["camera", "📷"], ["iphone", "📱"], ["computer", "💻"], ["video_game", "🎮"],
        ["lock", "🔒"], ["key", "🔑"], ["bell", "🔔"], ["pushpin", "📌"], ["sos", "🆘"],
        ["sweat_smile", "😅"], ["pleading", "🥺"], ["salute", "🫡"], ["shrug", "🤷"], ["facepalm", "🤦"]
    ];
    let emojiBox = null, emojiItems = [], emojiActive = 0;
    function emojiOpen() { return !!(emojiBox && emojiBox.style.display === "block"); }
    function closeEmoji() { if (emojiBox) emojiBox.style.display = "none"; emojiItems = []; }
    function emojiContext() {
        const v = input.value, pos = input.selectionStart == null ? v.length : input.selectionStart;
        const m = /(^|\s):([a-z0-9_+]{0,32})$/i.exec(v.slice(0, pos));
        if (!m) return null;
        return { query: m[2].toLowerCase(), start: pos - m[2].length - 1, end: pos };
    }
    function emojiChoices(q) {
        const list = q ? EMOJIS.filter(e => e[0].includes(q)) : EMOJIS.slice(0, 8);
        list.sort((a, b) => {
            const as = a[0].startsWith(q) ? 0 : 1, bs = b[0].startsWith(q) ? 0 : 1;
            if (as !== bs) return as - bs;
            return a[0].length - b[0].length;
        });
        return list.slice(0, 8);
    }
    function paintEmojiActive() { if (emojiBox) emojiBox.querySelectorAll(".emoji-item").forEach((el, i) => el.classList.toggle("active", i === emojiActive)); }
    function insertEmoji(emoji) {
        const ctx = emojiContext(); if (!ctx) return;
        const v = input.value;
        input.value = v.slice(0, ctx.start) + emoji + " " + v.slice(ctx.end);
        const np = ctx.start + emoji.length + 1;
        try { input.setSelectionRange(np, np); } catch {}
        input.focus(); closeEmoji(); autoGrow(); updateCount(); syncSendState();
    }
    function renderEmoji() {
        if (!emojiBox) {
            emojiBox = document.createElement("div"); emojiBox.className = "emoji-box";
            (composer || input.parentElement).appendChild(emojiBox);
            emojiBox.addEventListener("mousedown", e => { const it = e.target.closest("[data-e]"); if (it) { e.preventDefault(); insertEmoji(it.dataset.e); } });
            emojiBox.addEventListener("mousemove", e => { const it = e.target.closest("[data-i]"); if (it) { emojiActive = +it.dataset.i; paintEmojiActive(); } });
        }
        emojiBox.innerHTML = '<div class="emoji-head">Emoji</div>' + emojiItems.map((e, i) =>
            '<div class="emoji-item' + (i === emojiActive ? " active" : "") + '" data-e="' + e[1] + '" data-i="' + i + '"><span class="emoji-glyph">' + e[1] + '</span><span class="emoji-name">:' + esc(e[0]) + ':</span></div>').join("");
        emojiBox.style.display = "block";
    }
    function updateEmoji() {
        const ctx = emojiContext();
        if (!ctx) { closeEmoji(); return; }
        closeCmd(); closeMention();
        emojiItems = emojiChoices(ctx.query);
        if (!emojiItems.length) { closeEmoji(); return; }
        if (emojiActive >= emojiItems.length) emojiActive = 0;
        renderEmoji();
    }
    function emojiKey(e) {
        if (!emojiOpen()) return false;
        if (e.key === "ArrowDown") { emojiActive = (emojiActive + 1) % emojiItems.length; paintEmojiActive(); e.preventDefault(); return true; }
        if (e.key === "ArrowUp") { emojiActive = (emojiActive - 1 + emojiItems.length) % emojiItems.length; paintEmojiActive(); e.preventDefault(); return true; }
        if (e.key === "Enter" || e.key === "Tab") { insertEmoji((emojiItems[emojiActive] || emojiItems[0])[1]); e.preventDefault(); return true; }
        if (e.key === "Escape") { closeEmoji(); e.preventDefault(); return true; }
        return false;
    }
    input.addEventListener("input", updateEmoji);
    input.addEventListener("keyup", updateEmoji);
    input.addEventListener("click", updateEmoji);
    input.addEventListener("blur", () => setTimeout(closeEmoji, 160));

    const roomsScrim = document.createElement("div");
    roomsScrim.className = "rooms-scrim";
    if (roomsEl && roomsEl.parentElement) roomsEl.parentElement.appendChild(roomsScrim);
    roomsScrim.addEventListener("click", () => roomsEl.classList.remove("open"));
    function cssUrl(v) { return v ? 'url("' + v.replace(/"/g, "%22") + '")' : ""; }
    function paintEditor() {
        avInto(avatarPreview, state.me.username || "?", pendingAvatar);
        peBanner.style.backgroundImage = cssUrl(pendingBanner);
        bgPreview.style.backgroundImage = cssUrl(pendingBg);
    }
    async function openProfile() {
        if (state.me.userId == null) { showGate(); return; }
        profileErr.classList.remove("show");
        let p = { avatar: state.me.avatar, banner: null, background: null, pronouns: "", bio: "" };
        try { const r = await fetch("/api/chat/profile", { credentials: "same-origin" }); const d = await r.json(); if (d.profile) p = d.profile; } catch {}
        pendingAvatar = p.avatar; pendingBanner = p.banner; pendingBg = p.background;
        pronounsInput.value = p.pronouns || ""; bioInput.value = p.bio || "";
        paintEditor(); profileModal.classList.add("show");
    }

    function resizeImage(file, maxW, maxH, square) {
        return new Promise((resolve, reject) => {
            const img = new Image(), url = URL.createObjectURL(file);
            img.onload = () => {
                URL.revokeObjectURL(url);
                let c = document.createElement("canvas"), ctx;
                if (square) {
                    const size = maxW; c.width = size; c.height = size; ctx = c.getContext("2d");
                    const scale = Math.max(size / img.width, size / img.height), w = img.width * scale, h = img.height * scale;
                    ctx.drawImage(img, (size - w) / 2, (size - h) / 2, w, h);
                } else {
                    const ratio = Math.min(1, maxW / img.width, maxH / img.height);
                    c.width = Math.round(img.width * ratio); c.height = Math.round(img.height * ratio);
                    c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
                }
                resolve(c.toDataURL("image/jpeg", 0.85));
            };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
            img.src = url;
        });
    }
    async function pickImage(input, maxW, maxH, square, set) {
        const f = input.files && input.files[0]; input.value = ""; if (!f) return;
        if (f.size > 12 * 1024 * 1024) { profileErr.textContent = "That image is too big."; profileErr.classList.add("show"); return; }
        try { const data = await resizeImage(f, maxW, maxH, square); if (data.length > state.imageMax) { profileErr.textContent = "Image is too large even after resizing."; profileErr.classList.add("show"); return; } set(data); profileErr.classList.remove("show"); paintEditor(); }
        catch { profileErr.textContent = "Couldn't read that image."; profileErr.classList.add("show"); }
    }
    async function saveProfile() {
        const body = { avatar: pendingAvatar || null, banner: pendingBanner || null, background: pendingBg || null, pronouns: pronounsInput.value.trim(), bio: bioInput.value };
        try {
            const r = await fetch("/api/chat/profile", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { profileErr.textContent = d.error || "Couldn't save."; profileErr.classList.add("show"); return; }
            state.me.avatar = d.profile ? d.profile.avatar : pendingAvatar; paintMe(); onAvatar({ userId: state.me.userId, avatar: state.me.avatar });
            profileModal.classList.remove("show"); toast("Profile saved.");
        } catch { profileErr.textContent = "Network error."; profileErr.classList.add("show"); }
    }

    let pcUser = null;
    async function openProfileCard(userId) {
        if (!userId) return;
        try {
            const r = await fetch("/api/users/" + userId + "/profile", { credentials: "same-origin" });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.profile) { toast(d.error || "Couldn't load profile."); return; }
            const p = d.profile; pcUser = p;
            const card = $("profileCard");
            if (p.background) { card.classList.add("has-bg"); card.style.setProperty("--pc-bg", cssUrl(p.background)); } else { card.classList.remove("has-bg"); card.style.removeProperty("--pc-bg"); }
            $("pcBanner").style.backgroundImage = cssUrl(p.banner);
            avInto($("pcAvatar"), p.username, p.avatar);
            $("pcName").textContent = p.username;
            $("pcPronouns").textContent = p.pronouns || "";
            $("pcBio").textContent = p.bio || "";
            $("pcMessage").style.display = (state.me.userId === p.id) ? "none" : "";
            profileView.classList.add("show");
        } catch { toast("Couldn't load profile."); }
    }

    const gifBtn = $("gifBtn"), gifPicker = $("gifPicker"), gifInput = $("gifInput"), gifGrid = $("gifGrid"), gifTabsEl = $("gifTabs");
    let gifTimer = 0, gifTab = "trending";
    const gifFavs = new Map();

    function toggleGif() { if (gifPicker.hidden) openGifPicker(); else gifPicker.hidden = true; }
    function openGifPicker() { gifPicker.hidden = false; gifInput.value = ""; restoreGifSize(); watchGifSize(); loadFavSet(); setGifTab("trending"); setTimeout(() => gifInput.focus(), 30); }

    const GIF_SIZE_KEY = "nocturne:gifsize";
    let gifSizeObs = null, gifSizeTimer = 0;
    function restoreGifSize() { try { const s = JSON.parse(localStorage.getItem(GIF_SIZE_KEY) || "null"); if (s && s.w && s.h) { gifPicker.style.width = s.w + "px"; gifPicker.style.height = s.h + "px"; } } catch {} }
    function watchGifSize() {
        if (gifSizeObs || !window.ResizeObserver) return;
        gifSizeObs = new ResizeObserver(() => { clearTimeout(gifSizeTimer); gifSizeTimer = setTimeout(() => { if (!gifPicker.hidden) try { localStorage.setItem(GIF_SIZE_KEY, JSON.stringify({ w: Math.round(gifPicker.offsetWidth), h: Math.round(gifPicker.offsetHeight) })); } catch {} }, 350); });
        gifSizeObs.observe(gifPicker);
    }
    function setGifTab(tab) {
        gifTab = tab; gifInput.value = "";
        gifTabsEl.querySelectorAll(".gif-tab").forEach(b => b.classList.toggle("active", b.dataset.tab === tab));
        if (tab === "favorites") renderFavGrid(); else loadGifs("");
    }
    async function loadFavSet() {
        try { const r = await fetch("/api/giphy/favorites", { credentials: "same-origin" }); const d = await r.json().catch(() => ({})); if (d.favorites) { gifFavs.clear(); d.favorites.forEach(g => gifFavs.set(g.gif_id, g)); if (gifTab === "favorites") renderFavGrid(); } } catch {}
    }
    function renderFavGrid() {
        const arr = [...gifFavs.values()];
        if (!arr.length) { gifGrid.innerHTML = '<div class="gif-empty">No favorites yet.<br>Tap the &#9733; on any GIF to save it here.</div>'; return; }
        renderGifTiles(arr);
    }
    async function loadGifs(q) {
        gifGrid.innerHTML = '<div class="gif-empty">Loading...</div>';
        try {
            const r = await fetch("/api/giphy/search?q=" + encodeURIComponent(q), { credentials: "same-origin" });
            const d = await r.json().catch(() => ({}));
            if (!r.ok || !d.gifs) { gifGrid.innerHTML = '<div class="gif-empty">' + esc(d.error || "Couldn't load GIFs.") + "</div>"; return; }
            if (!d.gifs.length) { gifGrid.innerHTML = '<div class="gif-empty">No GIFs found.</div>'; return; }
            renderGifTiles(d.gifs);
        } catch { gifGrid.innerHTML = '<div class="gif-empty">Couldn\'t load GIFs.</div>'; }
    }
    function renderGifTiles(gifs) {
        gifGrid.innerHTML = "";
        gifs.forEach(g => {
            const gid = g.gif_id || g.id; if (!gid) return;
            const tile = document.createElement("div"); tile.className = "gif-tile";
            const img = document.createElement("img"); img.src = g.preview || g.url; img.alt = g.title || "GIF"; img.loading = "lazy"; img.onclick = () => sendGif(g.url);
            const star = document.createElement("button"); star.type = "button"; star.className = "gif-fav" + (gifFavs.has(gid) ? " on" : ""); star.innerHTML = "&#9733;"; star.title = "Favorite";
            star.onclick = e => { e.stopPropagation(); const add = !gifFavs.has(gid); star.classList.toggle("on", add); toggleFav({ gif_id: gid, url: g.url, preview: g.preview || null, title: g.title || null }, add); };
            tile.appendChild(img); tile.appendChild(star); gifGrid.appendChild(tile);
        });
    }
    async function toggleFav(g, add) {
        const gid = g.gif_id; if (!gid) return;
        if (add) { gifFavs.set(gid, g); try { await fetch("/api/giphy/favorites", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(g) }); } catch {} }
        else { gifFavs.delete(gid); try { await fetch("/api/giphy/favorites/" + encodeURIComponent(gid), { method: "DELETE", credentials: "same-origin" }); } catch {} if (gifTab === "favorites") renderFavGrid(); }
    }
    async function sendGif(url) {
        gifPicker.hidden = true;
        if (state.me.userId == null) { showGate(); return; }
        const endpoint = state.mode === "dm" ? "/api/dm/with/" + state.dm.otherId + "/send" : "/api/chat/send";
        const body = state.mode === "dm" ? { text: url } : { room: state.room, text: url };
        try {
            const r = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
            const d = await r.json().catch(() => ({}));
            if (!r.ok) { toast(d.error || "Couldn't send GIF."); return; }
            if (d.blocked) { toast("That GIF couldn't be sent."); return; }
            if (d.message) { if (state.mode === "dm") { appendMessage(dmToMsg(d.message)); bumpThreadLocal(state.dm.otherId, "GIF"); } else appendMessage(d.message); scrollToBottom(true); }
        } catch { toast("Couldn't send GIF."); }
    }

    const mediaViewer = $("mediaViewer"), mvImg = $("mvImg"), mvFav = $("mvFav"), mvOpen = $("mvOpen");
    let mvGifId = null;
    function gifIdFromUrl(url) { try { const p = new URL(url).pathname.split("/").filter(Boolean); if (p.length >= 2) return p[p.length - 2]; } catch {} return null; }
    function openMediaViewer(url, isGif) {
        mvImg.src = url; mvOpen.href = url;
        if (isGif) { mvGifId = gifIdFromUrl(url); mvFav.hidden = false; mvFav.classList.toggle("on", !!(mvGifId && gifFavs.has(mvGifId))); }
        else { mvFav.hidden = true; mvGifId = null; }
        mediaViewer.classList.add("show");
    }
    function mvToggleFav() {
        if (!mvGifId) return;
        const add = !gifFavs.has(mvGifId);
        mvFav.classList.toggle("on", add);
        toggleFav({ gif_id: mvGifId, url: mvImg.src, preview: null, title: null }, add);
        toast(add ? "Added to favorites." : "Removed from favorites.");
    }

    const notifBtn = $("notifBtn"), NOTIF_KEY = "nocturne:dmnotif";
    function paintNotif() {
        notifBtn.classList.remove("on", "denied");
        if (!("Notification" in window)) { notifBtn.style.display = "none"; return; }
        if (Notification.permission === "denied") notifBtn.classList.add("denied");
        else if (Notification.permission === "granted" && state.notif) notifBtn.classList.add("on");
    }
    function setNotif(v) { try { localStorage.setItem(NOTIF_KEY, v ? "1" : "0"); } catch {} state.notif = v; paintNotif(); }
    function onNotifClick() {
        if (!("Notification" in window)) { toast("Notifications aren't supported here."); return; }
        if (Notification.permission === "granted") { setNotif(!state.notif); toast(state.notif ? "DM notifications on." : "DM notifications off."); return; }
        if (Notification.permission === "denied") { showNotifHelp(); return; }
        Notification.requestPermission().then(perm => {
            if (perm === "granted") { setNotif(true); toast("DM notifications on."); }
            else { paintNotif(); if (perm === "denied") showNotifHelp(); }
        });
    }
    function showNotifHelp() {
        let m = document.getElementById("notifHelp");
        if (!m) {
            m = document.createElement("div"); m.id = "notifHelp"; m.className = "modal-back";
            m.innerHTML = '<div class="modal"><div class="modal-title">Turn on notifications</div>' +
                '<div class="modal-sub">Notifications are blocked for this site in your browser. To turn them back on:</div>' +
                '<ol style="margin:0 0 4px 18px;font-size:13px;color:var(--fg-2);line-height:1.7">' +
                '<li>Click the <b>lock / tune icon</b> at the left of the address bar.</li>' +
                '<li>Open <b>Site settings</b> (or "Permissions").</li>' +
                '<li>Set <b>Notifications</b> to <b>Allow</b>.</li>' +
                '<li>Reload this page, then click the bell again.</li></ol>' +
                '<div class="modal-actions"><button class="btn-soft btn-primary grow" id="notifHelpClose" type="button">Got it</button></div></div>';
            document.body.appendChild(m);
            m.addEventListener("click", e => { if (e.target === m || e.target.id === "notifHelpClose") m.classList.remove("show"); });
        }
        m.classList.add("show");
    }
    function maybeNotify(m, username) {
        if (!state.notif || !("Notification" in window) || Notification.permission !== "granted") return;
        if (!document.hidden && inOpenDm(m.senderId)) return;
        try {
            const body = GIF_RE.test((m.text || "").trim()) ? "Sent a GIF" : (m.text || "New message");
            const n = new Notification(username, { body, tag: "noc-dm-" + m.senderId });
            n.onclick = () => { try { window.focus(); } catch {} openDm({ id: m.senderId, username, avatar: m.avatar }); n.close(); };
        } catch {}
    }

    let fwdId = null;
    function openForward(id) { fwdId = id; const box = $("fwdRooms"); box.innerHTML = ""; state.rooms.forEach(rm => { const b = document.createElement("button"); b.className = "fwd-room"; b.type = "button"; b.innerHTML = '<span class="cr-hash">#</span>' + esc(rm.label); b.onclick = () => { fwdModal.classList.remove("show"); forwardTo(id, rm.id); }; box.appendChild(b); }); fwdModal.classList.add("show"); }
    function closeModals() { profileModal.classList.remove("show"); fwdModal.classList.remove("show"); findModal.classList.remove("show"); profileView.classList.remove("show"); mediaViewer.classList.remove("show"); }

    function showGate() { gate.classList.add("show"); input.disabled = true; sendBtn.disabled = true; stopStream(); }
    function hideGate() { gate.classList.remove("show"); input.disabled = false; syncSendState(); }
    async function refreshOnline() { try { const r = await fetch("/api/online", { credentials: "same-origin" }); const d = await r.json(); if (typeof d.online === "number") onlineCount.textContent = d.online; } catch {} }

    async function loadThreads() {
        try {
            const r = await fetch("/api/dm/threads", { credentials: "same-origin" });
            const d = await r.json().catch(() => ({}));
            if (d.threads) { dmThreads.clear(); d.threads.forEach(t => dmThreads.set(t.otherId, t)); renderThreads(); refreshDmTotal(); }
        } catch {}
    }

    async function init() {
        try {
            const r = await fetch("/api/chat/info", { credentials: "same-origin" });
            const info = await r.json();
            state.rooms = Array.isArray(info.rooms) && info.rooms.length ? info.rooms : [{ id: "general", label: "General" }];
            state.maxLen = info.maxLength || 1000;
            if (Array.isArray(info.reactionEmojis) && info.reactionEmojis.length) state.reactionEmojis = info.reactionEmojis;
            state.giphy = !!info.giphy; state.imageMax = info.imageMax || 4300000;
            gifBtn.hidden = !state.giphy;
            try { state.notif = localStorage.getItem(NOTIF_KEY) === "1"; } catch {}
            paintNotif();
            input.maxLength = state.maxLen;
            let want = "general";
            try { want = localStorage.getItem(ROOM_KEY) || info.defaultRoom || "general"; } catch { want = info.defaultRoom || "general"; }
            if (!state.rooms.some(r => r.id === want)) want = info.defaultRoom || state.rooms[0].id;
            state.room = want; state.mode = "room";
            const rm = state.rooms.find(r => r.id === want);
            input.placeholder = "Message #" + (rm ? rm.id : want);
            renderRooms(); paintConvoBar();

            state.me = { username: info.username, userId: info.userId, avatar: info.avatar || null, ...(info.me || {}) };
            state.gems = info.gems || 0;
            paintMe();
            paintGemBal();
            initPresenceUI();
            if (!info.authenticated) { showGate(); renderThreads(); return; }
            hideGate();
            await loadThreads();
            await loadMessages();
            connectStream();
        } catch { toast("Couldn't reach chat. Reconnecting..."); setTimeout(init, 4000); }
    }

    composer.addEventListener("submit", e => { e.preventDefault(); submit(); });
    input.addEventListener("input", () => { autoGrow(); updateCount(); syncSendState(); });
    input.addEventListener("keydown", e => { if (emojiKey(e) || cmdKey(e)) return; if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } else if (e.key === "Escape" && (state.replyingTo || state.editingId != null)) { cancelReply(); cancelEdit(); } });
    $("ccCancel").addEventListener("click", () => { cancelReply(); cancelEdit(); });
    $("menuBtn").addEventListener("click", () => roomsEl.classList.toggle("open"));
    $("gateReload").addEventListener("click", () => { hideGate(); init(); });
    $("meBtn").addEventListener("click", openProfile);
    $("dmAddBtn").addEventListener("click", openFind);
    notifBtn.addEventListener("click", onNotifClick);

    $("profileCancel").addEventListener("click", () => profileModal.classList.remove("show"));
    $("profileSave").addEventListener("click", saveProfile);
    $("avatarUploadBtn").addEventListener("click", () => avatarFile.click());
    $("avatarRemoveBtn").addEventListener("click", () => { pendingAvatar = null; paintEditor(); });
    $("bannerUploadBtn").addEventListener("click", () => bannerFile.click());
    $("bannerRemoveBtn").addEventListener("click", () => { pendingBanner = null; paintEditor(); });
    $("bgUploadBtn").addEventListener("click", () => bgFile.click());
    $("bgRemoveBtn").addEventListener("click", () => { pendingBg = null; paintEditor(); });
    avatarFile.addEventListener("change", () => pickImage(avatarFile, 256, 256, true, v => pendingAvatar = v));
    bannerFile.addEventListener("change", () => pickImage(bannerFile, 1200, 480, false, v => pendingBanner = v));
    bgFile.addEventListener("change", () => pickImage(bgFile, 1280, 1280, false, v => pendingBg = v));

    $("pcClose").addEventListener("click", () => profileView.classList.remove("show"));
    $("pcMessage").addEventListener("click", () => { if (pcUser) { profileView.classList.remove("show"); addAndOpen(pcUser); } });

    gifBtn.addEventListener("click", toggleGif);
    $("gifClose").addEventListener("click", () => gifPicker.hidden = true);
    gifTabsEl.addEventListener("click", e => { const t = e.target.closest(".gif-tab"); if (t) setGifTab(t.dataset.tab); });
    gifInput.addEventListener("input", () => {
        clearTimeout(gifTimer); const q = gifInput.value.trim();
        gifTimer = setTimeout(() => { if (q) { gifTabsEl.querySelectorAll(".gif-tab").forEach(b => b.classList.remove("active")); loadGifs(q); } else setGifTab(gifTab); }, 280);
    });

    $("fwdCancel").addEventListener("click", () => fwdModal.classList.remove("show"));
    $("findCancel").addEventListener("click", () => findModal.classList.remove("show"));
    findInput.addEventListener("input", () => { clearTimeout(findTimer); const q = findInput.value.trim(); findTimer = setTimeout(() => runSearch(q), 220); });

    mvFav.addEventListener("click", mvToggleFav);
    $("mvClose").addEventListener("click", () => mediaViewer.classList.remove("show"));
    [profileModal, fwdModal, findModal, profileView, mediaViewer].forEach(mb => mb.addEventListener("click", e => { if (e.target === mb) mb.classList.remove("show"); }));

    function unstrandFades() {
        document.querySelectorAll(".msg, .chat-notice, .chat-sys, .giveaway-card").forEach(el => { el.style.animation = "none"; });
        var h = document.documentElement;
        h.classList.add("noc-bfx");
        void document.body.offsetWidth;
        requestAnimationFrame(function () { requestAnimationFrame(function () { h.classList.remove("noc-bfx"); }); });
    }
    document.addEventListener("visibilitychange", () => {
        if (document.hidden) return;
        unstrandFades();
        if (state.me.userId != null && (!state.es || state.es.readyState === 2)) connectStream();
    });
    window.addEventListener("pageshow", () => { if (!document.hidden) unstrandFades(); });
    window.addEventListener("beforeunload", stopStream);

    refreshOnline(); setInterval(refreshOnline, 30000); init();
})();
