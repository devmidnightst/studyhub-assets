import { shouldTouchSession } from "./session-refresh.js";
import { randomBytes } from "crypto";
import { hashPassword, verifyPassword } from "./password.js";
export { hashPassword, verifyPassword } from "./password.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, stmts, MAX_USERS, SESSION_TTL_MS } from "./db.js";
import { verifyCaptcha } from "./captcha.js";
import { clientIp, ipSanction } from "./ip.js";
import { connectionRestricted, LIMITED_MESSAGE } from "./network.js";

export { clientIp };

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SESSION_COOKIE = "nocturne_sid";

const USERNAME_RE = /^[a-zA-Z0-9_-]{3,32}$/;
const PASSWORD_MIN = 8;
const PASSWORD_MAX = 256;

// Signup/login abuse protection is the Cap proof-of-work captcha (see captcha.js) —
// every signup/login request must carry a solved challenge, checked in each route below.
// This replaces the old per-IP throttle + login-failure lockout: a script now has to pay
// the PoW cost per attempt instead of just waiting out a timer.
//
// On top of that, a small per-IP burst limiter guards the (cheap, pre-captcha) request
// handling itself: 5 requests are allowed freely, then a 3s cooldown before the next one
// is accepted — just enough to stop rapid-fire spam without needing a real session.
const BURST_MAX = 5;
const BURST_WINDOW_MS = 3000;
const burstBuckets = new Map();
setInterval(() => {
    const now = Date.now();
    for (const [ip, b] of burstBuckets) if (now - b.start > BURST_WINDOW_MS) burstBuckets.delete(ip);
}, BURST_WINDOW_MS).unref();
function burstLimited(ip) {
    if (!ip) return false;
    const now = Date.now();
    let b = burstBuckets.get(ip);
    if (!b || now - b.start > BURST_WINDOW_MS) { b = { start: now, count: 0 }; burstBuckets.set(ip, b); }
    b.count += 1;
    return b.count > BURST_MAX;
}

// The owner / "god" account: seeded on boot with a configured password and a
// huge credit balance. The password comes from NOCTURNE_OWNER_PASSWORD; when
// unset, one is generated once and stored in data/owner-password (mode 0600,
// gitignored) — there is deliberately no hardcoded default.
export const OWNER_USERNAME = (process.env.NOCTURNE_OWNER || "midnightsweat").toLowerCase();
const OWNER_PASSWORD = loadOwnerPassword();

function loadOwnerPassword() {
    if (process.env.NOCTURNE_OWNER_PASSWORD) return process.env.NOCTURNE_OWNER_PASSWORD;
    const file = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "owner-password");
    try {
        const existing = fs.readFileSync(file, "utf8").trim();
        if (existing) return existing;
    } catch {}
    const generated = randomBytes(18).toString("base64url");
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, generated + "\n", { mode: 0o600 });
        console.log(`[auth] no NOCTURNE_OWNER_PASSWORD set — generated a random owner password, saved to ${file}`);
    } catch (e) {
        console.warn("[auth] could not persist generated owner password:", e.message);
    }
    return generated;
}
const OWNER_CREDITS_MICRO = Math.round((Number(process.env.NOCTURNE_OWNER_CREDITS_USD) || 99_999_999) * 1_000_000);

export function isOwnerName(name) {
    return typeof name === "string" && name.toLowerCase() === OWNER_USERNAME;
}
export function userIsLimited(user) {
    if (!user || isOwnerName(user.username)) return false;
    try {
        const row = stmts.signupLimited.get(user.id);
        return !!(row && row.n);
    } catch { return false; }
}
// Is this user currently banned? (owner is never banned)
export function userBanned(username) {
    if (!username || isOwnerName(username)) return null;
    try { return stmts.banCheck.get("user", String(username).toLowerCase(), Date.now()) || null; } catch { return null; }
}
export function ipBanned(ip) {
    if (!ip) return null;
    try { return stmts.banCheck.get("ip", String(ip), Date.now()) || null; } catch { return null; }
}
// Device (browser-fingerprint) ban — matches the noct_fp value set client-side.
export function deviceBanned(fp) {
    if (!fp) return null;
    try { return stmts.banCheck.get("device", String(fp), Date.now()) || null; } catch { return null; }
}

