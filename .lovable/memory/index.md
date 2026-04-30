---
name: index
description: Memory index
type: reference
---

# Project Memory

## Core
- OPFS-First & Local-Only: OPFS is the Single Source of Truth. Supabase DB is only for Wipe-and-Deploy backups.
- Contract K3 (No DB Fallback): Edge functions strictly use OPFS data via client requests. NO Supabase DB queries at runtime.
- Contract K4 (State Isolation): Project text/profiles NEVER in localStorage/sessionStorage. UI state stays in localStorage.
- Edit-Only Policy: Runtime modules only modify existing JSONs. Creation/structure changes strictly follow `bookTemplateOPFS.ts`.
- Platform Scope: Desktop Chromium strictly targeted. No mobile support. WebGPU required for Pro features.
- Audio Standard: 44.1 kHz / 16-bit WAV strictly required for all TTS, Voice Conversion, and renders.
- User Completion Authority: Only users set "Done" flags. Automation never overrides manual completion.
- Zero Legacy Policy: No V1 fallbacks, migrations, or mixed architectures. Fail-fast on corruption.
- External Repos: Server code (Python/CUDA) lives in separate GitHub repos, NEVER inside Lovable project. Upstream source = markdown excerpts in `.lovable/research/` only, never mirrored under `src/`.

## Memories
- [External Repo Protocol](mem://tech/policy/external-repo-protocol) — Three file types (contracts/server/research), prevents third-copy drift and Lovable sync conflicts
