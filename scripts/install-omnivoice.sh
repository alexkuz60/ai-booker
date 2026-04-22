#!/usr/bin/env bash
# ==========================================================================
# AI-Booker — One-shot installer for OmniVoice (vanilla upstream)
# --------------------------------------------------------------------------
# What it does (in order):
#   1. Detect active python + pip
#   2. Uninstall any existing omnivoice / omnivoice-server (clean slate)
#   3. pip install --no-cache-dir from upstream master:
#        - git+https://github.com/k2-fsa/OmniVoice.git           (library)
#        - git+https://github.com/maemreyo/omnivoice-server.git  (FastAPI server)
#   4. Verify install:
#        - both packages importable / on PATH
#        - omnivoice/utils/audio.py contains "PCM_16" (WAV-encoding fix canary)
#        - omnivoice-server --help works
#   5. Print a clear, color-coded summary (✓ / ✗) so you can see at a glance
#      whether the environment is good to go.
#
# Usage:
#   ./scripts/install-omnivoice.sh                  # default: install both
#   ./scripts/install-omnivoice.sh --library-only   # skip omnivoice-server
#   ./scripts/install-omnivoice.sh --no-uninstall   # don't remove old versions first
#   ./scripts/install-omnivoice.sh --pypi           # install stable PyPI build instead of git master
#   ./scripts/install-omnivoice.sh -h | --help
#
# After success: run ./scripts/dev-omnivoice.sh to start the server + Vite.
# ==========================================================================

set -euo pipefail

# -------- config --------
OMNI_LIB_GIT="git+https://github.com/k2-fsa/OmniVoice.git"
OMNI_SERVER_GIT="git+https://github.com/maemreyo/omnivoice-server.git@main"
OMNI_LIB_PYPI="omnivoice"
OMNI_SERVER_PYPI="omnivoice-server"

INSTALL_SERVER=1
DO_UNINSTALL=1
USE_PYPI=0

for arg in "$@"; do
  case "$arg" in
    --library-only) INSTALL_SERVER=0 ;;
    --no-uninstall) DO_UNINSTALL=0 ;;
    --pypi)         USE_PYPI=1 ;;
    -h|--help)
      sed -n '2,30p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $arg" >&2; exit 2 ;;
  esac
done

# -------- helpers --------
C_RESET="\033[0m"
C_DIM="\033[2m"
C_BOLD="\033[1m"
C_CYAN="\033[1;36m"
C_GREEN="\033[1;32m"
C_YELLOW="\033[1;33m"
C_RED="\033[1;31m"

log()  { printf "${C_CYAN}[install]${C_RESET} %s\n" "$*"; }
ok()   { printf "${C_GREEN}  ✓${C_RESET} %s\n" "$*"; }
warn() { printf "${C_YELLOW}  ⚠${C_RESET} %s\n" "$*"; }
fail() { printf "${C_RED}  ✗${C_RESET} %s\n" "$*"; }
die()  { printf "${C_RED}[install] FATAL${C_RESET} %s\n" "$*" >&2; exit 1; }

step() { printf "\n${C_BOLD}==>${C_RESET} ${C_BOLD}%s${C_RESET}\n" "$*"; }

# -------- step 1: detect python --------
step "Detecting Python environment"

PY="${PYTHON:-python3}"
command -v "$PY" >/dev/null 2>&1 || die "$PY not found in PATH (set PYTHON=... to override)"

PIP=("$PY" -m pip)

PY_VERSION="$("$PY" --version 2>&1 || true)"
PY_PATH="$(command -v "$PY")"
PY_PREFIX="$("$PY" -c 'import sys; print(sys.prefix)' 2>/dev/null || echo "?")"

ok "python : $PY_PATH ($PY_VERSION)"
ok "prefix : $PY_PREFIX"

if [[ -z "${VIRTUAL_ENV:-}" && -z "${CONDA_PREFIX:-}" ]]; then
  warn "No virtualenv / conda env detected — installing into system Python."
  warn "  If that's not what you want, activate your env and re-run."
fi

# -------- step 2: uninstall existing --------
if [[ "$DO_UNINSTALL" == "1" ]]; then
  step "Removing any existing omnivoice / omnivoice-server"
  "${PIP[@]}" uninstall -y "$OMNI_LIB_PYPI"    >/dev/null 2>&1 && ok "removed $OMNI_LIB_PYPI"    || ok "$OMNI_LIB_PYPI was not installed"
  "${PIP[@]}" uninstall -y "$OMNI_SERVER_PYPI" >/dev/null 2>&1 && ok "removed $OMNI_SERVER_PYPI" || ok "$OMNI_SERVER_PYPI was not installed"
else
  step "Skipping uninstall (--no-uninstall)"
fi

