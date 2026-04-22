#!/usr/bin/env bash
# ==========================================================================
# AI-Booker — One-shot installer for OmniVoice (vanilla upstream)
# --------------------------------------------------------------------------
# What it does (in order):
#   1. Detect / create a Python environment (venv-aware, PEP 668 safe)
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
#   ./scripts/install-omnivoice.sh                  # default: install both (auto venv if needed)
#   ./scripts/install-omnivoice.sh --library-only   # skip omnivoice-server
#   ./scripts/install-omnivoice.sh --no-uninstall   # don't remove old versions first
#   ./scripts/install-omnivoice.sh --pypi           # install stable PyPI build instead of git master
#   ./scripts/install-omnivoice.sh --venv PATH      # use/create venv at PATH (default: ~/.venvs/omnivoice)
#   ./scripts/install-omnivoice.sh --no-venv        # force install into current python (uses --break-system-packages on PEP 668)
#   ./scripts/install-omnivoice.sh --python BIN     # use specific interpreter (e.g. python3.14)
#   ./scripts/install-omnivoice.sh -h | --help
#
# Env overrides:
#   PYTHON=python3.14 ./scripts/install-omnivoice.sh
#
# After success: run ./scripts/dev-omnivoice.sh to start the server + Vite.
# ==========================================================================

set -euo pipefail

# -------- config --------
OMNI_LIB_GIT="git+https://github.com/k2-fsa/OmniVoice.git"
OMNI_SERVER_GIT="git+https://github.com/maemreyo/omnivoice-server.git@main"
OMNI_LIB_PYPI="omnivoice"
OMNI_SERVER_PYPI="omnivoice-server"

DEFAULT_VENV="$HOME/.venvs/omnivoice"

INSTALL_SERVER=1
DO_UNINSTALL=1
USE_PYPI=0
USE_VENV=auto      # auto | yes | no
VENV_PATH="$DEFAULT_VENV"
PY_OVERRIDE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --library-only) INSTALL_SERVER=0; shift ;;
    --no-uninstall) DO_UNINSTALL=0; shift ;;
    --pypi)         USE_PYPI=1; shift ;;
    --venv)         USE_VENV=yes; VENV_PATH="${2:?--venv needs a path}"; shift 2 ;;
    --no-venv)      USE_VENV=no; shift ;;
    --python)       PY_OVERRIDE="${2:?--python needs an interpreter}"; shift 2 ;;
    -h|--help)
      sed -n '2,35p' "$0"
      exit 0
      ;;
    *) echo "Unknown arg: $1" >&2; exit 2 ;;
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

# -------- step 1: detect / create python env --------
step "Detecting Python environment"

# Resolve the bootstrap interpreter (used to *create* the venv if needed)
BOOT_PY="${PY_OVERRIDE:-${PYTHON:-python3}}"
command -v "$BOOT_PY" >/dev/null 2>&1 || die "$BOOT_PY not found in PATH (use --python or set PYTHON=...)"

BOOT_PY_VERSION="$("$BOOT_PY" --version 2>&1 || true)"
BOOT_PY_PATH="$(command -v "$BOOT_PY")"
ok "bootstrap python : $BOOT_PY_PATH ($BOOT_PY_VERSION)"

# Detect PEP 668 "externally managed" state on the bootstrap interpreter
IS_EXTERNALLY_MANAGED=0
if "$BOOT_PY" - <<'PYEOF' >/dev/null 2>&1
import sys, sysconfig, os
stdlib = sysconfig.get_paths().get("stdlib", "")
# EXTERNALLY-MANAGED marker lives next to stdlib
marker = os.path.join(os.path.dirname(stdlib), "EXTERNALLY-MANAGED")
sys.exit(0 if os.path.exists(marker) else 1)
PYEOF
then
  IS_EXTERNALLY_MANAGED=1
fi

# Decide whether to use a venv
if [[ "$USE_VENV" == "auto" ]]; then
  if [[ -n "${VIRTUAL_ENV:-}" || -n "${CONDA_PREFIX:-}" ]]; then
    USE_VENV=no   # already inside an env — respect it
  elif [[ "$IS_EXTERNALLY_MANAGED" == "1" ]]; then
    USE_VENV=yes  # PEP 668 system python → must use a venv
  else
    USE_VENV=no
  fi
