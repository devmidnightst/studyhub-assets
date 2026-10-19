!function () {
    "use strict";
    var A = window.anime;
    if (!A || !A.animate || !A.createAnimatable) return;

    var root = document.documentElement;
    var EASE = "cubicBezier(.22,.8,.2,1)";
    var ROW_H = 34;

    function reduced() {
        try {
            return matchMedia("(prefers-reduced-motion: reduce)").matches
                || root.classList.contains("reduce-motion")
                || root.classList.contains("perf-min");
        } catch (e) { return false; }
    }

    // one live animation per element: starting a new one cancels the old, so rapid
    // interaction retargets instead of stacking instances
    var running = new WeakMap();
    function run(el, params) {
        var prev = running.get(el);
        if (prev) { try { prev.cancel(); } catch (e) {} running.delete(el); }
        var onDone = params.onComplete;
        var anim;
        params.onComplete = function () {
            if (running.get(el) === anim) running.delete(el);
            if (onDone) onDone();
        };
        anim = A.animate(el, params);
        running.set(el, anim);
        return anim;
    }

    var M = { reduced: reduced, ROW_H: ROW_H };

    // active-tab indicator: one element, retargeted with an animatable so a click
    // mid-flight simply redirects it
    var ind = null, indAn = null, indShown = false, trackRaf = 0;

    M.ensureIndicator = function (list) {
        if (ind && ind.parentNode === list) return ind;
        ind = document.createElement("span");
        ind.className = "tab-ind";
        ind.setAttribute("aria-hidden", "true");
        list.insertBefore(ind, list.firstChild);
        indAn = A.createAnimatable(ind, { translateX: 240, translateY: 240, width: 240, height: 240, ease: EASE });
        return ind;
    };

    M.indicatorTo = function (row, opts) {
        if (!ind || !indAn) return;
        if (!row || !row.isConnected) { ind.style.opacity = "0"; indShown = false; return; }
        opts = opts || {};
        var instant = opts.instant || !indShown || reduced();
        var d = instant ? 0 : (opts.dur == null ? 240 : opts.dur);
        indAn.translateX(row.offsetLeft, d);
        indAn.translateY(row.offsetTop, d);
        indAn.width(row.offsetWidth, d);
        indAn.height(ROW_H, d);
        if (!indShown) { ind.style.opacity = "1"; indShown = true; root.setAttribute("data-motion", ""); }
    };

    // while rows are growing or shrinking, neighbours move every frame, so keep the
    // indicator glued to its row for the length of that animation
    M.track = function (ms, fn) {
        cancelAnimationFrame(trackRaf);
        if (reduced()) { fn(); return; }
        var end = performance.now() + ms;
        (function step() {
            try { fn(); } catch (e) {}
            if (performance.now() < end) trackRaf = requestAnimationFrame(step);
        })();
    };

    M.rowEnter = function (el) {
        if (reduced()) return;
        el.style.overflow = "hidden";
        run(el, {
            height: [0, ROW_H], opacity: [0, 1], duration: 200, ease: EASE,
            onComplete: function () { el.style.height = ""; el.style.opacity = ""; el.style.overflow = ""; }
        });
    };

    M.rowLeave = function (el) {
        el.setAttribute("data-leaving", "");
        el.setAttribute("aria-hidden", "true");
        el.style.pointerEvents = "none";
        if (reduced()) { el.remove(); return; }
        var h = el.offsetHeight;
        el.style.overflow = "hidden";
        run(el, {
            height: [h, 0], opacity: [1, 0], duration: 180, ease: EASE,
            onComplete: function () { el.remove(); }
        });
    };

    // FLIP: a row that was reordered slides from where it was to where it is
    M.flip = function (el, dy) {
        if (reduced() || !dy) return;
        run(el, {
            translateY: [dy, 0], duration: 220, ease: EASE,
            onComplete: function () { el.style.transform = ""; }
        });
    };

    // understated content crossfade when switching tabs; opacity never reaches zero,
    // so there is no blank flash
    M.contentSwitch = function (el) {
        if (!el || reduced()) return;
        run(el, {
            opacity: [0.9, 1], duration: 170, ease: "outQuad",
            onComplete: function () { el.style.opacity = ""; }
        });
    };

    // sidebar width is one variable, so the dashboard, toolbar and frames follow it
    M.sidebarWidth = function (from, to, done) {
        if (reduced() || matchMedia("(max-width: 720px)").matches) {
            root.style.removeProperty("--sb-w");
            if (done) done();
            return;
        }
        root.style.setProperty("--sb-w", from + "px");
        run(root, {
            "--sb-w": [from + "px", to + "px"], duration: 260, ease: EASE,
            onComplete: function () { root.style.removeProperty("--sb-w"); if (done) done(); }
        });
    };

    // flyout reveal / conceal
    M.reveal = function (el) {
        el.hidden = false;
        if (reduced()) return;
        run(el, {
            opacity: [0, 1], translateX: [-6, 0], duration: 180, ease: EASE,
            onComplete: function () { el.style.opacity = ""; el.style.transform = ""; }
        });
    };
    M.conceal = function (el, done) {
        var finish = function () { el.hidden = true; el.style.opacity = ""; el.style.transform = ""; if (done) done(); };
        if (reduced()) { finish(); return; }
        run(el, { opacity: [1, 0], translateX: [0, -4], duration: 120, ease: "inQuad", onComplete: finish });
    };

    window.__nocMotion = M;
}();
