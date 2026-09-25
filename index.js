import dns from "node:dns";
try { dns.setDefaultResultOrder("ipv4first"); } catch {}
import { server as wisp } from "@mercuryworkshop/wisp-js/server";
import express from "express";
import compression from "compression";
import http from "http";
import path from "path";
import fs from "fs";
import crypto from "node:crypto";
import { fileURLToPath } from "url";
import { mountAuth, authMiddleware, userIsLimited } from "./auth.js";
import { clientIp, cfRangesReady, ipSanction } from "./ip.js";
import { sanctionMiddleware, staffFromRequest, mountSanction } from "./sanction.js";
import { mountCaptcha } from "./captcha.js";
import { mountStorage } from "./storage.js";
import { mountGroq } from "./groq.js";
import { mountModeration } from "./moderation.js";
import { mountChat } from "./chat.js";
import { mountVms, vmProxyUpgrade } from "./vms.js";
import { mountRunner, runnerProxyUpgrade, scrubDevOriginAuth } from "./runner.js";
import { mountBoxes, boxesTerminalUpgrade } from "./boxes.js";
import { terminalUpgrade, mountConsole } from "./webssh.js";
import { mountFlix, flixProxyUpgrade } from "./flix.js";
import { mountMusic } from "./music.js";
import { mountAdmin, banMiddleware } from "./admin.js";
import { noteVisitor, onlineCount, holdVisitor } from "./presence.js";
import { startSampler, countProxySession } from "./analytics.js";
import { LIMITED_MESSAGE } from "./network.js";
import { mountApplications } from "./applications.js";
import { mountProjects } from "./projects.js";
import { mountStratus, stratusSignalUpgrade } from "./stratus.js";
import { voiceUpgrade } from "./voice.js";
import { stmts } from "./db.js";
import JavaScriptObfuscator from "javascript-obfuscator";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Production: block the proxy from reaching loopback / private / link-local addresses
// (prevents SSRF to localhost services, the cloud metadata endpoint, and the internal
// network). Set NOCTURNE_ALLOW_LOCAL=1 only for local development.
const NOC_ALLOW_LOCAL = process.env.NOCTURNE_ALLOW_LOCAL === "1";
wisp.options.allow_loopback_ips = NOC_ALLOW_LOCAL;
wisp.options.allow_private_ips = NOC_ALLOW_LOCAL;

const app = express();
const PORT = process.env.PORT || 8080;

app.disable("x-powered-by");
// "trust proxy" = exact number of reverse proxies in front of this app so req.ip resolves to
// the real client (the rightmost X-Forwarded-For entry your own proxy appended), NOT a value
// the client can spoof. Set NOCTURNE_TRUST_PROXY to match the deployment: "1" behind a single
// nginx/CDN, "2" behind CDN+host, "false" if exposed directly with no proxy. Too high = clients
// can forge their IP and dodge rate-limits/bans; too low = everyone shares the proxy's IP.
{
    const _tp = process.env.NOCTURNE_TRUST_PROXY;
    app.set(
        "trust proxy",
        _tp == null || _tp === ""
            ? 1
            : /^\d+$/.test(_tp)
              ? Number(_tp)
              : _tp === "true"
                ? true
                : _tp === "false"
                  ? false
                  : _tp,
    );
}
app.use(compression({
    level: 6,
    threshold: 1024,
    filter: (req, res) => {
        if (req.path.startsWith("/api/ai/")) return false;
        if (req.path.startsWith("/vm/")) return false;   // VM proxy manages its own framing
        if (req.path.startsWith("/api/stratus/")) return false; // NDJSON stream must not be buffered
        const ct = res.getHeader("Content-Type") || "";
        if (typeof ct === "string" && ct.includes("text/event-stream")) return false;
        if (typeof ct === "string" && ct.includes("x-ndjson")) return false;
        return compression.filter(req, res);
    }
}));
// Most JSON bodies are tiny; only the AI routes carry image attachments (up to
// ~5MB each, which base64-inflates to ~6.7MB and can stack a few per request),
// so give just those a higher ceiling while keeping everything else locked down.
const _jsonSmall = express.json({ limit: "4mb" });
const _jsonBig = express.json({ limit: "40mb" });
app.use((req, res, next) => {
    const p = req.path;
    if (p.startsWith("/vm/")) return next();   // leave the body stream intact for the VM proxy
    if (p === "/api/ai" || p === "/api/ai/chat" || p === "/api/ai/history" || p.startsWith("/api/ai/chats") || p === "/api/chat/profile" || p.startsWith("/api/projects")) return _jsonBig(req, res, next);
    return _jsonSmall(req, res, next);
});
app.use((req, res, next) => {
    if (req.path.startsWith("/vm/")) return next();
    return express.urlencoded({ extended: true, limit: "1mb" })(req, res, next);
});

const S3_ORIGINS = [
    "https://d27jvgogyihpmk.cloudfront.net",
    "http://elahomework.s3-website-us-east-2.amazonaws.com",
    "http://elahomework.s3-website.us-east-2.amazonaws.com",
    "https://elahomework.s3.us-east-2.amazonaws.com",
    "http://elahomework.s3.us-east-2.amazonaws.com",
    "http://blooketassets.s3-website-us-east-2.amazonaws.com",
    "http://blooketassets.s3-website.us-east-2.amazonaws.com",
    "https://blooketassets.s3.us-east-2.amazonaws.com",
    "http://blooketassets.s3.us-east-2.amazonaws.com",
    "https://olive-fun.com",
    "wss://olive-fun.com/wisp/",
];

function isAllowedApiOrigin(origin) {
    if (!origin) return false;
    if (S3_ORIGINS.indexOf(origin) !== -1) return true;
    try {
        const host = new URL(origin).hostname;
        if (host === "nocturne.lol" || host === "www.nocturne.lol" || host.endsWith(".cloudfront.net")) return true;
        if (host === "olive-fun.com" || host === "www.olive-fun.com") return true;
        if (host.includes("elahomework") || host.includes("blooketassets")) return true;
    } catch {}
    return false;
}

app.use((req, res, next) => {
    if (req.path.startsWith("/api/") || req.path.startsWith("/cfp/")) {
        const origin = req.headers.origin;
        if (origin && isAllowedApiOrigin(origin)) {
            res.setHeader("Access-Control-Allow-Origin", origin);
            res.setHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
            res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Noc-Session, X-Bare-Url, X-Bare-Headers");
            res.setHeader("Access-Control-Allow-Credentials", "true");
            res.setHeader("Access-Control-Expose-Headers", "X-Bare-Status, X-Bare-Status-Text, X-Bare-Headers");
            res.setHeader("Access-Control-Max-Age", "86400");
            if (req.method === "OPTIONS") return res.sendStatus(204);
        }
    }
    next();
});

app.use(sanctionMiddleware);
mountSanction(app);

app.all("/cfp/", async (req, res) => {
    const targetUrl = req.headers["x-bare-url"];
    if (!targetUrl) return res.status(400).json({ error: "missing x-bare-url" });
    let parsed;
    try { parsed = new URL(targetUrl); } catch { return res.status(400).json({ error: "invalid url" }); }
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1") return res.status(403).json({ error: "blocked" });
    let targetHeaders = {};
    try { if (req.headers["x-bare-headers"]) targetHeaders = JSON.parse(req.headers["x-bare-headers"]); } catch {}
    const ctrl = new AbortController();
    req.on("close", () => ctrl.abort());
    const timer = setTimeout(() => ctrl.abort(), 30000);
    try {
        const upstream = await fetch(targetUrl, {
            method: req.method === "OPTIONS" ? "GET" : req.method,
            headers: targetHeaders,
            body: (req.method !== "GET" && req.method !== "HEAD") ? req : undefined,
            signal: ctrl.signal,
            redirect: "manual",
            duplex: "half",
        });
        clearTimeout(timer);
        const rh = {};
        upstream.headers.forEach((v, k) => { rh[k] = v; });
        res.setHeader("X-Bare-Status", String(upstream.status));
        res.setHeader("X-Bare-Status-Text", upstream.statusText || "");
        res.setHeader("X-Bare-Headers", JSON.stringify(rh));
        res.status(200);
        if (!upstream.body) return res.end();
        const { Readable } = await import("node:stream");
        Readable.fromWeb(upstream.body).pipe(res);
    } catch (e) {
        clearTimeout(timer);
        if (!res.headersSent) res.status(502).json({ error: e.message });
    }
});

app.use((req, res, next) => {
    const ua = req.headers["user-agent"] || "";
    const isFirefox = /firefox/i.test(ua);
    if (!isFirefox && !req.path.startsWith("/api/") && !req.path.startsWith("/cfp/")) {
        res.setHeader("Cross-Origin-Embedder-Policy", "credentialless");
        res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    }

    const p = req.path;
    if (/\/(sx|mx|ex|ax|edu)\//.test(p) || p.endsWith(".wasm")) {
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    } else if (/\.(js|mjs|css|html)$/.test(p) || p === "/" || !p.includes(".")) {
        res.setHeader("Cache-Control", "no-store");
    }
    next();
});

const _EDU_DECOY = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"><title>EduPath Academy — Free Study Guides &amp; Homework Help</title><meta name="description" content="EduPath Academy provides free study guides, practice problems, and homework help for K-12 students. Math, Science, English, and History resources."><meta name="keywords" content="homework help, study guides, math practice, science lessons, free education"><meta property="og:title" content="EduPath Academy"><meta property="og:description" content="Free study guides and homework help for students"><meta property="og:type" content="website"><link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><text y='28' font-size='28'>📚</text></svg>"><style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:system-ui,-apple-system,sans-serif;background:#f8f9fa;color:#1a1a2e}header{background:linear-gradient(135deg,#1a5276,#2e86c1);color:#fff;padding:20px 0;text-align:center}header h1{font-size:1.8rem;font-weight:600}header p{opacity:.85;margin-top:4px;font-size:.95rem}nav{background:#fff;border-bottom:1px solid #e0e0e0;padding:10px 24px;display:flex;gap:16px;flex-wrap:wrap;justify-content:center}nav a{color:#2e86c1;text-decoration:none;font-size:.9rem;padding:6px 12px;border-radius:6px;transition:background .2s}nav a:hover{background:#ebf5fb}.container{max-width:960px;margin:0 auto;padding:24px 16px}.hero{background:#fff;border-radius:12px;padding:32px;text-align:center;margin-bottom:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}.hero h2{color:#1a5276;font-size:1.5rem;margin-bottom:8px}.hero p{color:#555;line-height:1.6}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:24px}.card{background:#fff;border-radius:10px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}.card h3{color:#1a5276;margin-bottom:8px;font-size:1.1rem}.card p{color:#666;font-size:.9rem;line-height:1.5}.card .tag{display:inline-block;background:#ebf5fb;color:#2e86c1;font-size:.75rem;padding:2px 8px;border-radius:4px;margin-top:8px}footer{text-align:center;padding:24px;color:#888;font-size:.8rem;border-top:1px solid #e0e0e0;margin-top:32px}</style></head><body><header><h1>📚 EduPath Academy</h1><p>Free Study Guides &amp; Homework Help for Students</p></header><nav><a href="/">Home</a><a href="/math">Mathematics</a><a href="/science">Science</a><a href="/english">English</a><a href="/history">History</a><a href="/resources">Resources</a></nav><div class="container"><div class="hero"><h2>Welcome to EduPath Academy</h2><p>Access thousands of free study guides, practice problems, and educational resources. Our platform helps K-12 students excel in their studies with comprehensive materials aligned to common core standards.</p></div><div class="grid"><div class="card"><h3>📐 Algebra Fundamentals</h3><p>Master linear equations, quadratic functions, and polynomial expressions with step-by-step solutions and practice worksheets.</p><span class="tag">Grade 8-10</span></div><div class="card"><h3>🔬 Biology: Cell Structure</h3><p>Explore cell organelles, mitosis and meiosis, DNA replication, and protein synthesis with interactive diagrams.</p><span class="tag">Grade 9-12</span></div><div class="card"><h3>📖 Essay Writing Guide</h3><p>Learn the five-paragraph essay structure, thesis development, evidence integration, and proper MLA/APA citation formats.</p><span class="tag">Grade 7-12</span></div><div class="card"><h3>🌍 World History: Ancient Civilizations</h3><p>Study Mesopotamia, Ancient Egypt, Greek democracy, and the Roman Republic with primary source analysis activities.</p><span class="tag">Grade 6-10</span></div><div class="card"><h3>🧮 Geometry &amp; Trigonometry</h3><p>Practice proofs, triangle congruence, circle theorems, and trigonometric identities with worked examples.</p><span class="tag">Grade 9-11</span></div><div class="card"><h3>⚗️ Chemistry: Periodic Table</h3><p>Understand atomic structure, chemical bonding, stoichiometry, and reaction types with virtual lab simulations.</p><span class="tag">Grade 10-12</span></div></div><div class="hero"><h2>Practice Problem of the Day</h2><p><strong>Algebra:</strong> Solve for x: 3(2x - 5) + 4 = 2(x + 3) - 1</p><p style="margin-top:8px;color:#888;font-size:.85rem">Solution available after attempting the problem. Show your work for full credit.</p></div></div><footer><p>&copy; 2024 EduPath Academy. All rights reserved. Educational content for personal use only.</p><p style="margin-top:4px">Contact: support@edupath-academy.org | <a href="/privacy" style="color:#2e86c1">Privacy Policy</a> | <a href="/terms" style="color:#2e86c1">Terms of Use</a></p></footer></body></html>`;

