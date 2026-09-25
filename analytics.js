// Owner analytics: live time-series for the admin panel.
//
// Two sources feed the graphs:
//
//   Counters (AI requests, tokens, errors, signups, chat) are derived
//   on demand by bucketing the tables that already timestamp every row. Nothing
//   extra is written for them.
//
//   Concurrency (CCU) has no history anywhere - sessions only knows "now" - so a
//   sampler records it. High-resolution samples live in a memory ring (every 2s,
//   one hour deep) which is what the 1m/5m/30m views read; every 30s one row is
//   also written to metric_samples so the hour+ views have something to read
//   after a restart. Ring first, table for the long tail.
import { db } from "./db.js";
import { server as wispServer } from "@mercuryworkshop/wisp-js/server";
import { onlineCount } from "./presence.js";

const SAMPLE_MS = 2_000;          // ring resolution, matches the fastest UI refresh
const PERSIST_EVERY = 15;         // ring ticks per DB row -> one row every 30s
const RING_MAX = 1_800;           // 1h at 2s
const RETAIN_MS = 90 * 24 * 3600_000;
const ONLINE_WINDOW_MS = 5 * 60_000;   // a session counts as online for 5 min after last_seen

db.exec(`
CREATE TABLE IF NOT EXISTS metric_samples (
    ts INTEGER PRIMARY KEY,
    online INTEGER NOT NULL DEFAULT 0,
    sessions INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_metric_samples_ts ON metric_samples(ts);
-- the per-user index cannot serve a plain time-range scan, which is what every graph does
CREATE INDEX IF NOT EXISTS idx_ai_reqlog_created ON ai_request_logs(created_at);
CREATE INDEX IF NOT EXISTS idx_users_created ON users(created_at);
`);

// Added after the table shipped; ALTER is a no-op once the column exists.
for (const col of ["proxy_sessions", "proxy_streams"]) {
    try { db.exec(`ALTER TABLE metric_samples ADD COLUMN ${col} INTEGER NOT NULL DEFAULT 0`); } catch { /* already there */ }
}

const q = {
    insertSample: db.prepare("INSERT OR REPLACE INTO metric_samples (ts, online, sessions, proxy_sessions, proxy_streams) VALUES (?, ?, ?, ?, ?)"),
    pruneSamples: db.prepare("DELETE FROM metric_samples WHERE ts < ?"),
    samplesRange: db.prepare("SELECT ts, online, sessions, proxy_sessions, proxy_streams FROM metric_samples WHERE ts >= ? AND ts <= ? ORDER BY ts"),
    peakSince: db.prepare("SELECT MAX(online) AS n FROM metric_samples WHERE ts >= ?"),
    peakAll: db.prepare("SELECT MAX(online) AS n FROM metric_samples"),
    oldestSample: db.prepare("SELECT MIN(ts) AS ts FROM metric_samples"),
    countOnline: db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen > ?"),
    countSessions: db.prepare("SELECT COUNT(*) AS n FROM sessions WHERE expires_at > ?"),
    oldestUser: db.prepare("SELECT MIN(created_at) AS ts FROM users"),
};

// ── proxy traffic ────────────────────────────────────────────────────────────
//
// Proxied browsing never touches an Express route - it rides the wisp WebSocket -
// so there is no request middleware to count it from. (The search_logs table looks
// like the place for this, but nothing has ever written to it; that is why the
// "proxy searches" line was permanently flat.) Instead two running totals are kept
// here and the sampler records the delta, so a busy page load costs two increments
// rather than a row per subresource.

const total = { proxySessions: 0, proxyStreams: 0 };

/** Called from the wisp upgrade handler: one browsing session. */
export function countProxySession() { total.proxySessions++; }

/* One wisp stream ~ one connection the proxy opened on the page's behalf. There is
   no callback for this in wisp-js, so create_stream is wrapped. The wrapper must
   never be able to break proxying: it counts, then always calls through. */
