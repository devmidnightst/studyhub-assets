// flix.js — dedicated SERVER-SIDE reverse proxy for the Films feature (toustream.xyz).
//
// Why this exists
// ---------------
// toustream sits behind Anubis (Techaro) — a proof-of-work anti-bot gate. Our
// general proxy (Ultraviolet) terminates TLS in the browser (epoxy) and emulates
// cookies client-side; it mishandles Anubis's two-cookie, SameSite=None
// challenge→302→redirect dance inside a third-party iframe, so real human users get
// stuck forever on "Making sure you're not a bot!".
//
// This proxy instead terminates TLS to toustream ON THE SERVER and keeps a
// per-session cookie jar, so the techaro.lol-anubis-* cookies persist exactly like a
// normal browser's. Crucially we DO NOT solve the proof-of-work for the user — we
// serve the real Anubis challenge page natively (just rewriting one base-prefix
// value so its asset/PoW requests stay inside the proxy), the user's OWN browser
// does the hashcash work, and we capture the resulting signed JWT into the jar and
// replay it on every later request. The PoW therefore still does its job at human
// scale; we only give Anubis a clean environment UV couldn't.
//
// Gated behind NOCTURNE_FLIX. Purely additive: nothing happens until mountFlix runs
// and films.html points its iframe at /flix/. Self-contained — no db, no auth.
import http from "node:http";
import https from "node:https";
import zlib from "node:zlib";
import tls from "node:tls";
import crypto from "node:crypto";

const ENABLED = process.env.NOCTURNE_FLIX === "1";
export function flixEnabled() { return ENABLED; }

const PREFIX      = "/flix";                  // mount path (no trailing slash)
const EXT         = "/flix/_e/";              // cross-origin sub-route: /flix/_e/<base64url(absUrl)>
// Upstream is the operator's PARTNER endpoint — same TouStream backend, but with no
// Anubis gate and no rate limits (a special link the site owner provided). The whole
// toustream.xyz family maps to /flix and is fetched from here; the Anubis-clearing
// code below is now a dormant safety net (it simply never triggers on partners).
const ROOT_TARGET = "partners.toustream.xyz"; // host we connect to + Host header
const ROOT_ORIGIN = "https://partners.toustream.xyz";
const BASE_DOMAIN = "toustream.xyz";          // any *.toustream.xyz counts as "root"
const DEBUG       = process.env.NOCTURNE_FLIX_DEBUG === "1";
function log(...a) { if (DEBUG) console.log("[flix]", ...a); }

const PREFIX_RE = /^\/flix(\/|$|\?)/;
function isRootHost(h) { h = String(h || "").toLowerCase(); return h === BASE_DOMAIN || h.endsWith("." + BASE_DOMAIN); }

const b64u   = (s) => Buffer.from(String(s), "utf8").toString("base64url");
const unb64u = (s) => { try { return Buffer.from(String(s), "base64url").toString("utf8"); } catch { return ""; } };

// Keep-alive connection pools — a page's many subresources REUSE a handful of TCP
// connections to the upstream instead of opening a fresh TLS handshake per request.
// Cloudflare (which fronts partners.toustream.xyz) resets bursts of new connections
// from one IP; that's the "tls handshake eof" flood a connection-per-request proxy
// (incl. UV/epoxy) triggers. Pooling keeps us to ~16 reused sockets → no burst.
const _agentOpts = { keepAlive: true, keepAliveMsecs: 10000, maxSockets: 16, maxFreeSockets: 8, scheduling: "lifo", timeout: 30000 };
const httpsAgent = new https.Agent(_agentOpts);
const httpAgent  = new http.Agent(_agentOpts);

// ── Per-session cookie jar (in-memory; lost on restart → user just re-solves) ─────
const JAR = new Map();                         // key -> { at, hosts: Map<host, Map<name,{v,exp,path}>> }
const JAR_TTL = 6 * 60 * 60 * 1000;
const JAR_MAX = 8000;

