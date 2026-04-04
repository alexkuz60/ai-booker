/**
 * usePipelineProgress — reads/writes pipeline progress from project.json.
 *
 * Single source of truth for all readiness checks in the app.
 * Auto-detect flags are written here by the respective modules
 * (Parser writes toc_extracted, Studio writes storyboard_done, etc.)
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ProjectStorage, PipelineProgress, PipelineStepId } from "@/lib/projectStorage";
import { sanitizeProjectMeta } from "@/lib/projectStorage";
import { createEmptyPipelineProgress } from "@/lib/projectStorage";

const PROJECT_META_READ_RETRY_MS = 30;

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

async function readProjectMetaForWrite(
  storage: ProjectStorage,
): Promise<Record<string, unknown> | null> {
  const first = await storage.readJSON<Record<string, unknown>>("project.json");
  if (first) return first;

  // OPFS can briefly return null during concurrent writes; retry once.
  await new Promise<void>((resolve) => {
    setTimeout(resolve, PROJECT_META_READ_RETRY_MS);
  });

  return await storage.readJSON<Record<string, unknown>>("project.json");
}

export function usePipelineProgress(
  storage: ProjectStorage | null | undefined,
  /** Optional version counter — bump to force re-read from OPFS */
  version?: number,
): UsePipelineProgressReturn {
  const [progress, setProgress] = useState<PipelineProgress>(createEmptyPipelineProgress);
  const [loading, setLoading] = useState(true);
  const loadedRef = useRef(false);
  const storageRef = useRef(storage);
  storageRef.current = storage;

  // Load from project.json on mount / storage change / version bump
  useEffect(() => {
    loadedRef.current = false;
    if (!storage) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const repaired = await readPipelineProgress(storage);
        if (cancelled) return;
        setProgress(repaired);
        loadedRef.current = true;
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
    if (!loadedRef.current) {
      console.warn("[PipelineProgress] persist skipped — initial load not finished yet");
      return;
    }
    try {
      const meta = await readProjectMetaForWrite(s);
      if (!meta) {
        console.warn("[PipelineProgress] persist skipped — project.json unreadable, refusing destructive overwrite");
        return;
      }

      // Merge: never overwrite OPFS progress with stale React state
      const existing = (meta.pipelineProgress as PipelineProgress) ?? {};
      await s.writeJSON("project.json", sanitizeProjectMeta({
        ...meta,
        pipelineProgress: { ...existing, ...updated },
        updatedAt: new Date().toISOString(),
      }));
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
    return { ...createEmptyPipelineProgress(), ...saved };
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
    const meta = await readProjectMetaForWrite(storage);
    if (!meta) {
      console.warn("[PipelineProgress] writePipelineStep skipped — project.json unreadable, refusing destructive overwrite");
      return;
    }

    // Always merge with defaults to avoid losing keys
    const progress = { ...createEmptyPipelineProgress(), ...((meta.pipelineProgress as PipelineProgress) ?? {}) };
    progress[stepId] = done;
    await storage.writeJSON("project.json", sanitizeProjectMeta({
      ...meta,
      pipelineProgress: progress,
      updatedAt: new Date().toISOString(),
    }));
  } catch (e) {
    console.error("[PipelineProgress] writePipelineStep failed:", e);
  }
}
