# CLAUDE.md — Critical Rules for AI Assistants

> This file is the **first line of defense** against AI-induced data loss.
> Every AI model working with this codebase MUST read and follow these rules.
> Last updated: 2026-04-03.

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
- Never read scene content, storyboard segments, or phrases from Supabase DB at runtime.
- If OPFS is empty — show empty state. Never query DB for content.
- DB is backup only, written to by explicit "Push to Server" button.

### 3. NO AUTO-GENERATED FILES EDITING
- Never edit: `src/integrations/supabase/client.ts`, `src/integrations/supabase/types.ts`, `supabase/config.toml`, `.env`

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
- `chapters/{ch}/scenes/{sc}/{lang}/audio/**` (re-TTS in target language)

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

### Wipe-and-Deploy Protocol
When restoring from server (`openSavedBook`, `acceptServerVersion`):
1. `snapshotBeforeWipe()` — ZIP backup of existing project
2. Full OPFS folder deletion
3. Browser state cleanup (sessionStorage, localStorage, in-memory caches)
4. Create clean OPFS project
5. Write ALL data from server
6. `assertIntegrity()` — verify critical files exist
7. Only then — update React state

**FORBIDDEN**: incremental merge, partial replacement, runtime DB supplementation.

### OPFS Hygiene
- `OPFSStorage.openOrCreate()` — ONLY for: createProject, importZip, createTranslationProject, restoreTranslation.
- All read/scan operations MUST use `openExisting()` to prevent zombie directories.

### Data Integrity Invariants
- bookId is immutable — generated once at import, never changes.
- Scene IDs are unstable — dependents (storyboards, character maps) must update on TOC change.
- Character data must exist in both top-level CharacterIndex fields AND nested `profile` object.
- Translation languages tracked ONLY in `project.json.translationLanguages[]` — no external links.

---

## 📁 Project Folder Structure (V2)

```
{project-name}/
├── project.json          — metadata, translationLanguages[]
├── characters.json       — character registry (source of truth)
├── synopsis/             — book/chapter/scene synopses
├── structure/
│   ├── toc.json          — table of contents
│   └── chapters.json     — chapter ID map
└── chapters/{chapterId}/
    ├── content.json       — chapter text
    └── scenes/{sceneId}/
        ├── storyboard.json
        ├── audio_meta.json
        ├── clip_plugins.json
        ├── mixer_state.json
        ├── audio/tts/        — TTS audio files
        ├── audio/atmosphere/  — atmosphere layers
        ├── audio/renders/     — final scene renders
        └── {lang}/            — translation subdirectories
            ├── storyboard.json
            ├── radar-*.json
            └── audio/tts/
```

---

## 🔧 Key Files Reference

| Purpose | File |
|---------|------|
| Storage guard (delete protection) | `src/lib/storageGuard.ts` |
| Local sync (write-only!) | `src/lib/localSync.ts` |
| Project cleanup (wipe) | `src/lib/projectCleanup.ts` |
| Server deploy (restore) | `src/lib/serverDeploy.ts` |
| Book restore hook | `src/hooks/useBookRestore.ts` |
| Project storage API | `src/lib/projectStorage.ts` |
| Architecture docs | `ARCHITECTURE.md` |
| Known problems | `PROBLEMS.md` |
| Strategic plan | `STRATEGY.md` |

---

## ⚠️ Before Making Changes

1. Read `ARCHITECTURE.md` for full context.
2. Read `PROBLEMS.md` for known issues and past mistakes.
3. Run `grep -r "storage.delete" src/` — verify no new unguarded deletes.
4. Run tests: `npx vitest run src/lib/__tests__/storageGuard.test.ts`
5. After changes: verify build passes (`npx vite build`).