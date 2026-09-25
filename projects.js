// Saved code-IDE projects + GitHub import + ZIP export.
//   • /api/projects        — per-account multi-file workspaces (CRUD)
//   • /api/github/import    — pull a public GitHub repo's text files into the editor
//   • /api/projects/export  — download the current files as a .zip
// All project routes require a signed-in account; GitHub import is rate-limited
// and only ever talks to github.com (the user supplies owner/repo, never a raw
// URL we fetch), so there is no SSRF surface.
import zlib from "node:zlib";
import { stmts } from "./db.js";
import { requireAuth } from "./auth.js";
import { clientIp } from "./ip.js";

// ── Limits ───────────────────────────────────────────────────────────────────
const MAX_PROJECTS      = Number(process.env.NOCTURNE_MAX_PROJECTS) || 60;
const MAX_PROJECT_BYTES = 2 * 1024 * 1024;        // 2 MB of serialized files per project
const MAX_USER_BYTES    = 40 * 1024 * 1024;       // 40 MB total across a user's projects
const MAX_FILES         = 300;
const MAX_NAME_LEN      = 80;                      // project display name
const MAX_PATH_LEN      = 240;                     // a single file path
const MAX_FILE_BYTES    = 512 * 1024;             // a single file's contents

// ── Helpers ──────────────────────────────────────────────────────────────────
function cleanPath(p) {
    let s = String(p || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
    if (!s || s.length > MAX_PATH_LEN) return null;
    if (s.split("/").some(seg => seg === ".." || seg === ".")) return null;
    if (/[\x00-\x1f]/.test(s)) return null;
    return s;
}
// Normalize an arbitrary {files,active} payload into a safe, capped file list.
function sanitizeWorkspace(raw) {
    const files = [];
    const seen = new Set();
    let total = 0;
    const list = Array.isArray(raw?.files) ? raw.files : [];
    for (const f of list) {
        if (!f || typeof f !== "object") continue;
        const name = cleanPath(f.name);
        if (!name || seen.has(name)) continue;
        let content = typeof f.content === "string" ? f.content : String(f.content ?? "");
        if (Buffer.byteLength(content, "utf8") > MAX_FILE_BYTES) {
            content = content.slice(0, MAX_FILE_BYTES);   // hard clip oversized single file
        }
        seen.add(name);
        files.push({ name, content });
        total += Buffer.byteLength(content, "utf8") + name.length;
        if (files.length >= MAX_FILES || total > MAX_PROJECT_BYTES) break;
    }
    let active = cleanPath(raw?.active);
    if (!active || !seen.has(active)) active = files[0]?.name || null;
    return { files, active };
}
function serializeProject(ws) {
    const data = JSON.stringify(ws);
    return { data, bytes: Buffer.byteLength(data, "utf8") };
}
function cleanName(n, fallback = "Untitled project") {
    const s = String(n || "").trim().replace(/[\x00-\x1f]/g, "").slice(0, MAX_NAME_LEN);
    return s || fallback;
}

// ── Per-IP rate limiter (GitHub import + export) ─────────────────────────────
function makeLimiter(limit, windowMs) {
    const buckets = new Map();
    setInterval(() => { const now = Date.now(); for (const [k, b] of buckets) if (now - b.start > windowMs) buckets.delete(k); }, windowMs).unref();
    return function ok(ip) {
        if (!ip) return true;
        const now = Date.now();
        let b = buckets.get(ip);
        if (!b || now - b.start > windowMs) { b = { start: now, count: 0 }; buckets.set(ip, b); }
        if (b.count >= limit) return false;
        b.count++; return true;
    };
}
const importLimit = makeLimiter(Number(process.env.NOCTURNE_GH_IMPORT_RPM) || 10, 60_000);
const exportLimit = makeLimiter(30, 60_000);

// ── GitHub import ────────────────────────────────────────────────────────────
const GH_TOKEN = (process.env.GITHUB_TOKEN || process.env.NOCTURNE_GITHUB_TOKEN || "").trim();
const GB = 1024 * 1024 * 1024;
// Import cap = 10 GB of decoded text (per the owner's request). Note: in practice
// the browser editor, the JSON response (V8 string limit), and the tarball
// download below are the real ceilings — this just removes the artificial limit.
const GH_MAX_TOTAL  = Number(process.env.NOCTURNE_GH_MAX_TOTAL) || 10 * GB;
const GH_MAX_FILE   = Number(process.env.NOCTURNE_GH_MAX_FILE)  || 64 * 1024 * 1024;   // per-file ceiling (64 MB)
const GH_MAX_FILES  = Number(process.env.NOCTURNE_GH_MAX_FILES) || 20000;              // file-count ceiling
// Compressed tarball the server will pull into memory — kept bounded so a huge
// repo can't OOM the box (gunzip/JSON would fail anyway well before 10 GB).
const GH_MAX_TARBALL = Number(process.env.NOCTURNE_GH_MAX_TARBALL) || 1 * GB;
// Folders/files never worth importing into an editor.
const GH_SKIP_DIR = /(^|\/)(\.git|node_modules|\.next|dist|build|vendor|\.venv|__pycache__|\.idea|\.vscode|target)(\/|$)/i;
// Binary / non-text extensions to skip (kept by content sniff too).
const GH_BINARY_EXT = /\.(png|jpe?g|gif|webp|bmp|ico|svg|pdf|zip|gz|tar|tgz|rar|7z|mp[34]|wav|ogg|flac|mov|mp4|avi|webm|woff2?|ttf|otf|eot|wasm|class|jar|exe|dll|so|dylib|bin|dat|psd|sketch|node|lock|map)$/i;

// owner/repo[/tree/ref...] from a slug or any github.com URL → {owner, repo, ref}
function parseRepo(input) {
    let s = String(input || "").trim();
    if (!s) return null;
    s = s.replace(/^git@github\.com:/i, "").replace(/\.git$/i, "");
    let ref = "";
    try {
        if (/^https?:\/\//i.test(s) || /^github\.com\//i.test(s)) {
            const u = new URL(s.startsWith("http") ? s : "https://" + s);
            if (!/(^|\.)github\.com$/i.test(u.hostname)) return null;
            const parts = u.pathname.replace(/^\/+/, "").split("/");
            const owner = parts[0], repo = parts[1];
            if (parts[2] === "tree" && parts[3]) ref = parts.slice(3).join("/");
            return mk(owner, repo, ref);
        }
    } catch { return null; }
    const parts = s.split("/");
    if (parts.length >= 2) {
        // "owner/repo" or "owner/repo/tree/ref"
        if (parts[2] === "tree" && parts[3]) ref = parts.slice(3).join("/");
        return mk(parts[0], parts[1], ref);
    }
    return null;
    function mk(owner, repo, ref) {
        const ok = v => typeof v === "string" && /^[A-Za-z0-9._-]+$/.test(v) && v.length <= 100;
        if (!ok(owner) || !ok(repo)) return null;
        if (ref && !/^[A-Za-z0-9._\-\/]+$/.test(ref)) ref = "";
        return { owner, repo, ref };
    }
}

function looksBinary(buf) {
    const n = Math.min(buf.length, 8000);
    for (let i = 0; i < n; i++) if (buf[i] === 0) return true;   // NUL byte ⇒ binary
    return false;
}

// Parse a (already gunzipped) tar buffer → [{name, data:Buffer}]. Strips the
// single top-level "owner-repo-sha/" directory GitHub wraps everything in.
function untar(buf) {
    const out = [];
    let off = 0;
    while (off + 512 <= buf.length) {
        const header = buf.subarray(off, off + 512);
        // Two consecutive zero blocks mark the end of the archive.
        if (header.every(b => b === 0)) break;
        let name = header.toString("utf8", 0, 100).replace(/\0.*$/, "");
        const prefix = header.toString("utf8", 345, 500).replace(/\0.*$/, "");
        if (prefix) name = prefix + "/" + name;
        const sizeStr = header.toString("ascii", 124, 136).replace(/[\0 ]/g, "");
        const size = parseInt(sizeStr, 8) || 0;
        const type = String.fromCharCode(header[156] || 0);
        const dataStart = off + 512;
        off = dataStart + Math.ceil(size / 512) * 512;
        // Regular file only (type '0' or NUL). Skip dirs, pax/gnu meta, symlinks.
        if ((type === "0" || type === "\0") && size > 0 && name) {
            const slash = name.indexOf("/");
            const rel = slash >= 0 ? name.slice(slash + 1) : name;   // drop top-level dir
            if (rel) out.push({ name: rel, data: buf.subarray(dataStart, dataStart + size) });
        }
    }
    return out;
}

async function importGithubRepo(input) {
    const repo = parseRepo(input);
    if (!repo) throw Object.assign(new Error("Enter a repo as owner/name or a github.com URL."), { status: 400 });
    const url = `https://api.github.com/repos/${repo.owner}/${repo.repo}/tarball/${encodeURIComponent(repo.ref || "")}`;
    const headers = { "User-Agent": "Nocturne-IDE", "Accept": "application/vnd.github+json" };
    if (GH_TOKEN) headers.Authorization = "Bearer " + GH_TOKEN;
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 25_000);
    let resp;
    try { resp = await fetch(url, { headers, redirect: "follow", signal: ac.signal }); }
    catch (e) { throw Object.assign(new Error("Couldn't reach GitHub: " + (e.message || e)), { status: 502 }); }
    finally { clearTimeout(timer); }
    if (resp.status === 404) throw Object.assign(new Error("Repo not found (it must be public)."), { status: 404 });
    if (resp.status === 403) throw Object.assign(new Error("GitHub rate limit hit — try again in a few minutes."), { status: 429 });
    if (!resp.ok) throw Object.assign(new Error("GitHub returned " + resp.status + "."), { status: 502 });

    const gz = Buffer.from(await resp.arrayBuffer());
    if (gz.length > GH_MAX_TARBALL) throw Object.assign(new Error("That repo's download is too large to import safely."), { status: 413 });
    let tar;
    try {
        // Bound the DECOMPRESSED size. Without maxOutputLength a tiny "zip bomb" tarball can
        // inflate to terabytes and OOM the process before any per-file/total cap below runs.
        // Cap at the configured import ceiling (GH_MAX_TOTAL); larger archives are refused.
        tar = zlib.gunzipSync(gz, { maxOutputLength: GH_MAX_TOTAL });
    } catch (e) {
        const tooBig = e && (e.code === "ERR_BUFFER_TOO_LARGE" || /maxOutputLength|too large/i.test(String(e.message || "")));
        throw Object.assign(
            new Error(tooBig ? "That repo is too large to import safely." : "Couldn't unpack the repo archive."),
            { status: tooBig ? 413 : 502 },
        );
    }

    const entries = untar(tar);
    const files = [];
    let total = 0, skipped = 0, truncated = false;
    for (const e of entries) {
        const name = cleanPath(e.name);
        if (!name) { skipped++; continue; }
        if (GH_SKIP_DIR.test(name) || GH_BINARY_EXT.test(name)) { skipped++; continue; }
        if (e.data.length > GH_MAX_FILE || looksBinary(e.data)) { skipped++; continue; }
        if (total + e.data.length > GH_MAX_TOTAL || files.length >= GH_MAX_FILES) { truncated = true; break; }
        files.push({ name, content: e.data.toString("utf8") });
        total += e.data.length;
    }
    if (!files.length) throw Object.assign(new Error("No importable text files were found in that repo."), { status: 422 });
    return { name: repo.repo, owner: repo.owner, repo: repo.repo, ref: repo.ref || "default", files, fileCount: files.length, skipped, truncated };
}

