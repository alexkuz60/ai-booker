import { motion } from "framer-motion";
import { useState, useMemo, useEffect, useCallback } from "react";
import { Clock, Loader2 } from "lucide-react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { type StudioChapter } from "@/lib/studioChapter";
import { useLanguage } from "@/hooks/useLanguage";
import { ChapterNavigator, EmptyNavigator } from "@/components/studio/ChapterNavigator";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { StudioTimeline } from "@/components/studio/StudioTimeline";
import { estimateChapterDuration, estimateSceneDuration } from "@/lib/durationEstimate";
import { supabase } from "@/integrations/supabase/client";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useStudioSession } from "@/hooks/useStudioSession";

const Studio = () => {
  const { isRu } = useLanguage();
  const {
    chapter, setChapter,
    selectedSceneIdx, setSelectedSceneIdx,
    activeTab, setActiveTab,
    restored,
  } = useStudioSession();

  const [sceneContent, setSceneContent] = useState<string | null>(null);
  const [segmentedSceneIds, setSegmentedSceneIds] = useState<Set<string>>(new Set());
  const [bookId, setBookId] = useState<string | null>(chapter?.bookId ?? null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const chapterSceneIds = chapter?.scenes.map(s => s.id).filter(Boolean) as string[] | undefined;

  const selectedScene = chapter && selectedSceneIdx !== null ? chapter.scenes[selectedSceneIdx] : null;

  const chapterEstimate = useMemo(() => chapter ? estimateChapterDuration(chapter) : null, [chapter]);
  const sceneEstimate = useMemo(() => {
    if (!chapter || selectedSceneIdx === null) return null;
    return estimateSceneDuration(chapter.scenes[selectedSceneIdx]);
  }, [chapter, selectedSceneIdx]);

  // Resolve scene IDs and bookId from DB
  useEffect(() => {
    if (!chapter) return;
    const needIds = chapter.scenes.some(s => !s.id);
    const needBookId = !bookId;
    if (!needIds && !needBookId) return;

    (async () => {
      const { data: dbChapters } = await supabase
        .from("book_chapters")
        .select("id, title, book_id")
        .ilike("title", chapter.chapterTitle);
      if (!dbChapters?.length) return;

      if (needBookId && dbChapters[0]?.book_id) {
        setBookId(dbChapters[0].book_id);
      }

      if (needIds) {
        const chapterIds = dbChapters.map(c => c.id);
        const { data: dbScenes } = await supabase
          .from("book_scenes")
          .select("id, chapter_id, scene_number, content")
          .in("chapter_id", chapterIds)
          .order("scene_number");
        if (!dbScenes?.length) return;

        const updated = { ...chapter, scenes: chapter.scenes.map(s => {
          if (s.id) return s;
          const match = dbScenes.find(db => db.scene_number === s.scene_number);
          return match ? { ...s, id: match.id } : s;
        })};
        setChapter(updated);
      }
    })();
  }, [chapter?.chapterTitle]);

  // Check which scenes already have segments
  useEffect(() => {
    if (!chapter) return;
    const ids = chapter.scenes.map(s => s.id).filter(Boolean) as string[];
    if (ids.length === 0) return;
    (async () => {
      const { data } = await supabase
        .from("scene_segments")
        .select("scene_id")
        .in("scene_id", ids);
      if (data) {
        setSegmentedSceneIds(new Set(data.map(d => d.scene_id)));
      }
    })();
  }, [chapter?.scenes.map(s => s.id).join(",")]);

  // Load scene content: prefer in-memory, fallback to DB
  useEffect(() => {
    setSceneContent(null);
    if (!selectedScene) return;
    if (selectedScene.content) {
      setSceneContent(selectedScene.content);
      return;
    }
    if (!selectedScene.id) return;
    (async () => {
      const { data } = await supabase
        .from("book_scenes")
        .select("content")
        .eq("id", selectedScene.id)
        .maybeSingle();
      setSceneContent(data?.content || null);
    })();
  }, [selectedScene?.id, selectedScene?.content]);

  const onSegmented = useCallback((sceneId: string) => {
    setSegmentedSceneIds(prev => new Set(prev).add(sceneId));
  }, []);

  const { setPageHeader } = usePageHeader();

  const studioTitle = isRu ? 'АУДИО СТУДИЯ "ОК"' : 'AUDIO STUDIO "OK"';
  const studioSubtitle = chapter
    ? `${chapter.bookTitle} → ${chapter.chapterTitle}`
    : (isRu ? "Звукозапись ИИ-актеров. Монтаж. Сведение. Мастеринг." : "AI Voice Recording. Editing. Mixing. Mastering.");

  const headerRight = chapterEstimate && chapterEstimate.chars > 0 ? (
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
  ) : undefined;

  useEffect(() => {
    setPageHeader({ title: studioTitle, subtitle: studioSubtitle, headerRight });
    return () => setPageHeader({});
  }, [studioTitle, studioSubtitle, chapterEstimate?.formatted, sceneEstimate?.formatted]);

  // Show loading while restoring session
  if (!restored) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-3rem)]">
        <div className="flex flex-col items-center gap-3 text-muted-foreground">
          <Loader2 className="h-6 w-6 animate-spin" />
          <span className="text-sm font-body">{isRu ? "Восстановление сессии…" : "Restoring session…"}</span>
        </div>
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex flex-col h-[calc(100vh-3rem)] min-h-0 overflow-hidden"
    >
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-hidden">
          <ResizablePanelGroup direction="horizontal" className="h-full min-h-0" autoSaveId="studio-h-panels">
            <ResizablePanel defaultSize={30} minSize={15} maxSize={50} className="min-h-0">
              {chapter ? (
                <ChapterNavigator
                  chapter={chapter}
                  selectedSceneIdx={selectedSceneIdx}
                  onSelectScene={setSelectedSceneIdx}
                  isRu={isRu}
                  segmentedSceneIds={segmentedSceneIds}
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
                bookId={bookId}
                chapterSceneIds={chapterSceneIds}
                onSegmented={onSegmented}
                selectedCharacterId={selectedCharacterId}
                onSelectCharacter={setSelectedCharacterId}
                activeTab={activeTab}
                onTabChange={setActiveTab}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <StudioTimeline
          isRu={isRu}
          sceneDurationSec={sceneEstimate?.sec}
          chapterDurationSec={chapterEstimate?.sec}
          sceneId={selectedScene?.id ?? null}
          bookId={bookId}
          chapterSceneIds={chapterSceneIds}
          chapterScenes={chapter?.scenes.map(s => ({ id: s.id, scene_number: s.scene_number, title: s.title }))}
          selectedCharacterId={selectedCharacterId}
          onSelectCharacter={setSelectedCharacterId}
          onSelectSceneIdx={setSelectedSceneIdx}
        />
      </div>
    </motion.div>
  );
};

export default Studio;
