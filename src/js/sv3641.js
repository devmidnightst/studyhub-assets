

export function isBackendProject(files, activeLang) {
    const f = Array.isArray(files) ? files : [];
    const anyContent = (re) => f.some(x => re.test(String(x.content || "")));
    const anyName = (re) => f.some(x => re.test(String(x.name || "")));

    const pkg = f.find(x => /(^|\/)package\.json$/i.test(x.name || ""));
    if (pkg) {
        try {
            const j = JSON.parse(pkg.content || "{}");
            if (j.scripts && j.scripts.start) return true;
            const deps = Object.keys({ ...(j.dependencies || {}), ...(j.devDependencies || {}) }).join(" ");
            if (/\b(express|fastify|koa|next|nuxt|nest|@nestjs|hapi|http-server|serve|socket\.io|ws|polka|h3)\b/i.test(deps)) return true;
        } catch {}
    }
    const jsish = activeLang === "javascript" || activeLang === "typescript" || anyName(/\.(m?js|cjs|ts)$/i);
    if (jsish && anyContent(/\.listen\s*\(|createServer\s*\(|app\.listen|new\s+WebSocketServer|Bun\.serve|Deno\.serve/)) return true;
    if (anyName(/\.py$/i) && anyContent(/\b(from\s+flask|import\s+flask|fastapi|aiohttp|django|http\.server|socketserver|uvicorn|gunicorn|bottle|tornado)\b/i)) return true;
    return false;
}

async function postJSON(url, body) {
    const r = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body || {}) });
    let data = {}; try { data = await r.json(); } catch {}
    return { ok: r.ok, status: r.status, data };
}

export async function startBackend(files, cmd) {
    const { ok, status, data } = await postJSON("/api/runner/run", { files, cmd });
    if (!ok) {
        const e = new Error(data.error || ("runner error " + status));
        if (status === 401) e.needsAuth = true;
        throw e;
    }
    return data;
}

export function streamLogs(onLine) {
    let es;
    try { es = new EventSource("/api/runner/logs"); } catch { return { close() {} }; }
    es.onmessage = (e) => { try { const d = JSON.parse(e.data); if (d.line != null) onLine(d.line); } catch {} };
    return es;
}

export async function backendStatus() {
    try { const r = await fetch("/api/runner/status", { credentials: "same-origin" }); return r.ok ? r.json() : { provisioned: false }; }
    catch { return { provisioned: false }; }
}

export async function stopBackend() { return postJSON("/api/runner/stop", {}); }

export async function waitUntilLive(timeoutMs = 40000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const s = await backendStatus();
        if (s.live) return s;
        if (!s.running && Date.now() - start > 4000) return s;
        await new Promise(r => setTimeout(r, 900));
    }
    return backendStatus();
}