function installStreamCounter() {
    try {
        const proto = wispServer && wispServer.ServerConnection && wispServer.ServerConnection.prototype;
        if (!proto || typeof proto.create_stream !== "function" || proto.create_stream.__noctCounted) return false;

        const original = proto.create_stream;
        function counted(...args) {
            try { total.proxyStreams++; } catch { /* counting is never fatal */ }
            return original.apply(this, args);
        }
        counted.__noctCounted = true;
        proto.create_stream = counted;
        return true;
    } catch {
        return false;   // a wisp-js change costs the metric, never the proxy
    }
}

// ── sampler ──────────────────────────────────────────────────────────────────

const ring = [];   // { ts, online, sessions, proxySessions, proxyStreams }, oldest first
let tick = 0;

// Counters are cumulative; samples store the delta since the previous sample of the
// same kind. The ring ticks every 2s, the table every 30s, and samplesFor() never
// mixes a ring tick with the table row that already covers it.
const sinceTick = { proxySessions: 0, proxyStreams: 0 };
const sincePersist = { proxySessions: 0, proxyStreams: 0 };

function delta(mark) {
    const out = {};
    for (const k of Object.keys(total)) {
        out[k] = Math.max(0, total[k] - mark[k]);
        mark[k] = total[k];
    }
    return out;
}

function sampleNow() {
    const now = Date.now();
    let online = 0, sessions = 0;
    try {
        online = onlineCount();
        sessions = q.countSessions.get(now).n || 0;
    } catch { return; }

    const d = delta(sinceTick);
    ring.push({ ts: now, online, sessions, proxySessions: d.proxySessions, proxyStreams: d.proxyStreams });
    if (ring.length > RING_MAX) ring.splice(0, ring.length - RING_MAX);

    if (++tick % PERSIST_EVERY === 0) {
        const p = delta(sincePersist);
        try { q.insertSample.run(now, online, sessions, p.proxySessions, p.proxyStreams); } catch (e) { complain("insertSample", e); }
    }
}

export function startSampler() {
    if (!installStreamCounter()) console.warn("[analytics] wisp create_stream hook unavailable - proxy request counts will stay at 0");
    sampleNow();
    const t = setInterval(sampleNow, SAMPLE_MS);
    if (t.unref) t.unref();

    const p = setInterval(() => {
        try { q.pruneSamples.run(Date.now() - RETAIN_MS); } catch {}
    }, 3600_000);
    if (p.unref) p.unref();
}

// ── ranges ───────────────────────────────────────────────────────────────────

// bucketMs is chosen so every range lands on 30-120 points: enough shape to read,
// few enough that the SVG stays light and the tooltip can snap cleanly.
const RANGES = {
    "1m":  { ms: 60_000,          bucket: 2_000 },
    "5m":  { ms: 5 * 60_000,      bucket: 5_000 },
    "30m": { ms: 30 * 60_000,     bucket: 30_000 },
    "1h":  { ms: 3600_000,        bucket: 60_000 },
    "1d":  { ms: 24 * 3600_000,   bucket: 15 * 60_000 },
    "7d":  { ms: 7 * 24 * 3600_000,  bucket: 2 * 3600_000 },
    "30d": { ms: 30 * 24 * 3600_000, bucket: 12 * 3600_000 },
};

export const RANGE_KEYS = [...Object.keys(RANGES), "max"];

// Long windows genuinely do not change between two-second polls, so they are served
// from a short cache. Short windows - the ones that are meant to feel live - are not.
const CACHE_TTL = { "1m": 1_000, "5m": 1_000, "30m": 1_000, "1h": 2_000, "1d": 5_000, "7d": 15_000, "30d": 30_000, max: 30_000 };

function resolveRange(key) {
    if (key !== "max") {
        const r = RANGES[key] || RANGES["1h"];
        const to = Date.now();
        return { key: RANGES[key] ? key : "1h", from: to - r.ms, to, bucket: r.bucket };
    }

    // MAX runs from the first thing that ever happened to now, bucketed to ~90 points.
    const to = Date.now();
    const candidates = [];
    for (const row of [q.oldestSample.get(), q.oldestUser.get()]) {
        if (row && row.ts) candidates.push(row.ts);
    }
    const from = candidates.length ? Math.min(...candidates) : to - RANGES["1d"].ms;
    const span = Math.max(to - from, 60_000);
    const bucket = Math.max(60_000, Math.round(span / 90 / 60_000) * 60_000);
    return { key: "max", from, to, bucket };
}

