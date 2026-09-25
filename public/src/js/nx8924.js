const WELCOME = `// nocturne · editor
// monaco, typed out just for you.

function greet(name) {
  return \`hello, \${name}\`;
}

const stack = {
  runtime:  "node 22",
  bundler:  "esbuild",
  shell:     "express 5",
};

console.log(greet("friend"));
console.table(stack);

// press \u2318S / ctrl+S to save, \u2325\u21E7F to format, run to execute.
`;

const STORAGE_KEY = "nocturne-editor";
const FILENAME_KEY = "nocturne-editor-filename";
const LANG_KEY = "nocturne-editor-lang";
const PREFS_KEY = "nocturne-editor-prefs";
const STDIN_KEY = "nocturne-editor-stdin";
const PROJECT_KEY = "nocturne-editor-project";

const EXT_BY_LANG = {
    javascript: "js", typescript: "ts", python: "py", html: "html",
    css: "css", scss: "scss", sass: "sass", less: "less", stylus: "styl",
    json: "json", markdown: "md", sql: "sql",
    xml: "xml", yaml: "yaml", toml: "toml", ini: "ini",
    vue: "vue", svelte: "svelte", graphql: "graphql",
    c: "c", cpp: "cpp", csharp: "cs", rust: "rs", go: "go", java: "java",
    kotlin: "kt", dart: "dart", coffeescript: "coffee", clojure: "clj", dockerfile: "dockerfile",
    swift: "swift", ruby: "rb", php: "php", lua: "lua", bash: "sh", r: "r",
    perl: "pl", scala: "scala", haskell: "hs", crystal: "cr", d: "d",
    elixir: "ex", erlang: "erl", groovy: "groovy", julia: "jl", nim: "nim",
    ocaml: "ml", pascal: "pas", lisp: "lisp", zig: "zig", plaintext: "txt"
};
const LANG_BY_EXT = {
    js: "javascript", mjs: "javascript", cjs: "javascript",
    ts: "typescript", tsx: "typescript",
    py: "python", pyw: "python",
    html: "html", htm: "html", xhtml: "html",
    css: "css", scss: "scss", sass: "sass", less: "less", styl: "stylus",
    jsx: "javascript",
    vue: "vue", svelte: "svelte",
    xml: "xml", svg: "xml", yaml: "yaml", yml: "yaml", toml: "toml", ini: "ini", cfg: "ini", conf: "ini",
    kt: "kotlin", kts: "kotlin", dart: "dart", coffee: "coffeescript", clj: "clojure", cljs: "clojure",
    dockerfile: "dockerfile", graphql: "graphql", gql: "graphql",
    json: "json", json5: "json", jsonc: "json",
    md: "markdown", markdown: "markdown",
    sql: "sql",
    c: "c", h: "c",
    cpp: "cpp", cc: "cpp", cxx: "cpp", hpp: "cpp", hh: "cpp",
    cs: "csharp",
    rs: "rust",
    go: "go",
    java: "java",
    swift: "swift",
    rb: "ruby",
    php: "php",
    lua: "lua",
    sh: "bash", bash: "bash",
    r: "r",
    pl: "perl", pm: "perl",
    scala: "scala", sc: "scala",
    hs: "haskell",
    cr: "crystal",
    d: "d",
    ex: "elixir", exs: "elixir",
    erl: "erlang",
    groovy: "groovy",
    jl: "julia",
    nim: "nim",
    ml: "ocaml",
    pas: "pascal", pp: "pascal",
    lisp: "lisp", lsp: "lisp", cl: "lisp",
    zig: "zig",
    txt: "plaintext"
};

const MONACO_LANG = {
    cpp: "cpp", csharp: "csharp", bash: "shell", groovy: "java",
    crystal: "ruby", lisp: "scheme",
    haskell: "plaintext", d: "plaintext", erlang: "plaintext",
    nim: "plaintext", ocaml: "plaintext", zig: "plaintext",

    sass: "scss", stylus: "css", vue: "html", svelte: "html",
    toml: "ini", coffeescript: "coffee", clojure: "clojure", graphql: "graphql"
};
function monacoLang(id) { return MONACO_LANG[id] || id; }

const BROWSER_RUN = new Set(["javascript", "typescript", "python", "html", "markdown", "json"]);

const REMOTE_LANGS = new Set([
    "c", "cpp", "csharp", "rust", "go", "java", "swift", "ruby", "php", "lua",
    "sql", "bash", "r", "perl", "scala", "haskell", "crystal", "d", "elixir",
    "erlang", "groovy", "julia", "nim", "ocaml", "pascal", "lisp", "zig"
]);

const STYLE_LANGS = new Set(["css", "scss", "sass", "less", "stylus"]);

const TEMPLATES = [
    { id: "website", lang: "web", name: "Website", desc: "Multi-page site: index + shop, shared CSS and JS.",
      files: [
        { name: "index.html", content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Home</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <nav>\n    <a href="index.html" class="active">Home</a>\n    <a href="shop.html">Shop</a>\n  </nav>\n  <main>\n    <h1>Welcome to Nocturne</h1>\n    <p>This is a multi-file site. The nav links connect the pages.</p>\n    <button id="hi">Say hi</button>\n  </main>\n  <script src="script.js"></script>\n</body>\n</html>\n` },
        { name: "shop.html", content: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <meta name="viewport" content="width=device-width, initial-scale=1.0">\n  <title>Shop</title>\n  <link rel="stylesheet" href="style.css">\n</head>\n<body>\n  <nav>\n    <a href="index.html">Home</a>\n    <a href="shop.html" class="active">Shop</a>\n  </nav>\n  <main>\n    <h1>Shop</h1>\n    <div class="grid">\n      <div class="card">Moon lamp</div>\n      <div class="card">Star map</div>\n      <div class="card">Night candle</div>\n    </div>\n    <p><a href="index.html">Back home</a></p>\n  </main>\n</body>\n</html>\n` },
        { name: "style.css", content: `:root { color-scheme: dark; }\nbody { margin: 0; font-family: system-ui, sans-serif; background: #0a0b14; color: #eae6ff; }\nnav { display: flex; gap: 6px; padding: 14px 20px; border-bottom: 1px solid rgba(200,195,230,0.12); }\nnav a { color: #a9a3c7; text-decoration: none; padding: 6px 12px; border-radius: 8px; }\nnav a:hover { background: rgba(200,195,230,0.08); color: #fff; }\nnav a.active { color: #c9c1ff; background: rgba(200,195,230,0.1); }\nmain { padding: 32px 20px; max-width: 720px; margin: 0 auto; }\nh1 { color: #c9c1ff; }\nbutton { padding: 9px 16px; border-radius: 8px; border: none; background: #b8b0da; color: #0a0b14; font-weight: 600; cursor: pointer; }\n.grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin-top: 18px; }\n.card { padding: 28px 14px; border-radius: 12px; text-align: center; background: rgba(200,195,230,0.05); border: 1px solid rgba(200,195,230,0.12); }\n` },
        { name: "script.js", content: `document.getElementById("hi")?.addEventListener("click", function () {\n  alert("Hello from script.js");\n});\n` }
      ] },
    { id: "js-starter",   lang: "javascript", name: "JavaScript", desc: "Hello + console demo.",
      code: `console.log("hello world");\n\nconst data = [1, 2, 3, 4, 5];\nconst doubled = data.map(n => n * 2);\nconsole.table({ data, doubled });\n` },
    { id: "ts-starter",   lang: "typescript", name: "TypeScript", desc: "Typed functions, interfaces.",
      code: `type User = { name: string; age: number };\n\nfunction describe(u: User): string {\n  return \`\${u.name} (\${u.age})\`;\n}\n\nconst u: User = { name: "Ada", age: 30 };\nconsole.log(describe(u));\n` },
    { id: "html-page",    lang: "html",       name: "HTML page", desc: "Minimal document.",
      code: `<!DOCTYPE html>\n<html lang="en">\n<head>\n  <meta charset="UTF-8">\n  <title>Page</title>\n  <style>\n    body { font-family: sans-serif; background: #0a0b14; color: #eae6ff; padding: 40px; }\n    h1 { color: #c9c1ff; }\n  </style>\n</head>\n<body>\n  <h1>Hello, night.</h1>\n  <p>This is a starter page.</p>\n</body>\n</html>\n` },
    { id: "html-canvas",  lang: "html",       name: "Canvas sketch", desc: "Animated canvas.",
      code: `<!DOCTYPE html>\n<html><head><style>body{margin:0;background:#05060d}canvas{display:block}</style></head>\n<body>\n<canvas id="c" width="600" height="400"></canvas>\n<script>\nconst c = document.getElementById("c").getContext("2d");\nlet t = 0;\nfunction draw(){\n  c.fillStyle = "rgba(5,6,13,0.2)";\n  c.fillRect(0,0,600,400);\n  for(let i=0;i<40;i++){\n    const a = t*0.01 + i*0.1;\n    const x = 300 + Math.cos(a)*(100+i*3);\n    const y = 200 + Math.sin(a*1.3)*(80+i*2);\n    c.fillStyle = \`hsla(\${(i*8+t)%360}, 70%, 70%, 0.5)\`;\n    c.beginPath(); c.arc(x,y,2,0,Math.PI*2); c.fill();\n  }\n  t++;\n  requestAnimationFrame(draw);\n}\ndraw();\n<\/script>\n</body></html>\n` },
    { id: "json-pkg",     lang: "json",       name: "JSON", desc: "Small object tree.",
      code: `{\n  "name": "midnight",\n  "version": "1.0.0",\n  "stack": {\n    "runtime":  "node",\n    "bundler":  "esbuild",\n    "editor":   "monaco"\n  },\n  "tags": ["workspace", "midnight", "editor"]\n}\n` },
    { id: "md-readme",    lang: "markdown",   name: "Markdown", desc: "Readme scaffold.",
      code: `# Editor\n\nA fast, private, midnight-themed workspace.\n\n## Features\n\n- Fast, private, and simple\n- **Monaco** editor with live preview\n- Syntax highlighting, formatting\n\n---\n\n> Press **Run** to preview this markdown.\n\n\`\`\`js\nconst hi = "hello";\nconsole.log(hi);\n\`\`\`\n` },
    { id: "py-starter",   lang: "python",     name: "Python", desc: "Runs via Pyodide, imports auto-load.",
      code: `def fib(n):\n    a, b = 0, 1\n    for _ in range(n):\n        a, b = b, a + b\n    return a\n\nprint([fib(i) for i in range(10)])\n` },
    { id: "c-starter",    lang: "c",          name: "C", desc: "gcc, reads stdin.",
      code: `#include <stdio.h>\n\nint main(void) {\n    char name[64];\n    printf("your name? ");\n    if (scanf("%63s", name) == 1) printf("hello, %s\\n", name);\n    for (int i = 1; i <= 5; i++) printf("%d squared = %d\\n", i, i * i);\n    return 0;\n}\n` },
    { id: "cpp-starter",  lang: "cpp",        name: "C++", desc: "g++ with the STL.",
      code: `#include <iostream>\n#include <vector>\n#include <numeric>\n\nint main() {\n    std::vector<int> v{1, 2, 3, 4, 5};\n    int sum = std::accumulate(v.begin(), v.end(), 0);\n    std::cout << "sum = " << sum << "\\n";\n    return 0;\n}\n` },
    { id: "rust-starter", lang: "rust",       name: "Rust", desc: "Ownership, iterators.",
      code: `fn main() {\n    let nums = vec![1, 2, 3, 4, 5];\n    let total: i32 = nums.iter().sum();\n    let doubled: Vec<i32> = nums.iter().map(|n| n * 2).collect();\n    println!("total = {total}");\n    println!("doubled = {doubled:?}");\n}\n` },
    { id: "go-starter",   lang: "go",         name: "Go", desc: "Goroutines-ready starter.",
      code: `package main\n\nimport "fmt"\n\nfunc main() {\n    nums := []int{1, 2, 3, 4, 5}\n    sum := 0\n    for _, n := range nums {\n        sum += n\n    }\n    fmt.Println("sum =", sum)\n}\n` },
    { id: "java-starter", lang: "java",       name: "Java", desc: "Single-file Main class.",
      code: `import java.util.stream.IntStream;\n\npublic class Main {\n    public static void main(String[] args) {\n        int sum = IntStream.rangeClosed(1, 5).sum();\n        System.out.println("sum = " + sum);\n    }\n}\n` },
    { id: "cs-starter",   lang: "csharp",     name: "C#", desc: "Top-level statements.",
      code: `using System;\nusing System.Linq;\n\nvar nums = new[] { 1, 2, 3, 4, 5 };\nConsole.WriteLine($"sum = {nums.Sum()}");\n` },
    { id: "ruby-starter", lang: "ruby",       name: "Ruby", desc: "Blocks and ranges.",
      code: `nums = (1..5).to_a\nputs "sum = #{nums.sum}"\nputs "doubled = #{nums.map { |n| n * 2 }}"\n` },
    { id: "sql-starter",  lang: "sql",        name: "SQL", desc: "SQLite: create, insert, query.",
      code: `CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, age INTEGER);\nINSERT INTO users (name, age) VALUES ('Ada', 30), ('Lin', 24), ('Bo', 41);\n\nSELECT name, age FROM users WHERE age > 25 ORDER BY age DESC;\n` },
    { id: "blank",        lang: "plaintext",  name: "Blank",  desc: "Start with nothing.",
      code: `` }
];

import { AIPanel } from "/src/js/tn5521.js";
import { initProjects } from "/src/js/jd7108.js";
import { isBackendProject, startBackend, streamLogs, waitUntilLive } from "/src/js/sv3641.js";

require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.47.0/min/vs" }});

