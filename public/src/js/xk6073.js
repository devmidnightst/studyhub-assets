

(function() {
    const memoryStorage = {};
    const safeStorage = {
        getItem: function(key) { try { return localStorage.getItem(key); } catch(e) { return memoryStorage[key] || null; } },
        setItem: function(key, value) { try { localStorage.setItem(key, value); } catch(e) { memoryStorage[key] = String(value); } },
        removeItem: function(key) { try { localStorage.removeItem(key); } catch(e) { delete memoryStorage[key]; } }
    };
    try { localStorage.setItem('test', 'test'); localStorage.removeItem('test'); }
    catch(e) { Object.defineProperty(window, 'localStorage', { value: safeStorage, writable: false, configurable: false }); }
    try { document.cookie = 'test=test'; }
    catch(e) { Object.defineProperty(document, 'cookie', { get: function() { return ''; }, set: function() { return true; } }); }
})();

const CONFIG = {
    zones: "https://cdn.jsdelivr.net/gh/gn-math/assets@main/zones.json",
    zonesFallback: "https://cdn.jsdelivr.net/gh/freebuisness/assets@latest/zones.json",
    tagsZones: "https://cdn.jsdelivr.net/gh/sealiee11/gnmathstuff@main/zones.json",
    covers: "https://cdn.jsdelivr.net/gh/gn-math/covers@main",
    coversFallback: "https://cdn.jsdelivr.net/gh/freebuisness/covers@main",
    html: "https://cdn.jsdelivr.net/gh/gn-math/html@main",
    htmlFallback: "https://cdn.jsdelivr.net/gh/freebuisness/html@main",
    stats: "https://data.jsdelivr.com/v1/stats/packages/gh/gn-math/html@main/files?period="
};

let state = {
    games: [],
    libs: { gnmath: null, lumin: null, ckv: null, truffled: null, ugs: null, stratus: null },
    library: (function(){ try { return localStorage.getItem('gameLibrary') || 'gnmath'; } catch(e) { return 'gnmath'; } })(),
    luminReady: false,
    hits: {}, theme: 'modern', categories: [], tagGames: [], tagCount: 0
};

function findGame(id) {
    const s = String(id);
    return state.games.find(g => String(g.id) === s);
}

async function fetchZones() {
    let zonesURL = CONFIG.zones;
    try {
        const r = await fetch("https://api.github.com/repos/gn-math/assets/commits?t=" + Date.now());
        if (r.ok) {
            const j = await r.json();
            if (j[0]?.sha) zonesURL = `https://cdn.jsdelivr.net/gh/gn-math/assets@${j[0].sha}/zones.json`;
        }
    } catch(e) {}

    try {
        const r = await fetch(zonesURL + "?t=" + Date.now());
        if (!r.ok) throw new Error("HTTP " + r.status);
        return { games: await r.json(), source: "primary" };
    } catch(e) {
        const r2 = await fetch(CONFIG.zonesFallback + "?t=" + Date.now());
        if (!r2.ok) throw new Error("Both zones sources failed (HTTP " + r2.status + ")");
        return { games: await r2.json(), source: "fallback" };
    }
}

async function loadGnmathGames() {
    const { games, source } = await fetchZones();
    state.zonesSource = source;
    try {
        const tr = await fetch(CONFIG.tagsZones + "?t=" + Date.now());
        state.tagGames = tr.ok ? await tr.json() : games;
    } catch(e) { state.tagGames = games; }
    if (games[0]) games[0].featured = true;
    return games;
}

// cherrigames libraries (ckv/truffled/ugs) — each its own tab, backed by our own
// /api/games/list (which also mirrors gn-math's zones.json, tagged per source via
// `special`). Filtering client-side here means one fetch covers all three tabs.
let _cherriListPromise = null;
async function fetchCherriList() {
    if (!_cherriListPromise) {
        _cherriListPromise = fetch("/api/games/list?t=" + Date.now()).then(r => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
        }).catch(e => { _cherriListPromise = null; throw e; });
    }
    return _cherriListPromise;
}
async function loadCherriLibrary(source) {
    const all = await fetchCherriList();
    return all.filter(g => g.special?.includes(source));
}

async function ensureLumin() {
    if (state.luminReady) return true;
    let tries = 0;
    while (typeof Lumin === 'undefined' && tries < 120) { await new Promise(r => setTimeout(r, 50)); tries++; }
    if (typeof Lumin === 'undefined') return false;
    await Lumin.init({ headless: true });
    state.luminReady = true;
    return true;
}

// Lumin hands back each page in a random order, and it re-rolls that order on
// every request, so paging straight through it gives a list that is shuffled,
// repeats some games and drops others - and it comes out different on every
// reload. Dedupe by id, keep sweeping while we know games are still missing,
// and sort by name so the library is always the same list in the same order.
const LUMIN_PAGE_LIMIT = 100;
const LUMIN_MAX_PAGES = 60;
const LUMIN_MAX_REQUESTS = 90;

function luminOrder(a, b) {
    const byName = String(a.name || '').localeCompare(String(b.name || ''), 'en', { sensitivity: 'base' });
    return byName || String(a.id).localeCompare(String(b.id));
}

async function loadLuminGames() {
    if (!(await ensureLumin())) throw new Error("Lumin SDK failed to load");

    const byId = new Map();
    let requests = 0, pages = 1, total = 0;

    async function sweep() {
        let added = 0;
        for (let page = 1; page <= pages && requests < LUMIN_MAX_REQUESTS; page++) {
            const res = await Lumin.getGames({ page, limit: LUMIN_PAGE_LIMIT });
            requests++;
            const batch = res.games || res || [];
            pages = Math.min(Number(res.pages) || pages, LUMIN_MAX_PAGES);
            if (Number(res.total) > 0) total = Number(res.total);
            for (const g of batch) {
                const key = g && g.id != null ? String(g.id) : '';
                if (!key || byId.has(key)) continue;
                byId.set(key, g);
                added++;
            }
        }
        return added;
    }

    await sweep();
    // Only re-sweeps when the shuffle actually cost us games, and stops as soon
    // as a full pass stops finding new ones, so a well-behaved API costs nothing.
    while (total && byId.size < total && requests < LUMIN_MAX_REQUESTS) {
        if (!(await sweep())) break;
    }

    return Array.from(byId.values()).map(g => ({
        id: g.id,
        name: g.name,
        image_token: g.image_token,
        category: g.category,
        _lumin: true
    })).sort(luminOrder);
}

function setLibraryChip(lib) {
    document.querySelectorAll('.lib-chip').forEach(c => c.classList.toggle('active', c.dataset.lib === lib));
}

const LIB_LABELS = { lumin: 'Lumin', gnmath: 'gnmath', ckv: 'CKV', truffled: 'Truffled', ugs: 'UGS', seraph: 'Seraph', stratus: 'Cloud' };
const CHERRI_LIBS = ['ckv', 'truffled', 'ugs', 'seraph'];

async function loadLibrary(lib, persist = true) {
    if (!LIB_LABELS[lib]) lib = 'gnmath';
    state.library = lib;
    if (persist) { try { localStorage.setItem('gameLibrary', lib); } catch(e) {} }
    setLibraryChip(lib);

    document.getElementById('searchView')?.classList.add('hidden');
    document.getElementById('modernView')?.classList.remove('hidden');
    const sb = document.getElementById('searchBar'); if (sb) sb.value = '';
    document.querySelectorAll('#catStrip .chip').forEach((c, i) => c.classList.toggle('active', i === 0));

    if (state.libs[lib]) {
        state.games = state.libs[lib];
        sortZones();
        return;
    }

    const grid = document.getElementById('allGamesGrid');
    if (grid) grid.innerHTML = `<div id="loading" style="grid-column: 1 / -1; text-align:center; padding:40px; color: var(--fg-3);"><div class="spinner"></div><div>Please wait - the ${LIB_LABELS[lib]} games are loading. The site may lag.</div></div>`;

    try {
        const games = lib === 'lumin' ? await loadLuminGames()
            : lib === 'gnmath' ? await loadGnmathGames()
            : lib === 'stratus' ? await loadStratusGames()
            : await loadCherriLibrary(lib);
        state.libs[lib] = games;
        state.games = games;
        sortZones();
        if (lib === 'gnmath') { fetchAllStats('year'); getAllStats(); }
    } catch(e) {
        console.error("Library load failed", e);

        if (lib === 'lumin') {
            if (grid) grid.innerHTML = `<div id="loading" style="grid-column: 1 / -1; text-align:center; padding:40px; color: var(--fg-3);"><div class="spinner"></div><div>Please wait - the games are loading. The site may lag.</div></div>`;
            return loadLibrary('gnmath', false);
        }
        if (grid) grid.innerHTML = `<div style="grid-column: 1 / -1; text-align:center; padding:40px; color: var(--fg-3);">Failed to load ${lib} games: ${e.message}</div>`;
    }
}

// ── Stratus cloud gaming ──────────────────────────────────────────────────────

async function loadStratusGames() {
    const r = await fetch('/api/stratus/games');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const data = await r.json();
    if (!Array.isArray(data) || !data.length) throw new Error('No games returned');
    return data.map(g => ({ ...g, _stratus: true, id: g.game_key, name: g.name }));
}

