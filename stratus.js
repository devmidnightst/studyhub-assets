// Stratus cloud gaming proxy — keeps the API key server-side.
// Set NOCTURNE_STRATUS_BASE and NOCTURNE_STRATUS_KEY (or put them in
// data/stratus-base and data/stratus-key). If neither is configured the
// routes still mount but return { enabled: false }.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { WebSocket, WebSocketServer } from "ws";
import { isOwnerName } from "./auth.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function readFile(name) {
    const dir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
    try { return fs.readFileSync(path.join(dir, name), "utf8").split(/[\r\n]+/).map(s => s.trim()).find(s => s && !s.startsWith("#")) || ""; }
    catch { return ""; }
}

function loadConfig() {
    const base = (process.env.NOCTURNE_STRATUS_BASE || readFile("stratus-base")).replace(/\/+$/, "");
    const key  = process.env.NOCTURNE_STRATUS_KEY  || readFile("stratus-key");
    return { base, key, enabled: !!(base && key) };
}

let _cfg = null;
function cfg() { if (!_cfg) _cfg = loadConfig(); return _cfg; }

// cloud.json game list — fetched once and cached in memory for 5 minutes.
let _gamesCache = null, _gamesCachedAt = 0;
const GAMES_TTL = 5 * 60 * 1000;
const CLOUD_JSON = "https://cdn.jsdelivr.net/gh/x8rr/stratus-api@main/cloud.json";

