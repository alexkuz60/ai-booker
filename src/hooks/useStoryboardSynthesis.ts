/**
 * useStoryboardSynthesis — TTS synthesis logic extracted from StoryboardPanel.
 *
 * Responsibilities:
 * - Adaptive batching (≤20 segments / ≤3000 chars)
 * - SSML length pre-validation (Yandex v1 limit 4900)
 * - NDJSON streaming + incremental OPFS save
 * - Per-segment re-synthesis
 */

import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { buildVoiceConfigsPayload } from "@/lib/voiceConfigPayload";
import { resolveProvider, type TtsProvider } from "@/components/studio/phraseAnnotations";
import type { Segment, CharacterOption } from "@/components/studio/storyboard/types";
import type { ProjectStorage } from "@/lib/projectStorage";

// ── Yandex v1 voices that are NOT v3 ──
const V3_ONLY = new Set([
  "dasha","julia","lera","masha","alexander","kirill","anton",
  "saule_ru","zamira_ru","zhanar_ru","yulduz_ru",
  "naomi","saule","zhanar","zamira","yulduz",
]);

const YANDEX_V1_MAX = 4900;

export interface SynthResult {
  segment_id: string;
  status: string;
  duration_ms: number;
  audio_base64?: string;
  voice_config?: Record<string, unknown>;
  error?: string;
  inline_narrations?: Array<{
    text: string;
    insert_after: string;
    audio_base64: string;
    duration_ms: number;
    offset_ms: number;
  }>;
  phrase_results?: Array<{
    phrase_index: number;
    audio_base64: string;
    duration_ms: number;
  }>;
}

interface UseStoryboardSynthesisParams {
  sceneId: string | null;
  chapterId?: string | null;
  segments: Segment[];
  characters: CharacterOption[];
  isRu: boolean;
  projectStorage: ProjectStorage | null;
  mergeChecked: Set<string>;
  saveSynthResultsToOpfs: (results: SynthResult[]) => Promise<void>;
  onSegmented?: (sceneId: string) => void;
  onSynthesizingChange?: (ids: Set<string>) => void;
  onErrorSegmentsChange?: (ids: Set<string>) => void;
  setMergeChecked: (ids: Set<string>) => void;
}

