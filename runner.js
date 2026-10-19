// Backend code execution — runs user apps (Node/Python servers) inside a hardened
// Docker container and routes live HTTP/WS traffic back through Nocturne.
//
// Model (per the operator's choice):
//   • Default: ONE shared, persistent container ("nocturne-shared", 2c/4GB) that
//     every user shares. Each user gets an isolated workspace dir + a unique app
//     port + an unguessable routing token.
//   • Provisioned users (admin) get their OWN container ("nocturne-u<id>") with
//     custom cpu/memory/pids limits.
//
// Safety: containers run as non-root (uid 1001 'coder'), --cap-drop=ALL,
// no-new-privileges, hard cpu/mem/pids caps, NO host bind mounts, NO docker
// socket, and ports are NEVER published to the host's public interface — the
// Nocturne process reaches apps over the docker bridge IP only. The whole module
// is gated behind NOCTURNE_RUNNER and has no side effects until mountRunner runs.
import { execFile, spawn } from "node:child_process";
import net from "node:net";
import crypto from "node:crypto";
import { db } from "./db.js";
import { requireAuth, isOwnerName } from "./auth.js";

// User apps run arbitrary code, so they are only ever served from their own
// hostname (NOCTURNE_RUNNER_HOST, e.g. a separate apex domain). On the main
// origin an app could read the visitor's session from localStorage or open
// the owner terminal socket. Without a dedicated host the runner stays off.
const RUNNER_FLAG = process.env.NOCTURNE_RUNNER === "1";
const RUNNER_HOST = String(process.env.NOCTURNE_RUNNER_HOST || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
const ENABLED = RUNNER_FLAG && !!RUNNER_HOST;
// Limited-testing gate: when set, only the owner account may start backend apps.
const OWNER_ONLY = process.env.NOCTURNE_RUNNER_OWNER_ONLY === "1";
// In-memory set of users with a running app — for idle-reaping + the kill-switch.
const running = new Map();   // userId -> { container, dir, at }
const IDLE_MS = Number(process.env.NOCTURNE_RUNNER_IDLE_MS) || 30 * 60 * 1000;
// Soft cap on the SHARED container's /workspaces, app-enforced. (A kernel-level
// hard cap isn't possible in here: ext4 backing → no --storage-opt size, and no
// loop devices → no image-backed volume. Both need a Proxmox host change.)
const WORKSPACES_CAP_MB = Number(process.env.NOCTURNE_WORKSPACES_CAP_MB) || 50 * 1024;
let _wsUsage = { mb: 0, at: 0 };
export function runnerEnabled() { return ENABLED; }

const DOCKER       = process.env.NOCTURNE_DOCKER_BIN || "docker";
const IMAGE        = process.env.NOCTURNE_RUNNER_IMAGE || "nocturne-runner:latest";
const SHARED_NAME  = "nocturne-shared";
const CODER_UID    = "1001";
const WS_ROOT      = "/workspaces";
const DEBUG        = process.env.NOCTURNE_RUNNER_DEBUG === "1";
function log(...a) { if (DEBUG) console.log("[runner]", ...a); }

// Default tier handed to every user without an explicit spec row.
const DEFAULTS = Object.freeze({
    cpus: 2, memoryMb: 4096, pidsLimit: 512, diskMb: 1024, dedicated: 0, enabled: 1
});

// App ports are allocated from this private pool. Each workspace gets one; the
// container binds the app on 0.0.0.0:<port> and we proxy to <containerIP>:<port>.
const PORT_BASE = 20000;
const PORT_SPAN = 400;            // up to 400 concurrent apps

// ── Schema (self-contained; uses the shared db handle, never edits db.js) ──────
db.exec(`
    CREATE TABLE IF NOT EXISTS runner_specs (
        user_id     INTEGER PRIMARY KEY,
        cpus        REAL,
        memory_mb   INTEGER,
        pids_limit  INTEGER,
        disk_mb     INTEGER,
        dedicated   INTEGER NOT NULL DEFAULT 0,
        enabled     INTEGER NOT NULL DEFAULT 1,
        updated_at  INTEGER NOT NULL,
        updated_by  TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE TABLE IF NOT EXISTS runner_workspaces (
        user_id     INTEGER PRIMARY KEY,
        container   TEXT NOT NULL,
        dir         TEXT NOT NULL,
        port        INTEGER NOT NULL,
        token       TEXT UNIQUE NOT NULL,
        created_at  INTEGER NOT NULL,
        last_active INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_runner_ws_token ON runner_workspaces(token);
`);

const q = {
    specGet:   db.prepare("SELECT * FROM runner_specs WHERE user_id = ?"),
    specUpsert: db.prepare(`INSERT INTO runner_specs (user_id, cpus, memory_mb, pids_limit, disk_mb, dedicated, enabled, updated_at, updated_by)
        VALUES (@user_id, @cpus, @memory_mb, @pids_limit, @disk_mb, @dedicated, @enabled, @updated_at, @updated_by)
        ON CONFLICT(user_id) DO UPDATE SET cpus=@cpus, memory_mb=@memory_mb, pids_limit=@pids_limit, disk_mb=@disk_mb,
            dedicated=@dedicated, enabled=@enabled, updated_at=@updated_at, updated_by=@updated_by`),
    specDelete: db.prepare("DELETE FROM runner_specs WHERE user_id = ?"),
    wsGet:     db.prepare("SELECT * FROM runner_workspaces WHERE user_id = ?"),
    wsByToken: db.prepare("SELECT * FROM runner_workspaces WHERE token = ?"),
    wsPorts:   db.prepare("SELECT port FROM runner_workspaces"),
    wsInsert:  db.prepare(`INSERT INTO runner_workspaces (user_id, container, dir, port, token, created_at, last_active)
        VALUES (?, ?, ?, ?, ?, ?, ?)`),
    wsTouch:   db.prepare("UPDATE runner_workspaces SET last_active = ? WHERE user_id = ?"),
};

// ── Docker low-level (pure; no db) ─────────────────────────────────────────────
function dexec(args, { input, timeout = 60000 } = {}) {
    return new Promise((resolve) => {
        const child = execFile(DOCKER, args, { timeout, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
            resolve({ code: err ? (err.code ?? 1) : 0, stdout: stdout || "", stderr: stderr || "", err });
        });
        if (input != null) { try { child.stdin.end(input); } catch {} }
    });
}

async function containerExists(name) {
    const r = await dexec(["inspect", "-f", "{{.State.Running}}", name], { timeout: 8000 });
    if (r.code !== 0) return { exists: false, running: false };
    return { exists: true, running: r.stdout.trim() === "true" };
}

const _ipCache = new Map();       // name -> { ip, at }
async function containerIp(name) {
    const c = _ipCache.get(name);
    if (c && Date.now() - c.at < 15000) return c.ip;
    const r = await dexec(["inspect", "-f", "{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}", name], { timeout: 8000 });
    const ip = r.code === 0 ? r.stdout.trim() : "";
    if (ip) _ipCache.set(name, { ip, at: Date.now() });
    return ip;
}

// Launch a container with the standard hardening. limits = {cpus, memoryMb, pidsLimit}.
async function runContainer(name, limits, volume) {
    const args = [
        "run", "-d", "--name", name, "--restart", "unless-stopped",
        "--cpus", String(limits.cpus),
        "--memory", `${limits.memoryMb}m`, "--memory-swap", `${limits.memoryMb}m`,
        "--pids-limit", String(limits.pidsLimit),
        "--security-opt", "no-new-privileges", "--cap-drop", "ALL",
        "-v", `${volume}:${WS_ROOT}`,
        IMAGE,
    ];
    const r = await dexec(args, { timeout: 60000 });
    if (r.code !== 0 && !/already in use/i.test(r.stderr)) throw new Error("container start failed: " + r.stderr.trim());
    return name;
}

let _sharedReady = null;
async function ensureShared() {
    if (_sharedReady) return SHARED_NAME;
    const st = await containerExists(SHARED_NAME);
    if (st.exists && st.running) { _sharedReady = SHARED_NAME; return SHARED_NAME; }
    if (st.exists && !st.running) { await dexec(["start", SHARED_NAME], { timeout: 20000 }); }
    else { await runContainer(SHARED_NAME, DEFAULTS, "nocturne-workspaces"); }
    _sharedReady = SHARED_NAME;
    return SHARED_NAME;
}

async function ensureDedicated(userId, spec) {
    const name = `nocturne-u${userId}`;
    const st = await containerExists(name);
    if (st.exists && !st.running) await dexec(["start", name], { timeout: 20000 });
    else if (!st.exists) await runContainer(name, spec, `nocturne-ws-u${userId}`);
    return name;
}

// ── Spec + workspace provisioning (db-backed) ──────────────────────────────────
function resolveSpec(userId) {
    const row = q.specGet.get(userId);
    if (!row) return { ...DEFAULTS };
    return {
        cpus: row.cpus ?? DEFAULTS.cpus,
        memoryMb: row.memory_mb ?? DEFAULTS.memoryMb,
        pidsLimit: row.pids_limit ?? DEFAULTS.pidsLimit,
        diskMb: row.disk_mb ?? DEFAULTS.diskMb,
        dedicated: row.dedicated ? 1 : 0,
        enabled: row.enabled ? 1 : 0,
    };
}

function allocatePort() {
    const used = new Set(q.wsPorts.all().map(r => r.port));
    for (let p = PORT_BASE; p < PORT_BASE + PORT_SPAN; p++) if (!used.has(p)) return p;
    throw new Error("no free app ports");
}

// Resolve (or create) a user's container + workspace dir + port + token.
async function provision(userId) {
    const spec = resolveSpec(userId);
    if (!spec.enabled) throw new Error("Backend runners are disabled for this account.");
    const container = spec.dedicated ? await ensureDedicated(userId, spec) : await ensureShared();
    const dir = `${WS_ROOT}/u${userId}`;

    // dir is created as 'coder' so the app (also coder) owns its files.
    await dexec(["exec", "-u", CODER_UID, container, "mkdir", "-p", `${dir}/.noc`], { timeout: 15000 });

    let ws = q.wsGet.get(userId);
    if (!ws) {
        const now = Date.now();
        const token = crypto.randomBytes(12).toString("hex");
        const port = allocatePort();
        try { q.wsInsert.run(userId, container, dir, port, token, now, now); }
        catch { /* race: another request inserted */ }
        ws = q.wsGet.get(userId);
    } else if (ws.container !== container) {
        // spec flipped shared<->dedicated; keep the row but follow the new container
        db.prepare("UPDATE runner_workspaces SET container = ? WHERE user_id = ?").run(container, userId);
        ws = q.wsGet.get(userId);
    }
    const ip = await containerIp(container);
    return { spec, container, dir, port: ws.port, token: ws.token, ip };
}

// ── Files ──────────────────────────────────────────────────────────────────────
function cleanPath(p) {
    let s = String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!s || s.length > 240) return null;
    if (s.split("/").some(seg => seg === ".." || seg === ".")) return null;
    if (/[\x00-\x1f]/.test(s)) return null;
    return s;
}