function jarFor(key) {
    let j = JAR.get(key);
    if (!j) { j = { at: Date.now(), hosts: new Map() }; JAR.set(key, j); }
    j.at = Date.now();
    return j;
}
// Identify a viewer by their Nocturne session cookie (stable per browser); fall back
// to a hash of IP+UA for anonymous viewers. Never sent upstream — jar key only.
function sessionKey(req) {
    const c = String(req.headers.cookie || "");
    const m = /(?:^|;\s*)nocturne_sid=([^;]+)/.exec(c);
    if (m) return "s:" + m[1];
    const ua = String(req.headers["user-agent"] || "");
    const ip = String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "");
    return "a:" + crypto.createHash("sha1").update(ip + "|" + ua).digest("hex").slice(0, 24);
}
function storeSetCookies(key, host, scArr) {
    if (!scArr) return;
    const arr = Array.isArray(scArr) ? scArr : [scArr];
    const j = jarFor(key);
    let hm = j.hosts.get(host);
    if (!hm) { hm = new Map(); j.hosts.set(host, hm); }
    for (const line of arr) {
        if (!line) continue;
        const parts = String(line).split(/;\s*/);
        const nv = parts.shift() || "";
        const eq = nv.indexOf("=");
        if (eq < 0) continue;
        const name = nv.slice(0, eq).trim();
        const val = nv.slice(eq + 1);
        let exp = 0, path = "/";
        for (const a of parts) {
            const al = a.toLowerCase();
            if (al.startsWith("max-age=")) { const s = parseInt(a.slice(8), 10); if (!isNaN(s)) exp = s <= 0 ? -1 : Date.now() + s * 1000; }
            else if (al.startsWith("expires=") && !exp) { const d = Date.parse(a.slice(8)); if (!isNaN(d)) exp = d; }
            else if (al.startsWith("path=")) { path = a.slice(5) || "/"; }
        }
        if (exp === -1) { hm.delete(name); continue; }   // server asked us to drop it
        hm.set(name, { v: val, exp, path });
    }
}
function cookieHeaderFor(key, host, reqPath) {
    const j = JAR.get(key); if (!j) return "";
    const hm = j.hosts.get(host); if (!hm) return "";
    const now = Date.now(); const out = [];
    const p = String(reqPath || "/");
    for (const [name, c] of hm) {
        if (c.exp && c.exp < now) { hm.delete(name); continue; }
        if (c.path && c.path !== "/" && !p.startsWith(c.path)) continue;
        out.push(name + "=" + c.v);
    }
    return out.join("; ");
}

// ── URL mapping (server side) ────────────────────────────────────────────────────
// Everything that points at toustream becomes "/flix<path>"; anything cross-origin
// becomes "/flix/_e/<base64url(absolute)>" so it's tunnelled too (video CDNs etc.).
function mapAbs(abs) {
    if (isRootHost(abs.hostname)) return PREFIX + abs.pathname + abs.search + abs.hash;
    return EXT + b64u(abs.href);
}
const SKIP_SCHEME = /^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i;
function mapRaw(raw, baseHref) {
    if (raw == null) return raw;
    const s = String(raw).trim();
    if (!s || SKIP_SCHEME.test(s)) return raw;
    if (s.startsWith(PREFIX + "/") || s === PREFIX) return raw;
    let abs; try { abs = new URL(s, baseHref); } catch { return raw; }
    if (abs.protocol !== "http:" && abs.protocol !== "https:") return raw;
    return mapAbs(abs);
}

// ── Target resolution from the inbound /flix URL ──────────────────────────────────
function targetFromReq(req) {
    const raw = req.url || "";
    if (!PREFIX_RE.test(raw)) return null;
    let rest = raw.slice(PREFIX.length);                  // "" | "/…" | "?…"

    if (rest.startsWith("/_e/")) {
        let token = rest.slice(4);                        // <b64>[/extra][?query]
        let tail = "";
        const qi = token.indexOf("?"); if (qi >= 0) { tail = token.slice(qi); token = token.slice(0, qi); }
        const si = token.indexOf("/"); if (si >= 0) { tail = token.slice(si) + tail; token = token.slice(0, si); }
        const absStr = unb64u(token);
        if (!absStr) return null;
        let abs; try { abs = new URL(absStr); } catch { return null; }
        if (tail) { try { abs = new URL(tail, abs); } catch { } }
        const scheme = abs.protocol.replace(":", "");
        return {
            scheme, host: abs.hostname, port: abs.port || (scheme === "https" ? 443 : 80),
            upstreamPath: abs.pathname + abs.search, pageHref: abs.href, pageHost: abs.hostname, ext: true,
        };
    }

    let up = rest || "/";
    if (up === "" || up[0] === "?") up = "/" + up;
    if (up[0] !== "/") up = "/" + up;
    return {
        scheme: "https", host: ROOT_TARGET, port: 443,
        upstreamPath: up, pageHref: ROOT_ORIGIN + up, pageHost: ROOT_TARGET, ext: false,
    };
}

