// Music: search / browse / stream via Audius (free, open, full-length streaming,
// no API key). All audio is proxied through Nocturne so the source host never
// reaches the browser. Listening history drives a personalized "For You" mix and
// is saved per-account, alongside liked songs.
import https from "node:https";
import dns from "node:dns/promises";
import net from "node:net";
import { spawn } from "node:child_process";
import { stmts } from "./db.js";

const APP = "Nocturne";

// ── SSRF guard ───────────────────────────────────────────────────────────────
// The audio proxy follows upstream redirects (Audius 302s to a storage node), so
// every hop must be re-checked: a malicious/poisoned upstream could otherwise
// 302 us to http://169.254.169.254/ or an internal host and stream the bytes
// back to the client. Mirrors the link-unfurl defense in chat.js.
function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const p = ip.split(".").map(Number);
        if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
        if (p[0] === 169 && p[1] === 254) return true;            // link-local / cloud metadata
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
        if (p[0] === 192 && p[1] === 168) return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
        if (p[0] >= 224) return true;                              // multicast/reserved
        return false;
    }
    if (net.isIPv6(ip)) {
        const l = ip.toLowerCase().replace(/^\[|\]$/g, "");
        if (l === "::1" || l === "::") return true;
        if (l.startsWith("fe80") || l.startsWith("fc") || l.startsWith("fd")) return true;
        if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
        return false;
    }
    return true;   // unparseable → treat as unsafe
}
async function hostIsPublic(hostname) {
    if (!hostname) return false;
    if (net.isIP(hostname)) return !isPrivateIp(hostname);
    let addrs;
    try { addrs = await dns.lookup(hostname, { all: true }); } catch { return false; }
    return addrs.length > 0 && !addrs.some(a => isPrivateIp(a.address));
}
// api.audius.co routes to a healthy discovery node and serves /v1 directly; we
// also keep a fallback pool and rotate hosts on failure.
const FALLBACK_HOSTS = [
    "https://api.audius.co",
    "https://discoveryprovider.audius.co",
    "https://discoveryprovider2.audius.co",
    "https://discoveryprovider3.audius.co"
];
let hostPool = [...FALLBACK_HOSTS];
let hostIdx = 0;
let lastHostFetch = 0;

// Only trust discovery hosts that are HTTPS and on the audius.co domain — the
// upstream list is otherwise attacker-influenceable and feeds straight into the
// server-side fetch + audio-proxy base URL (an SSRF repoint vector).
function isAudiusHost(u) {
    try { const h = new URL(u); return h.protocol === "https:" && /(^|\.)audius\.co$/i.test(h.hostname); }
    catch { return false; }
}
async function refreshHosts() {
    if (Date.now() - lastHostFetch < 10 * 60_000) return;
    lastHostFetch = Date.now();
    try {
        const r = await fetch("https://api.audius.co", { signal: AbortSignal.timeout(8000) });
        const d = await r.json();
        if (Array.isArray(d?.data)) {
            const safe = d.data.filter(isAudiusHost);
            if (safe.length) { hostPool = safe; hostIdx = 0; }
        }
    } catch {}
}
const host = () => hostPool[hostIdx % hostPool.length] || FALLBACK_HOSTS[0];
const rotateHost = () => { hostIdx++; };

async function audius(pathQ, { retries = 2 } = {}) {
    await refreshHosts();
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        const url = host() + pathQ + (pathQ.includes("?") ? "&" : "?") + "app_name=" + APP;
        try {
            const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
            if (r.ok) return await r.json();
            lastErr = new Error("audius " + r.status);
        } catch (e) { lastErr = e; }
        rotateHost();
    }
    throw lastErr || new Error("audius unreachable");
}

// Genres offered as quick-pick chips (subset of Audius' genre taxonomy).
const GENRE_CHIPS = [
    "Trap", "Hip-Hop/Rap", "Electronic", "Lo-Fi", "House", "Dubstep",
    "Drum & Bass", "Future Bass", "Hyperpop", "R&B/Soul", "Pop", "Rock",
    "Ambient", "Jazz", "Dancehall", "Techno"
];
// Allow-list so a genre param can't be used to smuggle anything upstream.
const ALL_GENRES = new Set([...GENRE_CHIPS,
    "Dance & EDM", "Deep House", "Tech House", "Trance", "Soul", "Funk", "Reggae",
    "Latin", "Classical", "Country", "Folk", "Metal", "Punk", "World",
    "Experimental", "Disco", "Electro", "Alternative", "Soundtrack"]);

