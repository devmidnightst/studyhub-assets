(function () {
    "use strict";
    var h1 = document.querySelector("#homePage .title");
    if (!h1 || !window.requestAnimationFrame) return;
    try { if (matchMedia("(prefers-reduced-motion: reduce)").matches) return; } catch (e) {}
    if (document.documentElement.classList.contains("reduce-motion")) return;
    if (document.documentElement.classList.contains("perf-min")) return;

    var TEXT = "Nocturne";
    var dpr = Math.max(1, Math.min(window.devicePixelRatio || 1, 2));
    var PAD = 90;
    var R = 55, PUSH = 2.2, SPRING = 0.05, DAMP = 0.82, FADE = 42;
    var color = "#e8e5f4";
    try { var cc = getComputedStyle(h1).color; if (cc) color = cc; } catch (e) {}

    var canvas = document.createElement("canvas");
    canvas.className = "noc-canvas";
    var ctx = canvas.getContext("2d");
    if (!ctx) return;
    h1.appendChild(canvas);

    var parts = [], cssW = 0, cssH = 0, SZ = 3, raf = 0, ready = false;
    var mouseOn = false, mx = -9999, my = -9999, prevMx = -9999, prevMy = -9999, wordL = 0, wordR = 0, wordT = 0, wordB = 0;

    function fontOf() {
        var cs = getComputedStyle(h1);
        return {
            s: (cs.fontWeight || "500") + " " + (cs.fontSize || "48px") + " " + (cs.fontFamily || "Inter, sans-serif"),
            px: parseFloat(cs.fontSize) || 48
        };
    }

    function build() {
        var f = fontOf();
        var mc = document.createElement("canvas").getContext("2d");
        mc.font = f.s;
        var m = mc.measureText(TEXT);
        var tw = Math.ceil(m.width) + 6;
        var asc = m.actualBoundingBoxAscent || f.px * 0.8;
        var desc = m.actualBoundingBoxDescent || f.px * 0.25;
        var th = Math.ceil(asc + desc) + 6;

        cssW = tw + PAD * 2; cssH = th + PAD * 2;
        canvas.style.width = cssW + "px"; canvas.style.height = cssH + "px";
        canvas.style.left = "calc(50% - " + (cssW / 2) + "px)";
        canvas.style.top = "calc(50% - " + (cssH / 2) + "px)";
        canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var off = document.createElement("canvas");
        off.width = Math.round(tw * dpr); off.height = Math.round(th * dpr);
        var oc = off.getContext("2d");
        oc.setTransform(dpr, 0, 0, dpr, 0, 0);
        oc.font = f.s; oc.textBaseline = "alphabetic"; oc.fillStyle = "#fff";
        oc.fillText(TEXT, 3, asc + 3);
        var data;
        try { data = oc.getImageData(0, 0, off.width, off.height).data; } catch (e) { return; }

        var step = Math.max(4, Math.round(f.px / 11));
        SZ = Math.max(2, step * 0.5);
        var np = [];
        for (var y = 0; y < th; y += step) {
            for (var x = 0; x < tw; x += step) {
                var di = (Math.round(y * dpr) * off.width + Math.round(x * dpr)) * 4;
                if (data[di + 3] > 130) {
                    var hx = x + PAD, hy = y + PAD;
                    np.push({ hx: hx, hy: hy, x: hx, y: hy, vx: 0, vy: 0, o: 1 });
                }
            }
        }
        parts = np;
        wordL = PAD; wordT = PAD; wordR = PAD + tw; wordB = PAD + th;
        ready = true;
        h1.classList.add("noc-canvas-on");
        draw();
    }

    function draw() {
        ctx.clearRect(0, 0, cssW, cssH);
        ctx.fillStyle = color;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (p.o <= 0.02) continue;
            ctx.globalAlpha = p.o < 1 ? p.o : 1;
            ctx.beginPath();
            ctx.arc(p.x, p.y, SZ, 0, 6.2832);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }

    function tick() {
        raf = 0;
        var moving = false;
        var R2 = R * R;
        var ax = prevMx, ay = prevMy, sdx = mx - ax, sdy = my - ay;
        var sl2 = sdx * sdx + sdy * sdy;
        for (var i = 0; i < parts.length; i++) {
            var p = parts[i];
            if (mouseOn) {
                var t = sl2 > 0 ? ((p.x - ax) * sdx + (p.y - ay) * sdy) / sl2 : 0;
                t = t < 0 ? 0 : t > 1 ? 1 : t;
                var dx = p.x - (ax + t * sdx), dy = p.y - (ay + t * sdy);
                var d2 = dx * dx + dy * dy;
                if (d2 < R2) {
                    var d = Math.sqrt(d2) || 0.0001;
                    var force = (1 - d / R) * PUSH;
                    p.vx += (dx / d) * force;
                    p.vy += (dy / d) * force;
                }
            }
            p.vx += (p.hx - p.x) * SPRING;
            p.vy += (p.hy - p.y) * SPRING;
            p.vx *= DAMP; p.vy *= DAMP;
            p.x += p.vx; p.y += p.vy;
            var ox = p.x - p.hx, oy = p.y - p.hy;
            var disp = Math.sqrt(ox * ox + oy * oy);
            p.o = disp >= FADE ? 0 : 1 - disp / FADE;
            if (disp > 0.35 || (p.vx * p.vx + p.vy * p.vy) > 0.05) moving = true;
        }
        prevMx = mx; prevMy = my;
        draw();
        if (mouseOn || moving) raf = requestAnimationFrame(tick);
    }
    function start() { if (!raf && ready) raf = requestAnimationFrame(tick); }

    function onMove(e) {
        if (!ready) return;
        var r = canvas.getBoundingClientRect();
        var nx = e.clientX - r.left, ny = e.clientY - r.top;
        var near = nx > wordL - R && nx < wordR + R && ny > wordT - R && ny < wordB + R;
        if (near && !mouseOn) { prevMx = nx; prevMy = ny; }
        mx = nx; my = ny;
        mouseOn = near;
        if (near) start();
    }
    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("pointerdown", onMove, { passive: true });
    window.addEventListener("pointerup", function (e) { if (e.pointerType === "touch") { mouseOn = false; start(); } });
    window.addEventListener("pointercancel", function () { mouseOn = false; start(); });
    document.addEventListener("mouseleave", function () { if (mouseOn) { mouseOn = false; start(); } });

    function rebuild() { ready = false; try { build(); } catch (e) {} }
    rebuild();
    if (document.fonts && document.fonts.ready) { try { document.fonts.ready.then(rebuild); } catch (e) {} }
    var rt = 0;
    window.addEventListener("resize", function () { clearTimeout(rt); rt = setTimeout(rebuild, 200); });
})();