// Write one file into the workspace AS coder (uid 1001). The relative path is
// passed as a positional arg ($1), never interpolated into the script — so a
// crafted filename can't inject shell. Content arrives on stdin.
async function writeFile(container, dir, relpath, content) {
    const script = 'p="$1"; d=$(dirname "$p"); [ "$d" = "." ] || mkdir -p "$d"; cat > "$p"';
    const r = await dexec(
        ["exec", "-i", "-u", CODER_UID, "-w", dir, container, "sh", "-c", script, "_", relpath],
        { input: content, timeout: 20000 }
    );
    if (r.code !== 0) throw new Error(`write ${relpath} failed: ${r.stderr.trim()}`);
}

async function syncFiles(container, dir, files) {
    const written = [];
    for (const f of Array.isArray(files) ? files : []) {
        const rel = cleanPath(f?.name);
        if (!rel) continue;
        const content = typeof f.content === "string" ? f.content : String(f.content ?? "");
        if (content.length > 2 * 1024 * 1024) continue;          // 2MB/file cap
        await writeFile(container, dir, rel, content);
        written.push(rel);
    }
    return written;
}

// ── App lifecycle ────────────────────────────────────────────────────────────
// Guess a start command from the file set. Callers may override.
function detectStartCommand(files) {
    const names = (files || []).map(f => String(f?.name || ""));
    const has = (re) => names.find(n => re.test(n));
    const pkg = (files || []).find(f => /(^|\/)package\.json$/i.test(f?.name || ""));
    if (pkg) {
        let start = null;
        try { start = JSON.parse(pkg.content || "{}").scripts?.start; } catch {}
        const inst = "npm install --no-audit --no-fund --loglevel=error";
        if (start) return `${inst} && npm start`;
        const entry = has(/(^|\/)(server|app|index|main)\.(m?js|cjs)$/i) || "index.js";
        return `${inst} && node ${entry}`;
    }
    const pyEntry = has(/(^|\/)(app|main|server|wsgi|manage)\.py$/i) || has(/\.py$/i);
    if (pyEntry) {
        const req = names.some(n => /(^|\/)requirements\.txt$/i.test(n))
            ? "pip install --quiet -r requirements.txt; " : "";
        return `${req}python3 ${pyEntry}`;
    }
    const node = has(/(^|\/)(server|app|index|main)\.(m?js|cjs)$/i);
    if (node) return `node ${node}`;
    return null;
}