// Renders a cloud game card (portrait ratio, shows description on hover).
function renderCloudCard(g, favs, index) {
    const key = String(g.game_key).replace(/"/g, '&quot;');
    const nameAttr = String(g.name || '').replace(/"/g, '&quot;');
    const starred = isFav(favs, g.game_key) ? ' starred' : '';
    const tags = (g.tags || []).slice(0, 3).join(' · ');
    return `<div class="game-card cloud-card" data-game-id="${key}" data-cover="${(g.cover || g.image || '').replace(/"/g, '&quot;')}" data-index="${index}" onclick="openCloudGame('${key.replace(/'/g, "\\'")}')" title="${nameAttr}">
        <div class="star-icon${starred}" onclick="event.stopPropagation(); toggleFavorite('${key.replace(/'/g, "\\'")}', event)">★</div>
        <img class="card-thumb" alt="" decoding="async" loading="lazy" onerror="this.closest('.game-card').classList.add('no-cover')">
        <span class="card-noimg">${nameAttr}</span>
        <div class="cloud-card-overlay">
            <div class="cloud-card-title">${nameAttr}</div>
            <div class="cloud-card-tags">${tags}</div>
            <button class="cloud-play-btn">▶ Play</button>
        </div>
    </div>`;
}

// ── Cloud gaming session + WebRTC ─────────────────────────────────────────────

let _cloudSession = null;

function _cloudTermLog(msg, cls) {
    const body = document.getElementById('cloudTerminal');
    if (!body) return;
    const now = new Date();
    const ts = now.getHours().toString().padStart(2,'0') + ':' +
               now.getMinutes().toString().padStart(2,'0') + ':' +
               now.getSeconds().toString().padStart(2,'0');
    const line = document.createElement('div');
    line.className = 'cterm-line';
    line.innerHTML = `<span class="cterm-ts">${ts}</span><span class="cterm-msg${cls ? ' ' + cls : ''}">${msg}</span>`;
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;
}

// ── Pool-account animated loader ──────────────────────────────────────────────
// Ping-pong: dots step left→right→left one position at a time.
let _poolLoaderTimer = null;
let _poolLoaderEl = null;
const _PL_FRAMES = ['[•••   ]', '[ •••  ]', '[  ••• ]', '[   •••]', '[  ••• ]', '[ •••  ]'];
let _poolLoaderFrame = 0;
let _poolLoaderDots = null;

function _startPoolLoader() {
    _stopPoolLoader();
    const body = document.getElementById('cloudTerminal');
    if (!body) return;
    const now = new Date();
    const ts = now.getHours().toString().padStart(2,'0') + ':' +
               now.getMinutes().toString().padStart(2,'0') + ':' +
               now.getSeconds().toString().padStart(2,'0');

    const line = document.createElement('div');
    line.className = 'cterm-line';

    const ts_span = document.createElement('span');
    ts_span.className = 'cterm-ts';
    ts_span.textContent = ts;

    const msg = document.createElement('span');
    msg.className = 'cterm-msg';
    msg.style.color = '#f97316';

    const label = document.createTextNode('requesting account from pool  ');
    _poolLoaderDots = document.createElement('span');
    _poolLoaderDots.style.fontFamily = 'monospace';
    _poolLoaderFrame = 0;
    _poolLoaderDots.textContent = _PL_FRAMES[0];

    msg.appendChild(label);
    msg.appendChild(_poolLoaderDots);
    line.appendChild(ts_span);
    line.appendChild(msg);
    body.appendChild(line);
    body.scrollTop = body.scrollHeight;

    _poolLoaderEl = line;
    _poolLoaderTimer = setInterval(function() {
        _poolLoaderFrame = (_poolLoaderFrame + 1) % _PL_FRAMES.length;
        if (_poolLoaderDots) _poolLoaderDots.textContent = _PL_FRAMES[_poolLoaderFrame];
    }, 350);
}

function _stopPoolLoader() {
    clearInterval(_poolLoaderTimer);
    _poolLoaderTimer = null;
    _poolLoaderDots = null;
    _poolLoaderEl = null;
}

function showCloudViewer(name) {
    document.getElementById('cloudName').textContent = name;
    const sn = document.getElementById('cloudStepsName');
    if (sn) sn.textContent = name;
    const badge = document.getElementById('cloudSpinnerLabel');
    if (badge) badge.textContent = '';
    document.getElementById('cloudLoadMsg').textContent = '';
    document.getElementById('cloudQueuePos').textContent = '';
    const s3s = document.getElementById('cstep-3-sub');
    if (s3s) s3s.textContent = '';
    const term = document.getElementById('cloudTerminal');
    if (term) term.innerHTML = '';
    for (let i = 0; i < 4; i++) {
        const el = document.getElementById('cstep-' + i);
        if (el) el.className = 'cstep pending';
    }
    const bar = document.getElementById('cstepsBar');
    if (bar) bar.style.width = '0%';
    document.getElementById('cloudLoading').style.display = 'flex';
    document.getElementById('cloudVideo').style.display = 'none';
    document.getElementById('cloudFsBtn').style.display = 'none';
    document.getElementById('cloudViewer').style.display = 'flex';
    document.querySelector('nav.nav').style.display = 'none';
    document.querySelector('main').style.display = 'none';
    document.querySelector('footer').style.display = 'none';
    unloadAllCardImages();
    _startCloudTimer();
    _stopPoolLoader();
    _cloudTermLog('Starting session…', 'dim');
}

const _CSTEP_LABELS = ['Creating account…', 'Requesting game…', 'In queue…', 'Starting stream…'];
const _CSTEP_BAR   = ['12%', '35%', '60%', '85%'];

let _cloudTimerInterval = null, _cloudTimerSecs = 0;

function _startCloudTimer() {
    _cloudTimerSecs = 0;
    clearInterval(_cloudTimerInterval);
    const el = document.getElementById('cstepsTimer');
    if (el) el.textContent = '0:00';
    _cloudTimerInterval = setInterval(() => {
        _cloudTimerSecs++;
        const m = Math.floor(_cloudTimerSecs / 60);
        const s = String(_cloudTimerSecs % 60).padStart(2, '0');
        if (el) el.textContent = m + ':' + s;
    }, 1000);
}

function _stopCloudTimer() {
    clearInterval(_cloudTimerInterval);
    _cloudTimerInterval = null;
}

function setCloudStep(idx, sub) {
    for (let i = 0; i < 4; i++) {
        const el = document.getElementById('cstep-' + i);
        if (!el) continue;
        el.className = 'cstep ' + (i < idx ? 'done' : i === idx ? 'active' : 'pending');
    }
    const qEl = document.getElementById('cloudQueuePos');
    if (qEl) qEl.textContent = (idx === 2 && sub) ? sub : '';
    const s3El = document.getElementById('cstep-3-sub');
    if (s3El) s3El.textContent = (idx === 3 && sub) ? sub : '';
    const badge = document.getElementById('cloudSpinnerLabel');
    if (badge) badge.textContent = _CSTEP_LABELS[idx] || '';
    const bar = document.getElementById('cstepsBar');
    if (bar) bar.style.width = _CSTEP_BAR[idx] || '12%';
}

function showCloudStream() {
    _stopCloudTimer();
    const bar = document.getElementById('cstepsBar');
    if (bar) bar.style.width = '100%';
    document.getElementById('cloudLoading').style.display = 'none';
    const vid = document.getElementById('cloudVideo');
    vid.style.display = 'block';
    document.getElementById('cloudFsBtn').style.display = '';
    document.getElementById('cloudStatusBadge').textContent = 'Live';
    _cloudAttachInput();
    _cloudSetHint(false);
}

// Reads the NDJSON stream from createSession. The stream ends after either:
//   {status:"queue", uuid, queue_pos}      → session is queued, must poll getQueue
//   {status:"finished_queue", uuid}        → ready immediately
//   {status:"error", error}               → failed
// Returns {uuid, queued: boolean}
async function createSession(game_key) {
    const r = await fetch('/api/stratus/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ game_key })
    });
    if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || 'Session error (HTTP ' + r.status + ')');
    }

    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    let result = null;

    while (true) {
        const { done, value } = await reader.read();
        if (value) buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
            if (!line.trim()) continue;
            let evt;
            try { evt = JSON.parse(line); } catch { continue; }
            const t = evt.status || evt.type || '';
            if (t === 'log') {
                _cloudTermLog(evt.msg || '');
            } else if (t === 'pool_account') {
                setCloudStep(0);
                _startPoolLoader();
            } else if (t === 'creating_account') {
                setCloudStep(0);
                _cloudTermLog('Creating account…', 'dim');
            } else if (t === 'account_ready') {
                _stopPoolLoader();
                _cloudTermLog('Account ready', 'dim');
            } else if (t === 'requesting_game') {
                setCloudStep(1);
                _cloudTermLog('Requesting game slot…', 'dim');
            } else if (t === 'queue') {
                const _pos = evt.queue_pos ?? evt.position;
                setCloudStep(2, _pos != null ? 'Position #' + _pos : '');
                _cloudTermLog(_pos != null ? `In queue — position #${_pos}` : 'Joined queue', 'dim');
                result = { uuid: evt.uuid, queued: true };
            } else if (t === 'finished_queue') {
                _cloudTermLog('Queue cleared — starting stream…', 'dim');
                result = { uuid: evt.uuid, queued: false };
            } else if (t === 'error') {
                _stopPoolLoader();
                _cloudTermLog(evt.error || evt.message || 'Session error', 'error');
                throw new Error(evt.error || evt.message || 'Session error');
            }
        }
        if (done) {
            // Flush any trailing bytes that weren't followed by a newline.
            if (buf.trim()) {
                let evt;
                try { evt = JSON.parse(buf); } catch { /* malformed trailing data — ignore */ }
                if (evt) {
                    const t = evt.status || evt.type || '';
                    if (t === 'queue') { _stopPoolLoader(); const _p2 = evt.queue_pos ?? evt.position; setCloudStep(2, _p2 != null ? 'Position #' + _p2 : ''); result = { uuid: evt.uuid, queued: true }; }
                    else if (t === 'finished_queue') { _stopPoolLoader(); result = { uuid: evt.uuid, queued: false }; }
                    else if (t === 'error') { _stopPoolLoader(); throw new Error(evt.error || evt.message || 'Session error'); }
                }
            }
            break;
        }
    }

    if (!result) throw new Error('Session stream ended without a result');
    return result;
}