const cleanGenre = g => { g = String(g || "").trim(); return ALL_GENRES.has(g) ? g : ""; };
const lim = (req, def) => { const n = parseInt(req.query.limit, 10); return (Number.isInteger(n) && n > 0 && n <= 100) ? n : def; };
const str = (v, max) => (v == null ? null : String(v).slice(0, max));
const int = v => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

function normTrack(t) {
    if (!t || !t.id) return null;
    const a = t.artwork || {};
    return {
        id: String(t.id),
        title: t.title || "Untitled",
        artist: (t.user && (t.user.name || t.user.handle)) || "Unknown artist",
        artwork: a["150x150"] || a["480x480"] || "",
        art: a["480x480"] || a["1000x1000"] || a["150x150"] || "",
        duration: t.duration || 0,
        genre: t.genre || ""
    };
}
const rowTrack = r => {
    const id = String(r.track_id);
    const dz = id.startsWith("dz:"), ytm = id.startsWith("ytm:");
    return { id: r.track_id, title: r.title, artist: r.artist, genre: r.genre, artwork: r.artwork, art: r.artwork, duration: r.duration, source: ytm ? "ytm" : (dz ? "deezer" : "audius"), preview: dz };
};

function markFav(req, tracks) {
    if (!req.user) return tracks;
    let ids = new Set();
    try { ids = new Set(stmts.musicFavIds.all(req.user.id).map(r => r.track_id)); } catch {}
    return tracks.map(t => ({ ...t, liked: ids.has(String(t.id)) }));
}
function interleave(lists) {
    const out = [], seen = new Set();
    let i = 0, any = true;
    while (any) {
        any = false;
        for (const l of lists) {
            if (l[i]) { any = true; const t = l[i]; if (!seen.has(t.id)) { seen.add(t.id); out.push(t); } }
        }
        i++;
    }
    return out;
}
const dedupe = tracks => { const s = new Set(); return tracks.filter(t => s.has(t.id) ? false : (s.add(t.id), true)); };

// Reverse-proxy audio from any source so the CDN host never reaches the browser.
// Follows redirects (e.g. the Audius 302 to a storage node) and forwards Range
// headers so seeking works.
function pipeAudio(req, res, startUrl) {
    let redirects = 0;
    async function go(urlStr) {
        let u;
        try { u = new URL(urlStr); } catch { try { res.statusCode = 502; res.end(); } catch {} return; }
        // Re-validate EVERY hop: https only, and the resolved host must be public.
        if (u.protocol !== "https:" && u.protocol !== "http:") { try { res.statusCode = 502; res.end(); } catch {} return; }
        if (!(await hostIsPublic(u.hostname))) { try { if (!res.headersSent) res.statusCode = 502; res.end(); } catch {} return; }
        const headers = { "User-Agent": "Nocturne" };
        if (req.headers.range) headers.range = req.headers.range;
        const r = https.get({ hostname: u.hostname, port: 443, path: u.pathname + u.search, headers, timeout: 20000 }, (pres) => {
            if ([301, 302, 303, 307, 308].includes(pres.statusCode) && pres.headers.location && redirects < 5) {
                redirects++; pres.resume();
                return go(new URL(pres.headers.location, u).toString());
            }
            const out = {};
            for (const h of ["content-type", "content-length", "content-range", "accept-ranges", "cache-control"]) {
                if (pres.headers[h]) out[h] = pres.headers[h];
            }
            out["content-type"] = out["content-type"] || "audio/mpeg";
            out["accept-ranges"] = out["accept-ranges"] || "bytes";
            try { res.writeHead(pres.statusCode || 200, out); } catch {}
            pres.pipe(res);
        });
        r.on("timeout", () => { try { r.destroy(); } catch {} });
        r.on("error", () => { try { if (!res.headersSent) res.statusCode = 502; res.end(); } catch {} });
        res.on("close", () => { try { r.destroy(); } catch {} });
    }
    go(startUrl);
}

