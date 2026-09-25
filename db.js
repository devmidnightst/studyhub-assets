import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATA_DIR = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
fs.mkdirSync(DATA_DIR, { recursive: true });

const dbPath = path.join(DATA_DIR, "nocturne.db");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.pragma("synchronous = NORMAL");

db.exec(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL COLLATE NOCASE,
        password_hash TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        storage_bytes INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL,
        last_seen INTEGER NOT NULL,
        ip TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);

    CREATE TABLE IF NOT EXISTS cookies (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        domain TEXT NOT NULL,
        name TEXT NOT NULL,
        value TEXT NOT NULL,
        path TEXT NOT NULL DEFAULT '/',
        expires INTEGER,
        secure INTEGER NOT NULL DEFAULT 0,
        http_only INTEGER NOT NULL DEFAULT 0,
        same_site TEXT,
        updated_at INTEGER NOT NULL,
        size_bytes INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE (user_id, domain, name, path)
    );

    CREATE INDEX IF NOT EXISTS idx_cookies_user_domain ON cookies(user_id, domain);
    CREATE INDEX IF NOT EXISTS idx_cookies_user ON cookies(user_id);

    CREATE TABLE IF NOT EXISTS bans (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        target_kind TEXT NOT NULL CHECK (target_kind IN ('user', 'ip', 'device')),
        target TEXT NOT NULL,
        reason TEXT,
        banned_at INTEGER NOT NULL,
        expires_at INTEGER,
        banned_by TEXT,
        UNIQUE (target_kind, target)
    );

    CREATE INDEX IF NOT EXISTS idx_bans_expires ON bans(expires_at);
    CREATE INDEX IF NOT EXISTS idx_bans_target ON bans(target);

    CREATE TABLE IF NOT EXISTS search_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        ip TEXT,
        query TEXT NOT NULL,
        blocked INTEGER NOT NULL DEFAULT 0,
        block_reason TEXT,
        overridden INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_search_user ON search_logs(user_id);
    CREATE INDEX IF NOT EXISTS idx_search_ip ON search_logs(ip);
    CREATE INDEX IF NOT EXISTS idx_search_created ON search_logs(created_at);
    CREATE INDEX IF NOT EXISTS idx_search_blocked ON search_logs(blocked);

    CREATE TABLE IF NOT EXISTS ai_history (
        user_id INTEGER PRIMARY KEY,
        messages TEXT NOT NULL,
        model TEXT,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS ai_chats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        title TEXT,
        messages TEXT NOT NULL,
        model TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_chats_user_updated ON ai_chats(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS support_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        username TEXT,
        ip TEXT,
        subject TEXT,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved INTEGER NOT NULL DEFAULT 0
    );

    CREATE INDEX IF NOT EXISTS idx_support_resolved ON support_messages(resolved);
    CREATE INDEX IF NOT EXISTS idx_support_created ON support_messages(created_at);

    CREATE TABLE IF NOT EXISTS code_snippets (
        id TEXT PRIMARY KEY,
        content TEXT NOT NULL,
        language TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_code_snippets_expires ON code_snippets(expires_at);

    CREATE TABLE IF NOT EXISTS chat_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room TEXT NOT NULL DEFAULT 'general',
        user_id INTEGER,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        risk_score INTEGER NOT NULL DEFAULT 0,
        risk_category TEXT,
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_room_id ON chat_messages(room, id);
    CREATE INDEX IF NOT EXISTS idx_chat_created ON chat_messages(created_at);

    CREATE TABLE IF NOT EXISTS chat_flags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        room TEXT NOT NULL,
        user_id INTEGER,
        username TEXT,
        ip TEXT,
        text TEXT NOT NULL,
        risk_score INTEGER NOT NULL,
        risk_category TEXT,
        reason TEXT,
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chat_flags_created ON chat_flags(created_at);

    CREATE TABLE IF NOT EXISTS chat_reactions (
        message_id INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        emoji TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (message_id, user_id, emoji),
        FOREIGN KEY (message_id) REFERENCES chat_messages(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_chat_reactions_msg ON chat_reactions(message_id);

    CREATE TABLE IF NOT EXISTS dm_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        convo_key TEXT NOT NULL,
        sender_id INTEGER NOT NULL,
        recipient_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        text TEXT NOT NULL,
        reply_to INTEGER,
        edited_at INTEGER,
        deleted INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_dm_convo ON dm_messages(convo_key, id);
    CREATE INDEX IF NOT EXISTS idx_dm_created ON dm_messages(created_at);

    CREATE TABLE IF NOT EXISTS dm_threads (
        user_id INTEGER NOT NULL,
        other_id INTEGER NOT NULL,
        other_username TEXT NOT NULL,
        last_text TEXT,
        last_ts INTEGER NOT NULL,
        unread INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (user_id, other_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_dm_threads_user ON dm_threads(user_id, last_ts DESC);

    CREATE TABLE IF NOT EXISTS dm_settings (
        convo_key TEXT PRIMARY KEY,
        filter_off INTEGER NOT NULL DEFAULT 0,
        pending_by INTEGER,
        updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS gif_favorites (
        user_id INTEGER NOT NULL,
        gif_id TEXT NOT NULL,
        url TEXT NOT NULL,
        preview TEXT,
        title TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, gif_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_gif_fav_user ON gif_favorites(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS music_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        track_id TEXT NOT NULL,
        title TEXT,
        artist TEXT,
        genre TEXT,
        artwork TEXT,
        duration INTEGER,
        played_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_music_hist_user ON music_history(user_id, played_at DESC);
    CREATE INDEX IF NOT EXISTS idx_music_hist_genre ON music_history(user_id, genre, played_at DESC);

    CREATE TABLE IF NOT EXISTS music_favorites (
        user_id INTEGER NOT NULL,
        track_id TEXT NOT NULL,
        title TEXT,
        artist TEXT,
        genre TEXT,
        artwork TEXT,
        duration INTEGER,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, track_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_music_fav_user ON music_favorites(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS projects (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        data TEXT NOT NULL,
        bytes INTEGER NOT NULL DEFAULT 0,
        user_seq INTEGER,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_projects_user_updated ON projects(user_id, updated_at DESC);

    CREATE TABLE IF NOT EXISTS api_keys (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        key_hash TEXT UNIQUE NOT NULL,
        label TEXT,
        created_at INTEGER NOT NULL,
        last_used INTEGER,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_user ON api_keys(user_id);

    -- Per-request log for the public /api/ai endpoint: powers the Logs pane and
    -- per-model usage-on-hover stats. Pruned after AI_LOG_RETENTION_MS.
    CREATE TABLE IF NOT EXISTS ai_request_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        model TEXT NOT NULL,
        ok INTEGER NOT NULL,
        status_code INTEGER NOT NULL,
        latency_ms INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_ai_reqlog_user_created ON ai_request_logs(user_id, created_at DESC);

    -- Navy provider liveness pings (every 10 min) - backs the Status pane.
    -- Retained 90 days.
    CREATE TABLE IF NOT EXISTS navy_health_checks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        status TEXT NOT NULL CHECK (status IN ('operational', 'degraded', 'outage')),
        latency_ms INTEGER,
        attempts INTEGER NOT NULL DEFAULT 1,
        error TEXT,
        checked_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_navy_health_checked ON navy_health_checks(checked_at DESC);

    -- Rolling hourly cap for the API-docs support chatbot (10 msgs/hour/account).
    CREATE TABLE IF NOT EXISTS ai_assist_limits (
        user_id INTEGER PRIMARY KEY,
        count INTEGER NOT NULL DEFAULT 0,
        window_start INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS yt_watch_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT,
        author TEXT,
        thumbnail TEXT,
        duration TEXT,
        watched_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_yt_hist_user ON yt_watch_history(user_id, watched_at DESC);
    CREATE INDEX IF NOT EXISTS idx_yt_hist_video ON yt_watch_history(user_id, video_id);

    CREATE TABLE IF NOT EXISTS yt_preferences (
        user_id INTEGER NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('tag', 'channel', 'category')),
        value TEXT NOT NULL,
        weight INTEGER NOT NULL DEFAULT 1,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, kind, value),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_yt_prefs_user ON yt_preferences(user_id, kind, weight DESC);

    CREATE TABLE IF NOT EXISTS yt_liked (
        user_id INTEGER NOT NULL,
        video_id TEXT NOT NULL,
        title TEXT,
        author TEXT,
        thumbnail TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (user_id, video_id),
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_yt_liked_user ON yt_liked(user_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS user_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        ip TEXT,
        fingerprint TEXT,
        user_agent TEXT,
        event TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_user_logs_user ON user_logs(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_logs_ip ON user_logs(ip);
    CREATE INDEX IF NOT EXISTS idx_user_logs_fp ON user_logs(fingerprint);
    CREATE INDEX IF NOT EXISTS idx_user_logs_event ON user_logs(event);
`);

ensureColumns("api_keys", { key_enc: "TEXT" });

// ── Lightweight migrations ──────────────────────────────────────────────────
// Add columns introduced after the tables already existed in a user's DB.
function ensureColumns(table, cols) {
    let existing;
    try { existing = new Set(db.prepare(`PRAGMA table_info(${table})`).all().map(r => r.name)); }
    catch { return; }
    for (const [name, def] of Object.entries(cols)) {
        if (!existing.has(name)) {
            try { db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`); } catch {}
        }
    }
}
ensureColumns("users", { avatar: "TEXT", bio: "TEXT", pronouns: "TEXT", banner: "TEXT", background: "TEXT" });
// AI credits for the agentic code IDE, stored in micro-dollars (1 = $0.000001).
// NULL means "never granted" so the first read can seed the welcome balance.
ensureColumns("users", { ai_credits_micro: "INTEGER", ai_credits_granted_at: "INTEGER" });
// Chat roles & presence. chat_perm = moderation level (owner/admin/mod/member);
// chat_role = a custom display label; role_color = hex for the name.
ensureColumns("users", { chat_perm: "TEXT", chat_role: "TEXT", role_color: "TEXT" });
// Gem economy: balance + daily/beg claim timestamps.
ensureColumns("users", { gems: "INTEGER DEFAULT 250", daily_claimed_at: "INTEGER", beg_claimed_at: "INTEGER" });
// Set at signup when the connection is a VPN, proxy, or Tor exit. Stays on the account.
ensureColumns("users", { signup_limited: "INTEGER NOT NULL DEFAULT 0" });

// Expand bans.target_kind to allow 'device' (fingerprint) bans on DBs created
// before that kind existed. SQLite can't ALTER a CHECK, so rebuild the table once.
// (bans has no foreign keys in or out, so a plain rebuild is safe.)
try {
    const row = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='bans'").get();
    if (row && row.sql && !/device/.test(row.sql)) {
        db.transaction(() => {
            db.exec(`
                CREATE TABLE bans_new (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    target_kind TEXT NOT NULL CHECK (target_kind IN ('user', 'ip', 'device')),
                    target TEXT NOT NULL,
                    reason TEXT,
                    banned_at INTEGER NOT NULL,
                    expires_at INTEGER,
                    banned_by TEXT,
                    UNIQUE (target_kind, target)
                );
                INSERT INTO bans_new (id, target_kind, target, reason, banned_at, expires_at, banned_by)
                    SELECT id, target_kind, target, reason, banned_at, expires_at, banned_by FROM bans;
                DROP TABLE bans;
                ALTER TABLE bans_new RENAME TO bans;
                CREATE INDEX IF NOT EXISTS idx_bans_expires ON bans(expires_at);
                CREATE INDEX IF NOT EXISTS idx_bans_target ON bans(target);
            `);
        })();
        console.log("[db] migrated bans table to allow device (fingerprint) bans");
    }
} catch (e) { console.warn("[db] bans device migration failed:", e.message); }
// Persistent AI usage: tokens + estimated cost (micro-$) per user per UTC day.
db.exec(`CREATE TABLE IF NOT EXISTS ai_usage (
    user_id INTEGER NOT NULL,
    day INTEGER NOT NULL,
    tokens INTEGER NOT NULL DEFAULT 0,
    cost_micro INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (user_id, day)
)`);
ensureColumns("chat_messages", {
    reply_to: "INTEGER",
    edited_at: "INTEGER",
    deleted: "INTEGER NOT NULL DEFAULT 0",
    fwd_user: "TEXT",
    fwd_room: "TEXT"
});
// Owner moderation: a per-user chat mute that expires (distinct from the hard `bans`).
db.exec(`CREATE TABLE IF NOT EXISTS chat_timeouts (
    user_id INTEGER PRIMARY KEY,
    until INTEGER NOT NULL,
    reason TEXT,
    by TEXT,
    created_at INTEGER NOT NULL
)`);
// Giveaways + their entries.
db.exec(`CREATE TABLE IF NOT EXISTS giveaways (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    prize TEXT NOT NULL,
    host TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    ends_at INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'open',
    winner_id INTEGER,
    winner_name TEXT
)`);
db.exec(`CREATE TABLE IF NOT EXISTS giveaway_entries (
    giveaway_id INTEGER NOT NULL,
    user_id INTEGER NOT NULL,
    username TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (giveaway_id, user_id)
)`);

db.exec(`
    CREATE TABLE IF NOT EXISTS gem_transactions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        username TEXT NOT NULL,
        amount INTEGER NOT NULL,
        balance_after INTEGER NOT NULL,
        type TEXT NOT NULL,
        detail TEXT,
        other_user_id INTEGER,
        created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gem_tx_user ON gem_transactions(user_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_gem_tx_created ON gem_transactions(created_at);
`);

// Per-user sequential project number (project 1, 2, 3... for that account), used
// to build shareable /s/<username>/<n> links. Backfill runs once: existing rows
// predate the column, so they're all NULL the first time it's added.
ensureColumns("projects", { user_seq: "INTEGER" });
{
    const missing = db.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_seq IS NULL").get().n;
    if (missing > 0) {
        const users = db.prepare("SELECT DISTINCT user_id FROM projects WHERE user_seq IS NULL").all();
        const rowsFor = db.prepare("SELECT id FROM projects WHERE user_id = ? ORDER BY created_at ASC, id ASC");
        const setSeq = db.prepare("UPDATE projects SET user_seq = ? WHERE id = ?");
        const backfill = db.transaction(() => {
            for (const { user_id } of users) {
                let n = 0;
                for (const row of rowsFor.all(user_id)) setSeq.run(++n, row.id);
            }
        });
        backfill();
    }
}
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_user_seq ON projects(user_id, user_seq)`);

export const MAX_USERS = 15000;
export const MAX_BYTES_PER_USER = 50 * 1024 * 1024;
export const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const stmts = {
    countUsers: db.prepare("SELECT COUNT(*) AS n FROM users"),
    findUserByName: db.prepare("SELECT * FROM users WHERE username = ?"),
    findUserById: db.prepare("SELECT id, username, created_at, storage_bytes FROM users WHERE id = ?"),
    insertUser: db.prepare("INSERT INTO users (username, password_hash, created_at) VALUES (?, ?, ?)"),
    setSignupLimited: db.prepare("UPDATE users SET signup_limited = 1 WHERE id = ?"),
    signupLimited: db.prepare("SELECT signup_limited AS n FROM users WHERE id = ?"),
    updateStorageBytes: db.prepare("UPDATE users SET storage_bytes = storage_bytes + ? WHERE id = ?"),
    setStorageBytes: db.prepare("UPDATE users SET storage_bytes = ? WHERE id = ?"),
    deleteUser: db.prepare("DELETE FROM users WHERE id = ?"),
    changePassword: db.prepare("UPDATE users SET password_hash = ? WHERE id = ?"),

    // AI credits (agentic code IDE). Micro-dollars; NULL = not yet granted.
    aiCreditsGet: db.prepare("SELECT ai_credits_micro AS micro, ai_credits_granted_at AS grantedAt FROM users WHERE id = ?"),
    aiCreditsGrant: db.prepare("UPDATE users SET ai_credits_micro = ?, ai_credits_granted_at = ? WHERE id = ? AND ai_credits_micro IS NULL"),
    aiCreditsDebit: db.prepare("UPDATE users SET ai_credits_micro = MAX(0, COALESCE(ai_credits_micro, 0) - ?) WHERE id = ?"),
    aiCreditsAdd: db.prepare("UPDATE users SET ai_credits_micro = COALESCE(ai_credits_micro, 0) + ? WHERE id = ?"),
    aiCreditsSet: db.prepare("UPDATE users SET ai_credits_micro = ? WHERE id = ?"),
    aiCreditsRefresh: db.prepare("UPDATE users SET ai_credits_micro = ?, ai_credits_granted_at = ? WHERE id = ?"),

    // Persistent AI usage tracking (tokens + estimated cost per user per day).
    aiUsageAdd: db.prepare("INSERT INTO ai_usage (user_id, day, tokens, cost_micro) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, day) DO UPDATE SET tokens = tokens + excluded.tokens, cost_micro = cost_micro + excluded.cost_micro"),
    aiUsageUser: db.prepare("SELECT COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(cost_micro),0) AS cost FROM ai_usage WHERE user_id = ? AND day >= ?"),
    aiUsageUserAll: db.prepare("SELECT COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(cost_micro),0) AS cost FROM ai_usage WHERE user_id = ?"),
    aiUsagePlatform: db.prepare("SELECT COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(cost_micro),0) AS cost FROM ai_usage WHERE day >= ?"),
    aiUsagePlatformAll: db.prepare("SELECT COALESCE(SUM(tokens),0) AS tokens, COALESCE(SUM(cost_micro),0) AS cost FROM ai_usage"),

    // Admin: user directory (includes credits), bans, impersonation lookups.
    adminUserList: db.prepare("SELECT id, username, created_at, storage_bytes, ai_credits_micro FROM users ORDER BY id DESC LIMIT ? OFFSET ?"),
    adminUserSearch: db.prepare("SELECT id, username, created_at, storage_bytes, ai_credits_micro FROM users WHERE username LIKE ? ESCAPE '\\' ORDER BY id DESC LIMIT ? OFFSET ?"),
    banUpsert: db.prepare("INSERT INTO bans (target_kind, target, reason, banned_at, expires_at, banned_by) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(target_kind, target) DO UPDATE SET reason=excluded.reason, banned_at=excluded.banned_at, expires_at=excluded.expires_at, banned_by=excluded.banned_by"),
    banDelete: db.prepare("DELETE FROM bans WHERE target_kind = ? AND target = ?"),
    banDeleteById: db.prepare("DELETE FROM bans WHERE id = ?"),
    banList: db.prepare("SELECT id, target_kind, target, reason, banned_at, expires_at, banned_by FROM bans ORDER BY banned_at DESC LIMIT ? OFFSET ?"),
    banCheck: db.prepare("SELECT id, reason, expires_at FROM bans WHERE target_kind = ? AND target = ? AND (expires_at IS NULL OR expires_at > ?)"),

    // Admin dashboard stats + chat moderation review.
    adminCountMessages: db.prepare("SELECT COUNT(*) AS n FROM chat_messages"),
    adminCountFlags: db.prepare("SELECT COUNT(*) AS n FROM chat_flags"),
    adminCountBans: db.prepare("SELECT COUNT(*) AS n FROM bans WHERE expires_at IS NULL OR expires_at > ?"),
    adminCountSupportOpen: db.prepare("SELECT COUNT(*) AS n FROM support_messages WHERE resolved = 0"),
    adminCountOnline: db.prepare("SELECT COUNT(DISTINCT user_id) AS n FROM sessions WHERE last_seen > ?"),
    adminFlagList: db.prepare("SELECT id, room, user_id, username, ip, text, risk_score, risk_category, reason, created_at FROM chat_flags ORDER BY id DESC LIMIT ? OFFSET ?"),
    adminFlagDelete: db.prepare("DELETE FROM chat_flags WHERE id = ?"),

    // User IP/fingerprint logging
    userLogInsert: db.prepare("INSERT INTO user_logs (user_id, username, ip, fingerprint, user_agent, event, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    userLogsByUser: db.prepare("SELECT id, ip, fingerprint, user_agent, event, created_at FROM user_logs WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"),
    userLogsByIp: db.prepare("SELECT DISTINCT user_id, username FROM user_logs WHERE ip = ?"),
    userLogsByFp: db.prepare("SELECT DISTINCT user_id, username FROM user_logs WHERE fingerprint = ?"),
    userLogSearch: db.prepare("SELECT ul.id, ul.user_id, ul.username, ul.ip, ul.fingerprint, ul.user_agent, ul.event, ul.created_at FROM user_logs ul WHERE ul.username LIKE ? ESCAPE '\\' OR ul.ip LIKE ? ESCAPE '\\' OR ul.fingerprint LIKE ? ESCAPE '\\' ORDER BY ul.created_at DESC LIMIT ? OFFSET ?"),
    userLogLatest: db.prepare("SELECT ul.id, ul.user_id, ul.username, ul.ip, ul.fingerprint, ul.event, ul.created_at FROM user_logs ul ORDER BY ul.created_at DESC LIMIT ? OFFSET ?"),

    insertSession: db.prepare("INSERT INTO sessions (token, user_id, created_at, expires_at, last_seen, ip) VALUES (?, ?, ?, ?, ?, ?)"),
    findSession: db.prepare(`
        SELECT s.token, s.user_id, s.expires_at, u.username
        FROM sessions s
        JOIN users u ON u.id = s.user_id
        WHERE s.token = ? AND s.expires_at > ?
    `),
    touchSession: db.prepare("UPDATE sessions SET last_seen = ?, expires_at = ? WHERE token = ?"),
    deleteSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
    deleteUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),
    pruneExpired: db.prepare("DELETE FROM sessions WHERE expires_at <= ?"),

    cookieList: db.prepare("SELECT name, value, path, expires, secure, http_only, same_site, updated_at, size_bytes FROM cookies WHERE user_id = ? AND domain = ? ORDER BY name"),
    cookieAll: db.prepare("SELECT domain, name, value, path, expires, secure, http_only, same_site, updated_at, size_bytes FROM cookies WHERE user_id = ? ORDER BY domain, name"),
    cookieGet: db.prepare("SELECT * FROM cookies WHERE user_id = ? AND domain = ? AND name = ? AND path = ?"),
    cookieDelete: db.prepare("DELETE FROM cookies WHERE user_id = ? AND domain = ? AND name = ? AND path = ?"),
    cookieDeleteAll: db.prepare("DELETE FROM cookies WHERE user_id = ?"),
    cookieDeleteDomain: db.prepare("DELETE FROM cookies WHERE user_id = ? AND domain = ?"),
    cookieUpsert: db.prepare(`
        INSERT INTO cookies (user_id, domain, name, value, path, expires, secure, http_only, same_site, updated_at, size_bytes)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, domain, name, path) DO UPDATE SET
            value = excluded.value,
            expires = excluded.expires,
            secure = excluded.secure,
            http_only = excluded.http_only,
            same_site = excluded.same_site,
            updated_at = excluded.updated_at,
            size_bytes = excluded.size_bytes
    `),
    cookieSizeSum: db.prepare("SELECT COALESCE(SUM(size_bytes), 0) AS total FROM cookies WHERE user_id = ?"),
    cookieOldestForEvict: db.prepare("SELECT id, size_bytes FROM cookies WHERE user_id = ? ORDER BY updated_at ASC LIMIT ?"),
    cookieDeleteById: db.prepare("DELETE FROM cookies WHERE id = ?"),

    listAllUsers: db.prepare("SELECT id, username, created_at, storage_bytes FROM users ORDER BY id ASC LIMIT ? OFFSET ?"),

    supportInsert: db.prepare("INSERT INTO support_messages (user_id, username, ip, subject, body, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
    supportList: db.prepare("SELECT id, user_id, username, ip, subject, body, created_at, resolved FROM support_messages ORDER BY resolved ASC, created_at DESC LIMIT ? OFFSET ?"),
    supportResolve: db.prepare("UPDATE support_messages SET resolved = 1 WHERE id = ?"),
    supportUnresolve: db.prepare("UPDATE support_messages SET resolved = 0 WHERE id = ?"),
    supportDelete: db.prepare("DELETE FROM support_messages WHERE id = ?"),
    supportRecentByUser: db.prepare("SELECT COUNT(*) AS n FROM support_messages WHERE (user_id = ? OR ip = ?) AND created_at > ?"),

    aiHistoryGet: db.prepare("SELECT messages, model, updated_at FROM ai_history WHERE user_id = ?"),
    aiHistorySet: db.prepare(`
        INSERT INTO ai_history (user_id, messages, model, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            messages = excluded.messages,
            model = excluded.model,
            updated_at = excluded.updated_at
    `),
    aiHistoryDelete: db.prepare("DELETE FROM ai_history WHERE user_id = ?"),

    aiChatList: db.prepare("SELECT id, title, model, created_at, updated_at FROM ai_chats WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?"),
    aiChatGet: db.prepare("SELECT id, title, messages, model, created_at, updated_at FROM ai_chats WHERE id = ? AND user_id = ?"),
    aiChatInsert: db.prepare("INSERT INTO ai_chats (user_id, title, messages, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)"),
    aiChatUpdate: db.prepare("UPDATE ai_chats SET messages = ?, model = ?, title = COALESCE(NULLIF(?, ''), title), updated_at = ? WHERE id = ? AND user_id = ?"),
    aiChatSetTitle: db.prepare("UPDATE ai_chats SET title = ? WHERE id = ? AND user_id = ?"),
    aiChatDelete: db.prepare("DELETE FROM ai_chats WHERE id = ? AND user_id = ?"),
    aiChatDeleteAll: db.prepare("DELETE FROM ai_chats WHERE user_id = ?"),
    aiChatCount: db.prepare("SELECT COUNT(*) AS n FROM ai_chats WHERE user_id = ?"),

    codeInsert: db.prepare("INSERT INTO code_snippets (id, content, language, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"),
    codeGet: db.prepare("SELECT id, content, language, created_at, expires_at FROM code_snippets WHERE id = ? AND expires_at > ?"),
    codePruneExpired: db.prepare("DELETE FROM code_snippets WHERE expires_at <= ?"),

    chatInsert: db.prepare("INSERT INTO chat_messages (room, user_id, username, text, risk_score, risk_category, reply_to, fwd_user, fwd_room, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    chatRecent: db.prepare(`SELECT m.id, m.room, m.user_id, m.username, m.text, m.created_at, m.reply_to, m.edited_at, m.deleted, m.fwd_user, m.fwd_room, u.avatar, u.chat_perm, u.chat_role, u.role_color
        FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.room = ? ORDER BY m.id DESC LIMIT ?`),
    chatAfter: db.prepare(`SELECT m.id, m.room, m.user_id, m.username, m.text, m.created_at, m.reply_to, m.edited_at, m.deleted, m.fwd_user, m.fwd_room, u.avatar, u.chat_perm, u.chat_role, u.role_color
        FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.room = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`),
    chatGetById: db.prepare(`SELECT m.id, m.room, m.user_id, m.username, m.text, m.created_at, m.reply_to, m.edited_at, m.deleted, m.fwd_user, m.fwd_room, u.avatar, u.chat_perm, u.chat_role, u.role_color
        FROM chat_messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.id = ?`),
    setChatRole: db.prepare("UPDATE users SET chat_perm = ?, chat_role = ?, role_color = ? WHERE id = ?"),
    getChatRole: db.prepare("SELECT id, username, chat_perm, chat_role, role_color FROM users WHERE id = ?"),
    chatEdit: db.prepare("UPDATE chat_messages SET text = ?, risk_score = ?, risk_category = ?, edited_at = ? WHERE id = ? AND user_id = ? AND deleted = 0"),
    chatSoftDelete: db.prepare("UPDATE chat_messages SET deleted = 1, text = '' WHERE id = ? AND user_id = ?"),
    chatSoftDeleteAny: db.prepare("UPDATE chat_messages SET deleted = 1, text = '' WHERE id = ?"),
    chatPruneOld: db.prepare("DELETE FROM chat_messages WHERE created_at < ?"),
    chatFlagInsert: db.prepare("INSERT INTO chat_flags (room, user_id, username, ip, text, risk_score, risk_category, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),

    timeoutSet: db.prepare("INSERT OR REPLACE INTO chat_timeouts (user_id, until, reason, by, created_at) VALUES (?, ?, ?, ?, ?)"),
    timeoutGet: db.prepare("SELECT user_id, until, reason, by FROM chat_timeouts WHERE user_id = ?"),
    timeoutClear: db.prepare("DELETE FROM chat_timeouts WHERE user_id = ?"),
    timeoutSweep: db.prepare("DELETE FROM chat_timeouts WHERE until <= ?"),
    chatRecentIds: db.prepare("SELECT id FROM chat_messages WHERE room = ? ORDER BY id DESC LIMIT ?"),
    chatPurgeRoom: db.prepare("DELETE FROM chat_messages WHERE room = ?"),
    chatHardDeleteId: db.prepare("DELETE FROM chat_messages WHERE id = ?"),
    gwInsert: db.prepare("INSERT INTO giveaways (room, prize, host, created_at, ends_at, status) VALUES (?, ?, ?, ?, ?, 'open')"),
    gwGet: db.prepare("SELECT * FROM giveaways WHERE id = ?"),
    gwActiveByRoom: db.prepare("SELECT * FROM giveaways WHERE room = ? AND status = 'open' ORDER BY id DESC"),
    gwDue: db.prepare("SELECT * FROM giveaways WHERE status = 'open' AND ends_at <= ?"),
    gwClose: db.prepare("UPDATE giveaways SET status = 'ended', winner_id = ?, winner_name = ? WHERE id = ?"),
    gwEntryInsert: db.prepare("INSERT OR IGNORE INTO giveaway_entries (giveaway_id, user_id, username, created_at) VALUES (?, ?, ?, ?)"),
    gwEntries: db.prepare("SELECT user_id, username FROM giveaway_entries WHERE giveaway_id = ?"),
    gwEntryCount: db.prepare("SELECT COUNT(*) AS n FROM giveaway_entries WHERE giveaway_id = ?"),

    chatReactInsert: db.prepare("INSERT OR IGNORE INTO chat_reactions (message_id, user_id, emoji, created_at) VALUES (?, ?, ?, ?)"),
    chatReactDelete: db.prepare("DELETE FROM chat_reactions WHERE message_id = ? AND user_id = ? AND emoji = ?"),
    chatReactList: db.prepare("SELECT emoji, user_id FROM chat_reactions WHERE message_id = ?"),

    profileGetAvatar: db.prepare("SELECT avatar FROM users WHERE id = ?"),
    profileSetAvatar: db.prepare("UPDATE users SET avatar = ? WHERE id = ?"),
    profileGetFull: db.prepare("SELECT id, username, avatar, bio, pronouns, banner, background, created_at FROM users WHERE id = ?"),
    profileSetAll: db.prepare("UPDATE users SET avatar = ?, bio = ?, pronouns = ?, banner = ?, background = ? WHERE id = ?"),

    dmSettingsGet: db.prepare("SELECT convo_key, filter_off, pending_by, updated_at FROM dm_settings WHERE convo_key = ?"),
    dmSettingsUpsert: db.prepare(`INSERT INTO dm_settings (convo_key, filter_off, pending_by, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(convo_key) DO UPDATE SET filter_off = excluded.filter_off, pending_by = excluded.pending_by, updated_at = excluded.updated_at`),

    gifFavList: db.prepare("SELECT gif_id, url, preview, title FROM gif_favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"),
    gifFavAdd: db.prepare(`INSERT INTO gif_favorites (user_id, gif_id, url, preview, title, created_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, gif_id) DO UPDATE SET url = excluded.url, preview = excluded.preview, title = excluded.title`),
    gifFavDelete: db.prepare("DELETE FROM gif_favorites WHERE user_id = ? AND gif_id = ?"),
    gifFavCount: db.prepare("SELECT COUNT(*) AS n FROM gif_favorites WHERE user_id = ?"),

    userByNameLite: db.prepare("SELECT id, username, avatar FROM users WHERE username = ?"),
    userByIdLite: db.prepare("SELECT id, username, avatar FROM users WHERE id = ?"),
    userSearch: db.prepare(`SELECT id, username, avatar FROM users WHERE username LIKE ? AND id != ?
        ORDER BY CASE WHEN username LIKE ? THEN 0 ELSE 1 END, length(username), username COLLATE NOCASE LIMIT ?`),

    dmInsert: db.prepare("INSERT INTO dm_messages (convo_key, sender_id, recipient_id, username, text, reply_to, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    dmGetById: db.prepare(`SELECT m.id, m.convo_key, m.sender_id, m.recipient_id, m.username, m.text, m.reply_to, m.edited_at, m.deleted, m.created_at, u.avatar
        FROM dm_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.id = ?`),
    dmRecent: db.prepare(`SELECT m.id, m.convo_key, m.sender_id, m.recipient_id, m.username, m.text, m.reply_to, m.edited_at, m.deleted, m.created_at, u.avatar
        FROM dm_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.convo_key = ? ORDER BY m.id DESC LIMIT ?`),
    dmAfter: db.prepare(`SELECT m.id, m.convo_key, m.sender_id, m.recipient_id, m.username, m.text, m.reply_to, m.edited_at, m.deleted, m.created_at, u.avatar
        FROM dm_messages m LEFT JOIN users u ON u.id = m.sender_id WHERE m.convo_key = ? AND m.id > ? ORDER BY m.id ASC LIMIT ?`),
    dmEdit: db.prepare("UPDATE dm_messages SET text = ?, edited_at = ? WHERE id = ? AND sender_id = ? AND deleted = 0"),
    dmDelete: db.prepare("UPDATE dm_messages SET deleted = 1, text = '' WHERE id = ? AND sender_id = ?"),
    dmPruneOld: db.prepare("DELETE FROM dm_messages WHERE created_at < ?"),

    dmThreadUpsert: db.prepare(`INSERT INTO dm_threads (user_id, other_id, other_username, last_text, last_ts, unread)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, other_id) DO UPDATE SET
            other_username = excluded.other_username,
            last_text = excluded.last_text,
            last_ts = excluded.last_ts,
            unread = dm_threads.unread + excluded.unread`),
    dmThreadList: db.prepare(`SELECT t.other_id, t.other_username, t.last_text, t.last_ts, t.unread, u.avatar
        FROM dm_threads t LEFT JOIN users u ON u.id = t.other_id WHERE t.user_id = ? ORDER BY t.last_ts DESC LIMIT ?`),
    dmThreadGet: db.prepare("SELECT other_id, other_username, last_text, last_ts, unread FROM dm_threads WHERE user_id = ? AND other_id = ?"),
    dmThreadMarkRead: db.prepare("UPDATE dm_threads SET unread = 0 WHERE user_id = ? AND other_id = ?"),
    dmUnreadTotal: db.prepare("SELECT COALESCE(SUM(unread), 0) AS n FROM dm_threads WHERE user_id = ?"),

    musicHistoryAdd: db.prepare("INSERT INTO music_history (user_id, track_id, title, artist, genre, artwork, duration, played_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    musicHistoryRecent: db.prepare("SELECT track_id, title, artist, genre, artwork, duration, MAX(played_at) AS played_at FROM music_history WHERE user_id = ? GROUP BY track_id ORDER BY played_at DESC LIMIT ?"),
    musicHistoryClear: db.prepare("DELETE FROM music_history WHERE user_id = ?"),
    musicTopGenres: db.prepare("SELECT genre, COUNT(*) AS n FROM music_history WHERE user_id = ? AND genre IS NOT NULL AND genre != '' AND played_at > ? GROUP BY genre ORDER BY n DESC LIMIT ?"),
    musicHistoryPrune: db.prepare("DELETE FROM music_history WHERE user_id = ? AND id NOT IN (SELECT id FROM music_history WHERE user_id = ? ORDER BY played_at DESC LIMIT ?)"),
    musicFavAdd: db.prepare(`INSERT INTO music_favorites (user_id, track_id, title, artist, genre, artwork, duration, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(user_id, track_id) DO UPDATE SET title = excluded.title, artist = excluded.artist, genre = excluded.genre, artwork = excluded.artwork, duration = excluded.duration`),
    musicFavList: db.prepare("SELECT track_id, title, artist, genre, artwork, duration FROM music_favorites WHERE user_id = ? ORDER BY created_at DESC LIMIT ?"),
    musicFavIds: db.prepare("SELECT track_id FROM music_favorites WHERE user_id = ?"),
    musicFavDelete: db.prepare("DELETE FROM music_favorites WHERE user_id = ? AND track_id = ?"),

    // Saved code-IDE projects (multi-file workspaces stored per account).
    projectList: db.prepare("SELECT id, name, bytes, user_seq, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC LIMIT ?"),
    projectGet: db.prepare("SELECT id, name, data, bytes, user_seq, created_at, updated_at FROM projects WHERE id = ? AND user_id = ?"),
    projectInsert: db.prepare("INSERT INTO projects (user_id, name, data, bytes, user_seq, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    projectUpdate: db.prepare("UPDATE projects SET name = COALESCE(NULLIF(?, ''), name), data = ?, bytes = ?, updated_at = ? WHERE id = ? AND user_id = ?"),
    projectRename: db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?"),
    projectDelete: db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?"),
    projectCount: db.prepare("SELECT COUNT(*) AS n FROM projects WHERE user_id = ?"),
    projectBytes: db.prepare("SELECT COALESCE(SUM(bytes),0) AS total FROM projects WHERE user_id = ?"),
    projectNextSeq: db.prepare("SELECT COALESCE(MAX(user_seq),0)+1 AS n FROM projects WHERE user_id = ?"),
    projectGetByUserSeq: db.prepare(`
        SELECT p.id, p.name, p.data, p.bytes, p.user_seq, p.created_at, p.updated_at, u.username
        FROM projects p JOIN users u ON u.id = p.user_id
        WHERE u.username = ? AND p.user_seq = ?
    `),

    // Developer API keys (for the public /api/ai endpoint). key_hash (SHA-256) is
    // used for fast auth lookups; key_enc is an AES-256-GCM blob (see groq.js
    // encryptApiKey/decryptApiKey) that lets an owner re-reveal their own key later.
    apiKeyInsert: db.prepare("INSERT INTO api_keys (user_id, key_hash, key_enc, label, created_at) VALUES (?, ?, ?, ?, ?)"),
    apiKeyByHash: db.prepare("SELECT id, user_id, label FROM api_keys WHERE key_hash = ?"),
    apiKeyList: db.prepare("SELECT id, label, created_at, last_used FROM api_keys WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"),
    apiKeyGetEnc: db.prepare("SELECT key_enc FROM api_keys WHERE id = ? AND user_id = ?"),
    apiKeyDelete: db.prepare("DELETE FROM api_keys WHERE id = ? AND user_id = ?"),
    apiKeyTouch: db.prepare("UPDATE api_keys SET last_used = ? WHERE id = ?"),
    apiKeyCount: db.prepare("SELECT COUNT(*) AS n FROM api_keys WHERE user_id = ?"),

    // Per-request API logs (Logs pane + per-model hover stats).
    aiLogInsert: db.prepare("INSERT INTO ai_request_logs (user_id, model, ok, status_code, latency_ms, input_tokens, output_tokens, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"),
    aiLogRecent: db.prepare("SELECT id, model, ok, status_code, latency_ms, input_tokens, output_tokens, error, created_at FROM ai_request_logs WHERE user_id = ? ORDER BY id DESC LIMIT ?"),
    aiLogTodayStats: db.prepare("SELECT COUNT(*) AS requests, COALESCE(SUM(input_tokens + output_tokens),0) AS tokens, COALESCE(AVG(latency_ms),0) AS avgLatency FROM ai_request_logs WHERE user_id = ? AND created_at >= ?"),
    aiLogByModel: db.prepare(`SELECT model, COUNT(*) AS requests, COALESCE(SUM(input_tokens + output_tokens),0) AS tokens,
        COALESCE(AVG(latency_ms),0) AS avgLatency, MAX(created_at) AS lastUsed
        FROM ai_request_logs WHERE user_id = ? AND created_at >= ? GROUP BY model ORDER BY tokens DESC`),
    aiLogPrune: db.prepare("DELETE FROM ai_request_logs WHERE created_at < ?"),

    // Navy provider health-check history (Status pane), 90-day retention.
    navyHealthInsert: db.prepare("INSERT INTO navy_health_checks (status, latency_ms, attempts, error, checked_at) VALUES (?, ?, ?, ?, ?)"),
    navyHealthLatest: db.prepare("SELECT status, latency_ms, attempts, error, checked_at FROM navy_health_checks ORDER BY id DESC LIMIT 1"),
    navyHealthRecent: db.prepare("SELECT status, latency_ms, attempts, error, checked_at FROM navy_health_checks ORDER BY id DESC LIMIT ?"),
    navyHealthPrune: db.prepare("DELETE FROM navy_health_checks WHERE checked_at < ?"),
    // One row per UTC day - worst status that day (0=outage,1=degraded,2=operational) + avg latency.
    navyHealthDaily: db.prepare(`SELECT (checked_at / 86400000) AS dayBucket,
        MIN(CASE status WHEN 'outage' THEN 0 WHEN 'degraded' THEN 1 ELSE 2 END) AS worstRank,
        AVG(latency_ms) AS avgLatency, COUNT(*) AS checks
        FROM navy_health_checks WHERE checked_at >= ? GROUP BY dayBucket ORDER BY dayBucket ASC`),

    // AI docs-assistant chatbot: rolling hourly message cap per account.
    assistLimitGet: db.prepare("SELECT count, window_start FROM ai_assist_limits WHERE user_id = ?"),
    assistLimitUpsert: db.prepare(`INSERT INTO ai_assist_limits (user_id, count, window_start) VALUES (?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET count = excluded.count, window_start = excluded.window_start`),

    ytHistoryInsert: db.prepare("INSERT INTO yt_watch_history (user_id, video_id, title, author, thumbnail, duration, watched_at) VALUES (?, ?, ?, ?, ?, ?, ?)"),
    ytHistoryList: db.prepare("SELECT video_id, title, author, thumbnail, duration, watched_at FROM yt_watch_history WHERE user_id = ? ORDER BY watched_at DESC LIMIT ? OFFSET ?"),
    ytHistoryRecent: db.prepare("SELECT DISTINCT video_id, title, author, thumbnail, duration, MAX(watched_at) AS watched_at FROM yt_watch_history WHERE user_id = ? GROUP BY video_id ORDER BY watched_at DESC LIMIT ?"),
    ytHistoryDelete: db.prepare("DELETE FROM yt_watch_history WHERE user_id = ? AND video_id = ?"),
    ytHistoryClear: db.prepare("DELETE FROM yt_watch_history WHERE user_id = ?"),

    ytPrefUpsert: db.prepare(`INSERT INTO yt_preferences (user_id, kind, value, weight, updated_at) VALUES (?, ?, ?, 1, ?)
        ON CONFLICT(user_id, kind, value) DO UPDATE SET weight = weight + 1, updated_at = excluded.updated_at`),
    ytPrefTop: db.prepare("SELECT value, weight FROM yt_preferences WHERE user_id = ? AND kind = ? ORDER BY weight DESC LIMIT ?"),
    ytPrefAll: db.prepare("SELECT kind, value, weight FROM yt_preferences WHERE user_id = ? ORDER BY weight DESC"),
    ytPrefClear: db.prepare("DELETE FROM yt_preferences WHERE user_id = ?"),
    ytPrefPrune: db.prepare("DELETE FROM yt_preferences WHERE user_id = ? AND kind = ? AND value NOT IN (SELECT value FROM yt_preferences WHERE user_id = ? AND kind = ? ORDER BY weight DESC LIMIT ?)"),

    ytLikeInsert: db.prepare("INSERT OR IGNORE INTO yt_liked (user_id, video_id, title, author, thumbnail, created_at) VALUES (?, ?, ?, ?, ?, ?)"),
    ytLikeDelete: db.prepare("DELETE FROM yt_liked WHERE user_id = ? AND video_id = ?"),
    ytLikeList: db.prepare("SELECT video_id, title, author, thumbnail, created_at FROM yt_liked WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?"),
    ytLikeCheck: db.prepare("SELECT 1 FROM yt_liked WHERE user_id = ? AND video_id = ?"),

    // Gem economy
    gemBalance: db.prepare("SELECT COALESCE(gems, 250) AS gems FROM users WHERE id = ?"),
    gemSet: db.prepare("UPDATE users SET gems = ? WHERE id = ?"),
    gemAdd: db.prepare("UPDATE users SET gems = COALESCE(gems, 250) + ? WHERE id = ?"),
    gemDeduct: db.prepare("UPDATE users SET gems = MAX(0, COALESCE(gems, 250) - ?) WHERE id = ?"),
    gemLeaderboard: db.prepare("SELECT id, username, COALESCE(gems, 250) AS gems FROM users ORDER BY gems DESC LIMIT ?"),
    gemTotalCirculating: db.prepare("SELECT COALESCE(SUM(COALESCE(gems, 250)), 0) AS total FROM users"),
    gemDailyClaim: db.prepare("SELECT daily_claimed_at FROM users WHERE id = ?"),
    gemDailySet: db.prepare("UPDATE users SET daily_claimed_at = ? WHERE id = ?"),
    gemBegClaim: db.prepare("SELECT beg_claimed_at FROM users WHERE id = ?"),
    gemBegSet: db.prepare("UPDATE users SET beg_claimed_at = ? WHERE id = ?"),
    gemTxInsert: db.prepare("INSERT INTO gem_transactions (user_id, username, amount, balance_after, type, detail, other_user_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"),
    gemTxRecent: db.prepare("SELECT id, amount, balance_after, type, detail, other_user_id, created_at FROM gem_transactions WHERE user_id = ? ORDER BY id DESC LIMIT ?"),
    gemTxPrune: db.prepare("DELETE FROM gem_transactions WHERE created_at < ?")
};

// Keep the public chat from growing without bound - drop messages older than 30 days.
const CHAT_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Per-request API logs: 30 days is plenty for the Logs pane / per-model stats.
const AI_LOG_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
// Navy health-check history: 90 days, per the Status pane's uptime window.
const NAVY_HEALTH_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;

setInterval(() => {
    try { stmts.pruneExpired.run(Date.now()); } catch {}
    try { stmts.codePruneExpired.run(Date.now()); } catch {}
    try { stmts.chatPruneOld.run(Date.now() - CHAT_RETENTION_MS); } catch {}
    try { stmts.dmPruneOld.run(Date.now() - CHAT_RETENTION_MS); } catch {}
    try { stmts.timeoutSweep.run(Date.now()); } catch {}
    try { stmts.aiLogPrune.run(Date.now() - AI_LOG_RETENTION_MS); } catch {}
    try { stmts.navyHealthPrune.run(Date.now() - NAVY_HEALTH_RETENTION_MS); } catch {}
    try { stmts.gemTxPrune.run(Date.now() - 90 * 24 * 60 * 60 * 1000); } catch {}
}, 60 * 60 * 1000).unref();

stmts.pruneExpired.run(Date.now());
stmts.codePruneExpired.run(Date.now());
try { stmts.chatPruneOld.run(Date.now() - CHAT_RETENTION_MS); } catch {}
try { stmts.dmPruneOld.run(Date.now() - CHAT_RETENTION_MS); } catch {}
