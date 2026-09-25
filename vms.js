import fs from "fs";
import path from "path";
import https from "node:https";
import tls from "node:tls";
import { fileURLToPath } from "url";
import { stmts } from "./db.js";
import { clientIp } from "./auth.js";
import { logActivity, fpFromReq } from "./activity.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// VM infrastructure provider. The base URL + key live only on the server and are
// never surfaced to the client or in any user-facing text. All VM traffic is
// reverse-proxied through Nocturne so the provider's domain never reaches the
// user's browser, history, or network log.
const PROVIDER_HOST = "xcloud-cname.loremgroup.org";
const PROVIDER_BASE = "https://" + PROVIDER_HOST;
const DEVELOPER_ID = "nocturne";
const VM_PATH_RE = /^\/vm\/([A-Za-z0-9_-]{3,80})(\/[^?#]*)?(\?[^#]*)?/;

// On by default so the next live VM load logs every proxied path + WS upgrade,
// which is how we pinpoint a "loads forever". Set NOCTURNE_VM_DEBUG=0 to silence.
const VM_DEBUG = process.env.NOCTURNE_VM_DEBUG !== "0";
// Hop-by-hop headers must never be forwarded/copied — they describe a single
// connection, and leaking the provider's transfer-encoding/connection clashes
// with our own framing (and with the compression middleware) and can hang.
const HOP_BY_HOP = ["connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade"];

// Injected into VM HTML pages. The provider reaps a VM after 60s with no VNC input.
// While the tab is open, keep it alive — but ONLY when the user has been idle a
// while, by nudging the VNC pointer 1px (KasmVNC needs a real pointermove with a
// position delta; a no-op move or a mousemove doesn't register). Real input is
// tracked via isTrusted so this never fires (or interferes) during active use.
// Verified: a VM stayed alive 195s with only this. All best-effort / try-caught.
const VM_KEEPALIVE = "<script>(function(){try{"
    + "var lastInput=Date.now(),lx=120,ly=120,n=0;"
    + "function real(e){if(!e||!e.isTrusted)return;lastInput=Date.now();if(typeof e.clientX==='number'){lx=e.clientX;ly=e.clientY;}}"
    + "['pointermove','mousemove','pointerdown','keydown','wheel','touchstart'].forEach(function(t){try{document.addEventListener(t,real,true);}catch(e){}});"
    + "function desktop(){var a=document.querySelectorAll('canvas');for(var i=0;i<a.length;i++){if(a[i].width>=800)return a[i];}return a[0]||null;}"
    + "function tick(){try{if(Date.now()-lastInput<20000)return;"
    + "var c=desktop();if(!c)return;var r=c.getBoundingClientRect();if(!r.width)return;"
    + "var x=Math.min(Math.max(lx+(n%2?1:-1),r.left+1),r.right-1),y=Math.min(Math.max(ly,r.top+1),r.bottom-1);n++;"
    + "['pointermove','mousemove'].forEach(function(t){try{var E=(t==='pointermove'&&window.PointerEvent)?PointerEvent:MouseEvent;"
    + "c.dispatchEvent(new E(t,{clientX:x,clientY:y,bubbles:true,cancelable:true,view:window,pointerId:1,buttons:0}));}catch(e){}});"
    + "}catch(e){}}"
    + "setInterval(tick,12000);"
    + "}catch(e){}})();</script>";

// Never hand Nocturne's own session, clearance, or account cookies to the VM provider.
function stripNocturneCookie(cookie) {
    if (!cookie) return undefined;
    const kept = String(cookie).split(/;\s*/).filter(c => {
        const name = c.split("=")[0].trim().toLowerCase();
        if (!name) return false;
        if (name === "nocturne_sid" || name === "nf_pass") return false;
        if (name.startsWith("noc") || name.startsWith("nocturne")) return false;
        return true;
    });
    return kept.length ? kept.join("; ") : undefined;
}

const UPSTREAM_DROP = new Set([
    "authorization", "proxy-authorization", "x-noc-session", "x-api-key",
    "x-forwarded-for", "x-real-ip", "forwarded", "cf-connecting-ip", "true-client-ip",
    "x-forwarded-host", "x-forwarded-server", "cloudfront-viewer-address",
    "cloudfront-viewer-country", "cookie"
]);

function upstreamHeaders(headers) {
    const out = {};
    for (const [k, v] of Object.entries(headers || {})) {
        const lk = k.toLowerCase();
        if (UPSTREAM_DROP.has(lk) || lk.startsWith("x-nocturne") || HOP_BY_HOP.includes(lk)) continue;
        out[k] = v;
    }
    const cookie = stripNocturneCookie(headers && headers.cookie);
    if (cookie) out.cookie = cookie;
    return out;
}

// A provider Set-Cookie must not be able to plant or replace an account cookie.
function quarantineSetCookie(setCookie) {
    const list = Array.isArray(setCookie) ? setCookie : (setCookie ? [String(setCookie)] : []);
    const kept = [];
    for (const raw of list) {
        const name = String(raw).split("=")[0].trim().toLowerCase();
        if (!name || name === "nocturne_sid" || name === "nf_pass" || name.startsWith("noc") || name.startsWith("nocturne")) continue;
        let c = String(raw).replace(/;\s*domain=[^;]*/ig, "").replace(/;\s*path=[^;]*/ig, "");
        kept.push(c + "; Path=/vm; SameSite=Lax");
    }
    return kept;
}

// The desktop page is served on our origin, so provider script must not be able
// to call the account API or read the session sitting in page storage.
const VM_ISOLATION = "<script>(function(){try{"
    + "var mem=new Map();function box(){return{getItem:function(k){return mem.has(k)?mem.get(k):null;},setItem:function(k,v){mem.set(String(k),String(v));},removeItem:function(k){mem.delete(k);},clear:function(){mem.clear();},key:function(i){return Array.from(mem.keys())[i]||null;},get length(){return mem.size;}};}"
    + "var store=box();"
    + "try{Object.defineProperty(window,'localStorage',{get:function(){return store;}});}catch(e){}"
    + "try{Object.defineProperty(window,'sessionStorage',{get:function(){return box();}});}catch(e){}"
    + "try{Object.defineProperty(document,'cookie',{get:function(){return '';},set:function(){}});}catch(e){}"
    + "}catch(e){}})();</script>";

function vmIsolationCsp(host) {
    const h = String(host || "localhost").split(":")[0];
    const paths = ["/vm/", "/websockify", "/core/", "/app/", "/vendor/", "/.within.website/", "/.well-known/"];
    const connect = [];
    for (const scheme of ["https", "http", "wss", "ws"]) {
        for (const p of paths) connect.push(scheme + "://" + h + p);
    }
    return [
        "default-src 'none'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-src 'none'",
        "worker-src 'none'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data: blob:",
        "font-src 'self' data:",
        "media-src 'self' blob:",
        "connect-src " + connect.join(" ")
    ].join("; ");
}

// KasmVNC ships a session-timeout watcher that it never tears down:
//
//   UI._sessionTimeoutInterval = setInterval(function () {
//     var timeSinceLastActivityInS = (Date.now() - UI.rfb.lastActiveAt) / 1000;
//     ...
//     UI.rfb.sendKey(1, null, false);
//   }, 5000);
//
// On disconnect it clears UI.rfb but leaves the interval running, so every five
// seconds from then on it throws
//   Uncaught TypeError: Cannot read properties of undefined (reading 'lastActiveAt')
// and the desktop shows "KasmVNC encountered an error". Any dropped socket does it:
// a reload, a network blip, and now a suspended VM, which makes it routine rather
// than rare.
//
// We cannot patch their source, but every byte of it passes through this proxy, so
// the callback gets a guard on the way past: bail out and stop the timer once the
// connection is gone. When connected the behaviour is byte-for-byte unchanged.
const KASM_IDLE_RE = /var\s+timeSinceLastActivityInS\s*=\s*\(\s*Date\.now\(\)\s*-\s*UI\.rfb\.lastActiveAt\s*\)\s*\/\s*1000\s*;/g;

function patchKasmIdleTimer(source) {
    if (source.indexOf("timeSinceLastActivityInS") === -1) return source;
    return source.replace(KASM_IDLE_RE,
        "if(!UI.rfb){try{clearInterval(UI._sessionTimeoutInterval);}catch(e){}return;} $&");
}

// Rewrite any absolute provider URLs in a text body so they point back at the
// proxy (keeps the provider host out of the page entirely).
function rewriteBody(body, host, secure) {
    const ws = secure ? "wss" : "ws";
    let s = String(body);
    // WebSocket URLs must point back at the Nocturne host (same scheme).
    s = s.split("wss://" + PROVIDER_HOST).join(ws + "://" + host);
    s = s.split("ws://" + PROVIDER_HOST).join(ws + "://" + host);
    s = s.split("wss:\\/\\/" + PROVIDER_HOST).join(ws + ":\\/\\/" + host);   // JSON/JS-escaped
    s = s.split("ws:\\/\\/" + PROVIDER_HOST).join(ws + ":\\/\\/" + host);
    // Absolute http(s) URLs collapse to root-relative (same origin as the page).
    s = s.split("https://" + PROVIDER_HOST).join("");
    s = s.split("http://" + PROVIDER_HOST).join("");
    s = s.split("https:\\/\\/" + PROVIDER_HOST).join("");
    s = s.split("http:\\/\\/" + PROVIDER_HOST).join("");
    // Protocol-relative + any bare leftover hostname token.
    s = s.split("//" + PROVIDER_HOST).join("//" + host);
    s = s.split(PROVIDER_HOST).join(host);
    return patchKasmIdleTimer(s);
}

// The provider answers a request for a container that is stopped, missing or not
// yet listening with a bare JSON error body. Rendered inside the desktop iframe
// that reads as {"error":"HTTP_EXCEPTION","message":"VM not found"} on a blank
// page, which is what users were seeing. Nothing good comes of forwarding it, so
// a failed VM request gets a quiet page of our own (for a navigation) or an empty
// body (for a sub-resource), and the real state is settled by /api/vms/status.
// kind: "stopped" (404, nothing to connect to) or "booting" (502/503, not yet
// listening). A booting VM reloads itself until it answers — the page used to say
// it would retry and then just sat there. Both tell the parent what happened, so
// vms.html can react at once instead of waiting for its next status poll. The page
// is served from Nocturne's own origin, so postMessage to the parent is same-origin.
const VM_ERROR_PAGE = (title, detail, kind) =>
    "<!doctype html><meta charset=utf-8><title>" + title + "</title>" +
    "<style>html,body{height:100%;margin:0}body{display:flex;align-items:center;justify-content:center;" +
    "background:#0c0c10;color:#c9c6d6;font:15px/1.6 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;text-align:center}" +
    "div{max-width:30rem;padding:24px}b{display:block;margin-bottom:6px;font-size:1.05rem;color:#fff;font-weight:600}" +
    "span{color:#8b8799;font-size:0.9rem}</style>" +
    "<div><b>" + title + "</b><span>" + detail + "</span></div>" +
    "<script>(function(){var K='nocVmBoot';try{parent.postMessage({source:'jitter-vm',vmState:'" + kind + "'},'*');}catch(e){}" +
    (kind === "booting"
        // Bounded: this placeholder reloads itself while the container is still
        // coming up, but gives up after ~30s and hands the decision to the user
        // rather than reloading behind their back for ever.
        ? "var n=0;try{n=+(sessionStorage.getItem(K)||0);}catch(e){}" +
          "if(n<10){try{sessionStorage.setItem(K,n+1);}catch(e){}setTimeout(function(){location.reload();},3000);}" +
          "else{try{sessionStorage.removeItem(K);parent.postMessage({source:'jitter-vm',vmState:'slow'},'*');}catch(e){}}"
        : "try{sessionStorage.removeItem(K);}catch(e){}") +
    "})();<\/script>";

// Is this request the browser navigating (the iframe itself), or a sub-resource?
function isNavigation(req) {
    const dest = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
    if (dest) return dest === "document" || dest === "iframe" || dest === "frame";
    return /text\/html/i.test(String(req.headers.accept || ""));
}

function sendVmError(req, res, status, code) {
    try {
        if (!isNavigation(req)) { res.statusCode = status; return res.end(); }
        const stopped = status === 404;
        res.statusCode = 200;   // the page itself renders fine; the VM is the problem
        res.setHeader("Content-Type", "text/html; charset=utf-8");
        res.setHeader("Cache-Control", "no-store");
        res.end(stopped
            ? VM_ERROR_PAGE("This machine is not running", "It was stopped, or it has been cleaned up. Head back to the VM page to start it again.", "stopped")
            : VM_ERROR_PAGE("The desktop is still coming up", "The machine is there but not answering yet. Retrying every few seconds.", "booting"));
    } catch {}
    flagSuspect(code);
}

// Reverse-proxy an HTTP request for /vm/<code>/... to the provider.
function proxyVmHttp(req, res, fullPathWithQuery, code) {
    const clientHost = req.headers.host || "";
    // Anubis' challenge JS sets ?redir=<full current URL>, which is the Nocturne
    // URL when proxied. Anubis validates redir against its own host, so strip our
    // origin (plain + percent-encoded) to leave a same-origin relative path —
    // otherwise the post-challenge redirect bounces to "/" instead of the VM.
    const hostName = clientHost.split(":")[0];
    if (hostName && fullPathWithQuery.indexOf(hostName) !== -1) {
        fullPathWithQuery = fullPathWithQuery
            .split("https://" + clientHost).join("")
            .split("http://" + clientHost).join("")
            .split(encodeURIComponent("https://" + clientHost)).join("")
            .split(encodeURIComponent("http://" + clientHost)).join("");
    }
    const headers = upstreamHeaders(req.headers);
    headers.host = PROVIDER_HOST;
    // Make any provider-side Origin/Referer checks see their own host, not Nocturne.
    if (headers.origin) headers.origin = PROVIDER_BASE;
    if (headers.referer && clientHost) headers.referer = headers.referer.split(clientHost).join(PROVIDER_HOST);
    delete headers["accept-encoding"];           // ask for plain bytes so we can rewrite text
    for (const h of HOP_BY_HOP) delete headers[h];
    const preq = https.request({ hostname: PROVIDER_HOST, port: 443, path: fullPathWithQuery, method: req.method || "GET", headers, servername: PROVIDER_HOST }, (pres) => {
        const ct = String(pres.headers["content-type"] || "");
        const isText = /text\/|javascript|json|xml|svg|html/i.test(ct);
        const out = Object.assign({}, pres.headers);
        delete out["content-length"]; delete out["content-encoding"];
        delete out["content-security-policy"]; delete out["content-security-policy-report-only"];
        delete out["x-frame-options"];           // must be iframeable inside Nocturne
        const planted = quarantineSetCookie(out["set-cookie"]);
        delete out["set-cookie"];
        if (planted.length) out["set-cookie"] = planted;
        if (/html/i.test(ct)) out["content-security-policy"] = vmIsolationCsp(clientHost);
        for (const h of HOP_BY_HOP) delete out[h];
        // Keep redirects (e.g. Anubis' post-challenge 302) on the Nocturne origin.
        if (out.location) out.location = String(out.location)
            .split("https://" + PROVIDER_HOST).join("")
            .split("http://" + PROVIDER_HOST).join("")
            .split(PROVIDER_HOST).join(clientHost);
        if (VM_DEBUG) console.log("[vms] http", req.method, fullPathWithQuery.slice(0, 90), "->", pres.statusCode, ct.split(";")[0]);

        // The provider's own error envelope (404 "VM not found" when the container
        // is stopped or deleted, 502 "Bad gateway" while it is not yet listening).
        // Swallow the body and answer for ourselves; forwarding it painted raw JSON
        // inside the desktop iframe.
        if ((pres.statusCode === 404 || pres.statusCode === 502 || pres.statusCode === 503) && /json/i.test(ct)) {
            pres.resume();                       // drain so the socket is reusable
            pres.on("error", () => {});
            return sendVmError(req, res, pres.statusCode, code);
        }

        if (isText) {
            const chunks = [];
            pres.on("data", c => chunks.push(c));
            pres.on("end", () => {
                const secure = req.secure || req.headers["x-forwarded-proto"] === "https";
                let body = rewriteBody(Buffer.concat(chunks).toString("utf8"), clientHost, secure);
                // Inject the idle keep-alive into VM HTML documents.
                if (/html/i.test(ct)) {
                    const guard = VM_ISOLATION;
                    if (/<head[^>]*>/i.test(body)) body = body.replace(/<head[^>]*>/i, (m) => m + guard);
                    else body = guard + body;
                    body = body.includes("</body>") ? body.replace("</body>", VM_KEEPALIVE + "</body>") : (body + VM_KEEPALIVE);
                }
                try { res.writeHead(pres.statusCode || 502, out); res.end(body); } catch {}
            });
            pres.on("error", () => { try { if (res.headersSent) res.destroy(); else { res.statusCode = 502; res.end(); } } catch {} });
        } else {
            try { res.writeHead(pres.statusCode || 502, out); } catch {}
            // pipe() does not forward errors, and an unhandled 'error' on a
            // readable is a throw. Binary assets (fonts, images, the VNC blobs)
            // go down this branch, so a provider connection that drops mid-body
            // used to take the process with it.
            pres.on("error", () => { try { res.destroy(); } catch {} });
            pres.pipe(res);
        }
    });
    // Never let a stalled provider hang the browser forever.
    preq.setTimeout(30_000, () => { if (VM_DEBUG) console.log("[vms] http timeout", fullPathWithQuery.slice(0, 90)); preq.destroy(new Error("upstream timeout")); });
    preq.on("error", (e) => { if (VM_DEBUG) console.log("[vms] http error", e && e.message, fullPathWithQuery.slice(0, 90)); try { if (!res.headersSent) res.statusCode = 504; res.end(); } catch {} });
    // The Anubis challenge reloads/aborts requests rapidly; if the client bails
    // mid-flight, tear down the upstream instead of letting an unhandled stream
    // 'error' bubble up. (These guards are why the server stays alive under load.)
    res.on("error", () => { try { preq.destroy(); } catch {} });
    res.on("close", () => { if (!res.writableFinished) { try { preq.destroy(); } catch {} } });
    req.on("error", () => { try { preq.destroy(); } catch {} });
    req.pipe(preq);
}

// Reverse-proxy a WebSocket upgrade for /vm/<code>/... (the VNC stream).
// Returns true if it handled the upgrade.
export function vmProxyUpgrade(req, socket, head) {
    let url = req.url || "";
    let code;
    const direct = VM_PATH_RE.exec(url);
    if (direct) {
        code = direct[1];
    } else {
        // Root-absolute WS (e.g. "/websockify") — attribute it to the VM whose
        // page opened it (via Referer) and re-prefix so the provider routes it.
        code = codeFromReferer(req.headers.referer);
        if (!code) {
            // Loud diagnostic for the one case the referer fallback can't rescue:
            // a root WS with no usable Referer. If this fires on a live load, the
            // provider's noVNC uses an un-prefixed WS path and needs another hook.
            if (VM_DEBUG && /websockif|novnc|vnc|socket/i.test(url)) {
                console.log("[vms] ⚠ ws fell through to wisp (no /vm match, no active referer):", url.slice(0, 90), "referer=", req.headers.referer || "-");
            }
            return false;   // not a VM socket — let the normal (wisp) upgrade handle it
        }
        url = "/vm/" + code + (url.startsWith("/") ? url : "/" + url);
        if (VM_DEBUG) console.log("[vms] ws re-attributed", (req.url || "").slice(0, 60), "->", url.slice(0, 90));
    }
    // Ownership: only the signed-in owner of this VM may open its framebuffer
    // socket. We claim the upgrade (return true) and drop it on a mismatch so it
    // can't fall through to any other handler.
    if (!ownsCode(req, code)) {
        if (VM_DEBUG) console.log("[vms] ws upgrade denied — not owner; code=", code);
        try { socket.destroy(); } catch {}
        return true;
    }
    const uid = (req.user && req.user.id) || uidFromCookie(req);
    try {
        const limited = uid != null && stmts.signupLimited.get(uid);
        if (limited && limited.n) {
            try { socket.destroy(); } catch {}
            return true;
        }
    } catch {}
    if (VM_DEBUG) console.log("[vms] ws upgrade", url.slice(0, 90), "origin=", req.headers.origin || "-");
    // Pin HTTP/1.1 via ALPN: if TLS negotiates h2 the provider speaks binary
    // frames and our hand-written HTTP/1.1 upgrade is never understood -> the
    // VNC socket "connects forever". This is the #1 cause of the hang.
    const upstream = tls.connect({ host: PROVIDER_HOST, port: 443, servername: PROVIDER_HOST, ALPNProtocols: ["http/1.1"] }, () => {
        const headers = upstreamHeaders(req.headers);
        headers.host = PROVIDER_HOST;
        // Provider WS backends commonly enforce a same-origin check.
        if (headers.origin) headers.origin = PROVIDER_BASE;
        delete headers["proxy-connection"];
        let raw = (req.method || "GET") + " " + url + " HTTP/1.1\r\n";
        for (const k in headers) {
            const v = headers[k];
            if (v == null) continue;
            if (Array.isArray(v)) { for (const vv of v) raw += k + ": " + vv + "\r\n"; }
            else raw += k + ": " + v + "\r\n";
        }
        raw += "\r\n";
        upstream.write(raw);
        if (head && head.length) upstream.write(head);
        upstream.pipe(socket);
        socket.pipe(upstream);
    });
    try { upstream.setNoDelay(true); socket.setNoDelay(true); } catch {}
    // Fail fast if the provider TLS handshake stalls instead of hanging the socket.
    upstream.setTimeout(15_000, () => { if (VM_DEBUG) console.log("[vms] ws connect timeout"); try { upstream.destroy(); } catch {} try { socket.destroy(); } catch {} });
    upstream.once("secureConnect", () => { try { upstream.setTimeout(0); } catch {} });
    upstream.on("error", (e) => { if (VM_DEBUG) console.log("[vms] ws upstream error", e && e.message); try { socket.destroy(); } catch {} });
    socket.on("error", () => { try { upstream.destroy(); } catch {} });
    return true;
}

// The single PREMIUM "nocturne" key (enterprise) serves many concurrent VMs — no
// per-key cap and no auto-delete (free keys were 1-VM-each; that era is over).
// Default is high so capacity isn't bottlenecked; override with XCLOUD_VMS_PER_KEY.
const _perKeyEnv = parseInt(process.env.XCLOUD_VMS_PER_KEY, 10);
const PER_KEY_VMS = (Number.isInteger(_perKeyEnv) && _perKeyEnv > 0) ? _perKeyEnv : 1000;
const GLOBAL_CREATE_GAP_MS = 3_000;    // ~matches old 8-key throughput on one key; per-IP 429s are absorbed by the backoff below
const QUEUE_STALE_MS = 25_000;         // drop a waitlist entry that stops polling
// Back off a key that hit its hourly create cap. The provider's "10 per hour" is
// a ROLLING window, so we can't know the exact recovery time — keep this short so
// we re-probe often and let the user in soon after it actually frees, while still
// staying well under ~10 probes/hour/key (so probes can't keep the window full).
const KEY_HOURLY_BLOCK_MS = 8 * 60_000;
// Time-based reaping is OFF by default: a VM belongs to the user until they end
// it, and nothing on a clock takes it away from them. Both knobs stay here so a
// reap can be dialled back in from the environment without touching this file.
//
//   NOCTURNE_VM_IDLE_MS      ms with no heartbeat before the slot is freed. 0 = never.
//   NOCTURNE_VM_MAX_MINUTES  hard cap on a single session.                  0 = no cap.
//
// With both at 0 the only things that end a VM are the user pressing End, an
// admin, or the provider's own reaping. Trade-off: an abandoned tab holds its
// slot until someone ends it, so watch capacity if that ever starts to bite.
//
// Suspend-on-away is a separate thing and it IS on: it stops an idle container
// without ending the session. See AWAY_STOP_MS below.
const _idleEnv = parseInt(process.env.NOCTURNE_VM_IDLE_MS, 10);
const INACTIVITY_MS = Number.isInteger(_idleEnv) && _idleEnv > 0 ? _idleEnv : 0;
const _maxMinEnv = parseInt(process.env.NOCTURNE_VM_MAX_MINUTES, 10);
const VM_MAX_MINUTES = Number.isInteger(_maxMinEnv) && _maxMinEnv > 0 ? _maxMinEnv : 0;

// Suspend (do NOT delete) a VM once the user has been away from the screen this
// long. "Away" means the VM page reported the tab hidden or the desktop minimised,
// or stopped reporting at all (tab closed).
//
// ON by default at 5 minutes. A suspend is a stop, never a delete: the session,
// the container, the connect code and the URL all survive, and /api/vms/resume
// starts the same machine back up. Deletion stays off (NOCTURNE_VM_IDLE_MS = 0),
// so nothing on a clock destroys a VM.
//
// Worth re-measuring on the enterprise key: on the old free tier a stopped
// container was reaped provider-side after roughly 170 seconds, and there is no
// lease to hold one open (/api/extend_vm takes a premium voucher code, not a
// container lease, per the provider's OpenAPI spec). If that reaping still
// applies, resuming more than ~3 minutes after a suspend finds the container
// gone. That path is already handled end to end: providerAction("start") comes
// back 404, /api/vms/resume answers 410 with { gone: true, relaunch: true }, and
// public/vms.html launches a fresh VM in its place instead of showing an error.
//
// Set NOCTURNE_VM_AWAY_MS=0 to turn suspending off again.
const _awayEnv = parseInt(process.env.NOCTURNE_VM_AWAY_MS, 10);
const AWAY_STOP_MS = Number.isInteger(_awayEnv) ? Math.max(0, _awayEnv) : 5 * 60_000;

// Sessions with no cap carry expiresAt = Infinity, which compares correctly
// everywhere. JSON.stringify turns it into null, so it is normalised on the way out.
function outExpiry(v) { return Number.isFinite(v) ? v : null; }
function outSecondsLeft(v) { return Number.isFinite(v) ? Math.max(0, Math.round((v - Date.now()) / 1000)) : null; }

// Rough wait estimate for someone at a given spot in line. Deliberately a little
// generous — the UI labels it an estimate and notes real waits are usually shorter.
function estimateWaitSeconds(position) {
    return Math.max(30, position * 45);
}

// One key per line in data/xcloud-key (comments with #), or a whitespace/comma
// list in XCLOUD_API_KEY. Keys are filled in order and rotated when full/limited.
function loadKeys() {
    const env = (process.env.XCLOUD_API_KEY || process.env.VM_API_KEY || "").trim();
    let raw = [];
    if (env) raw = env.split(/[\s,]+/);
    else {
        const dir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
        try { raw = fs.readFileSync(path.join(dir, "xcloud-key"), "utf8").split(/[\r\n]+/); } catch {}
    }
    return raw.map(s => s.trim()).filter(s => s && !s.startsWith("#"));
}
// Each key gets its own create rate-limit (cooldownUntil) and hourly-cap backoff.
const keyStates = loadKeys().map((key, index) => ({ key, index, cooldownUntil: 0, blockedUntil: 0 }));
const MAX_VMS = keyStates.length * PER_KEY_VMS;   // total capacity across all keys
console.log(`[vms] provider keys: ${keyStates.length} | ${PER_KEY_VMS}/key | capacity: ${MAX_VMS}`);

export function vmsConfigured() { return keyStates.length > 0; }

const sessions = new Map();   // userId -> { containerId, connectCode, url, keyIndex, createdAt, expiresAt }

// A proxied request that comes back 404/502 means our idea of this VM's state may
// be wrong. Rather than guess from the proxy (which sees dozens of sub-resource
// requests a second), just mark it and let the next status poll do one authoritative
// check against the provider.
function flagSuspect(code) {
    if (!code) return;
    for (const sess of sessions.values()) {
        if (sess.connectCode === code) { sess.suspect = true; return; }
    }
}
const activeCodes = new Set();// connect_codes of live sessions (reverse index for proxy attribution)
const queue = [];             // [{ userId, since, lastSeen }] FIFO waitlist

// How many live VMs a given key currently hosts.
function keyVmCount(index) {
    let n = 0;
    for (const s of sessions.values()) if (s.keyIndex === index) n++;
    return n;
}
// Total free slots right now (keys that are hourly-blocked can't take new VMs).
function totalFree() {
    const now = Date.now();
    let free = 0;
    for (const ks of keyStates) {
        if (ks.blockedUntil > now) continue;
        free += Math.max(0, PER_KEY_VMS - keyVmCount(ks.index));
    }
    return free;
}
// Snapshot of where capacity is going: free (can create now), inUse (slots taken
// by live VMs), blocked (key hit the provider's hourly CREATE limit). When free=0
// but blocked>0, the bottleneck is the hourly create budget, not concurrent slots.
function capacitySnapshot() {
    const now = Date.now();
    let free = 0, inUse = 0, blocked = 0, soonest = Infinity;
    for (const ks of keyStates) {
        if (ks.blockedUntil > now) { blocked++; soonest = Math.min(soonest, ks.blockedUntil); }
        else if (keyVmCount(ks.index) >= PER_KEY_VMS) { inUse++; }
        else { free++; }
    }
    return { free, inUse, blocked, soonestUnblockMs: soonest === Infinity ? 0 : Math.max(0, soonest - now) };
}
// Lowest-index key that can take a new VM. Returns { ks, wait } where wait>0 means
// it has room but is inside its per-key 24s create gap; null means none available.
function pickKeyForCreate() {
    const now = Date.now();
    let waiting = null;
    for (const ks of keyStates) {
        if (ks.blockedUntil > now) continue;
        if (keyVmCount(ks.index) >= PER_KEY_VMS) continue;
        if (ks.cooldownUntil > now) { if (!waiting) waiting = ks; continue; }
        return { ks, wait: 0 };
    }
    return waiting ? { ks: waiting, wait: waiting.cooldownUntil - now } : null;
}

// noVNC often loads assets / opens its framebuffer WebSocket at a ROOT-absolute
// path (e.g. "/websockify", "/core/rfb.js") instead of under "/vm/<code>/". Such
// a request still carries a Referer of the iframe page ("/vm/<code>/..."), so we
// re-attribute it to that VM — but only if <code> is a live session.
function codeFromReferer(ref) {
    if (!ref) return null;
    try {
        const m = /^\/vm\/([A-Za-z0-9_-]{3,80})(?:\/|$)/.exec(new URL(ref).pathname);
        return m && activeCodes.has(m[1]) ? m[1] : null;
    } catch { return null; }
}

// Resolve the owning Nocturne user straight from the session cookie. VM asset
// requests (.js/.css/.png) take the static fast-path and bypass the global auth
// middleware, and the WS upgrade never runs Express middleware at all — so we
// parse the cookie ourselves rather than trusting req.user being populated.
function uidFromCookie(req) {
    const raw = req.headers && req.headers.cookie;
    if (!raw) return null;
    let token = "";
    for (const part of String(raw).split(/;\s*/)) {
        const i = part.indexOf("=");
        if (i > 0 && part.slice(0, i).trim() === "nocturne_sid") { token = part.slice(i + 1).trim(); break; }
    }
    if (!token || token.length !== 64) return null;
    try { const s = stmts.findSession.get(token, Date.now()); return s ? s.user_id : null; } catch { return null; }
}
// A /vm/<code> request is authorized only when the requester is signed in AND owns
// the live VM that <code> belongs to (connect codes are unique per user). This is
// what stops anyone who learns/guesses a connect_code from driving another user's
// desktop. Owner of the session is identified by req.user (if populated) or cookie.
function ownsCode(req, code) {
    if (!code) return false;
    const uid = (req.user && req.user.id) || uidFromCookie(req);
    if (uid == null) return false;
    const sess = sessions.get(uid);
    return !!(sess && sess.connectCode === code);
}

async function providerCreate(developerId, key) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 60_000);
    try {
        const r = await fetch(PROVIDER_BASE + "/api/create?developer_id=" + encodeURIComponent(developerId), {
            headers: { "X-API-Key": key }, signal: ac.signal
        });
        const data = await r.json().catch(() => null);
        return { ok: r.ok && data && data.status === "success", status: r.status, data };
    } finally { clearTimeout(timer); }
}
// Poll the VM's own web endpoint until it actually serves, so we don't hand the
// iframe a URL for a container that's scheduled but not yet listening (which
// would render as an error/blank "loads forever"). Best-effort: returns after
// the budget regardless, so a slow-but-fine VM is never rejected.
async function providerReady(code, budgetMs = 15_000) {
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline) {
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), 3000);
        try {
            const r = await fetch(PROVIDER_BASE + "/vm/" + encodeURIComponent(code) + "/", { redirect: "manual", signal: ac.signal });
            if (r.status >= 200 && r.status < 400) return true;   // serving
        } catch {}
        finally { clearTimeout(t); }   // an aborted probe left this timer running
        await new Promise(res => setTimeout(res, 1200));
    }
    return false;
}
// The provider exposes stop/start/restart alongside create/delete (see its
// /openapi.json). All four take the developer key in X-API-Key, same as delete.
// Returns { ok, status, message } and never throws — a failed stop must not cost
// the user their VM, and a failed start has to surface a real message.
async function providerAction(action, containerId, keyIndex) {
    if (!containerId) return { ok: false, status: 0, message: "no container" };
    const ks = keyStates[keyIndex] || keyStates[0];
    if (!ks) return { ok: false, status: 0, message: "no key" };
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 30_000);
    try {
        const r = await fetch(PROVIDER_BASE + "/api/" + action + "/" + encodeURIComponent(containerId), {
            headers: { "X-API-Key": ks.key }, signal: ac.signal
        });
        const data = await r.json().catch(() => null);
        const ok = r.ok && (!data || data.status !== "error");
        if (VM_DEBUG) console.log("[vms]", action, containerId, "->", r.status, (data && (data.message || data.error)) || "");
        return { ok, status: r.status, message: (data && (data.message || data.error)) || "" };
    } catch (e) {
        if (VM_DEBUG) console.log("[vms]", action, "failed:", e && e.message);
        return { ok: false, status: 0, message: (e && e.message) || "request failed" };
    } finally { clearTimeout(timer); }
}

