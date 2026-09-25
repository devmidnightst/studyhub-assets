const DEFAULT_MODEL = "navy:gpt-5.4-mini";

const COMPANY_ORDER = ["Nocturne", "ChatGPT", "Claude", "Gemini", "Grok", "DeepSeek", "Perplexity", "Llama", "Mistral", "Qwen", "Kimi", "Nemotron", "MiMo", "Cohere"];
function buildModelOptions(models, currentId) {
    const groups = {};
    for (const m of models) (groups[m.company || "Other"] ||= []).push(m);
    const cos = Object.keys(groups).sort((a, b) => {
        const ia = COMPANY_ORDER.indexOf(a), ib = COMPANY_ORDER.indexOf(b);
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return cos.map(c => {
        const opts = groups[c].map(m => `<option value="${m.id}" ${m.id === currentId ? "selected" : ""}>${m.label || m.id}</option>`).join("");
        return `<optgroup label="${c}">${opts}</optgroup>`;
    }).join("");
}

const MODEL_STORAGE    = "nocturne-ai-model-groq";
const HISTORY_STORAGE  = "nocturne-ai-history";
const INCL_CODE_STORE  = "nocturne-ai-include-code";
const AGENT_MODE_STORE = "nocturne-ai-agent-mode";
const AGENT_MAX_STEPS  = 16;

let availableModels = [];
let modelLocked = false;   // free plan → single model, picker disabled

let creditState = { authenticated: false, unlimited: false, micro: null, dollars: null };
let agentInitialMicro = 3_000_000;
const DEFAULT_PRICE = { inPerToken: 1, outPerToken: 4 };

let _cfgFetch = null;
async function ensureConfig() {
    if (_cfgFetch) return _cfgFetch;
    _cfgFetch = fetch("/api/ai/config", { cache: "no-store" })
        .then(r => r.ok ? r.json() : null)
        .then(cfg => {
            if (!cfg) return;
            if (Array.isArray(cfg.models)) availableModels = cfg.models.filter(m => m.ide !== false);
            if (typeof cfg.agentInitialMicro === "number") agentInitialMicro = cfg.agentInitialMicro;
            if (cfg.credits) creditState = { authenticated: true, ...cfg.credits };
            else creditState = { authenticated: false, unlimited: false, micro: null, dollars: null };
            modelLocked = !!cfg.modelLocked;
            const stored = localStorage.getItem(MODEL_STORAGE);
            const ids = availableModels.map(m => m.id);
            if (modelLocked || !stored || !ids.includes(stored)) {
                localStorage.setItem(MODEL_STORAGE, cfg.defaultModel || ids[0] || DEFAULT_MODEL);
            }
        })
        .catch(() => {});
    return _cfgFetch;
}
ensureConfig();

function getModel() { return localStorage.getItem(MODEL_STORAGE) || DEFAULT_MODEL; }

function pricingFor(modelId) {
    const m = availableModels.find(x => x.id === modelId);
    return (m && m.pricing) || DEFAULT_PRICE;
}

function estimateCostMicro(modelId, inTokens, outTokens) {
    const p = pricingFor(modelId);
    return Math.ceil(inTokens * p.inPerToken + outTokens * p.outPerToken);
}
function fmtDollars(micro) {
    if (micro == null) return "∞";
    const d = micro / 1_000_000;
    if (d > 0 && d < 0.01) return "$" + d.toFixed(4);
    return "$" + d.toFixed(2);
}
async function refreshCredits() {
    try {
        const r = await fetch("/api/ai/credits", { cache: "no-store", credentials: "same-origin" });
        if (!r.ok) return creditState;
        const c = await r.json();
        creditState = c.authenticated
            ? { authenticated: true, unlimited: !!c.unlimited, micro: c.micro ?? null, dollars: c.dollars ?? null }
            : { authenticated: false, unlimited: false, micro: null, dollars: null };
    } catch {}
    return creditState;
}

function systemPreamble(currentLang, currentCode, includeCode) {
    const base = `You are a coding assistant embedded in Nocturne, a midnight-themed web editor. You help the user read, write, refactor, and debug code.

Style rules:
- Prefer showing concise code over long explanations.
- When you return code, use proper fenced code blocks with a language tag (e.g. \`\`\`js ... \`\`\`).
- Keep prose tight - a few sentences, then code.
- If the request is ambiguous, ask one clarifying question.`;

    if (!includeCode || !currentCode.trim()) return base;

    const snippet = currentCode.length > 6000 ? currentCode.slice(0, 6000) + "\n// …(truncated)" : currentCode;
    return base + `\n\nThe user's current editor content (language: ${currentLang}):\n\`\`\`${currentLang}\n${snippet}\n\`\`\``;
}

async function callGroq(history, systemInstruction, model, onDelta, meta, onReasoning, opts = {}) {
    const messages = [];
    if (systemInstruction) messages.push({ role: "system", content: systemInstruction });

    for (const m of history.slice(-50)) {
        const content = String(m.text || "").slice(0, 30000);
        messages.push({ role: m.role === "assistant" ? "assistant" : "user", content });
    }

    const res = await fetch("/api/ai/chat", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        signal: opts.signal,
        body: JSON.stringify({ model, messages, agent: !!opts.agent, temperature: 0.7, max_completion_tokens: opts.agent ? 8192 : 4096, level: (localStorage.getItem("nocturne-ai-effort") || "normal"), reasoning_effort: ({ off: "low", normal: "medium", extended: "high" }[localStorage.getItem("nocturne-ai-effort")] || "medium") })
    });

    if (!res.ok) {
        let msg = `HTTP ${res.status}`;
        try { const err = await res.json(); msg = err.error || msg; } catch {}
        const e = new Error(msg);
        if (res.status === 402) e.outOfCredits = true;
        if (res.status === 401) e.needsAuth = true;
        throw e;
    }
    if (!res.body) throw new Error("no response body");

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let acc = "";
    let racc = "";
    while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() || "";
        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const payload = line.slice(6);
            if (payload === "[DONE]") continue;
            try {
                const evt = JSON.parse(payload);
                if (evt.type === "reasoning" && evt.text) {
                    racc += evt.text;
                    if (meta) meta.reasoning = racc;
                    if (onReasoning) onReasoning(racc);
                } else if (evt.type === "delta" && evt.text) {
                    acc += evt.text;
                    if (onDelta) onDelta(acc);
                } else if (evt.type === "usage") {
                    if (meta) meta.usage = evt;
                    if (opts.onUsage) opts.onUsage(evt);
                } else if (evt.type === "done") {
                    if (meta && evt.finish) meta.finish = evt.finish;
                } else if (evt.type === "error") {
                    throw new Error(evt.error || "stream error");
                }
            } catch (e) {
                if (!(e instanceof SyntaxError)) throw e;
            }
        }
    }
    return acc.trim();
}

