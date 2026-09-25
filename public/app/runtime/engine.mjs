

const _s2q = "/sj/";

function _l7r(src) {
    return new Promise((res, rej) => {
        for (const s of document.scripts) if (s.src && s.src.indexOf(src) !== -1) return res();
        const el = document.createElement("script");
        el.src = src; el.async = false;
        el.onload = () => res();
        el.onerror = () => rej(new Error("failed to load " + src));
        document.head.appendChild(el);
    });
}

function _y3p(str) {
    let out = "";
    for (let i = 0; i < str.length; i++) out += i % 2 ? String.fromCharCode(str.charCodeAt(i) ^ 2) : str[i];
    return out;
}
const _c8v = {
    encode: (url) => encodeURIComponent(_y3p(url)),
    decode: (s) => _y3p(decodeURIComponent(s)),
};

let _o5j = null;
let _v2n = null;
const _p6f = new WeakMap();

let _a1s = null;
const _d4w = new WeakMap();
const _u8b = new Map();
let _k3m = 1;
let _r0t = null;

function _g7x(iframe) {
    let id = _d4w.get(iframe);
    if (id == null) {
        id = _k3m++;
        _d4w.set(iframe, id);
        _u8b.set(id, iframe);
    }
    return id;
}
function _i2h(tabId) {
    const iframe = _u8b.get(tabId);
    if (!iframe) return null;
    let url = "", title = "";
    try { url = iframe.contentWindow?.location.href || iframe.src || ""; } catch (e) { url = iframe.src || ""; }
    try { title = iframe.contentDocument?.title || ""; } catch (e) {}
    return { id: tabId, windowId: 1, url, title, active: tabId === _r0t };
}

async function _n4c() {
    let mod;
    try {
        mod = await import("/sapphire/sapphire.bundle.mjs");
    } catch (e) {
        return null;
    }
    const { Sapphire } = mod;
    let backgroundRoot = document.getElementById("__sapphireBackgroundRoot");
    if (!backgroundRoot) {
        backgroundRoot = document.createElement("div");
        backgroundRoot.id = "__sapphireBackgroundRoot";
        backgroundRoot.style.cssText = "position:fixed;left:-9999px;top:-9999px;width:0;height:0;overflow:hidden";
        document.body.appendChild(backgroundRoot);
    }
    const sapphire = new Sapphire({
        backgroundRoot,
        host: {
            getTabId(win) {
                for (const [id, iframe] of _u8b) {
                    try { if (iframe.contentWindow === win) return id; } catch (e) {}
                }
                return null;
            },
            getTab(tabId) { return _i2h(tabId); },
            getAllTabs() {
                const out = [];
                for (const id of _u8b.keys()) { const t = _i2h(id); if (t) out.push(t); }
                return out;
            },
            getActiveTabId() { return _r0t; },
            getTabWindow(tabId) {
                const iframe = _u8b.get(tabId);
                try { return iframe?.contentWindow || null; } catch (e) { return null; }
            },
            navigateTab(tabId, url) {
                const iframe = _u8b.get(tabId);
                if (iframe) _w1f(iframe, url);
            },
            showNotification(title, message) {
                try {
                    if (Notification.permission === "granted") new Notification(title, { body: message });
                } catch (e) {}
            }
        }
    });
    try { await sapphire.init(); } catch (e) { return null; }
    return sapphire;
}

export function _y6e(_u4k) {
    if (_o5j) return _o5j;
    _o5j = (async () => {
        await _l7r(atob("L2VkdS9yZXMvcnQuanM="));
        await _l7r(atob("L2VkdS9jb3JlL2NvbnRyb2xsZXIuYXBpLmpz"));
        const { default: _j3t } = await import(atob("L2FwcC9tb2R1bGVzL2lvL2luZGV4Lm1qcw=="));
        const _h7n = new _j3t({ wisp: _u4k });
        await navigator.serviceWorker.register(atob("L3NlcnZpY2Utd29ya2VyLXguanM="), { scope: "/" });
        await navigator.serviceWorker.ready;
        const _w8s = new URL(atob("L3NlcnZpY2Utd29ya2VyLXguanM="), location.origin).href;
        const _c9b = () => navigator.serviceWorker.controller?.scriptURL === _w8s;
        if (!_c9b()) {
            await new Promise((resolve, reject) => {
                const done = (fn) => {
                    navigator.serviceWorker.removeEventListener("controllerchange", tick);
                    clearInterval(poll); clearTimeout(timer); fn();
                };
                const tick = () => { if (_c9b()) done(resolve); };
                const poll = setInterval(tick, 200);
                const timer = setTimeout(() => done(() => reject(new Error("sw never took control"))), 12000);
                navigator.serviceWorker.addEventListener("controllerchange", tick);
                tick();
            });
        }
        const { Controller: _z5c } = self.$_rc;
        _v2n = new _z5c({
            prefix: _s2q,
            wasmPath: atob("L2VkdS9yZXMvcnQud2FzbQ=="),
            codec: _c8v,
            transport: _h7n,
            serviceworker: navigator.serviceWorker.controller,
        });
        await _v2n.wait();
        try { _v2n.setTransport(_h7n); } catch (e) {}
        _a1s = await _n4c();
        return _v2n;
    })();
    return _o5j;
}

export async function _w1f(iframe, url) {
    const c = await _o5j;
    _r0t = _g7x(iframe);
    let frame = _p6f.get(iframe);
    if (!frame) {
        let plugins;
        if (_a1s) {
            const { SapphireContentScriptPlugin } = await import("/sapphire/sapphire.bundle.mjs");
            plugins = [new SapphireContentScriptPlugin(_a1s, _r0t)];
        }
        frame = c.createFrame(iframe, plugins ? { plugins } : undefined);
        _p6f.set(iframe, frame);
        _a1s?.notifyTabCreated(_r0t);
    }
    _a1s?.notifyTabActivated(_r0t);
    frame.go(url);
    _a1s?.notifyTabUpdated(_r0t, { status: "loading", url });
}

export function _q9r() { return _o5j; }

export function _a4s() { return !!_a1s; }
export async function _x7i(buffer, filename) {
    if (!_a1s) throw new Error("Extensions are unavailable right now.");
    return _a1s.installExtension(buffer, filename);
}
export async function _u2r(extId) { if (_a1s) await _a1s.uninstallExtension(extId); }
export async function _s6e(extId, enabled) { if (_a1s) await _a1s.setExtensionEnabled(extId, enabled); }
export function _g3i() { return _a1s ? _a1s.getInstalledExtensions() : []; }
export function _o8c(cb) { return _a1s ? _a1s.onChange(cb) : () => {}; }