// The provider answers /vm/<code>/ with an identical 404 "VM not found" whether a
// container is merely stopped or has been deleted outright (verified against the
// live API). The only way to tell them apart is to ask for the record itself:
// a stopped VM is still listed with status "exited", a deleted one is not listed.
//   -> "running" | "exited" | "gone" | null (couldn't tell)
async function providerVmState(connectCode, keyIndex) {
    if (!connectCode) return null;
    const ks = keyStates[keyIndex] || keyStates[0];
    if (!ks) return null;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 12_000);
    try {
        const r = await fetch(PROVIDER_BASE + "/api/dev/list?connect_code=" + encodeURIComponent(connectCode), {
            headers: { "X-API-Key": ks.key }, signal: ac.signal
        });
        const data = await r.json().catch(() => null);
        if (!r.ok || !data || !Array.isArray(data.vms)) return null;
        const vm = data.vms.find(v => v && v.connect_code === connectCode) || data.vms[0];
        const state = !vm ? "gone" : (/^running$/i.test(String(vm.status || "")) ? "running" : "exited");
        if (VM_DEBUG) console.log("[vms] provider state for", connectCode, "->", state, "(listed:", data.vms.length + ")");
        return state;
    } catch (e) {
        return null;   // network trouble is not evidence the VM is gone
    } finally { clearTimeout(timer); }
}