const _BOT_RE = /\b(?:curl|wget|python|aiohttp|scrapy|go-http|httpclient|libwww|okhttp|java\/|node-fetch|axios|got\/|phantomjs|headless|puppeteer|playwright|selenium|bot|crawler|spider|slurp|httrack|archive\.org|semrush|ahref|mj12bot|dotbot|petalbot|bytespider|gptbot|ccbot|chatgpt|claudebot|anthropic|facebookexternalhit|twitterbot|whatsapp|telegrambot|discordbot|linkchecker|w3c_validator|validator|probe|scan|monitor|check|fetch|http_request|ruby|perl\/|php\/|dart|colly|ferret|nutch|heritrix|yandex|baidu|sogou|duckduck|qwant|ecosia|bing|google|yahoo)\b/i;

function _isBot(req) {
    const ua = String(req.headers["user-agent"] || "");
    if (!ua || ua.length < 10) return true;
    if (_BOT_RE.test(ua)) return true;
    if (!req.headers["accept-language"] && !req.headers["sec-fetch-dest"]) return true;
    return false;
}

app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api/")) return next();
    if (req.path === "/ping") return next();
    if (req.path === "/robots.txt") return next();
    if (!_isBot(req)) return next();
    const accept = String(req.headers.accept || "");
    if (accept.includes("text/html") || req.path === "/" || /\.html?$/i.test(req.path)) {
        res.type("text/html").set("Cache-Control", "public, max-age=3600").send(_EDU_DECOY);
        return;
    }
    if (/\.(?:js|mjs|css)$/i.test(req.path)) {
        res.status(404).end();
        return;
    }
    next();
});

app.get("/robots.txt", (req, res) => {
    res.type("text/plain").send("User-agent: *\nAllow: /\nSitemap: https://edupath-academy.org/sitemap.xml\n");
});

app.get("/ping", (req, res) => res.status(204).end());

app.get("/check-domain", (req, res) => {
    const d = String(req.query.domain || "").trim().toLowerCase();
    if (!d || !/^[a-z0-9.\-]+$/.test(d) || d.length > 253) {
        return res.status(400).send("bad domain");
    }
    res.status(200).send("ok");
});

// ---------------------------------------------------------------------------
//  Code runner.  Public Piston (emkc.org) went whitelist-only on 2026-02-15,
//  so "Run" now compiles + executes through Wandbox, which needs no API key.
//  Want to self-host Piston instead (faster, private)? Set PISTON_BASE, e.g.
//    docker run -d --name piston -p 2000:2000 ghcr.io/engineer-man/piston
//    PISTON_BASE=http://localhost:2000/api/v2
//  When PISTON_BASE is set it is tried first, with Wandbox as the fallback.
// ---------------------------------------------------------------------------
const WANDBOX_BASE = process.env.WANDBOX_BASE || "https://wandbox.org/api";
const PISTON_BASE = process.env.PISTON_BASE || "";

// editor language id -> Wandbox compiler. Pinned to stable builds on purpose:
// the "-head" builds are nightly and occasionally fail to boot.
const WANDBOX_LANG = {
    c: "gcc-13.2.0-c",
    cpp: "gcc-13.2.0", "c++": "gcc-13.2.0",
    rust: "rust-1.82.0", rs: "rust-1.82.0",
    go: "go-1.23.2",
    java: "openjdk-jdk-22+36",
    csharp: "mono-6.12.0.199", cs: "mono-6.12.0.199",
    ruby: "ruby-3.4.9", rb: "ruby-3.4.9",
    php: "php-8.3.12",
    swift: "swift-6.0.1",
    lua: "lua-5.4.7",
    sql: "sqlite-3.46.1", sqlite: "sqlite-3.46.1",
    bash: "bash", sh: "bash",
    perl: "perl-5.42.0", pl: "perl-5.42.0",
    r: "r-4.4.1", rscript: "r-4.4.1",
    scala: "scala-3.5.1",
    haskell: "ghc-9.10.1", hs: "ghc-9.10.1",
    crystal: "crystal-1.13.3", cr: "crystal-1.13.3",
    d: "dmd-2.109.1",
    elixir: "elixir-1.17.3", ex: "elixir-1.17.3",
    erlang: "erlang-27.1", erl: "erlang-27.1",
    groovy: "groovy-4.0.23",
    julia: "julia-1.10.5", jl: "julia-1.10.5",
    nim: "nim-2.2.10",
    ocaml: "ocaml-5.2.0", ml: "ocaml-5.2.0",
    pascal: "fpc-3.2.2", pas: "fpc-3.2.2",
    lisp: "clisp-2.49", lsp: "clisp-2.49",
    zig: "zig-head",
    vim: "vim-9.1.0758",
    python: "cpython-3.13.8", py: "cpython-3.13.8",
    typescript: "typescript-5.6.2", ts: "typescript-5.6.2"
};

// editor language id -> Piston language (only consulted when PISTON_BASE is set)
const PISTON_LANG = {
    python: "python", py: "python",
    typescript: "typescript", ts: "typescript",
    rust: "rust", rs: "rust",
    go: "go",
    sql: "sqlite3", sqlite: "sqlite3",
    java: "java",
    c: "c",
    cpp: "c++", "c++": "c++",
    csharp: "csharp.net", cs: "csharp.net",
    ruby: "ruby", rb: "ruby",
    php: "php",
    bash: "bash", sh: "bash",
    lua: "lua",
    swift: "swift",
    kotlin: "kotlin",
    elixir: "elixir", erlang: "erlang",
    perl: "perl", pl: "perl",
    r: "r", rscript: "r",
    haskell: "haskell", hs: "haskell",
    nim: "nim", zig: "zig", d: "d",
    scala: "scala", groovy: "groovy",
    julia: "julia", crystal: "crystal",
    ocaml: "ocaml", pascal: "pascal"
};
const runBuckets = new Map();
function runRateOk(req) {
    const ip = req.ip || req.socket?.remoteAddress || "anon";
    const now = Date.now();
    const b = runBuckets.get(ip);
    if (!b || now - b.start > 60_000) { runBuckets.set(ip, { count: 1, start: now }); return true; }
    if (b.count >= 12) return false;
    b.count += 1;
    return true;
}
setInterval(() => {
    const now = Date.now();
    for (const [k, v] of runBuckets) if (now - v.start > 60_000) runBuckets.delete(k);
}, 60_000).unref();

async function fetchWithTimeout(url, opts, ms) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), ms);
    try { return await fetch(url, { ...opts, signal: ctrl.signal }); }
    finally { clearTimeout(t); }
}

async function runWandbox(lang, code, stdin, files) {
    const compiler = WANDBOX_LANG[lang];
    if (!compiler) return { unsupported: true };
    // Wandbox compiles Java to prog.java, so a `public class Main` trips the
    // "should be in a file named Main.java" check. Dropping the public modifier
    // on the class lets any single-file Java program run; main is still found.
    if (lang === "java") code = code.replace(/\bpublic\s+(?=(?:final\s+|abstract\s+)?class\b)/g, "");
    const body = { compiler, code, stdin: stdin || "" };
    if (files && files.length) {
        body.codes = files.map(f => ({ file: f.name, code: f.content }));
        // C/C++ must name extra source files on the command line so they link.
        if (lang === "c" || lang === "cpp" || lang === "c++") {
            const srcs = files.filter(f => /\.(c|cc|cpp|cxx|c\+\+)$/i.test(f.name)).map(f => f.name);
            if (srcs.length) body["compiler-option-raw"] = srcs.join("\n");
        }
    }
    const r = await fetchWithTimeout(`${WANDBOX_BASE}/compile.json`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
    }, 25000);
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`Wandbox ${r.status}: ${t.slice(0, 200)}`);
    }
    const d = await r.json();
    const status = parseInt(d.status, 10);
    return {
        ok: status === 0,
        stdout: String(d.program_output || ""),
        stderr: String(d.program_error || ""),
        compileStderr: String(d.compiler_error || d.compiler_output || ""),
        exitCode: Number.isNaN(status) ? null : status,
        signal: d.signal || null,
        language: lang,
        version: compiler
    };
}

