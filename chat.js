import { rejectBlockedChatText } from "./chat-moderation.js";
import fs from "fs";
import path from "path";
import dns from "node:dns/promises";
import net from "node:net";
import { fileURLToPath } from "url";
import { db, stmts } from "./db.js";
import { createHistoryLoader } from "./chat-history.js";
import { writeChatEvent, attachChatStream } from "./chat-stream.js";
const loadHistory = createHistoryLoader(db);
import { scoreMessageRisk, moderationConfigured } from "./groq.js";
import { filterProfanity } from "./profanity.js";
import { isOwnerName } from "./auth.js";
import { clientIp } from "./ip.js";
import { holdVisitor } from "./presence.js";
import {
    getGemConfig, setGemConfig, getBalance, setBalance, addGems,
    getLeaderboard, getEconomyStats, DAILY_TIERS,
    claimDaily, claimBeg, giftGems,
    playCoinflip, playSlots, playDice, playBlackjack, playRoulette,
    getCrashState, startCrash, cashoutCrash, onCrashSettled, armCrashRounds
} from "./economy.js";

// ── Chat roles & presence ────────────────────────────────────────────────────
const PERM_RANK = { member: 0, mod: 1, admin: 2, owner: 3 };
const PERM_COLOR = { owner: "#e6c976", admin: "#ff8f8f", mod: "#87b4ff", member: null };
function roleInfo(row) {
    let perm = (row.chat_perm || "member").toLowerCase();
    if (isOwnerName(row.username)) perm = "owner";
    if (!(perm in PERM_RANK)) perm = "member";
    const role = row.chat_role || (perm !== "member" ? perm.charAt(0).toUpperCase() + perm.slice(1) : null);
    const roleColor = row.role_color || PERM_COLOR[perm] || null;
    return { perm, role, roleColor, rank: PERM_RANK[perm] };
}
function canModerate(user) {
    if (!user) return false;
    if (isOwnerName(user.username)) return true;
    try { const r = stmts.getChatRole.get(user.id); return r && PERM_RANK[(r.chat_perm || "member").toLowerCase()] >= PERM_RANK.mod; }
    catch { return false; }
}

// Presence: userId -> { status: 'online'|'idle'|'dnd'|'invisible', last }
const presence = new Map();
function setPresence(userId, status) {
    if (!["online", "idle", "dnd", "invisible"].includes(status)) status = "online";
    presence.set(userId, { status, last: Date.now() });
}
function presenceOf(userId) {
    const online = userSubs.has(userId);
    const p = presence.get(userId);
    if (!online) return "offline";
    return (p && p.status) || "online";
}

// Notify @-mentioned users on their personal SSE feed. Supports @everyone / @here
// (pings all online users) and up to 10 specific @usernames per message.
const MENTION_RE = /@([a-zA-Z0-9_-]{3,32}|everyone|here)/g;
function notifyMentions(text, room, msg, sender) {
    const names = new Set();
    let everyone = false, m;
    MENTION_RE.lastIndex = 0;
    while ((m = MENTION_RE.exec(String(text)))) {
        const name = m[1].toLowerCase();
        if (name === "everyone" || name === "here") everyone = true;
        else if (names.size < 10) names.add(name);
    }
    const preview = String(text).slice(0, 120);
    const base = { type: "mention", room, from: sender.username, messageId: msg.id, preview };
    if (everyone) {
        for (const uid of userSubs.keys()) if (uid !== sender.id) pushToUser(uid, { ...base, everyone: true });
        return;
    }
    for (const name of names) {
        const u = stmts.findUserByName.get(name);
        if (u && u.id !== sender.id) pushToUser(u.id, base);
    }
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Expand any URLs in a message into readable words (de-slugged hostname + path),
// so the moderation AI / profanity filter can catch slurs hidden inside a link
// like "site.com/n-word-page". Returns extra text used ONLY for scoring.
function deslugUrls(text) {
    const urls = String(text || "").match(/\bhttps?:\/\/[^\s]+/gi);
    if (!urls) return "";
    let out = "";
    for (const u of urls.slice(0, 5)) {
        try { const p = new URL(u); let dec = ""; try { dec = decodeURIComponent(p.pathname + " " + p.search); } catch { dec = p.pathname + " " + p.search; } out += " " + p.hostname + " " + dec; }
        catch { out += " " + u; }
    }
    return out.replace(/[^a-zA-Z0-9]+/g, " ").trim();
}

// Mask profanity in `text` but leave any URLs untouched (so links don't break).
function maskTextKeepUrls(text) {
    const re = /\bhttps?:\/\/[^\s]+/gi;
    let out = "", last = 0, m;
    while ((m = re.exec(text))) {
        out += filterProfanity(text.slice(last, m.index), { mask: true, blockSlurs: false }).clean + m[0];
        last = m.index + m[0].length;
    }
    out += filterProfanity(text.slice(last), { mask: true, blockSlurs: false }).clean;
    return out;
}

// Public chat rooms. Whitelisted so users can't spam arbitrary rooms.
// `lenient` channels (Vent) skip cuss-word masking and use a higher AI threshold,
// but still hard-block slurs/hate and the worst content.
const ROOMS = [
    { id: "general", label: "General" },
    { id: "gaming",  label: "Gaming" },
    { id: "cheats",  label: "Cheats" },
    { id: "vent",    label: "Vent", lenient: true }
];
const ROOM_IDS = new Set(ROOMS.map(r => r.id));
const DEFAULT_ROOM = "general";

// Block any message the safety AI scores OVER this (0-100). 75 per spec.
const RISK_BLOCK_THRESHOLD = 75;
const VENT_THRESHOLD = 85;
const MAX_LEN = 1000;

function roomPolicy(roomId) {
    const r = ROOMS.find(x => x.id === roomId);
    if (r && r.lenient) return { mask: false, blockSlurs: true, threshold: VENT_THRESHOLD };
    return { mask: true, blockSlurs: true, threshold: RISK_BLOCK_THRESHOLD };
}

// ── Giphy (GIF picker) ──────────────────────────────────────────────────────
function loadGiphyKey() {
    const env = (process.env.GIPHY_API_KEY || "").trim();
    if (env) return env;
    const dir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
    try { return fs.readFileSync(path.join(dir, "giphy-key"), "utf8").split(/[\r\n]+/).map(s => s.trim()).find(s => s && !s.startsWith("#")) || ""; }
    catch { return ""; }
}
const GIPHY_KEY = loadGiphyKey();

// Reaction emojis users can add to messages.
const REACTION_EMOJIS = ["\u{1F44D}", "❤️", "\u{1F602}", "\u{1F62E}", "\u{1F622}", "\u{1F525}", "\u{1F389}", "\u{1F44E}"];
const REACTION_SET = new Set(REACTION_EMOJIS);

function sanitizeRoom(r) {
    const v = String(r || "").toLowerCase().trim();
    return ROOM_IDS.has(v) ? v : DEFAULT_ROOM;
}

// Drop C0 control chars (keep tab=9 and newline=10) and DEL=127, collapse runs
// of blank lines / spaces, then trim. Char-code scan avoids control literals.
function stripControl(s) {
    let out = "";
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c === 9 || c === 10 || (c >= 32 && c !== 127)) out += s[i];
    }
    return out;
}

function cleanText(s) {
    return stripControl(String(s || "").replace(/\r\n/g, "\n").replace(/\r/g, "\n"))
        .replace(/\n{3,}/g, "\n\n")
        .replace(/[ \t]{2,}/g, " ")
        .trim();
}

// Validate an image field: data:image URL (size-capped) or an https:// URL.
function validateImageField(v, maxLen, label) {
    if (v == null || v === "") return { ok: true, value: null };
    if (typeof v !== "string") return { ok: false, error: "Invalid " + label + "." };
    if (/^data:image\/(png|jpe?g|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(v)) {
        const clean = v.replace(/\s+/g, "");
        if (clean.length > maxLen) return { ok: false, error: label + " is too large." };
        return { ok: true, value: clean };
    }
    if (/^https:\/\/[^\s]+$/i.test(v) && v.length <= 1024) return { ok: true, value: v };
    return { ok: false, error: "Use an uploaded image or an https:// URL for the " + label + "." };
}
const AVATAR_MAX = 1_500_000;     // resized client-side to 256px, generous cap
const IMAGE_MAX = 4_300_000;      // ~3MB image as a base64 data URL

// ── Live feed (Server-Sent Events) ──────────────────────────────────────────
const subscribers = new Map(); // room -> Set<res>

function addSub(room, res) {
    let set = subscribers.get(room);
    if (!set) { set = new Set(); subscribers.set(room, set); }
    set.add(res);
    return () => { set.delete(res); if (!set.size) subscribers.delete(room); };
}

function broadcast(room, obj) {
    const set = subscribers.get(room);
    if (!set || !set.size) return;
    const payload = "data: " + JSON.stringify(obj) + "\n\n";
    for (const res of set) { writeChatEvent(res, payload); }
}

// Send to every subscriber in every room (used for avatar changes).
function broadcastAll(obj) {
    const payload = "data: " + JSON.stringify(obj) + "\n\n";
    for (const set of subscribers.values()) {
        for (const res of set) { writeChatEvent(res, payload); }
    }
}

// ── Per-user feed (for direct messages, independent of room) ────────────────
const userSubs = new Map(); // userId -> Set<res>
function addUserSub(userId, res) {
    let set = userSubs.get(userId);
    if (!set) { set = new Set(); userSubs.set(userId, set); }
    set.add(res);
    return () => { set.delete(res); if (!set.size) userSubs.delete(userId); };
}
function pushToUser(userId, obj) {
    const set = userSubs.get(userId);
    if (!set || !set.size) return;
    const payload = "data: " + JSON.stringify(obj) + "\n\n";
    for (const res of set) { writeChatEvent(res, payload); }
}

function convoKey(a, b) { return a < b ? a + ":" + b : b + ":" + a; }

// ── Per-sender rate limiting (min gap + short-window burst cap) ──────────────
const sendState = new Map();
const reactState = new Map();
const MIN_GAP_MS = 1200;
const BURST = 8;
const BURST_WINDOW_MS = 20_000;

function rateKey(req) { return req.user ? "u:" + req.user.id : "ip:" + clientIp(req); }

function checkSendRate(req) {
    const key = rateKey(req);
    const now = Date.now();
    let s = sendState.get(key);
    if (!s) { s = { last: 0, windowStart: now, count: 0 }; sendState.set(key, s); }
    if (now - s.last < MIN_GAP_MS) {
        return { ok: false, retryMs: MIN_GAP_MS - (now - s.last), reason: "You're sending messages too fast." };
    }
    if (now - s.windowStart > BURST_WINDOW_MS) { s.windowStart = now; s.count = 0; }
    if (s.count >= BURST) {
        return { ok: false, retryMs: BURST_WINDOW_MS - (now - s.windowStart), reason: "Slow down for a moment." };
    }
    s.last = now;
    s.count += 1;
    return { ok: true };
}

function checkReactRate(req) {
    const key = rateKey(req);
    const now = Date.now();
    let s = reactState.get(key);
    if (!s || now - s.start > 10_000) { s = { start: now, count: 0 }; reactState.set(key, s); }
    if (s.count >= 40) return false;
    s.count += 1;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [k, s] of sendState) if (now - s.last > 5 * 60_000) sendState.delete(k);
    for (const [k, s] of reactState) if (now - s.start > 60_000) reactState.delete(k);
}, 5 * 60_000).unref();