// An empty list has been observed transiently for a container that was still
// there a moment later, and acting on one reading would delete a session the user
// still owns. "gone" therefore has to be said twice, a beat apart, before it counts.
async function providerVmStateConfirmed(connectCode, keyIndex) {
    const first = await providerVmState(connectCode, keyIndex);
    if (first !== "gone") return first;
    await new Promise(r => setTimeout(r, 1500));
    const second = await providerVmState(connectCode, keyIndex);
    if (second !== "gone") {
        if (VM_DEBUG) console.log("[vms] transient empty list for", connectCode, "- second read says", second);
        return second;
    }
    return "gone";
}

// NOTE on how long a suspended VM survives. Measured against the live provider:
// once a container is stopped it is reaped on the provider's side after roughly
// 170 seconds, and there is no way to hold it open. /api/extend_vm looks like a
// lease renewal but its "code" field is a premium voucher code — it answers
// "Invalid or expired premium code" for both running and stopped containers, so
// it cannot be used as a keepalive.
//
// The consequence: a resumed VM is the SAME machine only within ~2.5 minutes of
// being suspended. After that the session survives but the container does not, and
// /api/vms/resume reports gone:true so the page can start a fresh one in its place.

async function providerDelete(containerId, keyIndex) {
    if (!containerId) return;
    const ks = keyStates[keyIndex] || keyStates[0];
    if (!ks) return;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 20_000);
    try {
        await fetch(PROVIDER_BASE + "/api/delete/" + encodeURIComponent(containerId), { headers: { "X-API-Key": ks.key }, signal: ac.signal });
    } catch {}
    finally { clearTimeout(timer); }
}

