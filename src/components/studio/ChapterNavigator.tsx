import { useState, useEffect } from "react";
import { ChevronRight, ChevronDown, Clapperboard, Film, Volume2, AlertTriangle, RefreshCw, Loader2, Clock } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
}) {
  const [chapterOpen, setChapterOpen] = useState(true);
  const [batchRunning, setBatchRunning] = useState(false);
  const [batchProgress, setBatchProgress] = useState("");

  // Load actual durations from scene_playlists
  const [playlistDurations, setPlaylistDurations] = useState<Map<string, number>>(new Map());
  useEffect(() => {
    const sceneIds = chapter.scenes.map(s => s.id).filter(Boolean) as string[];
    if (sceneIds.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("scene_playlists")
        .select("scene_id, total_duration_ms")
        .in("scene_id", sceneIds);
      if (data) {
        const map = new Map<string, number>();
        for (const d of data) map.set(d.scene_id, d.total_duration_ms);
        setPlaylistDurations(map);
      }
    })();
  }, [chapter.scenes.map(s => s.id).join(","), clipsRefreshToken]);

  const staleCount = staleAudioSceneIds?.size ?? 0;

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
              className="ml-auto h-6 px-2 text-[11px] gap-1 text-yellow-500 border-yellow-500/30 hover:bg-yellow-500/10"
              disabled={batchRunning}
              onClick={handleBatchResynth}
              title={isRu ? `Ре-синтез ${staleCount} устаревших сцен` : `Re-synthesize ${staleCount} stale scenes`}
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
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {chapter.bookTitle}
        </p>
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
                <span className="truncate">{chapter.chapterTitle}</span>
                {(() => {
                  // Compute total chapter duration: actual from playlists, or estimate
                  let totalSec = 0;
                  for (const scene of chapter.scenes) {
                    const actualMs = scene.id ? playlistDurations.get(scene.id) : undefined;
                    if (actualMs && actualMs > 0) {
                      totalSec += actualMs / 1000;
                    } else {
                      totalSec += estimateSceneDuration(scene).sec;
                    }
                  }
                  return totalSec > 0 ? (
                    <span className="flex items-center gap-1 ml-auto text-[11px] text-muted-foreground font-mono shrink-0">
                      <Clock className="h-3 w-3" />
                      {formatDuration(Math.round(totalSec))}
                    </span>
                  ) : null;
                })()}
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
                  const isActual = !!actualSec;
                  return (
                    <button
                      key={idx}
                      onClick={() => onSelectScene(idx)}
                      className={cn(
                        "w-full flex items-center gap-2 pl-9 pr-3 py-2 text-sm font-body rounded-md transition-colors text-left",
                        "hover:bg-accent/50",
                        selectedSceneIdx === idx && "bg-primary/10 text-primary border-r-2 border-primary"
                      )}
                    >
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] border shrink-0", colorClass)}>
                        {isRu ? (SCENE_TYPE_RU[scene.scene_type] || scene.scene_type) : scene.scene_type}
                      </span>
                      <span className="truncate flex-1">{scene.title}</span>
                      {staleAudioSceneIds?.has(scene.id || "") && (
                        <span title={isRu ? "Голос изменился — аудио устарело" : "Voice changed — audio outdated"}>
                          <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                        </span>
                      )}
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
                        className={cn(
                          "text-[11px] font-mono shrink-0",
                          isActual ? "text-foreground" : "text-muted-foreground"
                        )}
                        title={isActual
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
