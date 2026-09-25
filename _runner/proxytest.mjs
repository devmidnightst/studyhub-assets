import { db } from "../db.js";
import { __test } from "../runner.js";
const { ensureShared, syncFiles, startApp, stopApp, containerIp, probePort, WS_ROOT, CODER_UID, dexec } = __test;
const TOKEN = "a1b2c3d4e5f6a1b2c3d4e5f6";
const PORT = 20055;
const mode = process.argv[2];
const u = db.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get();
if (!u) { console.log("no users in db"); process.exit(1); }
const container = await ensureShared();
const dir = `${WS_ROOT}/u${u.id}`;
if (mode === "teardown") {
    await stopApp(container, dir).catch(() => {});
    db.prepare("DELETE FROM runner_workspaces WHERE token=?").run(TOKEN);
    await dexec(["exec", "-u", CODER_UID, container, "rm", "-rf", dir]);
    console.log("teardown done");
    process.exit(0);
}
await dexec(["exec", "-u", CODER_UID, container, "mkdir", "-p", `${dir}/.noc`]);
await syncFiles(container, dir, [{ name: "server.js", content: "require('http').createServer((q,s)=>{if(q.url==='/'){s.setHeader('content-type','text/html');s.end('<html><head><title>t</title></head><body><link href=\"/style.css\"><script src=\"/app.js\"></script>PROXY-OK</body></html>')}else{s.end('ASSET '+q.url)}}).listen(process.env.PORT,'0.0.0.0')" }]);
db.prepare("INSERT INTO runner_workspaces (user_id,container,dir,port,token,created_at,last_active) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id) DO UPDATE SET container=excluded.container,dir=excluded.dir,port=excluded.port,token=excluded.token,last_active=excluded.last_active").run(u.id, container, dir, PORT, TOKEN, Date.now(), Date.now());
await startApp(container, dir, PORT, "node server.js");
const ip = await containerIp(container);
let live = false; for (let i = 0; i < 25; i++) { if (await probePort(ip, PORT)) { live = true; break; } await new Promise(r => setTimeout(r, 400)); }
console.log("setup done token=" + TOKEN + " live=" + live);
process.exit(0);
