#!/usr/bin/env node
// patch-html.mjs — rewrite /src/ asset paths to jsDelivr CDN URLs
// Skips type="module" scripts and rel="modulepreload" links — those must stay
// same-origin because ES import paths resolve relative to the script's URL.
//
// Usage: node patch-html.mjs <cdn_base> <input.html> <output.html>

import fs from "fs";

const [cdnBase, inFile, outFile] = process.argv.slice(2);
if (!cdnBase || !inFile || !outFile) {
  console.error("usage: node patch-html.mjs <cdn_base> <input.html> <output.html>");
  process.exit(1);
}

let html = fs.readFileSync(inFile, "utf8");

// Normalize: strip any existing studyhub-assets CDN prefix so this script is
// idempotent even if the source files were already patched by a previous build.
html = html.replace(
  /https:\/\/cdn\.jsdelivr\.net\/gh\/devmidnightst\/studyhub-assets@[^/]+\//g,
  "/"
);

// Rewrite <link rel="stylesheet" href="/src/..."> — safe, CSS has no imports
html = html.replace(
  /(<link\b[^>]*\brel=["']stylesheet["'][^>]*\bhref=["'])(\/src\/)/gi,
  (_, pre, path) => pre + cdnBase + path
);
html = html.replace(
  /(<link\b[^>]*\bhref=["'])(\/src\/css\/[^"'>]+)(["'][^>]*>)/gi,
  (_, pre, path, post) => pre + cdnBase + path + post
);

// Rewrite <link rel="preload" as="image" href="/src/img/..."> — images are safe
html = html.replace(
  /(<link\b[^>]*\bas=["'](?:image|fetch)["'][^>]*\bhref=["'])(\/src\/)/gi,
  (_, pre, path) => pre + cdnBase + path
);

// Rewrite <script src="/src/..." defer|async (NOT type="module")>
// Matches script tags that do NOT have type="module" anywhere in the tag
html = html.replace(
  /<script\b([^>]*)>/gi,
  (tag, attrs) => {
    // skip module scripts — their /src/js imports resolve relative to origin
    if (/\btype=["']module["']/i.test(attrs)) return tag;
    // rewrite src="/src/..." in non-module script tags
    const patched = attrs.replace(/(src=["'])(\/src\/)/gi, `$1${cdnBase}$2`);
    return `<script${patched}>`;
  }
);

// Rewrite <img src="/src/img/...">
html = html.replace(/(src=["'])(\/src\/img\/)/gi, `$1${cdnBase}$2`);

// Do NOT rewrite rel="modulepreload" or rel="preload" as="script" —
// those are hints for module graph resolution, must stay same-origin

fs.writeFileSync(outFile, html, "utf8");

// Report what changed
const changed = (html.match(new RegExp(cdnBase.replace(/\//g, "\\/"), "g")) || []).length;
process.stdout.write(`  ${changed} refs → CDN  (${inFile.split("/").pop()})\n`);