async function fetchGames() {
    if (_gamesCache && Date.now() - _gamesCachedAt < GAMES_TTL) return _gamesCache;
    const r = await fetch(CLOUD_JSON, { signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`cloud.json fetch failed: HTTP ${r.status}`);
    const data = await r.json();
    _gamesCache = Array.isArray(data) ? data : Object.values(data).flat().filter(g => g && g.game_key);
    _gamesCachedAt = Date.now();
    return _gamesCache;
}

// Simple per-IP rate limiter: max 6 session-creates per 10 minutes.
const _sessionBuckets = new Map();
setInterval(() => {
    const cut = Date.now() - 600_000;
    for (const [k, v] of _sessionBuckets) if (v.start < cut) _sessionBuckets.delete(k);
}, 120_000).unref();
function sessionRateOk(ip) {
    const now = Date.now();
    let b = _sessionBuckets.get(ip);
    if (!b || now - b.start > 600_000) { b = { start: now, count: 0 }; _sessionBuckets.set(ip, b); }
    if (b.count >= 6) return false;
    b.count++;
    return true;
}

function authHeaders() {
    return { "x-api-key": cfg().key, "Content-Type": "application/json" };
}

function requireOwner(req, res, next) {
    if (!req.user || !isOwnerName(req.user.username)) return res.status(403).json({ error: "Forbidden — owner only." });
    next();
}

export function mountStratus(app, { authMiddleware = (req, res, next) => next() } = {}) {
    // Whether stratus is configured — frontend reads this before showing the tab.
    app.get("/api/stratus/status", (req, res) => {
        res.json({ enabled: cfg().enabled });
    });

    // Cloud game list.
    app.get("/api/stratus/games", async (req, res) => {
        if (!cfg().enabled) return res.json([]);
        try {
            const games = await fetchGames();
            res.json(games);
        } catch (e) {
            console.error("[stratus] games fetch error:", e.message);
            res.status(502).json({ error: "Failed to load game list" });
        }
    });

    // Create a session — proxies the NDJSON stream from Stratus so the client
    // can watch queue progress without needing the API key or base URL.
    app.post("/api/stratus/session", async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "Cloud gaming not configured" });
        const ip = req.ip || req.socket?.remoteAddress || "";
        if (!sessionRateOk(ip)) return res.status(429).json({ error: "Too many sessions — try again in a few minutes." });

        const game_key = String(req.body?.game_key || "").trim();
        if (!game_key) return res.status(400).json({ error: "game_key required" });
        if (!/^[a-zA-Z]{2}\d{4}$/.test(game_key)) return res.status(400).json({ error: "invalid game_key" });

        try {
            // No AbortSignal here — stratus-api is localhost and controls its own timeouts.
            // A blanket fetch timeout would cut the NDJSON body mid-stream if account
            // creation takes longer than expected (pool miss + slow mail.tm polling).
            const upstream = await fetch(`${cfg().base}/cloud/v1/createSession`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ game_key })
            });
            if (!upstream.ok) {
                const t = await upstream.text().catch(() => "");
                return res.status(upstream.status).json({ error: t.slice(0, 200) || "Upstream error" });
            }
            res.setHeader("Content-Type", "application/x-ndjson");
            res.setHeader("Cache-Control", "no-store");
            res.setHeader("X-Accel-Buffering", "no");
            res.flushHeaders && res.flushHeaders();
            upstream.body.pipeTo(new WritableStream({
                write(chunk) { res.write(chunk); },
                close() { res.end(); },
                abort(e) { console.error("[stratus] session stream aborted:", e.message); res.end(); }
            }));
        } catch (e) {
            if (!res.headersSent) res.status(502).json({ error: e.message || "Session error" });
        }
    });

    // Start a queued session — returns ice_servers + signaling_ws.
    // The signaling_ws from Stratus points to localhost:3001 which the browser
    // can't reach, so we rewrite it to go through Nocturne's own WS proxy.
    app.post("/api/stratus/start", async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "Cloud gaming not configured" });
        const uuid = String(req.body?.uuid || "").trim();
        if (!uuid) return res.status(400).json({ error: "uuid required" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/startGame`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ uuid }),
                signal: AbortSignal.timeout(30_000)
            });
            const data = await upstream.json();
            if (!upstream.ok) return res.status(upstream.status).json(data);

            // Rewrite signaling_ws to go through Nocturne so the browser can reach it.
            const uuidMatch = (data.signaling_ws || "").match(/\/signal\/([0-9a-f-]{36})/i);
            if (uuidMatch) {
                const isHttps = req.secure || req.headers["x-forwarded-proto"] === "https";
                data.signaling_ws = `${isHttps ? "wss" : "ws"}://${req.headers.host}/api/stratus/signal/${uuidMatch[1]}`;
            }

            res.json(data);
        } catch (e) {
            res.status(502).json({ error: e.message || "Start error" });
        }
    });

    // Poll queue status for a queued session.
    app.get("/api/stratus/queue", async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        const uuid = String(req.query.uuid || "").trim();
        if (!uuid) return res.status(400).json({ error: "uuid required" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/getQueue?uuid=${encodeURIComponent(uuid)}`, {
                headers: { "x-api-key": cfg().key },
                signal: AbortSignal.timeout(30_000)
            });
            const data = await upstream.json();
            res.status(upstream.status).json(data);
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    // Keepalive ping.
    app.post("/api/stratus/ping", async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        const uuid = String(req.body?.uuid || "").trim();
        if (!uuid) return res.status(400).json({ error: "uuid required" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/pingSession`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ uuid }),
                signal: AbortSignal.timeout(10_000)
            });
            const data = await upstream.json();
            res.status(upstream.status).json(data);
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    // Quit a session.
    app.post("/api/stratus/quit", async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        const uuid = String(req.body?.uuid || "").trim();
        if (!uuid) return res.status(400).json({ error: "uuid required" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/quitSession`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify({ uuid }),
                signal: AbortSignal.timeout(10_000)
            });
            res.status(upstream.status).end();
        } catch {
            res.status(204).end();
        }
    });

    // Admin: proxy status (owner only)
    app.get("/api/stratus/admin/proxy", authMiddleware, requireOwner, async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/admin/proxy`, {
                headers: { "x-api-key": cfg().key }, signal: AbortSignal.timeout(10_000)
            });
            res.json(await upstream.json());
        } catch (e) { res.status(502).json({ error: e.message }); }
    });

    // Admin: force proxy refresh (owner only)
    app.post("/api/stratus/admin/proxy/refresh", authMiddleware, requireOwner, async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/admin/proxy/refresh`, {
                method: "POST", headers: authHeaders(), signal: AbortSignal.timeout(10_000)
            });
            res.json(await upstream.json());
        } catch (e) { res.status(502).json({ error: e.message }); }
    });

    // Admin: get config (owner only)
    app.get("/api/stratus/admin/config", authMiddleware, requireOwner, async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/admin/config`, {
                headers: { "x-api-key": cfg().key },
                signal: AbortSignal.timeout(10_000)
            });
            const data = await upstream.json();
            res.json(data);
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    // Admin: update config (owner only)
    app.post("/api/stratus/admin/config", authMiddleware, requireOwner, async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/admin/config`, {
                method: "POST",
                headers: authHeaders(),
                body: JSON.stringify(req.body || {}),
                signal: AbortSignal.timeout(10_000)
            });
            const data = await upstream.json();
            res.status(upstream.status).json(data);
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    // Admin: clear pool (owner only)
    app.post("/api/stratus/admin/pool/clear", authMiddleware, requireOwner, async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/admin/pool/clear`, {
                method: "POST",
                headers: authHeaders(),
                signal: AbortSignal.timeout(10_000)
            });
            const data = await upstream.json();
            res.status(upstream.status).json(data);
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    // Admin: list pool accounts (owner only)
    app.get("/api/stratus/admin/pool/accounts", authMiddleware, requireOwner, async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/admin/pool/accounts`, {
                headers: { "x-api-key": cfg().key },
                signal: AbortSignal.timeout(10_000)
            });
            const data = await upstream.json();
            res.json(data);
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    // Admin: pool stats (owner only)
    app.get("/api/stratus/admin/pool", authMiddleware, requireOwner, async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/admin/pool`, {
                headers: { "x-api-key": cfg().key },
                signal: AbortSignal.timeout(10_000)
            });
            const data = await upstream.json();
            res.json(data);
        } catch (e) {
            res.status(502).json({ error: e.message });
        }
    });

    // Helper: pipe an NDJSON upstream response to the browser with proper streaming headers.
    function pipeNdjson(upstream, res) {
        res.setHeader("Content-Type", "application/x-ndjson");
        res.setHeader("Transfer-Encoding", "chunked");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
        upstream.body.pipeTo(new WritableStream({
            write(chunk) {
                res.write(chunk);
                // Flush immediately so the browser sees each line as it arrives.
                if (typeof res.flush === "function") res.flush();
            },
            close() { res.end(); },
            abort() { res.end(); }
        }));
    }

    // Admin: add one or more accounts to pool — streams NDJSON (owner only)
    app.post("/api/stratus/admin/pool/add", authMiddleware, requireOwner, async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        try {
            const count = parseInt(req.body?.count ?? 1, 10);
            const upstream = await fetch(`${cfg().base}/cloud/v1/admin/pool/add`, {
                method: "POST",
                headers: { ...authHeaders(), "Content-Type": "application/json" },
                body: JSON.stringify({ count: Math.max(1, Math.min(50, isNaN(count) ? 1 : count)) }),
            });
            if (!upstream.ok) {
                const t = await upstream.text().catch(() => "");
                return res.status(upstream.status).json({ error: t.slice(0, 200) || "Upstream error" });
            }
            pipeNdjson(upstream, res);
        } catch (e) {
            if (!res.headersSent) res.status(502).json({ error: e.message || "Error" });
        }
    });

    // Admin: fill pool to target — streams NDJSON (owner only)
    app.post("/api/stratus/admin/pool/fill", authMiddleware, requireOwner, async (req, res) => {
        if (!cfg().enabled) return res.status(503).json({ error: "not configured" });
        try {
            const upstream = await fetch(`${cfg().base}/cloud/v1/admin/pool/fill`, {
                method: "POST", headers: authHeaders()
            });
            if (!upstream.ok) {
                const t = await upstream.text().catch(() => "");
                return res.status(upstream.status).json({ error: t.slice(0, 200) || "Upstream error" });
            }
            pipeNdjson(upstream, res);
        } catch (e) {
            if (!res.headersSent) res.status(502).json({ error: e.message || "Error" });
        }
    });
}

