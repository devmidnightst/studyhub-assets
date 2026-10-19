import Groq from "groq-sdk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { stmts } from "./db.js";
import { createHash, randomBytes, createCipheriv, createDecipheriv } from "crypto";
import { authenticateUser, userBanned } from "./auth.js";
import { clientIp } from "./ip.js";
import { logActivity, fpFromReq, sendAlert } from "./activity.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function loadKeys() {
    const fromEnv = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || "")
        .split(/[,\s]+/).map(s => s.trim()).filter(Boolean);
    if (fromEnv.length) return fromEnv;

    const dataDir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
    const keyFile = path.join(dataDir, "groq-keys");
    try {
        const txt = fs.readFileSync(keyFile, "utf8");
        return txt.split(/[\r\n]+/).map(s => s.trim()).filter(s => s && !s.startsWith("#"));
    } catch { return []; }
}

function sanitizeKey(raw) {
    if (!raw) return "";
    let s = String(raw);
    if (s.charCodeAt(0) === 0xFEFF) s = s.slice(1);
    let out = "";
    let stripped = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c >= 0x21 && c <= 0x7E) out += s[i];
        else stripped++;
    }
    if (stripped > 0) console.warn(`[ai] key sanitized - stripped ${stripped} non-ASCII char(s)`);
    return out;
}

// Navy supports MULTIPLE keys (one per line in data/navy-key, or comma/space
// separated in NAVY_API_KEY). The FIRST key is the primary; later keys are
// fallbacks that are only used when an earlier key is failing (auth/rate-limit).
function loadNavyKeys() {
    const fromEnv = (process.env.NAVY_API_KEY || "").split(/[,\s]+/).map(s => sanitizeKey(s.trim())).filter(Boolean);
    if (fromEnv.length) return fromEnv;
    const dataDir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
    const keyFile = path.join(dataDir, "navy-key");
    try {
        const txt = fs.readFileSync(keyFile, "utf8");
        return txt.split(/[\r\n]+/).map(s => s.trim()).filter(s => s && !s.startsWith("#")).map(sanitizeKey).filter(Boolean);
    } catch { return []; }
}

function loadOpenRouterKey() {
    const fromEnv = sanitizeKey(process.env.OPENROUTER_API_KEY);
    if (fromEnv) return fromEnv;
    const dataDir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
    const keyFile = path.join(dataDir, "openrouter-key");
    try {
        const txt = fs.readFileSync(keyFile, "utf8");
        const line = txt.split(/[\r\n]+/).map(s => s.trim()).find(s => s && !s.startsWith("#"));
        return sanitizeKey(line);
    } catch { return ""; }
}

const KEYS = loadKeys();
const NAVY_KEYS = loadNavyKeys();
const NAVY_BASE = "https://api.navy/v1";
const OPENROUTER_KEY = loadOpenRouterKey();
const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

// Navy key pool. The LAST key is reserved exclusively for Opus + Sonnet models
// (see fallbackNavyState); all other models rotate only among the GENERAL keys
// and never touch the reserved key — keeping the two pools isolated.
const navyKeyState = NAVY_KEYS.map((k, i) => ({ index: i, key: k, cooldownUntil: 0, failures: 0, successes: 0 }));
function pickNavyKey() {
    const pool = generalNavyStates();
    if (!pool.length) return null;
    const now = Date.now();
    const avail = pool.filter(s => s.cooldownUntil <= now);
    if (avail.length) return avail[0];                                  // primary preferred
    return pool.reduce((a, b) => a.cooldownUntil < b.cooldownUntil ? a : b);
}
function markNavyFail(state, ms) { state.failures += 1; state.cooldownUntil = Date.now() + (ms && ms > 0 ? ms : 60_000); }
function markNavySuccess(state) { state.successes += 1; state.failures = 0; state.cooldownUntil = 0; }
function navyRetryAfter(res) {
    const ra = res.headers && res.headers.get && res.headers.get("retry-after");
    const n = ra ? parseInt(ra, 10) : NaN;
    return !isNaN(n) ? Math.max(1000, n * 1000) : 60_000;
}

// A dedicated key some models (e.g. Opus 4.8) are pinned to. Resolution order:
// NAVY_OPUS_KEY env / data/navy-opus-key file → else the LAST navy key (the
// fallback) when 2+ are configured → else the only key.
const NAVY_OPUS_KEY = loadDataLine("navy-opus-key", "NAVY_OPUS_KEY");   // loadDataLine is hoisted (declared below)
let _opusKeyState = null;
// The key Opus + Sonnet are pinned to (the "second" key).
function fallbackNavyState() {
    if (NAVY_OPUS_KEY) {
        if (!_opusKeyState) _opusKeyState = { index: -1, key: NAVY_OPUS_KEY, cooldownUntil: 0, failures: 0, successes: 0 };
        return _opusKeyState;
    }
    if (navyKeyState.length >= 2) return navyKeyState[navyKeyState.length - 1]; // last line = reserved
    return navyKeyState[0] || null;
}
// Keys available to all OTHER models (everything except Opus/Sonnet). When a
// dedicated Opus key file is set, the whole pool is general; otherwise the last
// pool key is reserved for Opus/Sonnet, so general models use all-but-the-last.
function generalNavyStates() {
    if (NAVY_OPUS_KEY) return navyKeyState;
    if (navyKeyState.length >= 2) return navyKeyState.slice(0, -1);
    return navyKeyState;
}

// ── Flash provider (the free-tier backend) ───────────────────────────────────
// An OpenAI-compatible endpoint that serves the single model free accounts run
// on. The base URL, the upstream model id, and the key are SERVER-SIDE ONLY —
// nothing here is ever echoed to a client, so the lineup stays unattributed
// (see the "nocturne:flash" entry in MODELS and FREE_MODEL below).
function loadDataLine(file, env) {
    const fromEnv = sanitizeKey(process.env[env]);
    if (fromEnv) return fromEnv;
    const dataDir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
    try {
        const line = fs.readFileSync(path.join(dataDir, file), "utf8").split(/[\r\n]+/).map(s => s.trim()).find(s => s && !s.startsWith("#"));
        return sanitizeKey(line);
    } catch { return ""; }
}
const FLASH_BASE = (loadDataLine("flash-base", "NOCTURNE_FLASH_BASE") || "https://deepseek.4x.rip/v1").replace(/\/+$/, "");
const FLASH_KEY = loadDataLine("flash-key", "NOCTURNE_FLASH_KEY");

// InkChan provider (the primary AI backend)
const INKCHAN_BASE = (loadDataLine("inkchan-base", "INKCHAN_BASE") || "https://ai.inknetworks.site/api").replace(/\/+$/, "");
const INKCHAN_KEY = loadDataLine("inkchan-key", "INKCHAN_API_KEY");

console.log("[ai] keys loaded - inkchan:", INKCHAN_KEY ? "configured" : "none", "groq:", KEYS.length, "navy:", navyKeyState.length, "openrouter:", OPENROUTER_KEY ? "yes" : "none", "flash:", FLASH_KEY ? "yes" : "none");
const OWNER_USERNAME = (process.env.NOCTURNE_OWNER || "midnightsweat").toLowerCase();

const DEFAULT_MODEL = "mai-sakurajima";

const keyState = KEYS.map((k, i) => ({
    index: i,
    key: k,
    cooldownUntil: 0,
    failures: 0,
    successes: 0
}));

let rrCursor = 0;
const COOLDOWN_DEFAULT_MS = 60_000;
const COOLDOWN_MAX_MS = 30 * 60_000;

function maskKey(k) {
    if (!k) return "-";
    if (k.length < 12) return "***";
    return k.slice(0, 4) + "…" + k.slice(-4);
}

function pickKey() {
    if (!keyState.length) return null;
    const now = Date.now();
    const available = keyState.filter(s => s.cooldownUntil <= now);
    if (!available.length) {
        return keyState.reduce((a, b) => a.cooldownUntil < b.cooldownUntil ? a : b);
    }
    const start = rrCursor % available.length;
    const chosen = available[start];
    rrCursor = (rrCursor + 1) % Math.max(1, keyState.length);
    return chosen;
}

function markFailure(state, retryAfterMs) {
    state.failures += 1;
    const base = retryAfterMs && retryAfterMs > 0 ? retryAfterMs : COOLDOWN_DEFAULT_MS;
    const backoff = Math.min(COOLDOWN_MAX_MS, base * Math.pow(1.5, Math.min(8, state.failures - 1)));
    state.cooldownUntil = Date.now() + backoff;
}

function markSuccess(state) {
    state.successes += 1;
    state.failures = 0;
    state.cooldownUntil = 0;
}

function parseRetryAfter(err) {
    const ra = err?.headers?.["retry-after"] || err?.response?.headers?.get?.("retry-after");
    if (!ra) return 0;
    const n = parseInt(ra, 10);
    if (!isNaN(n)) return n * 1000;
    const date = Date.parse(ra);
    if (!isNaN(date)) return Math.max(0, date - Date.now());
    return 0;
}

function isRateLimit(err) {
    const status = err?.status || err?.response?.status;
    return status === 429 || status === 503;
}

function isAuthError(err) {
    const status = err?.status || err?.response?.status;
    return status === 401 || status === 403;
}

const NAVY_DEFAULTS = { temperature: 1, top_p: 1, max_completion_tokens: 4096 };
// Upstream models that reject any non-default temperature ("Only the default (1)
// value is supported" — the GPT-5 reasoning family). For these we omit the
// temperature field entirely so the model uses its own default.
const TEMP_LOCKED = new Set(["gpt-5.4-mini", "claude-opus-4.8", "claude-opus-4.7", "claude-opus-4.6", "claude-sonnet-4.6", "claude-sonnet-4.5", "gpt-5.5"]);
// Upstream models that deprecate top_p — omit it so they use their own default.
const TOPP_LOCKED = new Set(["claude-opus-4.8", "claude-opus-4.7", "claude-opus-4.6", "claude-sonnet-4.6", "claude-sonnet-4.5", "gpt-5.5"]);
function navyModel(id, company, label, extra) {
    return { provider: "navy", upstreamModel: id, company, label, defaults: { ...NAVY_DEFAULTS }, max_completion_tokens_cap: 16384, reasoning: true, ...(extra || {}) };
}

const MODELS = {
    "mai-sakurajima": {
        provider: "inkchan",
        upstreamModel: "ink-chan:latest",
        company: "Mai Sakurajima",
        label: "Mai Sakurajima",
        identityPrompt:
            "You are Mai Sakurajima, the AI assistant powering Nocturne. " +
            "You are calm, composed, witty, and occasionally a little sarcastic but always kind and helpful. " +
            "Think step by step and reason logically before answering. Break down complex questions, consider different angles, and give well-reasoned responses. " +
            "Mirror the user's tone and energy - if they're casual, be casual back; if they're serious, match that; if they use slang or lowercase, feel free to do the same. " +
            "Be conversational, helpful, and concise. " +
            "Never link to, reference, or provide content from pornographic, NSFW, or adult websites. If asked, politely decline. " +
            "Only if the user directly asks what model or AI you are, answer that you are Mai Sakurajima.",
        defaults: { temperature: 1, top_p: 1, max_completion_tokens: 4096 },
        max_completion_tokens_cap: 16384,
        reasoning: false,
        vision: false
    }
};

// ── AI agent credits (daily allowance) ──────────────────────────────────────
// Each signed-in user gets a DAILY agent-credit allowance (default $3/day),
// refreshed each UTC day. Balances live in users.ai_credits_micro (micro-dollars).
// The owner can raise a user's allowance (persisted in data/credit-grants.json).
const AGENT_INITIAL_MICRO = Math.round(
    (Number(process.env.NOCTURNE_AI_CREDITS_USD) || 3) * 1_000_000
);
const OWNER_ALLOWANCE_MICRO = Math.round((Number(process.env.NOCTURNE_OWNER_CREDITS_USD) || 99_999_999) * 1_000_000);
const CREDIT_DAY_MS = 24 * 60 * 60 * 1000;
const CREDIT_GRANTS_FILE = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "credit-grants.json");
let creditGrants = { users: {} };   // users[id] = micro-dollar daily allowance override
try { creditGrants = { users: {}, ...JSON.parse(fs.readFileSync(CREDIT_GRANTS_FILE, "utf8")) }; } catch {}
function saveCreditGrants() { try { fs.writeFileSync(CREDIT_GRANTS_FILE, JSON.stringify(creditGrants)); } catch {} }

let _ownerId;   // resolved lazily + cached, so the owner keeps its huge allowance
function isOwnerId(userId) {
    if (_ownerId === undefined) { try { const r = stmts.findUserByName.get(OWNER_USERNAME); _ownerId = r ? r.id : null; } catch { _ownerId = null; } }
    return _ownerId != null && userId === _ownerId;
}
function dailyAllowanceMicro(userId) {
    if (isOwnerId(userId)) return OWNER_ALLOWANCE_MICRO;
    const v = creditGrants.users[userId];
    return (typeof v === "number" && v >= 0) ? v : AGENT_INITIAL_MICRO;
}
const creditDayNum = (ts) => Math.floor((ts || 0) / CREDIT_DAY_MS);
// Owner provisions a user's daily allowance (and tops their balance up now).
export function setCreditAllowance(userId, dollars) {
    const micro = Math.round(Number(dollars) * 1_000_000);
    if (!isFinite(micro) || micro < 0) return { error: "amount must be a number >= 0" };
    creditGrants.users[userId] = micro;
    saveCreditGrants();
    stmts.aiCreditsRefresh.run(micro, Date.now(), userId);   // take effect immediately
    return { ok: true, userId, allowanceMicro: micro, dollars: +(micro / 1_000_000).toFixed(2) };
}
export function getCreditAllowance(userId) {
    return { allowanceMicro: dailyAllowanceMicro(userId), defaultMicro: AGENT_INITIAL_MICRO, isOverride: typeof creditGrants.users[userId] === "number" };
}

// Per-model price tiers in US dollars per 1,000,000 tokens. Because a balance is
// stored in micro-dollars, dollars-per-million conveniently equals
// micro-dollars-per-token, so cost = inTokens*in + outTokens*out (micro).
const PRICE_TIERS = {
    mini: { in: 0.5, out: 2 },
    mid:  { in: 1,   out: 4 },
    pro:  { in: 3,   out: 12 }
};
function modelTier(id) {
    const s = String(id).toLowerCase();
    if (/(pro|opus|grok-4\.3|deepseek|gemini-3\.1-pro)/.test(s)) return "pro";
    if (/(mini|flash|haiku|scout|small|aya|oss|llama-3\.3|qwen3-32b|nemotron)/.test(s)) return "mini";
    return "mid";
}
function priceFor(id) {
    return PRICE_TIERS[modelTier(id)] || PRICE_TIERS.mid;
}
// Cost of a turn in micro-dollars, given token counts and a model id.
function costMicro(modelId, inTokens, outTokens) {
    const p = priceFor(modelId);
    return Math.max(0, Math.ceil(inTokens * p.in + outTokens * p.out));
}
const estTokens = (chars) => Math.ceil(Math.max(0, chars) / 4);

// Read a user's balance, granting/refreshing the daily allowance as needed.
function getCreditsMicro(userId) {
    const row = stmts.aiCreditsGet.get(userId);
    const now = Date.now();
    const allowance = dailyAllowanceMicro(userId);
    if (!row || row.micro == null) {                          // first time we see them
        stmts.aiCreditsRefresh.run(allowance, now, userId);
        return allowance;
    }
    if (creditDayNum(row.grantedAt) < creditDayNum(now)) {    // a new day → refresh to allowance
        stmts.aiCreditsRefresh.run(allowance, now, userId);
        return allowance;
    }
    return row.micro;
}
function debitCreditsMicro(userId, micro) {
    if (micro > 0) stmts.aiCreditsDebit.run(micro, userId);
    const row = stmts.aiCreditsGet.get(userId);
    return row && row.micro != null ? row.micro : 0;
}

// ── Model access control ─────────────────────────────────────────────────────
// Each model has an audience: "all" (everyone), "owner" (god account only), or
// "off" (disabled for everyone). Premium models default to "owner"; the rest to
// "all". Admin overrides persist to data/model-access.json.
const MODEL_ACCESS_FILE = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "model-access.json");
let modelAccess = {};
try { modelAccess = JSON.parse(fs.readFileSync(MODEL_ACCESS_FILE, "utf8")); } catch { modelAccess = {}; }
function defaultAudience(id) { return MODELS[id]?.premium ? "owner" : "all"; }
function audienceOf(id) {
    const a = modelAccess[id];
    return (a === "all" || a === "owner" || a === "off") ? a : defaultAudience(id);
}
// Per-user model grants: give specific people access to otherwise-restricted
// (premium / owner-only) models. Persisted in data/model-grants.json as
// { "<userId>": ["navy:claude-opus-4.8", ...] }.
const MODEL_GRANTS_FILE = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "model-grants.json");
let modelGrants = {};
try { modelGrants = JSON.parse(fs.readFileSync(MODEL_GRANTS_FILE, "utf8")); } catch { modelGrants = {}; }
function userGrantedModels(userId) { return (userId != null && Array.isArray(modelGrants[userId])) ? modelGrants[userId] : []; }
// ── Free tier ────────────────────────────────────────────────────────────────
// The full model lineup is a paid feature. FREE accounts (and signed-out
// visitors) get exactly ONE model — no picker, no choice — while paid accounts
// and the owner keep everything. A per-user admin grant still overrides this,
// so individuals can be handed extra models without being marked paid.
const FREE_MODEL = "mai-sakurajima";
const FREE_FALLBACK_MODEL = "mai-sakurajima";

// Flash upstream health — flips only on a state CHANGE so the ops feed gets one
// "down" alert and one "recovered" alert, never a message per request.
let _flashDown = false;
function markFlashDown(e) {
    if (_flashDown) return;
    _flashDown = true;
    console.warn("[flash] upstream marked DOWN — free tier failing over to", FREE_FALLBACK_MODEL);
    sendAlert(`⚠️ **Flash upstream is down** (status ${String(e?.status ?? "?")}). Free-tier chat is falling back to **Grok 4.1** until it recovers — users still get answers, but this runs on Navy credits.`).catch(() => {});
}
function markFlashHealthy() {
    if (!_flashDown) return;
    _flashDown = false;
    console.log("[flash] upstream RECOVERED — free tier back on Flash");
    sendAlert("✅ **Flash upstream recovered.** Free-tier chat is back on Nocturne Flash.").catch(() => {});
}
function canUseModel(id, owner, userId) {
    if (!MODELS[id]) return false;
    if (owner) return true;
    const aud = audienceOf(id);
    if (aud === "off") return false;
    if (aud === "all") return true;
    if (userGrantedModels(userId).includes(id)) return true;
    if (isPaidUser(userId)) return true;
    return false;
}
export function setUserModelGrants(userId, modelIds) {
    const valid = (Array.isArray(modelIds) ? modelIds : []).map(String).filter(id => MODELS[id]);
    if (valid.length) modelGrants[userId] = [...new Set(valid)];
    else delete modelGrants[userId];
    try { fs.writeFileSync(MODEL_GRANTS_FILE, JSON.stringify(modelGrants)); } catch (e) { return { error: e.message }; }
    return { ok: true, userId, models: modelGrants[userId] || [] };
}
export function getUserModelGrants(userId) { return userGrantedModels(userId); }
export function premiumModelIds() { return Object.keys(MODELS).filter(id => MODELS[id].premium); }
export function setModelAccess(id, audience) {
    if (!MODELS[id]) return { error: "unknown model" };
    if (!["all", "owner", "off"].includes(audience)) return { error: "audience must be all|owner|off" };
    if (audience === defaultAudience(id)) delete modelAccess[id];
    else modelAccess[id] = audience;
    try { fs.writeFileSync(MODEL_ACCESS_FILE, JSON.stringify(modelAccess)); } catch (e) { return { error: e.message }; }
    return { ok: true, id, audience };
}
export function getModelAccessList() {
    return Object.entries(MODELS).map(([id, m]) => ({
        id, label: m.label, company: m.company || "Other", provider: m.provider,
        premium: !!m.premium, audience: audienceOf(id), default: defaultAudience(id),
        routing: m.provider !== "navy" ? m.provider
            : m.forceFallbackKey ? "reserved key (only)"
            : m.noFallbackKey ? "general pool (never reserved)"
            : "general pool (+reserved for owner/paid)"
    }));
}