export function useStoryboardSynthesis({
  sceneId, chapterId, segments, characters, isRu, projectStorage,
  mergeChecked, saveSynthResultsToOpfs,
  onSegmented, onSynthesizingChange, onErrorSegmentsChange, setMergeChecked,
}: UseStoryboardSynthesisParams) {
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthProgress, setSynthProgress] = useState("");
  const [resynthSegId, setResynthSegId] = useState<string | null>(null);
  const [currentlySynthesizingIds, setCurrentlySynthesizingIds] = useState<Set<string>>(new Set());
  const synthIdsRef = useRef<Set<string>>(new Set());
  synthIdsRef.current = currentlySynthesizingIds;

  // ── Adaptive batching ──
  const buildAdaptiveBatches = useCallback((segs: Segment[]) => {
    const MAX_PER_BATCH = 20;
    const MAX_CHARS = 3000;
    const batches: Segment[][] = [];
    let current: Segment[] = [];
    let currentChars = 0;
    for (const seg of segs) {
      const chars = seg.phrases.reduce((s, p) => s + p.text.length, 0);
      if (current.length > 0 && (current.length >= MAX_PER_BATCH || currentChars + chars > MAX_CHARS)) {
        batches.push(current);
        current = [];
        currentChars = 0;
      }
      current.push(seg);
      currentChars += chars;
    }
    if (current.length > 0) batches.push(current);
    return batches;
  }, []);

  // ── SSML pre-validation ──
  const validateSsmlLength = useCallback((targetSegments: Segment[]): string[] => {
    const tooLong: string[] = [];
    for (const seg of targetSegments) {
      const hasAnnot = seg.phrases.some(p => (p.annotations?.length ?? 0) > 0);
      const isLyric = seg.segment_type === "lyric";
      if (!hasAnnot && !isLyric) continue;

      const speakerKey = (seg.speaker ?? "narrator").toLowerCase();
      const charMatch = characters.find(c => c.name.toLowerCase() === speakerKey);
      const vc = charMatch?.voiceConfig ?? {};
      const provider = (vc as any).provider ?? "yandex";
      const voiceId = (vc as any).voice_id ?? (vc as any).voice ?? "";

      if (provider !== "yandex" || V3_ONLY.has(voiceId)) continue;
      if ((vc as any).pitchShift || (vc as any).volume || (vc as any).role) continue;

      const textLen = seg.phrases.reduce((s, p) => s + p.text.length, 0);
      const annotCount = seg.phrases.reduce((s, p) => s + (p.annotations?.length ?? 0), 0);
      const estimatedSsml = 15 + textLen + annotCount * 35;

      if (estimatedSsml > YANDEX_V1_MAX) {
        const label = seg.speaker || (isRu ? "Рассказчик" : "Narrator");
        tooLong.push(`#${seg.segment_number} (${label}, ~${estimatedSsml} ${isRu ? "симв." : "chars"})`);
      }
    }
    return tooLong;
  }, [characters, isRu]);

  // ── Build segment payload for Edge Function ──
  const buildSynthPayload = useCallback(() => {
    return segments.map(seg => ({
      segment_id: seg.segment_id,
      segment_number: seg.segment_number,
      segment_type: seg.segment_type,
      speaker: seg.speaker,
      metadata: (seg as any).metadata ?? {},
      phrases: seg.phrases.map(p => ({
        phrase_id: p.phrase_id,
        text: p.text,
        annotations: p.annotations ?? [],
      })),
    }));
  }, [segments]);

  // ── Read scene_meta from OPFS ──
  const readSceneMeta = useCallback(async (): Promise<Record<string, unknown> | undefined> => {
    if (!projectStorage || !sceneId || !chapterId) return undefined;
    try {
      const contentData = await projectStorage.readJSON<{
        scenes?: Array<{ id: string; mood?: string; scene_type?: string }>;
      }>(`chapters/${chapterId}/content.json`);
      const sceneData = contentData?.scenes?.find(s => s.id === sceneId);
      if (sceneData) return { mood: sceneData.mood ?? null, scene_type: sceneData.scene_type ?? null };
    } catch { /* ignore */ }
    return undefined;
  }, [projectStorage, sceneId, chapterId]);

  // ── Get auth headers ──
  const getAuthHeaders = useCallback(async () => {
    const { data: session } = await supabase.auth.getSession();
    const token = session?.session?.access_token;
    if (!token) throw new Error("Not authenticated");
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
  }, []);

  // ── Parse NDJSON stream (shared between runSynthesis and resynthSegment) ──
  const parseNdjsonStream = useCallback(async (
    reader: ReadableStreamDefaultReader<Uint8Array>,
    opts: {
      onResult: (obj: any) => Promise<void>;
      onPhrase?: (segId: string, count: number) => void;
    },
  ) => {
    const decoder = new TextDecoder();
    let buffer = "";
    const streamedPhrases = new Map<string, Array<{ phrase_index: number; audio_base64: string; duration_ms: number }>>();

    while (true) {
      const { done, value } = await reader.read();
      if (value) buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const obj = JSON.parse(line);
          if (obj._summary) continue;
          if (obj._phrase_group_start) {
            streamedPhrases.set(obj.segment_id, []);
          } else if (obj._phrase) {
            const phrases = streamedPhrases.get(obj.segment_id) ?? [];
            phrases.push({ phrase_index: obj.phrase_index, audio_base64: obj.audio_base64, duration_ms: obj.duration_ms });
            streamedPhrases.set(obj.segment_id, phrases);
            opts.onPhrase?.(obj.segment_id, phrases.length);
          } else {
            const collectedPhrases = streamedPhrases.get(obj.segment_id);
            if (collectedPhrases && collectedPhrases.length > 0 && obj.status === "ready" && !obj.audio_base64) {
              obj.phrase_results = collectedPhrases;
              streamedPhrases.delete(obj.segment_id);
            }
            await opts.onResult(obj);
          }
        } catch { /* skip malformed lines */ }
      }
      if (done) break;
    }
  }, []);

  // ── Main synthesis ──
  const runSynthesis = useCallback(async () => {
    if (!sceneId || segments.length === 0) return;
    const targetSegments = mergeChecked.size > 0
      ? segments.filter(s => mergeChecked.has(s.segment_id))
      : segments;
    if (targetSegments.length === 0) return;

    // Pre-validate SSML length
    const tooLong = validateSsmlLength(targetSegments);
    if (tooLong.length > 0) {
      toast.error(
        isRu
          ? `Сегменты слишком длинные для Yandex v1 с аннотациями (лимит ${YANDEX_V1_MAX}):\n${tooLong.join(", ")}.\nРазбейте на части или уберите аннотации.`
          : `Segments too long for Yandex v1 with annotations (limit ${YANDEX_V1_MAX}):\n${tooLong.join(", ")}.\nSplit them or remove annotations.`,
        { duration: 8000 },
      );
      return;
    }

    const allTargetIds = new Set(targetSegments.map(s => s.segment_id));
    setSynthesizing(true);
    setCurrentlySynthesizingIds(allTargetIds);
    onSynthesizingChange?.(allTargetIds);
    onErrorSegmentsChange?.(new Set());
    setSynthProgress(isRu ? "Подготовка…" : "Preparing…");

    try {
      const voice_configs = await buildVoiceConfigsPayload(projectStorage);
      const synthSegments = buildSynthPayload();
      const scene_meta = await readSceneMeta();
      const headers = await getAuthHeaders();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

      const batches = buildAdaptiveBatches(targetSegments);
      console.log(`[Synthesis] ${targetSegments.length} segments → ${batches.length} batch(es)`);

      let totalSynthCount = 0;
      let totalCachedCount = 0;
      let totalErrorCount = 0;
      const allErrorIds = new Set<string>();
      const startTime = Date.now();

      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        const batchIds = batch.map(s => s.segment_id);
        const batchLabel = batches.length > 1
          ? (isRu ? `Батч ${batchIdx + 1}/${batches.length}` : `Batch ${batchIdx + 1}/${batches.length}`)
          : "";

        setSynthProgress(batchLabel
          ? (isRu ? `${batchLabel}: запуск…` : `${batchLabel}: starting…`)
          : (isRu ? "Запуск синтеза…" : "Starting synthesis…"));

        const resp = await fetch(`${supabaseUrl}/functions/v1/synthesize-scene`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            scene_id: sceneId, language: isRu ? "ru" : "en",
            voice_configs, segments: synthSegments, scene_meta,
            segment_ids: batchIds,
          }),
        });

        if (!resp.ok) {
          const errBody = await resp.text();
          throw new Error(`Synthesis HTTP ${resp.status}: ${errBody}`);
        }

        let batchSynth = 0, batchCached = 0, batchError = 0;
        let resultCount = 0;

        await parseNdjsonStream(resp.body!.getReader(), {
          onPhrase: (_segId, count) => {
            setSynthProgress(isRu ? `Синтез фраз: ${count}…` : `Phrases: ${count}…`);
          },
          onResult: async (obj) => {
            resultCount++;
            if (obj.status === "error") {
              batchError++;
              allErrorIds.add(obj.segment_id);
            } else if (obj.status === "ready" && (obj.audio_base64 || obj.phrase_results)) {
              batchSynth++;
              await saveSynthResultsToOpfs([obj]);
              onSegmented?.(sceneId);
            } else if (obj.status === "ready") {
              batchCached++;
            }
            // Remove completed segment from synthesizing set → clip re-renders immediately
            setCurrentlySynthesizingIds(prev => { const n = new Set(prev); n.delete(obj.segment_id); return n; });
            synthIdsRef.current = new Set(synthIdsRef.current);
            synthIdsRef.current.delete(obj.segment_id);
            onSynthesizingChange?.(new Set(synthIdsRef.current));

            // Update progress
            const s = totalSynthCount + batchSynth;
            const c = totalCachedCount + batchCached;
            const e = totalErrorCount + batchError;
            const parts: string[] = [];
            if (s > 0) parts.push(`✓${s}`);
            if (c > 0) parts.push(`⚡${c}`);
            if (e > 0) parts.push(`✗${e}`);
            const detail = parts.length > 0 ? ` (${parts.join(" ")})` : "";
            const prefix = batchLabel ? `${batchLabel} · ` : "";
            setSynthProgress(isRu
              ? `${prefix}Синтез: ${resultCount}/${targetSegments.length}${detail}`
              : `${prefix}Synthesis: ${resultCount}/${targetSegments.length}${detail}`);
          },
        });

        totalSynthCount += batchSynth;
        totalCachedCount += batchCached;
        totalErrorCount += batchError;
        onErrorSegmentsChange?.(allErrorIds);
        onSegmented?.(sceneId);

        if (batches.length > 1 && batchIdx < batches.length - 1) {
          console.log(`[Synthesis] Batch ${batchIdx + 1} done: ✓${batchSynth} ⚡${batchCached} ✗${batchError}`);
        }
      }

      const durSec = ((Date.now() - startTime) / 1000).toFixed(1);
      const cachedSuffix = totalCachedCount > 0
        ? (isRu ? `, ⚡${totalCachedCount} из кеша` : `, ⚡${totalCachedCount} cached`)
        : "";

      if (totalErrorCount > 0) {
        toast.warning(
          isRu
            ? `Синтез: ✓${totalSynthCount} готово, ✗${totalErrorCount} ошибок${cachedSuffix} (${durSec}с)`
            : `Synthesis: ✓${totalSynthCount} done, ✗${totalErrorCount} errors${cachedSuffix} (${durSec}s)`,
        );
      } else {
        toast.success(
          isRu
            ? `Синтез завершён: ✓${totalSynthCount} фрагм.${cachedSuffix} (${durSec}с)`
            : `Synthesis done: ✓${totalSynthCount} seg.${cachedSuffix} (${durSec}s)`,
        );
      }
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Synthesis failed:", err);
      toast.error(isRu ? "Ошибка синтеза" : "Synthesis failed");
    }
    setSynthesizing(false);
    setCurrentlySynthesizingIds(new Set());
    onSynthesizingChange?.(new Set());
    setSynthProgress("");
    setMergeChecked(new Set());
  }, [sceneId, segments, mergeChecked, isRu, projectStorage, buildSynthPayload, readSceneMeta, getAuthHeaders, buildAdaptiveBatches, validateSsmlLength, parseNdjsonStream, saveSynthResultsToOpfs, onSegmented, onSynthesizingChange, onErrorSegmentsChange, setMergeChecked]);

  // ── Re-synth single segment ──
  const resynthSegment = useCallback(async (segmentId: string) => {
    if (!sceneId) return;
    setResynthSegId(segmentId);
    setCurrentlySynthesizingIds(new Set([segmentId]));
    onSynthesizingChange?.(new Set([segmentId]));
    try {
      const voice_configs = await buildVoiceConfigsPayload(projectStorage);
      const synthSegments = buildSynthPayload();
      const scene_meta = await readSceneMeta();
      const headers = await getAuthHeaders();
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

      const resp = await fetch(`${supabaseUrl}/functions/v1/synthesize-scene`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          scene_id: sceneId, language: isRu ? "ru" : "en", force: true,
          segment_ids: [segmentId], voice_configs, segments: synthSegments, scene_meta,
        }),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Re-synth HTTP ${resp.status}: ${errBody}`);
      }

      let segmentResult: SynthResult | null = null;
      const allResults: SynthResult[] = [];

      await parseNdjsonStream(resp.body!.getReader(), {
        onResult: async (obj) => {
          allResults.push(obj);
          if (obj.segment_id === segmentId) segmentResult = obj;
        },
      });

      if (!segmentResult || segmentResult.status !== "ready") {
        throw new Error(
          segmentResult?.error || (isRu ? "Синтез вернул неполный результат" : "Synthesis returned partial result"),
        );
      }

      toast.success(isRu ? "Блок пересинтезирован" : "Segment re-synthesized");
      onErrorSegmentsChange?.(new Set());
      await saveSynthResultsToOpfs(allResults.filter(r => r.status !== "skipped"));
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Re-synth failed:", err);
      toast.error(isRu ? "Ошибка ре-синтеза" : "Re-synthesis failed", { description: err?.message });
      onErrorSegmentsChange?.(new Set([segmentId]));
    }
    setResynthSegId(null);
    setCurrentlySynthesizingIds(new Set());
    onSynthesizingChange?.(new Set());
  }, [sceneId, isRu, projectStorage, buildSynthPayload, readSceneMeta, getAuthHeaders, parseNdjsonStream, saveSynthResultsToOpfs, onSegmented, onSynthesizingChange, onErrorSegmentsChange]);

  return {
    synthesizing,
    synthProgress,
    resynthSegId,
    currentlySynthesizingIds,
    runSynthesis,
    resynthSegment,
  };
}