async function runPiston(lang, code, stdin, files) {
    const pistonLang = PISTON_LANG[lang];
    if (!pistonLang) return { unsupported: true };
    const fileArr = [{ content: code }];
    if (files && files.length) for (const f of files) fileArr.push({ name: f.name, content: f.content });
    const r = await fetchWithTimeout(`${PISTON_BASE}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            language: pistonLang, version: "*",
            files: fileArr, stdin: stdin || "",
            run_timeout: 8000, compile_timeout: 10000
        })
    }, 25000);
    if (!r.ok) {
        const t = await r.text().catch(() => "");
        throw new Error(`Piston ${r.status}: ${t.slice(0, 200)}`);
    }
    const d = await r.json();
    const run = d.run || {};
    const compile = d.compile || null;
    return {
        ok: run.code === 0,
        stdout: String(run.stdout || ""),
        stderr: String(run.stderr || ""),
        compileStderr: compile ? String(compile.stderr || "") : "",
        exitCode: typeof run.code === "number" ? run.code : null,
        signal: run.signal || null,
        language: d.language || pistonLang,
        version: d.version || ""
    };
}

// Validate extra project files: safe names, no traversal, sane sizes.
function sanitizeRunFiles(raw) {
    const out = [];
    if (!Array.isArray(raw)) return out;
    for (const f of raw) {
        if (!f || typeof f !== "object") continue;
        let name = String(f.name || "").replace(/\\/g, "/").replace(/^\/+/, "").trim();
        if (!name || name.length > 100 || name.split("/").includes("..")) continue;
        const content = String(f.content || "");
        out.push({ name, content });
        if (out.length >= 30) break;
    }
    return out;
}

app.post("/api/code/run", express.json({ limit: "2mb" }), async (req, res) => {
    if (!runRateOk(req)) return res.status(429).json({ error: "Run rate limit - give it a moment." });
    const lang = String(req.body?.language || "").toLowerCase();
    const code = String(req.body?.code || "");
    const stdin = String(req.body?.stdin || "");
    if (!code.trim()) return res.status(400).json({ error: "No code provided" });
    if (code.length > 100000) return res.status(400).json({ error: "Code too long (>100KB)" });

    const files = sanitizeRunFiles(req.body?.files);
    let totalExtra = 0;
    for (const f of files) {
        if (f.content.length > 100000) return res.status(400).json({ error: `File ${f.name} too long (>100KB)` });
        totalExtra += f.content.length;
    }
    if (totalExtra > 500000) return res.status(400).json({ error: "Project files too large (>500KB total)" });

    const canPiston = PISTON_BASE && PISTON_LANG[lang];
    const canWandbox = !!WANDBOX_LANG[lang];
    if (!canPiston && !canWandbox)
        return res.status(400).json({ error: `Run not supported for ${lang || "unknown language"}` });

    const backends = [];
    if (canPiston) backends.push(() => runPiston(lang, code, stdin, files));
    if (canWandbox) backends.push(() => runWandbox(lang, code, stdin, files));

    const cap = (s) => String(s || "").slice(0, 60000);
    let lastErr = "";
    for (const run of backends) {
        try {
            const out = await run();
            if (out && !out.unsupported) {
                return res.json({
                    ok: out.ok,
                    stdout: cap(out.stdout),
                    stderr: cap(out.stderr),
                    compileStderr: cap(out.compileStderr),
                    exitCode: out.exitCode,
                    signal: out.signal,
                    language: out.language,
                    version: out.version
                });
            }
        } catch (e) {
            lastErr = e.name === "AbortError" ? "runtime timed out" : (e.message || String(e));
        }
    }
    res.status(502).json({ error: "Runtime unreachable: " + (lastErr || "no backend available") });
});

const { createRequire } = await import("node:module");
const filterRequire = createRequire(import.meta.url);

const FILTER_LIST = [
    "aristotle", "barracuda", "blocksi", "cisco", "deledao",
    "fortiguard", "goguardian", "iboss", "lanschool",
    "lightspeed", "linewize", "paloalto", "qustodio", "securly",
    "senso", "sophos"
];

const FILTER_LABELS = {
    aristotle: "Aristotle",
    barracuda: "Barracuda",
    blocksi: "Blocksi",
    cisco: "Cisco Umbrella",
    deledao: "Deledao",
    fortiguard: "FortiGuard",
    goguardian: "GoGuardian",
    iboss: "iBoss",
    lanschool: "LanSchool",
    lightspeed: "Lightspeed",
    linewize: "Linewize",
    paloalto: "Palo Alto",
    qustodio: "Qustodio",
    securly: "Securly",
    senso: "Senso",
    sophos: "Sophos"
};

const filterFns = {};
for (const name of FILTER_LIST) {
    try {
        const mod = filterRequire(`./filters/${name}.cjs`);
        const fn = mod[name] || mod.default || mod[Object.keys(mod)[0]];
        if (typeof fn === "function") filterFns[name] = fn;
    } catch (e) {
        console.warn(`[linkcheck] failed to load filter '${name}':`, e.message);
    }
}
console.log(`[linkcheck] loaded ${Object.keys(filterFns).length}/${FILTER_LIST.length} filters: ${Object.keys(filterFns).join(", ")}`);

function normalizeFilterResult(raw) {
    if (raw === "Error" || raw == null) return { category: null, blocked: null, error: "filter error" };
    if (Array.isArray(raw)) {
        const [category, blocked] = raw;
        return { category: category != null ? String(category) : null, blocked: typeof blocked === "boolean" ? blocked : null };
    }
    if (typeof raw === "object") {
        return { category: raw.category != null ? String(raw.category) : null, blocked: typeof raw.blocked === "boolean" ? raw.blocked : null };
    }
    return { category: String(raw), blocked: null };
}

app.get("/api/linkcheck", (req, res) => res.json({ filters: FILTER_LIST.map(id => ({ id, label: FILTER_LABELS[id], available: !!filterFns[id] })) }));

app.get("/api/linkcheck/stream", async (req, res) => {
    // Each request fans out to ~16 outbound vendor calls — rate-limit per IP.
    if (!lcRateOk(lcClientIp(req), LC_LIMIT_ANON)) return res.status(429).json({ error: "Rate limit exceeded — slow down." });
    const rawUrl = String(req.query.url || "").trim();
    if (!rawUrl) return res.status(400).json({ error: "Missing url" });
    if (rawUrl.length > 2048) return res.status(400).json({ error: "URL too long" });

    let url;
    try {
        url = new URL(rawUrl.includes("://") ? rawUrl : "http://" + rawUrl);
    } catch {
        return res.status(400).json({ error: "Invalid URL" });
    }

    const requested = String(req.query.filters || "all").toLowerCase();
    let chosen;
    if (requested === "all" || requested === "*") chosen = Object.keys(filterFns);
    else chosen = requested.split(",").map(s => s.trim()).filter(s => filterFns[s]);
    if (!chosen.length) return res.status(400).json({ error: "No valid filters selected" });

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders && res.flushHeaders();

    const send = (event, data) => {
        res.write(`event: ${event}\n`);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    send("start", { url: url.toString(), filters: chosen.map(id => ({ id, label: FILTER_LABELS[id] })), total: chosen.length });

    const FILTER_TIMEOUT_MS = 12000;
    let closed = false;
    req.on("close", () => { closed = true; });

    const runOne = async (id) => {
        const fn = filterFns[id];
        const t0 = Date.now();
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), FILTER_TIMEOUT_MS));
        try {
            const raw = await Promise.race([fn(url.toString()), timeout]);
            const norm = normalizeFilterResult(raw);
            if (!closed) send("result", { id, label: FILTER_LABELS[id], ...norm, ms: Date.now() - t0 });
        } catch (e) {
            if (!closed) send("result", { id, label: FILTER_LABELS[id], category: null, blocked: null, error: e.message || "error", ms: Date.now() - t0 });
        }
    };

    await Promise.all(chosen.map(runOne));

    if (!closed) {
        send("done", { total: chosen.length });
        res.end();
    }
});

// ── Public link-check REST API (v1) ──────────────────────────────────────────
// A documented, CORS-enabled, rate-limited JSON API so external apps can check a
// URL against the school/content filters. Filters only call fixed vendor APIs
// (the user URL is sent as data, never fetched) so there is no SSRF surface; the
// guard here is abuse/DoS rate-limiting, with optional API keys for higher limits.
const _lcDataDir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
function loadLinkcheckKeys() {
    const out = new Set((process.env.NOCTURNE_LINKCHECK_KEYS || "").split(",").map(s => s.trim()).filter(Boolean));
    try { fs.readFileSync(path.join(_lcDataDir, "linkcheck-keys"), "utf8").split(/[\r\n]+/).map(s => s.trim()).filter(s => s && !s.startsWith("#")).forEach(k => out.add(k)); } catch {}
    return out;
}
const LINKCHECK_KEYS = loadLinkcheckKeys();
const LC_LIMIT_ANON = Number(process.env.NOCTURNE_LINKCHECK_RPM) || 30;
const LC_LIMIT_KEY = Number(process.env.NOCTURNE_LINKCHECK_RPM_KEY) || 300;
const _lcBuckets = new Map();
function lcClientIp(req) { return req.ip || req.socket?.remoteAddress || ""; }
function lcRateOk(ip, limit) {
    const now = Date.now();
    let b = _lcBuckets.get(ip);
    if (!b || now - b.start > 60_000) { b = { start: now, count: 0 }; _lcBuckets.set(ip, b); }
    if (b.count >= limit) return false;
    b.count++; return true;
}
setInterval(() => { const now = Date.now(); for (const [k, b] of _lcBuckets) if (now - b.start > 60_000) _lcBuckets.delete(k); }, 120_000).unref();

async function runFiltersJson(urlStr, chosen) {
    const FILTER_TIMEOUT_MS = 12000;
    return Promise.all(chosen.map(async id => {
        const fn = filterFns[id]; const t0 = Date.now();
        try {
            const raw = await Promise.race([fn(urlStr), new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), FILTER_TIMEOUT_MS))]);
            return { id, label: FILTER_LABELS[id], ...normalizeFilterResult(raw), ms: Date.now() - t0 };
        } catch (e) { return { id, label: FILTER_LABELS[id], category: null, blocked: null, error: e.message || "error", ms: Date.now() - t0 }; }
    }));
}

function v1Cors(res) {
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type, X-API-Key");
    res.set("Access-Control-Max-Age", "86400");
}
app.use((req, res, next) => {
    if (req.method === "OPTIONS" && req.path.startsWith("/api/v1/")) { v1Cors(res); return res.sendStatus(204); }
    next();
});

const _lcJson = express.json({ limit: "16kb" });
async function v1LinkcheckHandler(req, res) {
    v1Cors(res);
    const key = String(req.get("X-API-Key") || req.query.key || "");
    const keyed = LINKCHECK_KEYS.size > 0 && LINKCHECK_KEYS.has(key);
    const limit = keyed ? LC_LIMIT_KEY : LC_LIMIT_ANON;
    if (!lcRateOk(lcClientIp(req), limit)) {
        res.set("Retry-After", "60");
        return res.status(429).json({ error: "Rate limit exceeded — max " + limit + " requests/min.", limit, window: "60s" });
    }
    const rawUrl = String((req.body && req.body.url) || req.query.url || "").trim();
    if (!rawUrl) return res.status(400).json({ error: "Missing 'url' (query param or JSON body)." });
    if (rawUrl.length > 2048) return res.status(400).json({ error: "URL too long (max 2048)." });
    let url; try { url = new URL(rawUrl.includes("://") ? rawUrl : "http://" + rawUrl); } catch { return res.status(400).json({ error: "Invalid URL." }); }
    const bodyFilters = req.body && req.body.filters;
    let chosen;
    if (Array.isArray(bodyFilters)) chosen = bodyFilters.map(s => String(s).trim().toLowerCase()).filter(s => filterFns[s]);
    else {
        const reqF = String(bodyFilters || req.query.filters || "all").toLowerCase();
        chosen = (reqF === "all" || reqF === "*") ? Object.keys(filterFns) : reqF.split(",").map(s => s.trim()).filter(s => filterFns[s]);
    }
    if (!chosen.length) return res.status(400).json({ error: "No valid filters selected.", available: Object.keys(filterFns) });
    const results = await runFiltersJson(url.toString(), chosen);
    res.json({
        url: url.toString(),
        checkedAt: new Date().toISOString(),
        summary: {
            total: results.length,
            blocked: results.filter(r => r.blocked === true).length,
            allowed: results.filter(r => r.blocked === false).length,
            errors: results.filter(r => r.error).length
        },
        results
    });
}
app.get("/api/v1/filters", (req, res) => { v1Cors(res); res.json({ filters: FILTER_LIST.map(id => ({ id, label: FILTER_LABELS[id], available: !!filterFns[id] })) }); });
app.get("/api/v1/linkcheck", v1LinkcheckHandler);
app.post("/api/v1/linkcheck", _lcJson, v1LinkcheckHandler);
app.get(["/api/v1", "/api/v1/docs"], (req, res) => {
    v1Cors(res);
    res.json({
        name: "Nocturne Link-Check API",
        version: "1",
        description: "Check whether a URL is blocked by common school/content filters.",
        rateLimit: { anonymous: LC_LIMIT_ANON + "/min", withApiKey: LC_LIMIT_KEY + "/min", header: "X-API-Key" },
        endpoints: {
            "GET /api/v1/filters": "List all available filters.",
            "GET /api/v1/linkcheck?url=<url>&filters=<all|comma,list>": "Check a URL (query params).",
            "POST /api/v1/linkcheck": 'JSON body: {"url":"example.com","filters":["securly","goguardian"]}. Omit filters or use "all" for every filter.'
        },
        example: { request: 'GET /api/v1/linkcheck?url=discord.com&filters=all', result: { summary: { total: 16, blocked: 3, allowed: 12, errors: 1 }, results: [{ id: "securly", label: "Securly", category: "Social Media", blocked: true, ms: 240 }] } },
        filters: FILTER_LIST.map(id => ({ id, label: FILTER_LABELS[id] }))
    });
});

// Human-readable API docs landing — how to reach + set up the AI / link-check APIs.
app.get(["/api", "/api/"], (req, res) => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(__dirname, "public", "api.html"));
});

app.get("/api/online", (req, res, next) => {
    authMiddleware(req, res, () => {
        noteVisitor(req);
        res.setHeader("Cache-Control", "no-store");
        res.json({ online: onlineCount() });
    });
});

const STATIC_BYPASS_RE = /^\/(src\/|app\/|edu\/|sapphire\/|favicon\.ico|.+\.(css|js|mjs|wasm|png|jpg|jpeg|svg|woff2?|ttf|ico|map))$/i;

app.use(scrubDevOriginAuth);
app.use((req, res, next) => {
    if (STATIC_BYPASS_RE.test(req.path)) return next();
    authMiddleware(req, res, () => {
        if (req.user) noteVisitor(req);
        next();
    });
});

// Block banned IPs / users (owner exempt). Runs after auth so it knows req.user.
app.use((req, res, next) => {
    if (STATIC_BYPASS_RE.test(req.path)) return next();
    banMiddleware(req, res, next);
});

// Accounts created on a VPN, proxy, or Tor exit keep the proxy, games, and
// settings. AI, chat, VMs, and the rest of the account stay closed.
const LIMITED_ALLOW = /^\/api\/(?:auth|online|ads|go|captcha|sanction|games|cherri|linkcheck|v1)(?:\/|$)/;
app.use((req, res, next) => {
    if (!req.user || !userIsLimited(req.user)) return next();
    const path = req.path || "";
    if (LIMITED_ALLOW.test(path)) return next();
    if (path.startsWith("/api/") || path.startsWith("/vm/")) {
        res.set("Cache-Control", "no-store");
        return res.status(403).json({ error: LIMITED_MESSAGE, limited: true });
    }
    next();
});

mountCaptcha(app);
mountAuth(app);
mountStorage(app);
mountGroq(app, { authMiddleware });
mountModeration(app);
mountChat(app, { authMiddleware });
mountVms(app, { authMiddleware });
mountMusic(app, { authMiddleware });
mountAdmin(app, { authMiddleware });
startSampler();   // CCU has no history unless something records it
mountConsole(app, { authMiddleware });   // owner-only server terminal password endpoints
mountApplications(app, { authMiddleware });   // /api/apply + Admin → Applications
mountProjects(app);
mountRunner(app, { authMiddleware });
mountBoxes(app, { authMiddleware });
mountFlix(app);
mountStratus(app, { authMiddleware });

app.post("/api/youtube-account/watch", authMiddleware, (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not logged in" });
    const { videoId, title, author, thumbnail, duration, tags, categories } = req.body || {};
    if (!videoId || typeof videoId !== "string") return res.status(400).json({ error: "missing videoId" });
    const now = Date.now();
    try {
        stmts.ytHistoryInsert.run(req.user.id, videoId, title || "", author || "", thumbnail || "", duration || "", now);
        if (author) stmts.ytPrefUpsert.run(req.user.id, "channel", author, now);
        if (Array.isArray(tags)) tags.slice(0, 15).forEach(t => { if (t) stmts.ytPrefUpsert.run(req.user.id, "tag", String(t).toLowerCase(), now); });
        if (Array.isArray(categories)) categories.slice(0, 5).forEach(c => { if (c) stmts.ytPrefUpsert.run(req.user.id, "category", String(c).toLowerCase(), now); });
        stmts.ytPrefPrune.run(req.user.id, "tag", req.user.id, "tag", 50);
        stmts.ytPrefPrune.run(req.user.id, "channel", req.user.id, "channel", 30);
        stmts.ytPrefPrune.run(req.user.id, "category", req.user.id, "category", 20);
        _recCache.delete(req.user.id);
        res.json({ ok: true });
    } catch (e) { res.status(500).json({ error: "failed to save" }); }
});

app.get("/api/youtube-account/history", authMiddleware, (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not logged in" });
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;
    try {
        const rows = stmts.ytHistoryList.all(req.user.id, limit, offset);
        res.json({ history: rows });
    } catch { res.status(500).json({ error: "failed" }); }
});

app.get("/api/youtube-account/history/recent", authMiddleware, (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not logged in" });
    const limit = Math.min(parseInt(req.query.limit) || 20, 50);
    try {
        const rows = stmts.ytHistoryRecent.all(req.user.id, limit);
        res.json({ history: rows });
    } catch { res.status(500).json({ error: "failed" }); }
});

app.delete("/api/youtube-account/history", authMiddleware, (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not logged in" });
    const { videoId } = req.body || {};
    try {
        if (videoId) stmts.ytHistoryDelete.run(req.user.id, videoId);
        else stmts.ytHistoryClear.run(req.user.id);
        res.json({ ok: true });
    } catch { res.status(500).json({ error: "failed" }); }
});

app.get("/api/youtube-account/preferences", authMiddleware, (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not logged in" });
    try {
        const tags = stmts.ytPrefTop.all(req.user.id, "tag", 20);
        const channels = stmts.ytPrefTop.all(req.user.id, "channel", 15);
        const categories = stmts.ytPrefTop.all(req.user.id, "category", 10);
        res.json({ tags, channels, categories });
    } catch { res.status(500).json({ error: "failed" }); }
});

app.post("/api/youtube-account/like", authMiddleware, (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not logged in" });
    const { videoId, title, author, thumbnail } = req.body || {};
    if (!videoId) return res.status(400).json({ error: "missing videoId" });
    try {
        stmts.ytLikeInsert.run(req.user.id, videoId, title || "", author || "", thumbnail || "", Date.now());
        res.json({ ok: true, liked: true });
    } catch { res.status(500).json({ error: "failed" }); }
});

app.delete("/api/youtube-account/like", authMiddleware, (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not logged in" });
    const { videoId } = req.body || {};
    if (!videoId) return res.status(400).json({ error: "missing videoId" });
    try {
        stmts.ytLikeDelete.run(req.user.id, videoId);
        res.json({ ok: true, liked: false });
    } catch { res.status(500).json({ error: "failed" }); }
});

app.get("/api/youtube-account/likes", authMiddleware, (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not logged in" });
    const limit = Math.min(parseInt(req.query.limit) || 30, 100);
    const offset = parseInt(req.query.offset) || 0;
    try {
        const rows = stmts.ytLikeList.all(req.user.id, limit, offset);
        res.json({ likes: rows });
    } catch { res.status(500).json({ error: "failed" }); }
});

app.get("/api/youtube-account/me", authMiddleware, (req, res) => {
    if (!req.user) return res.json({ loggedIn: false });
    try {
        const tags = stmts.ytPrefTop.all(req.user.id, "tag", 10);
        const channels = stmts.ytPrefTop.all(req.user.id, "channel", 5);
        const categories = stmts.ytPrefTop.all(req.user.id, "category", 5);
        const recent = stmts.ytHistoryRecent.all(req.user.id, 10);
        res.json({
            loggedIn: true,
            username: req.user.username,
            userId: req.user.id,
            prefs: { tags, channels, categories },
            recentHistory: recent
        });
    } catch { res.json({ loggedIn: false }); }
});

const _recCache = new Map();
const _REC_TTL = 10 * 60 * 1000;
const _inkChanKeyForRec = (() => {
    const dataDir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
    try {
        const line = fs.readFileSync(path.join(dataDir, "inkchan-key"), "utf8").split(/[\r\n]+/).map(s => s.trim()).find(s => s && !s.startsWith("#"));
        return line || "";
    } catch { return ""; }
})();
const _inkChanBaseForRec = (() => {
    const dataDir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
    try {
        const line = fs.readFileSync(path.join(dataDir, "inkchan-base"), "utf8").split(/[\r\n]+/).map(s => s.trim()).find(s => s && !s.startsWith("#"));
        return (line || "https://ai.inknetworks.site/api").replace(/\/+$/, "");
    } catch { return "https://ai.inknetworks.site/api"; }
})();

app.get("/api/youtube-account/recommend", authMiddleware, async (req, res) => {
    if (!req.user) return res.status(401).json({ error: "not logged in" });
    const uid = req.user.id;
    const cached = _recCache.get(uid);
    if (cached && Date.now() - cached.ts < _REC_TTL) return res.json(cached.data);
    try {
        const history = stmts.ytHistoryRecent.all(uid, 20);
        const tags = stmts.ytPrefTop.all(uid, "tag", 15);
        const channels = stmts.ytPrefTop.all(uid, "channel", 10);
        const categories = stmts.ytPrefTop.all(uid, "category", 8);
        if (!history.length && !tags.length) return res.json({ queries: [] });
        const titles = history.map(h => h.title).filter(Boolean).slice(0, 15);
        const authors = [...new Set(history.map(h => h.author).filter(Boolean))].slice(0, 8);
        const tagList = tags.map(t => t.value).slice(0, 12);
        const catList = categories.map(c => c.value).slice(0, 6);
        const chanList = channels.map(c => c.value).slice(0, 6);
        const prompt = `Based on this person's YouTube watch history, generate 10 YouTube search queries that would find videos they'd love. Be specific — use artist names, song titles, genres, languages, and topics from their history. Mix discovery (similar artists/topics) with more of what they already like.

Recent videos watched:
${titles.join("\n")}

Favorite channels: ${chanList.join(", ") || "none"}
Top tags: ${tagList.join(", ") || "none"}
Categories: ${catList.join(", ") || "none"}
Authors: ${authors.join(", ") || "none"}

Return ONLY a JSON array of 10 search query strings. No explanation.`;

        if (!_inkChanKeyForRec) {
            const fallback = buildFallbackQueries(titles, authors, tagList, chanList);
            const resp = { queries: fallback };
            _recCache.set(uid, { data: resp, ts: Date.now() });
            return res.json(resp);
        }
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 8000);
        try {
            const r = await fetch(`${_inkChanBaseForRec}/chat/completions`, {
                method: "POST", signal: ctrl.signal,
                headers: { "Content-Type": "application/json", "Authorization": `Bearer ${_inkChanKeyForRec}`, "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
                body: JSON.stringify({ model: "ink-chan:latest", messages: [{ role: "user", content: prompt }], temperature: 0.8, max_tokens: 400 })
            });
            clearTimeout(timer);
            if (!r.ok) throw new Error(r.status);
            const j = await r.json();
            const text = j.choices?.[0]?.message?.content || "[]";
            let queries;
            try {
                const match = text.match(/\[[\s\S]*?\]/);
                queries = match ? JSON.parse(match[0]) : [];
            } catch { queries = []; }
            queries = queries.filter(q => typeof q === "string" && q.length > 2).slice(0, 10);
            if (!queries.length) queries = buildFallbackQueries(titles, authors, tagList, chanList);
            const resp = { queries, ai: true };
            _recCache.set(uid, { data: resp, ts: Date.now() });
            return res.json(resp);
        } catch { clearTimeout(timer); }
        const fallback = buildFallbackQueries(titles, authors, tagList, chanList);
        const resp = { queries: fallback };
        _recCache.set(uid, { data: resp, ts: Date.now() });
        return res.json(resp);
    } catch { return res.status(500).json({ error: "recommend failed" }); }
});

function buildFallbackQueries(titles, authors, tagList, chanList) {
    const queries = [];
    authors.forEach(a => queries.push(a + " latest"));
    tagList.slice(0, 4).forEach(t => queries.push(t + " best videos 2024"));
    chanList.slice(0, 3).forEach(c => queries.push(c + " new uploads"));
    const words = {};
    titles.forEach(t => t.split(/\s+/).forEach(w => { w = w.toLowerCase().replace(/[^a-z0-9一-鿿가-힯]/g, ""); if (w.length > 3) words[w] = (words[w] || 0) + 1; }));
    Object.entries(words).sort((a, b) => b[1] - a[1]).slice(0, 4).forEach(([w]) => queries.push(w + " videos"));
    while (queries.length < 8) queries.push("trending popular videos 2024");
    return [...new Set(queries)].slice(0, 10);
}

app.use("/api/youtube", async (req, res) => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120000);
    res.on("close", () => ctrl.abort());
    try {
        const upstream = `http://127.0.0.1:2450${req.originalUrl}`;
        const headers = { ...req.headers, host: "127.0.0.1:2450" };
        delete headers["connection"];
        headers["x-forwarded-for"] = req.ip || req.socket?.remoteAddress || "127.0.0.1";
        const opts = { method: req.method, headers, signal: ctrl.signal };
        if (req.method !== "GET" && req.method !== "HEAD" && req.body) {
            opts.body = JSON.stringify(req.body);
            opts.headers["content-type"] = "application/json";
        }
        const upstream_res = await fetch(upstream, opts);
        res.status(upstream_res.status);
        const ct = upstream_res.headers.get("content-type");
        if (ct) res.set("content-type", ct);
        const cr = upstream_res.headers.get("content-range");
        if (cr) res.set("content-range", cr);
        const cl = upstream_res.headers.get("content-length");
        if (cl) res.set("content-length", cl);
        const ar = upstream_res.headers.get("accept-ranges");
        if (ar) res.set("accept-ranges", ar);
        const ra = upstream_res.headers.get("retry-after");
        if (ra) res.set("retry-after", ra);
        if (upstream_res.body) {
            const reader = upstream_res.body.getReader();
            const pump = async () => {
                while (true) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    res.write(Buffer.from(value));
                }
                res.end();
            };
            await pump();
        } else {
            const buf = Buffer.from(await upstream_res.arrayBuffer());
            res.send(buf);
        }
    } catch (e) {
        clearTimeout(timer);
        if (!res.headersSent) res.status(502).json({ error: "youtube api unreachable" });
    } finally {
        clearTimeout(timer);
    }
});

