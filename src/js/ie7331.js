

(function () {
    "use strict";

    const THEME_KEY = "nocturne-bg-theme";

    const PALETTES = {

        miku: {
            colors: ["57, 197, 187", "120, 224, 224", "150, 220, 255", "86, 180, 230", "190, 245, 240"],
            glow: "57, 197, 187"
        },

        teto: {
            colors: ["214, 0, 63", "232, 56, 72", "255, 96, 120", "200, 28, 48", "255, 150, 160"],
            glow: "230, 40, 60"
        }
    };

    const PLUSH = {
        miku: { src: "/src/img/miku-plush.png", fallback: "/src/img/miku-plush.svg" },
        teto: { src: "/src/img/teto-plush.png", fallback: "/src/img/teto-plush.svg" }
    };

    const ANGLE = 47 * Math.PI / 180;
    const BASE_DIRX = Math.cos(ANGLE);
    const BASE_DIRY = Math.sin(ANGLE);

    const LAYERS = [
        { frac: 0.50, speed: 140, minR: 0.7, maxR: 1.4, minA: 0.16, maxA: 0.38, streak: 0.13 },
        { frac: 0.32, speed: 230, minR: 1.2, maxR: 2.2, minA: 0.28, maxA: 0.58, streak: 0.17 },
        { frac: 0.18, speed: 340, minR: 1.8, maxR: 3.2, minA: 0.46, maxA: 0.85, streak: 0.21 }
    ];

    let canvas = null, ctx = null;
    let w = 0, h = 0, dpr = 1;
    let particles = [];
    let raf = null;
    let activeId = null;
    let palette = null;
    let lastT = 0;
    let plushEl = null;
    let plushToken = 0;

    function ensureCanvas() {
        if (canvas) return;
        canvas = document.getElementById("bgParticles");
        if (!canvas) {
            canvas = document.createElement("canvas");
            canvas.id = "bgParticles";
            (document.body || document.documentElement).insertBefore(canvas, (document.body || document.documentElement).firstChild);
        }
        ctx = canvas.getContext("2d");
    }

    function targetCount() {
        const area = (window.innerWidth * window.innerHeight) / (1280 * 720);

        if (document.documentElement.classList.contains("perf-lite")) {
            return Math.round(Math.max(24, Math.min(46, 40 * area)));
        }
        return Math.round(Math.max(60, Math.min(140, 110 * area)));
    }

    function resize() {
        w = window.innerWidth;
        h = window.innerHeight;
        dpr = Math.min(window.devicePixelRatio || 1, 2);
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function pickLayer() {
        const r = Math.random();
        let acc = 0;
        for (let i = 0; i < LAYERS.length; i++) {
            acc += LAYERS[i].frac;
            if (r <= acc) return i;
        }
        return LAYERS.length - 1;
    }

    function spawn(p, initial) {
        const L = LAYERS[p.layer];
        if (initial) {
            p.x = Math.random() * w;
            p.y = Math.random() * h;
        } else if (Math.random() < w / (w + h)) {
            p.x = Math.random() * w;
            p.y = -20 - Math.random() * 80;
        } else {
            p.x = -20 - Math.random() * 80;
            p.y = Math.random() * h;
        }
        p.r = L.minR + Math.random() * (L.maxR - L.minR);
        p.baseA = L.minA + Math.random() * (L.maxA - L.minA);
        p.speed = L.speed * (0.75 + Math.random() * 0.5);
        p.streak = L.streak;
        const jitter = (Math.random() - 0.5) * 0.18;
        p.dirx = Math.cos(ANGLE + jitter);
        p.diry = Math.sin(ANGLE + jitter);
        p.phase = Math.random() * Math.PI * 2;
        p.tw = 1.4 + Math.random() * 2.4;
        p.wob = 0.3 + Math.random() * 0.9;
        p.color = palette.colors[(Math.random() * palette.colors.length) | 0];
    }

    function build() {
        const n = targetCount();
        particles = new Array(n);
        for (let i = 0; i < n; i++) {
            particles[i] = { layer: pickLayer() };
            spawn(particles[i], true);
        }
    }

    function shouldRun() {
        return !!activeId
            && !document.hidden
            && !document.documentElement.classList.contains("perf-min")
            && !document.body.classList.contains("browsing")
            && !document.body.classList.contains("noc-overlay-open");
    }

    function frame(now) {
        raf = null;
        if (!shouldRun()) return;

        let dt = (now - lastT) / 1000;
        lastT = now;
        if (!(dt > 0) || dt > 0.05) dt = 0.016;

        ctx.clearRect(0, 0, w, h);
        ctx.globalCompositeOperation = "lighter";
        ctx.lineCap = "round";

        const glow = palette.glow;
        for (let i = 0; i < particles.length; i++) {
            const p = particles[i];
            p.phase += dt * p.tw;

            const v = p.speed * dt;
            p.x += p.dirx * v;
            p.y += p.diry * v;

            const wob = Math.sin(p.phase) * p.wob;
            const px = p.x + -p.diry * wob;
            const py = p.y + p.dirx * wob;

            if (px > w + 48 || py > h + 48) { spawn(p, false); continue; }

            const a = p.baseA * (0.6 + 0.4 * Math.sin(p.phase * 1.7));

            const tx = px - p.dirx * p.speed * p.streak;
            const ty = py - p.diry * p.speed * p.streak;
            const grad = ctx.createLinearGradient(px, py, tx, ty);
            grad.addColorStop(0, "rgba(" + p.color + ", " + a + ")");
            grad.addColorStop(1, "rgba(" + p.color + ", 0)");
            ctx.strokeStyle = grad;
            ctx.lineWidth = p.r;
            ctx.beginPath();
            ctx.moveTo(px, py);
            ctx.lineTo(tx, ty);
            ctx.stroke();

            ctx.beginPath();
            ctx.arc(px, py, p.r * 1.8, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(" + glow + ", " + (a * 0.45) + ")";
            ctx.fill();
            ctx.beginPath();
            ctx.arc(px, py, p.r * 0.6, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255, 255, 255, " + (a * 0.55) + ")";
            ctx.fill();
        }

        ctx.globalCompositeOperation = "source-over";
        raf = requestAnimationFrame(frame);
    }

    function kick() {
        if (raf == null && shouldRun()) {
            lastT = performance.now();
            raf = requestAnimationFrame(frame);
        }
    }

    function ensurePlush() {
        if (plushEl) return plushEl;
        plushEl = document.getElementById("bgPlush");
        if (!plushEl) {
            plushEl = document.createElement("div");
            plushEl.id = "bgPlush";

            if (canvas && canvas.parentNode) {
                canvas.parentNode.insertBefore(plushEl, canvas);
            } else {
                const host = document.body || document.documentElement;
                host.insertBefore(plushEl, host.firstChild);
            }
        }
        return plushEl;
    }

    function showPlush(theme) {
        const cfg = PLUSH[theme];
        if (!cfg) return;
        const el = ensurePlush();
        el.classList.toggle("theme-teto", theme === "teto");
        const token = ++plushToken;
        const reveal = url => {
            if (token !== plushToken) return;
            el.style.backgroundImage = 'url("' + url + '")';
            el.classList.add("on");
        };
        const probe = new Image();
        probe.onload = () => reveal(cfg.src);
        probe.onerror = () => reveal(cfg.fallback);
        probe.src = cfg.src;
    }

    function hidePlush() {
        plushToken++;
        if (plushEl) plushEl.classList.remove("on");
    }

    function start(theme) {
        ensureCanvas();
        activeId = theme;
        palette = PALETTES[theme];
        canvas.style.display = "";
        resize();
        build();
        showPlush(theme);
        kick();
    }

    function stop() {
        activeId = null;
        palette = null;
        if (raf != null) { cancelAnimationFrame(raf); raf = null; }
        if (ctx) ctx.clearRect(0, 0, w, h);
        if (canvas) canvas.style.display = "none";
        hidePlush();
    }

    function apply(theme) {
        if (theme === "miku" || theme === "teto") {
            if (activeId === theme) return;
            start(theme);
        } else if (activeId) {
            stop();
        }
    }

    window.addEventListener("nocturne:bgtheme", e => apply(e.detail));
    window.addEventListener("resize", () => { if (activeId) resize(); }, { passive: true });
    document.addEventListener("visibilitychange", () => { if (activeId) kick(); });

    const mo = new MutationObserver(() => { if (activeId) kick(); });
    function boot() {
        if (document.body) mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
        mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
        const t = localStorage.getItem(THEME_KEY);
        if (t === "miku" || t === "teto") apply(t);
    }

    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot, { once: true });
    else boot();
})();
