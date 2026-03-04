import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FileText, BookOpen, ChevronDown, ChevronRight, Loader2,
  AlertCircle, CheckCircle2, Zap, Layers, PlayCircle, FolderOpen
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import {
  extractOutline, extractTextByPageRange, extractTextFromPdf,
  flattenTocWithRanges, type TocEntry
} from "@/lib/pdf-extract";

// ─── Types ───────────────────────────────────────────────────

interface Scene {
  scene_number: number;
  title: string;
  content_preview?: string;
  scene_type: string;
  mood: string;
  bpm: number;
}

interface Chapter {
  chapter_number: number;
  title: string;
  scenes: Scene[];
}

interface Part {
  part_number: number;
  title: string;
  chapters: Chapter[];
}

interface BookStructure {
  book_title: string;
  parts?: Part[];
  chapters?: Chapter[];
}

type SectionType = "content" | "preface" | "afterword" | "endnotes" | "appendix";

interface TocChapter {
  title: string;
  startPage: number;
  endPage: number;
  level: number;
  partTitle?: string;
  sectionType: SectionType;
}

// ─── Classification ──────────────────────────────────────────

const SECTION_PATTERNS: { type: SectionType; patterns: RegExp[] }[] = [
  {
    type: "preface",
    patterns: [
      /предисловие/i, /введение/i, /вступление/i, /от\s+автора/i, /пролог/i,
      /preface/i, /foreword/i, /introduction/i, /prologue/i,
    ],
  },
  {
    type: "afterword",
    patterns: [
      /послесловие/i, /заключение/i, /эпилог/i, /от\s+переводчика/i, /от\s+редактора/i,
      /afterword/i, /epilogue/i, /conclusion/i, /postscript/i,
    ],
  },
  {
    type: "endnotes",
    patterns: [
      /примечани/i, /сноск/i, /комментари/i, /ссылк/i, /библиограф/i, /литератур/i,
      /указатель/i, /глоссарий/i, /словарь/i,
      /notes/i, /references/i, /bibliography/i, /glossary/i, /index/i, /endnotes/i, /footnotes/i,
    ],
  },
  {
    type: "appendix",
    patterns: [/приложен/i, /дополнен/i, /appendix/i, /supplement/i],
  },
];

function classifySection(title: string): SectionType {
  for (const { type, patterns } of SECTION_PATTERNS) {
    if (patterns.some(p => p.test(title))) return type;
  }
  return "content";
}

const SECTION_ICONS: Record<SectionType, string> = {
  content: "📖",
  preface: "📝",
  afterword: "📜",
  endnotes: "🔗",
  appendix: "📎",
};

