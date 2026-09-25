import { db, stmts, MAX_BYTES_PER_USER } from "./db.js";
import { authMiddleware, requireAuth } from "./auth.js";

const MAX_DOMAIN_LEN = 253;
const MAX_NAME_LEN = 256;
const MAX_VALUE_LEN = 4096;
const MAX_PATH_LEN = 1024;
const MAX_COOKIES_PER_USER = 5000;
const SAME_SITE_VALUES = new Set(["strict", "lax", "none"]);

function byteLen(s) { return Buffer.byteLength(s || "", "utf8"); }

function cookieSize(c) {
    return byteLen(c.domain) + byteLen(c.name) + byteLen(c.value) + byteLen(c.path || "/");
}

function normalizeDomain(d) {
    if (typeof d !== "string") return "";
    let s = d.trim().toLowerCase();
    if (s.startsWith(".")) s = s.slice(1);
    // Enforce length + hostname charset here so the GET/DELETE-by-:domain routes
    // (which use this directly, not validateCookie) can't pass an oversized or
    // junk key straight into a query. Reject → "" so callers' `if (!domain)` bites.
    if (s.length > MAX_DOMAIN_LEN || !/^[a-z0-9.\-_:]+$/.test(s)) return "";
    return s;
}

function validateCookie(body) {
    const domain = normalizeDomain(body?.domain);
    const name = typeof body?.name === "string" ? body.name : "";
    const value = typeof body?.value === "string" ? body.value : "";
    const cookiePath = typeof body?.path === "string" && body.path ? body.path : "/";

    if (!domain || domain.length > MAX_DOMAIN_LEN) return { error: "invalid domain" };
    if (!name || name.length > MAX_NAME_LEN) return { error: "invalid name" };
    if (value.length > MAX_VALUE_LEN) return { error: "value too large" };
    if (cookiePath.length > MAX_PATH_LEN) return { error: "path too long" };
    if (!/^[!-~]+$/.test(name)) return { error: "invalid name characters" };

    let expires = null;
    if (body?.expires != null) {
        const n = Number(body.expires);
        if (!Number.isFinite(n) || n < 0) return { error: "invalid expires" };
        expires = Math.floor(n);
    }

    let sameSite = null;
    if (body?.sameSite != null) {
        const s = String(body.sameSite).toLowerCase();
        if (!SAME_SITE_VALUES.has(s)) return { error: "invalid sameSite" };
        sameSite = s;
    }

    return {
        domain, name, value, path: cookiePath, expires,
        secure: body?.secure ? 1 : 0,
        httpOnly: body?.httpOnly ? 1 : 0,
        sameSite
    };
}

function shapeCookie(row) {
    return {
        domain: row.domain,
        name: row.name,
        value: row.value,
        path: row.path,
        expires: row.expires,
        secure: !!row.secure,
        httpOnly: !!row.http_only,
        sameSite: row.same_site,
        updatedAt: row.updated_at,
        sizeBytes: row.size_bytes
    };
}

function evictUntilFits(userId, neededBytes) {
    const current = stmts.cookieSizeSum.get(userId).total || 0;
    if (current + neededBytes <= MAX_BYTES_PER_USER) return;
    let toFree = (current + neededBytes) - MAX_BYTES_PER_USER;
    const oldest = stmts.cookieOldestForEvict.all(userId, 200);
    for (const c of oldest) {
        if (toFree <= 0) break;
        stmts.cookieDeleteById.run(c.id);
        toFree -= c.size_bytes;
    }
    const recomputed = stmts.cookieSizeSum.get(userId).total || 0;
    stmts.setStorageBytes.run(recomputed, userId);
}

function recomputeSize(userId) {
    const total = stmts.cookieSizeSum.get(userId).total || 0;
    stmts.setStorageBytes.run(total, userId);
    return total;
}