require(["vs/editor/editor.main"], () => {
    defineTheme();

    const prefs = loadPrefs();
    let savedLang = localStorage.getItem(LANG_KEY) || "javascript";
    if (!EXT_BY_LANG[savedLang]) savedLang = "javascript";
    const savedValue = localStorage.getItem(STORAGE_KEY);
    const hashPayload = parseShareHash();

    const hasSavedCode = typeof savedValue === "string" && savedValue.trim().length > 0;

    const editor = monaco.editor.create(document.getElementById("editor"), {
        value: "",
        language: monacoLang(savedLang),
        theme: "nocturne",
        fontSize: prefs.fontSize,
        fontFamily: "'JetBrains Mono', Menlo, Consolas, monospace",
        fontLigatures: prefs.ligatures,
        lineHeight: 22,
        letterSpacing: 0.2,
        lineNumbers: "on",
        minimap: { enabled: prefs.minimap },
        scrollBeyondLastLine: false,
        renderLineHighlight: "line",
        smoothScrolling: true,
        cursorBlinking: "smooth",
        cursorSmoothCaretAnimation: "on",
        cursorStyle: "line",
        padding: { top: 18, bottom: 18 },
        roundedSelection: true,
        automaticLayout: true,
        wordWrap: prefs.wrap ? "on" : "off",
        tabSize: 4,
        bracketPairColorization: { enabled: true },
        guides: { indentation: true, highlightActiveIndentation: true, bracketPairs: true },
        renderWhitespace: "none",
        scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8,
            useShadows: false
        }
    });

    document.getElementById("codeBooting")?.remove();

    const fileNameEl = document.getElementById("fileName");
    const langSelect = document.getElementById("langSelect");
    const stStatus   = document.getElementById("stStatus");
    const stLang     = document.getElementById("stLang");
    const stLines    = document.getElementById("stLines");
    const stChars    = document.getElementById("stChars");
    const cursorInfo = document.getElementById("cursorInfo");
    const outputPanel = document.getElementById("outputPanel");
    const outputLog   = document.getElementById("outputLog");
    const btnCloseOut = document.getElementById("btnCloseOut");
    const btnClearOut = document.getElementById("btnClearOut");
    const prefsPanel  = document.getElementById("prefsPanel");
    const tplOverlay  = document.getElementById("templateOverlay");
    const tplGrid     = document.getElementById("templateGrid");

    const fileTabsEl = document.getElementById("fileTabs");

    const models = new Map();
    let activeName = null;

    function fileExt(name) { const m = /\.([^.\/]+)$/.exec(name || ""); return m ? m[1].toLowerCase() : ""; }
    function fileLang(name) { return LANG_BY_EXT[fileExt(name)] || "plaintext"; }
    function fileList() { return [...models.keys()].map(name => ({ name, content: models.get(name).getValue() })); }
    function activeContent() { const m = models.get(activeName); return m ? m.getValue() : ""; }
    function uniqueName(base, except) {
        base = base || "untitled.txt";
        if (base === except || !models.has(base)) return base;
        const m = /^(.*?)(\.[^.]+)?$/.exec(base); const stem = m[1] || base, e = m[2] || "";
        let i = 2; while (models.has(stem + "-" + i + e) && (stem + "-" + i + e) !== except) i++;
        return stem + "-" + i + e;
    }

    function updateStats() {
        const v = editor.getValue();
        const lines = v.split("\n").length;
        stLines.textContent = lines + " line" + (lines === 1 ? "" : "s");
        stChars.textContent = v.length + " char" + (v.length === 1 ? "" : "s");
        const pos = editor.getPosition();
        if (pos) cursorInfo.textContent = `ln ${pos.lineNumber}, col ${pos.column}`;
    }
    function flashStatus() {
        stStatus.classList.remove("flash");
        void stStatus.offsetWidth;
        stStatus.classList.add("flash");
    }

    let saveTimer = null;
    let projectsRef = null;
    function persistProject() {
        try { localStorage.setItem(PROJECT_KEY, JSON.stringify({ files: fileList(), active: activeName })); } catch {}
    }
    function scheduleSave() {
        stStatus.textContent = "editing";
        clearTimeout(saveTimer);
        saveTimer = setTimeout(() => { persistProject(); stStatus.textContent = "saved"; }, 500);
        projectsRef?.markDirty();
    }
    function saveNow() { clearTimeout(saveTimer); persistProject(); stStatus.textContent = "saved"; flashStatus(); }

    editor.onDidChangeModelContent(() => { updateStats(); scheduleSave(); });
    editor.onDidChangeCursorPosition(updateStats);

    function syncActiveMeta() {
        const lang = fileLang(activeName);
        langSelect.value = lang;
        langSelect._nocRefresh?.();
        stLang.textContent = lang;
        fileNameEl.value = activeName || "";
        if (typeof updateStdinHint === "function") updateStdinHint(lang);
    }

    function openFile(name) {
        if (!models.has(name)) return;
        activeName = name;
        editor.setModel(models.get(name));
        syncActiveMeta();
        renderFileTabs();
        updateStats();
        persistProject();
        editor.focus();
    }

    function addFile(name, content = "", focus = true) {
        name = uniqueName((name || "untitled.txt").replace(/^\/+/, ""));
        models.set(name, monaco.editor.createModel(content, monacoLang(fileLang(name))));
        if (focus) openFile(name); else renderFileTabs();
        return name;
    }

    function deleteFile(name) {
        if (!models.has(name) || models.size <= 1) return;
        const keys = [...models.keys()];
        const idx = keys.indexOf(name);
        models.get(name).dispose();
        models.delete(name);
        if (activeName === name) openFile(keys[idx + 1] || keys[idx - 1]);
        else { renderFileTabs(); persistProject(); }
    }

    function renameFile(oldName, newName) {
        newName = (newName || "").trim().replace(/^\/+/, "");
        if (!newName) { renderFileTabs(); fileNameEl.value = activeName || ""; return; }
        if (newName === oldName) { renderFileTabs(); return; }
        newName = uniqueName(newName, oldName);
        const entries = [...models.entries()].map(([k, v]) => [k === oldName ? newName : k, v]);
        models.clear();
        for (const [k, v] of entries) models.set(k, v);
        monaco.editor.setModelLanguage(models.get(newName), monacoLang(fileLang(newName)));
        if (activeName === oldName) activeName = newName;
        syncActiveMeta();
        renderFileTabs();
        persistProject();
    }

    function setLang(lang, persist = true) {

        if (!lang || !activeName) return;
        const e = EXT_BY_LANG[lang] || "txt";
        const base = activeName.replace(/\.[^.\/]+$/, "");
        const target = uniqueName(base + "." + e, activeName);
        if (target !== activeName) renameFile(activeName, target);
        else {
            monaco.editor.setModelLanguage(models.get(activeName), monacoLang(lang));
            langSelect.value = lang; langSelect._nocRefresh?.(); stLang.textContent = lang;
            if (typeof updateStdinHint === "function") updateStdinHint(lang);
        }
        if (persist) persistProject();
    }

    function promptNewFile() {
        const name = prompt("New file name (e.g. shop.html, style.css, helper.py):", "");
        if (name === null) return;
        if (name.trim()) { addFile(name.trim(), ""); saveNow(); }
    }

    function renderFileTabs() {
        if (!fileTabsEl) return;
        fileTabsEl.innerHTML = "";
        for (const name of models.keys()) {
            const chip = document.createElement("div");
            chip.className = "file-chip" + (name === activeName ? " active" : "");
            chip.title = name;
            const label = document.createElement("span");
            label.className = "file-chip-name";
            label.textContent = name;
            chip.appendChild(label);
            if (models.size > 1) {
                const x = document.createElement("button");
                x.className = "file-chip-x"; x.type = "button"; x.title = "Delete file";
                x.innerHTML = "&times;";
                x.addEventListener("click", ev => { ev.stopPropagation(); deleteFile(name); });
                chip.appendChild(x);
            }
            chip.addEventListener("click", () => { if (name !== activeName) openFile(name); });
            fileTabsEl.appendChild(chip);
        }
        const add = document.createElement("button");
        add.className = "file-add"; add.type = "button"; add.title = "New file";
        add.innerHTML = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
        add.addEventListener("click", promptNewFile);
        fileTabsEl.appendChild(add);
    }

    function loadFiles(files, active) {
        for (const m of models.values()) m.dispose();
        models.clear();
        for (const f of files) {
            if (!f || !f.name) continue;
            const name = uniqueName(String(f.name).replace(/^\/+/, ""));
            models.set(name, monaco.editor.createModel(String(f.content || ""), monacoLang(fileLang(name))));
        }
        if (!models.size) models.set("untitled.txt", monaco.editor.createModel("", "plaintext"));
        const first = models.has(active) ? active : models.keys().next().value;
        openFile(first);
    }

    langSelect.addEventListener("change", () => setLang(langSelect.value));
    fileNameEl.addEventListener("change", () => {
        const v = (fileNameEl.value || "").trim();
        if (v && v !== activeName) renameFile(activeName, v);
        else fileNameEl.value = activeName || "";
    });
    fileNameEl.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); fileNameEl.blur(); } });

    document.getElementById("btnFormat").addEventListener("click", () => {
        editor.getAction("editor.action.formatDocument")?.run();
    });

    document.getElementById("btnCopy").addEventListener("click", async () => {
        try {
            await navigator.clipboard.writeText(editor.getValue());
            stStatus.textContent = "copied";
            flashStatus();
            setTimeout(() => stStatus.textContent = "ready", 1200);
        } catch { stStatus.textContent = "copy failed"; }
    });

    document.getElementById("btnClear").addEventListener("click", () => {
        editor.setValue("");
        saveNow();
        editor.focus();
    });

    let _backendLogES = null;
    function closeBackendLogs() { if (_backendLogES) { try { _backendLogES.close(); } catch {} _backendLogES = null; } }
    async function runBackendInPanel(files) {
        closeBackendLogs();
        document.body.classList.remove("code-focus");
        outputPanel.classList.add("open");
        outputPanel.classList.remove("open-preview");
        outputLog.innerHTML = "";
        appendLine(outputLog, "meta", "▸  starting backend in your container…");
        try {
            const res = await startBackend(files);
            appendLine(outputLog, "info", "$ " + (res.cmd || ""));
            appendLine(outputLog, "meta", "waiting for it to listen on $PORT (" + res.port + ")…");
            _backendLogES = streamLogs(line => appendLine(outputLog, "log", line));
            const st = await waitUntilLive(45000);
            if (st && st.live) {
                appendLine(outputLog, "success", "✓ live at " + res.appUrl);
                showLivePreview(res.appUrl);
            } else if (st && st.running) {
                appendLine(outputLog, "error", "running but not reachable — bind 0.0.0.0 on process.env.PORT (" + res.port + ").");
            } else {
                appendLine(outputLog, "error", "the app exited before it listened — check the log above.");
            }
            return { backend: true, appUrl: res.appUrl, live: !!(st && st.live) };
        } catch (e) {
            if (e.needsAuth) appendLine(outputLog, "info", "Sign in to run backend apps — they execute in your account's container.");
            else appendLine(outputLog, "error", "backend run failed: " + (e.message || e));
            return { backend: true, error: e.message || String(e) };
        }
    }
    function showLivePreview(appUrl) {
        outputPanel.classList.add("open", "open-preview");
        outputLog.innerHTML = "";
        const wrap = document.createElement("div");
        wrap.style.cssText = "display:flex;flex-direction:column;height:100%;background:#fff";
        const bar = document.createElement("div");
        bar.style.cssText = "flex:0 0 auto;display:flex;gap:6px;align-items:center;padding:6px 10px;background:#0b0a14;color:#c9c1ff;font:12px/1.3 'JetBrains Mono',ui-monospace,monospace;border-bottom:1px solid rgba(200,195,230,.14)";
        const dot = document.createElement("span"); dot.textContent = "●"; dot.style.color = "#7ee787";
        const a = document.createElement("a"); a.href = appUrl; a.target = "_blank"; a.rel = "noopener";
        a.textContent = location.origin + appUrl; a.style.cssText = "color:#b8b0da;text-decoration:none;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:1";
        bar.append(dot, a);
        const frame = document.createElement("iframe");
        frame.src = appUrl;
        frame.style.cssText = "flex:1 1 auto;width:100%;border:0;background:#fff";
        wrap.append(bar, frame);
        outputLog.appendChild(wrap);
    }
    btnCloseOut?.addEventListener("click", closeBackendLogs);

    async function run() {
        saveNow();
        document.body.classList.remove("code-focus");
        const files = fileList();
        const lang = fileLang(activeName);
        const code = activeContent();

        if (isBackendProject(files, lang)) return runBackendInPanel(files);
        const htmlFiles = files.filter(f => /\.html?$/i.test(f.name));
        const jsLike = lang === "javascript" || lang === "typescript";
        const isPkgJson = /(^|\/)package\.json$/i.test(activeName);

        const showPreview = (entryName) => { outputPanel.classList.add("open", "open-preview"); outputLog.innerHTML = ""; return runWebProject(entryName, files, outputLog); };

        if (lang === "html") {
            const entry = files.find(f => f.name === activeName) || htmlFiles[0];
            if (entry) return showPreview(entry.name);
        }

        if (STYLE_LANGS.has(lang) || jsLike) {
            const linked = findHtmlThatUses(activeName, files);
            const entry = linked
                || (STYLE_LANGS.has(lang) && htmlFiles.length ? (htmlFiles.find(f => /(^|\/)index\.html?$/i.test(f.name)) || htmlFiles[0]) : null);
            if (entry) {
                if (linked) { stStatus.textContent = "↳ " + entry.name; flashStatus(); }
                return showPreview(entry.name);
            }
            if (lang === "css") { outputPanel.classList.add("open", "open-preview"); outputLog.innerHTML = ""; return runIframe(buildCssPreview(code), outputLog); }
            if (STYLE_LANGS.has(lang)) { outputPanel.classList.add("open"); outputPanel.classList.remove("open-preview"); outputLog.innerHTML = ""; appendLine(outputLog, "info", "Add an HTML file (or compile to CSS) to preview your " + lang + "."); return; }

        }

        if (lang === "python" || REMOTE_LANGS.has(lang)) {
            outputPanel.classList.add("open");
            outputPanel.classList.remove("open-preview");
            outputLog.innerHTML = "";
            if (lang === "python") {

                const entry = resolvePythonEntry(activeName, files);
                const ef = files.find(f => f.name === entry) || { name: activeName, content: code };
                if (!(ef.content || "").trim()) { appendLine(outputLog, "info", "nothing to run"); return; }
                if (ef.name !== activeName) { stStatus.textContent = "↳ " + ef.name; flashStatus(); }
                return runPython(ef.content, outputLog, files.filter(f => f.name !== ef.name));
            }
            if (!code.trim()) { appendLine(outputLog, "info", "nothing to run"); return; }
            const extras = files.filter(f => f.name !== activeName);
            return runRemote(code, lang, outputLog, extras);
        }

        if (jsLike || isPkgJson) {
            outputPanel.classList.add("open");
            outputPanel.classList.remove("open-preview");
            outputLog.innerHTML = "";

            const jsCount = files.filter(f => /\.(m?js|cjs|ts)$/i.test(f.name)).length;
            const multi = jsCount > 1 || files.some(f => /(^|\/)package\.json$/i.test(f.name));
            if (multi) return runMultiFileProject(files, isPkgJson ? null : activeName);
            return runNodeProject(files, isPkgJson ? null : activeName);
        }

        if (lang !== "markdown" && lang !== "json" && htmlFiles.length) {
            const e = htmlFiles.find(f => /(^|\/)index\.html?$/i.test(f.name)) || htmlFiles[0];
            return showPreview(e.name);
        }

        return runCode(editor, lang, outputPanel, outputLog);
    }

    async function runNodeProject(files, activeName, opts = {}) {
        const src = files.filter(f => /\.(m?js|cjs|ts|json)$/i.test(f.name));
        if (!src.length) { appendLine(outputLog, "info", "no JavaScript files to run"); return; }
        const entryFile = opts.forceEntry
            ? (files.find(f => f.name === opts.forceEntry) || { name: opts.forceEntry, content: "" })
            : resolveJsEntry(files, activeName);
        const prepared = [];
        let tsFailed = false;
        for (const f of src) {
            if (/\.ts$/i.test(f.name)) {
                try {
                    const ts = await loadTypeScriptOnce(outputLog);
                    const js = ts.transpile(f.content || "", { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true });
                    prepared.push({ name: f.name.replace(/\.ts$/i, ".js"), content: js });
                } catch (e) { tsFailed = true; appendLine(outputLog, "error", "TypeScript compile failed (" + f.name + "): " + (e.message || e)); }
            } else prepared.push({ name: f.name, content: f.content });
        }
        if (tsFailed) return;
        const entryName = entryFile.name.replace(/\.ts$/i, ".js");
        const isLib = looksLikeLibrary(files.find(f => f.name === entryFile.name) || entryFile);
        runJsProject(prepared, entryName, outputLog, {
            onDone: (hadOutput) => {
                if (!hadOutput && !opts.fromAi && (isLib || prepared.length > 1)) aiAssistRun(files, activeName);
            }
        });
    }

    async function aiAssistRun(files, activeName) {
        appendLine(outputLog, "meta", "▸  no output — asking the AI how to run this project…");
        let plan;
        try { plan = await aiFindHowToRun(files); }
        catch (e) { appendLine(outputLog, "error", "AI run helper failed: " + (e.message || e)); return; }
        if (plan.needsAuth) { appendLine(outputLog, "info", "Sign in to let the AI work out how to run this project."); return; }
        if (plan.error) { appendLine(outputLog, "info", plan.error); return; }
        if (plan.note) appendLine(outputLog, "info", "AI: " + plan.note);
        let entry = plan.entry || activeName;
        if (plan.runner && plan.runner.name && typeof plan.runner.content === "string" && plan.runner.content.trim()) {
            entry = addFile(plan.runner.name, plan.runner.content, true);
            saveNow();
        }
        runNodeProject(fileList(), entry, { forceEntry: entry, fromAi: true });
    }

    async function runMultiFileProject(files, activeName) {
        const key = fileSetKey(files);
        let plan = _runPlanCache.get(key);
        if (plan === undefined) {
            appendLine(outputLog, "meta", "▸  multi-file project — asking ChatGPT 5.4 mini how to run it…");
            try { plan = await aiFindHowToRun(files); } catch (e) { plan = { error: String((e && e.message) || e) }; }
            if (plan && !plan.needsAuth && !plan.error) _runPlanCache.set(key, plan);
        }
        let entry = null, runFiles = files.slice();
        if (plan && !plan.needsAuth && !plan.error) {
            if (plan.note) appendLine(outputLog, "info", "ChatGPT 5.4 mini: " + plan.note);
            if (plan.entry && files.some(f => f.name === plan.entry)) entry = plan.entry;
            if (plan.runner && plan.runner.name && typeof plan.runner.content === "string" && plan.runner.content.trim()) {
                addFile(plan.runner.name, plan.runner.content, true); saveNow();
                runFiles = fileList();
                entry = plan.runner.name;
            }
        } else if (plan && plan.needsAuth) {
            appendLine(outputLog, "info", "Sign in to let ChatGPT 5.4 mini pick the entry — using a best guess for now.");
        } else if (plan && plan.error) {
            appendLine(outputLog, "info", "Couldn't reach ChatGPT 5.4 mini (" + plan.error + ") — using a best guess.");
        }
        if (!entry) entry = resolveJsEntry(runFiles, activeName).name;

        const prepared = [];
        for (const f of runFiles.filter(x => /\.(m?js|cjs|ts|json)$/i.test(x.name))) {
            if (/\.ts$/i.test(f.name)) {
                try {
                    const ts = await loadTypeScriptOnce(outputLog);
                    prepared.push({ name: f.name.replace(/\.ts$/i, ".js"), content: ts.transpile(f.content || "", { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS, esModuleInterop: true }) });
                } catch (e) { appendLine(outputLog, "error", "TypeScript compile failed (" + f.name + "): " + (e.message || e)); return; }
            } else prepared.push({ name: f.name, content: f.content });
        }
        const entryName = entry.replace(/\.ts$/i, ".js");
        const win = runInNewTab(prepared, entryName);
        if (!win) appendLine(outputLog, "error", "Couldn't open a new tab — allow pop-ups for this site, then click Run again.");
        else appendLine(outputLog, "info", "✓  opened " + entryName + " in a new tab (running in a sandbox).");
    }

    document.getElementById("btnRun").addEventListener("click", () => run());
    btnCloseOut?.addEventListener("click", () => {
        outputPanel.classList.remove("open", "open-preview", "fullscreen");
        document.body.classList.remove("code-focus");
        if (document.fullscreenElement === outputPanel) document.exitFullscreen?.();
        updateOutputTab();
    });
    btnClearOut?.addEventListener("click", () => { outputLog.innerHTML = ""; });

    document.getElementById("btnFullOut")?.addEventListener("click", () => {
        if (document.fullscreenElement === outputPanel) {
            document.exitFullscreen?.();
            outputPanel.classList.remove("fullscreen");
        } else {
            outputPanel.requestFullscreen?.().then(() => outputPanel.classList.add("fullscreen")).catch(() => {});
        }
    });

    document.getElementById("btnNewTabOut")?.addEventListener("click", () => {
        const lang = fileLang(activeName);
        const htmlFiles = fileList().filter(f => /\.html?$/i.test(f.name));
        let html;
        if (lang === "html" || (htmlFiles.length && (lang === "css" || lang === "javascript"))) {
            const entry = lang === "html"
                ? (fileList().find(f => f.name === activeName) || htmlFiles[0])
                : (htmlFiles.find(f => /(^|\/)index\.html?$/i.test(f.name)) || htmlFiles[0]);
            html = entry ? buildSitePage(entry.name, fileList()) : null;
        } else {
            html = buildPreviewHtml(activeContent(), lang);
        }
        if (!html) return;

        const blob = new Blob([buildStandaloneSiteDoc(html)], { type: "text/html;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank", "noopener");
        setTimeout(() => URL.revokeObjectURL(url), 60000);
    });

    const editorEl     = document.getElementById("editor");
    const agentOverlay = document.getElementById("agentOverlay");
    const aoText = agentOverlay?.querySelector(".ao-text");
    const aoSub  = agentOverlay?.querySelector(".ao-sub");
    const PHASE_LABELS = { start: "AI in action", thinking: "AI is thinking", writing: "AI is writing", running: "AI is running", working: "AI in action", done: "AI finished" };
    const PARTY_LABELS = { start: "🎉 AI in action", thinking: "🎉 AI is vibing", writing: "🎉 AI is jamming", running: "🎉 AI is popping off", working: "🎉 AI in action", done: "🎉 AI nailed it" };
    let partyMode = false;
    document.getElementById("aiPanel")?.addEventListener("ai:party", (e) => { partyMode = !!e.detail?.on; });

    function positionOverlay() {
        if (!agentOverlay || !editorEl) return;
        const r = editorEl.getBoundingClientRect();
        agentOverlay.style.top = r.top + "px";
        agentOverlay.style.left = r.left + "px";
        agentOverlay.style.width = r.width + "px";
        agentOverlay.style.height = r.height + "px";
    }
    function agentPhase(phase, detail) {
        const b = document.body;
        if (phase === "idle" || phase === "stopped") {
            b.classList.remove("agent-active", "agent-typing", "agent-running-phase");
            return;
        }
        b.classList.add("agent-active");
        b.classList.toggle("agent-typing", phase === "writing");
        b.classList.toggle("agent-running-phase", phase === "running");
        const labels = partyMode ? PARTY_LABELS : PHASE_LABELS;
        if (aoText) aoText.textContent = labels[phase] || labels.start;
        if (aoSub) aoSub.textContent = detail || "";
        positionOverlay();
    }
    window.addEventListener("resize", () => { if (document.body.classList.contains("agent-active")) positionOverlay(); });

    const sleep = (ms) => new Promise(r => setTimeout(r, ms));

    async function typeInto(model, content) {
        model.setValue("");
        const total = content.length;
        if (!total) return;
        const steps = Math.min(120, Math.max(6, Math.ceil(total / 18)));
        const per   = Math.ceil(total / steps);
        const delay = Math.min(1800, Math.max(350, total * 1.1)) / steps;
        const isActive = () => editor.getModel() === model;
        for (let i = 0; i < total; i += per) {
            const chunk = content.slice(i, i + per);
            const lastLine = model.getLineCount();
            const lastCol = model.getLineMaxColumn(lastLine);
            model.applyEdits([{ range: new monaco.Range(lastLine, lastCol, lastLine, lastCol), text: chunk, forceMoveMarkers: true }]);
            if (isActive()) {
                const ln = model.getLineCount();
                try { editor.setPosition({ lineNumber: ln, column: model.getLineMaxColumn(ln) }); editor.revealLine(ln); } catch {}
            }
            await sleep(delay);
        }
    }

    async function agentWriteFile(name, content) {
        name = String(name || "").trim().replace(/^\/+/, "");
        if (!name) return "error: missing file path";
        content = String(content == null ? "" : content);
        const lines = content.split("\n").length;
        const existed = models.has(name);
        if (existed) openFile(name);
        else addFile(name, "", true);
        const model = models.get(name);
        document.body.classList.add("agent-typing");
        try { await typeInto(model, content); }
        finally {  }
        saveNow();
        return `${existed ? "updated" : "created"} ${name} (${lines} lines)`;
    }
    function agentDeleteFile(name) {
        name = String(name || "").trim().replace(/^\/+/, "");
        if (!models.has(name)) return `no such file: ${name}`;
        if (models.size <= 1) return "error: can't delete the only remaining file";
        deleteFile(name);
        saveNow();
        return `deleted ${name}`;
    }
    function agentRenameFile(from, to) {
        from = String(from || "").trim().replace(/^\/+/, "");
        to = String(to || "").trim().replace(/^\/+/, "");
        if (!models.has(from)) return `no such file: ${from}`;
        if (!to) return "error: missing new name";
        renameFile(from, to);
        saveNow();
        return `renamed ${from} → ${to}`;
    }
    function agentOpenFile(name) {
        name = String(name || "").trim().replace(/^\/+/, "");
        if (!models.has(name)) return `no such file: ${name}`;
        openFile(name);
        const c = models.get(name).getValue();
        return `opened ${name}:\n${c.length > 4000 ? c.slice(0, 4000) + "\n…(truncated)" : c}`;
    }
    async function agentImportGithub(repo) {
        repo = String(repo || "").trim();
        if (!repo) return "error: missing repo (use owner/name or a github.com URL)";
        let data;
        try {
            const r = await fetch("/api/github/import", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ repo }) });
            data = await r.json().catch(() => ({}));
            if (!r.ok) return "error: " + (data.error || ("GitHub import failed (" + r.status + ")"));
        } catch (e) { return "error: " + (e && e.message ? e.message : e); }
        if (!data.files || !data.files.length) return "error: no importable files found";
        loadFiles(data.files, data.files[0].name);
        saveNow();
        const names = data.files.map(f => f.name);
        return `imported ${data.fileCount} file${data.fileCount === 1 ? "" : "s"} from ${data.owner}/${data.repo} into the editor${data.truncated ? " (large repo — some files were skipped)" : ""}:\n${names.slice(0, 50).join(", ")}${names.length > 50 ? ", …" : ""}`;
    }
    async function agentRun(name) {
        name = String(name || "").trim().replace(/^\/+/, "");
        if (name && models.has(name)) openFile(name);
        const target = activeName;
        const lang = fileLang(target);
        let _runResult;
        try { _runResult = await Promise.resolve(run()); }
        catch (e) { return `run error: ${e && e.message ? e.message : e}`; }
        if (_runResult && _runResult.backend) {
            if (_runResult.error) return `backend run failed: ${_runResult.error}`;
            await new Promise(r => setTimeout(r, 150));
            const blog = (outputLog.innerText || outputLog.textContent || "").trim().slice(0, 2500);
            return (_runResult.live
                ? `backend is LIVE at ${location.origin}${_runResult.appUrl}`
                : `backend started but isn't reachable yet — it must bind 0.0.0.0 on process.env.PORT; url ${location.origin}${_runResult.appUrl}`)
                + (blog ? `\n\nrecent logs:\n${blog}` : "");
        }
        await new Promise(r => setTimeout(r, 80));
        const txt = (outputLog.innerText || outputLog.textContent || "").trim();
        if (!txt) return `ran ${target} (${lang}) — no textual output${/(html|markdown|css)/.test(lang) ? "; a live preview opened in the output panel" : ""}.`;
        return txt.length > 4000 ? txt.slice(0, 4000) + "\n…(truncated)" : txt;
    }

    const aiPanelEl = document.getElementById("aiPanel");
    const prefAgent = document.getElementById("prefAgent");
    const ai = new AIPanel(aiPanelEl, {
        getCode: () => activeContent(),
        getLang: () => fileLang(activeName),
        onInsert: (code) => {
            const sel = editor.getSelection();
            const op = { range: sel, text: code, forceMoveMarkers: true };
            editor.executeEdits("ai-insert", [op]);
            editor.focus();
            aiPanelEl.classList.remove("open");
        },

        onAgentMode: (on) => { if (prefAgent) prefAgent.checked = on; },

        onPhase: (phase, detail) => agentPhase(phase, detail),
        agent: {
            getWorkspace: () => ({ files: fileList(), active: activeName }),
            writeFile: agentWriteFile,
            deleteFile: agentDeleteFile,
            renameFile: agentRenameFile,
            openFile: agentOpenFile,
            run: agentRun,
            importGithub: agentImportGithub
        }
    });

    projectsRef = initProjects({
        getWorkspace: () => ({ files: fileList(), active: activeName }),
        applyWorkspace: (files, active) => loadFiles(files, active),
        saveLocal: saveNow,
        status: (t) => { stStatus.textContent = t; flashStatus(); setTimeout(() => { if (stStatus.textContent === t) stStatus.textContent = "ready"; }, 1600); },
        templates: TEMPLATES,
        ai,
        openAIPanel: () => aiPanelEl.classList.add("open")
    });

    const btnBackToCode = document.getElementById("btnBackToCode");
    const outputTab = document.getElementById("outputTab");
    function outputHasContent() { return !!(outputLog && outputLog.children.length); }
    function updateOutputTab() {
        const b = document.body;
        outputTab?.classList.toggle("show", b.classList.contains("ai-docked") && b.classList.contains("ai-open") && b.classList.contains("code-focus") && outputHasContent());
    }
    function applyDock() {
        const open = aiPanelEl.classList.contains("open");
        const wide = window.innerWidth >= 900;
        document.body.classList.toggle("ai-docked", wide);
        document.body.classList.toggle("ai-open", open && wide);
        if (!(open && wide)) document.body.classList.remove("code-focus");
        updateOutputTab();
        if (document.body.classList.contains("agent-active")) positionOverlay();
    }
    try { new MutationObserver(applyDock).observe(aiPanelEl, { attributes: true, attributeFilter: ["class"] }); } catch {}
    window.addEventListener("resize", applyDock);
    btnBackToCode?.addEventListener("click", () => { document.body.classList.add("code-focus"); updateOutputTab(); editor.focus(); });
    outputTab?.addEventListener("click", () => { document.body.classList.remove("code-focus"); updateOutputTab(); });
    applyDock();

    prefAgent?.addEventListener("change", () => {
        ai.setAgentMode(prefAgent.checked);
        if (prefAgent.checked) aiPanelEl.classList.add("open");
    });
    document.getElementById("btnAi").addEventListener("click", e => {
        e.stopPropagation();
        aiPanelEl.classList.toggle("open");
        if (aiPanelEl.classList.contains("open")) {
            setTimeout(() => aiPanelEl.querySelector(".ai-input")?.focus(), 200);
        }
    });
    document.getElementById("btnAiClose").addEventListener("click", () => aiPanelEl.classList.remove("open"));

    document.getElementById("btnShare").addEventListener("click", async () => {
        saveNow();

        if (projectsRef?.shareCurrent) {
            stStatus.textContent = "sharing…";
            const result = await projectsRef.shareCurrent();
            if (result?.ok && result.url) {
                const url = `${location.origin}${result.url}`;
                try {
                    await navigator.clipboard.writeText(url);
                    stStatus.textContent = "link copied";
                } catch {
                    history.replaceState(null, "", url);
                    stStatus.textContent = "link in address bar";
                }
                flashStatus();
                setTimeout(() => stStatus.textContent = "ready", 1500);
                return;
            }
        }

        const enc = encodeProject({ files: fileList(), active: activeName });
        const url = `${location.origin}/code.html#p=${enc}`;
        try {
            await navigator.clipboard.writeText(url);
            stStatus.textContent = "link copied";
            flashStatus();
            setTimeout(() => stStatus.textContent = "ready", 1500);
        } catch {
            history.replaceState(null, "", url);
            stStatus.textContent = "link in address bar";
        }
    });

    document.getElementById("btnDownload").addEventListener("click", () => {
        const name = activeName || ("untitled." + (EXT_BY_LANG[fileLang(activeName)] || "txt"));
        const blob = new Blob([activeContent()], { type: "text/plain;charset=utf-8" });
        const u = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = u; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        URL.revokeObjectURL(u);
        stStatus.textContent = "downloaded";
        flashStatus();
        setTimeout(() => stStatus.textContent = "ready", 1200);
    });

    const uploadInput = document.getElementById("uploadInput");
    document.getElementById("btnUpload").addEventListener("click", () => uploadInput.click());
    uploadInput.addEventListener("change", async e => {
        const fileObjs = [...(e.target.files || [])];
        let lastName = null;
        for (const file of fileObjs) {
            const text = await file.text().catch(() => "");
            lastName = addFile(file.name || "untitled.txt", text, false);
        }
        if (lastName) openFile(lastName);
        saveNow();
        e.target.value = "";
    });

    const stdinPanel = document.getElementById("stdinPanel");
    const stdinBox   = document.getElementById("stdinBox");
    const btnStdin   = document.getElementById("btnStdin");
    if (stdinBox) stdinBox.value = localStorage.getItem(STDIN_KEY) || "";

    function updateStdinHint(lang) {
        if (!btnStdin) return;
        const active = (REMOTE_LANGS.has(lang) || lang === "python") && !!(stdinBox && stdinBox.value.length);
        btnStdin.classList.toggle("ct-icon-on", active);
    }

    document.getElementById("btnPrefs").addEventListener("click", e => {
        e.stopPropagation();
        prefsPanel.classList.toggle("open");
        tplOverlay.classList.remove("open");
        stdinPanel?.classList.remove("open");
    });
    btnStdin?.addEventListener("click", e => {
        e.stopPropagation();
        stdinPanel.classList.toggle("open");
        prefsPanel.classList.remove("open");
        tplOverlay.classList.remove("open");
        if (stdinPanel.classList.contains("open")) setTimeout(() => stdinBox?.focus(), 60);
    });
    stdinBox?.addEventListener("input", () => {
        localStorage.setItem(STDIN_KEY, stdinBox.value);
        updateStdinHint(langSelect.value);
    });
    document.addEventListener("click", e => {
        if (!prefsPanel.contains(e.target) && !document.getElementById("btnPrefs").contains(e.target)) {
            prefsPanel.classList.remove("open");
        }
        if (stdinPanel && btnStdin && !stdinPanel.contains(e.target) && !btnStdin.contains(e.target)) {
            stdinPanel.classList.remove("open");
        }
    });

    setupPrefsUI(editor);
    updateStdinHint(savedLang);

    document.getElementById("btnTemplate").addEventListener("click", e => {
        e.stopPropagation();
        renderTemplates(tplGrid, (tpl) => {
            if (tpl.files) {
                loadFiles(tpl.files, tpl.files[0].name);
            } else {
                const ext = EXT_BY_LANG[tpl.lang] || "txt";
                const name = tpl.id === "blank" ? "untitled.txt"
                    : tpl.lang === "html" ? "index.html"
                    : tpl.lang === "markdown" ? "README.md"
                    : "main." + ext;
                loadFiles([{ name, content: tpl.code }], name);
            }
            saveNow();
            tplOverlay.classList.remove("open");
            editor.focus();
        });
        tplOverlay.classList.add("open");
        prefsPanel.classList.remove("open");
    });
    document.getElementById("btnTemplateClose").addEventListener("click", () => tplOverlay.classList.remove("open"));
    tplOverlay.addEventListener("click", e => { if (e.target === tplOverlay) tplOverlay.classList.remove("open"); });

    editor.onDidPaste(() => {

        if (fileLang(activeName) !== "plaintext") return;
        const code = editor.getValue();
        if (!code.trim()) return;
        const detected = detectLanguage(code);
        if (detected && detected !== fileLang(activeName)) {
            setLang(detected);
            stStatus.textContent = `detected ${detected}`;
            flashStatus();
            setTimeout(() => stStatus.textContent = "saved", 1800);
        }
    });

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, saveNow);
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => run());

    document.addEventListener("keydown", e => {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveNow(); }
        if (mod && e.key === "Enter") { e.preventDefault(); run(); }
        if (e.key === "Escape") {
            prefsPanel.classList.remove("open");
            tplOverlay.classList.remove("open");
            stdinPanel?.classList.remove("open");
        }
    });

    function loadSavedProject() {
        try {
            const raw = localStorage.getItem(PROJECT_KEY);
            if (raw) {
                const p = JSON.parse(raw);
                if (p && Array.isArray(p.files) && p.files.length) return { files: p.files, active: p.active };
            }
        } catch {}

        const old = localStorage.getItem(STORAGE_KEY);
        if (typeof old === "string" && old.trim().length) {
            const lang = localStorage.getItem(LANG_KEY) || "javascript";
            const baseName = localStorage.getItem(FILENAME_KEY) || "main";
            const name = /\.[^.\/]+$/.test(baseName) ? baseName : baseName + "." + (EXT_BY_LANG[lang] || "txt");
            return { files: [{ name, content: old }], active: name };
        }
        return { files: [{ name: "main.js", content: WELCOME }], active: "main.js" };
    }

    const initEditor = async () => {
        let payload = hashPayload;
        if (!payload) payload = await loadUserShare();
        if (!payload) payload = await loadServerShare();

        if (payload && payload.project && Array.isArray(payload.project.files) && payload.project.files.length) {
            loadFiles(payload.project.files, payload.project.active);
            saveNow();
            history.replaceState(null, "", "/code.html");
            stStatus.textContent = payload.owner ? `loaded ${payload.owner}'s "${payload.name || "project"}"` : "loaded from link";
            flashStatus();
        } else if (payload && typeof payload.code === "string") {
            const lang = payload.lang || "javascript";
            const name = lang === "html" ? "index.html" : "main." + (EXT_BY_LANG[lang] || "txt");
            loadFiles([{ name, content: payload.code }], name);
            saveNow();
            history.replaceState(null, "", "/code.html");
            stStatus.textContent = "loaded from link";
            flashStatus();
        } else {
            const proj = loadSavedProject();
            loadFiles(proj.files, proj.active);
            stStatus.textContent = "ready";
        }
    };

    initEditor().then(() => { try { projectsRef?.maybeOnboard(); } catch {} });
});

