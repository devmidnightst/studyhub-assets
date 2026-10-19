// Device fingerprint for the owner activity feed. Computes a stable-ish hash from
// coarse browser/device signals and drops it in a first-party cookie (noct_fp) so
// the server can attach it to activity-log events. This is a fuzzy identifier, NOT
// a hardware ID: it collides across similar machines and resets if the user clears
// storage. Disclosed in the privacy policy. Computed once, then cached.
(function () {
    "use strict";
    try {
        var STORE = "noct-fp";
        function setCookie(v) {
            try { document.cookie = "noct_fp=" + v + "; path=/; max-age=31536000; samesite=lax"; } catch (e) {}
        }

        // Reuse a cached value so the fingerprint stays stable and cheap.
        var cached = null;
        try { cached = localStorage.getItem(STORE); } catch (e) {}
        if (cached && /^[a-f0-9]{16}$/.test(cached)) { setCookie(cached); return; }

        var n = navigator, s = window.screen || {}, parts = [];
        parts.push(n.userAgent || "");
        parts.push(n.language || "");
        parts.push((n.languages || []).join(","));
        parts.push(n.platform || "");
        parts.push(n.hardwareConcurrency || "");
        parts.push(n.deviceMemory || "");
        parts.push(n.maxTouchPoints || "");
        parts.push((s.width || 0) + "x" + (s.height || 0) + "x" + (s.colorDepth || 0));
        parts.push(window.devicePixelRatio || "");
        try { parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || ""); } catch (e) {}
        parts.push(new Date().getTimezoneOffset());

        // Canvas signal — rendering differs subtly by GPU/driver/OS font stack.
        try {
            var c = document.createElement("canvas"); c.width = 220; c.height = 50;
            var ctx = c.getContext("2d");
            ctx.textBaseline = "top";
            ctx.font = "14px 'Arial'";
            ctx.fillStyle = "#f60"; ctx.fillRect(0, 0, 110, 20);
            ctx.fillStyle = "#069"; ctx.fillText("Nocturne❤️", 2, 15);
            ctx.fillStyle = "rgba(102,204,0,0.7)"; ctx.fillText("Nocturne❤️", 4, 17);
            parts.push(c.toDataURL());
        } catch (e) {}

        // WebGL renderer string — exposes GPU family on most machines.
        try {
            var gl = document.createElement("canvas").getContext("webgl");
            var dbg = gl && gl.getExtension("WEBGL_debug_renderer_info");
            if (dbg) parts.push(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "");
        } catch (e) {}

        // Two djb2 passes (forward + reversed) → 16 hex chars. Not cryptographic;
        // just needs to be stable and spread out.
        function h(str) {
            var hash = 5381;
            for (var i = 0; i < str.length; i++) { hash = ((hash << 5) + hash) ^ str.charCodeAt(i); hash = hash >>> 0; }
            return ("00000000" + hash.toString(16)).slice(-8);
        }
        var str = parts.join("|");
        var fp = h(str) + h(str.split("").reverse().join(""));

        try { localStorage.setItem(STORE, fp); } catch (e) {}
        setCookie(fp);
    } catch (e) {}
})();
