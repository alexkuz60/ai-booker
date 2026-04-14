# CLAUDE.md — Critical Rules for AI Assistants

> This file is the **first line of defense** against AI-induced data loss.
> Every AI model working with this codebase MUST read and follow these rules.
> Last updated: 2026-04-13.

---

## 🚨 ABSOLUTE BANS

### 1. NO AUTO-DELETE — EVER
- **NEVER** add code that automatically deletes files, folders, or directories in OPFS.
- No "stale cleanup", no "orphan pruning", no "zombie removal", no "sanitization" that calls `storage.delete()` or `removeEntry()`.
- The ONLY way to delete files inside a project is through `guardedDelete()` from `src/lib/storageGuard.ts`, which enforces a strict whitelist.
- `syncStructureToLocal()` in `src/lib/localSync.ts` is **write-only** — it MUST NEVER call `storage.delete()`.
- Whole-project deletion (`OPFSStorage.deleteProject()`) is allowed ONLY in these user-initiated flows:
  - Explicit "Delete" button click
  - "Clear all projects" button click
  - Wipe-and-Deploy (which creates a ZIP snapshot first via `snapshotBeforeWipe()`)

### 2. NO DB CONTENT FALLBACK
- OPFS is the **sole source of truth** at runtime.
- Never read scene content, storyboard segments, phrases, audio metadata, or voice configs from Supabase DB at runtime.
- Edge Functions receive ALL required data (segments, phrases, scene metadata) from the client request body — they do NOT query DB content tables.
- If OPFS is empty — show empty state. Never query DB for content.
- DB is backup only, written to by explicit "Push to Server" button.
- DB is read ONLY during Wipe-and-Deploy (full project restore from server to new device).

