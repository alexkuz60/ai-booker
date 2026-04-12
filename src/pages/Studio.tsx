import { motion } from "framer-motion";
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

import { readSceneContentFromLocal } from "@/lib/localSceneContent";
import { getCachedSceneIndex } from "@/lib/sceneIndex";
import { BackgroundAnalysisProvider } from "@/hooks/useBackgroundAnalysis";
import { useAiRoles } from "@/hooks/useAiRoles";
import { AudioZipControls } from "@/components/studio/AudioZipControls";

function toStudioScenePointers(
  scenes: Array<{
    id?: string;
    scene_number: number;
    title: string;
    scene_type?: string | null;
    mood?: string | null;
    bpm?: number | null;
    char_count?: number;
    content?: string;
  }>,
) {
  return scenes.map((scene) => ({
    id: scene.id,
    scene_number: scene.scene_number,
    title: scene.title,
    scene_type: scene.scene_type || "mixed",
    mood: scene.mood || "",
    bpm: scene.bpm || 120,
    char_count: scene.char_count ?? scene.content?.length,
  }));
}

function getStudioScenePointerSignature(
  scenes: Array<{
    id?: string;
    scene_number: number;
    title: string;
    scene_type?: string | null;
    mood?: string | null;
    bpm?: number | null;
  }>,
) {
  return scenes
    .map((scene) => `${scene.id ?? ""}:${scene.scene_number}:${scene.title}:${scene.scene_type ?? ""}:${scene.mood ?? ""}:${scene.bpm ?? ""}`)
    .join("|");
}

