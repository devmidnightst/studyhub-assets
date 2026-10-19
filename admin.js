import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { stmts, SESSION_TTL_MS } from "./db.js";
import {
    clientIp, newSessionToken, setSessionCookie, hashPassword,
    isOwnerName, ipBanned, userBanned, deviceBanned, logUserEvent
} from "./auth.js";
import { getModelAccessList, setModelAccess, getQuotaConfig, setQuotaOverride, getDailyUsage, getAiStats, setCreditAllowance, getCreditAllowance, setUserModelGrants, getUserModelGrants, isPaidUser, setPaidUser } from "./groq.js";
import { fpFromReq } from "./activity.js";
import { analytics, RANGE_KEYS } from "./analytics.js";
import { onlineCount } from "./presence.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const MICRO = 1_000_000;

// ── Global ads switch ────────────────────────────────────────────────────────
// A single owner-controlled kill switch for the whole site's ads, persisted so it
// survives restarts. Separate from per-user exemption: paid users and the owner
// never see ads regardless of this flag (see /api/ads/config below). Stored as
// { off: bool } in data/ads-config.json.
const ADS_FILE = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "ads-config.json");
let adsGlobalOff = false;
try { adsGlobalOff = !!(JSON.parse(fs.readFileSync(ADS_FILE, "utf8")) || {}).off; } catch {}
function saveAdsConfig() { try { fs.writeFileSync(ADS_FILE, JSON.stringify({ off: adsGlobalOff })); } catch {} }

function requireOwner(req, res, next) {
    if (!req.user || !isOwnerName(req.user.username)) return res.status(403).json({ error: "Forbidden — owner only." });
    next();
}

function userRow(u) {
    if (!u) return null;
    return {
        id: u.id,
        username: u.username,
        createdAt: u.created_at,
        storageBytes: u.storage_bytes,
        creditsMicro: u.ai_credits_micro == null ? null : u.ai_credits_micro,
        creditsDollars: u.ai_credits_micro == null ? null : +(u.ai_credits_micro / MICRO).toFixed(6),
        allowanceDollars: +(getCreditAllowance(u.id).allowanceMicro / MICRO).toFixed(2),
        grantedModels: getUserModelGrants(u.id),
        paid: isPaidUser(u.id)
    };
}

// Global gate: block banned IPs / users (the owner is never banned). Returns a
// plain 403 — JSON for API calls, a tiny page for navigations.
export function banMiddleware(req, res, next) {
    try {
        if (req.user && isOwnerName(req.user.username)) return next();
        const hit = ipBanned(clientIp(req)) || (req.user && userBanned(req.user.username)) || deviceBanned(fpFromReq(req));
        if (!hit) return next();
        const reason = hit.reason ? ` Reason: ${hit.reason}` : "";
        if (req.path.startsWith("/api/")) return res.status(403).json({ error: "You are banned." + reason, banned: true });
        res.status(403).type("html").send(`<!doctype html><meta charset=utf-8><title>Banned</title><body style="background:#05060d;color:#eae6ff;font-family:system-ui;display:flex;align-items:center;justify-content:center;height:100vh;margin:0;text-align:center"><div><h1 style="font-weight:600">Access blocked</h1><p style="color:#8a85a8">You have been banned from Nocturne.${reason ? "<br>" + reason.replace(/[<>&]/g, "") : ""}</p></div></body>`);
    } catch { next(); }
}