// Poll GET /api/stratus/queue until the session leaves the queue.
async function pollQueue(uuid) {
    while (true) {
        await new Promise(r => setTimeout(r, 3500));
        let d;
        try {
            const r = await fetch('/api/stratus/queue?uuid=' + encodeURIComponent(uuid));
            d = await r.json();
        } catch { continue; }
        const t = d.status || '';
        if (t === 'finished_queue') return;
        if (t === 'queue') setCloudStep(2, d.queue_pos != null ? 'Position #' + d.queue_pos : '');
        else if (d.error) {
            const msg = String(d.error);
            if (msg.includes('is not valid JSON') || msg.includes('not valid JSON')) continue;
            throw new Error(msg);
        }
    }
}

async function startSession(uuid) {
    const r = await fetch('/api/stratus/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid })
    });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Start error');
    return d;
}

function startPing(uuid) {
    let alive = true;
    const interval = setInterval(async () => {
        if (!alive) return;
        try {
            await fetch('/api/stratus/ping', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ uuid })
            });
        } catch {}
    }, 20_000);
    return () => { alive = false; clearInterval(interval); };
}

async function quitSession(uuid) {
    if (!uuid) return;
    try {
        await fetch('/api/stratus/quit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ uuid })
        });
    } catch {}
}

// ── Cloud input system ────────────────────────────────────────────────────────
let _cloudDc = null;
let _cloudFocused = false;
let _cloudPointerLocked = false;
let _cloudVMouseX = 0, _cloudVMouseY = 0;
let _cloudCurX = 0, _cloudCurY = 0;
let _cloudMouseButtons = 0;
const _cloudActiveKeys = new Set();
let _cloudEscTimer = null;
let _cloudInputRafId = null;

function _cloudGetVideoRect() {
    const vid = document.getElementById('cloudVideo');
    const rect = vid.getBoundingClientRect();
    const vw = vid.videoWidth || rect.width;
    const vh = vid.videoHeight || rect.height;
    const scale = Math.min(rect.width / vw, rect.height / vh);
    const rw = vw * scale, rh = vh * scale;
    return { left: rect.left + (rect.width - rw) / 2, top: rect.top + (rect.height - rh) / 2, width: rw, height: rh };
}

function _cloudDcSend(buf) {
    if (_cloudDc && _cloudDc.readyState === 'open') _cloudDc.send(buf);
}

function _cloudSendKey(keyCode, isDown) {
    if (isDown) _cloudActiveKeys.add(keyCode); else _cloudActiveKeys.delete(keyCode);
    const buf = new ArrayBuffer(24), v = new DataView(buf);
    v.setUint8(0, 1); v.setUint8(2, 1); v.setUint8(3, 1);
    v.setUint16(4, keyCode); v.setUint8(6, isDown ? 1 : 0);
    let offset = 7;
    for (const k of _cloudActiveKeys) {
        if (k !== keyCode && k > 0 && k < 255 && offset < 21) {
            v.setUint16(offset, k); offset += 2;
            v.setUint8(offset, 1); offset++;
        }
    }
    v.setUint8(offset++, 255);
    v.setUint8(1, offset - 1);
    _cloudDcSend(buf.slice(0, offset));
}

function _cloudSendMouse(moveX = 0, moveY = 0, scroll = 0) {
    moveX = Math.max(-127, Math.min(127, moveX));
    moveY = Math.max(-127, Math.min(127, moveY));
    const r = _cloudGetVideoRect();
    const absX = Math.floor(((_cloudCurX - r.left) / r.width) * 10000);
    const absY = Math.floor(((_cloudCurY - r.top) / r.height) * 10000);
    const buf = new ArrayBuffer(12), v = new DataView(buf);
    v.setUint8(0, 1); v.setUint8(1, 11); v.setUint8(2, 2); v.setUint8(3, 8);
    v.setUint16(4, Math.max(0, Math.min(10000, absX)));
    v.setUint16(6, Math.max(0, Math.min(10000, absY)));
    v.setInt8(8, moveX); v.setInt8(9, moveY);
    v.setUint8(10, _cloudMouseButtons); v.setInt8(11, scroll);
    _cloudDcSend(buf);
}

const _CLOUD_GAMEPAD_BTN_MASK = [4096, 8192, 16384, 32768, 256, 512, 0, 0, 32, 16, 64, 128, 1, 2, 4, 8, 0];
function _cloudSendGamepad() {
    const gamepads = navigator.getGamepads?.() || [];
    for (let i = 0; i < gamepads.length; i++) {
        const gp = gamepads[i]; if (!gp) continue;
        let mask = 0, lt = 0, rt = 0;
        for (let b = 0; b < Math.min(gp.buttons.length, 17); b++) {
            const btn = gp.buttons[b];
            const pressed = typeof btn === 'object' ? btn.pressed : btn > 0;
            const value = typeof btn === 'object' ? btn.value : btn;
            if (pressed) {
                if (b === 6) lt = Math.round(value * 255);
                else if (b === 7) rt = Math.round(value * 255);
                else mask |= _CLOUD_GAMEPAD_BTN_MASK[b];
            }
        }
        const ax = gp.axes;
        const lx = ax[0] ? Math.round(32767 * ax[0]) : 0;
        const ly = ax[1] ? Math.round(-32767 * ax[1]) : 0;
        const rx = ax[2] ? Math.round(32767 * ax[2]) : 0;
        const ry = ax[3] ? Math.round(-32767 * ax[3]) : 0;
        const buf = new ArrayBuffer(17), v = new DataView(buf);
        v.setUint8(0, 1); v.setUint8(1, 16); v.setUint8(2, 3); v.setUint8(3, 2); v.setUint8(4, i);
        v.setUint16(5, mask); v.setUint8(7, lt); v.setUint8(8, rt);
        v.setInt16(9, lx); v.setInt16(11, ly); v.setInt16(13, rx); v.setInt16(15, ry);
        _cloudDcSend(buf);
    }
}

function _cloudSetupCursorHandling(dc) {
    const MIMEMAP = { 0: 'image/x-icon', 1: 'image/jpeg', 2: 'image/png', 3: 'image/gif' };
    let cursorUrl = null;
    const vid = document.getElementById('cloudVideo');
    dc.onmessage = (e) => {
        if (!(e.data instanceof ArrayBuffer)) return;
        const dv = new DataView(e.data);
        if (dv.byteLength > 4 && dv.getUint8(0) === 163 && dv.getUint8(1) === 6) {
            if (dv.byteLength <= 32) {
                vid.style.cursor = 'none';
                if (cursorUrl) { URL.revokeObjectURL(cursorUrl); cursorUrl = null; }
            } else {
                const mimeType = MIMEMAP[dv.getUint8(2)] || 'image/png';
                const hotX = dv.getUint8(3), hotY = dv.getUint8(4);
                const blob = new Blob([e.data.slice(5)], { type: mimeType });
                if (cursorUrl) URL.revokeObjectURL(cursorUrl);
                cursorUrl = URL.createObjectURL(blob);
                vid.style.cursor = `url(${cursorUrl}) ${hotX} ${hotY}, default`;
                if (document.pointerLockElement === vid) document.exitPointerLock();
            }
        }
    };
}

function _cloudInputLoop() {
    if (_cloudDc && _cloudDc.readyState === 'open') _cloudSendGamepad();
    _cloudInputRafId = requestAnimationFrame(_cloudInputLoop);
}

