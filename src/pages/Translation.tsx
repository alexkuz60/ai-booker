import { motion } from "framer-motion";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useEffect, useState, useMemo, useRef } from "react";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Languages, Radar, BookOpen, Plus, Loader2, FileText, Wand2, Square } from "lucide-react";
import { getScoreLevel, SCORE_COLORS } from "@/lib/qualityRadar";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import {
  checkTranslationReadiness,
  type TranslationReadiness,
} from "@/lib/translationProject";
import { TranslationChapterNav } from "@/components/translation/TranslationChapterNav";
import { BilingualSegmentsView, type SelectedSegmentData } from "@/components/translation/BilingualSegmentsView";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useSaveBookToProject } from "@/hooks/useSaveBookToProject";
import { SaveBookButton } from "@/components/SaveBookButton";
import { AiRolesButton } from "@/components/AiRolesButton";
import { useUserApiKeys } from "@/hooks/useUserApiKeys";
import { useAiRoles } from "@/hooks/useAiRoles";
import { useTranslationStorage } from "@/hooks/useTranslationStorage";
import { useSegmentTranslation } from "@/hooks/useSegmentTranslation";
import { useSegmentLiteraryEdit } from "@/hooks/useSegmentLiteraryEdit";
import { useSegmentCritique } from "@/hooks/useSegmentCritique";
import { useTranslationBatch } from "@/hooks/useTranslationBatch";
import { useTranslationActions } from "@/hooks/useTranslationActions";
import { paths } from "@/lib/projectPaths";
import type { TocChapter } from "@/pages/parser/types";
import type { AiRoleId } from "@/config/aiRoles";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { QualityMonitorPanel } from "@/components/translation/QualityMonitorPanel";
import { TranslationProgressPanel } from "@/components/translation/TranslationProgressPanel";

interface ChapterEntry {
  index: number;
  chapterId: string;
  title: string;
}

const TRANSLATION_ROLES: AiRoleId[] = ["art_translator", "literary_editor", "translation_critic"];