const Studio = () => {
  const { isRu } = useLanguage();
  const { user } = useAuth();
  const userApiKeys = useUserApiKeys();
  const { loaded: aiReady, getModelForRole, getModelForBatch, getEffectivePool, isPoolEnabled } = useAiRoles(userApiKeys);
  const {
    chapter, setChapter,
    selectedSceneIdx, setSelectedSceneIdx,
    activeTab, setActiveTab,
    restored,
  } = useStudioSession();

  const [sceneContent, setSceneContent] = useState<string | null>(null);
  const [selectedSegmentId, setSelectedSegmentId] = useState<string | null>(null);
  const [checkedSegmentIds, setCheckedSegmentIds] = useState<Set<string>>(new Set());
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

  const selectedScene = chapter && selectedSceneIdx !== null ? chapter.scenes[selectedSceneIdx] : null;
  const chapterScenePointerSignature = useMemo(
    () => getStudioScenePointerSignature(chapter?.scenes ?? []),
    [chapter?.scenes],
  );
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

  // LOCAL-ONLY: reconcile chapter pointer against canonical OPFS structure.
  // DNI-7: scene IDs are unstable and must be revised immediately after TOC edits.
  useEffect(() => {
    if (!chapter || !storage) return;

    let cancelled = false;
    const sourceChapterId = chapter.chapterId;
    const sourceChapterTitle = chapter.chapterTitle;
    const sourceSignature = chapterScenePointerSignature;

    (async () => {
      try {
        const local = await readStructureFromLocal(storage);
        if (cancelled || !local?.structure) return;

        if (local.structure.bookId && local.structure.bookId !== bookId) {
          setBookId(local.structure.bookId);
        }

        let chapterIndex: number | null = null;
        for (const [idx, id] of local.chapterIdMap.entries()) {
          if (id === sourceChapterId) {
            chapterIndex = idx;
            break;
          }
        }
        if (chapterIndex === null && sourceChapterTitle) {
          chapterIndex = local.structure.toc.findIndex(
            (entry, idx) => entry.title === sourceChapterTitle && local.chapterResults.has(idx),
          );
        }
        if (chapterIndex === null || chapterIndex < 0) return;

        const result = local.chapterResults.get(chapterIndex);
        const resolvedChapterId = local.chapterIdMap.get(chapterIndex);
        const tocEntry = local.structure.toc[chapterIndex];
        if (!result || !resolvedChapterId || !tocEntry) return;

        const canonicalChapter = {
          chapterId: resolvedChapterId,
          chapterTitle: tocEntry.title,
          bookTitle: local.structure.title || chapter.bookTitle,
          bookId: local.structure.bookId || chapter.bookId,
          scenes: toStudioScenePointers(result.scenes),
        };
        const canonicalSignature = getStudioScenePointerSignature(canonicalChapter.scenes);

        if (!cancelled) {
          setChapter((prev) => {
            if (!prev) return prev;
            const sameBranch =
              (sourceChapterId && prev.chapterId === sourceChapterId) ||
              (!sourceChapterId && prev.chapterTitle === sourceChapterTitle);
            if (!sameBranch) return prev;
            if (getStudioScenePointerSignature(prev.scenes) !== sourceSignature) return prev;

            const alreadyCanonical =
              prev.chapterId === canonicalChapter.chapterId &&
              prev.chapterTitle === canonicalChapter.chapterTitle &&
              prev.bookTitle === canonicalChapter.bookTitle &&
              (prev.bookId ?? null) === (canonicalChapter.bookId ?? null) &&
              getStudioScenePointerSignature(prev.scenes) === canonicalSignature;

            return alreadyCanonical ? prev : canonicalChapter;
          });
        }
      } catch (err) {
        console.warn("[Studio] Failed to resolve IDs from OPFS:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [storage, chapter?.chapterId, chapter?.chapterTitle, chapter?.bookTitle, chapter?.bookId, chapterScenePointerSignature, bookId, setChapter]);

  useEffect(() => {
    if (!chapter) return;
    if (selectedSceneIdx === null) return;
    if (selectedSceneIdx >= 0 && selectedSceneIdx < chapter.scenes.length) return;
    setSelectedSceneIdx(chapter.scenes.length > 0 ? 0 : null);
  }, [chapter?.scenes.length, selectedSceneIdx, setSelectedSceneIdx]);

  // Hydrate chapter scene content from OPFS using robust scene lookup.
  // This avoids relying on sessionStorage snapshots or a single chapter file path.
  useEffect(() => {
    if (!storage || !chapter?.scenes?.length) return;

    let cancelled = false;
    const sourceChapterId = chapter.chapterId;
    const sourceSignature = chapterScenePointerSignature;

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
        if (!prev || prev.chapterId !== sourceChapterId) return prev;
        if (getStudioScenePointerSignature(prev.scenes) !== sourceSignature) return prev;

        let changed = false;
        const scenes = prev.scenes.map((scene, index) => {
          const localScene = resolvedScenes[index];
          const localContent = localScene?.content;

          if (localContent === undefined || localContent === scene.content) {
            // Even if content hasn't changed, ensure char_count is set
            if (!scene.char_count && localContent) {
              changed = true;
              return { ...scene, char_count: localContent.length };
            }
            return scene;
          }

          changed = true;
          return { ...scene, content: localContent, char_count: localContent.length };
        });

        return changed ? { ...prev, scenes } : prev;
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [storage, chapter?.chapterId, chapterScenePointerSignature, setChapter]);

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

  // LOCAL-ONLY: audio render status & staleness from OPFS audio_meta.json (K3)
  useEffect(() => {
    if (!chapter || !storage) return;
    const ids = chapter.scenes.map(s => s.id).filter(Boolean) as string[];
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const { readAudioMeta } = await import("@/lib/localAudioMeta");
      const { readStoryboardFromLocal } = await import("@/lib/storyboardSync");
      const { readCharacterIndex } = await import("@/lib/localCharacters");

      // Build character voice map (K4: OPFS only)
      const charVoiceMap = new Map<string, Record<string, unknown>>();
      try {
        const chars = await readCharacterIndex(storage);
        for (const c of chars) {
          const vc = (c.voice_config || {}) as Record<string, unknown>;
          charVoiceMap.set((c.name || "").toLowerCase(), vc);
          for (const a of (c.aliases || [])) {
            if (a) charVoiceMap.set(a.toLowerCase(), vc);
          }
        }
      } catch {}

      const rendered = new Set<string>();
      const stale = new Set<string>();
      const fully = new Set<string>();

      for (const sceneId of ids) {
        const meta = await readAudioMeta(storage, sceneId);
        if (!meta) continue;

        const entries = Object.values(meta.entries);
        const readyEntries = entries.filter(e => e.status === "ready");
        if (readyEntries.length === 0) continue;

        rendered.add(sceneId);

        // Check if all segments have audio
        const storyboard = await readStoryboardFromLocal(storage, sceneId);
        const totalSegments = storyboard?.segments?.length ?? 0;
        if (totalSegments > 0 && readyEntries.length >= totalSegments) {
          fully.add(sceneId);
        }

        // Check staleness: compare voice_config in audio_meta vs current character config
        if (charVoiceMap.size > 0 && storyboard?.segments) {
          const speakerMap = new Map(storyboard.segments.map(s => [s.segment_id, s.speaker]));
          for (const entry of readyEntries) {
            const speaker = speakerMap.get(entry.segmentId);
            if (!speaker) continue;
            const currentVc = charVoiceMap.get(speaker.toLowerCase());
            if (!currentVc || !currentVc.voice) continue;
            const savedVc = (entry.voiceConfig || {}) as Record<string, unknown>;
            const keys = ["voice", "role", "speed", "pitchShift", "volume"];
            const changed = keys.some(k => {
              const cur = currentVc[k];
              const sav = savedVc[k];
              const curStr = (cur !== undefined && cur !== null && cur !== "") ? String(cur) : "";
              const savStr = (sav !== undefined && sav !== null && sav !== "") ? String(sav) : "";
              if (k === "speed" || k === "pitchShift" || k === "volume") {
                return Math.abs((curStr ? Number(curStr) : -999) - (savStr ? Number(savStr) : -999)) > 0.01;
              }
              return curStr !== savStr;
            });
            if (changed) { stale.add(sceneId); break; }
          }
        }
      }

      if (!cancelled) {
        setRenderedSceneIds(rendered);
        setStaleAudioSceneIds(stale);
        setFullyRenderedSceneIds(fully);
      }
    })();
    return () => { cancelled = true; };
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
          console.info(`[Studio] 📖 Loaded content for sceneId=${selectedScene.id} sceneNum=${selectedScene.scene_number} len=${localScene.content.length} first80="${localScene.content.slice(0, 80).replace(/\n/g, "↵")}"`);
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
      // Recalc positions in audio_meta.json with new silence
      if (storage) {
        const { recalcPositions } = await import("@/lib/localAudioMeta");
        await recalcPositions(storage, selectedScene.id, undefined, sec);
      }
      setClipsRefreshToken(t => t + 1); // Refresh timeline
    }
  }, [selectedScene?.id, storage]);

  const onSegmented = useCallback((sceneId: string) => {
    setSegmentedSceneIds(prev => new Set(prev).add(sceneId));
    setClearedDirtySceneIds(prev => new Set(prev).add(sceneId));
    // Always refresh clips when segmentation/synthesis completes
    setClipsRefreshToken(t => t + 1);
    // Auto-set pipeline flag
    if (storage) {
      import("@/hooks/usePipelineProgress").then(({ writePipelineStep }) =>
        writePipelineStep(storage, "synthesis_done", true).catch(() => {}),
      );
    }
  }, [storage]);

  // ── Chapter switching from navigator ──────────────────────
  const handleChapterChange = useCallback(async (chapterId: string) => {
    if (!storage) return;
    const local = await readStructureFromLocal(storage);
    if (!local?.structure) return;

    let chapterIndex: number | null = null;
    for (const [idx, id] of local.chapterIdMap.entries()) {
      if (id === chapterId) { chapterIndex = idx; break; }
    }
    if (chapterIndex === null) return;

    const result = local.chapterResults.get(chapterIndex);
    const tocEntry = local.structure.toc[chapterIndex];
    if (!result || !tocEntry) return;

    const newChapter: StudioChapter = {
      chapterId,
      chapterTitle: tocEntry.title,
      bookTitle: local.structure.title || chapter?.bookTitle || "",
      bookId: local.structure.bookId || chapter?.bookId,
      scenes: result.scenes.map((scene) => ({
        id: scene.id,
        scene_number: scene.scene_number,
        title: scene.title,
        scene_type: scene.scene_type || "mixed",
        mood: scene.mood || "",
        bpm: scene.bpm || 120,
      })),
    };
    setChapter(newChapter);
    setSelectedSceneIdx(newChapter.scenes.length > 0 ? 0 : null);
    setSelectedSceneIndices(new Set());
    setClipsRefreshToken(t => t + 1);
  }, [storage, chapter?.bookTitle, chapter?.bookId, setChapter, setSelectedSceneIdx]);

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
      <AudioZipControls storage={storage} projectName={storage?.projectName} isRu={isRu} />
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
    <BackgroundAnalysisProvider
      storage={storage}
      aiReady={aiReady}
      getModelForRole={getModelForBatch}
      getEffectivePool={getEffectivePool}
      isPoolEnabled={isPoolEnabled}
      userApiKeys={userApiKeys}
      isRu={isRu}
      onSceneSegmented={onSegmented}
    >
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
                    onChapterChange={handleChapterChange}
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
                  checkedSegmentIds={checkedSegmentIds}
                  onCheckedSegmentIdsChange={setCheckedSegmentIds}
                  onSynthesizingChange={setSynthesizingSegmentIds}
                  onErrorSegmentsChange={setErrorSegmentIds}
                  silenceSec={silenceSec}
                  onSilenceSecChange={handleSilenceSecChange}
                  onRecalcDone={() => setClipsRefreshToken(t => t + 1)}
                  onVoiceSaved={() => setClipsRefreshToken(t => t + 1)}
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
            checkedSegmentIds={checkedSegmentIds}
            onCheckedSegmentIdsChange={setCheckedSegmentIds}
            synthesizingSegmentIds={synthesizingSegmentIds}
            errorSegmentIds={errorSegmentIds}
            clipsRefreshToken={clipsRefreshToken}
            onSceneRendered={() => setClipsRefreshToken(t => t + 1)}
          />
        </div>
      </motion.div>
    </BackgroundAnalysisProvider>
  );
};

export default Studio;