// Rebuild a believable Referer/Origin pointing at the real upstream, not /flix.
function realFromProxyUrl(u) {
    try {
        const m = /\/flix(\/_e\/([^/?#]+)|\/[^?#]*|)?/.exec(u);
        if (!m) return null;
        if (m[2]) { const d = unb64u(m[2]); return d || null; }
        const path = (m[1] || "/") || "/";
        return ROOT_ORIGIN + (path.startsWith("/") ? path : "/" + path);
    } catch { return null; }
}

// ── Upstream request/response plumbing ────────────────────────────────────────────
const HOP = new Set(["connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "trailers", "transfer-encoding", "upgrade", "host"]);

function buildUpstreamHeaders(req, t, key) {
    const h = {};
    const pass = ["user-agent", "accept", "accept-language", "content-type", "content-length",
        "range", "if-none-match", "if-modified-since", "upgrade-insecure-requests",
        "sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-user"];
    for (const k of pass) if (req.headers[k] != null) h[k] = req.headers[k];
    h.host = t.host;
    h["accept-encoding"] = "gzip, deflate, br";

    const ck = cookieHeaderFor(key, t.host, t.upstreamPath);
    if (ck) h.cookie = ck;                                // ONLY the jar — never the browser's nocturne_sid

    if (req.headers.referer) { const r = realFromProxyUrl(req.headers.referer); if (r) h.referer = r; }
    if (req.headers.origin) h.origin = t.scheme + "://" + t.host;
    return h;
}

function proxyHttp(req, res) {
    const t = targetFromReq(req);
    if (!t) { res.statusCode = 400; return res.end("bad flix url"); }
    const key = sessionKey(req);
    const headers = buildUpstreamHeaders(req, t, key);
    const lib = t.scheme === "http" ? http : https;
    const preq = lib.request({
        protocol: t.scheme + ":", host: t.host, servername: t.host, port: t.port,
        method: req.method, path: t.upstreamPath, headers, timeout: 30000,
        agent: t.scheme === "http" ? httpAgent : httpsAgent,
    }, (pres) => handleUpstream(req, res, pres, t, key));
    preq.on("timeout", () => preq.destroy(new Error("flix upstream timeout")));
    preq.on("error", (e) => { try { if (!res.headersSent) res.statusCode = 502; res.end("flix upstream error"); } catch { } log("err", t.host, e.message); });
    res.on("close", () => { if (!res.writableFinished) { try { preq.destroy(); } catch { } } });
    if (req.method !== "GET" && req.method !== "HEAD") req.pipe(preq); else preq.end();
}

const STRIP_RESP = new Set(["content-security-policy", "content-security-policy-report-only",
    "x-frame-options", "strict-transport-security", "cross-origin-opener-policy",
    "cross-origin-embedder-policy", "cross-origin-resource-policy", "report-to", "nel",
    "x-xss-protection", "set-cookie", "transfer-encoding", "connection", "keep-alive"]);

// Decide how to treat a response from its FIRST bytes + headers. The body sniff is
// essential for video: CDNs routinely serve HLS playlists as application/octet-stream
// (or even text/html). If we don't recognise + rewrite them, hls.js resolves each
// segment URL against the proxied playlist URL and every segment 404s.
function sniffKind(firstChunk, ct, path) {
    const head = firstChunk.slice(0, 256).toString("latin1").replace(/^\uFEFF/, "").replace(/^\s+/, "");
    if (/^#EXTM3U/.test(head)) return "m3u8";
    if (/mpegurl/i.test(ct)) return "m3u8";
    if (/\.m3u8(\?|$)/i.test(path)) return "m3u8";
    if (/text\/html/i.test(ct)) return "html";
    if (/text\/css/i.test(ct)) return "css";
    return "binary";
}

// Write with backpressure so large media (video segments) never balloon memory.
function writeBP(res, src, chunk) { if (!res.write(chunk)) { src.pause(); res.once("drain", () => { try { src.resume(); } catch { } }); } }

function handleUpstream(req, res, pres, t, key) {
    storeSetCookies(key, t.host, pres.headers["set-cookie"]);

    const out = {};
    for (const [k, v] of Object.entries(pres.headers)) if (!STRIP_RESP.has(k.toLowerCase())) out[k] = v;
    // Resources are same-origin to the page in practice, but be permissive so a
    // cors-mode fetch (hls.js, workers, fonts) is never blocked.
    out["access-control-allow-origin"] = req.headers.origin || "*";
    out["access-control-expose-headers"] = "*";
    if (req.headers.origin) out["vary"] = out["vary"] ? out["vary"] + ", Origin" : "Origin";

    const status = pres.statusCode || 502;
    if (pres.headers.location) {
        const abs = (() => { try { return new URL(pres.headers.location, t.pageHref); } catch { return null; } })();
        out.location = abs ? mapAbs(abs) : pres.headers.location;
    }

    const ct = String(pres.headers["content-type"] || "");

    // No body / must not buffer: HEAD, 204/304, SSE/multipart → pass straight through.
    if (req.method === "HEAD" || status === 204 || status === 304) {
        try { res.writeHead(status, out); res.end(); } catch { }
        pres.resume();
        return;
    }
    if (/event-stream|multipart/i.test(ct)) {
        try { res.writeHead(status, out); } catch { }
        pres.pipe(res);
        pres.on("error", () => { try { res.end(); } catch { } });
        return;
    }

    // Decide kind from the first chunk; rewrite text/playlists, stream everything else.
    let decided = null, piping = false;
    const chunks = [];
    pres.on("data", (c) => {
        if (piping) return writeBP(res, pres, c);
        if (decided === null) {
            decided = sniffKind(c, ct, t.upstreamPath);
            if (decided === "binary") {                  // video / segments / images → stream (Range intact)
                piping = true;
                try { res.writeHead(status, out); } catch { }
                writeBP(res, pres, c);
                return;
            }
        }
        chunks.push(c);
    });
    pres.on("error", () => { try { res.end(); } catch { } });
    pres.on("end", () => {
        if (piping) { try { res.end(); } catch { } return; }
        const raw = Buffer.concat(chunks);
        if (!decided || decided === "binary") { try { res.writeHead(status, out); res.end(raw); } catch { } return; }
        const buf = decompress(raw, pres.headers["content-encoding"]);
        let body;
        try {
            if (decided === "html") body = rewriteHtml(buf.toString("utf8"), t);
            else if (decided === "css") body = rewriteCss(buf.toString("utf8"), t);
            else body = rewriteM3u8(buf.toString("utf8"), t);
        } catch (e) { log("rewrite fail", e.message); body = buf.toString("utf8"); }
        delete out["content-encoding"];
        delete out["content-length"];
        // Never let the browser cache our REWRITTEN HTML/CSS/playlists — the injected
        // shim + URL rewriting change between deploys; a cached copy strands users on an
        // old shim (upstream sends "public, max-age=3600", which broke exactly this).
        out["cache-control"] = "no-store";
        delete out["expires"]; delete out["etag"]; delete out["last-modified"]; delete out["age"];
        const ob = Buffer.from(body, "utf8");
        out["content-length"] = String(ob.length);
        try { res.writeHead(status, out); res.end(ob); } catch { }
    });
}

function decompress(buf, enc) {
    try {
        enc = String(enc || "").toLowerCase();
        if (enc === "gzip") return zlib.gunzipSync(buf);
        if (enc === "deflate") return zlib.inflateSync(buf);
        if (enc === "br") return zlib.brotliDecompressSync(buf);
    } catch (e) { log("decompress fail", e.message); }
    return buf;
}

// ── Body rewriting ────────────────────────────────────────────────────────────────
function rewriteHtml(html, t) {
    // 1) Keep Anubis's PoW + assets inside the proxy: its base-prefix is "" → "/flix".
    html = html.replace(
        /(<script id="anubis_base_prefix"[^>]*>)\s*""\s*(<\/script>)/i,
        `$1"${PREFIX}"$2`
    );
    // 2) Drop SRI (we change bytes) and CSP <meta>.
    html = html.replace(/\sintegrity\s*=\s*("[^"]*"|'[^']*')/gi, "");
    html = html.replace(/<meta[^>]+http-equiv\s*=\s*["']?content-security-policy["'][^>]*>/gi, "");
    // 3) Map url-bearing attributes against the page's REAL url.
    html = html.replace(/(\s(?:href|src|action|poster|formaction|data-src)\s*=\s*)("([^"]*)"|'([^']*)')/gi,
        (m, pre, _q, dq, sq) => {
            const v = dq != null ? dq : sq;
            const mapped = mapRaw(v, t.pageHref);
            if (mapped === v) return m;
            return `${pre}"${mapped}"`;
        });
    html = html.replace(/(\ssrcset\s*=\s*)("([^"]*)"|'([^']*)')/gi, (m, pre, _q, dq, sq) => {
        const v = dq != null ? dq : sq;
        const mapped = v.split(",").map(part => {
            const seg = part.trim(); if (!seg) return part;
            const sp = seg.split(/\s+/); sp[0] = mapRaw(sp[0], t.pageHref); return sp.join(" ");
        }).join(", ");
        return `${pre}"${mapped}"`;
    });
    // 3b) Catch absolute root-origin URLs left in non-attribute spots (og:url meta,
    // JSON-LD, inline JS string literals) so the page never references its real
    // identity. MUST run before the shim is injected (the shim embeds the real href).
    if (!t.ext) {
        html = html.replace(/https?:\/\/(?:[a-z0-9-]+\.)*toustream\.xyz/gi, PREFIX);
        html = html.replace(/(^|[\s"'(=])\/\/(?:[a-z0-9-]+\.)*toustream\.xyz/gi, `$1${PREFIX}`);
    }
    // 4) Inject the client shim + <base> as early as possible in <head>.
    const inject = clientShim(t) + `<base href="${PREFIX}/">`;
    if (/<head[^>]*>/i.test(html)) html = html.replace(/<head([^>]*)>/i, `<head$1>${inject}`);
    else if (/<html[^>]*>/i.test(html)) html = html.replace(/<html([^>]*)>/i, `<html$1>${inject}`);
    else html = inject + html;
    return html;
}

function rewriteCss(css, t) {
    css = css.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (m, q, u) => `url("${mapRaw(u, t.pageHref)}")`);
    css = css.replace(/@import\s+(['"])([^'"]+)\1/gi, (m, q, u) => `@import "${mapRaw(u, t.pageHref)}"`);
    return css;
}

function rewriteM3u8(text, t) {
    return text.split("\n").map(line => {
        const l = line.trim();
        if (!l) return line;
        if (l[0] === "#") {
            return line.replace(/URI="([^"]+)"/gi, (m, u) => `URI="${mapRaw(u, t.pageHref)}"`);
        }
        return mapRaw(l, t.pageHref);
    }).join("\n");
}

// ── Client shim (runs inside every proxied HTML page) ─────────────────────────────
// Resolves every runtime URL against the page's REAL upstream URL and routes it back
// through /flix (toustream) or /flix/_e/<b64> (cross-origin). Wrapped in try/catch so
// it can never break a page; conservative (leaves data:/blob:/#/js: alone).
function clientShim(t) {
    const cfg = JSON.stringify({ base: t.pageHref, host: t.pageHost, root: BASE_DOMAIN, prefix: PREFIX, ext: EXT });
    return `<script>(function(){try{
var F=${cfg};window.__FLIX=F;
function isRoot(h){h=(h||'').toLowerCase();return h===F.root||h.endsWith('.'+F.root);}
function b64u(s){try{return btoa(unescape(encodeURIComponent(s))).replace(/\\+/g,'-').replace(/\\//g,'_').replace(/=+$/,'');}catch(e){return ''}}
function map(raw){try{
 if(raw==null)return raw;var s=String(raw);if(!s)return raw;
 if(/^(data:|blob:|javascript:|mailto:|tel:|about:|#)/i.test(s))return raw;
 if(s.indexOf(F.prefix+'/')===0||s===F.prefix)return raw;
 var a=new URL(s,F.base);if(a.protocol!=='http:'&&a.protocol!=='https:')return raw;
 if(a.host===location.host)return (a.pathname.indexOf(F.prefix+'/')===0||a.pathname===F.prefix)?(a.pathname+a.search+a.hash):(F.prefix+a.pathname+a.search+a.hash);
 if(isRoot(a.hostname))return F.prefix+a.pathname+a.search+a.hash;
 return F.ext+b64u(a.href);
}catch(e){return raw}}
window.__flixMap=map;
var _f=window.fetch;
if(_f)window.fetch=function(i,init){try{if(typeof i==='string')i=map(i);else if(i&&typeof i.href==='string')i=map(i.href);else if(i&&i.url)i=new Request(map(i.url),i);}catch(e){}return _f.call(this,i,init);};
var _o=XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open=function(m,u){try{u=map(u);}catch(e){}return _o.apply(this,[m,u].concat([].slice.call(arguments,2)));};
if(navigator.sendBeacon){var _b=navigator.sendBeacon.bind(navigator);navigator.sendBeacon=function(u,d){try{u=map(u);}catch(e){}return _b(u,d);};}
var _W=window.WebSocket;
if(_W){window.WebSocket=function(u,p){try{var a=new URL(u,F.base);var pr=(location.protocol==='https:'?'wss:':'ws:');u=isRoot(a.hostname)?pr+'//'+location.host+F.prefix+a.pathname+a.search:pr+'//'+location.host+F.ext+b64u(a.href);}catch(e){}return p!==undefined?new _W(u,p):new _W(u);};window.WebSocket.prototype=_W.prototype;try{window.WebSocket.CONNECTING=0;window.WebSocket.OPEN=1;window.WebSocket.CLOSING=2;window.WebSocket.CLOSED=3;}catch(e){}}
if(window.EventSource){var _E=window.EventSource;window.EventSource=function(u,c){try{u=map(u);}catch(e){}return new _E(u,c);};window.EventSource.prototype=_E.prototype;}
if(window.Worker){var _Wk=window.Worker;window.Worker=function(u,o){try{u=map(u);}catch(e){}return new _Wk(u,o);};window.Worker.prototype=_Wk.prototype;}
var _sa=Element.prototype.setAttribute;
Element.prototype.setAttribute=function(n,v){try{var ln=(n||'').toLowerCase();if(ln==='src'||ln==='href'||ln==='action'||ln==='poster'||ln==='formaction'||ln==='data-src'){v=map(v);}else if(ln==='srcset'){v=String(v).split(',').map(function(p){var x=p.trim().split(/\\s+/);if(x[0])x[0]=map(x[0]);return x.join(' ');}).join(', ');}}catch(e){}return _sa.call(this,n,v);};
function pp(proto,prop){try{var d=Object.getOwnPropertyDescriptor(proto,prop);if(!d||!d.set)return;Object.defineProperty(proto,prop,{configurable:true,enumerable:d.enumerable,get:d.get,set:function(v){try{v=map(v);}catch(e){}return d.set.call(this,v);}});}catch(e){}}
['HTMLImageElement','HTMLScriptElement','HTMLMediaElement','HTMLSourceElement','HTMLIFrameElement','HTMLTrackElement','HTMLEmbedElement'].forEach(function(k){if(window[k])pp(window[k].prototype,'src');});
['HTMLAnchorElement','HTMLLinkElement','HTMLAreaElement'].forEach(function(k){if(window[k])pp(window[k].prototype,'href');});
if(window.HTMLFormElement)pp(HTMLFormElement.prototype,'action');
['pushState','replaceState'].forEach(function(m){var _h=history[m];if(_h)history[m]=function(s,ti,u){if(u!=null){try{u=map(u);}catch(e){}}return _h.call(this,s,ti,u);};});
// URLs injected via innerHTML/template strings (e.g. movie posters) don't fire the
// property/setAttribute hooks — rewrite them as elements are inserted.
function fixEl(el){try{if(!el||el.nodeType!==1||!el.getAttribute)return;['src','href','poster','data-src'].forEach(function(at){if(el.hasAttribute(at)){var v=el.getAttribute(at),mm=map(v);if(mm!==v)el.setAttribute(at,mm);}});if(el.hasAttribute('srcset')){var ss=el.getAttribute('srcset'),nss=ss.split(',').map(function(p){var x=p.trim().split(/\\s+/);if(x[0])x[0]=map(x[0]);return x.join(' ');}).join(', ');if(nss!==ss)el.setAttribute('srcset',nss);}}catch(e){}}
try{new MutationObserver(function(ms){for(var a=0;a<ms.length;a++){var ns=ms[a].addedNodes;for(var b=0;b<ns.length;b++){var n=ns[b];fixEl(n);if(n.querySelectorAll){var d=n.querySelectorAll('[src],[href],[poster],[srcset],[data-src]');for(var c=0;c<d.length;c++)fixEl(d[c]);}}}}).observe(document.documentElement||document,{childList:true,subtree:true});}catch(e){}
}catch(e){}})();</script>`;
}

// ── WebSocket upgrade passthrough (best-effort; toustream content rarely needs it) ─
export function flixProxyUpgrade(req, socket, head) {
    if (!ENABLED) return false;
    if (!PREFIX_RE.test(req.url || "")) return false;
    const t = targetFromReq(req);
    if (!t) { try { socket.destroy(); } catch { } return true; }
    const key = sessionKey(req);
    const upstream = tls.connect({ host: t.host, port: t.port || 443, servername: t.host }, () => {
        const headers = { ...req.headers };
        headers.host = t.host;
        const ck = cookieHeaderFor(key, t.host, t.upstreamPath);
        if (ck) headers.cookie = ck; else delete headers.cookie;
        for (const k of ["x-forwarded-for", "x-forwarded-host", "x-forwarded-proto"]) delete headers[k];
        let rawReq = `${req.method || "GET"} ${t.upstreamPath} HTTP/1.1\r\n`;
        for (const k in headers) {
            const v = headers[k]; if (v == null) continue;
            if (Array.isArray(v)) for (const vv of v) rawReq += `${k}: ${vv}\r\n`;
            else rawReq += `${k}: ${v}\r\n`;
        }
        rawReq += "\r\n";
        upstream.write(rawReq);
        if (head && head.length) upstream.write(head);
        upstream.pipe(socket); socket.pipe(upstream);
    });
    upstream.on("error", () => { try { socket.destroy(); } catch { } });
    socket.on("error", () => { try { upstream.destroy(); } catch { } });
    return true;
}

// ── Express surface ────────────────────────────────────────────────────────────────
export function mountFlix(app) {
    if (!ENABLED) { console.log("[flix] disabled (set NOCTURNE_FLIX=1 to enable)"); return; }
    setInterval(() => {
        const now = Date.now();
        for (const [k, j] of JAR) if (now - j.at > JAR_TTL) JAR.delete(k);
        if (JAR.size > JAR_MAX) {
            const ents = [...JAR.entries()].sort((a, b) => a[1].at - b[1].at);
            for (let i = 0; i < ents.length - JAR_MAX; i++) JAR.delete(ents[i][0]);
        }
    }, 30 * 60 * 1000).unref();

    app.use((req, res, next) => {
        if (PREFIX_RE.test(req.url || "")) return proxyHttp(req, res);
        next();
    });
    console.log(`[flix] enabled — ${PREFIX}/ proxy mounted (target ${ROOT_ORIGIN})`);
}

// Exposed for the standalone verification harness.
export const __test = { targetFromReq, mapRaw, mapAbs, rewriteHtml, rewriteM3u8, storeSetCookies, cookieHeaderFor, sessionKey, JAR };