function emptyBuckets(from, to, bucket) {
    const start = Math.floor(from / bucket) * bucket;
    const out = [];
    for (let t = start; t <= to; t += bucket) out.push([t, 0]);
    return out;
}

// better-sqlite3 does not cache prepares, and these run on every poll.
const prepared = new Map();
function stmt(sql) {
    let s = prepared.get(sql);
    if (!s) { s = db.prepare(sql); prepared.set(sql, s); }
    return s;
}

// A query that breaks must be loud. Returning zeros looks exactly like "no traffic",
// which is how a broken bucket query shipped as a flat line nobody could explain.
const complained = new Set();
function complain(where, err) {
    if (complained.has(where)) return;
    complained.add(where);
    console.error(`[analytics] ${where} failed:`, err && err.message ? err.message : err);
}

/* Counter series: one row per event, summed into buckets. Gaps are real zeros.
   Binding notes, both learned the hard way:
     - better-sqlite3 rejects ?1/?2/?3 numbered placeholders with positional binding,
     - and it binds a JS number as REAL, so `created_at / ?` is float division and the
       bucket key never lands on a bucket boundary. CAST makes it integer division. */
function counterSeries(sql, { from, to, bucket }) {
    const points = emptyBuckets(from, to, bucket);
    const index = new Map(points.map((p, i) => [p[0], i]));

    let rows = [];
    try { rows = stmt(sql).all(bucket, bucket, from, to); } catch (e) { complain("counterSeries", e); return points; }

    for (const row of rows) {
        const i = index.get(row.b);
        if (i !== undefined) points[i][1] = row.v || 0;
    }
    return points;
}

/* Gauge series: a level that exists between samples. Empty buckets carry the last
   known value forward rather than dropping to zero, which would draw a sawtooth. */
function gaugeSeries(samples, { from, to, bucket }, pick) {
    const points = emptyBuckets(from, to, bucket);
    const index = new Map(points.map((p, i) => [p[0], i]));
    const seen = new Set();

    for (const s of samples) {
        const b = Math.floor(s.ts / bucket) * bucket;
        const i = index.get(b);
        if (i === undefined) continue;
        const v = pick(s);
        points[i][1] = seen.has(i) ? Math.max(points[i][1], v) : v;   // peak within the bucket
        seen.add(i);
    }

    let last = 0;
    for (let i = 0; i < points.length; i++) {
        if (seen.has(i)) last = points[i][1];
        else points[i][1] = last;
    }
    return points;
}

/* Sampled counters: each sample holds the traffic since the previous one, so a
   bucket is the sum of the samples that land in it (never a carry-forward). */
function sampleCounterSeries(samples, { from, to, bucket }, pick) {
    const points = emptyBuckets(from, to, bucket);
    const index = new Map(points.map((p, i) => [p[0], i]));

    for (const s of samples) {
        const i = index.get(Math.floor(s.ts / bucket) * bucket);
        if (i !== undefined) points[i][1] += pick(s) || 0;
    }
    return points;
}

function samplesFor({ from, to }) {
    // The ring is authoritative for the last hour; older windows come off disk.
    const ringFrom = ring.length ? ring[0].ts : Infinity;
    if (from >= ringFrom) return ring.filter(s => s.ts >= from && s.ts <= to);

    let rows = [];
    try { rows = q.samplesRange.all(from, to); } catch {}
    const cutoff = rows.length ? rows[rows.length - 1].ts : from;
    return rows.concat(ring.filter(s => s.ts > cutoff && s.ts <= to));
}

// ── metric definitions ───────────────────────────────────────────────────────

