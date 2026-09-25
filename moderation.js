import { stmts } from "./db.js";
import { authMiddleware } from "./auth.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Discord support webhook: env first, else data/support-webhook (one URL).
// Empty => postSupportToDiscord no-ops (messages are still saved to the DB).
function loadSupportWebhook() {
    const env = (process.env.NOCTURNE_SUPPORT_WEBHOOK || "").trim();
    if (env) return env;
    try {
        const f = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "support-webhook");
        return fs.readFileSync(f, "utf8").trim();
    } catch { return ""; }
}
const SUPPORT_WEBHOOK_URL = loadSupportWebhook();

async function postSupportToDiscord({ id, subject, body, username, userId }) {
    if (!SUPPORT_WEBHOOK_URL) return;
    const fields = [];
    // Escape backticks so a crafted username can't break out of the code span and
    // inject Discord markdown into the support channel (defense-in-depth; usernames
    // are already charset-restricted at signup).
    const safeUser = String(username || "").replace(/`/g, "'");
    if (username) fields.push({ name: "User", value: `\`${safeUser}\`` + (userId ? ` (id ${userId})` : ""), inline: true });
    else fields.push({ name: "User", value: "anonymous", inline: true });
    if (id) fields.push({ name: "Message ID", value: String(id), inline: true });

    const payload = {
        username: "Nocturne Support",
        // Never let report content turn into pings (@everyone / role / user mentions).
        allowed_mentions: { parse: [] },
        embeds: [{
            title: subject ? subject.slice(0, 240) : "(no subject)",
            description: body.slice(0, 4000),
            color: 0xb8b0da,
            fields,
            timestamp: new Date().toISOString()
        }]
    };
    try {
        const r = await fetch(SUPPORT_WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (!r.ok) {
            const text = await r.text().catch(() => "");
            console.warn("[support webhook] non-2xx", r.status, text.slice(0, 200));
        }
    } catch (e) {
        console.warn("[support webhook] failed:", e.message);
    }
}

const CSAM_PATTERNS = [
    /\bcsam\b/i,
    /\bcp\b/i,
    /\bchild\s*porn(?:ography)?\b/i,
    /\bchild\s*(?:sexual\s*)?abuse\s*material\b/i,
    /\bunderage\s*(?:porn|sex|nud)/i,
    /\bunder[\s-]?age\s*girls?\b/i,
    /\b(?:loli(?:con|s)?|shotacon|toddlercon)\b/i,
    /\b(?:preteen|kiddie|kiddy)\s*(?:porn|sex|nud)/i,
    /\bchildren\s*(?:porn|sex|nud)/i,
    /\bjailbait\b/i,
    /\bpedo(?:phile|philia)?\b/i,
    /\bnepi(?:ophile|ophilia)?\b/i,
    /\bmin(?:or|ors)\s*(?:porn|sex|nud)/i,
    /\bbarely\s*(?:legal|18)/i,
    /\bpthc\b/i,
    /\bhebephil(?:e|ia)?\b/i
];

function detectCsam(query) {
    const q = String(query || "").toLowerCase();
    for (const re of CSAM_PATTERNS) {
        if (re.test(q)) return true;
    }
    return false;
}

// Per-IP rate limit for support submissions: each one writes a DB row AND fires
// the Discord webhook, so without a cap an attacker can flood the support channel
// (and trip Discord's own webhook limit, disabling real support) and bloat the DB.
const SUPPORT_MAX = Number(process.env.NOCTURNE_SUPPORT_RPH) || 6;   // per IP per window
const SUPPORT_WINDOW_MS = 10 * 60_000;
const _supportBuckets = new Map();
function supportClientIp(req) { return req.ip || req.socket?.remoteAddress || ""; }
function supportRateOk(ip) {
    if (!ip) return true;
    const now = Date.now();
    let b = _supportBuckets.get(ip);
    if (!b || now - b.start > SUPPORT_WINDOW_MS) { b = { start: now, count: 0 }; _supportBuckets.set(ip, b); }
    if (b.count >= SUPPORT_MAX) return false;
    b.count++; return true;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of _supportBuckets) if (now - b.start > SUPPORT_WINDOW_MS) _supportBuckets.delete(k); }, SUPPORT_WINDOW_MS).unref();

export function mountModeration(app) {
    app.post("/api/moderation/check", authMiddleware, (req, res) => {
        const query = typeof req.body?.query === "string" ? req.body.query.slice(0, 2000) : "";
        if (!query) return res.status(400).json({ error: "query required" });

        if (detectCsam(query)) {
            return res.json({
                blocked: true,
                reason: "This search is blocked. Nocturne does not allow searches that may relate to child sexual abuse material."
            });
        }

        res.json({ blocked: false });
    });

    app.post("/api/support/message", authMiddleware, (req, res) => {
        if (!supportRateOk(supportClientIp(req))) {
            res.setHeader("Retry-After", "600");
            return res.status(429).json({ error: "You've sent several messages already — please wait a bit before sending more." });
        }
        const subject = (req.body?.subject || "").toString().trim().slice(0, 200);
        const body = (req.body?.body || "").toString().trim().slice(0, 4000);
        if (!body) return res.status(400).json({ error: "Message body required" });

        const userId = req.user?.id || null;
        const username = req.user?.username || null;

        try {
            const info = stmts.supportInsert.run(userId, username, null, subject || null, body, Date.now());
            res.json({ ok: true });
            postSupportToDiscord({
                id: info && info.lastInsertRowid,
                subject,
                body,
                username,
                userId
            });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });
}