export function mountStorage(app) {
    app.get("/api/storage/quota", authMiddleware, requireAuth, (req, res) => {
        const used = recomputeSize(req.user.id);
        res.json({ used, max: MAX_BYTES_PER_USER });
    });

    app.get("/api/storage/cookies", authMiddleware, requireAuth, (req, res) => {
        const domain = normalizeDomain(req.query.domain || "");
        if (domain) {
            const rows = stmts.cookieList.all(req.user.id, domain).map(r => ({ ...shapeCookie(r), domain }));
            return res.json({ cookies: rows });
        }
        const rows = stmts.cookieAll.all(req.user.id).map(shapeCookie);
        res.json({ cookies: rows });
    });

    app.put("/api/storage/cookies", authMiddleware, requireAuth, (req, res) => {
        const v = validateCookie(req.body);
        if (v.error) return res.status(400).json({ error: v.error });

        const userId = req.user.id;
        const newSize = cookieSize(v);

        const existing = stmts.cookieGet.get(userId, v.domain, v.name, v.path);
        const oldSize = existing ? existing.size_bytes : 0;
        const delta = newSize - oldSize;

        if (delta > 0) {
            const total = stmts.cookieSizeSum.get(userId).total || 0;
            if (total + delta > MAX_BYTES_PER_USER) {
                evictUntilFits(userId, delta);
                const after = stmts.cookieSizeSum.get(userId).total || 0;
                if (after + delta > MAX_BYTES_PER_USER) {
                    return res.status(413).json({ error: "Quota exceeded", used: after, max: MAX_BYTES_PER_USER });
                }
            }
        }

        if (!existing) {
            const countRow = db.prepare("SELECT COUNT(*) AS n FROM cookies WHERE user_id = ?").get(userId);
            if (countRow.n >= MAX_COOKIES_PER_USER) {
                return res.status(429).json({ error: "Too many cookies stored" });
            }
        }

        const now = Date.now();
        stmts.cookieUpsert.run(
            userId, v.domain, v.name, v.value, v.path, v.expires,
            v.secure, v.httpOnly, v.sameSite, now, newSize
        );
        const total = recomputeSize(userId);
        res.json({ ok: true, used: total, max: MAX_BYTES_PER_USER });
    });

    app.put("/api/storage/cookies/bulk", authMiddleware, requireAuth, (req, res) => {
        const list = Array.isArray(req.body?.cookies) ? req.body.cookies : null;
        if (!list || list.length > 500) return res.status(400).json({ error: "invalid bulk payload" });

        const userId = req.user.id;
        const validated = [];
        for (const item of list) {
            const v = validateCookie(item);
            if (v.error) return res.status(400).json({ error: v.error });
            validated.push(v);
        }

        const txn = db.transaction(items => {
            const now = Date.now();
            for (const v of items) {
                const newSize = cookieSize(v);
                const existing = stmts.cookieGet.get(userId, v.domain, v.name, v.path);
                const delta = newSize - (existing ? existing.size_bytes : 0);
                if (delta > 0) {
                    const total = stmts.cookieSizeSum.get(userId).total || 0;
                    if (total + delta > MAX_BYTES_PER_USER) evictUntilFits(userId, delta);
                    const after = stmts.cookieSizeSum.get(userId).total || 0;
                    if (after + delta > MAX_BYTES_PER_USER) throw new Error("quota");
                }
                stmts.cookieUpsert.run(
                    userId, v.domain, v.name, v.value, v.path, v.expires,
                    v.secure, v.httpOnly, v.sameSite, now, newSize
                );
            }
        });

        try { txn(validated); }
        catch (e) {
            if (e.message === "quota") return res.status(413).json({ error: "Quota exceeded" });
            return res.status(500).json({ error: "bulk upsert failed" });
        }
        const total = recomputeSize(userId);
        res.json({ ok: true, used: total, max: MAX_BYTES_PER_USER, count: validated.length });
    });

    app.delete("/api/storage/cookies", authMiddleware, requireAuth, (req, res) => {
        const domain = normalizeDomain(req.body?.domain || "");
        const name = typeof req.body?.name === "string" ? req.body.name : "";
        const cookiePath = typeof req.body?.path === "string" && req.body.path ? req.body.path : "/";
        if (!domain || !name) return res.status(400).json({ error: "domain and name required" });
        stmts.cookieDelete.run(req.user.id, domain, name, cookiePath);
        const total = recomputeSize(req.user.id);
        res.json({ ok: true, used: total });
    });

    app.delete("/api/storage/cookies/domain/:domain", authMiddleware, requireAuth, (req, res) => {
        const domain = normalizeDomain(req.params.domain);
        if (!domain) return res.status(400).json({ error: "invalid domain" });
        stmts.cookieDeleteDomain.run(req.user.id, domain);
        const total = recomputeSize(req.user.id);
        res.json({ ok: true, used: total });
    });

    app.delete("/api/storage/cookies/all", authMiddleware, requireAuth, (req, res) => {
        stmts.cookieDeleteAll.run(req.user.id);
        stmts.setStorageBytes.run(0, req.user.id);
        res.json({ ok: true, used: 0 });
    });

    app.get("/api/storage/domains", authMiddleware, requireAuth, (req, res) => {
        const rows = db.prepare(`
            SELECT domain, COUNT(*) AS count, SUM(size_bytes) AS bytes, MAX(updated_at) AS lastUpdated
            FROM cookies WHERE user_id = ?
            GROUP BY domain
            ORDER BY lastUpdated DESC
        `).all(req.user.id);
        res.json({ domains: rows });
    });
}
