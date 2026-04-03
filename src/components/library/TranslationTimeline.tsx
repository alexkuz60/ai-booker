/**
 * TranslationTimeline — horizontal stepper for art-translation pipeline.
 *
 * Activated only when storyboard_done is true in the main pipeline.
 * Steps: Project → Primary Translation → Art Corrector → Critique → Export to Studio
 * Context menu only on the first step (Project).
 */

import { useCallback } from "react";
import {
  FolderOpen, Languages, PenLine, ShieldCheck, Upload,
  Check, X,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuCheckboxItem, ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import {
  Tooltip, TooltipTrigger, TooltipContent, TooltipProvider,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PipelineProgress, PipelineStepId } from "@/lib/projectStorage";

// ── Stage definitions ───────────────────────────────────

interface SubStepDef {
  id: PipelineStepId;
  labelRu: string;
  labelEn: string;
}

interface StageDef {
  id: string;
  labelRu: string;
  labelEn: string;
  icon: typeof FolderOpen;
  hasContextMenu: boolean;
  subSteps: SubStepDef[];
}

const STAGES: StageDef[] = [
  {
    id: "trans_project",
    labelRu: "Проект",
    labelEn: "Project",
    icon: FolderOpen,
    hasContextMenu: true,
    subSteps: [
      { id: "trans_activated", labelRu: "Перевод активирован", labelEn: "Translation activated" },
    ],
  },
  {
    id: "trans_literal",
    labelRu: "Первичный\nперевод",
    labelEn: "Primary\ntranslation",
    icon: Languages,
    hasContextMenu: false,
    subSteps: [
      { id: "trans_literal_done", labelRu: "Подстрочник готов", labelEn: "Literal done" },
    ],
  },
  {
    id: "trans_literary",
    labelRu: "Арт-\nкорректор",
    labelEn: "Art\ncorrector",
    icon: PenLine,
    hasContextMenu: false,
    subSteps: [
      { id: "trans_literary_done", labelRu: "Художественная правка", labelEn: "Literary edit done" },
    ],
  },
  {
    id: "trans_critique",
    labelRu: "Критика\nи оценка",
    labelEn: "Critique &\nassessment",
    icon: ShieldCheck,
    hasContextMenu: false,
    subSteps: [
      { id: "trans_critique_done", labelRu: "Оценка завершена", labelEn: "Assessment done" },
    ],
  },
  {
    id: "trans_export",
    labelRu: "Экспорт\nв Студию",
    labelEn: "Export to\nStudio",
    icon: Upload,
    hasContextMenu: false,
    subSteps: [
      { id: "trans_export_done", labelRu: "Экспорт завершён", labelEn: "Export complete" },
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

// ── StageNode ───────────────────────────────────────────

interface StageNodeProps {
  stage: StageDef;
  progress: PipelineProgress;
  isRu: boolean;
  disabled: boolean;
  onToggleStep?: (stepId: PipelineStepId, done: boolean) => void;
  onStageClick?: (stageId: string) => void;
}

function StageNode({ stage, progress, isRu, disabled, onToggleStep, onStageClick }: StageNodeProps) {
  const Icon = stage.icon;
  const complete = isStageComplete(stage, progress);
  const frac = stageFraction(stage, progress);
  const doneCount = stage.subSteps.filter(s => !!progress[s.id]).length;
  const totalCount = stage.subSteps.length;
  const hasPartial = doneCount > 0 && !complete;
  const isEmpty = doneCount === 0;

  const handleClick = () => {
    if (!disabled && onStageClick) onStageClick(stage.id);
  };

  const nodeContent = (
    <div
      className={cn(
        "flex flex-col items-center gap-1 group/node",
        disabled && "opacity-30 pointer-events-none",
        !disabled && onStageClick && "cursor-pointer",
      )}
      onClick={handleClick}
    >
      <div className={cn(
        "relative flex items-center justify-center h-8 w-8 rounded-full border-2 transition-all",
        isEmpty && "border-muted-foreground/30 bg-background",
        hasPartial && "border-primary/50 bg-primary/10",
        complete && "border-primary bg-primary text-primary-foreground",
      )}>
        {complete ? (
          <Icon className="h-4 w-4 text-primary-foreground" />
        ) : (
          <Icon className={cn(
            "h-3.5 w-3.5",
            hasPartial ? "text-primary" : "text-muted-foreground",
          )} />
        )}
        {hasPartial && (
          <svg className="absolute inset-0 h-full w-full -rotate-90" viewBox="0 0 32 32">
            <circle
              cx="16" cy="16" r="14"
              fill="none"
              stroke="hsl(var(--primary))"
              strokeWidth="2"
              strokeDasharray={`${frac * 88} 88`}
              strokeLinecap="round"
              className="opacity-60"
            />
          </svg>
        )}
      </div>
      <span className={cn(
        "text-[10px] font-medium leading-tight text-center max-w-[64px] whitespace-pre-line",
        complete ? "text-primary" : hasPartial ? "text-foreground/80" : "text-muted-foreground/60",
      )}>
        {isRu ? stage.labelRu : stage.labelEn}
      </span>
      {totalCount > 1 && (
        <span className={cn(
          "text-[9px] tabular-nums",
          complete ? "text-primary/70" : "text-muted-foreground/60",
        )}>
          {doneCount}/{totalCount}
        </span>
      )}
    </div>
  );

  const tooltipWrapped = (
    <Tooltip>
      <TooltipTrigger asChild>
        <div>{nodeContent}</div>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="text-xs max-w-[180px]">
        <p className="font-medium mb-1">{isRu ? stage.labelRu.replace(/\n/g, " ") : stage.labelEn.replace(/\n/g, " ")}</p>
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
  );

  if (stage.hasContextMenu && !disabled) {
    return (
      <ContextMenu>
        <ContextMenuTrigger asChild>
          {tooltipWrapped}
        </ContextMenuTrigger>
        <ContextMenuContent className="w-56">
          <ContextMenuLabel className="text-xs font-semibold">
            {isRu ? stage.labelRu.replace(/\n/g, " ") : stage.labelEn.replace(/\n/g, " ")}
          </ContextMenuLabel>
          <ContextMenuSeparator />
          {stage.subSteps.map(sub => (
            <ContextMenuCheckboxItem
              key={sub.id}
              checked={!!progress[sub.id]}
              onCheckedChange={(checked) => onToggleStep?.(sub.id, !!checked)}
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

  return tooltipWrapped;
}

// ── Connector ───────────────────────────────────────────

function Connector({ nextComplete, nextPartial, disabled }: { nextComplete: boolean; nextPartial: boolean; disabled: boolean }) {
  return (
    <div className={cn("flex-1 flex items-start pt-4", disabled && "opacity-30")}>
      <div className={cn(
        "w-full rounded-full transition-colors",
        nextComplete
          ? "h-[3px] bg-primary"
          : nextPartial
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
  /** Called when a stage icon is clicked. stageId = "trans_project" for first, others for navigation */
  onStageClick?: (stageId: string) => void;
}

export function TranslationTimeline({ progress, isRu, onToggleStep, onStageClick }: Props) {
  const isActive = !!progress.storyboard_done;

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-start gap-1 mt-1">
        {/* Label */}
        <span className={cn(
          "text-[9px] font-medium uppercase tracking-wider pt-2 flex-shrink-0 min-w-[32px]",
          isActive ? "text-primary/60" : "text-muted-foreground/30",
        )}>
          {isRu ? "АРТ" : "ART"}
        </span>
        {/* Steps */}
        <div className="flex items-start gap-0 flex-1">
          {STAGES.map((stage, idx) => (
            <div key={stage.id} className="contents">
              {idx > 0 && (
                <Connector
                  nextComplete={isStageComplete(stage, progress)}
                  nextPartial={stageFraction(stage, progress) > 0}
                  disabled={!isActive}
                />
              )}
              <StageNode
                stage={stage}
                progress={progress}
                isRu={isRu}
                disabled={!isActive}
                onToggleStep={onToggleStep}
                onStageClick={onStageClick}
              />
            </div>
          ))}
        </div>
      </div>
    </TooltipProvider>
  );
}
