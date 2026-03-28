import { motion } from "framer-motion";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { useEffect } from "react";
import {
  ResizablePanelGroup,
  ResizablePanel,
  ResizableHandle,
} from "@/components/ui/resizable";
import { Languages, Radar, BookOpen } from "lucide-react";

export default function Translation() {
  const { isRu } = useLanguage();
  const { setHeader } = usePageHeader();

  useEffect(() => {
    setHeader(isRu ? "Арт-перевод" : "Art Translation");
  }, [isRu, setHeader]);

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
          <div className="h-full flex flex-col items-center justify-center gap-4 p-8 text-muted-foreground">
            <BookOpen className="h-12 w-12 opacity-30" />
            <h2 className="text-lg font-semibold text-foreground/70">
              {isRu ? "Раскадровка оригинала" : "Source Storyboard"}
            </h2>
            <p className="text-sm text-center max-w-md">
              {isRu
                ? "Навигатор глав и сегментированный текст оригинала с эмоциональной разметкой. Билингвальный просмотр оригинал/перевод."
                : "Chapter navigator and segmented source text with emotional markup. Bilingual original/translation view."}
            </p>
            <div className="mt-4 px-4 py-2 rounded-md border border-dashed border-muted-foreground/30 text-xs">
              {isRu ? "Фаза 1 — каркас" : "Phase 1 — scaffold"}
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
