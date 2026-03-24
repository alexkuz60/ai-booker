import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { Json, Database } from "@/integrations/supabase/types";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readCharactersFromLocal } from "@/lib/localSync";
import { useAiRoles } from "@/hooks/useAiRoles";
import { useUserApiKeys } from "@/hooks/useUserApiKeys";
import { useStoryboardPersistence, type StoryboardSnapshot } from "@/hooks/useStoryboardPersistence";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import { readSceneContentFromLocal } from "@/lib/localSceneContent";
import { useBackgroundAnalysis } from "@/hooks/useBackgroundAnalysis";
import { Loader2, Sparkles, BookOpen, AudioLines, CheckCircle2, XCircle, ScanSearch, MessageCircle, RefreshCw, Timer, Merge, Trash2, Eraser, SpellCheck, AlertTriangle, X } from "lucide-react";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  type PhraseAnnotation,
  type TtsProvider,
  resolveProvider,
} from "./phraseAnnotations";

import type { Phrase, Segment, CharacterOption } from "./storyboard/types";
import { SEGMENT_CONFIG } from "./storyboard/constants";
import { EditablePhrase } from "./storyboard/EditablePhrase";
import { SegmentTypeBadge } from "./storyboard/SegmentTypeBadge";
import { SpeakerBadge } from "./storyboard/SpeakerBadge";
import { StressReviewPanel, type StressSuggestion } from "./storyboard/StressReviewPanel";
import type { LocalTypeMappingEntry } from "@/lib/storyboardSync";

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
  onSynthesizingChange?: (ids: Set<string>) => void;
  onErrorSegmentsChange?: (ids: Set<string>) => void;
  silenceSec?: number;
  onSilenceSecChange?: (sec: number) => void;
  onRecalcDone?: () => void;
}) {
  const userApiKeys = useUserApiKeys();
  const { getModelForRole } = useAiRoles(userApiKeys);
  const { loadFromLocal, persist, persistNow, clearLocal, pushToDb, hasStorage } = useStoryboardPersistence(sceneId, chapterId);
  const [segments, setSegments] = useState<Segment[]>([]);

  // Track current sceneId to detect stale async results
  const sceneIdRef = useRef(sceneId);
  sceneIdRef.current = sceneId;
  const [loading, setLoading] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthProgress, setSynthProgress] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [correctingStress, setCorrectingStress] = useState(false);
  const [resynthSegId, setResynthSegId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [audioStatus, setAudioStatus] = useState<Map<string, { status: string; durationMs: number }>>(new Map());
  const [inlineNarrationSegIds, setInlineNarrationSegIds] = useState<Set<string>>(new Set());
  const [currentlySynthesizingIds, setCurrentlySynthesizingIds] = useState<Set<string>>(new Set());
  const [inlineNarrationSpeaker, setInlineNarrationSpeaker] = useState<string | null>(null);
  const [recalcRunning, setRecalcRunning] = useState(false);
  const [mergeChecked, setMergeChecked] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [staleAudioSegIds, setStaleAudioSegIds] = useState<Set<string>>(new Set());
  const [cleaningMetadata, setCleaningMetadata] = useState(false);
  const [contentDirty, setContentDirty] = useState(false);
  const [stressReviewOpen, setStressReviewOpen] = useState(false);
  const [stressSuggestions, setStressSuggestions] = useState<StressSuggestion[]>([]);
  const autoAnalyzeAttemptedRef = useRef<string | null>(null);
  const typeMappingsRef = useRef<LocalTypeMappingEntry[]>([]);
  const audioStatusRef = useRef(audioStatus);
  audioStatusRef.current = audioStatus;
  const inlineNarrationSpeakerRef = useRef(inlineNarrationSpeaker);
  inlineNarrationSpeakerRef.current = inlineNarrationSpeaker;

  /** Build a snapshot for OPFS persistence */
  const buildSnapshot = useCallback(
    (segs?: Segment[], audio?: Map<string, { status: string; durationMs: number }>, speaker?: string | null): StoryboardSnapshot => ({
      segments: segs ?? segments,
      typeMappings: typeMappingsRef.current,
      audioStatus: audio ?? audioStatus,
      inlineNarrationSpeaker: speaker !== undefined ? speaker : inlineNarrationSpeaker,
    }),
    [segments, audioStatus, inlineNarrationSpeaker],
  );

  // Reset merge selection when scene changes
  useEffect(() => { setMergeChecked(new Set()); }, [sceneId]);

  const toggleMergeCheck = useCallback((segId: string) => {
    setMergeChecked(prev => {
      const next = new Set(prev);
      if (next.has(segId)) next.delete(segId); else next.add(segId);
      return next;
    });
  }, []);

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

  // Load audio status: from OPFS snapshot (already loaded by loadSegments).
  // This DB-based loader is kept only for post-synthesis refresh.
  const refreshAudioStatusFromDb = useCallback(async (segIds: string[]) => {
    if (segIds.length === 0) return;
    const { data } = await supabase
      .from("segment_audio")
      .select("segment_id, status, duration_ms, created_at")
      .in("segment_id", segIds)
      .order("created_at", { ascending: false });

    const map = new Map<string, { status: string; durationMs: number }>();
    if (data) {
      for (const a of data) {
        const prev = map.get(a.segment_id);
        if (!prev) {
          map.set(a.segment_id, { status: a.status, durationMs: a.duration_ms });
          continue;
        }
        if (prev.status !== "ready" && a.status === "ready") {
          map.set(a.segment_id, { status: a.status, durationMs: a.duration_ms });
        }
      }
    }
    setAudioStatus(map);
    persist(buildSnapshot(undefined, map));
  }, [persist, buildSnapshot]);

  /** Apply loaded segments to component state */
  const applySegments = useCallback((builtSegments: Segment[]) => {
    setSegments(builtSegments);
    const inlineIds = new Set(builtSegments.filter(s => s.inline_narrations && s.inline_narrations.length > 0).map(s => s.segment_id));
    setInlineNarrationSegIds(inlineIds);
    setStaleAudioSegIds(new Set());
    setLoaded(true);
  }, []);

  const loadSegments = useCallback(async (sid: string) => {
    console.debug(`[Storyboard] loadSegments called for sceneId=${sid}, hasStorage=${hasStorage}`);
    setLoading(true);
    try {
      if (hasStorage) {
        const local = await loadFromLocal(sid);
        if (local && local.segments.length > 0) {
          const firstPhrase = local.segments[0]?.phrases?.[0]?.text?.slice(0, 80) || "(empty)";
          console.debug(`[Storyboard] Loaded ${local.segments.length} segments from OPFS, first phrase: "${firstPhrase}"`);
          typeMappingsRef.current = local.typeMappings || [];
          setInlineNarrationSpeaker(local.inlineNarrationSpeaker);
          setAudioStatus(new Map(Object.entries(local.audioStatus || {})));
          applySegments(local.segments);
          // LOCAL-ONLY: detect dirty via contentHash comparison (K3)
          if (local.contentHash) {
            const { isSceneDirty } = await import("@/lib/sceneIndex");
            setContentDirty(isSceneDirty(sid, local.contentHash));
          }
          setLoading(false);
          return;
        }
        console.debug(`[Storyboard] No OPFS data for sceneId=${sid} — showing empty state`);
      }

      typeMappingsRef.current = [];
      setInlineNarrationSpeaker(null);
      setAudioStatus(new Map());
      setSegments([]);
      setLoaded(true);
    } catch (err) {
      console.error("Failed to load segments:", err);
      toast.error(isRu ? "Ошибка загрузки сегментов" : "Failed to load segments");
    }
    setLoading(false);
  }, [isRu, hasStorage, loadFromLocal, applySegments]);

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
      await persistNow(buildSnapshot(updated, newAudioStatus));
      // Studio edit is newer than Parser — clear dirty flag
      if (contentDirty) {
        setContentDirty(false);
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
      if (contentDirty) {
        setContentDirty(false);
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
      if (contentDirty) {
        setContentDirty(false);
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
    autoAnalyzeAttemptedRef.current = null;
    if (sceneId) {
      loadSegments(sceneId);
      // LOCAL-ONLY: detect dirty from local contentHash, not DB
    }
  }, [sceneId, loadSegments]);

  const synthIdsRef = useRef<Set<string>>(new Set());
  synthIdsRef.current = currentlySynthesizingIds;

  useEffect(() => {
    if (segments.length === 0) return;

    const segmentIdSet = new Set(segments.map(s => s.segment_id));
    const channel = supabase
      .channel(`segment_audio_${sceneId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "segment_audio" },
        (payload) => {
          const row = payload.new as { segment_id: string; status: string; duration_ms: number } | undefined;
          if (!row || !segmentIdSet.has(row.segment_id)) return;
          if (!synthIdsRef.current.has(row.segment_id)) return;

          setCurrentlySynthesizingIds(prev => {
            const next = new Set(prev);
            next.delete(row.segment_id);
            onSynthesizingChange?.(next);
            return next;
          });
          setAudioStatus(prev => {
            const next = new Map(prev);
            next.set(row.segment_id, { status: row.status, durationMs: row.duration_ms });
            return next;
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [segments.map(s => s.segment_id).join(","), sceneId, onSynthesizingChange]);

  // ─── AI Actions (Background) ───────────────────────────────
  const bgAnalysis = useBackgroundAnalysis();

  // Reload from OPFS when a background job completes for the current scene
  useEffect(() => {
    if (!sceneId) return;
    const job = bgAnalysis.jobs.get(sceneId);
    if (job?.status === "done") {
      // Reload segments from OPFS
      loadSegments(sceneId);
    }
  }, [bgAnalysis.completionToken, sceneId, loadSegments]);

  const bgAnalyzing = sceneId ? bgAnalysis.isAnalyzing(sceneId) : false;

  const runAnalysis = useCallback(async () => {
    if (!sceneId) return;

    // Clear local state immediately
    setSegments([]);
    setAudioStatus(new Map());
    setInlineNarrationSegIds(new Set());
    setStaleAudioSegIds(new Set());
    setMergeChecked(new Set());
    setContentDirty(false);
    typeMappingsRef.current = [];
    setInlineNarrationSpeaker(null);

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
    // Rebuild typeMappings from current segments + characters
    const mappings: LocalTypeMappingEntry[] = [];
    const seen = new Set<string>();
    for (const seg of updatedSegments) {
      if (seg.speaker && !seen.has(seg.segment_type)) {
        const charRecord = characters.find(c => c.name === seg.speaker);
        if (charRecord) {
          mappings.push({ segmentType: seg.segment_type, characterId: charRecord.id, characterName: charRecord.name });
          seen.add(seg.segment_type);
        }
      }
    }
    typeMappingsRef.current = mappings;
  }, [characters]);

  const PROPAGATE_TYPES = new Set(["narrator", "first_person", "inner_thought", "epigraph", "lyric", "footnote"]);

  const TYPE_PROPAGATION_PAIRS: Record<string, string> = {
    narrator: "first_person",
    first_person: "narrator",
  };

  const updateSegmentType = useCallback(async (segmentId: string, newType: string) => {
    const targetSeg = segments.find(s => s.segment_id === segmentId);
    if (!targetSeg) return;
    const oldType = targetSeg.segment_type;

    const shouldPropagate = TYPE_PROPAGATION_PAIRS[oldType] === newType;
    const affectedIds = shouldPropagate
      ? segments.filter(s => s.segment_type === oldType).map(s => s.segment_id)
      : [segmentId];

    const updatedSegments = segments.map(seg =>
      affectedIds.includes(seg.segment_id) ? { ...seg, segment_type: newType } : seg
    );
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
  }, [isRu, segments, sceneId, syncTypeMappings, persist, buildSnapshot, onSegmented]);

  const updateSpeaker = useCallback(async (segmentId: string, newSpeaker: string | null) => {
    const targetSeg = segments.find(s => s.segment_id === segmentId);
    if (!targetSeg) return;

    const shouldPropagate = PROPAGATE_TYPES.has(targetSeg.segment_type);
    const affectedIds = shouldPropagate
      ? segments.filter(s => s.segment_type === targetSeg.segment_type).map(s => s.segment_id)
      : [segmentId];

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
        const updatedIndex = await upsertSpeakersFromSegments(storage, sceneId, updatedSegments, currentIndex);
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
  }, [isRu, segments, sceneId, storage, syncTypeMappings, persist, buildSnapshot, onSegmented]);

  // ─── Synthesis ────────────────────────────────────────────

  const runSynthesis = useCallback(async () => {
    if (!sceneId || segments.length === 0) return;
    const allIds = new Set(segments.map(s => s.segment_id));
    setSynthesizing(true);
    setCurrentlySynthesizingIds(allIds);
    onSynthesizingChange?.(allIds);
    onErrorSegmentsChange?.(new Set());
    setSynthProgress(isRu ? "Синхронизация с сервером…" : "Syncing to server…");
    try {
      // Push OPFS → DB before TTS (edge functions read from DB)
      await pushToDb(sceneId, buildSnapshot());
      setSynthProgress(isRu ? "Запуск синтеза…" : "Starting synthesis…");

      const { data, error } = await supabase.functions.invoke("synthesize-scene", {
        body: { scene_id: sceneId, language: isRu ? "ru" : "en" },
      });
      if (error) throw error;
      const synth = data as { synthesized: number; errors: number; total_duration_ms: number; results?: Array<{ segment_id: string; status: string; error?: string }> };
      const durSec = (synth.total_duration_ms / 1000).toFixed(1);

      const errorIds = new Set<string>();
      if (synth.results) {
        for (const r of synth.results) {
          if (r.status === "error") errorIds.add(r.segment_id);
        }
      }
      onErrorSegmentsChange?.(errorIds);

      if (synth.errors > 0) {
        toast.warning(
          isRu
            ? `Синтез: ${synth.synthesized} готово, ${synth.errors} ошибок (${durSec}с)`
            : `Synthesis: ${synth.synthesized} done, ${synth.errors} errors (${durSec}s)`
        );
      } else {
        toast.success(
          isRu
            ? `Синтез завершён: ${synth.synthesized} фрагм., ${durSec}с`
            : `Synthesis done: ${synth.synthesized} seg., ${durSec}s`
        );
      }
      onSegmented?.(sceneId);
      refreshAudioStatusFromDb(segments.map(s => s.segment_id));
    } catch (err: any) {
      console.error("Synthesis failed:", err);
      toast.error(isRu ? "Ошибка синтеза" : "Synthesis failed");
    }
    setSynthesizing(false);
    setCurrentlySynthesizingIds(new Set());
    onSynthesizingChange?.(new Set());
    setSynthProgress("");
  }, [sceneId, segments, isRu, onSegmented, refreshAudioStatusFromDb, onSynthesizingChange, onErrorSegmentsChange, pushToDb, buildSnapshot]);

  const resynthSegment = useCallback(async (segmentId: string) => {
    if (!sceneId) return;
    setResynthSegId(segmentId);
    setCurrentlySynthesizingIds(new Set([segmentId]));
    onSynthesizingChange?.(new Set([segmentId]));
    try {
      // Push current segment state to DB before re-synth
      await pushToDb(sceneId, buildSnapshot());

      const { data, error } = await supabase.functions.invoke("synthesize-scene", {
        body: { scene_id: sceneId, language: isRu ? "ru" : "en", force: true, segment_ids: [segmentId] },
      });
      if (error) throw error;

      const synth = data as {
        errors?: number;
        results?: Array<{ segment_id: string; status: string; error?: string }>;
      };
      const segmentResult = synth.results?.find((r) => r.segment_id === segmentId);

      if (!segmentResult || segmentResult.status !== "ready") {
        throw new Error(
          segmentResult?.error || (isRu ? "Синтез вернул неполный результат" : "Synthesis returned partial result")
        );
      }

      toast.success(isRu ? "Блок пересинтезирован" : "Segment re-synthesized");
      onErrorSegmentsChange?.(new Set());
      onSegmented?.(sceneId);
      await new Promise(r => setTimeout(r, 500));
      await refreshAudioStatusFromDb(segments.map(s => s.segment_id));
    } catch (err: any) {
      console.error("Re-synth failed:", err);
      toast.error(isRu ? "Ошибка ре-синтеза" : "Re-synthesis failed", {
        description: err?.message,
      });
      onErrorSegmentsChange?.(new Set([segmentId]));
      await refreshAudioStatusFromDb(segments.map(s => s.segment_id));
    }
    setResynthSegId(null);
    setCurrentlySynthesizingIds(new Set());
    onSynthesizingChange?.(new Set());
  }, [sceneId, isRu, onSegmented, refreshAudioStatusFromDb, segments, onSynthesizingChange, onErrorSegmentsChange, pushToDb, buildSnapshot]);

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

  if (loading || bgAnalyzing) {
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
            ? "Нет контента для анализа. Переанализируйте главу в Парсере."
            : "No content to analyze. Re-analyze the chapter in Parser."}
        </p>
      </div>
    );
  }

  const totalPhrases = segments.reduce((a, s) => a + s.phrases.length, 0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground font-body">
            {segments.length} {isRu ? "фрагм." : "seg."} · {totalPhrases} {isRu ? "фраз" : "phrases"}
            {inlineNarrationSegIds.size > 0 && (
              <span className="ml-1.5 text-accent-foreground">
                · <MessageCircle className="inline h-3 w-3 -mt-0.5" /> {inlineNarrationSegIds.size}
              </span>
            )}
          </span>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="sm" disabled={bgAnalyzing || !sceneContent} className="gap-1.5 h-7 text-xs">
                {bgAnalyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                {isRu ? "Переанализ" : "Re-analyze"}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{isRu ? "Переанализировать сцену?" : "Re-analyze scene?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {isRu
                    ? "Текущая раскадровка будет заменена. Существующие фразы, аудио и настройки голосов для этой сцены будут удалены."
                    : "Current segmentation will be replaced. Existing phrases, audio and voice settings for this scene will be deleted."}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
                <AlertDialogAction onClick={runAnalysis}>
                  {isRu ? "Переанализ" : "Re-analyze"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={!canMerge || merging || synthesizing}
            onClick={handleMergeSegments}
            title={isRu ? "Объединить выбранные соседние блоки" : "Merge selected adjacent segments"}
          >
            {merging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Merge className="h-3 w-3" />}
            {merging ? (isRu ? "Слияние…" : "Merging…") : (isRu ? "Объединить" : "Merge")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                disabled={mergeChecked.size === 0 || deleting || synthesizing}
                title={isRu ? "Удалить выбранные блоки" : "Delete selected segments"}
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {deleting ? (isRu ? "Удаление…" : "Deleting…") : (isRu ? "Удалить" : "Delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{isRu ? "Удалить блоки?" : "Delete segments?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {isRu
                    ? `Будет удалено ${mergeChecked.size} блок(ов) вместе с фразами и аудио. Это действие нельзя отменить.`
                    : `${mergeChecked.size} segment(s) will be deleted along with phrases and audio. This cannot be undone.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteSegments} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {isRu ? "Удалить" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          {dialogueCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={runDetectNarrations}
              disabled={detecting || bgAnalyzing || synthesizing}
              className="gap-1.5 h-7 text-xs"
              title={isRu ? "Поиск авторских вставок в диалогах" : "Detect narrator insertions in dialogues"}
            >
              {detecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
              {detecting ? (isRu ? "Поиск…" : "Detecting…") : (isRu ? "Вставки" : "Narrations")}
            </Button>
          )}
          {segments.length > 0 && (
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={correctingStress || bgAnalyzing || synthesizing}
                  className="gap-1.5 h-7 text-xs"
                  title={isRu ? "Коррекция ударений" : "Stress correction"}
                >
                  {correctingStress ? <Loader2 className="h-3 w-3 animate-spin" /> : <SpellCheck className="h-3 w-3" />}
                  {isRu ? "Ударения" : "Stress"}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-56 p-2" align="start">
                <div className="flex flex-col gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start gap-2 h-8 text-xs"
                    onClick={() => runStressCorrection("suggest")}
                    disabled={correctingStress}
                  >
                    <Sparkles className="h-3 w-3" />
                    {isRu ? "Найти неоднозначные" : "Find ambiguous"}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="justify-start gap-2 h-8 text-xs"
                    onClick={() => runStressCorrection("correct")}
                    disabled={correctingStress}
                  >
                    <CheckCircle2 className="h-3 w-3" />
                    {isRu ? "Применить словарь" : "Apply dictionary"}
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          )}
          {staleAudioSegIds.size > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={cleanStaleInlineAudio}
              disabled={cleaningMetadata || synthesizing}
              className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive"
              title={isRu
                ? `Очистить ${staleAudioSegIds.size} устаревших аудио-вставок (без ре-синтеза)`
                : `Clear ${staleAudioSegIds.size} stale audio metadata (no re-synthesis)`}
            >
              {cleaningMetadata ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eraser className="h-3 w-3" />}
              {staleAudioSegIds.size}
            </Button>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <div className="flex items-center gap-1 border-r border-border pr-2 mr-0.5">
            <Timer className="h-3 w-3 text-muted-foreground" />
            {[1, 2, 3].map((sec) => (
              <button
                key={sec}
                onClick={() => onSilenceSecChange?.(sec)}
                className={cn(
                  "h-5 w-5 text-[10px] font-mono rounded transition-colors",
                  (silenceSec ?? 2) === sec
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                )}
                title={isRu ? `Тишина в начале: ${sec}с` : `Start silence: ${sec}s`}
              >
                {sec}
              </button>
            ))}
            <span className="text-[10px] text-muted-foreground ml-0.5">
              {isRu ? "сек" : "s"}
            </span>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={runSynthesis}
            disabled={synthesizing || bgAnalyzing || segments.length === 0}
            className="gap-1.5 h-7 text-xs"
          >
            {synthesizing ? <AudioLines className="h-3 w-3 animate-pulse-glow text-primary" /> : <AudioLines className="h-3 w-3" />}
            {synthesizing
              ? (synthProgress || (isRu ? "Синтез…" : "Synth…"))
              : (isRu ? "Синтез сцены" : "Synthesize")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={recalcRunning || !sceneId || audioStatus.size === 0}
            onClick={handleRecalcDurations}
            title={isRu ? "Пересчитать длительности из MP3" : "Recalculate durations from MP3"}
          >
            {recalcRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Timer className="h-3 w-3" />}
            {isRu ? "Пересчёт" : "Recalc"}
          </Button>
        </div>
      </div>
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
          {segments.map((seg) => {
            const isSelected = selectedSegmentId === seg.segment_id;
            return (
              <div
                key={seg.segment_id}
                id={`storyboard-seg-${seg.segment_id}`}
                className={`rounded-lg border overflow-hidden transition-all cursor-pointer ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/30 bg-card"
                    : "border-border bg-card/50"
                }`}
                onClick={() => onSelectSegment?.(isSelected ? null : seg.segment_id)}
              >
                {/* Segment header */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/30">
                  <RoleBadge roleId="screenwriter" model={getModelForRole("screenwriter")} isRu={isRu} size={12} />
                  <SegmentTypeBadge
                    segmentType={seg.segment_type}
                    isRu={isRu}
                    onChange={(newType) => updateSegmentType(seg.segment_id, newType)}
                  />
                  {seg.segment_type !== "narrator" && seg.segment_type !== "footnote" && (
                    <SpeakerBadge
                      speaker={seg.speaker}
                      characters={characters}
                      isRu={isRu}
                      onChange={(newSpeaker) => updateSpeaker(seg.segment_id, newSpeaker)}
                    />
                  )}
                  {seg.segment_type === "lyric" && (
                    <span
                      className="text-[10px] text-pink-400 italic"
                      title={isRu
                        ? "Рекомендация: Yandex filipp/madirus (SSML контроль), OpenAI Onyx (натуральность), Sber Bora (эмоции)"
                        : "Tip: Yandex filipp/madirus (SSML control), OpenAI Onyx (natural), Sber Bora (emotions)"}
                    >
                      🎭 {isRu ? "стих" : "verse"}
                    </span>
                  )}
                  {(() => {
                    const audio = audioStatus.get(seg.segment_id);
                    if (!audio) return null;
                    const durSec = (audio.durationMs / 1000).toFixed(1);
                    return audio.status === "ready" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-green-400 font-mono">
                        <CheckCircle2 className="h-3 w-3" />
                        {durSec}s
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-destructive font-mono">
                        <XCircle className="h-3 w-3" />
                        {isRu ? "ошибка" : "error"}
                      </span>
                    );
                  })()}
                  {seg.inline_narrations && seg.inline_narrations.length > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] text-accent-foreground font-mono"
                      title={isRu
                        ? `${seg.inline_narrations.length} авторская вставка`
                        : `${seg.inline_narrations.length} narrator insertion(s)`}
                    >
                      <MessageCircle className="h-3 w-3" />
                      {seg.inline_narrations.length}
                    </span>
                  )}
                  <button
                    onClick={(e) => { e.stopPropagation(); resynthSegment(seg.segment_id); }}
                    disabled={resynthSegId === seg.segment_id || synthesizing}
                    className="ml-1 p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    title={audioStatus.get(seg.segment_id)
                      ? (isRu ? "Ре-синтез блока" : "Re-synthesize segment")
                      : (isRu ? "Синтез блока" : "Synthesize segment")}
                  >
                    {resynthSegId === seg.segment_id
                      ? <AudioLines className="h-3 w-3 animate-pulse-glow text-primary" />
                      : audioStatus.get(seg.segment_id)
                        ? <RefreshCw className="h-3 w-3" />
                        : <AudioLines className="h-3 w-3" />}
                  </button>
                  <div className="ml-auto flex items-center gap-1.5">
                    {seg.split_silence_ms !== undefined && (
                      <div className="flex items-center gap-0.5 border-r border-border pr-1.5 mr-0.5" onClick={(e) => e.stopPropagation()}>
                        <Timer className="h-3 w-3 text-muted-foreground" />
                        {[0, 500, 1000, 1500, 2000].map((ms) => (
                          <button
                            key={ms}
                            onClick={() => handleSplitSilenceChange(seg.segment_id, ms)}
                            className={cn(
                              "h-4 min-w-[20px] text-[9px] font-mono rounded transition-colors",
                              (seg.split_silence_ms ?? 0) === ms
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted/50 text-muted-foreground hover:bg-muted"
                            )}
                            title={`${ms}ms`}
                          >
                            {ms === 0 ? "0" : (ms / 1000).toFixed(1)}
                          </button>
                        ))}
                        <span className="text-[9px] text-muted-foreground">{isRu ? "с" : "s"}</span>
                      </div>
                    )}
                    <span className="text-[10px] text-muted-foreground font-mono">
                      #{seg.segment_number}
                    </span>
                    <Checkbox
                      checked={mergeChecked.has(seg.segment_id)}
                      onCheckedChange={() => toggleMergeCheck(seg.segment_id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5"
                    />
                  </div>
                </div>
                {/* Phrases */}
                <div className="divide-y divide-border/30">
                  {seg.phrases.map((ph) => (
                    <EditablePhrase
                      key={ph.phrase_id}
                      phrase={ph}
                      isRu={isRu}
                      onSave={savePhrase}
                      onSplit={handleSplitAtPhrase}
                      ttsProvider={seg.speaker ? (speakerProviderMap.get(seg.speaker.toLowerCase()) ?? "yandex") : "yandex"}
                      onAnnotate={saveAnnotation}
                      onRemoveAnnotation={removeAnnotation}
                    />
                  ))}
                </div>
                {seg.inline_narrations && seg.inline_narrations.length > 0 && (
                  <div className="px-3 py-1 bg-accent/10 border-t border-border/30">
                    <div className="flex items-center gap-2 mb-1">
                      <BookOpen className="h-3 w-3 text-yellow-400/70" />
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {isRu ? "Голос вставок:" : "Narration voice:"}
                      </span>
                      <SpeakerBadge
                        speaker={inlineNarrationSpeaker}
                        characters={characters}
                        isRu={isRu}
                        onChange={updateInlineNarrationSpeaker}
                      />
                    </div>
                    {seg.inline_narrations.map((n, idx) => (
                      <div key={idx} className="text-sm font-body flex items-start gap-1 leading-relaxed group/narr">
                        <BookOpen className="h-3 w-3 mt-1 shrink-0 text-yellow-400/70" />
                        <span className="text-muted-foreground/60 shrink-0">
                          {isRu ? "после" : "after"} «{n.insert_after.slice(0, 20)}{n.insert_after.length > 20 ? "…" : ""}»
                        </span>
                        <span className="text-muted-foreground/60">→</span>
                        <span className="text-yellow-300/70">«{n.text}»</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); removeInlineNarration(seg.segment_id, idx); }}
                          className="shrink-0 mt-0.5 opacity-0 group-hover/narr:opacity-100 transition-opacity text-destructive/60 hover:text-destructive"
                          title={isRu ? "Удалить вставку" : "Remove narration"}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
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
