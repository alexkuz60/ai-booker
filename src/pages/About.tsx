import { useEffect, useRef, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useLanguage } from "@/hooks/useLanguage";
import { Button } from "@/components/ui/button";
import { ChevronLeft, ChevronRight, Globe, Maximize2, Minimize2, Download } from "lucide-react";
import { pitchDeck, type PitchSlide } from "./about/pitchData";
import { cn } from "@/lib/utils";

/* ---------- design tokens (dark premium book theme) ---------- */
const palette = {
  bg: "#F2E8D5",          // warm cream (for text on dark)
  bgAlt: "#E8DCC4",
  ink: "#0E1628",         // deep midnight (main bg)
  inkSoft: "#C9B98F",     // muted gold-cream (soft text on dark)
  accent: "#C9A24A",      // gold (primary accent)
  accent2: "#8FA5B8",     // dusty blue (secondary)
  navy: "#1A2845",        // navy (gradient partner)
  gold: "#E5C46B",        // bright gold (highlights)
};

const fontDisplay = `'Playfair Display', Georgia, 'Times New Roman', serif`;
const fontBody = `'Inter', system-ui, sans-serif`;

/* ---------- slide layouts ---------- */
function SlideShell({
  children,
  kicker,
  variant = "light",
}: {
  children: React.ReactNode;
  kicker: string;
  variant?: "light" | "dark";
}) {
  const isDark = variant === "dark";
  return (
    <div
      className="relative w-full h-full overflow-hidden flex flex-col"
      style={{
        background: isDark
          ? `linear-gradient(135deg, ${palette.navy} 0%, ${palette.ink} 100%)`
          : `linear-gradient(135deg, ${palette.bg} 0%, ${palette.bgAlt} 100%)`,
        color: isDark ? palette.bg : palette.ink,
        fontFamily: fontBody,
      }}
    >
      {/* paper texture */}
      <div
        className="absolute inset-0 opacity-[0.07] pointer-events-none"
        style={{
          backgroundImage: `radial-gradient(circle at 20% 30%, ${palette.accent} 0%, transparent 40%), radial-gradient(circle at 80% 70%, ${palette.accent2} 0%, transparent 40%)`,
        }}
      />
      {/* decorative side bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-2"
        style={{ background: palette.accent }}
      />
      {/* kicker */}
      <div className="relative px-16 pt-10 pb-2 flex items-center gap-3">
        <div
          className="h-px flex-grow-0 w-12"
          style={{ background: palette.accent }}
        />
        <span
          className="text-[11px] font-bold tracking-[0.3em] uppercase"
          style={{ color: palette.accent }}
        >
          {kicker}
        </span>
      </div>
      <div className="relative flex-1 px-16 pb-16 pt-4 flex flex-col justify-center min-h-0">
        {children}
      </div>
      {/* footer mark */}
      <div
        className="absolute bottom-4 right-6 text-[10px] tracking-[0.25em] uppercase opacity-50"
        style={{ fontFamily: fontDisplay, color: isDark ? palette.bg : palette.inkSoft }}
      >
        AI Booker · {new Date().getFullYear()}
      </div>
    </div>
  );
}

function TitleLayout({ slide, isRu }: { slide: PitchSlide; isRu: boolean }) {
  return (
    <SlideShell kicker={isRu ? slide.kicker.ru : slide.kicker.en} variant="dark">
      <div className="max-w-4xl">
        <h1
          className="text-6xl md:text-7xl font-bold leading-[1.05] tracking-tight"
          style={{ fontFamily: fontDisplay, color: palette.bg }}
        >
          {isRu ? slide.title.ru : slide.title.en}
        </h1>
        {slide.subtitle && (
          <p
            className="mt-8 text-2xl italic"
            style={{ fontFamily: fontDisplay, color: palette.gold }}
          >
            «{isRu ? slide.subtitle.ru : slide.subtitle.en}»
          </p>
        )}
        {slide.body && (
          <p className="mt-12 text-sm tracking-[0.2em] uppercase opacity-70">
            {isRu ? slide.body.ru : slide.body.en}
          </p>
        )}
      </div>
    </SlideShell>
  );
}