function utf8ToB64(s) {
    const bytes = new TextEncoder().encode(s);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/=+$/, "");
}

function b64ToUtf8(s) {
    const padded = s + "===".slice((s.length + 3) % 4);
    const bin = atob(padded);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function mdRender(text) {
    const esc = s => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

    const blocks = [];
    let html = text.replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, lang, code) => {
        const i = blocks.push({ lang: lang || "plaintext", code: code.replace(/\n$/, "") }) - 1;
        return `\x00BLOCK${i}\x00`;
    });

    html = esc(html);
    html = html.replace(/&lt;(\/?)(br|sub|sup|u|kbd|mark|small)\s*\/?&gt;/gi, (_, slash, tag) => "<" + slash + tag.toLowerCase() + ">");
    html = html.replace(/^######\s+(.*)$/gm, "<h4>$1</h4>");
    html = html.replace(/^#####\s+(.*)$/gm, "<h4>$1</h4>");
    html = html.replace(/^####\s+(.*)$/gm, "<h4>$1</h4>");
    html = html.replace(/^###\s+(.*)$/gm, "<h4>$1</h4>");
    html = html.replace(/^##\s+(.*)$/gm, "<h3>$1</h3>");
    html = html.replace(/^#\s+(.*)$/gm, "<h3>$1</h3>");
    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
    html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
    html = html.replace(/^-\s+(.*)$/gm, "<li>$1</li>");
    html = html.replace(/(<li>[\s\S]*?<\/li>(\n|$))+/g, m => "<ul>" + m + "</ul>");

    html = html.split(/\n{2,}/).map(p => {
        if (/^<(h\d|ul|pre|ol|blockquote)/.test(p.trim())) return p;
        if (/^\x00BLOCK\d+\x00$/.test(p.trim())) return p;
        return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
    }).join("\n");

    html = html.replace(/\x00BLOCK(\d+)\x00/g, (_, i) => {
        const b = blocks[i];
        const enc = utf8ToB64(b.code);
        return `<div class="ai-code"><div class="ai-code-head"><span class="ai-code-lang">${esc(b.lang)}</span><button class="ai-code-insert" data-code="${enc}">insert</button><button class="ai-code-copy" data-code="${enc}">copy</button></div><pre>${esc(b.code)}</pre></div>`;
    });

    return html;
}

const AI_ACT_ICONS = {
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/></svg>',
    like: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h11.28a2 2 0 0 0 2-1.7l1.38-9a2 2 0 0 0-2-2.3z"/><path d="M7 22H4a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2h3"/></svg>',
    report: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"/><line x1="4" y1="22" x2="4" y2="15"/></svg>',
    cont: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M19 12l-7 7-7-7"/></svg>'
};

function aiActionsHtml(role, opts = {}) {
    if (role === "error") return "";
    let btns = `<button type="button" class="ai-act" data-act="copy" title="Copy" aria-label="Copy">${AI_ACT_ICONS.copy}<span class="ai-act-label">Copy</span></button>`;
    if (role === "assistant") {
        btns += `<button type="button" class="ai-act ai-act-icon" data-act="like" title="Good response" aria-label="Good response">${AI_ACT_ICONS.like}</button>`;
        btns += `<button type="button" class="ai-act ai-act-icon" data-act="report" title="Report" aria-label="Report">${AI_ACT_ICONS.report}</button>`;
        if (opts.truncated) {
            btns += `<button type="button" class="ai-act ai-continue" data-act="continue" title="Continue the response">${AI_ACT_ICONS.cont}<span class="ai-act-label">Continue</span></button>`;
        }
    }
    return btns;
}

const PANEL_THINK_CHEV = '<svg class="ai-think-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18l6-6-6-6"/></svg>';
function panelThinkHtml(done) {
    return '<div class="ai-think' + (done ? ' done' : '') + '">'
        + '<button type="button" class="ai-think-toggle" aria-expanded="false">'
        + '<span class="ai-think-label' + (done ? '' : ' thinking') + '">' + (done ? 'Thoughts' : 'Thinking') + '</span>'
        + PANEL_THINK_CHEV
        + '</button>'
        + '<div class="ai-think-body"></div>'
        + '</div>';
}
function panelEnsureThink(host) {
    let t = host.querySelector(":scope > .ai-think");
    if (!t) { host.insertAdjacentHTML("afterbegin", panelThinkHtml(false)); t = host.querySelector(":scope > .ai-think"); }
    return t;
}
function panelEnsureAnswer(host) {
    let a = host.querySelector(":scope > .ai-answer");
    if (!a) { a = document.createElement("div"); a.className = "ai-answer"; host.appendChild(a); }
    return a;
}
function panelPaintThink(host, reasoning, active) {
    const t = panelEnsureThink(host);
    const body = t.querySelector(".ai-think-body");
    if (body && body.textContent !== reasoning) {
        body.textContent = reasoning;
        if (t.classList.contains("open")) body.scrollTop = body.scrollHeight;
    }
    const lbl = t.querySelector(".ai-think-label");
    if (lbl) {
        if (active) { lbl.classList.add("thinking"); lbl.textContent = "Thinking"; }
        else { t.classList.add("done"); lbl.classList.remove("thinking"); lbl.textContent = "Thoughts"; }
    }
}

const AGENT_PROTOCOL = `You are Nocturne Agent, an autonomous coding agent inside the Nocturne web IDE. You complete the user's task yourself by creating files, editing files, and running code — step by step — until it works.

You operate in a loop: you take ONE small step, the IDE applies your actions and replies with the results, then you take the next step. Keep going until the task is done.

## Actions
Perform actions with fenced code blocks whose info string names the tool. The block body is the payload.

Write (create or fully overwrite) a file — body is the COMPLETE file contents:
\`\`\`tool write path="app.js"
console.log("hello");
\`\`\`

Run a file and read its output (body ignored; omit path to run the open file):
\`\`\`tool run path="app.js"
\`\`\`

Import a public GitHub repo's text files into the editor — body is the repo as owner/name or a github.com URL (use this when the user asks to import, clone, or open a repo):
\`\`\`tool import_github
octocat/Spoon-Knife
\`\`\`

Delete, rename, or open a file (body ignored):
\`\`\`tool delete path="old.js"
\`\`\`
\`\`\`tool rename from="a.js" to="b.js"
\`\`\`
\`\`\`tool open path="app.js"
\`\`\`

Ask the user a question when you need a decision you can't make yourself — body is JSON with the question and 2-4 short options the user can click:
\`\`\`tool ask
{"question":"Which styling approach do you want?","options":["Tailwind CSS","Plain CSS","Bootstrap"]}
\`\`\`

Finish when the task is fully complete — body is a short summary for the user:
\`\`\`tool finish
Built and verified a working todo app in app.js.
\`\`\`

## Rules
- Briefly say what you're about to do (one or two sentences), then emit the action block(s).
- Always write the WHOLE file in a \`write\` block. Never write "// ... rest unchanged" — the block replaces the entire file.
- The \`write\` block content is typed straight into the editor for the user to see — do NOT also paste the code into your prose. Keep prose to a short sentence.
- After writing runnable code, \`run\` it to check it, then fix any errors shown in the results before continuing.
- Backend/server apps run for real in a Linux container: a \`run\` starts them and returns a live URL. Make any server bind 0.0.0.0 on process.env.PORT (it is set for you) so it's reachable.
- Take small steps; you'll get the results back each time.
- Call \`finish\` as soon as the goal is met — do not loop forever.
- When you need a choice or info from the user, use an \`ask\` block (don't just write prose). The loop pauses until they answer.`;

function buildWorkspaceSnapshot(ws, perFileCap = 3000, totalCap = 10000) {
    if (!ws || !Array.isArray(ws.files) || !ws.files.length) {
        return "## Workspace\n(empty — no files yet)";
    }
    let out = `## Workspace\nOpen file: ${ws.active || "(none)"}\nFiles: ${ws.files.map(f => f.name).join(", ")}\n`;
    let budget = totalCap;
    for (const f of ws.files) {
        if (budget <= 0) { out += `\n--- ${f.name} --- (omitted, context full)\n`; continue; }
        let body = String(f.content || "");
        const cap = Math.min(perFileCap, budget);
        let trunc = "";
        if (body.length > cap) { body = body.slice(0, cap); trunc = "\n…(truncated)"; }
        budget -= body.length;
        out += `\n--- ${f.name} ---\n${body}${trunc}\n`;
    }
    return out;
}
function buildAgentSystem(ws) {
    return AGENT_PROTOCOL + "\n\n" + buildWorkspaceSnapshot(ws);
}

const AGENT_TOOL_RE = /```tool[ :]*([^\n`]*)\r?\n?([\s\S]*?)```/g;
function parseAttrs(s) {
    const attrs = {};
    const re = /(\w+)=(?:"([^"]*)"|'([^']*)'|([^\s`]+))/g;
    let m;
    while ((m = re.exec(s))) attrs[m[1]] = m[2] != null ? m[2] : (m[3] != null ? m[3] : (m[4] || ""));
    return attrs;
}
function toolFromBlock(info, body) {
    const verb = (info.split(/\s+/)[0] || "").toLowerCase();
    const a = parseAttrs(info);
    const path = a.path || a.file || a.name || "";
    if (verb === "write" || verb === "create") return { tool: "write", path, content: body };
    if (verb === "run")    return { tool: "run", path };
    if (verb === "delete") return { tool: "delete", path };
    if (verb === "rename") return { tool: "rename", from: a.from || "", to: a.to || "" };
    if (verb === "open")   return { tool: "open", path };
    if (verb === "import_github" || verb === "github" || verb === "import" || verb === "clone") {
        let repo = a.repo || a.url || a.name || "";
        if (!repo) {
            const b = body.trim();
            try { const jj = JSON.parse(b); repo = jj.repo || jj.url || jj.name || ""; } catch { repo = b.split(/\s+/)[0] || b; }
        }
        return { tool: "import_github", repo: String(repo).trim() };
    }
    if (verb === "ask") {
        let q = "", options = [];
        try { const j = JSON.parse(body); q = String(j.question || j.q || "").trim(); if (Array.isArray(j.options)) options = j.options.map(String).slice(0, 6); }
        catch { q = body.trim(); }
        if (!q) q = body.trim();
        return { tool: "ask", question: q, options };
    }
    if (verb === "finish") return { tool: "finish", summary: body.trim() };
    return null;
}
function parseAgentActions(raw) {
    const actions = [];
    AGENT_TOOL_RE.lastIndex = 0;
    let m;
    while ((m = AGENT_TOOL_RE.exec(raw))) {
        const action = toolFromBlock((m[1] || "").trim(), (m[2] != null ? m[2] : "").replace(/\r?\n$/, ""));
        if (action) actions.push(action);
    }
    return actions;
}

