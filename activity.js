// Activity feed → Discord webhook.
// Buffers events from across the app (AI API, in-app AI, VM sessions) and flushes
// them on a timer as ONE grouped message with a **bold** header per section, so
// the owner gets a readable running log instead of one webhook POST per request
// (which would trip Discord's ~30/min webhook rate limit almost immediately).
//
// Configure the destination with NOCTURNE_LOG_WEBHOOK, or put the URL in
// data/log-webhook. If neither is set, logActivity() is a cheap no-op and nothing
// is sent — the rest of the app is unaffected.
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { stmts } from "./db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function loadWebhook() {
    const env = (process.env.NOCTURNE_LOG_WEBHOOK || "").trim();
    if (env) return env;
    try {
        return fs.readFileSync(path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "log-webhook"), "utf8").trim();
    } catch { return ""; }
}
const WEBHOOK_URL = loadWebhook();

// Section key → display header (in the order they appear in the message).
const SECTIONS = [
    ["ai_api", "AI API"],
    ["ai_app", "AI (app)"],
    ["vm",     "VMs"],
];
const SECTION_KEYS = new Set(SECTIONS.map(s => s[0]));

const FLUSH_MS = 3_000;              // one webhook post at most every 3s
const MAX_BUFFER = 300;              // hard cap so a burst can't grow memory unbounded
const MAX_LINES_PER_SECTION = 15;    // trim noisy sections; a "…and N more" tail is added
const CONTENT_LIMIT = 1900;          // stay under Discord's 2000-char content cap

const buffer = [];   // { category, line }

// Neutralize Discord markdown/mention injection from any user-derived text.
function safe(s) {
    return String(s == null ? "" : s)
        .replace(/`/g, "'")
        .replace(/@/g, "@​")      // break @everyone / @here / <@id>
        .slice(0, 120);
}

// userId → username, cached so the hot AI path doesn't hit the DB every request.
const nameCache = new Map();
function usernameFor(userId, provided) {
    if (provided) { nameCache.set(userId, provided); return provided; }
    if (userId == null) return "anon";
    if (nameCache.has(userId)) return nameCache.get(userId);
    let name = "user " + userId;
    try { const u = stmts.findUserById.get(userId); if (u && u.username) name = u.username; } catch {}
    nameCache.set(userId, name);
    return name;
}

// Read the device-fingerprint cookie (noct_fp) set client-side by df5162.js.
export function fpFromReq(req) {
    try {
        const m = /(?:^|;\s*)noct_fp=([A-Za-z0-9]{4,64})/.exec(req.headers?.cookie || "");
        return m ? m[1] : null;
    } catch { return null; }
}

// Append identity/meta (IP, fingerprint) shared by every section.
function metaSuffix(f) {
    const meta = [];
    if (f.ip) meta.push("IP " + safe(f.ip));
    if (f.fp) meta.push("FP `" + safe(f.fp) + "`");
    return meta.length ? " · " + meta.join(" · ") : "";
}

// Format one event into a single Discord line for its section.
function formatLine(category, f) {
    const who = "`" + safe(usernameFor(f.userId, f.username)) + "`";
    const meta = metaSuffix(f);
    if (category === "vm") {
        return `${f.action || "accessed"} · ${who}${meta}`;
    }
    // ai_api / ai_app
    const code = f.status != null ? f.status : "?";
    const badge = (f.ok === false || (typeof code === "number" && code >= 400)) ? "❌" : "✅";
    const model = f.model ? " `" + safe(f.model) + "`" : "";
    const bits = [];
    if (f.tokens != null) bits.push(f.tokens + " tok");
    if (f.latencyMs != null) bits.push(f.latencyMs + "ms");
    const tail = bits.length ? " · " + bits.join(" · ") : "";
    return `${badge} ${code}${model} · ${who}${tail}${meta}`;
}

/**
 * Post a standalone alert to the feed immediately (not batched). Use sparingly —
 * for state-change notices like a provider going down/recovering, not per-request
 * events. No-op when no webhook is configured. Fire-and-forget.
 */
export async function sendAlert(content) {
    if (!WEBHOOK_URL || !content) return;
    try {
        await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: "Nocturne Activity", allowed_mentions: { parse: [] }, content: String(content).slice(0, 2000) }),
        });
    } catch (e) {
        console.warn("[activity alert] failed:", e.message);
    }
}

/**
 * Record one activity event. Categories: "ai_api", "ai_app", "vm".
 * fields: { userId, username, ip, fp, status, ok, model, tokens, latencyMs, action }
 * No-op when no webhook is configured.
 */
export function logActivity(category, fields = {}) {
    if (!WEBHOOK_URL) return;
    if (!SECTION_KEYS.has(category)) return;
    try {
        const line = formatLine(category, fields);
        if (buffer.length >= MAX_BUFFER) buffer.shift();
        buffer.push({ category, line });
    } catch { /* never let logging throw into a request path */ }
}

function buildContent(batch) {
    const grouped = {};
    for (const e of batch) (grouped[e.category] ||= []).push(e.line);
    let content = "";
    for (const [key, label] of SECTIONS) {
        const lines = grouped[key];
        if (!lines || !lines.length) continue;
        const shown = lines.slice(-MAX_LINES_PER_SECTION);
        const hidden = lines.length - shown.length;
        let block = `**${label}**` + (lines.length > 1 ? ` (${lines.length})` : "") + "\n";
        block += shown.join("\n") + "\n";
        if (hidden > 0) block += `…and ${hidden} more\n`;
        block += "\n";
        if (content.length + block.length > CONTENT_LIMIT) { content += "…(truncated)"; break; }
        content += block;
    }
    return content.trim();
}

async function flush() {
    if (!WEBHOOK_URL || !buffer.length) return;
    const batch = buffer.splice(0, buffer.length);
    const content = buildContent(batch);
    if (!content) return;
    try {
        const r = await fetch(WEBHOOK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                username: "Nocturne Activity",
                allowed_mentions: { parse: [] },
                content: content.slice(0, 2000),
            }),
        });
        if (!r.ok) console.warn("[activity webhook] non-2xx", r.status);
    } catch (e) {
        console.warn("[activity webhook] failed:", e.message);
    }
}

if (WEBHOOK_URL) {
    setInterval(() => { flush().catch(() => {}); }, FLUSH_MS).unref();
    console.log("[activity] Discord activity feed enabled (AI API · AI app · VMs)");
}