// Start (or restart) the user's app: detached, pid recorded, output to .noc/log.
// The app is told to bind 0.0.0.0:<port> via env so we can reach it on the bridge.
async function startApp(container, dir, port, cmd) {
    await stopApp(container, dir);                                // replace any previous app
    // $1 = port, $2 = user command. exec replaces the shell so .noc/pid holds the
    // real app pid; everything is grouped so output lands in .noc/log.
    const script =
        'mkdir -p .noc; : > .noc/log; ' +
        '{ echo $$ > .noc/pid; exec env PORT="$1" HOST=0.0.0.0 HOSTNAME=0.0.0.0 ' +
        'PYTHONUNBUFFERED=1 NODE_ENV=development sh -c "$2"; } >> .noc/log 2>&1';
    const r = await dexec(
        ["exec", "-d", "-u", CODER_UID, "-w", dir, container, "bash", "-lc", script, "_", String(port), cmd],
        { timeout: 15000 }
    );
    if (r.code !== 0) throw new Error("start failed: " + r.stderr.trim());
    return { port, cmd };
}

async function stopApp(container, dir) {
    const script = 'pid=$(cat .noc/pid 2>/dev/null); [ -n "$pid" ] && { pkill -P "$pid" 2>/dev/null; kill "$pid" 2>/dev/null; }; rm -f .noc/pid; true';
    await dexec(["exec", "-u", CODER_UID, "-w", dir, container, "bash", "-lc", script], { timeout: 12000 });
}