// ── Minimal ZIP writer (store+deflate, no external deps) ─────────────────────
const CRC_TABLE = (() => {
    const t = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
        let c = n;
        for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
        t[n] = c;
    }
    return t;
})();
function crc32(buf) {
    let c = 0 ^ -1;
    for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ CRC_TABLE[(c ^ buf[i]) & 0xff];
    return (c ^ -1) >>> 0;
}
function buildZip(files) {
    const chunks = [];          // local records
    const central = [];         // central directory records
    let offset = 0;
    for (const f of files) {
        const nameBuf = Buffer.from(f.name, "utf8");
        const content = Buffer.from(f.content ?? "", "utf8");
        const crc = crc32(content);
        let method = 8, body = zlib.deflateRawSync(content, { level: 6 });
        if (body.length >= content.length) { method = 0; body = content; }   // store if deflate didn't help
        const flags = 0x0800;   // UTF-8 filename
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(20, 4);          // version needed
        local.writeUInt16LE(flags, 6);
        local.writeUInt16LE(method, 8);
        local.writeUInt16LE(0, 10);          // mod time
        local.writeUInt16LE(0x21, 12);       // mod date (1980-01-01)
        local.writeUInt32LE(crc, 14);
        local.writeUInt32LE(body.length, 18);
        local.writeUInt32LE(content.length, 22);
        local.writeUInt16LE(nameBuf.length, 26);
        local.writeUInt16LE(0, 28);
        chunks.push(local, nameBuf, body);

        const cen = Buffer.alloc(46);
        cen.writeUInt32LE(0x02014b50, 0);
        cen.writeUInt16LE(20, 4);            // version made by
        cen.writeUInt16LE(20, 6);            // version needed
        cen.writeUInt16LE(flags, 8);
        cen.writeUInt16LE(method, 10);
        cen.writeUInt16LE(0, 12);
        cen.writeUInt16LE(0x21, 14);
        cen.writeUInt32LE(crc, 16);
        cen.writeUInt32LE(body.length, 20);
        cen.writeUInt32LE(content.length, 24);
        cen.writeUInt16LE(nameBuf.length, 28);
        cen.writeUInt32LE(offset, 42);
        central.push(cen, nameBuf);

        offset += local.length + nameBuf.length + body.length;
    }
    const centralBuf = Buffer.concat(central);
    const localBuf = Buffer.concat(chunks);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(files.length, 8);
    eocd.writeUInt16LE(files.length, 10);
    eocd.writeUInt32LE(centralBuf.length, 12);
    eocd.writeUInt32LE(localBuf.length, 16);
    return Buffer.concat([localBuf, centralBuf, eocd]);
}
function safeZipName(name) {
    return (String(name || "project").trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "project");
}

