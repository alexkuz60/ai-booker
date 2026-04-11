/**
 * StoryboardPanel — main storyboard UI for scene segments.
 * Refactored: logic extracted into specialized hooks.
 */

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { upsertAudioEntry, writeAudioMeta, recalcPositions, type LocalAudioEntry } from "@/lib/localAudioMeta";
import { writeTtsClip, writeNarrationClip, parseWavDurationMs } from "@/lib/localTtsStorage";
import { revokeAudioUrl } from "@/lib/localAudioProvider";
import { paths } from "@/lib/projectPaths";

import { useAiRoles } from "@/hooks/useAiRoles";
import { useUserApiKeys } from "@/hooks/useUserApiKeys";
import { useStoryboardPersistence, type StoryboardSnapshot } from "@/hooks/useStoryboardPersistence";
import { useStoryboardSynthesis, type SynthResult } from "@/hooks/useStoryboardSynthesis";
import { useStoryboardSegmentOps } from "@/hooks/useStoryboardSegmentOps";
import { useStoryboardAnnotations } from "@/hooks/useStoryboardAnnotations";
import { useInlineNarrations } from "@/hooks/useInlineNarrations";

import { useBackgroundAnalysis } from "@/hooks/useBackgroundAnalysis";
import { Loader2, Sparkles, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  type TtsProvider,
  resolveProvider,
} from "./phraseAnnotations";

import type { Segment, CharacterOption } from "./storyboard/types";
import { StressReviewPanel } from "./storyboard/StressReviewPanel";
import { StoryboardToolbar } from "./storyboard/StoryboardToolbar";
import { StoryboardSegmentRow } from "./storyboard/StoryboardSegmentRow";
import type { LocalTypeMappingEntry } from "@/lib/storyboardSync";
import { deriveStoryboardTypeMappings } from "@/lib/storyboardCharacterRouting";

// ─── Main component ─────────────────────────────────────────

