import { motion } from "framer-motion";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useEffect, useState, useCallback } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Languages, Radar, BookOpen, ChevronDown } from "lucide-react";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { toast } from "sonner";
import {
  checkTranslationReadiness,
  createTranslationProject,
  type TranslationReadiness,
} from "@/lib/translationProject";
import { TranslationReadinessPanel } from "@/components/translation/TranslationReadinessPanel";
import { TranslationChapterNav } from "@/components/translation/TranslationChapterNav";
import { paths } from "@/lib/projectPaths";
import type { TocChapter } from "@/pages/parser/types";
import type { SceneIndexData } from "@/lib/sceneIndex";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

interface ChapterEntry {
  index: number;
  chapterId: string;
  title: string;
}

export default function Translation() {
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();
  const { storage, meta, isOpen } = useProjectStorageContext();

  const [readiness, setReadiness] = useState<TranslationReadiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);

  // Chapter navigation
  const [chapters, setChapters] = useState<ChapterEntry[]>([]);
  const [selectedChapterIdx, setSelectedChapterIdx] = useState<number | null>(null);
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);

  useEffect(() => {
    setPageHeader({ title: isRu ? "Арт-перевод" : "Art Translation" });
  }, [isRu, setPageHeader]);

  // Load chapters list
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

  // Check readiness when project is open
  useEffect(() => {
    if (!storage || !isOpen) {
      setReadiness(null);
      return;
    }
    let cancelled = false;
    setChecking(true);
    checkTranslationReadiness(storage).then((r) => {
      if (!cancelled) {
        setReadiness(r);
        setChecking(false);
      }
    }).catch(() => {
      if (!cancelled) setChecking(false);
    });
    return () => { cancelled = true; };
  }, [storage, isOpen]);

  const handleCreateTranslation = useCallback(async () => {
    if (!storage || !meta || !readiness) return;
    const readyIndices = Array.from(readiness.readyChapters.keys());
    if (readyIndices.length === 0) {
      toast.error(isRu
        ? "Нет глав, готовых к переводу. Выполните раскадровку в Студии."
        : "No chapters ready for translation. Complete storyboarding in Studio.");
      return;
    }

    setCreating(true);
    try {
      const targetLang = meta.language === "ru" ? "en" : "ru";
      const translationStore = await createTranslationProject({
        sourceStorage: storage,
        sourceMeta: meta,
        targetLanguage: targetLang as "en" | "ru",
        chapterIndices: readyIndices,
      });

      toast.success(
        isRu
          ? `Проект перевода "${translationStore.projectName}" создан (${readyIndices.length} глав)`
          : `Translation project "${translationStore.projectName}" created (${readyIndices.length} chapters)`,
      );
    } catch (err) {
      console.error("[Translation] create error:", err);
      toast.error(isRu ? "Ошибка создания проекта перевода" : "Failed to create translation project");
    } finally {
      setCreating(false);
    }
  }, [storage, meta, readiness, isRu]);

  const selectedChapter = chapters.find((c) => c.index === selectedChapterIdx) ?? null;

  // ── No project open ────────────────────────────────────
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

  return (
    <motion.div
      className="flex-1 flex flex-col h-full overflow-hidden"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.3 }}
    >
      {/* ── Header: chapter selector + readiness summary ── */}
      <div className="border-b px-4 py-2 flex items-center gap-3 shrink-0">
        <Select
          value={selectedChapterIdx != null ? String(selectedChapterIdx) : undefined}
          onValueChange={(v) => {
            setSelectedChapterIdx(Number(v));
            setSelectedSceneId(null);
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

        {readiness && (
          <span className="text-xs text-muted-foreground ml-auto whitespace-nowrap">
            {isRu ? "Готово:" : "Ready:"}{" "}
            {readiness.readyChapters.size}/{chapters.length}{" "}
            {isRu ? "глав" : "ch."}
          </span>
        )}
      </div>

      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left: Bilingual storyboard + scene nav (70%) */}
        <ResizablePanel defaultSize={70} minSize={40}>
          <div className="h-full flex overflow-hidden">
              {/* Scene navigator sidebar */}
              <div className="w-48 shrink-0 border-r bg-muted/30">
                <TranslationChapterNav
                  storage={storage}
                  chapterId={selectedChapter?.chapterId ?? null}
                  chapterIndex={selectedChapterIdx}
                  selectedSceneId={selectedSceneId}
                  onSelectScene={setSelectedSceneId}
                  isRu={isRu}
                />
              </div>

              {/* Bilingual storyboard area */}
              <div className="flex-1 overflow-hidden">
                {selectedSceneId ? (
                  <ScrollArea className="h-full">
                    <div className="p-4 space-y-3">
                      {/* Bilingual accordion placeholder */}
                      <Accordion type="multiple" defaultValue={["translation"]}>
                        <AccordionItem value="original">
                          <AccordionTrigger className="text-xs font-medium py-2">
                            {isRu ? "🇷🇺 Оригинал" : "🇷🇺 Original"}
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="text-xs text-muted-foreground italic p-3 rounded-md bg-muted/30 border border-dashed border-muted-foreground/20">
                              {isRu
                                ? "Сегменты оригинала (read-only) будут отображаться здесь"
                                : "Original segments (read-only) will be displayed here"}
                            </div>
                          </AccordionContent>
                        </AccordionItem>

                        <AccordionItem value="translation">
                          <AccordionTrigger className="text-xs font-medium py-2">
                            {meta.language === "ru" ? "🇬🇧 Translation" : "🇷🇺 Перевод"}
                          </AccordionTrigger>
                          <AccordionContent>
                            <div className="text-xs text-muted-foreground italic p-3 rounded-md bg-muted/30 border border-dashed border-muted-foreground/20">
                              {isRu
                                ? "Редактируемые сегменты перевода будут отображаться здесь"
                                : "Editable translation segments will be displayed here"}
                            </div>
                          </AccordionContent>
                        </AccordionItem>
                      </Accordion>
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
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: Readiness + Quality monitoring (30%) */}
        <ResizablePanel defaultSize={30} minSize={20}>
          <div className="h-full flex flex-col">
            {/* Readiness panel */}
            <TranslationReadinessPanel
              readiness={readiness}
              checking={checking}
              creating={creating}
              meta={meta}
              isRu={isRu}
              onCreateTranslation={handleCreateTranslation}
            />

            {/* Quality monitor placeholder */}
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-6 text-muted-foreground">
              <Radar className="h-10 w-10 opacity-30" />
              <h2 className="text-sm font-semibold text-foreground/70">
                {isRu ? "Мониторинг качества" : "Quality Monitor"}
              </h2>
              <ul className="text-xs space-y-1 text-left">
                {[
                  isRu ? "Семантика" : "Semantics",
                  isRu ? "Сентимент" : "Sentiment",
                  isRu ? "Ритмика" : "Rhythm",
                  isRu ? "Фонетика" : "Phonetics",
                  isRu ? "Культурный код" : "Cultural code",
                ].map((label) => (
                  <li key={label} className="flex items-center gap-2">
                    <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                    {label}
                  </li>
                ))}
              </ul>
              <div className="mt-2 px-3 py-1.5 rounded-md border border-dashed border-muted-foreground/30 text-xs">
                {isRu ? "Фаза 2 — Quality Radar" : "Phase 2 — Quality Radar"}
              </div>
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </motion.div>
  );
}