function _cloudOnPointerLockChange() {
    const vid = document.getElementById('cloudVideo');
    _cloudPointerLocked = document.pointerLockElement === vid;
    if (_cloudPointerLocked) {
        const r = _cloudGetVideoRect();
        _cloudVMouseX = _cloudCurX - r.left;
        _cloudVMouseY = _cloudCurY - r.top;
    } else {
        navigator.keyboard?.unlock?.();
    }
}
function _cloudSetHint(focused) {
    const h = document.getElementById('cloudClickHint');
    if (!h) return;
    if (focused) {
        h.style.display = 'none';
    } else {
        h.style.display = '';
    }
}
function _cloudOnVideoClick() {
    if (!_cloudDc) return;
    _cloudFocused = true;
    _cloudSetHint(true);
    navigator.keyboard?.lock?.().catch(() => {});
}
function _cloudOnDocClick(e) {
    const vid = document.getElementById('cloudVideo');
    if (_cloudFocused && vid && !vid.contains(e.target)) {
        _cloudFocused = false;
        _cloudSetHint(false);
        navigator.keyboard?.unlock?.();
    }
}
function _cloudOnMouseMove(e) {
    if (_cloudFocused && _cloudDc) {
        const moveX = e.movementX || 0, moveY = e.movementY || 0;
        if (_cloudPointerLocked) {
            const r = _cloudGetVideoRect();
            _cloudVMouseX = Math.max(0, Math.min(r.width, _cloudVMouseX + moveX));
            _cloudVMouseY = Math.max(0, Math.min(r.height, _cloudVMouseY + moveY));
            _cloudCurX = r.left + _cloudVMouseX;
            _cloudCurY = r.top + _cloudVMouseY;
        } else {
            _cloudCurX = e.clientX; _cloudCurY = e.clientY;
        }
        _cloudSendMouse(moveX, moveY, 0);
    } else {
        _cloudCurX = e.clientX; _cloudCurY = e.clientY;
    }
}
function _cloudOnMouseDown(e) {
    if (!_cloudFocused || !_cloudDc) return;
    const vid = document.getElementById('cloudVideo');
    if (vid && vid.style.cursor === 'none' && !_cloudPointerLocked) {
        vid.requestPointerLock().catch(() => {});
    }
    _cloudMouseButtons = e.buttons;
    _cloudSendMouse(0, 0, 0);
}
function _cloudOnMouseUp(e) {
    if (!_cloudFocused || !_cloudDc) return;
    _cloudMouseButtons = e.buttons;
    _cloudSendMouse(0, 0, 0);
}
function _cloudOnContextMenu(e) { if (_cloudFocused) e.preventDefault(); }
function _cloudOnWheel(e) {
    if (!_cloudFocused) return;
    e.preventDefault();
    _cloudSendMouse(0, 0, e.deltaY > 0 ? -1 : 1);
}
function _cloudOnKeyDown(e) {
    if (!_cloudFocused || !_cloudDc) return;
    e.preventDefault(); e.stopPropagation();
    if (e.repeat) return;
    if (e.keyCode === 27 && !_cloudEscTimer) {
        _cloudEscTimer = setTimeout(() => {
            if (document.pointerLockElement) document.exitPointerLock();
            _cloudFocused = false;
            _cloudEscTimer = null;
        }, 3500);
    }
    _cloudSendKey(e.keyCode, true);
}
function _cloudOnKeyUp(e) {
    if (!_cloudFocused || !_cloudDc) return;
    e.preventDefault(); e.stopPropagation();
    if (e.keyCode === 27) { clearTimeout(_cloudEscTimer); _cloudEscTimer = null; }
    _cloudSendKey(e.keyCode, false);
}

function _cloudAttachInput() {
    const vid = document.getElementById('cloudVideo');
    vid.addEventListener('click', _cloudOnVideoClick);
    document.addEventListener('click', _cloudOnDocClick);
    document.addEventListener('pointerlockchange', _cloudOnPointerLockChange);
    document.addEventListener('mousemove', _cloudOnMouseMove);
    document.addEventListener('mousedown', _cloudOnMouseDown);
    document.addEventListener('mouseup', _cloudOnMouseUp);
    document.addEventListener('contextmenu', _cloudOnContextMenu);
    vid.addEventListener('wheel', _cloudOnWheel, { passive: false });
    document.addEventListener('keydown', _cloudOnKeyDown, { capture: true });
    document.addEventListener('keyup', _cloudOnKeyUp, { capture: true });
    _cloudInputLoop();
}

function _cloudDetachInput() {
    const vid = document.getElementById('cloudVideo');
    if (vid) {
        vid.removeEventListener('click', _cloudOnVideoClick);
        vid.removeEventListener('wheel', _cloudOnWheel);
        vid.style.cursor = '';
    }
    document.removeEventListener('click', _cloudOnDocClick);
    document.removeEventListener('pointerlockchange', _cloudOnPointerLockChange);
    document.removeEventListener('mousemove', _cloudOnMouseMove);
    document.removeEventListener('mousedown', _cloudOnMouseDown);
    document.removeEventListener('mouseup', _cloudOnMouseUp);
    document.removeEventListener('contextmenu', _cloudOnContextMenu);
    document.removeEventListener('keydown', _cloudOnKeyDown, { capture: true });
    document.removeEventListener('keyup', _cloudOnKeyUp, { capture: true });
    if (_cloudInputRafId) { cancelAnimationFrame(_cloudInputRafId); _cloudInputRafId = null; }
    _cloudDc = null;
    _cloudFocused = false;
    _cloudPointerLocked = false;
    _cloudActiveKeys.clear();
    _cloudMouseButtons = 0;
    if (_cloudEscTimer) { clearTimeout(_cloudEscTimer); _cloudEscTimer = null; }
    if (document.pointerLockElement) document.exitPointerLock();
    navigator.keyboard?.unlock?.();
    const h = document.getElementById('cloudClickHint');
    if (h) h.style.display = 'none';
}

// Raccoon signaling protocol (as proxied by Stratus):
function connectWebRTC(iceServers, signalingWsUrl, videoEl) {
    return new Promise((resolve, reject) => {
        const pc = new RTCPeerConnection({ iceServers });
        // Order matches Raccoon: audio=mid0, video=mid1, data=mid2
        pc.addTransceiver('audio', { direction: 'recvonly' });
        pc.addTransceiver('video', { direction: 'recvonly' });
        // Raccoon requires this data channel in the SDP offer; also used for input
        const dc = pc.createDataChannel('JYSDK', { id: 1, ordered: false, maxRetransmits: 0 });
        dc.onopen = () => { _cloudDc = dc; _cloudSetupCursorHandling(dc); };
        pc.ondatachannel = (ev) => { if (ev.channel.label === 'JYSDK') { _cloudDc = ev.channel; _cloudSetupCursorHandling(ev.channel); } };

        const pendingCandidates = [];
        let remoteSet = false;
        let resolved = false;

        async function drainPending() {
            for (const init of pendingCandidates) {
                try { await pc.addIceCandidate(new RTCIceCandidate(init)); } catch {}
            }
            pendingCandidates.length = 0;
        }

        const settle = (fn, val) => {
            if (resolved) return;
            resolved = true;
            clearTimeout(_timeout);
            if (fn === reject) {
                try { ws?.close(); } catch {}
                try { pc?.close(); } catch {}
            }
            fn(val);
        };

        pc.ontrack = (e) => {
            if (e.streams && e.streams[0]) videoEl.srcObject = e.streams[0];
            showCloudStream();
            videoEl.play().catch(() => {
                videoEl.muted = false;
                videoEl.play().catch(() => {});
            });
            settle(resolve, pc);
        };

        pc.oniceconnectionstatechange = () => {
            const s = pc.iceConnectionState;
            if (s === 'connected' || s === 'completed') settle(resolve, pc);
            if (s === 'failed') settle(reject, new Error('ICE connection failed'));
        };

        const ws = new WebSocket(signalingWsUrl);

        pc.onicecandidate = (e) => {
            if (e.candidate && ws.readyState === WebSocket.OPEN) {
                ws.send(JSON.stringify({ type: 'rtc_candidate', candidate: e.candidate.toJSON() }));
            }
        };

        ws.onmessage = async (ev) => {
            let msg;
            try { msg = JSON.parse(ev.data); } catch { return; }

            try {
                if (msg.type === 'game_ready') {
                    setCloudStep(3, 'Establishing stream…');
                    const offer = await pc.createOffer();
                    await pc.setLocalDescription(offer);
                    ws.send(JSON.stringify({ type: 'rtc_offer', sdp: offer.sdp }));

                } else if (msg.type === 'rtc_answer') {
                    const sdpObj = typeof msg.sdp === 'object' ? msg.sdp : { type: 'answer', sdp: msg.sdp };
                    await pc.setRemoteDescription(new RTCSessionDescription(sdpObj));
                    remoteSet = true;
                    await drainPending();

                } else if (msg.type === 'rtc_candidate') {
                    const c = msg.candidate;
                    const init = typeof c === 'string'
                        ? { candidate: c, sdpMid: '0', sdpMLineIndex: 0 }
                        : c;
                    if (remoteSet) {
                        await pc.addIceCandidate(new RTCIceCandidate(init));
                    } else {
                        pendingCandidates.push(init);
                    }
                }
            } catch (e) {
                settle(reject, e);
            }
        };

        ws.onerror = () => settle(reject, new Error('WebSocket error'));
        ws.onclose = (ev) => settle(reject, new Error(ev.reason || ('Signaling closed: ' + ev.code)));

        const _timeout = setTimeout(() => {
            settle(reject, new Error('Stream timed out — game server may be busy'));
        }, 45_000);

        _cloudSession = { pc, ws, stopPing: null, uuid: null };
    });
}

async function openCloudGame(game_key) {
    const g = state.games.find(x => String(x.game_key || x.id) === String(game_key));
    if (!g) return;

    showCloudViewer(g.name);
    let uuid = null;
    try {
        setCloudStep(0);
        const { uuid: sessionUuid, queued } = await createSession(game_key);
        uuid = sessionUuid;

        if (queued) {
            // Stream ended after "queue" — poll until the session leaves the queue.
            await pollQueue(uuid);
        }

        setCloudStep(3);
        _cloudTermLog('Starting WebRTC stream…', 'dim');
        const { ice_servers, signaling_ws } = await startSession(uuid);
        const stopPing = startPing(uuid);
        const videoEl = document.getElementById('cloudVideo');
        const pc = await connectWebRTC(ice_servers, signaling_ws, videoEl);
        if (_cloudSession) { _cloudSession.pc = pc; _cloudSession.stopPing = stopPing; _cloudSession.uuid = uuid; }
    } catch (e) {
        _stopCloudTimer();
        _cloudTermLog(e.message || 'Unknown error', 'error');
        document.getElementById('cloudLoadMsg').textContent = e.message || 'Unknown error';
        const _errStep = document.querySelector('.cstep.active');
        if (_errStep) _errStep.classList.add('error');
        if (uuid) quitSession(uuid);
        _cloudSession = null;
    }
}