// ── Message serialization ───────────────────────────────────────────────────
function replyPreview(replyToId) {
    if (!replyToId) return null;
    const r = stmts.chatGetById.get(replyToId);
    if (!r) return null;
    return {
        id: r.id,
        username: r.username,
        text: r.deleted ? null : String(r.text || "").slice(0, 140),
        deleted: !!r.deleted
    };
}

function reactionsFor(messageId, userId) {
    const rows = stmts.chatReactList.all(messageId);
    if (!rows.length) return {};
    const map = {};
    for (const r of rows) {
        if (!map[r.emoji]) map[r.emoji] = { count: 0, me: false };
        map[r.emoji].count++;
        if (userId != null && r.user_id === userId) map[r.emoji].me = true;
    }
    return map;
}

function reactionCounts(messageId) {
    const rows = stmts.chatReactList.all(messageId);
    const map = {};
    for (const r of rows) map[r.emoji] = (map[r.emoji] || 0) + 1;
    return map;
}

function serialize(row, userId, batch) {
    return {
        id: row.id,
        room: row.room,
        userId: row.user_id,
        username: row.username,
        avatar: row.avatar || null,
        text: row.deleted ? null : row.text,
        deleted: !!row.deleted,
        ts: row.created_at,
        edited: !!row.edited_at,
        replyTo: batch ? (batch.preview.get(row.reply_to) || null) : replyPreview(row.reply_to),
        fwd: row.fwd_user ? { username: row.fwd_user, room: row.fwd_room } : null,
        reactions: batch ? (batch.grouped.get(row.id) || {}) : reactionsFor(row.id, userId),
        ...(() => { const r = roleInfo(row); return { perm: r.perm, role: r.role, roleColor: r.roleColor }; })()
    };
}

// Compassionate, non-judgemental note shown when a message is blocked for
// self-harm. We block the public post but point the person to real help.
function supportInfoFor(category) {
    if (category === "self_harm") {
        return "It sounds like you might be going through something really hard, and you don't have to face it alone. If you're in the US, call or text 988 (Suicide & Crisis Lifeline) any time, or chat at 988lifeline.org. Outside the US, you can find a local helpline at findahelpline.com.";
    }
    return "";
}

// Content gate for chat messages.
// Returns { blocked, score, category, reason, support, clean }; `clean` is the
// text to store (never masked now).

function nsfwBlocked(text) {
    const n = text
        .replace(/[​‌‍‎‏﻿]/g, "")
        .replace(/(?<=\b[a-z])\s+(?=[a-z]\b)/gi, "")
        .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e")
        .replace(/4/g, "a").replace(/5/g, "s").replace(/\$/g, "s")
        .replace(/@/g, "a").replace(/\+/g, "t")
        .toLowerCase();

    const W = /\b(?:porn(?:o|ography|hub|star)?|sex(?:ting|ual(?:ly)?|iest|y)?|hentai|xxx+|nsfw|nude(?:s|ity)?|naked|boob(?:s|ies)?|tit(?:s|ties)|blowjob|handjob|deepthroat|gangbang|threesome|creampie|bukkake|futanari|yaoi|yuri|ahegao|ecchi|milf|dildo|vibrator|fleshlight|orgasm|masturbat(?:e|ion|ing)|fap(?:ping)?|jerking\s*off|cum(?:shot|ming|med)?|squirt(?:ing)?|bondage|bdsm|femdom|cuckold|swingers|dogging|exhibitionist|voyeur|upskirt|camgirl|cam\s*girl|cam\s*boy|onlyfans|chaturbate|stripchat|livejasmin|bongacams|myfreecams|cam4|fapello)\b/;

    const D = /\b(?:pornhub|xvideos|xnxx|xhamster|redtube|youporn|tube8|spankbang|eporner|tnaflix|drtuber|beeg|brazzers|bangbros|realitykings|naughtyamerica|onlyfans|chaturbate|stripchat|livejasmin|bongacams|cam4|myfreecams|fapello|rule34|e621|gelbooru|danbooru|nhentai|hanime|hentaihaven|fakku|literotica|sexstories|motherless|efukt|omegle|camsoda|streamate|flirt4free|imlive|porntrex|4tube|sunporno|txxx|hqporner|daftsex|theporndude|freeones|kindgirls|metart|hegre|suicidegirls|mrskin)\b/;

    return W.test(n) || D.test(n);
}

function secretsBlocked(text) {
    const t = text.replace(/\s+/g, " ");
    if (/(?:my\s+)?password\s+is\s+\S+/i.test(t)) return true;
    if (/(?:my\s+)?(?:pass|pw|pwd)\s*[:=]\s*\S+/i.test(t)) return true;
    if (/(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|bearer)\s*[:=]\s*\S{8,}/i.test(t)) return true;
    if (/\b(?:sk|pk)[-_](?:live|test|prod)[_-]\w{10,}\b/.test(t)) return true;
    if (/\bghp_[A-Za-z0-9]{36,}\b/.test(t)) return true;
    if (/\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/.test(t)) return true;
    if (/\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\./i.test(t)) return true;
    if (/\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/.test(t)) return true;
    if (/\b\d{3}-\d{2}-\d{4}\b/.test(t)) return true;
    return false;
}

function hasPermission(username, minRank) {
    if (isOwnerName(username)) return true;
    try {
        const u = stmts.findUserByName.get(username);
        if (!u) return false;
        const r = roleInfo(u);
        return r.rank >= minRank;
    } catch { return false; }
}

async function gateText(text, opts = {}) {
    const { scan = "" } = opts;
    const checkText = scan ? (text + " " + scan) : text;

    if (nsfwBlocked(checkText)) {
        return {
            blocked: true,
            score: 100,
            category: "nsfw",
            reason: "That message was blocked. NSFW and pornographic content is not allowed.",
            support: "",
            clean: text
        };
    }

    if (secretsBlocked(checkText)) {
        return {
            blocked: true,
            score: 80,
            category: "secrets",
            reason: "That message looks like it contains a password, API key, or other sensitive info. Don't share secrets in chat.",
            support: "",
            clean: text
        };
    }

    let risk;
    try { risk = await scoreMessageRisk(checkText); }
    catch { risk = { score: 0, category: "none", reason: "", source: "error" }; }
    if (risk.category === "csam") {
        return {
            blocked: true,
            score: risk.score || 100,
            category: "csam",
            reason: "This message was blocked. Nocturne does not allow any content that may relate to child sexual abuse material.",
            support: "",
            clean: text
        };
    }
    return { blocked: false, score: risk.score | 0, category: risk.category || null, reason: "", support: "", clean: text };
}

// ── Owner bot commands: timeouts, purge, giveaways ──────────────────────────
function activeTimeout(userId) {
    try {
        const t = stmts.timeoutGet.get(userId);
        if (!t) return null;
        if (t.until <= Date.now()) { try { stmts.timeoutClear.run(userId); } catch {} return null; }
        return t;
    } catch { return null; }
}
function parseDuration(s) {
    const m = /^(\d+)\s*(s|sec|secs|second|seconds|m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days)$/i.exec(String(s || "").trim());
    if (!m) return null;
    const n = parseInt(m[1], 10); if (!(n > 0)) return null;
    const u = m[2].toLowerCase()[0];
    const mult = u === "s" ? 1000 : u === "m" ? 60000 : u === "h" ? 3600000 : 86400000;
    const ms = n * mult;
    return ms > 0 && ms <= 30 * 86400000 ? ms : null;   // cap at 30 days
}
function fmtDuration(ms) {
    const s = Math.round(ms / 1000);
    if (s < 60) return s + "s";
    const mn = Math.round(s / 60); if (mn < 60) return mn + "m";
    const h = Math.round(mn / 60); if (h < 48) return h + "h";
    return Math.round(h / 24) + "d";
}
function resolveTarget(name) {
    const clean = String(name || "").replace(/^@/, "").trim();
    if (!clean) return null;
    try { return stmts.userByNameLite.get(clean) || null; } catch { return null; }
}
function sysAnnounce(room, text) {
    broadcast(room, { type: "system", text: String(text).slice(0, 500), ts: Date.now() });
}
function gwPublic(gw) {
    let entries = 0;
    try { entries = stmts.gwEntryCount.get(gw.id).n; } catch {}
    return { id: gw.id, room: gw.room, prize: gw.prize, host: gw.host, endsAt: gw.ends_at, status: gw.status, winner: gw.winner_name || null, entries };
}
function drawGiveaway(gw) {
    let winner = null;
    try {
        const entries = stmts.gwEntries.all(gw.id);
        if (entries.length) winner = entries[Math.floor(Math.random() * entries.length)];
        stmts.gwClose.run(winner ? winner.user_id : null, winner ? winner.username : null, gw.id);
    } catch {}
    broadcast(gw.room, { type: "giveaway-end", id: gw.id, winner: winner ? winner.username : null, prize: gw.prize });
    sysAnnounce(gw.room, winner
        ? "🎉 Giveaway ended — **" + gw.prize + "** goes to @" + winner.username + "! Congrats!"
        : "🎉 Giveaway for **" + gw.prize + "** ended with no entries.");
    return winner;
}

