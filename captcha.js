// Self-hosted Cap proof-of-work captcha (https://github.com/tiagozip/cap) for the accounts
// system. Same idea as the ALTCHA widget it replaces — a client must burn real CPU on a
// SHA-256 challenge we sign and verify ourselves, so scripted signup/login floods get
// expensive instead of merely throttled — but Cap splits the work into many small puzzles
// solved in parallel Web Workers with a WASM solver, which is quicker for a real visitor and
// costlier to fake at scale.
//
// We build on capjs-core rather than Cap Standalone: Standalone is a separate Docker service
// backed by Redis, while capjs-core is a stateless library that drops straight into this
// Express app. That keeps the promise made in privacy.md — the challenge is generated and
// verified entirely by our own server and nothing about the visitor goes to an outside
// service. The state Standalone would keep in Redis (redeem nonces and issued tokens) lives
// in the in-memory maps below, mirroring how the rest of this app handles abuse counters:
// nothing captcha-related is ever written to a database or a log we control.
//
// Proof-of-work only. Cap's optional "instrumentation" layer is deliberately left off: it
// probes the browser environment to spot automation, which risks locking out the hardened and
// uncommon browsers a lot of Nocturne's users are on, and its decompression path can fall back
// to fetching pako from a CDN — exactly the third-party request we're avoiding. To enable it
// later, pass `instrumentation: true` to generateChallenge, forward `instr` from the redeem
// body into validateChallenge, and self-host pako via window.CAP_PAKO_URL.
import { generateChallenge, validateChallenge } from "capjs-core";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Master secret; signs the challenge JWTs and so decides whether a solution is ours. Comes
// from NOCTURNE_CAP_SECRET when set; otherwise generated once and persisted to data/cap-secret
// (mode 0600, gitignored), mirroring how the owner password is handled in auth.js. Changing it
// invalidates challenges that are mid-flight, nothing worse — the widget just re-solves.
function loadSecret() {
    if (process.env.NOCTURNE_CAP_SECRET) return process.env.NOCTURNE_CAP_SECRET;
    const file = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "cap-secret");
    try {
        const existing = fs.readFileSync(file, "utf8").trim();
        if (existing) return existing;
    } catch {}
    const generated = crypto.randomBytes(32).toString("hex");
    try {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        fs.writeFileSync(file, generated + "\n", { mode: 0o600 });
        console.log(`[cap] no NOCTURNE_CAP_SECRET set — generated a random secret, saved to ${file}`);
    } catch (e) {
        console.warn("[cap] could not persist generated secret:", e.message);
    }
    return generated;
}
const SECRET = loadSecret();

// Bound into every challenge and re-checked on redeem, so a token minted here can only ever be
// spent on the auth routes even if another captcha-protected flow is added later.
const SCOPE = "auth";

// Cap's stock difficulty: 50 puzzles of 4 hex digits each. About a second of work in a browser
// with the WASM solver, a few seconds on the pure-JS fallback path.
const CHALLENGE_COUNT = 50;
const CHALLENGE_SIZE = 32;
const CHALLENGE_DIFFICULTY = 4;

// Two clocks: how long the visitor has to solve and redeem a challenge (the widget starts
// solving the moment the form renders, so this only has to cover the solve), and how long the
// resulting token stays spendable while they actually type their credentials.
const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const TOKEN_TTL_MS = 20 * 60 * 1000;

// Backstop against unbounded growth. Every entry costs the client a solved challenge, so this
// is a memory ceiling rather than the actual anti-flood defence.
const MAX_ENTRIES = 50_000;

const nonces = new Map();   // challenge signature -> expiry; stops one challenge being redeemed twice
const tokens = new Map();   // token key -> expiry; one solved challenge buys one signup/login

function sweep(map) {
    const now = Date.now();
    for (const [key, expires] of map) if (expires <= now) map.delete(key);
}
setInterval(() => { sweep(nonces); sweep(tokens); }, 60_000).unref();

// Returns false only if the map is genuinely full after a sweep, which fails the request
// closed rather than letting memory grow.
function hasRoom(map) {
    if (map.size < MAX_ENTRIES) return true;
    sweep(map);
    return map.size < MAX_ENTRIES;
}

