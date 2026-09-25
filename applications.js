// applications.js — staff / role applications (dev, moderator, support, …).
// Visitors apply at /application; submissions land in the /admin "Applications" tab.
// Self-contained: owns its table on the shared db handle, never edits db.js.
import express from "express";
import { db } from "./db.js";
import { isOwnerName, clientIp } from "./auth.js";

db.exec(`
    CREATE TABLE IF NOT EXISTS applications (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        role        TEXT NOT NULL,
        discord     TEXT NOT NULL,
        age         INTEGER,
        timezone    TEXT,
        expertise   TEXT,
        reason      TEXT,
        account     TEXT,                              -- nocturne username if signed in
        ip          TEXT,
        status      TEXT NOT NULL DEFAULT 'new',        -- new | reviewed
        created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_applications_created ON applications(created_at DESC);
`);

const q = {
    insert: db.prepare(`INSERT INTO applications (role, discord, age, timezone, expertise, reason, account, ip, status, created_at)
        VALUES (@role, @discord, @age, @timezone, @expertise, @reason, @account, @ip, 'new', @created_at)`),
    list: db.prepare("SELECT * FROM applications ORDER BY created_at DESC LIMIT ? OFFSET ?"),
    setStatus: db.prepare("UPDATE applications SET status = ? WHERE id = ?"),
    del: db.prepare("DELETE FROM applications WHERE id = ?"),
    countNew: db.prepare("SELECT COUNT(*) AS n FROM applications WHERE status = 'new'"),
};

// Light anti-spam: at most 5 submissions / hour / IP.
const recent = new Map();
function rateLimited(ip) {
    if (!ip) return false;
    const now = Date.now(), win = 60 * 60 * 1000;
    const arr = (recent.get(ip) || []).filter(t => now - t < win);
    if (arr.length >= 5) { recent.set(ip, arr); return true; }
    arr.push(now); recent.set(ip, arr);
    if (recent.size > 5000) for (const [k, v] of recent) if (!v.some(t => now - t < win)) recent.delete(k);
    return false;
}

const clip = (v, n) => String(v == null ? "" : v).trim().slice(0, n);

export function mountApplications(app, { authMiddleware } = {}) {
    const json = express.json({ limit: "64kb" });
    const requireOwner = (req, res, next) => {
        if (!req.user || !isOwnerName(req.user.username)) return res.status(403).json({ error: "Forbidden — owner only." });
        next();
    };
    const ownerGuard = authMiddleware ? [authMiddleware, requireOwner] : [requireOwner];

    // ── Public: submit an application ───────────────────────────────────────────
    app.post("/api/apply", json, (req, res) => {
        const ip = (() => { try { return clientIp(req); } catch { return null; } })();
        if (rateLimited(ip)) return res.status(429).json({ error: "Too many applications from here — try again later." });

        const b = req.body || {};
        const role = clip(b.role, 40);
        const discord = clip(b.discord, 40).replace(/^@+/, "");
        const expertise = clip(b.expertise, 2000);
        const reason = clip(b.reason, 4000);
        const timezone = clip(b.timezone, 80);
        let age = parseInt(b.age, 10);
        if (!Number.isFinite(age)) age = null;

        if (!role) return res.status(400).json({ error: "Pick a role to apply for." });
        if (!/^[a-zA-Z0-9._#]{2,37}$/.test(discord)) return res.status(400).json({ error: "Enter your real Discord username (e.g. yourname or yourname#1234) — no spaces." });
        if (age == null || age < 10 || age > 99) return res.status(400).json({ error: "Enter a valid age." });
        if (expertise.length < 5) return res.status(400).json({ error: "Tell us about your expertise / experience." });
        if (reason.length < 10) return res.status(400).json({ error: "Tell us why you'd be a good fit (a bit more detail)." });

        q.insert.run({
            role, discord, age, timezone: timezone || null, expertise, reason,
            account: req.user?.username || null, ip: ip || null, created_at: Date.now(),
        });
        res.json({ ok: true });
    });

    // ── Owner: list / update / delete (Admin → Applications tab) ─────────────────
    app.get("/api/admin/applications", ...ownerGuard, (req, res) => {
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 200));
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        res.json({ applications: q.list.all(limit, offset), newCount: q.countNew.get().n });
    });

    app.post("/api/admin/applications/:id", ...ownerGuard, json, (req, res) => {
        const id = Number(req.params.id);
        const action = req.body?.action;
        if (action === "reviewed") q.setStatus.run("reviewed", id);
        else if (action === "new") q.setStatus.run("new", id);
        else if (action === "delete") q.del.run(id);
        else return res.status(400).json({ error: "action must be reviewed|new|delete" });
        res.json({ ok: true });
    });

    console.log("[applications] mounted — /api/apply + /api/admin/applications");
}