const TOOL_LABEL = { write: ["write", "tw"], run: ["run", "tr"], delete: ["delete", "td"], rename: ["rename", "tn"], open: ["open", "to"], import_github: ["github", "tg"] };
function escHtml(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function renderToolCard(info, body) {
    const verb = (info.split(/\s+/)[0] || "").toLowerCase();
    const a = parseAttrs(info);
    if (verb === "finish") {
        return `<div class="tool-card tool-finish"><div class="tool-row"><span class="tool-badge tf">done</span><span class="tool-path">task complete</span></div>${body.trim() ? `<div class="tool-finish-msg">${mdRender(body)}</div>` : ""}</div>`;
    }
    if (verb === "write" || verb === "create") {

        const path = a.path || a.file || a.name || "file";
        const lines = body ? body.split("\n").length : 0;
        return `<div class="tool-card"><div class="tool-row"><span class="tool-badge tw">write</span><span class="tool-path">${escHtml(path)}</span><span class="tool-meta">${lines} line${lines === 1 ? "" : "s"} → editor</span></div></div>`;
    }
    if (verb === "ask") {
        let q = "", options = [];
        try { const j = JSON.parse(body); q = String(j.question || j.q || "").trim(); if (Array.isArray(j.options)) options = j.options.map(String).slice(0, 6); }
        catch { q = body.trim(); }
        if (!q) q = body.trim();
        const opts = options.map(o => `<button type="button" class="ask-option" data-answer="${escHtml(o)}">${escHtml(o)}</button>`).join("");
        return `<div class="tool-card tool-ask"><div class="ask-q">${escHtml(q)}</div>${opts ? `<div class="ask-opts">${opts}</div>` : ""}<div class="ask-hint">${opts ? "Pick an option or type your own answer below." : "Type your answer below."}</div></div>`;
    }
    if (verb === "import_github" || verb === "github" || verb === "import" || verb === "clone") {
        let repo = a.repo || a.url || a.name || "";
        if (!repo) { const b = body.trim(); try { repo = JSON.parse(b).repo || JSON.parse(b).url || ""; } catch { repo = b.split(/\s+/)[0] || ""; } }
        return `<div class="tool-card"><div class="tool-row"><span class="tool-badge tg">github</span><span class="tool-path">${escHtml(repo || "repo")}</span><span class="tool-meta">import → editor</span></div></div>`;
    }
    const [label, cls] = TOOL_LABEL[verb] || [verb || "tool", "tx"];
    const target = verb === "rename" ? `${escHtml(a.from || "")} → ${escHtml(a.to || "")}` : escHtml(a.path || a.file || a.name || "");
    return `<div class="tool-card"><div class="tool-row"><span class="tool-badge ${cls}">${label}</span><span class="tool-path">${target}</span></div></div>`;
}

function renderAgentMessage(text) {
    AGENT_TOOL_RE.lastIndex = 0;
    let html = "", last = 0, m, any = false;
    while ((m = AGENT_TOOL_RE.exec(text))) {
        any = true;
        const before = text.slice(last, m.index);
        if (before.trim()) html += mdRender(before);
        html += renderToolCard((m[1] || "").trim(), (m[2] != null ? m[2] : "").replace(/\r?\n$/, ""));
        last = AGENT_TOOL_RE.lastIndex;
    }
    const tail = text.slice(last);
    if (tail.trim()) html += mdRender(tail);
    return any ? (html || mdRender(text)) : mdRender(text);
}

function renderAgentStreaming(text) {
    const fenceCount = (text.match(/```/g) || []).length;
    if (fenceCount % 2 === 1) {
        const open = text.lastIndexOf("```");
        const head = text.slice(0, open);
        const m = /```tool[ :]*([^\n`]*)/.exec(text.slice(open));
        let chip = "";
        if (m) {
            const info = m[1].trim();
            const verb = (info.split(/\s+/)[0] || "tool").toLowerCase();
            const a = parseAttrs(info);
            const tgt = a.path || a.file || a.name || a.to || "";
            const cls = (TOOL_LABEL[verb] || ["", "tx"])[1];
            chip = `<div class="tool-card tool-live"><div class="tool-row"><span class="tool-badge ${verb === "write" ? "tw" : cls}">${escHtml(verb)}</span><span class="tool-path">${escHtml(tgt)}</span><span class="tool-meta">working…</span></div></div>`;
        }
        return renderAgentMessage(head) + chip;
    }
    return renderAgentMessage(text);
}