export function mountAdmin(app, { authMiddleware } = {}) {
    const guard = authMiddleware ? [authMiddleware, requireOwner] : [requireOwner];

    // Owner-only check + dashboard counters (the UI calls this first).
    app.get("/api/admin/summary", ...guard, (req, res) => {
        const users = stmts.countUsers.get().n;
        const bans = stmts.banList.all(100000, 0).length;
        const support = stmts.supportList.all(100000, 0);
        const unresolved = support.filter(s => !s.resolved).length;
        res.json({ ok: true, owner: req.user.username, users, bans, support: support.length, supportUnresolved: unresolved, adsOff: adsGlobalOff });
    });

    // Owner-only global ads kill switch. POST { off: bool } to turn every ad on
    // the site off (or back on). Paid/owner exemption is handled separately and
    // is unaffected by this flag.
    app.post("/api/admin/ads", ...guard, (req, res) => {
        adsGlobalOff = !!req.body?.off;
        saveAdsConfig();
        res.json({ ok: true, adsOff: adsGlobalOff });
    });

    // Public: the client ad script asks whether it should run for THIS visitor.
    // `show` is false when the owner has killed ads globally, or when the visitor
    // is a paid customer or the owner. req.user is populated by the global auth
    // middleware (index.js) before this route; signed-out visitors have none and
    // therefore see ads unless the global switch is off. No owner guard here.
    app.get("/api/ads/config", (req, res) => {
        res.set("Cache-Control", "no-store");
        const exempt = !!(req.user && (isOwnerName(req.user.username) || isPaidUser(req.user.id)));
        res.json({ show: !adsGlobalOff && !exempt });
    });

    // First-party hop. The page opens /api/go, and this is the only place
    // the smartlink lives, so blockers never see the destination in the page.
    const SMARTLINK = "https://asiafilm.org/4/07cbfc9d863cc12ec2838ae2e043ddcc";
    app.get("/api/go", (req, res) => {
        res.set("Cache-Control", "no-store");
        const exempt = !!(req.user && (isOwnerName(req.user.username) || isPaidUser(req.user.id)));
        if (adsGlobalOff || exempt) return res.status(204).end();
        res.redirect(302, SMARTLINK);
    });

    // Full dashboard stats (Overview tab).
    app.get("/api/admin/stats", ...guard, (req, res) => {
        const now = Date.now();
        res.json({
            users: stmts.countUsers.get().n,
            online: onlineCount(),
            messages: stmts.adminCountMessages.get().n,
            flags: stmts.adminCountFlags.get().n,
            bans: stmts.adminCountBans.get(now).n,
            supportOpen: stmts.adminCountSupportOpen.get().n,
            ai: getAiStats()
        });
    });

    // Live analytics: bucketed time-series + headline cards for the Analytics tab.
    // Polled as fast as every 2s, so the module keeps a short per-range cache and
    // the heavy ranges are served from it (see analytics.js).
    app.get("/api/admin/analytics", ...guard, (req, res) => {
        const range = RANGE_KEYS.includes(req.query.range) ? req.query.range : "1h";
        const compare = req.query.compare === "1" || req.query.compare === "true";
        res.set("Cache-Control", "no-store");
        try {
            res.json(analytics(range, { compare }));
        } catch (e) {
            res.status(500).json({ error: "Analytics failed: " + (e && e.message ? e.message : "unknown") });
        }
    });

    // Chat moderation: recent flagged (auto-blocked) messages.
    app.get("/api/admin/flags", ...guard, (req, res) => {
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        res.json({ flags: stmts.adminFlagList.all(limit, offset) });
    });
    app.post("/api/admin/flags/:id", ...guard, (req, res) => {
        if (req.body?.action === "delete") stmts.adminFlagDelete.run(Number(req.params.id));
        res.json({ ok: true });
    });

    // ── Users ────────────────────────────────────────────────────────────────
    app.get("/api/admin/users", ...guard, (req, res) => {
        const q = (req.query.q || "").toString().trim();
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 50));
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        const rows = q
            ? stmts.adminUserSearch.all("%" + q.replace(/[\\%_]/g, c => "\\" + c) + "%", limit, offset)
            : stmts.adminUserList.all(limit, offset);
        res.json({ users: rows.map(userRow) });
    });

    function resolveUser(body) {
        if (body?.userId) return stmts.findUserById.get(Number(body.userId));
        if (body?.username) return stmts.findUserByName.get(String(body.username).trim());
        return null;
    }

    // Provision agentic-coding credits — set an exact balance or add to it.
    app.post("/api/admin/credits", ...guard, (req, res) => {
        const u = resolveUser(req.body);
        if (!u) return res.status(404).json({ error: "user not found" });
        const dollars = Number(req.body?.dollars);
        if (!isFinite(dollars) || dollars < 0 || dollars > 1_000_000) return res.status(400).json({ error: "dollars must be a number between 0 and 1,000,000" });
        const micro = Math.round(dollars * MICRO);
        const mode = req.body?.mode === "add" ? "add" : "set";
        if (mode === "add") stmts.aiCreditsAdd.run(micro, u.id);
        else stmts.aiCreditsSet.run(micro, u.id);
        const after = stmts.aiCreditsGet.get(u.id);
        res.json({ ok: true, userId: u.id, username: u.username, mode, creditsMicro: after.micro, creditsDollars: +(after.micro / MICRO).toFixed(6) });
    });

    // Set a user's DAILY credit allowance ($/day, recurring). Default is $3/day.
    app.post("/api/admin/credit-allowance", ...guard, (req, res) => {
        const u = resolveUser(req.body);
        if (!u) return res.status(404).json({ error: "user not found" });
        const r = setCreditAllowance(u.id, Number(req.body?.dollars));
        if (r.error) return res.status(400).json({ error: r.error });
        res.json({ ...r, username: u.username });
    });

    // Paid-customer status — gates the reserved (fallback) navy AI key.
    app.post("/api/admin/paid", ...guard, (req, res) => {
        const u = resolveUser(req.body);
        if (!u) return res.status(404).json({ error: "user not found" });
        const paid = setPaidUser(u.id, !!req.body?.paid);
        res.json({ ok: true, userId: u.id, username: u.username, paid });
    });

    // Per-user model access (e.g. grant Opus to specific people).
    app.get("/api/admin/premium-models", ...guard, (req, res) => {
        res.json({ models: getModelAccessList().filter(m => m.premium) });
    });
    app.post("/api/admin/model-grant", ...guard, (req, res) => {
        const u = resolveUser(req.body);
        if (!u) return res.status(404).json({ error: "user not found" });
        const r = setUserModelGrants(u.id, Array.isArray(req.body?.models) ? req.body.models : []);
        if (r.error) return res.status(400).json({ error: r.error });
        res.json({ ...r, username: u.username });
    });

    // Log in as another user without their password (creates a fresh session).
    app.post("/api/admin/impersonate", ...guard, (req, res) => {
        const u = resolveUser(req.body);
        if (!u) return res.status(404).json({ error: "user not found" });
        if (isOwnerName(u.username)) return res.status(400).json({ error: "already the owner account" });
        const token = newSessionToken();
        const now = Date.now();
        stmts.insertSession.run(token, u.id, now, now + SESSION_TTL_MS, now, null);   // IP not stored (privacy)
        setSessionCookie(req, res, token);
        res.json({ ok: true, impersonating: { id: u.id, username: u.username } });
    });

    // Reset a user's password without knowing the old one.
    app.post("/api/admin/password", ...guard, async (req, res) => {
        const u = resolveUser(req.body);
        if (!u) return res.status(404).json({ error: "user not found" });
        const pw = typeof req.body?.password === "string" ? req.body.password : "";
        if (pw.length < 8 || pw.length > 256) return res.status(400).json({ error: "password must be 8-256 chars" });
        let hash;
        try { hash = await hashPassword(pw); }
        catch (error) {
            if (error.status !== 503) throw error;
            return res.set("Retry-After", "2").status(503).json({ error: "Password service busy; retry shortly." });
        }
        stmts.changePassword.run(hash, u.id);
        stmts.deleteUserSessions.run(u.id);
        res.json({ ok: true, userId: u.id, username: u.username });
    });

    app.post("/api/admin/delete-user", ...guard, (req, res) => {
        const u = resolveUser(req.body);
        if (!u) return res.status(404).json({ error: "user not found" });
        if (isOwnerName(u.username)) return res.status(400).json({ error: "cannot delete the owner account" });
        stmts.deleteUser.run(u.id);
        res.json({ ok: true });
    });

    // Grant a chat permission level (member/mod/admin) + an optional custom role
    // label and name color.
    app.post("/api/admin/chat-role", ...guard, (req, res) => {
        const u = resolveUser(req.body);
        if (!u) return res.status(404).json({ error: "user not found" });
        let perm = String(req.body?.perm || "member").toLowerCase();
        if (!["member", "mod", "admin"].includes(perm)) perm = "member";
        const role = req.body?.role ? String(req.body.role).slice(0, 32) : null;
        let color = req.body?.color ? String(req.body.color).trim() : null;
        if (color && !/^#[0-9a-fA-F]{6}$/.test(color)) color = null;
        stmts.setChatRole.run(perm, role, color, u.id);
        res.json({ ok: true, userId: u.id, username: u.username, perm, role, color });
    });

    // ── Bans ─────────────────────────────────────────────────────────────────
    app.get("/api/admin/bans", ...guard, (req, res) => {
        res.json({ bans: stmts.banList.all(500, 0) });
    });

    app.post("/api/admin/ban", ...guard, (req, res) => {
        const kind = (req.body?.kind === "ip" || req.body?.kind === "device") ? req.body.kind : "user";
        let target = String(req.body?.target || "").trim();
        if (kind === "user") target = target.toLowerCase();
        if (!target) return res.status(400).json({ error: "target required" });
        if (kind === "device" && !/^[A-Za-z0-9]{4,64}$/.test(target)) return res.status(400).json({ error: "invalid device id (expected the noct_fp fingerprint)" });
        if (kind === "user" && isOwnerName(target)) return res.status(400).json({ error: "cannot ban the owner" });
        const reason = (req.body?.reason || "").toString().slice(0, 500) || null;
        const days = Number(req.body?.days);
        const expiresAt = isFinite(days) && days > 0 ? Date.now() + days * 86400_000 : null;
        stmts.banUpsert.run(kind, target, reason, Date.now(), expiresAt, req.user.username);
        res.json({ ok: true, kind, target, expiresAt });
    });

    app.post("/api/admin/unban", ...guard, (req, res) => {
        if (req.body?.id != null) {
            stmts.banDeleteById.run(Number(req.body.id));
            return res.json({ ok: true });
        }
        const kind = (req.body?.kind === "ip" || req.body?.kind === "device") ? req.body.kind : "user";
        let target = String(req.body?.target || "").trim();
        if (kind === "user") target = target.toLowerCase();
        if (!target) return res.status(400).json({ error: "id or target required" });
        stmts.banDelete.run(kind, target);
        res.json({ ok: true });
    });

    // ── User logs (IP, fingerprint, user-agent tracking) ─────────────────────
    app.get("/api/admin/user-logs", ...guard, (req, res) => {
        const q = (req.query.q || "").toString().trim();
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        if (q) {
            const like = "%" + q.replace(/[\\%_]/g, c => "\\" + c) + "%";
            res.json({ logs: stmts.userLogSearch.all(like, like, like, limit, offset) });
        } else {
            res.json({ logs: stmts.userLogLatest.all(limit, offset) });
        }
    });

    app.get("/api/admin/user-logs/:userId", ...guard, (req, res) => {
        const userId = parseInt(req.params.userId, 10);
        const limit = Math.min(500, Math.max(1, parseInt(req.query.limit) || 100));
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        res.json({ logs: stmts.userLogsByUser.all(userId, limit, offset) });
    });

    app.get("/api/admin/ip-users/:ip", ...guard, (req, res) => {
        res.json({ users: stmts.userLogsByIp.all(req.params.ip) });
    });

    app.get("/api/admin/fp-users/:fp", ...guard, (req, res) => {
        res.json({ users: stmts.userLogsByFp.all(req.params.fp) });
    });

    // ── Support inbox ──────────────────────────────────────────────────────────
    app.get("/api/admin/support", ...guard, (req, res) => {
        const limit = Math.min(200, Math.max(1, parseInt(req.query.limit) || 100));
        const offset = Math.max(0, parseInt(req.query.offset) || 0);
        res.json({ messages: stmts.supportList.all(limit, offset) });
    });

    app.post("/api/admin/support/:id", ...guard, (req, res) => {
        const id = Number(req.params.id);
        const action = req.body?.action;
        if (action === "resolve") stmts.supportResolve.run(id);
        else if (action === "unresolve") stmts.supportUnresolve.run(id);
        else if (action === "delete") stmts.supportDelete.run(id);
        else return res.status(400).json({ error: "action must be resolve|unresolve|delete" });
        res.json({ ok: true });
    });

    // ── Model access (which models regular users may use) ──────────────────────
    app.get("/api/admin/models", ...guard, (req, res) => {
        res.json({ models: getModelAccessList() });
    });

    app.post("/api/admin/models", ...guard, (req, res) => {
        const r = setModelAccess(String(req.body?.id || ""), String(req.body?.audience || ""));
        if (r.error) return res.status(400).json({ error: r.error });
        res.json(r);
    });

    // ── Token fair-use quotas ──────────────────────────────────────────────────
    app.get("/api/admin/quota", ...guard, (req, res) => {
        const cfg = getQuotaConfig();
        const users = Object.entries(cfg.users).map(([id, o]) => {
            const u = stmts.findUserById.get(Number(id));
            const usage = getDailyUsage(Number(id));
            return { userId: Number(id), username: u ? u.username : "(deleted)", daily: o.daily, until: o.until || null, usedToday: usage.used };
        });
        res.json({ defaultDaily: cfg.defaultDaily, global: cfg.global, users });
    });

    app.post("/api/admin/quota", ...guard, (req, res) => {
        const scope = req.body?.scope === "global" ? "global" : "user";
        let userId = null;
        if (scope === "user") {
            const u = resolveUser(req.body);
            if (!u) return res.status(404).json({ error: "user not found" });
            userId = u.id;
        }
        const dailyTokens = req.body?.dailyTokens == null || req.body?.dailyTokens === "" ? null : Number(req.body.dailyTokens);
        if (dailyTokens != null && (!isFinite(dailyTokens) || dailyTokens < 0 || dailyTokens > 1_000_000_000))
            return res.status(400).json({ error: "dailyTokens must be between 0 and 1,000,000,000" });
        const days = Number(req.body?.days) || 0;
        const r = setQuotaOverride({ scope, userId, dailyTokens, days });
        if (r.error) return res.status(400).json({ error: r.error });
        res.json(r);
    });
}
