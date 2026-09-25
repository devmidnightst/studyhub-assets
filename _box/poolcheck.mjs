import fs from "fs";
const OWNER_PASSWORD = process.env.NOCTURNE_OWNER_PASSWORD || fs.readFileSync(new URL("../data/owner-password", import.meta.url), "utf8").trim();
const base="http://localhost:8099";
const lr=await fetch(base+"/api/auth/login",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({username:"midnightsweat",password:OWNER_PASSWORD})});
const raw=lr.headers.getSetCookie?lr.headers.getSetCookie().join("; "):(lr.headers.get("set-cookie")||"");
const cookie="nocturne_sid="+/nocturne_sid=([^;]+)/.exec(raw)[1];
const dc=await (await fetch(base+"/api/boxes/admin/datacenter",{headers:{Cookie:cookie}})).json();
console.log("  pool="+JSON.stringify(dc.pool)); console.log("  free="+JSON.stringify(dc.free)); process.exit(0);
