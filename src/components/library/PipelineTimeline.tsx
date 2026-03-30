/**
 * PipelineTimeline — horizontal stepper for book pipeline progress.
 *
 * Classic step-connector-step layout with icons, labels, progress lines.
 * Reads from project.json's `pipelineProgress` (flat Record<string, boolean>).
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen, BookOpen, Music, Film,
  Check, Lock,
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

// ── Stage / sub-step definitions ────────────────────────

interface SubStepDef {
  id: PipelineStepId;
  labelRu: string;
  labelEn: string;
  auto?: boolean;
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
      { id: "file_uploaded", labelRu: "Файл загружен", labelEn: "File uploaded", auto: true },
      { id: "opfs_created", labelRu: "Хранилище создано", labelEn: "Storage created", auto: true },
    ],
  },
  {
    id: "parser", labelRu: "Парсер", labelEn: "Parser", route: "/parser", icon: BookOpen,
    subSteps: [
      { id: "toc_extracted", labelRu: "Структура (TOC)", labelEn: "Structure (TOC)", auto: true },
      { id: "scenes_analyzed", labelRu: "Сцены проанализированы", labelEn: "Scenes analyzed", auto: true },
      { id: "characters_extracted", labelRu: "Персонажи извлечены", labelEn: "Characters extracted", auto: true },
      { id: "profiles_done", labelRu: "Профайлы готовы", labelEn: "Profiles ready" },
    ],
  },
  {
    id: "studio", labelRu: "Студия", labelEn: "Studio", route: "/studio", icon: Music,
    subSteps: [
      { id: "storyboard_done", labelRu: "Раскадровка", labelEn: "Storyboard", auto: true },
      { id: "inline_edit", labelRu: "Инлайн-правка", labelEn: "Inline editing" },
      { id: "synthesis_done", labelRu: "Синтез речи", labelEn: "Speech synthesis", auto: true },
      { id: "mix_done", labelRu: "Микс и эффекты", labelEn: "Mix & effects" },
      { id: "scene_render", labelRu: "Рендер сцен", labelEn: "Scene render", auto: true },
    ],
  },
  {
    id: "montage", labelRu: "Монтаж", labelEn: "Montage", route: "/montage", icon: Film,
    subSteps: [
      { id: "chapter_assembly", labelRu: "Сборка главы", labelEn: "Chapter assembly" },
      { id: "mastering", labelRu: "Мастеринг", labelEn: "Mastering" },
      { id: "final_render", labelRu: "Финальный рендер", labelEn: "Final render", auto: true },
    ],
  },
];

// ── Helpers ──────────────────────────────────────────────

function isStageComplete(stage: StageDef, progress: PipelineProgress): boolean {
  return stage.subSteps.length > 0 && stage.subSteps.every(s => !!progress[s.id]);
}

function isStageUnlocked(stageIdx: number, progress: PipelineProgress): boolean {
  if (stageIdx === 0) return true;
  return isStageComplete(STAGES[stageIdx - 1], progress);
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
  onNavigate: (stage: StageDef, idx: number) => void;
  onToggleStep?: (stepId: PipelineStepId, done: boolean) => void;
}

function StageNode({ stage, idx, progress, isRu, onNavigate, onToggleStep }: StageNodeProps) {
  const Icon = stage.icon;
  const unlocked = isStageUnlocked(idx, progress);
  const complete = isStageComplete(stage, progress);
  const frac = stageFraction(stage, progress);
  const doneCount = stage.subSteps.filter(s => !!progress[s.id]).length;
  const totalCount = stage.subSteps.length;
  const hasPartial = doneCount > 0 && !complete;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={() => onNavigate(stage, idx)}
              disabled={!unlocked}
              className={cn(
                "flex flex-col items-center gap-1.5 group/node focus-visible:outline-none",
                !unlocked && "opacity-40 cursor-not-allowed",
                unlocked && "cursor-pointer",
              )}
            >
              {/* Circle */}
              <div className={cn(
                "relative flex items-center justify-center h-10 w-10 rounded-full border-2 transition-all",
                !unlocked && "border-muted bg-muted/30",
                unlocked && !complete && !hasPartial && "border-muted-foreground/30 bg-background group-hover/node:border-primary/50",
                hasPartial && !complete && "border-primary/50 bg-primary/5",
                complete && "border-primary bg-primary text-primary-foreground",
              )}>
                {!unlocked ? (
                  <Lock className="h-4 w-4 text-muted-foreground" />
                ) : complete ? (
                  <Check className="h-5 w-5" />
                ) : (
                  <Icon className={cn(
                    "h-4.5 w-4.5",
                    hasPartial ? "text-primary" : "text-muted-foreground group-hover/node:text-foreground",
                  )} />
                )}

                {/* Partial ring indicator */}
                {unlocked && hasPartial && (
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

              {/* Label */}
              <span className={cn(
                "text-[11px] font-medium leading-tight text-center max-w-[72px]",
                complete ? "text-primary" : unlocked ? "text-foreground/80" : "text-muted-foreground/50",
              )}>
                {isRu ? stage.labelRu : stage.labelEn}
              </span>

              {/* Sub-step counter */}
              <span className={cn(
                "text-[10px] tabular-nums",
                complete ? "text-primary/70" : "text-muted-foreground/60",
              )}>
                {doneCount}/{totalCount}
              </span>
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="text-xs max-w-[200px]">
            <p className="font-medium mb-1">
              {isRu ? stage.labelRu : stage.labelEn}
              {!unlocked && " 🔒"}
            </p>
            <ul className="space-y-0.5">
              {stage.subSteps.map(sub => (
                <li key={sub.id} className="flex items-center gap-1.5">
                  {progress[sub.id]
                    ? <Check className="h-3 w-3 text-primary flex-shrink-0" />
                    : <span className="h-3 w-3 rounded-full border border-muted-foreground/30 flex-shrink-0" />
                  }
                  <span className={progress[sub.id] ? "text-foreground" : "text-muted-foreground"}>
                    {isRu ? sub.labelRu : sub.labelEn}
                  </span>
                </li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      </ContextMenuTrigger>

      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="text-xs font-semibold">
          {isRu ? stage.labelRu : stage.labelEn}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        {stage.subSteps.map(sub => (
          <ContextMenuCheckboxItem
            key={sub.id}
            checked={!!progress[sub.id]}
            disabled={sub.auto}
            onCheckedChange={(checked) => {
              if (!sub.auto) onToggleStep?.(sub.id, !!checked);
            }}
            onSelect={(e) => e.preventDefault()}
            className="text-xs"
          >
            <span className="flex items-center gap-1.5">
              {isRu ? sub.labelRu : sub.labelEn}
              {sub.auto && (
                <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wide">auto</span>
              )}
            </span>
          </ContextMenuCheckboxItem>
        ))}
      </ContextMenuContent>
    </ContextMenu>
  );
}

// ── Connector line between stages ───────────────────────

function Connector({ prevComplete, nextUnlocked }: { prevComplete: boolean; nextUnlocked: boolean }) {
  return (
    <div className="flex-1 flex items-start pt-5">
      <div className={cn(
        "h-0.5 w-full rounded-full transition-colors",
        prevComplete && nextUnlocked
          ? "bg-primary/60"
          : prevComplete
            ? "bg-primary/30"
            : "bg-muted-foreground/15",
      )} />
    </div>
  );
}

// ── Main component ──────────────────────────────────────

interface Props {
  progress: PipelineProgress;
  isRu: boolean;
  onToggleStep?: (stepId: PipelineStepId, done: boolean) => void;
}

export function PipelineTimeline({ progress, isRu, onToggleStep }: Props) {
  const navigate = useNavigate();

  const handleStageClick = useCallback((stage: StageDef, idx: number) => {
    if (!isStageUnlocked(idx, progress)) return;
    navigate(stage.route);
  }, [progress, navigate]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-start gap-0 w-full max-w-[520px]">
        {STAGES.map((stage, idx) => (
          <div key={stage.id} className="contents">
            {idx > 0 && (
              <Connector
                prevComplete={isStageComplete(STAGES[idx - 1], progress)}
                nextUnlocked={isStageUnlocked(idx, progress)}
              />
            )}
            <StageNode
              stage={stage}
              idx={idx}
              progress={progress}
              isRu={isRu}
              onNavigate={handleStageClick}
              onToggleStep={onToggleStep}
            />
          </div>
        ))}
      </div>
    </TooltipProvider>
  );
}
