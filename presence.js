import { clientIp, isCloudFrontEdge } from "./ip.js";

// One person, not one request. A signed-in account counts once no matter how
// many tabs they have. An anonymous visitor counts once per real address.
// Heartbeats and live sockets refresh the mark; a scan of a static file does not.
const TTL_MS = 75_000;
const marks = new Map();

function cleanIp(ip) {
    const v = String(ip || "").replace(/^::ffff:/, "");
    if (!v || v === "127.0.0.1" || v === "::1") return "";
    if (isCloudFrontEdge(v)) return "";
    return v;
}

export function visitorKey(req) {
    if (req?.user?.id) return "u:" + req.user.id;
    const ip = cleanIp(clientIp(req));
    return ip ? "ip:" + ip : "";
}

export function noteVisitor(req) {
    const key = visitorKey(req);
    if (!key) return;
    marks.set(key, Date.now());
}

export function releaseVisitor(req) {
    const key = visitorKey(req);
    if (key) marks.delete(key);
}

// Keep a long-lived socket (chat or the proxy) counted until it actually closes.
// Closing it leaves the last mark in place, so a page that is still heartbeating
// is not dropped, and a tab that really left falls off with the normal timeout.
export function holdVisitor(req) {
    noteVisitor(req);
    const key = visitorKey(req);
    if (!key) return () => {};
    const timer = setInterval(() => marks.set(key, Date.now()), 25_000);
    timer.unref?.();
    let gone = false;
    return () => {
        if (gone) return;
        gone = true;
        clearInterval(timer);
    };
}

export function onlineCount() {
    const cutoff = Date.now() - TTL_MS;
    let n = 0;
    for (const [key, seen] of marks) {
        if (seen >= cutoff) n++;
        else marks.delete(key);
    }
    return n;
}
