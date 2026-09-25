#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# nyx-wisp deploy — RUN THIS ON 10.10.20.8 (the Wisp host), not on the app box.
#
# Replaces the slow wisp-server-python (v0.9.0) with the Rust nyx-wisp server on
# the SAME port 6001, so Caddy needs no change and all traffic still exits via .8.
#
# It is deliberately PHASED so you never cut the live transport blind:
#   ./nyx-deploy.sh build     # clone + cargo build --release
#   ./nyx-deploy.sh test      # run on :6002 alongside Python — verify a site loads
#   ./nyx-deploy.sh cutover   # install systemd unit on :6001, stop Python, start nyx
#   ./nyx-deploy.sh rollback  # stop nyx, restart Python  (panic button)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

REPO="https://github.com/devmidnightst/nyx-wisp"
DIR="${NYX_DIR:-$HOME/nyx-wisp}"
BIN="$DIR/target/release/nyx-server"
PORT="${NYX_PORT:-6001}"
TEST_PORT="${NYX_TEST_PORT:-6002}"
BUFFER="${NYX_BUFFER:-1024}"        # flow-control window; bump to 2048 if users are far
PY_UNIT="${PY_UNIT:-wisp-python}"   # <-- set to the ACTUAL systemd unit/pm2 name of the Python server
BIND_ADDR="0.0.0.0"                 # must be reachable from the app host (.9) — NOT 127.0.0.1

phase="${1:-help}"

case "$phase" in
  build)
    command -v cargo >/dev/null || { echo "Rust not installed. Run: curl https://sh.rustup.rs -sSf | sh"; exit 1; }
    [ -d "$DIR/.git" ] || git clone "$REPO" "$DIR"
    cd "$DIR" && git pull --ff-only || true
    cargo build --release
    echo "✅ built: $BIN"
    ;;

  test)
    [ -x "$BIN" ] || { echo "Build first: $0 build"; exit 1; }
    echo "▶ starting nyx on $BIND_ADDR:$TEST_PORT (Python untouched on $PORT)…"
    echo "  Point a test client at port $TEST_PORT and load a site through the proxy."
    echo "  Ctrl-C when satisfied, then run: $0 cutover"
    exec "$BIN" --bind "$BIND_ADDR:$TEST_PORT" --buffer-size "$BUFFER"
    ;;

  cutover)
    [ -x "$BIN" ] || { echo "Build first: $0 build"; exit 1; }
    echo "▶ installing systemd unit for nyx on :$PORT…"
    sudo tee /etc/systemd/system/nyx-wisp.service >/dev/null <<UNIT
[Unit]
Description=nyx-wisp (Wisp v2, Rust)
After=network.target
[Service]
ExecStart=$BIN --bind $BIND_ADDR:$PORT --buffer-size $BUFFER
Restart=always
RestartSec=2
LimitNOFILE=1048576
[Install]
WantedBy=multi-user.target
UNIT
    echo "▶ stopping Python server ($PY_UNIT) and starting nyx on :$PORT…"
    sudo systemctl stop "$PY_UNIT" 2>/dev/null || echo "  (couldn't stop $PY_UNIT — stop it manually if it's not systemd)"
    sudo systemctl daemon-reload
    sudo systemctl enable --now nyx-wisp
    sleep 1
    ss -ltnp | grep ":$PORT " && echo "✅ nyx listening on :$PORT" || echo "⚠ nothing on :$PORT — check: journalctl -u nyx-wisp -e"
    echo "Now re-run your speed test through the proxy."
    ;;

  rollback)
    echo "▶ rolling back to Python…"
    sudo systemctl disable --now nyx-wisp 2>/dev/null || true
    sudo systemctl start "$PY_UNIT" 2>/dev/null || echo "  start $PY_UNIT manually"
    echo "✅ rolled back (verify :$PORT is the Python server again)"
    ;;

  *)
    echo "usage: $0 {build|test|cutover|rollback}"
    echo "  edit PY_UNIT at the top to your Python server's real service name first."
    ;;
esac
