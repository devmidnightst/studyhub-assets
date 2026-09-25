

(function () {
    "use strict";

    const CHIP = document.getElementById("weatherChip");
    const PANEL = document.getElementById("weatherPanel");
    if (!CHIP || !PANEL) return;

    const CACHE_KEY = "nocturne-weather";
    const LOC_KEY = "nocturne-weather-loc";
    const TTL = 30 * 60 * 1000;

    const WMO = {
        0:  ["Clear", "☀️"],
        1:  ["Mainly clear", "🌤️"],
        2:  ["Partly cloudy", "⛅"],
        3:  ["Overcast", "☁️"],
        45: ["Fog", "🌫️"], 48: ["Rime fog", "🌫️"],
        51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌧️"],
        56: ["Freezing drizzle", "🌧️"], 57: ["Freezing drizzle", "🌧️"],
        61: ["Light rain", "🌦️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
        66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
        71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"], 77: ["Snow grains", "🌨️"],
        80: ["Light showers", "🌦️"], 81: ["Showers", "🌧️"], 82: ["Heavy showers", "⛈️"],
        85: ["Snow showers", "🌨️"], 86: ["Snow showers", "❄️"],
        95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm, hail", "⛈️"]
    };
    function wmo(code) { return WMO[code] || ["—", "🌡️"]; }
    function icon(code, isDay) {
        if (!isDay && (code === 0 || code === 1)) return "🌙";
        return wmo(code)[1];
    }
    function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
    function unit(s) { return ({ "mp/h": "mph", "inch": "in" })[s] || s || ""; }
    function pr(v) { return Math.round((+v || 0) * 100) / 100; }

    async function geoFrom(url) {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error("geo " + r.status);
        const j = await r.json();
        const lat = parseFloat(j.latitude), lon = parseFloat(j.longitude);
        if (!isFinite(lat) || !isFinite(lon)) throw new Error("geo parse");
        return { lat, lon, city: j.city || j.region || "", cc: j.country_code || "" };
    }
    async function ipLocate() {
        try { return await geoFrom("https://get.geojs.io/v1/ip/geo.json"); }
        catch { return await geoFrom("https://ipapi.co/json/"); }
    }
    function savedLoc() { try { return JSON.parse(localStorage.getItem(LOC_KEY) || "null"); } catch { return null; } }
    function setSavedLoc(loc) {
        try { loc ? localStorage.setItem(LOC_KEY, JSON.stringify(loc)) : localStorage.removeItem(LOC_KEY); } catch {}
    }
    async function resolveLoc() { return savedLoc() || await ipLocate(); }
    function sameLoc(a, b) {
        return a && b && Math.abs(a.lat - b.lat) < 0.05 && Math.abs(a.lon - b.lon) < 0.05;
    }

    async function searchLocations(q) {
        const url = "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(q) + "&count=6&language=en&format=json";
        const r = await fetch(url, { cache: "no-store" });
        const j = await r.json();
        return (j.results || []).map(x => ({
            lat: x.latitude, lon: x.longitude,
            city: x.name, cc: x.country_code || "",
            sub: [x.admin1, x.country].filter(Boolean).join(", ")
        }));
    }

    async function fetchWeather(loc) {
        const us = loc.cc === "US";
        const q = new URLSearchParams({
            latitude: loc.lat, longitude: loc.lon,
            current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation,is_day",
            hourly: "temperature_2m,precipitation_probability,weather_code,wind_speed_10m,relative_humidity_2m",
            daily: "weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,precipitation_sum,sunrise,sunset,uv_index_max,wind_speed_10m_max",
            temperature_unit: us ? "fahrenheit" : "celsius",
            wind_speed_unit: us ? "mph" : "kmh",
            precipitation_unit: us ? "inch" : "mm",
            timezone: "auto", forecast_days: "7"
        });
        const r = await fetch("https://api.open-meteo.com/v1/forecast?" + q.toString(), { cache: "no-store" });
        const j = await r.json();
        if (!j || !j.current) throw new Error("weather");
        return j;
    }

    function readCache() { try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "null"); } catch { return null; } }
    async function loadWeather(force) {
        const want = await resolveLoc();
        if (!force) {
            const c = readCache();
            if (c && c.loc && sameLoc(c.loc, want) && (Date.now() - c.t) < TTL) return c;
        }
        const data = await fetchWeather(want);
        const payload = { t: Date.now(), loc: want, data };
        try { localStorage.setItem(CACHE_KEY, JSON.stringify(payload)); } catch {}
        return payload;
    }

    const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    function dayName(iso, i) {
        if (i === 0) return "Today";
        const p = iso.split("-").map(Number);
        return DAYS[new Date(p[0], p[1] - 1, p[2]).getDay()];
    }
    function stat(label, val) { return '<div class="wp-stat"><span>' + label + "</span><b>" + esc(val) + "</b></div>"; }

    function renderChip(p) {
        const cur = p.data.current;
        CHIP.innerHTML =
            '<span class="wc-icon">' + icon(cur.weather_code, cur.is_day) + "</span>" +
            '<span class="wc-temp">' + Math.round(cur.temperature_2m) + "°</span>" +
            '<span class="wc-cond">' + esc(wmo(cur.weather_code)[0]) + "</span>";
        CHIP.hidden = false;
    }

    function renderContent(p) {
        const cur = p.data.current, u = p.data.current_units || {}, d = p.data.daily;
        const week = d.time.map((iso, i) => {
            const pop = d.precipitation_probability_max[i];
            return '<div class="wp-day" role="button" tabindex="0" data-i="' + i + '">' +
                '<span class="wp-day-name">' + dayName(iso, i) + "</span>" +
                '<span class="wp-day-ico">' + wmo(d.weather_code[i])[1] + "</span>" +
                '<span class="wp-day-pop">' + (pop != null ? pop + "%" : "") + "</span>" +
                '<span class="wp-day-temps"><b>' + Math.round(d.temperature_2m_max[i]) + "°</b>" +
                    Math.round(d.temperature_2m_min[i]) + "°</span>" +
                '<span class="wp-day-chev">›</span>' +
                "</div>";
        }).join("");
        CONTENT.innerHTML =
            '<div class="wp-head">' +
                '<div class="wp-now">' +
                    '<span class="wp-now-ico">' + icon(cur.weather_code, cur.is_day) + "</span>" +
                    "<div><div class=\"wp-now-temp\">" + Math.round(cur.temperature_2m) + "°</div>" +
                    '<div class="wp-now-cond">' + esc(wmo(cur.weather_code)[0]) + "</div></div>" +
                "</div>" +
                '<div class="wp-loc">' + esc(p.loc.city || "Your area") + "</div>" +
            "</div>" +
            '<div class="wp-stats">' +
                stat("Feels like", Math.round(cur.apparent_temperature) + "°") +
                stat("Humidity", cur.relative_humidity_2m + "%") +
                stat("Wind", Math.round(cur.wind_speed_10m) + " " + unit(u.wind_speed_10m)) +
                stat("Precip", pr(cur.precipitation) + " " + unit(u.precipitation)) +
            "</div>" +
            '<div class="wp-week-label">7-day forecast · tap a day</div>' +
            '<div class="wp-week">' + week + "</div>";
        CONTENT.querySelectorAll(".wp-day").forEach(el => {
            const go = () => openDay(p, +el.dataset.i);
            el.addEventListener("click", go);
            el.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); go(); } });
        });
    }

    const FULLDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    function fmtDate(iso) {
        const p = iso.split("-").map(Number);
        return FULLDAYS[new Date(p[0], p[1] - 1, p[2]).getDay()] + ", " + MONTHS[p[1] - 1] + " " + p[2];
    }
    function fmtTime(iso) {
        if (!iso) return "—";
        const hm = iso.slice(11, 16).split(":").map(Number);
        let h = hm[0]; const ap = h >= 12 ? "PM" : "AM";
        h = h % 12 || 12;
        return h + ":" + String(hm[1]).padStart(2, "0") + " " + ap;
    }

    function buildChart(temps, pops, hours) {
        const n = temps.length;
        if (n < 2) return '<div class="wp-chart-empty">Hourly data unavailable</div>';
        const W = 280, H = 118, pL = 8, pR = 8, pT = 18, pB = 18;
        const iW = W - pL - pR, iH = H - pT - pB;
        let tmin = Math.min.apply(null, temps), tmax = Math.max.apply(null, temps);
        if (tmax - tmin < 1) { tmax += 1; tmin -= 1; }
        const rng = tmax - tmin;
        const X = i => pL + (i / (n - 1)) * iW;
        const Y = t => pT + iH - ((t - tmin) / rng) * iH;

        let bars = "", bw = iW / n, maxI = 0, minI = 0;
        for (let i = 0; i < n; i++) {
            if (temps[i] > temps[maxI]) maxI = i;
            if (temps[i] < temps[minI]) minI = i;
            const p = pops[i] || 0;
            if (p > 0) {
                const bh = (p / 100) * iH;
                bars += '<rect x="' + (X(i) - bw * 0.35).toFixed(1) + '" y="' + (pT + iH - bh).toFixed(1) +
                    '" width="' + (bw * 0.7).toFixed(1) + '" height="' + bh.toFixed(1) + '" rx="1.2" fill="rgba(127,184,230,0.22)"/>';
            }
        }
        let line = "";
        for (let i = 0; i < n; i++) line += (i ? "L" : "M") + X(i).toFixed(1) + " " + Y(temps[i]).toFixed(1) + " ";
        const area = line + "L" + X(n - 1).toFixed(1) + " " + (pT + iH).toFixed(1) + " L" + X(0).toFixed(1) + " " + (pT + iH).toFixed(1) + " Z";

        let xl = "";
        for (let i = 0; i < n; i++) {
            const h = hours[i];
            if (h % 6 === 0) {
                const lbl = h === 0 ? "12a" : h === 12 ? "12p" : h < 12 ? h + "a" : (h - 12) + "p";
                xl += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 4) + '" class="wp-cx">' + lbl + "</text>";
            }
        }
        const labels =
            '<text x="' + X(maxI).toFixed(1) + '" y="' + (Y(temps[maxI]) - 5).toFixed(1) + '" class="wp-chi">' + Math.round(temps[maxI]) + "°</text>" +
            '<text x="' + X(minI).toFixed(1) + '" y="' + (Y(temps[minI]) + 12).toFixed(1) + '" class="wp-clo">' + Math.round(temps[minI]) + "°</text>";

        return '<svg class="wp-chart" viewBox="0 0 ' + W + " " + H + '">' +
            '<defs><linearGradient id="wpg" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="var(--accent)" stop-opacity="0.3"/>' +
            '<stop offset="1" stop-color="var(--accent)" stop-opacity="0"/></linearGradient></defs>' +
            bars +
            '<path d="' + area + '" fill="url(#wpg)"/>' +
            '<path d="' + line + '" fill="none" stroke="var(--accent)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>' +
            labels + xl + "</svg>";
    }

    function openDay(p, i) {
        const d = p.data.daily, Hd = p.data.hourly || {}, du = p.data.daily_units || {};
        const date = d.time[i];
        const idx = [];
        (Hd.time || []).forEach((t, k) => { if (t.slice(0, 10) === date) idx.push(k); });
        const temps = idx.map(k => Hd.temperature_2m[k]);
        const pops = idx.map(k => (Hd.precipitation_probability ? Hd.precipitation_probability[k] : 0));
        const hours = idx.map(k => parseInt(Hd.time[k].slice(11, 13), 10));
        const [label, ic] = wmo(d.weather_code[i]);
        const pmax = d.precipitation_probability_max[i];
        CONTENT.innerHTML =
            '<button class="wp-back" type="button">‹ 7-day forecast</button>' +
            '<div class="wp-dd-head">' +
                '<span class="wp-dd-ico">' + ic + "</span>" +
                "<div><div class=\"wp-dd-title\">" + fmtDate(date) + "</div>" +
                '<div class="wp-dd-sub">' + esc(label) + " · " + Math.round(d.temperature_2m_max[i]) + "° / " + Math.round(d.temperature_2m_min[i]) + "°</div></div>" +
            "</div>" +
            '<div class="wp-chart-wrap">' + buildChart(temps, pops, hours) + "</div>" +
            '<div class="wp-stats">' +
                stat("Sunrise", fmtTime(d.sunrise && d.sunrise[i])) +
                stat("Sunset", fmtTime(d.sunset && d.sunset[i])) +
                stat("Max wind", (d.wind_speed_10m_max ? Math.round(d.wind_speed_10m_max[i]) + " " + unit(du.wind_speed_10m_max) : "—")) +
                stat("UV index", (d.uv_index_max && d.uv_index_max[i] != null ? Math.round(d.uv_index_max[i]) : "—")) +
                stat("Rain chance", (pmax != null ? pmax + "%" : "—")) +
                stat("Precip", pr(d.precipitation_sum[i]) + " " + unit(du.precipitation_sum)) +
            "</div>";
        CONTENT.querySelector(".wp-back").addEventListener("click", () => renderContent(p));
    }

    let CONTENT = null, INPUT = null, RESULTS = null, built = false;
    function buildShell() {
        PANEL.innerHTML =
            '<div class="wp-search">' +
                '<div class="wp-search-box">' +
                    '<span class="wp-search-ico"><svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="7" cy="7" r="5"/><line x1="13" y1="13" x2="10.5" y2="10.5"/></svg></span>' +
                    '<input class="wp-search-input" type="text" placeholder="Search a city…" autocomplete="off" spellcheck="false" aria-label="Search location">' +
                '</div>' +
                '<button class="wp-myloc" type="button" title="Use my location" aria-label="Use my location"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 21s-7-6.3-7-11a7 7 0 1 1 14 0c0 4.7-7 11-7 11z"/><circle cx="12" cy="10" r="2.5"/></svg></button>' +
                '<div class="wp-results" role="listbox"></div>' +
            '</div>' +
            '<div class="wp-content"></div>';
        CONTENT = PANEL.querySelector(".wp-content");
        INPUT = PANEL.querySelector(".wp-search-input");
        RESULTS = PANEL.querySelector(".wp-results");
        PANEL.querySelector(".wp-myloc").addEventListener("click", useMyLocation);
        wireSearch();
        built = true;
    }

    let searchToken = 0, debounce = null, active = -1, results = [];
    function hideResults() { RESULTS.classList.remove("show"); RESULTS.innerHTML = ""; results = []; active = -1; }
    function showResults(list) {
        results = list; active = -1;
        if (!list.length) {
            RESULTS.innerHTML = '<div class="wp-result-empty">No matches</div>';
        } else {
            RESULTS.innerHTML = list.map((r, i) =>
                '<div class="wp-result" role="option" data-i="' + i + '">' +
                    '<span class="wp-result-name">' + esc(r.city) + "</span>" +
                    (r.sub ? '<span class="wp-result-sub">' + esc(r.sub) + "</span>" : "") +
                "</div>").join("");
            RESULTS.querySelectorAll(".wp-result").forEach(el =>
                el.addEventListener("click", () => choose(list[+el.dataset.i])));
        }
        RESULTS.classList.add("show");
    }
    function highlight(d) {
        if (!results.length) return;
        active = (active + d + results.length) % results.length;
        RESULTS.querySelectorAll(".wp-result").forEach((el, i) => el.classList.toggle("active", i === active));
    }
    function wireSearch() {
        INPUT.addEventListener("input", () => {
            const q = INPUT.value.trim();
            if (debounce) clearTimeout(debounce);
            if (q.length < 2) { hideResults(); return; }
            const token = ++searchToken;
            debounce = setTimeout(async () => {
                try {
                    const list = await searchLocations(q);
                    if (token === searchToken) showResults(list);
                } catch { if (token === searchToken) hideResults(); }
            }, 250);
        });
        INPUT.addEventListener("keydown", e => {
            if (e.key === "ArrowDown") { e.preventDefault(); highlight(1); }
            else if (e.key === "ArrowUp") { e.preventDefault(); highlight(-1); }
            else if (e.key === "Enter") { e.preventDefault(); if (results.length) choose(results[active >= 0 ? active : 0]); }
            else if (e.key === "Escape") { if (results.length) { hideResults(); } else INPUT.blur(); }
        });
        INPUT.addEventListener("blur", () => setTimeout(hideResults, 150));
    }

    async function choose(loc) {
        if (!loc) return;
        setSavedLoc(loc);
        INPUT.value = "";
        hideResults();
        INPUT.blur();
        await refresh();
    }
    async function useMyLocation() {
        setSavedLoc(null);
        hideResults();
        await refresh();
    }
    async function refresh() {
        PANEL.classList.add("wp-loading");
        try {
            payload = await loadWeather(true);
            renderChip(payload);
            renderContent(payload);
        } catch {} finally {
            PANEL.classList.remove("wp-loading");
        }
    }

    let opened = false, payload = null, closeTimer = null;
    function openPanel() {
        if (!payload) return;
        if (!built) buildShell();
        renderContent(payload);
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        PANEL.hidden = false;
        requestAnimationFrame(() => PANEL.classList.add("open"));
        CHIP.setAttribute("aria-expanded", "true");
        opened = true;
    }
    function closePanel() {
        PANEL.classList.remove("open");
        CHIP.setAttribute("aria-expanded", "false");
        hideResults && RESULTS && hideResults();
        opened = false;
        closeTimer = setTimeout(() => { if (!opened) PANEL.hidden = true; }, 240);
    }

    CHIP.addEventListener("click", e => { e.stopPropagation(); opened ? closePanel() : openPanel(); });
    CHIP.addEventListener("keydown", e => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); opened ? closePanel() : openPanel(); }
    });

    PANEL.addEventListener("click", e => e.stopPropagation());
    document.addEventListener("click", e => {
        if (opened && !PANEL.contains(e.target) && e.target !== CHIP && !CHIP.contains(e.target)) closePanel();
    });
    document.addEventListener("keydown", e => { if (e.key === "Escape" && opened && (!INPUT || document.activeElement !== INPUT)) closePanel(); });

    (async () => {
        try {
            payload = await loadWeather(false);
            renderChip(payload);
        } catch {
            CHIP.hidden = true;
        }
    })();
})();
