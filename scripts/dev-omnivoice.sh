#!/usr/bin/env bash
# ==========================================================================
# AI-Booker — One-shot dev launcher for OmniVoice
# --------------------------------------------------------------------------
# What it does (in order):
#   1. git pull (fast-forward only) in the project root
#   2. npm install — only if package.json or package-lock.json changed
#   3. Create per-session log directory: /tmp/booker-dev/sessions/<timestamp>/
#   4. Start omnivoice-server --device cuda  (background, log to session dir)
#   5. Wait until http://127.0.0.1:8880/health responds
#   6. Probe additional OmniVoice API endpoints (voices, models, ...)
#      to make sure the server is actually ready to serve TTS, not just alive
#   7. Start `npm run dev` (Vite)            (background, log to session dir)
#   8. Wait until http://localhost:8080 responds
#   9. Open Chrome:
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
#
# History note (2026-04-22):
#   We previously maintained a fork (alexkuz60/BookerLab_OmniVoice) to patch
#   omnivoice/utils/audio.py (broken WAV encoding in tensor_to_wav_bytes).
#   Upstream k2-fsa/OmniVoice fixed it in master, so the fork is no longer
#   needed. We now install vanilla:
#     pip install -U \
#       "git+https://github.com/k2-fsa/OmniVoice.git" \
#       "git+https://github.com/maemreyo/omnivoice-server.git@main"
#   The startup check below greps the installed audio.py for `PCM_16` as a
#   regression canary — if upstream ever reverts the fix we'll know on launch.
# ==========================================================================

set -euo pipefail

# -------- config --------
PROJECT_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
OMNI_HOST="127.0.0.1"
OMNI_PORT="8880"
OMNI_BASE="http://$OMNI_HOST:$OMNI_PORT"
VITE_PORT="8080"
PROD_URL="https://booker-studio.lovable.app"

# Upstream install URLs — used in warnings if the audio.py canary check fails.
OMNI_LIB_INSTALL_URL="git+https://github.com/k2-fsa/OmniVoice.git"
OMNI_SERVER_INSTALL_URL="git+https://github.com/maemreyo/omnivoice-server.git@main"

# Logs root + per-session subdir (timestamped so each run is comparable)
LOG_ROOT="/tmp/booker-dev"
SESSION_ID="$(date +%Y%m%d-%H%M%S)"
SESSION_DIR="$LOG_ROOT/sessions/$SESSION_ID"
mkdir -p "$SESSION_DIR"

OMNI_LOG="$SESSION_DIR/omnivoice.log"
VITE_LOG="$SESSION_DIR/vite.log"
PROBE_LOG="$SESSION_DIR/api-probe.log"
SUMMARY_LOG="$SESSION_DIR/session.log"

# Convenience symlink: /tmp/booker-dev/latest → newest session dir
ln -sfn "$SESSION_DIR" "$LOG_ROOT/latest"

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
# Tee everything to the session summary so the user can diff runs later.
log()  { local m; m="$(printf "[%s] %s" "$(date +%H:%M:%S)" "$*")"; printf "\033[1;36m[dev]\033[0m %s\n" "$m"; printf "%s\n" "$m" >> "$SUMMARY_LOG"; }
warn() { local m; m="$(printf "[%s] WARN %s" "$(date +%H:%M:%S)" "$*")"; printf "\033[1;33m[dev]\033[0m %s\n" "$m"; printf "%s\n" "$m" >> "$SUMMARY_LOG"; }
die()  { local m; m="$(printf "[%s] FATAL %s" "$(date +%H:%M:%S)" "$*")"; printf "\033[1;31m[dev]\033[0m %s\n" "$m" >&2; printf "%s\n" "$m" >> "$SUMMARY_LOG"; exit 1; }

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
  log "Bye. Session logs: $SESSION_DIR"
}
trap cleanup EXIT INT TERM