# -------- step 3: install --------
if [[ "$USE_PYPI" == "1" ]]; then
  LIB_SRC="$OMNI_LIB_PYPI"
  SERVER_SRC="$OMNI_SERVER_PYPI"
  step "Installing from PyPI (stable releases)"
else
  LIB_SRC="$OMNI_LIB_GIT"
  SERVER_SRC="$OMNI_SERVER_GIT"
  step "Installing from upstream git (latest master)"
fi

log "omnivoice  ← $LIB_SRC"
"${PIP[@]}" install --no-cache-dir --upgrade "$LIB_SRC" \
  || die "Failed to install omnivoice from $LIB_SRC"
ok "omnivoice installed"

if [[ "$INSTALL_SERVER" == "1" ]]; then
  log "omnivoice-server ← $SERVER_SRC"
  "${PIP[@]}" install --no-cache-dir --upgrade "$SERVER_SRC" \
    || die "Failed to install omnivoice-server from $SERVER_SRC"
  ok "omnivoice-server installed"
else
  warn "Skipping omnivoice-server (--library-only)"
fi

# -------- step 4: verify --------
step "Verifying installation"

VERIFY_FAILED=0

# 4a. omnivoice importable
OMNI_VERSION="$("$PY" -c 'import omnivoice; print(getattr(omnivoice, "__version__", "?"))' 2>/dev/null || echo "")"
if [[ -n "$OMNI_VERSION" ]]; then
  ok "omnivoice importable (version: $OMNI_VERSION)"
else
  fail "omnivoice cannot be imported"
  VERIFY_FAILED=1
fi

# 4b. audio.py canary — the WAV-encoding fix marker
AUDIO_PATH="$("$PY" -c 'import omnivoice.utils.audio as a; print(a.__file__)' 2>/dev/null || true)"
if [[ -z "$AUDIO_PATH" || ! -f "$AUDIO_PATH" ]]; then
  fail "omnivoice/utils/audio.py not found"
  VERIFY_FAILED=1
else
  if grep -q 'PCM_16' "$AUDIO_PATH"; then
    ok "audio.py WAV-fix canary OK (PCM_16 present)"
    printf "${C_DIM}     %s${C_RESET}\n" "$AUDIO_PATH"
  else
    fail "audio.py is MISSING the 'PCM_16' marker — WAV output will likely be broken"
    printf "${C_DIM}     %s${C_RESET}\n" "$AUDIO_PATH"
    warn "  Upstream may have regressed the fix. Try --pypi, or pin a known-good commit."
    VERIFY_FAILED=1
  fi
fi

# 4c. omnivoice-server CLI
if [[ "$INSTALL_SERVER" == "1" ]]; then
  if command -v omnivoice-server >/dev/null 2>&1; then
    SERVER_BIN="$(command -v omnivoice-server)"
    SERVER_HELP_OK=0
    if omnivoice-server --help >/dev/null 2>&1; then
      SERVER_HELP_OK=1
    fi
    if [[ "$SERVER_HELP_OK" == "1" ]]; then
      ok "omnivoice-server CLI works ($SERVER_BIN)"
    else
      fail "omnivoice-server is on PATH but --help failed"
      VERIFY_FAILED=1
    fi
  else
    fail "omnivoice-server not found on PATH after install"
    warn "  Is your venv/conda env activated? Check: which omnivoice-server"
    VERIFY_FAILED=1
  fi
fi

# -------- step 5: summary --------
step "Summary"

printf "  python           : ${C_BOLD}%s${C_RESET}\n" "$PY_VERSION"
printf "  omnivoice        : ${C_BOLD}%s${C_RESET}  (from %s)\n" "${OMNI_VERSION:-not installed}" "$LIB_SRC"
if [[ "$INSTALL_SERVER" == "1" ]]; then
  SERVER_VERSION="$(omnivoice-server --version 2>/dev/null | head -n1 || echo "?")"
  printf "  omnivoice-server : ${C_BOLD}%s${C_RESET}  (from %s)\n" "$SERVER_VERSION" "$SERVER_SRC"
fi

echo
if [[ "$VERIFY_FAILED" == "0" ]]; then
  printf "${C_GREEN}${C_BOLD}✓ Installation OK${C_RESET}\n"
  echo
  echo "Next steps:"
  echo "  ./scripts/dev-omnivoice.sh           # start server + Vite (dev mode)"
  echo "  ./scripts/dev-omnivoice.sh --prod    # test against published booker-studio"
  exit 0
else
  printf "${C_RED}${C_BOLD}✗ Installation completed with errors — see above${C_RESET}\n"
  echo
  echo "Common fixes:"
  echo "  - Activate the right venv/conda env, then re-run this script."
  echo "  - Try the stable PyPI build:  ./scripts/install-omnivoice.sh --pypi"
  echo "  - Inspect the canary file manually:"
  echo "      python3 -c 'import omnivoice.utils.audio as a; print(a.__file__)'"
  exit 1
fi
