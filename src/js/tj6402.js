(function () {
    "use strict";
    const $ = id => document.getElementById(id);
    const MODEL = "navy:gemini-3.5-flash";
    const SYSTEM = "You are a helpful screen assistant. You are shown a snapshot of the user's shared screen along with their question. Look carefully at the screen and answer concisely and accurately based on what you can actually see. If something is too small or unclear to read, say so. Use markdown for formatting (bold, italics, headings, lists, code) and LaTeX for math, e.g. $\\frac{1}{2}$.";

    function escapeHtml(s) { return String(s || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
    function utf8ToB64(s) { const b = new TextEncoder().encode(s); let bin = ""; for (let i = 0; i < b.length; i++) bin += String.fromCharCode(b[i]); return btoa(bin).replace(/=+$/, ""); }
    function b64ToUtf8(s) { const p = s + "===".slice((s.length + 3) % 4); const bin = atob(p); const b = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) b[i] = bin.charCodeAt(i); return new TextDecoder().decode(b); }
    const SC = String.fromCharCode(0xE000), SM = String.fromCharCode(0xE001);
    function renderMd(text) {
        const codeBlocks = [];
        let html = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => { const i = codeBlocks.push({ lang: (lang || "text").toLowerCase(), code: code.replace(/\n$/, "") }) - 1; return SC + i + SC; });
        const mathBlocks = [];
        html = html.replace(/\\\[([\s\S]+?)\\\]|\$\$([\s\S]+?)\$\$|\\\(([\s\S]+?)\\\)|\$([^$\n]+?)\$/g, (m, d1, d2, inl, inl2) => {
            if (inl2 !== undefined && !/[{}^_]/.test(inl2)) return m;
            const display = d1 !== undefined || d2 !== undefined;
            const tex = d1 !== undefined ? d1 : (d2 !== undefined ? d2 : (inl !== undefined ? inl : inl2));
            const i = mathBlocks.push({ tex, display }) - 1;
            return SM + i + SM;
        });
        html = escapeHtml(html);
        html = html.replace(/&lt;(\/?)(br|sub|sup|u|kbd|mark|small)\s*\/?&gt;/gi, (_, slash, tag) => "<" + slash + tag.toLowerCase() + ">");
        html = html.replace(/^(#{1,6})\s+(.+)$/gm, (m, h, c) => { const lvl = Math.min(6, h.length); return "<h" + lvl + ">" + c.trim() + "</h" + lvl + ">"; });
        html = html.replace(/^[\s]*(?:[-*_]\s*){3,}[\s]*$/gm, "<hr>");
        html = html.replace(/(?:^&gt;\s?.+(?:\n&gt;\s?.+)*)/gm, m => { const inner = m.replace(/^&gt;\s?/gm, ""); return "<blockquote>" + inner.replace(/\n/g, "<br>") + "</blockquote>"; });
        html = html.replace(/(^|\n)((?:\d+\.\s+.+(?:\n {2,}.+)*\n?)+)/g, (m, lead, list) => { const items = list.trim().split(/\n(?=\d+\.\s+)/).map(it => "<li>" + it.replace(/^\d+\.\s+/, "").replace(/\n {2,}/g, " ").trim() + "</li>").join(""); return lead + "<ol>" + items + "</ol>"; });
        html = html.replace(/(^|\n)((?:[-*]\s+.+(?:\n {2,}.+)*\n?)+)/g, (m, lead, list) => { const items = list.trim().split(/\n(?=[-*]\s+)/).map(it => "<li>" + it.replace(/^[-*]\s+/, "").replace(/\n {2,}/g, " ").trim() + "</li>").join(""); return lead + "<ul>" + items + "</ul>"; });
        html = html.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
        html = html.replace(/__([^_\n]+)__/g, "<strong>$1</strong>");
        html = html.replace(/(^|[^*\w])\*([^*\n]+)\*/g, "$1<em>$2</em>");
        html = html.replace(/~~([^~\n]+)~~/g, "<del>$1</del>");
        html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
        html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
        const phRe = new RegExp("^(" + SC + "[0-9]+" + SC + "|" + SM + "[0-9]+" + SM + ")$");
        html = html.split(/\n{2,}/).map(p => { const t = p.trim(); if (!t) return ""; if (/^<(h\d|ul|ol|pre|blockquote|table|hr)/.test(t)) return p; if (phRe.test(t)) return p; return "<p>" + p.replace(/\n/g, "<br>") + "</p>"; }).filter(Boolean).join("\n");
        html = html.replace(new RegExp(SC + "([0-9]+)" + SC, "g"), (_, i) => { const b = codeBlocks[i]; const enc = utf8ToB64(b.code); return '<div class="code-block"><div class="code-head"><span class="code-lang">' + escapeHtml(b.lang) + '</span><button class="code-copy" data-c="' + enc + '">Copy</button></div><pre><code>' + escapeHtml(b.code) + "</code></pre></div>"; });
        html = html.replace(new RegExp(SM + "([0-9]+)" + SM, "g"), (_, i) => { const bm = mathBlocks[i]; if (!bm) return ""; const fb = escapeHtml((bm.display ? "\\[" : "\\(") + bm.tex + (bm.display ? "\\]" : "\\)")); return '<span class="noc-math" data-d="' + (bm.display ? 1 : 0) + '" data-tex="' + utf8ToB64(bm.tex) + '">' + fb + "</span>"; });
        return html;
    }
    function typesetMath(container) {
        if (!container || typeof window.katex === "undefined") return;
        container.querySelectorAll(".noc-math:not(.tex-done)").forEach(el => {
            let tex = ""; try { tex = b64ToUtf8(el.dataset.tex || ""); } catch {}
            const display = el.dataset.d === "1";
            try { el.innerHTML = window.katex.renderToString(tex, { displayMode: display, throwOnError: false }); }
            catch { el.textContent = (display ? "\\[" : "\\(") + tex + (display ? "\\]" : "\\)"); }
            el.classList.add("tex-done");
        });
    }

    const ssStart = $("ssStart"), ssScreen = $("ssScreen"), ssHint = $("ssHint");
    const video = $("preview"), convo = $("convo"), input = $("input"), composer = $("composer"), sendBtn = $("sendBtn");
    const SEND_ICON = sendBtn.innerHTML;

    let stream = null, busy = false;
    const history = [];

    function enableComposer(on) {
        input.disabled = !on;
        sendBtn.disabled = !on || busy;
        input.placeholder = on ? "Ask about what's on your screen..." : "Start screen share first...";
    }

    const stats = { startedAt: 0, shots: 0, bytes: 0, timer: null };
    const SURFACE = { monitor: "Entire screen", window: "Window", browser: "Browser tab", application: "Application" };
    function setStat(id, val, bump) {
        const e = $(id);
        if (!e || e.textContent === String(val)) return;
        e.textContent = val;
        if (bump) { e.classList.add("bump"); setTimeout(() => e.classList.remove("bump"), 600); }
    }
    function fmtBytes(n) {
        if (n < 1024) return n + " B";
        if (n < 1048576) return (n / 1024).toFixed(0) + " KB";
        return (n / 1048576).toFixed(1) + " MB";
    }
    function fmtElapsed(ms) {
        const s = Math.floor(ms / 1000), m = Math.floor(s / 60), h = Math.floor(m / 60);
        const mm = h ? String(m % 60).padStart(2, "0") : String(m);
        return (h ? h + ":" : "") + mm + ":" + String(s % 60).padStart(2, "0");
    }
    function refreshStats() {
        if (!stream) return;
        const track = stream.getVideoTracks()[0];
        const s = track ? track.getSettings() : {};
        setStat("stSource", SURFACE[s.displaySurface] || (s.displaySurface ? s.displaySurface : "Screen"));
        setStat("stRes", video.videoWidth ? video.videoWidth + " × " + video.videoHeight : "—");
        setStat("stFps", s.frameRate ? Math.round(s.frameRate) + " fps" : "—");
        setStat("stTime", fmtElapsed(Date.now() - stats.startedAt));
    }
    function startStats() {
        stats.startedAt = Date.now(); stats.shots = 0; stats.bytes = 0;
        setStat("stShots", "0"); setStat("stShotSize", "—"); setStat("stData", "0 KB");
        refreshStats();
        clearInterval(stats.timer);
        stats.timer = setInterval(refreshStats, 1000);

        video.addEventListener("loadedmetadata", refreshStats, { once: true });
    }
    function stopStats() { clearInterval(stats.timer); stats.timer = null; }

    async function startShare() {
        $("startErr").textContent = "";
        if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
            $("startErr").textContent = "Your browser doesn't support screen sharing here.";
            return;
        }
        try {
            stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 8 }, audio: false });
        } catch (e) {
            $("startErr").textContent = e && e.name === "NotAllowedError" ? "Screen share was cancelled or blocked." : ("Couldn't start screen share: " + (e && e.message || e));
            return;
        }
        video.srcObject = stream;
        const track = stream.getVideoTracks()[0];
        if (track) track.addEventListener("ended", stopShare);
        ssStart.hidden = true; ssScreen.hidden = false;
        if (ssHint) ssHint.remove();
        if (!convo.querySelector(".ss-msg")) addMsg("assistant", "I can see your screen now — ask me anything about it.");
        enableComposer(true);
        startStats();
        setTimeout(() => input.focus(), 50);
    }
    function stopShare() {
        if (stream) { stream.getTracks().forEach(t => { try { t.stop(); } catch {} }); stream = null; }
        video.srcObject = null;
        ssScreen.hidden = true; ssStart.hidden = false;
        enableComposer(false);
        stopStats();
    }
    function captureFrame() {
        if (!stream || !video.videoWidth) return null;
        const maxW = 1280, scale = Math.min(1, maxW / video.videoWidth);
        const c = $("grabber");
        c.width = Math.round(video.videoWidth * scale);
        c.height = Math.round(video.videoHeight * scale);
        c.getContext("2d").drawImage(video, 0, 0, c.width, c.height);
        let url; try { url = c.toDataURL("image/jpeg", 0.6); } catch { return null; }

        const bytes = Math.round((url.length - (url.indexOf(",") + 1)) * 0.75);
        stats.shots++; stats.bytes += bytes;
        setStat("stShots", String(stats.shots), true);
        setStat("stShotSize", fmtBytes(bytes), true);
        setStat("stData", fmtBytes(stats.bytes));
        return url;
    }

    function addMsg(role, text, cls) {
        const el = document.createElement("div");
        el.className = "ss-msg " + role + (cls ? " " + cls : "");
        el.textContent = text;
        convo.appendChild(el);
        convo.scrollTop = convo.scrollHeight;
        return el;
    }
    function setBusy(on) {
        busy = on;
        sendBtn.disabled = on || input.disabled;
        sendBtn.innerHTML = on ? '<span class="spin"></span>' : SEND_ICON;
    }

    async function ask(question) {
        if (busy || input.disabled) return;
        const frame = captureFrame();
        if (!frame) { addMsg("assistant", "I can't grab the screen — is the share still active?", "error"); return; }

        addMsg("user", question);
        setBusy(true);
        const out = addMsg("assistant", "Looking at your screen…", "thinking");

        const apiMessages = [{ role: "system", content: SYSTEM }, ...history,
            { role: "user", content: [{ type: "text", text: question }, { type: "image_url", image_url: { url: frame } }] }];

        let answer = "", errored = false;
        try {
            const r = await fetch("/api/ai/chat", {
                method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
                body: JSON.stringify({ model: MODEL, messages: apiMessages, max_completion_tokens: 1024 })
            });
            if (r.status === 401 || r.status === 403) {
                out.className = "ss-msg assistant error";
                out.textContent = r.status === 403 ? "Sign in to Nocturne first (images need an account), then reopen this window." : "Please sign in to Nocturne, then reopen this window.";
                setBusy(false); return;
            }
            if (!r.ok) {
                const j = await r.json().catch(() => ({}));
                out.className = "ss-msg assistant error";
                out.textContent = "Error: " + (j.error || ("HTTP " + r.status));
                setBusy(false); return;
            }
            const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = "";
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += dec.decode(value, { stream: true });
                const events = buf.split(/\r?\n\r?\n/); buf = events.pop() || "";
                for (const ev of events) {
                    const line = ev.split(/\r?\n/).find(l => l.startsWith("data:"));
                    if (!line) continue;
                    const payload = line.slice(5).trim();
                    if (!payload || payload === "[DONE]") continue;
                    try {
                        const d = JSON.parse(payload);
                        if (d.type === "delta" && d.text) { answer += d.text; out.className = "ss-msg assistant md"; out.innerHTML = renderMd(answer); typesetMath(out); convo.scrollTop = convo.scrollHeight; }
                        else if (d.type === "error") { errored = true; out.className = "ss-msg assistant error"; out.textContent = "Error: " + d.error; }
                    } catch {}
                }
            }
            if (!errored && !answer.trim()) { out.className = "ss-msg assistant"; out.textContent = "(no response — try asking again)"; }
        } catch (e) {
            out.className = "ss-msg assistant error";
            out.textContent = "Network error: " + (e && e.message || e);
            errored = true;
        }

        if (!errored && answer.trim()) {
            history.push({ role: "user", content: question });
            history.push({ role: "assistant", content: answer });
            if (history.length > 16) history.splice(0, history.length - 16);
        }
        setBusy(false);
        if (!input.disabled) input.focus();
    }

    $("startBtn").addEventListener("click", startShare);
    $("stopBtn").addEventListener("click", stopShare);
    composer.addEventListener("submit", e => { e.preventDefault(); if (input.disabled) return; const q = input.value.trim(); if (!q) return; input.value = ""; autoGrow(); ask(q); });
    input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); composer.requestSubmit(); } });
    input.addEventListener("input", autoGrow);
    convo.addEventListener("click", e => {
        const b = e.target.closest(".code-copy"); if (!b) return;
        try { navigator.clipboard.writeText(b64ToUtf8(b.dataset.c || "")); b.textContent = "Copied"; setTimeout(() => { b.textContent = "Copy"; }, 1200); } catch {}
    });
    function autoGrow() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; }
    window.addEventListener("beforeunload", stopShare);

    enableComposer(false);
})();