export function StoryboardPanel({
  sceneId,
  sceneContent,
  sceneNumber,
  sceneTitle,
  chapterId,
  isRu,
  bookId,
  onSegmented,
  selectedSegmentId,
  onSelectSegment,
  checkedSegmentIds: externalChecked,
  onCheckedSegmentIdsChange: onExternalCheckedChange,
  onSynthesizingChange,
  onErrorSegmentsChange,
  silenceSec,
  onSilenceSecChange,
  onRecalcDone,
}: {
  sceneId: string | null;
  sceneContent: string | null;
  sceneNumber?: number | null;
  sceneTitle?: string | null;
  chapterId?: string | null;
  isRu: boolean;
  bookId: string | null;
  onSegmented?: (sceneId: string) => void;
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string | null) => void;
  checkedSegmentIds?: Set<string>;
  onCheckedSegmentIdsChange?: (ids: Set<string>) => void;
  onSynthesizingChange?: (ids: Set<string>) => void;
  onErrorSegmentsChange?: (ids: Set<string>) => void;
  silenceSec?: number;
  onSilenceSecChange?: (sec: number) => void;
  onRecalcDone?: () => void;
}) {
  const userApiKeys = useUserApiKeys();
  const { getModelForRole } = useAiRoles(userApiKeys);
  const { loadFromLocal, persist, persistNow, clearLocal, pushToDb, hasStorage } = useStoryboardPersistence(sceneId, chapterId);
  const { storage: projectStorage } = useProjectStorageContext();
  const [segments, setSegments] = useState<Segment[]>([]);

  // Track current sceneId + request generation to reject stale async hydrations
  const sceneIdRef = useRef(sceneId);
  sceneIdRef.current = sceneId;
  const loadGenerationRef = useRef(0);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [audioStatus, setAudioStatus] = useState<Map<string, { status: string; durationMs: number }>>(new Map());
  const [inlineNarrationSegIds, setInlineNarrationSegIds] = useState<Set<string>>(new Set());
  const [recalcRunning, setRecalcRunning] = useState(false);
  const [internalChecked, setInternalChecked] = useState<Set<string>>(new Set());
  const mergeChecked = externalChecked ?? internalChecked;
  const setMergeChecked = onExternalCheckedChange ?? setInternalChecked;
  const [staleAudioSegIds, setStaleAudioSegIds] = useState<Set<string>>(new Set());
  const [contentDirty, setContentDirty] = useState(false);
  /** Preserved contentHash from analysis — survives all edits */
  const contentHashRef = useRef<number | undefined>(undefined);
  const autoAnalyzeAttemptedRef = useRef<string | null>(null);
  const typeMappingsRef = useRef<LocalTypeMappingEntry[]>([]);
  const audioStatusRef = useRef(audioStatus);
  audioStatusRef.current = audioStatus;

  const deriveCurrentTypeMappings = useCallback((sourceSegments: Segment[], sourceSpeaker?: string | null) => {
    return deriveStoryboardTypeMappings(
      sourceSegments,
      characters,
      typeMappingsRef.current,
      sourceSpeaker !== undefined ? sourceSpeaker : inlineNarrations.inlineNarrationSpeaker,
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [characters]);

  /** Build a snapshot for OPFS persistence — always preserves contentHash */
  const buildSnapshot = useCallback(
    (segs?: Segment[], audio?: Map<string, { status: string; durationMs: number }>, speaker?: string | null): StoryboardSnapshot => {
      const nextSegments = segs ?? segments;
      const nextSpeaker = speaker !== undefined ? speaker : inlineNarrations.inlineNarrationSpeaker;
      const nextTypeMappings = deriveCurrentTypeMappings(nextSegments, nextSpeaker);
      typeMappingsRef.current = nextTypeMappings;
      return {
        segments: nextSegments,
        typeMappings: nextTypeMappings,
        audioStatus: audio ?? audioStatus,
        inlineNarrationSpeaker: nextSpeaker,
        contentHash: contentHashRef.current,
      };
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
    [segments, audioStatus, deriveCurrentTypeMappings],
  );

  // Reset merge selection when scene changes
  useEffect(() => { setMergeChecked(new Set()); }, [sceneId]);

  const toggleMergeCheck = useCallback((segId: string) => {
    const next = new Set(mergeChecked);
    if (next.has(segId)) next.delete(segId); else next.add(segId);
    setMergeChecked(next);
  }, [mergeChecked, setMergeChecked]);

  // Build speaker → TTS provider map
  const speakerProviderMap = useMemo(() => {
    const map = new Map<string, TtsProvider>();
    for (const c of characters) {
      if (c.voiceConfig) {
        const provider = resolveProvider(c.voiceConfig);
        map.set(c.name.toLowerCase(), provider);
      }
    }
    return map;
  }, [characters]);

  const syncTypeMappings = useCallback((updatedSegments: Segment[]) => {
    typeMappingsRef.current = deriveCurrentTypeMappings(updatedSegments);
  }, [deriveCurrentTypeMappings]);

  // ─── Data Loading ─────────────────────────────────────────

  const handleRecalcDurations = useCallback(async () => {
    if (!sceneId) return;
    setRecalcRunning(true);
    try {
      const { data: sceneRow } = await supabase
        .from("book_scenes")
        .select("chapter_id")
        .eq("id", sceneId)
        .single();
      if (!sceneRow) {
        toast.error(isRu ? "Не удалось найти главу" : "Could not find chapter");
        setRecalcRunning(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke("recalc-durations", {
        body: { chapter_id: sceneRow.chapter_id },
      });
      if (error) {
        toast.error(isRu ? "Ошибка пересчёта" : "Recalc error");
      } else {
        const result = data as { updated: number; errors: number; total: number };
        if (result.updated > 0) {
          toast.success(isRu ? `Обновлено ${result.updated} из ${result.total} клипов` : `Updated ${result.updated} of ${result.total} clips`);
          onRecalcDone?.();
        } else {
          toast.info(isRu ? `Все длительности актуальны (${result.total} клипов)` : `All durations up to date (${result.total} clips)`);
        }
      }
    } catch (e) {
      console.error("recalc-durations exception:", e);
      toast.error(isRu ? "Ошибка пересчёта длительностей" : "Duration recalc error");
    }
    setRecalcRunning(false);
  }, [sceneId, isRu, onRecalcDone]);

  useEffect(() => {
    if (!selectedSegmentId) return;
    const el = document.getElementById(`storyboard-seg-${selectedSegmentId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedSegmentId]);

  // Load characters from OPFS (LOCAL-FIRST: K4 contract)
  const { storage } = useProjectStorageContext();
  useEffect(() => {
    if (!bookId) { setCharacters([]); return; }
    (async () => {
      if (!storage) { setCharacters([]); return; }
      const { readCharacterIndex } = await import("@/lib/localCharacters");
      const localChars = await readCharacterIndex(storage);
      setCharacters(localChars.map(c => ({
        id: c.id,
        name: c.name,
        color: c.color ?? undefined,
        voiceConfig: (c.voice_config || {}) as Record<string, unknown>,
      })));
    })();
  }, [bookId, storage]);

  /**
   * Save synthesis results to OPFS: decode base64 WAV → write TTS clips → update audio_meta.
   */
  const saveSynthResultsToOpfs = useCallback(async (results: SynthResult[]) => {
    if (!storage || !sceneId) return;

    const map = new Map(audioStatusRef.current);
    const opfsEntries: Record<string, LocalAudioEntry> = {};

    for (const r of results) {
      if (r.status === "ready" || r.status === "pending" || r.status === "error" || r.status === "estimated") {
        map.set(r.segment_id, { status: r.status, durationMs: r.duration_ms });
      }

      if (r.status === "ready" && r.phrase_results && r.phrase_results.length > 0) {
        const { writePhraseClip } = await import("@/lib/localTtsStorage");
        const phraseClips: import("@/lib/localAudioMeta").PhraseClipEntry[] = [];

        for (const pr of r.phrase_results) {
          const binary = atob(pr.audio_base64);
          const bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

          const phraseAudioPath = await writePhraseClip(
            storage, sceneId, r.segment_id, pr.phrase_index, bytes.buffer, chapterId ?? undefined,
          );
          if (phraseAudioPath) {
            revokeAudioUrl(phraseAudioPath);
            phraseClips.push({ index: pr.phrase_index, durationMs: pr.duration_ms, audioPath: phraseAudioPath });
          }
        }

        const mainPath = phraseClips[0]?.audioPath ?? paths.ttsClip(r.segment_id, sceneId, chapterId ?? undefined);
        opfsEntries[r.segment_id] = {
          segmentId: r.segment_id, status: "ready", durationMs: r.duration_ms,
          audioPath: mainPath, voiceConfig: r.voice_config, phraseClips,
        };
      } else if (r.status === "ready" && r.audio_base64) {
        const binary = atob(r.audio_base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

        await writeTtsClip(storage, sceneId, r.segment_id, bytes.buffer, chapterId ?? undefined);
        const clipPath = paths.ttsClip(r.segment_id, sceneId, chapterId ?? undefined);
        revokeAudioUrl(clipPath);

        opfsEntries[r.segment_id] = {
          segmentId: r.segment_id, status: "ready", durationMs: r.duration_ms,
          audioPath: clipPath, voiceConfig: r.voice_config,
        };

        if (r.inline_narrations) {
          for (let n = 0; n < r.inline_narrations.length; n++) {
            const narr = r.inline_narrations[n];
            if (!narr.audio_base64) continue;
            const narrBin = atob(narr.audio_base64);
            const narrBytes = new Uint8Array(narrBin.length);
            for (let j = 0; j < narrBin.length; j++) narrBytes[j] = narrBin.charCodeAt(j);
            await writeNarrationClip(storage, sceneId, r.segment_id, n, narrBytes.buffer, chapterId ?? undefined);
          }
        }
      }
    }

    audioStatusRef.current = map;
    setAudioStatus(map);
    await persistNow(buildSnapshot(undefined, map));

    if (Object.keys(opfsEntries).length > 0) {
      const { readAudioMeta: readMeta } = await import("@/lib/localAudioMeta");
      const existing = await readMeta(storage, sceneId, chapterId ?? undefined);
      const merged = { ...(existing?.entries ?? {}), ...opfsEntries };
      await writeAudioMeta(storage, sceneId, merged, chapterId ?? undefined, existing?.silenceSec);
      await recalcPositions(storage, sceneId, chapterId ?? undefined);
    }
  }, [storage, sceneId, chapterId, persistNow, buildSnapshot]);

  /** Apply loaded segments to component state */
  const applySegments = useCallback((builtSegments: Segment[]) => {
    setSegments(builtSegments);
    const inlineIds = new Set(builtSegments.filter(s => s.inline_narrations && s.inline_narrations.length > 0).map(s => s.segment_id));
    setInlineNarrationSegIds(inlineIds);
    setStaleAudioSegIds(new Set());
    setLoaded(true);
  }, []);

  const loadSegments = useCallback(async (sid: string) => {
    const generation = ++loadGenerationRef.current;
    const isStale = () => sceneIdRef.current !== sid || loadGenerationRef.current !== generation;

    console.debug(`[Storyboard] loadSegments called for sceneId=${sid}, hasStorage=${hasStorage}, gen=${generation}`);
    setLoading(true);
    setAnalysisPending(false);
    try {
      if (hasStorage) {
        const local = await loadFromLocal(sid);
        if (isStale()) return;
        if (local && local.segments.length > 0) {
          typeMappingsRef.current = deriveStoryboardTypeMappings(
            local.segments, characters, local.typeMappings || [], local.inlineNarrationSpeaker,
          );
          inlineNarrations.setInlineNarrationSpeaker(local.inlineNarrationSpeaker);
          setAudioStatus(new Map(Object.entries(local.audioStatus || {})));
          audioStatusRef.current = new Map(Object.entries(local.audioStatus || {}));
          contentHashRef.current = local.contentHash;
          if (isStale()) return;
          applySegments(local.segments);
          if (local.contentHash != null) {
            const { isSceneDirty } = await import("@/lib/sceneIndex");
            if (isStale()) return;
            const dirty = isSceneDirty(sid);
            setContentDirty(dirty);
          }
          setLoading(false);
          return;
        }
      }

      if (isStale()) return;
      typeMappingsRef.current = [];
      contentHashRef.current = undefined;
      inlineNarrations.setInlineNarrationSpeaker(null);
      setAudioStatus(new Map());
      audioStatusRef.current = new Map();
      setSegments([]);
      setLoaded(true);
    } catch (err) {
      if (isStale()) return;
      console.error("Failed to load segments:", err);
      toast.error(isRu ? "Ошибка загрузки сегментов" : "Failed to load segments");
    }
    if (!isStale()) setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRu, hasStorage, loadFromLocal, applySegments, characters]);

  useEffect(() => {
    setSegments([]);
    setLoaded(false);
    setContentDirty(false);
    setAnalysisPending(false);
    autoAnalyzeAttemptedRef.current = null;
    if (sceneId) loadSegments(sceneId);
  }, [sceneId, loadSegments]);

  // ─── AI Actions (Background) ───────────────────────────────
  const bgAnalysis = useBackgroundAnalysis();

  useEffect(() => {
    if (!sceneId) return;
    const job = bgAnalysis.jobs.get(sceneId);
    if (job?.status === "done") {
      setAnalysisPending(false);
      loadSegments(sceneId);
    } else if (job?.status === "error") {
      setAnalysisPending(false);
    }
  }, [bgAnalysis.completionToken, sceneId, loadSegments]);

  const bgAnalyzing = sceneId ? bgAnalysis.isAnalyzing(sceneId) : false;

  const runAnalysis = useCallback(async () => {
    if (!sceneId) return;
    setAnalysisPending(true);
    bgAnalysis.submit([{ sceneId, sceneTitle: sceneTitle ?? undefined, sceneNumber, chapterId }]);
  }, [sceneId, sceneTitle, sceneNumber, chapterId, bgAnalysis]);

  // ─── Extracted hooks ──────────────────────────────────────

  const inlineNarrations = useInlineNarrations({
    sceneId, segments, setSegments, characters, isRu,
    persist, persistNow, buildSnapshot,
    getModelForRole, userApiKeys,
    typeMappingsRef, staleAudioSegIds, setStaleAudioSegIds, setMergeChecked,
    onSegmented,
  });

  const segOps = useStoryboardSegmentOps({
    sceneId, segments, setSegments, characters, isRu, storage,
    mergeChecked, setMergeChecked,
    audioStatus, setAudioStatus, audioStatusRef,
    contentDirty, setContentDirty,
    typeMappingsRef, persistNow, persist, buildSnapshot, syncTypeMappings,
    setStaleAudioSegIds, onSegmented,
  });

  const annotations = useStoryboardAnnotations({
    sceneId, segments, setSegments, isRu,
    persist, buildSnapshot, getModelForRole, userApiKeys, setMergeChecked,
  });

  const synthesis = useStoryboardSynthesis({
    sceneId, chapterId, segments, characters, isRu,
    projectStorage, mergeChecked, saveSynthResultsToOpfs,
    onSegmented, onSynthesizingChange, onErrorSegmentsChange, setMergeChecked,
  });

  // Wrap updateSpeaker to also update characters state
  const handleUpdateSpeaker = useCallback(async (segmentId: string, newSpeaker: string | null) => {
    const updatedChars = await segOps.updateSpeaker(segmentId, newSpeaker);
    if (updatedChars) setCharacters(updatedChars);
  }, [segOps]);

  // ─── Render ───────────────────────────────────────────────

  if (!sceneId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground font-body">
          {isRu ? "Выберите сцену в навигаторе" : "Select a scene in the navigator"}
        </p>
      </div>
    );
  }

  if (loading || (bgAnalyzing && segments.length === 0)) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-body">
          {bgAnalyzing
            ? (isRu ? "Анализируем сцену…" : "Analyzing scene…")
            : (isRu ? "Загрузка…" : "Loading…")}
        </p>
      </div>
    );
  }

  if (loaded && segments.length === 0 && !sceneContent) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
        <Sparkles className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground font-body text-center max-w-xs">
          {isRu
            ? "Для этой сцены в локальном проекте нет полного текста. Раскадровка недоступна, пока текст не появится в проекте."
            : "This scene has no full text in the local project yet. Storyboard stays unavailable until the text exists locally."}
        </p>
      </div>
    );
  }

  const totalPhrases = segments.reduce((a, s) => a + s.phrases.length, 0);

  return (
    <div className="h-full flex flex-col">
      <StoryboardToolbar
        isRu={isRu}
        segmentCount={segments.length}
        totalPhrases={totalPhrases}
        inlineNarrationCount={inlineNarrationSegIds.size}
        analysisPending={analysisPending}
        bgAnalyzing={bgAnalyzing}
        sceneContent={sceneContent}
        synthesizing={synthesis.synthesizing}
        synthProgress={synthesis.synthProgress}
        canMerge={segOps.canMerge}
        merging={segOps.merging}
        deleting={segOps.deleting}
        mergeCheckedSize={mergeChecked.size}
        dialogueCount={inlineNarrations.dialogueCount}
        detecting={inlineNarrations.detecting}
        correctingStress={annotations.correctingStress}
        staleAudioSegIdsSize={staleAudioSegIds.size}
        cleaningMetadata={inlineNarrations.cleaningMetadata}
        recalcRunning={recalcRunning}
        sceneId={sceneId}
        audioStatusSize={audioStatus.size}
        silenceSec={silenceSec ?? 2}
        segmentIds={segments.map(s => s.segment_id)}
        getModelForRole={getModelForRole}
        onRunAnalysis={runAnalysis}
        onMergeSegments={segOps.handleMergeSegments}
        onDeleteSegments={segOps.handleDeleteSegments}
        onDetectNarrations={inlineNarrations.runDetectNarrations}
        onStressCorrection={annotations.runStressCorrection}
        onCleanStaleAudio={inlineNarrations.cleanStaleInlineAudio}
        onRecalcDurations={handleRecalcDurations}
        onSilenceSecChange={onSilenceSecChange}
        onRunSynthesis={synthesis.runSynthesis}
        onSelectAll={() => setMergeChecked(new Set(segments.map(s => s.segment_id)))}
        onDeselectAll={() => setMergeChecked(new Set())}
        allSelected={mergeChecked.size > 0 && mergeChecked.size === segments.length}
      />
      {contentDirty && segments.length > 0 && (
        <div className="flex items-center gap-2 px-4 py-2 bg-destructive/10 border-b border-destructive/20 shrink-0">
          <AlertTriangle className="h-4 w-4 text-destructive shrink-0" />
          <span className="text-xs text-destructive">
            {isRu
              ? "Контент сцены изменён в Парсере. Рекомендуется переанализировать раскадровку."
              : "Scene content was edited in Parser. Re-analysis recommended."}
          </span>
          <Button
            variant="destructive"
            size="sm"
            className="h-6 px-2 text-xs ml-auto shrink-0"
            onClick={runAnalysis}
            disabled={bgAnalyzing || !sceneContent}
          >
            <RefreshCw className="h-3 w-3 mr-1" />
            {isRu ? "Переанализ" : "Re-analyze"}
          </Button>
        </div>
      )}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {segments.map((seg) => (
            <StoryboardSegmentRow
              key={seg.segment_id}
              seg={seg}
              isRu={isRu}
              isSelected={selectedSegmentId === seg.segment_id}
              audioStatus={audioStatus.get(seg.segment_id)}
              ttsProvider={seg.speaker ? (speakerProviderMap.get(seg.speaker.toLowerCase()) ?? "yandex") : "yandex"}
              characters={characters}
              mergeChecked={mergeChecked.has(seg.segment_id)}
              resynthSegId={synthesis.resynthSegId}
              synthesizing={synthesis.synthesizing}
              inlineNarrationSpeaker={inlineNarrations.inlineNarrationSpeaker}
              getModelForRole={getModelForRole}
              onSelect={(id) => onSelectSegment?.(id)}
              onUpdateType={segOps.updateSegmentType}
              onUpdateSpeaker={handleUpdateSpeaker}
              onResynthSegment={synthesis.resynthSegment}
              onSplitSilenceChange={segOps.handleSplitSilenceChange}
              onToggleMergeCheck={toggleMergeCheck}
              onSavePhrase={annotations.savePhrase}
              onSplitAtPhrase={segOps.handleSplitAtPhrase}
              onAnnotate={annotations.saveAnnotation}
              onRemoveAnnotation={annotations.removeAnnotation}
              onRemoveInlineNarration={inlineNarrations.removeInlineNarration}
              onUpdateInlineNarrationSpeaker={inlineNarrations.updateInlineNarrationSpeaker}
            />
          ))}
        </div>
      </ScrollArea>

      <StressReviewPanel
        open={annotations.stressReviewOpen}
        onOpenChange={annotations.setStressReviewOpen}
        suggestions={annotations.stressSuggestions}
        isRu={isRu}
        onAccept={annotations.handleStressReviewAccept}
      />
    </div>
  );
}