// ── Deezer: mainstream catalog, no key, but only 30-second previews ──────────
async function deezer(pathQ) {
    const r = await fetch("https://api.deezer.com" + pathQ, { signal: AbortSignal.timeout(12000), headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error("deezer " + r.status);
    return await r.json();
}
function normDeezer(t) {
    if (!t || !t.id) return null;
    const al = t.album || {};
    return {
        id: "dz:" + t.id,
        title: t.title || t.title_short || "Untitled",
        artist: (t.artist && t.artist.name) || "Unknown artist",
        artwork: al.cover_medium || al.cover || "",
        art: al.cover_big || al.cover_xl || al.cover_medium || al.cover || "",
        duration: t.duration || 0,
        genre: "",
        source: "deezer",
        preview: true
    };
}
async function streamDeezer(req, res, id) {
    let preview;
    try {
        const d = await deezer("/track/" + encodeURIComponent(id));
        preview = d && d.preview;
    } catch {}
    if (!preview) { try { res.statusCode = 404; res.end(); } catch {} return; }
    pipeAudio(req, res, preview);
}

// ── YouTube Music: InnerTube search + yt-dlp audio ───────────────────────────
// Search hits YT Music's internal InnerTube API (no key). Playback is produced
// by yt-dlp searching YT Music for "<title> <artist>" and piping bestaudio to
// the client — yt-dlp must be installed and on PATH for audio to work.
//
// That's an OS-level dependency the app can't install for itself, so it fails
// silently (spawn ENOENT) unless we check for it. Probe once at boot and log
// clearly — this is the single most common reason "YT Music playback" reports
// as broken while search still works fine (search doesn't need yt-dlp).
let ytdlpAvailable = null;
(function checkYtDlp() {
    const proc = spawn("yt-dlp", ["--version"]);
    proc.on("error", () => {
        ytdlpAvailable = false;
        console.warn("[music] yt-dlp not found on PATH — YouTube Music playback (/api/sp/audio) will return 502 for every track. Install yt-dlp (https://github.com/yt-dlp/yt-dlp) and restart to fix. Search is unaffected.");
    });
    proc.on("exit", code => { if (code === 0) ytdlpAvailable = true; });
})();
const YTM_HEADERS = {
    "Content-Type": "application/json",
    "X-Origin": "https://music.youtube.com",
    Origin: "https://music.youtube.com",
    Referer: "https://music.youtube.com/",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
};
// Fixed InnerTube filter param — restricts results to Songs only. Do not change.
const YTM_SONGS_PARAMS = "EgWKAQIIAWoKEAkQBRALEAoQBA==";

async function ytmSearch(q) {
    const r = await fetch("https://music.youtube.com/youtubei/v1/search?prettyPrint=false", {
        method: "POST",
        headers: YTM_HEADERS,
        body: JSON.stringify({
            context: { client: { clientName: "WEB_REMIX", clientVersion: "1.20231101.01.00", hl: "en", gl: "US" } },
            query: q,
            params: YTM_SONGS_PARAMS
        }),
        signal: AbortSignal.timeout(12000)
    });
    if (!r.ok) throw new Error("ytm " + r.status);
    return await r.json();
}

// Recursively collect every musicResponsiveListItemRenderer node in the tree.
function collectYtmRenderers(node, out) {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) { for (const x of node) collectYtmRenderers(x, out); return; }
    if (node.musicResponsiveListItemRenderer) out.push(node.musicResponsiveListItemRenderer);
    for (const k in node) {
        if (k === "musicResponsiveListItemRenderer") continue;
        collectYtmRenderers(node[k], out);
    }
}

function ytmThumb(r, videoId) {
    const arr = r?.thumbnail?.musicThumbnailRenderer?.thumbnail?.thumbnails;
    let url = Array.isArray(arr) && arr.length ? arr[arr.length - 1].url : "";
    if (!url) return "https://i.ytimg.com/vi/" + videoId + "/mqdefault.jpg";
    // Google-hosted art takes a size suffix; strip any existing one first so we
    // never emit a double "=w..." (which 404s), then request a 226² cover.
    if (/googleusercontent|ggpht|lh3\./i.test(url)) url = url.replace(/=w\d+-h\d+[^=]*$/i, "") + "=w226-h226-l90";
    return url;
}

// Pull { src, id, title, artist, album, duration, thumb } out of one renderer.
function parseYtmItem(r) {
    const runs0 = r?.flexColumns?.[0]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs;
    const run0 = runs0 && runs0[0];
    const title = run0?.text;
    const videoId = run0?.navigationEndpoint?.watchEndpoint?.videoId
        || r?.overlay?.musicItemThumbnailOverlayRenderer?.content?.musicPlayButtonRenderer?.playNavigationEndpoint?.watchEndpoint?.videoId
        || null;
    if (!title || !videoId) return null;

    // Second flex column holds "artist • album • year • duration" style runs;
    // drop the " • " separators, pull duration + 4-digit year out, then the
    // first two survivors are artist and album.
    const meta = (r?.flexColumns?.[1]?.musicResponsiveListItemFlexColumnRenderer?.text?.runs || [])
        .map(x => x && x.text).filter(t => t && t !== " • ");
    let duration = 0;
    const rest = [];
    for (const m of meta) {
        if (/^\d+:\d{2}$/.test(m)) { const p = m.split(":").map(Number); duration = p.reduce((a, b) => a * 60 + b, 0); }
        else if (/^\d{4}$/.test(m)) { /* year — drop */ }
        else rest.push(m);
    }
    return {
        src: "ytm", id: videoId, title,
        artist: rest[0] || "", album: rest[1] || "",
        duration, thumb: ytmThumb(r, videoId)
    };
}

// Per-IP throttle for the unauthenticated streaming proxy: cap new-request rate
// and concurrent open streams so it can't be turned into a bandwidth/FD-exhaustion
// relay. Generous enough for normal listening (play + seek reconnects).
const STREAM_RPM = Number(process.env.NOCTURNE_MUSIC_STREAM_RPM) || 120;
const STREAM_MAX_CONCURRENT = Number(process.env.NOCTURNE_MUSIC_STREAM_CONCURRENT) || 8;
const _streamBuckets = new Map();   // ip -> { start, count, live }
function streamClientIp(req) { return req.ip || req.socket?.remoteAddress || ""; }
function streamAdmit(ip) {
    const now = Date.now();
    let b = _streamBuckets.get(ip);
    if (!b) { b = { start: now, count: 0, live: 0 }; _streamBuckets.set(ip, b); }
    if (now - b.start > 60_000) { b.start = now; b.count = 0; }
    if (b.count >= STREAM_RPM || b.live >= STREAM_MAX_CONCURRENT) return null;
    b.count++; b.live++;
    return b;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of _streamBuckets) if (b.live <= 0 && now - b.start > 120_000) _streamBuckets.delete(k); }, 120_000).unref();