const BUCKET = "(created_at / CAST(? AS INTEGER)) * CAST(? AS INTEGER) AS b";
const WINDOW = "created_at >= ? AND created_at <= ? GROUP BY b";

const SQL = {
    aiRequests: `SELECT ${BUCKET}, COUNT(*) AS v FROM ai_request_logs WHERE ${WINDOW}`,
    aiTokens:   `SELECT ${BUCKET}, SUM(input_tokens + output_tokens) AS v FROM ai_request_logs WHERE ${WINDOW}`,
    aiErrors:   `SELECT ${BUCKET}, COUNT(*) AS v FROM ai_request_logs WHERE ok = 0 AND ${WINDOW}`,
    signups:    `SELECT ${BUCKET}, COUNT(*) AS v FROM users WHERE ${WINDOW}`,
    messages:   `SELECT ${BUCKET}, COUNT(*) AS v FROM chat_messages WHERE ${WINDOW}`,
    aiLatency:  `SELECT ${BUCKET}, CAST(AVG(latency_ms) AS INTEGER) AS v FROM ai_request_logs WHERE ok = 1 AND ${WINDOW}`,
};

// label/unit/kind drive the axis format and the tooltip on the client.
export const METRICS = [
    { id: "ccu",        label: "Concurrent users", unit: "users",  kind: "gauge" },
    { id: "aiRequests", label: "AI requests",      unit: "reqs",   kind: "count" },
    { id: "aiTokens",   label: "AI tokens",        unit: "tokens", kind: "count" },
    { id: "aiErrors",   label: "AI errors",        unit: "errors", kind: "count" },
    { id: "aiLatency",  label: "AI latency",       unit: "ms",     kind: "gauge" },
    { id: "signups",    label: "Signups",          unit: "users",  kind: "count" },
    { id: "messages",   label: "Chat messages",    unit: "msgs",   kind: "count" },
    { id: "proxySessions", label: "Proxy sessions", unit: "sessions", kind: "count" },
    { id: "proxyStreams",  label: "Proxy requests", unit: "reqs",     kind: "count" },
];

function buildSeries(window) {
    const samples = samplesFor(window);
    const out = {
        ccu: gaugeSeries(samples, window, s => s.online),
        sessions: gaugeSeries(samples, window, s => s.sessions),
        proxySessions: sampleCounterSeries(samples, window, s => s.proxySessions ?? s.proxy_sessions),
        proxyStreams: sampleCounterSeries(samples, window, s => s.proxyStreams ?? s.proxy_streams),
    };
    for (const [id, sql] of Object.entries(SQL)) out[id] = counterSeries(sql, window);
    return out;
}

// ── headline cards ───────────────────────────────────────────────────────────

