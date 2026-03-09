import { motion } from "framer-motion";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
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
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const handleSelectSegmentFromTimeline = useCallback((segmentId: string | null) => {
    setSelectedSegmentId(segmentId);
    if (segmentId) setActiveTab("storyboard");
  }, [setActiveTab]);
  const [segmentedSceneIds, setSegmentedSceneIds] = useState<Set<string>>(new Set());
  const [synthesizingSegmentIds, setSynthesizingSegmentIds] = useState<Set<string>>(new Set());
  const [clipsRefreshToken, setClipsRefreshToken] = useState(0);

  // Bump refresh token when synthesis finishes (set goes from non-empty to empty)
  const prevSynthRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (prevSynthRef.current.size > 0 && synthesizingSegmentIds.size === 0) {
      setClipsRefreshToken(t => t + 1);
    }
    prevSynthRef.current = synthesizingSegmentIds;
  }, [synthesizingSegmentIds]);
  const [renderedSceneIds, setRenderedSceneIds] = useState<Set<string>>(new Set());
  const [fullyRenderedSceneIds, setFullyRenderedSceneIds] = useState<Set<string>>(new Set());
  const [staleAudioSceneIds, setStaleAudioSceneIds] = useState<Set<string>>(new Set());
  const [bookId, setBookId] = useState<string | null>(chapter?.bookId ?? null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [silenceSec, setSilenceSec] = useState<number>(2);
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

  // Check which scenes already have segments, audio rendered, and stale audio
  useEffect(() => {
    if (!chapter) return;
    const ids = chapter.scenes.map(s => s.id).filter(Boolean) as string[];
    if (ids.length === 0) return;
    (async () => {
      const { data: segData } = await supabase
        .from("scene_segments")
        .select("id, scene_id, speaker")
        .in("scene_id", ids);

      if (!segData?.length) return;

      setSegmentedSceneIds(new Set(segData.map(d => d.scene_id)));

      const segIds = segData.map(s => s.id);
      const { data: audioData } = await supabase
        .from("segment_audio")
        .select("segment_id, voice_config")
        .in("segment_id", segIds)
        .eq("status", "ready");

      // Load current character voice configs for staleness check
      const currentBookId = bookId ?? chapter.bookId;
      let charVoiceMap = new Map<string, Record<string, unknown>>();
      if (currentBookId) {
        const { data: chars } = await supabase
          .from("book_characters")
          .select("name, aliases, voice_config")
          .eq("book_id", currentBookId);
        if (chars) {
          for (const c of chars) {
            const vc = (c.voice_config || {}) as Record<string, unknown>;
            charVoiceMap.set((c.name || "").toLowerCase(), vc);
            for (const a of (c.aliases || [])) {
              charVoiceMap.set((a as string).toLowerCase(), vc);
            }
          }
        }
      }

      if (audioData?.length) {
        const segToScene = new Map(segData.map(s => [s.id, s.scene_id]));
        const segToSpeaker = new Map(segData.map(s => [s.id, s.speaker]));
        const rendered = new Set<string>();
        const stale = new Set<string>();
        const segCountByScene = new Map<string, number>();
        const audioCountByScene = new Map<string, number>();
        for (const s of segData) {
          segCountByScene.set(s.scene_id, (segCountByScene.get(s.scene_id) ?? 0) + 1);
        }
        for (const a of audioData) {
          const sceneId = segToScene.get(a.segment_id);
          if (sceneId) {
            rendered.add(sceneId);
            audioCountByScene.set(sceneId, (audioCountByScene.get(sceneId) ?? 0) + 1);
            // Check staleness: compare saved voice_config with current character voice_config
            const speaker = segToSpeaker.get(a.segment_id);
            if (speaker && charVoiceMap.size > 0) {
              const currentVc = charVoiceMap.get(speaker.toLowerCase());
              // Only compare if character has an explicitly configured voice
              if (currentVc && currentVc.voice) {
                const savedVc = (a.voice_config || {}) as Record<string, unknown>;
                const keys = ["voice", "role", "speed", "pitchShift", "volume"];
                const changed = keys.some(k => {
                  const cur = currentVc[k];
                  const sav = savedVc[k];
                  // Normalize: treat undefined/null/"" as equivalent empty
                  const curStr = (cur !== undefined && cur !== null && cur !== "") ? String(cur) : "";
                  const savStr = (sav !== undefined && sav !== null && sav !== "") ? String(sav) : "";
                  // For numeric fields, compare numerically to avoid "1" vs "1.0" issues
                  if (k === "speed" || k === "pitchShift" || k === "volume") {
                    const curNum = curStr ? Number(curStr) : -999;
                    const savNum = savStr ? Number(savStr) : -999;
                    return Math.abs(curNum - savNum) > 0.01;
                  }
                  return curStr !== savStr;
                });
                if (changed) stale.add(sceneId);
              }
            }
          }
        }
        setRenderedSceneIds(rendered);
        setStaleAudioSceneIds(stale);
        const fully = new Set<string>();
        for (const [sceneId, total] of segCountByScene) {
          if ((audioCountByScene.get(sceneId) ?? 0) >= total) fully.add(sceneId);
        }
        setFullyRenderedSceneIds(fully);
      }
    })();
  }, [chapter?.scenes.map(s => s.id).join(","), bookId, clipsRefreshToken]);

  // Load scene content and silenceSec: prefer in-memory, fallback to DB
  useEffect(() => {
    setSceneContent(null);
    if (!selectedScene) return;
    if (selectedScene.content) {
      setSceneContent(selectedScene.content);
    }
    if (!selectedScene.id) return;
    (async () => {
      const { data } = await supabase
        .from("book_scenes")
        .select("content, silence_sec")
        .eq("id", selectedScene.id)
        .maybeSingle();
      if (!selectedScene.content && data?.content) setSceneContent(data.content);
      if (data?.silence_sec !== undefined) setSilenceSec(data.silence_sec);
    })();
  }, [selectedScene?.id, selectedScene?.content]);

  // Save silenceSec when changed
  const handleSilenceSecChange = useCallback(async (sec: number) => {
    setSilenceSec(sec);
    if (selectedScene?.id) {
      await supabase.from("book_scenes").update({ silence_sec: sec }).eq("id", selectedScene.id);
      setClipsRefreshToken(t => t + 1); // Refresh timeline
    }
  }, [selectedScene?.id]);

  const onSegmented = useCallback((sceneId: string) => {
    setSegmentedSceneIds(prev => new Set(prev).add(sceneId));
    // Always refresh clips when segmentation/synthesis completes
    setClipsRefreshToken(t => t + 1);
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
                  renderedSceneIds={renderedSceneIds}
                  fullyRenderedSceneIds={fullyRenderedSceneIds}
                  staleAudioSceneIds={staleAudioSceneIds}
                  onBatchResynthDone={() => setClipsRefreshToken(t => t + 1)}
                  clipsRefreshToken={clipsRefreshToken}
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
                selectedSegmentId={selectedSegmentId}
                onSelectSegment={setSelectedSegmentId}
                onSynthesizingChange={setSynthesizingSegmentIds}
                silenceSec={silenceSec}
                onSilenceSecChange={handleSilenceSecChange}
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
          selectedSegmentId={selectedSegmentId}
          onSelectSegment={handleSelectSegmentFromTimeline}
          synthesizingSegmentIds={synthesizingSegmentIds}
          clipsRefreshToken={clipsRefreshToken}
        />
      </div>
    </motion.div>
  );
};

export default Studio;