fi

PIP_EXTRA=()

if [[ "$USE_VENV" == "yes" ]]; then
  if [[ ! -d "$VENV_PATH" ]]; then
    log "Creating venv at $VENV_PATH (using $BOOT_PY)"
    "$BOOT_PY" -m venv "$VENV_PATH" \
      || die "Failed to create venv at $VENV_PATH (try: sudo apt install python3-venv python3-full)"
    ok "venv created"
  else
    ok "venv already exists at $VENV_PATH"
  fi
  PY="$VENV_PATH/bin/python"
  [[ -x "$PY" ]] || die "venv interpreter not found at $PY"
  # Make sure pip itself is fresh inside the venv
  "$PY" -m pip install --quiet --upgrade pip >/dev/null 2>&1 || warn "Could not upgrade pip inside venv (continuing)"
else
  PY="$BOOT_PY"
  if [[ "$IS_EXTERNALLY_MANAGED" == "1" ]]; then
    warn "PEP 668: system Python is externally managed. Using --break-system-packages."
    warn "  Recommended instead: rerun without --no-venv to install into a venv."
    PIP_EXTRA+=(--break-system-packages)
  fi
  if [[ -z "${VIRTUAL_ENV:-}" && -z "${CONDA_PREFIX:-}" && "$IS_EXTERNALLY_MANAGED" != "1" ]]; then
    warn "No virtualenv / conda env detected — installing into the current Python."
    warn "  If that's not what you want, rerun with: --venv ~/.venvs/omnivoice"
  fi
fi

PIP=("$PY" -m pip)

PY_VERSION="$("$PY" --version 2>&1 || true)"
PY_PATH="$(command -v "$PY" || echo "$PY")"
PY_PREFIX="$("$PY" -c 'import sys; print(sys.prefix)' 2>/dev/null || echo "?")"

ok "install python  : $PY_PATH ($PY_VERSION)"
ok "prefix         : $PY_PREFIX"

# -------- step 2: uninstall existing --------
if [[ "$DO_UNINSTALL" == "1" ]]; then
  step "Removing any existing omnivoice / omnivoice-server"
  "${PIP[@]}" uninstall "${PIP_EXTRA[@]}" -y "$OMNI_LIB_PYPI"    >/dev/null 2>&1 && ok "removed $OMNI_LIB_PYPI"    || ok "$OMNI_LIB_PYPI was not installed"
  "${PIP[@]}" uninstall "${PIP_EXTRA[@]}" -y "$OMNI_SERVER_PYPI" >/dev/null 2>&1 && ok "removed $OMNI_SERVER_PYPI" || ok "$OMNI_SERVER_PYPI was not installed"
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
"${PIP[@]}" install "${PIP_EXTRA[@]}" --no-cache-dir --upgrade "$LIB_SRC" \
  || die "Failed to install omnivoice from $LIB_SRC"
ok "omnivoice installed"

if [[ "$INSTALL_SERVER" == "1" ]]; then
  log "omnivoice-server ← $SERVER_SRC"
  "${PIP[@]}" install "${PIP_EXTRA[@]}" --no-cache-dir --upgrade "$SERVER_SRC" \
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
#
# The actual `tensor_to_wav_bytes` (the function we care about) lives in the
# *server* package, not the library:
#
#   omnivoice_server/utils/audio.py      ← the one that matters (PCM_16 fix)
#   omnivoice/utils/audio.py             ← library helper, unrelated
#
# We try the server module first, fall back to the library only if the server
# isn't installed (--library-only).
CANARY_PATH=""
CANARY_SOURCE=""
for mod in omnivoice_server.utils.audio omnivoice.utils.audio; do
  p="$("$PY" -c "import $mod as a; print(a.__file__)" 2>/dev/null || true)"
  if [[ -n "$p" && -f "$p" ]]; then
    CANARY_PATH="$p"
    CANARY_SOURCE="$mod"
    break
  fi
done

if [[ -z "$CANARY_PATH" ]]; then
  fail "Neither omnivoice_server.utils.audio nor omnivoice.utils.audio could be located"
  VERIFY_FAILED=1