const SCENE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  action: { label: "Экшн", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  dialogue: { label: "Диалог", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  lyrical_digression: { label: "Лирика", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  description: { label: "Описание", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  inner_monologue: { label: "Монолог", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  mixed: { label: "Смешанный", color: "bg-muted text-muted-foreground border-border" },
};

type Step = "upload" | "extracting_toc" | "workspace" | "error";

// Analysis status per chapter
type ChapterStatus = "pending" | "analyzing" | "done" | "error";

export default function Parser() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [bookId, setBookId] = useState<string | null>(null);

  // TOC state
  const [tocEntries, setTocEntries] = useState<TocChapter[]>([]);
  const [pdfRef, setPdfRef] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  // Workspace state
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [chapterResults, setChapterResults] = useState<Map<number, { scenes: Scene[]; status: ChapterStatus }>>(new Map());
  const [expandedParts, setExpandedParts] = useState<Set<string>>(new Set());

  const togglePart = (key: string) => {
    setExpandedParts(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // ─── File Upload & TOC Extraction ──────────────────────────

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !user) return;

    if (!f.name.toLowerCase().endsWith('.pdf')) {
      toast.error("Поддерживается только PDF формат");
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error("Максимальный размер файла — 20 МБ");
      return;
    }

    setFileName(f.name);
    setFile(f);
    setStep("extracting_toc");
    setErrorMsg("");

    try {
      const { outline, pdf } = await extractOutline(f);
      setPdfRef(pdf);
      setTotalPages(pdf.numPages);

      let chapters: TocChapter[] = [];

      if (outline.length > 0) {
        const flat = flattenTocWithRanges(outline, pdf.numPages);
        let currentPart = "";
        for (const entry of flat) {
          if (entry.level === 0 && entry.children.length > 0) {
            currentPart = entry.title;
          } else {
            chapters.push({
              title: entry.title,
              startPage: entry.startPage,
              endPage: entry.endPage,
              level: entry.level,
              partTitle: currentPart || undefined,
              sectionType: classifySection(entry.title),
            });
          }
        }
        if (chapters.length === 0) {
          for (const entry of flat) {
            chapters.push({
              title: entry.title,
              startPage: entry.startPage,
              endPage: entry.endPage,
              level: entry.level,
              sectionType: classifySection(entry.title),
            });
          }
        }
        toast.success(`Найдено оглавление: ${chapters.length} элементов`);
      } else {
        // No TOC — create a single "full book" entry for fallback
        toast.info("Оглавление не найдено. Книга загружена как один блок.");
        chapters = [{
          title: f.name.replace('.pdf', ''),
          startPage: 1,
          endPage: pdf.numPages,
          level: 0,
          sectionType: "content",
        }];
      }

      setTocEntries(chapters);

      // Create book record
      const filePath = `${user.id}/${Date.now()}_${f.name}`;
      await supabase.storage.from('book-uploads').upload(filePath, f);
      const { data: book, error: bookErr } = await supabase
        .from('books')
        .insert({
          user_id: user.id,
          title: f.name.replace('.pdf', ''),
          file_name: f.name,
          file_path: filePath,
          status: 'uploaded',
        })
        .select('id')
        .single();
      if (bookErr) throw bookErr;
      setBookId(book.id);

      // Init status map
      const initMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
      chapters.forEach((_, i) => initMap.set(i, { scenes: [], status: "pending" }));
      setChapterResults(initMap);

      setStep("workspace");
    } catch (err: any) {
      console.error("Parser error:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
      toast.error("Ошибка: " + (err.message || ""));
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [user]);

  // ─── Single Chapter Analysis ───────────────────────────────

  const analyzeChapter = async (idx: number) => {
    if (!pdfRef || !user) return;
    const entry = tocEntries[idx];
    if (!entry) return;

    setChapterResults(prev => {
      const next = new Map(prev);
      next.set(idx, { scenes: [], status: "analyzing" });
      return next;
    });

    try {
      const text = await extractTextByPageRange(pdfRef, entry.startPage, entry.endPage);

      if (text.trim().length < 50) {
        setChapterResults(prev => {
          const next = new Map(prev);
          next.set(idx, { scenes: [], status: "done" });
          return next;
        });
        toast.info(`"${entry.title}" — недостаточно текста для анализа`);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('api_keys')
        .eq('id', user.id)
        .single();
      const apiKeys = (profile?.api_keys as Record<string, string>) || {};
      const userKey = apiKeys.openai || apiKeys.gemini || null;

      const { data: fnData, error: fnError } = await supabase.functions.invoke('parse-book-structure', {
        body: { text, user_api_key: userKey, mode: "chapter", chapter_title: entry.title },
      });

      if (fnError || fnData?.error) throw new Error(fnError?.message || fnData?.error);

      const scenes: Scene[] = fnData.structure?.scenes || [];

      setChapterResults(prev => {
        const next = new Map(prev);
        next.set(idx, { scenes, status: "done" });
        return next;
      });

      // Save to DB
      if (bookId) {
        const { data: chRow } = await supabase
          .from('book_chapters')
          .insert({
            book_id: bookId,
            chapter_number: idx + 1,
            title: entry.title,
          })
          .select('id')
          .single();

        if (chRow) {
          for (const sc of scenes) {
            await supabase.from('book_scenes').insert({
              chapter_id: chRow.id,
              scene_number: sc.scene_number,
              title: sc.title,
              content: sc.content_preview || '',
              scene_type: sc.scene_type,
              mood: sc.mood,
              bpm: sc.bpm,
            });
          }
        }
      }

      toast.success(`Глава "${entry.title}" проанализирована: ${scenes.length} сцен`);
    } catch (err: any) {
      console.error(`Chapter analysis failed for "${entry.title}":`, err);
      setChapterResults(prev => {
        const next = new Map(prev);
        next.set(idx, { scenes: [], status: "error" });
        return next;
      });
      toast.error(`Ошибка анализа: ${entry.title}`);
    }
  };

  // ─── Reset ─────────────────────────────────────────────────

  const handleReset = () => {
    setStep("upload");
    setFileName("");
    setErrorMsg("");
    setBookId(null);
    setTocEntries([]);
    setPdfRef(null);
    setFile(null);
    setSelectedIdx(null);
    setChapterResults(new Map());
    setExpandedParts(new Set());
  };

  // ─── Helpers ───────────────────────────────────────────────

  const selectedEntry = selectedIdx !== null ? tocEntries[selectedIdx] : null;
  const selectedResult = selectedIdx !== null ? chapterResults.get(selectedIdx) : null;

  const contentEntries = tocEntries.filter(e => e.sectionType === "content");
  const supplementaryEntries = tocEntries.filter(e => e.sectionType !== "content");

  const analyzedCount = Array.from(chapterResults.values()).filter(r => r.status === "done").length;
  const totalScenes = Array.from(chapterResults.values()).reduce((a, r) => a + r.scenes.length, 0);

  // Group content entries by part
  const partGroups: { title: string; indices: number[] }[] = [];
  const partlessIndices: number[] = [];
  const partMap = new Map<string, number[]>();

  tocEntries.forEach((entry, idx) => {
    if (entry.sectionType !== "content") return;
    const key = entry.partTitle || "";
    if (key) {
      if (!partMap.has(key)) {
        partMap.set(key, []);
        partGroups.push({ title: key, indices: partMap.get(key)! });
      }
      partMap.get(key)!.push(idx);
    } else {
      partlessIndices.push(idx);
    }
  });

  // ─── Render ────────────────────────────────────────────────

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">Парсер</h1>
          <p className="text-sm text-muted-foreground font-body">
            Модуль 1.1 — The Architect: структурная декомпозиция
          </p>
        </div>
        {step !== "upload" && (
          <div className="flex items-center gap-3">
            {step === "workspace" && (
              <div className="text-xs text-muted-foreground">
                {analyzedCount}/{tocEntries.length} глав • {totalScenes} сцен
              </div>
            )}
            <Button variant="outline" size="sm" onClick={handleReset}>
              Новый файл
            </Button>
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">
          {/* Upload */}
          {step === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex items-center justify-center h-full">
              <Card className="w-full max-w-md cursor-pointer border-dashed border-2 hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}>
                <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
                  <div className="h-16 w-16 rounded-2xl gradient-cyan flex items-center justify-center shadow-cool">
                    <Upload className="h-8 w-8 text-primary-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="font-display font-semibold text-lg text-foreground">Загрузите PDF книги</p>
                    <p className="text-sm text-muted-foreground mt-1">Максимум 20 МБ • PDF формат</p>
                  </div>
                  <Button variant="outline" size="lg">
                    <Upload className="h-4 w-4 mr-2" />
                    Выбрать файл
                  </Button>
                </CardContent>
              </Card>
              <input ref={fileInputRef} type="file" accept=".pdf" className="hidden" onChange={handleFileSelect} />
            </motion.div>
          )}

          {/* Extracting TOC */}
          {step === "extracting_toc" && (
            <motion.div key="extracting_toc" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="flex items-center justify-center h-full">
              <Card className="w-full max-w-md">
                <CardContent className="py-10 flex flex-col items-center gap-4">
                  <FileText className="h-8 w-8 text-primary" />
                  <div className="text-center">
                    <p className="font-display font-semibold">{fileName}</p>
                    <p className="text-sm text-muted-foreground mt-1">Поиск оглавления в PDF...</p>
                  </div>
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Error */}
          {step === "error" && (
            <motion.div key="error" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="flex items-center justify-center h-full">
              <Card className="w-full max-w-md border-destructive/30">
                <CardContent className="py-10 flex flex-col items-center gap-4">
                  <AlertCircle className="h-12 w-12 text-destructive" />
                  <div className="text-center">
                    <p className="font-display font-semibold text-lg">Ошибка</p>
                    <p className="text-sm text-muted-foreground mt-2 max-w-sm">{errorMsg}</p>
                  </div>
                  <Button variant="outline" onClick={handleReset}>Попробовать снова</Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* ═══ WORKSPACE: Split Panel ═══ */}
          {step === "workspace" && (
            <motion.div key="workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex h-full">

              {/* ── Left Sidebar: Navigator ── */}
              <div className="w-72 min-w-[260px] border-r border-border flex flex-col bg-card/50">
                <div className="px-4 py-3 border-b border-border">
                  <div className="flex items-center gap-2">
                    <BookOpen className="h-4 w-4 text-primary" />
                    <span className="font-display font-semibold text-sm text-foreground truncate">
                      {fileName.replace('.pdf', '')}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-1">
                    {totalPages} стр. • {contentEntries.length} глав
                    {supplementaryEntries.length > 0 && ` • ${supplementaryEntries.length} доп.`}
                  </p>
                </div>

                <ScrollArea className="flex-1">
                  <div className="py-2">
                    {/* Preface sections */}
                    {renderNavSection("preface")}

                    {/* Parts with chapters */}
                    {partGroups.map((group) => (
                      <div key={group.title}>
                        <button
                          onClick={() => togglePart(group.title)}
                          className="w-full flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-primary hover:bg-muted/30 transition-colors"
                        >
                          {expandedParts.has(group.title) ? (
                            <ChevronDown className="h-3 w-3" />
                          ) : (
                            <ChevronRight className="h-3 w-3" />
                          )}
                          <FolderOpen className="h-3 w-3" />
                          <span className="truncate">{group.title}</span>
                        </button>
                        {expandedParts.has(group.title) && (
                          <div className="ml-2">
                            {group.indices.map(idx => renderNavItem(idx))}
                          </div>
                        )}
                      </div>
                    ))}

                    {/* Chapters without parts */}
                    {partlessIndices.map(idx => renderNavItem(idx))}

                    {/* Supplementary sections */}
                    {renderNavSection("afterword")}
                    {renderNavSection("endnotes")}
                    {renderNavSection("appendix")}
                  </div>
                </ScrollArea>
              </div>

              {/* ── Right Panel: Chapter Detail ── */}
              <div className="flex-1 flex flex-col overflow-hidden">
                {selectedIdx === null ? (
                  <div className="flex-1 flex items-center justify-center text-muted-foreground">
                    <div className="text-center space-y-3">
                      <Layers className="h-12 w-12 mx-auto opacity-30" />
                      <p className="text-sm">Выберите главу для анализа</p>
                    </div>
                  </div>
                ) : selectedEntry && (
                  <ScrollArea className="flex-1">
                    <div className="p-6 max-w-3xl mx-auto space-y-4">
                      {/* Chapter header */}
                      <Card>
                        <CardHeader className="pb-3">
                          <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                              <div className="h-10 w-10 rounded-xl gradient-cyan flex items-center justify-center shadow-cool">
                                <FileText className="h-5 w-5 text-primary-foreground" />
                              </div>
                              <div>
                                <CardTitle className="text-lg">{selectedEntry.title}</CardTitle>
                                <p className="text-xs text-muted-foreground mt-0.5">
                                  Стр. {selectedEntry.startPage}–{selectedEntry.endPage}
                                  {selectedEntry.partTitle && ` • ${selectedEntry.partTitle}`}
                                </p>
                              </div>
                            </div>

                            {/* Analyze button */}
                            {selectedResult?.status === "pending" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => analyzeChapter(selectedIdx)}
                                className="gap-2"
                              >
                                <PlayCircle className="h-4 w-4" />
                                Анализировать
                              </Button>
                            )}
                            {selectedResult?.status === "done" && (
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => analyzeChapter(selectedIdx)}
                                className="gap-2 text-muted-foreground"
                              >
                                <Zap className="h-4 w-4" />
                                Повторить
                              </Button>
                            )}
                            {selectedResult?.status === "error" && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => analyzeChapter(selectedIdx)}
                                className="gap-2 border-destructive/30 text-destructive"
                              >
                                <AlertCircle className="h-4 w-4" />
                                Повторить
                              </Button>
                            )}
                          </div>
                        </CardHeader>
                      </Card>

                      {/* Analyzing state */}
                      {selectedResult?.status === "analyzing" && (
                        <Card>
                          <CardContent className="py-8 flex flex-col items-center gap-4">
                            <div className="h-14 w-14 rounded-2xl gradient-cyan flex items-center justify-center shadow-cool animate-pulse">
                              <Zap className="h-7 w-7 text-primary-foreground" />
                            </div>
                            <div className="text-center">
                              <p className="font-display font-semibold">The Architect</p>
                              <p className="text-sm text-muted-foreground mt-1">Анализируем сцены...</p>
                            </div>
                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                          </CardContent>
                        </Card>
                      )}

                      {/* Pending state */}
                      {selectedResult?.status === "pending" && (
                        <Card className="border-dashed">
                          <CardContent className="py-8 flex flex-col items-center gap-3 text-muted-foreground">
                            <PlayCircle className="h-10 w-10 opacity-30" />
                            <p className="text-sm">
                              Нажмите «Анализировать» для AI-декомпозиции на сцены
                            </p>
                          </CardContent>
                        </Card>
                      )}

                      {/* Error state */}
                      {selectedResult?.status === "error" && (
                        <Card className="border-destructive/30">
                          <CardContent className="py-6 flex flex-col items-center gap-3">
                            <AlertCircle className="h-8 w-8 text-destructive" />
                            <p className="text-sm text-muted-foreground">Ошибка при анализе. Попробуйте снова.</p>
                          </CardContent>
                        </Card>
                      )}

                      {/* Scenes list */}
                      {selectedResult?.status === "done" && selectedResult.scenes.length > 0 && (
                        <div className="space-y-2">
                          <h3 className="text-sm font-semibold text-muted-foreground px-1">
                            {selectedResult.scenes.length} сцен
                          </h3>
                          {selectedResult.scenes.map((sc) => {
                            const typeInfo = SCENE_TYPE_LABELS[sc.scene_type] || SCENE_TYPE_LABELS.mixed;
                            return (
                              <Card key={sc.scene_number}>
                                <CardContent className="py-3 px-4 space-y-2">
                                  <div className="flex items-center justify-between">
                                    <span className="text-sm font-medium">
                                      Сцена {sc.scene_number}: {sc.title}
                                    </span>
                                    <div className="flex items-center gap-1.5">
                                      <Badge variant="outline" className={`text-[10px] ${typeInfo.color}`}>
                                        {typeInfo.label}
                                      </Badge>
                                      <Badge variant="outline" className="text-[10px]">{sc.mood}</Badge>
                                      <Badge variant="outline" className="text-[10px] font-mono">
                                        {sc.bpm} BPM
                                      </Badge>
                                    </div>
                                  </div>
                                  {sc.content_preview && (
                                    <p className="text-xs text-muted-foreground line-clamp-2">
                                      {sc.content_preview}
                                    </p>
                                  )}
                                </CardContent>
                              </Card>
                            );
                          })}
                        </div>
                      )}

                      {/* Done but empty */}
                      {selectedResult?.status === "done" && selectedResult.scenes.length === 0 && (
                        <Card className="border-dashed">
                          <CardContent className="py-6 flex flex-col items-center gap-2 text-muted-foreground">
                            <p className="text-sm italic">Сцены не определены (мало текста или нестандартная структура)</p>
                          </CardContent>
                        </Card>
                      )}
                    </div>
                  </ScrollArea>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );

  // ─── Nav Sidebar Helpers ───────────────────────────────────

  function renderNavItem(idx: number) {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    const isSelected = selectedIdx === idx;
    const status = result?.status || "pending";

    return (
      <button
        key={idx}
        onClick={() => setSelectedIdx(idx)}
        className={`w-full flex items-center gap-2 px-4 py-1.5 text-left text-xs transition-colors ${
          isSelected
            ? "bg-primary/10 text-primary border-r-2 border-primary"
            : "text-foreground/70 hover:bg-muted/40 hover:text-foreground"
        }`}
      >
        {/* Status indicator */}
        <span className="flex-shrink-0">
          {status === "done" ? (
            <CheckCircle2 className="h-3 w-3 text-green-500" />
          ) : status === "analyzing" ? (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          ) : status === "error" ? (
            <AlertCircle className="h-3 w-3 text-destructive" />
          ) : (
            <div className="h-3 w-3 rounded-full border border-border" />
          )}
        </span>
        <span className="truncate flex-1">{entry.title}</span>
        <span className="text-[10px] text-muted-foreground font-mono flex-shrink-0">
          {entry.startPage}
        </span>
      </button>
    );
  }

  function renderNavSection(type: SectionType) {
    const entries = tocEntries
      .map((e, i) => ({ entry: e, idx: i }))
      .filter(({ entry }) => entry.sectionType === type);
    if (entries.length === 0) return null;

    return (
      <>
        <div className="px-4 py-1 mt-2">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {SECTION_ICONS[type]} {type === "preface" ? "Вступление" : type === "afterword" ? "Послесловие" : type === "endnotes" ? "Примечания" : "Приложения"}
          </span>
        </div>
        {entries.map(({ idx }) => renderNavItem(idx))}
      </>
    );
  }
}
