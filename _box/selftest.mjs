import { WebSocket } from "ws";
import fs from "fs";
const OWNER_PASSWORD = process.env.NOCTURNE_OWNER_PASSWORD || fs.readFileSync(new URL("../data/owner-password", import.meta.url), "utf8").trim();
const base = "http://localhost:8099";
const lr = await fetch(base + "/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username: "midnightsweat", password: OWNER_PASSWORD }) });
const raw = lr.headers.getSetCookie ? lr.headers.getSetCookie().join("; ") : (lr.headers.get("set-cookie") || "");
const sid = /nocturne_sid=([^;]+)/.exec(raw);
const cookie = sid ? "nocturne_sid=" + sid[1] : "";
if (!cookie) { console.log("LOGIN FAILED"); process.exit(1); }
const H = { "Content-Type": "application/json", Cookie: cookie };
const dc = await (await fetch(base + "/api/boxes/admin/datacenter", { headers: { Cookie: cookie } })).json();
console.log("  datacenter: pool=" + JSON.stringify(dc.pool) + " free=" + JSON.stringify(dc.free) + " cpuTemp=" + dc.system.cpuTemp + "C mem=" + dc.system.mem.usedMb + "/" + dc.system.mem.totalMb + "MB");
const cr = await (await fetch(base + "/api/boxes/admin/create", { method: "POST", headers: H, body: JSON.stringify({ username: "midnightsweat", cpus: 0.5, memoryMb: 512, diskMb: 1024, name: "selftest" }) })).json();
const boxId = cr.box && cr.box.id;
console.log("  create box -> " + (boxId ? ("#" + boxId + " " + cr.box.name + " " + cr.box.cpus + "c/" + cr.box.memoryMb + "MB") : JSON.stringify(cr)));
if (!boxId) process.exit(1);
await new Promise(r => setTimeout(r, 1800));
await new Promise((resolve) => {
  const ws = new WebSocket("ws://localhost:8099/api/boxes/term?id=" + boxId, { headers: { Cookie: cookie } });
  let out = "", done = false;
  const finish = (msg) => { if (done) return; done = true; console.log("  terminal -> " + msg); try { ws.close(); } catch {} resolve(); };
  ws.on("open", () => setTimeout(() => ws.send("whoami\n"), 500));
  ws.on("message", d => { out += d.toString(); if (/user@box/.test(out) || /\buser\b/.test(out.replace("whoami",""))) finish("PASS (got prompt+whoami: " + JSON.stringify(out.slice(-40)) + ")"); });
  ws.on("error", e => finish("ws error: " + e.message));
  setTimeout(() => finish("timeout, got: " + JSON.stringify(out.slice(0, 120))), 5000);
});
console.log("  reset  -> " + JSON.stringify(await (await fetch(base + "/api/boxes/admin/reset/" + boxId, { method: "POST", headers: { Cookie: cookie } })).json()));
console.log("  delete -> " + JSON.stringify(await (await fetch(base + "/api/boxes/admin/delete/" + boxId, { method: "POST", headers: { Cookie: cookie } })).json()));
process.exit(0);
