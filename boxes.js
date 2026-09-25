// Boxes — admin-provisioned, isolated Ubuntu 26.04 headless containers ("VMs"),
// carved from a fixed resource pool (Proxmox-style) and reached via an in-browser
// terminal. Separate from the code-IDE runner. Gated behind NOCTURNE_BOXES.
//
// The terminal allocates a PTY INSIDE the box with `script` and pipes it over a
// plain `ws` WebSocket — no native node-pty build needed. RAM/CPU are cgroup-
// enforced; the disk figure is pool-accounting only (this LXC can't hard-cap disk).
import { execFile, spawn } from "node:child_process";
import fs from "node:fs";
import { db, stmts } from "./db.js";
import { requireAuth, isOwnerName } from "./auth.js";
import express from "express";
import { WebSocketServer } from "ws";

const ENABLED = process.env.NOCTURNE_BOXES === "1";
const DOCKER  = process.env.NOCTURNE_DOCKER_BIN || "docker";
const IMAGE   = process.env.NOCTURNE_BOX_IMAGE || "nocturne-box:latest";
const PREFIX  = "nocturne-box-";

// Total allocatable pool — the "datacenter" capacity the owner divides up.
const POOL = Object.freeze({
    cpus:     Number(process.env.NOCTURNE_BOX_CPUS)    || 2,
    memoryMb: Number(process.env.NOCTURNE_BOX_MEM_MB)  || 8192,
    diskMb:   Number(process.env.NOCTURNE_BOX_DISK_MB) || 25600,
});

export function boxesEnabled() { return ENABLED; }

// ── Schema ───────────────────────────────────────────────────────────────────
db.exec(`
    CREATE TABLE IF NOT EXISTS boxes (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     INTEGER NOT NULL,
        name        TEXT NOT NULL,
        container   TEXT NOT NULL UNIQUE,
        cpus        REAL NOT NULL,
        memory_mb   INTEGER NOT NULL,
        disk_mb     INTEGER NOT NULL,
        created_at  INTEGER NOT NULL,
        created_by  TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_boxes_user ON boxes(user_id);
`);
const q = {
    all:    db.prepare("SELECT * FROM boxes ORDER BY id"),
    byId:   db.prepare("SELECT * FROM boxes WHERE id = ?"),
    byUser: db.prepare("SELECT * FROM boxes WHERE user_id = ? ORDER BY id"),
    insert: db.prepare("INSERT INTO boxes (user_id,name,container,cpus,memory_mb,disk_mb,created_at,created_by) VALUES (?,?,?,?,?,?,?,?)"),
    setContainer: db.prepare("UPDATE boxes SET container = ? WHERE id = ?"),
    del:    db.prepare("DELETE FROM boxes WHERE id = ?"),
    sums:   db.prepare("SELECT COALESCE(SUM(cpus),0) AS cpus, COALESCE(SUM(memory_mb),0) AS mem, COALESCE(SUM(disk_mb),0) AS disk FROM boxes"),
};

// ── Docker lifecycle ─────────────────────────────────────────────────────────
function dexec(args, opts = {}) {
    return new Promise((res) => {
        execFile(DOCKER, args, { timeout: opts.timeout || 60000, maxBuffer: 16 * 1024 * 1024 },
            (err, stdout, stderr) => res({ code: err ? (err.code ?? 1) : 0, stdout: stdout || "", stderr: stderr || "", err }));
    });
}
async function ensureImage() { return (await dexec(["image", "inspect", IMAGE], { timeout: 8000 })).code === 0; }

function poolUsed() { const s = q.sums.get(); return { cpus: s.cpus, memoryMb: s.mem, diskMb: s.disk }; }
function poolFree() { const u = poolUsed(); return { cpus: +(POOL.cpus - u.cpus).toFixed(2), memoryMb: POOL.memoryMb - u.memoryMb, diskMb: POOL.diskMb - u.diskMb }; }

async function runBoxContainer(box) {
    const r = await dexec(["run", "-d", "--name", box.container, "--restart", "unless-stopped",
        "--hostname", "box" + box.id,
        "--cpus", String(box.cpus), "--memory", box.memory_mb + "m", "--memory-swap", box.memory_mb + "m",
        "--pids-limit", "512",
        IMAGE], { timeout: 60000 });
    if (r.code !== 0 && !/already in use/i.test(r.stderr)) throw new Error("box start failed: " + r.stderr.trim());
}

