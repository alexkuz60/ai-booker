import { motion } from "framer-motion";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useEffect, useState, useCallback } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Languages, Radar, BookOpen, Plus, CheckCircle2, AlertCircle, Loader2 } from "lucide-react";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  checkTranslationReadiness,
  createTranslationProject,
  type TranslationReadiness,
} from "@/lib/translationProject";

export default function Translation() {
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();
  const { storage, meta, isOpen } = useProjectStorageContext();

  const [readiness, setReadiness] = useState<TranslationReadiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    setPageHeader({ title: isRu ? "Арт-перевод" : "Art Translation" });
  }, [isRu, setPageHeader]);

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
      // Determine target language (flip source)
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
      <ResizablePanelGroup direction="horizontal" className="flex-1">
        {/* Left: Source storyboard + navigator */}
        <ResizablePanel defaultSize={50} minSize={30}>
          <div className="h-full flex flex-col">
            {/* Readiness header */}
            <div className="border-b px-4 py-3 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold text-foreground">
                  {isRu ? "Готовность к переводу" : "Translation Readiness"}
                </h2>
                {checking && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              </div>

              {readiness && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>
                      {isRu ? "Сцен размечено:" : "Scenes storyboarded:"}
                    </span>
                    <Badge variant={readiness.totalReady === readiness.totalScenes ? "default" : "secondary"}>
                      {readiness.totalReady} / {readiness.totalScenes}
                    </Badge>
                  </div>

                  {readiness.readyChapters.size > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" />
                        {isRu
                          ? `Глав готово: ${readiness.readyChapters.size}`
                          : `Chapters ready: ${readiness.readyChapters.size}`}
                      </p>
                    </div>
                  )}

                  {readiness.notReadyChapters.size > 0 && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-amber-600 dark:text-amber-400 flex items-center gap-1">
                        <AlertCircle className="h-3 w-3" />
                        {isRu
                          ? `Глав не готово: ${readiness.notReadyChapters.size} (нужна раскадровка в Студии)`
                          : `Chapters not ready: ${readiness.notReadyChapters.size} (need storyboarding in Studio)`}
                      </p>
                    </div>
                  )}

                  <Button
                    size="sm"
                    onClick={handleCreateTranslation}
                    disabled={creating || readiness.readyChapters.size === 0}
                    className="w-full mt-2"
                  >
                    {creating ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <Plus className="h-4 w-4 mr-2" />
                    )}
                    {isRu
                      ? `Создать проект перевода (${meta.language === "ru" ? "→ EN" : "→ RU"})`
                      : `Create translation project (${meta.language === "ru" ? "→ EN" : "→ RU"})`}
                  </Button>
                </div>
              )}
            </div>

            {/* Storyboard placeholder */}
            <div className="flex-1 flex flex-col items-center justify-center gap-4 p-8 text-muted-foreground">
              <BookOpen className="h-12 w-12 opacity-30" />
              <h2 className="text-lg font-semibold text-foreground/70">
                {isRu ? "Раскадровка оригинала" : "Source Storyboard"}
              </h2>
              <p className="text-sm text-center max-w-md">
                {isRu
                  ? "Навигатор глав и сегментированный текст оригинала. Билингвальный просмотр оригинал/перевод."
                  : "Chapter navigator and segmented source text. Bilingual original/translation view."}
              </p>
              <div className="mt-4 px-4 py-2 rounded-md border border-dashed border-muted-foreground/30 text-xs">
                {isRu ? "Фаза 1 — каркас" : "Phase 1 — scaffold"}
              </div>
            </div>
          </div>
        </ResizablePanel>

        <ResizableHandle withHandle />

        {/* Right: Quality monitoring */}
        <ResizablePanel defaultSize={50} minSize={30}>
          <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-muted-foreground">
            <Radar className="h-12 w-12 opacity-30" />
            <h2 className="text-lg font-semibold text-foreground/70">
              {isRu ? "Мониторинг качества" : "Quality Monitor"}
            </h2>
            <p className="text-sm text-center max-w-md">
              {isRu
                ? "Многовекторный радар качества перевода, выбор синонимов, критическая оценка и варианты перевода."
                : "Multi-vector translation quality radar, synonym selection, critical assessment and translation variants."}
            </p>
            <ul className="mt-4 text-xs space-y-1 text-left">
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {isRu ? "Семантика" : "Semantics"}
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {isRu ? "Сентимент" : "Sentiment"}
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {isRu ? "Ритмика" : "Rhythm"}
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {isRu ? "Фонетика" : "Phonetics"}
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                {isRu ? "Культурный код" : "Cultural code"}
              </li>
            </ul>
            <div className="mt-4 px-4 py-2 rounded-md border border-dashed border-muted-foreground/30 text-xs">
              {isRu ? "Фаза 2 — Quality Radar" : "Phase 2 — Quality Radar"}
            </div>
          </div>
        </ResizablePanel>
      </ResizablePanelGroup>
    </motion.div>
  );
}