async function appAlive(container, dir) {
    const r = await dexec(["exec", "-u", CODER_UID, "-w", dir, container, "bash", "-lc",
        'pid=$(cat .noc/pid 2>/dev/null); [ -n "$pid" ] && [ -e "/proc/$pid" ] && echo up || echo down'], { timeout: 8000 });
    return r.stdout.trim() === "up";
}

// Clear the workspace before a sync so files deleted in the IDE disappear here too,
// but KEEP dependency caches (node_modules/.venv/__pycache__) and .noc.
async function cleanWorkspace(container, dir) {
    await dexec(["exec", "-u", CODER_UID, "-w", dir, container, "bash", "-lc",
        "find . -mindepth 1 -maxdepth 1 ! -name .noc ! -name node_modules ! -name .venv ! -name __pycache__ -exec rm -rf {} + 2>/dev/null; true"], { timeout: 15000 });
}
// Workspace disk usage in MB (best-effort).
async function workspaceDiskMb(container, dir) {
    const r = await dexec(["exec", "-u", CODER_UID, container, "du", "-sm", dir], { timeout: 15000 });
    const m = /^(\d+)/.exec((r.stdout || "").trim());
    return m ? Number(m[1]) : 0;
}
// Total /workspaces usage on the shared container (MB), cached 60s (du is heavy).
async function workspacesUsedMb() {
    if (Date.now() - _wsUsage.at < 60000) return _wsUsage.mb;
    try {
        const r = await dexec(["exec", "-u", CODER_UID, SHARED_NAME, "du", "-sm", WS_ROOT], { timeout: 20000 });
        const m = /^(\d+)/.exec((r.stdout || "").trim());
        _wsUsage = { mb: m ? Number(m[1]) : _wsUsage.mb, at: Date.now() };
    } catch {}
    return _wsUsage.mb;
}

