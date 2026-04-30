---
name: External Repo Protocol
description: Rules for working with external/upstream repos (e.g. booker-gpu-server) without breaking Lovable's local project state
type: constraint
---

# Protocol: External Repositories & Lovable Sync

**Why:** Lovable's internal project snapshot does not reliably track files added to GitHub via external Git pushes. Mixing non-web code (Python/CUDA/models) into the Lovable project causes:
- Files silently disappearing between sessions
- Sync conflicts on publish
- GitHub repo duplication (new repo with web-only files auto-created)
- Unpredictable conflicts when AI copies code from upstream public repos into the Lovable project ("third-copy drift")

## Three file types — three different homes

### 1. Contract files — live INSIDE Lovable project
- API contracts, JSON schemas, TypeScript types describing server I/O
- Location: `docs/api-contract.md`, `src/types/server-api.ts`
- Owned by Lovable, consumed by both sides

### 2. Server code (Python/CUDA/ComfyUI/models) — NEVER inside Lovable project
- Lives in a SEPARATE GitHub repo (e.g. `booker-gpu-server`)
- Managed locally via IDE + Git, not via Lovable
- Lovable AI may help design/generate code, but does NOT own the repo

### 3. Research / upstream references — ONLY as markdown excerpts
- When reading code from a public upstream repo (e.g. ComfyUI, omnivoice), do NOT copy `.py`/`.ts` source files into `src/`
- Save findings as markdown notes under `.lovable/research/{topic}.md` with quoted snippets + source URL + commit SHA
- This prevents the "third-copy drift" problem (upstream + user's local clone + Lovable copy all diverging)

## How to apply
- If user asks to "look at file X in repo Y" → read it, summarize in `.lovable/research/`, never mirror it under `src/`
- If user wants server-side feature → design contract in Lovable, implement server code in the separate repo
- Communication between Booker Studio (Lovable) and booker-gpu-server is HTTP/WebSocket via the documented contract

## Forbidden
- Copying Python files into the Lovable project
- Mirroring upstream source trees under `src/` for "convenience"
- Pretending Lovable can manage a non-Vite/non-React repo