export function logUserEvent(userId, username, req, event) {
    try {
        const ip = clientIp(req) || null;
        const fp = fpFromReq(req) || null;
        const ua = (req.headers?.["user-agent"] || "").slice(0, 512) || null;
        stmts.userLogInsert.run(userId, username, ip, fp, ua, event, Date.now());
    } catch {}
}

function fpFromReq(req) {
    try {
        const m = /(?:^|;\s*)noct_fp=([A-Za-z0-9]{4,64})/.exec(req.headers?.cookie || "");
        return m ? m[1] : null;
    } catch { return null; }
}

export function newSessionToken() {
    return randomBytes(32).toString("hex");
}

function parseCookies(req) {
    const out = {};
    const c = req.headers.cookie;
    if (!c) return out;
    const parts = c.split(/;\s*/);
    for (const p of parts) {
        const i = p.indexOf("=");
        if (i <= 0) continue;
        const k = p.slice(0, i).trim();
        const v = p.slice(i + 1);
        if (!k) continue;
        try { out[k] = decodeURIComponent(v); }
        catch { out[k] = v; }
    }
    return out;
}

export function setSessionCookie(req, res, token) {
    const isHttps = req.secure || req.get("x-forwarded-proto") === "https";
    res.cookie(SESSION_COOKIE, token, {
        httpOnly: true,
        secure: !!isHttps,
        sameSite: "lax",
        path: "/",
        maxAge: SESSION_TTL_MS
    });
}

function clearSessionCookie(req, res) {
    const isHttps = req.secure || req.get("x-forwarded-proto") === "https";
    res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: !!isHttps, sameSite: "lax", path: "/" });
}

const _sessionLogCache = new Map();
const SESSION_LOG_INTERVAL = 30 * 60_000;

export function authMiddleware(req, res, next) {
    req.user = null;
    const cookies = parseCookies(req);
    const token = cookies[SESSION_COOKIE] || req.headers["x-noc-session"] || req.query?._noc_session;
    if (!token || token.length !== 64) return next();
    let session;
    try { session = stmts.findSession.get(token, Date.now()); } catch { session = null; }
    if (!session) return next();
    const touchedAt = Date.now();
    if (shouldTouchSession(session, touchedAt, SESSION_TTL_MS)) {
        try { stmts.touchSession.run(touchedAt, touchedAt + SESSION_TTL_MS, token); } catch {}
    }
    req.user = { id: session.user_id, username: session.username, sessionToken: token };
    const now = Date.now();
    const lastLog = _sessionLogCache.get(session.user_id) || 0;
    if (now - lastLog > SESSION_LOG_INTERVAL) {
        _sessionLogCache.set(session.user_id, now);
        logUserEvent(session.user_id, session.username, req, "session");
    }
    next();
}

export function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ error: "auth required" });
    next();
}

// Verify account credentials for the public AI API (username + password). Returns
// { id, username } on success, else null. Honors bans + the same scrypt check as
// login. Used by /api/ai when an API key isn't supplied.
export async function authenticateUser(username, password) {
    const v = validateCredentials({ username, password });
    if (v.error) return null;
    const user = stmts.findUserByName.get(v.username);
    if (!user) return null;
    if (!(await verifyPassword(password, user.password_hash))) return null;
    if (stmts.findUserByName.get(user.username)?.password_hash !== user.password_hash) return null;
    if (userBanned(user.username)) return null;
    return { id: user.id, username: user.username };
}