async function createBox(userId, { cpus, memoryMb, diskMb, name }, createdBy) {
    cpus     = Math.max(0.25, Math.min(POOL.cpus, Number(cpus) || 1));
    memoryMb = Math.max(256, Math.min(POOL.memoryMb, Math.round(Number(memoryMb) || 1024)));
    diskMb   = Math.max(512, Math.min(POOL.diskMb, Math.round(Number(diskMb) || 5120)));
    const free = poolFree();
    if (cpus > free.cpus + 1e-6 || memoryMb > free.memoryMb || diskMb > free.diskMb)
        throw new Error(`Not enough free capacity — need ${cpus}c/${memoryMb}MB/${diskMb}MB, free ${free.cpus}c/${free.memoryMb}MB/${free.diskMb}MB`);
    const now = Date.now();
    const id = q.insert.run(userId, String(name || "box").slice(0, 40), PREFIX + "pending", cpus, memoryMb, diskMb, now, createdBy || null).lastInsertRowid;
    const container = PREFIX + id;
    q.setContainer.run(container, id);
    const box = q.byId.get(id);
    try { await runBoxContainer(box); }
    catch (e) { q.del.run(id); await dexec(["rm", "-f", container]); throw e; }
    return q.byId.get(id);
}
async function resetBox(id) {
    const box = q.byId.get(id); if (!box) return false;
    await dexec(["rm", "-f", box.container], { timeout: 30000 });
    await runBoxContainer(box);
    return true;
}
async function deleteBox(id) {
    const box = q.byId.get(id); if (!box) return false;
    await dexec(["rm", "-f", box.container], { timeout: 30000 });
    q.del.run(id);
    return true;
}

// ── Stats ────────────────────────────────────────────────────────────────────
function systemStats() {
    let temps = [];
    try {
        for (let i = 0; i < 12; i++) {
            const f = "/sys/class/thermal/thermal_zone" + i + "/temp";
            if (!fs.existsSync(f)) break;
            const t = parseInt(fs.readFileSync(f, "utf8").trim(), 10);
            if (t > 0) temps.push(Math.round(t / 1000));
        }
    } catch {}
    let mem = {};
    try {
        const mi = fs.readFileSync("/proc/meminfo", "utf8");
        const g = k => { const m = new RegExp("^" + k + ":\\s+(\\d+)", "m").exec(mi); return m ? Math.round(+m[1] / 1024) : 0; };
        const total = g("MemTotal"), avail = g("MemAvailable");
        mem = { totalMb: total, usedMb: total - avail, availMb: avail };
    } catch {}
    let load = [];
    try { load = fs.readFileSync("/proc/loadavg", "utf8").trim().split(" ").slice(0, 3).map(Number); } catch {}
    return { temps, cpuTemp: temps.length ? Math.max(...temps) : null, mem, load };
}
async function boxStats() {
    const ps = await dexec(["ps", "-a", "--filter", "name=" + PREFIX, "--format", "{{.Names}}|{{.Status}}"], { timeout: 8000 });
    const rows = ps.stdout.trim() ? ps.stdout.trim().split("\n").map(l => l.split("|")) : [];
    const up = rows.filter(r => /^Up/i.test(r[1] || "")).map(r => r[0]);
    const byName = {};
    if (up.length) {
        const st = await dexec(["stats", "--no-stream", "--format", "{{.Name}}|{{.CPUPerc}}|{{.MemUsage}}|{{.PIDs}}", ...up], { timeout: 12000 });
        for (const l of (st.stdout.trim() ? st.stdout.trim().split("\n") : [])) { const c = l.split("|"); byName[c[0]] = { cpu: c[1], mem: c[2], pids: c[3] }; }
    }
    const map = {};
    for (const r of rows) map[r[0]] = { status: r[1], up: /^Up/i.test(r[1] || ""), ...(byName[r[0]] || {}) };
    return map;
}
function boxView(b, stat) {
    return {
        id: b.id, name: b.name, userId: b.user_id, cpus: b.cpus, memoryMb: b.memory_mb, diskMb: b.disk_mb,
        createdAt: b.created_at, createdBy: b.created_by,
        up: stat ? stat.up : false, cpu: stat ? stat.cpu || null : null, mem: stat ? stat.mem || null : null, status: stat ? stat.status : "—",
    };
}