function closeCloud() {
    _stopCloudTimer();
    _cloudDetachInput();
    if (_cloudSession) {
        if (_cloudSession.stopPing) _cloudSession.stopPing();
        if (_cloudSession.uuid) quitSession(_cloudSession.uuid);
        try { _cloudSession.ws && _cloudSession.ws.close(); } catch {}
        try { _cloudSession.pc && _cloudSession.pc.close(); } catch {}
        _cloudSession = null;
    }
    const vid = document.getElementById('cloudVideo');
    if (vid) { try { vid.srcObject = null; } catch {} vid.style.display = 'none'; }
    document.getElementById('cloudViewer').style.display = 'none';
    document.querySelector('nav.nav').style.display = '';
    document.querySelector('main').style.display = '';
    document.querySelector('footer').style.display = '';
    reloadVisibleCardImages();
}

function fullscreenCloud() {
    const vid = document.getElementById('cloudVideo');
    if (vid && vid.requestFullscreen) vid.requestFullscreen();
    else if (document.getElementById('cloudBody')?.requestFullscreen) document.getElementById('cloudBody').requestFullscreen();
}

// ── init ──────────────────────────────────────────────────────────────────────

async function init() {
    renderCatStrip();
    setLibraryChip(state.library);
    // Show Cloud tab only when the backend is configured.
    fetch('/api/stratus/status').then(r => r.json()).then(d => {
        if (d && d.enabled) {
            const chip = document.getElementById('cloudChip');
            if (chip) chip.style.display = '';
        }
    }).catch(() => {});
    await loadLibrary(state.library);

    const id = new URLSearchParams(window.location.search).get('id');
    if (id) {
        const zone = findGame(id);
        if (zone) openGame(zone.id);
    }
}

async function fetchAllStats(period) {
    if (!state.hits[period]) state.hits[period] = {};
    let page = 1;
    let hasMore = true;
    while (hasMore) {
        try {
            const res = await fetch(`${CONFIG.stats}${period}&page=${page}`);
            if (res.status === 425) { hasMore = false; break; }
            const data = await res.json();
            if (!data || data.length === 0) { hasMore = false; }
            else {
                data.forEach(f => {
                    const m = f.name.match(/\/(\d+)\.html/);
                    if (m) {
                        const id = m[1];
                        if (!state.hits[period][id]) state.hits[period][id] = 0;
                        state.hits[period][id] += f.hits.total;
                    }
                });
                page++;
                if (page === 2) updatePlayCounts();
                await new Promise(r => setTimeout(r, 500));
            }
        } catch(e) { hasMore = false; }
    }
    updatePlayCounts();
    if (period === 'week') { updateTrendingWeek(); updateTagSections(); }
}

function updateTrendingWeek() {
    const top = [...state.games].sort((a, b) => getScore(b, 'week') - getScore(a, 'week')).slice(0, 15);
    const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
    const el = document.getElementById('trendingWrapper');
    if (!el) return;
    el.innerHTML = top.map(g => renderCardSlide(g, favs, 'week')).join('');
}

function updateTagSections() {
    const tagCount = state.tagCount || 0;
    for (let i = 0; i < tagCount; i++) {
        const wrap = document.getElementById(`tagWrapper${i}`);
        if (wrap && wrap.children.length > 0) {
            wrap.querySelectorAll('.swiper-slide').forEach(slide => {
                const card = slide.querySelector('.game-card[data-game-id]');
                if (!card) return;
                const game = state.games.find(g => g.id === parseInt(card.dataset.gameId, 10));
                if (!game) return;
                const sr = slide.querySelector('.stat-row');
                if (sr) sr.innerHTML = `<span class="stat-dot"></span>${formatPlays(getScore(game, 'week'))} plays`;
            });
        }
    }
}

function updatePlayCounts() {
    document.querySelectorAll('.stat-row').forEach(async el => {
        const card = el.closest('.game-card[data-game-id]');
        if (!card) return;
        const id = card.dataset.gameId;
        if (!id) return;
        const plays = await getStats(id);
        el.innerHTML = `<span class="stat-dot"></span>${formatPlays(plays)} plays`;
    });
}

function extractCategories() {
    const s = new Set();
    state.games.forEach(g => { if (g.special?.length) g.special.forEach(x => s.add(x)); });
    state.categories = Array.from(s).sort();
}
function getScore(g, p) { return state.hits[p]?.[g.id] || 0; }
function formatPlays(n) {
    if (n >= 1e6) return (n / 1e6).toFixed(1) + 'm';
    if (n >= 1e3) return (n / 1e3).toFixed(1) + 'k';
    return n.toString();
}
function resolveUrl(u) { return u.replace("{COVER_URL}", CONFIG.covers).replace("{HTML_URL}", CONFIG.html); }
function toTitleCase(s) { return s.replace(/\w\S*/g, t => t.charAt(0).toUpperCase() + t.substring(1).toLowerCase()); }

// Most cherrigames entries have no real cover (their manifests just point at a shared
// generic placeholder.png, which would otherwise render as a blank square), so those -
// and any cover that fails to load for any other reason - fall back to the game's name
// shown over the thumb instead of empty space.
function isPlaceholderCover(g) {
    return !g._lumin && /\/placeholder\.png(\?.*)?$/i.test(g.cover || '');
}

