const _r7m = await import("/app/modules/net/index.mjs");
const _k4q = _r7m[atob("X05NQw==")];

const _v9x = "13";

const _p3w = atob("L3NlcnZpY2Utd29ya2VyLmpz");
const _u6j = atob("L3ZpZXcv");

function _h8e(str) {
    if (!str) return str;
    let out = "";
    for (let i = 0; i < str.length; i++) {
        out += i % 2 ? String.fromCharCode(str.charCodeAt(i) ^ 2) : str[i];
    }
    return encodeURIComponent(out);
}

async function clearOldSW() {
    if ("serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        for (const r of regs) await r.unregister();
    }
    await new Promise(r => setTimeout(r, 200));
}

function wipeDB(name, maxMs = 5000) {
    return new Promise(resolve => {
        let done = false;
        const finish = (result) => { if (done) return; done = true; resolve(result); };
        let req;
        try { req = indexedDB.deleteDatabase(name); }
        catch (e) { return finish("throw:" + e.message); }
        req.onsuccess = () => finish("ok");
        req.onerror = () => finish("err:" + (req.error?.name || "?"));
        req.onblocked = () => {};
        setTimeout(() => finish("timeout"), maxMs);
    });
}

async function clearCaches() {
    try {
        const keys = await caches.keys();
        await Promise.all(keys.map(k => caches.delete(k).catch(() => {})));
    } catch (e) {}
}

const ENGINE_DBS = ["__op", atob("X19ydF9jdGw=")];

async function clearEngineState(full) {
    await clearOldSW();
    await clearCaches();
    if (!full) return;
    await Promise.all(ENGINE_DBS.map(n => wipeDB(n)));
    try { localStorage.removeItem(atob("YmFyZS1tdXgtcGF0aA==")); } catch (e) {}
    try { localStorage.removeItem("view-host"); } catch (e) {}
    try { localStorage.removeItem("nocturne-last-autoreset"); } catch (e) {}
    try { sessionStorage.removeItem("view-reload"); } catch (e) {}
}

if (window.self === window.top) {
    const storedVer = localStorage.getItem("nocturne-version");
    const resetFlag = localStorage.getItem("nocturne-reset");
    const switchFlag = localStorage.getItem("view-switch");
    if (storedVer !== _v9x || resetFlag === "true" || switchFlag === "true") {
        await clearEngineState(switchFlag === "true");
        localStorage.setItem("nocturne-version", _v9x);
        localStorage.removeItem("nocturne-reset");
        localStorage.removeItem("view-switch");
    }
}

const AUTO_RESET_COOLDOWN_MS = 60_000;
let autoResetFired = false;

function triggerAutoReset(reason) {
    if (autoResetFired) return false;
    const last = parseInt(localStorage.getItem("nocturne-last-autoreset") || "0", 10);
    if (Date.now() - last < AUTO_RESET_COOLDOWN_MS) return false;
    autoResetFired = true;
    localStorage.setItem("nocturne-last-autoreset", String(Date.now()));
    localStorage.setItem("nocturne-reset", "true");
    setTimeout(() => location.reload(), 50);
    return true;
}

async function _d2p() {
    if (!navigator.serviceWorker) throw new Error("Browser does not support required APIs.");
    const existing = await navigator.serviceWorker.getRegistration("/");
    const existingScript = existing?.active?.scriptURL || existing?.installing?.scriptURL || existing?.waiting?.scriptURL || "";
    const wantScript = new URL(_p3w, location.origin).href;
    if (existing && existingScript && existingScript !== wantScript) {
        await existing.unregister();
    }
    const recheck = await navigator.serviceWorker.getRegistration("/");
    if (recheck) {
        recheck.update().catch(() => {});
    } else {
        const opts = { scope: "/", updateViaCache: "none" };
        await navigator.serviceWorker["regi" + "ster"](_p3w, opts);
    }

    await Promise.race([
        navigator.serviceWorker.ready,
        new Promise((_, rej) => setTimeout(() => rej(new Error("SW ready timeout")), 4000))
    ]);

    if (!navigator.serviceWorker.controller) {
        await new Promise(resolve => {
            navigator.serviceWorker.addEventListener("controllerchange", resolve, { once: true });
            setTimeout(resolve, 1500);
        });
    }

    const currentController = navigator.serviceWorker.controller?.scriptURL || "";
    if (currentController && currentController !== wantScript) {
        const reloadKey = "view-reload";
        if (!sessionStorage.getItem(reloadKey)) {
            sessionStorage.setItem(reloadKey, String(Date.now()));
            location.reload();
            await new Promise(() => {});
        }
    } else {
        sessionStorage.removeItem("view-reload");
    }
}

const _e7c = (() => {
    try {
        const v = (new URLSearchParams(location.search).get("mode") || localStorage.getItem("view-mode") || "exp").toLowerCase();
        return v === "std" ? "std" : "exp";
    } catch (e) { return "exp"; }
})();

let _f4h = null;
async function _n5a() {
    await clearOldSW();
    const path = await _j6v();
    const _r3p = location.protocol === "https:" ? "wss:" : "ws:";
    const _u4k = _r3p + "//" + location.host + path;
    _f4h = await import("/app/runtime/engine.mjs");
    await _f4h._y6e(_u4k);
}

let _z8m = Promise.resolve();
if (window.self === window.top) {
    _z8m = (_e7c === "exp" ? _n5a() : _d2p())
        .catch(e => { triggerAutoReset((_e7c === "exp" ? "sj: " : "sw: ") + e.message); });
}

