

const CLOUD_KEY   = "nocturne-cloud-project";
const ONBOARD_KEY = "nocturne-code-onboarded";

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function elFrom(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
function timeAgo(ts) {
    const s = Math.max(1, Math.round((Date.now() - ts) / 1000));
    if (s < 60) return "just now";
    const m = Math.round(s / 60); if (m < 60) return m + "m ago";
    const h = Math.round(m / 60); if (h < 24) return h + "h ago";
    const d = Math.round(h / 24); return d + "d ago";
}
const ICON = {
    cloud: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>',
    github: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 1.5A10.5 10.5 0 0 0 8.7 22c.5.1.7-.2.7-.5v-1.7c-2.9.6-3.5-1.4-3.5-1.4-.5-1.2-1.2-1.5-1.2-1.5-.9-.6.1-.6.1-.6 1 .1 1.6 1 1.6 1 .9 1.6 2.4 1.1 3 .9.1-.7.4-1.1.6-1.4-2.3-.3-4.7-1.2-4.7-5.1 0-1.1.4-2 1-2.7-.1-.3-.5-1.3.1-2.7 0 0 .9-.3 2.8 1a9.6 9.6 0 0 1 5 0c1.9-1.3 2.8-1 2.8-1 .6 1.4.2 2.4.1 2.7.6.7 1 1.6 1 2.7 0 3.9-2.4 4.8-4.7 5.1.4.3.7.9.7 1.9v2.8c0 .3.2.6.7.5A10.5 10.5 0 0 0 12 1.5z"/></svg>',
    zip: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>',
    plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
    sparkle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2l2.5 6.5L21 11l-6.5 2.5L12 20l-2.5-6.5L3 11l6.5-2.5z"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>'
};

export function initProjects(api) {

    let cloud = loadCloud();
    let authed = null;
    let saveTimer = null;

    function loadCloud() { try { const r = JSON.parse(localStorage.getItem(CLOUD_KEY)); return (r && r.id) ? r : null; } catch { return null; } }
    function setCloud(c) { cloud = c; try { c ? localStorage.setItem(CLOUD_KEY, JSON.stringify(c)) : localStorage.removeItem(CLOUD_KEY); } catch {} }

    async function jget(path) { const r = await fetch("/api/projects" + path, { credentials: "same-origin" }); return r; }
    async function jsend(method, path, body) {
        return fetch("/api/projects" + path, { method, credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    }

    const host = elFrom(`<div id="projOverlays">
      <div class="proj-overlay" id="projectsOverlay"><div class="proj-modal">
        <div class="proj-head"><span class="proj-title">Projects</span><button class="ct-icon proj-x" data-close>✕</button></div>
        <div class="proj-actions">
          <button class="proj-act" id="pjNew">${ICON.plus}<span>New project</span></button>
          <button class="proj-act" id="pjSave">${ICON.cloud}<span>Save to cloud</span></button>
          <button class="proj-act" id="pjGithub">${ICON.github}<span>Import GitHub</span></button>
          <button class="proj-act" id="pjExport">${ICON.zip}<span>Export .zip</span></button>
        </div>
        <div class="proj-current" id="pjCurrent"></div>
        <div class="proj-listwrap"><div class="proj-list" id="pjList"></div></div>
      </div></div>

      <div class="proj-overlay" id="githubOverlay"><div class="proj-modal proj-modal-sm">
        <div class="proj-head"><span class="proj-title">Import from GitHub</span><button class="ct-icon proj-x" data-close>✕</button></div>
        <div class="proj-body">
          <p class="proj-hint">Paste a public repo as <code>owner/name</code> or a github.com URL. Its text files load straight into the editor.</p>
          <input type="text" id="ghInput" class="proj-input" placeholder="facebook/react  ·  https://github.com/owner/repo" spellcheck="false" autocomplete="off">
          <div class="proj-ex">Try: <button class="gh-ex" data-repo="octocat/Spoon-Knife">octocat/Spoon-Knife</button> <button class="gh-ex" data-repo="jamiebuilds/the-super-tiny-compiler">the-super-tiny-compiler</button></div>
          <div class="proj-status" id="ghStatus"></div>
          <div class="proj-foot"><button class="proj-primary" id="ghGo">Import repo</button></div>
        </div>
      </div></div>

      <div class="proj-overlay" id="wizardOverlay"><div class="proj-modal proj-wizard">
        <div class="proj-head"><span class="proj-title" id="wzTitle">Start a new project</span><button class="ct-icon proj-x" data-close>✕</button></div>
        <div class="proj-body" id="wzBody"></div>
      </div></div>

      <div class="proj-overlay" id="authPromptOverlay"><div class="proj-modal proj-modal-sm">
        <div class="proj-head"><span class="proj-title" id="apTitle">Create your account</span></div>
        <div class="proj-body">
          <p class="proj-hint" id="apBlurb">Save your projects to the cloud, use the AI agent, and pick up on any device. No email needed.</p>
          <input id="apUser" class="proj-input" type="text" placeholder="Username" autocomplete="username" spellcheck="false">
          <input id="apPass" class="proj-input proj-pass" type="password" placeholder="Password (8+ characters)" autocomplete="new-password">
          <cap-widget id="apCaptcha" data-cap-api-endpoint="/api/captcha/" data-cap-disable-haptics></cap-widget>
          <div class="proj-status" id="apErr"></div>
          <div class="proj-foot proj-foot-split">
            <button class="pj-link" id="apToggle" type="button">Have an account? Sign in</button>
            <button class="proj-primary" id="apSubmit" type="button">Create account</button>
          </div>
          <div class="ap-skip"><button class="pj-link" id="apSkip" type="button">Maybe later</button></div>
        </div>
      </div></div>
    </div>`);
    document.body.appendChild(host);

    const $ = id => host.querySelector("#" + id);
    const projectsOverlay = $("projectsOverlay"), githubOverlay = $("githubOverlay"), wizardOverlay = $("wizardOverlay");
    const open = o => o.classList.add("open");
    const close = o => o.classList.remove("open");
    const closeAll = () => host.querySelectorAll(".proj-overlay").forEach(close);
    host.querySelectorAll("[data-close]").forEach(b => b.addEventListener("click", () => close(b.closest(".proj-overlay"))));
    host.querySelectorAll(".proj-overlay").forEach(o => o.addEventListener("click", e => { if (e.target === o) close(o); }));
    document.addEventListener("keydown", e => { if (e.key === "Escape") closeAll(); });

    async function openProjects() {
        open(projectsOverlay);
        await renderProjects();
    }
    async function renderProjects() {
        const list = $("pjList"), current = $("pjCurrent");
        list.innerHTML = `<div class="proj-loading">Loading…</div>`;
        let r;
        try { r = await jget(""); } catch { list.innerHTML = `<div class="proj-empty">Couldn't reach the server.</div>`; return; }
        if (r.status === 401) {
            authed = false;
            current.innerHTML = "";
            list.innerHTML = `<div class="proj-empty"><b>Sign in to save projects.</b><br>Your code is kept in this browser until you do. <a href="/account.html">Sign in or create an account →</a></div>`;
            return;
        }
        authed = true;
        const data = await r.json().catch(() => ({ projects: [] }));
        const projects = data.projects || [];
        current.innerHTML = cloud
            ? `<span class="pj-dot"></span>Editing cloud project <b>${esc(cloud.name)}</b> — changes autosave.`
            : `<span class="pj-dot off"></span>This workspace isn't saved to the cloud yet. <button class="pj-link" id="pjSaveInline">Save it</button>.`;
        current.querySelector("#pjSaveInline")?.addEventListener("click", () => saveToCloud(true));
        if (!projects.length) {
            list.innerHTML = `<div class="proj-empty">No saved projects yet. Hit <b>New project</b> or <b>Save to cloud</b>.</div>`;
            return;
        }
        list.innerHTML = "";
        for (const p of projects) {
            const row = elFrom(`<div class="proj-row${cloud && cloud.id === p.id ? " active" : ""}">
                <div class="proj-row-main" data-open="${p.id}">
                    <div class="proj-row-name">${ICON.file}<span>${esc(p.name)}</span></div>
                    <div class="proj-row-meta">${(p.bytes / 1024).toFixed(1)} KB · ${timeAgo(p.updatedAt)}</div>
                </div>
                <button class="proj-row-del" data-del="${p.id}" title="Delete">${ICON.trash}</button>
            </div>`);
            list.appendChild(row);
        }
        list.querySelectorAll("[data-open]").forEach(b => b.addEventListener("click", () => openProject(+b.dataset.open)));
        list.querySelectorAll("[data-del]").forEach(b => b.addEventListener("click", () => deleteProject(+b.dataset.del, b)));
    }

    async function openProject(id) {
        api.status("opening…");
        let r; try { r = await jget("/" + id); } catch { api.status("open failed"); return; }
        if (!r.ok) { api.status("open failed"); return; }
        const p = await r.json();
        const files = (p.data && p.data.files) || [];
        if (!files.length) { api.status("empty project"); return; }
        api.applyWorkspace(files, p.data.active);
        api.saveLocal();
        setCloud({ id: p.id, name: p.name });
        closeAll();
        api.status(`opened ${p.name}`);
    }

    async function deleteProject(id, btn) {
        if (!confirm("Delete this project? This can't be undone.")) return;
        btn.disabled = true;
        try { await fetch("/api/projects/" + id, { method: "DELETE", credentials: "same-origin" }); } catch {}
        if (cloud && cloud.id === id) setCloud(null);
        renderProjects();
    }

    async function saveToCloud(forceNew) {
        const ws = api.getWorkspace();
        if (!ws.files.length) { api.status("nothing to save"); return; }
        if (authed === false) { open(projectsOverlay); renderProjects(); return; }
        if (cloud && !forceNew) {
            try {
                const r = await jsend("PUT", "/" + cloud.id, { data: ws });
                if (r.status === 401) { setCloud(null); return saveToCloud(true); }
                if (!r.ok) { const e = await r.json().catch(() => ({})); api.status(e.error || "save failed"); return; }
                api.status("saved to cloud"); return;
            } catch { api.status("save failed"); return; }
        }
        const name = prompt("Name this project:", cloud?.name || suggestName(ws));
        if (name === null) return;
        try {
            const r = await jsend("POST", "", { name, data: ws });
            if (r.status === 401) { open(projectsOverlay); renderProjects(); return; }
            const out = await r.json().catch(() => ({}));
            if (!r.ok) { api.status(out.error || "save failed"); return; }
            setCloud({ id: out.id, name: out.name });
            api.status("saved to cloud");
            if (projectsOverlay.classList.contains("open")) renderProjects();
        } catch { api.status("save failed"); }
    }
    // Save the current workspace to the cloud (creating or updating the linked
    // project) and hand back its /s/<username>/<n> share link. Returns
    // { ok:false, reason:"signed-out" } when there's no account to key the link
    // off of — the caller falls back to the old client-side hash link.
    async function shareCurrent() {
        const ws = api.getWorkspace();
        if (!ws.files.length) return { ok: false, reason: "empty" };
        if (authed == null) {
            try { const r = await jget(""); authed = r.status !== 401; } catch { authed = false; }
        }
        if (!authed) return { ok: false, reason: "signed-out" };
        try {
            let r, out;
            if (cloud) {
                r = await jsend("PUT", "/" + cloud.id, { data: ws });
                if (r.status === 401) { setCloud(null); authed = false; return { ok: false, reason: "signed-out" }; }
                if (!r.ok) return { ok: false, reason: "error" };
                out = await r.json().catch(() => ({}));
                return { ok: true, url: out.shareUrl, seq: out.seq, name: cloud.name };
            }
            const name = suggestName(ws);
            r = await jsend("POST", "", { name, data: ws });
            if (r.status === 401) { authed = false; return { ok: false, reason: "signed-out" }; }
            out = await r.json().catch(() => ({}));
            if (!r.ok) return { ok: false, reason: "error" };
            setCloud({ id: out.id, name: out.name });
            if (projectsOverlay.classList.contains("open")) renderProjects();
            return { ok: true, url: out.shareUrl, seq: out.seq, name: out.name };
        } catch { return { ok: false, reason: "error" }; }
    }

    function suggestName(ws) {
        const entry = ws.files.find(f => /^(index\.|main\.|app\.)/i.test(f.name)) || ws.files[0];
        return (entry ? entry.name.replace(/\.[^.]+$/, "") : "project").slice(0, 40) || "project";
    }

    function markDirty() {
        if (!cloud) return;
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { saveToCloud(false); }, 1500);
    }

    async function exportZip() {
        const ws = api.getWorkspace();
        if (!ws.files.length) { api.status("nothing to export"); return; }
        api.status("zipping…");
        try {
            const r = await fetch("/api/projects/export", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: cloud?.name || "project", data: ws }) });
            if (!r.ok) { const e = await r.json().catch(() => ({})); api.status(e.error || "export failed"); return; }
            const blob = await r.blob();
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url; a.download = (cloud?.name || "project").replace(/[^A-Za-z0-9._-]+/g, "-") + ".zip";
            document.body.appendChild(a); a.click(); a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 30000);
            api.status("exported .zip");
        } catch { api.status("export failed"); }
    }

    function openGithub() {
        close(projectsOverlay); open(githubOverlay);
        $("ghStatus").textContent = ""; $("ghStatus").className = "proj-status";
        setTimeout(() => $("ghInput").focus(), 80);
    }
    async function doGithubImport(repo) {
        repo = (repo || $("ghInput").value || "").trim();
        if (!repo) return;
        const st = $("ghStatus"), go = $("ghGo");
        st.className = "proj-status busy"; st.textContent = "Fetching " + repo + " …";
        go.disabled = true;
        try {
            const r = await fetch("/api/github/import", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo }) });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) { st.className = "proj-status err"; st.textContent = data.error || ("Import failed (" + r.status + ")"); go.disabled = false; return; }
            api.applyWorkspace(data.files, data.files[0].name);
            api.saveLocal();
            setCloud(null);
            st.className = "proj-status ok"; st.textContent = `Imported ${data.fileCount} files from ${data.owner}/${data.repo}.`;
            api.status(`imported ${data.owner}/${data.repo}`);
            setTimeout(closeAll, 700);
        } catch (e) { st.className = "proj-status err"; st.textContent = "Import failed: " + (e.message || e); }
        finally { go.disabled = false; }
    }

    function openWizard() { open(wizardOverlay); renderWizardHome(); }
    function renderWizardHome() {
        $("wzTitle").textContent = "Start a new project";
        $("wzBody").innerHTML = `
          <p class="proj-hint">Pick how you want to begin — you can change anything later.</p>
          <div class="wz-grid">
            <button class="wz-card" data-wz="template"><span class="wz-ic">${ICON.file}</span><b>From a template</b><small>HTML site, Python, C++, and more</small></button>
            <button class="wz-card" data-wz="ai"><span class="wz-ic">${ICON.sparkle}</span><b>Let AI build it</b><small>Describe it — the agent writes &amp; runs the code</small></button>
            <button class="wz-card" data-wz="github"><span class="wz-ic">${ICON.github}</span><b>Import from GitHub</b><small>Open any public repo in the editor</small></button>
            <button class="wz-card" data-wz="blank"><span class="wz-ic">${ICON.plus}</span><b>Blank file</b><small>Start from an empty editor</small></button>
          </div>
          <div class="wz-tourrow"><button class="pj-link" id="wzReplayTour" type="button">↻ Replay the feature tour</button></div>`;
        $("wzBody").querySelector("#wzReplayTour")?.addEventListener("click", () => { close(wizardOverlay); startTour(); });
        $("wzBody").querySelectorAll("[data-wz]").forEach(b => b.addEventListener("click", () => {
            const kind = b.dataset.wz;
            if (kind === "template") renderWizardTemplates();
            else if (kind === "ai") renderWizardAI();
            else if (kind === "github") { close(wizardOverlay); openGithub(); }
            else { markOnboarded(); api.applyWorkspace([{ name: "untitled.txt", content: "" }], "untitled.txt"); api.saveLocal(); closeAll(); }
        }));
    }
    function renderWizardTemplates() {
        $("wzTitle").textContent = "Choose a template";
        const cards = (api.templates || []).map((t, i) =>
            `<button class="wz-tpl" data-i="${i}"><b>${esc(t.name)}</b><span>${esc(t.lang)}</span><small>${esc(t.desc)}</small></button>`).join("");
        $("wzBody").innerHTML = `<div class="wz-back-row"><button class="pj-link" id="wzBack">← back</button></div><div class="wz-tpls">${cards}</div>`;
        $("wzBack").addEventListener("click", renderWizardHome);
        $("wzBody").querySelectorAll("[data-i]").forEach(b => b.addEventListener("click", () => {
            const t = api.templates[+b.dataset.i];
            applyTemplate(t);
            markOnboarded(); closeAll();
        }));
    }
    function renderWizardAI() {
        $("wzTitle").textContent = "Let the AI build it";
        const models = (api.ai && api.ai.modelsForPicker && api.ai.modelsForPicker()) || [];
        const opts = models.map(m => `<option value="${esc(m.id)}">${esc(m.label || m.id)}</option>`).join("");
        $("wzBody").innerHTML = `
          <div class="wz-back-row"><button class="pj-link" id="wzBack">← back</button></div>
          <p class="proj-hint">Describe what you want to build. The agent will create the files and run the code for you (uses your AI credits).</p>
          <textarea id="wzTask" class="proj-input proj-area" placeholder="e.g. a snake game in HTML canvas with a score counter"></textarea>
          ${opts ? `<label class="wz-modellabel">Model <select id="wzModel" class="proj-input">${opts}</select></label>` : ""}
          <div class="proj-foot"><button class="proj-primary" id="wzBuild">${ICON.sparkle}<span>Build it</span></button></div>`;
        $("wzBack").addEventListener("click", renderWizardHome);
        const sel = $("wzModel"); if (sel && api.ai.getModelId) sel.value = api.ai.getModelId();
        $("wzBuild").addEventListener("click", () => {
            const task = ($("wzTask").value || "").trim();
            if (!task) { $("wzTask").focus(); return; }
            if (sel && api.ai.setModelId) api.ai.setModelId(sel.value);
            markOnboarded(); closeAll();
            api.openAIPanel();
            api.ai.setAgentMode(true);
            api.ai.runAgent(task);
        });
    }
    function applyTemplate(t) {
        if (!t) return;
        if (t.files) api.applyWorkspace(t.files, t.files[0].name);
        else {
            const EXT = { javascript: "js", typescript: "ts", python: "py", html: "html", markdown: "md", json: "json", c: "c", cpp: "cpp", csharp: "cs", rust: "rs", go: "go", java: "java", ruby: "rb", sql: "sql", plaintext: "txt" };
            const ext = EXT[t.lang] || "txt";
            const name = t.id === "blank" ? "untitled.txt" : t.lang === "html" ? "index.html" : t.lang === "markdown" ? "README.md" : "main." + ext;
            api.applyWorkspace([{ name, content: t.code || "" }], name);
        }
        api.saveLocal();
    }
    function markOnboarded() { try { localStorage.setItem(ONBOARD_KEY, "1"); } catch {} }

    function startTour(onDone) {
        const openPanel = () => { try { api.openAIPanel(); } catch {} };
        const steps = [
            { sel: null, title: "Welcome to the Nocturne IDE", text: "A full editor with 30+ languages and AI built in. Here's a quick 20-second tour." },
            { sel: "#btnProjects", title: "Your projects", text: "Save your work to the cloud, open any GitHub repo, export a .zip, or start a new project — all here." },
            { sel: "#btnTemplate", title: "Templates", text: "Skip the blank page — start from a template: a website, Python, C++, and lots more." },
            { sel: "#btnRun", title: "Run your code", text: "Press Run (or Ctrl/⌘+Enter). Single files run right here; multi-file projects open in their own tab." },
            { sel: "#btnAi", title: "AI assistant", text: "Ask the AI to explain, refactor, debug, or write code for you.", before: openPanel },
            { sel: "#btnAgentMode", title: "Agent mode — switch it on here", text: "Flip this on and the AI takes over the editor: it writes files and runs code on its own to build what you describe. (Also in Preferences.)", before: openPanel },
            { sel: null, title: "You're all set 🎉", text: "Pick a template, import a repo, or just describe what you want — the agent will build it. Have fun!" }
        ];
        const root = elFrom(`<div class="tour-root">
            <div class="tour-spot"></div>
            <div class="tour-card">
              <div class="tour-meta"><span class="tour-step"></span><button class="tour-skip" type="button">Skip tour</button></div>
              <div class="tour-title"></div>
              <div class="tour-text"></div>
              <div class="tour-nav"><button class="tour-back" type="button">Back</button><button class="tour-next" type="button">Next</button></div>
            </div></div>`);
        document.body.appendChild(root);
        const spot = root.querySelector(".tour-spot"), cardEl = root.querySelector(".tour-card");
        let i = 0;
        function place(step) {
            const el = step.sel ? document.querySelector(step.sel) : null;
            const vw = window.innerWidth, vh = window.innerHeight;
            let r;
            if (el && el.getBoundingClientRect().width) { const b = el.getBoundingClientRect(); r = { left: b.left, top: b.top, width: b.width, height: b.height }; }
            else r = { left: vw / 2 - 170, top: vh / 2 - 110, width: 340, height: 220 };
            const pad = step.sel ? 8 : 0;
            spot.style.left = (r.left - pad) + "px"; spot.style.top = (r.top - pad) + "px";
            spot.style.width = (r.width + pad * 2) + "px"; spot.style.height = (r.height + pad * 2) + "px";
            spot.style.borderRadius = step.sel ? "12px" : "18px";
            root.querySelector(".tour-step").textContent = "Step " + (i + 1) + " of " + steps.length;
            root.querySelector(".tour-title").textContent = step.title;
            root.querySelector(".tour-text").textContent = step.text;
            root.querySelector(".tour-back").style.visibility = i === 0 ? "hidden" : "visible";
            root.querySelector(".tour-next").textContent = i === steps.length - 1 ? "Get started" : "Next";
            const cw = 308, chh = cardEl.offsetHeight || 170;
            let top = r.top + r.height + 16;
            if (top + chh > vh - 14) top = Math.max(14, r.top - chh - 16);
            let left = Math.max(14, Math.min(r.left + r.width / 2 - cw / 2, vw - cw - 14));
            cardEl.style.top = top + "px"; cardEl.style.left = left + "px";
            cardEl.classList.remove("pop"); void cardEl.offsetWidth; cardEl.classList.add("pop");
        }
        function render() { const step = steps[i]; if (step.before) { step.before(); setTimeout(() => place(step), 240); } else place(step); }
        function finish(viaDone) { try { root.remove(); } catch {} window.removeEventListener("resize", onResize); markOnboarded(); if (viaDone && typeof onDone === "function") { try { onDone(); } catch {} } }
        const onResize = () => place(steps[i]);
        window.addEventListener("resize", onResize);
        root.querySelector(".tour-next").addEventListener("click", () => { if (i >= steps.length - 1) finish(true); else { i++; render(); } });
        root.querySelector(".tour-back").addEventListener("click", () => { if (i > 0) { i--; render(); } });
        root.querySelector(".tour-skip").addEventListener("click", () => finish(false));

        spot.style.left = "-5vw"; spot.style.top = "-5vh"; spot.style.width = "110vw"; spot.style.height = "110vh"; spot.style.borderRadius = "0";
        requestAnimationFrame(() => requestAnimationFrame(render));
    }

    function afterTour() {
        if (authed === true) openWizard();
        else openAuthPrompt(() => openWizard());
    }

    function openAuthPrompt(onDone) {
        const ov = $("authPromptOverlay");
        let mode = "signup", done = false;
        const finish = () => { if (done) return; done = true; close(ov); if (typeof onDone === "function") { try { onDone(); } catch {} } };
        const showErr = (m) => { $("apErr").className = "proj-status err"; $("apErr").textContent = m; };
        function paint() {
            $("apTitle").textContent = mode === "signup" ? "Create your account" : "Welcome back";
            $("apBlurb").textContent = mode === "signup"
                ? "Save your projects to the cloud, use the AI agent, and pick up on any device. No email needed."
                : "Sign in to save projects, use the AI agent, and sync across devices.";
            $("apSubmit").textContent = mode === "signup" ? "Create account" : "Sign in";
            $("apToggle").textContent = mode === "signup" ? "Have an account? Sign in" : "New here? Create an account";
            $("apPass").autocomplete = mode === "signup" ? "new-password" : "current-password";
            $("apErr").className = "proj-status"; $("apErr").textContent = "";
        }
        // Cap's <cap-widget> is a custom element from the deferred /cap.js, so it may not be
        // upgraded yet when this modal is built. Wait for it, with a ceiling so a failed script
        // load shows a normal error instead of hanging the button.
        function capWidget() {
            const widget = $("apCaptcha");
            if (!widget) return Promise.resolve(null);
            if (typeof widget.solve === "function") return Promise.resolve(widget);
            return Promise.race([
                customElements.whenDefined("cap-widget").then(() => widget),
                new Promise(resolve => setTimeout(() => resolve(null), 10000))
            ]).then(w => (w && typeof w.solve === "function" ? w : null));
        }

        // Solve as soon as the prompt opens and reuse the in-flight promise on submit, so this
        // stays a one-click flow like the old auto-on-load captcha.
        let capPending = null;
        function primeCaptcha() {
            if (capPending) return capPending;
            capPending = capWidget()
                .then(w => (w && !w.token ? w.solve() : null))
                .catch(() => {})
                .finally(() => { capPending = null; });
            return capPending;
        }
        async function resetCaptcha() {
            const w = await capWidget();
            if (!w) return;
            try { w.reset(); } catch {}
            primeCaptcha();
        }
        async function getCaptchaToken() {
            const widget = $("apCaptcha");
            if (!widget) return "";
            if (widget.token) return widget.token;
            await primeCaptcha();
            return widget.token || "";
        }

        async function submit() {
            const username = ($("apUser").value || "").trim(), password = $("apPass").value || "";
            if (!username || !password) { showErr("Enter a username and password."); return; }
            const btn = $("apSubmit"); btn.disabled = true;
            $("apErr").className = "proj-status busy"; $("apErr").textContent = "…";
            try {
                const captcha = await getCaptchaToken();
                if (!captcha) { showErr("Captcha not ready yet — try again in a moment."); btn.disabled = false; return; }
                const r = await fetch("/api/auth/" + (mode === "signup" ? "signup" : "login"), { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password, captcha }) });
                const d = await r.json().catch(() => ({}));
                // Tokens are single-use, so a failed attempt always needs a freshly solved one.
                if (!r.ok) { showErr(d.error || "That didn't work — try again."); btn.disabled = false; resetCaptcha(); return; }
                authed = true;
                api.status("signed in as " + ((d.user && d.user.username) || username));
                btn.disabled = false;
                finish();
            } catch { showErr("Network error — try again."); btn.disabled = false; }
        }
        paint();
        $("apToggle").onclick = () => { mode = mode === "signup" ? "login" : "signup"; paint(); };
        $("apSubmit").onclick = submit;
        $("apSkip").onclick = finish;
        $("apPass").onkeydown = (e) => { if (e.key === "Enter") submit(); };
        $("apUser").onkeydown = (e) => { if (e.key === "Enter") $("apPass").focus(); };
        ov.onclick = (e) => { if (e.target === ov) finish(); };
        open(ov);
        primeCaptcha();
        setTimeout(() => { try { $("apUser").focus(); } catch {} }, 80);
    }

    async function maybeOnboard() {
        if (localStorage.getItem(ONBOARD_KEY) === "1") return;
        let r = null; try { r = await jget(""); } catch {}
        if (r && r.status === 200) {
            authed = true;
            const data = await r.json().catch(() => ({ projects: [] }));
            if ((data.projects || []).length > 0) { markOnboarded(); return; }
        } else if (r) { authed = false; }

        startTour(afterTour);
    }

    $("pjNew").addEventListener("click", () => { close(projectsOverlay); openWizard(); });
    $("pjSave").addEventListener("click", () => saveToCloud(false));
    $("pjGithub").addEventListener("click", openGithub);
    $("pjExport").addEventListener("click", exportZip);
    $("ghGo").addEventListener("click", () => doGithubImport());
    $("ghInput").addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doGithubImport(); } });
    host.querySelectorAll(".gh-ex").forEach(b => b.addEventListener("click", () => { $("ghInput").value = b.dataset.repo; doGithubImport(b.dataset.repo); }));

    document.getElementById("btnProjects")?.addEventListener("click", e => { e.stopPropagation(); openProjects(); });

    return { markDirty, openProjects, openWizard, openGithub, exportZip, saveToCloud, shareCurrent, maybeOnboard, startTour, openAuthPrompt };
}
