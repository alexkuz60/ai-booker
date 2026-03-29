/**
 * radarCache — module-level caches for Quality Radar data.
 *
 * Centralizes all in-memory caching for radar scores, computed results,
 * and stage files. Provides invalidation mechanism via listener pattern.
 */

import type { RadarScores } from "@/lib/qualityRadar";
import type { StageRadarFile, CritiqueRadarFile } from "@/lib/radarStages";
import { useEffect, useState } from "react";

// ── Module-level caches ─────────────────────────────────────────

/** Per-scene legacy radar.json cache */
export const radarCache = new Map<string, {
  segments: { segmentId: string; radar: RadarScores; critiqueNotes?: string[] }[];
}>();

/** Per-segment computed scores (survives remount within session) */
export const computedCache = new Map<string, { scores: RadarScores; notes: string[] }>();

/** Per-scene staged radar files cache */
export const stageCache = new Map<string, {
  literal: StageRadarFile | null;
  literary: StageRadarFile | null;
  critique: CritiqueRadarFile | null;
}>();

// ── Invalidation ────────────────────────────────────────────────

const invalidationListeners = new Set<() => void>();

function emitInvalidation() {
  invalidationListeners.forEach((fn) => fn());
}

/**
 * Invalidate caches for a scene so the monitor re-reads from storage.
 * If segmentId is provided, only that segment's computed cache is cleared.
 */
export function invalidateRadarCache(sceneId: string, segmentId?: string) {
  stageCache.delete(sceneId);
  radarCache.delete(sceneId);
  if (segmentId) {
    computedCache.delete(`${sceneId}:${segmentId}`);
  } else {
    for (const key of computedCache.keys()) {
      if (key.startsWith(`${sceneId}:`)) computedCache.delete(key);
    }
  }
  emitInvalidation();
}

/**
 * React hook: returns a revision counter that increments on every invalidation.
 * Components using this will re-render and re-fetch data.
 */
export function useRadarInvalidationRevision(): number {
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const listener = () => setRevision((c) => c + 1);
    invalidationListeners.add(listener);
    return () => { invalidationListeners.delete(listener); };
  }, []);

  return revision;
}

// ── Normalize helper ────────────────────────────────────────────

/** Normalize radar scores: if any axis > 1, assume 0-100 scale and convert to 0-1 */
export function normalizeRadar(radar: RadarScores): RadarScores {
  const axes: (keyof RadarScores)[] = ["semantic", "sentiment", "rhythm", "phonetic", "cultural", "weighted"];
  const needsNorm = axes.some(a => radar[a] > 1);
  if (!needsNorm) return radar;
  const norm: RadarScores = { ...radar };
  for (const a of axes) {
    norm[a] = Math.max(0, Math.min(1, radar[a] / 100));
  }
  return norm;
}
