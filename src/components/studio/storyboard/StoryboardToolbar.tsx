/**
 * StoryboardToolbar — header action bar for the storyboard panel.
 * Extracted from StoryboardPanel.tsx for modularity.
 */

import { memo } from "react";
import {
  Loader2, Sparkles, AudioLines, ScanSearch, MessageCircle,
  RefreshCw, Timer, Merge, Trash2, Eraser, SpellCheck, CheckCircle2,
} from "lucide-react";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";

interface StoryboardToolbarProps {
  isRu: boolean;
  segmentCount: number;
  totalPhrases: number;
  inlineNarrationCount: number;
  analysisPending: boolean;
  bgAnalyzing: boolean;
  sceneContent: string | null;
  synthesizing: boolean;
  synthProgress: string;
  canMerge: boolean;
  merging: boolean;
  deleting: boolean;
  mergeCheckedSize: number;
  dialogueCount: number;
  detecting: boolean;
  correctingStress: boolean;
  staleAudioSegIdsSize: number;
  cleaningMetadata: boolean;
  recalcRunning: boolean;
  sceneId: string | null;
  audioStatusSize: number;
  silenceSec: number;
  segmentIds: string[];
  getModelForRole: (role: string) => string;
  onRunAnalysis: () => void;
  onMergeSegments: () => void;
  onDeleteSegments: () => void;
  onDetectNarrations: () => void;
  onStressCorrection: (mode: "correct" | "suggest") => void;
  onCleanStaleAudio: () => void;
  onRecalcDurations: () => void;
  onSilenceSecChange?: (sec: number) => void;
  onRunSynthesis: () => void;
  onSelectAll: () => void;
  onDeselectAll: () => void;
  allSelected: boolean;
}

export const StoryboardToolbar = memo(function StoryboardToolbar(props: StoryboardToolbarProps) {
  const {
    isRu, segmentCount, totalPhrases, inlineNarrationCount,
    analysisPending, bgAnalyzing, sceneContent, synthesizing, synthProgress,
    canMerge, merging, deleting, mergeCheckedSize,
    dialogueCount, detecting, correctingStress,
    staleAudioSegIdsSize, cleaningMetadata,
    recalcRunning, sceneId, audioStatusSize, silenceSec,
    getModelForRole,
    onRunAnalysis, onMergeSegments, onDeleteSegments,
    onDetectNarrations, onStressCorrection, onCleanStaleAudio,
    onRecalcDurations, onSilenceSecChange, onRunSynthesis,
    onSelectAll, onDeselectAll, allSelected,
  } = props;

  return (
    <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-muted-foreground font-body">
          {segmentCount} {isRu ? "фрагм." : "seg."} · {totalPhrases} {isRu ? "фраз" : "phrases"}
          {inlineNarrationCount > 0 && (
            <span className="ml-1.5 text-accent-foreground">
              · <MessageCircle className="inline h-3 w-3 -mt-0.5" /> {inlineNarrationCount}
            </span>
          )}
        </span>
        {analysisPending && segmentCount > 0 && (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground font-body">
            <Loader2 className="h-3 w-3 animate-spin" />
            {isRu ? "Переанализ в фоне…" : "Re-analysis in background…"}
          </span>
        )}
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
              <AlertDialogAction onClick={onRunAnalysis}>
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
          onClick={onMergeSegments}
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
              disabled={mergeCheckedSize === 0 || deleting || synthesizing}
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
                  ? `Будет удалено ${mergeCheckedSize} блок(ов) вместе с фразами и аудио. Это действие нельзя отменить.`
                  : `${mergeCheckedSize} segment(s) will be deleted along with phrases and audio. This cannot be undone.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
              <AlertDialogAction onClick={onDeleteSegments} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                {isRu ? "Удалить" : "Delete"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
        {dialogueCount > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onDetectNarrations}
            disabled={detecting || bgAnalyzing || synthesizing}
            className="gap-1.5 h-7 text-xs"
            title={isRu ? "Поиск авторских вставок в диалогах" : "Detect narrator insertions in dialogues"}
          >
            {detecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
            {detecting ? (isRu ? "Поиск…" : "Detecting…") : (isRu ? "Вставки" : "Narrations")}
          </Button>
        )}
        {segmentCount > 0 && (
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
                  onClick={() => onStressCorrection("suggest")}
                  disabled={correctingStress}
                >
                  <Sparkles className="h-3 w-3" />
                  {isRu ? "Найти неоднозначные" : "Find ambiguous"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="justify-start gap-2 h-8 text-xs"
                  onClick={() => onStressCorrection("correct")}
                  disabled={correctingStress}
                >
                  <CheckCircle2 className="h-3 w-3" />
                  {isRu ? "Применить словарь" : "Apply dictionary"}
                </Button>
              </div>
            </PopoverContent>
          </Popover>
        )}
        {staleAudioSegIdsSize > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onCleanStaleAudio}
            disabled={cleaningMetadata || synthesizing}
            className="gap-1.5 h-7 text-xs text-destructive hover:text-destructive"
            title={isRu
              ? `Очистить ${staleAudioSegIdsSize} устаревших аудио-вставок (без ре-синтеза)`
              : `Clear ${staleAudioSegIdsSize} stale audio metadata (no re-synthesis)`}
          >
            {cleaningMetadata ? <Loader2 className="h-3 w-3 animate-spin" /> : <Eraser className="h-3 w-3" />}
            {staleAudioSegIdsSize}
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
                silenceSec === sec
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
          onClick={onRunSynthesis}
          disabled={synthesizing || bgAnalyzing || segmentCount === 0}
          className="gap-1.5 h-7 text-xs"
        >
          {synthesizing ? <AudioLines className="h-3 w-3 animate-pulse-glow text-primary" /> : <AudioLines className="h-3 w-3" />}
          {synthesizing
            ? (synthProgress || (isRu ? "Синтез…" : "Synth…"))
            : mergeCheckedSize > 0
              ? (isRu ? `Синтез (${mergeCheckedSize})` : `Synth (${mergeCheckedSize})`)
              : (isRu ? "Синтез сцены" : "Synthesize")}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={recalcRunning || !sceneId || audioStatusSize === 0}
          onClick={onRecalcDurations}
          title={isRu ? "Пересчитать длительности из MP3" : "Recalculate durations from MP3"}
        >
          {recalcRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Timer className="h-3 w-3" />}
          {isRu ? "Пересчёт" : "Recalc"}
        </Button>
        {segmentCount > 0 && (
          <label className="flex items-center gap-1.5 cursor-pointer text-xs text-muted-foreground select-none border-l border-border pl-2 ml-0.5">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => {
                if (checked) onSelectAll();
                else onDeselectAll();
              }}
            />
            {isRu ? "Все" : "All"}
          </label>
        )}
      </div>
    </div>
  );
});
