(function () {
    const canvas = document.getElementById("bgCanvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let w = 0, h = 0;
    let mouseX = 0, mouseY = 0;
    let targetX = 0, targetY = 0;
    let vignette = null;

    const LAYERS = [
        { count: 70, depth: 0.3, minR: 0.3, maxR: 0.8, minA: 0.08, maxA: 0.28, color: "232, 229, 244", pulse: false },
        { count: 32, depth: 0.6, minR: 0.6, maxR: 1.2, minA: 0.12, maxA: 0.45, color: "201, 193, 255", pulse: true },
        { count: 14, depth: 1.0, minR: 0.8, maxR: 1.6, minA: 0.22, maxA: 0.75, color: "255, 255, 255", pulse: true }
    ];

    const stars = [];
    LAYERS.forEach((layer, li) => {
        for (let i = 0; i < layer.count; i++) {
            stars.push({
                layer: li,
                x: Math.random(),
                y: Math.random(),
                r: layer.minR + Math.random() * (layer.maxR - layer.minR),
                baseA: layer.minA + Math.random() * (layer.maxA - layer.minA),
                phase: Math.random() * Math.PI * 2,
                phaseSpeed: 0.002 + Math.random() * 0.004
            });
        }
    });

    let resizeTimer = null;
    function resize() {
        w = window.innerWidth;
        h = window.innerHeight;
        canvas.width = w * dpr;
        canvas.height = h * dpr;
        canvas.style.width = w + "px";
        canvas.style.height = h + "px";
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        vignette = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
        vignette.addColorStop(0, "rgba(5, 6, 13, 0)");
        vignette.addColorStop(1, "rgba(5, 6, 13, 0.45)");
    }
    resize();
    window.addEventListener("resize", function () {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(resize, 120);
    });

    window.addEventListener("pointermove", e => {
        targetX = (e.clientX / w - 0.5) * 2;
        targetY = (e.clientY / h - 0.5) * 2;
    }, { passive: true });

    let enabled = true;
    let rafHandle = null;
    function shouldRun() {
        return enabled && !document.hidden
            && !document.documentElement.classList.contains("perf-lite")
            && !document.body.classList.contains("browsing")
            && !document.body.classList.contains("noc-overlay-open");
    }
    function kick() {
        if (rafHandle == null && shouldRun()) rafHandle = requestAnimationFrame(render);
    }
    window.addEventListener("nocturne:bgfx", e => {
        const next = !!e.detail;
        if (next === enabled) return;
        enabled = next;
        if (!enabled) ctx.clearRect(0, 0, w, h);
        kick();
    });
    document.addEventListener("visibilitychange", kick);
    const _mo = new MutationObserver(kick);
    if (document.body) _mo.observe(document.body, { attributes: true, attributeFilter: ["class"] });
    _mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

    let t = 0;
    function render() {
        rafHandle = null;
        if (!shouldRun()) return;
        t += 0.004;
        mouseX += (targetX - mouseX) * 0.05;
        mouseY += (targetY - mouseY) * 0.05;

        ctx.clearRect(0, 0, w, h);

        const cx = w * (0.5 + Math.sin(t * 0.3) * 0.04);
        const cy = h * (0.35 + Math.cos(t * 0.23) * 0.05);
        const nebula = ctx.createRadialGradient(cx, cy, 40, cx, cy, Math.max(w, h) * 0.75);
        nebula.addColorStop(0, "rgba(138, 128, 182, 0.07)");
        nebula.addColorStop(0.45, "rgba(138, 128, 182, 0.02)");
        nebula.addColorStop(1, "rgba(5, 6, 13, 0)");
        ctx.fillStyle = nebula;
        ctx.fillRect(0, 0, w, h);

        const cx2 = w * (0.85 + Math.sin(t * 0.17 + 2) * 0.04);
        const cy2 = h * (0.8 + Math.cos(t * 0.21 + 1) * 0.04);
        const nebula2 = ctx.createRadialGradient(cx2, cy2, 60, cx2, cy2, Math.max(w, h) * 0.55);
        nebula2.addColorStop(0, "rgba(201, 193, 255, 0.04)");
        nebula2.addColorStop(0.6, "rgba(201, 193, 255, 0.01)");
        nebula2.addColorStop(1, "rgba(5, 6, 13, 0)");
        ctx.fillStyle = nebula2;
        ctx.fillRect(0, 0, w, h);

        for (const s of stars) {
            const layer = LAYERS[s.layer];
            const px = s.x * w + mouseX * 18 * layer.depth;
            const py = s.y * h + mouseY * 14 * layer.depth;

            let alpha = s.baseA;
            if (layer.pulse) {
                s.phase += s.phaseSpeed;
                alpha = s.baseA + Math.sin(s.phase) * s.baseA * 0.45;
                alpha = Math.max(0.02, alpha);
            }

            ctx.beginPath();
            ctx.arc(px, py, s.r, 0, Math.PI * 2);
            ctx.fillStyle = `rgba(${layer.color}, ${alpha})`;
            ctx.fill();

            if (layer.depth >= 1 && s.r > 1) {
                ctx.beginPath();
                ctx.arc(px, py, s.r * 3.5, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(${layer.color}, ${alpha * 0.08})`;
                ctx.fill();
            }
        }

        ctx.fillStyle = vignette;
        ctx.fillRect(0, 0, w, h);

        rafHandle = requestAnimationFrame(render);
    }

    rafHandle = requestAnimationFrame(render);
})();
