
(function () {
    "use strict";
    var $ = function (id) { return document.getElementById(id); };

    var audio = $("muAudio");
    var listEl = $("muList"), stateEl = $("muState"), headingEl = $("muHeading"), subEl = $("muSub");
    var genresEl = $("muGenres"), authEl = $("muAuth"), tabsEl = $("muTabs");

    var state = {
        view: "foryou",
        source: "ytmusic",
        genre: "",
        queue: [],
        idx: -1,
        authed: false,
        liked: {},
        shuffle: false,
        repeat: false,
        listenTimer: null
    };

    function api(path, opts) {
        opts = opts || {};
        opts.credentials = "same-origin";
        if (opts.body && typeof opts.body !== "string") {
            opts.headers = Object.assign({ "Content-Type": "application/json" }, opts.headers || {});
            opts.body = JSON.stringify(opts.body);
        }
        return fetch(path, opts).then(function (r) { return r.json().catch(function () { return {}; }); });
    }
    function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]; }); }
    function fmt(sec) {
        sec = Math.max(0, Math.floor(sec || 0));
        var m = Math.floor(sec / 60), s = sec % 60;
        return m + ":" + (s < 10 ? "0" + s : s);
    }
    function art(t, big) { return (big ? (t.art || t.artwork) : (t.artwork || t.art)) || ""; }

    function streamUrl(t) {
        if (t.source === "ytm" || String(t.id).indexOf("ytm:") === 0) {
            var vid = String(t.id).replace(/^ytm:/, "");
            return "/api/sp/audio/" + encodeURIComponent(vid) +
                "?t=" + encodeURIComponent(t.title || "") + "&a=" + encodeURIComponent(t.artist || "");
        }
        return "/api/music/stream/" + encodeURIComponent(t.id);
    }

    function setState(msg, spin) {
        stateEl.innerHTML = msg ? ((spin ? '<span class="mu-spin"></span>' : "") + esc(msg)) : "";
    }
    function trackCard(t, i) {
        var liked = !!(state.liked[t.id] || t.liked);
        var a = art(t);
        return '<div class="mu-row" data-i="' + i + '" data-id="' + esc(t.id) + '">' +
            '<div class="mu-row-idx"><span class="mu-row-num">' + (i + 1) + '</span>' +
            '<svg class="mu-row-play" width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg></div>' +
            '<div class="mu-row-art">' + (a ? '<img loading="lazy" src="' + esc(a) + '" alt="">' : '<span class="mu-row-noart"></span>') + '</div>' +
            '<div class="mu-row-meta"><div class="mu-row-title">' + esc(t.title) +
            (t.preview ? ' <span class="mu-badge">preview</span>' : "") + '</div>' +
            '<div class="mu-row-artist">' + esc(t.artist) + (t.album ? ' &middot; ' + esc(t.album) : (t.genre ? ' &middot; ' + esc(t.genre) : "")) + '</div></div>' +
            '<div class="mu-row-dur">' + fmt(t.duration) + '</div>' +
            '<button class="mu-row-like mu-like' + (liked ? " on" : "") + '" data-like="' + i + '" aria-label="Like">' +
            '<svg width="17" height="17" viewBox="0 0 24 24" fill="' + (liked ? "currentColor" : "none") + '" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M19 14c1.49-1.46 3-3.21 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.76 0-3 .5-4.5 2-1.5-1.5-2.74-2-4.5-2A5.5 5.5 0 0 0 2 8.5c0 2.29 1.51 4.04 3 5.5l7 7Z"/></svg></button>' +
            '</div>';
    }
    function renderList(tracks) {
        state.queue = tracks || [];
        if (!state.queue.length) { listEl.innerHTML = ""; return; }
        listEl.innerHTML = state.queue.map(trackCard).join("");
        markPlayingRow();
    }
    function markPlayingRow() {
        var rows = listEl.querySelectorAll(".mu-row");
        for (var i = 0; i < rows.length; i++) rows[i].classList.toggle("playing", i === state.idx && state.view === playingView);
    }

    var playingView = "foryou";

    function setActiveTab(view) {
        var tabs = tabsEl.querySelectorAll(".mu-tab");
        for (var i = 0; i < tabs.length; i++) tabs[i].classList.toggle("active", tabs[i].dataset.view === view);
    }
    function showGenres(show) { genresEl.style.display = show ? "flex" : "none"; }

    function loadView(view, genre) {
        state.view = view;
        stopYtm();
        setActiveTab(view === "search" ? "" : view);
        $("muClearHist").hidden = view !== "history";
        $("muSearch").value = view === "search" ? $("muSearch").value : "";
        showGenres(view === "trending" && state.source === "audius");
        setState("Loading…", true);
        listEl.innerHTML = "";

        if (state.source === "ytmusic" && (view === "foryou" || view === "trending")) {
            return ytmFeed(view);
        }

        if (view === "foryou") {
            headingEl.textContent = "For You";
            subEl.textContent = "";
            api("/api/music/recommend?limit=40").then(function (d) {
                applyAuthed(d);
                if (d.error) return setState(d.error);
                subEl.textContent = (d.basedOn && d.basedOn.length)
                    ? "Tuned to your taste: " + d.basedOn.join(", ")
                    : (state.authed ? "Play a few tracks and this becomes yours." : "Sign in and this learns what you like.");
                done(d.tracks, "foryou");
            }).catch(function () { setState("Couldn't load your mix."); });
        } else if (view === "trending") {
            if (state.source === "deezer") {
                headingEl.textContent = "Top Charts";
                subEl.textContent = "Mainstream hits · 30-second previews";
                api("/api/music/trending?source=deezer&limit=50").then(function (d) {
                    applyAuthed(d);
                    if (d.error) return setState(d.error);
                    done(d.tracks, "trending");
                }).catch(function () { setState("Couldn't load charts."); });
            } else {
                genre = genre || state.genre || "";
                state.genre = genre;
                highlightGenre(genre);
                headingEl.textContent = genre ? genre : "Trending now";
                subEl.textContent = genre ? "Top " + genre + " tracks on Nocturne" : "What everyone's listening to";
                api("/api/music/trending?limit=50" + (genre ? "&genre=" + encodeURIComponent(genre) : "")).then(function (d) {
                    applyAuthed(d);
                    if (d.error) return setState(d.error);
                    done(d.tracks, "trending");
                }).catch(function () { setState("Couldn't load tracks."); });
            }
        } else if (view === "favorites") {
            headingEl.textContent = "Liked Songs";
            subEl.textContent = "";
            api("/api/music/favorites").then(function (d) {
                done(d.tracks, "favorites", state.authed ? "No liked songs yet — tap the heart on any track." : "Sign in to like songs and find them here.");
            }).catch(function () { setState("Couldn't load your likes."); });
        } else if (view === "history") {
            headingEl.textContent = "Recently Played";
            subEl.textContent = "";
            api("/api/music/history").then(function (d) {
                done(d.tracks, "history", state.authed ? "Nothing here yet." : "Sign in to keep a listening history.");
            }).catch(function () { setState("Couldn't load history."); });
        }
    }
    function done(tracks, view, emptyMsg) {
        tracks = tracks || [];
        tracks.forEach(function (t) { if (t.liked) state.liked[t.id] = true; });
        playingView = view;
        renderList(tracks);
        setState(tracks.length ? "" : (emptyMsg || "Nothing to show."));
    }

    function doSearch(q) {
        q = (q || "").trim();
        stopYtm();
        if (!q) { loadView("foryou"); return; }
        state.view = "search";
        setActiveTab("");
        showGenres(false);
        $("muClearHist").hidden = true;
        headingEl.textContent = "Results";
        subEl.textContent = '“' + q + '”' + (state.source === "ytmusic" ? " · YouTube Music" : state.source === "deezer" ? " · Deezer (previews)" : "");
        setState("Searching…", true);
        listEl.innerHTML = "";
        if (state.source === "ytmusic") {
            searchYtm(q, { limit: 40, onItem: function (t, all) { done(all.slice(), "search"); } })
                .then(function (all) { if (all !== null && !all.length) setState("No results for “" + q + "”."); })
                .catch(function () { setState("Search failed."); });
            return;
        }
        api("/api/music/search?q=" + encodeURIComponent(q) + "&limit=40&source=" + state.source).then(function (d) {
            applyAuthed(d);
            if (d.error) return setState(d.error);
            done(d.tracks, "search", "No results for “" + q + "”.");
        }).catch(function () { setState("Search failed."); });
    }

    function setSource(src) {
        if (src === state.source) return;
        state.source = src;
        var btns = $("muSource").querySelectorAll(".mu-src-btn");
        for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("on", btns[i].dataset.src === src);

        if (state.view === "search" && $("muSearch").value.trim()) doSearch($("muSearch").value);
        else loadView(src === "ytmusic" ? "foryou" : "trending");
    }

    var ytmAbort = null;
    function stopYtm() { if (ytmAbort) { try { ytmAbort.abort(); } catch (e) {} ytmAbort = null; } }
    function ytmTrack(o) {
        var thumb = o.thumb || "";
        return {
            id: "ytm:" + o.id, videoId: o.id, source: "ytm",
            title: o.title || "Untitled", artist: o.artist || "Unknown artist",
            album: o.album || "", genre: "", duration: o.duration || 0,
            artwork: thumb, art: thumb
        };
    }

    function searchYtm(q, opts) {
        opts = opts || {};
        if (ytmAbort) { try { ytmAbort.abort(); } catch (e) {} }
        var ac = new AbortController();
        ytmAbort = ac;
        var tracks = [];
        var url = "/api/music/ytm/search?q=" + encodeURIComponent(q) + "&limit=" + (opts.limit || 25);
        return fetch(url, { credentials: "same-origin", signal: ac.signal }).then(function (r) {
            if (!r.ok || !r.body) throw new Error("bad");
            var reader = r.body.getReader(), dec = new TextDecoder(), buf = "";
            function pump() {
                return reader.read().then(function (res) {
                    if (res.done) return tracks;
                    buf += dec.decode(res.value, { stream: true });
                    var parts = buf.split("\n\n"); buf = parts.pop();
                    for (var i = 0; i < parts.length; i++) {
                        var line = parts[i].trim();
                        if (line.indexOf("data:") !== 0) continue;
                        var payload = line.slice(5).trim();
                        if (payload === "[DONE]") return tracks;
                        try {
                            var t = ytmTrack(JSON.parse(payload));
                            tracks.push(t);
                            if (opts.onItem) opts.onItem(t, tracks);
                        } catch (e) {}
                    }
                    return pump();
                });
            }
            return pump();
        }).catch(function (e) { if (ac.signal.aborted) return null; throw e; });
    }

    function ytmFeed(view) {
        var q = view === "foryou" ? "popular songs" : "top hits";
        headingEl.textContent = view === "foryou" ? "For You" : "Trending";
        subEl.textContent = "YouTube Music";
        showGenres(false);
        $("muClearHist").hidden = true;
        setState("Loading…", true);
        listEl.innerHTML = "";
        searchYtm(q, { limit: 40, onItem: function (t, all) { done(all.slice(), view); } })
            .then(function (all) { if (all !== null && !all.length) setState("Couldn't load tracks."); })
            .catch(function () { setState("Couldn't load tracks."); });
    }

    function highlightGenre(g) {
        var chips = genresEl.querySelectorAll(".mu-chip");
        for (var i = 0; i < chips.length; i++) chips[i].classList.toggle("on", chips[i].dataset.genre === g);
    }
    function loadGenres() {
        api("/api/music/genres").then(function (d) {
            var chips = ['<button class="mu-chip" data-genre="">All</button>'];
            (d.genres || []).forEach(function (g) { chips.push('<button class="mu-chip" data-genre="' + esc(g) + '">' + esc(g) + "</button>"); });
            genresEl.innerHTML = chips.join("");
        });
    }

    function play(i) {
        if (i < 0 || i >= state.queue.length) return;
        state.idx = i;
        var t = state.queue[i];
        audio.src = streamUrl(t);
        audio.play().catch(function () {});
        updateNowPlaying(t);
        markPlayingRow();
        scheduleHistory(t);
        try {
            if ("mediaSession" in navigator) {
                navigator.mediaSession.metadata = new MediaMetadata({
                    title: t.title, artist: t.artist,
                    artwork: art(t, true) ? [{ src: art(t, true), sizes: "480x480", type: "image/jpeg" }] : []
                });
            }
        } catch (e) {}
    }
    function scheduleHistory(t) {
        if (state.listenTimer) clearTimeout(state.listenTimer);

        state.listenTimer = setTimeout(function () {
            if (state.queue[state.idx] && state.queue[state.idx].id === t.id && !audio.paused) {
                api("/api/music/history", { method: "POST", body: { id: t.id, title: t.title, artist: t.artist, genre: t.genre, artwork: art(t), duration: t.duration } });
            }
        }, 8000);
    }
    function togglePlay() {
        if (state.idx < 0 && state.queue.length) return play(0);
        if (audio.paused) audio.play().catch(function () {}); else audio.pause();
    }
    function next(auto) {
        if (!state.queue.length) return;
        if (state.shuffle) return play(Math.floor(Math.random() * state.queue.length));
        var n = state.idx + 1;
        if (n >= state.queue.length) { if (auto) return; n = 0; }
        play(n);
    }
    function prev() {
        if (!state.queue.length) return;
        if (audio.currentTime > 3) { audio.currentTime = 0; return; }
        play(state.idx <= 0 ? state.queue.length - 1 : state.idx - 1);
    }

    var PLAY_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
    var PAUSE_SVG = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
    function updateNowPlaying(t) {
        $("muPlayer").setAttribute("aria-hidden", "false");
        $("muPlayer").classList.add("on");
        $("muNpTitle").textContent = t.title;
        $("muNpArtist").textContent = t.artist;
        var img = $("muNpArt"), a = art(t, true);
        if (a) { img.src = a; img.style.display = ""; } else { img.style.display = "none"; }
        setLikeBtn($("muNpLike"), !!state.liked[t.id]);
    }
    function setPlayIcon() { $("muPlay").innerHTML = audio.paused ? PLAY_SVG : PAUSE_SVG; }

    function setLikeBtn(btn, on) {
        btn.classList.toggle("on", on);
        var svg = btn.querySelector("svg");
        if (svg) svg.setAttribute("fill", on ? "currentColor" : "none");
    }
    function toggleLike(t, rowBtn) {
        if (!state.authed) { flashAuth(); return; }
        var on = !state.liked[t.id];
        state.liked[t.id] = on;
        if (!on) delete state.liked[t.id];
        if (rowBtn) setLikeBtn(rowBtn, on);
        if (state.idx >= 0 && state.queue[state.idx] && state.queue[state.idx].id === t.id) setLikeBtn($("muNpLike"), on);
        if (on) api("/api/music/favorites", { method: "POST", body: { id: t.id, title: t.title, artist: t.artist, genre: t.genre, artwork: art(t), duration: t.duration } });
        else api("/api/music/favorites/" + encodeURIComponent(t.id), { method: "DELETE" });
        if (state.view === "favorites" && !on) setTimeout(function () { loadView("favorites"); }, 250);
    }

    function renderAuth() {
        authEl.innerHTML = state.authed ? "" :
            '<a href="/account.html" class="mu-signin">Sign in to save</a>';
    }
    function applyAuthed(d) {
        if (d && typeof d.authenticated === "boolean") { state.authed = d.authenticated; renderAuth(); }
    }

    function checkAuth() {
        api("/api/music/me").then(applyAuthed).catch(function () {});
    }
    function flashAuth() {
        authEl.classList.remove("flash"); void authEl.offsetWidth; authEl.classList.add("flash");
    }

    var barEl = $("muBar"), fillEl = $("muBarFill"), bufEl = $("muBarBuf");
    function seekFromEvent(e) {
        var r = barEl.getBoundingClientRect();
        var x = ((e.touches ? e.touches[0].clientX : e.clientX) - r.left) / r.width;
        x = Math.min(1, Math.max(0, x));
        if (audio.duration) audio.currentTime = x * audio.duration;
    }
    var seeking = false;
    barEl.addEventListener("pointerdown", function (e) { seeking = true; barEl.setPointerCapture(e.pointerId); seekFromEvent(e); });
    barEl.addEventListener("pointermove", function (e) { if (seeking) seekFromEvent(e); });
    barEl.addEventListener("pointerup", function () { seeking = false; });

    audio.addEventListener("play", setPlayIcon);
    audio.addEventListener("pause", setPlayIcon);
    audio.addEventListener("ended", function () { if (state.repeat) { audio.currentTime = 0; audio.play(); } else next(true); });
    audio.addEventListener("timeupdate", function () {

        var known = (state.idx >= 0 && state.queue[state.idx] && state.queue[state.idx].duration) || 0;
        var d = (isFinite(audio.duration) && audio.duration > 0) ? audio.duration : known;
        var c = audio.currentTime || 0;
        $("muCur").textContent = fmt(c);
        $("muDur").textContent = fmt(d);
        fillEl.style.width = (d ? (c / d * 100) : 0) + "%";
    });
    audio.addEventListener("progress", function () {
        try { if (audio.buffered.length && audio.duration) bufEl.style.width = (audio.buffered.end(audio.buffered.length - 1) / audio.duration * 100) + "%"; } catch (e) {}
    });
    audio.addEventListener("error", function () {
        if (state.idx < 0) return;
        var hadNext = state.shuffle ? state.queue.length > 1 : (state.idx + 1) < state.queue.length;
        setState("Couldn't play this track" + (hadNext ? " — skipping…" : "."), hadNext);
        next(true);
    });

    listEl.addEventListener("click", function (e) {
        var likeBtn = e.target.closest(".mu-row-like");
        if (likeBtn) { var li = +likeBtn.dataset.like; toggleLike(state.queue[li], likeBtn); return; }
        var row = e.target.closest(".mu-row");
        if (row) play(+row.dataset.i);
    });
    genresEl.addEventListener("click", function (e) {
        var chip = e.target.closest(".mu-chip");
        if (chip) loadView("trending", chip.dataset.genre);
    });
    tabsEl.addEventListener("click", function (e) {
        var tab = e.target.closest(".mu-tab");
        if (tab) loadView(tab.dataset.view);
    });
    $("muSource").addEventListener("click", function (e) {
        var b = e.target.closest(".mu-src-btn");
        if (b) setSource(b.dataset.src);
    });
    $("muSearchForm").addEventListener("submit", function (e) { e.preventDefault(); doSearch($("muSearch").value); });
    var searchT;
    $("muSearch").addEventListener("input", function () { clearTimeout(searchT); var v = this.value; searchT = setTimeout(function () { doSearch(v); }, 450); });
    $("muClearHist").addEventListener("click", function () { api("/api/music/history", { method: "DELETE" }).then(function () { loadView("history"); }); });

    $("muPlay").addEventListener("click", togglePlay);
    $("muNext").addEventListener("click", function () { next(false); });
    $("muPrev").addEventListener("click", prev);
    $("muShuffle").addEventListener("click", function () { state.shuffle = !state.shuffle; this.classList.toggle("on", state.shuffle); });
    $("muRepeat").addEventListener("click", function () { state.repeat = !state.repeat; this.classList.toggle("on", state.repeat); });
    $("muNpLike").addEventListener("click", function () { if (state.idx >= 0) toggleLike(state.queue[state.idx], null); });
    $("muVol").addEventListener("input", function () { audio.volume = this.value / 100; if (this.value > 0) audio.muted = false; updateMute(); });
    $("muMute").addEventListener("click", function () { audio.muted = !audio.muted; updateMute(); });
    function updateMute() { $("muMute").classList.toggle("muted", audio.muted || audio.volume === 0); }

    if ("mediaSession" in navigator) {
        try {
            navigator.mediaSession.setActionHandler("play", togglePlay);
            navigator.mediaSession.setActionHandler("pause", togglePlay);
            navigator.mediaSession.setActionHandler("previoustrack", prev);
            navigator.mediaSession.setActionHandler("nexttrack", function () { next(false); });
        } catch (e) {}
    }
    document.addEventListener("keydown", function (e) {
        if (e.target && /input|textarea/i.test(e.target.tagName)) return;
        if (e.code === "Space") { e.preventDefault(); togglePlay(); }
    });

    setPlayIcon();
    checkAuth();
    loadGenres();
    loadView("foryou");
})();