// WebSocket proxy: /api/stratus/signal/{uuid} → ws://localhost:3001/cloud/v1/signal/{uuid}
// Call this from server.on('upgrade'). Returns true if it handled the request.
const SIGNAL_RE = /^\/api\/stratus\/signal\/([0-9a-f-]{36})$/i;
const _wss = new WebSocketServer({ noServer: true });

export function stratusSignalUpgrade(req, socket, head) {
    const m = SIGNAL_RE.exec(req.url);
    if (!m) return false;

    const uuid = m[1];
    const { base } = cfg();
    const upstreamUrl = `${base.replace(/^http/, "ws")}/cloud/v1/signal/${uuid}`;

    _wss.handleUpgrade(req, socket, head, (client) => {
        const upstream = new WebSocket(upstreamUrl, { handshakeTimeout: 15_000 });

        upstream.on("open", () => {
            client.on("message", (data, isBinary) => {
                if (upstream.readyState === WebSocket.OPEN) upstream.send(data, { binary: isBinary });
            });
            upstream.on("message", (data, isBinary) => {
                if (client.readyState === WebSocket.OPEN) client.send(data, { binary: isBinary });
            });
        });

        const cleanup = (label, err) => {
            if (err) console.error(`[stratus] signal WS ${label}:`, err.message);
            upstream.readyState < WebSocket.CLOSING && upstream.terminate();
            client.readyState < WebSocket.CLOSING && client.terminate();
        };

        upstream.on("error", e => cleanup("upstream error", e));
        upstream.on("close", () => cleanup("upstream closed"));
        client.on("error", e => cleanup("client error", e));
        client.on("close", () => cleanup("client closed"));
    });

    return true;
}
