/**
 * PipelineTimeline — horizontal 4-stage progress indicator for book cards.
 *
 * Reads from project.json's `pipelineProgress` (flat Record<string, boolean>).
 * Stage → sub-step mapping is purely a UI concern defined here.
 */

import { useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen, BookOpen, Music, Film,
  ChevronRight, Check, Lock,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuCheckboxItem, ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import type { PipelineProgress, PipelineStepId } from "@/lib/projectStorage";

// ── Stage / sub-step UI definition ──────────────────────

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

// ── Component ───────────────────────────────────────────

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
      <div className="flex items-center gap-0.5">
        {STAGES.map((stage, idx) => {
          const Icon = stage.icon;
          const unlocked = isStageUnlocked(idx, progress);
          const complete = isStageComplete(stage, progress);
          const frac = stageFraction(stage, progress);
          const doneCount = stage.subSteps.filter(s => !!progress[s.id]).length;
          const totalCount = stage.subSteps.length;
          const hasPartial = doneCount > 0 && !complete;

          return (
            <div key={stage.id} className="flex items-center">
              {idx > 0 && (
                <ChevronRight className={cn(
                  "h-3 w-3 mx-0.5 flex-shrink-0",
                  isStageComplete(STAGES[idx - 1], progress)
                    ? "text-primary/60"
                    : "text-muted-foreground/30",
                )} />
              )}

              <ContextMenu>
                <ContextMenuTrigger asChild>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => handleStageClick(stage, idx)}
                        disabled={!unlocked}
                        className={cn(
                          "relative flex items-center justify-center h-8 w-8 rounded-lg transition-all",
                          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                          !unlocked && "opacity-40 cursor-not-allowed",
                          unlocked && !complete && "hover:bg-accent cursor-pointer",
                          complete && "bg-primary/15 text-primary cursor-pointer hover:bg-primary/20",
                          hasPartial && !complete && "ring-1 ring-primary/30",
                        )}
                      >
                        {!unlocked ? (
                          <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : complete ? (
                          <div className="relative">
                            <Icon className="h-4 w-4 text-primary" />
                            <Check className="absolute -bottom-1 -right-1 h-2.5 w-2.5 text-primary bg-background rounded-full" />
                          </div>
                        ) : (
                          <Icon className={cn(
                            "h-4 w-4",
                            hasPartial ? "text-primary/70" : "text-muted-foreground",
                          )} />
                        )}

                        {unlocked && !complete && doneCount > 0 && (
                          <div className="absolute bottom-0.5 left-1.5 right-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary/60 rounded-full transition-all"
                              style={{ width: `${frac * 100}%` }}
                            />
                          </div>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      <p className="font-medium">
                        {isRu ? stage.labelRu : stage.labelEn}
                        {!unlocked && " 🔒"}
                      </p>
                      <p className="text-muted-foreground">
                        {doneCount}/{totalCount} {isRu ? "готово" : "done"}
                      </p>
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
                        if (!sub.auto) {
                          onToggleStep?.(sub.id, !!checked);
                        }
                      }}
                      onSelect={(e) => e.preventDefault()}
                      className="text-xs"
                    >
                      <span className="flex items-center gap-1.5">
                        {isRu ? sub.labelRu : sub.labelEn}
                        {sub.auto && (
                          <span className="text-[9px] text-muted-foreground/60 uppercase tracking-wide">
                            auto
                          </span>
                        )}
                      </span>
                    </ContextMenuCheckboxItem>
                  ))}
                </ContextMenuContent>
              </ContextMenu>
            </div>
          );
        })}
      </div>
    </TooltipProvider>
  );
}