export default function Translation() {
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();
  const { storage, meta, isOpen, initialized } = useProjectStorageContext();
  const apiKeys = useUserApiKeys();
  const { getModelForRole, getEffectivePool } = useAiRoles(apiKeys);

  const bookId = meta?.bookId ?? null;
  const { saveBook, saving: savingBook, isProjectOpen, downloadZip, importZip } = useSaveBookToProject({
    isRu,
    currentBookId: bookId,
  });

  const [readiness, setReadiness] = useState<TranslationReadiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [monitorScore, setMonitorScore] = useState<number | null>(null);
  const [bilingualTick, setBilingualTick] = useState(0);

  // Panel size persistence
  const { value: panelSizes, update: setPanelSizes } = useCloudSettings<{
    main: number[];
    inner: number[];
  }>("translation-panel-sizes", { main: [70, 30], inner: [25, 75] });

  // Chapter navigation
  const [chapters, setChapters] = useState<ChapterEntry[]>([]);
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [selectedSegment, setSelectedSegment] = useState<SelectedSegmentData | null>(null);

  // Translation storage (mirror OPFS project)
  const { translationStorage, exists: transProjectExists, refresh: refreshTransStorage } =
    useTranslationStorage(storage, meta);

  // Compute source/target langs
  const sourceLang = meta?.language ?? "ru";
  const targetLang = sourceLang === "ru" ? "en" : "ru";

  const selectedChapter = chapters.find((c) => c.index === selectedChapterIdx) ?? null;

  // ── AI hooks ────────────────────────────────────────────
  const translationModel = getModelForRole("art_translator");
  const {
    translateSegments: doTranslateSegments,
    translating,
    progressLabel,
  } = useSegmentTranslation({
    sourceStorage: storage,
    translationStorage,
    model: translationModel,
    userApiKeys: apiKeys,
    sourceLang,
    targetLang,
    isRu,
  });

  const literaryModel = getModelForRole("literary_editor");
  const { editSegment, editing: literaryEditing } = useSegmentLiteraryEdit({
    translationStorage,
    model: literaryModel,
    userApiKeys: apiKeys,
    sourceLang,
    targetLang,
    isRu,
  });

  const critiqueModel = getModelForRole("translation_critic");
  const { critiqueSegment, critiquing: segCritiquing } = useSegmentCritique({
    translationStorage,
    model: critiqueModel,
    userApiKeys: apiKeys,
    sourceLang,
    targetLang,
    isRu,
  });

  const {
    translateSceneFull,
    translateChapterBatch,
    progress: batchProgress,
    abort: abortBatch,
  } = useTranslationBatch({
    sourceStorage: storage,
    translationStorage,
    userApiKeys: apiKeys,
    sourceLang,
    targetLang,
    isRu,
    getModelForRole,
    getEffectivePool,
    onSceneComplete: () => setBilingualTick(t => t + 1),
    onSegmentComplete: () => setBilingualTick(t => t + 1),
  });

  // ── Extracted actions ───────────────────────────────────
  const {
    creating,
    createProgress,
    handleTranslateSegments,
    handleLiteraryEdit,
    handleCritique,
    handleTranslateSceneFull,
    handleTranslateChapter,
    handleCreateTranslation,
  } = useTranslationActions({
    storage,
    meta,
    isRu,
    selectedSceneId,
    selectedChapter,
    readiness,
    selectedSegment,
    setSelectedSegment,
    setBilingualTick,
    doTranslateSegments,
    editSegment,
    critiqueSegment,
    translateSceneFull,
    translateChapterBatch,
    refreshTransStorage,
  });

  // ── Header ──────────────────────────────────────────────
  const headerRight = useMemo(() => {
    if (!isOpen || !meta) return undefined;
    return (
      <div className="flex items-center gap-2">
        <SaveBookButton
          isRu={isRu}
          onClick={saveBook}
          loading={savingBook}
          disabled={!bookId}
          showDownloadZip={isProjectOpen}
          onDownloadZip={downloadZip}
          showImportZip={!isProjectOpen}
          onImportZip={importZip}
        />
        <AiRolesButton
          isRu={isRu}
          apiKeys={apiKeys}
          bookTitle={meta?.title}
          roleFilter={TRANSLATION_ROLES}
        />
      </div>
    );
  }, [isOpen, meta, isRu, saveBook, savingBook, bookId, isProjectOpen, downloadZip, importZip, apiKeys]);

  const headerRightRef = useRef(headerRight);
  headerRightRef.current = headerRight;

  useEffect(() => {
    setPageHeader({
      title: isRu ? "Арт-перевод" : "Art Translation",
      headerRight: headerRightRef.current,
    });
    return () => setPageHeader({});
  }, [isRu, setPageHeader, headerRight]);

  // ── Load chapters ───────────────────────────────────────
  useEffect(() => {
    if (!storage || !isOpen) {
      setChapters([]);
      setSelectedChapterIdx(null);
      return;
    }
    let cancelled = false;

    (async () => {
      const tocData = await storage.readJSON<{ toc: TocChapter[] }>(paths.structureToc());
      const chaptersMapRaw = await storage.readJSON<Record<string, string>>(paths.structureChapters());
      if (cancelled || !tocData?.toc || !chaptersMapRaw) return;

      const entries: ChapterEntry[] = tocData.toc.map((ch, i) => ({
        index: i,
        chapterId: chaptersMapRaw[String(i)] ?? "",
        title: ch.title || `${isRu ? "Глава" : "Chapter"} ${i + 1}`,
      })).filter((e) => e.chapterId);

      setChapters(entries);
      if (entries.length > 0 && selectedChapterIdx == null) {
        setSelectedChapterIdx(entries[0].index);
      }
    })();

    return () => { cancelled = true; };
  }, [storage, isOpen, isRu]);

  // Check readiness
  useEffect(() => {
    if (!storage || !isOpen) {
      setReadiness(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    checkTranslationReadiness(storage).then((r) => {
      if (!cancelled) { setReadiness(r); setChecking(false); }
    }).catch(() => { if (!cancelled) setChecking(false); });
    return () => { cancelled = true; };
  }, [storage, isOpen]);

  // ── No project open ────────────────────────────────────
  if (!initialized) {
    return (
      <motion.div
        className="flex-1 flex flex-col h-full items-center justify-center gap-4 text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <Loader2 className="h-8 w-8 animate-spin opacity-40" />
        <p className="text-sm">
          {isRu ? "Загрузка проекта…" : "Loading project…"}
        </p>
      </motion.div>
    );
  }

  if (!isOpen || !meta) {
    return (
      <motion.div
        className="flex-1 flex flex-col h-full items-center justify-center gap-4 text-muted-foreground"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
      >
        <Languages className="h-16 w-16 opacity-20" />
        <p className="text-sm">
          {isRu
            ? "Откройте проект в Парсере, чтобы начать перевод"
            : "Open a project in Parser to start translation"}
        </p>
      </motion.div>
    );
  }

  // ── Main layout ────────────────────────────────────────
  return (
    <motion.div
      className="flex-1 flex flex-col h-full overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* Header bar */}
      <div className="border-b px-4 py-2 flex items-center gap-3 shrink-0 flex-wrap">
        <Select
          value={selectedChapterIdx != null ? String(selectedChapterIdx) : undefined}
          onValueChange={(v) => {
            setSelectedChapterIdx(Number(v));
            setSelectedSceneId(null);
            setSelectedSegment(null);
          }}
        >
          <SelectTrigger className="w-[280px] h-8 text-xs">
            <SelectValue placeholder={isRu ? "Выберите главу…" : "Select chapter…"} />
          </SelectTrigger>
          <SelectContent>
            {chapters.map((ch) => (
              <SelectItem key={ch.index} value={String(ch.index)} className="text-xs">
                {ch.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {transProjectExists && selectedChapter && (
          <Button
            size="sm"
            variant="secondary"
            onClick={handleTranslateChapter}
            disabled={translating || batchProgress.running}
            className="h-7 text-xs px-3 gap-1.5"
          >
            {batchProgress.running ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Languages className="h-3.5 w-3.5" />
            )}
            {isRu ? "Перевести главу" : "Translate chapter"}
          </Button>
        )}

        {readiness && (
          <div className="flex items-center gap-2 ml-auto text-xs text-muted-foreground">
            <span>{isRu ? "Сцен:" : "Scenes:"}</span>
            <Badge variant={readiness.totalReady === readiness.totalScenes ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
              {readiness.totalReady} / {readiness.totalScenes}
            </Badge>
            {checking && <Loader2 className="h-3 w-3 animate-spin" />}
            {transProjectExists && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 text-primary border-primary/30">
                {isRu ? "Проект перевода" : "Translation project"} ✓
              </Badge>
            )}
          </div>
        )}
      </div>

      <ResizablePanelGroup
        direction="horizontal"
        className="flex-1"
        onLayout={(sizes) => setPanelSizes((prev) => ({ ...prev, main: sizes }))}
      >
        {/* Left: Bilingual storyboard + scene nav */}
        <ResizablePanel defaultSize={panelSizes.main[0] ?? 70} minSize={40}>
          <ResizablePanelGroup
            direction="horizontal"
            onLayout={(sizes) => setPanelSizes((prev) => ({ ...prev, inner: sizes }))}
          >
            <ResizablePanel defaultSize={panelSizes.inner[0] ?? 25} minSize={12} maxSize={40}>
              <div className="h-full border-r bg-muted/30 flex flex-col">
                <div className="shrink-0 border-b px-3 py-1.5 flex items-center gap-1.5 bg-muted/50">
                  <FileText className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    {isRu ? "Сцены" : "Scenes"}
                  </span>
                </div>
                <div className="flex-1 min-h-0">
                  <TranslationChapterNav
                    storage={storage}
                    chapterId={selectedChapter?.chapterId ?? null}
                    chapterIndex={selectedChapterIdx}
                    selectedSceneId={selectedSceneId}
                    onSelectScene={(id) => { setSelectedSceneId(id); setSelectedSegment(null); }}
                    isRu={isRu}
                  />
                </div>
              </div>
            </ResizablePanel>

            <ResizableHandle withHandle />

            <ResizablePanel defaultSize={panelSizes.inner[1] ?? 75} minSize={40}>
              <div className="h-full flex flex-col">
                <div className="shrink-0 border-b px-3 py-1.5 flex items-center gap-1.5 bg-muted/50">
                  <Languages className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                    {isRu ? "Билингва" : "Bilingual"}
                  </span>
                  {transProjectExists && selectedSceneId && (
                    <div className="flex items-center gap-1.5 ml-auto">
                      {batchProgress.running && batchProgress.currentStage && (
                        <span className="text-[10px] text-muted-foreground tabular-nums">
                          {(() => {
                            const cs = batchProgress.currentStage;
                            const stageNum = cs.stage === "literal" ? 1 : cs.stage === "literary" ? 1 : cs.stage === "radar" ? 2 : cs.stage === "critique" ? 3 : 0;
                            if (cs.segmentIndex != null && cs.totalSegments && stageNum > 0) {
                              return `${stageNum}:${cs.segmentIndex + 1}/${cs.totalSegments}`;
                            }
                            return cs.message;
                          })()}
                        </span>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={handleTranslateSceneFull}
                        disabled={translating || batchProgress.running}
                        className="h-6 text-[10px] px-2 gap-1"
                      >
                        {batchProgress.running && batchProgress.scenesTotal === 1 ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wand2 className="h-3 w-3" />
                        )}
                        {isRu ? "Полный пайплайн" : "Full pipeline"}
                      </Button>
                      {batchProgress.running && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={abortBatch}
                          className="h-6 w-6 p-0 text-destructive hover:text-destructive"
                          title={isRu ? "Остановить" : "Stop"}
                        >
                          <Square className="h-3 w-3 fill-current" />
                        </Button>
                      )}
                    </div>
                  )}
                </div>
                {selectedSceneId ? (
                  <ScrollArea className="h-full">
                    <div className="p-3" key={`${selectedSceneId}-${bilingualTick}`}>
                      <BilingualSegmentsView
                        sourceStorage={storage}
                        translationStorage={translationStorage}
                        sceneId={selectedSceneId}
                        chapterId={selectedChapter?.chapterId ?? null}
                        isRu={isRu}
                        onTranslateSegments={transProjectExists ? handleTranslateSegments : undefined}
                        onLiteraryEdit={transProjectExists ? handleLiteraryEdit : undefined}
                        onCritique={transProjectExists ? handleCritique : undefined}
                        translating={translating || batchProgress.running}
                        progressLabel={progressLabel}
                        selectedSegmentId={selectedSegment?.segmentId ?? null}
                        onSelectSegment={setSelectedSegment}
                      />
                    </div>
                  </ScrollArea>
                ) : (
                  <div className="h-full flex flex-col items-center justify-center gap-3 text-muted-foreground">
                    <BookOpen className="h-10 w-10 opacity-20" />
                    <p className="text-xs">
                      {isRu ? "Выберите сцену для просмотра" : "Select a scene to view"}
                    </p>
                  </div>
                )}
              </div>
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: Quality monitoring */}
        <ResizablePanel defaultSize={panelSizes.main[1] ?? 30} minSize={20}>
          <div className="h-full flex flex-col">
            <div className="shrink-0 border-b px-3 py-1.5 flex items-center gap-1.5 bg-muted/50">
              <Radar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
                {isRu ? "Мониторинг" : "Monitor"}
              </span>
              {monitorScore != null && (
                <span
                  className="ml-auto text-lg font-bold tabular-nums"
                  style={{ color: SCORE_COLORS[getScoreLevel(monitorScore)] }}
                >
                  {Math.round(monitorScore * 100)}
                  <span className="text-xs font-normal text-muted-foreground"> / 100</span>
                </span>
              )}
            </div>
            <ScrollArea className="flex-1 min-h-0">
              <div className="p-3 space-y-3">
                {(batchProgress.running || batchProgress.scenesTotal > 0) && (
                  <TranslationProgressPanel
                    progress={batchProgress}
                    onAbort={abortBatch}
                    isRu={isRu}
                  />
                )}
                <QualityMonitorPanel
                  storage={translationStorage}
                  sceneId={selectedSceneId}
                  chapterId={selectedChapter?.chapterId ?? null}
                  isRu={isRu}
                  selectedSegment={selectedSegment}
                  sourceLang={(sourceLang as "ru" | "en")}
                  targetLang={(targetLang as "ru" | "en")}
                  userApiKeys={apiKeys}
                  onScoreChange={setMonitorScore}
                />
              </div>
            </ScrollArea>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </motion.div>
  );
}
