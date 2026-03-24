import { motion } from "framer-motion";
// @ts-ignore – used for cross-page chapter hydration
import { readStructureFromLocal } from "@/lib/localSync";
import { useState, useMemo, useEffect, useCallback, useRef } from "react";
import { Clock, Loader2 } from "lucide-react";
import { useUserApiKeys } from "@/hooks/useUserApiKeys";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { type StudioChapter } from "@/lib/studioChapter";
import { useLanguage } from "@/hooks/useLanguage";
import { useAuth } from "@/hooks/useAuth";
import { ChapterNavigator, EmptyNavigator } from "@/components/studio/ChapterNavigator";
import { StudioWorkspace } from "@/components/studio/StudioWorkspace";
import { StudioTimeline } from "@/components/studio/StudioTimeline";
import { estimateChapterDuration, estimateSceneDuration, formatDuration } from "@/lib/durationEstimate";
import { supabase } from "@/integrations/supabase/client";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useStudioSession } from "@/hooks/useStudioSession";
import { AiRolesButton } from "@/components/AiRolesButton";
import { useSaveBookToProject } from "@/hooks/useSaveBookToProject";
import { SaveBookButton } from "@/components/SaveBookButton";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import type { LocalChapterData } from "@/lib/localSync";
import { readSceneContentFromLocal } from "@/lib/localSceneContent";
import { getCachedSceneIndex } from "@/lib/sceneIndex";