// ── Direct-message serialization ────────────────────────────────────────────
function dmReplyPreview(replyToId) {
    if (!replyToId) return null;
    const r = stmts.dmGetById.get(replyToId);
    if (!r) return null;
    return { id: r.id, username: r.username, text: r.deleted ? null : String(r.text || "").slice(0, 140), deleted: !!r.deleted };
}
function serializeDm(row) {
    return {
        id: row.id, convo: row.convo_key, senderId: row.sender_id, recipientId: row.recipient_id,
        username: row.username, avatar: row.avatar || null,
        text: row.deleted ? null : row.text, deleted: !!row.deleted,
        ts: row.created_at, edited: !!row.edited_at, replyTo: dmReplyPreview(row.reply_to)
    };
}
function serializeThread(row) {
    return { otherId: row.other_id, username: row.other_username, avatar: row.avatar || null, lastText: row.last_text || null, lastTs: row.last_ts, unread: row.unread | 0 };
}

// Profanity-filter state for a DM convo, from `meId`'s perspective.
function dmFilterState(key, meId) {
    const s = stmts.dmSettingsGet.get(key);
    if (!s) return { off: false, pendingFromMe: false, pendingFromOther: false };
    return {
        off: !!s.filter_off,
        pendingFromMe: !s.filter_off && s.pending_by === meId,
        pendingFromOther: !s.filter_off && s.pending_by != null && s.pending_by !== meId
    };
}

