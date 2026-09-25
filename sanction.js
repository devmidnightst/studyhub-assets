import { stmts } from "./db.js";
import { isOwnerName } from "./auth.js";
import { clientIp, ipSanction, SANCTION_MESSAGE } from "./ip.js";

const SESSION_COOKIE = "nocturne_sid";

function sessionToken(req) {
    const hdr = req.headers?.["x-noc-session"];
    if (typeof hdr === "string" && /^[a-f0-9]{64}$/i.test(hdr)) return hdr;
    let q = req.query?._noc_session;
    // Websocket upgrades are raw Node requests: the session is on the URL,
    // not on Express req.query. S3 pages pass it as ?_noc_session= because
    // the cookie is not sent on that socket.
    if (!q && req.url) {
        try { q = new URL(req.url, "http://localhost").searchParams.get("_noc_session") || ""; }
        catch { q = ""; }
    }
    if (typeof q === "string" && /^[a-f0-9]{64}$/i.test(q)) return q;
    const raw = req.headers?.cookie || "";
    const m = raw.match(new RegExp("(?:^|;\\s*)" + SESSION_COOKIE + "=([^;]+)"));
    if (!m) return "";
    try { return decodeURIComponent(m[1]); } catch { return m[1]; }
}

function isStaff(userId, username) {
    if (isOwnerName(username)) return true;
    try {
        const role = stmts.getChatRole.get(userId);
        return String(role?.chat_perm || "").toLowerCase() === "admin"
            || String(role?.chat_perm || "").toLowerCase() === "mod";
    } catch {
        return false;
    }
}

export function staffFromRequest(req) {
    if (req.user?.id && req.user?.username) return isStaff(req.user.id, req.user.username);
    const token = sessionToken(req);
    if (!token || token.length !== 64) return false;
    try {
        const row = stmts.findSession.get(token, Date.now());
        if (!row) return false;
        return isStaff(row.user_id, row.username);
    } catch {
        return false;
    }
}

function wantsHtml(req) {
    if (req.method !== "GET" && req.method !== "HEAD") return false;
    const path = req.path || "";
    if (path.startsWith("/api/") || path.startsWith("/cfp/") || path.startsWith("/wisp/")) return false;
    const accept = String(req.headers?.accept || "");
    return accept.includes("text/html") || path.endsWith(".html") || path === "/" || !path.includes(".");
}

function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function blockPage(message) {
    const msg = esc(message || SANCTION_MESSAGE);
    return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${msg}</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#07070b;color:#f4f4f5;font:15px/1.45 system-ui,sans-serif}
.box{width:min(420px,calc(100% - 32px));background:#12121a;border:1px solid rgba(255,255,255,.08);border-radius:16px;padding:28px}
h1{font-size:18px;margin:0 0 8px}
p{margin:0 0 18px;color:#a1a1aa}
label{display:block;font-size:12px;color:#a1a1aa;margin:12px 0 6px}
input{width:100%;box-sizing:border-box;background:#0c0c12;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:10px;padding:10px 12px}
button{margin-top:16px;width:100%;background:#fff;color:#111;border:0;border-radius:10px;padding:11px;font-weight:650;cursor:pointer}
.err{color:#f87171;min-height:1.2em;margin-top:10px;font-size:13px}
</style></head><body>
<div class="box">
<h1>${msg}</h1>
<p>Staff sign in. The owner, admins, and mods set with /setperm can enter while this range is blocked.</p>
<p><a href="/games.html" style="color:#fff">Play games</a></p>
<form id="staff-login">
<label>Username</label><input name="username" autocomplete="username" required>
<label>Password</label><input name="password" type="password" autocomplete="current-password" required>
<button type="submit">Owner sign in</button>
<div class="err" id="err"></div>
</form></div>
<script>
document.getElementById("staff-login").addEventListener("submit", async function (e) {
  e.preventDefault();
  var err = document.getElementById("err");
  var btn = e.target.querySelector("button");
  btn.disabled = true;
  err.textContent = "";
  var body = { username: e.target.username.value, password: e.target.password.value };
  var r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify(body) });
  var d = {};
  try { d = await r.json(); } catch (x) {}
  if (!r.ok || !d.ok) { err.textContent = d.error || "Sign-in failed."; btn.disabled = false; return; }
  location.reload();
});
</script></body></html>`;
}

function gamesOnly(path) {
    if (path === "/games" || path === "/games.html") return true;
    if (path.startsWith("/api/games") || path.startsWith("/api/cherri")) return true;
    if (path === "/src/css/games.css" || path === "/src/css/nocturne-select.css" || path === "/src/css/notice.css") return true;
    if (path === "/src/js/xk6073.js" || path === "/src/js/qt3674.js" || path === "/src/js/zb8215.js" || path === "/src/js/yc1962.js" || path === "/src/js/pu3927.js") return true;
    return false;
}

export function sanctionMiddleware(req, res, next) {
    const hit = ipSanction(clientIp(req));
    if (!hit || staffFromRequest(req)) return next();
    if (req.method === "POST" && req.path === "/api/auth/login") return next();
    if (req.path === "/api/sanction" || req.path === "/cap.js" || req.path === "/cap.wasm") return next();
    if (req.path.startsWith("/api/captcha/")) return next();
    if (gamesOnly(req.path)) return next();
    const message = hit.message || SANCTION_MESSAGE;
    res.set("Cache-Control", "no-store");
    if (wantsHtml(req)) {
        res.status(403).type("html").send(blockPage(message));
        return;
    }
    res.status(403).json({ error: message, sanctioned: true, blocked: true, message });
}

export function mountSanction(app) {
    app.get("/api/sanction", (req, res) => {
        const hit = ipSanction(clientIp(req));
        res.set("Cache-Control", "no-store");
        if (!hit || staffFromRequest(req)) return res.json({ blocked: false });
        res.status(403).json({ blocked: true, sanctioned: true, message: hit.message || SANCTION_MESSAGE, error: hit.message || SANCTION_MESSAGE });
    });
}
