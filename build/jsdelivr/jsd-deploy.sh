#!/usr/bin/env bash
set -euo pipefail

# jsd-deploy.sh — push assets to GitHub and apply patched HTML to the live VPS
#
# Requires jsd-build.sh to have been run first.
#
# Usage:
#   ./jsd-deploy.sh --repo USER/REPO --tag v1.0.0 [--remote git@github.com:USER/REPO.git]
#
# Environment vars (all optional):
#   SSH_TARGET   user@host to rsync HTML to (default: skip HTML deploy, just GitHub push)
#   SSH_PUBLIC   remote path to the public/ dir  (default: /var/www/nocturne/public)

REPO=""
TAG=""
REMOTE=""
SSH_TARGET="${SSH_TARGET:-}"
SSH_PUBLIC="${SSH_PUBLIC:-/var/www/nocturne/public}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo)   REPO="$2";   shift 2 ;;
    --tag)    TAG="$2";    shift 2 ;;
    --remote) REMOTE="$2"; shift 2 ;;
    *) echo "unknown arg: $1"; exit 1 ;;
  esac
done

if [[ -z "$REPO" || -z "$TAG" ]]; then
  echo "usage: $0 --repo USER/REPO --tag vX.Y.Z [--remote git@github.com:USER/REPO.git]"
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASSETS="$SCRIPT_DIR/out/assets-repo"
HTML="$SCRIPT_DIR/out/dist-html"

if [[ ! -d "$ASSETS" ]]; then
  echo "[jsd-deploy] error: run jsd-build.sh first (out/assets-repo not found)"
  exit 1
fi

# ── 1. Push assets to GitHub ─────────────────────────────────────────────────
echo ""
echo "[jsd-deploy] pushing assets to github.com/$REPO @ $TAG ..."
cd "$ASSETS"

if [[ ! -d ".git" ]]; then
  git init -b main
  if [[ -n "$REMOTE" ]]; then
    git remote add origin "$REMOTE"
  else
    git remote add origin "git@github.com:$REPO.git"
  fi
fi

# Make sure origin is set
if ! git remote get-url origin &>/dev/null && [[ -n "$REMOTE" ]]; then
  git remote add origin "$REMOTE"
elif ! git remote get-url origin &>/dev/null; then
  git remote add origin "git@github.com:$REPO.git"
fi

git add -A
git commit -m "nocturne cdn assets $TAG" 2>/dev/null || echo "  (nothing changed)"

# Move existing tag if present
git tag -f "$TAG"
git push origin main --force
git push origin "$TAG" --force

echo "[jsd-deploy] github push done"
echo "  CDN url: https://cdn.jsdelivr.net/gh/$REPO@$TAG/src/css/global.css"

# ── 2. Optionally sync HTML to VPS ───────────────────────────────────────────
if [[ -n "$SSH_TARGET" ]]; then
  echo ""
  echo "[jsd-deploy] syncing patched HTML to $SSH_TARGET:$SSH_PUBLIC ..."
  rsync -avz --include="*.html" --exclude="*" "$HTML/" "$SSH_TARGET:$SSH_PUBLIC/"
  echo "[jsd-deploy] HTML sync done"
else
  echo ""
  echo "[jsd-deploy] no SSH_TARGET set — skipping HTML deploy"
  echo "  to deploy HTML manually:"
  echo "    rsync -avz $HTML/ USER@HOST:$SSH_PUBLIC/"
  echo "  or just copy out/dist-html/*.html → public/ on the VPS"
fi

echo ""
echo "[jsd-deploy] all done!"