// Stop a session's container at the provider but keep the session, so the user
// can start it again and get the same machine back. If the provider refuses the
// stop we leave the VM running rather than losing it — the worst case is that it
// stays up, which is the old behaviour.
async function suspendSession(uid, s, why) {
    if (s.state !== "running" || s.suspending) return;
    s.suspending = true;
    const r = await providerAction("stop", s.containerId, s.keyIndex);
    s.suspending = false;
    if (!sessions.has(uid)) return;     // ended while the stop was in flight

    if (r.ok) {
        s.state = "stopped";
        s.stoppedAt = Date.now();
        s.suspect = false;
        if (VM_DEBUG) console.log("[vms] suspended", s.containerId, "(" + why + ")");
        return;
    }

    // A 404 here means the provider already disposed of the container. Left alone
    // this retried on every 15s sweep forever, hammering the provider and leaving
    // the page trying to connect to a machine that no longer exists. Settle it now.
    const gone = r.status === 404 || /not\s*found|already terminated|no such/i.test(r.message || "");
    if (gone) {
        const real = await providerVmStateConfirmed(s.connectCode, s.keyIndex);
        if (!sessions.has(uid)) return;
        if (real === "gone") {
            sessions.delete(uid);
            if (s.connectCode) activeCodes.delete(s.connectCode);
            if (VM_DEBUG) console.log("[vms] session cleared — provider already disposed of", s.containerId);
            return;
        }
        if (real === "exited") { s.state = "stopped"; s.stoppedAt = Date.now(); s.suspect = false; return; }
    }

    // Still there but it would not stop. Leave it running and back off, rather than
    // asking again every single sweep.
    s.suspendRetryAt = Date.now() + 60_000;
    if (VM_DEBUG) console.log("[vms] suspend refused for", s.containerId, "-", r.message, "- retrying in 60s");
}

