import { useState } from "react";
import { motion } from "framer-motion";
import {
  FileText, Layers, PlayCircle, Zap, AlertCircle, Loader2, ChevronDown
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { t, tSceneType, tMood, tSceneTitle } from "@/pages/parser/i18n";
import type { TocChapter, Scene, ChapterStatus } from "@/pages/parser/types";
import { SCENE_TYPE_COLORS } from "@/pages/parser/types";

interface ChapterDetailPanelProps {
  isRu: boolean;
  selectedIdx: number | null;
  selectedEntry: TocChapter | null;
  selectedResult: { scenes: Scene[]; status: ChapterStatus } | null | undefined;
  analysisLog: string[];
  onAnalyze: (idx: number) => void;
}

function SceneCards({ scenes, isRu }: { scenes: Scene[]; isRu: boolean }) {
  const [expandedId, setExpandedId] = useState<number | null>(null);

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-semibold text-muted-foreground px-1">
        {scenes.length} {t("scenes", isRu)}
      </h3>
      {scenes.map((sc) => {
        const colorCls = SCENE_TYPE_COLORS[sc.scene_type] || SCENE_TYPE_COLORS.mixed;
        const isExpanded = expandedId === sc.scene_number;
        const content = sc.content || sc.content_preview || "";
        const preview = content.slice(0, 100);
        const hasMore = content.length > 100;

        return (
          <Card
            key={sc.scene_number}
            className={hasMore ? "cursor-pointer" : ""}
            onClick={() => hasMore && setExpandedId(isExpanded ? null : sc.scene_number)}
          >
            <CardContent className="py-3 px-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-base font-medium">
                  {t("scenePrefix", isRu)} {sc.scene_number}: {tSceneTitle(sc.title, isRu)}
                </span>
                <div className="flex items-center gap-1.5">
                  <Badge variant="outline" className={`text-xs ${colorCls}`}>
                    {tSceneType(sc.scene_type, isRu)}
                  </Badge>
                  <Badge variant="outline" className="text-xs">{tMood(sc.mood, isRu)}</Badge>
                  <Badge variant="outline" className="text-xs font-mono">
                    {sc.bpm} BPM
                  </Badge>
                  {hasMore && (
                    <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                  )}
                </div>
              </div>
              {content && (
                <p className="text-sm text-muted-foreground whitespace-pre-line">
                  {isExpanded ? content : (
                    <>
                      {preview}{hasMore && "…"}
                    </>
                  )}
                </p>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function ChapterDetailPanel({
  isRu, selectedIdx, selectedEntry, selectedResult, analysisLog, onAnalyze,
}: ChapterDetailPanelProps) {
  if (selectedIdx === null || !selectedEntry) {
    return (
      <div className="flex-1 flex items-center justify-center text-muted-foreground">
        <div className="text-center space-y-3">
          <Layers className="h-12 w-12 mx-auto opacity-30" />
          <p className="text-sm">{t("selectChapter", isRu)}</p>
        </div>
      </div>
    );
  }

  return (
    <ScrollArea className="flex-1">
      <div className="p-6 space-y-4">
        {/* Chapter header */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="h-10 w-10 rounded-xl gradient-cyan flex items-center justify-center shadow-cool">
                  <FileText className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <CardTitle className="text-lg">{selectedEntry.title}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("pageRange", isRu)} {selectedEntry.startPage}–{selectedEntry.endPage}
                    {selectedEntry.partTitle && ` • ${selectedEntry.partTitle}`}
                  </p>
                </div>
              </div>

              {selectedResult?.status === "pending" && (
                <Button variant="outline" size="sm" onClick={() => onAnalyze(selectedIdx)} className="gap-2">
                  <PlayCircle className="h-4 w-4" />
                  {t("analyze", isRu)}
                </Button>
              )}
              {selectedResult?.status === "done" && (
                <Button variant="ghost" size="sm" onClick={() => onAnalyze(selectedIdx)} className="gap-2 text-muted-foreground">
                  <Zap className="h-4 w-4" />
                  {t("reanalyze", isRu)}
                </Button>
              )}
              {selectedResult?.status === "error" && (
                <Button variant="outline" size="sm" onClick={() => onAnalyze(selectedIdx)} className="gap-2 border-destructive/30 text-destructive">
                  {(selectedResult?.scenes?.length || 0) > 0 ? (
                    <><PlayCircle className="h-4 w-4" />{t("resume", isRu)}</>
                  ) : (
                    <><AlertCircle className="h-4 w-4" />{t("retry", isRu)}</>
                  )}
                </Button>
              )}
            </div>
          </CardHeader>
        </Card>

        {/* Analyzing log */}
        {selectedResult?.status === "analyzing" && (
          <Card>
            <CardContent className="py-4 space-y-2">
              <div className="flex items-center gap-3 mb-3">
                <div className="h-10 w-10 rounded-xl gradient-cyan flex items-center justify-center shadow-cool animate-pulse shrink-0">
                  <Zap className="h-5 w-5 text-primary-foreground" />
                </div>
                <div>
                  <p className="font-display font-semibold text-sm">The Architect</p>
                  <p className="text-xs text-muted-foreground">{t("decomposing", isRu)}</p>
                </div>
                <Loader2 className="h-4 w-4 animate-spin text-primary ml-auto shrink-0" />
              </div>
              <ScrollArea className="max-h-[300px]">
                <div className="space-y-1 font-mono text-xs">
                  {analysisLog.map((line, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ duration: 0.2 }}
                      className={line.startsWith("  ") ? "pl-4 text-muted-foreground" : "text-foreground"}
                    >
                      {line}
                    </motion.div>
                  ))}
                </div>
              </ScrollArea>
            </CardContent>
          </Card>
        )}

        {/* Pending */}
        {selectedResult?.status === "pending" && (
          <Card className="border-dashed">
            <CardContent className="py-8 flex flex-col items-center gap-3 text-muted-foreground">
              <PlayCircle className="h-10 w-10 opacity-30" />
              <p className="text-sm">{t("pendingHint", isRu)}</p>
            </CardContent>
          </Card>
        )}

        {/* Error */}
        {selectedResult?.status === "error" && (
          <Card className="border-destructive/30">
            <CardContent className="py-4 space-y-2">
              <div className="flex items-center gap-2 mb-2">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                <p className="text-sm text-muted-foreground">{t("errorAnalysis", isRu)}</p>
              </div>
              {analysisLog.length > 0 && (
                <ScrollArea className="max-h-[200px]">
                  <div className="space-y-1 font-mono text-xs text-muted-foreground">
                    {analysisLog.map((line, i) => (
                      <div key={i} className={line.startsWith("❌") ? "text-destructive" : ""}>{line}</div>
                    ))}
                  </div>
                </ScrollArea>
              )}
            </CardContent>
          </Card>
        )}

        {/* Scene cards */}
        {selectedResult?.status === "done" && selectedResult.scenes.length > 0 && (
          <SceneCards scenes={selectedResult.scenes} isRu={isRu} />
        )}

        {/* Done but empty */}
        {selectedResult?.status === "done" && selectedResult.scenes.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-6 flex flex-col items-center gap-2 text-muted-foreground">
              <p className="text-sm italic">{t("noScenes", isRu)}</p>
            </CardContent>
          </Card>
        )}
      </div>
    </ScrollArea>
  );
}
