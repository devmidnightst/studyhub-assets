(() => {
    const $ = (s, r = document) => r.querySelector(s);
    const gate = $("#adminGate"), appEl = $("#adminApp");

    async function api(path, method = "GET", body) {
        const opt = { method, credentials: "same-origin", headers: {}, cache: "no-store" };
        if (body !== undefined) { opt.headers["Content-Type"] = "application/json"; opt.body = JSON.stringify(body); }
        const ctl = new AbortController(); const timer = setTimeout(() => ctl.abort(), 12000); opt.signal = ctl.signal;
        let r;
        try { r = await fetch("/api/admin" + path, opt); }
        catch (e) {
            if (ctl.signal.aborted) throw new Error("Request timed out — try a hard-refresh with Ctrl+Shift+R.");
            throw new Error("Network error: " + (e && e.message || e));
        } finally { clearTimeout(timer); }
        let data = null; try { data = await r.json(); } catch {}
        if (!r.ok) throw new Error((data && data.error) || ("HTTP " + r.status));
        return data;
    }
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const fmtMoney = micro => micro == null ? "—" : "$" + (micro / 1e6).toLocaleString(undefined, { maximumFractionDigits: 2 });
    const fmtDate = ms => ms ? new Date(ms).toLocaleString() : "—";

    let toastT = null;
    function toast(msg, bad) {
        const t = $("#adToast");
        t.textContent = msg; t.classList.toggle("bad", !!bad); t.hidden = false;
        clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 2600);
    }

    async function loadUsers() {
        const q = $("#userSearch").value.trim();
        const { users } = await api("/users?limit=100&q=" + encodeURIComponent(q));
        const el = $("#usersList");
        if (!users.length) { el.innerHTML = '<div class="ad-empty">no users</div>'; return; }
        el.innerHTML = users.map(u => `
            <div class="ad-card" data-id="${u.id}" data-name="${esc(u.username)}">
                <div class="ad-card-main">
                    <div class="ad-card-title">${esc(u.username)} <span class="ad-id">#${u.id}</span></div>
                    <div class="ad-card-sub">credits ${fmtMoney(u.creditsMicro)} · joined ${fmtDate(u.createdAt)}</div>
                </div>
                <div class="ad-card-acts">
                    <button class="ad-btn ad-sm" data-act="credits">credits</button>
                    <button class="ad-btn ad-sm" data-act="quota">quota</button>
                    <button class="ad-btn ad-sm" data-act="role">role</button>
                    <button class="ad-btn ad-sm" data-act="impersonate">log in as</button>
                    <button class="ad-btn ad-sm" data-act="password">reset pw</button>
                    <button class="ad-btn ad-sm ad-danger" data-act="ban">ban</button>
                    <button class="ad-btn ad-sm ad-danger" data-act="del">delete</button>
                </div>
            </div>`).join("");
    }

    async function userAction(act, id, name) {
        if (act === "credits") {
            const v = prompt(`Credits for "${name}".\nEnter a dollar amount to SET, or prefix with + to ADD (e.g. 25 or +10):`, "");
            if (v == null) return;
            const add = v.trim().startsWith("+");
            const dollars = parseFloat(v.replace(/^\+/, ""));
            if (!isFinite(dollars) || dollars < 0) return toast("invalid amount", true);
            const r = await api("/credits", "POST", { userId: id, dollars, mode: add ? "add" : "set" });
            toast(`${name}: ${fmtMoney(r.creditsMicro)}`); loadUsers();
        } else if (act === "quota") {
            const v = prompt(`Daily token limit for "${name}" (leave blank to remove the override and use the default):`, "");
            if (v == null) return;
            const tokens = v.trim() === "" ? null : parseInt(v.replace(/[^0-9]/g, ""), 10);
            let days = 0;
            if (tokens != null) { const d = prompt("For how many days? (blank = forever)", ""); if (d == null) return; days = parseInt(d, 10) || 0; }
            const r = await api("/quota", "POST", { scope: "user", userId: id, dailyTokens: tokens, days });
            toast(tokens == null ? "override removed for " + name : `${name}: ${tokens.toLocaleString()} tok/day`);
        } else if (act === "role") {
            const perm = prompt(`Chat permission for "${name}": member, mod, or admin`, "member");
            if (perm == null) return;
            const role = prompt("Custom role label (e.g. VIP, Legend) — blank for none:", "");
            if (role == null) return;
            const color = prompt("Name color hex (e.g. #e6c976) — blank for default:", "");
            if (color == null) return;
            await api("/chat-role", "POST", { userId: id, perm: perm.trim().toLowerCase(), role: role.trim(), color: color.trim() });
            toast(`role updated for ${name}`);
        } else if (act === "impersonate") {
            if (!confirm(`Log in as "${name}"? You'll become this user. Sign out and back in as the owner to return.`)) return;
            await api("/impersonate", "POST", { userId: id });
            toast("now logged in as " + name + " — opening site…");
            setTimeout(() => location.href = "/", 900);
        } else if (act === "password") {
            const pw = prompt(`New password for "${name}" (8-256 chars):`, "");
            if (pw == null) return;
            await api("/password", "POST", { userId: id, password: pw });
            toast("password reset for " + name);
        } else if (act === "ban") {
            const reason = prompt(`Ban "${name}". Reason (optional):`, "");
            if (reason == null) return;
            await api("/ban", "POST", { kind: "user", target: name, reason });
            toast("banned " + name); loadBans();
        } else if (act === "del") {
            if (!confirm(`Permanently DELETE "${name}" and all their data? This cannot be undone.`)) return;
            await api("/delete-user", "POST", { userId: id });
            toast("deleted " + name); loadUsers();
        }
    }

    async function loadBans() {
        const { bans } = await api("/bans");
        const el = $("#bansList");
        if (!bans.length) { el.innerHTML = '<div class="ad-empty">no active bans</div>'; return; }
        el.innerHTML = bans.map(b => `
            <div class="ad-card">
                <div class="ad-card-main">
                    <div class="ad-card-title"><span class="ad-tag">${b.target_kind}</span> ${esc(b.target)}</div>
                    <div class="ad-card-sub">${esc(b.reason) || "no reason"} · ${b.expires_at ? "until " + fmtDate(b.expires_at) : "permanent"} · by ${esc(b.banned_by)}</div>
                </div>
                <div class="ad-card-acts"><button class="ad-btn ad-sm" data-unban="${b.id}">unban</button></div>
            </div>`).join("");
    }

    async function loadSupport() {
        const { messages } = await api("/support?limit=150");
        const el = $("#supportList");
        if (!messages.length) { el.innerHTML = '<div class="ad-empty">no support messages</div>'; return; }
        el.innerHTML = messages.map(m => `
            <div class="ad-card ${m.resolved ? "done" : ""}">
                <div class="ad-card-main">
                    <div class="ad-card-title">${esc(m.subject) || "(no subject)"} ${m.resolved ? '<span class="ad-tag ok">resolved</span>' : ""}</div>
                    <div class="ad-card-body">${esc(m.body)}</div>
                    <div class="ad-card-sub">${esc(m.username) || "anonymous"}${m.ip ? " · " + esc(m.ip) : ""} · ${fmtDate(m.created_at)}</div>
                </div>
                <div class="ad-card-acts">
                    <button class="ad-btn ad-sm" data-sup="${m.id}" data-sa="${m.resolved ? "unresolve" : "resolve"}">${m.resolved ? "reopen" : "resolve"}</button>
                    <button class="ad-btn ad-sm ad-danger" data-sup="${m.id}" data-sa="delete">delete</button>
                </div>
            </div>`).join("");
    }

    const fmtTok = n => (n == null ? "—" : Number(n).toLocaleString() + " tok/day");
    async function loadQuota() {
        const q = await api("/quota");
        $("#qDefault").textContent = "default " + Number(q.defaultDaily).toLocaleString() + "/day";
        const rows = [];
        const g = q.global;
        rows.push(`<div class="ad-card"><div class="ad-card-main"><div class="ad-card-title">All users (global)</div>
            <div class="ad-card-sub">${g ? fmtTok(g.daily) + (g.until ? " · until " + fmtDate(g.until) : " · forever") : "using default " + Number(q.defaultDaily).toLocaleString()}</div></div>
            ${g ? '<div class="ad-card-acts"><button class="ad-btn ad-sm" data-qclear="global">remove</button></div>' : ""}</div>`);
        for (const u of q.users) {
            rows.push(`<div class="ad-card"><div class="ad-card-main"><div class="ad-card-title">${esc(u.username)} <span class="ad-id">#${u.userId}</span></div>
                <div class="ad-card-sub">${fmtTok(u.daily)}${u.until ? " · until " + fmtDate(u.until) : " · forever"} · used today ${Number(u.usedToday).toLocaleString()}</div></div>
                <div class="ad-card-acts"><button class="ad-btn ad-sm" data-qclear="user" data-uid="${u.userId}">remove</button></div></div>`);
        }
        $("#quotaList").innerHTML = rows.join("");
    }

    async function loadModels() {
        const { models } = await api("/models");
        const el = $("#modelsList");
        el.innerHTML = models.map(m => `
            <div class="ad-card">
                <div class="ad-card-main">
                    <div class="ad-card-title">${esc(m.label)} ${m.premium ? '<span class="ad-tag prem">premium</span>' : ""}</div>
                    <div class="ad-card-sub">${esc(m.company)} · ${esc(m.id)}</div>
                </div>
                <div class="ad-card-acts">
                    <select class="ad-input ad-sm" data-model="${esc(m.id)}">
                        <option value="all" ${m.audience === "all" ? "selected" : ""}>all</option>
                        <option value="owner" ${m.audience === "owner" ? "selected" : ""}>owner</option>
                        <option value="off" ${m.audience === "off" ? "selected" : ""}>off</option>
                    </select>
                </div>
            </div>`).join("");
    }

    function wire() {
        document.querySelectorAll(".ad-tab").forEach(t => t.addEventListener("click", () => {
            document.querySelectorAll(".ad-tab").forEach(x => x.classList.remove("active"));
            document.querySelectorAll(".ad-panel").forEach(x => x.classList.remove("active"));
            t.classList.add("active");
            const name = t.dataset.tab;
            $(`.ad-panel[data-panel="${name}"]`).classList.add("active");
            ({ users: loadUsers, bans: loadBans, quotas: loadQuota, support: loadSupport, models: loadModels }[name] || (() => {}))().catch(e => toast(e.message, true));
        }));

        $("#userRefresh").addEventListener("click", () => loadUsers().catch(e => toast(e.message, true)));
        let st; $("#userSearch").addEventListener("input", () => { clearTimeout(st); st = setTimeout(() => loadUsers().catch(() => {}), 250); });

        $("#usersList").addEventListener("click", e => {
            const btn = e.target.closest("[data-act]"); if (!btn) return;
            const card = btn.closest(".ad-card");
            userAction(btn.dataset.act, Number(card.dataset.id), card.dataset.name).catch(er => toast(er.message, true));
        });
        $("#bansList").addEventListener("click", e => {
            const btn = e.target.closest("[data-unban]"); if (!btn) return;
            api("/unban", "POST", { id: Number(btn.dataset.unban) }).then(() => { toast("unbanned"); loadBans(); }).catch(er => toast(er.message, true));
        });
        $("#banAdd").addEventListener("click", () => {
            const kind = $("#banKind").value, target = $("#banTarget").value.trim();
            if (!target) return toast("enter a target", true);
            const reason = $("#banReason").value.trim(), days = parseFloat($("#banDays").value) || 0;
            api("/ban", "POST", { kind, target, reason, days }).then(() => { toast("banned " + target); $("#banTarget").value = ""; $("#banReason").value = ""; loadBans(); }).catch(er => toast(er.message, true));
        });
        $("#supportList").addEventListener("click", e => {
            const btn = e.target.closest("[data-sup]"); if (!btn) return;
            api("/support/" + btn.dataset.sup, "POST", { action: btn.dataset.sa }).then(() => loadSupport()).catch(er => toast(er.message, true));
        });
        $("#modelsList").addEventListener("change", e => {
            const sel = e.target.closest("[data-model]"); if (!sel) return;
            api("/models", "POST", { id: sel.dataset.model, audience: sel.value }).then(() => toast("updated")).catch(er => toast(er.message, true));
        });

        $("#qScope").addEventListener("change", () => { $("#qUser").style.display = $("#qScope").value === "user" ? "" : "none"; });
        $("#qApply").addEventListener("click", () => {
            const scope = $("#qScope").value;
            const body = { scope, dailyTokens: $("#qTokens").value, days: parseFloat($("#qDays").value) || 0 };
            if (scope === "user") { const u = $("#qUser").value.trim(); if (!u) return toast("enter a username", true); body.username = u; }
            api("/quota", "POST", body).then(() => { toast("quota updated"); $("#qTokens").value = ""; $("#qDays").value = ""; loadQuota(); }).catch(er => toast(er.message, true));
        });
        $("#quotaList").addEventListener("click", e => {
            const btn = e.target.closest("[data-qclear]"); if (!btn) return;
            const body = { scope: btn.dataset.qclear, dailyTokens: null };
            if (btn.dataset.qclear === "user") body.userId = Number(btn.dataset.uid);
            api("/quota", "POST", body).then(() => { toast("override removed"); loadQuota(); }).catch(er => toast(er.message, true));
        });
    }

    if (navigator.serviceWorker) {
        try { navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => { try { r.update(); } catch {} })); } catch {}
    }

    async function meOwner() {

        try {
            const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
            const me = await (await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store", signal: ctl.signal })).json();
            clearTimeout(t);
            if (me && me.authenticated && me.user) {
                const name = String(me.user.username || "");
                if (name.toLowerCase() === "midnightsweat") return name;
            }
        } catch {}
        return null;
    }

    function enterPanel(owner) {
        gate.hidden = true; appEl.hidden = false;
        $("#adOwner").textContent = "god · " + owner;
        wire();

        api("/summary").then(s => { $("#adStats").innerHTML = `<span>${s.users} users</span><span>${s.bans} bans</span><span>${s.supportUnresolved} open tickets</span>`; }).catch(() => {});
        loadUsers().catch(e => toast(e.message, true));
    }

    (async () => {

        const boot = (typeof window !== "undefined" && window.__ADMIN_BOOT) || null;
        if (boot && boot.owner) { enterPanel(boot.owner); return; }

        let owner = null;
        try { owner = (await api("/summary")).owner; }
        catch (e) {
            owner = await meOwner();
            if (!owner) {
                gate.innerHTML = `<div style="text-align:center"><h2 style="font-weight:600">Not authorized</h2><p style="color:#8a85a8">${esc(e.message)}<br>Sign in as the owner account, then reload.</p><a href="/account" style="color:#c9c1ff">→ sign in</a></div>`;
                return;
            }
        }
        enterPanel(owner);
    })();
})();
