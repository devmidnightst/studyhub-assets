import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const dataDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "data");
const sanctionFile = path.join(dataDir, "sanctions.json");

export const SANCTION_MESSAGE = "This RANGE has been blocked by Sanctionary";

const DEFAULT_RULES = [{ cidr: "198.17.32.96/32", message: SANCTION_MESSAGE }];

let cfNets = [];
let rules = DEFAULT_RULES.slice();

function ipv4ToInt(ip) {
    const p = String(ip || "").split(".");
    if (p.length !== 4) return null;
    let n = 0;
    for (const part of p) {
        if (!/^\d{1,3}$/.test(part)) return null;
        const o = Number(part);
        if (o > 255) return null;
        n = (n * 256 + o) >>> 0;
    }
    return n;
}

function parseCidr(cidr) {
    const [ip, bitsRaw] = String(cidr || "").split("/");
    const ipn = ipv4ToInt(ip);
    const bits = Number(bitsRaw);
    if (ipn == null || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return { net: (ipn & mask) >>> 0, mask };
}

export function ipv4InCidr(ip, cidr) {
    const parsed = typeof cidr === "string" ? parseCidr(cidr) : cidr;
    const n = ipv4ToInt(ip);
    if (!parsed || n == null) return false;
    return ((n & parsed.mask) >>> 0) === parsed.net;
}

function loadRules() {
    try {
        if (!fs.existsSync(sanctionFile)) {
            fs.mkdirSync(dataDir, { recursive: true });
            fs.writeFileSync(sanctionFile, JSON.stringify(DEFAULT_RULES, null, 2));
        }
        const list = JSON.parse(fs.readFileSync(sanctionFile, "utf8"));
        if (Array.isArray(list) && list.length) rules = list;
    } catch {}
}

loadRules();

export function ipSanction(ip) {
    const clean = String(ip || "").replace(/^::ffff:/, "");
    for (const rule of rules) {
        if (rule && rule.cidr && ipv4InCidr(clean, rule.cidr)) {
            return { cidr: rule.cidr, message: rule.message || SANCTION_MESSAGE };
        }
    }
    return null;
}

function parseViewer(header) {
    const raw = String(header || "").trim();
    if (!raw) return "";
    if (raw.startsWith("[")) {
        const end = raw.indexOf("]");
        return end > 1 ? raw.slice(1, end) : "";
    }
    const v4 = raw.match(/^(\d{1,3}(?:\.\d{1,3}){3})(?::\d+)?$/);
    if (v4) return v4[1];
    if (/^[0-9a-f:]+$/i.test(raw)) return raw;
    return "";
}

function peerOf(req) {
    const direct = String(req.ip || "").replace(/^::ffff:/, "");
    if (direct && direct !== "127.0.0.1" && direct !== "::1") return direct;
    const xff = String(req.headers?.["x-forwarded-for"] || "");
    const hops = xff.split(",").map((s) => s.trim().replace(/^::ffff:/, "")).filter(Boolean);
    if (hops.length) return hops[hops.length - 1];
    return String(req.socket?.remoteAddress || "").replace(/^::ffff:/, "");
}

export function isCloudFrontEdge(ip) {
    return cfNets.some((net) => ipv4InCidr(String(ip || "").replace(/^::ffff:/, ""), net));
}

export function clientIp(req) {
    const peer = peerOf(req);
    const viewer = parseViewer(req.headers?.["cloudfront-viewer-address"]);
    if (viewer && isCloudFrontEdge(peer)) return viewer;
    return peer;
}

export async function refreshCloudFrontRanges() {
    try {
        const r = await fetch("https://ip-ranges.amazonaws.com/ip-ranges.json");
        if (!r.ok) return;
        const data = await r.json();
        const next = [];
        for (const p of data.prefixes || []) {
            if (p.service !== "CLOUDFRONT") continue;
            const net = parseCidr(p.ip_prefix);
            if (net) next.push(net);
        }
        if (next.length) {
            cfNets = next;
            console.log(`[ip] loaded ${next.length} CloudFront ranges`);
        }
    } catch (e) {
        console.warn("[ip] CloudFront range list failed:", e.message);
    }
}

export const cfRangesReady = refreshCloudFrontRanges();
setInterval(() => { refreshCloudFrontRanges(); }, 12 * 60 * 60 * 1000).unref?.();