const Studio = () => {
  const { isRu } = useLanguage();
  const { user } = useAuth();
  const userApiKeys = useUserApiKeys();
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
  const [errorSegmentIds, setErrorSegmentIds] = useState<Set<string>>(new Set());
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
  const [clearedDirtySceneIds, setClearedDirtySceneIds] = useState<Set<string>>(new Set());
  const [bookId, setBookId] = useState<string | null>(chapter?.bookId ?? null);
  const [selectedCharacterId, setSelectedCharacterId] = useState<string | null>(null);
  const [silenceSec, setSilenceSec] = useState<number>(2);
  const chapterSceneIds = chapter?.scenes.map(s => s.id).filter(Boolean) as string[] | undefined;

  // Multi-select state
  const [selectedSceneIndices, setSelectedSceneIndices] = useState<Set<number>>(new Set());
  const [batchSceneIds, setBatchSceneIds] = useState<string[] | null>(null);

  // Build batch scenes info from chapter
  const batchScenes = useMemo(() => {
    if (!chapter || !batchSceneIds) return [];
    return batchSceneIds
      .map(id => {
        const scene = chapter.scenes.find(s => s.id === id);
        if (!scene) return null;
        return { id, title: scene.title, sceneNumber: scene.scene_number, content: scene.content };
      })
      .filter(Boolean) as { id: string; title: string; sceneNumber: number; content?: string | null }[];
  }, [chapter, batchSceneIds]);

  const handleBatchAnalyze = useCallback((sceneIds: string[]) => {
    setBatchSceneIds(sceneIds);
    setActiveTab("storyboard");
  }, [setActiveTab]);

  const handleBatchComplete = useCallback(() => {
    setBatchSceneIds(null);
    setClipsRefreshToken(t => t + 1);
    setSelectedSceneIndices(new Set());
  }, []);

  const handleBatchClose = useCallback(() => {
    setBatchSceneIds(null);
    setSelectedSceneIndices(new Set());
  }, []);

  const selectedScene = chapter && selectedSceneIdx !== null ? chapter.scenes[selectedSceneIdx] : null;
  const { saveBook, saving: savingBook, isProjectOpen, downloadZip, importZip } = useSaveBookToProject({
    isRu,
    currentBookId: bookId,
  });
  const { storage } = useProjectStorageContext();

  const chapterEstimate = useMemo(() => chapter ? estimateChapterDuration(chapter) : null, [chapter]);
  const sceneEstimate = useMemo(() => {
    if (!chapter || selectedSceneIdx === null) return null;
    const scene = chapter.scenes[selectedSceneIdx];
    if (!scene) return null;
    return estimateSceneDuration(scene);
  }, [chapter, selectedSceneIdx]);

  // Playlist durations received from ChapterNavigator (single source of truth)
  const [playlistDurations, setPlaylistDurations] = useState<Map<string, number>>(new Map());
  const handlePlaylistDurationsLoaded = useCallback((m: Map<string, number>) => {
    setPlaylistDurations(m);
  }, []);

  // Resolve scene IDs and bookId from DB
  useEffect(() => {
    if (!chapter) return;
    const needIds = chapter.scenes.some(s => !s.id);
    const currentBookId = bookId || chapter.bookId;
    const needBookId = !bookId;
    if (!needIds && !needBookId) return;

    (async () => {
      let dbChapters: { id: string; title: string; book_id: string }[] | null = null;

      if (chapter.chapterId) {
        let idQuery = supabase
          .from("book_chapters")
          .select("id, title, book_id")
          .eq("id", chapter.chapterId);

        if (currentBookId) {
          idQuery = idQuery.eq("book_id", currentBookId);
        }

        const { data } = await idQuery;
        dbChapters = data;
      }

      if (!dbChapters?.length) {
        let fallbackQuery = supabase
          .from("book_chapters")
          .select("id, title, book_id")
          .eq("title", chapter.chapterTitle)
          .order("chapter_number", { ascending: true })
          .limit(1);

        if (currentBookId) {
          fallbackQuery = fallbackQuery.eq("book_id", currentBookId);
        }

        const { data } = await fallbackQuery;
        dbChapters = data;
      }

      if (!dbChapters?.length) return;

      if (needBookId && dbChapters[0]?.book_id) {
        setBookId(dbChapters[0].book_id);
      }

      if (needIds) {
        const chapterIds = dbChapters.map(c => c.id);
        // LOCAL-FIRST: fetch only IDs for mapping, never content
        const { data: dbScenes } = await supabase
          .from("book_scenes")
          .select("id, chapter_id, scene_number")
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
  }, [chapter?.chapterId, chapter?.chapterTitle, bookId, chapter, setChapter]);

  // Cross-page navigation: if chapter has no scenes (e.g. from Narrators link),
  // hydrate full scene list from OPFS structure data.
  useEffect(() => {
    if (!storage || !chapter?.chapterId || chapter.scenes.length > 0) return;

    let cancelled = false;
    (async () => {
      try {
        const local = await readStructureFromLocal(storage);
        if (cancelled || !local?.structure) return;

        // Find chapter index by chapterId
        let chapterIndex: number | null = null;
        for (const [idx, id] of local.chapterIdMap.entries()) {
          if (id === chapter.chapterId) { chapterIndex = idx; break; }
        }
        if (chapterIndex === null) return;

        const result = local.chapterResults.get(chapterIndex);
        const tocEntry = local.structure.toc[chapterIndex];
        if (!result?.scenes?.length || !tocEntry) return;

        const hydrated = {
          chapterId: chapter.chapterId,
          chapterTitle: tocEntry.title,
          bookTitle: local.structure.title || chapter.bookTitle,
          bookId: local.structure.bookId || chapter.bookId,
          scenes: result.scenes.map(s => ({
            id: (s as any).id,
            scene_number: s.scene_number,
            title: s.title,
            scene_type: s.scene_type || "mixed",
            mood: s.mood || "",
            bpm: s.bpm || 120,
          })),
        };

        if (!cancelled) setChapter(hydrated);
      } catch (err) {
        console.error("[Studio] Failed to hydrate chapter from OPFS:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [storage, chapter?.chapterId, chapter?.scenes?.length, setChapter]);

  // Hydrate chapter scene content from OPFS using robust scene lookup.
  // This avoids relying on sessionStorage snapshots or a single chapter file path.
  useEffect(() => {
    if (!storage || !chapter?.scenes?.length) return;

    let cancelled = false;

    (async () => {
      const resolvedScenes = await Promise.all(
        chapter.scenes.map(async (scene) => {
          const localScene = await readSceneContentFromLocal(storage, {
            sceneId: scene.id,
            chapterId: chapter.chapterId,
            sceneNumber: scene.scene_number,
            title: scene.title,
          });

          return localScene?.content
            ? { ...scene, content: localScene.content, char_count: localScene.content.length }
            : scene;
        }),
      );

      if (cancelled) return;

      setChapter((prev) => {
        if (!prev || prev.chapterId !== chapter.chapterId) return prev;

        let changed = false;
        const scenes = prev.scenes.map((scene, index) => {
          const localScene = resolvedScenes[index];
          const localContent = localScene?.content;

          if (localContent === undefined || localContent === scene.content) {
            return scene;
          }

          changed = true;
          return { ...scene, content: localContent };
        });

        return changed ? { ...prev, scenes } : prev;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [storage, chapter?.chapterId, chapter?.scenes.map((scene) => `${scene.id ?? "no-id"}:${scene.scene_number}:${scene.title}`).join("|"), setChapter]);

  // LOCAL-ONLY: segmented scene IDs come exclusively from OPFS scene_index
  useEffect(() => {
    if (!chapter) return;
    const ids = chapter.scenes.map(s => s.id).filter(Boolean) as string[];
    if (ids.length === 0) return;

    const sceneIndex = getCachedSceneIndex();
    if (!sceneIndex?.storyboarded?.length) {
      setSegmentedSceneIds(new Set());
      return;
    }
    const idSet = new Set(ids);
    const localSegmented = new Set<string>();
    for (const sid of sceneIndex.storyboarded) {
      if (idSet.has(sid)) localSegmented.add(sid);
    }
    setSegmentedSceneIds(localSegmented);
  }, [chapter?.scenes.map(s => s.id).join(","), clipsRefreshToken]);

  // DB-first: audio render status & staleness (segment_audio is DB-first)
  useEffect(() => {
    if (!chapter) return;
    const ids = chapter.scenes.map(s => s.id).filter(Boolean) as string[];
    if (ids.length === 0) return;
    (async () => {
      // Fetch segments from DB (segment_audio is DB-first, so we need segment IDs)
      const CHUNK = 500;
      let segData: { id: string; scene_id: string; speaker: string | null }[] = [];
      for (let i = 0; i < ids.length; i += CHUNK) {
        const slice = ids.slice(i, i + CHUNK);
        const { data } = await supabase
          .from("scene_segments")
          .select("id, scene_id, speaker")
          .in("scene_id", slice)
          .limit(5000);
        if (data?.length) segData.push(...data);
      }

      if (segData.length === 0) return;

      const segIds = segData.map(s => s.id);
      let audioData: { segment_id: string; voice_config: unknown }[] = [];
      for (let i = 0; i < segIds.length; i += CHUNK) {
        const slice = segIds.slice(i, i + CHUNK);
        const { data } = await supabase
          .from("segment_audio")
          .select("segment_id, voice_config")
          .in("segment_id", slice)
          .eq("status", "ready")
          .limit(5000);
        if (data?.length) audioData.push(...data);
      }

      // LOCAL-ONLY: character voice configs from OPFS via readCharacterIndex
      let charVoiceMap = new Map<string, Record<string, unknown>>();
      if (storage?.isReady) {
        try {
          const { readCharacterIndex } = await import("@/lib/localCharacters");
          const chars = await readCharacterIndex(storage);
          for (const c of chars) {
            const vc = (c.voice_config || {}) as Record<string, unknown>;
            charVoiceMap.set((c.name || "").toLowerCase(), vc);
            for (const a of (c.aliases || [])) {
              charVoiceMap.set(a.toLowerCase(), vc);
            }
          }
        } catch (err) {
          console.warn("[Studio] Failed to read local character index for staleness check:", err);
        }
      }

      if (audioData.length > 0) {
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
            const speaker = segToSpeaker.get(a.segment_id);
            if (speaker && charVoiceMap.size > 0) {
              const currentVc = charVoiceMap.get(speaker.toLowerCase());
              if (currentVc && currentVc.voice) {
                const savedVc = (a.voice_config || {}) as Record<string, unknown>;
                const keys = ["voice", "role", "speed", "pitchShift", "volume"];
                const changed = keys.some(k => {
                  const cur = currentVc[k];
                  const sav = savedVc[k];
                  const curStr = (cur !== undefined && cur !== null && cur !== "") ? String(cur) : "";
                  const savStr = (sav !== undefined && sav !== null && sav !== "") ? String(sav) : "";
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
  }, [chapter?.scenes.map(s => s.id).join(","), bookId, clipsRefreshToken, storage]);

  // LOCAL-FIRST: selected scene text always comes from OPFS, never from browser storage.
  // К3+К4: scene text comes ONLY from OPFS — no fallback to in-memory chapter or DB.
  useEffect(() => {
    let cancelled = false;
    setSceneContent(null);

    if (!selectedScene) return;

    (async () => {
      if (storage) {
        const localScene = await readSceneContentFromLocal(storage, {
          sceneId: selectedScene.id,
          chapterId: chapter?.chapterId,
          sceneNumber: selectedScene.scene_number,
          title: selectedScene.title,
        });

        if (!cancelled && localScene?.content) {
          setSceneContent(localScene.content);
        }
      }

      if (!selectedScene.id) return;

      const { data } = await supabase
        .from("book_scenes")
        .select("silence_sec")
        .eq("id", selectedScene.id)
        .maybeSingle();

      if (!cancelled && typeof data?.silence_sec === "number") {
        setSilenceSec(data.silence_sec);
      }
    })();

    return () => { cancelled = true; };
  }, [storage, chapter?.chapterId, selectedScene?.id, selectedScene?.scene_number, selectedScene?.title]);

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
    setClearedDirtySceneIds(prev => new Set(prev).add(sceneId));
    // Always refresh clips when segmentation/synthesis completes
    setClipsRefreshToken(t => t + 1);
  }, []);

  const { setPageHeader } = usePageHeader();

  const studioTitle = isRu ? 'АУДИО СТУДИЯ "ОК"' : 'AUDIO STUDIO "OK"';
  const studioSubtitle = chapter
    ? `${chapter.bookTitle} → ${chapter.chapterTitle}`
    : (isRu ? "Звукозапись ИИ-актеров. Монтаж. Сведение. Мастеринг." : "AI Voice Recording. Editing. Mixing. Mastering.");

  // Compute actual chapter duration (prefer playlist, fallback to estimate)
  const actualChapterDurationSec = useMemo(() => {
    if (!chapter) return null;
    let total = 0;
    for (const scene of chapter.scenes) {
      const actualMs = scene.id ? playlistDurations.get(scene.id) : undefined;
      if (actualMs && actualMs > 0) {
        total += actualMs / 1000;
      } else {
        total += estimateSceneDuration(scene).sec;
      }
    }
    return total > 0 ? total : null;
  }, [chapter, playlistDurations]);

  // Actual scene duration from playlist
  const actualSceneDurationMs = selectedScene?.id ? playlistDurations.get(selectedScene.id) : undefined;
  const actualSceneSec = actualSceneDurationMs && actualSceneDurationMs > 0 ? actualSceneDurationMs / 1000 : null;

  const headerRight = useMemo(() => (
    <div className="flex items-center gap-3 text-sm font-body">
      {chapterEstimate && chapterEstimate.chars > 0 && (
        <>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-4 w-4" />
            {actualChapterDurationSec ? (
              <span className="font-medium text-foreground">
                {formatDuration(Math.round(actualChapterDurationSec))}
              </span>
            ) : (
              <span className="font-medium text-muted-foreground italic flex items-center gap-0.5">
                <span className="text-xs">~</span>
                {chapterEstimate.formatted}
              </span>
            )}
            <span className="text-xs">
              ({chapterEstimate.chars.toLocaleString()} {isRu ? "сим." : "chars"})
            </span>
          </div>
          {sceneEstimate && sceneEstimate.chars > 0 && (
            <div className="text-xs text-muted-foreground border-l border-border pl-3">
              {isRu ? "Сцена" : "Scene"}:{" "}
              {actualSceneSec ? (
                <span className="font-medium text-foreground">
                  {formatDuration(Math.round(actualSceneSec))}
                </span>
              ) : (
                <span className="font-medium text-muted-foreground italic flex items-center gap-0.5">
                  <span className="text-xs">~</span>
                  {sceneEstimate.formatted}
                </span>
              )}
              <span className="ml-1">({sceneEstimate.chars.toLocaleString()} {isRu ? "сим." : "ch."})</span>
            </div>
          )}
        </>
      )}
      <SaveBookButton isRu={isRu} onClick={saveBook} loading={savingBook} disabled={!bookId} showDownloadZip={isProjectOpen} onDownloadZip={downloadZip} showImportZip={!isProjectOpen} onImportZip={importZip} />
      <AiRolesButton isRu={isRu} apiKeys={userApiKeys} bookTitle={chapter?.bookTitle} />
    </div>
  ), [isRu, chapterEstimate, sceneEstimate, actualChapterDurationSec, actualSceneSec, saveBook, savingBook, bookId, isProjectOpen, downloadZip, importZip, userApiKeys, chapter?.bookTitle]);

  useEffect(() => {
    setPageHeader({ title: studioTitle, subtitle: studioSubtitle, headerRight });
    return () => setPageHeader({});
  }, [studioTitle, studioSubtitle, headerRight, setPageHeader]);

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
                  clearedDirtySceneIds={clearedDirtySceneIds}
                  onBatchResynthDone={() => setClipsRefreshToken(t => t + 1)}
                  clipsRefreshToken={clipsRefreshToken}
                  bookId={bookId}
                  onPlaylistDurationsLoaded={handlePlaylistDurationsLoaded}
                  selectedSceneIndices={selectedSceneIndices}
                  onSelectedSceneIndicesChange={setSelectedSceneIndices}
                  onBatchAnalyze={handleBatchAnalyze}
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
                  selectedSceneNumber={selectedScene?.scene_number ?? null}
                  selectedSceneTitle={selectedScene?.title ?? null}
                  chapterId={chapter?.chapterId ?? null}
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
                onErrorSegmentsChange={setErrorSegmentIds}
                silenceSec={silenceSec}
                onSilenceSecChange={handleSilenceSecChange}
                onRecalcDone={() => setClipsRefreshToken(t => t + 1)}
                onVoiceSaved={() => setClipsRefreshToken(t => t + 1)}
                batchSceneIds={batchSceneIds}
                batchScenes={batchScenes}
                onBatchComplete={handleBatchComplete}
                onBatchClose={handleBatchClose}
                userApiKeys={userApiKeys}
                clipsRefreshToken={clipsRefreshToken}
              />
            </ResizablePanel>
          </ResizablePanelGroup>
        </div>

        <StudioTimeline
          isRu={isRu}
          sceneDurationSec={sceneEstimate?.sec}
          sceneId={selectedScene?.id ?? null}
          bookId={bookId}
          selectedCharacterId={selectedCharacterId}
          onSelectCharacter={setSelectedCharacterId}
          selectedSegmentId={selectedSegmentId}
          onSelectSegment={handleSelectSegmentFromTimeline}
          synthesizingSegmentIds={synthesizingSegmentIds}
          errorSegmentIds={errorSegmentIds}
          clipsRefreshToken={clipsRefreshToken}
          onSceneRendered={() => setClipsRefreshToken(t => t + 1)}
        />
      </div>
    </motion.div>
  );
};

export default Studio;
