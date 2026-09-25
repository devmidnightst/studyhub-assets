/*
 * Admin → Analytics.
 *
 * One filter row scopes everything below it. The metric tiles double as the chart's
 * selector (pick a tile, it becomes the plot) which is what keeps this to a single
 * y-axis: two measures of different scale are never drawn on one set of gridlines.
 *
 * Exposes window.NocturneAnalytics.mount(host, { api, toast }).
 */
(function () {
    "use strict";

    // Validated against the #05060d surface (OKLCH lightness band, chroma floor, 3:1 contrast).
    var SERIES = "#9085e9";
    var PREV = "#6f6a8c";
    var STATUS = { good: "#0ca30c", warning: "#fab219", critical: "#d03b3b" };

    var RANGES = ["1m", "5m", "30m", "1h", "1d", "7d", "30d", "max"];
    var REFRESH = [
        { ms: 2000, label: "2s" }, { ms: 5000, label: "5s" }, { ms: 10000, label: "10s" },
        { ms: 30000, label: "30s" }, { ms: 60000, label: "1m" }, { ms: 0, label: "off" }
    ];

    var STORE = "noct.analytics";
    var svgNS = "http://www.w3.org/2000/svg";

    function saved() {
        try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch (e) { return {}; }
    }
    function save(patch) {
        try {
            var next = saved();
            for (var k in patch) next[k] = patch[k];
            localStorage.setItem(STORE, JSON.stringify(next));
        } catch (e) { /* private mode */ }
    }

    // ── formatting ───────────────────────────────────────────────────────────

    function compact(n) {
        n = Number(n) || 0;
        var abs = Math.abs(n);
        if (abs >= 1e9) return (n / 1e9).toFixed(abs >= 1e10 ? 0 : 1) + "B";
        if (abs >= 1e6) return (n / 1e6).toFixed(abs >= 1e7 ? 0 : 1) + "M";
        if (abs >= 1e4) return (n / 1e3).toFixed(0) + "K";
        if (abs >= 1e3) return (n / 1e3).toFixed(1) + "K";
        return String(Math.round(n * 10) / 10);
    }
    function full(n) { return (Number(n) || 0).toLocaleString(); }

    function pad(n) { return (n < 10 ? "0" : "") + n; }

    function axisTime(ts, range) {
        var d = new Date(ts);
        if (range === "1m" || range === "5m") return pad(d.getHours()) + ":" + pad(d.getMinutes()) + ":" + pad(d.getSeconds());
        if (range === "30m" || range === "1h" || range === "1d") return pad(d.getHours()) + ":" + pad(d.getMinutes());
        if (range === "7d") return d.toLocaleDateString(undefined, { weekday: "short" }) + " " + d.getDate();
        return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
    function fullTime(ts) { return new Date(ts).toLocaleString(); }

    // Pick the tick STEP first, then derive the top from it, so the labels are always
    // numbers a reader can do arithmetic on (0 / 500 / 1,000) rather than 0 / 1.3 / 2.5.
    // Everything plotted here is a whole count or a millisecond, so the step never
    // goes fractional.
    function niceScale(v, wanted) {
        wanted = wanted || 4;
        if (!(v > 0)) return { max: 1, step: 1, ticks: 1 };

        var raw = v / wanted;
        var mag = Math.pow(10, Math.floor(Math.log10(raw)));
        var norm = raw / mag;
        var step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
        if (step < 1) step = 1;

        var max = Math.ceil(v / step) * step;
        return { max: max, step: step, ticks: Math.max(1, Math.round(max / step)) };
    }

    function el(tag, cls, text) {
        var n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text != null) n.textContent = text;
        return n;
    }
    function svgEl(tag, attrs) {
        var n = document.createElementNS(svgNS, tag);
        for (var k in attrs) n.setAttribute(k, attrs[k]);
        return n;
    }

    // ── sparkline (numbers only, safe to build as a string) ──────────────────

    function sparkline(points, color, w, h) {
        if (!points || points.length < 2) return "";
        var max = 0, i;
        for (i = 0; i < points.length; i++) max = Math.max(max, points[i][1]);
        if (max <= 0) max = 1;

        var step = w / (points.length - 1);
        var xs = [], ys = [], i;
        for (i = 0; i < points.length; i++) {
            xs.push(i * step);
            ys.push(h - (points[i][1] / max) * (h - 4) - 2);
        }
        var slopes = [], tangents = [];
        for (i = 0; i < xs.length - 1; i++) {
            var dx = xs[i + 1] - xs[i];
            slopes.push(dx ? (ys[i + 1] - ys[i]) / dx : 0);
        }
        tangents.push(slopes[0]);
        for (i = 1; i < slopes.length; i++) tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
        tangents.push(slopes[slopes.length - 1]);
        var d = "M" + xs[0].toFixed(1) + " " + ys[0].toFixed(1);
        for (i = 0; i < xs.length - 1; i++) {
            var span = (xs[i + 1] - xs[i]) / 3;
            d += "C" + (xs[i] + span).toFixed(1) + " " + (ys[i] + tangents[i] * span).toFixed(1)
                + " " + (xs[i + 1] - span).toFixed(1) + " " + (ys[i + 1] - tangents[i + 1] * span).toFixed(1)
                + " " + xs[i + 1].toFixed(1) + " " + ys[i + 1].toFixed(1);
        }
        return '<svg viewBox="0 0 ' + w + " " + h + '" width="' + w + '" height="' + h + '" preserveAspectRatio="none" aria-hidden="true">' +
            '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/></svg>';
    }

    function downsample(points, target) {
        if (!points || points.length <= target) return points || [];
        var out = [], stride = points.length / target;
        for (var i = 0; i < target; i++) {
            var a = Math.floor(i * stride), b = Math.min(points.length, Math.floor((i + 1) * stride));
            var peak = 0;
            for (var j = a; j < b; j++) peak = Math.max(peak, points[j][1]);
            out.push([points[a][0], peak]);
        }
        return out;
    }

    function sum(points) {
        var t = 0;
        for (var i = 0; i < (points || []).length; i++) t += points[i][1];
        return t;
    }
    function peak(points) {
        var t = 0;
        for (var i = 0; i < (points || []).length; i++) t = Math.max(t, points[i][1]);
        return t;
    }

    // ── the main chart ───────────────────────────────────────────────────────

    function Chart(host) {
        var PAD = { l: 64, r: 22, t: 18, b: 32 };
        var H = 260;

        var wrap = el("div", "an-plot");
        var svg = svgEl("svg", { class: "an-svg", role: "img", tabindex: "0" });
        var base = svgEl("g", {});        // plot: rebuilt only when the data changes
        var cursorLayer = svgEl("g", {}); // crosshair: rebuilt on every pointer move
        svg.appendChild(base);
        svg.appendChild(cursorLayer);
        var tip = el("div", "an-tip");
        tip.hidden = true;
        wrap.appendChild(svg);
        wrap.appendChild(tip);
        host.appendChild(wrap);

        var state = { data: null, cursor: -1 };

        function geom() {
            var w = Math.max(320, wrap.clientWidth || 640);
            return { w: w, h: H, iw: w - PAD.l - PAD.r, ih: H - PAD.t - PAD.b };
        }

        function xAt(i, g, n) { return PAD.l + (n <= 1 ? g.iw / 2 : (i / (n - 1)) * g.iw); }
        function yAt(v, g, max) { return PAD.t + g.ih - (v / max) * g.ih; }

        var frame = null;   // { max, n, g } - what the cursor needs to place itself

        function render() {
            var d = state.data;
            while (base.firstChild) base.removeChild(base.firstChild);
            clearCursor();
            frame = null;
            if (!d || !d.points.length) return;

            var g = geom();
            svg.setAttribute("viewBox", "0 0 " + g.w + " " + g.h);
            svg.setAttribute("width", g.w);
            svg.setAttribute("height", g.h);
            svg.setAttribute("aria-label", d.meta.label + " over the last " + d.range);

            var scale = niceScale(Math.max(peak(d.points), peak(d.prev)));
            var max = scale.max;
            var n = d.points.length;

            // gridlines + y ticks: solid hairlines, one step off the surface
            var ticks = scale.ticks, i;
            for (i = 0; i <= ticks; i++) {
                var v = scale.step * i;
                var y = yAt(v, g, max);
                base.appendChild(svgEl("line", {
                    x1: PAD.l, x2: g.w - PAD.r, y1: y.toFixed(1), y2: y.toFixed(1),
                    class: i === 0 ? "an-axis" : "an-grid"
                }));
                var t = svgEl("text", { x: PAD.l - 9, y: (y + 3.5).toFixed(1), class: "an-ytick" });
                t.textContent = compact(v);
                base.appendChild(t);
            }

            // x ticks, thinned to whatever fits
            var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(g.iw / 88))));
            for (i = 0; i < n; i += every) {
                var lastTick = i + every >= n;
                var anchor = i === 0 ? "start" : lastTick ? "end" : "middle";
                var xt = svgEl("text", {
                    x: xAt(i, g, n).toFixed(1),
                    y: g.h - 10,
                    class: "an-xtick",
                    "text-anchor": anchor
                });
                xt.textContent = axisTime(d.points[i][0], d.range);
                base.appendChild(xt);
            }

            function smooth(points, close) {
                var i, xs = [], ys = [];
                for (i = 0; i < points.length; i++) {
                    xs.push(xAt(i, g, points.length));
                    ys.push(yAt(points[i][1], g, max));
                }
                if (xs.length < 2) return "";
                var slopes = [], tangents = [], k;
                for (i = 0; i < xs.length - 1; i++) {
                    var dx = xs[i + 1] - xs[i];
                    slopes.push(dx ? (ys[i + 1] - ys[i]) / dx : 0);
                }
                tangents.push(slopes[0]);
                for (i = 1; i < slopes.length; i++) {
                    tangents.push(slopes[i - 1] * slopes[i] <= 0 ? 0 : (slopes[i - 1] + slopes[i]) / 2);
                }
                tangents.push(slopes[slopes.length - 1]);
                for (i = 0; i < slopes.length; i++) {
                    if (Math.abs(slopes[i]) < 1e-6) { tangents[i] = 0; tangents[i + 1] = 0; continue; }
                    var a = tangents[i] / slopes[i], b = tangents[i + 1] / slopes[i];
                    var hyp = a * a + b * b;
                    if (hyp > 9) {
                        var tau = 3 / Math.sqrt(hyp);
                        tangents[i] = tau * a * slopes[i];
                        tangents[i + 1] = tau * b * slopes[i];
                    }
                }
                var d = "M" + xs[0].toFixed(1) + " " + ys[0].toFixed(1);
                for (i = 0; i < xs.length - 1; i++) {
                    var span = (xs[i + 1] - xs[i]) / 3;
                    d += "C" + (xs[i] + span).toFixed(1) + " " + (ys[i] + tangents[i] * span).toFixed(1)
                        + " " + (xs[i + 1] - span).toFixed(1) + " " + (ys[i + 1] - tangents[i + 1] * span).toFixed(1)
                        + " " + xs[i + 1].toFixed(1) + " " + ys[i + 1].toFixed(1);
                }
                if (close) {
                    var floor = PAD.t + g.ih;
                    d += "L" + xs[xs.length - 1].toFixed(1) + " " + floor;
                    d += "L" + xs[0].toFixed(1) + " " + floor + "Z";
                }
                return d;
            }

            if (d.prev.length > 1) {
                base.appendChild(svgEl("path", { d: smooth(d.prev, false), class: "an-prev" }));
            }

            var grad = svgEl("linearGradient", { id: "anFill", x1: "0", y1: "0", x2: "0", y2: "1" });
            grad.appendChild(svgEl("stop", { offset: "0%", "stop-color": SERIES, "stop-opacity": "0.16" }));
            grad.appendChild(svgEl("stop", { offset: "100%", "stop-color": SERIES, "stop-opacity": "0" }));
            var defs = svgEl("defs", {});
            defs.appendChild(grad);
            base.appendChild(defs);

            base.appendChild(svgEl("path", { d: smooth(d.points, true), class: "an-fill", fill: "url(#anFill)", stroke: "none" }));
            base.appendChild(svgEl("path", { d: smooth(d.points, false), class: "an-line" }));

            // end marker: 8px, with a 2px surface ring so it stays legible on the line
            var last = n - 1;
            base.appendChild(svgEl("circle", {
                cx: xAt(last, g, n).toFixed(1), cy: yAt(d.points[last][1], g, max).toFixed(1),
                r: 4, class: "an-end"
            }));

            // the endpoint is the one direct label - the axis and tooltip carry the rest
            var ex = xAt(last, g, n);
            var ey = yAt(d.points[last][1], g, max);
            var labelY = ey - 14;
            var labelAnchor = "end";
            var labelX = ex - 10;
            if (labelY < PAD.t + 12) labelY = ey + 16;
            if (labelX < PAD.l + 36) { labelX = ex + 10; labelAnchor = "start"; }
            var lv = svgEl("text", {
                x: labelX.toFixed(1),
                y: labelY.toFixed(1),
                class: "an-endlabel",
                "text-anchor": labelAnchor
            });
            lv.textContent = compact(d.points[last][1]);
            base.appendChild(lv);

            base.appendChild(svgEl("rect", {
                x: PAD.l, y: PAD.t, width: g.iw, height: g.ih, fill: "transparent", class: "an-hit"
            }));

            frame = { max: max, n: n, g: g };
            if (state.cursor >= 0 && state.cursor < n) drawCursor();
        }

        function clearCursor() {
            while (cursorLayer.firstChild) cursorLayer.removeChild(cursorLayer.firstChild);
        }

        function drawCursor() {
            clearCursor();
            var d = state.data, i = state.cursor;
            if (!frame || !d || i < 0 || i >= frame.n) return;

            var g = frame.g, max = frame.max, x = xAt(i, g, frame.n);
            cursorLayer.appendChild(svgEl("line", { x1: x.toFixed(1), x2: x.toFixed(1), y1: PAD.t, y2: PAD.t + g.ih, class: "an-cross" }));
            cursorLayer.appendChild(svgEl("circle", { cx: x.toFixed(1), cy: yAt(d.points[i][1], g, max).toFixed(1), r: 4, class: "an-end" }));
            if (d.prev.length === frame.n) {
                cursorLayer.appendChild(svgEl("circle", { cx: x.toFixed(1), cy: yAt(d.prev[i][1], g, max).toFixed(1), r: 3.5, class: "an-end-prev" }));
            }
        }

        // Values lead, labels follow; series keyed by a short stroke, not a box.
        function showTip(i) {
            var d = state.data;
            if (!d || i < 0 || i >= d.points.length) return;

            tip.textContent = "";
            tip.appendChild(el("div", "an-tip-when", fullTime(d.points[i][0])));

            var row = el("div", "an-tip-row");
            row.appendChild(el("span", "an-key"));
            row.appendChild(el("b", null, full(d.points[i][1]) + " " + d.meta.unit));
            row.appendChild(el("span", "an-tip-name", "current"));
            tip.appendChild(row);

            if (d.prev.length === d.points.length) {
                var prow = el("div", "an-tip-row");
                prow.appendChild(el("span", "an-key is-prev"));
                prow.appendChild(el("b", null, full(d.prev[i][1]) + " " + d.meta.unit));
                prow.appendChild(el("span", "an-tip-name", "previous"));
                tip.appendChild(prow);
            }

            var g = geom();
            var x = xAt(i, g, d.points.length);
            tip.hidden = false;
            var tw = tip.offsetWidth || 160;
            tip.style.left = Math.max(4, Math.min(g.w - tw - 4, x - tw / 2)) + "px";
        }

        function indexFromX(clientX) {
            var d = state.data;
            if (!d || !d.points.length) return -1;
            var g = geom();
            var rect = svg.getBoundingClientRect();
            var scale = rect.width / g.w;
            var rel = (clientX - rect.left) / (scale || 1);
            var frac = (rel - PAD.l) / g.iw;
            return Math.max(0, Math.min(d.points.length - 1, Math.round(frac * (d.points.length - 1))));
        }

        function moveTo(i) {
            state.cursor = i;
            drawCursor();
            showTip(i);
        }
        function clear() {
            state.cursor = -1;
            tip.hidden = true;
            clearCursor();
        }

        svg.addEventListener("pointermove", function (e) {
            var i = indexFromX(e.clientX);
            if (i !== state.cursor) moveTo(i); else showTip(i);
        });
        svg.addEventListener("pointerleave", clear);
        svg.addEventListener("blur", clear);
        svg.addEventListener("focus", function () {
            if (state.data && state.data.points.length) moveTo(state.data.points.length - 1);
        });
        svg.addEventListener("keydown", function (e) {
            if (!state.data) return;
            var n = state.data.points.length;
            if (e.key === "ArrowLeft") { e.preventDefault(); moveTo(Math.max(0, state.cursor - 1)); }
            else if (e.key === "ArrowRight") { e.preventDefault(); moveTo(Math.min(n - 1, state.cursor + 1)); }
            else if (e.key === "Escape") clear();
        });

        if (window.ResizeObserver) new ResizeObserver(function () { render(); }).observe(wrap);

        return {
            set: function (data) {
                state.data = data;
                if (state.cursor >= data.points.length) state.cursor = -1;
                render();
                if (state.cursor >= 0) showTip(state.cursor);
            }
        };
    }

    // ── panel ────────────────────────────────────────────────────────────────

    function mount(host, ctx) {
        var api = ctx.api, toast = ctx.toast;
        var prefs = saved();

        var state = {
            range: RANGES.indexOf(prefs.range) >= 0 ? prefs.range : "1h",
            refresh: prefs.refresh == null ? 2000 : prefs.refresh,
            compare: !!prefs.compare,
            metric: prefs.metric || "ccu",
            paused: false,
            table: false,
            data: null,
            timer: null,
            busy: false
        };

        host.textContent = "";

        // — filter row: one row, above everything it scopes —
        var bar = el("div", "an-bar");

        var chips = el("div", "an-chips");
        RANGES.forEach(function (r) {
            var b = el("button", "an-chip" + (r === state.range ? " on" : ""), r === "max" ? "MAX" : r);
            b.type = "button";
            b.dataset.range = r;
            b.addEventListener("click", function () {
                state.range = r;
                save({ range: r });
                chips.querySelectorAll(".an-chip").forEach(function (x) { x.classList.toggle("on", x.dataset.range === r); });
                load(true);
            });
            chips.appendChild(b);
        });
        bar.appendChild(chips);
        bar.appendChild(el("div", "an-sp"));

        var refreshWrap = el("label", "an-ctl");
        refreshWrap.appendChild(el("span", null, "refresh"));
        var refreshSel = el("select", "in sm");
        REFRESH.forEach(function (r) {
            var o = el("option", null, r.label);
            o.value = String(r.ms);
            if (r.ms === state.refresh) o.selected = true;
            refreshSel.appendChild(o);
        });
        refreshSel.addEventListener("change", function () {
            state.refresh = parseInt(refreshSel.value, 10) || 0;
            save({ refresh: state.refresh });
            schedule();
        });
        refreshWrap.appendChild(refreshSel);
        bar.appendChild(refreshWrap);

        var cmp = el("label", "an-ctl");
        var cmpBox = el("input");
        cmpBox.type = "checkbox";
        cmpBox.checked = state.compare;
        cmpBox.addEventListener("change", function () {
            state.compare = cmpBox.checked;
            save({ compare: state.compare });
            load(true);
        });
        cmp.appendChild(cmpBox);
        cmp.appendChild(el("span", null, "compare"));
        bar.appendChild(cmp);

        var pause = el("button", "btn sm", "pause");
        pause.type = "button";
        pause.addEventListener("click", function () {
            state.paused = !state.paused;
            pause.textContent = state.paused ? "resume" : "pause";
            pause.classList.toggle("go", state.paused);
            schedule();
        });
        bar.appendChild(pause);

        var live = el("span", "an-live");
        live.appendChild(el("i"));
        live.appendChild(el("span", null, "live"));
        bar.appendChild(live);
        host.appendChild(bar);

        // — right now —
        host.appendChild(el("div", "sec-h", "Right now"));
        var nowGrid = el("div", "an-cards");
        host.appendChild(nowGrid);

        // — metric tiles double as the chart selector —
        host.appendChild(el("div", "sec-h", "Metrics"));
        host.appendChild(el("p", "hint", "Pick a metric to plot it below. Each tile totals the selected range; concurrent users and latency show their peak and average instead."));
        var tiles = el("div", "an-tiles");
        host.appendChild(tiles);

        // — the plot —
        var card = el("div", "an-card");
        var head = el("div", "an-head");
        var title = el("div", "an-title", "Concurrent users");
        var legend = el("div", "an-legend");
        head.appendChild(title);
        head.appendChild(el("div", "an-sp"));
        head.appendChild(legend);
        var tableBtn = el("button", "btn sm", "table");
        tableBtn.type = "button";
        tableBtn.addEventListener("click", function () {
            state.table = !state.table;
            tableBtn.classList.toggle("go", state.table);
            tableWrap.hidden = !state.table;
            renderTable();
        });
        head.appendChild(tableBtn);
        card.appendChild(head);

        var plotHost = el("div", "an-plot-host");
        card.appendChild(plotHost);
        var tableWrap = el("div", "an-table");
        tableWrap.hidden = true;
        card.appendChild(tableWrap);
        host.appendChild(card);

        var chart = Chart(plotHost);

        // — breakdowns —
        host.appendChild(el("div", "sec-h", "Top in range"));
        var breakdown = el("div", "an-split");
        var modelsBox = el("div", "an-card");
        var usersBox = el("div", "an-card");
        breakdown.appendChild(modelsBox);
        breakdown.appendChild(usersBox);
        host.appendChild(breakdown);

        // ── rendering ────────────────────────────────────────────────────────

        function statusFor(rate) {
            if (rate >= 25) return STATUS.critical;
            if (rate >= 8) return STATUS.warning;
            return STATUS.good;
        }

        function card1(label, value, note, tone) {
            var c = el("div", "an-c");
            var n = el("div", "an-c-n", value);
            if (tone) n.style.color = tone;
            c.appendChild(n);
            c.appendChild(el("div", "an-c-l", label));
            if (note) c.appendChild(el("div", "an-c-s", note));
            return c;
        }

        function renderCards(d) {
            var c = d.cards;
            nowGrid.textContent = "";

            var hero = el("div", "an-c is-hero");
            hero.appendChild(el("div", "an-c-hero", full(c.online)));
            hero.appendChild(el("div", "an-c-l", "Online now"));
            hero.appendChild(el("div", "an-c-s", "on the site right now"));
            nowGrid.appendChild(hero);

            nowGrid.appendChild(card1("Peak today", full(c.peakToday), "highest concurrent"));
            nowGrid.appendChild(card1("Peak all-time", full(c.peakAll), "since sampling began"));
            nowGrid.appendChild(card1("Active 24h", full(c.activeDay), "unique accounts"));
            nowGrid.appendChild(card1("Open sessions", full(c.sessions), "unexpired tokens"));
            nowGrid.appendChild(card1("Accounts", full(c.users), "+" + full(c.signupsToday) + " today"));

            // status colour never carries meaning alone, so the note spells it out
            var rate = c.aiErrorRate;
            var word = rate >= 25 ? "critical" : rate >= 8 ? "elevated" : "healthy";
            nowGrid.appendChild(card1("AI error rate", rate + "%", word + " · today", statusFor(rate)));
            nowGrid.appendChild(card1("AI p95 latency", compact(c.aiP95Ms) + "ms", full(c.aiUsersToday) + " users today"));
            nowGrid.appendChild(card1("Sessions", compact(c.proxySessionsToday), "started today"));
            nowGrid.appendChild(card1("Requests", compact(c.proxyStreamsToday), "tunnelled today"));
        }

        function tileValue(id, points) {
            if (id === "ccu") return { v: peak(points), note: "peak" };
            if (id === "aiLatency") {
                var hits = 0, total = 0;
                for (var i = 0; i < points.length; i++) if (points[i][1] > 0) { total += points[i][1]; hits++; }
                return { v: hits ? Math.round(total / hits) : 0, note: "avg" };
            }
            return { v: sum(points), note: "total" };
        }

        // Tiles are built once and then updated in place. Rebuilding them on every
        // poll would drop keyboard focus and restart the hover state twice a second.
        var tileEls = {};

        function buildTiles(d) {
            tiles.textContent = "";
            tileEls = {};

            d.metrics.forEach(function (m) {
                var t = el("button", "an-tile");
                t.type = "button";

                var label = el("div", "an-t-l", m.label);
                var vRow = el("div", "an-t-v");
                var value = el("b", null, "0");
                var note = el("span", null, m.unit);
                vRow.appendChild(value);
                vRow.appendChild(note);

                var delta = el("div", "an-t-d");
                delta.hidden = true;
                var spark = el("div", "an-t-s");

                t.appendChild(label);
                t.appendChild(vRow);
                t.appendChild(delta);
                t.appendChild(spark);

                t.addEventListener("click", function () {
                    state.metric = m.id;
                    save({ metric: m.id });
                    updateTiles(state.data);
                    renderChart(state.data);
                });

                tileEls[m.id] = { root: t, value: value, note: note, delta: delta, spark: spark };
                tiles.appendChild(t);
            });
        }

        function updateTiles(d) {
            if (!d) return;
            if (!Object.keys(tileEls).length) buildTiles(d);

            d.metrics.forEach(function (m) {
                var t = tileEls[m.id];
                if (!t) return;

                var points = d.series[m.id] || [];
                var cur = tileValue(m.id, points);
                var on = m.id === state.metric;

                t.root.classList.toggle("on", on);
                t.root.setAttribute("aria-pressed", String(on));
                t.value.textContent = compact(cur.v);
                t.note.textContent = cur.note + " · " + m.unit;

                if (d.previous) {
                    var was = tileValue(m.id, d.previous.series[m.id] || []).v;
                    var pct = was ? Math.round((cur.v - was) / was * 100) : (cur.v ? 100 : 0);
                    var arrow = pct > 0 ? "\u25b2" : pct < 0 ? "\u25bc" : "\u2022";
                    t.delta.textContent = arrow + " " + Math.abs(pct) + "% vs previous " + d.range;
                    t.delta.className = "an-t-d " + (pct > 0 ? "up" : pct < 0 ? "down" : "flat");
                    t.delta.hidden = false;
                } else {
                    t.delta.hidden = true;
                }

                t.spark.innerHTML = sparkline(downsample(points, 24), on ? SERIES : PREV, 120, 26);
            });
        }

        function metricMeta(d) {
            for (var i = 0; i < d.metrics.length; i++) if (d.metrics[i].id === state.metric) return d.metrics[i];
            // The remembered metric no longer exists (renamed or dropped) - fall back
            // rather than leaving every tile unselected.
            state.metric = d.metrics[0].id;
            save({ metric: state.metric });
            return d.metrics[0];
        }

        function renderChart(d) {
            var meta = metricMeta(d);
            title.textContent = meta.label;

            legend.textContent = "";
            if (d.previous) {
                [["current", SERIES, ""], ["previous " + d.range, PREV, " is-prev"]].forEach(function (pair) {
                    var item = el("span", "an-leg");
                    item.appendChild(el("span", "an-key" + pair[2]));
                    item.appendChild(el("span", null, pair[0]));
                    legend.appendChild(item);
                });
            }

            chart.set({
                points: d.series[meta.id] || [],
                prev: d.previous ? (d.previous.series[meta.id] || []) : [],
                meta: meta,
                range: d.range
            });
            renderTable();
        }

        // Every value in the plot is reachable without hovering.
        function renderTable() {
            if (!state.table || !state.data) return;
            var d = state.data, meta = metricMeta(d);
            var points = d.series[meta.id] || [];
            var prev = d.previous ? (d.previous.series[meta.id] || []) : [];

            tableWrap.textContent = "";
            var tbl = el("table");
            var thead = el("thead");
            var hr = el("tr");
            ["Time", meta.label + " (" + meta.unit + ")"].concat(prev.length ? ["Previous"] : []).forEach(function (h) {
                hr.appendChild(el("th", null, h));
            });
            thead.appendChild(hr);
            tbl.appendChild(thead);

            var tb = el("tbody");
            for (var i = points.length - 1; i >= 0; i--) {
                var tr = el("tr");
                tr.appendChild(el("td", null, fullTime(points[i][0])));
                tr.appendChild(el("td", "num", full(points[i][1])));
                if (prev.length === points.length) tr.appendChild(el("td", "num", full(prev[i][1])));
                tb.appendChild(tr);
            }
            tbl.appendChild(tb);
            tableWrap.appendChild(tbl);
        }

        function renderRank(box, heading, rows, valueKey, unit, subFn) {
            box.textContent = "";
            box.appendChild(el("div", "an-title", heading));
            if (!rows || !rows.length) {
                box.appendChild(el("div", "empty", "nothing in this range"));
                return;
            }
            var top = rows[0][valueKey] || 1;
            var list = el("div", "an-rank");
            rows.forEach(function (r) {
                var row = el("div", "an-rank-row");
                var name = el("div", "an-rank-name");
                name.textContent = r.name || "—";          // untrusted: model ids and usernames
                row.appendChild(name);

                var barWrap = el("div", "an-rank-bar");
                var fill = el("i");
                fill.style.width = Math.max(2, ((r[valueKey] || 0) / top) * 100) + "%";
                barWrap.appendChild(fill);
                row.appendChild(barWrap);

                var v = el("div", "an-rank-v");
                v.textContent = compact(r[valueKey]) + " " + unit;
                row.appendChild(v);

                if (subFn) {
                    var s = el("div", "an-rank-s");
                    s.textContent = subFn(r);
                    row.appendChild(s);
                }
                list.appendChild(row);
            });
            box.appendChild(list);
        }

        function paint(d) {
            state.data = d;
            metricMeta(d);
            renderCards(d);
            updateTiles(d);
            renderChart(d);
            renderRank(modelsBox, "Models by requests", d.top.models, "reqs", "reqs", function (r) {
                return compact(r.tokens) + " tok · " + compact(r.latency) + "ms · " + full(r.errors) + " err";
            });
            renderRank(usersBox, "Users by AI requests", d.top.users, "reqs", "reqs", function (r) {
                return compact(r.tokens) + " tokens";
            });
        }

        // ── polling ──────────────────────────────────────────────────────────

        var dimTimer = null;

        function load(showBusy) {
            if (state.busy) return Promise.resolve();
            state.busy = true;

            // Hold the previous render rather than flashing a skeleton; only dim if
            // the request is actually slow enough to notice.
            if (showBusy) {
                clearTimeout(dimTimer);
                dimTimer = setTimeout(function () { host.classList.add("is-loading"); }, 400);
            }

            return api("/analytics?range=" + encodeURIComponent(state.range) + (state.compare ? "&compare=1" : ""))
                .then(function (d) {
                    paint(d);
                })
                .catch(function (e) {
                    if (toast) toast(e.message, 1);
                })
                .then(function () {
                    state.busy = false;
                    clearTimeout(dimTimer);
                    host.classList.remove("is-loading");
                });
        }

        function schedule() {
            clearInterval(state.timer);
            state.timer = null;
            var on = !state.paused && state.refresh > 0;
            live.classList.toggle("off", !on);
            if (!on) return;
            state.timer = setInterval(function () {
                if (document.hidden) return;        // a backgrounded tab does not need to poll
                load(false);
            }, state.refresh);
        }

        schedule();

        return {
            refresh: function () { return load(true); },
            stop: function () { clearInterval(state.timer); state.timer = null; }
        };
    }

    window.NocturneAnalytics = { mount: mount };
})();
