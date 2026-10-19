#!/usr/bin/env node
// patch-svg-html.mjs — prepare HTML for embedding in an SVG wrapper
// On top of the CDN-patched HTML, this pass:
//   1. Rewrites module scripts + modulepreloads to absolute https://nocturne.lol/ URLs
//      so they load from the VPS regardless of the SVG's origin (blob:, cdn.jsdelivr.net)
//   2. Rewrites /app/ paths to absolute VPS URLs (proxy engine, service worker)
//
// Usage: node patch-svg-html.mjs <input.html> <output.html>

import fs from "fs";

const VPS = "https://nocturne.lol";
const [inFile, outFile] = process.argv.slice(2);
if (!inFile || !outFile) {
  console.error("usage: node patch-svg-html.mjs <input.html> <output.html>");
  process.exit(1);
}

let html = fs.readFileSync(inFile, "utf8");

// Rewrite type="module" script src to absolute VPS URL
html = html.replace(
  /(<script\b[^>]*\btype=["']module["'][^>]*\bsrc=["'])(\/)/gi,
  `$1${VPS}/`
);
html = html.replace(
  /(<script\b[^>]*\bsrc=["'])(\/)((?:[^"'>]*)["'][^>]*\btype=["']module["'])/gi,
  `$1${VPS}/$3`
);

// Rewrite rel="modulepreload" href to absolute VPS URL
html = html.replace(
  /(<link\b[^>]*\brel=["']modulepreload["'][^>]*\bhref=["'])(\/)/gi,
  `$1${VPS}/`
);

// Rewrite rel="preload" as="script" href to absolute VPS URL
html = html.replace(
  /(<link\b[^>]*\brel=["']preload["'][^>]*\bas=["']script["'][^>]*\bhref=["'])(\/)/gi,
  `$1${VPS}/`
);
html = html.replace(
  /(<link\b[^>]*\bhref=["'])(\/)((?:[^"'>]*)["'][^>]*\brel=["']preload["'][^>]*\bas=["']script["'])/gi,
  `$1${VPS}/$3`
);

// Rewrite /app/ hrefs and srcs to absolute VPS URL (engine + SW files)
html = html.replace(/(["'])(\/app\/)/g, `$1${VPS}/app/`);

// Rewrite /sapphire/ /controller/ /scramjet/ /sj/ etc (proxy engine paths)
html = html.replace(/(["'])(\/sapphire\/)/g, `$1${VPS}/sapphire/`);

fs.writeFileSync(outFile, html, "utf8");
process.stdout.write(`  svg-patched → ${inFile.split("/").pop()}\n`);