function detectLanguage(code) {
    const s = code.trim();
    if (!s) return null;

    const scores = {
        html: 0, json: 0, python: 0, rust: 0, go: 0, sql: 0,
        markdown: 0, typescript: 0, javascript: 0,
        c: 0, cpp: 0, java: 0, ruby: 0, php: 0
    };

    if (/^<!DOCTYPE\s+html/i.test(s)) scores.html += 10;
    if (/^<html[\s>]/i.test(s)) scores.html += 8;
    if (/<\/?(div|span|body|head|script|style|link|meta|p|a|img|h[1-6])[\s>/]/i.test(s)) scores.html += 3;
    if (/<[a-z][\w-]*\s+[^>]*>/i.test(s)) scores.html += 2;

    if (/^[\s\n]*[{\[]/.test(s) && /[}\]][\s\n]*$/.test(s)) {
        try { JSON.parse(s); scores.json += 15; } catch {}
    }

    if (/^\s*(import|from)\s+[a-zA-Z_]/m.test(s)) scores.python += 4;
    if (/^\s*def\s+[a-zA-Z_]\w*\s*\(/m.test(s)) scores.python += 5;
    if (/^\s*class\s+[A-Z]\w*\s*[:(]/m.test(s)) scores.python += 3;
    if (/\bprint\s*\(/m.test(s) && !/console\.log/.test(s)) scores.python += 2;
    if (/:\s*$/m.test(s) && /^\s{2,4}[a-zA-Z_]/m.test(s)) scores.python += 2;
    if (/\belif\b|\band\b|\bor\b|\bnot\s+in\b|\bis\s+None\b/.test(s)) scores.python += 2;

    if (/\bfn\s+\w+\s*\(/.test(s)) scores.rust += 6;
    if (/^\s*use\s+\w+(::\w+)+;/m.test(s)) scores.rust += 5;
    if (/\blet\s+mut\s+/.test(s)) scores.rust += 4;
    if (/->\s*\w+\s*\{/.test(s)) scores.rust += 3;
    if (/\bimpl\s+\w+\s+for\b|\btrait\s+\w+/.test(s)) scores.rust += 3;

    if (/^package\s+\w+/m.test(s)) scores.go += 8;
    if (/\bfunc\s+(\(\w+\s+\*?\w+\)\s+)?\w+\s*\(/.test(s)) scores.go += 5;
    if (/\bgo\s+\w+\(/.test(s) || /\bchan\b|\bgoroutine\b/.test(s)) scores.go += 3;

    if (/\b(SELECT|INSERT|UPDATE|DELETE|CREATE|DROP|ALTER|TABLE)\b\s/i.test(s)) scores.sql += 4;
    if (/\bFROM\s+\w+/i.test(s) && /\bWHERE\b|\bJOIN\b/i.test(s)) scores.sql += 4;
    if (/;\s*(SELECT|INSERT)/i.test(s)) scores.sql += 2;

    if (/^#{1,6}\s+\S/m.test(s)) scores.markdown += 4;
    if (/^[-*]\s+\S/m.test(s) && /\n\s*[-*]\s/m.test(s)) scores.markdown += 2;
    if (/\*\*[^*]+\*\*/.test(s) || /`[^`]+`/.test(s)) scores.markdown += 2;
    if (/^\[.+\]\(.+\)$/m.test(s)) scores.markdown += 2;
    if (/^```[\s\S]*?```$/m.test(s)) scores.markdown += 3;

    if (/#include\s*<[\w./]+>/.test(s)) { scores.c += 4; scores.cpp += 4; }
    if (/\b(std::|cout|cin|template\s*<|nullptr|using namespace)\b/.test(s)) scores.cpp += 5;
    if (/\b(printf|scanf|malloc|->|struct\s+\w+\s*\{)\b/.test(s)) scores.c += 2;
    if (/\bpublic\s+(static\s+)?(class|void)\b/.test(s) || /System\.out\.print/.test(s)) scores.java += 6;
    if (/\bputs\b|\bend\b|\.each\s+do\b|def\s+\w+[!?]?\s*$/m.test(s)) scores.ruby += 4;
    if (/<\?php|\$\w+\s*=|echo\s+["'$]/.test(s)) scores.php += 5;

    if (/:\s*(string|number|boolean|any|void|unknown|never)\b/.test(s)) scores.typescript += 5;
    if (/\binterface\s+\w+\s*\{/.test(s)) scores.typescript += 5;
    if (/\btype\s+\w+\s*=/.test(s)) scores.typescript += 4;
    if (/\bas\s+(string|number|boolean|\w+)\b/.test(s)) scores.typescript += 2;
    if (/<[A-Z]\w*>/.test(s) && /\bfunction|const|let/.test(s)) scores.typescript += 2;

    if (/\bconsole\.(log|error|warn|info)\s*\(/.test(s)) scores.javascript += 4;
    if (/\b(const|let|var)\s+\w+\s*=/.test(s)) scores.javascript += 2;
    if (/\bfunction\s*\*?\s*\w*\s*\(/.test(s)) scores.javascript += 2;
    if (/=>\s*[\{(]/.test(s)) scores.javascript += 2;
    if (/\brequire\s*\(['"]/.test(s) || /\bimport\s+.*\bfrom\s+['"]/.test(s)) scores.javascript += 3;
    if (/\bdocument\.|\bwindow\.|\baddEventListener\(/.test(s)) scores.javascript += 2;

    let best = null;
    let bestScore = 0;
    for (const [lang, score] of Object.entries(scores)) {
        if (score > bestScore) { bestScore = score; best = lang; }
    }

    return bestScore >= 4 ? best : null;
}

function defineTheme() {
    monaco.editor.defineTheme("nocturne", {
        base: "vs-dark",
        inherit: true,
        rules: [
            { token: "",           foreground: "e8e5f4" },
            { token: "comment",    foreground: "706b8f", fontStyle: "italic" },
            { token: "keyword",    foreground: "b8b0da" },
            { token: "string",     foreground: "c9c1ff" },
            { token: "number",     foreground: "a9a3c7" },
            { token: "type",       foreground: "8a80b6" },
            { token: "function",   foreground: "d6cff2" },
            { token: "variable",   foreground: "e8e5f4" },
            { token: "operator",   foreground: "a9a3c7" },
            { token: "delimiter",  foreground: "706b8f" },
            { token: "tag",        foreground: "b8b0da" },
            { token: "attribute.name",  foreground: "8a80b6" },
            { token: "attribute.value", foreground: "c9c1ff" }
        ],
        colors: {
            "editor.background":              "#05060d",
            "editor.foreground":              "#e8e5f4",
            "editorLineNumber.foreground":    "#3f3c5a",
            "editorLineNumber.activeForeground": "#a9a3c7",
            "editor.lineHighlightBackground": "#0d0f1c",
            "editor.lineHighlightBorder":     "#0d0f1c",
            "editor.selectionBackground":     "#312c4f88",
            "editor.selectionHighlightBackground": "#25223a55",
            "editor.inactiveSelectionBackground":  "#25223a55",
            "editor.wordHighlightBackground":      "#25223a77",
            "editor.findMatchBackground":     "#4c4478",
            "editor.findMatchHighlightBackground": "#3a325e88",
            "editorCursor.foreground":        "#b8b0da",
            "editorWhitespace.foreground":    "#1e1c30",
            "editorIndentGuide.background":   "#13131f",
            "editorIndentGuide.activeBackground": "#2a2840",
            "editorBracketMatch.background":  "#3a325e55",
            "editorBracketMatch.border":      "#8a80b6",
            "editorGutter.background":        "#05060d",
            "editorWidget.background":        "#0c0d18",
            "editorWidget.border":            "#1a1b2b",
            "editorSuggestWidget.background": "#0c0d18",
            "editorSuggestWidget.border":     "#1a1b2b",
            "editorSuggestWidget.selectedBackground": "#25223a",
            "editorHoverWidget.background":   "#0c0d18",
            "editorHoverWidget.border":       "#1a1b2b",
            "scrollbar.shadow":               "#00000000",
            "scrollbarSlider.background":     "#25223a77",
            "scrollbarSlider.hoverBackground":"#312c4fbb",
            "scrollbarSlider.activeBackground":"#4c4478"
        }
    });
}

function loadPrefs() {
    const defaults = { fontSize: 13.5, wrap: true, minimap: false, ligatures: true };
    try {
        const raw = localStorage.getItem(PREFS_KEY);
        if (!raw) return defaults;
        return Object.assign({}, defaults, JSON.parse(raw));
    } catch { return defaults; }
}

function savePrefs(prefs) {
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch {}
}

function setupPrefsUI(editor) {
    const prefs = loadPrefs();
    const font = document.getElementById("prefFont");
    const fontVal = document.getElementById("prefFontVal");
    const wrap = document.getElementById("prefWrap");
    const mini = document.getElementById("prefMini");
    const lig = document.getElementById("prefLig");

    font.value = prefs.fontSize;
    fontVal.textContent = prefs.fontSize + "px";
    wrap.checked = prefs.wrap;
    mini.checked = prefs.minimap;
    lig.checked  = prefs.ligatures;

    font.addEventListener("input", () => {
        prefs.fontSize = parseFloat(font.value);
        fontVal.textContent = prefs.fontSize + "px";
        editor.updateOptions({ fontSize: prefs.fontSize });
        savePrefs(prefs);
    });
    wrap.addEventListener("change", () => {
        prefs.wrap = wrap.checked;
        editor.updateOptions({ wordWrap: prefs.wrap ? "on" : "off" });
        savePrefs(prefs);
    });
    mini.addEventListener("change", () => {
        prefs.minimap = mini.checked;
        editor.updateOptions({ minimap: { enabled: prefs.minimap } });
        savePrefs(prefs);
    });
    lig.addEventListener("change", () => {
        prefs.ligatures = lig.checked;
        editor.updateOptions({ fontLigatures: prefs.ligatures });
        savePrefs(prefs);
    });
}

function renderTemplates(container, onPick) {
    container.innerHTML = "";
    for (const tpl of TEMPLATES) {
        const card = document.createElement("button");
        card.className = "tm-card";
        card.innerHTML = `<div class="tm-name">${escapeHtml(tpl.name)}</div><div class="tm-lang">${escapeHtml(tpl.lang)}</div><div class="tm-desc">${escapeHtml(tpl.desc)}</div>`;
        card.addEventListener("click", () => onPick(tpl));
        container.appendChild(card);
    }
}

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function encodeShare(code, lang) {
    const bytes = new TextEncoder().encode(code);
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    const b64 = btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return { c: b64, l: lang };
}

function decodeShare(c) {
    try {
        const b64 = c.replace(/-/g, "+").replace(/_/g, "/");
        const bin = atob(b64);
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        return new TextDecoder().decode(bytes);
    } catch { return null; }
}

function encodeProject(project) {
    const bytes = new TextEncoder().encode(JSON.stringify(project));
    let bin = "";
    for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeProject(p) {
    try {
        const obj = JSON.parse(decodeShare(p));
        if (obj && Array.isArray(obj.files) && obj.files.length) return obj;
    } catch {}
    return null;
}

function parseShareHash() {
    const h = location.hash.replace(/^#/, "");
    if (!h) return null;
    const params = new URLSearchParams(h);
    const p = params.get("p");
    if (p) {
        const project = decodeProject(p);
        if (project) return { project };
    }
    const c = params.get("c");
    const l = params.get("l");
    if (!c) return null;
    const code = decodeShare(c);
    if (code === null) return null;
    return { code, lang: l || "javascript" };
}

async function loadServerShare() {
    const params = new URLSearchParams(location.search);
    const shareId = params.get("share");
    if (!shareId) return null;
    try {
        const res = await fetch(`/api/code/${shareId}`);
        if (!res.ok) return null;
        const data = await res.json();
        return { code: data.content, lang: data.language || "javascript" };
    } catch {
        return null;
    }
}

async function loadUserShare() {
    const m = location.pathname.match(/^\/s\/([^\/]+)\/(\d+)$/);
    if (!m) return null;
    try {
        const res = await fetch(`/api/projects/share/${encodeURIComponent(m[1])}/${m[2]}`);
        if (!res.ok) return null;
        const data = await res.json();
        if (data?.data && Array.isArray(data.data.files) && data.data.files.length) {
            return { project: { files: data.data.files, active: data.data.active }, owner: data.username, name: data.name };
        }
    } catch {}
    return null;
}

function buildPreviewHtml(code, lang) {
    if (!code.trim()) return null;
    if (lang === "html") return code;
    if (lang === "javascript" || lang === "typescript") {
        const safe = code.replace(/<\/script/gi, "<\\/script");
        return `<!doctype html><html><head><meta charset="utf-8"><title>JS run</title><style>body{font-family:'JetBrains Mono',Menlo,monospace;background:#05060d;color:#e8e5f4;padding:20px;font-size:13px;line-height:1.6}.log{padding:2px 0}.error{color:#e07cb8}.warn{color:#e0c17c}.info{color:#7cc8e0}.meta{color:#706b8f;font-style:italic}</style></head><body><div id="out"></div><script>
const out = document.getElementById("out");
const fmt = v => { try { return typeof v === "object" ? JSON.stringify(v, null, 2) : String(v); } catch { return String(v); } };
const line = (cls, args) => { const d = document.createElement("div"); d.className = "log " + cls; d.textContent = args.map(fmt).join(" "); out.appendChild(d); };
console.log = (...a) => line("log", a);
console.error = (...a) => line("error", a);
console.warn = (...a) => line("warn", a);
console.info = (...a) => line("info", a);
const t0 = performance.now();
try { (function(){ ${safe} })(); } catch (e) { line("error", [e.name + ": " + e.message]); }
const m = document.createElement("div"); m.className = "log meta"; m.textContent = "done in " + (performance.now() - t0).toFixed(1) + "ms"; out.appendChild(m);
<\/script></body></html>`;
    }
    if (lang === "markdown") {
        const rendered = renderMarkdown(code);
        return `<!doctype html><html><head><meta charset="utf-8"><title>Markdown preview</title><style>
body{font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;color:#e8e5f4;background:#0a0b14;padding:24px;line-height:1.6;max-width:760px;margin:0 auto}
h1,h2,h3,h4{color:#fff;letter-spacing:-0.01em;margin-top:1em}
h1{font-size:28px}h2{font-size:22px;border-bottom:1px solid #1a1b2b;padding-bottom:6px}h3{font-size:18px}
a{color:#c9c1ff}code{background:rgba(200,195,230,0.08);padding:2px 5px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:12.5px}
pre{background:rgba(200,195,230,0.04);padding:12px;border-radius:8px;overflow-x:auto;border:1px solid #1a1b2b}
pre code{background:none;padding:0}
blockquote{border-left:2px solid #8a80b6;padding-left:14px;color:#a9a3c7;margin:1em 0}
hr{border:none;border-top:1px solid #1a1b2b;margin:2em 0}
ul,ol{padding-left:24px}img{max-width:100%}
</style></head><body>${rendered}</body></html>`;
    }
    if (lang === "json") {
        try {
            const pretty = JSON.stringify(JSON.parse(code), null, 2);
            const escaped = pretty.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
            return `<!doctype html><html><head><meta charset="utf-8"><title>JSON</title><style>body{margin:0;background:#0a0b14;color:#e8e5f4;font-family:'JetBrains Mono',Menlo,monospace;font-size:13px;padding:20px;white-space:pre}</style></head><body>${escaped}</body></html>`;
        } catch { return null; }
    }
    return null;
}

function runCode(editor, lang, panel, log) {
    panel.classList.add("open");
    panel.classList.remove("open-preview");
    log.innerHTML = "";

    const code = editor.getValue();
    if (!code.trim()) {
        appendLine(log, "info", "nothing to run");
        return;
    }

    if (lang === "javascript") return runJS(code, log);
    if (lang === "typescript") return runTS(code, log);
    if (lang === "python") return runPython(code, log);
    if (lang === "html") { panel.classList.add("open-preview"); return runIframe(code, log); }
    if (lang === "json") return runJSON(code, log);
    if (lang === "markdown") {
        panel.classList.add("open-preview");
        const rendered = renderMarkdown(code);
        const wrapped = `<!doctype html><html><head><style>
body{font-family:-apple-system,BlinkMacSystemFont,Inter,sans-serif;color:#e8e5f4;background:#0a0b14;padding:24px;line-height:1.6;max-width:760px;margin:0 auto}
h1,h2,h3,h4{color:#fff;letter-spacing:-0.01em;margin-top:1em}
h1{font-size:28px}h2{font-size:22px;border-bottom:1px solid #1a1b2b;padding-bottom:6px}h3{font-size:18px}
a{color:#c9c1ff}code{background:rgba(200,195,230,0.08);padding:2px 5px;border-radius:4px;font-family:'JetBrains Mono',monospace;font-size:12.5px}
pre{background:rgba(200,195,230,0.04);padding:12px;border-radius:8px;overflow-x:auto;border:1px solid #1a1b2b}
pre code{background:none;padding:0}
blockquote{border-left:2px solid #8a80b6;padding-left:14px;color:#a9a3c7;margin:1em 0}
hr{border:none;border-top:1px solid #1a1b2b;margin:2em 0}
ul,ol{padding-left:24px}img{max-width:100%}
</style></head><body>${rendered}</body></html>`;
        return runIframe(wrapped, log);
    }

    return runRemote(code, lang, log);
}

const TS_VERSION = "5.6.2";
let _tsPromise = null;
function loadTypeScriptOnce(log) {
    if (_tsPromise) return _tsPromise;
    _tsPromise = new Promise((resolve, reject) => {
        if (window.ts) return resolve(window.ts);
        if (log) appendLine(log, "info", "loading TypeScript compiler (one-time)…");
        const s = document.createElement("script");
        s.src = `https://cdn.jsdelivr.net/npm/typescript@${TS_VERSION}/lib/typescript.min.js`;
        s.onload = () => window.ts ? resolve(window.ts) : reject(new Error("typescript loaded but unavailable"));
        s.onerror = () => reject(new Error("failed to load the TypeScript compiler"));
        document.head.appendChild(s);
    });
    return _tsPromise;
}

async function runTS(code, log) {
    let ts;
    try {
        ts = await loadTypeScriptOnce(log);
    } catch (e) {
        appendLine(log, "error", "Could not load TypeScript: " + (e.message || e));
        return;
    }
    let js;
    try {
        js = ts.transpile(code, {
            target: ts.ScriptTarget.ES2020,
            module: ts.ModuleKind.None,
            jsx: ts.JsxEmit ? ts.JsxEmit.Preserve : undefined,
            removeComments: false
        });
    } catch (e) {
        appendLine(log, "error", "TypeScript error: " + (e.message || e));
        return;
    }
    runJS(js, log);
}

const PYODIDE_VERSION = "0.26.4";
let _pyodidePromise = null;
function loadPyodideOnce(log) {
    if (_pyodidePromise) return _pyodidePromise;
    _pyodidePromise = (async () => {
        if (!window.loadPyodide) {
            appendLine(log, "info", "fetching Python runtime (one-time, ~10MB)…");
            await new Promise((res, rej) => {
                const s = document.createElement("script");
                s.src = `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/pyodide.js`;
                s.onload = res;
                s.onerror = () => rej(new Error("pyodide.js failed to load"));
                document.head.appendChild(s);
            });
        }
        if (log) appendLine(log, "info", "initializing interpreter…");
        const py = await window.loadPyodide({ indexURL: `https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/` });
        return py;
    })();
    return _pyodidePromise;
}

async function runPython(code, log, extraFiles) {
    const startLine = document.createElement("div");
    startLine.className = "ol ol-meta";
    startLine.textContent = `▸  python · ${new Date().toLocaleTimeString()}`;
    log.appendChild(startLine);
    const t0 = performance.now();
    let py;
    try {
        py = await loadPyodideOnce(log);
    } catch (e) {
        appendLine(log, "error", "Failed to load Python runtime: " + e.message);
        return;
    }
    py.setStdout({ batched: (s) => appendLine(log, "log", s.trimEnd()) });
    py.setStderr({ batched: (s) => appendLine(log, "error", s.trimEnd()) });

    if (extraFiles && extraFiles.length) {
        for (const f of extraFiles) {
            if (!f || !f.name) continue;
            try {
                const parts = f.name.split("/");
                let dir = "";
                for (let i = 0; i < parts.length - 1; i++) { dir += (i ? "/" : "") + parts[i]; try { py.FS.mkdir(dir); } catch {} }
                py.FS.writeFile(f.name, f.content || "");
            } catch {}
        }
    }

    const stdinText = document.getElementById("stdinBox")?.value || "";
    let stdinDone = false;
    try {
        py.setStdin({ stdin: () => { if (stdinDone) return null; stdinDone = true; return stdinText; }, autoEOF: false });
    } catch {}

    try {
        await py.loadPackagesFromImports(code);
    } catch (e) {
        appendLine(log, "warn", "package load: " + (e.message || e));
    }

    try {
        const result = await py.runPythonAsync(code);
        if (result !== undefined && result !== null) appendLine(log, "log", "← " + String(result));
    } catch (e) {
        const msg = String(e?.message || e);
        for (const line of msg.split("\n")) appendLine(log, "error", line);
    }
    const doneLine = document.createElement("div");
    doneLine.className = "ol ol-meta";
    doneLine.textContent = `■  done in ${(performance.now() - t0).toFixed(0)}ms`;
    log.appendChild(doneLine);
    log.scrollTop = log.scrollHeight;
}

async function runRemote(code, lang, log, extraFiles) {
    if (!REMOTE_LANGS.has(lang)) {
        appendLine(log, "info", `run is not built-in for ${lang} yet.`);
        return;
    }
    const stdin = document.getElementById("stdinBox")?.value || "";
    const files = (extraFiles || []).filter(f => f && f.name).map(f => ({ name: f.name, content: String(f.content || "") }));
    const startLine = document.createElement("div");
    startLine.className = "ol ol-meta";
    const extra = files.length ? ` (+${files.length} file${files.length === 1 ? "" : "s"})` : "";
    startLine.textContent = `▸  ${lang} · compiling and running${extra} · ${new Date().toLocaleTimeString()}`;
    log.appendChild(startLine);
    const t0 = performance.now();
    try {
        const r = await fetch("/api/code/run", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ language: lang, code, stdin, files })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            appendLine(log, "error", data.error || `HTTP ${r.status}`);
            return;
        }
        if (data.compileStderr) appendLine(log, "error", data.compileStderr.trimEnd());
        if (data.stdout) {
            for (const line of data.stdout.split("\n")) appendLine(log, "log", line);
        }
        if (data.stderr) {
            for (const line of data.stderr.split("\n")) appendLine(log, "error", line);
        }
        if (!data.stdout && !data.stderr && !data.compileStderr) appendLine(log, "info", "(no output)");
        const tag = data.version ? ` (${data.language || lang} ${data.version})` : "";
        const status = data.ok ? "exit 0" : (data.signal ? `signal ${data.signal}` : `exit ${data.exitCode}`);
        const doneLine = document.createElement("div");
        doneLine.className = "ol ol-meta";
        doneLine.textContent = `■  ${status}${tag} · ${(performance.now() - t0).toFixed(0)}ms`;
        log.appendChild(doneLine);
    } catch (e) {
        appendLine(log, "error", "Run failed: " + (e.message || e));
    }
    log.scrollTop = log.scrollHeight;
}

const JS_RUNNER_HTML = `<!doctype html><html><head><meta charset="utf-8"></head><body><script>
(function(){
  var FILES = __FILES__, ENTRY = __ENTRY__;
  function post(kind, text){ try{ parent.postMessage({__nocRun:1, kind:kind, text:String(text)}, "*"); }catch(e){} }
  function fmt(v){ try{ if(typeof v==="string") return v; if(v===null) return "null"; if(v===undefined) return "undefined"; if(typeof v==="function") return String(v).split("\\n")[0]; if(typeof v==="object") return JSON.stringify(v, null, 2); return String(v);}catch(e){ try{return String(v);}catch(_){ return "[unprintable]";}} }
  function emit(kind){ return function(){ post(kind, Array.prototype.slice.call(arguments).map(fmt).join(" ")); }; }
  console.log=emit("log"); console.info=emit("info"); console.warn=emit("warn"); console.error=emit("error"); console.debug=emit("log");
  function stripNl(s){ var t=String(s); if(t.charCodeAt(t.length-1)===10) t=t.slice(0,-1); return t; }
  var process={ argv:["node", ENTRY], env:{}, platform:"browser", arch:"wasm", version:"v18.0.0", versions:{node:"18.0.0"}, browser:true, cwd:function(){return "/";}, chdir:function(){}, nextTick:function(f){ var a=Array.prototype.slice.call(arguments,1); Promise.resolve().then(function(){ f.apply(null,a); }); }, exit:function(){}, on:function(){}, once:function(){}, off:function(){}, emit:function(){}, hrtime:function(){ return [0,0]; }, stdout:{ write:function(s){ post("log", stripNl(s)); return true; } }, stderr:{ write:function(s){ post("error", stripNl(s)); return true; } } };
  try{ self.process=process; }catch(e){}
  window.onerror=function(m,s,l,c,err){ post("error", (err&&err.stack)?String(err.stack):String(m)); return true; };
  window.addEventListener("unhandledrejection", function(e){ post("error", "Unhandled promise rejection: "+fmt(e&&e.reason)); });
  function dir(p){ var i=p.lastIndexOf("/"); return i<0?"":p.slice(0,i+1); }
  function norm(p){ var a=p.split("/"), o=[]; for(var i=0;i<a.length;i++){ var s=a[i]; if(s==="."||s==="") continue; if(s===".."){ o.pop(); } else o.push(s);} return o.join("/"); }
  function resolve(spec, from){
    var cands;
    if(spec.charAt(0)==="."){ var p=norm(dir(from)+spec); cands=[p,p+".js",p+".cjs",p+".mjs",p+".json",p+"/index.js",p+"/index.cjs"]; }
    else { cands=[spec,spec+".js",spec+".cjs",spec+".mjs",spec+".json",spec+"/index.js"]; }
    for(var i=0;i<cands.length;i++){ var c=norm(cands[i]); if(FILES[c]!=null) return c; }
    var keys=Object.keys(FILES);
    for(var j=0;j<keys.length;j++) for(var k=0;k<cands.length;k++){ if(keys[j].toLowerCase()===norm(cands[k]).toLowerCase()) return keys[j]; }
    return null;
  }
  // Shims for the common PURE-JS Node built-ins so real Node code + test files
  // run in the sandbox. (I/O built-ins like fs/http/net stay unavailable.)
  function AssertionError(msg){ this.name="AssertionError"; this.message=msg||"assertion failed"; }
  AssertionError.prototype=Object.create(Error.prototype);
  function deepEq(a,b){ try{ return JSON.stringify(a)===JSON.stringify(b); }catch(e){ return a===b; } }
  function assert(v,msg){ if(!v) throw new AssertionError(msg||"Expected value to be truthy"); }
  assert.ok=assert;
  assert.equal=function(a,b,m){ if(a!=b) throw new AssertionError(m||(fmt(a)+" != "+fmt(b))); };
  assert.notEqual=function(a,b,m){ if(a==b) throw new AssertionError(m||"values are equal"); };
  assert.strictEqual=function(a,b,m){ if(a!==b) throw new AssertionError(m||(fmt(a)+" !== "+fmt(b))); };
  assert.notStrictEqual=function(a,b,m){ if(a===b) throw new AssertionError(m||"values are strictly equal"); };
  assert.deepEqual=function(a,b,m){ if(!deepEq(a,b)) throw new AssertionError(m||"not deep equal"); };
  assert.deepStrictEqual=assert.deepEqual;
  assert.notDeepStrictEqual=function(a,b,m){ if(deepEq(a,b)) throw new AssertionError(m||"unexpectedly deep equal"); };
  assert.throws=function(fn,m){ var th=false; try{ fn(); }catch(e){ th=true; } if(!th) throw new AssertionError(m||"expected to throw"); };
  assert.doesNotThrow=function(fn){ fn(); };
  assert.fail=function(m){ throw new AssertionError(m||"failed"); };
  assert.AssertionError=AssertionError;
  function EventEmitter(){ this._ev={}; }
  EventEmitter.prototype.on=function(n,f){ (this._ev[n]=this._ev[n]||[]).push(f); return this; };
  EventEmitter.prototype.addListener=EventEmitter.prototype.on;
  EventEmitter.prototype.once=function(n,f){ var s=this; function g(){ s.removeListener(n,g); f.apply(null,arguments); } return this.on(n,g); };
  EventEmitter.prototype.removeListener=function(n,f){ if(this._ev[n]) this._ev[n]=this._ev[n].filter(function(x){return x!==f;}); return this; };
  EventEmitter.prototype.off=EventEmitter.prototype.removeListener;
  EventEmitter.prototype.removeAllListeners=function(n){ if(n) delete this._ev[n]; else this._ev={}; return this; };
  EventEmitter.prototype.emit=function(n){ var a=Array.prototype.slice.call(arguments,1), ls=this._ev[n]||[]; ls.slice().forEach(function(f){ f.apply(null,a); }); return ls.length>0; };
  EventEmitter.EventEmitter=EventEmitter;
  var utilMod={ inspect:function(v){ return fmt(v); }, format:function(){ return Array.prototype.slice.call(arguments).map(fmt).join(" "); }, inherits:function(c,p){ c.super_=p; c.prototype=Object.create(p.prototype); c.prototype.constructor=c; }, promisify:function(fn){ return function(){ var s=this, a=Array.prototype.slice.call(arguments); return new Promise(function(res,rej){ a.push(function(e,r){ return e?rej(e):res(r); }); fn.apply(s,a); }); }; }, types:{} };
  var pathMod={ sep:"/", delimiter:":",
    basename:function(p,ext){ var b=String(p).split("/").pop(); if(ext&&b.length>=ext.length&&b.slice(b.length-ext.length)===ext) b=b.slice(0,b.length-ext.length); return b; },
    dirname:function(p){ var s=String(p), i=s.replace(/[/]+$/,"").lastIndexOf("/"); return i<0?".":(i===0?"/":s.slice(0,i)); },
    extname:function(p){ var b=String(p).split("/").pop(), i=b.lastIndexOf("."); return i>0?b.slice(i):""; },
    join:function(){ return norm(Array.prototype.slice.call(arguments).join("/")); },
    resolve:function(){ return "/"+norm(Array.prototype.slice.call(arguments).join("/")); },
    normalize:function(p){ return norm(String(p)); } };
  var BUILTINS={ assert:assert, "node:assert":assert, "assert/strict":assert, events:EventEmitter, "node:events":EventEmitter, util:utilMod, "node:util":utilMod, path:pathMod, "node:path":pathMod, "path/posix":pathMod, process:process, "node:process":process, os:{ EOL:"\\n", platform:function(){return "browser";}, type:function(){return "Browser";}, arch:function(){return "wasm";}, homedir:function(){return "/";}, tmpdir:function(){return "/tmp";}, cpus:function(){return [];} } };
  var cache={};
  function makeReq(from){ return function(spec){
    var key=resolve(spec, from);
    if(key==null){ if(Object.prototype.hasOwnProperty.call(BUILTINS, spec)) return BUILTINS[spec]; throw new Error("Cannot find module '"+spec+"'. npm packages and I/O built-ins (fs, http, net, crypto, ...) aren't available in the in-browser sandbox."); }
    if(cache[key]) return cache[key].exports;
    var mod={exports:{}}; cache[key]=mod;
    if(/\\.json$/i.test(key)){ mod.exports=JSON.parse(FILES[key]||"null"); return mod.exports; }
    var fn=new Function("module","exports","require","__filename","__dirname", (FILES[key]||"")+"\\n//# sourceURL="+key);
    fn(mod, mod.exports, makeReq(key), key, dir(key));
    return mod.exports;
  }; }
  var t0=(self.performance&&performance.now)?performance.now():Date.now();
  try{ makeReq("")(ENTRY.charAt(0)==="."?ENTRY:("./"+ENTRY)); }
  catch(err){ post("error", (err&&err.stack)?String(err.stack):(err&&err.name?err.name+": "+err.message:String(err))); }
  setTimeout(function(){ var ms=((self.performance&&performance.now)?performance.now():Date.now())-t0; post("__done", String(Math.round(ms))); }, 40);
})();
<\/script></body></html>`;

function buildJsRunnerDoc(fileMap, entry) {
    const filesJson = JSON.stringify(fileMap).replace(/<\/script/gi, "<\\/script");
    const entryJson = JSON.stringify(entry);
    return JS_RUNNER_HTML.replace("__ENTRY__", () => entryJson).replace("__FILES__", () => filesJson);
}

let _jsRunFrame = null, _jsRunHandler = null;
function runJsProject(files, entry, log, opts = {}) {
    if (_jsRunHandler) { window.removeEventListener("message", _jsRunHandler); _jsRunHandler = null; }
    if (_jsRunFrame && _jsRunFrame.parentNode) { try { _jsRunFrame.remove(); } catch {} }

    const fileMap = {};
    for (const f of files) if (f && f.name) fileMap[f.name] = String(f.content == null ? "" : f.content);

    const startLine = document.createElement("div");
    startLine.className = "ol ol-meta";
    startLine.textContent = "▸  run · " + entry + " · " + new Date().toLocaleTimeString();
    log.appendChild(startLine);

    const frame = document.createElement("iframe");
    frame.setAttribute("sandbox", "allow-scripts");
    frame.style.cssText = "position:absolute;width:0;height:0;border:0;opacity:0;pointer-events:none";
    const t0 = performance.now();
    let hadOutput = false, done = false;

    const finish = () => {
        if (done) return; done = true;
        if (!hadOutput) appendLine(log, "info", "(no output)");
        const d = document.createElement("div");
        d.className = "ol ol-meta";
        d.textContent = "■  done in " + (performance.now() - t0).toFixed(0) + "ms";
        log.appendChild(d); log.scrollTop = log.scrollHeight;
        window.removeEventListener("message", handler);
        if (_jsRunHandler === handler) _jsRunHandler = null;
        try { opts.onDone && opts.onDone(hadOutput); } catch {}
        setTimeout(() => { try { frame.remove(); } catch {} }, 4000);
    };
    const handler = (e) => {
        if (!e.data || !e.data.__nocRun) return;
        if (frame.contentWindow && e.source !== frame.contentWindow) return;
        if (e.data.kind === "__done") return finish();
        hadOutput = true;
        appendLine(log, e.data.kind || "log", e.data.text == null ? "" : String(e.data.text));
        log.scrollTop = log.scrollHeight;
    };
    _jsRunHandler = handler;
    window.addEventListener("message", handler);
    _jsRunFrame = frame;
    frame.srcdoc = buildJsRunnerDoc(fileMap, entry);
    log.appendChild(frame);
    setTimeout(() => { if (!done) appendLine(log, "meta", "… still running (close the output panel to stop)"); }, 12000);
}

const STANDALONE_SHELL_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Nocturne · Run</title>
<style>
  html,body{margin:0;height:100%;background:#05060d;color:#e8e5f4;font-family:'JetBrains Mono',Menlo,Consolas,monospace}
  #bar{display:flex;align-items:center;gap:8px;padding:9px 16px;background:#0c0d18;border-bottom:1px solid #1a1b2b;font-size:12.5px;color:#a9a3c7}
  #bar .dot{width:8px;height:8px;border-radius:50%;background:#8ad6a0;box-shadow:0 0 8px #8ad6a0;flex:none}
  #bar b{color:#c9c1ff}
  #wrap{display:flex;flex-direction:column;height:calc(100% - 39px)}
  #app{flex:1 1 62%;border:0;width:100%;background:#0a0b14;min-height:0}
  #con{flex:0 0 38%;overflow:auto;padding:10px 16px;background:#05060d;border-top:1px solid #1a1b2b;font-size:12.5px;line-height:1.55;white-space:pre-wrap;word-break:break-word}
  #con:empty::before{content:"console output appears here…";color:#3f3c5a}
  .l{padding:1px 0}.e{color:#e07cb8}.w{color:#e0c17c}.i{color:#7cc8e0}.m{color:#706b8f;font-style:italic}
</style></head>
<body>
  <div id="bar"><span class="dot"></span>Running&nbsp;<b id="ent"></b>&nbsp;<span style="color:#3f3c5a">· Nocturne sandbox</span></div>
  <div id="wrap">
    <iframe id="app" sandbox="allow-scripts allow-forms allow-modals allow-popups" title="run"></iframe>
    <div id="con"></div>
  </div>
  <script>
    var ENTRY = __ENTRY__;
    try{ document.getElementById('ent').textContent = ENTRY; document.title = "Run · " + ENTRY; }catch(e){}
    var con = document.getElementById('con'), app = document.getElementById('app');
    function line(cls, t){ var d=document.createElement('div'); d.className='l '+cls; d.textContent=t; con.appendChild(d); con.scrollTop=con.scrollHeight; }
    window.addEventListener('message', function(e){
      if(!e.data || !e.data.__nocRun) return;
      if(app.contentWindow && e.source!==app.contentWindow) return;
      if(e.data.kind==='__done'){ line('m','■ finished in '+e.data.text+'ms'); return; }
      var k = e.data.kind==='error'?'e':(e.data.kind==='warn'?'w':(e.data.kind==='info'?'i':''));
      line(k, e.data.text);
    });
    app.srcdoc = __RUNNER__;
  <\/script>
</body></html>`;

function buildStandaloneRunnerDoc(fileMap, entry) {
    const runner = buildJsRunnerDoc(fileMap, entry);
    const runnerJson = JSON.stringify(runner).replace(/<\/script/gi, "<\\/script");
    const entryJson = JSON.stringify(entry).replace(/<\/script/gi, "<\\/script");
    return STANDALONE_SHELL_HTML.replace("__ENTRY__", () => entryJson).replace("__RUNNER__", () => runnerJson);
}
function runInNewTab(files, entry) {
    const fileMap = {};
    for (const f of files) if (f && f.name) fileMap[f.name] = String(f.content == null ? "" : f.content);
    const doc = buildStandaloneRunnerDoc(fileMap, entry);
    const url = URL.createObjectURL(new Blob([doc], { type: "text/html;charset=utf-8" }));
    const win = window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    return win;
}

const STANDALONE_SITE_SHELL = `<!doctype html><html><head><meta charset="utf-8"><title>Nocturne · Preview</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src blob: data:; style-src 'unsafe-inline'; img-src data:">
<style>html,body{margin:0;height:100%;background:#05060d}#f{border:0;display:block;width:100%;height:100%}</style>
</head><body><iframe id="f" sandbox="allow-scripts allow-forms allow-modals allow-popups allow-pointer-lock" title="preview"></iframe>
<script>document.getElementById('f').srcdoc=__DOC__;<\/script></body></html>`;
function buildStandaloneSiteDoc(html) {
    const docJson = JSON.stringify(String(html)).replace(/<\/script/gi, "<\\/script");
    return STANDALONE_SITE_SHELL.replace("__DOC__", () => docJson);
}

const _runPlanCache = new Map();
function fileSetKey(files) { return files.map(f => f.name + ":" + ((f.content || "").length)).sort().join("|"); }

function resolveJsEntry(files, activeName) {
    const isJs = n => /\.(m?js|cjs|ts)$/i.test(n);
    const js = files.filter(f => isJs(f.name));
    const byName = n => files.find(f => f.name.toLowerCase() === String(n || "").toLowerCase());
    const pkg = files.find(f => /(^|\/)package\.json$/i.test(f.name));
    let pkgStart = null, pkgMain = null;
    if (pkg) {
        try {
            const p = JSON.parse(pkg.content || "{}");
            if (p.scripts && typeof p.scripts.start === "string") { const m = /([\w./-]+\.[cm]?js)\b/.exec(p.scripts.start); if (m) pkgStart = m[1].replace(/^\.\//, ""); }
            if (typeof p.main === "string") pkgMain = p.main.replace(/^\.\//, "");
        } catch {}
    }

    if (pkgStart) { const f = byName(pkgStart); if (f) return f; }

    const active = byName(activeName);
    const printingSibling = (exclude) => js.find(f => f.name !== exclude && /(test|spec|example|demo|index|main|run|cli|start|app)/i.test(f.name) && !looksLikeLibrary(f));
    const anyPrinting = (exclude) => js.find(f => f.name !== exclude && !looksLikeLibrary(f));

    if (active && isJs(active.name)) {
        if (!looksLikeLibrary(active)) return active;
        return printingSibling(active.name) || anyPrinting(active.name) || active;
    }

    const common = files.find(f => /(^|\/)(index|main|app)\.(m?js|cjs|ts)$/i.test(f.name));
    if (common && !looksLikeLibrary(common)) return common;
    const printing = anyPrinting(null);
    if (printing) return printing;

    if (pkgMain) { const f = byName(pkgMain); if (f) return f; }
    return common || js[0] || files[0];
}
function looksLikeLibrary(file) {
    const c = (file && file.content) || "";
    if (!c.trim()) return false;
    const exportsSomething = /\bmodule\.exports\b|\bexports\.\w+\s*=|^\s*export\s+(default|const|let|var|function|class|\{|async)/m.test(c);
    const printsOrRuns = /\bconsole\.(log|error|warn|info)\s*\(|\bprocess\.stdout\b|\bdocument\b|\balert\s*\(/.test(c);
    return exportsSomething && !printsOrRuns;
}

async function aiComplete(messages, model) {
    const res = await fetch("/api/ai/chat", {
        method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, temperature: 0.2, max_completion_tokens: 1000, level: "off" })
    });
    if (!res.ok) { const e = new Error("HTTP " + res.status); if (res.status === 401 || res.status === 402) e.needsAuth = true; throw e; }
    const reader = res.body.getReader(); const dec = new TextDecoder(); let buf = "", acc = "";
    while (true) {
        const { value, done } = await reader.read(); if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n"); buf = lines.pop() || "";
        for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            const p = line.slice(6); if (p === "[DONE]") continue;
            try { const ev = JSON.parse(p); if (ev.type === "delta" && ev.text) acc += ev.text; else if (ev.type === "error") throw new Error(ev.error || "stream error"); }
            catch (e) { if (!(e instanceof SyntaxError)) throw e; }
        }
    }
    return acc.trim();
}
async function aiFindHowToRun(files) {
    const manifest = files
        .filter(f => /\.(m?js|cjs|ts|json|py|md|txt)$/i.test(f.name))
        .map(f => {

            const c = f.content || "";
            const body = c.length > 1800 ? c.slice(0, 1200) + "\n… (" + (c.length - 1700) + " chars omitted) …\n" + c.slice(-500) : c;
            return `--- ${f.name} ---\n${body}`;
        }).join("\n\n").slice(0, 15000);
    const sys = `You work out how to run a code project so it produces visible output. Reply with ONLY a JSON object, no prose, no code fences:
{"entry":"<the .js file to run>","runner":{"name":"run.js","content":"<a SHORT CommonJS script that require()s the project's main module and console.logs a small real example of its output>"}|null,"note":"<one short sentence>"}
Rules: If the main file is a LIBRARY (exports things but prints nothing), set "runner" to a minimal script that does const x = require('./<mainfile>.js') and console.logs an example result. If a file already prints output, set "runner" to null and "entry" to that file. The runner must be plain CommonJS (require/module.exports), under 20 lines, no npm packages.`;

    const model = "navy:gpt-5.4-mini";
    let text;
    try { text = await aiComplete([{ role: "system", content: sys }, { role: "user", content: "Project files:\n\n" + manifest }], model); }
    catch (e) { if (e.needsAuth) return { needsAuth: true }; return { error: "AI error: " + (e.message || e) }; }
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return { error: "The AI didn't return a run plan." };
    try { const p = JSON.parse(m[0]); return { entry: p.entry, runner: p.runner, note: p.note }; }
    catch { return { error: "Couldn't parse the AI run plan." }; }
}

function runJS(code, log) {
    return runJsProject([{ name: "main.js", content: code }], "main.js", log);
}

function _legacyRunJS(code, log) {
    const startLine = document.createElement("div");
    startLine.className = "ol ol-meta";
    startLine.textContent = `\u25B8  run · ${new Date().toLocaleTimeString()}`;
    log.appendChild(startLine);

    const origLog  = console.log;
    const origErr  = console.error;
    const origWarn = console.warn;
    const origInfo = console.info;

    const capture = (kind) => (...args) => {
        const line = args.map(formatValue).join(" ");
        appendLine(log, kind, line);
    };

    console.log  = capture("log");
    console.error = capture("error");
    console.warn = capture("warn");
    console.info = capture("info");

    const t0 = performance.now();
    try {
        const result = undefined;
        if (result !== undefined) appendLine(log, "log", "\u2190  " + formatValue(result));
    } catch (e) {
        appendLine(log, "error", e.name + ": " + e.message);
    } finally {
        console.log = origLog;
        console.error = origErr;
        console.warn = origWarn;
        console.info = origInfo;

        const doneLine = document.createElement("div");
        doneLine.className = "ol ol-meta";
        doneLine.textContent = `\u25A0  done in ${(performance.now() - t0).toFixed(1)}ms`;
        log.appendChild(doneLine);
        log.scrollTop = log.scrollHeight;
    }
}

function runIframe(htmlDoc, log) {
    log.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.className = "ol-iframe";
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups");
    frame.srcdoc = htmlDoc;
    log.appendChild(frame);
}

function _siteBaseName(href) {
    return String(href || "").split("#")[0].split("?")[0].replace(/^\.?\//, "").split("/").pop().toLowerCase();
}

function findHtmlThatUses(name, files) {
    const base = _siteBaseName(name);
    if (!base) return null;
    const esc = base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const inlineRe = new RegExp("[\"'(/]" + esc + "[\"')]");
    for (const h of files.filter(f => /\.html?$/i.test(f.name))) {
        const content = h.content || "";
        let doc;
        try { doc = new DOMParser().parseFromString(content, "text/html"); } catch { doc = null; }
        if (doc) {
            const refs = [];
            doc.querySelectorAll("link[href]").forEach(el => refs.push(_siteBaseName(el.getAttribute("href"))));
            doc.querySelectorAll("[src]").forEach(el => refs.push(_siteBaseName(el.getAttribute("src"))));
            if (refs.includes(base)) return h;
        }
        if (inlineRe.test(content)) return h;
    }
    return null;
}

function buildCssPreview(css) {
    const safe = String(css || "").replace(/<\/style/gi, "<\\/style");
    return `<!doctype html><html><head><meta charset="utf-8">
<style>body{margin:0;font-family:system-ui,-apple-system,sans-serif;color:#111;background:#fff}.noc-demo{max-width:840px;margin:0 auto;padding:28px}.noc-note{font:12px/1.5 ui-monospace,monospace;color:#777;background:#f5f5f7;border:1px dashed #ccc;border-radius:8px;padding:9px 13px;margin-bottom:20px}</style>
<style>${safe}</style></head>
<body><div class="noc-demo">
<div class="noc-note">No HTML file found — previewing your CSS on sample content. Add an .html file to preview your real page.</div>
<h1>Heading 1</h1><h2>Heading 2</h2><h3>Heading 3</h3>
<p>A paragraph with a <a href="#">link</a>, <strong>bold</strong> and <em>italic</em> text.</p>
<p><button>Button</button> <button class="btn">.btn</button> <input placeholder="Input field"></p>
<ul><li>List item one</li><li>List item two</li><li>List item three</li></ul>
<blockquote>A blockquote element.</blockquote>
<div class="card"><h3>Card title</h3><p>A <code>.card</code> element with text inside.</p></div>
<table><thead><tr><th>Name</th><th>Value</th></tr></thead><tbody><tr><td>Alpha</td><td>1</td></tr><tr><td>Beta</td><td>2</td></tr></tbody></table>
</div></body></html>`;
}

function resolvePythonEntry(activeName, files) {
    const active = files.find(f => f.name === activeName);
    if (!active || !/\.pyw?$/i.test(active.name) || !pyLooksLikeLibrary(active.content)) return activeName;
    const mod = active.name.replace(/.*\//, "").replace(/\.pyw?$/i, "");
    const importsIt = new RegExp("(^|\\n)\\s*(import\\s+" + mod + "\\b|from\\s+" + mod + "\\s+import)");
    const py = files.filter(f => /\.pyw?$/i.test(f.name) && f.name !== active.name);
    const runner = py.find(f => importsIt.test(f.content || "") && !pyLooksLikeLibrary(f.content));
    if (runner) return runner.name;
    const main = py.find(f => /(^|\/)(main|app|__main__|run)\.pyw?$/i.test(f.name) && !pyLooksLikeLibrary(f.content));
    return main ? main.name : activeName;
}
function pyLooksLikeLibrary(content) {
    const c = content || "";
    if (!c.trim()) return false;
    const lines = c.split("\n");
    if (!lines.some(l => /^\s*(def |class )/.test(l))) return false;
    const runsAtTop = lines.some(l => {
        if (!/^\S/.test(l) || /^\s*$/.test(l)) return false;
        if (/^(def |class |import |from |@|#)/.test(l)) return false;
        if (/^if __name__/.test(l)) return true;
        if (/^print\s*\(/.test(l)) return true;
        if (/^[A-Za-z_][\w.]*\s*\(/.test(l)) return true;
        return false;
    });
    return !runsAtTop;
}

function buildSitePage(entryName, files, forPreview) {
    const byBase = {};
    for (const f of files) byBase[String(f.name).toLowerCase()] = f;
    const entry = byBase[String(entryName).toLowerCase()] || files.find(f => /\.html?$/i.test(f.name));
    if (!entry) return null;

    let doc;
    try { doc = new DOMParser().parseFromString(entry.content || "", "text/html"); }
    catch { return entry.content || ""; }

    doc.querySelectorAll('link[rel~="stylesheet"][href]').forEach(link => {
        const f = byBase[_siteBaseName(link.getAttribute("href"))];
        if (f && /\.css$/i.test(f.name)) {
            const style = doc.createElement("style");
            style.textContent = f.content || "";
            link.replaceWith(style);
        }
    });
    doc.querySelectorAll("script[src]").forEach(s => {
        const f = byBase[_siteBaseName(s.getAttribute("src"))];
        if (f && /\.(m?js)$/i.test(f.name)) {
            const ns = doc.createElement("script");
            for (const a of s.attributes) if (a.name.toLowerCase() !== "src") ns.setAttribute(a.name, a.value);
            ns.textContent = f.content || "";
            s.replaceWith(ns);
        }
    });
    doc.querySelectorAll("img[src], source[src], audio[src], video[src]").forEach(el => {
        const f = byBase[_siteBaseName(el.getAttribute("src"))];
        if (f && /^data:/i.test((f.content || "").trim())) el.setAttribute("src", (f.content || "").trim());
    });

    if (forPreview) {
        const pages = files.filter(f => /\.html?$/i.test(f.name)).map(f => f.name);
        const nav = doc.createElement("script");
        nav.textContent = SITE_NAV_JS.replace("__PAGES__", JSON.stringify(pages));
        (doc.body || doc.documentElement).appendChild(nav);
    }
    return "<!DOCTYPE html>\n" + doc.documentElement.outerHTML;
}

const SITE_NAV_JS = `(function(){
  var PAGES = (__PAGES__).map(function(p){return String(p).toLowerCase();});
  function base(h){ return String(h||"").split("#")[0].split("?")[0].replace(/^\\.?\\//,"").split("/").pop().toLowerCase(); }
  document.addEventListener("click", function(e){
    var t = e.target;
    while (t && t.tagName !== "A") t = t.parentElement;
    if (!t) return;
    var href = t.getAttribute("href") || "";
    if (/^(https?:|mailto:|tel:|data:|javascript:|#)/i.test(href)) return;
    var name = base(href);
    if (PAGES.indexOf(name) === -1) return;
    e.preventDefault();
    try { parent.postMessage({ __nocSiteNav: name }, "*"); } catch (err) {}
  }, true);
})();`;

let _siteNavHandler = null;
function runWebProject(entryName, files, log) {
    log.innerHTML = "";
    const frame = document.createElement("iframe");
    frame.className = "ol-iframe";
    frame.setAttribute("sandbox", "allow-scripts allow-forms allow-modals allow-popups");
    log.appendChild(frame);

    const render = (name) => {
        const target = files.find(f => f.name.toLowerCase() === String(name).toLowerCase() && /\.html?$/i.test(f.name));
        const html = buildSitePage(target ? target.name : entryName, files, true);
        frame.srcdoc = html || "<!doctype html><meta charset=utf-8><body style='font-family:sans-serif;color:#888;padding:24px'>Nothing to preview.</body>";
    };

    if (_siteNavHandler) window.removeEventListener("message", _siteNavHandler);
    _siteNavHandler = (e) => {
        if (!e.data || e.data.__nocSiteNav == null) return;
        if (frame.contentWindow && e.source && e.source !== frame.contentWindow) return;
        render(e.data.__nocSiteNav);
    };
    window.addEventListener("message", _siteNavHandler);
    render(entryName);
}

function runJSON(code, log) {
    try {
        const parsed = JSON.parse(code);
        const pretty = JSON.stringify(parsed, null, 2);
        const pre = document.createElement("pre");
        pre.className = "ol ol-json";
        pre.textContent = pretty;
        log.appendChild(pre);
        appendLine(log, "meta", `\u25A0  parsed · ${pretty.length} chars`);
    } catch (e) {
        appendLine(log, "error", e.message);
    }
}

function renderMarkdown(src) {
    const esc = (s) => s.replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    let html = src;

    const codeBlocks = [];
    html = html.replace(/```(\w*)\n([\s\S]*?)```/g, (m, lang, code) => {
        const i = codeBlocks.push(`<pre><code>${esc(code)}</code></pre>`) - 1;
        return `\x00CODE${i}\x00`;
    });

    html = esc(html);

    html = html.replace(/^######\s+(.*)$/gm, "<h6>$1</h6>");
    html = html.replace(/^#####\s+(.*)$/gm, "<h5>$1</h5>");
    html = html.replace(/^####\s+(.*)$/gm, "<h4>$1</h4>");
    html = html.replace(/^###\s+(.*)$/gm, "<h3>$1</h3>");
    html = html.replace(/^##\s+(.*)$/gm, "<h2>$1</h2>");
    html = html.replace(/^#\s+(.*)$/gm, "<h1>$1</h1>");

    html = html.replace(/^---+$/gm, "<hr>");
    html = html.replace(/^&gt;\s?(.*)$/gm, "<blockquote>$1</blockquote>");

    const mdUrl = (u, img) => {
        const s = String(u || "");
        const probe = s.replace(/[\x00-\x20]+/g, "").toLowerCase();
        const m = /^([a-z][a-z0-9+.-]*):/.exec(probe);
        if (m) {
            const sc = m[1];
            const ok = img
                ? sc === "http" || sc === "https" || (sc === "data" && /^data:image\//.test(probe))
                : sc === "http" || sc === "https" || sc === "mailto";
            if (!ok) return "#";
        }
        return s;
    };
    html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (m, a, u) => `<img alt="${a}" src="${mdUrl(u, true)}">`);
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, t, u) => `<a href="${mdUrl(u, false)}" target="_blank" rel="noopener">${t}</a>`);

    html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    html = html.replace(/\*([^*]+)\*/g, "<em>$1</em>");
    html = html.replace(/`([^`]+)`/g, "<code>$1</code>");

    html = html.replace(/(^- .+(?:\n- .+)*)/gm, m => {
        const items = m.split("\n").map(l => l.replace(/^- /, "<li>") + "</li>").join("");
        return "<ul>" + items + "</ul>";
    });
    html = html.replace(/(^\d+\. .+(?:\n\d+\. .+)*)/gm, m => {
        const items = m.split("\n").map(l => l.replace(/^\d+\. /, "<li>") + "</li>").join("");
        return "<ol>" + items + "</ol>";
    });

    html = html.split(/\n{2,}/).map(p => {
        if (/^<(h[1-6]|ul|ol|blockquote|pre|hr|table)/.test(p.trim())) return p;
        if (/^\x00CODE\d+\x00$/.test(p.trim())) return p;
        return "<p>" + p.replace(/\n/g, "<br>") + "</p>";
    }).join("\n");

    html = html.replace(/\x00CODE(\d+)\x00/g, (_, i) => codeBlocks[i]);

    return html;
}

function formatValue(v) {
    if (v === null) return "null";
    if (v === undefined) return "undefined";
    if (typeof v === "string") return v;
    if (typeof v === "function") return v.toString().split("\n")[0];
    try { return JSON.stringify(v, null, 2); }
    catch { return String(v); }
}

const ANSI_NORMAL = ["#3b3a4a", "#e07cb8", "#8fd6a0", "#e0c17c", "#7c9fe0", "#c9a0e0", "#7cd2e0", "#d7d4e8"];
const ANSI_BRIGHT = ["#6b6885", "#f0a0cf", "#b0e8c0", "#f0d8a0", "#a0c0f0", "#dcc0f0", "#b0e8f0", "#ffffff"];

function ansiColor256(n) {
    if (n < 8) return ANSI_NORMAL[n];
    if (n < 16) return ANSI_BRIGHT[n - 8];
    if (n <= 231) {
        n -= 16;
        const f = v => (v ? 55 + v * 40 : 0);
        return `rgb(${f(Math.floor(n / 36))},${f(Math.floor((n % 36) / 6))},${f(n % 6)})`;
    }
    const v = 8 + (n - 232) * 10;
    return `rgb(${v},${v},${v})`;
}

function ansiApply(state, codeStr) {
    const codes = codeStr === "" ? [0] : codeStr.split(";").map(n => parseInt(n, 10) || 0);
    for (let i = 0; i < codes.length; i++) {
        const c = codes[i];
        if (c === 0) { state.fg = state.bg = null; state.bold = state.dim = state.italic = state.underline = false; }
        else if (c === 1) state.bold = true;
        else if (c === 2) state.dim = true;
        else if (c === 3) state.italic = true;
        else if (c === 4) state.underline = true;
        else if (c === 22) { state.bold = false; state.dim = false; }
        else if (c === 23) state.italic = false;
        else if (c === 24) state.underline = false;
        else if (c >= 30 && c <= 37) state.fg = ANSI_NORMAL[c - 30];
        else if (c === 39) state.fg = null;
        else if (c >= 90 && c <= 97) state.fg = ANSI_BRIGHT[c - 90];
        else if (c >= 40 && c <= 47) state.bg = ANSI_NORMAL[c - 40];
        else if (c === 49) state.bg = null;
        else if (c >= 100 && c <= 107) state.bg = ANSI_BRIGHT[c - 100];
        else if (c === 38 || c === 48) {
            const mode = codes[i + 1];
            let col = null;
            if (mode === 5) { col = ansiColor256(codes[i + 2] || 0); i += 2; }
            else if (mode === 2) { col = `rgb(${codes[i + 2] || 0},${codes[i + 3] || 0},${codes[i + 4] || 0})`; i += 4; }
            if (col) { if (c === 38) state.fg = col; else state.bg = col; }
        }
    }
}

function ansiToHtml(input) {
    if (input.indexOf("\x1b[") === -1) return null;
    const esc = s => s.replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
    const re = /\x1b\[([0-9;]*)m/g;
    const state = { fg: null, bg: null, bold: false, dim: false, italic: false, underline: false };
    let html = "", last = 0, m;
    const seg = (txt) => {
        if (!txt) return;
        let s = "";
        if (state.fg) s += "color:" + state.fg + ";";
        if (state.bg) s += "background:" + state.bg + ";border-radius:2px;";
        if (state.bold) s += "font-weight:600;";
        if (state.dim) s += "opacity:.65;";
        if (state.italic) s += "font-style:italic;";
        if (state.underline) s += "text-decoration:underline;";
        html += s ? `<span style="${s}">${esc(txt)}</span>` : esc(txt);
    };
    while ((m = re.exec(input)) !== null) {
        seg(input.slice(last, m.index));
        last = re.lastIndex;
        ansiApply(state, m[1]);
    }
    seg(input.slice(last));
    return html;
}

function appendLine(log, kind, text) {
    const el = document.createElement("div");
    el.className = "ol ol-" + kind;
    const html = ansiToHtml(String(text));
    if (html === null) el.textContent = text;
    else el.innerHTML = html;
    log.appendChild(el);
    log.scrollTop = log.scrollHeight;
}
