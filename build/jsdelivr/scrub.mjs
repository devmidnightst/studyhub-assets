#!/usr/bin/env node
// scrub.mjs — strip proxy fingerprints from JS/HTML files
// Usage: node scrub.mjs <file> [<file> ...]  (edits in place)

import fs from "fs";

function scrub(code) {
  return String(code)
    .replace(/\s*\/\/[#@]\s*sourceMappingURL=[^\s'"`]+\.map\s*$/, "")
    .replace(/(?:\.{0,2}\/)*(?:node_modules|\.pnpm)\/[^\s"'`)]*/g, "app")
    .replace(/(?<![\w+/])@?(?:mercury[\s._-]?workshop|titanium[\s._-]?network)(?:-dev)?/gi, "webcore")
    .replace(/https?:\/\/github\.com\/[^\s"'`)\]]+/g, "https://github.com/nicecorp/app")
    .replace(/bare-mux:/g, "io:")
    .replace(/\.bareClient/g, "._nc")
    .replace(/__uv\$config/g, "__ne$config")
    .replace(/UVServiceWorker/g, "_NESW")
    .replace(/BareMuxConnection/g, "_NMC")
    .replace(/BareTransport/g, "_NT")
    .replace(/BareClient/g, "_NC")
    .replace(/BareMux/g, "_NM")
    .replace(/(?<![_\/\w])Ultraviolet(?![\w])/g, "_NE")
    .replace(/(?<![_\/\w])ultraviolet(?![\w])/g, "_ne")
    .replace(/\$scramjetController/g, "$_rc")
    .replace(/\$scramjet(?!Controller)/g, "$_rt")
    .replace(/__scramjet_controller/g, "__rt_ctl")
    .replace(/__scramjet(?!_controller)/g, "__rt")
    .replace(/SCRAMJETCLIENT/g, "_RTCLIENT")
    .replace(/SCRAMJETCLIENTNAME/g, "_RTCLIENTNAME")
    .replace(/ScramjetClient/g, "_RtClient")
    .replace(/ScramjetFrame/g, "_RtFrame")
    .replace(/ScramjetFetchHandler/g, "_RtFetchHandler")
    .replace(/ScramjetFetchTrackedClient/g, "_RtFetchTrackedClient")
    .replace(/ScramjetHeaders/g, "_RtHeaders")
    .replace(/scramjet-attr/g, "_rt-attr")
    .replace(/SCRAMJET FUNCTION/g, "_RT FUNCTION")
    .replace(/SCRAMJET INTERNALS/g, "_RT INTERNALS")
    .replace(/a scramjet client/g, "a runtime client")
    .replace(/scramjet version/g, "runtime version")
    .replace(/scramjet is not loaded/g, "runtime is not loaded")
    .replace(/scramjet before/g, "runtime before")
    .replace(/assertRuntimeScramjetVersion/g, "assertRuntimeVersion")
    .replace(/scramjetPath/g, "_rtPath")
    .replace(/scramjetConfig/g, "_rtConfig")
    .replace(/scramjet-injected/g, "_rt-injected")
    .replace(/scramjet original/g, "_rt original")
    .replace(/scramjet realm/g, "_rt realm")
    .replace(/scramjet client global/g, "_rt client global")
    .replace(/loadScramjetWasm/g, "load_RtWasm")
    .replace(/injectScramjet/g, "inject_Rt")
    .replace(/"scramjet"/g, '"_rt"')
    .replace(/UVClient/g, "_NEC")
    .replace(/__uv(?!\$config)/g, "__ne")
    .replace(/baremuxinit/g, "_nmioinit")
    .replace(/bare-mux(?![\w])/g, "net-io")
    .replace(/(?<![_\w])baremux(?![_\w])/gi, "netio")
    .replace(/(?<!__wbg_)(?<![\w])Epoxy(?=Client|WebSocket|Handlers|Options)/g, "_Tn")
    .replace(/(?<!__wbg_)(?<![\w])epoxy(?=_client|_websocket|_handlers)/g, "_tn")
    .replace(/["']\/scramjet\//g, (m) => m[0] + "/edu/res/")
    .replace(/["']\/controller\//g, (m) => m[0] + "/edu/core/")
    .replace(/importScripts\(["']\/scramjet\//g, 'importScripts("/edu/res/')
    .replace(/importScripts\(["']\/controller\//g, 'importScripts("/edu/core/')
    .replace(/scramjet\.js/g, "rt.js")
    .replace(/scramjet\.wasm/g, "rt.wasm")
    .replace(/scramjet\.mjs/g, "rt.mjs");
}

const files = process.argv.slice(2);
if (!files.length) {
  console.error("usage: node scrub.mjs <file> [<file> ...]");
  process.exit(1);
}

let count = 0;
for (const f of files) {
  try {
    const original = fs.readFileSync(f, "utf8");
    const scrubbed = scrub(original);
    if (scrubbed !== original) {
      fs.writeFileSync(f, scrubbed, "utf8");
      count++;
    }
  } catch (e) {
    console.error(`  skip ${f}: ${e.message}`);
  }
}
console.log(`scrubbed ${count}/${files.length} files`);
