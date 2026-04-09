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
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { buildVoiceConfigsPayload } from "@/lib/voiceConfigPayload";

import { useBackgroundAnalysis } from "@/hooks/useBackgroundAnalysis";
import { Loader2, Sparkles, AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import {
  type PhraseAnnotation,
  type TtsProvider,
  resolveProvider,
} from "./phraseAnnotations";

import type { Phrase, Segment, CharacterOption } from "./storyboard/types";
import { SEGMENT_CONFIG } from "./storyboard/constants";
import { StressReviewPanel, type StressSuggestion } from "./storyboard/StressReviewPanel";
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
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthProgress, setSynthProgress] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [correctingStress, setCorrectingStress] = useState(false);
  const [resynthSegId, setResynthSegId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [analysisPending, setAnalysisPending] = useState(false);
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [audioStatus, setAudioStatus] = useState<Map<string, { status: string; durationMs: number }>>(new Map());
  const [inlineNarrationSegIds, setInlineNarrationSegIds] = useState<Set<string>>(new Set());
  const [currentlySynthesizingIds, setCurrentlySynthesizingIds] = useState<Set<string>>(new Set());
  const [inlineNarrationSpeaker, setInlineNarrationSpeaker] = useState<string | null>(null);
  const [recalcRunning, setRecalcRunning] = useState(false);
  const [internalChecked, setInternalChecked] = useState<Set<string>>(new Set());
  const mergeChecked = externalChecked ?? internalChecked;
  const setMergeChecked = onExternalCheckedChange ?? setInternalChecked;
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [staleAudioSegIds, setStaleAudioSegIds] = useState<Set<string>>(new Set());
  const [cleaningMetadata, setCleaningMetadata] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);
  /** Preserved contentHash from analysis — survives all edits */
  const contentHashRef = useRef<number | undefined>(undefined);
  const [stressReviewOpen, setStressReviewOpen] = useState(false);
  const [stressSuggestions, setStressSuggestions] = useState<StressSuggestion[]>([]);
  const autoAnalyzeAttemptedRef = useRef<string | null>(null);
  const typeMappingsRef = useRef<LocalTypeMappingEntry[]>([]);
  const audioStatusRef = useRef(audioStatus);
  audioStatusRef.current = audioStatus;
  const inlineNarrationSpeakerRef = useRef(inlineNarrationSpeaker);
  inlineNarrationSpeakerRef.current = inlineNarrationSpeaker;

  const deriveCurrentTypeMappings = useCallback((sourceSegments: Segment[], sourceSpeaker?: string | null) => {
    return deriveStoryboardTypeMappings(
      sourceSegments,
      characters,
      typeMappingsRef.current,
      sourceSpeaker !== undefined ? sourceSpeaker : inlineNarrationSpeakerRef.current,
    );
  }, [characters]);

  /** Build a snapshot for OPFS persistence — always preserves contentHash */
  const buildSnapshot = useCallback(
    (segs?: Segment[], audio?: Map<string, { status: string; durationMs: number }>, speaker?: string | null): StoryboardSnapshot => {
      const nextSegments = segs ?? segments;
      const nextSpeaker = speaker !== undefined ? speaker : inlineNarrationSpeaker;
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
    [segments, audioStatus, inlineNarrationSpeaker, deriveCurrentTypeMappings],
  );

  // Reset merge selection when scene changes
  useEffect(() => { setMergeChecked(new Set()); }, [sceneId]);

  const toggleMergeCheck = useCallback((segId: string) => {
    const next = new Set(mergeChecked);
    if (next.has(segId)) next.delete(segId); else next.add(segId);
    setMergeChecked(next);
  }, [mergeChecked, setMergeChecked]);

  // Find consecutive groups of checked segments (≥2 adjacent)
  const mergeGroups = useMemo(() => {
    if (mergeChecked.size < 2) return [];
    const checked = segments.filter(s => mergeChecked.has(s.segment_id));
    const checkedNums = new Set(checked.map(s => s.segment_number));
    const groups: Segment[][] = [];
    let current: Segment[] = [];
    for (const seg of segments) {
      if (checkedNums.has(seg.segment_number)) {
        current.push(seg);
      } else {
        if (current.length >= 2) groups.push(current);
        current = [];
      }
    }
    if (current.length >= 2) groups.push(current);
    return groups;
  }, [mergeChecked, segments]);

  const canMerge = mergeGroups.length > 0;

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
   * Fully local — no DB reads for audio status.
   */
  const saveSynthResultsToOpfs = useCallback(async (
    results: Array<{
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
    }>,
  ) => {
    if (!storage || !sceneId) return;

    const map = new Map<string, { status: string; durationMs: number }>();
    const opfsEntries: Record<string, LocalAudioEntry> = {};

    for (const r of results) {
      map.set(r.segment_id, { status: r.status, durationMs: r.duration_ms });

      if (r.status === "ready" && r.audio_base64) {
        // Decode base64 → ArrayBuffer and write to OPFS
        const binary = atob(r.audio_base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        const wavData = bytes.buffer;

        await writeTtsClip(storage, sceneId, r.segment_id, wavData, chapterId ?? undefined);

        // Revoke any cached blob URL for this clip (force reload)
        const clipPath = paths.ttsClip(r.segment_id, sceneId, chapterId ?? undefined);
        revokeAudioUrl(clipPath);

        opfsEntries[r.segment_id] = {
          segmentId: r.segment_id,
          status: "ready",
          durationMs: r.duration_ms,
          audioPath: clipPath,
          voiceConfig: r.voice_config,
        };

        // Write inline narration overlays
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

    setAudioStatus(map);
    persist(buildSnapshot(undefined, map));

    // Merge into existing audio_meta.json (don't overwrite!) and recalc positions
    if (Object.keys(opfsEntries).length > 0) {
      const { readAudioMeta: readMeta } = await import("@/lib/localAudioMeta");
      const existing = await readMeta(storage, sceneId, chapterId ?? undefined);
      const merged = { ...(existing?.entries ?? {}), ...opfsEntries };
      await writeAudioMeta(storage, sceneId, merged, chapterId ?? undefined, existing?.silenceSec);
      await recalcPositions(storage, sceneId, chapterId ?? undefined);
    }
  }, [storage, sceneId, chapterId, persist, buildSnapshot]);

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
          const firstPhrase = local.segments[0]?.phrases?.[0]?.text?.slice(0, 80) || "(empty)";
          console.debug(`[Storyboard] Loaded ${local.segments.length} segments from OPFS, first phrase: "${firstPhrase}"`);
          typeMappingsRef.current = deriveStoryboardTypeMappings(
            local.segments,
            characters,
            local.typeMappings || [],
            local.inlineNarrationSpeaker,
          );
          setInlineNarrationSpeaker(local.inlineNarrationSpeaker);
          setAudioStatus(new Map(Object.entries(local.audioStatus || {})));
          audioStatusRef.current = new Map(Object.entries(local.audioStatus || {}));
          contentHashRef.current = local.contentHash;
          if (isStale()) return;
          applySegments(local.segments);
          if (local.contentHash != null) {
            const { isSceneDirty } = await import("@/lib/sceneIndex");
            if (isStale()) return;
            const dirty = isSceneDirty(sid);
            console.debug(`[Storyboard] dirtyCheck sceneId=${sid} → dirty=${dirty}`);
            setContentDirty(dirty);
          }
          setLoading(false);
          return;
        }
        console.debug(`[Storyboard] No OPFS data for sceneId=${sid} — showing empty state`);
      }

      if (isStale()) return;
      typeMappingsRef.current = [];
      contentHashRef.current = undefined;
      setInlineNarrationSpeaker(null);
      setAudioStatus(new Map());
      audioStatusRef.current = new Map();
      setSegments([]);
      setLoaded(true);
    } catch (err) {
      if (isStale()) return;
      console.error("Failed to load segments:", err);
      toast.error(isRu ? "Ошибка загрузки сегментов" : "Failed to load segments");
    }
    if (!isStale()) {
      setLoading(false);
    }
  }, [isRu, hasStorage, loadFromLocal, applySegments, characters]);

  // ─── Segment Operations ───────────────────────────────────

  const handleMergeSegments = useCallback(async () => {
    if (!sceneId || mergeGroups.length === 0) return;
    setMerging(true);
    try {
      let updated = [...segments];
      const allMergedIds = new Set<string>();
      const keeperIds = new Set<string>();

      for (const group of mergeGroups) {
        const [keeper, ...toMerge] = group;
        const mergeIds = new Set(toMerge.map(s => s.segment_id));
        for (const id of mergeIds) allMergedIds.add(id);
        keeperIds.add(keeper.segment_id);

        let allPhrases = [...keeper.phrases];
        for (const seg of toMerge) {
          for (let pi = 0; pi < seg.phrases.length; pi++) {
            const ph = seg.phrases[pi];
            const startsNewSentence = /^[A-ZА-ЯЁ«"—–\-\[]/.test(ph.text.trimStart());
            if (pi === 0 && !startsNewSentence && allPhrases.length > 0) {
              const prev = allPhrases[allPhrases.length - 1];
              const separator = prev.text.endsWith(" ") ? "" : " ";
              allPhrases[allPhrases.length - 1] = { ...prev, text: prev.text + separator + ph.text };
            } else {
              allPhrases.push(ph);
            }
          }
        }

        allPhrases = allPhrases.map((ph, i) => ({ ...ph, phrase_number: i + 1 }));

        updated = updated
          .map(s => s.segment_id === keeper.segment_id ? { ...s, phrases: allPhrases } : s)
          .filter(s => !mergeIds.has(s.segment_id));
      }

      updated = updated.map((s, i) => ({ ...s, segment_number: i + 1 }));

      // Update audioStatus: remove merged IDs, mark keepers as stale (text changed)
      const newAudioStatus = new Map(audioStatusRef.current);
      for (const id of allMergedIds) newAudioStatus.delete(id);
      for (const id of keeperIds) newAudioStatus.delete(id); // text changed, old audio is stale
      setAudioStatus(newAudioStatus);

      // Mark keepers as stale so UI shows re-synth needed
      setStaleAudioSegIds(prev => {
        const next = new Set(prev);
        for (const id of keeperIds) next.add(id);
        return next;
      });

      setSegments(updated);
      setMergeChecked(new Set());
      console.warn(`[Storyboard] 🔀 MERGE: ${segments.length} → ${updated.length} segments, persisting...`);
      await persistNow(buildSnapshot(updated, newAudioStatus));
      console.warn(`[Storyboard] 🔀 MERGE persisted for sceneId=${sceneId}`);
      // Studio edit is newer than Parser — clear dirty flag in index
      if (contentDirty && storage && sceneId) {
        setContentDirty(false);
        import("@/lib/sceneIndex").then(m => m.unmarkSceneDirty(storage, sceneId));
        supabase.from("book_scenes").update({ content_dirty: false }).eq("id", sceneId);
      }
      toast.success(isRu ? "Блоки объединены" : "Segments merged");
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Merge failed:", err);
      toast.error(isRu ? "Ошибка объединения" : "Merge failed");
    }
    setMerging(false);
  }, [sceneId, mergeGroups, segments, isRu, persistNow, buildSnapshot, onSegmented, contentDirty]);

  const handleDeleteSegments = useCallback(async () => {
    if (!sceneId || mergeChecked.size === 0) return;
    const toDelete = segments.filter(s => mergeChecked.has(s.segment_id));
    if (toDelete.length === 0) return;
    if (toDelete.length === segments.length) {
      toast.error(isRu ? "Нельзя удалить все блоки сцены" : "Cannot delete all segments");
      return;
    }
    setDeleting(true);
    try {
      const deleteIds = new Set(toDelete.map(s => s.segment_id));
      const updated = segments
        .filter(s => !deleteIds.has(s.segment_id))
        .map((s, i) => ({ ...s, segment_number: i + 1 }));

      setSegments(updated);
      setMergeChecked(new Set());
      await persistNow(buildSnapshot(updated));
      if (contentDirty && storage && sceneId) {
        setContentDirty(false);
        import("@/lib/sceneIndex").then(m => m.unmarkSceneDirty(storage, sceneId));
        supabase.from("book_scenes").update({ content_dirty: false }).eq("id", sceneId);
      }
      toast.success(isRu ? `Удалено ${toDelete.length} блок(ов)` : `Deleted ${toDelete.length} segment(s)`);
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Delete segments failed:", err);
      toast.error(isRu ? "Ошибка удаления" : "Delete failed");
    }
    setDeleting(false);
  }, [sceneId, mergeChecked, segments, isRu, persistNow, buildSnapshot, onSegmented, contentDirty]);

  const handleSplitAtPhrase = useCallback(async (phraseId: string, textBefore: string, textAfter: string) => {
    if (!sceneId) return;
    const segIdx = segments.findIndex(s => s.phrases.some(p => p.phrase_id === phraseId));
    if (segIdx < 0) return;
    const seg = segments[segIdx];
    const phraseIdx = seg.phrases.findIndex(p => p.phrase_id === phraseId);
    if (phraseIdx < 0) return;

    try {
      const keeperPhrases = seg.phrases.slice(0, phraseIdx + 1).map((ph, i) => ({
        ...ph,
        text: i === phraseIdx ? textBefore : ph.text,
        phrase_number: i + 1,
      }));

      const newSegId = crypto.randomUUID();
      const newPhrases = [
        { phrase_id: crypto.randomUUID(), phrase_number: 1, text: textAfter },
        ...seg.phrases.slice(phraseIdx + 1).map((ph, i) => ({
          ...ph, phrase_number: i + 2,
        })),
      ];

      const newSeg: Segment = {
        segment_id: newSegId,
        segment_number: seg.segment_number + 1,
        segment_type: seg.segment_type,
        speaker: seg.speaker,
        phrases: newPhrases,
        split_silence_ms: 1000,
      };

      const updated = [
        ...segments.slice(0, segIdx),
        { ...seg, phrases: keeperPhrases },
        newSeg,
        ...segments.slice(segIdx + 1),
      ].map((s, i) => ({ ...s, segment_number: i + 1 }));

      setSegments(updated);
      await persistNow(buildSnapshot(updated));
      if (contentDirty && storage && sceneId) {
        setContentDirty(false);
        import("@/lib/sceneIndex").then(m => m.unmarkSceneDirty(storage, sceneId));
        supabase.from("book_scenes").update({ content_dirty: false }).eq("id", sceneId);
      }
      toast.success(isRu ? "Блок разделён" : "Segment split");
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Split failed:", err);
      toast.error(isRu ? "Ошибка разделения" : "Split failed");
    }
  }, [sceneId, segments, isRu, persistNow, buildSnapshot, onSegmented, contentDirty]);

  const handleSplitSilenceChange = useCallback((segmentId: string, ms: number) => {
    const updated = segments.map(s =>
      s.segment_id === segmentId ? { ...s, split_silence_ms: ms } : s
    );
    setSegments(updated);
    persist(buildSnapshot(updated));
    onSegmented?.(sceneId!);
  }, [sceneId, segments, persist, buildSnapshot, onSegmented]);

  useEffect(() => {
    setSegments([]);
    setLoaded(false);
    setContentDirty(false);
    setAnalysisPending(false);
    autoAnalyzeAttemptedRef.current = null;
    if (sceneId) {
      loadSegments(sceneId);
      // LOCAL-ONLY: detect dirty from local contentHash, not DB
    }
  }, [sceneId, loadSegments]);

  const synthIdsRef = useRef<Set<string>>(new Set());
  synthIdsRef.current = currentlySynthesizingIds;

  // Synthesis progress is now tracked locally via saveSynthResultsToOpfs.
  // No realtime subscription to segment_audio DB table needed (K3).
  // Synthesizing IDs are managed by runSynthesis/resynthSegment callbacks.

  // ─── AI Actions (Background) ───────────────────────────────
  const bgAnalysis = useBackgroundAnalysis();

  // Reload from OPFS when a background job completes for the current scene
  useEffect(() => {
    if (!sceneId) return;
    const job = bgAnalysis.jobs.get(sceneId);
    if (job?.status === "done") {
      // Reload segments from OPFS
      setAnalysisPending(false);
      loadSegments(sceneId);
      return;
    }
    if (job?.status === "error") {
      setAnalysisPending(false);
    }
  }, [bgAnalysis.completionToken, sceneId, loadSegments]);

  const bgAnalyzing = sceneId ? bgAnalysis.isAnalyzing(sceneId) : false;

  const runAnalysis = useCallback(async () => {
    if (!sceneId) return;
    setAnalysisPending(true);

    // Submit to background service
    bgAnalysis.submit([{
      sceneId,
      sceneTitle: sceneTitle ?? undefined,
      sceneNumber,
      chapterId,
    }]);
  }, [sceneId, sceneTitle, sceneNumber, chapterId, bgAnalysis]);

  // Auto-analysis removed: user starts segmentation manually via per-scene or batch buttons.

  // ─── Phrase CRUD ──────────────────────────────────────────

  const savePhrase = useCallback(async (phraseId: string, newText: string) => {
    const updated = segments.map(seg => ({
      ...seg,
      phrases: seg.phrases.map(ph =>
        ph.phrase_id === phraseId ? { ...ph, text: newText } : ph
      ),
    }));
    setSegments(updated);
    persist(buildSnapshot(updated));
  }, [segments, persist, buildSnapshot]);

  const addToStressDictionary = useCallback(async (phraseId: string, annotation: PhraseAnnotation) => {
    if (annotation.type !== "stress" || annotation.start === undefined) return;
    let phraseText = "";
    for (const seg of segments) {
      const ph = seg.phrases.find(p => p.phrase_id === phraseId);
      if (ph) { phraseText = ph.text; break; }
    }
    if (!phraseText) return;

    const stressPos = annotation.start;
    const wordRegex = /[а-яёА-ЯЁ]+/g;
    let m: RegExpExecArray | null;
    while ((m = wordRegex.exec(phraseText)) !== null) {
      if (stressPos >= m.index && stressPos < m.index + m[0].length) {
        const word = m[0].toLowerCase();
        const stressedIndex = stressPos - m.index;
        await supabase.from("stress_dictionary").upsert(
          { user_id: (await supabase.auth.getUser()).data.user?.id, word, stressed_index: stressedIndex },
          { onConflict: "user_id,word,stressed_index" }
        );
        break;
      }
    }
  }, [segments]);

  const saveAnnotation = useCallback(async (phraseId: string, annotation: PhraseAnnotation) => {
    let currentAnnotations: PhraseAnnotation[] = [];
    for (const seg of segments) {
      const ph = seg.phrases.find(p => p.phrase_id === phraseId);
      if (ph) {
        currentAnnotations = [...(ph.annotations || [])];
        break;
      }
    }
    currentAnnotations.push(annotation);

    if (annotation.type === "stress") {
      addToStressDictionary(phraseId, annotation);
    }

    const updated = segments.map(seg => ({
      ...seg,
      phrases: seg.phrases.map(ph =>
        ph.phrase_id === phraseId ? { ...ph, annotations: currentAnnotations } : ph
      ),
    }));
    setSegments(updated);
    persist(buildSnapshot(updated));
    toast.success(isRu ? "Аннотация добавлена" : "Annotation added");
  }, [segments, isRu, addToStressDictionary, persist, buildSnapshot]);

  const removeAnnotation = useCallback(async (phraseId: string, index: number) => {
    let currentAnnotations: PhraseAnnotation[] = [];
    for (const seg of segments) {
      const ph = seg.phrases.find(p => p.phrase_id === phraseId);
      if (ph) {
        currentAnnotations = [...(ph.annotations || [])];
        break;
      }
    }
    currentAnnotations.splice(index, 1);

    const updated = segments.map(seg => ({
      ...seg,
      phrases: seg.phrases.map(ph =>
        ph.phrase_id === phraseId ? { ...ph, annotations: currentAnnotations.length > 0 ? currentAnnotations : undefined } : ph
      ),
    }));
    setSegments(updated);
    persist(buildSnapshot(updated));
    toast.success(isRu ? "Аннотация удалена" : "Annotation removed");
  }, [segments, isRu, persist, buildSnapshot]);

  // ─── Character Sync (local-only — update typeMappings ref) ──

  const syncTypeMappings = useCallback((updatedSegments: Segment[]) => {
    typeMappingsRef.current = deriveCurrentTypeMappings(updatedSegments);
  }, [deriveCurrentTypeMappings]);

  const PROPAGATE_TYPES = new Set(["narrator", "epigraph", "lyric", "footnote"]);

  const TYPE_PROPAGATION_PAIRS: Record<string, string> = {
    narrator: "first_person",
    first_person: "narrator",
  };

  const updateSegmentType = useCallback(async (segmentId: string, newType: string) => {
    const targetSeg = segments.find(s => s.segment_id === segmentId);
    if (!targetSeg) return;
    const oldType = targetSeg.segment_type;

    // Bulk: if target is among checked segments, apply to all checked
    const bulkChecked = mergeChecked.size > 1 && mergeChecked.has(segmentId);
    let affectedIds: string[];
    if (bulkChecked) {
      affectedIds = segments.filter(s => mergeChecked.has(s.segment_id)).map(s => s.segment_id);
    } else {
      const shouldPropagate = TYPE_PROPAGATION_PAIRS[oldType] === newType;
      affectedIds = shouldPropagate
        ? segments.filter(s => s.segment_type === oldType).map(s => s.segment_id)
        : [segmentId];
    }

    // Auto-assign system speaker when switching to a system type
    const SYSTEM_TYPE_SPEAKER: Record<string, string> = {
      narrator: "Рассказчик",
      epigraph: "Рассказчик",
      lyric: "Рассказчик",
      footnote: "Комментатор",
    };
    const systemSpeaker = SYSTEM_TYPE_SPEAKER[newType] ?? null;
    const SYSTEM_SPEAKERS = new Set(Object.values(SYSTEM_TYPE_SPEAKER));

    const updatedSegments = segments.map(seg => {
      if (!affectedIds.includes(seg.segment_id)) return seg;
      const updated: typeof seg = { ...seg, segment_type: newType };
      if (systemSpeaker) {
        // Switching TO system type → assign system speaker
        updated.speaker = systemSpeaker;
      } else if (SYSTEM_SPEAKERS.has(seg.speaker ?? "")) {
        // Switching FROM system type to non-system → clear system speaker
        updated.speaker = null;
      }
      return updated;
    });
    setSegments(updatedSegments);

    if (affectedIds.length > 1) {
      const newLabel = isRu ? SEGMENT_CONFIG[newType]?.label_ru : SEGMENT_CONFIG[newType]?.label_en;
      toast.success(
        isRu
          ? `Тип изменён: ${newLabel} (${affectedIds.length} фрагм.)`
          : `Type changed: ${newLabel} (${affectedIds.length} seg.)`
      );
    }

    syncTypeMappings(updatedSegments);
    persist(buildSnapshot(updatedSegments));
    onSegmented?.(sceneId!);
  }, [isRu, segments, sceneId, mergeChecked, syncTypeMappings, persist, buildSnapshot, onSegmented]);

  const updateSpeaker = useCallback(async (segmentId: string, newSpeaker: string | null) => {
    const targetSeg = segments.find(s => s.segment_id === segmentId);
    if (!targetSeg) return;

    // If the changed segment is among checked segments, apply to ALL checked
    const bulkChecked = mergeChecked.size > 1 && mergeChecked.has(segmentId);
    let affectedIds: string[];
    if (bulkChecked) {
      affectedIds = segments.filter(s => mergeChecked.has(s.segment_id)).map(s => s.segment_id);
    } else {
      const shouldPropagate = PROPAGATE_TYPES.has(targetSeg.segment_type);
      affectedIds = shouldPropagate
        ? segments.filter(s => s.segment_type === targetSeg.segment_type).map(s => s.segment_id)
        : [segmentId];
    }

    const updatedSegments = segments.map(seg =>
      affectedIds.includes(seg.segment_id) ? { ...seg, speaker: newSpeaker } : seg
    );
    setSegments(updatedSegments);

    syncTypeMappings(updatedSegments);
    persist(buildSnapshot(updatedSegments));

    if (affectedIds.length > 1) {
      const typeLabel = isRu
        ? SEGMENT_CONFIG[targetSeg.segment_type]?.label_ru
        : SEGMENT_CONFIG[targetSeg.segment_type]?.label_en;
      toast.success(
        isRu
          ? `«${typeLabel}» → ${newSpeaker || "?"} (${affectedIds.length} фрагм.)`
          : `"${typeLabel}" → ${newSpeaker || "?"} (${affectedIds.length} seg.)`
      );
    }

    // Sync characters: upsert new speaker into index + scene map, then reload
    if (storage && sceneId) {
      try {
        const { readCharacterIndex, upsertSpeakersFromSegments } = await import("@/lib/localCharacters");
        const currentIndex = await readCharacterIndex(storage);
        const updatedIndex = await upsertSpeakersFromSegments(
          storage, sceneId, updatedSegments, currentIndex,
          typeMappingsRef.current.map(m => ({ segmentType: m.segmentType, characterId: m.characterId })),
        );
        setCharacters(updatedIndex.map(c => ({
          id: c.id,
          name: c.name,
          color: c.color ?? undefined,
          voiceConfig: (c.voice_config || {}) as Record<string, unknown>,
        })));
      } catch (err) {
        console.warn("[StoryboardPanel] Character sync after speaker update failed:", err);
      }
    }

    onSegmented?.(sceneId!);
  }, [isRu, segments, sceneId, storage, syncTypeMappings, persist, buildSnapshot, onSegmented, mergeChecked]);

  // ─── Synthesis ────────────────────────────────────────────

  const runSynthesis = useCallback(async () => {
    if (!sceneId || segments.length === 0) return;
    // If some segments are checked — synthesize only those; otherwise all
    const targetSegments = mergeChecked.size > 0
      ? segments.filter(s => mergeChecked.has(s.segment_id))
      : segments;
    if (targetSegments.length === 0) return;

    const targetIds = new Set(targetSegments.map(s => s.segment_id));
    setSynthesizing(true);
    setCurrentlySynthesizingIds(targetIds);
    onSynthesizingChange?.(targetIds);
    onErrorSegmentsChange?.(new Set());
    setSynthProgress(isRu ? "Синхронизация с сервером…" : "Syncing to server…");
    try {
      // Push OPFS → DB before TTS (edge functions read segments from DB)
      await pushToDb(sceneId, buildSnapshot());
      setSynthProgress(isRu ? "Запуск синтеза…" : "Starting synthesis…");

      // Send voice configs from OPFS directly (П1: OPFS is source of truth)
      const voice_configs = await buildVoiceConfigsPayload(projectStorage);

      // Use streaming NDJSON to avoid edge function memory limit on large scenes
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const requestBody: Record<string, unknown> = { scene_id: sceneId, language: isRu ? "ru" : "en", voice_configs };
      // Pass segment_ids filter only when subset is selected
      if (mergeChecked.size > 0) {
        requestBody.segment_ids = [...targetIds];
      }

      const resp = await fetch(`${supabaseUrl}/functions/v1/synthesize-scene`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
        },
        body: JSON.stringify(requestBody),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Synthesis HTTP ${resp.status}: ${errBody}`);
      }

      // Read NDJSON stream line by line
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const allResults: Array<{
        segment_id: string; status: string; duration_ms: number;
        audio_base64?: string; voice_config?: Record<string, unknown>; error?: string;
        inline_narrations?: Array<{ text: string; insert_after: string; audio_base64: string; duration_ms: number; offset_ms: number }>;
      }> = [];
      let summary: { synthesized?: number; errors?: number; total_duration_ms?: number; error?: string } = {};

      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (obj._summary) {
              summary = obj;
            } else {
              allResults.push(obj);
              // Save each segment to OPFS immediately (streaming save)
              if (obj.status === "ready" && obj.audio_base64) {
                await saveSynthResultsToOpfs([obj]);
                // Trigger timeline redraw after each streamed segment
                onSegmented?.(sceneId);
              }
              setSynthProgress(
                isRu
                  ? `Синтез: ${allResults.length}/${targetSegments.length}`
                  : `Synthesis: ${allResults.length}/${targetSegments.length}`
              );
            }
          } catch { /* skip malformed lines */ }
        }
        if (done) break;
      }

      if (summary.error) throw new Error(summary.error);

      const durSec = ((summary.total_duration_ms ?? 0) / 1000).toFixed(1);
      const errorIds = new Set<string>();
      for (const r of allResults) {
        if (r.status === "error") errorIds.add(r.segment_id);
      }
      onErrorSegmentsChange?.(errorIds);

      // Save non-audio results (skipped/cached) to update audio_meta
      const nonAudioResults = allResults.filter(r => r.status !== "ready" || !r.audio_base64);
      if (nonAudioResults.length > 0) {
        await saveSynthResultsToOpfs(nonAudioResults);
      }

      if ((summary.errors ?? 0) > 0) {
        toast.warning(
          isRu
            ? `Синтез: ${summary.synthesized ?? 0} готово, ${summary.errors} ошибок (${durSec}с)`
            : `Synthesis: ${summary.synthesized ?? 0} done, ${summary.errors} errors (${durSec}s)`
        );
      } else {
        toast.success(
          isRu
            ? `Синтез завершён: ${summary.synthesized ?? 0} фрагм., ${durSec}с`
            : `Synthesis done: ${summary.synthesized ?? 0} seg., ${durSec}s`
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
  }, [sceneId, segments, isRu, onSegmented, saveSynthResultsToOpfs, onSynthesizingChange, onErrorSegmentsChange, pushToDb, buildSnapshot]);

  const resynthSegment = useCallback(async (segmentId: string) => {
    if (!sceneId) return;
    setResynthSegId(segmentId);
    setCurrentlySynthesizingIds(new Set([segmentId]));
    onSynthesizingChange?.(new Set([segmentId]));
    try {
      // Push current segment state to DB before re-synth
      await pushToDb(sceneId, buildSnapshot());

      const voice_configs = await buildVoiceConfigsPayload(projectStorage);

      // Use streaming NDJSON (same as runSynthesis)
      const { data: session } = await supabase.auth.getSession();
      const token = session?.session?.access_token;
      if (!token) throw new Error("Not authenticated");
      const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
      const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

      const resp = await fetch(`${supabaseUrl}/functions/v1/synthesize-scene`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: anonKey,
        },
        body: JSON.stringify({ scene_id: sceneId, language: isRu ? "ru" : "en", force: true, segment_ids: [segmentId], voice_configs }),
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`Re-synth HTTP ${resp.status}: ${errBody}`);
      }

      // Parse NDJSON stream
      const reader = resp.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let segmentResult: { segment_id: string; status: string; duration_ms: number; audio_base64?: string; voice_config?: Record<string, unknown>; error?: string; inline_narrations?: any[] } | null = null;
      const allResults: typeof segmentResult[] = [];

      while (true) {
        const { done, value } = await reader.read();
        if (value) buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";
        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj = JSON.parse(line);
            if (!obj._summary) {
              allResults.push(obj);
              if (obj.segment_id === segmentId) segmentResult = obj;
            }
          } catch { /* skip */ }
        }
        if (done) break;
      }

      if (!segmentResult || segmentResult.status !== "ready") {
        throw new Error(
          segmentResult?.error || (isRu ? "Синтез вернул неполный результат" : "Synthesis returned partial result")
        );
      }

      toast.success(isRu ? "Блок пересинтезирован" : "Segment re-synthesized");
      onErrorSegmentsChange?.(new Set());
      // Save re-synthesized audio to OPFS
      await saveSynthResultsToOpfs(allResults.filter(Boolean) as any[]);
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Re-synth failed:", err);
      toast.error(isRu ? "Ошибка ре-синтеза" : "Re-synthesis failed", {
        description: err?.message,
      });
      onErrorSegmentsChange?.(new Set([segmentId]));
    }
    setResynthSegId(null);
    setCurrentlySynthesizingIds(new Set());
    onSynthesizingChange?.(new Set());
  }, [sceneId, isRu, onSegmented, saveSynthResultsToOpfs, segments, onSynthesizingChange, onErrorSegmentsChange, pushToDb, buildSnapshot]);

  // ─── Detection & Stress ───────────────────────────────────

  const dialogueCount = segments.filter(s => s.segment_type === "dialogue").length;
  const runDetectNarrations = useCallback(async () => {
    if (!sceneId || dialogueCount === 0) return;
    setDetecting(true);
    try {
      const { data, error } = await invokeWithFallback({
        functionName: "detect-inline-narrations",
        body: { scene_id: sceneId, language: isRu ? "ru" : "en", model: getModelForRole("screenwriter") },
        userApiKeys,
        isRu,
      });
      if (error) throw error;
      const det = data as { detected: number; segments_updated: number; message?: string };
      if (det.detected > 0) {
        toast.success(
          isRu
            ? `Найдено ${det.detected} вставок в ${det.segments_updated} фрагментах`
            : `Found ${det.detected} insertions in ${det.segments_updated} segments`
        );
        await loadSegments(sceneId);
      } else {
        toast.info(det.message || (isRu ? "Вставок не найдено" : "No insertions found"));
      }
    } catch (err: any) {
      console.error("Detection failed:", err);
      toast.error(isRu ? "Ошибка поиска вставок" : "Detection failed");
    }
    setDetecting(false);
  }, [sceneId, dialogueCount, isRu, loadSegments]);

  const runStressCorrection = useCallback(async (mode: "correct" | "suggest") => {
    if (!sceneId) return;
    setCorrectingStress(true);
    try {
      if (mode === "suggest") {
        // Push to DB first so edge function can read phrases
        await pushToDb(sceneId, buildSnapshot());
        const { data, error } = await invokeWithFallback({
          functionName: "correct-stress",
          body: { scene_id: sceneId, mode: "suggest", model: getModelForRole("proofreader") },
          userApiKeys,
          isRu,
        });
        if (error) throw error;
        const result = data as any;
        const suggestions = result.suggestions as StressSuggestion[];
        if (!suggestions?.length) {
          toast.info(isRu ? "Неоднозначных ударений не найдено" : "No ambiguous stress found");
        } else {
          setStressSuggestions(suggestions);
          setStressReviewOpen(true);
        }
      } else {
        // Push to DB first so edge function can read phrases
        await pushToDb(sceneId, buildSnapshot());
        const { data, error } = await invokeWithFallback({
          functionName: "correct-stress",
          body: { scene_id: sceneId, mode: "correct", model: getModelForRole("proofreader") },
          userApiKeys,
          isRu,
        });
        if (error) throw error;
        const result = data as any;
        if (result.applied > 0) {
          toast.success(
            isRu
              ? `Расставлено ${result.applied} ударений в ${result.phrases_affected} фразах`
              : `Applied ${result.applied} stress marks in ${result.phrases_affected} phrases`
          );
          await loadSegments(sceneId);
        } else {
          toast.info(result.message || (isRu ? "Нет совпадений со словарём" : "No dictionary matches"));
        }
      }
    } catch (err: any) {
      console.error("Stress correction failed:", err);
      toast.error(isRu ? "Ошибка коррекции ударений" : "Stress correction failed");
    }
    setCorrectingStress(false);
  }, [sceneId, isRu, loadSegments, pushToDb, buildSnapshot, getModelForRole, userApiKeys]);

  const handleStressReviewAccept = useCallback(async (accepted: StressSuggestion[]) => {
    if (accepted.length === 0) return;
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) return;
      for (const s of accepted) {
        await supabase.from("stress_dictionary" as any).upsert(
          { user_id: userId, word: s.word.toLowerCase(), stressed_index: s.stressed_index, context: s.reason },
          { onConflict: "user_id,word,stressed_index" }
        );
      }
      toast.success(
        isRu
          ? `${accepted.length} слов добавлено в словарь. Нажмите «Применить» для расстановки.`
          : `${accepted.length} words added to dictionary. Click "Apply" to set stress marks.`
      );
    } catch (err) {
      console.error("Failed to save stress dictionary:", err);
      toast.error(isRu ? "Ошибка сохранения словаря" : "Failed to save dictionary");
    }
  }, [isRu]);

  // ─── Cleanup ──────────────────────────────────────────────

  const cleanStaleInlineAudio = useCallback(async () => {
    if (!sceneId || staleAudioSegIds.size === 0) return;
    setCleaningMetadata(true);
    try {
      // Remove inline_narrations from segments locally
      const updated = segments.map(s => {
        if (!staleAudioSegIds.has(s.segment_id)) return s;
        return { ...s, inline_narrations: undefined };
      });
      setSegments(updated);
      setStaleAudioSegIds(new Set());
      await persistNow(buildSnapshot(updated));
      if (onSegmented) onSegmented(sceneId);
      toast.success(
        isRu
          ? `Очищено ${staleAudioSegIds.size} устаревших аудио-вставок`
          : `Cleared ${staleAudioSegIds.size} stale audio metadata entries`
      );
    } catch (err) {
      console.error("Cleanup failed:", err);
      toast.error(isRu ? "Ошибка очистки" : "Cleanup failed");
    }
    setCleaningMetadata(false);
  }, [sceneId, staleAudioSegIds, segments, isRu, onSegmented, persistNow, buildSnapshot]);

  const removeInlineNarration = useCallback((segmentId: string, narrationIdx: number) => {
    if (!sceneId) return;
    const updated = segments.map(s => {
      if (s.segment_id !== segmentId || !s.inline_narrations) return s;
      const remaining = s.inline_narrations.filter((_, i) => i !== narrationIdx);
      return { ...s, inline_narrations: remaining.length > 0 ? remaining : undefined };
    });
    setSegments(updated);
    persist(buildSnapshot(updated));
    onSegmented?.(sceneId);
    toast.success(isRu ? "Вставка удалена" : "Narration removed");
  }, [sceneId, segments, isRu, persist, buildSnapshot, onSegmented]);

  const updateInlineNarrationSpeaker = useCallback(async (newSpeaker: string | null) => {
    if (!sceneId) return;
    setInlineNarrationSpeaker(newSpeaker);

    // Update typeMappings locally
    const charRecord = newSpeaker ? characters.find(c => c.name === newSpeaker) : null;
    if (charRecord) {
      typeMappingsRef.current = [
        ...typeMappingsRef.current.filter(m => m.segmentType !== "inline_narration"),
        { segmentType: "inline_narration", characterId: charRecord.id, characterName: charRecord.name },
      ];
      toast.success(isRu ? `Голос вставок → ${newSpeaker}` : `Narration voice → ${newSpeaker}`);
    } else {
      typeMappingsRef.current = typeMappingsRef.current.filter(m => m.segmentType !== "inline_narration");
      toast.success(isRu ? "Голос вставок сброшен" : "Narration voice reset");
    }
    persist(buildSnapshot(undefined, undefined, newSpeaker));
  }, [sceneId, characters, isRu, persist, buildSnapshot]);

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
        synthesizing={synthesizing}
        synthProgress={synthProgress}
        canMerge={canMerge}
        merging={merging}
        deleting={deleting}
        mergeCheckedSize={mergeChecked.size}
        dialogueCount={dialogueCount}
        detecting={detecting}
        correctingStress={correctingStress}
        staleAudioSegIdsSize={staleAudioSegIds.size}
        cleaningMetadata={cleaningMetadata}
        recalcRunning={recalcRunning}
        sceneId={sceneId}
        audioStatusSize={audioStatus.size}
        silenceSec={silenceSec ?? 2}
        segmentIds={segments.map(s => s.segment_id)}
        getModelForRole={getModelForRole}
        onRunAnalysis={runAnalysis}
        onMergeSegments={handleMergeSegments}
        onDeleteSegments={handleDeleteSegments}
        onDetectNarrations={runDetectNarrations}
        onStressCorrection={runStressCorrection}
        onCleanStaleAudio={cleanStaleInlineAudio}
        onRecalcDurations={handleRecalcDurations}
        onSilenceSecChange={onSilenceSecChange}
        onRunSynthesis={runSynthesis}
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
              resynthSegId={resynthSegId}
              synthesizing={synthesizing}
              inlineNarrationSpeaker={inlineNarrationSpeaker}
              getModelForRole={getModelForRole}
              onSelect={(id) => onSelectSegment?.(id)}
              onUpdateType={updateSegmentType}
              onUpdateSpeaker={updateSpeaker}
              onResynthSegment={resynthSegment}
              onSplitSilenceChange={handleSplitSilenceChange}
              onToggleMergeCheck={toggleMergeCheck}
              onSavePhrase={savePhrase}
              onSplitAtPhrase={handleSplitAtPhrase}
              onAnnotate={saveAnnotation}
              onRemoveAnnotation={removeAnnotation}
              onRemoveInlineNarration={removeInlineNarration}
              onUpdateInlineNarrationSpeaker={updateInlineNarrationSpeaker}
            />
          ))}
        </div>
      </ScrollArea>

      <StressReviewPanel
        open={stressReviewOpen}
        onOpenChange={setStressReviewOpen}
        suggestions={stressSuggestions}
        isRu={isRu}
        onAccept={handleStressReviewAccept}
      />
    </div>
  );
}
