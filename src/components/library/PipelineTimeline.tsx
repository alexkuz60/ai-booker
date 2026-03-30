/**
 * PipelineTimeline — horizontal 4-stage progress indicator for book cards.
 *
 * Stages: Project → Parser → Studio → Montage
 * Each stage icon is a navigation button (disabled until prerequisites met).
 * Sub-steps shown in a context menu with auto-detect + manual checkboxes.
 */

import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderOpen, BookOpen, Music, Film,
  ChevronRight, Check, Circle, Lock,
} from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent,
  ContextMenuCheckboxItem, ContextMenuSeparator, ContextMenuLabel,
} from "@/components/ui/context-menu";
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

// ── Pipeline definition ─────────────────────────────────────

export interface SubStep {
  id: string;
  labelRu: string;
  labelEn: string;
  auto?: boolean;        // can be auto-detected
  done: boolean;
}

export interface PipelineStage {
  id: "project" | "parser" | "studio" | "montage";
  labelRu: string;
  labelEn: string;
  route: string;
  subSteps: SubStep[];
}

export interface PipelineProgress {
  stages: PipelineStage[];
}

// ── Default pipeline factory ────────────────────────────────

export function createDefaultPipeline(): PipelineStage[] {
  return [
    {
      id: "project",
      labelRu: "Проект",
      labelEn: "Project",
      route: "/",
      subSteps: [
        { id: "file_uploaded", labelRu: "Файл загружен", labelEn: "File uploaded", auto: true, done: false },
        { id: "opfs_created", labelRu: "Хранилище создано", labelEn: "Storage created", auto: true, done: false },
      ],
    },
    {
      id: "parser",
      labelRu: "Парсер",
      labelEn: "Parser",
      route: "/parser",
      subSteps: [
        { id: "toc_extracted", labelRu: "Структура (TOC)", labelEn: "Structure (TOC)", auto: true, done: false },
        { id: "scenes_analyzed", labelRu: "Сцены проанализированы", labelEn: "Scenes analyzed", auto: true, done: false },
        { id: "characters_extracted", labelRu: "Персонажи извлечены", labelEn: "Characters extracted", auto: true, done: false },
        { id: "profiles_done", labelRu: "Профайлы готовы", labelEn: "Profiles ready", done: false },
      ],
    },
    {
      id: "studio",
      labelRu: "Студия",
      labelEn: "Studio",
      route: "/studio",
      subSteps: [
        { id: "storyboard_done", labelRu: "Раскадровка", labelEn: "Storyboard", auto: true, done: false },
        { id: "inline_edit", labelRu: "Инлайн-правка", labelEn: "Inline editing", done: false },
        { id: "synthesis_done", labelRu: "Синтез речи", labelEn: "Speech synthesis", auto: true, done: false },
        { id: "mix_done", labelRu: "Микс и эффекты", labelEn: "Mix & effects", done: false },
        { id: "scene_render", labelRu: "Рендер сцен", labelEn: "Scene render", auto: true, done: false },
      ],
    },
    {
      id: "montage",
      labelRu: "Монтаж",
      labelEn: "Montage",
      route: "/montage",
      subSteps: [
        { id: "chapter_assembly", labelRu: "Сборка главы", labelEn: "Chapter assembly", done: false },
        { id: "mastering", labelRu: "Мастеринг", labelEn: "Mastering", done: false },
        { id: "final_render", labelRu: "Финальный рендер", labelEn: "Final render", auto: true, done: false },
      ],
    },
  ];
}

// ── Helpers ──────────────────────────────────────────────────

function stageIcon(id: string) {
  switch (id) {
    case "project": return FolderOpen;
    case "parser": return BookOpen;
    case "studio": return Music;
    case "montage": return Film;
    default: return Circle;
  }
}

function isStageComplete(stage: PipelineStage): boolean {
  return stage.subSteps.length > 0 && stage.subSteps.every(s => s.done);
}

function isStageUnlocked(stages: PipelineStage[], idx: number): boolean {
  if (idx === 0) return true;
  return isStageComplete(stages[idx - 1]);
}

function stageProgress(stage: PipelineStage): number {
  if (stage.subSteps.length === 0) return 0;
  return stage.subSteps.filter(s => s.done).length / stage.subSteps.length;
}

// ── Component ───────────────────────────────────────────────

interface Props {
  stages: PipelineStage[];
  isRu: boolean;
  onToggleSubStep?: (stageId: string, subStepId: string, done: boolean) => void;
  bookId: string;
}

export function PipelineTimeline({ stages, isRu, onToggleSubStep, bookId }: Props) {
  const navigate = useNavigate();

  const handleStageClick = useCallback((stage: PipelineStage, idx: number) => {
    if (!isStageUnlocked(stages, idx)) return;
    navigate(stage.route);
  }, [stages, navigate]);

  return (
    <TooltipProvider delayDuration={200}>
      <div className="flex items-center gap-0.5">
        {stages.map((stage, idx) => {
          const Icon = stageIcon(stage.id);
          const unlocked = isStageUnlocked(stages, idx);
          const complete = isStageComplete(stage);
          const progress = stageProgress(stage);
          const doneCount = stage.subSteps.filter(s => s.done).length;
          const totalCount = stage.subSteps.length;
          const hasPartial = doneCount > 0 && !complete;

          return (
            <div key={stage.id} className="flex items-center">
              {idx > 0 && (
                <ChevronRight className={cn(
                  "h-3 w-3 mx-0.5 flex-shrink-0",
                  isStageComplete(stages[idx - 1])
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

                        {/* Mini progress arc (bottom line) */}
                        {unlocked && !complete && doneCount > 0 && (
                          <div className="absolute bottom-0.5 left-1.5 right-1.5 h-0.5 rounded-full bg-muted overflow-hidden">
                            <div
                              className="h-full bg-primary/60 rounded-full transition-all"
                              style={{ width: `${progress * 100}%` }}
                            />
                          </div>
                        )}
                      </button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="text-xs">
                      <p className="font-medium">
                        {isRu ? stage.labelRu : stage.labelEn}
                        {!unlocked && (isRu ? " 🔒" : " 🔒")}
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
                      checked={sub.done}
                      disabled={sub.auto}
                      onCheckedChange={(checked) => {
                        if (!sub.auto) {
                          onToggleSubStep?.(stage.id, sub.id, !!checked);
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