function startOfToday() {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function cards() {
    const now = Date.now();
    const today = startOfToday();
    const dayAgo = now - 24 * 3600_000;

    const one = (sql, ...args) => {
        try { return stmt(sql).get(...args) || {}; } catch { return {}; }
    };

    const online = onlineCount();

    // Peak has to consider the ring too - the last 30s of it is not on disk yet.
    let peakToday = 0;
    try { peakToday = q.peakSince.get(today).n || 0; } catch {}
    let peakAll = 0;
    try { peakAll = q.peakAll.get().n || 0; } catch {}
    for (const s of ring) {
        if (s.ts >= today) peakToday = Math.max(peakToday, s.online);
        peakAll = Math.max(peakAll, s.online);
    }

    const ai = one(
        "SELECT COUNT(*) AS reqs, SUM(ok = 0) AS errs, SUM(input_tokens + output_tokens) AS toks, COUNT(DISTINCT user_id) AS users FROM ai_request_logs WHERE created_at >= ?",
        today
    );

    // p95 without a window function: skip the first 95% by latency and take the next.
    const total = one("SELECT COUNT(*) AS n FROM ai_request_logs WHERE ok = 1 AND created_at >= ?", today).n || 0;
    const p95 = total
        ? (one("SELECT latency_ms AS v FROM ai_request_logs WHERE ok = 1 AND created_at >= ? ORDER BY latency_ms LIMIT 1 OFFSET ?", today, Math.max(0, Math.floor(total * 0.95) - 1)).v || 0)
        : 0;

    const reqs = ai.reqs || 0;

    // Persisted deltas for today, plus the tail still sitting in the ring.
    const persisted = one("SELECT SUM(proxy_sessions) AS s, SUM(proxy_streams) AS r FROM metric_samples WHERE ts >= ?", today);
    const proxyToday = { sessions: persisted.s || 0, streams: persisted.r || 0 };
    const lastRow = one("SELECT MAX(ts) AS ts FROM metric_samples WHERE ts >= ?", today).ts || 0;
    for (const s of ring) {
        if (s.ts <= lastRow || s.ts < today) continue;
        proxyToday.sessions += s.proxySessions || 0;
        proxyToday.streams += s.proxyStreams || 0;
    }

    return {
        online,
        peakToday: Math.max(peakToday, online),
        peakAll: Math.max(peakAll, online),
        users: one("SELECT COUNT(*) AS n FROM users").n || 0,
        signupsToday: one("SELECT COUNT(*) AS n FROM users WHERE created_at >= ?", today).n || 0,
        aiRequestsToday: reqs,
        aiTokensToday: ai.toks || 0,
        aiUsersToday: ai.users || 0,
        aiErrorRate: reqs ? +((ai.errs || 0) / reqs * 100).toFixed(1) : 0,
        aiP95Ms: p95,
        messagesToday: one("SELECT COUNT(*) AS n FROM chat_messages WHERE created_at >= ?", today).n || 0,
        proxySessionsToday: proxyToday.sessions,
        proxyStreamsToday: proxyToday.streams,
        sessions: ring.length ? ring[ring.length - 1].sessions : 0,
        activeDay: one("SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen > ?", dayAgo).n || 0,
    };
}

function breakdowns(window) {
    const rows = (sql, ...args) => {
        try { return stmt(sql).all(...args); } catch { return []; }
    };

    return {
        models: rows(
            `SELECT model AS name, COUNT(*) AS reqs, SUM(input_tokens + output_tokens) AS tokens,
                    CAST(AVG(latency_ms) AS INTEGER) AS latency, SUM(ok = 0) AS errors
             FROM ai_request_logs WHERE created_at >= ? AND created_at <= ?
             GROUP BY model ORDER BY reqs DESC LIMIT 8`,
            window.from, window.to
        ),
        users: rows(
            `SELECT u.username AS name, COUNT(*) AS reqs, SUM(l.input_tokens + l.output_tokens) AS tokens
             FROM ai_request_logs l JOIN users u ON u.id = l.user_id
             WHERE l.created_at >= ? AND l.created_at <= ?
             GROUP BY l.user_id ORDER BY reqs DESC LIMIT 8`,
            window.from, window.to
        ),
    };
}

// ── the endpoint payload ─────────────────────────────────────────────────────

const cache = new Map();   // rangeKey -> { at, payload }

export function analytics(rangeKey, { compare = false } = {}) {
    const key = rangeKey + (compare ? "|c" : "");
    const hit = cache.get(key);
    const ttl = CACHE_TTL[rangeKey] ?? 2_000;
    if (hit && Date.now() - hit.at < ttl) return hit.payload;

    const window = resolveRange(rangeKey);
    const payload = {
        range: window.key,
        from: window.from,
        to: window.to,
        bucketMs: window.bucket,
        sampleMs: SAMPLE_MS,
        metrics: METRICS,
        series: buildSeries(window),
        cards: cards(),
        top: breakdowns(window),
    };

    if (compare) {
        // Same length of time, immediately before this window, for the ghost line.
        const span = window.to - window.from;
        const prev = { key: window.key, from: window.from - span, to: window.from, bucket: window.bucket };
        payload.previous = { from: prev.from, to: prev.to, series: buildSeries(prev) };
    }

    cache.set(key, { at: Date.now(), payload });
    return payload;
}