// Live container + backend-app stats for the admin Containers tab (owner-only).
async function adminStats() {
    const ps = await dexec(["ps", "-a", "--filter", "name=nocturne-", "--format", "{{.Names}}|{{.Status}}"], { timeout: 8000 });
    const rows = ps.stdout.trim() ? ps.stdout.trim().split("\n").map(l => l.split("|")) : [];
    const upNames = rows.filter(r => /^Up/i.test(r[1] || "")).map(r => r[0]);
    const byName = {};
    if (upNames.length) {
        const st = await dexec(["stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.MemPerc}}|{{.PIDs}}", ...upNames], { timeout: 12000 });
        for (const line of (st.stdout.trim() ? st.stdout.trim().split("\n") : [])) {
            const c = line.split("|");
            byName[c[0]] = { cpu: c[1], mem: c[2], memPct: c[3], pids: c[4] };
        }
    }
    const containers = rows.map(r => ({ name: r[0], status: r[1], up: /^Up/i.test(r[1] || ""), ...(byName[r[0]] || {}) }));
    const apps = [];
    for (const [userId, info] of running) {
        let username = null; try { username = stmts.findUserById.get(userId)?.username || null; } catch {}
        const ws = q.wsGet.get(userId);
        apps.push({ userId, username, container: info.container, port: ws ? ws.port : null, lastActive: ws ? ws.last_active : info.at });
    }
    apps.sort((a, b) => (b.lastActive || 0) - (a.lastActive || 0));
    const wsMb = await workspacesUsedMb();
    return { containers, apps, counts: { containers: containers.length, up: upNames.length, runningApps: apps.length }, storage: { usedMb: wsMb, capMb: WORKSPACES_CAP_MB }, idleMs: IDLE_MS, ts: Date.now() };
}

// Is the app actually accepting connections on its port yet?
function probePort(ip, port, timeout = 1500) {
    return new Promise((resolve) => {
        const s = net.connect({ host: ip, port }, () => { s.destroy(); resolve(true); });
        s.setTimeout(timeout, () => { s.destroy(); resolve(false); });
        s.on("error", () => resolve(false));
    });
}

// ── HTTP/WS reverse proxy to the user's app over the docker bridge ─────────────
// Apps are served under a PATH on whatever domain currently fronts Nocturne, so it
// follows rotating domains:  <domain>/code/dev/<id>/…   The id is an unguessable
// hex token. We forward the sub-path (the app sees "/"), inject a <base> and
// rewrite root-absolute asset URLs under the prefix so pages resolve, rewrite
// redirects, and strip Nocturne's session cookie so it never reaches the app.
import http from "node:http";

const DEV_PREFIX = "/code/dev";
function devPath(token) { return `${DEV_PREFIX}/${token}/`; }
function devUrl(token) { return `https://${RUNNER_HOST}${devPath(token)}`; }
function hostOf(req) { return String(req.headers?.host || "").trim().toLowerCase(); }
function onRunnerHost(req) {
    const h = hostOf(req);
    return !!RUNNER_HOST && (h === RUNNER_HOST || h.replace(/:\d+$/, "") === RUNNER_HOST);
}

// Mounted first in index.js: the runner host serves user apps and nothing
// else, so none of Nocturne's own pages or APIs ever load on that origin.
export function runnerHostGuard(req, res, next) {
    if (!ENABLED || !onRunnerHost(req)) return next();
    if (RUN_RE.test(req.url || "")) return next();
    res.statusCode = 404;
    res.end("not found");
}

function resolveToken(token) { return q.wsByToken.get(token) || null; }

// Drop Nocturne's session cookie so it never leaks into a user's app.
function stripSession(cookie) {
    if (!cookie) return cookie;
    const kept = String(cookie).split(/;\s*/).filter(c => !/^nocturne_sid=/i.test(c)).join("; ");
    return kept || null;
}

