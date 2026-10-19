// Owner-only server terminal, relayed into the admin panel over a websocket.
// Spawns a login shell ON THE HOST THIS APP RUNS ON (a PTY via `script`, the same
// no-native-deps trick the box terminals use) and pipes it to xterm.js.
//
// TWO gates before a shell ever spawns:
//   1. The websocket upgrade is accepted only for the owner (nocturne_sid cookie).
//   2. If a "console password" is set, the client must send it over the socket and
//      it is verified server-side (scrypt) before the shell starts. This is the
//      extra password prompt — a second factor on top of the owner session.
import { spawn } from "node:child_process";
import { WebSocketServer } from "ws";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { stmts } from "./db.js";
import { isOwnerName, hashPassword, verifyPassword } from "./auth.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CONSOLE_PW_FILE = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "console-password");

function loadConsoleHash() { try { return fs.readFileSync(CONSOLE_PW_FILE, "utf8").trim(); } catch { return ""; } }
function consolePasswordSet() { return !!loadConsoleHash(); }
async function verifyConsolePassword(pw) {
    const h = loadConsoleHash();
    if (!h) return false;
    return (await verifyPassword(String(pw || ""), h)) && loadConsoleHash() === h;
}
async function setConsolePassword(pw) {
    const hash = await hashPassword(pw);
    fs.mkdirSync(path.dirname(CONSOLE_PW_FILE), { recursive: true });
    fs.writeFileSync(CONSOLE_PW_FILE, hash + "\n", { mode: 0o600 });
}
function clearConsolePassword() { try { fs.unlinkSync(CONSOLE_PW_FILE); } catch {} }

function ownerFromReq(req) {
    try {
        let token = "";
        const m = /(?:^|;\s*)nocturne_sid=([^;]+)/.exec(req.headers.cookie || "");
        if (m) {
            // The browser attaches this cookie to sockets opened by any same-site
            // page, so a cookie login only counts when the page is our own origin.
            // (The ?_noc_session path below needs the token itself, so it is safe
            // from cross-origin mirrors.)
            const origin = String(req.headers.origin || "");
            let sameOrigin = !origin;
            if (origin) { try { sameOrigin = new URL(origin).host.toLowerCase() === String(req.headers.host || "").toLowerCase(); } catch { sameOrigin = false; } }
            if (sameOrigin) token = decodeURIComponent(m[1]);
        }
        // Static S3/CloudFront pages cannot send the httpOnly cookie on a
        // cross-origin socket, so the console also passes the session as
        // ?_noc_session= (same token authMiddleware already accepts).
        if (!token) {
            try { token = new URL(req.url, "http://x").searchParams.get("_noc_session") || ""; }
            catch { token = ""; }
        }
        if (!token || token.length !== 64) return null;
        const s = stmts.findSession.get(token, Date.now());
        if (!s) return null;
        return isOwnerName(s.username) ? { id: s.user_id, username: s.username } : null;
    } catch { return null; }
}

let wss = null;

// Brute-force guard on the console password: 3 wrong tries → locked for 2 minutes.
// Module-level so it survives websocket reconnects (owner-only tool, so a single
// shared counter is fine); it resets on a server restart.
const CONSOLE_MAX_TRIES = 3;
const CONSOLE_LOCK_MS = 2 * 60 * 1000;
let consoleFails = 0;
let consoleLockedUntil = 0;