function pruneExpired() {
    const now = Date.now();
    for (const [uid, s] of sessions) {
        // Both checks are opt-in. expiresAt is Infinity when uncapped, and the
        // idle check is skipped entirely unless INACTIVITY_MS was configured, so
        // by default a live session is never reaped out from under its owner.
        const capped = s.expiresAt <= now;
        const idle = INACTIVITY_MS > 0 && (now - (s.lastSeen || s.createdAt)) > INACTIVITY_MS;
        if (capped || idle) {
            sessions.delete(uid); if (s.connectCode) activeCodes.delete(s.connectCode); providerDelete(s.containerId, s.keyIndex);
            continue;
        }
        // Away long enough -> stop it. lastActiveAt only advances while the page
        // says the user is actually looking at the VM, so a closed tab, a hidden
        // tab and a minimised desktop all land here by the same route.
        if (AWAY_STOP_MS > 0 && s.state === "running" && now >= (s.suspendRetryAt || 0)
            && (now - (s.lastActiveAt || s.createdAt)) > AWAY_STOP_MS) {
            suspendSession(uid, s, "away " + Math.round((now - (s.lastActiveAt || s.createdAt)) / 1000) + "s");
            continue;
        }

    }
    // The waitlist still prunes: someone who stopped polling has closed the tab.
    for (let i = queue.length - 1; i >= 0; i--) { if (now - queue[i].lastSeen > QUEUE_STALE_MS) queue.splice(i, 1); }
}
function queueIndex(uid) { return queue.findIndex(q => q.userId === uid); }
function removeFromQueue(uid) { const i = queueIndex(uid); if (i >= 0) queue.splice(i, 1); }

