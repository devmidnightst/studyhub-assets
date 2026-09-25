const http = require("http");
const fs = require("fs");
const path = require("path");
const PORT = 8090;
const TOTAL = 12;
let active = 0, queue = 0;
const html = fs.readFileSync(path.join(__dirname, "index.html"));
function readBody(req){ return new Promise(r=>{ let b=""; req.on("data",c=>b+=c); req.on("end",()=>r(b)); }); }
const MOCK_VNC = "data:text/html,<body style='margin:0;background:%23101018;color:%23b8b0da;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;font-size:20px'>mock noVNC desktop</body>";
http.createServer(async (req,res)=>{
  const u = req.url.split("?")[0];
  if (u === "/" || u === "/index.html") { res.writeHead(200,{"Content-Type":"text/html"}); return res.end(html); }
  if (u === "/api/status") { res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({ activeSlots: active, totalSlots: TOTAL, queueLength: queue })); }
  if (u === "/api/request" && req.method === "POST") {
    await readBody(req);
    res.writeHead(200,{"Content-Type":"application/json"});
    if (req.url.indexOf("full") > -1 || active >= TOTAL) { queue++; return res.end(JSON.stringify({ status:"queued", position: queue })); }
    active++;
    return res.end(JSON.stringify({ status:"assigned", novncUrl: MOCK_VNC, slotId: "vps0-slot"+active, duration: 600000 }));
  }
  if (u === "/api/end" && req.method === "POST") { await readBody(req); if (active>0) active--; res.writeHead(200,{"Content-Type":"application/json"}); return res.end(JSON.stringify({ ok:true })); }
  res.writeHead(404); res.end("nf");
}).listen(PORT, ()=>console.log("mock vm-manager listening on "+PORT));