app.get("/api", (req, res) => res.sendFile(path.join(__dirname, "public/api.html")));
app.get("/api", (req, res) => res.sendFile(path.join(__dirname, "public/api.html")));

// Admin panel page: the SERVER decides owner-access and injects it, so the
// client shows the panel immediately with no gate-blocking fetch (a hung
// /api/admin/summary can never strand it on "checking access").
const OWNER_NAME = (process.env.NOCTURNE_OWNER || "midnightsweat").toLowerCase();
let _adminHtml = null;
app.get(["/cp", "/panel", "/admin", "/god", "/admin.html"], (req, res, next) => {
    try {
        if (_adminHtml == null || process.env.NODE_ENV !== "production") {
            _adminHtml = fs.readFileSync(path.join(__dirname, "public", "admin.html"), "utf8");
        }
        const isOwner = !!(req.user && req.user.username && req.user.username.toLowerCase() === OWNER_NAME);
        const boot = `<script>window.__ADMIN_BOOT=${JSON.stringify(isOwner ? { owner: req.user.username } : { owner: null })};</script>`;
        const html = _adminHtml.replace("</head>", boot + "</head>");
        res.set("Cache-Control", "no-store").type("html").send(html);
    } catch (e) { next(); }
});


const TMDB_API_KEY = (() => {
    if (process.env.TMDB_API_KEY) return process.env.TMDB_API_KEY.trim();
    try {
        const dir = process.env.NOCTURNE_DATA_DIR || path.join(__dirname, "data");
        return fs.readFileSync(path.join(dir, "tmdb-key"), "utf8").trim();
    } catch { return ""; }
})();
const TMDB_BASE = "https://api.themoviedb.org/3";

const ADULT_TITLE_RE = /\b(sex|sexy|sexual|porn|porno|pornograph|xxx|erotic|erotica|sensual|nude|nudes|nudity|naked|orgy|orgasm|kinky|kink|stripper|striptease|hentai|playboy|hooker|escort|brothel|prostitut|hardcore|softcore|adult\s+film|adult\s+movie|adult\s+entertain|fetish|bdsm|bondage|incest|threesome|swing(?:er|ing)|cuckold|hookup|onlyfans|softporn|s&m)\b/i;
const ADULT_QUERY_RE = ADULT_TITLE_RE;
const ADULT_GENRE_NAMES = new Set(["adult"]);

function filterAdult(payload) {
    if (!payload || typeof payload !== "object") return payload;
    if (Array.isArray(payload.results)) {
        payload.results = payload.results.filter(item => {
            if (!item) return false;
            if (item.adult === true) return false;
            const title = String(item.title || item.name || "");
            const original = String(item.original_title || item.original_name || "");
            const overview = String(item.overview || "");
            if (ADULT_TITLE_RE.test(title) || ADULT_TITLE_RE.test(original) || ADULT_TITLE_RE.test(overview)) return false;
            if (Array.isArray(item.genre_ids) && item.genre_ids.length === 0 && /uncensored|unrated/i.test(overview)) return false;
            return true;
        });
    }
    if (Array.isArray(payload.genres)) {
        payload.genres = payload.genres.filter(g => !ADULT_GENRE_NAMES.has(String(g.name || "").toLowerCase()));
    }
    if (payload.adult === true) {
        const err = new Error("adult content filtered");
        err.status = 451;
        throw err;
    }
    if (Array.isArray(payload.recommendations?.results)) {
        payload.recommendations.results = payload.recommendations.results.filter(item => !item.adult && !ADULT_TITLE_RE.test(String(item.title || item.name || "")));
    }
    return payload;
}

async function tmdb(pathname, query = {}) {
    if (!TMDB_API_KEY) {
        const err = new Error("TMDB_API_KEY not configured on server");
        err.status = 503;
        throw err;
    }
    const u = new URL(TMDB_BASE + pathname);
    u.searchParams.set("api_key", TMDB_API_KEY);
    if (!("include_adult" in query)) u.searchParams.set("include_adult", "false");
    u.searchParams.set("certification_country", query.certification_country || "US");
    for (const [k, v] of Object.entries(query)) if (v != null && v !== "") u.searchParams.set(k, String(v));
    const r = await fetch(u);
    if (!r.ok) {
        const err = new Error(`TMDB ${r.status}`);
        err.status = r.status === 404 ? 404 : 502;
        throw err;
    }
    const json = await r.json();
    return filterAdult(json);
}

function tmdbHandler(fn) {
    return async (req, res) => {
        try { res.json(await fn(req)); }
        catch (e) {
            const status = e.status || 500;
            res.status(status).json({ error: e.message, configured: !!TMDB_API_KEY });
        }
    };
}

app.get("/api/movies/config", (req, res) => {
    res.json({ configured: !!TMDB_API_KEY, imageBase: "https://image.tmdb.org/t/p" });
});

app.get("/api/movies/trending", tmdbHandler(async req => {
    const window = req.query.window === "day" ? "day" : "week";
    return tmdb(`/trending/all/${window}`, { page: req.query.page });
}));

app.get("/api/movies/popular/movies", tmdbHandler(async req => tmdb("/movie/popular", { page: req.query.page })));
app.get("/api/movies/popular/tv", tmdbHandler(async req => tmdb("/tv/popular", { page: req.query.page })));
app.get("/api/movies/top/movies", tmdbHandler(async req => tmdb("/movie/top_rated", { page: req.query.page })));
app.get("/api/movies/top/tv", tmdbHandler(async req => tmdb("/tv/top_rated", { page: req.query.page })));