// Returns true if it claimed the upgrade (so index.js stops the chain).
export function terminalUpgrade(req, socket, head) {
    if (!/^\/api\/admin\/term(?:\?|$)/.test(req.url || "")) return false;
    if (!ownerFromReq(req)) { try { socket.destroy(); } catch {} return true; }   // owner gate

    // Match the PTY size to the client's terminal (sent as ?cols=&rows=) so output
    // wraps to their actual screen instead of a fixed 120x32. Clamped to sane bounds.
    let cols = 120, rows = 32;
    try {
        const u = new URL(req.url, "http://x");
        const c = parseInt(u.searchParams.get("cols"), 10);
        const r = parseInt(u.searchParams.get("rows"), 10);
        if (Number.isFinite(c) && c >= 20 && c <= 400) cols = c;
        if (Number.isFinite(r) && r >= 5 && r <= 200) rows = r;
    } catch {}

    if (!wss) wss = new WebSocketServer({ noServer: true });
    wss.handleUpgrade(req, socket, head, (ws) => {
        let child = null;
        let authed = false;
        let verifying = false;

        const lockRemainingSec = () => Math.max(0, Math.ceil((consoleLockedUntil - Date.now()) / 1000));

        const startShell = () => {
            authed = true;
            child = spawn("script", ["-qfc", `stty rows ${rows} cols ${cols} 2>/dev/null; exec bash -l`, "/dev/null"], {
                cwd: process.env.HOME || __dirname,
                env: { ...process.env, TERM: "xterm-256color", COLUMNS: String(cols), LINES: String(rows) },
            });
            child.stdout.on("data", (d) => { try { ws.send(d); } catch {} });
            child.stderr.on("data", (d) => { try { ws.send(d); } catch {} });
            child.on("close", () => { try { ws.close(); } catch {} });
            child.on("error", () => { try { ws.close(); } catch {} });
            try { ws.send("\r\n\x1b[2m· nocturne server shell — you are on the app host ·\x1b[0m\r\n"); } catch {}
        };

        // No console password configured → owner cookie alone is enough.
        if (!consolePasswordSet()) {
            startShell();
        } else if (lockRemainingSec() > 0) {
            try { ws.send(JSON.stringify({ __auth: "locked", seconds: lockRemainingSec() })); } catch {}
            try { ws.close(); } catch {}
        } else {
            try { ws.send(JSON.stringify({ __auth: "password-required" })); } catch {}
        }

        ws.on("message", async (d) => {
            if (authed) { try { child.stdin.write(d); } catch {}; return; }   // raw keystrokes once past the gate

            // Pre-auth: the only thing we accept is the password frame.
            let msg;
            try { msg = JSON.parse(d.toString()); } catch { return; }
            if (msg.type !== "auth" || verifying) return;
            if (typeof msg.password !== "string" || msg.password.length > 256) return;

            // Locked out? Refuse regardless of what they send.
            if (lockRemainingSec() > 0) {
                try { ws.send(JSON.stringify({ __auth: "locked", seconds: lockRemainingSec() })); } catch {}
                try { ws.close(); } catch {}
                return;
            }

            verifying = true;
            let verified;
            try { verified = await verifyConsolePassword(msg.password); }
            catch {
                if (ws.readyState === 1) ws.close(1013, "Password service busy; retry shortly");
                return;
            } finally { verifying = false; }
            // The socket, owner session, or lock may have changed while hashing.
            if (ws.readyState !== 1) return;
            if (!ownerFromReq(req) || lockRemainingSec() > 0) { ws.close(); return; }
            if (verified) {
                consoleFails = 0;
                startShell();
            } else {
                consoleFails++;
                if (consoleFails >= CONSOLE_MAX_TRIES) {
                    consoleLockedUntil = Date.now() + CONSOLE_LOCK_MS;
                    consoleFails = 0;
                    try { ws.send(JSON.stringify({ __auth: "locked", seconds: Math.ceil(CONSOLE_LOCK_MS / 1000) })); } catch {}
                    try { ws.close(); } catch {}
                } else {
                    try { ws.send(JSON.stringify({ __auth: "denied", remaining: CONSOLE_MAX_TRIES - consoleFails })); } catch {}
                }
            }
        });

        ws.on("close", () => { try { if (child) child.kill("SIGKILL"); } catch {} });
        ws.on("error", () => { try { if (child) child.kill("SIGKILL"); } catch {} });
    });
    return true;
}

// Owner-only endpoints to check/set/clear the console password.
export function mountConsole(app, { authMiddleware } = {}) {
    const ownerOnly = (req, res, next) => {
        if (!req.user || !isOwnerName(req.user.username)) return res.status(403).json({ error: "owner only" });
        next();
    };
    const guard = authMiddleware ? [authMiddleware, ownerOnly] : [ownerOnly];

    app.get("/api/admin/console-password/status", ...guard, (req, res) => {
        res.json({ set: consolePasswordSet() });
    });

    app.post("/api/admin/console-password", ...guard, async (req, res) => {
        if (req.body?.clear) { clearConsolePassword(); return res.json({ ok: true, set: false }); }
        const pw = typeof req.body?.password === "string" ? req.body.password : "";
        if (pw.length < 6) return res.status(400).json({ error: "Console password must be at least 6 characters." });
        if (pw.length > 256) return res.status(400).json({ error: "Too long." });
        try { await setConsolePassword(pw); }
        catch (error) {
            if (error.status !== 503) throw error;
            return res.set("Retry-After", "2").status(503).json({ error: "Password service busy; retry shortly." });
        }
        res.json({ ok: true, set: true });
    });
}