function validateCredentials(body) {
    const username = typeof body?.username === "string" ? body.username.trim() : "";
    const password = typeof body?.password === "string" ? body.password : "";
    if (!USERNAME_RE.test(username)) return { error: "Username must be 3-32 chars (letters, numbers, _ or -)" };
    if (password.length < PASSWORD_MIN) return { error: `Password must be at least ${PASSWORD_MIN} characters` };
    if (password.length > PASSWORD_MAX) return { error: "Password too long" };
    return { username, password };
}

// Ensure the owner/"god" account exists with the configured password and a huge
// credit balance. Idempotent — runs every boot, resetting the password to match.
async function seedOwner() {
    try {
        const existing = stmts.findUserByName.get(OWNER_USERNAME);
        const hash = await hashPassword(OWNER_PASSWORD);
        if (!existing) {
            const info = stmts.insertUser.run(OWNER_USERNAME, hash, Date.now());
            stmts.aiCreditsSet.run(OWNER_CREDITS_MICRO, info.lastInsertRowid);
            console.log(`[auth] seeded owner account "${OWNER_USERNAME}"`);
        } else {
            stmts.changePassword.run(hash, existing.id);
            stmts.aiCreditsSet.run(OWNER_CREDITS_MICRO, existing.id);
            console.log(`[auth] owner account "${OWNER_USERNAME}" ready (password + credits reset)`);
        }
    } catch (e) {
        console.warn("[auth] owner seed failed:", e.message);
    }
}

