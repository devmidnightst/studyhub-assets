// Standalone test of runner.js docker mechanics — NO index.js wiring, NO runner
// db rows. Exercises the real low-level functions against nocturne-shared with an
// isolated throwaway dir, then cleans up. Run: sg docker -c 'node _runner/selftest.mjs'
import { __test } from "../runner.js";
const { dexec, ensureShared, syncFiles, startApp, stopApp, appAlive, probePort, containerIp, detectStartCommand, WS_ROOT, CODER_UID } = __test;
// (selftest unchanged — see _runner/proxytest.mjs for subdomain routing)

const dir = `${WS_ROOT}/_selftest`;
const port = 20999;
let pass = true;
const ok  = (c, m) => { console.log(`${c ? "PASS" : "FAIL"}: ${m}`); if (!c) pass = false; };

const container = await ensureShared();
console.log("container:", container);

// fresh start
await stopApp(container, dir).catch(() => {});
await dexec(["exec", "-u", CODER_UID, container, "rm", "-rf", dir]);
await dexec(["exec", "-u", CODER_UID, container, "mkdir", "-p", `${dir}/.noc`]);

// 1) file sync (incl. a hyphenated name + a subdir path — the cleanPath fix)
const files = [
    { name: "server.js", content:
`const http = require('http');
const port = process.env.PORT || 3000;
http.createServer((req,res)=>{ res.end('hello from runner test pid '+process.pid); })
    .listen(port, process.env.HOST || '0.0.0.0', ()=>console.log('listening on '+port));
` },
    { name: "lib/my-helper.js", content: "module.exports = 1;\n" },
];
const written = await syncFiles(container, dir, files);
ok(written.includes("server.js") && written.includes("lib/my-helper.js"), `synced files: ${written.join(", ")}`);

const back = await dexec(["exec", "-u", CODER_UID, "-w", dir, container, "cat", "server.js"]);
ok(back.stdout.includes("listening on"), "file content round-trips intact");

// 2) start-command detection
const cmd = detectStartCommand(files);
ok(cmd === "node server.js", `detectStartCommand => ${cmd}`);

// 3) start the app + wait for it to actually listen
await startApp(container, dir, port, cmd);
const ip = await containerIp(container);
let live = false;
for (let i = 0; i < 30; i++) { if (await probePort(ip, port)) { live = true; break; } await new Promise(r => setTimeout(r, 400)); }
ok(live, `app listening on ${ip}:${port}`);
ok(await appAlive(container, dir), "appAlive() reports up");

// 4) reach it from the host over the bridge (this is the live-URL path)
if (live) {
    const body = await fetch(`http://${ip}:${port}/`).then(r => r.text()).catch(e => "ERR:" + e.message);
    ok(body.startsWith("hello from runner test"), `HTTP over bridge: "${body.slice(0, 60)}"`);
}

// 5) stop kills exactly this app
await stopApp(container, dir);
await new Promise(r => setTimeout(r, 600));
ok(!(await appAlive(container, dir)), "appAlive() reports down after stop");
ok(!(await probePort(ip, port)), "port closed after stop");

// cleanup
await dexec(["exec", "-u", CODER_UID, container, "rm", "-rf", dir]);
console.log(pass ? "\n=== ALL MECHANICS PASS ===" : "\n=== SOME CHECKS FAILED ===");
process.exit(pass ? 0 : 1);
