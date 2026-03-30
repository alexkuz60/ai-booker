/**
 * usePipelineProgress — reads/writes pipeline progress from project.json.
 *
 * Single source of truth for all readiness checks in the app.
 * Auto-detect flags are written here by the respective modules
 * (Parser writes toc_extracted, Studio writes storyboard_done, etc.)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectStorage, PipelineProgress, PipelineStepId } from "@/lib/projectStorage";
import { createEmptyPipelineProgress } from "@/lib/projectStorage";

interface UsePipelineProgressReturn {
  progress: PipelineProgress;
  /** Set a single step's done status and persist to project.json */
  setStep: (stepId: PipelineStepId, done: boolean) => Promise<void>;
  /** Batch-set multiple steps */
  setSteps: (updates: Partial<Record<PipelineStepId, boolean>>) => Promise<void>;
  /** Check if a step is done */
  isDone: (stepId: PipelineStepId) => boolean;
  /** Loading state */
  loading: boolean;
}

export function usePipelineProgress(
  storage: ProjectStorage | null | undefined,
  /** Optional version counter — bump to force re-read from OPFS */
  version?: number,
): UsePipelineProgressReturn {
  const [progress, setProgress] = useState<PipelineProgress>(createEmptyPipelineProgress);
  const [loading, setLoading] = useState(true);
  const storageRef = useRef(storage);
  storageRef.current = storage;

  // Load from project.json on mount / storage change / version bump
  useEffect(() => {
    if (!storage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const meta = await storage.readJSON<Record<string, unknown>>("project.json");
        if (cancelled) return;
        const saved = (meta?.pipelineProgress as PipelineProgress) ?? {};
        setProgress(prev => ({ ...createEmptyPipelineProgress(), ...saved }));
      } catch {
        // project.json missing — use defaults
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [storage, version]);

  const persist = useCallback(async (updated: PipelineProgress) => {
    const s = storageRef.current;
    if (!s) return;
    try {
      const meta = (await s.readJSON<Record<string, unknown>>("project.json")) ?? {};
      meta.pipelineProgress = updated;
      meta.updatedAt = new Date().toISOString();
      await s.writeJSON("project.json", meta);
    } catch (e) {
      console.error("[PipelineProgress] Failed to persist:", e);
    }
  }, []);

  const setStepFn = useCallback(async (stepId: PipelineStepId, done: boolean) => {
    setProgress(prev => {
      const next = { ...prev, [stepId]: done };
      persist(next);
      return next;
    });
  }, [persist]);

  const setStepsFn = useCallback(async (updates: Partial<Record<PipelineStepId, boolean>>) => {
    setProgress(prev => {
      const next = { ...prev, ...updates };
      persist(next);
      return next;
    });
  }, [persist]);

  const isDone = useCallback((stepId: PipelineStepId) => !!progress[stepId], [progress]);

  return { progress, setStep: setStepFn, setSteps: setStepsFn, isDone, loading };
}

// ─── Standalone helpers (for use outside React) ──────────

/** Read pipeline progress from project.json directly */
export async function readPipelineProgress(storage: ProjectStorage): Promise<PipelineProgress> {
  try {
    const meta = await storage.readJSON<Record<string, unknown>>("project.json");
    const saved = (meta?.pipelineProgress as PipelineProgress) ?? {};
    const progress = { ...createEmptyPipelineProgress(), ...saved };

    // Auto-infer obvious flags for legacy projects that pre-date pipelineProgress
    let patched = false;

    // If project.json exists, project was created and file was uploaded
    if (meta && !progress.file_uploaded) {
      progress.file_uploaded = true;
      patched = true;
    }
    if (meta && !progress.opfs_created) {
      progress.opfs_created = true;
      patched = true;
    }

    // Infer characters_extracted from characters.json existence
    if (!progress.characters_extracted) {
      try {
        const chars = await storage.readJSON<unknown[]>("characters.json");
        if (Array.isArray(chars) && chars.length > 0) {
          progress.characters_extracted = true;
          patched = true;
        }
      } catch {}

      // Legacy fallback: structure/characters.json
      if (!progress.characters_extracted) {
        try {
          const legacyChars = await storage.readJSON<unknown[]>("structure/characters.json");
          if (Array.isArray(legacyChars) && legacyChars.length > 0) {
            progress.characters_extracted = true;
            patched = true;
          }
        } catch {}
      }
    }

    // Infer profiles_done from enriched character fields
    if (!progress.profiles_done) {
      try {
        const chars = await storage.readJSON<any[]>("characters.json");
        if (Array.isArray(chars) && chars.some((c) =>
          !!c?.profile ||
          !!c?.temperament ||
          !!c?.speech_style ||
          (Array.isArray(c?.psycho_tags) && c.psycho_tags.length > 0) ||
          (Array.isArray(c?.speech_tags) && c.speech_tags.length > 0) ||
          !!c?.description,
        )) {
          progress.profiles_done = true;
          patched = true;
        }
      } catch {}
    }

    // Infer storyboard_done from scene_index.storyboarded
    if (!progress.storyboard_done) {
      try {
        const idx = await storage.readJSON<{ storyboarded?: string[] }>("scene_index.json");
        if (Array.isArray(idx?.storyboarded) && idx.storyboarded.length > 0) {
          progress.storyboard_done = true;
          patched = true;
        }
      } catch {}
    }

    // Persist repaired progress so the fix is permanent
    if (patched) {
      try {
        const freshMeta = (await storage.readJSON<Record<string, unknown>>("project.json")) ?? {};
        freshMeta.pipelineProgress = progress;
        freshMeta.updatedAt = new Date().toISOString();
        await storage.writeJSON("project.json", freshMeta);
        console.info("[PipelineProgress] Auto-repaired flags for project:", storage.projectName);
      } catch (e) {
        console.warn("[PipelineProgress] Failed to persist auto-repair:", e);
      }
    }

    return progress;
  } catch {
    return createEmptyPipelineProgress();
  }
}

/** Write a single pipeline step to project.json */
export async function writePipelineStep(
  storage: ProjectStorage,
  stepId: PipelineStepId,
  done: boolean,
): Promise<void> {
  try {
    const meta = (await storage.readJSON<Record<string, unknown>>("project.json")) ?? {};
    // Always merge with defaults to avoid losing keys
    const progress = { ...createEmptyPipelineProgress(), ...((meta.pipelineProgress as PipelineProgress) ?? {}) };
    progress[stepId] = done;
    meta.pipelineProgress = progress;
    meta.updatedAt = new Date().toISOString();
    await storage.writeJSON("project.json", meta);
  } catch (e) {
    console.error("[PipelineProgress] writePipelineStep failed:", e);
  }
}
