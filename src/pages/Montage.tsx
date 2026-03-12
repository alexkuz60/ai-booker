import { useEffect } from "react";
import { motion } from "framer-motion";
import { Loader2, AlertCircle } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useMontageData } from "@/hooks/useMontageData";
import { MasterMeterPanel } from "@/components/studio/MasterMeterPanel";
import { MasterEffectsTabs } from "@/components/studio/MasterEffectsTabs";
import { MontageTimeline } from "@/components/montage/MontageTimeline";

const SIDEBAR_WIDTH = 280;

function formatTime(s: number) {
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

const Montage = () => {
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();

  const {
    bookTitle, chapterId, chapterTitle,
    scenes, sceneIds, loading,
    renderedSceneIds, unrenderedSceneIds,
    clips, sceneBoundaries, totalDurationSec,
  } = useMontageData();

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
          <div className="flex items-center gap-2 ml-auto">
            {unrenderedSceneIds.length > 0 && (
              <span className="text-xs text-destructive flex items-center gap-1 font-body">
                <AlertCircle className="h-3 w-3" />
                {unrenderedSceneIds.length} {isRu ? "не отрендерено" : "not rendered"}
              </span>
            )}
            <span className="text-xs text-muted-foreground font-body">
              {renderedSceneIds.length}/{scenes.length} {isRu ? "сцен" : "scenes"} · {formatTime(totalDurationSec)}
            </span>
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
                <MasterMeterPanel isRu={isRu} width={SIDEBAR_WIDTH} />
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