// ── Routes ───────────────────────────────────────────────────────────────────
export function mountProjects(app) {
    // List the signed-in user's saved projects.
    app.get("/api/projects", requireAuth, (req, res) => {
        const rows = stmts.projectList.all(req.user.id, MAX_PROJECTS);
        const used = stmts.projectBytes.get(req.user.id)?.total || 0;
        res.json({
            projects: rows.map(r => ({ id: r.id, name: r.name, bytes: r.bytes, updatedAt: r.updated_at, createdAt: r.created_at })),
            count: rows.length, max: MAX_PROJECTS, usedBytes: used, maxBytes: MAX_USER_BYTES
        });
    });

    // Create a new project from the current workspace.
    app.post("/api/projects", requireAuth, (req, res) => {
        const ws = sanitizeWorkspace(req.body?.data || req.body);
        if (!ws.files.length) return res.status(400).json({ error: "Nothing to save — add at least one file." });
        const { data, bytes } = serializeProject(ws);
        if (bytes > MAX_PROJECT_BYTES) return res.status(413).json({ error: "Project is too large (max 2 MB)." });
        const count = stmts.projectCount.get(req.user.id)?.n || 0;
        if (count >= MAX_PROJECTS) return res.status(409).json({ error: `Project limit reached (${MAX_PROJECTS}). Delete one first.` });
        const usedBytes = stmts.projectBytes.get(req.user.id)?.total || 0;
        if (usedBytes + bytes > MAX_USER_BYTES) return res.status(413).json({ error: "You're out of project storage." });
        const now = Date.now();
        const name = cleanName(req.body?.name);
        const seq = stmts.projectNextSeq.get(req.user.id)?.n || 1;
        const info = stmts.projectInsert.run(req.user.id, name, data, bytes, seq, now, now);
        res.json({ ok: true, id: info.lastInsertRowid, name, seq, shareUrl: `/s/${encodeURIComponent(req.user.username)}/${seq}`, updatedAt: now });
    });

    // Full project (files) for opening in the editor.
    app.get("/api/projects/:id", requireAuth, (req, res) => {
        const row = stmts.projectGet.get(Number(req.params.id), req.user.id);
        if (!row) return res.status(404).json({ error: "Project not found." });
        let ws; try { ws = JSON.parse(row.data); } catch { ws = { files: [], active: null }; }
        res.json({ id: row.id, name: row.name, seq: row.user_seq, shareUrl: `/s/${encodeURIComponent(req.user.username)}/${row.user_seq}`, data: ws, updatedAt: row.updated_at, createdAt: row.created_at });
    });

    // Update files and/or rename.
    app.put("/api/projects/:id", requireAuth, (req, res) => {
        const id = Number(req.params.id);
        const existing = stmts.projectGet.get(id, req.user.id);
        if (!existing) return res.status(404).json({ error: "Project not found." });
        const ws = sanitizeWorkspace(req.body?.data || req.body);
        const { data, bytes } = serializeProject(ws);
        if (bytes > MAX_PROJECT_BYTES) return res.status(413).json({ error: "Project is too large (max 2 MB)." });
        const usedBytes = (stmts.projectBytes.get(req.user.id)?.total || 0) - (existing.bytes || 0);
        if (usedBytes + bytes > MAX_USER_BYTES) return res.status(413).json({ error: "You're out of project storage." });
        const now = Date.now();
        stmts.projectUpdate.run(req.body?.name != null ? cleanName(req.body.name, existing.name) : "", data, bytes, now, id, req.user.id);
        res.json({ ok: true, id, seq: existing.user_seq, shareUrl: `/s/${encodeURIComponent(req.user.username)}/${existing.user_seq}`, updatedAt: now });
    });

    // Public, read-only lookup for a shared project link: /s/<username>/<n>.
    // No auth required — this is what the share URL itself resolves to.
    app.get("/api/projects/share/:username/:seq", (req, res) => {
        const username = String(req.params.username || "").trim();
        const seq = Number(req.params.seq);
        if (!username || !Number.isInteger(seq) || seq < 1) return res.status(404).json({ error: "Project not found." });
        const row = stmts.projectGetByUserSeq.get(username, seq);
        if (!row) return res.status(404).json({ error: "Project not found." });
        let ws; try { ws = JSON.parse(row.data); } catch { ws = { files: [], active: null }; }
        res.json({ name: row.name, username: row.username, seq: row.user_seq, data: ws, updatedAt: row.updated_at, createdAt: row.created_at });
    });

    app.delete("/api/projects/:id", requireAuth, (req, res) => {
        stmts.projectDelete.run(Number(req.params.id), req.user.id);
        res.json({ ok: true });
    });

    // Import a public GitHub repo's text files (returned to the client, which
    // loads them into the editor — and the agent can call this as a tool).
    app.post("/api/github/import", requireAuth, async (req, res) => {
        if (!importLimit(clientIp(req))) return res.status(429).json({ error: "Too many imports — wait a minute and try again." });
        try {
            const result = await importGithubRepo(req.body?.repo || req.body?.url || "");
            res.json({ ok: true, ...result });
        } catch (e) {
            res.status(e.status || 500).json({ error: e.message || "Import failed." });
        }
    });

    // Zip the supplied files and stream the archive back as a download.
    app.post("/api/projects/export", (req, res) => {
        if (!exportLimit(clientIp(req))) return res.status(429).json({ error: "Slow down — too many exports." });
        const ws = sanitizeWorkspace(req.body?.data || req.body);
        if (!ws.files.length) return res.status(400).json({ error: "No files to export." });
        let zip;
        try { zip = buildZip(ws.files); } catch (e) { return res.status(500).json({ error: "Could not build the zip." }); }
        const fname = safeZipName(req.body?.name) + ".zip";
        res.setHeader("Content-Type", "application/zip");
        res.setHeader("Content-Disposition", `attachment; filename="${fname}"`);
        res.setHeader("Content-Length", zip.length);
        res.setHeader("Cache-Control", "no-store");
        res.end(zip);
    });
}