// Make a proxied HTML page resolve under the dev prefix: inject <base> for relative
// URLs and push root-absolute href/src/action ("/x") under the prefix.
function rewriteHtml(body, prefix) {
    // Rewrite the app's root-absolute URLs FIRST, then inject <base> — otherwise the
    // rewrite would re-prefix the base href we just added.
    body = body.replace(/(\s(?:href|src|action)\s*=\s*["'])\/(?!\/)/gi, `$1${prefix}`);
    if (!/<base\s/i.test(body)) body = body.replace(/<head([^>]*)>/i, `<head$1><base href="${prefix}">`);
    return body;
}

async function proxyToApp(req, res, token, fullPath) {
    const ws = resolveToken(token);
    if (!ws) { res.statusCode = 404; return res.end("unknown app"); }
    const ip = await containerIp(ws.container);
    if (!ip) { res.statusCode = 502; return res.end("app container offline"); }
    q.wsTouch.run(Date.now(), ws.user_id);
    const prefix = devPath(token);

    const headers = { ...req.headers };
    headers.host = `${ip}:${ws.port}`;
    const ck = stripSession(headers.cookie);
    if (ck == null) delete headers.cookie; else headers.cookie = ck;
    delete headers["accept-encoding"];                          // plain bytes so we can rewrite HTML
    delete headers["x-forwarded-host"];

    const preq = http.request({ host: ip, port: ws.port, method: req.method, path: fullPath || "/", headers, timeout: 30000 }, (pres) => {
        const ct = String(pres.headers["content-type"] || "");
        const out = { ...pres.headers };
        delete out["content-length"]; delete out["content-encoding"];
        delete out["x-frame-options"]; delete out["content-security-policy"]; delete out["content-security-policy-report-only"];
        if (out.location) out.location = String(out.location).replace(/^https?:\/\/[^/]+/, "").replace(/^\/(?!code\/dev\/)/, prefix);
        if (/text\/html/i.test(ct)) {
            const chunks = [];
            pres.on("data", c => chunks.push(c));
            pres.on("end", () => {
                const body = rewriteHtml(Buffer.concat(chunks).toString("utf8"), prefix);
                try { res.writeHead(pres.statusCode || 502, out); res.end(body); } catch {}
            });
            pres.on("error", () => { try { res.end(); } catch {} });
            return;
        }
        try { res.writeHead(pres.statusCode || 502, out); } catch {}
        pres.pipe(res);
    });
    preq.on("timeout", () => preq.destroy(new Error("app timeout")));
    preq.on("error", () => { try { if (!res.headersSent) res.statusCode = 502; res.end("app error"); } catch {} });
    res.on("close", () => { if (!res.writableFinished) try { preq.destroy(); } catch {} });
    req.pipe(preq);
}

const RUN_RE = /^\/code\/dev\/([a-f0-9]{16,64})(\/[^?]*)?(\?.*)?$/;

// Defense-in-depth for the same-origin dev path: if an /api/* request came from a
// /code/dev/<id>/ page (its Referer), drop Nocturne's session cookie so a user's app
// can't act as the viewer. (Full isolation needs a separate origin, which rotating
// domains rule out; a no-referrer app can still bypass this — documented limit.)
export function scrubDevOriginAuth(req, res, next) {
    try {
        if (ENABLED && req.path.startsWith("/api/") && req.headers.cookie) {
            const ref = req.headers.referer || "";
            const i = ref.indexOf("/code/dev/");
            if (i !== -1 && /^\/code\/dev\/[a-f0-9]{16,64}/.test(ref.slice(i))) {
                const kept = stripSession(req.headers.cookie);
                if (kept == null) delete req.headers.cookie; else req.headers.cookie = kept;
            }
        }
    } catch {}
    next();
}

// Raw-socket WS upgrade proxy to the user's app (so the app's own websockets work).
export function runnerProxyUpgrade(req, socket, head) {
    if (!ENABLED) return false;
    const m = RUN_RE.exec(req.url || "");
    const onHost = onRunnerHost(req);
    if (!m && !onHost) return false;
    // Nothing but app sockets on the runner host, and app sockets only there.
    if (!m || !onHost) { try { socket.destroy(); } catch {} return true; }
    const token = m[1];
    const fullPath = (m[2] || "/") + (m[3] || "");
    const ws = resolveToken(token);
    if (!ws) { try { socket.destroy(); } catch {} return true; }
    containerIp(ws.container).then((ip) => {
        if (!ip) { try { socket.destroy(); } catch {} return; }
        const upstream = net.connect({ host: ip, port: ws.port }, () => {
            const headers = { ...req.headers };
            headers.host = `${ip}:${ws.port}`;
            const ck = stripSession(headers.cookie);
            if (ck == null) delete headers.cookie; else headers.cookie = ck;
            let raw = `${req.method || "GET"} ${fullPath} HTTP/1.1\r\n`;
            for (const k in headers) {
                const v = headers[k];
                if (v == null) continue;
                if (Array.isArray(v)) for (const vv of v) raw += `${k}: ${vv}\r\n`;
                else raw += `${k}: ${v}\r\n`;
            }
            raw += "\r\n";
            upstream.write(raw);
            if (head && head.length) upstream.write(head);
            upstream.pipe(socket); socket.pipe(upstream);
        });
        upstream.on("error", () => { try { socket.destroy(); } catch {} });
        socket.on("error", () => { try { upstream.destroy(); } catch {} });
    });
    return true;
}

// ── Express surface ────────────────────────────────────────────────────────────
import express from "express";

export function mountRunner(app, { authMiddleware } = {}) {
    if (RUNNER_FLAG && !RUNNER_HOST) { console.error("[runner] NOT enabled: NOCTURNE_RUNNER=1 needs NOCTURNE_RUNNER_HOST (a separate hostname for user apps)"); return; }
    if (!ENABLED) { console.log("[runner] disabled (set NOCTURNE_RUNNER=1 and NOCTURNE_RUNNER_HOST to enable)"); return; }
    // Best-effort: make sure the shared container is up at boot.
    ensureShared().then(() => console.log("[runner] shared container ready")).catch(e => console.error("[runner] shared container init failed:", e.message));

    // Idle-reaper: stop apps with no proxy traffic for IDLE_MS (frees ports + pids).
    setInterval(async () => {
        const now = Date.now();
        for (const [userId, info] of running) {
            const ws = q.wsGet.get(userId);
            const last = ws ? ws.last_active : info.at;
            if (now - last > IDLE_MS) {
                try { await stopApp(info.container, info.dir); } catch {}
                running.delete(userId);
                log("reaped idle app, user", userId);
            }
        }
    }, 5 * 60 * 1000).unref();

    // Live HTTP proxy for user apps at /code/dev/<id>/ (registered before the static
    // handler). Public — the id is unguessable; the IDE embeds it in an iframe.
    app.use((req, res, next) => {
        const m = RUN_RE.exec(req.url || "");
        if (!m) return next();
        if (!onRunnerHost(req)) {
            // Old same-origin links: bounce GETs to the app host, refuse the rest.
            if (req.method === "GET" || req.method === "HEAD") { res.statusCode = 302; res.setHeader("Location", `https://${RUNNER_HOST}${req.url}`); return res.end(); }
            res.statusCode = 404; return res.end("not found");
        }
        proxyToApp(req, res, m[1], (m[2] || "/") + (m[3] || "")).catch(() => { try { res.statusCode = 502; res.end(); } catch {} });
    });

    const json = express.json({ limit: "4mb" });

    // Start (or restart) the signed-in user's app from a synced file set.
    app.post("/api/runner/run", requireAuth, json, async (req, res) => {
        if (OWNER_ONLY && !isOwnerName(req.user.username)) return res.status(403).json({ error: "Backend runners are in limited testing — not enabled for your account yet.", limited: true });
        try {
            const { spec, container, dir, port, token } = await provision(req.user.id);
            if (container === SHARED_NAME) {
                const wsMb = await workspacesUsedMb();
                if (wsMb >= WORKSPACES_CAP_MB) return res.status(507).json({ error: `Shared workspace storage is full (${(wsMb / 1024).toFixed(1)} GB of ${Math.round(WORKSPACES_CAP_MB / 1024)} GB). Delete files or stop unused apps.` });
            }
            const files = Array.isArray(req.body?.files) ? req.body.files : [];
            await cleanWorkspace(container, dir);        // IDE deletes propagate; dep caches kept
            await syncFiles(container, dir, files);
            const usedMb = await workspaceDiskMb(container, dir);
            if (usedMb > spec.diskMb) return res.status(413).json({ error: `Workspace is over its ${spec.diskMb} MB limit (using ${usedMb} MB) — remove files or dependencies.` });
            const cmd = (typeof req.body?.cmd === "string" && req.body.cmd.trim())
                ? req.body.cmd.trim() : detectStartCommand(files);
            if (!cmd) return res.status(400).json({ error: "Could not determine how to start this project — set a start script or pass an explicit command." });
            await startApp(container, dir, port, cmd);
            running.set(req.user.id, { container, dir, at: Date.now() });
            res.json({ ok: true, token, url: devUrl(token), appUrl: devUrl(token), port, cmd });
        } catch (e) {
            res.status(500).json({ error: String(e?.message || e) });
        }
    });

    app.post("/api/runner/stop", requireAuth, async (req, res) => {
        try {
            const ws = q.wsGet.get(req.user.id);
            if (ws) await stopApp(ws.container, ws.dir);
            running.delete(req.user.id);
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
    });

    // Owner kill-switch: stop every running app at once.
    app.post("/api/runner/admin/killall", requireAuth, async (req, res) => {
        if (!isOwnerName(req.user.username)) return res.status(403).json({ error: "owner only" });
        let stopped = 0;
        for (const [, info] of running) { try { await stopApp(info.container, info.dir); stopped++; } catch {} }
        running.clear();
        res.json({ ok: true, stopped });
    });

    // Live container + app stats (owner-only) for the admin Containers tab.
    app.get("/api/runner/admin/stats", requireAuth, async (req, res) => {
        if (!isOwnerName(req.user.username)) return res.status(403).json({ error: "owner only" });
        try { res.json(await adminStats()); } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
    });
    // Stop one user's app (owner-only).
    app.post("/api/runner/admin/stop/:userId", requireAuth, async (req, res) => {
        if (!isOwnerName(req.user.username)) return res.status(403).json({ error: "owner only" });
        const uid = Number(req.params.userId);
        const r = running.get(uid), ws = q.wsGet.get(uid);
        const container = (r && r.container) || (ws && ws.container), dir = (r && r.dir) || (ws && ws.dir);
        if (container && dir) { try { await stopApp(container, dir); } catch {} }
        running.delete(uid);
        res.json({ ok: true });
    });

    app.get("/api/runner/status", requireAuth, async (req, res) => {
        try {
            const ws = q.wsGet.get(req.user.id);
            if (!ws) return res.json({ provisioned: false });
            const ip = await containerIp(ws.container);
            const [alive, live] = await Promise.all([appAlive(ws.container, ws.dir), ip ? probePort(ip, ws.port) : false]);
            res.json({ provisioned: true, running: alive, live, url: devUrl(ws.token), appUrl: devUrl(ws.token), port: ws.port });
        } catch (e) { res.status(500).json({ error: String(e?.message || e) }); }
    });

    // Live logs over SSE (tails the app's .noc/log).
    app.get("/api/runner/logs", requireAuth, async (req, res) => {
        const ws = q.wsGet.get(req.user.id);
        if (!ws) return res.status(404).end();
        res.writeHead(200, {
            "Content-Type": "text/event-stream", "Cache-Control": "no-cache",
            "Connection": "keep-alive", "X-Accel-Buffering": "no",
        });
        res.write(": connected\n\n");
        const tail = spawn(DOCKER, ["exec", ws.container, "tail", "-n", "200", "-F", `${ws.dir}/.noc/log`]);
        const send = (line) => { try { res.write(`data: ${JSON.stringify({ line })}\n\n`); } catch {} };
        let buf = "";
        const onData = (chunk) => {
            buf += chunk.toString("utf8");
            const lines = buf.split("\n"); buf = lines.pop() || "";
            for (const l of lines) send(l);
        };
        tail.stdout.on("data", onData);
        tail.stderr.on("data", onData);
        const ping = setInterval(() => { try { res.write(": ping\n\n"); } catch {} }, 15000);
        const cleanup = () => { clearInterval(ping); try { tail.kill("SIGKILL"); } catch {} };
        req.on("close", cleanup);
        tail.on("close", () => { try { res.end(); } catch {} });
    });

    // Owner-only admin: read/set per-user specs. (Full UI wired in a later phase.)
    app.get("/api/runner/admin/spec/:userId", requireAuth, (req, res) => {
        if (!isOwnerName(req.user.username)) return res.status(403).json({ error: "owner only" });
        const uid = Number(req.params.userId);
        res.json({ userId: uid, spec: resolveSpec(uid), explicit: !!q.specGet.get(uid) });
    });
    app.post("/api/runner/admin/spec/:userId", requireAuth, json, (req, res) => {
        if (!isOwnerName(req.user.username)) return res.status(403).json({ error: "owner only" });
        const uid = Number(req.params.userId);
        if (!Number.isInteger(uid)) return res.status(400).json({ error: "bad user id" });
        const b = req.body || {};
        if (b.reset) { q.specDelete.run(uid); return res.json({ ok: true, spec: resolveSpec(uid) }); }
        const clamp = (v, lo, hi, dflt) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt; };
        q.specUpsert.run({
            user_id: uid,
            cpus: clamp(b.cpus, 0.25, 8, DEFAULTS.cpus),
            memory_mb: Math.round(clamp(b.memoryMb, 256, 16384, DEFAULTS.memoryMb)),
            pids_limit: Math.round(clamp(b.pidsLimit, 64, 4096, DEFAULTS.pidsLimit)),
            disk_mb: Math.round(clamp(b.diskMb, 128, 20480, DEFAULTS.diskMb)),
            dedicated: b.dedicated ? 1 : 0,
            enabled: b.enabled === false ? 0 : 1,
            updated_at: Date.now(),
            updated_by: req.user.username,
        });
        res.json({ ok: true, spec: resolveSpec(uid) });
    });

    console.log("[runner] enabled — /run proxy + /api/runner/* mounted");
}

// Exposed for the standalone mechanics test (Phase 2 verification).
export const __test = {
    dexec, ensureShared, containerIp, syncFiles, startApp, stopApp, appAlive,
    probePort, detectStartCommand, cleanPath, cleanWorkspace, workspaceDiskMb, WS_ROOT, CODER_UID,
};
