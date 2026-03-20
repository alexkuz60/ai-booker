import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronRight, ChevronDown, Clapperboard, Film, Volume2, AlertTriangle, RefreshCw, Loader2, Clock, Timer, BookOpen, Scissors, Disc, Sparkles } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { StudioChapter } from "@/lib/studioChapter";
import { estimateSceneDuration, formatDuration } from "@/lib/durationEstimate";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

// ─── Scene type colors (same as Parser) ─────────────────────
export const SCENE_TYPE_COLORS: Record<string, string> = {
  action: "bg-red-500/20 text-red-400 border-red-500/30",
  dialogue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  lyrical_digression: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  description: "bg-green-500/20 text-green-400 border-green-500/30",
  inner_monologue: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  mixed: "bg-muted text-muted-foreground border-border",
};

export const SCENE_TYPE_RU: Record<string, string> = {
  action: "действие",
  dialogue: "диалог",
  lyrical_digression: "лир. отступление",
  description: "описание",
  inner_monologue: "внутр. монолог",
  mixed: "смешанный",
};

// ─── Book-wide stale segment info ───────────────────────────
interface StaleSegmentInfo {
  segmentId: string;
  sceneId: string;
  speaker: string | null;
  currentVoice: string;
  savedVoice: string;
}

interface BookStaleReport {
  staleSegments: StaleSegmentInfo[];
  totalAudioSegments: number;
  scenesAffected: Set<string>;
  providerBreakdown: Map<string, number>; // provider -> count
}

async function scanBookForStaleAudio(bookId: string): Promise<BookStaleReport> {
  const report: BookStaleReport = {
    staleSegments: [],
    totalAudioSegments: 0,
    scenesAffected: new Set(),
    providerBreakdown: new Map(),
  };

  // Load all characters with voice configs
  const { data: chars } = await supabase
    .from("book_characters")
    .select("name, aliases, voice_config")
    .eq("book_id", bookId);
  if (!chars?.length) return report;

  const charVoiceMap = new Map<string, Record<string, unknown>>();
  for (const c of chars) {
    const vc = (c.voice_config || {}) as Record<string, unknown>;
    charVoiceMap.set((c.name || "").toLowerCase(), vc);
    for (const a of (c.aliases || [])) {
      charVoiceMap.set((a as string).toLowerCase(), vc);
    }
  }

  // Load all chapters -> scenes -> segments -> audio for the book
  const { data: chapters } = await supabase
    .from("book_chapters")
    .select("id")
    .eq("book_id", bookId);
  if (!chapters?.length) return report;

  const chapterIds = chapters.map(c => c.id);
  const { data: scenes } = await supabase
    .from("book_scenes")
    .select("id")
    .in("chapter_id", chapterIds);
  if (!scenes?.length) return report;

  const sceneIds = scenes.map(s => s.id);

  // Load all segments for these scenes
  const { data: segments } = await supabase
    .from("scene_segments")
    .select("id, scene_id, speaker")
    .in("scene_id", sceneIds);
  if (!segments?.length) return report;

  const segIds = segments.map(s => s.id);

  // Load all ready audio
  const { data: audioData } = await supabase
    .from("segment_audio")
    .select("segment_id, voice_config, status")
    .in("segment_id", segIds)
    .eq("status", "ready");
  if (!audioData?.length) return report;

  report.totalAudioSegments = audioData.length;

  const segToSpeaker = new Map(segments.map(s => [s.id, s.speaker]));
  const segToScene = new Map(segments.map(s => [s.id, s.scene_id]));

  const COMPARE_KEYS = ["voice", "role", "speed", "pitchShift", "volume", "provider", "model"];

  for (const a of audioData) {
    const speaker = segToSpeaker.get(a.segment_id);
    if (!speaker) continue;

    const currentVc = charVoiceMap.get(speaker.toLowerCase());
    if (!currentVc || !currentVc.voice) continue;

    const savedVc = (a.voice_config || {}) as Record<string, unknown>;

    const changed = COMPARE_KEYS.some(k => {
      const cur = currentVc[k];
      const sav = savedVc[k];
      const curStr = (cur !== undefined && cur !== null && cur !== "") ? String(cur) : "";
      const savStr = (sav !== undefined && sav !== null && sav !== "") ? String(sav) : "";
      if (k === "speed" || k === "pitchShift" || k === "volume") {
        const curNum = curStr ? Number(curStr) : -999;
        const savNum = savStr ? Number(savStr) : -999;
        return Math.abs(curNum - savNum) > 0.01;
      }
      return curStr !== savStr;
    });

    if (changed) {
      const sceneId = segToScene.get(a.segment_id) || "";
      report.staleSegments.push({
        segmentId: a.segment_id,
        sceneId,
        speaker,
        currentVoice: String(currentVc.voice || ""),
        savedVoice: String(savedVc.voice || ""),
      });
      report.scenesAffected.add(sceneId);

      const provider = String(currentVc.provider || savedVc.provider || "yandex");
      report.providerBreakdown.set(provider, (report.providerBreakdown.get(provider) || 0) + 1);
    }
  }

  return report;
}