// ── Link unfurling (SSRF-safe) ──────────────────────────────────────────────
function isPrivateIp(ip) {
    if (net.isIPv4(ip)) {
        const p = ip.split(".").map(Number);
        if (p[0] === 10 || p[0] === 127 || p[0] === 0) return true;
        if (p[0] === 169 && p[1] === 254) return true;
        if (p[0] === 172 && p[1] >= 16 && p[1] <= 31) return true;
        if (p[0] === 192 && p[1] === 168) return true;
        if (p[0] === 100 && p[1] >= 64 && p[1] <= 127) return true; // CGNAT
        if (p[0] >= 224) return true;
        return false;
    }
    if (net.isIPv6(ip)) {
        const l = ip.toLowerCase().replace(/^\[|\]$/g, "");
        if (l === "::1" || l === "::") return true;
        if (l.startsWith("fe80") || l.startsWith("fc") || l.startsWith("fd")) return true;
        if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
        return false;
    }
    return true;
}
async function safeFetchHtml(rawUrl, depth = 0) {
    if (depth > 4) return null;
    let u; try { u = new URL(rawUrl); } catch { return null; }
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    let addrs; try { addrs = await dns.lookup(u.hostname, { all: true }); } catch { return null; }
    if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) return null;
    const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), 5000);
    let r;
    try { r = await fetch(u.href, { signal: ac.signal, redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (compatible; NocturneBot/1.0; +link-preview)", "Accept": "text/html,application/xhtml+xml" } }); }
    catch { clearTimeout(timer); return null; }
    clearTimeout(timer);
    if (r.status >= 300 && r.status < 400) {
        const loc = r.headers.get("location"); if (!loc) return null;
        let next; try { next = new URL(loc, u.href).href; } catch { return null; }
        return safeFetchHtml(next, depth + 1);
    }
    if (!r.ok) return null;
    if (!/text\/html|application\/xhtml/i.test(r.headers.get("content-type") || "")) return null;
    try {
        const reader = r.body.getReader(); const dec = new TextDecoder("utf-8"); let html = "", received = 0;
        while (true) { const { done, value } = await reader.read(); if (done) break; received += value.length; html += dec.decode(value, { stream: true }); if (received > 512 * 1024) { try { await reader.cancel(); } catch {} break; } }
        return html;
    } catch { return null; }
}
function decodeEntities(s) {
    return String(s).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0*39;|&#x0*27;|&apos;/gi, "'").replace(/&nbsp;/g, " ").replace(/&#(\d+);/g, (_, n) => { try { return String.fromCharCode(+n); } catch { return ""; } });
}
function parseOg(html, baseUrl) {
    const meta = (prop) => {
        let m = html.match(new RegExp('<meta[^>]+(?:property|name)=["\']' + prop + '["\'][^>]*content=["\']([^"\']*)["\']', "i"));
        if (!m) m = html.match(new RegExp('<meta[^>]+content=["\']([^"\']*)["\'][^>]*(?:property|name)=["\']' + prop + '["\']', "i"));
        return m ? decodeEntities(m[1]).trim() : null;
    };
    const titleTag = (() => { const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i); return m ? decodeEntities(m[1]).trim() : null; })();
    let title = meta("og:title") || titleTag;
    let description = meta("og:description") || meta("description") || meta("twitter:description");
    let image = meta("og:image") || meta("og:image:url") || meta("twitter:image") || meta("twitter:image:src");
    const siteName = meta("og:site_name");
    if (image) { try { image = new URL(image, baseUrl).href; } catch { image = null; } }
    if (image && !/^https?:\/\//i.test(image)) image = null;
    return {
        title: title ? title.slice(0, 200) : null,
        description: description ? description.slice(0, 300) : null,
        image: image || null,
        siteName: siteName ? siteName.slice(0, 100) : null
    };
}

export function mountChat(app, { authMiddleware } = {}) {
    const auth = authMiddleware || ((req, res, next) => next());
    const need = (req, res) => { if (!req.user) { res.status(401).json({ error: "Sign in to use chat." }); return false; } return true; };

    app.get("/api/chat/info", auth, (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        let avatar = null;
        if (req.user) { try { avatar = stmts.profileGetAvatar.get(req.user.id)?.avatar || null; } catch {} }
        res.json({
            authenticated: !!req.user,
            username: req.user?.username || null,
            userId: req.user?.id || null,
            avatar,
            rooms: ROOMS,
            defaultRoom: DEFAULT_ROOM,
            moderation: moderationConfigured(),
            threshold: RISK_BLOCK_THRESHOLD,
            maxLength: MAX_LEN,
            reactionEmojis: REACTION_EMOJIS,
            giphy: false,
            imageMax: IMAGE_MAX,
            gems: req.user ? getBalance(req.user.id) : 0,
            me: req.user ? (() => { const r = stmts.getChatRole.get(req.user.id); const ri = roleInfo(r || { username: req.user.username }); return { perm: ri.perm, role: ri.role, roleColor: ri.roleColor, canModerate: ri.rank >= PERM_RANK.mod }; })() : null
        });
    });

    // ── Profile (avatar, banner, background, pronouns, bio) ───────────────────
    function publicProfile(u) {
        return { id: u.id, username: u.username, avatar: u.avatar || null, bio: u.bio || null, pronouns: u.pronouns || null, banner: u.banner || null, background: u.background || null, createdAt: u.created_at || 0 };
    }

    app.get("/api/chat/profile", auth, (req, res) => {
        if (!need(req, res)) return;
        try { const u = stmts.profileGetFull.get(req.user.id); res.json({ ok: true, profile: u ? publicProfile(u) : null }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get("/api/users/:id/profile", auth, (req, res) => {
        if (!need(req, res)) return;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Invalid id." });
        const u = stmts.profileGetFull.get(id);
        if (!u) return res.status(404).json({ error: "User not found." });
        res.setHeader("Cache-Control", "no-store");
        res.json({ ok: true, profile: publicProfile(u) });
    });

    app.post("/api/chat/profile", auth, (req, res) => {
        if (!need(req, res)) return;
        const b = req.body || {};
        const av = validateImageField(b.avatar, AVATAR_MAX, "avatar");
        if (!av.ok) return res.status(400).json({ error: av.error });
        const banner = validateImageField(b.banner, IMAGE_MAX, "banner");
        if (!banner.ok) return res.status(400).json({ error: banner.error });
        const bg = validateImageField(b.background, IMAGE_MAX, "background");
        if (!bg.ok) return res.status(400).json({ error: bg.error });
        const bio = typeof b.bio === "string" ? stripControl(b.bio).slice(0, 500).trim() : null;
        const pronouns = typeof b.pronouns === "string" ? b.pronouns.replace(/[^\w\s/+-]/g, "").slice(0, 40).trim() : null;
        try {
            stmts.profileSetAll.run(av.value, bio || null, pronouns || null, banner.value, bg.value, req.user.id);
            broadcastAll({ type: "avatar", userId: req.user.id, avatar: av.value });
            res.json({ ok: true, profile: publicProfile({ id: req.user.id, username: req.user.username, avatar: av.value, bio, pronouns, banner: banner.value, background: bg.value }) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── GIF search (Giphy proxy; key stays server-side, results cached) ──────
    const giphyCache = new Map(); // key -> { at, gifs }
    const GIPHY_CACHE_TTL = 5 * 60 * 1000;
    app.get("/api/giphy/search", auth, async (req, res) => {
        return res.status(403).json({ error: "GIFs have been disabled." });
        if (!need(req, res)) return;
        if (!GIPHY_KEY) return res.status(503).json({ error: "GIFs aren't configured on this server." });
        const q = String(req.query.q || "").slice(0, 100).trim().toLowerCase();
        const cacheKey = q || "__trending__";
        const cached = giphyCache.get(cacheKey);
        if (cached && Date.now() - cached.at < GIPHY_CACHE_TTL) {
            res.setHeader("Cache-Control", "private, max-age=120");
            return res.json({ ok: true, gifs: cached.gifs, cached: true });
        }
        const base = q ? "https://api.giphy.com/v1/gifs/search" : "https://api.giphy.com/v1/gifs/trending";
        const url = base + "?api_key=" + encodeURIComponent(GIPHY_KEY) + (q ? "&q=" + encodeURIComponent(q) : "") + "&limit=24&rating=pg-13&bundle=messaging_non_clips";
        try {
            const r = await fetch(url);
            // On rate-limit or upstream error, fall back to any stale cache so the
            // grid never goes blank; otherwise return a clear message.
            if (!r.ok) {
                if (cached) { res.setHeader("Cache-Control", "private, max-age=60"); return res.json({ ok: true, gifs: cached.gifs, cached: true }); }
                if (r.status === 429) return res.status(429).json({ error: "GIFs are busy right now (rate limit). Try again in a minute." });
                return res.status(502).json({ error: "GIF search failed." });
            }
            const data = await r.json();
            const gifs = (data.data || []).map(g => ({
                id: g.id,
                url: (g.images && (g.images.downsized_medium || g.images.downsized || g.images.original) || {}).url,
                preview: (g.images && (g.images.fixed_width_small || g.images.preview_gif || g.images.downsized_still) || {}).url,
                title: g.title || "GIF"
            })).filter(g => g.url && /^https:\/\/[\w.-]*\.giphy\.com\//.test(g.url));
            if (gifs.length) { giphyCache.set(cacheKey, { at: Date.now(), gifs }); if (giphyCache.size > 200) giphyCache.delete(giphyCache.keys().next().value); }
            res.setHeader("Cache-Control", "private, max-age=120");
            res.json({ ok: true, gifs });
        } catch {
            if (cached) return res.json({ ok: true, gifs: cached.gifs, cached: true });
            res.status(502).json({ error: "GIF search failed." });
        }
    });

    // ── Favorite GIFs (saved per user) ───────────────────────────────────────
    const isGiphyUrl = u => typeof u === "string" && u.length <= 1024 && /^https:\/\/[\w.-]*\.giphy\.com\//.test(u);
    app.get("/api/giphy/favorites", auth, (req, res) => {
        if (!need(req, res)) return;
        try { res.setHeader("Cache-Control", "no-store"); res.json({ ok: true, favorites: stmts.gifFavList.all(req.user.id, 200) }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.post("/api/giphy/favorites", auth, (req, res) => {
        if (!need(req, res)) return;
        const b = req.body || {};
        const gifId = String(b.gif_id || b.id || "").slice(0, 128);
        if (!gifId) return res.status(400).json({ error: "Missing GIF id." });
        if (!isGiphyUrl(b.url)) return res.status(400).json({ error: "Invalid GIF." });
        const preview = isGiphyUrl(b.preview) ? b.preview : null;
        const title = typeof b.title === "string" ? b.title.slice(0, 200) : null;
        try {
            if ((stmts.gifFavCount.get(req.user.id)?.n || 0) >= 200 && !stmts.gifFavList.all(req.user.id, 200).some(f => f.gif_id === gifId)) {
                return res.status(429).json({ error: "Favorites are full (200). Remove some first." });
            }
            stmts.gifFavAdd.run(req.user.id, gifId, b.url, preview, title, Date.now());
            res.json({ ok: true });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });
    app.delete("/api/giphy/favorites/:gifId", auth, (req, res) => {
        if (!need(req, res)) return;
        try { stmts.gifFavDelete.run(req.user.id, String(req.params.gifId || "").slice(0, 128)); res.json({ ok: true }); }
        catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Link preview (unfurl OG metadata for embeds) ─────────────────────────
    const unfurlCache = new Map();
    const UNFURL_TTL = 60 * 60 * 1000;
    const unfurlRate = new Map();
    app.get("/api/chat/unfurl", auth, async (req, res) => {
        if (!need(req, res)) return;
        const raw = String(req.query.url || "");
        if (!/^https?:\/\//i.test(raw) || raw.length > 2048) return res.status(400).json({ ok: false });
        const rkey = "u:" + req.user.id, now = Date.now();
        let rl = unfurlRate.get(rkey); if (!rl || now - rl.start > 60_000) { rl = { start: now, n: 0 }; unfurlRate.set(rkey, rl); }
        if (rl.n >= 60) return res.status(429).json({ ok: false });
        rl.n++;
        const cached = unfurlCache.get(raw);
        if (cached && now - cached.at < UNFURL_TTL) { res.setHeader("Cache-Control", "private, max-age=600"); return res.json(cached.data); }
        let data;
        try { const html = await safeFetchHtml(raw); if (!html) data = { ok: false }; else { const og = parseOg(html, raw); data = (og.title || og.image) ? { ok: true, url: raw, ...og } : { ok: false }; } }
        catch { data = { ok: false }; }
        unfurlCache.set(raw, { at: now, data });
        if (unfurlCache.size > 1500) unfurlCache.delete(unfurlCache.keys().next().value);
        res.setHeader("Cache-Control", "private, max-age=600");
        res.json(data);
    });

    // ── History + live feed ──────────────────────────────────────────────────
    app.get("/api/chat/messages", auth, (req, res) => {
        if (!need(req, res)) return;
        const room = sanitizeRoom(req.query.room);
        const after = parseInt(req.query.after, 10);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
        try {
            const rows = (after > 0)
                ? stmts.chatAfter.all(room, after, limit)
                : stmts.chatRecent.all(room, limit).reverse();
            res.setHeader("Cache-Control", "no-store");
            const batch = loadHistory(rows, req.user.id);
            res.json({ ok: true, room, messages: rows.map(r => serialize(r, req.user.id, batch)) });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    });

    app.get("/api/chat/stream", auth, (req, res) => {
        if (!req.user) return res.status(401).end();
        const room = sanitizeRoom(req.query.room);
        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();
        const releaseVisit = holdVisitor(req);
        const remove = addSub(room, res);
        // Also register on the user's personal feed so direct messages reach them
        // no matter which room (or DM) they're currently viewing.
        const removeUser = addUserSub(req.user.id, res);
        const wasOffline = !presence.has(req.user.id);
        if (wasOffline) setPresence(req.user.id, "online");
        const ka = setInterval(() => { writeChatEvent(res, ": ka\n\n"); }, 25_000);
        const close = attachChatStream(res, () => {
            clearInterval(ka); remove(); removeUser(); releaseVisit();
            if (!userSubs.has(req.user.id)) {
                presence.delete(req.user.id);
                broadcastAll({ type: "presence", userId: req.user.id, username: req.user.username, status: "offline" });
            }
        });
        req.on("close", close);
        broadcastAll({ type: "presence", userId: req.user.id, username: req.user.username, status: presenceOf(req.user.id) });

        writeChatEvent(res, "retry: 4000\n\n");
        writeChatEvent(res, "data: " + JSON.stringify({ type: "hello", room }) + "\n\n");
    });

    // Set your presence status (online / idle / dnd / invisible).
    app.post("/api/chat/status", auth, (req, res) => {
        if (!req.user) return res.status(401).json({ error: "auth required" });
        const status = String(req.body?.status || "online").toLowerCase();
        if (!["online", "idle", "dnd", "invisible"].includes(status)) return res.status(400).json({ error: "bad status" });
        setPresence(req.user.id, status);
        broadcastAll({ type: "presence", userId: req.user.id, username: req.user.username, status: status === "invisible" ? "offline" : status });
        res.json({ ok: true, status });
    });

    // Online members + their roles (for the @-mention list and the sidebar).
    app.get("/api/chat/online", auth, (req, res) => {
        const out = [];
        for (const uid of userSubs.keys()) {
            const u = stmts.getChatRole.get(uid);
            if (!u) continue;
            const status = presenceOf(uid);
            if (status === "invisible") continue;   // honor invisible mode — hide from the roster
            const ri = roleInfo(u);
            out.push({ userId: uid, username: u.username, status, perm: ri.perm, role: ri.role, roleColor: ri.roleColor });
        }
        out.sort((a, b) => (PERM_RANK[b.perm] - PERM_RANK[a.perm]) || a.username.localeCompare(b.username));
        res.json({ online: out, count: out.length });
    });

    // Typing indicator — lightweight, throttled broadcast to the room.
    const _typingAt = new Map();
    app.post("/api/chat/typing", auth, (req, res) => {
        if (!need(req, res)) return;
        const room = sanitizeRoom(req.body?.room);
        const now = Date.now();
        if (now - (_typingAt.get(req.user.id) || 0) >= 2000) {
            _typingAt.set(req.user.id, now);
            broadcast(room, { type: "typing", username: req.user.username, room });
        }
        res.json({ ok: true });
    });

    // ── Send (with optional reply / forward) ─────────────────────────────────
    app.post("/api/chat/send", auth, async (req, res) => {
        if (!need(req, res)) return;
        const room = sanitizeRoom(req.body?.room);

        const rl = checkSendRate(req);
        if (!rl.ok) return res.status(429).json({ error: rl.reason, retryMs: rl.retryMs });

        if (!isOwnerName(req.user.username)) {
            const to = activeTimeout(req.user.id);
            if (to) return res.json({ ok: false, timeout: true, until: to.until, reason: to.reason || "" });
        }

        const forwardOf = parseInt(req.body?.forwardOf, 10);
        let text, replyTo = null, fwdUser = null, fwdRoom = null, score = 0, category = null;

        if (forwardOf > 0) {
            // Forwarding an already-posted (already-vetted) message into this room.
            const orig = stmts.chatGetById.get(forwardOf);
            if (!orig || orig.deleted) return res.status(404).json({ error: "That message is no longer available." });
            text = cleanText(orig.text);
            if (!text) return res.status(400).json({ error: "Nothing to forward." });
            if (rejectBlockedChatText(res, text)) return;
            fwdUser = orig.username;
            fwdRoom = orig.room;
        } else {
            text = cleanText(req.body?.text);
            if (!text) return res.status(400).json({ error: "Message is empty." });
            if (text.length > MAX_LEN) return res.status(400).json({ error: `Message is too long (max ${MAX_LEN} characters).` });
            if (rejectBlockedChatText(res, text)) return;

            const replyId = parseInt(req.body?.replyTo, 10);
            if (replyId > 0) {
                const ref = stmts.chatGetById.get(replyId);
                if (ref && ref.room === room) replyTo = ref.id;
            }

            if (!isOwnerName(req.user.username)) {
                if (/\.gif(\?|$)/i.test(text) || /giphy\.com/i.test(text) || /tenor\.com/i.test(text) || /gfycat\.com/i.test(text)) {
                    return res.status(400).json({ error: "GIFs are not allowed in chat." });
                }

                const gate = await gateText(text, { ...roomPolicy(room), scan: deslugUrls(text) });
                if (gate.blocked) {
                    try {
                        stmts.chatFlagInsert.run(room, req.user.id, req.user.username, null, text.slice(0, 2000), gate.score, gate.category || null, gate.reason || null, Date.now());
                    } catch {}
                    console.warn(`[chat] blocked msg from ${req.user.username} (${gate.category} ${gate.score}/100)`);
                    return res.json({ ok: false, blocked: true, score: gate.score, category: gate.category, reason: gate.reason, support: gate.support });
                }
                text = gate.clean;
                score = gate.score;
                category = gate.category;
            }
        }

        const now = Date.now();
        let info;
        try {
            info = stmts.chatInsert.run(room, req.user.id, req.user.username, text, score, category, replyTo, fwdUser, fwdRoom, now);
        } catch (e) {
            return res.status(500).json({ error: e.message });
        }
        const row = stmts.chatGetById.get(Number(info.lastInsertRowid));
        const msg = serialize(row, req.user.id);
        broadcast(room, { type: "message", message: msg });
        if (!fwdUser) { try { notifyMentions(text, room, msg, req.user); } catch {} }
        res.json({ ok: true, message: msg });
    });

    // ── Chat commands: economy (all users) + moderation (mod+) ────────────────
    app.post("/api/chat/command", auth, (req, res) => {
        if (!need(req, res)) return;
        const isOwner = isOwnerName(req.user.username);
        const rank = isOwner ? 3 : (() => { try { const u = stmts.findUserByName.get(req.user.username); return u ? roleInfo(u).rank : 0; } catch { return 0; } })();
        const room = sanitizeRoom(req.body?.room);
        const raw = String(req.body?.text || "").trim();
        if (raw.length > MAX_LEN) return res.status(400).json({ error: "Command is too long." });
        if (rejectBlockedChatText(res, raw)) return;
        if (!raw.startsWith("/")) return res.status(400).json({ error: "Not a command." });
        const parts = raw.slice(1).split(/\s+/);
        const cmd = (parts.shift() || "").toLowerCase();

        // ── Economy commands (all users) ────────────────────────────────────
        const parseBetAmount = (token) => {
            const t = String(token || "").toLowerCase().replace(/,/g, "");
            const cfg = getGemConfig();
            const bal = getBalance(req.user.id);
            const cap = Math.max(0, Math.min(bal, cfg.maxBet || bal));
            if (t === "all" || t === "max") return cap;
            if (t === "half") return Math.floor(cap / 2);
            return parseInt(t, 10);
        };
        const isBetWord = (token) => /^(all|max|half)$/i.test(token || "") || /^\d[\d,]*$/.test(token || "");
        const takeBet = () => {
            const a = parts[0], b = parts[1];
            if (a && b && !isBetWord(a) && isBetWord(b)) {
                parts.shift(); parts.shift();
                return { bet: parseBetAmount(b), extra: a };
            }
            const token = parts.shift();
            return { bet: parseBetAmount(token), extra: parts.shift() || "" };
        };

        if (cmd === "daily") {
            const result = claimDaily(req.user.id, req.user.username);
            if (!result.success) {
                if (result.error) return res.json({ ok: false, error: result.error });
                const mins = Math.ceil(result.cooldownMs / 60000);
                return res.json({ ok: true, message: `⏰ Daily reward resets in ${mins < 60 ? mins + "m" : Math.ceil(mins / 60) + "h"}. Come back later!` });
            }
            broadcast(room, { type: "game", game: "daily", userId: req.user.id, username: req.user.username, amount: result.amount, tier: result.tier, tierName: result.tierName, balance: getBalance(req.user.id) });
            return res.json({ ok: true, message: `🎁 You claimed ${result.amount} 💎 (${result.tierName})!` });
        }
        if (cmd === "beg") {
            const result = claimBeg(req.user.id, req.user.username);
            if (!result.success) {
                const mins = Math.ceil(result.cooldownMs / 60000);
                return res.json({ ok: true, message: `⏰ You already begged today. Come back in ${mins < 60 ? mins + "m" : Math.ceil(mins / 60) + "h"}.` });
            }
            sysAnnounce(room, `🙏 @${req.user.username} begged and received **${result.amount} 💎**.`);
            return res.json({ ok: true, message: `You received ${result.amount} 💎!` });
        }
        if (cmd === "gift" || cmd === "give") {
            const target = resolveTarget(parts.shift());
            if (!target) return res.json({ ok: false, error: "User not found." });
            const amount = parseInt(parts.shift(), 10);
            if (!(amount > 0)) return res.json({ ok: false, error: "Usage: /gift @user <amount>" });
            const result = giftGems(req.user.id, req.user.username, target.id, target.username, amount);
            if (!result.success) return res.json({ ok: false, error: result.error });
            sysAnnounce(room, `🎁 @${req.user.username} gifted **${amount} 💎** to @${target.username}!`);
            return res.json({ ok: true, message: `Sent ${amount} 💎 to @${target.username}.` });
        }
        if (cmd === "bal" || cmd === "balance") {
            const bal = getBalance(req.user.id);
            return res.json({ ok: true, message: `💎 Your balance: **${bal.toLocaleString()} gems**` });
        }
        if (cmd === "lb" || cmd === "leaderboard" || cmd === "top") {
            const lb = getLeaderboard(10);
            broadcast(room, { type: "game", game: "leaderboard", entries: lb, requestedBy: req.user.username });
            return res.json({ ok: true, message: "Leaderboard displayed." });
        }
        if (cmd === "coinflip" || cmd === "cf") {
            const picked = takeBet();
            const bet = picked.bet;
            const call = picked.extra || "heads";
            if (!(bet > 0)) return res.json({ ok: false, error: "Usage: /coinflip <amount|all> [heads|tails]" });
            const result = playCoinflip(req.user.id, req.user.username, bet, call);
            if (!result.success) return res.json({ ok: false, error: result.error });
            broadcast(room, { type: "game", ...result.result, userId: req.user.id, username: req.user.username });
            return res.json({ ok: true, message: result.result.won ? `🪙 You won ${result.result.payout} 💎!` : `🪙 You lost ${bet} 💎.` });
        }
        if (cmd === "slots" || cmd === "slot") {
            const bet = takeBet().bet;
            if (!(bet > 0)) return res.json({ ok: false, error: "Usage: /slots <amount|all>" });
            const result = playSlots(req.user.id, req.user.username, bet);
            if (!result.success) return res.json({ ok: false, error: result.error });
            broadcast(room, { type: "game", ...result.result, userId: req.user.id, username: req.user.username });
            return res.json({ ok: true, message: result.result.won ? `🎰 ${result.result.multiplier}x — You won ${result.result.payout} 💎!` : (result.result.push ? `🎰 Stake returned.` : `🎰 No match. You lost ${bet} 💎.`) });
        }
        if (cmd === "dice" || cmd === "roll") {
            const bet = takeBet().bet;
            if (!(bet > 0)) return res.json({ ok: false, error: "Usage: /dice <amount|all>" });
            const result = playDice(req.user.id, req.user.username, bet);
            if (!result.success) return res.json({ ok: false, error: result.error });
            broadcast(room, { type: "game", ...result.result, userId: req.user.id, username: req.user.username });
            return res.json({ ok: true, message: result.result.won ? `🎲 You rolled ${result.result.playerRoll} vs ${result.result.houseRoll} — won ${result.result.payout} 💎!` : (result.result.push ? `🎲 Tie ${result.result.playerRoll} — stake returned.` : `🎲 You rolled ${result.result.playerRoll} vs ${result.result.houseRoll} — lost.`) });
        }
        if (cmd === "blackjack" || cmd === "bj") {
            const arg = (parts.shift() || "").toLowerCase();
            if (arg === "hit" || arg === "h") {
                const result = playBlackjack(req.user.id, req.user.username, 0, "hit");
                if (!result.success) return res.json({ ok: false, error: result.error });
                broadcast(room, { type: "game", ...result.result, userId: req.user.id, username: req.user.username });
                return res.json({ ok: true, message: result.result.phase === "result" ? (result.result.won ? `🃏 You won!` : `🃏 Bust!`) : `🃏 Total: ${result.result.playerTotal}` });
            }
            if (arg === "stand" || arg === "s") {
                const result = playBlackjack(req.user.id, req.user.username, 0, "stand");
                if (!result.success) return res.json({ ok: false, error: result.error });
                broadcast(room, { type: "game", ...result.result, userId: req.user.id, username: req.user.username });
                return res.json({ ok: true, message: result.result.won ? `🃏 You won ${result.result.payout} 💎!` : (result.result.push ? `🃏 Push — bet returned.` : `🃏 Dealer wins.`) });
            }
            parts.unshift(arg);
            const bet = takeBet().bet;
            if (!(bet > 0)) return res.json({ ok: false, error: "Usage: /blackjack <bet|all> · /blackjack hit · /blackjack stand" });
            const result = playBlackjack(req.user.id, req.user.username, bet, "start");
            if (!result.success) return res.json({ ok: false, error: result.error });
            broadcast(room, { type: "game", ...result.result, userId: req.user.id, username: req.user.username });
            if (result.result.phase === "result") return res.json({ ok: true, message: result.result.won ? `🃏 Blackjack! Won ${result.result.payout} 💎!` : `🃏 Push — bet returned.` });
            return res.json({ ok: true, message: `🃏 Dealt! Your total: ${result.result.playerTotal}. Use /bj hit or /bj stand.` });
        }
        if (cmd === "crash") {
            const picked = takeBet();
            const bet = picked.bet;
            const auto = picked.extra;
            if (!(bet > 0)) {
                return res.json({ ok: true, crashPanel: true, state: getCrashState(req.user.id), message: "Crash panel opened." });
            }
            const result = startCrash(req.user.id, req.user.username, bet, null, auto, room);
            if (!result.success) return res.json({ ok: false, error: result.error });
            return res.json({ ok: true, crashPanel: true, state: { ...getCrashState(req.user.id), active: result.round, balance: result.balance }, message: "Crash started." });
        }
        if (cmd === "roulette" || cmd === "roul") {
            const picked = takeBet();
            const bet = picked.bet;
            const betType = String(picked.extra || "").toLowerCase();
            if (!(bet > 0) || !betType) return res.json({ ok: false, error: "Usage: /roulette <amount|all> <red|black|green|0-36>" });
            const result = playRoulette(req.user.id, req.user.username, bet, betType);
            if (!result.success) return res.json({ ok: false, error: result.error });
            broadcast(room, { type: "game", ...result.result, userId: req.user.id, username: req.user.username });
            return res.json({ ok: true, message: result.result.won ? `🎡 ${result.result.number} ${result.result.color} — You won ${result.result.payout} 💎!` : `🎡 ${result.result.number} ${result.result.color} — You lost ${bet} 💎.` });
        }

        // ── Owner economy commands ──────────────────────────────────────────
        if (cmd === "setgems") {
            if (!isOwner) return res.json({ ok: false, error: "Only the owner can set gem balances." });
            const target = resolveTarget(parts.shift());
            if (!target) return res.json({ ok: false, error: "User not found." });
            const amount = parseInt(parts.shift(), 10);
            if (isNaN(amount) || amount < 0) return res.json({ ok: false, error: "Usage: /setgems @user <amount>" });
            setBalance(target.id, target.username, amount);
            return res.json({ ok: true, message: `Set @${target.username}'s balance to ${amount} 💎.` });
        }
        if (cmd === "givegems" || cmd === "addgems") {
            if (!isOwner) return res.json({ ok: false, error: "Only the owner can give gems." });
            const target = resolveTarget(parts.shift());
            if (!target) return res.json({ ok: false, error: "User not found." });
            const amount = parseInt(parts.shift(), 10);
            if (!(amount > 0)) return res.json({ ok: false, error: "Usage: /givegems @user <amount>" });
            addGems(target.id, target.username, amount, "admin_give", `by @${req.user.username}`, req.user.id);
            sysAnnounce(room, `💎 @${target.username} received **${amount} 💎** from the owner.`);
            return res.json({ ok: true, message: `Gave @${target.username} ${amount} 💎.` });
        }
        if (cmd === "panel") {
            if (!isOwner) return res.json({ ok: false, error: "Only the owner can open the panel." });
            return res.json({ ok: true, panel: true, config: getGemConfig(), stats: getEconomyStats(), message: "Panel opened." });
        }

        // ── Moderation commands (rank >= 1) ─────────────────────────────────
        if (cmd === "help" || cmd === "commands") {
            let msg = "💎 Economy — /daily · /beg · /gift @user <n> · /bal · /lb · /coinflip <n|all> [heads|tails] · /slots <n|all> · /dice <n|all> · /blackjack <n|all> · /roulette <n|all> <red|black|green|0-36> · /crash <n|all> [auto]";
            if (rank >= 1) msg += "\n⚙️ Mod — /timeout @user <dur> [reason] · /untimeout @user · /purge <n|all> · /deletemsg <id> · /giveaway <dur> <prize> · /gend [id]";
            if (isOwner) msg += "\n👑 Owner — /setperm @user <rank> · /setrole @user <title> [#color] · /setgems @user <n> · /givegems @user <n> · /panel";
            return res.json({ ok: true, message: msg });
        }
        if (rank < 1) return res.json({ ok: false, error: "Unknown command. Try /help." });

        if (cmd === "timeout" || cmd === "mute") {
            const target = resolveTarget(parts.shift());
            if (!target) return res.json({ ok: false, error: "User not found." });
            if (isOwnerName(target.username)) return res.json({ ok: false, error: "You can't time out the owner." });
            const targetRank = (() => { try { return roleInfo(stmts.findUserByName.get(target.username)).rank; } catch { return 0; } })();
            if (!isOwner && targetRank >= rank) return res.json({ ok: false, error: "You can't time out someone at or above your rank." });
            const ms = parseDuration(parts.shift());
            if (!ms) return res.json({ ok: false, error: "Bad duration — try 30s, 10m, 2h or 1d." });
            const reason = parts.join(" ").slice(0, 200);
            try { stmts.timeoutSet.run(target.id, Date.now() + ms, reason || null, req.user.username, Date.now()); }
            catch (e) { return res.json({ ok: false, error: e.message }); }
            sysAnnounce(room, "🔇 @" + target.username + " was timed out for " + fmtDuration(ms) + (reason ? " — " + reason : "") + ".");
            return res.json({ ok: true, message: "Timed out @" + target.username + " for " + fmtDuration(ms) + "." });
        }
        if (cmd === "untimeout" || cmd === "unmute") {
            const target = resolveTarget(parts.shift());
            if (!target) return res.json({ ok: false, error: "User not found." });
            try { stmts.timeoutClear.run(target.id); } catch {}
            sysAnnounce(room, "🔊 @" + target.username + "'s timeout was lifted.");
            return res.json({ ok: true, message: "Lifted @" + target.username + "'s timeout." });
        }
        if (cmd === "purge" || cmd === "clear") {
            const arg = (parts.shift() || "").toLowerCase();
            if (arg === "all") {
                if (!isOwner) return res.json({ ok: false, error: "Only the owner can purge all." });
                try { stmts.chatPurgeRoom.run(room); } catch (e) { return res.json({ ok: false, error: e.message }); }
                broadcast(room, { type: "purge", all: true });
                sysAnnounce(room, "🧹 Every message in this channel was purged.");
                return res.json({ ok: true, message: "Purged all of #" + room + "." });
            }
            const n = parseInt(arg, 10);
            if (!(n > 0) || n > 500) return res.json({ ok: false, error: "Use /purge <1-500> or /purge all." });
            let ids = [];
            try { ids = stmts.chatRecentIds.all(room, n).map(r => r.id); } catch (e) { return res.json({ ok: false, error: e.message }); }
            for (const id of ids) { try { stmts.chatHardDeleteId.run(id); } catch {} }
            broadcast(room, { type: "purge", ids });
            sysAnnounce(room, "🧹 Purged " + ids.length + " message" + (ids.length === 1 ? "" : "s") + ".");
            return res.json({ ok: true, message: "Purged " + ids.length + " message" + (ids.length === 1 ? "" : "s") + "." });
        }
        if (cmd === "deletemsg" || cmd === "delmsg" || cmd === "dm") {
            const id = parseInt(parts.shift(), 10);
            if (!(id > 0)) return res.json({ ok: false, error: "Usage: /deletemsg <message-id>" });
            const msg = stmts.chatGetById.get(id);
            if (!msg || msg.deleted) return res.json({ ok: false, error: "Message not found." });
            if (!isOwner && msg.room !== room) return res.json({ ok: false, error: "That message isn't in this room." });
            try { stmts.chatHardDeleteId.run(id); } catch (e) { return res.json({ ok: false, error: e.message }); }
            broadcast(msg.room, { type: "purge", ids: [id] });
            return res.json({ ok: true, message: "Deleted message #" + id + " by @" + msg.username + "." });
        }
        if (cmd === "setperm" || cmd === "setrank") {
            if (!isOwner) return res.json({ ok: false, error: "Only the owner can change permissions." });
            const target = resolveTarget(parts.shift());
            if (!target) return res.json({ ok: false, error: "User not found." });
            if (isOwnerName(target.username)) return res.json({ ok: false, error: "Owner permissions can't be changed." });
            const perm = (parts.shift() || "").toLowerCase();
            if (!["admin", "mod", "member"].includes(perm)) return res.json({ ok: false, error: "Use admin, mod, or member." });
            try { stmts.setChatRole.run(perm, null, null, target.id); } catch (e) { return res.json({ ok: false, error: e.message }); }
            sysAnnounce(room, "⚙️ @" + target.username + " is now **" + perm + "**.");
            return res.json({ ok: true, message: "Set @" + target.username + " to " + perm + "." });
        }
        if (cmd === "setrole") {
            if (!isOwner) return res.json({ ok: false, error: "Only the owner can set roles." });
            const target = resolveTarget(parts.shift());
            if (!target) return res.json({ ok: false, error: "User not found." });
            const colorIdx = parts.findIndex(p => /^#[0-9a-f]{6}$/i.test(p));
            let color = null;
            if (colorIdx >= 0) { color = parts.splice(colorIdx, 1)[0]; }
            const title = parts.join(" ").trim().slice(0, 32) || null;
            const current = stmts.getChatRole.get(target.id);
            const perm = current?.chat_perm || "member";
            try { stmts.setChatRole.run(perm, title, color, target.id); } catch (e) { return res.json({ ok: false, error: e.message }); }
            return res.json({ ok: true, message: "Set @" + target.username + "'s role to " + (title || "(cleared)") + (color ? " " + color : "") + "." });
        }
        if (cmd === "giveaway" || cmd === "gw" || cmd === "gstart") {
            if (rank < 2 && !isOwner) return res.json({ ok: false, error: "Admins and above can start giveaways." });
            const ms = parseDuration(parts.shift());
            if (!ms) return res.json({ ok: false, error: "Usage: /giveaway <duration> <prize> — e.g. /giveaway 10m Discord Nitro" });
            const prize = parts.join(" ").trim().slice(0, 120);
            if (!prize) return res.json({ ok: false, error: "Add a prize: /giveaway 10m <prize>" });
            const now = Date.now();
            let info;
            try { info = stmts.gwInsert.run(room, prize, req.user.username, now, now + ms); }
            catch (e) { return res.json({ ok: false, error: e.message }); }
            const gw = stmts.gwGet.get(Number(info.lastInsertRowid));
            broadcast(room, { type: "giveaway", gw: gwPublic(gw) });
            sysAnnounce(room, "🎉 **Giveaway:** " + prize + " — ends in " + fmtDuration(ms) + ". Hit Join on the card to enter!");
            return res.json({ ok: true, message: "Giveaway started (" + fmtDuration(ms) + ")." });
        }
        if (cmd === "gend" || cmd === "drawnow") {
            if (rank < 2 && !isOwner) return res.json({ ok: false, error: "Admins and above can end giveaways." });
            const id = parseInt(parts.shift(), 10);
            const gw = id > 0 ? stmts.gwGet.get(id) : (stmts.gwActiveByRoom.all(room)[0] || null);
            if (!gw || gw.status !== "open") return res.json({ ok: false, error: "No open giveaway here." });
            const w = drawGiveaway(gw);
            return res.json({ ok: true, message: w ? "Winner: @" + w.username : "Ended — no entries." });
        }
        return res.json({ ok: false, error: "Unknown command. Try /help." });
    });

    // Owner economy config update
    app.post("/api/chat/economy-config", auth, (req, res) => {
        if (!need(req, res)) return;
        if (!isOwnerName(req.user.username)) return res.status(403).json({ error: "Owner only." });
        const ok = setGemConfig(req.body || {});
        if (!ok) return res.status(500).json({ error: "Failed to save configuration." });
        res.json({ ok: true, config: getGemConfig() });
    });

    // Enter a giveaway (any signed-in user).
    app.post("/api/chat/giveaway/:id/join", auth, (req, res) => {
        if (!need(req, res)) return;
        const gw = stmts.gwGet.get(parseInt(req.params.id, 10));
        if (!gw || gw.status !== "open" || gw.ends_at <= Date.now()) return res.status(400).json({ error: "This giveaway isn't open." });
        try { stmts.gwEntryInsert.run(gw.id, req.user.id, req.user.username, Date.now()); } catch {}
        let entries = 0; try { entries = stmts.gwEntryCount.get(gw.id).n; } catch {}
        broadcast(gw.room, { type: "giveaway-update", id: gw.id, entries });
        res.json({ ok: true, entries });
    });

    // Active giveaways for a room (so cards survive a reload).
    app.get("/api/chat/giveaways", auth, (req, res) => {
        if (!need(req, res)) return;
        const room = sanitizeRoom(req.query?.room);
        let giveaways = [];
        try { giveaways = stmts.gwActiveByRoom.all(room).map(gwPublic); } catch {}
        res.json({ giveaways });
    });

    // Draw any giveaways whose timer is up.
    setInterval(() => {
        let due = [];
        try { due = stmts.gwDue.all(Date.now()); } catch {}
        for (const gw of due) { try { drawGiveaway(gw); } catch {} }
    }, 15000).unref();

    // ── Edit own message ─────────────────────────────────────────────────────
    app.put("/api/chat/messages/:id", auth, async (req, res) => {
        if (!need(req, res)) return;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Invalid id." });
        const row = stmts.chatGetById.get(id);
        if (!row || row.deleted) return res.status(404).json({ error: "Message not found." });
        if (row.user_id !== req.user.id) return res.status(403).json({ error: "You can only edit your own messages." });
        if (row.fwd_user) return res.status(400).json({ error: "Forwarded messages can't be edited." });

        const text = cleanText(req.body?.text);
        if (!text) return res.status(400).json({ error: "Message is empty." });
        if (text.length > MAX_LEN) return res.status(400).json({ error: `Message is too long (max ${MAX_LEN} characters).` });
        if (rejectBlockedChatText(res, text)) return;

        const gate = await gateText(text, { ...roomPolicy(row.room), scan: deslugUrls(text) });
        if (gate.blocked) {
            return res.json({ ok: false, blocked: true, score: gate.score, category: gate.category, reason: gate.reason, support: gate.support });
        }
        try { stmts.chatEdit.run(gate.clean, gate.score, gate.category, Date.now(), id, req.user.id); }
        catch (e) { return res.status(500).json({ error: e.message }); }

        const updated = serialize(stmts.chatGetById.get(id), req.user.id);
        broadcast(row.room, { type: "edit", id, text: updated.text, edited: true });
        res.json({ ok: true, message: updated });
    });

    // ── Delete own message ───────────────────────────────────────────────────
    app.delete("/api/chat/messages/:id", auth, (req, res) => {
        if (!need(req, res)) return;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Invalid id." });
        const row = stmts.chatGetById.get(id);
        if (!row) return res.status(404).json({ error: "Message not found." });
        const isMod = canModerate(req.user);
        if (row.user_id !== req.user.id && !isMod) return res.status(403).json({ error: "You can only delete your own messages." });
        try {
            if (row.user_id === req.user.id) stmts.chatSoftDelete.run(id, req.user.id);
            else stmts.chatSoftDeleteAny.run(id);   // moderator deleting someone else's
        } catch (e) { return res.status(500).json({ error: e.message }); }
        broadcast(row.room, { type: "delete", id, byMod: isMod && row.user_id !== req.user.id });
        res.json({ ok: true });
    });

    // ── Toggle an emoji reaction ─────────────────────────────────────────────
    app.post("/api/chat/messages/:id/react", auth, (req, res) => {
        if (!need(req, res)) return;
        if (!checkReactRate(req)) return res.status(429).json({ error: "Too many reactions - slow down." });
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Invalid id." });
        const emoji = String(req.body?.emoji || "");
        if (!REACTION_SET.has(emoji)) return res.status(400).json({ error: "That reaction isn't allowed." });
        const row = stmts.chatGetById.get(id);
        if (!row || row.deleted) return res.status(404).json({ error: "Message not found." });

        let added;
        try {
            const del = stmts.chatReactDelete.run(id, req.user.id, emoji);
            if (del.changes > 0) { added = false; }
            else { stmts.chatReactInsert.run(id, req.user.id, emoji, Date.now()); added = true; }
        } catch (e) { return res.status(500).json({ error: e.message }); }

        const counts = reactionCounts(id);
        broadcast(row.room, { type: "react", id, counts });
        res.json({ ok: true, id, emoji, added, counts });
    });

    // ── User directory: find people to message ───────────────────────────────
    app.get("/api/users/search", auth, (req, res) => {
        if (!need(req, res)) return;
        const q = String(req.query.q || "").trim().replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 32);
        if (!q) return res.json({ ok: true, users: [] });
        try {
            const rows = stmts.userSearch.all("%" + q + "%", req.user.id, q + "%", 12);
            res.setHeader("Cache-Control", "no-store");
            res.json({ ok: true, users: rows.map(u => ({ id: u.id, username: u.username, avatar: u.avatar || null })) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // ── Direct messages ──────────────────────────────────────────────────────
    function resolveOther(req, res, raw) {
        const otherId = parseInt(raw, 10);
        if (!otherId || otherId === req.user.id) { res.status(400).json({ error: "Invalid user." }); return null; }
        const other = stmts.userByIdLite.get(otherId);
        if (!other) { res.status(404).json({ error: "User not found." }); return null; }
        return other;
    }

    // Add (or look up) a person by username so they appear in your DM list.
    app.post("/api/dm/add", auth, (req, res) => {
        if (!need(req, res)) return;
        const name = String(req.body?.username || "").trim();
        if (!name) return res.status(400).json({ error: "Enter a username." });
        const other = stmts.userByNameLite.get(name);
        if (!other) return res.status(404).json({ error: "No user found with that username." });
        if (other.id === req.user.id) return res.status(400).json({ error: "You can't message yourself." });
        const existing = stmts.dmThreadGet.get(req.user.id, other.id);
        if (!existing) { try { stmts.dmThreadUpsert.run(req.user.id, other.id, other.username, null, Date.now(), 0); } catch {} }
        res.json({ ok: true, user: { id: other.id, username: other.username, avatar: other.avatar || null } });
    });

    app.get("/api/dm/threads", auth, (req, res) => {
        if (!need(req, res)) return;
        try {
            const rows = stmts.dmThreadList.all(req.user.id, 100);
            const total = stmts.dmUnreadTotal.get(req.user.id)?.n || 0;
            res.setHeader("Cache-Control", "no-store");
            res.json({ ok: true, threads: rows.map(serializeThread), unreadTotal: total });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    app.get("/api/dm/with/:otherId/messages", auth, (req, res) => {
        if (!need(req, res)) return;
        const other = resolveOther(req, res, req.params.otherId);
        if (!other) return;
        const key = convoKey(req.user.id, other.id);
        const after = parseInt(req.query.after, 10);
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
        try {
            const rows = (after > 0) ? stmts.dmAfter.all(key, after, limit) : stmts.dmRecent.all(key, limit).reverse();
            try { stmts.dmThreadMarkRead.run(req.user.id, other.id); } catch {}
            res.setHeader("Cache-Control", "no-store");
            res.json({ ok: true, other: { id: other.id, username: other.username, avatar: other.avatar || null }, messages: rows.map(serializeDm), filter: dmFilterState(key, req.user.id) });
        } catch (e) { res.status(500).json({ error: e.message }); }
    });

    // Toggle the per-conversation profanity filter. Turning it OFF needs both
    // people to agree; either side can turn it back ON at any time.
    app.post("/api/dm/with/:otherId/filter", auth, (req, res) => {
        if (!need(req, res)) return;
        const other = resolveOther(req, res, req.params.otherId);
        if (!other) return;
        const key = convoKey(req.user.id, other.id);
        const action = String(req.body?.action || "");
        const now = Date.now();
        const s = stmts.dmSettingsGet.get(key) || { filter_off: 0, pending_by: null };
        const notify = () => {
            pushToUser(other.id, { type: "dm-filter", otherId: req.user.id, filter: dmFilterState(key, other.id), by: req.user.username, action });
            pushToUser(req.user.id, { type: "dm-filter", otherId: other.id, filter: dmFilterState(key, req.user.id), action });
        };
        if (action === "request-off") {
            if (!s.filter_off) { try { stmts.dmSettingsUpsert.run(key, 0, req.user.id, now); } catch {} notify(); }
        } else if (action === "accept-off") {
            if (!s.pending_by || s.pending_by === req.user.id) return res.status(400).json({ error: "There's no pending request to accept." });
            try { stmts.dmSettingsUpsert.run(key, 1, null, now); } catch {}
            notify();
        } else if (action === "decline-off" || action === "on") {
            try { stmts.dmSettingsUpsert.run(key, 0, null, now); } catch {}
            notify();
        } else {
            return res.status(400).json({ error: "Unknown action." });
        }
        res.json({ ok: true, filter: dmFilterState(key, req.user.id) });
    });

    app.post("/api/dm/with/:otherId/read", auth, (req, res) => {
        if (!need(req, res)) return;
        const otherId = parseInt(req.params.otherId, 10);
        if (!otherId) return res.status(400).json({ error: "Invalid user." });
        try { stmts.dmThreadMarkRead.run(req.user.id, otherId); } catch {}
        res.json({ ok: true });
    });

    app.post("/api/dm/with/:otherId/send", auth, async (req, res) => {
        if (!need(req, res)) return;
        const other = resolveOther(req, res, req.params.otherId);
        if (!other) return;
        const rl = checkSendRate(req);
        if (!rl.ok) return res.status(429).json({ error: rl.reason, retryMs: rl.retryMs });

        const text0 = cleanText(req.body?.text);
        if (!text0) return res.status(400).json({ error: "Message is empty." });
        if (text0.length > MAX_LEN) return res.status(400).json({ error: `Message is too long (max ${MAX_LEN} characters).` });
        if (rejectBlockedChatText(res, text0)) return;

        const key = convoKey(req.user.id, other.id);
        let replyTo = null;
        const replyId = parseInt(req.body?.replyTo, 10);
        if (replyId > 0) { const ref = stmts.dmGetById.get(replyId); if (ref && ref.convo_key === key) replyTo = ref.id; }

        let text = text0;
        if (!isOwnerName(req.user.username)) {
            if (/\.gif(\?|$)/i.test(text0) || /giphy\.com/i.test(text0) || /tenor\.com/i.test(text0) || /gfycat\.com/i.test(text0)) {
                return res.status(400).json({ error: "GIFs are not allowed." });
            }
            const filterOff = !!(stmts.dmSettingsGet.get(key)?.filter_off);
            const gate = await gateText(text0, { mask: !filterOff, scan: deslugUrls(text0) });
            if (gate.blocked) {
                try { stmts.chatFlagInsert.run("dm:" + key, req.user.id, req.user.username, null, text0.slice(0, 2000), gate.score, gate.category || null, gate.reason || null, Date.now()); } catch {}
                return res.json({ ok: false, blocked: true, score: gate.score, category: gate.category, reason: gate.reason, support: gate.support });
            }
            text = gate.clean;
        }
        const now = Date.now();
        let info;
        try { info = stmts.dmInsert.run(key, req.user.id, other.id, req.user.username, text, replyTo, now); }
        catch (e) { return res.status(500).json({ error: e.message }); }

        const msg = serializeDm(stmts.dmGetById.get(Number(info.lastInsertRowid)));
        const preview = text.length > 80 ? text.slice(0, 80) : text;
        try {
            stmts.dmThreadUpsert.run(req.user.id, other.id, other.username, preview, now, 0);
            stmts.dmThreadUpsert.run(other.id, req.user.id, req.user.username, preview, now, 1);
        } catch {}
        pushToUser(req.user.id, { type: "dm", otherId: other.id, message: msg });
        pushToUser(other.id, { type: "dm", otherId: req.user.id, message: msg });
        res.json({ ok: true, message: msg });
    });

    app.put("/api/dm/messages/:id", auth, async (req, res) => {
        if (!need(req, res)) return;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Invalid id." });
        const row = stmts.dmGetById.get(id);
        if (!row || row.deleted) return res.status(404).json({ error: "Message not found." });
        if (row.sender_id !== req.user.id) return res.status(403).json({ error: "You can only edit your own messages." });
        const text = cleanText(req.body?.text);
        if (!text) return res.status(400).json({ error: "Message is empty." });
        if (text.length > MAX_LEN) return res.status(400).json({ error: `Message is too long (max ${MAX_LEN} characters).` });
        if (rejectBlockedChatText(res, text)) return;
        const dmFilterOff = !!(stmts.dmSettingsGet.get(row.convo_key)?.filter_off);
        const gate = await gateText(text, { mask: !dmFilterOff, scan: deslugUrls(text) });
        if (gate.blocked) return res.json({ ok: false, blocked: true, score: gate.score, category: gate.category, reason: gate.reason, support: gate.support });
        try { stmts.dmEdit.run(gate.clean, Date.now(), id, req.user.id); }
        catch (e) { return res.status(500).json({ error: e.message }); }
        pushToUser(row.sender_id, { type: "dm-edit", otherId: row.recipient_id, id, text: gate.clean });
        pushToUser(row.recipient_id, { type: "dm-edit", otherId: row.sender_id, id, text: gate.clean });
        res.json({ ok: true, id, text: gate.clean });
    });

    app.delete("/api/dm/messages/:id", auth, (req, res) => {
        if (!need(req, res)) return;
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Invalid id." });
        const row = stmts.dmGetById.get(id);
        if (!row) return res.status(404).json({ error: "Message not found." });
        if (row.sender_id !== req.user.id) return res.status(403).json({ error: "You can only delete your own messages." });
        try { stmts.dmDelete.run(id, req.user.id); } catch (e) { return res.status(500).json({ error: e.message }); }
        pushToUser(row.sender_id, { type: "dm-delete", otherId: row.recipient_id, id });
        pushToUser(row.recipient_id, { type: "dm-delete", otherId: row.sender_id, id });
        res.json({ ok: true });
    });

    onCrashSettled((result) => {
        if (!result || !result.room) return;
        broadcast(result.room, { type: "game", ...result });
    });
    armCrashRounds();

    app.get("/api/chat/crash", auth, (req, res) => {
        if (!need(req, res)) return;
        res.set("Cache-Control", "no-store");
        res.json(getCrashState(req.user.id));
    });
    app.post("/api/chat/crash/start", auth, (req, res) => {
        if (!need(req, res)) return;
        const cfg = getGemConfig();
        let bet = req.body?.bet;
        if (typeof bet === "string" && /^(all|max|half)$/i.test(bet.trim())) {
            const bal = getBalance(req.user.id);
            const cap = Math.max(0, Math.min(bal, cfg.maxBet || bal));
            bet = /half/i.test(bet) ? Math.floor(cap / 2) : cap;
        } else bet = parseInt(bet, 10);
        const result = startCrash(req.user.id, req.user.username, bet, req.body?.clientSeed, req.body?.auto, sanitizeRoom(req.body?.room));
        if (!result.success) return res.status(400).json({ error: result.error });
        res.json({ ok: true, round: result.round, fair: result.fair, balance: result.balance });
    });
    app.post("/api/chat/crash/cashout", auth, (req, res) => {
        if (!need(req, res)) return;
        const result = cashoutCrash(req.user.id);
        if (!result.success) return res.status(400).json({ error: result.error });
        res.json({ ok: true, result: result.result });
    });
}