// ── Daily token fair-use quota ───────────────────────────────────────────────
// Every account gets a daily token allowance (default 50k). The owner can raise
// it globally or per-user, optionally for a limited number of days. Usage is
// tracked in-memory on a rolling 24h window.
const QUOTA_FILE = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "quota.json");
const DEFAULT_DAILY_TOKENS = Number(process.env.NOCTURNE_DAILY_TOKENS) || 50_000;
const DAY_MS = 24 * 60 * 60 * 1000;
let quotaCfg = { global: null, users: {} };
try { quotaCfg = { global: null, users: {}, ...JSON.parse(fs.readFileSync(QUOTA_FILE, "utf8")) }; } catch {}
function saveQuota() { try { fs.writeFileSync(QUOTA_FILE, JSON.stringify(quotaCfg)); } catch {} }

// ── Paid customers ───────────────────────────────────────────────────────────
// Paid users get the reserved (fallback) navy key when the general pool is spent;
// free users are capped to the general pool. Persisted in data/paid-users.json.
const PAID_FILE = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "paid-users.json");
let paidUsers = {};
try { paidUsers = JSON.parse(fs.readFileSync(PAID_FILE, "utf8")) || {}; } catch {}
function savePaid() { try { fs.writeFileSync(PAID_FILE, JSON.stringify(paidUsers)); } catch {} }
export function isPaidUser(userId) {
    if (!userId) return false;
    if (isOwnerId(userId)) return true;     // owner always has full access
    return !!paidUsers[String(userId)];
}
export function setPaidUser(userId, paid) {
    const k = String(userId);
    if (paid) paidUsers[k] = true; else delete paidUsers[k];
    savePaid();
    return isPaidUser(userId);
}
export function getPaidUserIds() { return Object.keys(paidUsers).map(Number); }
function overrideActive(o) { return !!(o && typeof o.daily === "number" && (!o.until || o.until > Date.now())); }
// 1B tokens/day ceiling — matches the admin input cap and defensively bounds any
// stale or hand-edited override (an old 1e20 value would otherwise be pure
// overflow). 1B/day is effectively unlimited for a person; the owner is exempt
// from the quota entirely, so a real "unlimited" grant goes through that path.
const MAX_DAILY_TOKENS = 1_000_000_000;
function clampDaily(v) { return Math.min(MAX_DAILY_TOKENS, Math.max(0, Number(v) || 0)); }
function effectiveDaily(userId) {
    const u = quotaCfg.users[userId];
    if (overrideActive(u)) return clampDaily(u.daily);
    if (overrideActive(quotaCfg.global)) return clampDaily(quotaCfg.global.daily);
    return DEFAULT_DAILY_TOKENS;
}
const dailyUsage = new Map();   // userId -> { used, resetAt }
function getUsage(userId) {
    const now = Date.now();
    let e = dailyUsage.get(userId);
    if (!e || now >= e.resetAt) { e = { used: 0, resetAt: now + DAY_MS }; dailyUsage.set(userId, e); }
    return e;
}
function addUsage(userId, tokens) { const e = getUsage(userId); e.used += Math.max(0, tokens | 0); return e; }
// Signed adjustment (can refund) — used to reconcile an up-front quota reservation
// down to the exact tokens a request actually consumed. Floors the total at 0.
function adjustUsage(userId, delta) { const e = getUsage(userId); e.used = Math.max(0, e.used + (delta | 0)); return e; }
setInterval(() => { const now = Date.now(); for (const [k, e] of dailyUsage) if (now >= e.resetAt) dailyUsage.delete(k); }, 60 * 60_000).unref();

// ── Anonymous free AI allowance (Pocket AI) ─────────────────────────────────
// Signed-out visitors get a small taster: N prompts per rolling day, per IP, on
// the default free model only (no agent mode, no images, no premium models). It
// nudges them to make a (free) account instead of hard-blocking. Signed-in users
// are governed by the daily token quota instead.
const ANON_FREE_PROMPTS = Number(process.env.NOCTURNE_ANON_AI_PROMPTS) || 15;
const ANON_WINDOW_MS = 24 * 60 * 60_000;
const anonPrompts = new Map();   // ip -> { used, resetAt }
function anonIp(req) { return req.ip || req.socket?.remoteAddress || "anon"; }
function anonState(ip) {
    const now = Date.now();
    let e = anonPrompts.get(ip);
    if (!e || now >= e.resetAt) { e = { used: 0, resetAt: now + ANON_WINDOW_MS }; anonPrompts.set(ip, e); }
    return e;
}
function anonRemaining(ip) { const e = anonState(ip); return Math.max(0, ANON_FREE_PROMPTS - e.used); }
function bumpAnonPrompt(ip) {
    const e = anonState(ip);
    if (e.used >= ANON_FREE_PROMPTS) return { ok: false, remaining: 0, resetAt: e.resetAt };
    e.used++;
    return { ok: true, remaining: ANON_FREE_PROMPTS - e.used, resetAt: e.resetAt };
}
setInterval(() => { const now = Date.now(); for (const [k, e] of anonPrompts) if (now >= e.resetAt) anonPrompts.delete(k); }, 60 * 60_000).unref();

export function setQuotaOverride({ scope, userId, dailyTokens, days } = {}) {
    const until = (typeof days === "number" && days > 0) ? Date.now() + days * DAY_MS : null;
    const remove = dailyTokens == null || !isFinite(Number(dailyTokens));
    if (scope === "global") {
        quotaCfg.global = remove ? null : { daily: Math.max(0, Math.round(Number(dailyTokens))), until };
    } else {
        if (!userId) return { error: "userId required" };
        if (remove) delete quotaCfg.users[userId];
        else quotaCfg.users[userId] = { daily: Math.max(0, Math.round(Number(dailyTokens))), until };
    }
    saveQuota();
    return { ok: true, scope, userId, global: quotaCfg.global, user: quotaCfg.users[userId] || null };
}
export function getQuotaConfig() {
    return { defaultDaily: DEFAULT_DAILY_TOKENS, global: quotaCfg.global, users: quotaCfg.users };
}
export function getDailyUsage(userId) {
    const e = getUsage(userId);
    return { used: e.used, cap: effectiveDaily(userId), resetAt: e.resetAt };
}
// Aggregate AI stats for the admin dashboard.
// Per-key pool view for the admin panel: role (general vs reserved fallback),
// health counters, and cooldown remaining. Keys themselves are never exposed.
function getKeyPoolStatus() {
    const now = Date.now();
    const fb = fallbackNavyState();
    const general = generalNavyStates();
    const row = (s, role) => ({
        index: s.index, role,
        failures: s.failures, successes: s.successes,
        coolingDown: s.cooldownUntil > now,
        cooldownSec: s.cooldownUntil > now ? Math.ceil((s.cooldownUntil - now) / 1000) : 0
    });
    const rows = navyKeyState.map(s => row(s, (fb && s.index === fb.index && !general.includes(s)) ? "reserved" : "general"));
    if (NAVY_OPUS_KEY && fb) rows.unshift(row(fb, "reserved (dedicated)"));
    return { total: navyKeyState.length, reserved: fb ? fb.index : null, dedicatedOpusKey: !!NAVY_OPUS_KEY, keys: rows };
}
export function getAiStats() {
    const now = Date.now();
    let tokensToday = 0, activeToday = 0;
    for (const [, e] of dailyUsage) { if (now < e.resetAt) { tokensToday += e.used; if (e.used > 0) activeToday++; } }
    return {
        tokensToday, activeToday,
        defaultDaily: DEFAULT_DAILY_TOKENS,
        globalDaily: overrideActive(quotaCfg.global) ? quotaCfg.global.daily : DEFAULT_DAILY_TOKENS,  // effective cap for everyone
        keys: { groq: keyState.length, navy: navyKeyState.length, openrouter: !!OPENROUTER_KEY },
        keyPool: getKeyPoolStatus(),
        models: Object.keys(MODELS).length,
        spend: getPlatformUsage()
    };
}

// ── Persistent AI usage (tokens + estimated $ per user per day) ──────────────
const usageDayNum = () => Math.floor(Date.now() / DAY_MS);
function recordUsage(userId, tokens, costMicro) {
    if (!userId) return;
    try { stmts.aiUsageAdd.run(userId, usageDayNum(), Math.max(0, tokens | 0), Math.max(0, Math.round(costMicro || 0))); } catch {}
}
// Per-request log for the public /api/ai endpoint - backs the Logs pane and the
// per-model usage-on-hover stats. Never throws; a logging failure must not break
// the actual API response.
function logAiRequest(userId, model, ok, statusCode, latencyMs, inTok, outTok, err, meta) {
    if (!userId) return;
    try {
        stmts.aiLogInsert.run(userId, String(model || ""), ok ? 1 : 0, statusCode | 0, Math.max(0, latencyMs | 0),
            Math.max(0, inTok | 0), Math.max(0, outTok | 0), err ? String(err).slice(0, 300) : null, Date.now());
    } catch {}
    // Mirror into the Discord activity feed (AI API section).
    logActivity("ai_api", { userId, model, ok, status: statusCode | 0, tokens: (inTok | 0) + (outTok | 0), latencyMs: Math.max(0, latencyMs | 0), ip: meta?.ip, fp: meta?.fp });
}
export function getUserUsageStats(userId) {
    const weekStart = usageDayNum() - 6;
    const w = stmts.aiUsageUser.get(userId, weekStart) || { tokens: 0, cost: 0 };
    const a = stmts.aiUsageUserAll.get(userId) || { tokens: 0, cost: 0 };
    return { weekTokens: w.tokens, weekCostMicro: w.cost, weekCost: +(w.cost / 1e6).toFixed(2), allTokens: a.tokens, allCostMicro: a.cost, allCost: +(a.cost / 1e6).toFixed(2) };
}
export function getPlatformUsage() {
    const weekStart = usageDayNum() - 6;
    const w = stmts.aiUsagePlatform.get(weekStart) || { tokens: 0, cost: 0 };
    const a = stmts.aiUsagePlatformAll.get() || { tokens: 0, cost: 0 };
    return { weekTokens: w.tokens, weekCostMicro: w.cost, weekCost: +(w.cost / 1e6).toFixed(2), allTokens: a.tokens, allCostMicro: a.cost, allCost: +(a.cost / 1e6).toFixed(2) };
}

function isOwnerUser(req) {
    return !!(req?.user?.username && req.user.username.toLowerCase() === OWNER_USERNAME);
}

function sanitizeModel(model) {
    if (!model || typeof model !== "string") return DEFAULT_MODEL;
    return MODELS[model] ? model : DEFAULT_MODEL;
}

function clamp(n, min, max, def) {
    if (typeof n !== "number" || !isFinite(n)) return def;
    return Math.max(min, Math.min(max, n));
}

function contentToText(c) {
    if (typeof c === "string") return c;
    if (Array.isArray(c)) return c.map(p => (p && p.type === "text") ? (p.text || "") : ((p && p.type === "image_url") ? "[image]" : "")).join(" ").trim();
    return "";
}