const AGENT_ERR_MAP = [
    [/tokens per minute|TPM|Request too large|rate_limit|413/i, "This model hit its size/rate limit for agent mode. Switch to a different model (ChatGPT 5.4 mini or Claude work well) from the model picker in AI settings."],
    [/reasoning_effort/i, "This model rejected the reasoning setting for agent mode — pick a different model in AI settings."],
    [/Error in input stream|ECONNRESET|terminated|socket|network|fetch failed|premature|aborted/i, "The model connection dropped mid-response. I retried automatically; if it keeps happening, try a different model."]
];
function friendlyError(msg) {
    const s = String(msg || "");
    for (const [re, friendly] of AGENT_ERR_MAP) if (re.test(s)) return friendly;
    return s;
}
function isTransientError(msg) {
    return /Error in input stream|ECONNRESET|terminated|socket|network|fetch failed|premature|aborted|502|503|504/i.test(String(msg || ""));
}

export class AIPanel {
    constructor(root, opts = {}) {
        this.root = root;
        this.messagesEl = root.querySelector(".ai-messages");
        this.inputEl    = root.querySelector(".ai-input");
        this.sendBtn    = root.querySelector("#aiSend");
        this.modelLabel = root.querySelector("#aiModel");
        this.quickBar   = root.querySelector(".ai-quick");
        this.settingsEl = root.querySelector(".ai-settings");
        this.inclToggle = root.querySelector("#aiIncludeCode");

        this.modelSelect = root.querySelector("#aiModelSelect");

        this.creditsEl = root.querySelector("#aiCredits");
        this.estEl     = root.querySelector("#aiEst");
        this.agentBtn  = root.querySelector("#btnAgentMode");
        this.stopBtn   = root.querySelector("#aiStop");

        this.getCode = opts.getCode || (() => "");
        this.getLang = opts.getLang || (() => "plaintext");
        this.onInsert = opts.onInsert || (() => {});
        this.agent = opts.agent || null;
        this.onPhase = opts.onPhase || (() => {});
        this.onAgentMode = opts.onAgentMode || (() => {});

        this.agentMode = !!this.agent && localStorage.getItem(AGENT_MODE_STORE) === "1";
        this.running = false;
        this.abort = null;

        this.history = this.loadHistory();
        this.busy = false;

        this.renderAll();
        this.wire();
        this.updateModelLabel();
        this.populateModels();
        this.applyAgentMode();
        this.refreshCreditsUI();
    }

    creditsDepleted() {
        return creditState.authenticated && !creditState.unlimited && (creditState.micro != null) && creditState.micro <= 0;
    }

    async populateModels() {
        await ensureConfig();
        if (!this.modelSelect) return;
        if (!availableModels.length) return;
        const cur = getModel();
        this.modelSelect.innerHTML = buildModelOptions(availableModels, cur);
        this.modelSelect.disabled = modelLocked;
        if (modelLocked) this.modelSelect.title = "Upgrade to choose from the full model lineup";
        this.updateModelLabel();
    }

    loadHistory() {
        try {
            const raw = localStorage.getItem(HISTORY_STORAGE);
            return raw ? JSON.parse(raw) : [];
        } catch { return []; }
    }

    saveHistory() {
        const trimmed = this.history.length > 40;
        try { localStorage.setItem(HISTORY_STORAGE, JSON.stringify(this.history.slice(-40))); } catch {}
        if (trimmed) this.flashCompaction();
    }

    updateModelLabel() {
        if (this.modelLabel) this.modelLabel.textContent = getModel();
    }

    modelsForPicker() { return availableModels.slice(); }
    getModelId() { return getModel(); }
    setModelId(id) {
        if (!id) return;
        localStorage.setItem(MODEL_STORAGE, id);
        this.updateModelLabel();
        if (this.modelSelect) this.modelSelect.value = id;
    }

