import { useState, useMemo, useCallback, Fragment } from "react";
import { motion } from "framer-motion";
import {
  FileText, Layers, PlayCircle, Zap, AlertCircle, Loader2, ChevronDown, Clock, RefreshCw, Palette, StopCircle,
  Trash2, Hash, Scissors, SpellCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuTrigger, ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import { RoleBadge, RoleBadges } from "@/components/ui/RoleBadge";
import { t, tSceneType, tMood, tSceneTitle } from "@/pages/parser/i18n";
import { useContentCleanup, type CleanupAction } from "@/hooks/useContentCleanup";
import { toast } from "sonner";
import type { TocChapter, Scene, ChapterStatus } from "@/pages/parser/types";
import { SCENE_TYPE_COLORS } from "@/pages/parser/types";
import { estimateDurationSec, formatDuration } from "@/lib/durationEstimate";

/**
 * Render scene text with styled inline markers:
 * - [стр. N]  → muted gray badge
 * - [сн. N]…[/сн.] → amber footnote badge + dimmed content
 */
function renderMarkedText(text: string) {
  const regex = /(\[стр\.\s*\d+\]|\[сн\.\s*\d+\]|\[\/сн\.\])/g;
  const parts = text.split(regex);
  if (parts.length === 1) return text;

  let insideFootnote = false;

  return parts.map((part, i) => {
    if (/^\[стр\.\s*\d+\]$/.test(part)) {
      return (
        <span key={i} className="inline-flex items-center mx-1 px-1.5 py-0 rounded text-[10px] font-mono bg-muted text-muted-foreground/60 align-baseline">
          {part}
        </span>
      );
    }
    if (/^\[сн\.\s*\d+\]$/.test(part)) {
      insideFootnote = true;
      return (
        <span key={i} className="inline-flex items-center mx-1 px-1.5 py-0 rounded text-[10px] font-mono bg-amber-500/15 text-amber-400/80 align-baseline">
          {part}
        </span>
      );
    }
    if (part === '[/сн.]') {
      insideFootnote = false;
      return (
        <span key={i} className="inline-flex items-center mx-0.5 px-1 py-0 rounded text-[10px] font-mono bg-amber-500/15 text-amber-400/60 align-baseline">
          ⌟
        </span>
      );
    }
    if (insideFootnote) {
      return <span key={i} className="text-amber-300/50 italic text-xs">{part}</span>;
    }
    return <Fragment key={i}>{part}</Fragment>;
  });
}

export interface ChapterDetailPanelProps {
  isRu: boolean;
  selectedIdx: number | null;
  selectedEntry: TocChapter | null;
  selectedResult: { scenes: Scene[]; status: ChapterStatus } | null | undefined;
  analysisLog: string[];
  onAnalyze: (idx: number, mode?: "full" | "enrich") => void;
  onStopAnalysis?: () => void;
  isAnalyzing?: boolean;
  childCount?: number;
  /** Current model names for role badges */
  roleModels?: { screenwriter?: string; director?: string };
  /** Callback when scenes are modified by cleanup actions */
  onScenesUpdate?: (scenes: Scene[]) => void;
}

function SceneCards({
  scenes, isRu, roleModels, onScenesUpdate,
}: {
  scenes: Scene[];
  isRu: boolean;
  roleModels?: { screenwriter?: string; director?: string };
  onScenesUpdate?: (scenes: Scene[]) => void;
}) {
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { applyCleanup } = useContentCleanup();

  const totalDuration = useMemo(() => {
    const totalChars = scenes.reduce((sum, sc) => sum + (sc.content?.length ?? sc.content_preview?.length ?? 0), 0);
    return { sec: estimateDurationSec(totalChars), formatted: formatDuration(estimateDurationSec(totalChars)) };
  }, [scenes]);

  const getSelectedText = useCallback(() => {
    const sel = window.getSelection();
    return sel?.toString().trim() || "";
  }, []);

  const handleCleanup = useCallback((action: CleanupAction, sceneIndex: number) => {
    const selectedText = getSelectedText();
    if (action !== "fix_punctuation_spaces" && !selectedText) {
      toast.info(t("cleanupNoSelection", isRu));
      return;
    }
    const result = applyCleanup(action, scenes, selectedText, sceneIndex);
    if (result.changeCount > 0 && onScenesUpdate) {
      onScenesUpdate(result.scenes);
    }
    toast(result.summary, { duration: 3000 });
  }, [scenes, isRu, applyCleanup, getSelectedText, onScenesUpdate]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <h3 className="text-sm font-semibold text-muted-foreground">
          {scenes.length} {t("scenes", isRu)}
        </h3>
        <div className="flex items-center gap-3">
          <Button
            variant="ghost" size="sm"
            className="h-6 px-2 text-xs text-muted-foreground"
            onClick={() => handleCleanup("fix_punctuation_spaces", 0)}
          >
            <SpellCheck className="h-3 w-3 mr-1" />
            {t("cleanupFixSpaces", isRu)}
          </Button>
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Clock className="h-3 w-3" />
            ≈ {totalDuration.formatted}
          </span>
        </div>
      </div>
      {scenes.map((sc, i) => {
        const colorCls = SCENE_TYPE_COLORS[sc.scene_type] || SCENE_TYPE_COLORS.mixed;
        const isExpanded = expandedId === i;
        const content = sc.content || sc.content_preview || "";
        const preview = content.slice(0, 100);
        const hasMore = content.length > 100;
        const sceneDur = formatDuration(estimateDurationSec(content.length));

        return (
          <ContextMenu key={`${sc.scene_number}-${i}`}>
            <ContextMenuTrigger asChild>
              <Card
                className={hasMore ? "cursor-pointer" : ""}
                onClick={() => hasMore && setExpandedId(isExpanded ? null : i)}
              >
                <CardContent className="py-3 px-4 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-base font-medium flex items-center gap-1.5">
                      <RoleBadge roleId="screenwriter" model={roleModels?.screenwriter} isRu={isRu} size={13} />
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
                      <RoleBadge roleId="director" model={roleModels?.director} isRu={isRu} size={12} />
                      <span className="text-[10px] text-muted-foreground font-mono ml-1">
                        {sceneDur}
                      </span>
                      {hasMore && (
                        <ChevronDown className={`h-3.5 w-3.5 text-muted-foreground transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                      )}
                    </div>
                  </div>
                  {content && (
                    <p className="text-sm text-muted-foreground whitespace-pre-line select-text">
                      {isExpanded ? renderMarkedText(content) : (
                        <>
                          {renderMarkedText(preview)}{hasMore && "…"}
                        </>
                      )}
                    </p>
                  )}
                </CardContent>
              </Card>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-64">
              <ContextMenuLabel>{t("cleanupLabel", isRu)}</ContextMenuLabel>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => handleCleanup("header", i)} className="gap-2">
                <Trash2 className="h-4 w-4 text-muted-foreground" />
                {t("cleanupHeader", isRu)}
              </ContextMenuItem>
              <ContextMenuItem onClick={() => handleCleanup("page_number", i)} className="gap-2">
                <Hash className="h-4 w-4 text-muted-foreground" />
                {t("cleanupPageNum", isRu)}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => handleCleanup("chapter_split", i)} className="gap-2">
                <Scissors className="h-4 w-4 text-muted-foreground" />
                {t("cleanupChapterSplit", isRu)}
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        );
      })}
    </div>
  );
}

export default function ChapterDetailPanel({
  isRu, selectedIdx, selectedEntry, selectedResult, analysisLog, onAnalyze, onStopAnalysis, isAnalyzing, childCount = 0, roleModels,
}: ChapterDetailPanelProps) {
  const [reanalyzeOpen, setReanalyzeOpen] = useState(false);

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
                  {childCount > 0 ? <Layers className="h-5 w-5 text-primary-foreground" /> : <FileText className="h-5 w-5 text-primary-foreground" />}
                </div>
                <div>
                  <CardTitle className="text-lg">{selectedEntry.title}</CardTitle>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {t("pageRange", isRu)} {selectedEntry.startPage}–{selectedEntry.endPage}
                    {childCount > 0 && ` • ${childCount} ${isRu ? "разд." : "sections"}`}
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
                <Button variant="ghost" size="sm" onClick={() => setReanalyzeOpen(true)} className="gap-2 text-muted-foreground">
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
                  <p className="font-display font-semibold text-sm flex items-center gap-1.5">
                    The Architect
                    <RoleBadges
                      roles={[
                        { roleId: "screenwriter", model: roleModels?.screenwriter },
                        { roleId: "director", model: roleModels?.director },
                      ]}
                      isRu={isRu}
                      size={12}
                    />
                  </p>
                  <p className="text-xs text-muted-foreground">{t("decomposing", isRu)}</p>
                </div>
                <div className="flex items-center gap-2 ml-auto shrink-0">
                  {onStopAnalysis && (
                    <Button
                      variant="ghost" size="sm"
                      onClick={onStopAnalysis}
                      className="gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                    >
                      <StopCircle className="h-4 w-4" />
                      {isRu ? "Стоп" : "Stop"}
                    </Button>
                  )}
                  <Loader2 className="h-4 w-4 animate-spin text-primary shrink-0" />
                </div>
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
          <SceneCards scenes={selectedResult.scenes} isRu={isRu} roleModels={roleModels} />
        )}

        {/* Done but empty */}
        {selectedResult?.status === "done" && selectedResult.scenes.length === 0 && (
          <Card className="border-dashed">
            <CardContent className="py-6 flex flex-col items-center gap-2 text-muted-foreground">
              <p className="text-sm italic">{t("noScenes", isRu)}</p>
            </CardContent>
          </Card>
        )}
        {/* Re-analysis mode dialog */}
        <Dialog open={reanalyzeOpen} onOpenChange={setReanalyzeOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>{t("reanalyzeDialogTitle", isRu)}</DialogTitle>
              <DialogDescription>{t("reanalyzeDialogDesc", isRu)}</DialogDescription>
            </DialogHeader>
            <div className="space-y-3 pt-2">
              <button
                className="w-full text-left rounded-lg border border-border p-4 hover:bg-accent/50 transition-colors space-y-1"
                onClick={() => { setReanalyzeOpen(false); onAnalyze(selectedIdx!, "full"); }}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <RefreshCw className="h-4 w-4 text-primary" />
                  {t("reanalyzeFull", isRu)}
                </div>
                <p className="text-xs text-muted-foreground">{t("reanalyzeFullDesc", isRu)}</p>
              </button>
              <button
                className="w-full text-left rounded-lg border border-border p-4 hover:bg-accent/50 transition-colors space-y-1"
                onClick={() => { setReanalyzeOpen(false); onAnalyze(selectedIdx!, "enrich"); }}
              >
                <div className="flex items-center gap-2 font-medium text-sm">
                  <Palette className="h-4 w-4 text-primary" />
                  {t("reanalyzeEnrich", isRu)}
                </div>
                <p className="text-xs text-muted-foreground">{t("reanalyzeEnrichDesc", isRu)}</p>
              </button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </ScrollArea>
  );
}