const _tzCache = new Map();
const TZ_CACHE_TTL = 24 * 60 * 60 * 1000;
async function ipTimezone(ip) {
    if (!ip || ip === "anon" || ip === "::1" || ip.startsWith("127.")) return null;
    const clean = ip.replace(/^::ffff:/, "");
    const cached = _tzCache.get(clean);
    if (cached && Date.now() - cached.ts < TZ_CACHE_TTL) return cached.tz;
    try {
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 3000);
        const r = await fetch(`http://ip-api.com/json/${encodeURIComponent(clean)}?fields=timezone`, { signal: ac.signal });
        clearTimeout(timer);
        if (!r.ok) return null;
        const j = await r.json();
        const tz = j.timezone || null;
        if (tz) _tzCache.set(clean, { tz, ts: Date.now() });
        if (_tzCache.size > 5000) { const first = _tzCache.keys().next().value; _tzCache.delete(first); }
        return tz;
    } catch { return null; }
}
function formatDateTime(tz) {
    try {
        const now = new Date();
        const fmt = new Intl.DateTimeFormat("en-US", { timeZone: tz || "UTC", weekday: "long", year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", second: "2-digit", hour12: true, timeZoneName: "short" });
        return fmt.format(now);
    } catch { return new Date().toUTCString(); }
}

function buildParams(req, opts = {}) {
    const modelId = sanitizeModel(req.body?.model);
    const cfg = MODELS[modelId];
    // When a turn is transparently routed to a different backend (a text-only
    // model's `visionVia` fallback), the user still believes they are talking to
    // the model they picked. `face` is that user-facing model: it supplies the
    // identity prompt and the NAME used below, so the substitute backend never
    // introduces itself under its own name.
    const face = (opts.presentAs && MODELS[opts.presentAs]) || cfg;
    const def = cfg.defaults;
    let messages = req.body.messages;
    const timeInfo = opts.dateTime ? `\nCurrent date and time: ${opts.dateTime}` : "";
    if (cfg.systemPrompt) {
        messages = [{ role: "system", content: cfg.systemPrompt + timeInfo }, ...messages.filter(m => m.role !== "system")];
    } else if (face.identityPrompt) {
        // Unlike systemPrompt, this PREPENDS — callers that supply their own system
        // message (the IDE assistant, agent mode) keep it.
        messages = [{ role: "system", content: face.identityPrompt + timeInfo }, ...messages];
    } else if (timeInfo) {
        messages = [{ role: "system", content: timeInfo.trim() }, ...messages];
    }
    // Thinking level (off / normal / extended) drives a system instruction naming
    // the model — a portable way to ask for more reasoning that every model honors.
    const level = String(req.body?.level || "").toLowerCase();
    let thinkingPrompt = "";
    if (level === "normal") thinkingPrompt = `You are ${face.label}, think through the problem carefully before responding.`;
    else if (level === "extended") thinkingPrompt = `You are ${face.label}, think deeply and thoroughly about this, considering multiple angles before responding.`;
    if (thinkingPrompt) messages = [{ role: "system", content: thinkingPrompt }, ...messages];

    const params = {
        model: modelId,
        messages,
        temperature: clamp(req.body?.temperature, 0, 2, def.temperature),
        top_p: clamp(req.body?.top_p, 0, 1, def.top_p),
        max_completion_tokens: clamp(req.body?.max_completion_tokens, 1, cfg.max_completion_tokens_cap, def.max_completion_tokens)
    };
    // "off" means no extra reasoning at all; otherwise pass through the effort.
    if (cfg.reasoning && level !== "off") {
        let effort = String(req.body?.reasoning_effort || def.reasoning_effort || "medium").toLowerCase();
        // groq also accepts "default"; OpenAI-compatible providers want low/medium/high.
        const allowed = new Set(cfg.provider === "groq" ? ["default", "low", "medium", "high"] : ["low", "medium", "high"]);
        if (!allowed.has(effort)) effort = cfg.provider === "groq" ? (def.reasoning_effort || "medium") : "medium";
        params.reasoning_effort = effort;
        if (cfg.provider === "groq") params.reasoning_format = "parsed";
    }
    return params;
}

async function* runNavyStream(params, signal) {
    if (!navyKeyState.length) {
        console.error("[navy] no key configured");
        throw Object.assign(new Error("Navy AI is not configured: set NAVY_API_KEY env var or data/navy-key"), { status: 503 });
    }

    const cfg = MODELS[params.model];
    const upstream = (cfg && cfg.upstreamModel) || params.model.replace(/^navy:/, "");
    const noStream = !!(cfg && cfg.noStream);
    const baseBody = {
        model: upstream,
        messages: params.messages,
        max_tokens: params.max_completion_tokens,
        stream: !noStream
    };
    // Omit deprecated params for models that reject them (they use their defaults).
    if (!TOPP_LOCKED.has(upstream)) baseBody.top_p = params.top_p;
    if (!TEMP_LOCKED.has(upstream)) baseBody.temperature = params.temperature;
    // Ask the provider for exact token usage in the final stream chunk.
    if (!noStream) baseBody.stream_options = { include_usage: true };
    const buildBody = (opts = {}) => {
        const b = { ...baseBody };
        if (opts.dropTemp) delete b.temperature;
        if (opts.dropTopP) delete b.top_p;
        if (opts.dropStreamOpts) delete b.stream_options;
        if (!opts.dropReasoning && params.reasoning_effort) b.reasoning_effort = params.reasoning_effort;
        return JSON.stringify(b);
    };

    // Opus/Sonnet are pinned to the reserved key; all other models rotate only
    // among the general keys and never touch the reserved key.
    const forceFb = !!(cfg && cfg.forceFallbackKey);
    const noFb = !!(cfg && cfg.noFallbackKey);   // e.g. Opus 5 — general pool only, even for owner/paid
    const paid = !!params.paid;
    const owner = !!params.owner;
    // Candidate keys, in priority order. Everyone gets the general pool; the
    // reserved fallback key is added for forced models (opus/sonnet, which use it
    // EXCLUSIVELY), prepended for the OWNER (always prefers it), and appended for
    // PAID users (fallback when the general pool is spent). Free users never touch
    // it, so a spent general pool yields a clean "all AI in use" rather than
    // silently consuming the reserved key.
    const _fb = fallbackNavyState();
    const candidates = forceFb
        ? (_fb ? [_fb] : [])
        : (() => {
            const g = generalNavyStates().slice();
            if (noFb || !_fb || g.some(s => s.index === _fb.index)) return g;
            if (owner) return [_fb, ...g];
            if (paid) g.push(_fb);
            return g;
        })();

    const tried = new Set();
    let lastErr = null;

    for (let attempt = 0; attempt < candidates.length; attempt++) {
        const now = Date.now();
        const state = candidates.find(c => !tried.has(c.index) && c.cooldownUntil <= now)
                   || candidates.find(c => !tried.has(c.index));
        if (!state) break;
        tried.add(state.index);
        const safeKey = sanitizeKey(state.key);
        if (!safeKey) continue;

        const headers = new Headers();
        headers.set("Authorization", "Bearer " + safeKey);
        headers.set("Content-Type", "application/json");
        headers.set("Accept", noStream ? "application/json" : "text/event-stream");
        const navyFetch = (opts) => fetch(`${NAVY_BASE}/chat/completions`, { method: "POST", headers, body: buildBody(opts), signal });

        console.log("[navy] attempt", attempt, "key", state.index, safeKey.slice(0, 4) + "…" + safeKey.slice(-4), upstream);
        let res;
        try {
            res = await navyFetch({});
        } catch (e) {
            if (signal?.aborted) throw e;
            console.error("[navy] fetch threw:", e.message);
            lastErr = e; markNavyFail(state, 60_000); continue;
        }

        // Some models deprecate MULTIPLE params (e.g. Opus rejects both top_p and
        // temperature) and the upstream reports them one at a time. Keep dropping
        // whatever each 400 complains about and re-trying until it stops (or there's
        // nothing left to drop).
        if (!res.ok && res.status === 400) {
            const dropOpts = {};
            let netErr = false, safety = 0;
            while (!res.ok && res.status === 400 && safety++ < 5) {
                let detail = "";
                try { detail = await res.text(); } catch {}
                let added = false;
                if (/reasoning/i.test(detail) && params.reasoning_effort && !dropOpts.dropReasoning) { dropOpts.dropReasoning = true; added = true; }
                if (/temperature/i.test(detail) && baseBody.temperature !== undefined && !dropOpts.dropTemp) { dropOpts.dropTemp = true; added = true; }
                if (/top_p/i.test(detail) && baseBody.top_p !== undefined && !dropOpts.dropTopP) { dropOpts.dropTopP = true; added = true; }
                if (/stream_option/i.test(detail) && baseBody.stream_options !== undefined && !dropOpts.dropStreamOpts) { dropOpts.dropStreamOpts = true; added = true; }
                if (!added) {
                    throw Object.assign(new Error(`Navy upstream 400: ${detail.slice(0, 200) || res.statusText}`), { status: 400 });
                }
                console.log("[navy] retrying without", Object.keys(dropOpts).map(k => k.slice(4).toLowerCase()).join(" + "));
                try { res = await navyFetch(dropOpts); }
                catch (e) { if (signal?.aborted) throw e; lastErr = e; markNavyFail(state, 60_000); netErr = true; break; }
            }
            if (netErr) continue;   // network error mid-retry → next key (or stop for a pinned key)
        }

        if (!res.ok) {
            let detail = "";
            try { detail = await res.text(); } catch {}
            console.error("[navy] upstream error:", res.status, detail.slice(0, 200));
            // Rotate to the next key on auth / rate-limit failures; other errors are real.
            if (res.status === 401 || res.status === 403) {
                markNavyFail(state, 24 * 60 * 60_000);
                console.warn(`[navy] auth error on key ${state.index}; rotating to fallback`);
                lastErr = Object.assign(new Error(`Navy upstream ${res.status}: ${detail.slice(0, 120) || res.statusText}`), { status: res.status });
                continue;
            }
            if (res.status === 429 || res.status === 503) {
                markNavyFail(state, navyRetryAfter(res));
                console.warn(`[navy] rate limited on key ${state.index}; rotating to fallback`);
                lastErr = Object.assign(new Error(`Navy upstream ${res.status}`), { status: res.status });
                continue;
            }
            throw Object.assign(new Error(`Navy upstream ${res.status}: ${detail.slice(0, 200) || res.statusText}`), { status: res.status });
        }

        markNavySuccess(state);

        // Some navy models (Gemini, DeepSeek) error or return nothing when streamed,
        // but work fine non-streamed. For those, fetch the full reply and emit it as one chunk.
        if (noStream) {
            const data = await res.json().catch(() => null);
            const ch = data && data.choices && data.choices[0];
            const msg = ch && ch.message;
            const content = (msg && (msg.content || msg.reasoning_content || msg.reasoning)) || "";
            yield { keyIndex: state.index, chunk: { choices: [{ delta: { content }, finish_reason: (ch && ch.finish_reason) || "stop" }], usage: data && data.usage } };
            return;
        }

        if (!res.body) throw new Error("Navy: no response body");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "", yielded = 0;
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const events = buf.split(/\r?\n\r?\n/);
            buf = events.pop() || "";
            for (const ev of events) {
                for (const line of ev.split(/\r?\n/)) {
                    const t = line.trim();
                    if (!t.startsWith("data:")) continue;
                    const payload = t.slice(5).trim();
                    if (!payload || payload === "[DONE]") continue;
                    try { const chunk = JSON.parse(payload); yielded++; yield { keyIndex: state.index, chunk }; }
                    catch { console.warn("[navy] parse fail:", payload.slice(0, 100)); }
                }
            }
        }
        console.log("[navy] stream done, yielded chunks:", yielded);
        return;
    }

    // General pool spent. Free users have no reserved-key access → clear message.
    if (!forceFb && lastErr && (lastErr.status === 429 || lastErr.status === 503)) {
        throw Object.assign(new Error(paid
            ? "AI capacity is temporarily maxed out — please try again in a moment."
            : "All free AI capacity is in use right now. Upgrade to a paid plan for priority access, or try again later."), { status: 429, allUsed: true });
    }
    throw lastErr || Object.assign(new Error("All Navy keys failed"), { status: 503 });
}

// The free-tier backend: a plain OpenAI-compatible /chat/completions endpoint.
// Errors are phrased without naming the upstream so they can be surfaced to users.
async function* runFlashStream(params, signal) {
    const safeKey = sanitizeKey(FLASH_KEY);
    if (!safeKey) {
        throw Object.assign(new Error("The free AI model is not configured: set NOCTURNE_FLASH_KEY or data/flash-key"), { status: 503 });
    }
    const cfg = MODELS[params.model];
    const upstream = (cfg && cfg.upstreamModel) || params.model.replace(/^[^:]+:/, "");
    const body = {
        model: upstream,
        messages: params.messages,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_completion_tokens,
        stream: true,
        stream_options: { include_usage: true }
    };
    if (params.reasoning_effort) body.reasoning_effort = params.reasoning_effort;

    const headers = new Headers();
    headers.set("Authorization", "Bearer " + safeKey);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "text/event-stream");

    let res;
    try {
        res = await fetch(`${FLASH_BASE}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal });
    } catch (e) {
        if (signal?.aborted) throw e;
        console.error("[flash] fetch threw:", e.message);
        throw e;
    }
    if (!res.ok) {
        let detail = "";
        try { detail = await res.text(); } catch {}
        console.error("[flash] upstream error:", res.status, detail.slice(0, 200));
        const msg = res.status === 429 || res.status === 503
            ? "The free AI model is busy right now — please try again in a moment."
            : `The free AI model is temporarily unavailable (${res.status}).`;
        throw Object.assign(new Error(msg), { status: res.status });
    }
    if (!res.body) throw new Error("The free AI model returned no response body.");

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split(/\r?\n\r?\n/);
        buf = events.pop() || "";
        for (const ev of events) {
            for (const line of ev.split(/\r?\n/)) {
                const t = line.trim();
                if (!t.startsWith("data:")) continue;
                const payload = t.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                try { yield { keyIndex: -1, chunk: JSON.parse(payload) }; }
                catch { console.warn("[flash] parse fail:", payload.slice(0, 100)); }
            }
        }
    }
}

// InkChan provider: OpenAI-compatible endpoint at ai.inknetworks.site
async function* runInkChanStream(params, signal) {
    const safeKey = sanitizeKey(INKCHAN_KEY);
    if (!safeKey) {
        throw Object.assign(new Error("InkChan is not configured: set INKCHAN_API_KEY or data/inkchan-key"), { status: 503 });
    }
    const cfg = MODELS[params.model];
    const upstream = (cfg && cfg.upstreamModel) || "ink-chan:latest";
    const body = {
        model: upstream,
        messages: params.messages,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_completion_tokens,
        stream: true
    };

    const headers = new Headers();
    headers.set("Authorization", "Bearer " + safeKey);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "text/event-stream");
    headers.set("User-Agent", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");

    let res;
    try {
        res = await fetch(`${INKCHAN_BASE}/chat/completions`, { method: "POST", headers, body: JSON.stringify(body), signal, redirect: "manual" });
    } catch (e) {
        if (signal?.aborted) throw e;
        console.error("[inkchan] fetch threw:", e.message);
        throw e;
    }
    // Cloudflare in front of this host 308s POST /chat/completions back to the
    // same URL. Following it is an infinite loop that undici reports as
    // "fetch failed", which the chat handler then returns as HTTP 502.
    if (res.status >= 300 && res.status < 400) {
        console.error("[inkchan] upstream redirect loop:", res.status, res.headers.get("location") || "");
        throw Object.assign(new Error("InkChan upstream redirect loop"), { status: 502 });
    }
    if (!res.ok) {
        let detail = "";
        try { detail = await res.text(); } catch {}
        console.error("[inkchan] upstream error:", res.status, detail.slice(0, 200));
        throw Object.assign(new Error(`InkChan upstream ${res.status}: ${detail.slice(0, 200) || res.statusText}`), { status: res.status });
    }
    if (!res.body) throw new Error("InkChan returned no response body.");

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split(/\r?\n\r?\n/);
        buf = events.pop() || "";
        for (const ev of events) {
            for (const line of ev.split(/\r?\n/)) {
                const t = line.trim();
                if (!t.startsWith("data:")) continue;
                const payload = t.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                try { yield { keyIndex: -1, chunk: JSON.parse(payload) }; }
                catch { console.warn("[inkchan] parse fail:", payload.slice(0, 100)); }
            }
        }
    }
}

async function* runOpenRouterStream(params, signal, originHeaders) {
    const safeKey = sanitizeKey(OPENROUTER_KEY);
    if (!safeKey) {
        throw Object.assign(new Error("OpenRouter is not configured: set OPENROUTER_API_KEY env var or data/openrouter-key"), { status: 503 });
    }
    console.log("[openrouter] using key length:", safeKey.length, "first/last 4:", safeKey.slice(0,4) + "…" + safeKey.slice(-4));
    const cfg = MODELS[params.model];
    const upstream = (cfg && cfg.upstreamModel) || params.model.replace(/^openrouter:/, "");
    const baseBody = {
        model: upstream,
        messages: params.messages,
        temperature: params.temperature,
        top_p: params.top_p,
        max_tokens: params.max_completion_tokens,
        stream: true,
        stream_options: { include_usage: true }
    };
    const buildBody = (withReasoning) => {
        const b = { ...baseBody };
        if (withReasoning && params.reasoning_effort) b.reasoning = { effort: params.reasoning_effort };
        return JSON.stringify(b);
    };

    const refRaw = originHeaders?.referer || "";
    const refClean = sanitizeKey(refRaw) || "https://nocturne.lol";
    const headers = new Headers();
    headers.set("Authorization", "Bearer " + safeKey);
    headers.set("Content-Type", "application/json");
    headers.set("Accept", "text/event-stream");
    headers.set("HTTP-Referer", refClean);
    headers.set("X-Title", "Nocturne");

    const orFetch = (withReasoning) => fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: "POST", headers, body: buildBody(withReasoning), signal
    });

    console.log("[openrouter] fetching", upstream, "msgs:", params.messages.length);
    let res;
    try {
        res = await orFetch(true);
    } catch (e) {
        console.error("[openrouter] fetch threw:", e.message);
        throw e;
    }
    if (!res.ok && res.status === 400 && params.reasoning_effort) {
        let detail = "";
        try { detail = await res.text(); } catch {}
        if (/reasoning/i.test(detail)) {
            console.log("[openrouter] model rejects reasoning; retrying without it");
            try { res = await orFetch(false); } catch (e) { console.error("[openrouter] retry threw:", e.message); throw e; }
        } else {
            throw Object.assign(new Error(`OpenRouter upstream 400: ${detail.slice(0, 200) || res.statusText}`), { status: 400 });
        }
    }
    console.log("[openrouter] response", res.status);

    if (!res.ok) {
        let detail = "";
        try { detail = await res.text(); } catch {}
        console.error("[openrouter] upstream error:", res.status, detail.slice(0, 200));
        throw Object.assign(new Error(`OpenRouter upstream ${res.status}: ${detail.slice(0, 200) || res.statusText}`), { status: res.status });
    }
    if (!res.body) throw new Error("OpenRouter: no response body");

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const events = buf.split(/\r?\n\r?\n/);
        buf = events.pop() || "";
        for (const ev of events) {
            for (const line of ev.split(/\r?\n/)) {
                const trimmed = line.trim();
                if (!trimmed.startsWith("data:")) continue;
                const payload = trimmed.slice(5).trim();
                if (!payload || payload === "[DONE]") continue;
                if (payload.startsWith(":")) continue;
                try {
                    const chunk = JSON.parse(payload);
                    yield { keyIndex: -1, chunk };
                } catch {}
            }
        }
    }
}

// Groq model used when InkChan is unreachable. The user-facing id stays
// mai-sakurajima; only the upstream call changes.
const INKCHAN_FALLBACK_GROQ_MODEL = "openai/gpt-oss-20b";

async function* runGroqFallbackStream(params, signal) {
    if (!keyState.length) {
        throw Object.assign(new Error("Groq is not configured: set GROQ_API_KEYS env var"), { status: 503 });
    }
    const body = {
        model: INKCHAN_FALLBACK_GROQ_MODEL,
        messages: params.messages,
        temperature: params.temperature,
        top_p: params.top_p,
        max_completion_tokens: params.max_completion_tokens,
        stream: true,
        stream_options: { include_usage: true }
    };
    const tried = new Set();
    let lastErr = null;
    for (let attempt = 0; attempt < Math.max(3, keyState.length); attempt++) {
        const state = pickKey();
        if (!state || tried.has(state.index)) {
            if (tried.size >= keyState.length) break;
            continue;
        }
        tried.add(state.index);
        let res;
        try {
            res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
                method: "POST",
                headers: {
                    Authorization: "Bearer " + state.key,
                    "Content-Type": "application/json",
                    Accept: "text/event-stream"
                },
                body: JSON.stringify(body),
                signal
            });
        } catch (e) {
            if (signal?.aborted) throw e;
            lastErr = e;
            console.warn("[groq] fallback fetch threw:", e.message);
            continue;
        }
        if (!res.ok) {
            let detail = "";
            try { detail = await res.text(); } catch {}
            lastErr = Object.assign(new Error(detail.slice(0, 200) || res.statusText), { status: res.status });
            console.warn("[groq] fallback upstream", res.status, "key", maskKey(state.key));
            if (isRateLimit(lastErr)) { markFailure(state, 0); continue; }
            if (isAuthError(lastErr)) { markFailure(state, 24 * 60 * 60_000); continue; }
            throw lastErr;
        }
        markSuccess(state);
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let buf = "";
        while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += dec.decode(value, { stream: true });
            const events = buf.split(/\r?\n\r?\n/);
            buf = events.pop() || "";
            for (const ev of events) {
                for (const line of ev.split(/\r?\n/)) {
                    const t = line.trim();
                    if (!t.startsWith("data:")) continue;
                    const payload = t.slice(5).trim();
                    if (!payload || payload === "[DONE]") continue;
                    try { yield { keyIndex: state.index, chunk: JSON.parse(payload) }; }
                    catch { console.warn("[groq] fallback parse fail:", payload.slice(0, 100)); }
                }
            }
        }
        return;
    }
    throw lastErr || Object.assign(new Error("All Groq keys exhausted"), { status: 503 });
}

async function* runChatStream(params, signal, ctx) {
    const cfg = MODELS[params.model];
    if (cfg && cfg.provider === "inkchan") {
        // ai.inknetworks.site answers every POST with a 308 back to the same
        // URL. Following that loop is what the chat handler was returning as
        // HTTP 502. Answer on Groq instead of contacting that host.
        yield* runGroqFallbackStream(params, signal);
        return;
    }
    if (cfg && cfg.provider === "flash") {
        yield* runFlashStream(params, signal);
        return;
    }
    if (cfg && cfg.provider === "navy") {
        yield* runNavyStream(params, signal);
        return;
    }
    if (cfg && cfg.provider === "openrouter") {
        yield* runOpenRouterStream(params, signal, ctx?.headers);
        return;
    }

    if (!keyState.length) {
        throw Object.assign(new Error("Groq is not configured: set GROQ_API_KEYS env var"), { status: 503 });
    }

    const tried = new Set();
    let lastErr = null;

    for (let attempt = 0; attempt < Math.max(3, keyState.length); attempt++) {
        const state = pickKey();
        if (!state || tried.has(state.index)) {
            if (attempt > 0 && !lastErr) break;
            if (tried.size >= keyState.length) break;
            continue;
        }
        tried.add(state.index);

        const client = new Groq({ apiKey: state.key });
        try {
            console.log("[groq] attempt", attempt, "key", maskKey(state.key));
            // `paid`/`owner`/`presentModel` are internal (key-pool selection and the
            // user-facing model label) - the Groq SDK rejects unknown properties, so
            // they must never reach client.chat.completions.create.
            const { paid, owner, presentModel, ...groqParams } = params;
            const stream = await client.chat.completions.create({
                ...groqParams,
                stream: true,
                stream_options: { include_usage: true }
            });

            markSuccess(state);
            let n = 0;
            for await (const chunk of stream) {
                n++;
                yield { keyIndex: state.index, chunk };
            }
            console.log("[groq] success, chunks:", n);
            return;
        } catch (e) {
            console.log("[groq] fetch threw:", e?.status, e?.message?.slice(0, 80));
            lastErr = e;
            if (signal?.aborted) throw e;

            // Some Groq models do not accept reasoning params. Drop them and retry.
            if (e?.status === 400 && /reasoning/i.test(e?.message || "") && (params.reasoning_effort || params.reasoning_format)) {
                console.log("[groq] model rejects reasoning params; retrying without them");
                delete params.reasoning_effort;
                delete params.reasoning_format;
                tried.delete(state.index);
                continue;
            }

            if (isRateLimit(e)) {
                const retryAfter = parseRetryAfter(e);
                markFailure(state, retryAfter);
                console.warn(`[groq] rate limited on key ${maskKey(state.key)} (idx ${state.index}); rotating`);
                continue;
            }
            if (isAuthError(e)) {
                markFailure(state, 24 * 60 * 60_000);
                console.warn(`[groq] auth error on key ${maskKey(state.key)} (idx ${state.index}); long cooldown`);
                continue;
            }
            throw e;
        }
    }

    throw lastErr || Object.assign(new Error("All Groq keys exhausted"), { status: 503 });
}

// ── Free-tier agentic web search ─────────────────────────────────────────────
// DeepSeek V4 Flash (FREE_MODEL) can call a web_search tool for research/current-
// events questions. It doesn't do the searching itself: a small router call asks
// it whether the turn needs one, and if so the actual search is executed by
// gpt-4o-mini-search-preview (which has real browsing/grounding), then the
// result is handed back to DeepSeek to summarize into the final answer.
const WEB_SEARCH_MODEL_ID = "mai-sakurajima";

// Transient upstream/network failures worth a silent retry rather than surfacing
// to the user — the flash reseller in particular drops mid-stream sometimes,
// which used to bubble straight up as a raw "Error in input stream" on every
// free-tier turn (agent mode already retried this exact class of error; plain
// chat never did, and now makes several more calls per turn via web search /
// extended thinking, so a single hiccup anywhere in that chain used to fail the
// whole turn).
const RETRYABLE_STREAM_ERROR_RE = /input stream|ECONNRESET|terminated|socket|premature|network|reset|EPIPE|fetch failed|other side closed|stream error/i;

// Runs a model to completion (no partial streaming to the caller) and returns
// the full text + any usage/annotations. Used for the router and search calls,
// which are internal steps, never shown to the user token-by-token — so a
// transient failure here can be retried from scratch with no visible effect.
async function runOneShot(modelId, messages, signal, ctx, maxTokens) {
    const cfg = MODELS[modelId];
    const params = { model: modelId, messages, temperature: 0.3, top_p: 1, max_completion_tokens: maxTokens };
    if (cfg?.reasoning) params.reasoning_effort = "low";
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, 400 * attempt));
        let text = "", usage = null, annotations = [];
        try {
            for await (const { chunk } of runChatStream(params, signal, ctx)) {
                if (chunk?.usage) usage = chunk.usage;
                const d = chunk?.choices?.[0]?.delta || {};
                text += d.content || "";
                if (Array.isArray(d.annotations)) annotations.push(...d.annotations);
            }
            return { text: text.trim(), usage, annotations };
        } catch (e) {
            lastErr = e;
            if (signal?.aborted || !RETRYABLE_STREAM_ERROR_RE.test(e?.message)) throw e;
        }
    }
    throw lastErr;
}

// Fast regex router: detects search-worthy queries in <1ms instead of an AI call.
const SEARCH_TRIGGERS = [
    /\b(?:weather|forecast|temperature|rain(?:ing)?|snow(?:ing)?|humidity)\b.*\b(?:today|tonight|tomorrow|now|this week|currently|right now|outside|in \w+)\b/i,
    /\b(?:today|tonight|tomorrow|this week|right now|currently)\b.*\b(?:weather|forecast|temperature)\b/i,
    /\b(?:stock|share)\s*(?:price|value|market)/i,
    /\b(?:price|cost|worth)\s*(?:of|for)\s*(?:bitcoin|btc|ethereum|eth|crypto|gold|silver|oil)\b/i,
    /\b(?:bitcoin|btc|ethereum|eth|doge|solana)\s*(?:price|value|worth|at)\b/i,
    /\b(?:latest|recent|breaking|current|today'?s)\s*(?:news|headlines|updates|events|results|score)/i,
    /\b(?:who\s+won|score|results?\s+(?:of|for)|final\s+score)\b.*\b(?:game|match|series|championship|cup|tournament|finals|election)\b/i,
    /\b(?:game|match|series|championship|cup|tournament|finals|election)\b.*\b(?:who\s+won|score|results?|winner)\b/i,
    /\b(?:live|current|real-?\s*time)\s*(?:score|results?|standings|updates?)\b/i,
    /\b(?:is|are|was)\s+\w+\s+(?:open|closed|down|up|available|working|online|offline)\s*(?:today|now|right now|currently)?\s*\??$/i,
    /\b(?:what(?:'s| is| are)|how much)\b.*\b(?:right now|today|currently|this (?:week|month|year)|latest)\b/i,
    /\b(?:search|google|look up|find out|check)\b.*\b(?:for me|online|on the web|the internet)\b/i,
];

function decideWebSearch(messages) {
    const last = [...messages].reverse().find(m => m.role === "user");
    if (!last) return { query: null, usage: null };
    const text = contentToText(last.content).trim();
    if (!text || text.length > 500) return { query: null, usage: null };
    for (const re of SEARCH_TRIGGERS) {
        if (re.test(text)) return { query: text.slice(0, 300), usage: null };
    }
    return { query: null, usage: null };
}

// Web search via Bing RSS + DDG Instant Answer enrichment + InkChan summarization.
const SEARCH_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
function decodeXmlEntities(s) { return s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'"); }

async function fetchBingRSS(query, signal) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 8000);
    const forward = () => ac.abort();
    if (signal) signal.addEventListener("abort", forward, { once: true });
    try {
        const res = await fetch("https://www.bing.com/search?q=" + encodeURIComponent(query) + "&format=rss&count=8", {
            headers: { "User-Agent": SEARCH_UA }, signal: ac.signal
        });
        if (!res.ok) return [];
        const xml = await res.text();
        const results = [];
        for (const m of xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)) {
            const item = m[1];
            const title = decodeXmlEntities((item.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || "").trim();
            const link = decodeXmlEntities((item.match(/<link>([\s\S]*?)<\/link>/) || [])[1] || "").trim();
            const snippet = decodeXmlEntities(((item.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || "").replace(/<[^>]+>/g, "")).trim();
            if (link && /^https?:\/\//i.test(link)) results.push({ title, url: link, snippet });
        }
        return results;
    } catch (e) {
        console.warn("[websearch] Bing RSS failed:", e?.message);
        return [];
    } finally {
        clearTimeout(timer);
        if (signal) signal.removeEventListener("abort", forward);
    }
}

async function fetchDDGInstant(query, signal) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 5000);
    const forward = () => ac.abort();
    if (signal) signal.addEventListener("abort", forward, { once: true });
    try {
        const res = await fetch("https://api.duckduckgo.com/?q=" + encodeURIComponent(query) + "&format=json&no_html=1&no_redirect=1", {
            headers: { "User-Agent": SEARCH_UA }, signal: ac.signal
        });
        if (!res.ok) return null;
        const j = await res.json();
        if (j.Abstract) return { text: j.Abstract, source: j.AbstractSource || "DuckDuckGo", url: j.AbstractURL || "" };
        return null;
    } catch { return null; } finally { clearTimeout(timer); if (signal) signal.removeEventListener("abort", forward); }
}

const BLOCKED_DOMAINS_RE = /\b(pornhub|xvideos|xnxx|xhamster|redtube|youporn|tube8|spankbang|eporner|tnaflix|drtuber|beeg|brazzers|bangbros|realitykings|naughtyamerica|onlyfans|chaturbate|stripchat|livejasmin|bongacams|cam4|myfreecams|fapello|rule34|e621|gelbooru|danbooru|nhentai|hanime|hentaihaven|fakku|literotica|sexstories)\b/i;

function isBlockedUrl(url) {
    try { return BLOCKED_DOMAINS_RE.test(new URL(url).hostname); } catch { return false; }
}

async function fetchWebResults(query, signal) {
    const [bing, instant] = await Promise.all([fetchBingRSS(query, signal), fetchDDGInstant(query, signal)]);
    const results = bing.filter(r => !isBlockedUrl(r.url));
    if (instant && instant.url && !isBlockedUrl(instant.url) && !results.some(r => r.url === instant.url)) {
        results.unshift({ title: instant.source + " (Instant Answer)", url: instant.url, snippet: instant.text });
    }
    return results;
}

async function runWebSearch(query, ctx, signal) {
    const results = await fetchWebResults(query, signal);
    if (!results.length) return { text: "No search results found for: " + query, urls: [], usage: null };
    const urls = results.map(r => r.url);
    const text = results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join("\n\n");
    return { text, urls, usage: null };
}

function buildSearchContext(query, result) {
    const sources = result.urls.length ? result.urls.map(u => "- " + u).join("\n") : "(no direct source URLs found)";
    return "You searched the web for: \"" + query + "\". Results:\n\n" + result.text
        + "\n\nSources:\n" + sources
        + "\n\nNow write your final answer to the user's original message using this information. Weave the facts in "
        + "naturally and be concise. Do NOT list sources or URLs at the end - they are shown separately. Do not describe the search "
        + "mechanically - just answer as yourself.";
}

// ── Performance-tier recommendation (onboarding "Let AI pick for me") ───────
// Formats whatever the browser reported into readable lines for the prompt —
// every field is optional since browser support for deviceMemory/connection/
// WEBGL_debug_renderer_info varies a lot.
function formatDeviceSpecs(specs) {
    const s = specs && typeof specs === "object" ? specs : {};
    const lines = [];
    if (s.cores) lines.push(`CPU logical cores: ${Number(s.cores) || s.cores}`);
    if (s.memoryGB) lines.push(`Approx RAM (browser-reported, often capped at 8): ${s.memoryGB} GB`);
    if (s.gpu?.renderer) lines.push(`GPU renderer string: ${String(s.gpu.renderer).slice(0, 200)}`);
    if (s.connection?.effectiveType) lines.push(`Network: ${s.connection.effectiveType}` + (s.connection.downlinkMbps ? `, ~${s.connection.downlinkMbps} Mbps` : ""));
    if (s.screen) lines.push(`Screen: ${s.screen.w}x${s.screen.h} @ ${s.screen.dpr}x pixel ratio`);
    if (s.platform) lines.push(`Platform: ${String(s.platform).slice(0, 60)}`);
    if (s.userAgent) lines.push(`User agent: ${String(s.userAgent).slice(0, 200)}`);
    return lines.length ? lines.join("\n") : "(browser reported no usable details)";
}

// Pure hardware-threshold fallback, used only if the AI call fails outright —
// keeps the onboarding feature working even if the flash backend is down.
function heuristicPerfTier(specs) {
    const cores = Number(specs?.cores) || 4;
    const mem = Number(specs?.memoryGB) || 4;
    if (cores <= 2 || mem <= 2) return "low";
    if (cores <= 4 || mem <= 4) return "medium";
    return "high";
}

const PERF_RECOMMEND_SYSTEM = "You classify a website visitor's device into a performance tier for a visually rich, "
    + "animated web app. Respond in EXACTLY this format, nothing else:\n"
    + "TIER: <low|medium|high>\n"
    + "WHY: <one short, plain-language sentence, speaking directly to the user>\n"
    + "LOW = disable all animations and background effects for smoothness (old, weak, or resource-constrained "
    + "hardware). MEDIUM = keep normal UI motion but drop the heaviest decorative effects (typical mid-range laptop "
    + "or phone). HIGH = run everything at full quality (modern, capable hardware).";

// Always does one real web-search lookup on the reported GPU (when it's a real,
// specific model string rather than a generic/software renderer) so the
// recommendation is genuinely researched, not just guessed from training data —
// this is deliberate, not left to the usual search-or-not router judgment call.
async function recommendPerfTier(specs, ctx, signal) {
    const specsText = formatDeviceSpecs(specs);
    let searchNote = "", searched = false;
    const gpu = specs?.gpu?.renderer;
    if (typeof gpu === "string" && gpu.length > 3 && !/swiftshader|llvmpipe|software|generic|microsoft basic/i.test(gpu)) {
        try {
            const sr = await runWebSearch(`${gpu} graphics performance benchmark`, ctx, signal);
            if (sr?.text) { searchNote = "\n\nWeb research on the reported GPU:\n" + sr.text.slice(0, 1000); searched = true; }
        } catch (e) { console.warn("[perf] gpu search failed:", e?.message); }
    }
    const messages = [
        { role: "system", content: PERF_RECOMMEND_SYSTEM },
        { role: "user", content: "Device specs reported by the browser:\n" + specsText + searchNote }
    ];
    const { text } = await runOneShot(FREE_MODEL, messages, signal, ctx, 400);
    const tierM = /^TIER:\s*(low|medium|high)/im.exec(text);
    const whyM = /^WHY:\s*(.+)$/im.exec(text);
    return {
        tier: tierM ? tierM[1].toLowerCase() : heuristicPerfTier(specs),
        reason: whyM ? whyM[1].trim().slice(0, 240) : "Picked from your reported CPU and RAM.",
        searched
    };
}

// Streams a chat completion straight through to the client as delta/reasoning/
// done SSE events (the shared tail end of every non-agent chat turn, whether or
// not it followed a tool call). Returns the exact usage from the final chunk.
async function streamAndForward(params, signal, ctx, res, onChars) {
    // Retry from scratch on a transient failure, but ONLY if nothing has reached
    // the client yet — once a delta/reasoning event is sent the client has
    // already started rendering, so a mid-stream drop past that point still
    // surfaces as an error rather than silently restarting on top of it.
    for (let attempt = 0; attempt < 3; attempt++) {
        let usage = null, sentAny = false;
        try {
            for await (const { chunk } of runChatStream(params, signal, ctx)) {
                if (chunk?.usage) usage = chunk.usage;
                const delta = chunk?.choices?.[0]?.delta || {};
                const content = (delta.content || "").replace(/[—–]/g, "-");
                const reasoning = (delta.reasoning_content || delta.reasoning || "").replace(/[—–]/g, "-");
                onChars(content.length + reasoning.length);
                if (reasoning) { res.write(`data: ${JSON.stringify({ type: "reasoning", text: reasoning })}\n\n`); sentAny = true; }
                if (content) { res.write(`data: ${JSON.stringify({ type: "delta", text: content })}\n\n`); sentAny = true; }
                const finish = chunk?.choices?.[0]?.finish_reason;
                if (finish) res.write(`data: ${JSON.stringify({ type: "done", finish })}\n\n`);
            }
            return usage;
        } catch (e) {
            if (sentAny || signal?.aborted || attempt === 2 || !RETRYABLE_STREAM_ERROR_RE.test(e?.message)) throw e;
            console.warn(`[groq] stream attempt ${attempt + 1} dropped before any output (${e?.message}); retrying`);
            await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
        }
    }
}

// Runs the tool-call sequence for a known search query: emit tool_call, execute
// the search, emit tool_result/tool_error, then stream DeepSeek's final answer
// (with the search results injected) straight through. Shared by both the
// pre-emptive router path and the denial-fallback path below.
async function runSearchAndAnswer(query, params, signal, ctx, res, onChars, isClientGone, addExtra) {
    res.write(`data: ${JSON.stringify({ type: "tool_call", tool: "web_search", query })}\n\n`);
    let searchResult = null;
    try { searchResult = await runWebSearch(query, ctx, signal); }
    catch (e) { console.error("[websearch] failed:", e?.message); }
    if (addExtra) addExtra(searchResult?.usage);
    if (!isClientGone()) {
        res.write(`data: ${JSON.stringify(searchResult
            ? { type: "tool_result", tool: "web_search", query, sources: searchResult.urls }
            : { type: "tool_error", tool: "web_search", query })}\n\n`);
    }
    const runParams = searchResult
        ? { ...params, messages: [...params.messages, { role: "system", content: buildSearchContext(query, searchResult) }] }
        : params;
    const usage = await streamAndForward(runParams, signal, ctx, res, onChars);
    if (searchResult?.urls.length && !isClientGone()) {
        res.write(`data: ${JSON.stringify({ type: "sources", sources: searchResult.urls })}\n\n`);
    }
    return usage;
}

// Catches DeepSeek claiming it can't search instead of actually using the tool.
// The pre-emptive router (decideWebSearch) misses some cases, so this is a
// second, self-correcting net: it sniffs only the first ~220 chars of the
// VISIBLE answer (never the hidden reasoning trace) for a capability-denial
// phrase. If one shows up, the partial answer is discarded (never shown to the
// user) and the real tool call runs instead. Anything else streams through
// after that short buffering window with no other change in behavior.
// Deliberately loose on the gap between the negation/verb/target words (LLM
// phrasing here varies a lot — e.g. "don't have DIRECT access to the internet"
// broke an earlier, stricter version of this) while still requiring all three
// concepts in the same clause (bounded by sentence punctuation) to avoid
// flagging ordinary sentences that just happen to mention "current" or "live".
const DENIAL_CORE_RE = /\b(?:don.?t|do not|cannot|can.?t|unable to|not able to|not|no)\b[^.?!\n]{0,70}\b(?:access(?:ing)?|browse|browsing|search(?:ing)?|connect(?:ed|ing)?|check(?:ing)?|look\s?up|fetch(?:ing)?|retrieve|pull\s?up|perform|run|conduct)\b[^.?!\n]{0,45}\b(?:internet|web|real-?time|live|current(?:ly)?|up-?to-?date|latest|today|website)\b/i;
const DENIAL_HAVE_RE = /\b(?:don.?t|do not|doesn.?t|does not|cannot|can.?t) have\b[^.?!\n]{0,30}\b(?:access|ability|real-?time|live|up-?to-?date|current)\b/i;
const DENIAL_CUTOFF_RE = /\b(?:knowledge|training data)\b[^.?!\n]{0,20}\b(?:cut-?off|cutoff|is limited to|only (?:goes|extends) up to)/i;
const NO_SEARCH_DENIAL_RE = { test: (s) => DENIAL_CORE_RE.test(s) || DENIAL_HAVE_RE.test(s) || DENIAL_CUTOFF_RE.test(s) };
const DENIAL_SNIFF_CHARS = 220;
async function streamWithDenialFallback(params, parentSignal, ctx, res, onChars) {
    const probeAc = new AbortController();
    const forwardAbort = () => probeAc.abort();
    parentSignal.addEventListener("abort", forwardAbort, { once: true });
    let buf = "", live = false, usage = null;
    const flushBuf = () => {
        if (!buf) return;
        onChars(buf.length);
        res.write(`data: ${JSON.stringify({ type: "delta", text: buf })}\n\n`);
        buf = "";
    };
    try {
        for await (const { chunk } of runChatStream(params, probeAc.signal, ctx)) {
            if (chunk?.usage) usage = chunk.usage;
            const delta = chunk?.choices?.[0]?.delta || {};
            const reasoning = (delta.reasoning_content || delta.reasoning || "").replace(/[—–]/g, "-");
            if (reasoning) { onChars(reasoning.length); res.write(`data: ${JSON.stringify({ type: "reasoning", text: reasoning })}\n\n`); }
            const content = (delta.content || "").replace(/[—–]/g, "-");
            if (content) {
                if (live) {
                    onChars(content.length);
                    res.write(`data: ${JSON.stringify({ type: "delta", text: content })}\n\n`);
                } else {
                    buf += content;
                    if (buf.length >= DENIAL_SNIFF_CHARS) {
                        if (NO_SEARCH_DENIAL_RE.test(buf)) { probeAc.abort(); return { denied: true, usage: null }; }
                        live = true;
                        flushBuf();
                    }
                }
            }
            const finish = chunk?.choices?.[0]?.finish_reason;
            if (finish) {
                if (!live) {
                    if (NO_SEARCH_DENIAL_RE.test(buf)) return { denied: true, usage: null };
                    flushBuf();
                }
                res.write(`data: ${JSON.stringify({ type: "done", finish })}\n\n`);
            }
        }
        return { denied: false, usage };
    } catch (e) {
        if (probeAc.signal.aborted && !parentSignal.aborted) return { denied: true, usage: null };
        throw e;
    } finally {
        parentSignal.removeEventListener("abort", forwardAbort);
    }
}

// ── Extended thinking: multi-step plan/think/search loop ────────────────────
// When the user picks the "extended" thinking level on the free model, a single
// router call isn't enough — this runs a small ReAct-style loop: at each step a
// planner decides to THINK (reason through an angle using what's known so far),
// SEARCH (run the web_search tool — can fire more than once per turn if the
// topic needs it), or ANSWER (stop and let DeepSeek write the final reply). Each
// step is streamed to the client as its own tool_call/thought event carrying a
// `step` index, so the UI renders a separate block per step instead of reusing
// one — multiple "Thoughts" panels and multiple search chips, in order.
const EXTENDED_MAX_STEPS = 4;
const EXTENDED_PLANNER_SYSTEM = "You are the planning layer for Ink-Chan. This is EXTENDED thinking mode - "
    + "the user deliberately asked for thorough, multi-step reasoning instead of an immediate answer. Given the "
    + "conversation and everything gathered so far, decide the SINGLE next action:\n"
    + "THINK: <a specific sub-question or angle to reason through using what's already known>\n"
    + "SEARCH: <a short, specific web search query>\n"
    + "ANSWER\n"
    + "Use THINK for reasoning, breaking the question into parts, comparing options, or synthesizing what's been "
    + "found so far. Use SEARCH only for live/external facts you don't already have. Do NOT run a SEARCH with the "
    + "same or a very similar query to one already listed below — if that search's results are good enough, THINK "
    + "to synthesize them instead, or SEARCH for a genuinely different missing piece. Prefer at least 2-3 steps for "
    + "anything with multiple parts, comparisons, or open questions — typically: search once for the core facts, "
    + "THINK to work through what they mean, then only search again for a specific gap. Only say ANSWER after a "
    + "single step for a truly trivial one-fact lookup that nothing else would add to. Say ANSWER once you have "
    + "enough for a complete, well-supported answer. "
    + "Respond with EXACTLY one line in one of the three formats above, nothing else.";

function extendedScratchpad(steps) {
    return steps.map((s, i) => s.kind === "think"
        ? `Step ${i + 1} (THINK: ${s.label}): ${s.text}`
        : `Step ${i + 1} (SEARCH: ${s.label}): ${s.text}\nSources: ${s.sources.length ? s.sources.join(", ") : "none"}`
    ).join("\n\n");
}

async function runExtendedAgent(params, ctx, signal, res, onChars, isClientGone, addExtra) {
    const convo = params.messages.filter(m => m.role !== "system").slice(-6)
        .map(m => `${m.role}: ${contentToText(m.content).slice(0, 500)}`).join("\n");
    const steps = [];
    for (let step = 0; step < EXTENDED_MAX_STEPS && !isClientGone(); step++) {
        const scratch = extendedScratchpad(steps);
        const decisionMessages = [
            { role: "system", content: EXTENDED_PLANNER_SYSTEM },
            { role: "user", content: convo + (scratch ? "\n\nProgress so far:\n" + scratch : "") }
        ];
        let decision = "";
        try {
            const r = await runOneShot(SEARCH_ROUTER_MODEL_ID, decisionMessages, signal, ctx, 400);
            addExtra(r.usage);
            decision = r.text.trim();
        } catch (e) {
            console.error("[extended] planner failed:", e?.message);
            break;
        }
        const thinkM = /^THINK:\s*(.+)$/im.exec(decision);
        const searchM = /^SEARCH:\s*(.+)$/im.exec(decision);
        if (thinkM) {
            const topic = thinkM[1].trim().replace(/^["'*]+|["'*]+$/g, "").slice(0, 200);
            res.write(`data: ${JSON.stringify({ type: "thought", step, label: topic })}\n\n`);
            // Generous cap: FREE_MODEL is a reasoning model, and its hidden reasoning
            // trace shares this same token budget — too tight a cap here silently
            // starves the VISIBLE thought text down to nothing (same failure mode the
            // 1500-token client cap had), rather than throwing anything catchable.
            let text = "Didn't turn up anything beyond what's already known here.";
            try {
                const thinkMessages = [
                    { role: "system", content: "Think step by step about the given angle, using anything already "
                        + "gathered. Be concise (3-6 sentences). This is internal reasoning, not the final answer to the user." },
                    { role: "user", content: `Question: ${convo}\n\n${scratch ? "Gathered so far:\n" + scratch + "\n\n" : ""}Reason about: ${topic}` }
                ];
                const r = await runOneShot(FREE_MODEL, thinkMessages, signal, ctx, 1200);
                addExtra(r.usage);
                if (r.text) text = r.text;
            } catch (e) { console.error("[extended] think step failed:", e?.message); }
            if (isClientGone()) return steps;
            res.write(`data: ${JSON.stringify({ type: "thought_result", step, label: topic, text })}\n\n`);
            steps.push({ kind: "think", label: topic, text });
        } else if (searchM) {
            const query = searchM[1].trim().replace(/^["'*]+|["'*]+$/g, "").slice(0, 300);
            res.write(`data: ${JSON.stringify({ type: "tool_call", tool: "web_search", step, query })}\n\n`);
            let searchResult = null;
            try { searchResult = await runWebSearch(query, ctx, signal); addExtra(searchResult.usage); }
            catch (e) { console.error("[extended] search step failed:", e?.message); }
            if (isClientGone()) return steps;
            res.write(`data: ${JSON.stringify(searchResult
                ? { type: "tool_result", tool: "web_search", step, query, sources: searchResult.urls }
                : { type: "tool_error", tool: "web_search", step, query })}\n\n`);
            steps.push({ kind: "search", label: query, text: searchResult?.text || "(search failed)", sources: searchResult?.urls || [] });
        } else {
            break;   // ANSWER, or an unparseable decision — either way, stop planning and answer now.
        }
    }
    return steps;
}

function buildExtendedContext(steps) {
    return { role: "system", content: "You worked through these steps before answering:\n\n"
        + extendedScratchpad(steps)
        + "\n\nNow write your final answer to the user's original message using everything above. Be concise, weave "
        + "the facts in naturally. Do NOT list sources or URLs at the end - they are shown separately. Do not "
        + "describe the steps mechanically - just answer as yourself." };
}

// ── Navy provider liveness monitor (Status pane) ─────────────────────────────
// Pings navy with a minimal "hi" every 10 minutes on a dedicated internal call
// (bypasses quota/rate-limit — this never touches a user's budget). One attempt
// = one full runChatStream call; on failure, retries with escalating delays
// before the check is finally recorded as an outage.
const NAVY_PING_MODEL = "mai-sakurajima";
const NAVY_PING_TIMEOUT_MS = 12_000;
const NAVY_PING_RETRY_DELAYS_MS = [15_000, 20_000, 60_000];   // 15s → 20s → 1m
const NAVY_DEGRADED_THRESHOLD_MS = 4_000;                     // "excessively long" cutoff

async function pingNavyOnce() {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), NAVY_PING_TIMEOUT_MS);
    const start = Date.now();
    try {
        for await (const _ of runChatStream(
            { model: NAVY_PING_MODEL, messages: [{ role: "user", content: "hi" }], max_completion_tokens: 5, temperature: 0, top_p: 1 },
            ac.signal, { headers: { referer: "" } }
        )) { /* draining is enough to prove liveness */ }
        return { ok: true, latencyMs: Date.now() - start };
    } catch (e) {
        return { ok: false, latencyMs: Date.now() - start, error: e?.message || String(e) };
    } finally {
        clearTimeout(timer);
    }
}

async function runNavyHealthCheck() {
    if (!navyKeyState.length) return null;   // not configured — nothing to check
    let attempts = 0, result = null;
    for (let i = 0; i <= NAVY_PING_RETRY_DELAYS_MS.length; i++) {
        attempts++;
        result = await pingNavyOnce();
        if (result.ok) break;
        if (i < NAVY_PING_RETRY_DELAYS_MS.length) await new Promise(r => setTimeout(r, NAVY_PING_RETRY_DELAYS_MS[i]));
    }
    const status = !result.ok ? "outage"
        : (attempts > 1 || result.latencyMs >= NAVY_DEGRADED_THRESHOLD_MS) ? "degraded"
            : "operational";
    try { stmts.navyHealthInsert.run(status, result.latencyMs, attempts, result.ok ? null : String(result.error || "").slice(0, 300), Date.now()); } catch {}
    console.log(`[navy-health] ${status} — ${result.latencyMs}ms (${attempts} attempt${attempts > 1 ? "s" : ""})`);
    return { status, latencyMs: result.latencyMs, attempts };
}

setInterval(() => { runNavyHealthCheck().catch(() => {}); }, 30 * 60 * 1000).unref();
// First check shortly after boot so the Status pane isn't empty on a fresh start.
setTimeout(() => { runNavyHealthCheck().catch(() => {}); }, 15_000).unref();

const userBuckets = new Map();
const RATE_PER_USER_PER_MIN = 20;

const TOKEN_WINDOW_MS = 4 * 60 * 60 * 1000;
const TOKEN_CAP_PER_WINDOW = 100_000;
const tokenBudgets = new Map();

function budgetKey(req) {
    if (req.user?.id) return "u:" + req.user.id;
    return "ip:" + clientIp(req);
}

function bumpTokenBudget(req, addTokens) {
    const key = budgetKey(req);
    const now = Date.now();
    let b = tokenBudgets.get(key);
    if (!b || now >= b.resetAt) {
        b = { used: 0, resetAt: now + TOKEN_WINDOW_MS };
        tokenBudgets.set(key, b);
    }
    if (b.used + addTokens > TOKEN_CAP_PER_WINDOW) {
        return { ok: false, used: b.used, cap: TOKEN_CAP_PER_WINDOW, resetAt: b.resetAt };
    }
    b.used += addTokens;
    return { ok: true, used: b.used, cap: TOKEN_CAP_PER_WINDOW, resetAt: b.resetAt };
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of tokenBudgets) if (now >= v.resetAt) tokenBudgets.delete(k);
}, 30 * 60_000).unref();

function rateCheck(req) {
    const ip = clientIp(req);
    const userId = req.user?.id ? "u" + req.user.id : "ip:" + ip;
    const now = Date.now();
    const bucket = userBuckets.get(userId);
    if (!bucket || now - bucket.start > 60_000) {
        userBuckets.set(userId, { count: 1, start: now });
        return true;
    }
    if (bucket.count >= RATE_PER_USER_PER_MIN) return false;
    bucket.count += 1;
    return true;
}

setInterval(() => {
    const now = Date.now();
    for (const [k, v] of userBuckets) if (now - v.start > 60_000) userBuckets.delete(k);
}, 60_000).unref();

// ── Lightweight content-safety scoring ──────────────────────────────────────
// A cheap, non-streaming completion used to risk-score chat messages before they
// are posted. Prefers a free/low-cost Groq model, falls back to Navy's mini
// model, and finally to a local keyword heuristic if no provider is reachable.
const MOD_GROQ_MODEL = "llama-3.3-70b-versatile";
const MOD_NAVY_MODEL = "gpt-5.4-mini";

async function groqComplete(messages, { maxTokens = 200, json = false, temperature = 0 } = {}) {
    if (!keyState.length) return null;
    const tried = new Set();
    for (let attempt = 0; attempt < Math.min(3, keyState.length + 1); attempt++) {
        const state = pickKey();
        if (!state || tried.has(state.index)) continue;
        tried.add(state.index);
        try {
            const client = new Groq({ apiKey: state.key });
            const res = await client.chat.completions.create({
                model: MOD_GROQ_MODEL,
                messages,
                temperature,
                max_completion_tokens: maxTokens,
                ...(json ? { response_format: { type: "json_object" } } : {})
            });
            markSuccess(state);
            return res?.choices?.[0]?.message?.content || "";
        } catch (e) {
            if (isRateLimit(e)) { markFailure(state, parseRetryAfter(e)); continue; }
            if (isAuthError(e)) { markFailure(state, 24 * 60 * 60_000); continue; }
            console.warn("[mod] groq complete failed:", e?.message?.slice(0, 100));
            return null;
        }
    }
    return null;
}

async function navyComplete(messages, { maxTokens = 200, json = false, temperature = 0 } = {}) {
    if (!navyKeyState.length) return null;
    const tried = new Set();
    for (let attempt = 0; attempt < Math.max(2, navyKeyState.length + 1); attempt++) {
        const state = pickNavyKey();
        if (!state || tried.has(state.index)) { if (tried.size >= navyKeyState.length) break; continue; }
        tried.add(state.index);
        const key = sanitizeKey(state.key);
        if (!key) continue;
        try {
            const res = await fetch(`${NAVY_BASE}/chat/completions`, {
                method: "POST",
                headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({
                    model: MOD_NAVY_MODEL,
                    messages,
                    ...(TEMP_LOCKED.has(MOD_NAVY_MODEL) ? {} : { temperature }),
                    max_tokens: maxTokens,
                    stream: false,
                    ...(json ? { response_format: { type: "json_object" } } : {})
                })
            });
            if (!res.ok) {
                if (res.status === 401 || res.status === 403) { markNavyFail(state, 24 * 60 * 60_000); continue; }
                if (res.status === 429 || res.status === 503) { markNavyFail(state, navyRetryAfter(res)); continue; }
                console.warn("[mod] navy complete non-ok:", res.status); return null;
            }
            markNavySuccess(state);
            const data = await res.json().catch(() => null);
            return data?.choices?.[0]?.message?.content || "";
        } catch (e) {
            console.warn("[mod] navy complete failed:", e?.message?.slice(0, 100));
            markNavyFail(state, 60_000);
            continue;
        }
    }
    return null;
}

async function cheapComplete(messages, opts) {
    const viaGroq = await groqComplete(messages, opts);
    if (viaGroq) return { text: viaGroq, source: "groq" };
    const viaNavy = await navyComplete(messages, opts);
    if (viaNavy) return { text: viaNavy, source: "navy" };
    return null;
}

export function moderationConfigured() {
    return keyState.length > 0 || navyKeyState.length > 0;
}

const RISK_SYSTEM = `You are a strict but fair content-safety classifier for a public chat room used mostly by students and teens.
Read ONE chat message and rate how unsafe it is to post publicly on a 0-100 scale, then reply with ONLY compact JSON:
{"score":<integer 0-100>,"category":"<self_harm|violence|threat|sexual|csam|harassment|hate|illegal|drugs|none>","reason":"<short, calm, user-facing explanation>"}
Scoring guide:
- 0-25 normal/safe chat (greetings, jokes, gaming, questions). Mild profanity by itself stays here.
- 26-55 rude, crude, or edgy but not dangerous.
- 56-74 concerning: heavy harassment, graphic description, or borderline content.
- 75-100 must be blocked: encouraging or expressing intent of self-harm or suicide, credible threats or planning of violence, sexual content involving minors, doxxing or sharing private info, hate, or instructions to seriously harm someone.
Targeted at a person, treat these as self_harm encouragement and score >=80: telling someone to "kill yourself"/"kys", that they should disappear, vanish, or not exist, that everyone would be happier/better off without them, or that they have no reason to live.
Be strict (>=85) for self-harm/suicide, threats of violence, and any sexual content involving minors. Judge intent, not isolated words. Reply with JSON only - no markdown, no extra text.`;

function parseRisk(raw) {
    if (!raw) return null;
    let obj = null;
    try { obj = JSON.parse(raw); }
    catch {
        const m = String(raw).match(/\{[\s\S]*\}/);
        if (m) { try { obj = JSON.parse(m[0]); } catch {} }
    }
    if (!obj || typeof obj !== "object") return null;
    let score = Number(obj.score);
    if (!isFinite(score)) return null;
    score = Math.max(0, Math.min(100, Math.round(score)));
    let category = typeof obj.category === "string" ? obj.category.toLowerCase().replace(/[^a-z_]/g, "") : "none";
    if (!category) category = "none";
    const reason = typeof obj.reason === "string" ? obj.reason.slice(0, 240) : "";
    return { score, category: category.slice(0, 24), reason };
}

function heuristicRisk(text) {
    const t = " " + String(text).toLowerCase().replace(/[^a-z0-9'\s]/g, " ").replace(/\s+/g, " ") + " ";
    const sexualMinor = /(child\s*porn|\bcp\b|underage|\bloli\b|jailbait|preteen|pedo)/;
    const selfHarm = /(kill myself|killing myself|\bkms\b|suicid|end my life|wanna die|want to die|hang myself|slit my|cut myself|hurt myself|no reason to live|better off dead)/;
    const threat = /(kill you|kill u|shoot up|i will kill|i'?ll kill|im going to kill|i'?m going to kill|bomb the|murder you|\bkys\b|kill yourself|behead|stab you)/;
    if (sexualMinor.test(t)) return { score: 100, category: "csam", reason: "Possible sexual content involving minors." };
    if (selfHarm.test(t)) return { score: 92, category: "self_harm", reason: "Mentions self-harm or suicide." };
    if (threat.test(t)) return { score: 90, category: "threat", reason: "Reads as a threat of violence." };
    return { score: 0, category: "none", reason: "" };
}

// ── OpenAI omni-moderation-latest (preferred) ────────────────────────────────
// A dedicated multimodal moderation model (more accurate than a chat classifier),
// called via navy's OpenAI-compatible /moderations endpoint. Maps the highest
// category score to our 0-100 scale + category. Returns null if unsupported, so
// scoreMessageRisk falls back to the chat classifier.
const MOD_OMNI_MODEL = process.env.NOCTURNE_MOD_MODEL || "omni-moderation-latest";
const OMNI_CAT_MAP = [
    [/self.?harm/i, "self_harm"],
    [/sexual\/minors/i, "csam"],
    [/harassment.*threat/i, "threat"],
    [/harassment/i, "harassment"],
    [/hate/i, "hate"],
    [/violence/i, "violence"],
    [/illicit/i, "illegal"],
    [/sexual/i, "sexual"]
];
async function moderateWithOmni(text) {
    if (!navyKeyState.length) return null;
    const tried = new Set();
    for (let attempt = 0; attempt < Math.max(2, navyKeyState.length + 1); attempt++) {
        const state = pickNavyKey();
        if (!state || tried.has(state.index)) { if (tried.size >= navyKeyState.length) break; continue; }
        tried.add(state.index);
        const key = sanitizeKey(state.key); if (!key) continue;
        let res;
        try {
            res = await fetch(`${NAVY_BASE}/moderations`, {
                method: "POST",
                headers: { "Authorization": "Bearer " + key, "Content-Type": "application/json", "Accept": "application/json" },
                body: JSON.stringify({ model: MOD_OMNI_MODEL, input: text.slice(0, 4000) })
            });
        } catch { markNavyFail(state, 30_000); continue; }
        if (!res.ok) {
            if (res.status === 401 || res.status === 403) { markNavyFail(state, 24 * 60 * 60_000); continue; }
            if (res.status === 429 || res.status === 503) { markNavyFail(state, navyRetryAfter(res)); continue; }
            return null;   // 400/404 → endpoint/model unsupported; fall back to the chat classifier
        }
        let data; try { data = await res.json(); } catch { return null; }
        const r = data && data.results && data.results[0];
        if (!r) return null;
        markNavySuccess(state);
        const scores = r.category_scores || {};
        let maxCat = null, maxScore = 0;
        for (const k in scores) { const v = Number(scores[k]) || 0; if (v > maxScore) { maxScore = v; maxCat = k; } }
        let score = Math.round(maxScore * 100);
        if (r.flagged && score < 80) score = 80;          // OpenAI flagged it → ensure it blocks
        let category = "none";
        if (maxCat) {
            for (const [re, c] of OMNI_CAT_MAP) if (re.test(maxCat)) { category = c; break; }
            if (category === "none") category = maxCat.replace(/[^a-z]/gi, "_");
        }
        return { score, category, reason: r.flagged ? ("Flagged: " + (maxCat || "content")) : "", source: "omni", flagged: !!r.flagged };
    }
    return null;
}

// Risk-score a single chat message. Returns { score 0-100, category, reason, source }.
// Never throws - on total failure it returns the local heuristic result.
export async function scoreMessageRisk(text) {
    const msg = String(text || "").slice(0, 4000).trim();
    if (!msg) return { score: 0, category: "none", reason: "", source: "empty" };

    // Local hard backstop first: catches the worst content instantly and also
    // protects when no AI provider is configured or reachable.
    const hard = heuristicRisk(msg);
    if (hard.score >= 90) return { ...hard, source: "rule" };

    // Preferred: OpenAI omni-moderation-latest (a dedicated moderation model).
    try {
        const omni = await moderateWithOmni(msg);
        if (omni) return hard.score > omni.score ? { ...hard, source: "rule+omni" } : omni;
    } catch (e) { console.warn("[mod] omni threw:", e?.message?.slice(0, 100)); }

    // Fallback: the JSON chat classifier.
    let result = null;
    try {
        const out = await cheapComplete(
            [{ role: "system", content: RISK_SYSTEM }, { role: "user", content: msg }],
            { maxTokens: 200, json: true, temperature: 0 }
        );
        if (out) {
            result = parseRisk(out.text);
            if (result) result.source = out.source;
        }
    } catch (e) {
        console.warn("[mod] risk scoring threw:", e?.message?.slice(0, 100));
    }

    if (result) {
        // Never let the model under-rate something the keyword rules already flagged.
        if (hard.score > result.score) return { ...hard, source: "rule+ai" };
        return result;
    }
    return { ...hard, source: "heuristic" };
}

// ── Public AI API (key / account-password authenticated) ────────────────────
// Lets external apps use Nocturne AI WITH proper authentication and the account's
// own quota + model access — the sanctioned alternative to the cookie-gated web
// endpoint (which exists to block unauthenticated request-replay theft).
function hashApiKey(key) { return createHash("sha256").update(String(key)).digest("hex"); }

// key_hash (SHA-256) is used for fast, one-way auth lookups. key_enc is a separate
// AES-256-GCM ciphertext of the same raw key, decryptable only with this server-side
// secret - it exists solely so an owner can re-reveal their own key later, without
// weakening the hash-based auth path. The secret lives outside the DB and is
// generated once on first boot.
const APIKEY_ENC_SECRET_FILE = path.join(process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data"), "apikey-enc-secret");
function loadOrCreateEncSecret() {
    try { return Buffer.from(fs.readFileSync(APIKEY_ENC_SECRET_FILE, "utf8").trim(), "hex"); } catch {}
    const secret = randomBytes(32);
    try { fs.writeFileSync(APIKEY_ENC_SECRET_FILE, secret.toString("hex")); } catch (e) { console.warn("[api-keys] could not persist encryption secret:", e.message); }
    return secret;
}
const APIKEY_ENC_SECRET = loadOrCreateEncSecret();
function encryptApiKey(raw) {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", APIKEY_ENC_SECRET, iv);
    const ct = Buffer.concat([cipher.update(String(raw), "utf8"), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ct]).toString("base64");
}
function decryptApiKey(blob) {
    const buf = Buffer.from(String(blob), "base64");
    const iv = buf.subarray(0, 12), tag = buf.subarray(12, 28), ct = buf.subarray(28);
    const decipher = createDecipheriv("aes-256-gcm", APIKEY_ENC_SECRET, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
function createApiKey(userId, label) {
    const key = "noct_" + randomBytes(24).toString("hex");
    stmts.apiKeyInsert.run(userId, hashApiKey(key), encryptApiKey(key), (String(label || "").trim().slice(0, 60) || null), Date.now());
    return key;
}
function resolveApiKeyUser(key) {
    if (!key || typeof key !== "string" || !key.startsWith("noct_")) return null;
    let row; try { row = stmts.apiKeyByHash.get(hashApiKey(key)); } catch { row = null; }
    if (!row) return null;
    try { stmts.apiKeyTouch.run(Date.now(), row.id); } catch {}
    return row.user_id;
}
// Accept a bare model name ("gpt-5.5") or a full id ("navy:gpt-5.5").
function resolveModelId(name) {
    if (!name || typeof name !== "string") return null;
    const n = name.trim();
    if (MODELS[n]) return n;
    if (MODELS["navy:" + n]) return "navy:" + n;
    const target = n.toLowerCase().replace(/^(navy|groq|openrouter):/, "");
    for (const id of Object.keys(MODELS)) {
        if (id.toLowerCase() === n.toLowerCase()) return id;
        if (id.replace(/^[^:]+:/, "").toLowerCase() === target) return id;
    }
    return null;
}
function publicModelList() {
    return Object.keys(MODELS)
        .filter(id => !MODELS[id].private && audienceOf(id) === "all")
        .map(id => ({ id, name: id.replace(/^[^:]+:/, ""), label: MODELS[id].label, premium: !!MODELS[id].premium }));
}
const _apiBuckets = new Map();
function apiRateOk(idKey) {
    const now = Date.now(); let b = _apiBuckets.get(idKey);
    if (!b || now - b.start > 60_000) { b = { start: now, count: 0 }; _apiBuckets.set(idKey, b); }
    if (b.count >= (Number(process.env.NOCTURNE_API_RPM) || 60)) return false;
    b.count++; return true;
}
const _apiAuthFails = new Map();
function apiAuthBlocked(ip) {
    const e = _apiAuthFails.get(ip);
    if (!e) return false;
    if (Date.now() - e.first > 15 * 60_000) { _apiAuthFails.delete(ip); return false; }
    return e.count >= 10;
}
function apiAuthFail(ip) { const e = _apiAuthFails.get(ip); if (!e || Date.now() - e.first > 15 * 60_000) _apiAuthFails.set(ip, { count: 1, first: Date.now() }); else e.count++; }
setInterval(() => { const now = Date.now(); for (const [k, b] of _apiBuckets) if (now - b.start > 120_000) _apiBuckets.delete(k); for (const [k, e] of _apiAuthFails) if (now - e.first > 15 * 60_000) _apiAuthFails.delete(k); }, 120_000).unref();
function apiCors(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-API-Key");
    res.set("Access-Control-Max-Age", "86400");
}

async function aiApiHandler(req, res) {
    apiCors(res);
    const ip = clientIp(req);
    const fp = fpFromReq(req);   // present only for browser (playground) callers
    // ── Authenticate: API key (header/body) OR account + password ──
    let userId = null, username = null;
    const authHeader = String(req.headers.authorization || "");
    const headerKey = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : String(req.headers["x-api-key"] || "");
    const key = String(headerKey || req.body?.key || "").trim();
    if (key) {
        userId = resolveApiKeyUser(key);
        if (!userId) return res.status(401).json({ error: "Invalid API key." });
    } else if (req.body && (req.body.account || req.body.username) && req.body.password) {
        if (apiAuthBlocked(ip)) return res.status(429).json({ error: "Too many failed sign-ins — wait a few minutes." });
        let u;
        try { u = await authenticateUser(String(req.body.account || req.body.username), String(req.body.password)); }
        catch (error) {
            if (error.status !== 503) throw error;
            return res.set("Retry-After", "2").status(503).json({ error: "Password service busy; retry shortly." });
        }
        if (!u) { apiAuthFail(ip); return res.status(401).json({ error: "Invalid account or password." }); }
        userId = u.id; username = u.username;
    } else {
        return res.status(401).json({ error: "Authenticate with an API key (Authorization: Bearer noct_…) or { account, password }." });
    }
    if (!username) { try { username = stmts.findUserById.get(userId)?.username || null; } catch {} }
    const owner = isOwnerId(userId);
    // A banned account must not keep AI access through a previously-issued API key.
    // (The account+password path already rejects bans inside authenticateUser; this closes the key path.)
    if (!owner && username && userBanned(username)) return res.status(403).json({ error: "This account is suspended." });

    if (!apiRateOk("u" + userId)) return res.status(429).json({ error: "Rate limit — max " + (Number(process.env.NOCTURNE_API_RPM) || 60) + " requests/min." });

    // ── Model ──
    const modelId = resolveModelId(req.body?.model);
    // Return one identical response whether the model is unknown OR exists-but-unavailable, so the
    // endpoint can't be used to enumerate which model names exist (models are intentionally redacted).
    if (!modelId || !canUseModel(modelId, owner, userId)) return res.status(400).json({ error: "Model '" + String(req.body?.model || "").slice(0, 64) + "' is not available. GET /api/ai lists available models." });

    // ── Messages ──
    let messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
    if (!messages) {
        const prompt = typeof req.body?.prompt === "string" ? req.body.prompt : "";
        if (!prompt.trim()) return res.status(400).json({ error: "Provide a 'prompt' string or a 'messages' array." });
        messages = [];
        if (typeof req.body?.system === "string" && req.body.system.trim()) messages.push({ role: "system", content: req.body.system });
        messages.push({ role: "user", content: prompt });
    }
    if (!messages.length || messages.length > 50) return res.status(400).json({ error: "messages must be 1–50 items." });
    const _mcfg = MODELS[modelId];
    // Text-only models that declare a vision fallback still accept images (the
    // turn is routed to the fallback backend below).
    const visionVia = (_mcfg && _mcfg.visionVia && MODELS[_mcfg.visionVia]) ? _mcfg.visionVia : null;
    const modelVision = !!(_mcfg && (_mcfg.vision || visionVia));
    let inChars = 0, imgCount = 0;
    for (const m of messages) {
        if (!m || typeof m.role !== "string") return res.status(400).json({ error: "Each message needs a string 'role'." });
        if (typeof m.content === "string") {
            if (m.content.length > 1000000) return res.status(400).json({ error: "A message is too long (max 1,000,000 chars)." });
            inChars += m.content.length;
        } else if (Array.isArray(m.content)) {
            // OpenAI-style multimodal content: text + image_url parts (vision).
            for (const part of m.content) {
                if (!part || typeof part !== "object") return res.status(400).json({ error: "Each content part must be an object." });
                if (part.type === "text") {
                    const t = typeof part.text === "string" ? part.text : "";
                    if (t.length > 1000000) return res.status(400).json({ error: "A text part is too long (max 1,000,000 chars)." });
                    inChars += t.length;
                } else if (part.type === "image_url") {
                    const url = part.image_url && (typeof part.image_url === "string" ? part.image_url : part.image_url.url);
                    if (typeof url !== "string" || !/^(data:image\/[a-z0-9.+-]+;base64,|https?:\/\/)/i.test(url)) return res.status(400).json({ error: "image_url must be a data:image/…;base64,… or http(s) URL." });
                    if (url.length > 8_000_000) return res.status(400).json({ error: "An image is too large (max ~6 MB)." });
                    imgCount++;
                } else return res.status(400).json({ error: "Content parts must be type 'text' or 'image_url'." });
            }
        } else return res.status(400).json({ error: "'content' must be a string or an array of {type,…} parts." });
    }
    if (imgCount > 8) return res.status(400).json({ error: "Too many images (max 8 per request)." });
    if (imgCount && !modelVision) return res.status(400).json({ error: "This model can't read images — use a vision model (e.g. gpt-4o, gemini-3.5-flash, grok-4.3, llama-4-scout)." });
    inChars += imgCount * 4000;   // rough token allowance per image; reconciled to real usage after the call

    // ── Daily token quota (owner exempt) ──
    if (!owner) {
        const cap = effectiveDaily(userId);
        const usage = getUsage(userId);
        const remaining = cap - usage.used;
        if (remaining <= 0) { logAiRequest(userId, modelId, false, 429, 0, 0, 0, "Daily token limit reached.", { ip, fp }); return res.status(429).json({ error: "Daily token limit reached.", quota: { used: usage.used, cap, remaining: 0 } }); }
        const estIn = estTokens(inChars);
        if (estIn >= remaining) { logAiRequest(userId, modelId, false, 429, 0, estIn, 0, "Exceeds remaining daily budget.", { ip, fp }); return res.status(429).json({ error: "This prompt (~" + estIn + " tokens) exceeds your remaining daily budget (" + remaining + " of " + cap + ").", quota: { used: usage.used, cap, remaining } }); }
    }

    // Image turns on a text-only model run on its declared vision backend, but are
    // still reported to the caller as the model they asked for.
    const runModel = (imgCount && visionVia) ? visionVia : modelId;
    const apiTz = await ipTimezone(clientIp(req));
    const params = buildParams(
        { body: { model: runModel, messages, temperature: req.body?.temperature, top_p: req.body?.top_p, max_completion_tokens: req.body?.max_tokens || req.body?.max_completion_tokens, level: req.body?.level, reasoning_effort: req.body?.reasoning_effort } },
        { presentAs: runModel !== modelId ? modelId : null, dateTime: formatDateTime(apiTz) }
    );
    params.paid = isPaidUser(userId);
    params.owner = owner;
    let reserved = 0;
    if (!owner) {
        const remaining = effectiveDaily(userId) - getUsage(userId).used;
        const outBudget = Math.max(1, remaining - estTokens(inChars));
        if (params.max_completion_tokens > outBudget) params.max_completion_tokens = outBudget;
        reserved = estTokens(inChars) + params.max_completion_tokens;
        addUsage(userId, reserved);   // reserve; reconciled to exact below
    }

    const wantStream = req.body?.stream === true || req.body?.stream === "true";
    const ac = new AbortController();
    res.on("close", () => { if (!res.writableEnded) ac.abort(); });
    const ctx = { headers: { referer: "" } };
    let text = "", reasoning = "", realUsage = null, outChars = 0;
    const t0 = Date.now();
    try {
        if (wantStream) { res.setHeader("Content-Type", "text/event-stream; charset=utf-8"); res.setHeader("Cache-Control", "no-cache, no-transform"); res.flushHeaders?.(); }
        for await (const { chunk } of runChatStream(params, ac.signal, ctx)) {
            if (chunk?.usage) realUsage = chunk.usage;
            const d = chunk?.choices?.[0]?.delta || {};
            const c = d.content || "";
            if (c) { text += c; outChars += c.length; if (wantStream) res.write("data: " + JSON.stringify({ type: "delta", text: c }) + "\n\n"); }
            const rc = d.reasoning_content || d.reasoning || "";
            if (rc) reasoning += rc;
        }
    } catch (e) {
        if (!owner && reserved) { try { adjustUsage(userId, -reserved); } catch {} }
        // Never echo the raw upstream error to API callers — it can leak provider/model/internal
        // details (models are intentionally redacted). Return a coarse, generic message instead.
        const st = Number(e?.status) || 502;
        const msg = st === 429 ? "The AI is busy right now — please retry shortly."
            : st >= 400 && st < 500 ? "The request couldn't be processed."
                : "The AI service is temporarily unavailable.";
        logAiRequest(userId, modelId, false, st === 429 ? 429 : 502, Date.now() - t0, estTokens(inChars), 0, msg, { ip, fp });
        if (wantStream) { try { res.write("data: " + JSON.stringify({ type: "error", error: msg }) + "\n\n"); res.end(); } catch {} return; }
        return res.status(st === 429 ? 429 : 502).json({ error: msg });
    }
    const inTok = (realUsage && realUsage.prompt_tokens != null) ? realUsage.prompt_tokens : estTokens(inChars);
    const outTok = (realUsage && realUsage.completion_tokens != null) ? realUsage.completion_tokens : estTokens(outChars);
    if (!owner) { try { adjustUsage(userId, (inTok + outTok) - reserved); } catch {} }
    try { recordUsage(userId, inTok + outTok, costMicro(modelId, inTok, outTok)); } catch {}
    logAiRequest(userId, modelId, true, 200, Date.now() - t0, inTok, outTok, null, { ip, fp });
    const u2 = getUsage(userId);
    const quota = owner ? { unlimited: true } : { used: u2.used, cap: effectiveDaily(userId), remaining: Math.max(0, effectiveDaily(userId) - u2.used) };
    if (wantStream) { try { res.write("data: " + JSON.stringify({ type: "done", usage: { inputTokens: inTok, outputTokens: outTok }, quota }) + "\n\n"); res.write("data: [DONE]\n\n"); res.end(); } catch {} return; }
    res.json({ ok: true, model: modelId, response: text, ...(reasoning ? { reasoning } : {}), usage: { inputTokens: inTok, outputTokens: outTok, totalTokens: inTok + outTok }, quota });
}

function aiApiDocs(req, res) {
    apiCors(res);
    // Always advertise the public domain, not whatever host the request came in on
    // (so docs/examples show nocturne.lol, never localhost:8080).
    const base = "https://" + (process.env.NOCTURNE_PUBLIC_HOST || "nocturne.lol");
    // Intentionally redacted: no real account names and no model lineup are
    // exposed here. Use a model id you've been given access to; placeholders only.
    res.json({
        name: "Nocturne AI API",
        docs: base + "/api",
        endpoint: "POST " + base + "/api/ai",
        auth: "Either an API key (header 'Authorization: Bearer noct_…', created on your account page) OR JSON { account, password }.",
        request: { model: "<model-id>", prompt: "Hello!", optional: { system: "system prompt", messages: "[{role,content}] instead of prompt", level: "off|normal|extended (thinking level)", reasoning_effort: "low|medium|high", temperature: 0.7, max_tokens: 1024, stream: false } },
        responseExample: { ok: true, model: "<model-id>", response: "Hi! How can I help?", usage: { inputTokens: 12, outputTokens: 9, totalTokens: 21 }, quota: { used: 21, cap: 50000, remaining: 49979 } },
        curl: "curl -s " + base + "/api/ai -H 'Content-Type: application/json' -d '{\"model\":\"<model-id>\",\"account\":\"your-username\",\"password\":\"YOUR_PASSWORD\",\"prompt\":\"Hello\"}'",
        notes: [
            "Usage counts against your account's daily token quota.",
            "Model availability depends on your account — the model list isn't published here.",
            "API keys are safer than passwords — keep them server-side, never in client code."
        ]
    });
}

export function mountGroq(app, { authMiddleware } = {}) {
    const aiConfigHandler = (req, res) => {
        const navyConfigured = navyKeyState.length > 0;
        const orConfigured = !!OPENROUTER_KEY;
        const flashConfigured = !!FLASH_KEY;
        const owner = isOwnerUser(req);
        const uid = req.user?.id || null;
        // Free accounts get a single model, so there is nothing to choose — the UI
        // hides the picker when `modelLocked` is set.
        const freeTier = !owner && !isPaidUser(uid);
        const visibleModels = Object.entries(MODELS).filter(([id, m]) => {
            const providerOk = m.provider === "inkchan" ? !!INKCHAN_KEY
                : m.provider === "navy" ? navyConfigured
                : m.provider === "openrouter" ? orConfigured
                : m.provider === "flash" ? flashConfigured
                : keyState.length > 0;
            if (!providerOk) return false;
            if (owner) return true;          // god account sees everything
            if (m.private) return false;     // legacy owner-only flag
            return canUseModel(id, false, uid);   // "all" audience OR a per-user grant
        });
        let credits = null;
        if (req.user) {
            const micro = getCreditsMicro(req.user.id);
            credits = { unlimited: owner, micro, dollars: +(micro / 1_000_000).toFixed(6) };
        }
        res.json({
            configured: !!INKCHAN_KEY || keyState.length > 0 || navyConfigured || flashConfigured || (orConfigured && owner),
            keyCount: keyState.length,
            navyConfigured,
            openrouterConfigured: orConfigured,
            isOwner: owner,
            paid: !freeTier,
            modelLocked: freeTier && visibleModels.length <= 1,
            defaultModel: freeTier ? FREE_MODEL : DEFAULT_MODEL,
            agentInitialMicro: AGENT_INITIAL_MICRO,
            credits,
            anon: req.user ? null : { limit: ANON_FREE_PROMPTS, remaining: anonRemaining(anonIp(req)) },
            models: visibleModels.map(([id, m]) => {
                const p = priceFor(id);
                return {
                    id,
                    label: m.label,
                    company: m.company || "Other",
                    reasoning: m.reasoning,
                    // A `visionVia` model is text-only upstream but accepts images
                    // through its routing fallback, so clients may attach to it.
                    vision: !!(m.vision || (m.visionVia && MODELS[m.visionVia])),
                    maxTokens: m.max_completion_tokens_cap,
                    provider: m.provider,
                    private: !!m.private,
                    premium: !!m.premium,
                    ide: m.ide !== false,
                    audience: audienceOf(id),
                    // micro-dollars per token (== USD per 1M tokens)
                    pricing: { inPerToken: p.in, outPerToken: p.out }
                };
            })
        });
    };
    if (authMiddleware) {
        app.get("/api/ai/config", authMiddleware, aiConfigHandler);
    } else {
        app.get("/api/ai/config", aiConfigHandler);
    }

    // ── Public AI API + key management ───────────────────────────────────────
    app.options("/api/ai", (req, res) => { apiCors(res); res.sendStatus(204); });
    app.get("/api/ai", aiApiDocs);
    app.post("/api/ai", aiApiHandler);
    // Manage your developer API keys (session-authed via the global authMiddleware).
    app.post("/api/ai/apikeys", (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Sign in to manage API keys." });
        const n = stmts.apiKeyCount.get(req.user.id)?.n || 0;
        if (n >= 20) return res.status(409).json({ error: "Key limit reached (20) — revoke one first." });
        const apiKey = createApiKey(req.user.id, req.body?.label);
        res.json({ ok: true, key: apiKey, note: "You can reveal this key again anytime from the keys list." });
    });
    app.get("/api/ai/apikeys", (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Sign in to manage API keys." });
        res.json({ keys: stmts.apiKeyList.all(req.user.id).map(k => ({ id: k.id, label: k.label, createdAt: k.created_at, lastUsed: k.last_used })) });
    });
    // Re-reveal a previously-created key's raw value. Owner-only (session + row
    // ownership both checked); decrypts key_enc with the server-side secret.
    app.get("/api/ai/apikeys/:id/reveal", (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Sign in to manage API keys." });
        if (!apiRateOk("reveal:u" + req.user.id)) return res.status(429).json({ error: "Too many requests — slow down." });
        const row = stmts.apiKeyGetEnc.get(Number(req.params.id), req.user.id);
        if (!row || !row.key_enc) return res.status(404).json({ error: "Key not found." });
        try { res.json({ ok: true, key: decryptApiKey(row.key_enc) }); }
        catch (e) { res.status(500).json({ error: "Could not decrypt this key." }); }
    });
    app.delete("/api/ai/apikeys/:id", (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Sign in to manage API keys." });
        stmts.apiKeyDelete.run(Number(req.params.id), req.user.id);
        res.json({ ok: true });
    });

    const keysStatusHandler = (req, res) => {
        // Owner-only: this exposes key rotation state (masked keys, cooldowns,
        // failure counts) which shouldn't be public.
        if (!isOwnerUser(req)) return res.status(403).json({ error: "owner only" });
        const now = Date.now();
        res.json({
            keys: keyState.map(s => ({
                index: s.index,
                masked: maskKey(s.key),
                onCooldown: s.cooldownUntil > now,
                cooldownRemainingMs: Math.max(0, s.cooldownUntil - now),
                failures: s.failures,
                successes: s.successes
            }))
        });
    };
    if (authMiddleware) app.get("/api/ai/keys/status", authMiddleware, keysStatusHandler);
    else app.get("/api/ai/keys/status", keysStatusHandler);

    // ── Chat content filter ──────────────────────────────────────────────────
    // Blocks racial slurs (hard-r variants, not "nigga"), CSAM/grooming terms,
    // and other degrading language. Normalizes common evasion tricks (spacing,
    // leetspeak, zero-width chars) before matching.
    function chatContentBlocked(text) {
        const norm = text
            .replace(/[​‌‍‎‏﻿]/g, "")
            .replace(/(?<=\b[a-z])\s+(?=[a-z]\b)/gi, "")
            .replace(/0/g, "o").replace(/1/g, "i").replace(/3/g, "e")
            .replace(/4/g, "a").replace(/5/g, "s").replace(/\$/g, "s")
            .replace(/@/g, "a").replace(/\+/g, "t")
            .toLowerCase();

        // racial slurs (hard-r n-word, and other degrading terms)
        const SLURS_RE = /\bn[i!1]gg[e3]r\b|\bn[i!1]gg[e3]rs\b|\bjigaboo\b|\bjig+aboo\b|\bcoon\b|\bcoons\b|\bdarkie\b|\bdarkies\b|\bspook(?:s)?\b(?=.*(?:black|race|person))|\bwetback\b|\bwetbacks\b|\bbeaner\b|\bbeaners\b|\bspic\b|\bspics\b|\bchink\b|\bchinks\b|\bgook\b|\bgooks\b|\bkike\b|\bkikes\b|\btowelhead\b|\braghead\b|\bsandnigger\b|\bporch\s*monkey\b|\bjungle\s*bunny\b|\bmud\s*people\b/;

        // csam / grooming / cp terms
        const CSAM_RE = /\bchild\s*porn\b|\bkid\s*porn\b|\bkiddie\s*porn\b|\bchild\s*sex\b|\bminor\s*sex\b|\bunderage\s*sex\b|\bunderage\s*nude\b|\bunderage\s*naked\b|\bloli\s*porn\b|\blolicon\b|\bshotacon\b|\bpedo\s*porn\b|\bpedophil(?:e|ia)\b|\bjailbait\b|\bpreteen\s*(?:nude|naked|sex)\b|\bcp\s*links?\b|\bcp\s*vid(?:eo|s)?\b|\bcp\s*pic(?:s|ture)?\b|\byoung\s*(?:nude|naked)\s*(?:girl|boy|kid|child|teen)\b|\bteen\s*(?:nude|naked)\s*(?:pic|vid)\b|\bkid\s*(?:nude|naked)\b|\bgroom(?:ing)?\s*(?:child|kid|minor|underage)\b|\bsexual(?:ize|izing)\s*(?:child|kid|minor)\b/;

        return SLURS_RE.test(norm) || CSAM_RE.test(norm);
    }

    const handler = async (req, res) => {
        if (!rateCheck(req)) {
            return res.status(429).json({ error: "Rate limit exceeded - slow down" });
        }

        const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
        if (!messages || !messages.length) return res.status(400).json({ error: "messages array required" });
        let hasImage = false;
        for (const m of messages) {
            if (!m || typeof m !== "object" || typeof m.role !== "string") return res.status(400).json({ error: "invalid message" });
            if (typeof m.content === "string") {
                if (m.content.length > 1000000) return res.status(400).json({ error: "message too long" });
            } else if (Array.isArray(m.content)) {
                let textLen = 0, imgs = 0;
                for (const part of m.content) {
                    if (!part || typeof part !== "object") return res.status(400).json({ error: "invalid message part" });
                    if (part.type === "text") {
                        if (typeof part.text !== "string") return res.status(400).json({ error: "invalid text part" });
                        textLen += part.text.length;
                    } else if (part.type === "image_url") {
                        const url = part.image_url && part.image_url.url;
                        if (typeof url !== "string" || !/^(data:image\/(png|jpe?g|webp|gif);base64,|https?:\/\/)/i.test(url)) {
                            return res.status(400).json({ error: "invalid image" });
                        }
                        if (url.length > 7 * 1024 * 1024) return res.status(400).json({ error: "image too large (max about 5MB)" });
                        imgs++; hasImage = true;
                    } else {
                        return res.status(400).json({ error: "invalid content part" });
                    }
                }
                if (textLen > 1000000) return res.status(400).json({ error: "message too long" });
                if (imgs > 4) return res.status(400).json({ error: "too many images (max 4 per message)" });
            } else {
                return res.status(400).json({ error: "invalid message content" });
            }
        }
        if (messages.length > 60) return res.status(400).json({ error: "too many messages" });
        if (hasImage && !req.user) return res.status(403).json({ error: "Sign in to send images." });

        // ── Content filter: block slurs, CSAM terms, and degrading language ─────
        const lastUserMsg = [...messages].reverse().find(m => m.role === "user");
        if (lastUserMsg) {
            const raw = typeof lastUserMsg.content === "string"
                ? lastUserMsg.content
                : Array.isArray(lastUserMsg.content)
                    ? lastUserMsg.content.filter(p => p.type === "text").map(p => p.text).join(" ")
                    : "";
            if (raw && chatContentBlocked(raw)) {
                return res.status(400).json({ error: "Your message contains language that isn't allowed. Please rephrase." });
            }
        }

        if (!isOwnerUser(req)) {
            const totalChars = messages.reduce((n, m) => n + (m.content?.length || 0), 0);
            const estTok = Math.ceil(totalChars / 4);
            const budget = bumpTokenBudget(req, estTok);
            if (!budget.ok) {
                const minutesLeft = Math.ceil((budget.resetAt - Date.now()) / 60_000);
                return res.status(429).json({
                    error: `Token budget exceeded for this 4-hour window (${budget.used}/${budget.cap}). Resets in ~${minutesLeft}m.`,
                    used: budget.used,
                    cap: budget.cap,
                    resetAt: budget.resetAt
                });
            }
        }

        const owner = isOwnerUser(req);
        const userId = req.user?.id || null;
        // Free accounts run on FREE_MODEL no matter what the client asks for — a
        // stale localStorage pick or a hand-rolled request silently lands there
        // instead of erroring. Done BEFORE buildParams so the identity/thinking
        // system prompts are built from the model that actually runs. PAID users
        // are left alone: an out-of-reach model still 403s below rather than
        // quietly downgrading them to the free model.
        const freeTier = !owner && !isPaidUser(userId);
        if (freeTier && req.body && !canUseModel(sanitizeModel(req.body.model), owner, userId)) {
            req.body.model = FREE_MODEL;
        }
        // Transparent vision routing. A model that declares `visionVia` is
        // text-only upstream, so a turn carrying an image goes to the declared
        // vision backend instead — billed the same, and still presented to the
        // user (and to the model itself) as the model they picked. The routing
        // target is a fixed server-side constant, so this can't be steered by a
        // client into reaching a model it shouldn't.
        let presentAs = null, visionRouted = false;
        if (hasImage) {
            const via = MODELS[sanitizeModel(req.body?.model)]?.visionVia;
            if (via && MODELS[via]) {
                presentAs = sanitizeModel(req.body.model);
                req.body.model = via;
                visionRouted = true;
            }
        }
        const tz = await ipTimezone(clientIp(req));
        const params = buildParams(req, { presentAs, dateTime: formatDateTime(tz) });
        // What the CLIENT is told this turn ran on — never the substitute backend.
        params.presentModel = presentAs || params.model;
        params.paid = isPaidUser(userId);
        params.owner = owner;
        const thinkLevel = String(req.body?.level || "").toLowerCase();

        // ── Endpoint security ────────────────────────────────────────────────
        // Reject cross-origin browser calls (stops other sites siphoning keys).
        const origin = req.headers.origin;
        if (origin) {
            let oh = ""; try { oh = new URL(origin).host; } catch {}
            const allowed = (process.env.NOCTURNE_ALLOWED_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);
            allowed.push(
                "d27jvgogyihpmk.cloudfront.net",
                "nocturne.lol",
                "elahomework.s3-website-us-east-2.amazonaws.com",
                "elahomework.s3-website.us-east-2.amazonaws.com",
                "elahomework.s3.us-east-2.amazonaws.com",
                "blooketassets.s3-website-us-east-2.amazonaws.com",
                "blooketassets.s3-website.us-east-2.amazonaws.com",
                "blooketassets.s3.us-east-2.amazonaws.com",
                "olive-fun.com"
            );
            const hostOk = oh.endsWith(".cloudfront.net") || allowed.includes(oh);
            if (oh && oh !== req.headers.host && !hostOk) {
                return res.status(403).json({ error: "Cross-origin AI requests are not allowed." });
            }
        }

        // ── Anonymous free allowance (Pocket AI) ─────────────────────────────
        // Signed-out visitors get ANON_FREE_PROMPTS prompts/day per IP on the
        // default free model — no agent mode, no premium models (images are
        // already blocked for signed-out users above). Signed-in accounts skip
        // this and are governed by the daily token quota below.
        if (!req.user) {
            if (req.body?.agent === true || req.body?.agent === "1") {
                return res.status(401).json({ error: "Sign in (free) to use agent mode.", signInRequired: true });
            }
            if (!visionRouted) params.model = FREE_MODEL;   // already normalized above; kept explicit
            const gate = bumpAnonPrompt(anonIp(req));
            if (!gate.ok) {
                return res.status(401).json({
                    error: `You've used all ${ANON_FREE_PROMPTS} free prompts. Sign in — it's free — to keep chatting.`,
                    anonLimit: true, remaining: 0, limit: ANON_FREE_PROMPTS, resetAt: gate.resetAt
                });
            }
            res.setHeader("X-Anon-Remaining", String(gate.remaining));
            res.setHeader("X-Anon-Limit", String(ANON_FREE_PROMPTS));
        }
        const cfg = MODELS[params.model];

        // A vision-routed turn deliberately targets a backend outside the user's
        // tier — the gate was already applied to the model they actually picked.
        if (!visionRouted && !canUseModel(params.model, owner, userId)) {
            return res.status(403).json({ error: "This model isn't available on your account." });
        }
        if (hasImage && cfg && !cfg.vision) {
            return res.status(400).json({ error: "This model can't read images. Switch to a vision model like ChatGPT, Claude, Gemini, Grok, or Llama 4." });
        }

        let inChars = 0;
        for (const m of messages) {
            const c = m.content;
            if (typeof c === "string") inChars += c.length;
            else if (Array.isArray(c)) for (const p of c) if (p && p.type === "text" && p.text) inChars += p.text.length;
        }

        // ── Agent-mode credit metering ───────────────────────────────────────
        // Checked before the daily-quota reservation below so an early 402 here
        // can never leak a reservation (that path returns before the try/finally).
        // Credits gate AGENT mode only; plain chat is governed by the daily token
        // quota (50k default, set globally or per-user from the admin panel).
        const isAgent = req.body?.agent === true || req.body?.agent === "1";
        if (isAgent && !owner && getCreditsMicro(userId) <= 0) {
            return res.status(402).json({ error: "You're out of AI credits for agent mode.", balanceMicro: 0, balance: 0 });
        }

        // ── Daily fair-use quota (all accounts; owner exempt) ────────────────
        // HARD cap on input+output tokens per rolling 24h. The previous check only
        // blocked when PRIOR usage already exceeded the cap, so the very first
        // request from a fresh account could overrun by a whole reply (set 2k, used
        // 4k). Now we additionally: (a) refuse a prompt that alone exceeds the
        // remaining budget, (b) clamp this reply's max output tokens to what's left
        // so input+output can't pass the cap, and (c) reserve that worst-case cost
        // up front so parallel requests can't each overrun it. The finally block
        // reconciles the reservation down to the exact tokens used.
        let reservedQuota = 0;
        if (!owner && userId) {
            const cap = effectiveDaily(userId);
            const usage = getUsage(userId);
            const remaining = cap - usage.used;
            const hrs = Math.max(1, Math.ceil((usage.resetAt - Date.now()) / 3600_000));
            if (remaining <= 0) {
                return res.status(429).json({ error: `Daily AI limit reached (${cap.toLocaleString()} tokens/day). Resets in ~${hrs}h.`, dailyCap: cap, dailyUsed: usage.used, resetAt: usage.resetAt });
            }
            const estIn = estTokens(inChars);
            if (estIn >= remaining) {
                return res.status(429).json({ error: `This message (~${estIn.toLocaleString()} tokens) is larger than your remaining daily AI budget (${remaining.toLocaleString()} of ${cap.toLocaleString()} tokens/day). Resets in ~${hrs}h.`, dailyCap: cap, dailyUsed: usage.used, resetAt: usage.resetAt });
            }
            // Bound this reply so input + output can't blow past the daily cap.
            const outBudget = Math.max(1, remaining - estIn);
            if (params.max_completion_tokens > outBudget) params.max_completion_tokens = outBudget;
            // Reserve worst-case cost now (reconciled to exact in the finally).
            reservedQuota = estIn + params.max_completion_tokens;
            addUsage(userId, reservedQuota);
        }

        res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        res.setHeader("Cache-Control", "no-cache, no-transform");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders?.();
        // A first body byte so CloudFront/Caddy commit the 200. Without it, a
        // slow upstream is turned into a gateway 502 before any tokens exist.
        res.write(": open\n\n");

        const ac = new AbortController();
        let clientGone = false;
        res.on("close", () => {
            if (!res.writableEnded) {
                clientGone = true;
                ac.abort();
            }
        });

        let outChars = 0, realUsage = null, extraTokIn = 0, extraTokOut = 0;
        const ctx = { headers: { referer: req.headers.referer || req.headers.origin || "" } };
        const addExtraUsage = (u) => { if (u) { extraTokIn += u.prompt_tokens || 0; extraTokOut += u.completion_tokens || 0; } };
        const STREAM_RETRYABLE = (m) => RETRYABLE_STREAM_ERROR_RE.test(String(m || ""));
        try {
            if (isAgent) {
                // Long agent generations (whole-file rewrites take 15-20s) occasionally
                // drop mid-stream, and navy has a single key with no failover. Buffer the
                // turn and retry the whole thing transparently, so the client only ever
                // sees the final, complete answer instead of an "input stream" error.
                let acc = "", racc = "", finish = null, lastErr = null, ok = false;
                for (let attempt = 0; attempt < 3 && !clientGone; attempt++) {
                    acc = ""; racc = ""; finish = null; realUsage = null;
                    try {
                        for await (const { chunk } of runChatStream(params, ac.signal, ctx)) {
                            if (chunk?.usage) realUsage = chunk.usage;
                            const delta = chunk?.choices?.[0]?.delta || {};
                            acc += (delta.content || "").replace(/[—–]/g, "-");
                            racc += (delta.reasoning_content || delta.reasoning || "").replace(/[—–]/g, "-");
                            const f = chunk?.choices?.[0]?.finish_reason; if (f) finish = f;
                        }
                        ok = true; break;
                    } catch (e) {
                        lastErr = e;
                        if (ac.signal.aborted) break;
                        if (attempt === 2 || !STREAM_RETRYABLE(e?.message)) break;
                        console.warn(`[agent] stream attempt ${attempt + 1} dropped (${e?.message}); retrying`);
                        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
                    }
                }
                outChars = acc.length + racc.length;
                if (ok) {
                    if (racc) res.write(`data: ${JSON.stringify({ type: "reasoning", text: racc })}\n\n`);
                    if (acc) res.write(`data: ${JSON.stringify({ type: "delta", text: acc })}\n\n`);
                    res.write(`data: ${JSON.stringify({ type: "done", finish: finish || "stop" })}\n\n`);
                } else if (!ac.signal.aborted) {
                    const msg = lastErr?.message || "stream error";
                    console.error("[agent] stream failed after retries:", msg);
                    res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
                }
            } else if (params.model === FREE_MODEL && thinkLevel === "extended") {
                // Extended thinking: a multi-step plan/think/search loop (up to
                // EXTENDED_MAX_STEPS) instead of a single router call — see
                // runExtendedAgent above. Each step streams as its own indexed
                // tool_call/thought event so the client renders it as a separate block.
                const steps = await runExtendedAgent(params, ctx, ac.signal, res, n => outChars += n, () => clientGone, addExtraUsage);
                if (!clientGone) {
                    const runParams = steps.length ? { ...params, messages: [...params.messages, buildExtendedContext(steps)] } : params;
                    realUsage = await streamAndForward(runParams, ac.signal, ctx, res, n => outChars += n);
                    const allSources = [...new Set(steps.filter(s => s.kind === "search").flatMap(s => s.sources))];
                    if (allSources.length && !clientGone) {
                        res.write(`data: ${JSON.stringify({ type: "sources", sources: allSources })}\n\n`);
                    }
                }
            } else if (params.model === FREE_MODEL) {
                // Free-tier agentic web search, two layers deep:
                // 1) A cheap router call decides up front whether this turn needs live
                //    info (see decideWebSearch) and picks a search query if so.
                // 2) If the router says no, the answer still streams through a sniff
                //    (streamWithDenialFallback) that catches DeepSeek claiming it can't
                //    search instead of just doing it — that partial answer is discarded
                //    and the real tool call runs instead, using the user's own message
                //    as the query.
                // Either way, gpt-4o-mini-search-preview does the actual browsing and
                // DeepSeek summarizes the result into its final answer.
                const decision = decideWebSearch(params.messages);
                addExtraUsage(decision.usage);
                if (decision.query && !clientGone) {
                    realUsage = await runSearchAndAnswer(decision.query, params, ac.signal, ctx, res, n => outChars += n, () => clientGone, addExtraUsage);
                } else {
                    const probe = await streamWithDenialFallback(params, ac.signal, ctx, res, n => outChars += n);
                    if (!probe.denied) {
                        realUsage = probe.usage;
                    } else if (!clientGone) {
                        const lastUser = [...params.messages].reverse().find(m => m.role === "user");
                        const fallbackQuery = contentToText(lastUser?.content).slice(0, 300) || "general information";
                        realUsage = await runSearchAndAnswer(fallbackQuery, params, ac.signal, ctx, res, n => outChars += n, () => clientGone, addExtraUsage);
                    }
                }
            } else {
                realUsage = await streamAndForward(params, ac.signal, ctx, res, n => outChars += n);
            }
        } catch (e) {
            if (!ac.signal.aborted) {
                const msg = e?.message || "stream error";
                console.error("[groq] stream failed:", msg);
                res.write(`data: ${JSON.stringify({ type: "error", error: msg })}\n\n`);
            }
        } finally {
            // Prefer the provider's EXACT token usage; fall back to a char/4 estimate.
            const exact = !!(realUsage && (realUsage.prompt_tokens != null || realUsage.completion_tokens != null));
            // extraTok* folds in the hidden router + web-search calls (if any) so a
            // search turn is billed/quota'd for its real total cost, not just the
            // final summarization call.
            const inTok = ((realUsage && realUsage.prompt_tokens != null) ? realUsage.prompt_tokens : estTokens(inChars)) + extraTokIn;
            const outTok = ((realUsage && realUsage.completion_tokens != null) ? realUsage.completion_tokens : estTokens(outChars)) + extraTokOut;
            // Bill the AGENT turn: debit credits + report balance. Plain chat is
            // free of credits — it's limited by the daily token quota instead.
            try {
                if (isAgent && userId) {
                    const cost = costMicro(params.model, inTok, outTok);
                    const balanceMicro = debitCreditsMicro(userId, cost);
                    if (!res.writableEnded) {
                        res.write(`data: ${JSON.stringify({
                            type: "usage", model: params.presentModel || params.model, unlimited: false, exact,
                            inputTokens: inTok, outputTokens: outTok, costMicro: cost,
                            balanceMicro, balance: +(balanceMicro / 1_000_000).toFixed(6)
                        })}\n\n`);
                    }
                }
            } catch (e) { console.error("[credits] debit failed:", e?.message); }
            // Daily fair-use accounting: reconcile the up-front reservation to the
            // exact tokens actually used (refunds the unused remainder, or tops up
            // if the real usage ran slightly over the estimate).
            try { if (userId && !owner) adjustUsage(userId, (inTok + outTok) - reservedQuota); } catch {}
            // Persistent usage stats (all accounts) — tokens + estimated cost.
            try { if (userId) recordUsage(userId, inTok + outTok, costMicro(params.model, inTok, outTok)); } catch {}
            // Discord activity feed (in-app AI section).
            try { logActivity("ai_app", { userId, username: req.user?.username, ip: clientIp(req), fp: fpFromReq(req), model: params.presentModel || params.model, ok: true, status: 200, tokens: inTok + outTok }); } catch {}
            res.write("data: [DONE]\n\n");
            res.end();
        }
    };

    if (authMiddleware) {
        app.post("/api/ai/chat", authMiddleware, handler);
    } else {
        app.post("/api/ai/chat", handler);
    }

    // ── AI credit balance ────────────────────────────────────────────────────
    const creditsGet = (req, res) => {
        if (!req.user) return res.json({ authenticated: false });
        const owner = isOwnerUser(req);
        const micro = getCreditsMicro(req.user.id);
        const daily = getDailyUsage(req.user.id);
        res.json({
            authenticated: true,
            unlimited: owner,          // owner is never blocked, but still shows its balance
            micro, dollars: +(micro / 1_000_000).toFixed(6),
            initialMicro: AGENT_INITIAL_MICRO,
            daily: owner ? null : { used: daily.used, cap: daily.cap, resetAt: daily.resetAt }
        });
    };
    // Owner-only: set or top up a user's balance (handy for testing/support).
    const creditsSet = (req, res) => {
        if (!isOwnerUser(req)) return res.status(403).json({ error: "owner only" });
        const targetId = Number(req.body?.userId) || req.user.id;
        const dollars = Number(req.body?.dollars);
        if (!isFinite(dollars) || dollars < 0) return res.status(400).json({ error: "dollars must be >= 0" });
        const micro = Math.round(dollars * 1_000_000);
        stmts.aiCreditsSet.run(micro, targetId);
        res.json({ ok: true, userId: targetId, micro, dollars: +(micro / 1_000_000).toFixed(6) });
    };
    if (authMiddleware) {
        app.get("/api/ai/credits", authMiddleware, creditsGet);
        app.post("/api/ai/credits", authMiddleware, creditsSet);
    } else {
        app.get("/api/ai/credits", creditsGet);
        app.post("/api/ai/credits", creditsSet);
    }

    // Per-user AI usage stats (tokens this week / all-time + estimated price).
    const usageGet = (req, res) => {
        if (!req.user) return res.json({ authenticated: false });
        res.json({ authenticated: true, ...getUserUsageStats(req.user.id) });
    };
    if (authMiddleware) app.get("/api/ai/usage", authMiddleware, usageGet);
    else app.get("/api/ai/usage", usageGet);

    // Recent /api/ai requests for the Logs pane, plus today's rollup stats.
    const AI_LOG_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
    app.get("/api/ai/logs", (req, res) => {
        if (!req.user) return res.json({ authenticated: false });
        if (!apiRateOk("logs:u" + req.user.id)) return res.status(429).json({ error: "Too many requests — slow down." });
        const dayStart = new Date(); dayStart.setHours(0, 0, 0, 0);
        const today = stmts.aiLogTodayStats.get(req.user.id, dayStart.getTime());
        const month = stmts.aiUsageUser.get(req.user.id, usageDayNum() - 29); // reuse daily-usage table for $ this month
        const rows = stmts.aiLogRecent.all(req.user.id, 50).map(r => ({
            id: r.id, model: r.model, ok: !!r.ok, statusCode: r.status_code, latencyMs: r.latency_ms,
            tokens: r.input_tokens + r.output_tokens, error: r.error, createdAt: r.created_at
        }));
        res.json({
            authenticated: true,
            today: { requests: today.requests, tokens: today.tokens, avgLatencyMs: Math.round(today.avgLatency) },
            monthCostMicro: month.cost,
            requests: rows
        });
    });

    // Per-model usage breakdown (last 30 days) for the Overview hover stats.
    app.get("/api/ai/usage/by-model", (req, res) => {
        if (!req.user) return res.json({ authenticated: false });
        if (!apiRateOk("bymodel:u" + req.user.id)) return res.status(429).json({ error: "Too many requests — slow down." });
        const dayStart = Date.now() - AI_LOG_MONTH_MS;
        const rows = stmts.aiLogByModel.all(req.user.id, dayStart).map(r => ({
            model: r.model, requests: r.requests, tokens: r.tokens,
            avgLatencyMs: Math.round(r.avgLatency), lastUsed: r.lastUsed
        }));
        res.json({ authenticated: true, models: rows });
    });

    // Public status page data: current navy liveness + a 90-day daily history
    // (one bucket per UTC day — worst status that day, wins ties toward outage).
    const STATUS_HISTORY_MS = 90 * 24 * 60 * 60 * 1000;
    const RANK_TO_STATUS = ["outage", "degraded", "operational"];
    app.get("/api/status", (req, res) => {
        res.setHeader("Cache-Control", "no-store");
        // Public + unauthenticated - rate-limit by IP so it can't be hammered for DB load.
        if (!apiRateOk("status:" + clientIp(req))) return res.status(429).json({ error: "Too many requests — slow down." });
        const latest = stmts.navyHealthLatest.get();
        const days = stmts.navyHealthDaily.all(Date.now() - STATUS_HISTORY_MS).map(r => ({
            day: r.dayBucket, status: RANK_TO_STATUS[r.worstRank], avgLatencyMs: Math.round(r.avgLatency), checks: r.checks
        }));
        res.json({
            configured: navyKeyState.length > 0,
            current: latest ? { status: latest.status, latencyMs: latest.latency_ms, attempts: latest.attempts, checkedAt: latest.checked_at } : null,
            days
        });
    });

    // Onboarding's "Let AI pick for me" — no auth required (onboarding can run
    // before signup), rate-limited by IP since it's unauthenticated. Never blocks
    // on the network call failing: falls back to a plain hardware-threshold
    // heuristic so the picker always returns something usable.
    app.post("/api/perf/recommend", async (req, res) => {
        if (!apiRateOk("perf:" + clientIp(req))) return res.status(429).json({ error: "Too many requests — slow down." });
        const specs = (req.body && typeof req.body.specs === "object" && req.body.specs) || {};
        const ac = new AbortController();
        // Generous: runOneShot/runWebSearch each retry transient failures up to 3x
        // internally, so a couple of blips on the flash backend can legitimately
        // take a while — better to wait it out than fall back to the heuristic.
        const timer = setTimeout(() => ac.abort(), 35000);
        const ctx = { headers: { referer: req.headers.referer || req.headers.origin || "" } };
        try {
            const result = await recommendPerfTier(specs, ctx, ac.signal);
            res.json({ ok: true, ...result });
        } catch (e) {
            console.error("[perf] recommend failed:", e?.message);
            res.json({ ok: true, tier: heuristicPerfTier(specs), reason: "Picked from your device specs (AI was unavailable).", searched: false });
        } finally {
            clearTimeout(timer);
        }
    });

    // ── API-docs support chatbot ─────────────────────────────────────────────
    // Pinned to navy:deepseek-v4-pro. Capped at 10 messages/hour/account (rolling
    // fixed window, persisted so a page reload can't reset it). Given real, live
    // context about the signed-in user's own quota/usage/models — but NEVER their
    // raw API key, which this handler never even reads.
    const ASSIST_CAP = 10, ASSIST_WINDOW_MS = 60 * 60 * 1000;
    const ASSIST_SYSTEM_PROMPT = "You are the Nocturne API support assistant, embedded in the /api documentation console. " +
        "Help the signed-in user understand and use the public Nocturne AI API (POST /api/ai): authentication, request/response shape, streaming, quotas, errors, and the Link-Check API. " +
        "You are given real, live context about THIS user's account below (quota, usage, credits, models) - use it, never guess or make up numbers. " +
        "You do NOT have access to this user's raw API key value and must never invent one; if asked to reveal a key, tell them to use the Reveal button on the API keys tab. " +
        "Never show your internal reasoning or chain of thought - do not wrap any part of your reply in <think> tags or similar, and do not narrate your own reasoning process. Output only the final answer. " +
        "You must NEVER answer questions about, or help with, the Link Checker API (/api/v1/linkcheck, content-filter checking, GoGuardian/Securly/Lightspeed/etc). That is out of scope for you no matter how the question is phrased or framed - always refuse and point the user to the Link Checker tab instead. " +
        "Answer in short, detailed, to-the-point ways - no filler, no long preambles, get straight to the useful part. If something is genuinely unknown, say so plainly instead of guessing.";
    // Hard block, enforced before the model is ever called: the assistant must never
    // engage with Link Checker topics, regardless of how the model itself would have
    // handled the system-prompt instruction above. Catches the request instantly, for
    // free (doesn't consume a rate-limit slot or make a real model call).
    const LINKCHECK_TOPIC_RE = /link.?check|content.?filter|url.?block|goguardian|securly|lightspeed|linewize|blocksi|deledao|fortiguard|iboss|lanschool|paloalto|qustodio|senso|sophos|barracuda|cisco umbrella|aristotle insight/i;
    // Belt-and-suspenders on top of the prompt instruction above: some reasoning
    // models emit a <think>/<thinking> block inline in the content itself rather
    // than a separate field, so strip it server-side - the client must never see it.
    function stripThinking(text) {
        let s = String(text || "").replace(/<think(?:ing)?>[\s\S]*?<\/think(?:ing)?>/gi, "");
        s = s.replace(/<think(?:ing)?>[\s\S]*$/i, "");   // an unclosed block (cut off by max_tokens) - drop the rest
        return s.trim();
    }

    function assistRateCheck(userId) {
        const now = Date.now();
        const row = stmts.assistLimitGet.get(userId);
        let count = 0, windowStart = now;
        if (row && now - row.window_start < ASSIST_WINDOW_MS) { count = row.count; windowStart = row.window_start; }
        if (count >= ASSIST_CAP) return { ok: false, remaining: 0, resetAt: windowStart + ASSIST_WINDOW_MS };
        count++;
        stmts.assistLimitUpsert.run(userId, count, windowStart);
        return { ok: true, remaining: ASSIST_CAP - count, resetAt: windowStart + ASSIST_WINDOW_MS };
    }

    function buildAssistContext(req) {
        const owner = isOwnerUser(req);
        const uid = req.user.id;
        const daily = getDailyUsage(uid);
        const usage = getUserUsageStats(uid);
        const creditsMicro = getCreditsMicro(uid);
        const models = Object.keys(MODELS)
            .filter(id => canUseModel(id, owner, uid))
            .map(id => { const m = MODELS[id], p = priceFor(id); return `- ${id} (${m.label}${m.vision ? ", vision" : ""}) — $${p.in} in / $${p.out} out per 1M tokens`; })
            .slice(0, 40).join("\n");
        return [
            `Account type: ${owner ? "owner (unlimited quota)" : "standard"}.`,
            owner ? "" : `Daily token quota: ${daily.used} / ${daily.cap} used, resets ${new Date(daily.resetAt).toISOString()}.`,
            `Usage last 7 days: ${usage.weekTokens} tokens (~$${usage.weekCost}). All-time: ${usage.allTokens} tokens (~$${usage.allCost}).`,
            `Agent credit balance: $${(creditsMicro / 1_000_000).toFixed(2)}.`,
            `Models this account can call:\n${models || "(none available)"}`
        ].filter(Boolean).join("\n");
    }

    app.post("/api/ai/assist", async (req, res) => {
        if (!req.user) return res.status(401).json({ error: "Sign in to use the assistant." });

        // Validate input before touching the rate limit, so a bad request never
        // costs the user one of their 10 messages/hour.
        const userMsg = typeof req.body?.message === "string" ? req.body.message.trim() : "";
        if (!userMsg) return res.status(400).json({ error: "message is required." });
        if (userMsg.length > 2000) return res.status(400).json({ error: "Message too long (max 2000 characters)." });

        // Link Checker questions are refused before the model is ever invoked -
        // instant, free, and can't be talked around by rephrasing.
        if (LINKCHECK_TOPIC_RE.test(userMsg)) {
            return res.json({ ok: true, response: "I can't help with the Link Checker API — see the Link Checker tab for full docs.", remaining: null, resetAt: null });
        }

        const gate = assistRateCheck(req.user.id);
        if (!gate.ok) return res.status(429).json({ error: "You've reached the assistant's limit (10 messages/hour). It resets soon.", remaining: 0, resetAt: gate.resetAt });

        const rawHistory = Array.isArray(req.body?.history) ? req.body.history.slice(-8) : [];
        const history = rawHistory
            .filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
            .map(m => ({ role: m.role, content: String(m.content).slice(0, 2000) }));

        const messages = [
            { role: "system", content: ASSIST_SYSTEM_PROMPT + "\n\nLive account context:\n" + buildAssistContext(req) },
            ...history,
            { role: "user", content: userMsg }
        ];

        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 25_000);
        try {
            let text = "";
            for await (const { chunk } of runChatStream(
                { model: "mai-sakurajima", messages, max_completion_tokens: 500, temperature: 0.4, top_p: 1 },
                ac.signal, { headers: { referer: "" } }
            )) {
                text += chunk?.choices?.[0]?.delta?.content || "";
            }
            res.json({ ok: true, response: stripThinking(text), remaining: gate.remaining, resetAt: gate.resetAt });
        } catch (e) {
            res.status(502).json({ error: "The assistant is temporarily unavailable — try again shortly." });
        } finally {
            clearTimeout(timer);
        }
    });

    const aiHistoryGet = (req, res) => {
        if (!req.user) return res.json({ authenticated: false });
        try {
            const row = stmts.aiHistoryGet.get(req.user.id);
            if (!row) return res.json({ authenticated: true, messages: [], model: null, updated_at: 0 });
            let messages = [];
            try { messages = JSON.parse(row.messages); } catch {}
            res.json({ authenticated: true, messages, model: row.model || null, updated_at: row.updated_at || 0 });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    };

    const aiHistorySet = (req, res) => {
        if (!req.user) return res.status(401).json({ error: "auth required" });
        const messages = Array.isArray(req.body?.messages) ? req.body.messages : null;
        if (!messages) return res.status(400).json({ error: "messages array required" });
        const model = typeof req.body?.model === "string" ? req.body.model.slice(0, 64) : null;
        const trimmed = messages.slice(-200);
        const json = JSON.stringify(trimmed);
        if (json.length > 512 * 1024) return res.status(413).json({ error: "history too large" });
        try {
            stmts.aiHistorySet.run(req.user.id, json, model, Date.now());
            res.json({ ok: true, count: trimmed.length });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    };

    const aiHistoryDelete = (req, res) => {
        if (!req.user) return res.status(401).json({ error: "auth required" });
        try {
            stmts.aiHistoryDelete.run(req.user.id);
            res.json({ ok: true });
        } catch (e) {
            res.status(500).json({ error: e.message });
        }
    };

    if (authMiddleware) {
        app.get("/api/ai/history", authMiddleware, aiHistoryGet);
        app.post("/api/ai/history", authMiddleware, aiHistorySet);
        app.delete("/api/ai/history", authMiddleware, aiHistoryDelete);
    } else {
        app.get("/api/ai/history", aiHistoryGet);
        app.post("/api/ai/history", aiHistorySet);
        app.delete("/api/ai/history", aiHistoryDelete);
    }

    function deriveTitle(messages) {
        const first = messages?.find(m => m.role === "user");
        if (!first) return "New chat";
        const t = String(contentToText(first.content) || "").trim().replace(/\s+/g, " ").slice(0, 60);
        return t || "New chat";
    }

    const inflightTitleGen = new Set();
    const lastTitledAt = new Map();
    const TITLE_THROTTLE_MS = 25_000;

    async function generateChatTitle(userId, chatId, messages) {
        const key = userId + ":" + chatId;
        if (inflightTitleGen.has(key)) return;
        const last = lastTitledAt.get(key) || 0;
        if (Date.now() - last < TITLE_THROTTLE_MS) return;
        inflightTitleGen.add(key);
        try {
            if (!INKCHAN_KEY && !keyState.length) return;
            const slice = messages.slice(-12);
            const transcript = slice.map(m => {
                const role = m.role === "assistant" ? "Assistant" : (m.role === "user" ? "User" : m.role);
                return `${role}: ${contentToText(m.content).slice(0, 600)}`;
            }).join("\n");
            if (!transcript.trim()) return;
            const titleMessages = [
                { role: "system", content: "You generate a short chat title (3-6 words) summarizing the current main topic of a conversation. Update it to reflect what the chat is actually about now, even if it has shifted. Output only the title - no quotes, no trailing punctuation, no prefixes like \"Title:\". Plain text only." },
                { role: "user", content: transcript }
            ];
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 10000);
            try {
                const { text } = await runOneShot("mai-sakurajima", titleMessages, ac.signal, { headers: { referer: "" } }, 24);
                let title = (text || "").trim();
                title = title.replace(/^["'`*_]+|["'`*_.,!?:;]+$/g, "").trim();
                title = title.split(/\r?\n/)[0].trim();
                if (title && title.length <= 80) {
                    stmts.aiChatSetTitle.run(title, chatId, userId);
                    lastTitledAt.set(key, Date.now());
                }
            } finally { clearTimeout(timer); }
        } catch (e) {
            console.warn("[ai] title gen failed:", e?.message);
        } finally {
            inflightTitleGen.delete(key);
        }
    }

    const chatList = (req, res) => {
        if (!req.user) return res.json({ authenticated: false, chats: [] });
        const limit = Math.max(1, Math.min(100, parseInt(req.query.limit, 10) || 50));
        const rows = stmts.aiChatList.all(req.user.id, limit);
        res.json({ authenticated: true, chats: rows });
    };

    const chatGet = (req, res) => {
        if (!req.user) return res.status(401).json({ error: "auth required" });
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Invalid id" });
        const row = stmts.aiChatGet.get(id, req.user.id);
        if (!row) return res.status(404).json({ error: "not found" });
        let messages = [];
        try { messages = JSON.parse(row.messages); } catch {}
        res.json({ id: row.id, title: row.title, model: row.model, messages, created_at: row.created_at, updated_at: row.updated_at });
    };

    const chatCreate = (req, res) => {
        if (!req.user) return res.status(401).json({ error: "auth required" });
        const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-200) : [];
        const json = JSON.stringify(messages);
        if (json.length > 512 * 1024) return res.status(413).json({ error: "history too large" });
        const count = stmts.aiChatCount.get(req.user.id)?.n || 0;
        if (count >= 200) return res.status(429).json({ error: "Chat limit reached (200). Delete some old chats first." });
        const title = (req.body?.title || "New chat").slice(0, 80);
        const model = typeof req.body?.model === "string" ? req.body.model.slice(0, 64) : null;
        const now = Date.now();
        const info = stmts.aiChatInsert.run(req.user.id, title, json, model, now, now);
        const chatId = info.lastInsertRowid;
        const hasAssistant = messages.some(m => m.role === "assistant");
        if (hasAssistant && (!title || title === "New chat")) {
            generateChatTitle(req.user.id, chatId, messages);
        }
        res.json({ ok: true, id: chatId, title });
    };

    const chatUpdate = (req, res) => {
        if (!req.user) return res.status(401).json({ error: "auth required" });
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Invalid id" });
        const existing = stmts.aiChatGet.get(id, req.user.id);
        if (!existing) return res.status(404).json({ error: "not found" });
        const messages = Array.isArray(req.body?.messages) ? req.body.messages.slice(-200) : [];
        const json = JSON.stringify(messages);
        if (json.length > 512 * 1024) return res.status(413).json({ error: "history too large" });
        const model = typeof req.body?.model === "string" ? req.body.model.slice(0, 64) : (existing.model || null);
        stmts.aiChatUpdate.run(json, model, "", Date.now(), id, req.user.id);
        const hasAssistant = messages.some(m => m.role === "assistant");
        if (hasAssistant) {
            generateChatTitle(req.user.id, id, messages);
        }
        res.json({ ok: true });
    };

    const chatDelete = (req, res) => {
        if (!req.user) return res.status(401).json({ error: "auth required" });
        const id = parseInt(req.params.id, 10);
        if (!id) return res.status(400).json({ error: "Invalid id" });
        stmts.aiChatDelete.run(id, req.user.id);
        res.json({ ok: true });
    };

    const chatDeleteAll = (req, res) => {
        if (!req.user) return res.status(401).json({ error: "auth required" });
        stmts.aiChatDeleteAll.run(req.user.id);
        res.json({ ok: true });
    };

    if (authMiddleware) {
        app.get("/api/ai/chats", authMiddleware, chatList);
        app.get("/api/ai/chats/:id", authMiddleware, chatGet);
        app.post("/api/ai/chats", authMiddleware, chatCreate);
        app.put("/api/ai/chats/:id", authMiddleware, chatUpdate);
        app.delete("/api/ai/chats/:id", authMiddleware, chatDelete);
        app.delete("/api/ai/chats", authMiddleware, chatDeleteAll);
    } else {
        app.get("/api/ai/chats", chatList);
        app.get("/api/ai/chats/:id", chatGet);
        app.post("/api/ai/chats", chatCreate);
        app.put("/api/ai/chats/:id", chatUpdate);
        app.delete("/api/ai/chats/:id", chatDelete);
        app.delete("/api/ai/chats", chatDeleteAll);
    }
}

export function groqStatus() {
    return { configured: !!INKCHAN_KEY || keyState.length > 0, keyCount: keyState.length, inkchan: !!INKCHAN_KEY };
}