function BulletsLayout({ slide, isRu }: { slide: PitchSlide; isRu: boolean }) {
  return (
    <SlideShell kicker={isRu ? slide.kicker.ru : slide.kicker.en}>
      <h2
        className="text-4xl md:text-5xl font-bold leading-tight mb-10 max-w-4xl"
        style={{ fontFamily: fontDisplay, color: palette.ink }}
      >
        {isRu ? slide.title.ru : slide.title.en}
      </h2>
      <ul className="space-y-5 max-w-5xl">
        {slide.bullets?.map((b, i) => (
          <motion.li
            key={i}
            initial={{ opacity: 0, x: -12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: i * 0.06 }}
            className="flex gap-5 items-start"
          >
            <span
              className="flex-shrink-0 mt-1.5 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold"
              style={{
                background: palette.accent,
                color: palette.bg,
                fontFamily: fontDisplay,
              }}
            >
              {i + 1}
            </span>
            <p
              className="text-lg md:text-xl leading-relaxed"
              style={{ color: palette.inkSoft }}
            >
              {isRu ? b.ru : b.en}
            </p>
          </motion.li>
        ))}
      </ul>
    </SlideShell>
  );
}

function StatsLayout({ slide, isRu }: { slide: PitchSlide; isRu: boolean }) {
  return (
    <SlideShell kicker={isRu ? slide.kicker.ru : slide.kicker.en}>
      <h2
        className="text-3xl md:text-4xl font-bold leading-tight mb-10 max-w-4xl"
        style={{ fontFamily: fontDisplay, color: palette.ink }}
      >
        {isRu ? slide.title.ru : slide.title.en}
      </h2>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-8">
        {slide.stats?.map((s, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.08 }}
            className="p-5 rounded-lg border"
            style={{
              borderColor: `${palette.accent}30`,
              background: `${palette.accent}08`,
            }}
          >
            <div
              className="text-4xl md:text-5xl font-bold mb-2"
              style={{ fontFamily: fontDisplay, color: palette.accent }}
            >
              {s.value}
            </div>
            <div
              className="text-sm font-semibold mb-1"
              style={{ color: palette.ink }}
            >
              {isRu ? s.label.ru : s.label.en}
            </div>
            {s.sub && (
              <div className="text-xs opacity-70" style={{ color: palette.inkSoft }}>
                {isRu ? s.sub.ru : s.sub.en}
              </div>
            )}
          </motion.div>
        ))}
      </div>
      {slide.body && (
        <p
          className="max-w-4xl text-base md:text-lg italic leading-relaxed border-l-2 pl-5"
          style={{
            borderColor: palette.accent,
            color: palette.inkSoft,
            fontFamily: fontDisplay,
          }}
        >
          {isRu ? slide.body.ru : slide.body.en}
        </p>
      )}
    </SlideShell>
  );
}