export function mountMusic(app, { authMiddleware } = {}) {
    const auth = authMiddleware || ((req, res, next) => next());

    app.get("/api/music/genres", (req, res) => {
        res.setHeader("Cache-Control", "public, max-age=3600");
        res.json({ genres: GENRE_CHIPS });
    });

    // Lightweight, reliable auth check — independent of any upstream music API, so
    // the "sign in" hint never shows wrongly when a catalog provider is slow/down.
    app.get("/api/music/me", auth, (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        res.json({ authenticated: !!req.user, username: req.user?.username || null });
    });

    app.get("/api/music/search", auth, async (req, res) => {
        const q = String(req.query.q || "").trim().slice(0, 120);
        if (!q) return res.json({ tracks: [] });
        const src = req.query.source === "deezer" ? "deezer" : "audius";
        try {
            if (src === "deezer") {
                const d = await deezer("/search?q=" + encodeURIComponent(q) + "&limit=" + lim(req, 40));
                return res.json({ authenticated: !!req.user, source: "deezer", tracks: markFav(req, (d.data || []).map(normDeezer).filter(Boolean)) });
            }
            const d = await audius("/v1/tracks/search?query=" + encodeURIComponent(q) + "&limit=" + lim(req, 30));
            res.json({ authenticated: !!req.user, source: "audius", tracks: markFav(req, (d.data || []).map(normTrack).filter(Boolean)) });
        } catch { res.status(502).json({ error: "Search is unavailable right now." }); }
    });

    app.get("/api/music/trending", auth, async (req, res) => {
        const src = req.query.source === "deezer" ? "deezer" : "audius";
        try {
            if (src === "deezer") {
                const d = await deezer("/chart/0/tracks?limit=" + lim(req, 50));
                return res.json({ authenticated: !!req.user, source: "deezer", genre: null, tracks: markFav(req, (d.data || []).map(normDeezer).filter(Boolean)) });
            }
            const genre = cleanGenre(req.query.genre);
            const d = await audius("/v1/tracks/trending?limit=" + lim(req, 40) + (genre ? "&genre=" + encodeURIComponent(genre) : ""));
            res.json({ authenticated: !!req.user, source: "audius", genre: genre || null, tracks: markFav(req, (d.data || []).map(normTrack).filter(Boolean)) });
        } catch { res.status(502).json({ error: "Couldn't load tracks." }); }
    });

    // Personalized: weight by the genres this user plays most (last 60 days).
    app.get("/api/music/recommend", auth, async (req, res) => {
        let genres = [];
        if (req.user) {
            try { genres = stmts.musicTopGenres.all(req.user.id, Date.now() - 60 * 24 * 3600 * 1000, 4).map(r => r.genre).filter(Boolean); } catch {}
        }
        try {
            let tracks = [];
            if (genres.length) {
                const perGenre = await Promise.all(genres.slice(0, 3).map(g =>
                    audius("/v1/tracks/trending?limit=12&genre=" + encodeURIComponent(g))
                        .then(d => (d.data || []).map(normTrack).filter(Boolean)).catch(() => [])));
                tracks = interleave(perGenre);
            }
            if (tracks.length < 12) {
                const d = await audius("/v1/tracks/trending?limit=30");
                tracks = dedupe([...tracks, ...(d.data || []).map(normTrack).filter(Boolean)]);
            }
            res.json({ authenticated: !!req.user, basedOn: genres, tracks: markFav(req, tracks.slice(0, 40)) });
        } catch { res.status(502).json({ error: "Couldn't build your mix." }); }
    });

    app.get("/api/music/stream/:id", (req, res) => {
        const bucket = streamAdmit(streamClientIp(req));
        if (!bucket) { res.setHeader("Retry-After", "10"); return res.status(429).json({ error: "Too many stream requests — slow down." }); }
        let released = false;
        const release = () => { if (!released) { released = true; bucket.live = Math.max(0, bucket.live - 1); } };
        res.on("close", release); res.on("finish", release);
        const id = String(req.params.id).slice(0, 60);
        if (id.startsWith("dz:")) return streamDeezer(req, res, id.slice(3));
        pipeAudio(req, res, host() + "/v1/tracks/" + encodeURIComponent(id) + "/stream?app_name=" + APP);
    });

    // YouTube Music search — Server-Sent Events. One `data:` line per song, then
    // `data: [DONE]`. Songs-only via the fixed InnerTube filter param.
    app.get("/api/music/ytm/search", auth, async (req, res) => {
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        try { res.flushHeaders?.(); } catch {}
        const send = obj => { try { res.write("data: " + JSON.stringify(obj) + "\n\n"); } catch {} };
        const done = () => { try { res.write("data: [DONE]\n\n"); } catch {} try { res.end(); } catch {} };
        const q = String(req.query.q || "").trim().slice(0, 120);
        if (!q) return done();
        let closed = false;
        res.on("close", () => { closed = true; });
        try {
            const data = await ytmSearch(q);
            const renderers = [];
            collectYtmRenderers(data, renderers);
            const limit = lim(req, 20);
            let n = 0;
            for (const r of renderers) {
                if (closed) break;
                const item = parseYtmItem(r);
                if (!item) continue;
                send(item);
                if (++n >= limit) break;
            }
        } catch { /* end the stream with whatever we got */ }
        done();
    });

    // Audio for a YT Music track: yt-dlp searches YT Music for "<title> <artist>"
    // and pipes bestaudio straight to the client. Requires yt-dlp on PATH. The
    // stream isn't seekable (Accept-Ranges: none) and the yt-dlp process is
    // killed as soon as the client disconnects. Per-IP throttle guards the spawn.
    app.get("/api/sp/audio/:id", (req, res) => {
        const bucket = streamAdmit(streamClientIp(req));
        if (!bucket) { res.setHeader("Retry-After", "10"); return res.status(429).json({ error: "Too many stream requests — slow down." }); }
        let released = false;
        const release = () => { if (!released) { released = true; bucket.live = Math.max(0, bucket.live - 1); } };
        res.on("close", release); res.on("finish", release);

        const title = String(req.query.t || "").slice(0, 200);
        const artist = String(req.query.a || "").slice(0, 200);
        const q = [title, artist].filter(Boolean).join(" ");
        if (!q) { try { res.status(400).end(); } catch {} return; }

        if (ytdlpAvailable === false) {
            release();
            return res.status(502).json({ error: "YouTube Music playback isn't configured on this server (yt-dlp missing)." });
        }

        const proc = spawn("yt-dlp", [
            "-f", "bestaudio[ext=m4a]/bestaudio[ext=webm]/bestaudio/best",
            "-o", "-",
            "--no-warnings", "--quiet",
            "--playlist-end", "1",
            "https://music.youtube.com/search?q=" + encodeURIComponent(q)
        ]);
        res.setHeader("Content-Type", "audio/mpeg");
        res.setHeader("Accept-Ranges", "none");
        let wroteBytes = false;
        proc.stdout.once("data", () => { wroteBytes = true; });
        proc.stdout.pipe(res);
        let stderrTail = "";
        proc.stderr.on("data", d => { stderrTail = (stderrTail + d).slice(-2000); });
        proc.on("error", e => {
            ytdlpAvailable = e.code !== "ENOENT" ? ytdlpAvailable : false;
            console.warn("[music] yt-dlp spawn failed:", e.code || e.message);
            if (!res.headersSent) { try { res.status(502).end(); } catch {} } else { try { res.end(); } catch {} }
        });
        proc.on("exit", (code, signal) => {
            if (!wroteBytes && code !== 0 && signal !== "SIGKILL") {
                console.warn(`[music] yt-dlp exited ${code} for "${q}" with no audio written: ${stderrTail.trim().slice(-300) || "(no stderr)"}`);
            }
        });
        res.on("close", () => { try { proc.kill("SIGKILL"); } catch {} });
    });

    app.get("/api/music/history", auth, (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        if (!req.user) return res.json({ tracks: [] });
        try { res.json({ tracks: markFav(req, stmts.musicHistoryRecent.all(req.user.id, lim(req, 60)).map(rowTrack)) }); }
        catch { res.json({ tracks: [] }); }
    });

    app.post("/api/music/history", auth, (req, res) => {
        if (!req.user) return res.json({ ok: false });
        const t = req.body || {};
        if (!t.id) return res.status(400).json({ error: "bad track" });
        try {
            stmts.musicHistoryAdd.run(req.user.id, String(t.id).slice(0, 40), str(t.title, 200), str(t.artist, 200), str(t.genre, 60), str(t.artwork, 400), int(t.duration), Date.now());
            stmts.musicHistoryPrune.run(req.user.id, req.user.id, 800);
        } catch {}
        res.json({ ok: true });
    });

    app.delete("/api/music/history", auth, (req, res) => {
        if (req.user) { try { stmts.musicHistoryClear.run(req.user.id); } catch {} }
        res.json({ ok: true });
    });

    app.get("/api/music/favorites", auth, (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        if (!req.user) return res.json({ tracks: [] });
        try { res.json({ tracks: stmts.musicFavList.all(req.user.id, 300).map(rowTrack).map(t => ({ ...t, liked: true })) }); }
        catch { res.json({ tracks: [] }); }
    });

    app.post("/api/music/favorites", auth, (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Sign in to save songs." });
        const t = req.body || {};
        if (!t.id) return res.status(400).json({ error: "bad track" });
        try { stmts.musicFavAdd.run(req.user.id, String(t.id).slice(0, 40), str(t.title, 200), str(t.artist, 200), str(t.genre, 60), str(t.artwork, 400), int(t.duration), Date.now()); } catch {}
        res.json({ ok: true });
    });

    app.delete("/api/music/favorites/:id", auth, (req, res) => {
        if (req.user) { try { stmts.musicFavDelete.run(req.user.id, String(req.params.id).slice(0, 40)); } catch {} }
        res.json({ ok: true });
    });
}
