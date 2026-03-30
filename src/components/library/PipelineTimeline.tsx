/**
 * PipelineTimeline — horizontal stepper for book pipeline progress.
 *
 * Requirements:
 * 1. Click any icon → opens book & navigates to that stage's page.
 * 2. Context menus always active (even locked icons). Checkboxes update progress JSON.
 * 3. Partial progress = bright icon; full = filled primary circle (keeps native icon).
 * 4. First step "Project" click = full reload with confirmation dialog (resets all).
 */

import { useCallback, useState } from "react";
import {
  FolderOpen, BookOpen, Music, Film,
  Check, X, RefreshCw,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuCheckboxItem, ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PipelineProgress, PipelineStepId } from "@/lib/projectStorage";

// ── Stage / sub-step definitions ────────────────────────

interface SubStepDef {
  id: PipelineStepId;
  labelRu: string;
  labelEn: string;
}

interface StageDef {
  id: "project" | "parser" | "studio" | "montage";
  labelRu: string;
  labelEn: string;
  route: string;
  icon: typeof FolderOpen;
  subSteps: SubStepDef[];
}

const STAGES: StageDef[] = [
  {
    id: "project", labelRu: "Проект", labelEn: "Project", route: "/", icon: FolderOpen,
    subSteps: [
      { id: "file_uploaded", labelRu: "Файл загружен", labelEn: "File uploaded" },
      { id: "opfs_created", labelRu: "Хранилище создано", labelEn: "Storage created" },
    ],
  },
  {
    id: "parser", labelRu: "Парсер", labelEn: "Parser", route: "/parser", icon: BookOpen,
    subSteps: [
      { id: "toc_extracted", labelRu: "Структура (TOC)", labelEn: "Structure (TOC)" },
      { id: "scenes_analyzed", labelRu: "Сцены проанализированы", labelEn: "Scenes analyzed" },
      { id: "characters_extracted", labelRu: "Персонажи извлечены", labelEn: "Characters extracted" },
      { id: "profiles_done", labelRu: "Профайлы готовы", labelEn: "Profiles ready" },
    ],
  },
  {
    id: "studio", labelRu: "Студия", labelEn: "Studio", route: "/studio", icon: Music,
    subSteps: [
      { id: "storyboard_done", labelRu: "Раскадровка", labelEn: "Storyboard" },
      { id: "inline_edit", labelRu: "Инлайн-правка", labelEn: "Inline editing" },
      { id: "synthesis_done", labelRu: "Синтез речи", labelEn: "Speech synthesis" },
      { id: "mix_done", labelRu: "Микс и эффекты", labelEn: "Mix & effects" },
      { id: "scene_render", labelRu: "Рендер сцен", labelEn: "Scene render" },
    ],
  },
  {
    id: "montage", labelRu: "Монтаж", labelEn: "Montage", route: "/montage", icon: Film,
    subSteps: [
      { id: "chapter_assembly", labelRu: "Сборка главы", labelEn: "Chapter assembly" },
      { id: "mastering", labelRu: "Мастеринг", labelEn: "Mastering" },
      { id: "final_render", labelRu: "Финальный рендер", labelEn: "Final render" },
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────

function isStageComplete(stage: StageDef, progress: PipelineProgress): boolean {
  return stage.subSteps.length > 0 && stage.subSteps.every(s => !!progress[s.id]);
}

function stageFraction(stage: StageDef, progress: PipelineProgress): number {
  if (stage.subSteps.length === 0) return 0;
  return stage.subSteps.filter(s => !!progress[s.id]).length / stage.subSteps.length;
}

// ── StageNode sub-component ─────────────────────────────

interface StageNodeProps {
  stage: StageDef;
  idx: number;
  progress: PipelineProgress;
  isRu: boolean;
  onStageClick: (stage: StageDef, idx: number) => void;
  onToggleStep?: (stepId: PipelineStepId, done: boolean) => void;
}

function StageNode({ stage, idx, progress, isRu, onStageClick, onToggleStep }: StageNodeProps) {
  const Icon = stage.icon;
  const complete = isStageComplete(stage, progress);
  const frac = stageFraction(stage, progress);
  const doneCount = stage.subSteps.filter(s => !!progress[s.id]).length;
  const totalCount = stage.subSteps.length;
  const hasPartial = doneCount > 0 && !complete;
  const isEmpty = doneCount === 0;

  return (
    <ContextMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <ContextMenuTrigger asChild>
            <button
              onClick={() => onStageClick(stage, idx)}
              className={cn(
                "flex flex-col items-center gap-1.5 group/node focus-visible:outline-none cursor-pointer",
              )}
            >
              <div className={cn(
                "relative flex items-center justify-center h-10 w-10 rounded-full border-2 transition-all",
                isEmpty && "border-muted-foreground/30 bg-background group-hover/node:border-primary/50",
                hasPartial && "border-primary/50 bg-primary/10",
                complete && "border-primary bg-primary text-primary-foreground",
              )}>
                {complete ? (
                  <Icon className="h-5 w-5 text-primary-foreground" />
                ) : (
                  <Icon className={cn(
                    "h-4.5 w-4.5",
                    hasPartial ? "text-primary" : "text-muted-foreground group-hover/node:text-foreground",
                  )} />
                )}
                {hasPartial && (
                  <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 40 40">
                    <circle
                      cx="20" cy="20" r="18"
                      fill="none"
                      stroke="hsl(var(--primary))"
                      strokeWidth="2"
                      strokeDasharray={`${frac * 113} 113`}
                      strokeLinecap="round"
                      className="opacity-60"
                    />
                  </svg>
                )}
              </div>
              <span className={cn(
                "text-[11px] font-medium leading-tight text-center max-w-[72px]",
                complete ? "text-primary" : hasPartial ? "text-foreground/80" : "text-muted-foreground/60",
              )}>
                {isRu ? stage.labelRu : stage.labelEn}
              </span>
              <span className={cn(
                "text-[10px] tabular-nums",
                complete ? "text-primary/70" : "text-muted-foreground/60",
              )}>
                {doneCount}/{totalCount}
              </span>
            </button>
          </ContextMenuTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-xs max-w-[200px]">
          <p className="font-medium mb-1">
            {isRu ? stage.labelRu : stage.labelEn}
          </p>
          <ul className="space-y-0.5">
            {stage.subSteps.map(sub => (
              <li key={sub.id} className="flex items-center gap-1.5">
               {progress[sub.id]
                  ? <Check className="h-3 w-3 text-primary flex-shrink-0" />
                  : <X className="h-3 w-3 text-muted-foreground/50 flex-shrink-0" />
                }
                <span className={progress[sub.id] ? "text-foreground" : "text-muted-foreground"}>
                  {isRu ? sub.labelRu : sub.labelEn}
                </span>
              </li>
            ))}
          </ul>
        </TooltipContent>
      </Tooltip>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="text-xs font-semibold">
          {isRu ? stage.labelRu : stage.labelEn}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        {stage.subSteps.map(sub => (
          <ContextMenuCheckboxItem
            key={sub.id}
            checked={!!progress[sub.id]}
            onCheckedChange={(checked) => {
              onToggleStep?.(sub.id, !!checked);
            }}
            onSelect={(e) => e.preventDefault()}
            className="text-xs"
          >
            {isRu ? sub.labelRu : sub.labelEn}
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Connector line between stages ───────────────────────

function Connector({ prevComplete, prevPartial }: { prevComplete: boolean; prevPartial: boolean }) {
  return (
    <div className="flex-1 flex items-start pt-5">
      <div className={cn(
        "w-full rounded-full transition-colors",
        prevComplete
          ? "h-[3px] bg-primary"
          : prevPartial
            ? "h-[3px] border-t-[3px] border-dashed border-primary/60 bg-transparent"
            : "h-0.5 bg-muted-foreground/15",
      )} />
    </div>
  );
}

// ── Main component ──────────────────────────────────────

interface Props {
  progress: PipelineProgress;
  isRu: boolean;
  onToggleStep?: (stepId: PipelineStepId, done: boolean) => void;
  /** Called when user clicks a stage icon. Receives the route to navigate to. */
  onStageClick?: (route: string) => void;
  /** Called when user confirms project reset (first stage click). */
  onProjectReset?: () => void;
}

export function PipelineTimeline({ progress, isRu, onToggleStep, onStageClick, onProjectReset }: Props) {
  const [showResetDialog, setShowResetDialog] = useState(false);

  const handleStageClick = useCallback((stage: StageDef, _idx: number) => {
    if (stage.id === "project") {
      // First stage = project reset with confirmation
      setShowResetDialog(true);
      return;
    }
    onStageClick?.(stage.route);
  }, [onStageClick]);

  const handleConfirmReset = useCallback(() => {
    setShowResetDialog(false);
    onProjectReset?.();
  }, [onProjectReset]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-start gap-0 w-full">
        {STAGES.map((stage, idx) => (
          <div key={stage.id} className="contents">
            {idx > 0 && (
              <Connector nextComplete={isStageComplete(stage, progress)} nextPartial={stageFraction(stage, progress) > 0} />
            )}
            <StageNode
              stage={stage}
              idx={idx}
              progress={progress}
              isRu={isRu}
              onStageClick={handleStageClick}
              onToggleStep={onToggleStep}
            />
          </div>
        ))}
      </div>

      {/* Project reset confirmation dialog */}
      <AlertDialog open={showResetDialog} onOpenChange={setShowResetDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <RefreshCw className="h-5 w-5 text-destructive" />
              {isRu ? "Перезагрузить проект?" : "Reload project?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isRu
                ? "Текущий прогресс будет полностью сброшен. Все данные парсера, студии и монтажа будут удалены. Это действие необратимо."
                : "All progress will be completely reset. Parser, studio, and montage data will be deleted. This action cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleConfirmReset}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {isRu ? "Сбросить и перезагрузить" : "Reset & reload"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </TooltipProvider>
  );
}
