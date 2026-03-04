import { useState } from "react";
import { ChevronRight, ChevronDown, Clapperboard } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { StudioChapter } from "@/lib/studioChapter";
import { estimateSceneDuration } from "@/lib/durationEstimate";

// ─── Scene type colors (same as Parser) ─────────────────────
export const SCENE_TYPE_COLORS: Record<string, string> = {
  action: "bg-red-500/20 text-red-400 border-red-500/30",
  dialogue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  lyrical_digression: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  description: "bg-green-500/20 text-green-400 border-green-500/30",
  inner_monologue: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  mixed: "bg-muted text-muted-foreground border-border",
};

export const SCENE_TYPE_RU: Record<string, string> = {
  action: "действие",
  dialogue: "диалог",
  lyrical_digression: "лир. отступление",
  description: "описание",
  inner_monologue: "внутр. монолог",
  mixed: "смешанный",
};

// ─── Chapter Navigator ──────────────────────────────────────

export function ChapterNavigator({
  chapter,
  selectedSceneIdx,
  onSelectScene,
  isRu,
  segmentedSceneIds,
}: {
  chapter: StudioChapter;
  selectedSceneIdx: number | null;
  onSelectScene: (idx: number | null) => void;
  isRu: boolean;
  segmentedSceneIds?: Set<string>;
}) {
  const [chapterOpen, setChapterOpen] = useState(true);

  return (
    <div className="h-full flex flex-col border-r border-border">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Clapperboard className="h-5 w-5 text-primary" />
          <span className="text-sm font-medium text-muted-foreground uppercase tracking-wider font-body">
            {isRu ? "Глава" : "Chapter"}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">
          {chapter.bookTitle}
        </p>
      </div>
      <ScrollArea type="always" className="flex-1 min-h-0">
        <div className="py-2 px-1">
          <Collapsible open={chapterOpen} onOpenChange={setChapterOpen}>
            <CollapsibleTrigger asChild>
              <button
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 text-base font-body rounded-md transition-colors",
                  "hover:bg-accent/50 font-semibold text-foreground"
                )}
                onClick={() => onSelectScene(null)}
              >
                {chapterOpen ? (
                  <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                ) : (
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{chapter.chapterTitle}</span>
                <Badge variant="outline" className="ml-auto text-[11px] shrink-0">
                  {chapter.scenes.length}
                </Badge>
              </button>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <div className="space-y-0.5">
                {chapter.scenes.map((scene, idx) => {
                  const colorClass = SCENE_TYPE_COLORS[scene.scene_type] || SCENE_TYPE_COLORS.mixed;
                  const est = estimateSceneDuration(scene);
                  return (
                    <button
                      key={idx}
                      onClick={() => onSelectScene(idx)}
                      className={cn(
                        "w-full flex items-center gap-2 pl-9 pr-3 py-2 text-sm font-body rounded-md transition-colors text-left",
                        "hover:bg-accent/50",
                        selectedSceneIdx === idx && "bg-primary/10 text-primary border-r-2 border-primary"
                      )}
                    >
                      <span className={cn("px-1.5 py-0.5 rounded text-[10px] border shrink-0", colorClass)}>
                        {isRu ? (SCENE_TYPE_RU[scene.scene_type] || scene.scene_type) : scene.scene_type}
                      </span>
                      <span className="truncate flex-1">{scene.title}</span>
                      <span className="text-[11px] text-muted-foreground font-mono shrink-0" title={`${est.chars} ${isRu ? "сим." : "chars"}`}>
                        {est.formatted}
                      </span>
                    </button>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Empty state ────────────────────────────────────────────

export function EmptyNavigator({ isRu }: { isRu: boolean }) {
  return (
    <div className="h-full flex flex-col border-r border-border">
      <div className="px-4 py-3 border-b border-border shrink-0">
        <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider font-body">
          {isRu ? "Глава" : "Chapter"}
        </span>
      </div>
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="text-center space-y-2">
          <Clapperboard className="h-8 w-8 mx-auto text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "Откройте главу из Парсера, нажав иконку 🎬 рядом с проанализированной главой"
              : "Open a chapter from Parser by clicking the 🎬 icon next to an analyzed chapter"}
          </p>
        </div>
      </div>
    </div>
  );
}