### 3. NO AUTO-GENERATED FILES EDITING
- Never edit: `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, `supabase/config.toml`, `.env`

### 4. NO `openOrCreate` — EVER
- `OPFSStorage.openOrCreate()` is **permanently removed**. Any attempt to re-introduce it is a bug.
- Use the three dedicated functions instead (see OPFS Initialization below).

---

## 🛡️ Data Protection Infrastructure

### storageGuard.ts (`src/lib/storageGuard.ts`)
- `guardedDelete(storage, path, caller)` — whitelist-only delete. Blocks and logs unauthorized attempts.
- `snapshotBeforeWipe(storage, bookId)` — creates ZIP backup before any destructive operation.
- `assertIntegrity(storage, operation)` — post-operation check that critical files survived.
- `getDestructiveJournal()` — in-memory log of all delete attempts (allowed and blocked).

### Whitelist (what CAN be deleted inside a project):
- `chapters/{ch}/scenes/{sc}/storyboard.json` (re-analysis)
- `chapters/{ch}/scenes/{sc}/audio/**` (re-synthesis)
- `chapters/{ch}/scenes/{sc}/{lang}/storyboard.json` (re-translation)
- `chapters/{ch}/scenes/{sc}/{lang}/radar-*.json` (re-evaluation)
- Legacy: `chapters/{ch}/scenes/{sc}/{lang}/audio_meta.json|clip_plugins.json|mixer_state.json` (cleanup)

### Protected files (NEVER deletable via guardedDelete):
- `project.json`, `characters.json`, `structure/*`, `synopsis/*`
- `audio_meta.json`, `clip_plugins.json`, `mixer_state.json`
- `content.json` (chapter text)
- Any whole directory (chapters/, scenes/)

---

## 📐 Architecture Contracts

### LOCAL-ONLY (not local-first)
- OPFS = only source of truth at runtime.
- Supabase = backup only, via "Push to Server" button.
- No runtime data mixing from cloud into local.

### OPFS Initialization — Three Functions (NO `openOrCreate`)

| Function | Purpose | When to use |
|----------|---------|-------------|
| `OPFSStorage.createNewProject(name)` | Creates new project, builds `ROOT_DIRS` from `bookTemplateOPFS.ts` | User uploads a book, creates new project |
| `OPFSStorage.openExisting(name)` | Opens existing project read-only, returns `null` if missing | Scan, search, bootstrap, library |
| `OPFSStorage.restoreProjectFromBackup(name, zip)` | Wipes existing folder, imports ZIP contents | Import from ZIP file |

**Architectural test** (`architecturalInvariants.test.ts`) enforces:
- `openOrCreate` must not exist anywhere in the codebase
- `createNewProject` only from `useProjectStorage.ts`
- `restoreProjectFromBackup` only from `useProjectStorage.ts`, `serverDeploy.ts`, `useBookRestore.ts`

### Wipe-and-Deploy Protocol
When restoring from server (`openSavedBook`):
1. `snapshotBeforeWipe()` — ZIP backup of existing project
2. Full OPFS folder deletion (`wipeProjectBrowserState`)
3. Browser state cleanup (sessionStorage, localStorage, in-memory caches)
4. `createProject()` — create fresh OPFS project (via `createNewProject`)
5. `deployFromServer()` — write ALL data from server
6. `assertIntegrity()` — verify critical files exist
7. Only then — update React state

**FORBIDDEN**: incremental merge, partial replacement, runtime DB supplementation, `ensureWritableLocalStorage` (removed).

### Data Integrity Invariants
- bookId is immutable — generated once at import, never changes.
- Scene IDs are unstable — dependents (storyboards, character maps) must update on TOC change.
- Character data must exist in both top-level CharacterIndex fields AND nested `profile` object.
- Translation languages tracked ONLY in `project.json.translationLanguages[]` — no external links.

---

## 📁 Project Folder Structure (V2)

**Single source of truth**: `src/lib/bookTemplateOPFS.ts` — all default values and directory hierarchy.

```
{project-name}/
├── project.json          — metadata, translationLanguages[]
├── characters.json       — character registry (source of truth)
├── book_map.json         — precomputed path map (chapters/scenes)
├── scene_index.json      — sceneId→chapterId mapping
├── synopsis/             — book/chapter/scene synopses
├── structure/
│   ├── toc.json          — table of contents
│   └── chapters.json     — chapter ID map
└── chapters/{chapterId}/
    ├── content.json       — chapter text
    ├── renders/           — final chapter renders
    └── scenes/{sceneId}/
        ├── storyboard.json
        ├── audio_meta.json
        ├── clip_plugins.json
        ├── mixer_state.json
        ├── characters.json
        ├── atmospheres.json   — { sceneId, updatedAt, atmo: [], sfx: [] }
        ├── tts/               — synthesized TTS clips
        ├── audio/atmosphere/  — atmosphere audio layers
        └── {lang}/            — translation subdirectories (text only, no audio)
            ├── storyboard.json
            └── radar-*.json
```

---

## 🔧 Key Files Reference

| Purpose | File |
|---------|------|
| **OPFS structure template (SSOT)** | `src/lib/bookTemplateOPFS.ts` |
| Storage guard (delete protection) | `src/lib/storageGuard.ts` |
| Local sync (write-only!) | `src/lib/localSync.ts` |
| Project cleanup (wipe) | `src/lib/projectCleanup.ts` |
| Server deploy (restore) | `src/lib/serverDeploy.ts` |
| Book restore hook | `src/hooks/useBookRestore.ts` |
| Project storage API | `src/lib/projectStorage.ts` |
| Path resolver | `src/lib/projectPaths.ts` |
| Book map (precomputed paths) | `src/lib/bookMap.ts` |
| Voice matching helpers | `src/lib/voiceMatching.ts` |
| VC pipeline orchestrator | `src/lib/vcPipeline.ts` |
| VC model OPFS cache | `src/lib/vcModelCache.ts` |
| VC ONNX session manager | `src/lib/vcInferenceSession.ts` |
| VC RMS normalization | `src/lib/vcNormalize.ts` |
| VC WavLM encoder | `src/lib/vcWavLM.ts` |
| VC ContentVec encoder | `src/lib/vcContentVec.ts` |
| Reusable slider component | `src/components/ui/SliderField.tsx` |
| Architecture docs | `ARCHITECTURE.md` |
| Known problems | `PROBLEMS.md` |
| Strategic plan | `STRATEGY.md` |

---

## 🎤 VC Pipeline Contracts

- **Core models** (ContentVec, CREPE Tiny, RVC v2) are required for Booker Pro activation.
- **Pitch models** (CREPE Full, SwiftF0, RMVPE) are optional, downloaded on demand.
- **Encoder models** (WavLM-Base-Plus INT8) are optional, recommended for expressive TTS.
- Pipeline stages: resample → **RMS normalize** → encoder (ContentVec|WavLM) → pitch (F0) → RVC v2 → WAV.
- RMS normalization targets -23 dBFS with soft ceiling limiter at -1 dBFS.
- `SpeechEncoder` type: `"contentvec" | "wavlm"` — stored in `voice_config.vc_encoder`.
- WavLM-Base-Plus outputs 768-dim embeddings — drop-in compatible with RVC v2 decoder.
- RMVPE mel-spectrogram input tensor MUST be padded to a multiple of 32 frames (`PAD_MULTIPLE = 32`).
- All ONNX sessions are cached; on backend switch call `releaseAllVcSessions()`.
- Model cache lives in OPFS `vc-models/` directory, emits `VC_MODEL_CACHE_EVENT` on change.
- UI components: `BookerProSection` (profile), `GpuStatusCard`, `ModelDownloadPanel`, `VoiceConversionTab` (narrators).

---

## ⚠️ Before Making Changes

1. Read `ARCHITECTURE.md` for full context.
2. Read `PROBLEMS.md` for known issues and past mistakes.
3. Run `grep -r "storage.delete" src/` — verify no new unguarded deletes.
4. Run `grep -r "openOrCreate" src/` — must return zero matches in non-test files.
5. Run tests: `npx vitest run src/lib/__tests__/storageGuard.test.ts`
6. Run tests: `npx vitest run src/lib/__tests__/architecturalInvariants.test.ts`
7. After changes: verify build passes (`npx vite build`).