export function mountVms(app, { authMiddleware } = {}) {
    const auth = authMiddleware || ((req, res, next) => next());
    const need = (req, res) => { if (!req.user) { res.status(401).json({ error: "Sign in to launch a VM." }); return false; } return true; };

    // Reverse-proxy all /vm/<code>/... traffic to the provider (HTTP; the WS
    // upgrade is handled by vmProxyUpgrade in the server's upgrade listener).
    app.use((req, res, next) => {
        const m = VM_PATH_RE.exec(req.url);
        if (!m) return next();
        if (!keyStates.length) return res.status(503).end();
        // Only the signed-in owner of this VM may reach it.
        if (!ownsCode(req, m[1])) return res.status(403).end();
        proxyVmHttp(req, res, req.url, m[1]);
    });

    // Fallback: a root-absolute request made from inside a VM iframe carries that
    // iframe's Referer — re-attribute it to the VM and proxy. Two cases:
    //  • Anubis (the provider's bot check) serves its assets + proof-of-work API
    //    at the provider ROOT (/.within.website/, /.well-known/) — those MUST be
    //    proxied root-to-root or the challenge never completes (it just re-serves
    //    itself), which is the "loads forever".
    //  • Anything else that escaped the prefix is a VM asset → put it back under
    //    /vm/<code>/.
    app.use((req, res, next) => {
        if (req.url.startsWith("/api/") || req.url.startsWith("/vm/")) return next();
        const code = codeFromReferer(req.headers.referer);
        if (!code) return next();
        if (!keyStates.length) return res.status(503).end();
        // The Referer attributes this root asset to a VM — but only proxy it for
        // that VM's actual owner; otherwise let it fall through to normal handling.
        if (!ownsCode(req, code)) return next();
        const path = req.url.split("?")[0];
        const toRoot = path.startsWith("/.within.website/") || path.startsWith("/.well-known/");
        const target = toRoot ? req.url : ("/vm/" + code + req.url);
        if (VM_DEBUG) console.log("[vms] http re-attributed", req.method, req.url.slice(0, 60), "->", target.slice(0, 80));
        proxyVmHttp(req, res, target, code);
    });

    app.get("/api/vms/status", auth, async (req, res) => {
        pruneExpired();
        res.setHeader("Cache-Control", "no-store");
        let sess = req.user ? sessions.get(req.user.id) : null;

        // The proxy saw the provider disown this VM. Settle it with one
        // authoritative call rather than letting the page reconnect forever
        // against a container that is stopped or already gone.
        if (sess && sess.suspect && !sess.verifying && Date.now() - (sess.verifiedAt || 0) > 5_000) {
            sess.verifying = true;
            try {
                const real = await providerVmStateConfirmed(sess.connectCode, sess.keyIndex);
                sess.verifiedAt = Date.now();
                if (real === "gone") {
                    sessions.delete(req.user.id);
                    if (sess.connectCode) activeCodes.delete(sess.connectCode);
                    if (VM_DEBUG) console.log("[vms] session cleared — provider no longer has", sess.connectCode);
                    sess = null;
                } else if (real === "exited") {
                    sess.state = "stopped";
                    sess.stoppedAt = sess.stoppedAt || Date.now();
                    sess.suspect = false;
                } else if (real === "running") {
                    // A 502 while it was booting. Nothing is wrong with the session.
                    sess.state = "running";
                    sess.suspect = false;
                }
            } finally {
                if (sess) sess.verifying = false;
            }
        }

        const alive = !!(sess && sess.expiresAt > Date.now());
        // "active" stays the flag that means "there is a desktop to show right
        // now". A suspended VM is still the user's, but it has no picture until
        // they start it, so it reports active:false with state:"stopped".
        const active = alive && sess.state === "running";
        const snap = capacitySnapshot();
        res.json({
            available: keyStates.length > 0, authenticated: !!req.user, active,
            // "running" | "stopped" | null when there is no session at all.
            state: alive ? sess.state : null,
            stoppedAt: alive && sess.state === "stopped" ? sess.stoppedAt : null,
            url: active ? sess.url : null,
            // null = this session has no time limit; a number = seconds remaining.
            secondsLeft: active ? outSecondsLeft(sess.expiresAt) : 0,
            expiresAt: active ? outExpiry(sess.expiresAt) : null,
            inUse: sessions.size, capacity: MAX_VMS, waiting: queue.length,
            // When every open key is rate-limited, surface that distinctly.
            rateLimited: snap.free === 0 && snap.blocked > 0,
            rateLimitSeconds: (snap.free === 0 && snap.blocked > 0) ? Math.ceil(snap.soonestUnblockMs / 1000) : 0
        });
    });

    // Keep-alive: while the VM page is open it pings this. With NOCTURNE_VM_IDLE_MS
    // unset the ping no longer decides whether the VM lives, but it still tracks
    // lastSeen for the admin view and for anyone who turns idle reaping back on.
    app.post("/api/vms/heartbeat", auth, (req, res) => {
        const sess = req.user && sessions.get(req.user.id);
        if (!sess) return res.status(404).json({ ok: false });
        const now = Date.now();
        sess.lastSeen = now;
        // The page tells us whether the user is actually on the desktop. Anything
        // that is not an explicit "away: true" counts as present, so an older
        // client that does not send the flag keeps its VM awake exactly as before.
        const away = req.body && req.body.away === true;
        if (!away) sess.lastActiveAt = now;
        res.json({
            ok: true,
            state: sess.state,
            secondsLeft: outSecondsLeft(sess.expiresAt),
            // How long until this gets suspended, so the page can warn first.
            suspendInSeconds: (AWAY_STOP_MS > 0 && sess.state === "running")
                ? Math.max(0, Math.round((AWAY_STOP_MS - (now - (sess.lastActiveAt || sess.createdAt))) / 1000))
                : null
        });
    });

    // Start a suspended VM back up. Same container, same connect code, same URL —
    // the user lands back on the machine they left.
    app.post("/api/vms/resume", auth, async (req, res) => {
        if (!need(req, res)) return;
        const uid = req.user.id;
        const sess = sessions.get(uid);
        if (!sess) return res.status(404).json({ error: "You don't have a VM to start. Launch a new one." });

        sess.lastSeen = Date.now();
        sess.lastActiveAt = Date.now();
        if (sess.state === "running") return res.json({ ok: true, url: sess.url, state: "running", alreadyRunning: true });
        if (sess.resuming) return res.json({ ok: true, url: sess.url, state: "starting", pending: true });

        sess.resuming = true;
        try {
            const r = await providerAction("start", sess.containerId, sess.keyIndex);
            if (!r.ok) {
                // The container is gone at the provider (reaped, expired, wiped).
                // Drop the dead session so the page can offer a fresh launch
                // instead of retrying a machine that no longer exists.
                const gone = r.status === 404 || /not\s*found|no such|unknown container/i.test(r.message || "");
                if (gone) {
                    // The provider reaped the stopped container. The session is the
                    // user's, so hand the page a relaunch instruction rather than an
                    // error: it calls /api/vms/create, which keeps all the queueing
                    // and rate-limit handling in one place.
                    sessions.delete(uid);
                    if (sess.connectCode) activeCodes.delete(sess.connectCode);
                    return res.status(410).json({
                        error: "That machine had already been cleaned up, so a fresh one is starting.",
                        gone: true, relaunch: true
                    });
                }
                return res.status(502).json({ error: r.message || "Couldn't start your VM. Try again in a moment." });
            }
            await providerReady(sess.connectCode);
            sess.state = "running";
            sess.stoppedAt = null;
            sess.suspect = false;
            sess.lastActiveAt = Date.now();
            sess.lastSeen = Date.now();
            try { logActivity("vm", { userId: uid, username: req.user?.username, ip: clientIp(req), fp: fpFromReq(req), action: "resumed desktop" }); } catch {}
            res.json({ ok: true, url: sess.url, state: "running" });
        } finally {
            sess.resuming = false;
        }
    });

    // Restart the same container in place. Offered when a desktop is slow to come
    // up: it is a heavier hammer than reloading the frame but keeps the machine.
    app.post("/api/vms/restart", auth, async (req, res) => {
        if (!need(req, res)) return;
        const uid = req.user.id;
        const sess = sessions.get(uid);
        if (!sess) return res.status(404).json({ error: "You don't have a VM to restart. Launch one." });
        if (sess.restarting) return res.json({ ok: true, url: sess.url, pending: true });

        sess.restarting = true;
        try {
            // A stopped container has to be started rather than restarted.
            const action = sess.state === "stopped" ? "start" : "restart";
            const r = await providerAction(action, sess.containerId, sess.keyIndex);
            if (!r.ok) {
                const gone = r.status === 404 || /not\s*found|already terminated|no such/i.test(r.message || "");
                if (gone) {
                    sessions.delete(uid);
                    if (sess.connectCode) activeCodes.delete(sess.connectCode);
                    return res.status(410).json({ error: "That machine had already been cleaned up, so a fresh one is starting.", gone: true, relaunch: true });
                }
                return res.status(502).json({ error: r.message || "Couldn't restart your VM. Try again in a moment." });
            }
            await providerReady(sess.connectCode);
            sess.state = "running";
            sess.stoppedAt = null;
            sess.suspect = false;
            sess.lastSeen = Date.now();
            sess.lastActiveAt = Date.now();
            try { logActivity("vm", { userId: uid, username: req.user?.username, ip: clientIp(req), fp: fpFromReq(req), action: "restarted desktop" }); } catch {}
            res.json({ ok: true, url: sess.url, state: "running" });
        } finally {
            sess.restarting = false;
        }
    });

    app.post("/api/vms/create", auth, async (req, res) => {
        if (!need(req, res)) return;
        if (!keyStates.length) return res.status(503).json({ error: "VMs aren't available right now." });
        pruneExpired();
        const uid = req.user.id, now = Date.now();

        // Already has a VM -> hand it back rather than making a second one. A
        // suspended one is started first, so pressing Launch on the paused screen
        // does the obvious thing.
        const existing = sessions.get(uid);
        if (existing && existing.expiresAt > now) {
            existing.lastSeen = now;
            existing.lastActiveAt = now;
            removeFromQueue(uid);
            if (existing.state === "stopped") {
                const r = await providerAction("start", existing.containerId, existing.keyIndex);
                if (r.ok) {
                    await providerReady(existing.connectCode);
                    existing.state = "running";
                    existing.stoppedAt = null;
                } else {
                    const gone = r.status === 404 || /not\s*found|no such|unknown container/i.test(r.message || "");
                    // Only a container that is genuinely gone gets cleared; anything
                    // else keeps the session so a transient provider blip is not a
                    // reason to lose the machine.
                    if (gone) { sessions.delete(uid); if (existing.connectCode) activeCodes.delete(existing.connectCode); }
                    else return res.status(502).json({ error: r.message || "Couldn't start your VM. Try again in a moment." });
                }
            }
            if (sessions.has(uid)) {
                return res.json({ ok: true, url: existing.url, sessionId: existing.containerId, expiresAt: outExpiry(existing.expiresAt), maxMinutes: VM_MAX_MINUTES || null, state: existing.state, reused: true });
            }
        }

        // Hold (or take) a place in line.
        let qi = queueIndex(uid);
        if (qi < 0) { queue.push({ userId: uid, since: now, lastSeen: now }); qi = queue.length - 1; }
        else { queue[qi].lastSeen = now; }

        const free = totalFree();

        // Not enough free machines for this person yet -> stay on the waitlist.
        if (qi >= free) {
            const position = qi + 1;
            const snap = capacitySnapshot();
            // Every open key is rate-limited -> it's the provider's hourly create
            // budget, not concurrent slots. Say so, and poll near the unblock time.
            if (snap.free === 0 && snap.blocked > 0) {
                return res.json({ ok: true, queued: true, rateLimited: true, position, total: queue.length, capacity: MAX_VMS, etaSeconds: Math.ceil(snap.soonestUnblockMs / 1000), retryMs: Math.min(snap.soonestUnblockMs + 1000, 60_000) || 20_000 });
            }
            return res.json({ ok: true, queued: true, position, total: queue.length, capacity: MAX_VMS, etaSeconds: estimateWaitSeconds(position), retryMs: 7000 });
        }

        // Pick the next key with room. If it's mid create-gap, poll again shortly.
        const pick = pickKeyForCreate();
        if (!pick) {
            return res.json({ ok: true, queued: true, starting: true, position: qi + 1, total: queue.length, retryMs: 6000 });
        }
        if (pick.wait > 0) {
            return res.json({ ok: true, queued: true, starting: true, position: qi + 1, total: queue.length, retryMs: Math.min(pick.wait + 500, 8000) });
        }

        const ks = pick.ks;
        ks.cooldownUntil = now + GLOBAL_CREATE_GAP_MS;   // claim this key's create window
        let result;
        try { result = await providerCreate(DEVELOPER_ID, ks.key); }
        catch { ks.cooldownUntil = Date.now() + 5000; return res.json({ ok: true, queued: true, starting: true, position: qi + 1, total: queue.length, retryMs: 5000 }); }

        if (!result.ok) {
            // Prefer the human-readable message: the provider's "error" field is often
            // just a generic code (e.g. "HTTP_EXCEPTION") while "message"/"detail" has
            // the actual reason ("Invalid API Key. Please re-log.", "10 per hour", ...).
            const detail = (result.data && (result.data.detail || result.data.message || result.data.error)) || "";
            // This key hit its hourly create cap -> back it off and rotate to the
            // next key on the client's quick re-poll.
            if (/per\s*\d*\s*hour|hourly/i.test(detail)) {
                ks.blockedUntil = Date.now() + KEY_HOURLY_BLOCK_MS;
                if (VM_DEBUG) console.log(`[vms] key ${ks.index} hit hourly cap; rotating to next key`);
                return res.json({ ok: true, queued: true, starting: true, position: qi + 1, total: queue.length, retryMs: 1200 });
            }
            if (result.status === 429 || /wait|busy|limit/i.test(detail)) {
                const m = /(\d+)\s*second/i.exec(detail);
                ks.cooldownUntil = Date.now() + ((m ? +m[1] : 25) * 1000);
                return res.json({ ok: true, queued: true, starting: true, position: qi + 1, total: queue.length, retryMs: ((m ? +m[1] : 20) * 1000) + 500 });
            }
            ks.cooldownUntil = 0;
            return res.status(502).json({ error: detail || "Couldn't start a VM right now. Try again." });
        }

        const d = result.data;
        if (!d.url || !d.container_id || !d.connect_code) return res.status(502).json({ error: "The VM service returned an unexpected response." });
        removeFromQueue(uid);
        await providerReady(d.connect_code);   // best-effort: don't hand over a not-yet-serving VM
        const maxMin = VM_MAX_MINUTES;   // 0 = no cap
        const expiresAt = maxMin > 0 ? Date.now() + maxMin * 60 * 1000 : Infinity;
        // Hand the client a Nocturne-relative URL; all traffic is proxied so the
        // provider's domain never reaches the browser.
        const proxiedUrl = "/vm/" + d.connect_code + "/";
        sessions.set(uid, { containerId: d.container_id, connectCode: d.connect_code, url: proxiedUrl, keyIndex: ks.index, createdAt: Date.now(), lastSeen: Date.now(), lastActiveAt: Date.now(), state: "running", stoppedAt: null, expiresAt });
        activeCodes.add(d.connect_code);
        try { logActivity("vm", { userId: uid, username: req.user?.username, ip: clientIp(req), fp: fpFromReq(req), action: "opened desktop" }); } catch {}
        res.json({ ok: true, url: proxiedUrl, sessionId: d.container_id, maxMinutes: maxMin || null, inactivityTimeout: d.inactivity_timeout_seconds || 60, gpu: !!d.gpu_enabled, state: "running", awaySeconds: AWAY_STOP_MS > 0 ? Math.round(AWAY_STOP_MS / 1000) : null, expiresAt: outExpiry(expiresAt) });
    });

    app.post("/api/vms/end", auth, async (req, res) => {
        if (!need(req, res)) return;
        removeFromQueue(req.user.id);
        const sess = sessions.get(req.user.id);
        if (sess) { sessions.delete(req.user.id); if (sess.connectCode) activeCodes.delete(sess.connectCode); providerDelete(sess.containerId, sess.keyIndex); }
        try { logActivity("vm", { userId: req.user.id, username: req.user?.username, ip: clientIp(req), fp: fpFromReq(req), action: "closed desktop" }); } catch {}
        res.json({ ok: true });
    });
}

setInterval(pruneExpired, 15_000).unref();
