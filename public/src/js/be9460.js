(function () {
    const STORAGE_KEY = "nocturne-debug";

    const hud = document.createElement("div");
    hud.id = "debugHud";
    hud.innerHTML = `
        <span class="dh-metric"><span class="dh-label">fps</span><span class="dh-val" id="dhFps">-</span></span>
        <span class="dh-sep">·</span>
        <span class="dh-metric"><span class="dh-label">ping</span><span class="dh-val" id="dhPing">- ms</span></span>
        <canvas id="dhGraph" width="80" height="18"></canvas>
        <span class="dh-sep">·</span>
        <span class="dh-metric"><span class="dh-label">sw</span><span class="dh-dot" id="dhSwDot"></span><span class="dh-val" id="dhSw">-</span></span>
    `;

    const style = document.createElement("style");
    style.textContent = `
        #debugHud {
            position: fixed;
            top: 10px;
            right: 12px;
            z-index: 300;
            display: none;
            align-items: center;
            gap: 8px;
            padding: 5px 10px;
            background: rgba(8, 9, 16, 0.78);
            border: 1px solid rgba(200, 195, 230, 0.12);
            border-radius: 7px;
            backdrop-filter: blur(10px);
            font-family: 'JetBrains Mono', 'Space Mono', monospace;
            font-size: 10px;
            letter-spacing: 0.04em;
            color: #a9a3c7;
            font-variant-numeric: tabular-nums;
            pointer-events: none;
            animation: dhIn 0.2s ease;
        }
        #debugHud.visible { display: inline-flex; }
        @keyframes dhIn {
            from { opacity: 0; transform: translateY(-4px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        #debugHud .dh-metric { display: inline-flex; align-items: baseline; gap: 5px; }
        #debugHud .dh-label { color: #706b8f; font-size: 9px; text-transform: uppercase; letter-spacing: 0.08em; }
        #debugHud .dh-val   { color: #e8e5f4; min-width: 42px; text-align: right; }
        #debugHud .dh-val.warn { color: #e0c17c; }
        #debugHud .dh-val.bad  { color: #e07cb8; }
        #debugHud .dh-sep     { color: #3f3c5a; }
        #debugHud #dhGraph    { display: block; width: 80px; height: 18px; opacity: 0.85; }
        #debugHud .dh-dot     { width: 6px; height: 6px; border-radius: 50%; background: #706b8f; display: inline-block; margin-right: 1px; transition: background 0.15s ease; }
        #debugHud .dh-dot.ok    { background: #7ce0a8; box-shadow: 0 0 4px rgba(124,224,168,0.5); }
        #debugHud .dh-dot.warn  { background: #e0c17c; }
        #debugHud .dh-dot.bad   { background: #e07cb8; }
    `;
    document.head.appendChild(style);
    document.body.appendChild(hud);

    const fpsEl = hud.querySelector("#dhFps");
    const pingEl = hud.querySelector("#dhPing");
    const graphEl = hud.querySelector("#dhGraph");
    const swEl = hud.querySelector("#dhSw");
    const swDotEl = hud.querySelector("#dhSwDot");
    const gctx = graphEl.getContext("2d");
    const GRAPH_LEN = 60;
    const pingHistory = [];

    let frames = 0;
    let lastFpsTime = performance.now();
    let fpsTimer = 0;
    let pingTimer = 0;
    let swTimer = 0;

    function drawGraph() {
        const w = graphEl.width;
        const h = graphEl.height;
        gctx.clearRect(0, 0, w, h);
        if (pingHistory.length < 2) return;
        const max = Math.max(60, ...pingHistory);
        const step = w / (GRAPH_LEN - 1);
        gctx.strokeStyle = "#a9a3c7";
        gctx.lineWidth = 1;
        gctx.beginPath();
        for (let i = 0; i < pingHistory.length; i++) {
            const v = pingHistory[i];
            const x = i * step;
            const y = h - 1 - (v / max) * (h - 2);
            if (i === 0) gctx.moveTo(x, y); else gctx.lineTo(x, y);
        }
        gctx.stroke();
    }

    async function tickSw() {
        if (!navigator.serviceWorker) {
            swEl.textContent = "n/a";
            swDotEl.className = "dh-dot bad";
            return;
        }
        try {
            const reg = await navigator.serviceWorker.getRegistration("/");
            const ctrl = navigator.serviceWorker.controller;
            if (!reg) {
                swEl.textContent = "none";
                swDotEl.className = "dh-dot bad";
            } else if (reg.active && ctrl) {
                swEl.textContent = "active";
                swDotEl.className = "dh-dot ok";
            } else if (reg.installing) {
                swEl.textContent = "install";
                swDotEl.className = "dh-dot warn";
            } else if (reg.waiting) {
                swEl.textContent = "wait";
                swDotEl.className = "dh-dot warn";
            } else if (reg.active && !ctrl) {
                swEl.textContent = "uncontrol";
                swDotEl.className = "dh-dot warn";
            } else {
                swEl.textContent = "?";
                swDotEl.className = "dh-dot warn";
            }
        } catch {
            swEl.textContent = "err";
            swDotEl.className = "dh-dot bad";
        }
    }

    function tickFps(now) {
        frames++;
        const elapsed = now - lastFpsTime;
        if (elapsed >= 500) {
            const fps = Math.round((frames * 1000) / elapsed);
            fpsEl.textContent = fps;
            fpsEl.classList.toggle("warn", fps < 40 && fps >= 20);
            fpsEl.classList.toggle("bad",  fps < 20);
            frames = 0;
            lastFpsTime = now;
        }
        fpsTimer = requestAnimationFrame(tickFps);
    }

    async function tickPing() {
        const t0 = performance.now();
        try {
            const res = await fetch("/ping", { cache: "no-store" });
            if (!res.ok && res.status !== 204) throw new Error();
            const ms = Math.round(performance.now() - t0);
            pingEl.textContent = ms + " ms";
            pingEl.classList.toggle("warn", ms > 60 && ms <= 150);
            pingEl.classList.toggle("bad",  ms > 150);
            pingHistory.push(ms);
        } catch {
            pingEl.textContent = "fail";
            pingEl.classList.remove("warn");
            pingEl.classList.add("bad");
            pingHistory.push(pingHistory[pingHistory.length - 1] || 0);
        }
        if (pingHistory.length > GRAPH_LEN) pingHistory.shift();
        drawGraph();
    }

    function start() {
        if (fpsTimer) return;
        frames = 0;
        lastFpsTime = performance.now();
        fpsTimer = requestAnimationFrame(tickFps);
        tickPing();
        pingTimer = setInterval(tickPing, 2000);
        tickSw();
        swTimer = setInterval(tickSw, 1500);
    }

    function stop() {
        if (fpsTimer) { cancelAnimationFrame(fpsTimer); fpsTimer = 0; }
        if (pingTimer) { clearInterval(pingTimer); pingTimer = 0; }
        if (swTimer) { clearInterval(swTimer); swTimer = 0; }
        fpsEl.textContent = "-";
        pingEl.textContent = "- ms";
        swEl.textContent = "-";
        fpsEl.className = "dh-val";
        pingEl.className = "dh-val";
        swDotEl.className = "dh-dot";
        pingHistory.length = 0;
        gctx.clearRect(0, 0, graphEl.width, graphEl.height);
    }

    function apply(on) {
        hud.classList.toggle("visible", !!on);
        if (on) start(); else stop();
    }

    const initial = localStorage.getItem(STORAGE_KEY) === "1";
    apply(initial);

    window.addEventListener("nocturne:debug", e => {
        const on = !!e.detail;
        localStorage.setItem(STORAGE_KEY, on ? "1" : "0");
        apply(on);
    });

    document.addEventListener("keydown", e => {
        if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "d") {
            e.preventDefault();
            const cur = localStorage.getItem(STORAGE_KEY) === "1";
            window.dispatchEvent(new CustomEvent("nocturne:debug", { detail: !cur }));
        }
    });

})();
