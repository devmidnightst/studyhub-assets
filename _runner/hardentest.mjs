// Verify cleanWorkspace: IDE-deleted files vanish, dep caches survive.
import { __test } from "../runner.js";
const { dexec, ensureShared, syncFiles, cleanWorkspace, CODER_UID, WS_ROOT } = __test;
const c = await ensureShared();
const dir = `${WS_ROOT}/_hardentest`;
let pass = true; const ok = (b, m) => { console.log((b ? "PASS" : "FAIL") + ": " + m); if (!b) pass = false; };

await dexec(["exec", "-u", CODER_UID, c, "rm", "-rf", dir]);
await dexec(["exec", "-u", CODER_UID, c, "mkdir", "-p", `${dir}/.noc`, `${dir}/node_modules/keep`]);
await syncFiles(c, dir, [{ name: "a.js", content: "1" }, { name: "b.js", content: "2" }, { name: "src/c.js", content: "3" }]);
// simulate the run flow: clean, then sync only the surviving file set
await cleanWorkspace(c, dir);
await syncFiles(c, dir, [{ name: "a.js", content: "1" }]);

const ls = (await dexec(["exec", "-u", CODER_UID, c, "ls", "-A", dir])).stdout.trim().split(/\s+/);
ok(ls.includes("a.js"), "a.js present after resync");
ok(!ls.includes("b.js"), "b.js (deleted in IDE) removed — got [" + ls.join(",") + "]");
ok(!ls.includes("src"), "stale src/ dir removed");
ok(ls.includes("node_modules"), "node_modules dep cache KEPT");
ok(ls.includes(".noc"), ".noc kept");

await dexec(["exec", "-u", CODER_UID, c, "rm", "-rf", dir]);
console.log(pass ? "\n=== HARDENING CLEANUP PASS ===" : "\n=== FAIL ===");
process.exit(pass ? 0 : 1);
