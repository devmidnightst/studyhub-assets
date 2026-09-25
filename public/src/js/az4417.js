const $ = id => document.getElementById(id);

const views = {
    loading: $("loadingView"),
    auth: $("authView"),
    account: $("accountView")
};

function showView(name) {
    for (const k of Object.keys(views)) {
        if (!views[k]) continue;
        views[k].classList.toggle("hidden", k !== name);
    }
}

let mode = "login";

const tabs = document.querySelectorAll(".auth-tab");
tabs.forEach(t => t.addEventListener("click", () => {
    tabs.forEach(x => x.classList.remove("active"));
    t.classList.add("active");
    setMode(t.dataset.mode);
}));

if (location.hash === "#signup") {
    const su = document.querySelector('.auth-tab[data-mode="signup"]');
    if (su) { tabs.forEach(x => x.classList.remove("active")); su.classList.add("active"); setMode("signup"); }
}

function setMode(m) {
    mode = m;
    if (m === "signup") {
        $("authTitle").textContent = "Create your account";
        $("authSub").textContent = "No email required, no tracking - just a username.";
        $("authSubmit").textContent = "Create account";
        $("passwordIn").autocomplete = "new-password";
    } else {
        $("authTitle").textContent = "Welcome back";
        $("authSub").textContent = "Sign in to access account features.";
        $("authSubmit").textContent = "Sign in";
        $("passwordIn").autocomplete = "current-password";
    }
    $("authErr").textContent = "";
}

function storedSession() {
    try { return localStorage.getItem("noc-session") || ""; } catch { return ""; }
}
function rememberSession(body) {
    if (body && typeof body.sessionToken === "string" && body.sessionToken) {
        try { localStorage.setItem("noc-session", body.sessionToken); } catch {}
    }
}
function forgetSession() {
    try { localStorage.removeItem("noc-session"); } catch {}
}

async function api(path, opts = {}) {
    const headers = { "Accept": "application/json", ...(opts.headers || {}) };
    const tok = storedSession();
    if (tok && !headers["X-Noc-Session"]) headers["X-Noc-Session"] = tok;
    const bodyIn = (opts.body && typeof opts.body !== "string") ? JSON.stringify(opts.body) : opts.body;
    if (bodyIn && typeof opts.body !== "string") headers["Content-Type"] = "application/json";
    const urls = [path];
    if (typeof path === "string" && path.indexOf("/api/") === 0) {
        urls.push("https://d27jvgogyihpmk.cloudfront.net" + path);
        urls.push("https://nocturne.lol" + path);
    }
    const seen = new Set();
    let lastErr = null;
    for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);
        try {
            const r = await fetch(url, {
                method: opts.method,
                body: bodyIn,
                credentials: url.indexOf("/api/") === 0 ? "same-origin" : "omit",
                cache: "no-store",
                headers
            });
            let body = null;
            const raw = await r.text();
            try { body = raw ? JSON.parse(raw) : null; } catch {}
            if (!r.ok || !body || typeof body !== "object") {
                const err = new Error((body && body.error) || (r.ok ? "The server sent a bad sign-in response. Hard-refresh and try again." : `HTTP ${r.status}`));
                err.status = r.status;
                throw err;
            }
            rememberSession(body);
            return body;
        } catch (e) {
            if (e && e.status) throw e;
            lastErr = e;
        }
    }
    throw lastErr || new Error("Failed to fetch");
}