else
  if grep -q 'PCM_16' "$CANARY_PATH"; then
    ok "audio.py WAV-fix canary OK (PCM_16 present in $CANARY_SOURCE)"
    printf "${C_DIM}     %s${C_RESET}\n" "$CANARY_PATH"
  else
    fail "audio.py is MISSING the 'PCM_16' marker — WAV output will likely be broken"
    printf "${C_DIM}     %s  (module: %s)${C_RESET}\n" "$CANARY_PATH" "$CANARY_SOURCE"
    warn "  Upstream may have regressed the fix. Try --pypi, or pin a known-good commit."
    VERIFY_FAILED=1
  fi
fi

# 4c. omnivoice-server CLI
SERVER_BIN=""
if [[ "$INSTALL_SERVER" == "1" ]]; then
  # In a venv the binary lives at $VENV_PATH/bin/omnivoice-server, not on global PATH
  if [[ "$USE_VENV" == "yes" && -x "$VENV_PATH/bin/omnivoice-server" ]]; then
    SERVER_BIN="$VENV_PATH/bin/omnivoice-server"
  elif command -v omnivoice-server >/dev/null 2>&1; then
    SERVER_BIN="$(command -v omnivoice-server)"
  fi

  if [[ -n "$SERVER_BIN" ]]; then
    if "$SERVER_BIN" --help >/dev/null 2>&1; then
      ok "omnivoice-server CLI works ($SERVER_BIN)"
    else
      fail "omnivoice-server is installed but --help failed ($SERVER_BIN)"
      VERIFY_FAILED=1
    fi
  else
    fail "omnivoice-server not found after install"
    if [[ "$USE_VENV" == "yes" ]]; then
      warn "  Activate the venv first:  source $VENV_PATH/bin/activate"
    else
      warn "  Is your venv/conda env activated? Check: which omnivoice-server"
    fi
    VERIFY_FAILED=1
  fi
fi

# -------- step 5: summary --------
step "Summary"

printf "  python           : ${C_BOLD}%s${C_RESET}  (%s)\n" "$PY_VERSION" "$PY_PATH"
if [[ "$USE_VENV" == "yes" ]]; then
  printf "  venv             : ${C_BOLD}%s${C_RESET}\n" "$VENV_PATH"
fi
printf "  omnivoice        : ${C_BOLD}%s${C_RESET}  (from %s)\n" "${OMNI_VERSION:-not installed}" "$LIB_SRC"
if [[ "$INSTALL_SERVER" == "1" && -n "$SERVER_BIN" ]]; then
  SERVER_VERSION="$("$SERVER_BIN" --version 2>/dev/null | head -n1 || echo "?")"
  printf "  omnivoice-server : ${C_BOLD}%s${C_RESET}  (from %s)\n" "$SERVER_VERSION" "$SERVER_SRC"
fi

echo
if [[ "$VERIFY_FAILED" == "0" ]]; then
  printf "${C_GREEN}${C_BOLD}✓ Installation OK${C_RESET}\n"
  echo
  echo "Next steps:"
  if [[ "$USE_VENV" == "yes" ]]; then
    echo "  source $VENV_PATH/bin/activate    # activate the venv in your shell"
    echo "  ./scripts/dev-omnivoice.sh           # start server + Vite (dev mode)"
  else
    echo "  ./scripts/dev-omnivoice.sh           # start server + Vite (dev mode)"
    echo "  ./scripts/dev-omnivoice.sh --prod    # test against published booker-studio"
  fi
  exit 0
else
  printf "${C_RED}${C_BOLD}✗ Installation completed with errors — see above${C_RESET}\n"
  echo
  echo "Common fixes:"
  echo "  - Use a venv (recommended on Ubuntu 24.04+):"
  echo "      ./scripts/install-omnivoice.sh --venv ~/.venvs/omnivoice"
  echo "  - Pick a specific Python:"
  echo "      ./scripts/install-omnivoice.sh --python python3.14 --venv ~/.venvs/omnivoice"
  echo "  - Try the stable PyPI build:  ./scripts/install-omnivoice.sh --pypi"
  echo "  - Inspect the canary file manually:"
  echo "      $PY -c 'import omnivoice.utils.audio as a; print(a.__file__)'"
  exit 1
fi
