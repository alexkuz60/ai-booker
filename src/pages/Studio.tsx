import { motion } from "framer-motion";
import { useState, useMemo, useEffect } from "react";
import { Clock } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { loadStudioChapter, type StudioChapter } from "@/lib/studioChapter";
import { useLanguage } from "@/hooks/useLanguage";
import { ChapterNavigator, EmptyNavigator } from "@/components/studio/ChapterNavigator";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { StudioTimeline, TIMELINE_HEADER_HEIGHT } from "@/components/studio/StudioTimeline";
import { estimateChapterDuration, estimateSceneDuration } from "@/lib/durationEstimate";
import { supabase } from "@/integrations/supabase/client";

const Studio = () => {
  const { isRu } = useLanguage();
  const [chapter] = useState<StudioChapter | null>(() => loadStudioChapter());
  const [selectedSceneIdx, setSelectedSceneIdx] = useState<number | null>(null);
  const [sceneContent, setSceneContent] = useState<string | null>(null);

  const selectedScene = chapter && selectedSceneIdx !== null ? chapter.scenes[selectedSceneIdx] : null;

  const chapterEstimate = useMemo(() => chapter ? estimateChapterDuration(chapter) : null, [chapter]);
  const sceneEstimate = useMemo(() => {
    if (!chapter || selectedSceneIdx === null) return null;
    return estimateSceneDuration(chapter.scenes[selectedSceneIdx]);
  }, [chapter, selectedSceneIdx]);

  // Load full scene content from DB when scene is selected
  useEffect(() => {
    setSceneContent(null);
    if (!selectedScene?.id) return;
    (async () => {
      const { data } = await supabase
        .from("book_scenes")
        .select("content")
        .eq("id", selectedScene.id)
        .maybeSingle();
      setSceneContent(data?.content || null);
    })();
  }, [selectedScene?.id]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-[calc(100vh-3rem)] min-h-0 overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">
              {isRu ? "Студия" : "Studio"}
            </h1>
            <p className="text-sm text-muted-foreground font-body">
              {chapter
                ? `${chapter.bookTitle} → ${chapter.chapterTitle}`
                : (isRu ? "Рабочая панель" : "Workspace")}
            </p>
          </div>
          {chapterEstimate && chapterEstimate.chars > 0 && (
            <div className="flex items-center gap-3 text-sm font-body">
              <div className="flex items-center gap-1.5 text-muted-foreground">
                <Clock className="h-4 w-4" />
                <span className="font-medium text-foreground">{chapterEstimate.formatted}</span>
                <span className="text-xs">
                  ({chapterEstimate.chars.toLocaleString()} {isRu ? "сим." : "chars"})
                </span>
              </div>
              {sceneEstimate && sceneEstimate.chars > 0 && (
                <div className="text-xs text-muted-foreground border-l border-border pl-3">
                  {isRu ? "Сцена" : "Scene"}: <span className="font-medium text-foreground">{sceneEstimate.formatted}</span>
                  <span className="ml-1">({sceneEstimate.chars.toLocaleString()} {isRu ? "сим." : "ch."})</span>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Body: upper workspace + bottom timeline */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {/* Upper: Navigator + Tabs */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <ResizablePanelGroup direction="horizontal" className="h-full min-h-0" autoSaveId="studio-h-panels">
            <ResizablePanel defaultSize={30} minSize={15} maxSize={50} className="min-h-0">
              {chapter ? (
                <ChapterNavigator
                  chapter={chapter}
                  selectedSceneIdx={selectedSceneIdx}
                  onSelectScene={setSelectedSceneIdx}
                  isRu={isRu}
                />
              ) : (
                <EmptyNavigator isRu={isRu} />
              )}
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={70} className="min-h-0">
              <StudioWorkspace
                isRu={isRu}
                selectedSceneId={selectedScene?.id ?? null}
                selectedSceneContent={sceneContent}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Bottom: Timeline */}
        <StudioTimeline isRu={isRu} durationSec={chapterEstimate?.sec} />
      </div>
    </motion.div>
  );
};

export default Studio;
