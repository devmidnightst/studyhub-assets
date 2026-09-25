// Signup-time network class. Tor exits come from the public exit list.
// VPN / proxy / Tor-via-relay comes from proxycheck. A positive result is cached
// so a signup flood cannot hammer the lookup. A lookup failure does not invent
// a restriction — Tor is still decided locally.
const TOR_URL = "https://check.torproject.org/torbulkexitlist";
const CACHE_MS = 12 * 60 * 60 * 1000;
const torExits = new Set();
const cache = new Map();

function cleanIp(ip) {
    return String(ip || "").replace(/^::ffff:/, "").trim();
}

export async function refreshTorExits() {
    try {
        const r = await fetch(TOR_URL, { signal: AbortSignal.timeout(20_000) });
        if (!r.ok) return;
        const next = new Set();
        for (const line of (await r.text()).split(/\n/)) {
            const ip = line.trim();
            if (ip && !ip.startsWith("#")) next.add(ip);
        }
        if (next.size) {
            torExits.clear();
            for (const ip of next) torExits.add(ip);
        }
    } catch {}
}

refreshTorExits();
setInterval(refreshTorExits, 6 * 60 * 60 * 1000).unref?.();

async function lookup(ip) {
    const hit = cache.get(ip);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    let value = { restricted: false, kind: "" };
    try {
        const r = await fetch("https://proxycheck.io/v2/" + encodeURIComponent(ip) + "?vpn=1&asn=1", {
            signal: AbortSignal.timeout(4500),
            headers: { Accept: "application/json" }
        });
        if (r.ok) {
            const data = await r.json();
            const row = data && data[ip];
            if (row && String(row.proxy || "").toLowerCase() === "yes") {
                const type = String(row.type || "proxy").toLowerCase();
                const kind = type.includes("tor") ? "tor" : type.includes("vpn") ? "vpn" : "proxy";
                value = { restricted: true, kind };
            }
        }
    } catch {}
    cache.set(ip, { at: Date.now(), value });
    return value;
}

// { restricted, kind } kind is "tor", "vpn", or "proxy".
export async function connectionRestricted(ip) {
    const clean = cleanIp(ip);
    if (!clean || clean === "127.0.0.1" || clean === "::1") return { restricted: false, kind: "" };
    if (torExits.has(clean)) return { restricted: true, kind: "tor" };
    return lookup(clean);
}

export const LIMITED_MESSAGE = "This account was created on a VPN, proxy, or Tor connection. AI, chat, and VMs are off. Proxy, games, and settings still work.";
