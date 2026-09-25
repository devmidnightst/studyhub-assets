(async function () {
    function apiOrigin() {
        var hn = location.hostname;
        if (!hn || hn === "localhost" || hn === "127.0.0.1" || hn === "nocturne.lol" || hn.indexOf("cloudfront") !== -1) return location.origin;
        return "https://d27jvgogyihpmk.cloudfront.net";
    }
    function sessionToken() {
        try { return localStorage.getItem("noc-session") || ""; } catch (e) { return ""; }
    }

    // Ask the server whether ads should run for this visitor. It returns show:false
    // when the owner has killed ads globally, or when this account is a paid customer
    // or the owner. Signed-out visitors and free accounts get show:true.
    let show = true;
    try {
        const headers = { Accept: "application/json" };
        const tok = sessionToken();
        if (tok) headers["X-Noc-Session"] = tok;
        const r = await fetch(apiOrigin() + "/api/ads/config", { credentials: "omit", cache: "no-store", headers: headers });
        if (r.ok) {
            const cfg = await r.json();
            show = !!cfg.show;
        }
    } catch (e) { /* network/offline — leave show as-is */ }
    if (!show) return;

    var s = document.createElement("script");
    s.src = "https://abscloud.org/1/02da7b16f9f9f71551ab95370b82ed26";
    s.setAttribute("data-cfasync", "false");
    document.body.appendChild(s);
})();
