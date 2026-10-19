import { _c3y } from "/app/main.mjs";

const cache = new Map();
const MAX_ENTRIES = 24;
const TTL_MS = 60_000;

function setCache(key, value) {
    cache.set(key, { value, at: Date.now() });
    if (cache.size > MAX_ENTRIES) {
        const first = cache.keys().next().value;
        cache.delete(first);
    }
}

export function prefetchedUrl(url) {
    const hit = cache.get(url);
    if (!hit) return null;
    if (Date.now() - hit.at > TTL_MS) { cache.delete(url); return null; }
    return hit.value;
}

async function resolveOne(url) {
    const hit = cache.get(url);
    if (hit && Date.now() - hit.at <= TTL_MS) return;
    if (hit) cache.delete(url);
    try {
        const proxied = await _c3y(url);
        setCache(url, proxied);
    } catch {}
}

export function wireHoverPrefetch(selector = "[data-url]") {
    document.addEventListener("pointerover", e => {
        const el = e.target.closest(selector);
        if (!el) return;
        const url = el.getAttribute("data-url");
        if (url) resolveOne(url);
    }, { passive: true });

    document.addEventListener("focusin", e => {
        const el = e.target.closest(selector);
        if (!el) return;
        const url = el.getAttribute("data-url");
        if (url) resolveOne(url);
    });
}