function renderCardSlide(g, favs, period) {
    const cover = resolveUrl(g.cover);
    const noCover = isPlaceholderCover(g);
    const nameAttr = String(g.name || '').replace(/"/g, '&quot;');
    return `
    <div class="swiper-slide">
        <div class="game-card${noCover ? ' no-cover' : ''}" data-game-id="${g.id}" ${noCover ? '' : `data-cover="${cover}"`} onclick="event.stopPropagation(); openGame(${g.id})">
            <div class="star-icon ${isFav(favs, g.id) ? 'starred' : ''}" onclick="event.stopPropagation(); toggleFavorite(${g.id}, event)">★</div>
            <img class="card-thumb" alt="" decoding="async" loading="lazy" onerror="this.closest('.game-card').classList.add('no-cover')">
            <span class="card-noimg">${nameAttr}</span>
            <div class="card-body">
                <div class="card-title">${g.name}</div>
                <div class="card-tags">${(g.special || g.tags || []).slice(0,2).map(toTitleCase).join(' · ') || '&nbsp;'}</div>
                <div class="stat-row"><span class="stat-dot"></span>${period ? formatPlays(getScore(g, period)) + ' plays' : '...'}</div>
            </div>
        </div>
    </div>`;
}

function renderCard(g, favs, index) {
    const idAttr = String(g.id).replace(/"/g, '&quot;');

    const idArg = "'" + String(g.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
    const starred = isFav(favs, g.id) ? ' starred' : '';
    const noCover = isPlaceholderCover(g);
    const imgAttr = g._lumin
        ? `data-token="${(g.image_token || '').replace(/"/g, '&quot;')}"`
        : (noCover ? '' : `data-cover="${resolveUrl(g.cover)}"`);
    const nameAttr = String(g.name || '').replace(/"/g, '&quot;');
    return `<div class="game-card${noCover ? ' no-cover' : ''}" data-game-id="${idAttr}" ${imgAttr} data-index="${index}" onclick="openGame(${idArg})" title="${nameAttr}"><div class="star-icon${starred}" onclick="event.stopPropagation(); toggleFavorite(${idArg}, event)">★</div><img class="card-thumb" alt="" decoding="async" loading="lazy" onerror="this.closest('.game-card').classList.add('no-cover')"><span class="card-noimg">${nameAttr}</span></div>`;
}

function favKey(id) { return state.library + ':' + String(id); }
function getFavs() { try { const a = JSON.parse(localStorage.getItem('favorites') || '[]'); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
function setFavs(a) { try { localStorage.setItem('favorites', JSON.stringify(a)); } catch (e) {} }
function isFav(favs, id) {
    return favs.indexOf(favKey(id)) !== -1 || favs.indexOf(String(id)) !== -1;
}

async function loadCardThumb(card) {
    const img = card.querySelector('img.card-thumb');
    if (!img || img.getAttribute('src')) return;
    if (card.dataset.token) {
        try { img.src = await Lumin.getImageUrl(card.dataset.token); } catch(e) {}
    } else if (card.dataset.cover) {
        img.src = card.dataset.cover;
    }
}

let _imgObserver = null;
function ensureImgObserver() {
    if (_imgObserver) return _imgObserver;
    if (typeof IntersectionObserver === 'undefined') return null;
    _imgObserver = new IntersectionObserver(entries => {
        for (const en of entries) {
            if (!en.isIntersecting) continue;
            const card = en.target;
            loadCardThumb(card);
            _imgObserver.unobserve(card);
        }
    }, { rootMargin: '400px 0px', threshold: 0.01 });
    return _imgObserver;
}
function observeCardImages(root) {
    const io = ensureImgObserver();
    if (!io) {
        root.querySelectorAll('.game-card').forEach(loadCardThumb);
        return;
    }
    root.querySelectorAll('.game-card').forEach(c => io.observe(c));
}

function unloadAllCardImages() {
    if (_imgObserver) { try { _imgObserver.disconnect(); } catch {} _imgObserver = null; }
    document.querySelectorAll('.game-card img.card-thumb').forEach(img => {
        if (img.getAttribute('src')) img.removeAttribute('src');
    });
}

function reloadVisibleCardImages() {
    const grid = document.getElementById('allGamesGrid');
    if (grid) observeCardImages(grid);
    const sr = document.getElementById('searchResults');
    if (sr && sr.children.length) observeCardImages(sr);
}

function renderTagSections() {
    const allTags = new Set();
    state.tagGames.forEach(g => { if (g.tags?.length) g.tags.forEach(t => allTags.add(t)); });
    const arr = Array.from(allTags);
    if (!arr.length) return 0;
    const picked = arr.sort(() => Math.random() - 0.5).slice(0, 3);
    const container = document.getElementById('tagSections');
    if (!container) return 0;
    container.innerHTML = picked.map((tag, i) => `
        <div class="section">
            <div class="section-header"><div class="section-title">${tag}</div></div>
            <div class="swiper horizontal-list" id="tagSwiper${i}">
                <div class="swiper-wrapper" id="tagWrapper${i}"></div>
                <div class="swiper-button-next"></div>
                <div class="swiper-button-prev"></div>
            </div>
        </div>
    `).join('');
    picked.forEach((tag, i) => {
        const games = state.tagGames.filter(g => g.tags?.includes(tag)).slice(0, 15);
        if (!games.length) return;
        const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
        const tw = document.getElementById(`tagWrapper${i}`);
        tw.innerHTML = games.map(g => renderCardSlide(g, favs, 'week')).join('');
        observeCardImages(tw);
    });
    return picked.length;
}

function renderApp() {
    if (state.library === 'stratus') {
        renderCatStrip();
        // Show a "Cloud Gaming" header in place of the hero/trending swipers.
        const allTitle = document.querySelector('#allGamesGrid')?.closest('.section')?.querySelector('.section-title');
        if (allTitle) allTitle.childNodes[allTitle.childNodes.length - 1].textContent = 'Cloud Gaming — ' + state.games.length + ' titles';
        document.getElementById('sortOptions').value = 'name';
        sortZones();
        return;
    }
    renderCatStrip();
    const popular = state.games.filter(g => (g.featured || g.special?.includes('popular')) && !g.special?.includes('tools'));
    const ports = state.games.filter(g => g.special?.includes('port') && !g.special?.includes('tools'));
    const rnd = [];
    for (let i = 0; i < 2; i++) {
        const rg = state.games[Math.floor(Math.random() * state.games.length)];
        if (!rg.special?.includes('tools')) rnd.push(rg);
    }
    const pp = popular[Math.floor(Math.random() * popular.length)];
    const pk = ports.length ? ports[Math.floor(Math.random() * ports.length)] : popular[1];
    const featured = [pp, ...rnd, pk, popular[0]].filter(Boolean).slice(0, 5);
    renderHero(featured);

    const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
    state.tagCount = 0;

    document.getElementById('sortOptions').value = localStorage.getItem('sortPreference') || 'name';
    sortZones();

    initSwipers();
    updatePlayCounts();
}

function renderCatStrip() {
    const strip = document.getElementById('catStrip');
    strip.innerHTML = '';
    const all = document.createElement('button');
    all.className = 'chip active';
    all.textContent = 'All Games';
    all.onclick = (e) => switchView('all', e);
    strip.appendChild(all);

    const fav = document.createElement('button');
    fav.className = 'chip';
    fav.textContent = '★ Favorites';
    fav.onclick = (e) => filterFavorites(e);
    strip.appendChild(fav);
}

function filterFavorites(e) {
    setActiveChip(e);
    document.getElementById('modernView').classList.add('hidden');
    document.getElementById('searchView').classList.remove('hidden');
    document.getElementById('searchBar').value = '';
    const titleEl = document.querySelector('#searchView .section-title');
    if (titleEl) titleEl.textContent = 'Favorites';
    const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
    const hits = state.games.filter(g => isFav(favs, g.id));
    const grid = document.getElementById('searchResults');
    grid.innerHTML = hits.length
        ? hits.map((g, i) => renderCard(g, favs, i)).join('')
        : '<div style="grid-column: 1 / -1; text-align:center; padding:40px; color: var(--fg-3); font-size: 13px;">No favorites yet. Tap the star on any game to save it here.</div>';
    observeCardImages(grid);
}

function toggleFavorite(id, evt) {
    const key = favKey(id), bare = String(id);
    let favs = getFavs();
    const star = evt?.currentTarget || evt?.target;
    if (favs.indexOf(key) !== -1 || favs.indexOf(bare) !== -1) {
        favs = favs.filter(f => f !== key && f !== bare);
        star?.classList.remove('starred');
    } else {
        favs.push(key);
        star?.classList.add('starred');
    }
    setFavs(favs);
}

function renderHero(games) {
    document.getElementById('heroWrapper').innerHTML = games.map(g => `
        <div class="swiper-slide">
            <div class="slide-bg" style="background-image: url('${resolveUrl(g.cover)}')"></div>
            <div class="slide-content">
                <div class="slide-image-wrapper"><img src="${resolveUrl(g.cover)}" class="slide-image" loading="lazy"></div>
                <div class="slide-info">
                    <h2 class="hero-title">${g.name}</h2>
                    <div class="hero-meta">
                        ${(g.special || ['Popular']).slice(0,3).map(t => `<span class="tag-badge">${toTitleCase(t)}</span>`).join('')}
                    </div>
                    ${g.author ? `<p class="hero-author">by ${g.author}</p>` : ''}
                    <button class="hero-btn" onclick="event.stopPropagation(); openGame(${g.id})">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
                        Play now
                    </button>
                </div>
            </div>
        </div>
    `).join('');
}

function sortZones() {
    const sortSel = document.getElementById('sortOptions');
    let sortBy = sortSel ? sortSel.value : (localStorage.getItem('sortPreference') || 'name');

    if ((state.library === 'lumin' || CHERRI_LIBS.includes(state.library)) && sortBy !== 'name') sortBy = 'name';
    try { localStorage.setItem('sortPreference', sortBy); } catch(e) {}

    let games = [...state.games];
    const pinned = games.filter(g => g.id === -1 || g.id === 596);
    const regular = games.filter(g => g.id !== -1 && g.id !== 596);
    if (sortBy === 'name') regular.sort((a, b) => String(a.name).localeCompare(String(b.name)));
    else if (sortBy === 'id') regular.sort((a, b) => (Number(b.id) || 0) - (Number(a.id) || 0));
    else if (sortBy === 'popular') regular.sort((a, b) => getScore(b, 'year') - getScore(a, 'year'));
    const all = [...pinned, ...regular];
    const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
    const grid = document.getElementById('allGamesGrid');
    grid.innerHTML = state.library === 'stratus'
        ? all.map((g, i) => renderCloudCard(g, favs, i)).join('')
        : all.map((g, i) => renderCard(g, favs, i)).join('');
    observeCardImages(grid);
}

let heroSwiper, trendingSwiper;
function initSwipers() {
    return;
    if (heroSwiper) heroSwiper.destroy(true, true);
    heroSwiper = new Swiper('.featured-slider', {
        loop: true, observer: true, observeParents: true, centeredSlides: true,
        slidesPerView: 'auto',
        autoplay: { delay: 5000, disableOnInteraction: false },
        pagination: { el: '.swiper-pagination', clickable: true },
        navigation: { nextEl: '.featured-slider .swiper-button-next', prevEl: '.featured-slider .swiper-button-prev' },
        speed: 600
    });

    if (trendingSwiper) trendingSwiper.destroy(true, true);
    trendingSwiper = new Swiper('#trendingSwiper', {
        slidesPerView: 'auto', spaceBetween: 12, slidesPerGroup: 1, speed: 400,
        observer: true, observeParents: true,
        navigation: { nextEl: '#trendingSwiper .swiper-button-next', prevEl: '#trendingSwiper .swiper-button-prev' }
    });

    for (let i = 0; i < (state.tagCount || 0); i++) {
        const el = document.getElementById(`tagSwiper${i}`);
        if (el) new Swiper(`#tagSwiper${i}`, {
            slidesPerView: 'auto', spaceBetween: 12, slidesPerGroup: 1, speed: 400,
            observer: true, observeParents: true,
            navigation: { nextEl: `#tagSwiper${i} .swiper-button-next`, prevEl: `#tagSwiper${i} .swiper-button-prev` }
        });
    }
}

function setActiveChip(e) {
    document.querySelectorAll('#catStrip .chip').forEach(c => c.classList.remove('active'));
    if (e && e.target) e.target.classList.add('active');
}

function handleSearch(q) {
    const s = document.getElementById('searchView');
    const m = document.getElementById('modernView');
    const r = document.getElementById('searchResults');
    if (!q) { s.classList.add('hidden'); m.classList.remove('hidden'); return; }
    m.classList.add('hidden');
    s.classList.remove('hidden');
    const titleEl = document.querySelector('#searchView .section-title');
    if (titleEl) titleEl.textContent = 'Results';
    const favs = JSON.parse(localStorage.getItem('favorites') || '[]');
    const hits = state.games.filter(g => g.name.toLowerCase().includes(q.toLowerCase()));
    r.innerHTML = hits.length
        ? hits.map((g, i) => renderCard(g, favs, i)).join('')
        : `<div style="grid-column: 1 / -1; text-align:center; padding:40px; color: var(--fg-3); font-size: 13px;">No results for "${q}".</div>`;
    observeCardImages(r);
}

function switchView(v, e) {
    setActiveChip(e);
    document.getElementById('searchBar').value = '';
    handleSearch('');
}

async function openGame(id) {
    const g = findGame(id);
    if (!g) return;
    const stats = JSON.parse(localStorage.getItem('userStats') || '{"opens": {}, "timeStart": null}');
    stats.opens[id] = (stats.opens[id] || 0) + 1;
    stats.timeStart = Date.now();
    localStorage.setItem('userStats', JSON.stringify(stats));

    document.getElementById('zoneName').textContent = g.name;
    document.getElementById('zoneId').textContent = id;
    const authorLink = document.getElementById('zoneAuthor');
    authorLink.textContent = g._lumin ? "via Lumin" : ("by " + (g.author || "Unknown"));
    authorLink.href = g.authorLink || "#";

    document.getElementById('zoneViewer').style.display = 'flex';
    document.querySelector('nav.nav').style.display = 'none';
    document.querySelector('main').style.display = 'none';
    document.querySelector('footer').style.display = 'none';

    unloadAllCardImages();

    const url = new URL(window.location);
    url.searchParams.set('id', id);
    history.pushState(null, '', url.toString());

    const f = document.getElementById('zoneFrame');

    if (g._lumin) {
        try {
            const res = await Lumin.getGameUrl(g.id);
            const gameUrl = res && res.url;
            if (!gameUrl) throw new Error("no url");
            f.removeAttribute("sandbox");
            f.setAttribute("allow", "autoplay; fullscreen; pointer-lock; gamepad");
            f.setAttribute("allowfullscreen", "true");
            f.removeAttribute("srcdoc");
            f.src = gameUrl;
        } catch(e) { alert("Load failed: " + (e.message || e)); closeZone(); }
        return;
    }

    if (g.url.startsWith('http') && !g.url.includes('{')) {
        window.open(g.url, '_blank');
        closeZone();
        return;
    }
    try {
        const primary = resolveUrl(g.url);
        const fallback = g.url.replace("{COVER_URL}", CONFIG.coversFallback).replace("{HTML_URL}", CONFIG.htmlFallback);
        let h = "";
        try {
            const r = await fetch(primary + "?t=" + Date.now());
            if (!r.ok) throw new Error("HTTP " + r.status);
            h = await r.text();
            if (h.trim().startsWith("Couldn't find the requested file")) throw new Error("not-found");
        } catch(e) {
            const r2 = await fetch(fallback + "?t=" + Date.now());
            if (!r2.ok) throw new Error("Both sources failed");
            h = await r2.text();
        }
        f.setAttribute("sandbox", "allow-scripts allow-forms allow-pointer-lock allow-popups allow-popups-to-escape-sandbox allow-orientation-lock");
        f.srcdoc = h;
    } catch(e) { alert("Load failed: " + e.message); closeZone(); }
}

function closeZone() {
    const stats = JSON.parse(localStorage.getItem('userStats') || '{"opens": {}, "timeStart": null, "totalTime": 0}');
    if (stats.timeStart) {
        stats.totalTime = (stats.totalTime || 0) + (Date.now() - stats.timeStart);
        stats.timeStart = null;
        localStorage.setItem('userStats', JSON.stringify(stats));
    }
    document.getElementById('zoneViewer').style.display = 'none';
    const oldFrame = document.getElementById('zoneFrame');
    if (oldFrame) {
        const fresh = document.createElement('iframe');
        fresh.id = 'zoneFrame';
        for (const a of oldFrame.attributes) {
            if (a.name === 'id' || a.name === 'src' || a.name === 'srcdoc') continue;
            fresh.setAttribute(a.name, a.value);
        }
        oldFrame.removeAttribute('srcdoc');
        oldFrame.src = 'about:blank';
        oldFrame.replaceWith(fresh);
    }
    document.querySelector('nav.nav').style.display = '';
    document.querySelector('main').style.display = '';
    document.querySelector('footer').style.display = '';

    reloadVisibleCardImages();
    const url = new URL(window.location);
    url.searchParams.delete('id');
    history.pushState(null, '', url.toString());
}

function fullscreenZone() {
    const f = document.getElementById('zoneFrame');
    if (f.requestFullscreen) f.requestFullscreen();
}

function aboutBlank() {
    const id = document.getElementById('zoneId').textContent;
    const g = findGame(id);
    if (!g) return;
    if (g._lumin) { alert("New-tab is not available for Lumin games."); return; }
    const w = window.open('about:blank', '_blank');
    if (!w) { alert('Popup blocked.'); return; }
    const fallback = g.url.replace("{COVER_URL}", CONFIG.coversFallback).replace("{HTML_URL}", CONFIG.htmlFallback);
    fetch(resolveUrl(g.url)).then(r => r.text()).then(h => {
        if (h.trim().startsWith("Couldn't find the requested file")) {
            return fetch(fallback + "?t=" + Date.now()).then(r => r.text()).then(hh => {
                w.document.open(); w.document.write(hh); w.document.close();
            });
        }
        w.document.open(); w.document.write(h); w.document.close();
    }).catch(() => { try { w.close(); } catch {}; alert("Failed to open"); });
}

function downloadZone() {
    const id = document.getElementById('zoneId').textContent;
    const g = findGame(id);
    if (!g) return;
    if (g._lumin) { alert("Download is not available for Lumin games."); return; }
    fetch(resolveUrl(g.url)).then(r => r.text()).then(t => {
        const b = new Blob([t], { type: "text/html" });
        const href = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = href;
        a.download = g.name + ".html";
        a.click();
        setTimeout(() => URL.revokeObjectURL(href), 1000);
    });
}

function openModal(t, c) {
    document.getElementById('modalTitle').textContent = t;
    document.getElementById('modalContent').innerHTML = c;
    const o = document.getElementById('modalOverlay');
    o.style.display = 'flex';
    setTimeout(() => o.classList.add('open'), 10);
}
function closeModal() {
    const o = document.getElementById('modalOverlay');
    o.classList.remove('open');
    setTimeout(() => o.style.display = 'none', 300);
}

function openSettings() {
    const stats = JSON.parse(localStorage.getItem('userStats') || '{"opens": {}, "totalTime": 0}');
    const totalOpens = Object.values(stats.opens).reduce((a, b) => a + b, 0);
    const openKeys = Object.keys(stats.opens);
    const mostPlayedId = openKeys.length
        ? openKeys.reduce((a, b) => stats.opens[a] > stats.opens[b] ? a : b)
        : null;
    const mostPlayed = mostPlayedId ? state.games.find(g => g.id == mostPlayedId) : null;
    const hours = Math.floor(stats.totalTime / 3600000);
    const minutes = Math.floor((stats.totalTime % 3600000) / 60000);
    const _vm = currentVisualMode();
    openModal("Settings", `
        <div class="cfg-row">
            <span class="cfg-label">Visual mode</span>
            <div class="seg" id="visualModeSeg">
                <button class="seg-btn ${_vm === 'optimized' ? 'active' : ''}" onclick="setVisualMode('optimized', this)">Optimized</button>
                <button class="seg-btn ${_vm === 'smooth' ? 'active' : ''}" onclick="setVisualMode('smooth', this)">Smooth</button>
            </div>
        </div>
        <div class="cfg-hint" id="visualModeHint">${_vm === 'smooth' ? 'Rich, smooth animations everywhere - best on a strong setup.' : 'Animations off for maximum speed and the lowest lag.'}</div>
        <div class="cfg-row">
            <span class="cfg-label">Card size</span>
            <select class="select" onchange="setGameSize(this.value)">
                <option value="small" ${localStorage.getItem('gameSize') === 'small' ? 'selected' : ''}>Small</option>
                <option value="default" ${!localStorage.getItem('gameSize') || localStorage.getItem('gameSize') === 'default' ? 'selected' : ''}>Default</option>
                <option value="large" ${localStorage.getItem('gameSize') === 'large' ? 'selected' : ''}>Large</option>
            </select>
        </div>
        <div class="cfg-row">
            <span class="cfg-label">Export save data</span>
            <button class="cfg-btn" onclick="saveData()">Export</button>
        </div>
        <div class="cfg-row">
            <span class="cfg-label">Import save data</span>
            <button class="cfg-btn" onclick="document.getElementById('importFile').click()">Import</button>
        </div>
        <div style="margin-top: 18px; padding-top: 18px; border-top: 1px solid var(--line);">
            <div style="color: var(--fg-3); font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;">Your stats</div>
            <div style="color: var(--fg-2); line-height: 1.8; font-size: 13px;">
                <div><b>Total games played:</b> ${totalOpens}</div>
                <div><b>Most played:</b> ${mostPlayed ? mostPlayed.name : 'None'} (${mostPlayedId ? (stats.opens[mostPlayedId] || 0) : 0} times)</div>
                <div><b>Time on site:</b> ${hours}h ${minutes}m</div>
            </div>
        </div>
    `);
}

function currentVisualMode() {
    const v = localStorage.getItem('visualMode');
    if (v === 'optimized' || v === 'smooth') return v;
    const legacy = localStorage.getItem('performanceMode');
    if (legacy === 'false') return 'smooth';
    if (legacy === 'true') return 'optimized';

    if (document.documentElement.classList.contains('perf-lite')) return 'optimized';
    let reduce = false;
    try { reduce = matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) {}
    const lowEnd = (navigator.deviceMemory && navigator.deviceMemory <= 4) ||
                   (navigator.hardwareConcurrency && navigator.hardwareConcurrency <= 4);
    return (reduce || lowEnd) ? 'optimized' : 'smooth';
}

function applyVisualMode(mode) {
    const smooth = mode === 'smooth';
    document.body.classList.toggle('smooth-mode', smooth);
    document.body.classList.toggle('performance-mode', !smooth);
}

function setVisualMode(mode, btn) {
    localStorage.setItem('visualMode', mode);
    applyVisualMode(mode);
    if (btn && btn.parentElement) {
        btn.parentElement.querySelectorAll('.seg-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
    }
    const hint = document.getElementById('visualModeHint');
    if (hint) hint.textContent = mode === 'smooth'
        ? 'Rich, smooth animations everywhere - best on a strong setup.'
        : 'Animations off for maximum speed and the lowest lag.';
}

function setGameSize(size) {
    localStorage.setItem('gameSize', size);
    const map = { small: '140px', default: '180px', large: '240px' };
    let s = document.getElementById('gameSizeStyle');
    if (!s) { s = document.createElement('style'); s.id = 'gameSizeStyle'; document.head.appendChild(s); }
    s.textContent = `.grid { grid-template-columns: repeat(auto-fill, minmax(${map[size]}, 1fr)); }`;
}

function toggleSection(gridId, title) {
    const grid = document.getElementById(gridId);
    const arrow = title.querySelector('.collapse-arrow');
    if (grid.style.display === 'none') { grid.style.display = 'grid'; arrow.style.transform = 'rotate(0deg)'; }
    else { grid.style.display = 'none'; arrow.style.transform = 'rotate(-90deg)'; }
}

let _statsCache = null, _statsPromise = null;
function loadCachedStats() {
    try {
        const c = localStorage.getItem('statsCache_v2');
        if (!c) return null;
        const d = JSON.parse(c);
        if (!d.timestamp || !d.stats || (Date.now() - d.timestamp) > 3600000) { localStorage.removeItem('statsCache_v2'); return null; }
        if (Object.keys(d.stats).length < 100) { localStorage.removeItem('statsCache_v2'); return null; }
        return d.stats;
    } catch(e) { localStorage.removeItem('statsCache_v2'); return null; }
}
function saveCachedStats(s) { try { localStorage.setItem('statsCache_v2', JSON.stringify({ timestamp: Date.now(), stats: s })); } catch(e) {} }
async function getAllStats(force = false) {
    if (!force && _statsCache) return _statsCache;
    if (!force) { const c = loadCachedStats(); if (c) { _statsCache = c; return c; } }
    if (_statsPromise) return _statsPromise;
    _statsPromise = (async () => {
        const BASE = 'https://data.jsdelivr.com/v1/stats/packages/gh/gn-math/html@main/files';
        const map = Object.create(null);
        let page = 1, empty = 0;
        while (empty < 2) {
            const pages = Array.from({ length: 10 }, (_, i) => page + i);
            const responses = await Promise.all(pages.map(p => fetch(`${BASE}?period=year&page=${p}&limit=100`).then(r => r.ok ? r.json() : []).catch(() => [])));
            let found = false;
            for (const data of responses) {
                if (!Array.isArray(data) || !data.length) continue;
                found = true;
                for (const item of data) {
                    if (!item?.name) continue;
                    const m = item.name.match(/^\/(\d+)([.-])/);
                    if (!m) continue;
                    const id = m[1];
                    if (!map[id]) map[id] = { hits: 0, bandwidth: 0 };
                    map[id].hits += item.hits?.total ?? 0;
                    map[id].bandwidth += item.bandwidth?.total ?? 0;
                }
            }
            empty = found ? 0 : empty + 1;
            page += 10;
        }
        _statsCache = map;
        saveCachedStats(map);
        _statsPromise = null;
        updatePlayCounts();
        return map;
    })();
    return _statsPromise;
}
async function getStats(id) { return (await getAllStats())[String(id)]?.hits ?? 0; }

async function showZoneInfo() {
    const rawId = document.getElementById('zoneId').textContent;
    const gg = findGame(rawId);
    if (gg && gg._lumin) {
        openModal(gg.name, `<p><b>Name:</b> ${gg.name}</p>${gg.category ? `<p><b>Category:</b> ${gg.category}</p>` : ''}<p><b>Source:</b> Lumin</p>`);
        return;
    }
    let id = Number(rawId);
    openModal("Info", `<p>Loading...</p>`);
    try {
        const j = await (await fetch(`https://api.github.com/repos/gn-math/html/commits?path=${id}.html`)).json();
        const g = state.games.find(a => a.id === id);
        document.getElementById('modalTitle').textContent = g.name;
        const date = new Date(j.at(-1).commit.author.date);
        const fd = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true }).format(date);
        const stats = await getStats(id);
        document.getElementById('modalContent').innerHTML = `
            <p><b>Name:</b> ${g.name}</p>
            ${g.author ? `<p><b>Author:</b> ${g.author}</p>` : ''}
            ${g.authorLink ? `<p><b>Link:</b> <a style="color:var(--accent);" href="${g.authorLink}">${g.authorLink}</a></p>` : ''}
            ${g.special ? `<p><b>Tags:</b> ${g.special.join(', ')}</p>` : ''}
            <p><b>Added:</b> ${fd}</p>
            <p><b>Plays:</b> ${Number(stats).toLocaleString("en-US")}</p>`;
    } catch(e) { document.getElementById('modalContent').innerHTML = `<p>Failed to load info.</p>`; }
}

function sanitizeData(obj, maxStr = 1000, maxArr = 10000) {
    if (typeof obj === 'string') return obj.length > maxStr ? obj.slice(0, maxStr) + '...[truncated]' : obj;
    if (obj instanceof Uint8Array) return obj.length > maxArr ? `[Uint8Array too large (${obj.length} bytes)]` : obj;
    if (Array.isArray(obj)) return obj.map(x => sanitizeData(x, maxStr, maxArr));
    if (obj && typeof obj === 'object') { const n = {}; for (const k in obj) if (obj.hasOwnProperty(k)) n[k] = sanitizeData(obj[k], maxStr, maxArr); return n; }
    return obj;
}

async function saveData() {
    alert("Exporting save data - this can take a moment.");
    const result = {};
    result.cookies = document.cookie;
    result.localStorage = { ...localStorage };
    result.sessionStorage = { ...sessionStorage };
    result.indexedDB = {};
    const dbs = await indexedDB.databases();
    for (const dbInfo of dbs) {
        if (!dbInfo.name) continue;
        result.indexedDB[dbInfo.name] = {};
        await new Promise((resolve, reject) => {
            const req = indexedDB.open(dbInfo.name, dbInfo.version);
            req.onerror = () => reject(req.error);
            req.onsuccess = () => {
                const db = req.result;
                const names = Array.from(db.objectStoreNames);
                if (!names.length) { resolve(); return; }
                const tx = db.transaction(names, "readonly");
                const ps = [];
                for (const n of names) {
                    result.indexedDB[dbInfo.name][n] = [];
                    const getAll = tx.objectStore(n).getAll();
                    ps.push(new Promise((res, rej) => {
                        getAll.onsuccess = () => { result.indexedDB[dbInfo.name][n] = sanitizeData(getAll.result, 1000, 100); res(); };
                        getAll.onerror = () => rej(getAll.error);
                    }));
                }
                Promise.all(ps).then(() => resolve());
            };
        });
    }
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify(result)], { type: "application/octet-stream" }));
    link.download = `nocturne-${Date.now()}.data`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

const SAFE_IMPORT_KEYS = new Set([
    'favorites', 'userStats', 'gameLibrary', 'sortPreference', 'performanceMode', 'visualMode', 'gameSize',
    'statsCache_v2', 'nocturne-bgfx', 'nocturne-engine', 'nocturne-cloak',
    'nocturne-tabs', 'nocturne-debug', 'nocturne-perf',
    'nocturne-ai-model-groq', 'nocturne-ai-chat', 'nocturne-ai-history',
    'nocturne-ai-include-code', 'nocturne-ai-sidebar-collapsed'
]);
const UNSAFE_VALUE_RE = /^\s*(javascript|data|vbscript):/i;

function isSafeImportValue(v) {
    if (typeof v !== 'string') return false;
    if (v.length > 1_000_000) return false;
    if (UNSAFE_VALUE_RE.test(v)) return false;
    return true;
}

async function loadData(event) {
    const file = event.target.files[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert("File too large (>10 MB)."); return; }
    const reader = new FileReader();
    reader.onload = async (e) => {
        let data;
        try { data = JSON.parse(e.target.result); }
        catch { alert("Invalid file - not JSON."); return; }
        if (!data || typeof data !== 'object') { alert("Invalid file format."); return; }

        let imported = 0, skipped = 0;
        if (data.localStorage && typeof data.localStorage === 'object') {
            for (const k in data.localStorage) {
                if (!SAFE_IMPORT_KEYS.has(k)) { skipped++; continue; }
                const v = data.localStorage[k];
                if (!isSafeImportValue(v)) { skipped++; continue; }
                localStorage.setItem(k, v);
                imported++;
            }
        }
        if (data.sessionStorage && typeof data.sessionStorage === 'object') {
            for (const k in data.sessionStorage) {
                if (!SAFE_IMPORT_KEYS.has(k)) { skipped++; continue; }
                const v = data.sessionStorage[k];
                if (!isSafeImportValue(v)) { skipped++; continue; }
                sessionStorage.setItem(k, v);
                imported++;
            }
        }

        try { applyVisualMode(currentVisualMode()); } catch (e) {}
        try { const gs = localStorage.getItem('gameSize'); if (gs) setGameSize(gs); } catch (e) {}
        try { const el = document.getElementById('sortOptions'); if (el) el.value = localStorage.getItem('sortPreference') || 'name'; } catch (e) {}
        try { setLibraryChip(state.library); sortZones(); } catch (e) {}
        alert(`Imported ${imported} setting(s) — Lumin and gnmath favorites both restored. Skipped ${skipped} (unknown or unsafe).`);
    };
    reader.readAsText(file);
}

applyVisualMode(currentVisualMode());
const _gs = localStorage.getItem('gameSize');
if (_gs) setGameSize(_gs);

document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        if (document.getElementById('zoneViewer').style.display === 'flex') closeZone();
        if (document.getElementById('cloudViewer').style.display === 'flex') closeCloud();
    }
});

(function waitForSwiper() {
    if (typeof Swiper !== 'undefined') init();
    else setTimeout(waitForSwiper, 50);
})();