    renderAll() {
        this.messagesEl.innerHTML = "";
        if (this.history.length === 0) {
            this.messagesEl.innerHTML = `<div class="ai-empty">
                <div class="ai-empty-title">Ask me anything</div>
                <div class="ai-empty-sub">I can explain code, refactor, debug, or generate. Use the buttons below for quick actions.</div>
            </div>`;
        } else {
            for (const m of this.history) this.renderMessage(m, false);
        }
        this.scrollToBottom();
    }

    renderMessage(msg, scroll = true, opts = {}) {
        const el = document.createElement("div");
        el.className = "ai-msg ai-msg-" + msg.role;
        el._raw = msg.text || "";

        const asAgent = msg.role === "assistant" && (msg.agent || opts.agentView);
        if (msg.role === "assistant") {
            let html = "";
            if (opts.reasoning) html += panelThinkHtml(true);
            html += '<div class="ai-answer">' + (asAgent ? renderAgentMessage(msg.text) : mdRender(msg.text)) + '</div>';
            el.innerHTML = html;
            if (opts.reasoning) {
                const body = el.querySelector(".ai-think-body");
                if (body) body.textContent = opts.reasoning;
            }
        } else if (msg.role === "observation") {
            el.className = "ai-msg ai-obs";
            el.innerHTML = `<button type="button" class="ai-obs-toggle" aria-expanded="true"><span class="ai-obs-label">Results</span>${PANEL_THINK_CHEV}</button><pre class="ai-obs-body">${escHtml(msg.text)}</pre>`;
            el.classList.add("open");
        } else if (msg.role === "error") {
            el.innerHTML = mdRender(msg.text);
        } else {
            el.textContent = msg.text;
        }

        this.messagesEl.appendChild(el);
        if (msg.role !== "error" && msg.role !== "observation") {
            const bar = this.makeActions(msg.role, msg.text, opts);
            bar._for = el;
            this.messagesEl.appendChild(bar);
        }
        if (scroll) this.scrollToBottom();
        return el;
    }

    makeActions(role, rawText, opts = {}) {
        const bar = document.createElement("div");
        bar.className = "ai-msg-actions" + (role === "user" ? " user" : "");
        bar._raw = rawText || "";
        bar.innerHTML = aiActionsHtml(role, opts);
        return bar;
    }

    scrollToBottom() {
        this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
    }

    wire() {
        this.sendBtn.addEventListener("click", () => this.onSend());
        this.inputEl.addEventListener("keydown", e => {
            if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                this.onSend();
            }
        });
        this.inputEl.addEventListener("input", () => this.updateEstimate());

        if (this.agentBtn) {
            if (!this.agent) this.agentBtn.style.display = "none";
            this.agentBtn.addEventListener("click", () => this.setAgentMode(!this.agentMode));
        }
        this.stopBtn?.addEventListener("click", () => this.stopAgent());

        this.quickBar.addEventListener("click", e => {
            const btn = e.target.closest("[data-action]");
            if (!btn) return;
            const action = btn.dataset.action;
            const prompts = {
                explain: "Explain what this code does, in plain language.",
                refactor: "Refactor this for clarity and idiomatic style. Keep behavior identical.",
                comment: "Add concise inline comments explaining the intent of each non-obvious section.",
                debug: "Look for bugs, edge cases, or misuses. Be specific about what's wrong and suggest fixes.",
                test: "Write a handful of unit tests that exercise the main paths and a few edge cases.",
                optimize: "Suggest performance improvements without changing observable behavior.",
                document: "Add clear doc comments / docstrings to the public functions and types, plus a short summary at the top.",
                types: "Add precise type annotations (or JSDoc types) throughout, keeping behavior identical."
            };
            if (!prompts[action]) return;
            this.inputEl.value = prompts[action];
            this.onSend();
        });

        this.messagesEl.addEventListener("click", e => {
            const toolExpand = e.target.closest(".tool-expand");
            if (toolExpand) {
                const body = toolExpand.closest(".tool-card")?.querySelector(".tool-body");
                if (body) { const hide = !body.hasAttribute("hidden"); body.toggleAttribute("hidden", hide); toolExpand.textContent = hide ? "view" : "hide"; }
                return;
            }
            const obsToggle = e.target.closest(".ai-obs-toggle");
            if (obsToggle) {
                const obs = obsToggle.closest(".ai-obs");
                const open = obs.classList.toggle("open");
                obsToggle.setAttribute("aria-expanded", open ? "true" : "false");
                return;
            }
            const askOpt = e.target.closest(".ask-option");
            if (askOpt) {
                if (this.running) return;
                const card = askOpt.closest(".tool-ask");
                if (card?.classList.contains("answered")) return;
                const ans = askOpt.dataset.answer || askOpt.textContent || "";
                if (card) {
                    card.classList.add("answered");
                    card.querySelectorAll(".ask-option").forEach(b => { b.disabled = true; });
                    askOpt.classList.add("chosen");
                }
                this.runAgent(ans);
                return;
            }
            const thinkToggle = e.target.closest(".ai-think-toggle");
            if (thinkToggle) {
                const think = thinkToggle.closest(".ai-think");
                if (think) {
                    const open = think.classList.toggle("open");
                    thinkToggle.setAttribute("aria-expanded", open ? "true" : "false");
                    if (open) {
                        const body = think.querySelector(".ai-think-body");
                        if (body) body.scrollTop = body.scrollHeight;
                    }
                }
                return;
            }
            const actBtn = e.target.closest(".ai-act");
            if (actBtn) {
                const bar = actBtn.closest(".ai-msg-actions");
                const kind = actBtn.dataset.act;
                if (kind === "copy") {
                    const raw = (bar && bar._raw != null) ? bar._raw : (bar?._for?._raw || "");
                    navigator.clipboard?.writeText(raw).catch(() => {});
                    const lbl = actBtn.querySelector(".ai-act-label");
                    if (lbl) {
                        const orig = lbl.textContent;
                        lbl.textContent = "Copied";
                        actBtn.classList.add("ok");
                        setTimeout(() => { lbl.textContent = orig; actBtn.classList.remove("ok"); }, 1400);
                    }
                } else if (kind === "like") {
                    actBtn.classList.toggle("active");
                    if (actBtn.classList.contains("active")) bar?.querySelector('.ai-act[data-act="report"]')?.classList.remove("active");
                } else if (kind === "report") {
                    actBtn.classList.toggle("active");
                    if (actBtn.classList.contains("active")) bar?.querySelector('.ai-act[data-act="like"]')?.classList.remove("active");
                } else if (kind === "continue") {
                    this.continueMessage(bar);
                }
                return;
            }
            const insertBtn = e.target.closest(".ai-code-insert");
            const copyBtn = e.target.closest(".ai-code-copy");
            if (insertBtn) {
                const code = b64ToUtf8(insertBtn.dataset.code);
                this.onInsert(code);
            } else if (copyBtn) {
                const code = b64ToUtf8(copyBtn.dataset.code);
                navigator.clipboard?.writeText(code).catch(() => {});
                copyBtn.textContent = "copied";
                setTimeout(() => copyBtn.textContent = "copy", 1400);
            }
        });

