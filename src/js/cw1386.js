
(function () {
    "use strict";

    function escapeHtml(s) {
        return String(s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function inline(s) {
        s = escapeHtml(s);
        s = s.replace(/`([^`]+)`/g, "<code>$1</code>");
        s = s.replace(/\*\*([^*]+?)\*\*/g, "<strong>$1</strong>");
        s = s.replace(/\*([^*\n]+?)\*/g, "<em>$1</em>");
        s = s.replace(/\b_([^_\n]+?)_\b/g, "<em>$1</em>");
        s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, function (m, t, url) {
            var ext = /^https?:\/\//.test(url);
            return '<a href="' + url + '"' + (ext ? ' target="_blank" rel="noopener"' : "") + ">" + t + "</a>";
        });
        return s;
    }

    var BLOCK_START = /^(#{1,6}\s|[-*]\s|\d+\.\s|>\s?|(-{3,}|\*{3,}|_{3,})\s*$)/;

    function render(md) {
        var lines = String(md).replace(/\r\n?/g, "\n").split("\n");
        var out = [], i = 0, title = null;
        while (i < lines.length) {
            var line = lines[i];
            if (!line.trim()) { i++; continue; }

            var h = /^(#{1,6})\s+(.*)$/.exec(line);
            if (h) {
                var level = h[1].length, text = h[2].trim();
                if (level === 1 && title === null) { title = text; i++; continue; }
                // Slug id so in-page anchor links (e.g. [x](#operational-logging)) resolve.
                var slug = text.toLowerCase().replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-");
                out.push("<h" + level + (slug ? ' id="' + slug + '"' : "") + ">" + inline(text) + "</h" + level + ">");
                i++; continue;
            }
            if (/^(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { out.push("<hr>"); i++; continue; }

            if (/^>\s?/.test(line)) {
                var bq = [];
                while (i < lines.length && /^>\s?/.test(lines[i])) { bq.push(lines[i].replace(/^>\s?/, "")); i++; }
                out.push("<blockquote>" + inline(bq.join(" ").trim()) + "</blockquote>");
                continue;
            }
            if (/^[-*]\s+/.test(line)) {
                var ul = [];
                while (i < lines.length && /^[-*]\s+/.test(lines[i])) { ul.push("<li>" + inline(lines[i].replace(/^[-*]\s+/, "")) + "</li>"); i++; }
                out.push("<ul>" + ul.join("") + "</ul>");
                continue;
            }
            if (/^\d+\.\s+/.test(line)) {
                var ol = [];
                while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { ol.push("<li>" + inline(lines[i].replace(/^\d+\.\s+/, "")) + "</li>"); i++; }
                out.push("<ol>" + ol.join("") + "</ol>");
                continue;
            }

            var p = [];
            while (i < lines.length && lines[i].trim() && !BLOCK_START.test(lines[i])) { p.push(lines[i]); i++; }
            var joined = p.join(" ").trim();
            var cls = /^last updated/i.test(joined) ? ' class="doc-meta"' : "";
            out.push("<p" + cls + ">" + inline(joined) + "</p>");
        }
        return { html: out.join("\n"), title: title };
    }

    async function load(el) {
        var src = el.getAttribute("data-md");
        try {
            var r = await fetch(src, { cache: "no-cache", credentials: "same-origin" });
            if (!r.ok) throw new Error("HTTP " + r.status);
            var doc = render(await r.text());
            el.innerHTML = doc.html;
            if (doc.title) {
                var t = document.querySelector("[data-doc-title]");
                if (t) t.textContent = doc.title;
                document.title = doc.title + " · Nocturne";
            }
            el.classList.add("loaded");
        } catch (e) {
            el.innerHTML = '<p>Couldn’t load this document. <a href="' + src + '">Open it directly</a>.</p>';
        }
    }

    function init() { document.querySelectorAll("[data-md]").forEach(load); }
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
    else init();
})();
