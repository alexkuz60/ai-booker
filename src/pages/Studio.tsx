import { motion } from "framer-motion";
import { useState, useMemo } from "react";
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

const Studio = () => {
  const { isRu } = useLanguage();
  const [chapter] = useState<StudioChapter | null>(() => loadStudioChapter());
  const [selectedSceneIdx, setSelectedSceneIdx] = useState<number | null>(null);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-[calc(100vh-3rem)] min-h-0 overflow-hidden"
    >
      {/* Header */}
      <div className="px-6 py-3 border-b border-border shrink-0">
        <h1 className="font-display text-2xl font-bold text-foreground">
          {isRu ? "Студия" : "Studio"}
        </h1>
        <p className="text-sm text-muted-foreground font-body">
          {chapter
            ? `${chapter.bookTitle} → ${chapter.chapterTitle}`
            : (isRu ? "Рабочая панель" : "Workspace")}
        </p>
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
              <StudioWorkspace isRu={isRu} />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        {/* Bottom: Timeline */}
        <StudioTimeline isRu={isRu} />
      </div>
    </motion.div>
  );
};

export default Studio;
