#!/usr/bin/env bash
# ==========================================================================
# AI-Booker — One-shot dev launcher for OmniVoice
# --------------------------------------------------------------------------
# What it does (in order):
#   1. git pull (fast-forward only) in the project root
#   2. npm install — only if package.json or package-lock.json changed
#   3. Start omnivoice-server --device cuda  (background, log to /tmp)
#   4. Wait until http://127.0.0.1:8880/health responds
#   5. Start `npm run dev` (Vite)            (background, log to /tmp)
#   6. Wait until http://localhost:8080 responds
#   7. Open Chrome:
#        - default profile  → http://localhost:8080  (Vite proxy handles TTS)
#        - --prod flag      → opens https://booker-studio.lovable.app
#                             in an isolated Chrome profile with
#                             --unsafely-treat-insecure-origin-as-secure
#                             so it can talk to http://127.0.0.1:8880
#
# Usage:
#   ./scripts/dev-omnivoice.sh           # local dev (default)
#   ./scripts/dev-omnivoice.sh --prod    # test against published booker-studio
#   ./scripts/dev-omnivoice.sh --no-pull # skip git pull this run
#
# One Ctrl+C kills both background processes cleanly.
# ==========================================================================

set -euo pipefail

# -------- config --------
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OMNI_HOST="127.0.0.1"
OMNI_PORT="8880"
VITE_PORT="8080"
PROD_URL="https://booker-studio.lovable.app"
LOG_DIR="/tmp/booker-dev"
mkdir -p "$LOG_DIR"
OMNI_LOG="$LOG_DIR/omnivoice.log"
VITE_LOG="$LOG_DIR/vite.log"

MODE_PROD=0
DO_PULL=1
for arg in "$@"; do
  case "$arg" in
    --prod)    MODE_PROD=1 ;;
    --no-pull) DO_PULL=0 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# -------- helpers --------
log()  { printf "\033[1;36m[dev]\033[0m %s\n" "$*"; }
warn() { printf "\033[1;33m[dev]\033[0m %s\n" "$*"; }
die()  { printf "\033[1;31m[dev]\033[0m %s\n" "$*" >&2; exit 1; }

OMNI_PID=""
VITE_PID=""

cleanup() {
  log "Shutting down..."
  if [[ -n "$VITE_PID" ]] && kill -0 "$VITE_PID" 2>/dev/null; then
    kill "$VITE_PID" 2>/dev/null || true
    wait "$VITE_PID" 2>/dev/null || true
  fi
  if [[ -n "$OMNI_PID" ]] && kill -0 "$OMNI_PID" 2>/dev/null; then
    kill "$OMNI_PID" 2>/dev/null || true
    wait "$OMNI_PID" 2>/dev/null || true
  fi
  log "Bye."
}
trap cleanup EXIT INT TERM

wait_for_url() {
  local url="$1"
  local label="$2"
  local timeout="${3:-60}"
  log "Waiting for $label ($url, up to ${timeout}s)..."
  for ((i=0; i<timeout; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      log "$label is up."
      return 0
    fi
    sleep 1
  done
  die "$label did not become ready within ${timeout}s. Tail of log:
$(tail -n 40 "$3" 2>/dev/null || true)"
}

# -------- step 1: git pull --------
cd "$PROJECT_ROOT"
if [[ "$DO_PULL" == "1" ]]; then
  if [[ -d .git ]]; then
    log "git pull --ff-only ..."
    git pull --ff-only || warn "git pull failed (continuing with current code)"
  else
    warn "Not a git repo, skipping pull."
  fi
else
  log "Skipping git pull (--no-pull)"
fi

# -------- step 2: npm install (only if manifests changed) --------
HASH_FILE="$LOG_DIR/.deps-hash"
NEW_HASH="$(sha1sum package.json package-lock.json 2>/dev/null | sha1sum | awk '{print $1}')"
OLD_HASH="$(cat "$HASH_FILE" 2>/dev/null || true)"
if [[ "$NEW_HASH" != "$OLD_HASH" ]]; then
  log "Dependencies changed → npm install ..."
  npm install
  echo "$NEW_HASH" > "$HASH_FILE"
else
  log "Dependencies unchanged, skipping npm install."
fi

# -------- step 3: start omnivoice-server --------
if curl -fsS --max-time 1 "http://$OMNI_HOST:$OMNI_PORT/health" >/dev/null 2>&1; then
  log "OmniVoice already running on :$OMNI_PORT, reusing."
else
  command -v omnivoice-server >/dev/null 2>&1 \
    || die "omnivoice-server not found in PATH. Install: pip install omnivoice-server"
  log "Starting omnivoice-server (cuda) → $OMNI_LOG"
  : > "$OMNI_LOG"
  omnivoice-server --device cuda >>"$OMNI_LOG" 2>&1 &
  OMNI_PID=$!
  wait_for_url "http://$OMNI_HOST:$OMNI_PORT/health" "OmniVoice" 60
fi

# -------- step 4: start vite dev --------
if curl -fsS --max-time 1 "http://localhost:$VITE_PORT" >/dev/null 2>&1; then
  log "Vite already running on :$VITE_PORT, reusing."
else
  log "Starting Vite dev server → $VITE_LOG"
  : > "$VITE_LOG"
  npm run dev >>"$VITE_LOG" 2>&1 &
  VITE_PID=$!
  wait_for_url "http://localhost:$VITE_PORT" "Vite" 60
fi

# -------- step 5: open browser --------
open_browser() {
  local url="$1"; shift
  local extra=("$@")

  # Pick a chromium-family binary
  local bin=""
  for cand in google-chrome google-chrome-stable chromium chromium-browser brave-browser; do
    if command -v "$cand" >/dev/null 2>&1; then bin="$cand"; break; fi
  done

  if [[ -z "$bin" ]]; then
    warn "No Chromium-family browser found. Open manually: $url"
    return
  fi

  log "Opening $bin → $url"
  "$bin" "${extra[@]}" "$url" >/dev/null 2>&1 &
}

if [[ "$MODE_PROD" == "1" ]]; then
  PROFILE_DIR="$LOG_DIR/chrome-prod-profile"
  mkdir -p "$PROFILE_DIR"
  # Isolated profile so the insecure-origin flag never leaks into your normal browsing.
  open_browser "$PROD_URL" \
    --user-data-dir="$PROFILE_DIR" \
    --unsafely-treat-insecure-origin-as-secure="http://$OMNI_HOST:$OMNI_PORT" \
    --new-window
  log "Prod mode: $PROD_URL  (talking directly to http://$OMNI_HOST:$OMNI_PORT)"
else
  open_browser "http://localhost:$VITE_PORT"
  log "Dev mode: http://localhost:$VITE_PORT  (Vite proxies /api/omnivoice → :$OMNI_PORT)"
fi

# -------- step 6: hand off control --------
log "All set. Logs:"
log "  OmniVoice : tail -f $OMNI_LOG"
log "  Vite      : tail -f $VITE_LOG"
log "Press Ctrl+C to stop both."

# Wait on whichever background process we own; if both pre-existed, just sleep.
if [[ -n "$VITE_PID" ]]; then
  wait "$VITE_PID"
elif [[ -n "$OMNI_PID" ]]; then
  wait "$OMNI_PID"
else
  while true; do sleep 3600; done
fi