// ─── Chapter Navigator ──────────────────────────────────────

export function ChapterNavigator({
  chapter,
  selectedSceneIdx,
  onSelectScene,
  isRu,
  segmentedSceneIds,
  renderedSceneIds,
  fullyRenderedSceneIds,
  staleAudioSceneIds,
  onBatchResynthDone,
  clipsRefreshToken,
  bookId,
  onPlaylistDurationsLoaded,
  selectedSceneIndices,
  onSelectedSceneIndicesChange,
  onBatchAnalyze,
}: {
  chapter: StudioChapter;
  selectedSceneIdx: number | null;
  onSelectScene: (idx: number | null) => void;
  isRu: boolean;
  segmentedSceneIds?: Set<string>;
  renderedSceneIds?: Set<string>;
  fullyRenderedSceneIds?: Set<string>;
  staleAudioSceneIds?: Set<string>;
  onBatchResynthDone?: () => void;
  clipsRefreshToken?: number;
  bookId?: string | null;
  onPlaylistDurationsLoaded?: (m: Map<string, number>) => void;
  selectedSceneIndices?: Set<number>;
  onSelectedSceneIndicesChange?: (indices: Set<number>) => void;
  onBatchAnalyze?: (sceneIds: string[]) => void;
}) {
  const navigate = useNavigate();
  const [chapterOpen, setChapterOpen] = useState(true);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");
  const [recalcRunning, setRecalcRunning] = useState(false);

  // Book-wide stale scan
  const [scanning, setScanning] = useState(false);
  const [staleReport, setStaleReport] = useState<BookStaleReport | null>(null);
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);
  const [bookResynthRunning, setBookResynthRunning] = useState(false);
  const [bookResynthProgress, setBookResynthProgress] = useState("");

  // Load actual durations from scene_playlists
  const [playlistDurations, setPlaylistDurations] = useState<Map<string, number>>(new Map());
  // Render status: 'full' | 'partial' | undefined (none)
  const [renderStatus, setRenderStatus] = useState<Map<string, "full" | "partial">>(new Map());
  // Dirty scenes (edited in Parser, need re-analysis)
  const [dirtySceneIds, setDirtySceneIds] = useState<Set<string>>(new Set());
  useEffect(() => {
    const sceneIds = chapter.scenes.map(s => s.id).filter(Boolean) as string[];
    if (sceneIds.length === 0) return;
    (async () => {
      const [{ data: plData }, { data: rnData }, { data: dirtyData }] = await Promise.all([
        supabase
          .from("scene_playlists")
          .select("scene_id, total_duration_ms")
          .in("scene_id", sceneIds),
        supabase
          .from("scene_renders")
          .select("scene_id, voice_path, atmo_path, sfx_path, status")
          .in("scene_id", sceneIds),
        supabase
          .from("book_scenes")
          .select("id, content_dirty")
          .in("id", sceneIds)
          .eq("content_dirty", true),
      ]);
      if (plData) {
        const map = new Map<string, number>();
        for (const d of plData) map.set(d.scene_id, d.total_duration_ms);
        setPlaylistDurations(map);
        onPlaylistDurationsLoaded?.(map);
      }
      if (rnData) {
        const map = new Map<string, "full" | "partial">();
        for (const r of rnData) {
          const paths = [r.voice_path, r.atmo_path, r.sfx_path].filter(Boolean);
          if (paths.length === 3) map.set(r.scene_id, "full");
          else if (paths.length > 0) map.set(r.scene_id, "partial");
        }
        setRenderStatus(map);
      }
      if (dirtyData) {
        setDirtySceneIds(new Set(dirtyData.map(d => d.id)));
      }
    })();
  }, [chapter.scenes.map(s => s.id).join(","), clipsRefreshToken]);

  const staleCount = staleAudioSceneIds?.size ?? 0;
  const lastClickedIdxRef = useRef<number | null>(null);

  const handleSceneClick = useCallback((idx: number, e: React.MouseEvent) => {
    // Multi-select with Ctrl/Cmd or Shift
    if ((e.ctrlKey || e.metaKey) && onSelectedSceneIndicesChange) {
      const next = new Set(selectedSceneIndices ?? []);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      onSelectedSceneIndicesChange(next);
      lastClickedIdxRef.current = idx;
      return;
    }
    if (e.shiftKey && onSelectedSceneIndicesChange && lastClickedIdxRef.current !== null) {
      const from = Math.min(lastClickedIdxRef.current, idx);
      const to = Math.max(lastClickedIdxRef.current, idx);
      const next = new Set(selectedSceneIndices ?? []);
      for (let i = from; i <= to; i++) next.add(i);
      onSelectedSceneIndicesChange(next);
      return;
    }
    // Normal click: clear multi-select, select single
    if (onSelectedSceneIndicesChange) onSelectedSceneIndicesChange(new Set());
    lastClickedIdxRef.current = idx;
    onSelectScene(idx);
  }, [onSelectScene, onSelectedSceneIndicesChange, selectedSceneIndices]);

  const multiCount = selectedSceneIndices?.size ?? 0;
  const handleBatchAnalyzeClick = useCallback(() => {
    if (!onBatchAnalyze || !selectedSceneIndices || multiCount === 0) return;
    const ids = [...selectedSceneIndices]
      .sort((a, b) => a - b)
      .map(i => chapter.scenes[i]?.id)
      .filter(Boolean) as string[];
    if (ids.length > 0) onBatchAnalyze(ids);
  }, [onBatchAnalyze, selectedSceneIndices, multiCount, chapter.scenes]);


  const handleBatchResynth = async () => {
    if (!staleAudioSceneIds || staleCount === 0) return;
    setBatchRunning(true);
    const staleIds = [...staleAudioSceneIds];
    let done = 0;
    let errors = 0;
    for (const sceneId of staleIds) {
      done++;
      setBatchProgress(`${done}/${staleIds.length}`);
      try {
        const { error } = await supabase.functions.invoke("synthesize-scene", {
          body: { scene_id: sceneId, language: isRu ? "ru" : "en", force: true },
        });
        if (error) {
          console.error("Batch resynth error for scene", sceneId, error);
          errors++;
        }
      } catch (e) {
        console.error("Batch resynth exception for scene", sceneId, e);
        errors++;
      }
    }
    setBatchRunning(false);
    setBatchProgress("");
    onBatchResynthDone?.();
    if (errors === 0) {
      toast.success(isRu ? `Ре-синтез завершён: ${staleIds.length} сцен` : `Re-synthesis complete: ${staleIds.length} scenes`);
    } else {
      toast.warning(isRu ? `Ре-синтез: ${staleIds.length - errors} ок, ${errors} ошибок` : `Re-synthesis: ${staleIds.length - errors} ok, ${errors} errors`);
    }
  };

  const handleRecalcDurations = async () => {
    const sceneWithId = chapter.scenes.find(s => s.id);
    if (!sceneWithId?.id) return;

    setRecalcRunning(true);
    try {
      const { data: sceneRow } = await supabase
        .from("book_scenes")
        .select("chapter_id")
        .eq("id", sceneWithId.id)
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
        console.error("recalc-durations error:", error);
      } else {
        const result = data as { updated: number; errors: number; total: number };
        if (result.updated > 0) {
          toast.success(
            isRu
              ? `Обновлено ${result.updated} из ${result.total} клипов`
              : `Updated ${result.updated} of ${result.total} clips`
          );
          onBatchResynthDone?.();
        } else {
          toast.info(
            isRu
              ? `Все длительности актуальны (${result.total} клипов)`
              : `All durations up to date (${result.total} clips)`
          );
        }
      }
    } catch (e) {
      console.error("recalc-durations exception:", e);
      toast.error(isRu ? "Ошибка пересчёта длительностей" : "Duration recalc error");
    }
    setRecalcRunning(false);
  };

  // ── Book-wide stale scan ──
  const handleBookStaleScan = useCallback(async () => {
    if (!bookId) {
      toast.error(isRu ? "ID книги не определён" : "Book ID not found");
      return;
    }
    setScanning(true);
    try {
      const report = await scanBookForStaleAudio(bookId);
      setStaleReport(report);
      if (report.staleSegments.length === 0) {
        toast.success(isRu ? "Все аудио актуальны — устаревших нет" : "All audio up to date — no stale segments");
      } else {
        setShowConfirmDialog(true);
      }
    } catch (e) {
      console.error("Book stale scan error:", e);
      toast.error(isRu ? "Ошибка сканирования" : "Scan error");
    }
    setScanning(false);
  }, [bookId, isRu]);

  // ── Book-wide resynth ──
  const handleBookResynth = useCallback(async () => {
    if (!staleReport) return;
    setShowConfirmDialog(false);
    setBookResynthRunning(true);

    const affectedScenes = [...staleReport.scenesAffected];
    let done = 0;
    let errors = 0;

    for (const sceneId of affectedScenes) {
      done++;
      setBookResynthProgress(`${done}/${affectedScenes.length}`);
      try {
        // Only re-synth stale segment_ids within each scene
        const staleSegIds = staleReport.staleSegments
          .filter(s => s.sceneId === sceneId)
          .map(s => s.segmentId);

        const { error } = await supabase.functions.invoke("synthesize-scene", {
          body: {
            scene_id: sceneId,
            language: isRu ? "ru" : "en",
            force: true,
            segment_ids: staleSegIds,
          },
        });
        if (error) {
          console.error("Book resynth error for scene", sceneId, error);
          errors++;
        }
      } catch (e) {
        console.error("Book resynth exception for scene", sceneId, e);
        errors++;
      }
    }

    setBookResynthRunning(false);
    setBookResynthProgress("");
    setStaleReport(null);
    onBatchResynthDone?.();

    if (errors === 0) {
      toast.success(
        isRu
          ? `Ре-синтез завершён: ${staleReport.staleSegments.length} сегментов в ${affectedScenes.length} сценах`
          : `Re-synthesis complete: ${staleReport.staleSegments.length} segments in ${affectedScenes.length} scenes`
      );
    } else {
      toast.warning(
        isRu
          ? `Ре-синтез: ${affectedScenes.length - errors} ок, ${errors} ошибок`
          : `Re-synthesis: ${affectedScenes.length - errors} ok, ${errors} errors`
      );
    }
  }, [staleReport, isRu, onBatchResynthDone]);

  // Compute total chapter duration
  let chapterTotalSec = 0;
  for (const scene of chapter.scenes) {
    const actualMs = scene.id ? playlistDurations.get(scene.id) : undefined;
    if (actualMs && actualMs > 0) {
      chapterTotalSec += actualMs / 1000;
    } else {
      chapterTotalSec += estimateSceneDuration(scene).sec;
    }
  }

  // Build provider cost estimate text
  const buildCostWarning = (report: BookStaleReport): string => {
    const lines: string[] = [];
    for (const [provider, count] of report.providerBreakdown) {
      const label = provider === "elevenlabs" ? "ElevenLabs" : provider === "proxyapi" ? "OpenAI (ProxyAPI)" : "Yandex TTS";
      lines.push(`• ${label}: ${count} ${isRu ? "сегм." : "seg."}`);
    }
    return lines.join("\n");
  };

  return (
    <div className="h-full flex flex-col border-r border-border">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-body">
            {isRu ? "Глава" : "Chapter"}
          </span>
          {staleCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] gap-1 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10"
              disabled={batchRunning}
              onClick={handleBatchResynth}
              title={isRu ? `Ре-синтез ${staleCount} устаревших сцен главы` : `Re-synthesize ${staleCount} stale scenes in chapter`}
            >
              {batchRunning ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>{batchProgress}</span>
                </>
              ) : (
                <>
                  <RefreshCw className="h-3 w-3" />
                  <span>{staleCount}</span>
                </>
              )}
            </Button>
          )}
          {/* Book-wide stale scan button */}
          <Button
            size="sm"
            variant="ghost"
            className={cn("h-6 w-6 p-0", staleCount > 0 ? "" : "ml-auto")}
            disabled={scanning || bookResynthRunning}
            onClick={handleBookStaleScan}
            title={isRu ? "Сканировать всю книгу на устаревшее аудио" : "Scan entire book for stale audio"}
          >
            {scanning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : bookResynthRunning ? (
              <Loader2 className="h-3 w-3 animate-spin text-yellow-500" />
            ) : (
              <BookOpen className="h-3 w-3" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className={cn("h-6 w-6 p-0", staleCount > 0 || true ? "" : "ml-auto")}
            disabled={recalcRunning}
            onClick={handleRecalcDurations}
            title={isRu ? "Пересчитать длительности из MP3" : "Recalculate durations from MP3"}
          >
            {recalcRunning ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Timer className="h-3 w-3" />
            )}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-6 w-6 p-0"
            onClick={() => {
              if (bookId) sessionStorage.setItem("montage_book_id", bookId);
              const chapterId = chapter.scenes[0]?.id ? undefined : undefined;
              // Find chapter ID from scenes
              const sceneId = chapter.scenes[0]?.id;
              if (sceneId) {
                supabase.from("book_scenes").select("chapter_id").eq("id", sceneId).single().then(({ data }) => {
                  if (data?.chapter_id) sessionStorage.setItem("montage_chapter_id", data.chapter_id);
                  navigate("/montage");
                });
              } else {
                navigate("/montage");
              }
            }}
            title={isRu ? "Открыть в Монтаже" : "Open in Montage"}
          >
            <Scissors className="h-3 w-3" />
          </Button>
        </div>
        {multiCount > 0 && (
          <div className="flex items-center gap-2 mt-1.5 px-0.5">
            <Badge variant="secondary" className="text-[10px]">
              {multiCount} {isRu ? "выбр." : "sel."}
            </Badge>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[11px] gap-1"
              onClick={handleBatchAnalyzeClick}
            >
              <Sparkles className="h-3 w-3" />
              {isRu ? "Анализ выбранных" : "Analyze Selected"}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 px-1.5 text-[11px]"
              onClick={() => onSelectedSceneIndicesChange?.(new Set())}
            >
              ✕
            </Button>
          </div>
        )}
        <div className="flex items-center gap-2 mt-0.5">
          <p className="text-xs text-muted-foreground truncate flex-1">
            {chapter.bookTitle}
          </p>
          {bookResynthRunning && (
            <span className="text-[10px] text-yellow-500 font-mono shrink-0">
              {bookResynthProgress}
            </span>
          )}
        </div>
      </div>
      <ScrollArea type="always" className="flex-1 min-h-0">
        <div className="py-2 px-1">
          <Collapsible open={chapterOpen} onOpenChange={setChapterOpen}>
            <CollapsibleTrigger asChild>
              <button
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-base font-body rounded-md transition-colors",
                  "hover:bg-accent/50 font-semibold text-foreground"
                )}
                onClick={() => onSelectScene(null)}
              >
                {chapterOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate flex-1">{chapter.chapterTitle}</span>
                {chapterTotalSec > 0 && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono shrink-0">
                    <Clock className="h-3 w-3" />
                    {formatDuration(Math.round(chapterTotalSec))}
                  </span>
                )}
                <Badge variant="outline" className="text-[11px] shrink-0">
                  {chapter.scenes.length}
                </Badge>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-0.5">
              {chapter.scenes.map((scene, idx) => {
                  const colorClass = SCENE_TYPE_COLORS[scene.scene_type] || SCENE_TYPE_COLORS.mixed;
                  const est = estimateSceneDuration(scene);
                  const actualMs = scene.id ? playlistDurations.get(scene.id) : undefined;
                   const actualSec = actualMs && actualMs > 0 ? Math.round(actualMs / 1000) : null;
                   const displayDuration = actualSec ? formatDuration(actualSec) : est.formatted;
                   const isStale = staleAudioSceneIds?.has(scene.id || "");
                   const isActual = !!actualSec;
                   const sceneRender = scene.id ? renderStatus.get(scene.id) : undefined;
                   const isMultiSelected = selectedSceneIndices?.has(idx);
                   const isDirty = dirtySceneIds.has(scene.id || "");

                  const durationColor = isStale
                    ? "text-yellow-500"
                    : isActual
                      ? "text-emerald-500"
                      : "text-muted-foreground";

                  return (
                    <button
                      key={idx}
                      onClick={(e) => handleSceneClick(idx, e)}
                      className={cn(
                        "w-full flex items-center gap-2 pl-9 pr-3 py-2 text-sm font-body rounded-md transition-colors text-left",
                        "hover:bg-accent/50",
                        isMultiSelected && "bg-primary/15 border-l-2 border-primary",
                        !isMultiSelected && selectedSceneIdx === idx && "bg-primary/10 text-primary border-r-2 border-primary"
                      )}
                    >
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] border shrink-0", colorClass)}>
                        {isRu ? (SCENE_TYPE_RU[scene.scene_type] || scene.scene_type) : scene.scene_type}
                      </span>
                      <span className="truncate flex-1">{scene.title}</span>
                       {isStale && (
                         <span title={isRu ? "Голос изменился — аудио устарело" : "Voice changed — audio outdated"}>
                           <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                         </span>
                       )}
                       {sceneRender === "full" ? (
                         <span title={isRu ? "Рендер готов (3 стема)" : "Render ready (3 stems)"}>
                           <Disc className="h-3 w-3 text-emerald-500 shrink-0" />
                         </span>
                       ) : sceneRender === "partial" ? (
                         <span title={isRu ? "Частичный рендер" : "Partial render"}>
                           <Disc className="h-3 w-3 text-yellow-500 shrink-0" />
                         </span>
                       ) : null}
                      {fullyRenderedSceneIds?.has(scene.id || "") ? (
                        <span title={isRu ? "Все клипы готовы" : "All clips ready"}>
                          <Volume2 className="h-3 w-3 text-foreground shrink-0" />
                        </span>
                      ) : renderedSceneIds?.has(scene.id || "") ? (
                        <span title={isRu ? "Частично отрендерено" : "Partially rendered"}>
                          <Volume2 className="h-3 w-3 text-muted-foreground shrink-0" strokeWidth={1.5} />
                        </span>
                      ) : segmentedSceneIds?.has(scene.id || "") ? (
                        <span title={isRu ? "Сегментировано" : "Segmented"}>
                          <Film className="h-3 w-3 text-primary shrink-0" />
                        </span>
                      ) : null}
                      <span
                        className={cn("text-[11px] font-mono shrink-0", durationColor)}
                        title={
                          isStale
                            ? (isRu ? "Аудио устарело — требуется ре-синтез" : "Audio stale — re-synthesis needed")
                            : isActual
                              ? `${isRu ? "Фактическое время" : "Actual duration"} (${est.chars} ${isRu ? "сим." : "chars"})`
                              : `≈ ${est.chars} ${isRu ? "сим." : "chars"}`
                        }
                      >
                        {!isActual && "≈"}{displayDuration}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>

      {/* Book-wide stale confirmation dialog */}
      <AlertDialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-yellow-500" />
              {isRu ? "Устаревшее аудио в книге" : "Stale Audio in Book"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  {isRu
                    ? `Обнаружено ${staleReport?.staleSegments.length ?? 0} устаревших сегментов в ${staleReport?.scenesAffected.size ?? 0} сценах (из ${staleReport?.totalAudioSegments ?? 0} аудио-сегментов в книге).`
                    : `Found ${staleReport?.staleSegments.length ?? 0} stale segments in ${staleReport?.scenesAffected.size ?? 0} scenes (out of ${staleReport?.totalAudioSegments ?? 0} audio segments in the book).`
                  }
                </p>

                {staleReport && staleReport.providerBreakdown.size > 0 && (
                  <div className="bg-muted/50 rounded-md p-3 space-y-1">
                    <p className="font-medium text-foreground text-xs">
                      {isRu ? "Расход по провайдерам:" : "Cost by provider:"}
                    </p>
                    {[...staleReport.providerBreakdown.entries()].map(([provider, count]) => {
                      const label = provider === "elevenlabs" ? "ElevenLabs" : provider === "proxyapi" ? "OpenAI (ProxyAPI)" : "Yandex TTS";
                      const isExpensive = provider === "elevenlabs" || provider === "proxyapi";
                      return (
                        <div key={provider} className={cn("flex items-center gap-2 text-xs", isExpensive ? "text-yellow-500" : "text-muted-foreground")}>
                          {isExpensive && <AlertTriangle className="h-3 w-3" />}
                          <span>{label}: {count} {isRu ? "сегм." : "seg."}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <p className="text-yellow-600 dark:text-yellow-400 font-medium text-xs">
                  {isRu
                    ? "⚠ Ре-синтез использует API речевых движков и может повлечь дополнительные расходы. Каждый сегмент будет заново озвучен с текущими голосовыми настройками персонажей."
                    : "⚠ Re-synthesis uses speech engine APIs and may incur additional costs. Each segment will be re-voiced with current character voice settings."
                  }
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleBookResynth}
              className="bg-yellow-600 hover:bg-yellow-700 text-white"
            >
              <RefreshCw className="h-4 w-4 mr-2" />
              {isRu
                ? `Ре-синтез ${staleReport?.staleSegments.length ?? 0} сегментов`
                : `Re-synth ${staleReport?.staleSegments.length ?? 0} segments`
              }
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────

export function EmptyNavigator({ isRu }: { isRu: boolean }) {
  return (
    <div className="h-full flex flex-col border-r border-border">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
          {isRu ? "Глава" : "Chapter"}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <Clapperboard className="h-8 w-8 mx-auto text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "Откройте главу из Парсера, нажав иконку 🎬 рядом с проанализированной главой"
              : "Open a chapter from Parser by clicking the 🎬 icon next to an analyzed chapter"}
          </p>
        </div>
      </div>
    </div>
  );
}