// ── In-browser terminal (script-PTY piped over ws) ───────────────────────────
function userFromReq(req) {
    try {
        const m = /(?:^|;\s*)nocturne_sid=([^;]+)/.exec(req.headers.cookie || "");
        if (!m) return null;
        const s = stmts.findSession.get(decodeURIComponent(m[1]), Date.now());
        return s ? { id: s.user_id, username: s.username } : null;
    } catch { return null; }
}
let wss = null;
export function boxesTerminalUpgrade(req, socket, head) {
    if (!ENABLED) return false;
    const m = /^\/api\/boxes\/term(?:\?id=|\/)(\d+)/.exec(req.url || "");
    if (!m) return false;
    const box = q.byId.get(Number(m[1]));
    const user = userFromReq(req);
    if (!box || !user || (user.id !== box.user_id && !isOwnerName(user.username))) { try { socket.destroy(); } catch {} return true; }
    if (!wss) wss = new WebSocketServer({ noServer: true });
    wss.handleUpgrade(req, socket, head, (ws) => {
        // PTY allocated by `script` inside the box; bash runs as the sudo user.
        const child = spawn(DOCKER, ["exec", "-i", "-u", "user", "-w", "/home/user", box.container,
            "script", "-qfc", "stty rows 30 cols 100 2>/dev/null; exec bash -l", "/dev/null"]);
        child.stdout.on("data", d => { try { ws.send(d); } catch {} });
        child.stderr.on("data", d => { try { ws.send(d); } catch {} });
        ws.on("message", d => { try { child.stdin.write(d); } catch {} });
        ws.on("close", () => { try { child.kill("SIGKILL"); } catch {} });
        child.on("close", () => { try { ws.close(); } catch {} });
        child.on("error", () => { try { ws.close(); } catch {} });
        try { ws.send("\r\n\x1b[2m· connected to " + box.name + " — Ubuntu 26.04 ·\x1b[0m\r\n"); } catch {}
    });
    return true;
}

// ── Express surface ──────────────────────────────────────────────────────────
export function mountBoxes(app, { authMiddleware } = {}) {
    if (!ENABLED) { console.log("[boxes] disabled (set NOCTURNE_BOXES=1 to enable)"); return; }
    ensureImage().then(ok => console.log(ok ? "[boxes] image ready" : "[boxes] WARNING: " + IMAGE + " missing — build _box/Dockerfile")).catch(() => {});

    const json = express.json({ limit: "64kb" });
    const owner = (req, res, next) => { if (!req.user || !isOwnerName(req.user.username)) return res.status(403).json({ error: "owner only" }); next(); };

    // Datacenter view — pool, system stats, every box.
    app.get("/api/boxes/admin/datacenter", requireAuth, owner, async (req, res) => {
        try {
            const stats = await boxStats();
            const boxes = q.all.all().map(b => { const u = stmts.findUserById.get(b.user_id); return { ...boxView(b, stats[b.container]), username: u ? u.username : ("#" + b.user_id) }; });
            res.json({ pool: POOL, used: poolUsed(), free: poolFree(), system: systemStats(), boxes });
        } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    });
    // Allocate a box to a user (Proxmox-style provisioning).
    app.post("/api/boxes/admin/create", requireAuth, owner, json, async (req, res) => {
        try {
            const username = String(req.body?.username || "").trim();
            const u = username ? stmts.findUserByName.get(username) : (req.body?.userId ? stmts.findUserById.get(Number(req.body.userId)) : null);
            if (!u) return res.status(404).json({ error: "user not found" });
            const box = await createBox(u.id, { cpus: req.body?.cpus, memoryMb: req.body?.memoryMb, diskMb: req.body?.diskMb, name: req.body?.name }, req.user.username);
            res.json({ ok: true, box: { ...boxView(box), username: u.username } });
        } catch (e) { res.status(400).json({ error: String(e.message || e) }); }
    });
    app.post("/api/boxes/admin/reset/:id", requireAuth, owner, async (req, res) => { try { await resetBox(Number(req.params.id)); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: String(e.message || e) }); } });
    app.post("/api/boxes/admin/delete/:id", requireAuth, owner, async (req, res) => { try { await deleteBox(Number(req.params.id)); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: String(e.message || e) }); } });

    // A user's own boxes (shown in their VMs area).
    app.get("/api/boxes/mine", requireAuth, async (req, res) => {
        try { const stats = await boxStats(); res.json({ boxes: q.byUser.all(req.user.id).map(b => boxView(b, stats[b.container])) }); }
        catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    });
    app.post("/api/boxes/reset/:id", requireAuth, async (req, res) => {
        const box = q.byId.get(Number(req.params.id));
        if (!box || (box.user_id !== req.user.id && !isOwnerName(req.user.username))) return res.status(404).json({ error: "not found" });
        try { await resetBox(box.id); res.json({ ok: true }); } catch (e) { res.status(500).json({ error: String(e.message || e) }); }
    });

    console.log(`[boxes] enabled — pool ${POOL.cpus}c / ${POOL.memoryMb}MB / ${POOL.diskMb}MB`);
}