# Wait for a URL to return 2xx/3xx; on failure, dump tail of given log file.
wait_for_url() {
  local url="$1"
  local label="$2"
  local timeout="${3:-60}"
  local tail_log="${4:-}"
  log "Waiting for $label ($url, up to ${timeout}s)..."
  for ((i=0; i<timeout; i++)); do
    if curl -fsS --max-time 2 "$url" >/dev/null 2>&1; then
      log "$label is up."
      return 0
    fi
    sleep 1
  done
  if [[ -n "$tail_log" && -f "$tail_log" ]]; then
    warn "Tail of $tail_log:"
    tail -n 40 "$tail_log" | sed 's/^/    /' | tee -a "$SUMMARY_LOG"
  fi
  die "$label did not become ready within ${timeout}s."
}

# Probe one OmniVoice API endpoint.
#   $1 = path (e.g. /v1/voices)
#   $2 = "required" | "optional"
# Writes status + first ~200 chars of body to $PROBE_LOG.
probe_endpoint() {
  local path="$1"
  local mode="${2:-required}"
  local url="$OMNI_BASE$path"
  local code body
  code="$(curl -s -o /tmp/booker-probe-body.$$ -w '%{http_code}' --max-time 5 "$url" || echo "000")"
  body="$(head -c 200 /tmp/booker-probe-body.$$ 2>/dev/null || true)"
  rm -f /tmp/booker-probe-body.$$
  {
    printf "[%s] GET %s -> %s\n" "$(date +%H:%M:%S)" "$url" "$code"
    printf "    body[0..200]: %s\n" "$body"
  } >> "$PROBE_LOG"

  if [[ "$code" =~ ^(2|3)[0-9][0-9]$ ]]; then
    log "  ✓ $path ($code)"
    return 0
  fi

  if [[ "$mode" == "required" ]]; then
    warn "  ✗ $path returned $code (required)"
    return 1
  else
    log "  · $path returned $code (optional, ignoring)"
    return 0
  fi
}

# Run the full probe set against omnivoice-server. Returns non-zero if any
# REQUIRED endpoint failed.
probe_omnivoice_api() {
  log "Probing OmniVoice API endpoints (details → $PROBE_LOG)"
  : > "$PROBE_LOG"

  local failed=0
  # Required: server alive + at least one TTS-related route reachable.
  probe_endpoint "/health"                     required || failed=1
  probe_endpoint "/v1/audio/speech"            required || failed=1   # POST-only, but should answer (405/422), not 404/000
  # Optional: nice-to-have introspection routes (depends on server version).
  probe_endpoint "/v1/voices"                  optional
  probe_endpoint "/v1/models"                  optional
  probe_endpoint "/v1/audio/speech/clone"      optional   # POST-only; 405/422 acceptable

  if [[ "$failed" -ne 0 ]]; then
    warn "One or more REQUIRED OmniVoice endpoints failed. See $PROBE_LOG and $OMNI_LOG"
    return 1
  fi
  log "OmniVoice API surface looks healthy."
  return 0
}

# -------- step 1: git pull --------
cd "$PROJECT_ROOT"
log "Session: $SESSION_ID"
log "Session dir: $SESSION_DIR"

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
HASH_FILE="$LOG_ROOT/.deps-hash"
NEW_HASH="$(sha1sum package.json package-lock.json 2>/dev/null | sha1sum | awk '{print $1}')"
OLD_HASH="$(cat "$HASH_FILE" 2>/dev/null || true)"
if [[ "$NEW_HASH" != "$OLD_HASH" ]]; then
  log "Dependencies changed → npm install ..."
  npm install
  echo "$NEW_HASH" > "$HASH_FILE"
else
  log "Dependencies unchanged, skipping npm install."
fi