app.get("/api/movies/search", tmdbHandler(async req => {
    const q = (req.query.q || "").toString().trim();
    if (!q) return { page: 1, results: [], total_pages: 0, total_results: 0 };
    if (ADULT_QUERY_RE.test(q)) return { page: 1, results: [], total_pages: 0, total_results: 0, filtered: true };
    return tmdb("/search/multi", { query: q, page: req.query.page, include_adult: false });
}));

app.get("/api/movies/details/movie/:id", tmdbHandler(async req => tmdb(`/movie/${encodeURIComponent(req.params.id)}`, { append_to_response: "credits,videos,recommendations" })));
app.get("/api/movies/details/tv/:id", tmdbHandler(async req => tmdb(`/tv/${encodeURIComponent(req.params.id)}`, { append_to_response: "credits,videos,recommendations" })));
app.get("/api/movies/season/:tvId/:season", tmdbHandler(async req => tmdb(`/tv/${encodeURIComponent(req.params.tvId)}/season/${encodeURIComponent(req.params.season)}`)));

app.get("/api/movies/discover/:kind", tmdbHandler(async req => {
    const kind = req.params.kind === "tv" ? "tv" : "movie";
    return tmdb(`/discover/${kind}`, {
        page: req.query.page,
        sort_by: req.query.sort_by || "popularity.desc",
        with_genres: req.query.with_genres,
        primary_release_year: req.query.year,
        first_air_date_year: req.query.year
    });
}));

app.get("/api/movies/genres/:kind", tmdbHandler(async req => {
    const kind = req.params.kind === "tv" ? "tv" : "movie";
    return tmdb(`/genre/${kind}/list`);
}));

