#!/usr/bin/env bash
set -euo pipefail

# jsd-build.sh — Nocturne jsDelivr build
#
# Creates two outputs:
#   assets-repo/   → the static assets to push to your GitHub CDN repo
#   dist-html/     → HTML files with /src/ paths rewritten to jsDelivr CDN URLs
#
# Usage:
#   ./jsd-build.sh --repo USER/REPO --tag v1.0.0
#   ./jsd-build.sh --repo nightcoreteam/nocturne-cdn --tag v2.1.0
#
# After running:
#   1. Push assets-repo/ contents to your GitHub repo at the given tag
#   2. Copy dist-html/ files to the VPS (or let the deploy step do it)
#
# jsDelivr URL format:
#   https://cdn.jsdelivr.net/gh/USER/REPO@TAG/src/css/global.css

REPO=""
TAG=""
NO_SCRUB=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO="$2"; shift 2 ;;
    --tag)  TAG="$2";  shift 2 ;;
    --no-scrub) NO_SCRUB=1; shift ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$REPO" || -z "$TAG" ]]; then
  echo "usage: $0 --repo USER/REPO --tag vX.Y.Z"
  echo "  example: $0 --repo nightcoreteam/nocturne-cdn --tag v2.0.0"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"       # /var/www/nocturne
PUBLIC="$ROOT/public"
OUT_ASSETS="$SCRIPT_DIR/out/assets-repo"
OUT_HTML="$SCRIPT_DIR/out/dist-html"
CDN_BASE="https://cdn.jsdelivr.net/gh/${REPO}@${TAG}"

echo ""
echo "[jsd-build] repo   : $REPO"
echo "[jsd-build] tag    : $TAG"
echo "[jsd-build] cdn    : $CDN_BASE"
echo ""

rm -rf "$SCRIPT_DIR/out"
mkdir -p "$OUT_ASSETS" "$OUT_HTML"

# ── 1. Copy static assets to assets-repo and scrub JS ────────────────────────
echo "[jsd-build] copying assets..."
for dir in css js img lib; do
  src="$PUBLIC/src/$dir"
  if [[ -d "$src" ]]; then
    dest="$OUT_ASSETS/src/$dir"
    mkdir -p "$dest"
    cp -a "$src/." "$dest/"
    count="$(find "$src" -type f | wc -l)"
    echo "  src/$dir  ($count files)"
  fi
done