function AskLayout({ slide, isRu }: { slide: PitchSlide; isRu: boolean }) {
  return (
    <SlideShell kicker={isRu ? slide.kicker.ru : slide.kicker.en} variant="dark">
      <h2
        className="text-5xl md:text-6xl font-bold mb-10 max-w-4xl"
        style={{ fontFamily: fontDisplay, color: palette.bg }}
      >
        {isRu ? slide.title.ru : slide.title.en}
      </h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-5xl mb-10">
        {slide.bullets?.map((b, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: i * 0.08 }}
            className="p-5 rounded-lg"
            style={{
              background: `${palette.bg}10`,
              border: `1px solid ${palette.gold}40`,
            }}
          >
            <p className="text-lg leading-relaxed" style={{ color: palette.bg }}>
              {isRu ? b.ru : b.en}
            </p>
          </motion.div>
        ))}
      </div>
      {slide.quote && (
        <div className="text-center mt-4">
          <a
            href={`https://${isRu ? slide.quote.ru : slide.quote.en}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block text-2xl md:text-3xl font-bold tracking-wide hover:underline"
            style={{ fontFamily: fontDisplay, color: palette.gold }}
          >
            {isRu ? slide.quote.ru : slide.quote.en}
          </a>
        </div>
      )}
    </SlideShell>
  );
}

function renderSlide(slide: PitchSlide, isRu: boolean) {
  switch (slide.layout) {
    case "title":
      return <TitleLayout slide={slide} isRu={isRu} />;
    case "stats":
      return <StatsLayout slide={slide} isRu={isRu} />;
    case "ask":
      return <AskLayout slide={slide} isRu={isRu} />;
    case "bullets":
    default:
      return <BulletsLayout slide={slide} isRu={isRu} />;
  }
}

/* ---------- main page ---------- */
export default function About() {
  const { isRu, toggleLang } = useLanguage();
  const [index, setIndex] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const total = pitchDeck.length;
  const next = useCallback(() => setIndex((i) => Math.min(total - 1, i + 1)), [total]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  // Keyboard nav
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === " ") {
        e.preventDefault();
        next();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        prev();
      } else if (e.key === "Escape" && document.fullscreenElement) {
        document.exitFullscreen();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [next, prev]);

  // Fullscreen sync
  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", onChange);
    return () => document.removeEventListener("fullscreenchange", onChange);
  }, []);

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      containerRef.current?.requestFullscreen();
    } else {
      document.exitFullscreen();
    }
  };

  const slide = pitchDeck[index];

  return (
    <>
      {/* Load Playfair Display for elegant headings */}
      <link
        href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,400;0,700;1,400;1,700&display=swap"
        rel="stylesheet"
      />
      <div
        ref={containerRef}
        className="relative w-full h-full flex flex-col"
        style={{ background: palette.ink }}
      >
        {/* Top bar */}
        <div
          className="flex items-center justify-between px-4 py-2.5 border-b"
          style={{
            background: `${palette.ink}f5`,
            borderColor: `${palette.bg}15`,
            color: palette.bg,
          }}
        >
          <div className="flex items-center gap-3">
            <span
              className="text-sm tracking-[0.25em] uppercase font-semibold"
              style={{ fontFamily: fontDisplay, color: palette.gold }}
            >
              {isRu ? "О проекте" : "About"}
            </span>
            <span className="text-xs opacity-50">
              {index + 1} / {total}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleLang}
              className="text-xs gap-1.5 h-8"
              style={{ color: palette.bg }}
            >
              <Globe className="h-3.5 w-3.5" />
              {isRu ? "EN" : "RU"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-xs gap-1.5 h-8"
              style={{ color: palette.bg }}
            >
              <a href="/pitch/ai-booker-pitch-ru.pptx" download>
                <Download className="h-3.5 w-3.5" />
                .pptx RU
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="text-xs gap-1.5 h-8"
              style={{ color: palette.bg }}
            >
              <a href="/pitch/ai-booker-pitch-en.pptx" download>
                <Download className="h-3.5 w-3.5" />
                .pptx EN
              </a>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleFullscreen}
              className="h-8 w-8 p-0"
              style={{ color: palette.bg }}
            >
              {isFullscreen ? (
                <Minimize2 className="h-3.5 w-3.5" />
              ) : (
                <Maximize2 className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        </div>

        {/* Slide stage — 16:9 aspect, centered */}
        <div className="flex-1 flex items-center justify-center p-6 min-h-0">
          <div
            className="w-full max-w-[1280px] aspect-[16/9] rounded-xl overflow-hidden shadow-2xl relative"
            style={{ boxShadow: `0 30px 80px -20px rgba(0,0,0,0.6)` }}
          >
            <AnimatePresence mode="wait">
              <motion.div
                key={index}
                initial={{ opacity: 0, x: 30 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -30 }}
                transition={{ duration: 0.35, ease: "easeOut" }}
                className="absolute inset-0"
              >
                {renderSlide(slide, isRu)}
              </motion.div>
            </AnimatePresence>
          </div>
        </div>

        {/* Bottom controls */}
        <div className="flex items-center justify-between px-6 py-3 gap-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={prev}
            disabled={index === 0}
            className="gap-1.5"
            style={{ color: palette.bg }}
          >
            <ChevronLeft className="h-4 w-4" />
            {isRu ? "Назад" : "Prev"}
          </Button>

          {/* Dots */}
          <div className="flex gap-1.5">
            {pitchDeck.map((s, i) => (
              <button
                key={s.id}
                onClick={() => setIndex(i)}
                className={cn(
                  "h-1.5 rounded-full transition-all",
                  i === index ? "w-8" : "w-1.5 opacity-40 hover:opacity-70"
                )}
                style={{
                  background: i === index ? palette.accent : palette.bg,
                }}
                aria-label={`Slide ${i + 1}`}
              />
            ))}
          </div>

          <Button
            variant="ghost"
            size="sm"
            onClick={next}
            disabled={index === total - 1}
            className="gap-1.5"
            style={{ color: palette.bg }}
          >
            {isRu ? "Дальше" : "Next"}
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </>
  );
}