// capjs-core's replay guard: it hands us the challenge's signature and the TTL to remember it
// for, and expects set-if-not-exists semantics (Redis SET NX EX in the Standalone build).
async function consumeNonce(sigHex, ttlMs) {
    if (nonces.has(sigHex)) return false;
    if (!hasRoom(nonces)) return false;
    nonces.set(sigHex, Date.now() + ttlMs);
    return true;
}

// capjs-core issues the client `id:secret` and expects us to store `id:sha256(secret)`, so the
// spendable token itself never sits in our memory.
function tokenKeyFor(token) {
    const sep = token.indexOf(":");
    if (sep <= 0) return null;
    const id = token.slice(0, sep);
    const secret = token.slice(sep + 1);
    if (!secret) return null;
    return `${id}:${crypto.createHash("sha256").update(secret).digest("hex")}`;
}

const WIDGET_JS = path.join(__dirname, "node_modules/cap-widget/cap.min.js");
const WIDGET_WASM = path.join(__dirname, "node_modules/@cap.js/wasm/browser/cap_wasm_bg.wasm");

// The stock widget fetches its WASM solver from jsDelivr. Point it at our own copy — prepended
// to the bundle so it's set before the widget reads it — so serving the captcha never involves
// a third-party host. If this file is missing the widget just falls back to its JS solver.
let widgetBundle = null;
function getWidgetBundle() {
    if (widgetBundle === null) {
        widgetBundle = 'window.CAP_CUSTOM_WASM_URL="/cap.wasm";\n' + fs.readFileSync(WIDGET_JS, "utf8");
    }
    return widgetBundle;
}

export function mountCaptcha(app) {
    // The widget POSTs here for a challenge, then POSTs the solutions to /redeem — both paths
    // are driven by the widget itself, not by our page code.
    app.post("/api/captcha/challenge", async (req, res) => {
        try {
            const challenge = await generateChallenge(SECRET, {
                scope: SCOPE,
                challengeCount: CHALLENGE_COUNT,
                challengeSize: CHALLENGE_SIZE,
                challengeDifficulty: CHALLENGE_DIFFICULTY,
                expiresMs: CHALLENGE_TTL_MS
            });
            res.set("Cache-Control", "no-store");
            res.json(challenge);
        } catch (e) {
            res.status(500).json({ error: "Could not create a captcha challenge." });
        }
    });

    app.post("/api/captcha/redeem", async (req, res) => {
        res.set("Cache-Control", "no-store");
        let result;
        try {
            result = await validateChallenge(
                SECRET,
                { token: req.body?.token, solutions: req.body?.solutions },
                { scope: SCOPE, tokenTtlMs: TOKEN_TTL_MS, consumeNonce }
            );
        } catch (e) {
            return res.status(500).json({ success: false, error: "Captcha verification failed." });
        }
        // Deliberately vague to the client: the specific reason (expired, replayed, wrong
        // solution) is useful to someone probing the endpoint and useless to a real visitor,
        // whose widget just resets and solves again.
        if (!result.success) {
            return res.status(400).json({ success: false, error: "Captcha verification failed — please try again." });
        }
        if (!hasRoom(tokens)) {
            return res.status(503).json({ success: false, error: "Captcha is busy — try again in a moment." });
        }
        tokens.set(result.tokenKey, result.expires);
        res.json({ success: true, token: result.token, expires: result.expires });
    });

    // Self-hosted widget script and solver — no third-party CDN in the loop.
    app.get("/cap.js", (req, res) => {
        res.set("Cache-Control", "public, max-age=3600");
        res.type("application/javascript");
        try { res.send(getWidgetBundle()); }
        catch { if (!res.headersSent) res.status(404).end(); }
    });

    app.get("/cap.wasm", (req, res) => {
        res.type("application/wasm");
        res.sendFile(WIDGET_WASM, err => { if (err && !res.headersSent) res.status(404).end(); });
    });
}

// Verifies the token the widget produced (what the client sends as `captcha`). Tokens are
// single-use: a successful check consumes it, so one solved challenge buys exactly one
// signup/login attempt and a captured token can't be replayed. Returns false for anything
// missing, malformed, unknown or expired.
export async function verifyCaptcha(token) {
    if (!token || typeof token !== "string" || token.length > 256) return false;
    const key = tokenKeyFor(token);
    if (!key) return false;
    const expires = tokens.get(key);
    if (expires === undefined) return false;
    tokens.delete(key);
    return expires > Date.now();
}