        const btnClear = this.root.querySelector("#btnAiClear");
        btnClear?.addEventListener("click", () => this.clearConversation());

        const btnSettings = this.root.querySelector("#btnAiSettings");
        btnSettings?.addEventListener("click", () => {
            this.settingsEl.classList.toggle("open");
            this.inclToggle.checked = localStorage.getItem(INCL_CODE_STORE) !== "0";
            this.populateModels();
        });

        this.modelSelect?.addEventListener("change", () => {
            const v = this.modelSelect.value || DEFAULT_MODEL;
            localStorage.setItem(MODEL_STORAGE, v);
            this.updateModelLabel();
        });
        this.inclToggle?.addEventListener("change", () => {
            localStorage.setItem(INCL_CODE_STORE, this.inclToggle.checked ? "1" : "0");
        });
    }

    clearConversation() {
        this.history = [];
        this.saveHistory();
        this.renderAll();
    }

    showTyping() {
        const el = document.createElement("div");
        el.className = "ai-msg ai-msg-assistant ai-typing";
        el.innerHTML = '<div class="ai-orbiter" role="status" aria-label="Thinking">' + '<span class="ai-orbit"></span>'.repeat(3) + '</div>';
        this.messagesEl.appendChild(el);
        this.scrollToBottom();
        return el;
    }

    togglePartyMode() {
        const on = this.root.classList.toggle("party-mode");
        this.root.dispatchEvent(new CustomEvent("ai:party", { detail: { on }, bubbles: true }));
        if (on) {
            this._partyPlaceholder = this.inputEl?.placeholder;
            if (this.inputEl) this.inputEl.placeholder = "spill the tea, we're vibing now...";
            this.spawnConfetti();
            this.renderMessage({ role: "assistant", text: "🎉 **party mode engaged.** Say `/party` again to sober up." });
        } else {
            if (this.inputEl && this._partyPlaceholder) this.inputEl.placeholder = this._partyPlaceholder;
            this.renderMessage({ role: "assistant", text: "party mode off. back to business." });
        }
        this.saveHistory();
    }

    spawnConfetti() {
        const colors = 26;
        for (let i = 0; i < colors; i++) {
            const piece = document.createElement("span");
            piece.className = "ai-confetti";
            piece.style.left = (i / colors * 100 + (i % 3) * 3) + "%";
            piece.style.setProperty("--hue", String((i * 137) % 360));
            piece.style.animationDelay = ((i % 7) * 0.06) + "s";
            piece.style.animationDuration = (1.5 + (i % 5) * 0.18) + "s";
            this.root.appendChild(piece);
            piece.addEventListener("animationend", () => piece.remove());
        }
    }

    flashCompaction() {
        if (this._compactBar) return;
        const bar = document.createElement("div");
        bar.className = "ai-compact";
        bar.innerHTML = '<div class="ai-compact-fill"></div><span class="ai-compact-label">compacting conversation…</span>';
        const head = this.root.querySelector(".ai-head");
        if (head) head.after(bar); else this.root.prepend(bar);
        this._compactBar = bar;
        setTimeout(() => bar.classList.add("done"), 1100);
        setTimeout(() => { bar.remove(); if (this._compactBar === bar) this._compactBar = null; }, 1650);
    }

    async onSend() {
        if (this.busy || this.running) return;
        const text = this.inputEl.value.trim();
        if (!text) return;

        if (/^\/party\b/i.test(text)) {
            this.inputEl.value = "";
            this.togglePartyMode();
            return;
        }

        if (this.history.length === 0) this.messagesEl.innerHTML = "";

        this.messagesEl.querySelectorAll(".ai-continue").forEach(b => b.remove());

        if (this.agentMode && this.agent) {
            this.inputEl.value = "";
            this.updateEstimate();
            return this.runAgent(text);
        }

        const userMsg = { role: "user", text };
        this.history.push(userMsg);
        this.renderMessage(userMsg);
        this.saveHistory();

        this.inputEl.value = "";
        this.busy = true;
        this.sendBtn.disabled = true;

        const typingEl = this.showTyping();

        const includeCode = localStorage.getItem(INCL_CODE_STORE) !== "0";
        const sys = systemPreamble(this.getLang(), this.getCode(), includeCode);

        await ensureConfig();

        let responseText = "";
        const modelUsed = getModel();
        const meta = {};
        let streamingEl = null;
        let reasoningAcc = "";
        let contentStarted = false;
        const ensureStreamEl = () => {
            if (!streamingEl) {
                if (typingEl.parentNode) typingEl.remove();
                streamingEl = document.createElement("div");
                streamingEl.className = "ai-msg ai-msg-assistant";
                this.messagesEl.appendChild(streamingEl);
            }
            return streamingEl;
        };
        try {
            responseText = await callGroq(this.history, sys, modelUsed, (acc) => {
                contentStarted = true;
                const el = ensureStreamEl();
                if (reasoningAcc) panelPaintThink(el, reasoningAcc, false);
                panelEnsureAnswer(el).innerHTML = mdRender(acc);
                this.scrollToBottom();
            }, meta, (racc) => {
                reasoningAcc = racc;
                const el = ensureStreamEl();
                panelPaintThink(el, reasoningAcc, !contentStarted);
                this.scrollToBottom();
            });
        } catch (e) {
            if (typingEl.parentNode) typingEl.remove();
            if (streamingEl?.parentNode) streamingEl.remove();
            this.renderMessage({ role: "error", text: "**Error:** " + e.message });
            this.busy = false; this.sendBtn.disabled = false;
            return;
        }

        if (typingEl.parentNode) typingEl.remove();
        if (streamingEl?.parentNode) streamingEl.remove();

        const assistantMsg = { role: "assistant", text: responseText };
        this.history.push(assistantMsg);
        this.renderMessage(assistantMsg, true, { truncated: meta.finish === "length", reasoning: reasoningAcc });
        this.saveHistory();

        this.busy = false;
        this.sendBtn.disabled = false;
    }

    async continueMessage(bar) {
        if (this.busy || !bar) return;
        const msgEl = bar._for || bar.previousElementSibling;
        if (!msgEl || !msgEl.classList.contains("ai-msg-assistant")) return;
        let idx = -1;
        for (let i = this.history.length - 1; i >= 0; i--) {
            if (this.history[i].role === "assistant") { idx = i; break; }
        }
        if (idx === -1) return;

        this.busy = true;
        this.sendBtn.disabled = true;
        bar.remove();

        const base = this.history[idx].text || "";
        const needsSpace = base.length > 0 && !/\s$/.test(base);
        const join = (tail) => {
            let out = base;
            if (needsSpace && tail && !/^\s/.test(tail) && !/^[.,;:!?)\]]/.test(tail)) out += " ";
            return out + tail;
        };

        await ensureConfig();
        const model = getModel();
        const includeCode = localStorage.getItem(INCL_CODE_STORE) !== "0";
        const sys = systemPreamble(this.getLang(), this.getCode(), includeCode);
        const reqHistory = this.history.slice();
        reqHistory.push({ role: "user", text: "Continue your previous answer from exactly where it stopped. Do not repeat any text you already wrote." });
        const meta = {};
        const baseReason = msgEl.querySelector(":scope > .ai-think .ai-think-body")?.textContent || "";
        let contReason = "";

        try {
            const tail = await callGroq(reqHistory, sys, model, (accTail) => {
                panelEnsureAnswer(msgEl).innerHTML = mdRender(join(accTail));
                this.scrollToBottom();
            }, meta, (racc) => {
                contReason = racc;
                panelPaintThink(msgEl, baseReason + contReason, false);
                this.scrollToBottom();
            });
            const joined = join(tail);
            this.history[idx].text = joined;
            msgEl._raw = joined;
            if (contReason) panelPaintThink(msgEl, baseReason + contReason, false);
            panelEnsureAnswer(msgEl).innerHTML = mdRender(joined);
            this.saveHistory();
            const newBar = this.makeActions("assistant", joined, { truncated: meta.finish === "length" });
            newBar._for = msgEl;
            msgEl.after(newBar);
        } catch (e) {
            const newBar = this.makeActions("assistant", msgEl._raw || base, { truncated: true });
            newBar._for = msgEl;
            msgEl.after(newBar);
        } finally {
            this.busy = false;
            this.sendBtn.disabled = false;
            this.scrollToBottom();
        }
    }

    setAgentMode(on) {
        if (!this.agent) return;
        this.agentMode = !!on;
        localStorage.setItem(AGENT_MODE_STORE, this.agentMode ? "1" : "0");
        this.applyAgentMode();
        if (this.agentMode) this.inputEl?.focus();
    }

    applyAgentMode() {
        const on = this.agentMode && !!this.agent;
        this.root.classList.toggle("agent-on", on);
        if (this.agentBtn) this.agentBtn.setAttribute("aria-pressed", on ? "true" : "false");
        if (this.inputEl) this.inputEl.placeholder = on
            ? "Describe a task — the agent builds it, file by file (Enter to start)"
            : "Ask anything... (Enter to send, Shift+Enter for newline)";
        this.onAgentMode(on);
        this.refreshCreditsUI();
    }

    setRunning(on) {
        this.running = on;
        this.busy = on;
        if (this.stopBtn) this.stopBtn.hidden = !on;
        if (this.sendBtn) { this.sendBtn.disabled = on; this.sendBtn.hidden = on; }
        this.root.classList.toggle("agent-running", on);
    }

    stopAgent() { try { this.abort?.abort(); } catch {} }

    async refreshCreditsUI() {
        await ensureConfig();
        this.paintCredits();
        this.updateEstimate();
        if (this.agentMode && this.agent) {
            await refreshCredits();
            this.paintCredits();
            this.updateEstimate();
        }
    }

    paintCredits() {
        const el = this.creditsEl;
        if (!el) return;

        const show = this.agentMode && !!this.agent;
        el.hidden = !show;
        if (!show) return;
        if (!creditState.authenticated) { el.textContent = "sign in for credits"; el.className = "ai-credits muted"; el.title = "Sign in to get AI credits for agent mode"; return; }
        if (creditState.micro == null) { el.textContent = "∞ credits"; el.className = "ai-credits"; el.title = "Unlimited credits"; return; }
        const micro = creditState.micro;
        el.textContent = fmtDollars(micro) + " credits";
        el.className = "ai-credits" + (creditState.unlimited ? "" : (micro <= 0 ? " empty" : (micro < agentInitialMicro * 0.15 ? " low" : "")));
        el.title = creditState.unlimited ? "God account · effectively unlimited" : `${fmtDollars(micro)} of ${fmtDollars(agentInitialMicro)} AI credits remaining`;
    }

    onUsage(u) {
        if (u.unlimited) { creditState.unlimited = true; creditState.authenticated = true; }
        else if (typeof u.balanceMicro === "number") {
            creditState.authenticated = true;
            creditState.micro = u.balanceMicro;
            creditState.dollars = u.balance;
        }
        if (typeof u.costMicro === "number") this._lastCostMicro = u.costMicro;
        this.paintCredits();
        this.updateEstimate();
    }

    updateEstimate() {
        const el = this.estEl;
        if (!el) return;
        if (!(this.agentMode && this.agent)) { el.hidden = true; return; }
        el.hidden = false;
        const model = getModel();
        let wsChars = 0;
        try { wsChars = buildWorkspaceSnapshot(this.agent.getWorkspace()).length; } catch {}
        const histChars = this.history.reduce((n, m) => n + (m.text ? m.text.length : 0), 0);
        const draft = this.inputEl ? this.inputEl.value.length : 0;
        const inTok = Math.ceil((AGENT_PROTOCOL.length + wsChars + histChars + draft) / 4);
        const stepMicro = estimateCostMicro(model, inTok, 700);
        const bits = [`est ~${fmtDollars(stepMicro)} / step`];
        if (this._lastCostMicro) bits.push(`last −${fmtDollars(this._lastCostMicro)}`);
        el.textContent = bits.join("   ·   ");
    }

    async streamAgentTurn(sys, model, meta) {
        this.onPhase("thinking");
        const typingEl = this.showTyping();
        let streamingEl = null, reasoningAcc = "", contentStarted = false;
        const ensureEl = () => {
            if (!streamingEl) {
                if (typingEl.parentNode) typingEl.remove();
                streamingEl = document.createElement("div");
                streamingEl.className = "ai-msg ai-msg-assistant";
                this.messagesEl.appendChild(streamingEl);
            }
            return streamingEl;
        };
        try {
            const raw = await callGroq(this.history, sys, model, (acc) => {
                contentStarted = true;
                const el = ensureEl();
                if (reasoningAcc) panelPaintThink(el, reasoningAcc, false);
                panelEnsureAnswer(el).innerHTML = renderAgentStreaming(acc);
                this.scrollToBottom();
            }, meta, (racc) => {
                reasoningAcc = racc;
                const el = ensureEl();
                panelPaintThink(el, reasoningAcc, !contentStarted);
                this.scrollToBottom();
            }, { agent: true, signal: this.abort?.signal, onUsage: (u) => this.onUsage(u) });
            meta.reasoning = reasoningAcc;
            return raw;
        } finally {
            if (typingEl.parentNode) typingEl.remove();
            if (streamingEl?.parentNode) streamingEl.remove();
        }
    }

    async applyAction(a) {
        const g = this.agent;
        if (a.tool === "write")  return await g.writeFile(a.path, a.content);
        if (a.tool === "run")    return await g.run(a.path);
        if (a.tool === "delete") return await g.deleteFile(a.path);
        if (a.tool === "rename") return await g.renameFile(a.from, a.to);
        if (a.tool === "open")   return await g.openFile(a.path);
        if (a.tool === "import_github") return g.importGithub ? await g.importGithub(a.repo) : "error: GitHub import unavailable";
        return "unknown tool";
    }

    async runAgent(task) {
        await ensureConfig();
        await refreshCredits();
        this.paintCredits();
        if (!creditState.authenticated) {
            this.renderMessage({ role: "error", text: "**Sign in required.** Agent mode uses AI credits tied to your account — [sign in](/) and try again." });
            return;
        }
        if (this.creditsDepleted()) {
            this.renderMessage({ role: "error", text: "**Out of credits.** You've spent your AI credits for agent mode." });
            return;
        }

        const userMsg = { role: "user", text: task };
        this.history.push(userMsg);
        this.renderMessage(userMsg);
        this.saveHistory();

        this.setRunning(true);
        this.abort = new AbortController();
        const model = getModel();
        this._agentToolCounts = new Map();

        try {
            for (let step = 0; step < AGENT_MAX_STEPS; step++) {
                if (this.abort.signal.aborted) break;
                if (this.creditsDepleted()) {
                    this.renderMessage({ role: "error", text: "**Out of credits.** Stopping the agent — you've spent your AI credits." });
                    break;
                }

                const sys = buildAgentSystem(this.agent.getWorkspace());
                const meta = {};

                let raw = null;
                for (let attempt = 0; attempt < 3; attempt++) {
                    try { raw = await this.streamAgentTurn(sys, model, meta); break; }
                    catch (e) {
                        if (e?.name === "AbortError" || this.abort.signal.aborted || e?.outOfCredits || e?.needsAuth) throw e;
                        if (attempt === 2 || !isTransientError(e?.message)) throw e;
                        this.renderMessage({ role: "error", text: `_Connection hiccup — retrying (${attempt + 1}/2)…_` });
                        await new Promise(r => setTimeout(r, 700 * (attempt + 1)));
                    }
                }
                if (raw == null) break;

                const assistantMsg = { role: "assistant", text: raw, agent: true };
                this.history.push(assistantMsg);
                const msgEl = this.renderMessage(assistantMsg, true, { agentView: true, reasoning: meta.reasoning, truncated: meta.finish === "length" });
                this.saveHistory();
                this.updateEstimate();

                const actions = parseAgentActions(raw);
                if (!actions.length) break;

                const cards = msgEl.querySelectorAll(".tool-card");
                actions.forEach((a, i) => {
                    if (a.tool === "ask" || a.tool === "finish") return;
                    const key = a.tool + ":" + (a.tool === "rename" ? `${a.from}>${a.to}` : (a.path || a.repo || ""));
                    const n = (this._agentToolCounts.get(key) || 0) + 1;
                    this._agentToolCounts.set(key, n);
                    if (n > 1 && cards[i]) {
                        const row = cards[i].querySelector(".tool-row");
                        if (row && !row.querySelector(".tool-repeat")) {
                            const badge = document.createElement("span");
                            badge.className = "tool-repeat";
                            badge.textContent = "×" + n;
                            badge.title = "repeated " + n + " times this run";
                            row.appendChild(badge);
                        }
                    }
                });

                let finished = false;
                const observations = [];
                for (const a of actions) {
                    if (this.abort.signal.aborted) { finished = true; break; }
                    if (a.tool === "finish") { finished = true; break; }
                    if (a.tool === "ask") { finished = true; break; }
                    this.onPhase(
                        a.tool === "write" ? "writing" : (a.tool === "run" ? "running" : "working"),
                        a.tool === "rename" ? `${a.from} → ${a.to}` : (a.path || a.repo || "")
                    );
                    let obs;
                    try { obs = await this.applyAction(a); }
                    catch (e) { obs = "error: " + (e?.message || e); }
                    const tag = a.tool === "rename" ? `${a.from} → ${a.to}` : (a.path || a.repo || "");
                    observations.push(`• ${a.tool} ${tag}\n${obs}`.trim());
                }

                if (finished || this.abort.signal.aborted) break;

                const obsMsg = { role: "observation", text: observations.join("\n\n") || "(no output)" };
                this.history.push(obsMsg);
                this.renderMessage(obsMsg);
                this.saveHistory();

                if (step === AGENT_MAX_STEPS - 1) {
                    this.renderMessage({ role: "error", text: `**Paused** after ${AGENT_MAX_STEPS} steps. Tell me to keep going and I'll continue.` });
                }
            }
        } catch (e) {
            if (e?.name === "AbortError" || this.abort?.signal.aborted) {
                this.renderMessage({ role: "error", text: "_Agent stopped._" });
            } else if (e?.outOfCredits) {
                creditState.micro = 0; creditState.dollars = 0; this.paintCredits();
                this.renderMessage({ role: "error", text: "**Out of credits.** You've spent your AI credits for agent mode." });
            } else if (e?.needsAuth) {
                this.renderMessage({ role: "error", text: "**Sign in required** to use agent mode." });
            } else {
                this.renderMessage({ role: "error", text: "**Error:** " + friendlyError(e?.message || e) });
            }
        } finally {
            this.onPhase("idle");
            this.setRunning(false);
            this.abort = null;
            this.saveHistory();
        }
    }
}