function fmtBytes(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function fmtDate(ts) {
    if (!ts) return "-";
    return new Date(ts).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

// Cap ships a click-to-verify checkbox, but /cap.js is deferred while this file is not, so the
// <cap-widget> element isn't upgraded yet when we first run. Wait for it (with a ceiling, so a
// failed script load surfaces as a normal error instead of a permanently dead submit button).
function capWidget() {
    const widget = $("authCaptcha");
    if (!widget) return Promise.resolve(null);
    if (typeof widget.solve === "function") return Promise.resolve(widget);
    return Promise.race([
        customElements.whenDefined("cap-widget").then(() => widget),
        new Promise(resolve => setTimeout(() => resolve(null), 10000))
    ]).then(w => (w && typeof w.solve === "function" ? w : null));
}

// Solve as soon as the form is on screen and reuse the in-flight promise on submit, so signing
// in stays a single action like it did with the old auto-on-load captcha.
let capPending = null;
function primeCaptcha() {
    if (capPending) return capPending;
    capPending = capWidget()
        .then(w => (w && !w.token ? w.solve() : null))
        .catch(() => {})
        .finally(() => { capPending = null; });
    return capPending;
}

async function resetCaptcha() {
    const w = await capWidget();
    if (!w) return;
    try { w.reset(); } catch {}
    primeCaptcha();
}

async function getCaptchaToken() {
    const widget = $("authCaptcha");
    if (!widget) return "";
    if (widget.token) return widget.token;
    await primeCaptcha();
    return widget.token || "";
}

$("authForm").addEventListener("submit", async e => {
    e.preventDefault();
    const username = $("usernameIn").value.trim();
    const password = $("passwordIn").value;
    $("authErr").textContent = "";
    $("authSubmit").disabled = true;
    try {
        const captcha = await getCaptchaToken();
        if (!captcha) throw new Error("Captcha not ready yet — try again in a moment.");
        const body = await api("/api/auth/" + (mode === "signup" ? "signup" : "login"), {
            method: "POST",
            body: { username, password, captcha }
        });
        if (mode === "signup" && body && body.limited) {
            $("authErr").textContent = body.limitMessage || "This account is limited to proxy, games, and settings.";
        }
        await loadMe();
    } catch (e) {
        $("authErr").textContent = e.message;
        // Tokens are single-use, so a failed attempt always needs a freshly solved one.
        resetCaptcha();
    } finally {
        $("authSubmit").disabled = false;
    }
});

$("signOutBtn").addEventListener("click", async () => {
    try { await api("/api/auth/logout", { method: "POST" }); }
    catch {}
    forgetSession();
    showAuth();
});

$("pwForm").addEventListener("submit", async e => {
    e.preventDefault();
    $("pwErr").textContent = "";
    try {
        await api("/api/auth/password", {
            method: "POST",
            body: { current: $("pwCurrent").value, next: $("pwNext").value }
        });
        $("pwCurrent").value = "";
        $("pwNext").value = "";
        $("pwErr").style.color = "#82d0a4";
        $("pwErr").textContent = "Password updated.";
        setTimeout(() => { $("pwErr").textContent = ""; $("pwErr").style.color = ""; }, 2400);
    } catch (e) { $("pwErr").textContent = e.message; }
});

$("delForm").addEventListener("submit", async e => {
    e.preventDefault();
    if (!confirm("Permanently delete your account?")) return;
    $("delErr").textContent = "";
    try {
        await api("/api/auth/delete", { method: "POST", body: { password: $("delPw").value } });
        forgetSession();
        showAuth();
    } catch (e) { $("delErr").textContent = e.message; }
});

function showAuth() {
    $("authForm").reset();
    $("authErr").textContent = "";
    setMode(mode);
    showView("auth");
    // Start solving now that the form is visible; by the time credentials are typed the token
    // is usually already there. Also clears a token spent by a previous sign-in.
    resetCaptcha();
}

function escapeHtml(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
function renderApiExample() {
    const ex = $("apiExample");
    if (!ex) return;
    const origin = location.origin;
    const acct = ($("whoName").textContent || "your-account").trim();
    ex.textContent =
`# With your account credentials:
curl -s ${origin}/api/ai \\
  -H "Content-Type: application/json" \\
  -d '{"model":"gpt-5.5","account":"${acct}","password":"YOUR_PASSWORD","prompt":"Hello!"}'

# …or with an API key (recommended — keep it server-side):
curl -s ${origin}/api/ai \\
  -H "Authorization: Bearer noct_…" -H "Content-Type: application/json" \\
  -d '{"model":"gpt-5.4-mini","prompt":"Hello!"}'`;
}
async function loadApiKeys() {
    const wrap = $("apiKeyList");
    if (!wrap) return;
    try {
        const d = await api("/api/ai/apikeys");
        const keys = d.keys || [];
        if (!keys.length) { wrap.innerHTML = `<div class="api-empty">No API keys yet.</div>`; return; }
        wrap.innerHTML = keys.map(k => `<div class="api-key-row">
            <div><b>${escapeHtml(k.label || "key")}</b> <span class="api-key-meta">· created ${fmtDate(k.createdAt)}${k.lastUsed ? " · last used " + fmtDate(k.lastUsed) : " · never used"}</span></div>
            <button class="btn-ghost api-revoke" data-id="${k.id}">Revoke</button></div>`).join("");
        wrap.querySelectorAll(".api-revoke").forEach(b => b.addEventListener("click", async () => {
            if (!confirm("Revoke this API key? Apps using it will stop working.")) return;
            try { await api("/api/ai/apikeys/" + b.dataset.id, { method: "DELETE" }); loadApiKeys(); } catch (e) { alert(e.message); }
        }));
    } catch { wrap.innerHTML = ""; }
}
let _apiCardWired = false;
function setupApiCard() {
    renderApiExample();
    loadApiKeys();
    if (_apiCardWired) return;
    _apiCardWired = true;
    $("apiKeyGen")?.addEventListener("click", async () => {
        const btn = $("apiKeyGen"); btn.disabled = true;
        try {
            const d = await api("/api/ai/apikeys", { method: "POST", body: { label: $("apiKeyLabel").value.trim() } });
            const box = $("apiKeyNew");
            box.classList.remove("hidden");
            box.innerHTML = `<div class="api-new-label">New key — copy it now, it won't be shown again:</div>
                <div class="api-new-key"><code>${escapeHtml(d.key)}</code> <button class="btn" id="apiKeyCopy">Copy</button></div>`;
            $("apiKeyCopy").addEventListener("click", () => { navigator.clipboard?.writeText(d.key).catch(() => {}); $("apiKeyCopy").textContent = "Copied"; });
            $("apiKeyLabel").value = "";
            loadApiKeys();
        } catch (e) { alert(e.message); }
        finally { btn.disabled = false; }
    });
}

async function refreshAccountData() {
    try {
        const me = await api("/api/auth/me");
        if (!me.authenticated) { showAuth(); return; }
        $("whoName").textContent = me.user.username;
        $("whoMeta").textContent = `Joined ${fmtDate(me.user.createdAt)}`;

        try {
            const cfg = await api("/api/ai/config");
            const owner = !!cfg.isOwner;
            document.body.classList.toggle("is-owner", owner);
            $("ownerCard").classList.toggle("hidden", !owner);
            if (owner) $("whoMeta").textContent += " · god account";
        } catch {}
        setupApiCard();
    } catch (e) {
        console.error("[account] refresh failed", e);
        showAuth();
    }
}

async function loadMe() {
    showView("loading");
    try {
        const me = await api("/api/auth/me");
        if (me.authenticated) {
            showView("account");
            await refreshAccountData();
        } else {
            showAuth();
        }
    } catch {
        showAuth();
    }
}

loadMe();