const _x1l = new _k4q("/app/worker.js");
const _m2f = atob("L2FwcC9tb2R1bGVzL2lvL2luZGV4Lm1qcw==");

function _g5r() {
    return 'const{default:_E}=await import("' + _m2f + '");function _fH(h){if(!h)return h;if(typeof h[Symbol.iterator]==="function")return h;return Object.entries(h)}function _eO(h){if(!h||typeof h!=="object")return h;if(!Array.isArray(h))return h;const o={};for(let i=0;i<h.length;i++){const p=h[i];if(Array.isArray(p)&&p.length>=2){const k=p[0].toLowerCase();o[k]=o[k]?o[k]+", "+p[1]:p[1]}}return o}class _W extends _E{async request(r,m,b,h,s){const rp=await super.request(r,m,b,_fH(h),s);rp.headers=_eO(rp.headers);return rp}connect(u,p,rH,oo,om,oc,oe){return super.connect(u,p,_fH(rH),oo,om,oc,oe)}}return[_W,"' + _m2f + '"];';
}

const _t4n = [atob("L2FwaS9zeW5jLw=="),atob("L2FwaS92MS9zeW5jLw=="),atob("L2FwaS92Mi9jb25uZWN0Lw=="),atob("L2FwaS9yZWFsdGltZS8="),atob("L2FwaS9ub3RpZmljYXRpb25zLw=="),atob("L2FwaS9mZWVkLw=="),atob("L2FwaS9jaGFubmVsLw=="),atob("L2FwaS9zdHJlYW0v")];

function _w3s(a) {
    const out = a.slice();
    for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
}

async function _j6v() {
    const _r3p = location.protocol === "https:" ? "wss:" : "ws:";
    const lastGood = localStorage.getItem("view-host");
    let candidates = _w3s(_t4n);
    if (lastGood && _t4n.includes(lastGood)) candidates = [lastGood, ...candidates.filter(p => p !== lastGood)];
    candidates = candidates.slice(0, 4);
    for (let i = 0; i < candidates.length; i++) {
        const path = candidates[i];
        const url = _r3p + "//" + location.host + path;
        const ok = await new Promise((resolve) => {
            let ws, timer, done = false;
            const finish = (v) => { if (done) return; done = true; clearTimeout(timer); try { ws && ws.close(); } catch (e) {} resolve(v); };
            timer = setTimeout(() => finish(false), i === 0 ? 6000 : 3500);
            try {
                ws = new WebSocket(url);
                ws.onopen = () => finish(true);
                ws.onerror = () => finish(false);
                ws.onclose = () => finish(false);
            } catch (e) { finish(false); }
        });
        if (ok) { try { localStorage.setItem("view-host", path); } catch (e) {} return path; }
        await new Promise(r => setTimeout(r, 150));
    }
    return localStorage.getItem("view-host") || atob("L2FwaS9zeW5jLw==");
}

let _q1d = Promise.resolve();

if (window.self === window.top && _e7c !== "exp") {
    const _r3p = location.protocol === "https:" ? "wss:" : "ws:";
    const code = _g5r();

    const lastGood = localStorage.getItem("view-host");
    let candidates = _w3s(_t4n);
    if (lastGood && _t4n.includes(lastGood)) {
        candidates = [lastGood, ...candidates.filter(p => p !== lastGood)];
    }
    candidates = candidates.slice(0, 3);

    _q1d = (async () => {
        let lastError = null;
        for (let i = 0; i < candidates.length; i++) {
            const path = candidates[i];
            const _u4k = _r3p + "//" + location.host + path;
            const opts = [{ wisp: _u4k }];
            const timeoutMs = i === 0 ? 6000 : 3500;
            try {
                await Promise.race([
                    _x1l.setManualTransport(code, opts),
                    new Promise((_, r) => setTimeout(() => r(new Error("timeout @ " + path)), timeoutMs))
                ]);
                localStorage.setItem("view-host", path);
                window.dispatchEvent(new CustomEvent("nocturne:transport", { detail: { ok: true, path } }));
                _b9k(path);
                return;
            } catch (e) {
                lastError = e;
                await new Promise(r => setTimeout(r, 200));
            }
        }
        const errMsg = (lastError && lastError.message) || "all paths failed";
        window.dispatchEvent(new CustomEvent("nocturne:transport", { detail: { ok: false, error: errMsg } }));
        triggerAutoReset("transport: " + errMsg);
    })();
}

function _b9k(path) {
    const send = () => {
        const c = navigator.serviceWorker?.controller;
        if (!c) return false;
        try { c.postMessage({ type: "nocturne:transport-ready", path }); return true; }
        catch { return false; }
    };
    if (send()) return;
    if ("serviceWorker" in navigator) {
        navigator.serviceWorker.addEventListener("controllerchange", () => { send(); }, { once: true });
        setTimeout(send, 500);
        setTimeout(send, 1500);
    }
}

if (window.self === window.top) {
    window.dispatchEvent(new CustomEvent("nocturne:engine", { detail: { engine: _e7c, ok: true } }));
}

export async function _c3y(url) {
    if (_e7c === "exp") { await _z8m; return null; }
    await Promise.all([_z8m, _q1d]);
    return _u6j + _h8e(url);
}

export async function _a6t(iframe, url, proxiedUrl) {
    if (_e7c === "exp") {
        await _z8m;
        return _f4h._w1f(iframe, url);
    }
    iframe.src = proxiedUrl != null ? proxiedUrl : await _c3y(url);
}
export function _i9w() { return _e7c; }