app.get("/api/suggest", async (req, res) => {
    const q = (req.query.q || "").toString().slice(0, 200).trim();
    res.set("Cache-Control", "no-store");
    if (!q) return res.json({ suggestions: [] });
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3500);
    try {
        const url = "https://suggestqueries.google.com/complete/search?client=firefox&hl=en&q=" + encodeURIComponent(q);
        const r = await fetch(url, { signal: ctrl.signal, headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36" } });
        const data = await r.json();
        const list = (Array.isArray(data) && Array.isArray(data[1]) ? data[1] : [])
            .filter(s => typeof s === "string")
            .slice(0, 8);
        res.json({ suggestions: list });
    } catch {
        res.json({ suggestions: [] });
    } finally {
        clearTimeout(timer);
    }
});

// cherrigames — originally proxied live from gitlab.com/x8r/cherrigames, but that repo
// went down. Game files (ckv/truffled/ugs/img) are now vendored locally under ./cherrigames,
// and so are the real {name,img,url} manifests (ckv.json/truffled.json/ugs.json/seraph.json)
// the repo itself never served over the broken proxy. seraph's manifest is present but its
// game files aren't vendored yet, so seraph entries list correctly but 404 on open until a
// seraph/ folder shows up next to the others.
const CHERRI_DIR = path.join(__dirname, "cherrigames");
const CHERRI_ID_BASE = 100_000;   // keeps ids well clear of gn-math's (roughly -1..500)
const CHERRI_SOURCES = ["ckv", "truffled", "ugs", "seraph"];

let _cherriGamesCache = null;
function scanCherriGames() {
    if (_cherriGamesCache) return _cherriGamesCache;
    const out = [];
    let id = CHERRI_ID_BASE;
    for (const src of CHERRI_SOURCES) {
        let list;
        try { list = JSON.parse(fs.readFileSync(path.join(CHERRI_DIR, src + ".json"), "utf8")); }
        catch { continue; }
        if (!Array.isArray(list)) continue;
        for (const g of list) {
            if (!g || typeof g.name !== "string" || typeof g.url !== "string") continue;
            out.push({
                id: id++,
                name: g.name,
                cover: "/api/cherri" + (g.img || "/img/placeholder.png"),
                url: "/api/cherri" + g.url,
                special: [src]
            });
        }
    }
    _cherriGamesCache = out;
    return out;
}

app.get("/api/games/list", async (req, res) => {
    try {
        const response = await fetch("https://raw.githubusercontent.com/gn-math/assets/main/zones.json");
        if (!response.ok) throw new Error("Failed to fetch games");
        const games = await response.json();
        const COVER_URL = "https://cdn.jsdelivr.net/gh/gn-math/covers@main";
        const HTML_URL = "https://cdn.jsdelivr.net/gh/gn-math/html@main";

        const processedGames = games.map(game => ({
            ...game,
            cover: game.cover.replace("{COVER_URL}", COVER_URL),
            url: game.url.replace("{HTML_URL}", HTML_URL)
        }));

        const cherriGames = scanCherriGames();

        res.json(processedGames.concat(cherriGames));
    } catch (error) {
        console.error("[nocturne] /api/games/list failed:", error);
        res.status(500).json({ error: "Failed to load games" });
    }
});

// cherrigames' game files are now vendored locally (see scanCherriGames above), so this is
// a plain static mount instead of a live proxy to the (now-down) GitLab repo.
app.use("/api/cherri", express.static(CHERRI_DIR));

const CODE_ID_RE = /^[A-Za-z0-9_-]{16}$/;
const CODE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CODE_MAX_BYTES = 200 * 1024;
const CODE_LANG_MAX = 32;

app.post("/api/code", (req, res) => {
    const content = typeof req.body?.content === "string" ? req.body.content : "";
    const language = typeof req.body?.language === "string" ? req.body.language.slice(0, CODE_LANG_MAX) : "";
    if (!content || !language) return res.status(400).json({ error: "Content and language required" });
    if (Buffer.byteLength(content, "utf8") > CODE_MAX_BYTES) return res.status(413).json({ error: "Content too large" });

    const codeId = crypto.randomBytes(12).toString("base64url");
    const now = Date.now();
    try {
        stmts.codeInsert.run(codeId, content, language, now, now + CODE_TTL_MS);
    } catch (e) {
        return res.status(500).json({ error: "Failed to store snippet" });
    }
    res.json({ success: true, codeId, shareUrl: `/code.html?share=${codeId}` });
});

app.get("/api/code/:codeId", (req, res) => {
    const id = req.params.codeId;
    if (!CODE_ID_RE.test(id)) return res.status(404).json({ error: "Code snippet not found" });
    const row = stmts.codeGet.get(id, Date.now());
    if (!row) return res.status(404).json({ error: "Code snippet not found" });
    res.json({
        content: row.content,
        language: row.language,
        timestamp: new Date(row.created_at).toISOString(),
        expiresAt: new Date(row.expires_at).toISOString()
    });
});

// ─── Console filter regex + ASCII banner constants ─────────────────────
// Used by the page-side inline filter (CONSOLE_INJECT) and the worker/proxy
// filter prepended to every framework script we serve.
const _NOC_BANNER = [
    " _   _    ___     ____   _____   _   _   ____    _   _   _____      _        ___    _ ",
    "| \\ | |  / _ \\   / ___| |_   _| | | | | |  _ \\  | \\ | | | ____|    | |      / _ \\  | |",
    "|  \\| | | | | | | |       | |   | | | | | |_) | |  \\| | |  _|      | |     | | | | | |",
    "| |\\  | | |_| | | |___    | |   | |_| | |  _ <  | |\\  | | |___  _  | |___  | |_| | |___",
    "|_| \\_|  \\___/   \\____|   |_|    \\___/  |_| \\_\\ |_| \\_| |_____|(_) |_____|  \\___/  |_____|"
].join("\n");

// Any console message mentioning the underlying proxy stack is dropped. Covers
// the actual log strings these libraries emit (bare-mux version banners, "set
// transport to", "error while processing", UVServiceWorker, epoxy/wisp, etc.).
// Built at runtime from base64 so the served HTML/worker source carries no
// plaintext framework word-list (it would otherwise be the single loudest tell
// in every page). Decodes to the same case-insensitive alternation as before.
const _NOC_FILTER_RE = 'new RegExp(atob("YmFyZVstXyBdP211eHxiYXJlbXV4fHNjcmFtamV0fHVsdHJhdmlvbGV0fFxiZXBveHlcYnxcYndpc3BcYnxVVlNlcnZpY2VXb3JrZXJ8QmFyZU11eHxVbHRyYXZpb2xldHxCYXJlQ2xpZW50fEJhcmVUcmFuc3BvcnR8XCRzY3JhbWpldHx1dlwuYnVuZGxlfHV2XC5zd3x1dlwuaGFuZGxlcnx1dlwuY2xpZW50fHV2LXdvcmtlcnx1di1jb25maWd8cGFnZS1pbml0fHBhZ2UtY29uZmlnfG5vY3R1cm5lOmluaXR8Y29udHJvbGxlcmNoYW5nZXx3aXNwWy0gXT9wYXRofHRpdGFuaXVtbmV0d29ya3xtZXJjdXJ5d29ya3Nob3B8c2V0IHRyYW5zcG9ydCB0b3xlcnJvciB3aGlsZSBwcm9jZXNzaW5nfG5vIGJhcmUgY2xpZW50c3x3b3JrZXJQYXRofE1lc3NhZ2VQb3J0"),"i")';

// Worker/proxy console filter - silences proxy framework chatter in any scope
// (SW, SharedWorker, or the proxied iframe). Works via `self.console`, which
// resolves in Window, Worker and ServiceWorker contexts alike.
const _WORKER_CONSOLE_FILTER = '(function(){try{if(self.__nocCF)return;self.__nocCF=1;var BAD=' + _NOC_FILTER_RE + ';["log","warn","error","info","debug","trace"].forEach(function(k){var o=self.console&&self.console[k];if(typeof o!=="function")return;self.console[k]=function(){try{for(var i=0;i<arguments.length;i++){var v=arguments[i];var s=(typeof v==="string")?v:(v&&v.message)?v.message:"";if(s&&BAD.test(s))return;}}catch(e){}return o.apply(self.console,arguments);};});}catch(e){}})();\n';

// Strip build-time brand tells from the vendor bundles at serve time so a
// scraper can't fingerprint the proxy stack by grepping the served JS. Every
// replacement here targets a NON-functional string only:
//   - //# sourceMappingURL / sourceURL pointers (leak the map + framework name)
//   - .pnpm / node_modules build paths (e.g. "@mercuryworkshop+epoxy-tls@2.1.19")
//   - the author/org names (never referenced at runtime)
//   - console LABEL prefixes like "bare-mux: " (the colon form is only ever a
//     log label; the functional key/channel/worker ids use a hyphen and are
//     left untouched)
// Base-64 safety: .pnpm/node_modules/sourceMappingURL/"bare-mux:" all contain
// characters ('.', '_', '#', ':') that never occur inside a base64 blob, and
// the org-name rule is anchored with a lookbehind that forbids a preceding
// base64 char - so none of this can corrupt epoxy's inlined base64 wasm.
// NOTE: epoxy/scramjet/wisp WASM export names (wasm.__wbg_epoxy*, scramjet.*)
// are baked into the .wasm binaries and referenced verbatim, so they CANNOT be
// renamed here - that needs a wasm rebuild/patch.
function scrubVendor(code) {
    return String(code)
        .replace(/\s*\/\/[#@]\s*sourceMappingURL=[^\s'"`]+\.map\s*$/, "")
        .replace(/(?:\.{0,2}\/)*(?:node_modules|\.pnpm)\/[^\s"'`)]*/g, "app")
        .replace(/(?<![\w+/])@?(?:mercury[\s._-]?workshop|titanium[\s._-]?network)(?:-dev)?/gi, "webcore")
        .replace(/https?:\/\/github\.com\/[^\s"'`)\]]+/g, "https://github.com/nicecorp/app")
        .replace(/bare-mux:/g, "io:")
        .replace(/\.bareClient/g, "._nc")
        .replace(/__uv\$config/g, "__ne$config")
        .replace(/UVServiceWorker/g, "_NESW")
        .replace(/BareMuxConnection/g, "_NMC")
        .replace(/BareTransport/g, "_NT")
        .replace(/BareClient/g, "_NC")
        .replace(/BareMux/g, "_NM")
        .replace(/(?<![_\/\w])Ultraviolet(?![\w])/g, "_NE")
        .replace(/(?<![_\/\w])ultraviolet(?![\w])/g, "_ne")
        .replace(/\$scramjetController/g, "$_rc")
        .replace(/\$scramjet(?!Controller)/g, "$_rt")
        .replace(/__scramjet_controller/g, "__rt_ctl")
        .replace(/__scramjet(?!_controller)/g, "__rt")
        .replace(/SCRAMJETCLIENT/g, "_RTCLIENT")
        .replace(/SCRAMJETCLIENTNAME/g, "_RTCLIENTNAME")
        .replace(/ScramjetClient/g, "_RtClient")
        .replace(/ScramjetFrame/g, "_RtFrame")
        .replace(/ScramjetFetchHandler/g, "_RtFetchHandler")
        .replace(/ScramjetFetchTrackedClient/g, "_RtFetchTrackedClient")
        .replace(/ScramjetHeaders/g, "_RtHeaders")
        .replace(/scramjet-attr/g, "_rt-attr")
        .replace(/SCRAMJET FUNCTION/g, "_RT FUNCTION")
        .replace(/SCRAMJET INTERNALS/g, "_RT INTERNALS")
        .replace(/a scramjet client/g, "a runtime client")
        .replace(/scramjet version/g, "runtime version")
        .replace(/scramjet is not loaded/g, "runtime is not loaded")
        .replace(/scramjet before/g, "runtime before")
        .replace(/assertRuntimeScramjetVersion/g, "assertRuntimeVersion")
        .replace(/scramjetPath/g, "_rtPath")
        .replace(/scramjetConfig/g, "_rtConfig")
        .replace(/scramjet-injected/g, "_rt-injected")
        .replace(/scramjet original/g, "_rt original")
        .replace(/scramjet realm/g, "_rt realm")
        .replace(/scramjet client global/g, "_rt client global")
        .replace(/loadScramjetWasm/g, "load_RtWasm")
        .replace(/injectScramjet/g, "inject_Rt")
        .replace(/\$scramitize/g, "$_rtSanitize")
        .replace(/(?<!__wbg_)scramtag/g, "_rttag")
        .replace(/scramitize/g, "_rtSanitize")
        .replace(/maskedfiles:\["inject\.js","scramjet\.wasm\.js"\]/g, 'maskedfiles:["inject.js","rt.wasm.js"]')
        .replace(/"scramjet"/g, '"_rt"')
        .replace(/UVClient/g, "_NEC")
        .replace(/__uv(?!\$config)/g, "__ne")
        .replace(/baremuxinit/g, "_nmioinit")
        .replace(/bare-mux(?![\w])/g, "net-io")
        .replace(/(?<![_\w])baremux(?![_\w])/gi, "netio")
        .replace(/(?<!__wbg_)(?<![\w])Epoxy(?=Client|WebSocket|Handlers|Options)/g, "_Tn")
        .replace(/(?<!__wbg_)(?<![\w])epoxy(?=_client|_websocket|_handlers)/g, "_tn")
        .replace(/["']\/scramjet\//g, (m) => m[0] + "/edu/res/")
        .replace(/["']\/controller\//g, (m) => m[0] + "/edu/core/")
        .replace(/importScripts\(["']\/scramjet\//g, 'importScripts("/edu/res/')
        .replace(/importScripts\(["']\/controller\//g, 'importScripts("/edu/core/')
        .replace(/scramjet\.js/g, "rt.js")
        .replace(/scramjet\.wasm/g, "rt.wasm")
        .replace(/scramjet\.mjs/g, "rt.mjs");
}

// Serve the proxy framework bundles (UV / bare-mux / epoxy) with the console
// filter prepended to every .js. This silences their chatter in EVERY scope
// they run in - crucially the proxied iframe, which never receives the page
// CONSOLE_INJECT and is where the UV bundle's embedded bare-mux logs leak from.
function filteredProxyStatic(dirAbs) {
    const fallback = express.static(dirAbs);
    const cache = new Map();
    return function (req, res, next) {
        // Cover classic scripts AND ES modules (.mjs) - bare-mux and the epoxy
        // transport are pulled in via `import("/mx/index.mjs")` / "/ex/index.mjs".
        if ((req.method !== "GET" && req.method !== "HEAD") || !/\.(?:js|mjs|cjs)$/i.test(req.path)) {
            return fallback(req, res, next);
        }
        let rel;
        try { rel = decodeURIComponent(req.path).replace(/^\/+/, ""); } catch { return fallback(req, res, next); }
        const filePath = path.normalize(path.join(dirAbs, rel));
        if (!filePath.startsWith(dirAbs)) return fallback(req, res, next);
        let stat;
        try { stat = fs.statSync(filePath); if (!stat.isFile()) return fallback(req, res, next); }
        catch { return fallback(req, res, next); }
        const key = filePath + ":" + stat.mtimeMs;
        let out = cache.get(key);
        if (out === undefined) {
            try { out = _WORKER_CONSOLE_FILTER + scrubVendor(fs.readFileSync(filePath, "utf8")); }
            catch { return fallback(req, res, next); }
            if (cache.size > 32) cache.clear();
            cache.set(key, out);
        }
        res.type("application/javascript");
        res.set("Cache-Control", "no-cache");
        if (req.method === "HEAD") return res.end();
        res.send(out);
    };
}

const _epoxyDir = path.join(__dirname, "node_modules/@mercuryworkshop/epoxy-transport/dist");
const _baremuxDir = path.join(__dirname, "node_modules/@mercuryworkshop/bare-mux/dist");
const _uvDir = path.join(__dirname, "node_modules/@titaniumnetwork-dev/ultraviolet/dist");
const _sjCoreDir = path.join(__dirname, "node_modules/@mercuryworkshop/scramjet/dist");
const _sjCtlDir = path.join(__dirname, "node_modules/@mercuryworkshop/scramjet-controller/dist");

// ── Runtime module routes ───────────────────────────────────────────────
// Public paths are neutral ("/app/modules/*") so the network tab / a scraper
// sees ordinary app-bundle URLs instead of named proxy frameworks. The dirs
// underneath are unchanged.
app.use("/app/modules/io", filteredProxyStatic(_epoxyDir));    // network transport
app.use("/app/modules/net", filteredProxyStatic(_baremuxDir)); // transport mux

// Ultraviolet's dist ships tell-tale filenames (uv.bundle.js, uv.sw.js, ...).
// Serve the four files the client needs under opaque names, with the console
// filter prepended and any sourceMappingURL comment stripped (it points back at
// uv.*.js.map and would re-leak the framework name).
const _vendorCache = new Map();
function serveVendorJs(absFile) {
    return (req, res) => {
        let stat;
        try { stat = fs.statSync(absFile); } catch { return res.sendStatus(404); }
        const key = absFile + ":" + stat.mtimeMs;
        let out = _vendorCache.get(key);
        if (out === undefined) {
            try {
                out = _WORKER_CONSOLE_FILTER + scrubVendor(fs.readFileSync(absFile, "utf8"));
            } catch { return res.sendStatus(404); }
            if (_vendorCache.size > 32) _vendorCache.clear();
            _vendorCache.set(key, out);
        }
        res.type("application/javascript").set("Cache-Control", "no-cache");
        if (req.method === "HEAD") return res.end();
        res.send(out);
    };
}
app.get("/app/modules/core/core.js", serveVendorJs(path.join(_uvDir, "uv.bundle.js")));
app.get("/app/modules/core/h.js",    serveVendorJs(path.join(_uvDir, "uv.handler.js")));
app.get("/app/modules/core/c.js",    serveVendorJs(path.join(_uvDir, "uv.client.js")));
app.get("/app/modules/core/s.js",    serveVendorJs(path.join(_uvDir, "uv.sw.js")));

app.use("/edu/res", filteredProxyStatic(_sjCoreDir));
app.get("/edu/res/rt.js", (req, res, next) => { req.url = "/scramjet.js"; filteredProxyStatic(_sjCoreDir)(req, res, next); });
app.get("/edu/res/rt.wasm", (req, res) => {
    const f = path.join(_sjCoreDir, "scramjet.wasm");
    try { res.type("application/wasm").set("Cache-Control", "public, max-age=31536000, immutable").sendFile(f); } catch { res.sendStatus(404); }
});
app.get("/edu/res/rt.mjs", (req, res, next) => { req.url = "/scramjet.mjs"; filteredProxyStatic(_sjCoreDir)(req, res, next); });
app.use("/edu/core", filteredProxyStatic(_sjCtlDir));

// bare-mux SharedWorker script, neutral name.
const _muxJsRaw = fs.readFileSync(path.join(__dirname, "node_modules/@mercuryworkshop/bare-mux/dist/worker.js"), "utf8");
const _muxJs = _WORKER_CONSOLE_FILTER + scrubVendor(_muxJsRaw);
app.get("/app/worker.js", (req, res) => res.type("application/javascript").set("Cache-Control", "no-cache").send(_muxJs));

// Page service worker + its config. uv-worker.js / uv-config.js already point at
// the neutral paths above, so no path rewriting is needed here anymore.
const _pageInitJs = _WORKER_CONSOLE_FILTER + fs.readFileSync(path.join(__dirname, "_engine/uv-worker.js"), "utf8");
app.get("/service-worker.js", (req, res) => res.type("application/javascript").set("Cache-Control", "no-cache").send(_pageInitJs));

const _pageConfigJs = fs.readFileSync(path.join(__dirname, "_engine/uv-config.js"), "utf8");
app.get("/app/settings.js", (req, res) => res.type("application/javascript").set("Cache-Control", "no-cache").send(_pageConfigJs));

const _scramSwJs = _WORKER_CONSOLE_FILTER +
    'importScripts("/edu/core/controller.sw.js");' +
    'self.addEventListener("fetch",function(e){try{if(self.$_rc&&$_rc.shouldRoute(e)){return e.respondWith($_rc.route(e));}}catch(err){}});';
app.get("/service-worker-x.js", (req, res) => res.type("application/javascript").set("Cache-Control", "no-cache").send(_scramSwJs));

// ─── Page-side console filter + ASCII banner ───────────────────────────
// Drops any console message that mentions the underlying proxy frameworks
// (bare-mux, ultraviolet, epoxy, wisp, etc.) and prints a clean Nocturne
// banner on init. Re-callable via window.__nocBanner() on user actions.
const CONSOLE_INJECT = '<script>(function(){try{'
    + 'if(window.__nocFilt)return;window.__nocFilt=1;'
    + 'var BAD=' + _NOC_FILTER_RE + ';'
    + 'var O={};["log","warn","error","info","debug","trace"].forEach(function(k){'
    +   'var o=console[k];if(typeof o!=="function")return;O[k]=o;'
    +   'console[k]=function(){try{for(var i=0;i<arguments.length;i++){var v=arguments[i];'
    +     'var s=(typeof v==="string")?v:(v&&v.message)?v.message:"";'
    +     'if(s&&BAD.test(s))return;}}catch(e){}return o.apply(console,arguments);};'
    + '});'
    + 'var B=' + JSON.stringify("\n" + _NOC_BANNER + "\n\n              nocturne.lol\n") + ';'
    + 'window.__nocBanner=function(){try{(O.log||function(){}).call(console,"%c"+B,"color:#b8b0da;font-family:ui-monospace,monospace;font-size:11px;line-height:1.2");}catch(e){}};'
    + 'if(window.self===window.top&&!window.__nocB1){window.__nocB1=1;window.__nocBanner();'
    +   'var L=O.log||function(){};'
    +   'try{if(localStorage.getItem("nocturne-onboarded")==="1")L.call(console,"spared onboarding");}catch(e){}'
    +   'try{var _vm=(new URLSearchParams(location.search).get("mode")||localStorage.getItem("view-mode")||"std").toLowerCase();L.call(console,"mode="+(_vm==="exp"?"6b":"6a"));}catch(e){}'
    +   'try{fetch("/api/auth/me",{credentials:"same-origin",cache:"no-store"}).then(function(r){return r.json();}).then(function(m){if(m&&m.authenticated&&m.user)L.call(console,"user logged in ("+m.user.id+")");}).catch(function(){});}catch(e){}'
    + '}'
    + '}catch(e){}})();</script>';

// ─── Global background-palette injection ────────────────────────────────
// Every HTML response gets a self-contained <style>+<script> block that
// reads localStorage["nocturne-bg-theme"] and paints the chosen palette,
// so the user's chosen backdrop applies across all pages including 404.
const BG_INJECT = '<!--nocturne-bg-inject-->'
    + '<style>'
    + '#bgCanvas{position:fixed;inset:0;z-index:0;pointer-events:none}'
    + '#bgAurora{position:fixed;inset:0;z-index:0;pointer-events:none;opacity:0;transition:opacity 1.2s cubic-bezier(.22,.72,.14,1);filter:blur(44px);background:#05060d;will-change:transform,opacity;transform-origin:center center;backface-visibility:hidden}'
    + '#bgAurora.active{opacity:1}'
    + '#bgAurora.theme-aurora{background:radial-gradient(60% 50% at 18% 22%,rgba(155,218,176,.18),transparent 60%),radial-gradient(55% 50% at 82% 78%,rgba(149,200,224,.22),transparent 60%),radial-gradient(45% 40% at 62% 36%,rgba(184,176,218,.22),transparent 60%),#05060d;animation:nbgAur 36s cubic-bezier(.45,0,.55,1) infinite alternate}'
    + '#bgAurora.theme-nebula{background:radial-gradient(70% 60% at 22% 28%,rgba(190,110,210,.24),transparent 60%),radial-gradient(60% 55% at 78% 72%,rgba(110,110,230,.26),transparent 60%),radial-gradient(48% 42% at 50% 50%,rgba(220,140,200,.14),transparent 60%),#05060d;animation:nbgNeb 48s cubic-bezier(.45,0,.55,1) infinite alternate}'
    + '#bgAurora.theme-ocean{background:radial-gradient(65% 55% at 20% 25%,rgba(80,150,200,.26),transparent 60%),radial-gradient(55% 50% at 80% 75%,rgba(60,200,180,.22),transparent 60%),radial-gradient(45% 40% at 50% 55%,rgba(100,180,220,.18),transparent 60%),linear-gradient(180deg,#03060d 0%,#060d18 100%);animation:nbgOce 40s cubic-bezier(.45,0,.55,1) infinite alternate}'
    + '#bgAurora.theme-sunset{background:radial-gradient(70% 60% at 22% 78%,rgba(232,130,102,.22),transparent 60%),radial-gradient(60% 55% at 78% 28%,rgba(186,96,138,.28),transparent 60%),radial-gradient(50% 45% at 50% 50%,rgba(220,150,132,.16),transparent 60%),linear-gradient(180deg,#0d0612 0%,#1c0a1a 100%);animation:nbgSun 44s cubic-bezier(.45,0,.55,1) infinite alternate}'
    + '#bgAurora.theme-mono{background:radial-gradient(60% 50% at 30% 30%,rgba(200,200,222,.07),transparent 60%),radial-gradient(50% 45% at 70% 70%,rgba(180,180,210,.05),transparent 60%),linear-gradient(180deg,#0a0a10 0%,#050508 100%);animation:nbgMon 32s cubic-bezier(.45,0,.55,1) infinite alternate}'
    + '#bgAurora.theme-embers{background:radial-gradient(45% 40% at 24% 72%,rgba(224,112,60,.18),transparent 60%),radial-gradient(40% 35% at 76% 28%,rgba(204,80,52,.16),transparent 60%),radial-gradient(35% 30% at 60% 60%,rgba(232,142,80,.10),transparent 60%),linear-gradient(180deg,#0a0508 0%,#08060d 100%);animation:nbgEmb 34s cubic-bezier(.45,0,.55,1) infinite alternate}'
    + '@keyframes nbgAur{0%{background-position:0% 0%,100% 100%,50% 50%;transform:translate3d(0,0,0) scale(1)}100%{background-position:8% 4%,92% 96%,48% 52%;transform:translate3d(-.6%,.4%,0) scale(1.015)}}'
    + '@keyframes nbgNeb{0%{transform:translate3d(0,0,0) scale(1) rotate(0deg)}100%{transform:translate3d(-.4%,.3%,0) scale(1.02) rotate(.6deg)}}'
    + '@keyframes nbgOce{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(-.8%,.5%,0) scale(1.018)}}'
    + '@keyframes nbgSun{0%{transform:translate3d(0,0,0) scale(1)}100%{transform:translate3d(.4%,-.4%,0) scale(1.014)}}'
    + '@keyframes nbgMon{0%{opacity:1;transform:scale(1)}100%{opacity:.86;transform:scale(1.01)}}'
    + '@keyframes nbgEmb{0%{opacity:1;transform:translate3d(0,0,0) scale(1)}100%{opacity:.88;transform:translate3d(.3%,-.3%,0) scale(1.015)}}'
    + '</style>'
    + '<script>(function(){try{'
    + 'var fstack=localStorage.getItem("nocturne-font-stack")||"";if(fstack){var fcss=localStorage.getItem("nocturne-font-css")||"";if(fcss&&!document.getElementById("nocFontLink")){var fl=document.createElement("link");fl.id="nocFontLink";fl.rel="stylesheet";fl.href="https://fonts.googleapis.com/css2?family="+fcss+"&display=swap";(document.head||document.documentElement).appendChild(fl)}document.documentElement.style.setProperty("--font",fstack)}'
    + 'var t=localStorage.getItem("nocturne-bg-theme")||"stars";var known=["aurora","nebula","ocean","sunset","mono","embers"];'
    + 'function img(){var bimg=localStorage.getItem("nocturne-bg-image")||"";if(!bimg)return;var be=document.getElementById("__nocturneBg");if(!be){be=document.createElement("div");be.id="__nocturneBg";be.style.cssText="position:fixed;inset:0;z-index:0;pointer-events:none;background-position:center;background-size:cover;background-repeat:no-repeat;transition:opacity .2s,filter .2s";document.body.insertBefore(be,document.body.firstChild)}be.style.backgroundImage=\'url("\'+bimg+\'")\';be.style.opacity=(parseInt(localStorage.getItem("nocturne-bg-opacity"),10)||100)/100;be.style.filter="blur("+(parseInt(localStorage.getItem("nocturne-bg-blur"),10)||0)+"px)"}'
    + 'function init(){img();var c=document.getElementById("bgCanvas");if(t==="stars"){if(!c){c=document.createElement("canvas");c.id="bgCanvas";document.body.insertBefore(c,document.body.firstChild)}if(!document.querySelector(\'script[src="/src/js/wz6714.js"]\')){var s=document.createElement("script");s.src="/src/js/wz6714.js";s.defer=true;document.head.appendChild(s)}return}if(c)c.style.display="none";if(t==="off")return;if(known.indexOf(t)===-1)return;var a=document.getElementById("bgAurora");if(!a){a=document.createElement("div");a.id="bgAurora";document.body.insertBefore(a,document.body.firstChild)}for(var i=0;i<known.length;i++)a.classList.remove("theme-"+known[i]);a.classList.add("theme-"+t);a.classList.add("active")}if(document.body)init();else document.addEventListener("DOMContentLoaded",init)}catch(e){}})();</script>';

// When a Nocturne page is loaded INSIDE the tab system (an iframe), hide its own
// "back to Nocturne"/Home links and any duplicate top chrome, so navigation
// happens through the parent's left sidebar instead of nesting a second window.
// Exception: the "Open in about:blank" wrapper loads the WHOLE app in an iframe
// (top stays about:blank for cloaking) and tags it with ?nocab=1 — that one must
// keep its full chrome, so we skip embed-mode for it.
const EMBED_INJECT = '<script>(function(){try{var noEmbed=false;try{noEmbed=location.search.indexOf("nocab=1")!==-1;}catch(e){}if(window.self!==window.top&&!noEmbed)document.documentElement.classList.add("noc-embedded");}catch(e){}})();</script>'
    + '<style>html.noc-embedded a[href="/"],html.noc-embedded a[href="/index.html"],html.noc-embedded a.brand,html.noc-embedded #tabStrip,html.noc-embedded #toolbar,html.noc-embedded #dock,html.noc-embedded .discord-chip,html.noc-embedded #navRail{display:none!important}</style>';

// ─── Anti-inspect guard ────────────────────────────────────────────────────
// Best-effort deterrent against casual code-skimming: traps F12 / Ctrl+U /
// Ctrl+Shift+I,J,C, blocks the right-click menu (except in inputs/editors), and
// watches for an open devtools pane (viewport-delta heuristic) — on any of these
// it blanks the page. This is a speed-bump, not real security: anyone can disable JS,
// read the Network tab, or proxy the traffic. The real frontend is already
// obfuscated + served behind the decoy/cloak; this just hides it from a glance.
// Escape hatch for development: visit /?guard=off (re-enable with /?guard=on).
// Only ever runs in the top window, so proxied iframes are untouched.
const ANTIINSPECT_INJECT = '<script>(function(){try{'
    + 'if(window.self!==window.top)return;'
    + 'var sp;try{sp=new URLSearchParams(location.search);}catch(e){sp=null;}'
    + 'try{if(sp){if(sp.get("guard")==="off")localStorage.setItem("noc-guard","off");else if(sp.get("guard")==="on")localStorage.removeItem("noc-guard");}}catch(e){}'
    + 'try{if(localStorage.getItem("noc-guard")==="off")return;}catch(e){}'
    + 'var done=false;'
    + 'function bounce(){if(done)return;done=true;try{if(window.stop)window.stop();}catch(e){}try{document.documentElement.innerHTML="";document.title="";}catch(e){}}'
    + 'function editable(t){try{if(!t)return false;var n=(t.tagName||"").toUpperCase();if(n==="INPUT"||n==="TEXTAREA"||n==="SELECT")return true;if(t.isContentEditable)return true;return !!(t.closest&&t.closest(".cm-editor,.monaco-editor,.view-lines,.CodeMirror"));}catch(e){return false;}}'
    + 'window.addEventListener("keydown",function(e){var k=e.keyCode||e.which||0,key=(e.key||"").toLowerCase();'
    + 'if(k===123){e.preventDefault();bounce();}'
    + 'else if(e.ctrlKey&&!e.shiftKey&&!e.altKey&&key==="u"){e.preventDefault();bounce();}'
    + 'else if(e.ctrlKey&&e.shiftKey&&(key==="i"||key==="j"||key==="c")){e.preventDefault();bounce();}'
    + '},true);'
    + 'window.addEventListener("contextmenu",function(e){if(!editable(e.target))e.preventDefault();},true);'
    + 'var base=null,hits=0,GAP=170;'
    + 'function d(){return{w:window.outerWidth-window.innerWidth,h:window.outerHeight-window.innerHeight};}'
    + 'function check(){try{var c=d();if(base===null){base=c;return;}if((c.w-base.w)>GAP||(c.h-base.h)>GAP){hits++;if(hits>=2)bounce();}else{hits=0;}}catch(e){}}'
    + 'setTimeout(function(){base=d();},700);'
    + 'setInterval(check,1000);'
    + '}catch(e){}})();</script>';

// ─── Dynamic Island injection ──────────────────────────────────────────────
// The Caelestia-vibed side taskbar (nav + music + pocket AI + extensions).
// Injected into every first-party page's <head> so it's global chrome, and
// never reaches proxied pages (those go through UV, not serveHtml). The <link>
// is inlined by inlineLocalCss just like the app's other stylesheets.
const ISLAND_INJECT =
    '<link rel="stylesheet" href="/src/css/island.css">'
    + '<script src="/src/js/ph4529.js" defer></script>';

const _htmlCache = new Map();

// Inlined CSS is baked into the cached HTML, so the HTML cache must also bust when
// any /src/css file changes (otherwise edits to CSS never appear without a restart).
let _cssVerCache = { v: 0, at: 0 };
function cssVersion() {
    const now = Date.now();
    if (now - _cssVerCache.at < 2000) return _cssVerCache.v;
    let max = 0;
    try {
        const dir = path.join(__dirname, "public", "src", "css");
        for (const f of fs.readdirSync(dir)) {
            if (!f.endsWith(".css")) continue;
            const mt = fs.statSync(path.join(dir, f)).mtimeMs;
            if (mt > max) max = mt;
        }
    } catch {}
    _cssVerCache = { v: max, at: now };
    return max;
}

// Inline first-party CSS into the page so /src/css/*.css never appear as separate
// (skimmable) network requests. Leaves external (https) stylesheets alone.
function inlineLocalCss(html) {
    return html.replace(/<link\b[^>]*\bhref=["'](\/src\/css\/[^"']+\.css)["'][^>]*>/gi, (m, href) => {
        try {
            const pubRoot = path.join(__dirname, "public");
            const fp = path.normalize(path.join(pubRoot, href));
            if (!fp.startsWith(pubRoot)) return m;
            let css = fs.readFileSync(fp, "utf8");
            css = css.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\s+/g, " ").trim();
            return "<style>" + css + "</style>";
        } catch { return m; }
    });
}

let _wrapperTemplate = null;
function getWrapperTemplate() {
    if (_wrapperTemplate) return _wrapperTemplate;
    let html;
    try {
        html = fs.readFileSync(path.join(__dirname, "public/learn.html"), "utf8");
    } catch {
        return null;
    }
    const overlay = '<script>(function(w,d,s,l,i){'
        + 'w[l]=w[l]||[];w[l].push({"bp.start":new Date().getTime(),event:"bp.js"});'
        + 'var p=d.location.pathname+d.location.search+d.location.hash;'
        + 'var q=new Headers({"Accept":"text/html"});'
        + 'q.set(atob("eC1uZi1yYXc="),"1");'
        + 'fetch(p,{headers:q,credentials:"include",cache:"no-store"})'
        + '.then(function(r){return r.text();})'
        + '.then(function(h){'
        +   'var a=\'<style id="__bp">html{visibility:hidden!important;background:#0a0a0a!important}</style>\';'
        +   'var b=\'<scr\'+\'ipt>(function(){function v(){var e=document.getElementById("__bp");if(e&&e.parentNode)e.parentNode.removeChild(e);}function c(){var l=document.querySelectorAll("link[rel=stylesheet]"),n=0;function f(){n--;if(n<=0){n=-1;requestAnimationFrame(v);}}for(var i=0;i<l.length;i++){var x=l[i];if(x.media&&x.media!=="all"&&!matchMedia(x.media).matches)continue;if(x.sheet)continue;n++;x.addEventListener("load",f,{once:true});x.addEventListener("error",f,{once:true});}if(n===0)requestAnimationFrame(v);setTimeout(v,1200);}if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",c,{once:true});else c();})()\'+\'<\\/scr\'+\'ipt>\';'
        +   'if(/<head[^>]*>/i.test(h)){h=h.replace(/(<head[^>]*>)/i,"$1"+a+b);}else{h=a+b+h;}'
        +   'document.open("text/html","replace");document.write(h);document.close();'
        + '})'
        + '.catch(function(){});'
        + '})(window,document,"script","bpLayer","BP-4821903");</script>';
    if (/<\/body>/i.test(html)) {
        html = html.replace(/<\/body>/i, overlay + "</body>");
    } else {
        html = html + overlay;
    }
    _wrapperTemplate = html;
    return html;
}

// Internal pages that open as in-app TABS (mirrors PAGE_SLUGS in app.js). A
// direct top-level visit to one of these should boot the app and open it as a
// tab, not render the bare page.
const TAB_PAGES = new Set([
    "games.html", "apps.html", "chat.html", "ai.html", "films.html", "music.html",
    "tools.html", "code.html", "youtube.html", "settings.html", "account.html", "privacy.html",
    "terms.html", "dmca.html", "legal.html", "linkcheck.html", "vms.html"
]);

// Extensionless internal-page aliases (mirrors PAGE_SLUGS in app.js). A direct
// visit or refresh of /ai, /games, /code, etc. must resolve to a real page so it
// boots the app, instead of falling through to the proxy ("routes to UV").
const SLUG_PAGES = {
    games: "games.html", g: "games.html", apps: "apps.html",
    chat: "chat.html", vms: "vms.html", vm: "vms.html", ai: "ai.html",
    movies: "films.html", films: "films.html", music: "music.html",
    tools: "tools.html", code: "code.html", editor: "code.html",
    youtube: "youtube.html", yt: "youtube.html",
    api: "api.html",
    settings: "settings.html", account: "account.html",
    privacy: "privacy.html", terms: "terms.html", dmca: "dmca.html",
    legal: "legal.html", linkcheck: "linkcheck.html", links: "linkcheck.html",
    admin: "admin.html", god: "admin.html", cp: "admin.html", panel: "admin.html"
};

// ── Browser-challenge clearance ────────────────────────────────────────────
// First top-level visit shows the "checking your browser" interstitial. The
// in-page JS proves a real browser by fetching the page (x-nf-raw); the server
// answers with a short HMAC-signed clearance cookie, so every later visit
// carries it and skips the check (instant). This is a pure JS/browser check,
// NOT an IP check - VPNs and residential proxies pass like any other browser.
// Only no-JS scrapers/bots never earn a cookie and stay on the interstitial.
const NF_SECRET = crypto.randomBytes(32);
const NF_TTL_MS = 7 * 24 * 60 * 60 * 1000;
function nfSign(exp) {
    return crypto.createHmac("sha256", NF_SECRET).update(String(exp)).digest("base64url").slice(0, 24);
}
function nfIssue() {
    const exp = Date.now() + NF_TTL_MS;
    return exp + "." + nfSign(exp);
}
function nfValid(tok) {
    if (!tok) return false;
    const i = tok.indexOf(".");
    if (i < 1) return false;
    const exp = Number(tok.slice(0, i));
    if (!exp || exp < Date.now()) return false;
    return tok.slice(i + 1) === nfSign(exp);
}
function nfCookie(req) {
    const m = (req.headers.cookie || "").match(/(?:^|;\s*)nf_pass=([^;]+)/);
    return m ? decodeURIComponent(m[1]) : null;
}

// Master switch for the educational decoy cloak. When true every top-level
// document request serves the BrightPath template; in-page JS fetches the real
// page via x-nf-raw and swaps it in with document.write.
const CLOAK_ENABLED = true;

function shouldWrap(req, filePath) {
    if (!CLOAK_ENABLED) return false;
    if (String(req.headers["x-nf-raw"] || "") === "1") return false;
    const base = path.basename(filePath).toLowerCase();
    if (base === "learn.html" || base === "decoy.html") return false;
    // Only cloak genuine top-level page navigations. Internal pages (games,
    // settings, ai, etc.) open as in-app tabs that load via <iframe>, which the
    // browser tags Sec-Fetch-Dest: iframe; those must receive the REAL page, not
    // the decoy shell. Sub-resource fetches (dest empty/other) are served direct
    // too. Header is absent only on ancient browsers, where we still wrap.
    const dest = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
    if (dest && dest !== "document") return false;
    return true;
}

function serveHtml(req, res, filePath, status) {
    const isRaw = String(req.headers["x-nf-raw"] || "") === "1";
    const dest = String(req.headers["sec-fetch-dest"] || "").toLowerCase();
    const topLevelDoc = (!dest || dest === "document");

    // The reveal (x-nf-raw) is only ever performed by a real browser's in-page JS.
    // Refuse it from non-browser/bot User-Agents trying to curl past the cloak -
    // they stay stuck on the "checking" screen. Then reward a real browser with a
    // signed clearance cookie so the next visit skips the check.
    if (isRaw) {
        const ua = String(req.headers["user-agent"] || "");
        if (!ua || /\b(?:curl|wget|python|aiohttp|scrapy|go-http|httpclient|libwww|okhttp|java|node-fetch|axios|got|phantomjs|headless|puppeteer|playwright|selenium|bot|crawler|spider|slurp|httrack)\b/i.test(ua)) {
            res.status(403).end();
            return true;
        }
        res.setHeader("Set-Cookie", "nf_pass=" + nfIssue() + "; Path=/; Max-Age=" + Math.floor(NF_TTL_MS / 1000) + "; SameSite=Lax");
    }

    // With the decoy disabled, a real top-level visit no longer passes through the
    // x-nf-raw reveal that used to mint the clearance cookie - so issue it here
    // instead, keeping the Settings > Security "Passed" badge accurate.
    if (topLevelDoc && !isRaw && !nfCookie(req)) {
        res.setHeader("Set-Cookie", "nf_pass=" + nfIssue() + "; Path=/; Max-Age=" + Math.floor(NF_TTL_MS / 1000) + "; SameSite=Lax");
    }

    // A top-level visit to an internal tab page (direct URL, refresh, or a shared
    // link) hands back the app shell (index.html) so app.js opens the matching tab
    // and cleans the URL to "/". The tab's own iframe loads the bare page directly
    // (Sec-Fetch-Dest: iframe), unaffected.
    if ((isRaw || topLevelDoc) && TAB_PAGES.has(path.basename(filePath).toLowerCase())) {
        filePath = path.join(__dirname, "public", "index.html");
    }

    let stat;
    try { stat = fs.statSync(filePath); } catch { return false; }
    if (!stat.isFile()) return false;

    // Decoy (document) and real (iframe) responses share a URL, so the cache
    // must key on the fetch destination or an iframe could be handed a stale
    // decoy that was cached from an earlier top-level visit.
    res.setHeader("Vary", "Sec-Fetch-Dest");

    if (shouldWrap(req, filePath)) {
        const tmpl = getWrapperTemplate();
        if (tmpl) {
            if (status) res.status(status);
            res.type("text/html").send(tmpl);
            return true;
        }
    }

    const cacheKey = filePath + ":" + stat.mtimeMs + ":" + cssVersion();
    let html = _htmlCache.get(cacheKey);
    if (!html) {
        try {
            let raw = fs.readFileSync(filePath, "utf8");
            if (raw.indexOf("nocturne-bg-inject") !== -1 || path.basename(filePath).toLowerCase() === "decoy.html" || path.basename(filePath).toLowerCase() === "learn.html") {
                html = raw;
            } else {
                // The anti-inspect guard blanks the page on
                // devtools/F12/right-click - part of the same cloak, so it's gated
                // off too when the cloak is disabled (no antivirus page, ever).
                const antiInspect = CLOAK_ENABLED ? ANTIINSPECT_INJECT : "";
                if (/<head[^>]*>/i.test(raw)) {
                    raw = raw.replace(/(<head[^>]*>)/i, "$1" + antiInspect + CONSOLE_INJECT + EMBED_INJECT);
                } else {
                    raw = antiInspect + CONSOLE_INJECT + EMBED_INJECT + raw;
                }
                if (/<\/head>/i.test(raw)) {
                    html = raw.replace(/<\/head>/i, BG_INJECT + ISLAND_INJECT + "</head>");
                } else {
                    html = BG_INJECT + ISLAND_INJECT + raw;
                }
                html = inlineLocalCss(html);
            }
            _htmlCache.set(cacheKey, html);
            if (_htmlCache.size > 64) {
                const firstKey = _htmlCache.keys().next().value;
                _htmlCache.delete(firstKey);
            }
        } catch { return false; }
    }
    if (status) res.status(status);
    res.type("text/html").send(html);
    return true;
}

app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    let pathname = req.path;
    if (pathname === "/") pathname = "/index.html";
    // Resolve a bare internal slug (/ai, /games, /code, ...) to its page file so
    // it is served like the .html and boots the app, never the proxy.
    if (!pathname.includes(".")) {
        const slug = pathname.replace(/^\/+/, "").replace(/\/+$/, "").toLowerCase();
        if (SLUG_PAGES[slug]) pathname = "/" + SLUG_PAGES[slug];
    }
    if (!pathname.toLowerCase().endsWith(".html")) return next();

    const pubRoot = path.join(__dirname, "public");
    const filePath = path.normalize(path.join(pubRoot, pathname));
    if (!filePath.startsWith(pubRoot)) return next();

    if (serveHtml(req, res, filePath)) return;
    next();
});

// Project share links: /s/<username>/<n>. A top-level visit gets the app shell
// (index.html) like any other TAB_PAGES entry, via serveHtml's own Sec-Fetch-Dest
// check; the tab's iframe request for the same path gets the real code.html,
// whose code.js reads the path and fetches /api/projects/share/:username/:seq.
app.get(/^\/s\/[^\/]+\/\d+$/, (req, res) => {
    const filePath = path.join(__dirname, "public", "code.html");
    if (serveHtml(req, res, filePath)) return;
    res.sendFile(filePath);
});

// Obfuscate first-party JS on the fly (source stays readable on disk; what we
// SEND is scrambled). Cached by file mtime; falls back to the original on error.
const OBF_OPTS = {
    compact: true,
    identifierNamesGenerator: "mangled",
    renameGlobals: false,
    // stringArray is DISABLED. Its index can desync on these ES-module files,
    // which either threw (undefined.charAt in the base64 decoder) or, worse,
    // silently returned the wrong string literal - that made dock.js's
    // shouldIntercept("href") read the wrong attribute, so internal-page links
    // navigated the whole page instead of opening a tab. Identifier mangling +
    // compaction still scramble the code without that fragility.
    stringArray: false,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    selfDefending: false,
    debugProtection: false,
    numbersToExpressions: false,
    simplify: true,
    splitStrings: false,
    transformObjectKeys: false,
    unicodeEscapeSequence: false
};
const _obfCache = new Map();
function getObfuscatedJs(filePath) {
    let stat;
    try { stat = fs.statSync(filePath); if (!stat.isFile()) return null; } catch { return null; }
    const key = filePath + ":" + stat.mtimeMs;
    if (_obfCache.has(key)) return _obfCache.get(key);
    let src;
    try { src = fs.readFileSync(filePath, "utf8"); } catch { return null; }
    let out;
    try { out = JavaScriptObfuscator.obfuscate(src, OBF_OPTS).getObfuscatedCode(); }
    catch (e) { console.warn("[obf] failed:", path.basename(filePath), e.message); out = src; }
    if (_obfCache.size > 128) _obfCache.clear();
    _obfCache.set(key, out);
    return out;
}

app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (!/^\/(?:src\/js\/[^?#]+\.js|app\/main\.mjs|app\/runtime\/engine\.mjs)$/i.test(req.path)) return next();
    const pubRoot = path.join(__dirname, "public");
    const filePath = path.normalize(path.join(pubRoot, req.path));
    if (!filePath.startsWith(pubRoot)) return next();
    const code = getObfuscatedJs(filePath);
    if (code == null) return next();
    res.type("application/javascript");
    res.set("Cache-Control", "no-cache");
    if (req.method === "HEAD") return res.end();
    res.send(code);
});

// Standalone single-file build — a thin shell that loads the CDN copy into an
// iframe. Lives outside public/ so it stays a self-contained drop-in artifact.
app.use("/singlefile", express.static(path.join(__dirname, "singlefile"), {
    extensions: ["html"]
}));

app.use(express.static(path.join(__dirname, "public"), {
    extensions: ["html"],
    setHeaders: (res, filePath) => {
        if (filePath.endsWith(".wasm")) res.setHeader("Content-Type", "application/wasm");
    }
}));

app.use((req, res) => {
    if (req.path === "/" || req.path === "/index.html" || req.path.startsWith("/search/")) {
        if (serveHtml(req, res, path.join(__dirname, "public/index.html"))) return;
        return res.sendFile(path.join(__dirname, "public/index.html"));
    }
    const accept = String(req.headers.accept || "");
    if (req.path.startsWith("/api/") || !accept.includes("text/html")) {
        return res.status(404).json({ error: "Not found", path: req.path });
    }
    if (serveHtml(req, res, path.join(__dirname, "public/404.html"), 404)) return;
    res.status(404).sendFile(path.join(__dirname, "public/404.html"));
});

const server = http.createServer(app);

server.on("upgrade", (request, socket, head) => {
    if (ipSanction(clientIp(request)) && !staffFromRequest(request)) {
        socket.destroy();
        return;
    }
    const releaseVisit = holdVisitor(request);
    socket.on("close", releaseVisit);
    // VM (VNC) websocket traffic is reverse-proxied to the provider.
    if (vmProxyUpgrade(request, socket, head)) return;
    if (runnerProxyUpgrade(request, socket, head)) return;
    if (boxesTerminalUpgrade(request, socket, head)) return;
    if (terminalUpgrade(request, socket, head)) return;   // owner-only server terminal
    if (flixProxyUpgrade(request, socket, head)) return;   // before cookie strip (needs nocturne_sid as jar key)
    if (stratusSignalUpgrade(request, socket, head)) return;
    if (voiceUpgrade(request, socket, head)) return;
    if (request.headers["cookie"]) delete request.headers["cookie"];
    countProxySession();   // the only chokepoint every proxied session passes through
    wisp.routeRequest(request, socket, head);
});

process.on("uncaughtException", err => console.error("[nocturne] uncaught:", err));
process.on("unhandledRejection", reason => console.error("[nocturne] unhandled:", reason));

function shutdown(sig) {
    console.log(`\n[nocturne] ${sig} received, closing...`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 5000).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

cfRangesReady.finally(() => server.listen(PORT, () => {
    const bar = "─".repeat(46);
    console.log();
    console.log("  \x1b[1m\x1b[35mNOCTURNE\x1b[0m");
    console.log(`  \x1b[2m${bar}\x1b[0m`);
    console.log(`  \x1b[2mlistening\x1b[0m  http://localhost:${PORT}`);
    console.log(`  \x1b[2mnode\x1b[0m       ${process.version}`);
    console.log();
}));

setTimeout(() => {
    try {
        const jsDir = path.join(__dirname, "public/src/js");
        for (const f of fs.readdirSync(jsDir)) {
            if (f.toLowerCase().endsWith(".js")) { try { getObfuscatedJs(path.join(jsDir, f)); } catch {} }
        }
        try { getObfuscatedJs(path.join(__dirname, "public/app/main.mjs")); } catch {}
        try { getObfuscatedJs(path.join(__dirname, "public/app/runtime/engine.mjs")); } catch {}
        console.log(`[obf] warmed ${_obfCache.size} JS files`);
    } catch {}
}, 600).unref();