# -------- step 2b: regression canary for omnivoice/utils/audio.py --------
# Upstream k2-fsa/OmniVoice fixed the WAV-encoding bug in tensor_to_wav_bytes
# (used `subtype="PCM_16"` via soundfile). If a future release ever reverts
# that fix, /v1/audio/speech will silently produce broken WAVs. Catch it here.
check_omnivoice_audio_canary() {
  # The WAV fix lives in omnivoice_server/utils/audio.py (the *server* package),
  # not omnivoice/utils/audio.py. Try server first, fall back to library.
  local audio_path="" source=""
  for mod in omnivoice_server.utils.audio omnivoice.utils.audio; do
    local p
    p="$(python3 -c "import $mod as a; print(a.__file__)" 2>/dev/null || true)"
    if [[ -n "$p" && -f "$p" ]]; then
      audio_path="$p"
      source="$mod"
      break
    fi
  done
  if [[ -z "$audio_path" ]]; then
    warn "Could not locate omnivoice_server.utils.audio (or omnivoice.utils.audio)."
    warn "  Is omnivoice-server installed for the active python? Try:"
    warn "    pip install --force-reinstall $OMNI_LIB_INSTALL_URL"
    warn "    pip install --force-reinstall $OMNI_SERVER_INSTALL_URL"
    return 0
  fi
  if grep -q 'PCM_16' "$audio_path"; then
    log "omnivoice audio.py canary OK ✓ (PCM_16 present in $source → $audio_path)"
    return 0
  fi
  warn "============================================================"
  warn "$source ($audio_path) is missing the 'PCM_16' marker."
  warn ""
  warn "Upstream may have regressed the WAV-encoding fix → expect"
  warn "silent / broken WAV output from /v1/audio/speech*."
  warn ""
  warn "Try reinstalling fresh upstream:"
  warn "  pip install --force-reinstall $OMNI_LIB_INSTALL_URL"
  warn "  pip install --force-reinstall $OMNI_SERVER_INSTALL_URL"
  warn "============================================================"
}
check_omnivoice_audio_canary

# -------- step 3: start omnivoice-server --------
if curl -fsS --max-time 1 "$OMNI_BASE/health" >/dev/null 2>&1; then
  log "OmniVoice already running on :$OMNI_PORT, reusing."
else
  command -v omnivoice-server >/dev/null 2>&1 \
    || die "omnivoice-server not found in PATH. Install: pip install omnivoice-server"
  log "Starting omnivoice-server (cuda) → $OMNI_LOG"
  : > "$OMNI_LOG"
  omnivoice-server --device cuda >>"$OMNI_LOG" 2>&1 &
  OMNI_PID=$!
  wait_for_url "$OMNI_BASE/health" "OmniVoice /health" 60 "$OMNI_LOG"
fi

# -------- step 3b: probe API surface before doing anything else --------
if ! probe_omnivoice_api; then
  die "OmniVoice is alive but its API is not ready. Aborting before opening browser."
fi

# -------- step 4: start vite dev --------
if curl -fsS --max-time 1 "http://localhost:$VITE_PORT" >/dev/null 2>&1; then
  log "Vite already running on :$VITE_PORT, reusing."
else
  log "Starting Vite dev server → $VITE_LOG"
  : > "$VITE_LOG"
  npm run dev >>"$VITE_LOG" 2>&1 &
  VITE_PID=$!
  wait_for_url "http://localhost:$VITE_PORT" "Vite" 60 "$VITE_LOG"
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
  PROFILE_DIR="$LOG_ROOT/chrome-prod-profile"
  mkdir -p "$PROFILE_DIR"
  # Isolated profile so the insecure-origin flag never leaks into your normal browsing.
  open_browser "$PROD_URL" \
    --user-data-dir="$PROFILE_DIR" \
    --unsafely-treat-insecure-origin-as-secure="$OMNI_BASE" \
    --new-window
  log "Prod mode: $PROD_URL  (talking directly to $OMNI_BASE)"
else
  open_browser "http://localhost:$VITE_PORT"
  log "Dev mode: http://localhost:$VITE_PORT  (Vite proxies /api/omnivoice → :$OMNI_PORT)"
fi

# -------- step 6: hand off control --------
log "All set. Session logs in: $SESSION_DIR"
log "  Summary    : tail -f $SUMMARY_LOG"
log "  OmniVoice  : tail -f $OMNI_LOG"
log "  Vite       : tail -f $VITE_LOG"
log "  API probe  : cat   $PROBE_LOG"
log "  Shortcut   : $LOG_ROOT/latest -> $SESSION_DIR"
log "Press Ctrl+C to stop both."

# Wait on whichever background process we own; if both pre-existed, just sleep.
if [[ -n "$VITE_PID" ]]; then
  wait "$VITE_PID"
elif [[ -n "$OMNI_PID" ]]; then
  wait "$OMNI_PID"
else
  while true; do sleep 3600; done
fi
