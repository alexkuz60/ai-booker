import { useEffect, useMemo, useState, useCallback } from "react";
import { motion } from "framer-motion";
import { Loader2, AlertCircle } from "lucide-react";
import { toast } from "sonner";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useAuth } from "@/hooks/useAuth";
import { useMontageData } from "@/hooks/useMontageData";
import { MasterMeterPanel } from "@/components/studio/MasterMeterPanel";
import { MasterEffectsTabs } from "@/components/studio/MasterEffectsTabs";
import { MontageTimeline } from "@/components/montage/MontageTimeline";
import { Button } from "@/components/ui/button";
import { normalizeChapter, renderChapter } from "@/lib/chapterRenderer";
import type { ChapterRenderProgress } from "@/lib/chapterRenderer";

const SIDEBAR_WIDTH = 280;

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const Montage = () => {
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();
  const { user } = useAuth();

  const {
    bookTitle, chapterId, chapterTitle,
    scenes, sceneIds, loading,
    renderedSceneIds, unrenderedSceneIds,
    clips, sceneBoundaries, totalDurationSec,
    parts, activePartIdx, setActivePartIdx,
    splitAtScene, removeParts, activeSceneIds,
  } = useMontageData();

  // ── Render / Normalize state ───────────────────────────────
  const [processing, setProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [normGainDb, setNormGainDb] = useState(0);

  const onProgress = useCallback((p: ChapterRenderProgress) => {
    setProgressPct(p.percent);
    setProgressMsg(p.message ?? p.phase);
    if (p.phase === "done" || p.phase === "error") {
      setTimeout(() => { setProcessing(false); setProgressMsg(null); setProgressPct(null); }, 3000);
    }
  }, []);

  const handleNormalize = useCallback(async () => {
    if (processing || clips.length === 0) return;
    setProcessing(true);
    try {
      const result = await normalizeChapter(clips, totalDurationSec, onProgress);
      setNormGainDb(result.gainDeltaDb);
      toast.success(
        isRu
          ? `Нормализация: пик ${result.peakDb.toFixed(1)} dB → усиление ${result.gainDeltaDb >= 0 ? "+" : ""}${result.gainDeltaDb.toFixed(1)} dB`
          : `Normalize: peak ${result.peakDb.toFixed(1)} dB → gain ${result.gainDeltaDb >= 0 ? "+" : ""}${result.gainDeltaDb.toFixed(1)} dB`,
      );
    } catch (err: any) {
      toast.error(isRu ? `Ошибка нормализации: ${err.message}` : `Normalize error: ${err.message}`);
      setProcessing(false);
      setProgressMsg(null);
      setProgressPct(null);
    }
  }, [processing, clips, totalDurationSec, onProgress, isRu]);

  const handleRender = useCallback(async () => {
    if (processing || clips.length === 0 || !user || !chapterId) return;
    setProcessing(true);
    try {
      const activePart = parts.length > 0 ? parts[activePartIdx] : null;
      const partNumber = activePart?.part_number ?? null;

      const result = await renderChapter(
        clips, totalDurationSec, user.id, chapterId,
        partNumber, normGainDb, onProgress,
      );
      toast.success(
        isRu
          ? `Рендер завершён: ${(result.durationMs / 1000).toFixed(1)}с, пик ${result.peakDb.toFixed(1)} dB`
          : `Render complete: ${(result.durationMs / 1000).toFixed(1)}s, peak ${result.peakDb.toFixed(1)} dB`,
      );
    } catch (err: any) {
      toast.error(isRu ? `Ошибка рендера: ${err.message}` : `Render error: ${err.message}`);
      setProcessing(false);
      setProgressMsg(null);
      setProgressPct(null);
    }
  }, [processing, clips, totalDurationSec, user, chapterId, parts, activePartIdx, normGainDb, onProgress, isRu]);

  // ── Page header ────────────────────────────────────────────
  const title = isRu ? "МОНТАЖ" : "MONTAGE";
  const subtitle = bookTitle && chapterTitle
    ? `${bookTitle} → ${chapterTitle}`
    : (isRu ? "Финальный монтаж и мастеринг глав" : "Final chapter montage & mastering");

  useEffect(() => {
    setPageHeader({ title, subtitle });
    return () => setPageHeader({});
  }, [title, subtitle]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3rem)]">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const hasContent = !!chapterId && sceneIds.length > 0;
  const hasRenderedClips = clips.length > 0;

  // Count rendered/unrendered for active part only
  const activeRendered = activeSceneIds.filter(id => renderedSceneIds.includes(id));
  const activeUnrendered = activeSceneIds.filter(id => unrenderedSceneIds.includes(id));
  const activeSceneCount = activeSceneIds.length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-[calc(100vh-3rem)] min-h-0 overflow-hidden"
    >
      {/* Info bar */}
      {hasContent && (
        <div className="flex items-center gap-3 px-4 py-1.5 border-b border-border shrink-0">
          <span className="text-xs text-muted-foreground font-body truncate">
            {bookTitle} → {chapterTitle}
          </span>

          {/* Part tabs */}
          {parts.length > 0 && (
            <div className="flex items-center gap-1 ml-2">
              {parts.map((part, idx) => (
                <Button
                  key={part.id}
                  variant={idx === activePartIdx ? "default" : "outline"}
                  size="sm"
                  className="h-5 px-2 text-[10px] font-mono"
                  onClick={() => setActivePartIdx(idx)}
                >
                  {isRu ? `Часть ${part.part_number}` : `Part ${part.part_number}`}
                </Button>
              ))}
              <Button
                variant="ghost"
                size="sm"
                className="h-5 px-1.5 text-[10px] text-muted-foreground hover:text-destructive"
                onClick={removeParts}
                title={isRu ? "Убрать разбивку" : "Remove split"}
              >
                ✕
              </Button>
            </div>
          )}

          <div className="flex items-center gap-2 ml-auto">
            {activeUnrendered.length > 0 && (
              <span className="text-xs text-destructive flex items-center gap-1 font-body">
                <AlertCircle className="h-3 w-3" />
                {activeUnrendered.length} {isRu ? "не отрендерено" : "not rendered"}
              </span>
            )}
            <span className="text-xs text-muted-foreground font-body">
              {activeRendered.length}/{activeSceneCount} {isRu ? "сцен" : "scenes"} · {formatTime(totalDurationSec)}
            </span>
            {normGainDb !== 0 && (
              <span className="text-[10px] text-primary font-mono">
                NORM {normGainDb >= 0 ? "+" : ""}{normGainDb.toFixed(1)} dB
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main content */}
      {hasContent ? (
        <>
          {/* Effects workspace */}
          <div className="flex-1 min-h-0 overflow-hidden p-4">
            <div className="h-full rounded-lg border border-border bg-card/50 overflow-hidden flex">
              <div className="shrink-0 border-r border-border" style={{ width: `${SIDEBAR_WIDTH}px` }}>
                <MasterMeterPanel
                  isRu={isRu}
                  width={SIDEBAR_WIDTH}
                  onNormalize={handleNormalize}
                  onRender={handleRender}
                  normalizeDisabled={processing || !hasRenderedClips}
                  renderDisabled={processing || !hasRenderedClips}
                  progressMessage={progressMsg}
                  progressPercent={progressPct}
                />
              </div>
              <div className="flex-1 min-h-0 p-2">
                <MasterEffectsTabs isRu={isRu} />
              </div>
            </div>
          </div>

          {/* Timeline */}
          <MontageTimeline
            clips={clips}
            sceneBoundaries={sceneBoundaries}
            totalDurationSec={totalDurationSec}
            chapterId={chapterId}
            isRu={isRu}
            onSplitAtScene={splitAtScene}
            hasParts={parts.length > 0}
          />
        </>
      ) : (
        <div className="flex-1 flex items-center justify-center text-muted-foreground">
          <div className="text-center space-y-2">
            <p className="text-lg font-display">
              {isRu ? "Нет выбранной главы" : "No chapter selected"}
            </p>
            <p className="text-sm font-body">
              {isRu
                ? "Откройте главу из Студии кнопкой ✂ или вернитесь к последней сессии"
                : "Open a chapter from Studio via ✂ button or return to your last session"}
            </p>
          </div>
        </div>
      )}
    </motion.div>
  );
};

export default Montage;