echo ""
echo "[jsd-build] scrubbing JS/lib..."
JS_FILES=()
while IFS= read -r f; do JS_FILES+=("$f"); done < <(find "$OUT_ASSETS/src/js" "$OUT_ASSETS/src/lib" -type f -name "*.js" 2>/dev/null)
if [[ ${#JS_FILES[@]} -gt 0 ]]; then
  node "$SCRIPT_DIR/scrub.mjs" "${JS_FILES[@]}"
fi

# ── 2. Rewrite HTML files (module scripts kept local) ────────────────────────
# patch-html.mjs skips type="module" scripts and rel="modulepreload" links —
# ES import paths resolve relative to the script URL, so those must stay
# same-origin on the VPS.
echo ""
echo "[jsd-build] rewriting HTML..."

PATCHED=0

for html in "$PUBLIC"/*.html; do
  fname="$(basename "$html")"
  dest="$OUT_HTML/$fname"
  node "$SCRIPT_DIR/patch-html.mjs" "$CDN_BASE" "$html" "$dest"
  PATCHED=$((PATCHED + 1))
done

if [[ -d "$PUBLIC/legal" ]]; then
  mkdir -p "$OUT_HTML/legal"
  for html in "$PUBLIC/legal/"*.html; do
    [[ -f "$html" ]] || continue
    dest="$OUT_HTML/legal/$(basename "$html")"
    node "$SCRIPT_DIR/patch-html.mjs" "$CDN_BASE" "$html" "$dest"
    PATCHED=$((PATCHED + 1))
  done
fi

# ── 3. Scrub HTML files (inline scripts may carry proxy tells) ────────────────
echo ""
echo "[jsd-build] scrubbing HTML..."
HTML_FILES=()
while IFS= read -r f; do HTML_FILES+=("$f"); done < <(find "$OUT_HTML" -maxdepth 2 -type f -name "*.html")
if [[ ${#HTML_FILES[@]} -gt 0 ]]; then
  node "$SCRIPT_DIR/scrub.mjs" "${HTML_FILES[@]}"
fi

# ── 4. Prepare SVG-specific HTML (absolute VPS URLs for modules + /app/) ─────
# Module scripts resolve imports relative to their URL. From a blob:/cdn origin,
# /src/js/kf2093.js would try cdn.jsdelivr.net/src/js/... → 404.
# This pass rewrites them to https://nocturne.lol/src/js/... so they always
# load from the VPS regardless of where the SVG is opened from.
echo ""
echo "[jsd-build] preparing SVG HTML (abs module URLs)..."
SVG_HTML_DIR="$SCRIPT_DIR/out/dist-svg-html"
mkdir -p "$SVG_HTML_DIR"
for html in "$OUT_HTML"/*.html; do
  [[ -f "$html" ]] || continue
  dest="$SVG_HTML_DIR/$(basename "$html")"
  node "$SCRIPT_DIR/patch-svg-html.mjs" "$html" "$dest"
done

# ── 5. Wrap HTML files as SVG so jsDelivr renders them ───────────────────────
# Primary: blob URL (Chrome/Firefox/Android).
# iOS Safari silently blocks programmatic blob: navigation, so after 150ms we
# fall back to a plain https:// redirect to the VPS page — works on all browsers.
echo ""
echo "[jsd-build] wrapping pages as SVG..."

VPS_BASE="https://nocturne.lol"
SVG_COUNT=0
for html in "$SVG_HTML_DIR"/*.html; do
  [[ -f "$html" ]] || continue
  base="$(basename "$html" .html)"
  svg="$OUT_ASSETS/${base}.svg"
  b64="$(base64 -w 0 "$html")"
  # Map page name to VPS URL
  if [[ "$base" == "index" ]]; then
    vps_url="${VPS_BASE}/"
  else
    vps_url="${VPS_BASE}/${base}.html"
  fi
  printf '<svg xmlns="http://www.w3.org/2000/svg"><script type="text/javascript">(function(){var h=atob("%s"),b=new Blob([h],{type:"text/html"}),u=URL.createObjectURL(b);location.replace(u);setTimeout(function(){location.replace("%s")},150)})();</script></svg>' "$b64" "$vps_url" > "$svg"
  SVG_COUNT=$((SVG_COUNT + 1))
  echo "  ${base}.svg"
done

echo ""
echo "[jsd-build] done!"
echo "  $PATCHED HTML files patched"
echo "  $SVG_COUNT SVG wrappers generated"
echo ""
echo "── outputs ─────────────────────────────────────────────"
echo "  assets-repo/  →  push to github.com/$REPO  then tag $TAG"
echo "  dist-html/    →  deploy HTML files to the VPS"
echo ""
echo "── next steps ───────────────────────────────────────────"
echo "  1. cd $SCRIPT_DIR/out/assets-repo"
echo "     git init / git remote add origin git@github.com:$REPO.git"
echo "     git add . && git commit -m 'nocturne cdn assets $TAG'"
echo "     git tag $TAG && git push origin main --tags"
echo ""
echo "  2. copy dist-html/* to your VPS public/ dir"
echo "     (or run jsd-deploy.sh if you set SSH_TARGET)"
echo ""
echo "  3. visit https://cdn.jsdelivr.net/gh/$REPO@$TAG/index.svg"
echo "     to confirm the CDN is live (may take ~2 min to propagate)"