export async function mountAuth(app) {
    await seedOwner();

    app.post("/api/auth/signup", async (req, res) => {
        if (burstLimited(clientIp(req))) {
            return res.status(429).json({ error: "Slow down — wait a few seconds and try again." });
        }
        if (!(await verifyCaptcha(req.body?.captcha))) {
            return res.status(400).json({ error: "Captcha verification failed — please try again." });
        }
        const v = validateCredentials(req.body);
        if (v.error) return res.status(400).json({ error: v.error });

        const { n } = stmts.countUsers.get();
        if (n >= MAX_USERS) return res.status(503).json({ error: "Service is full. Try again later." });

        const existing = stmts.findUserByName.get(v.username);
        if (existing) return res.status(409).json({ error: "Username unavailable" });

        let info;
        try {
            const passwordHash = await hashPassword(v.password);
            if (stmts.countUsers.get().n >= MAX_USERS) return res.status(503).json({ error: "Service is full. Try again later." });
            info = stmts.insertUser.run(v.username, passwordHash, Date.now());
        } catch (e) {
            if (String(e.message || "").includes("UNIQUE")) return res.status(409).json({ error: "Username unavailable" });
            return res.status(e.status === 503 ? 503 : 500).json({ error: e.status === 503 ? "Password service busy; retry shortly." : "Signup failed" });
        }
        const userId = info.lastInsertRowid;
        const net = await connectionRestricted(clientIp(req));
        if (net.restricted) {
            try { stmts.setSignupLimited.run(userId); } catch {}
        }
        const token = newSessionToken();
        const now = Date.now();
        stmts.insertSession.run(token, userId, now, now + SESSION_TTL_MS, now, clientIp(req));
        setSessionCookie(req, res, token);
        logUserEvent(userId, v.username, req, "signup");
        res.json({
            ok: true,
            user: { id: userId, username: v.username },
            sessionToken: token,
            limited: !!net.restricted,
            limitMessage: net.restricted ? LIMITED_MESSAGE : ""
        });
    });

    app.post("/api/auth/login", async (req, res) => {
        if (burstLimited(clientIp(req))) {
            return res.status(429).json({ error: "Slow down — wait a few seconds and try again." });
        }
        const onBlockedRange = !!ipSanction(clientIp(req));
        if (!onBlockedRange && !(await verifyCaptcha(req.body?.captcha))) {
            return res.status(400).json({ error: "Captcha verification failed — please try again." });
        }

        const v = validateCredentials(req.body);
        if (v.error) return res.status(400).json({ error: "Invalid credentials" });

        const user = stmts.findUserByName.get(v.username);
        if (!user) return res.status(401).json({ error: "Invalid credentials" });
        if (!(await verifyPassword(v.password, user.password_hash))) {
            return res.status(401).json({ error: "Invalid credentials" });
        }

        if (stmts.findUserByName.get(user.username)?.password_hash !== user.password_hash) return res.status(401).json({ error: "Credentials changed; sign in again." });
        const ban = userBanned(user.username);
        if (ban) return res.status(403).json({ error: "This account is banned." + (ban.reason ? " Reason: " + ban.reason : "") });

        const sanctioned = onBlockedRange ? ipSanction(clientIp(req)) : null;
        if (sanctioned && !isOwnerName(user.username)) {
            const role = stmts.getChatRole.get(user.id);
            const perm = String(role?.chat_perm || "").toLowerCase();
            if (perm !== "admin" && perm !== "mod") {
                return res.status(403).json({ error: sanctioned.message, sanctioned: true, blocked: true });
            }
        }

        const token = newSessionToken();
        const now = Date.now();
        stmts.insertSession.run(token, user.id, now, now + SESSION_TTL_MS, now, clientIp(req));
        setSessionCookie(req, res, token);
        logUserEvent(user.id, user.username, req, "login");
        res.json({ ok: true, user: { id: user.id, username: user.username }, sessionToken: token });
    });

    app.post("/api/auth/logout", authMiddleware, (req, res) => {
        if (req.user?.sessionToken) {
            try { stmts.deleteSession.run(req.user.sessionToken); } catch {}
        }
        clearSessionCookie(req, res);
        res.json({ ok: true });
    });

    app.get("/api/auth/me", authMiddleware, (req, res) => {
        if (!req.user) return res.json({ authenticated: false });
        const u = stmts.findUserById.get(req.user.id);
        if (!u) return res.json({ authenticated: false });
        res.json({
            authenticated: true,
            user: {
                id: u.id,
                username: u.username,
                createdAt: u.created_at,
                storageBytes: u.storage_bytes,
                limited: userIsLimited(u)
            }
        });
    });

    app.post("/api/auth/password", authMiddleware, requireAuth, async (req, res) => {
        const current = typeof req.body?.current === "string" ? req.body.current : "";
        const next = typeof req.body?.next === "string" ? req.body.next : "";
        if (next.length < PASSWORD_MIN || next.length > PASSWORD_MAX) {
            return res.status(400).json({ error: "Invalid new password" });
        }
        const u = stmts.findUserByName.get(req.user.username);
        if (!u || !(await verifyPassword(current, u.password_hash))) {
            return res.status(401).json({ error: "Current password incorrect" });
        }
        const replacementHash = await hashPassword(next);
        if (stmts.findUserByName.get(u.username)?.password_hash !== u.password_hash) return res.status(409).json({ error: "Credentials changed; retry." });
        stmts.changePassword.run(replacementHash, u.id);
        stmts.deleteUserSessions.run(u.id);
        const token = newSessionToken();
        const now = Date.now();
        stmts.insertSession.run(token, u.id, now, now + SESSION_TTL_MS, now, null);   // IP not stored (privacy)
        setSessionCookie(req, res, token);
        res.json({ ok: true, sessionToken: token });
    });

    app.post("/api/auth/delete", authMiddleware, requireAuth, async (req, res) => {
        const password = typeof req.body?.password === "string" ? req.body.password : "";
        const u = stmts.findUserByName.get(req.user.username);
        if (!u || !(await verifyPassword(password, u.password_hash))) {
            return res.status(401).json({ error: "Password incorrect" });
        }
        if (stmts.findUserByName.get(u.username)?.password_hash !== u.password_hash) return res.status(409).json({ error: "Credentials changed; retry." });
        stmts.deleteUser.run(u.id);
        clearSessionCookie(req, res);
        res.json({ ok: true });
    });
    app.use("/api/auth", (error, req, res, next) => {
        if (error.status !== 503) return next(error);
        res.set("Retry-After", "2").status(503).json({ error: "Password service busy; retry shortly." });
    });
}
