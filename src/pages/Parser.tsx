import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, BookOpen, ChevronDown, ChevronRight, Loader2, AlertCircle, CheckCircle2, Zap, Edit2, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { extractOutline, extractTextByPageRange, extractTextFromPdf, flattenTocWithRanges, type TocEntry } from "@/lib/pdf-extract";

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

interface TocChapter {
  title: string;
  startPage: number;
  endPage: number;
  level: number;
  partTitle?: string;
}

type Step = "upload" | "extracting_toc" | "review_toc" | "analyzing" | "done" | "error";

const SCENE_TYPE_LABELS: Record<string, { label: string; color: string }> = {
  action: { label: "Экшн", color: "bg-red-500/20 text-red-400 border-red-500/30" },
  dialogue: { label: "Диалог", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  lyrical_digression: { label: "Лирика", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  description: { label: "Описание", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  inner_monologue: { label: "Монолог", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  mixed: { label: "Смешанный", color: "bg-muted text-muted-foreground border-border" },
};

const STEPS_INFO = [
  { key: "upload", label: "Загрузка PDF" },
  { key: "extracting_toc", label: "Извлечение оглавления" },
  { key: "review_toc", label: "Проверка структуры" },
  { key: "analyzing", label: "AI-анализ глав" },
  { key: "done", label: "Готово" },
];

export default function Parser() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [structure, setStructure] = useState<BookStructure | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [expandedParts, setExpandedParts] = useState<Set<number>>(new Set());
  const [expandedChapters, setExpandedChapters] = useState<Set<string>>(new Set());
  const [bookId, setBookId] = useState<string | null>(null);

  // TOC review state
  const [tocEntries, setTocEntries] = useState<TocChapter[]>([]);
  const [hasToc, setHasToc] = useState(false);
  const [pdfRef, setPdfRef] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  // Parallel analysis progress
  const [analysisProgress, setAnalysisProgress] = useState({ done: 0, total: 0 });

  const togglePart = (n: number) => {
    setExpandedParts(prev => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });
  };

  const toggleChapter = (key: string) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

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
    setStructure(null);
    setErrorMsg("");

    try {
      // 1. Try to extract TOC from PDF outline/bookmarks
      const { outline, pdf } = await extractOutline(f);
      setPdfRef(pdf);
      setTotalPages(pdf.numPages);

      if (outline.length > 0) {
        // Found TOC — build chapter list with page ranges
        const flat = flattenTocWithRanges(outline, pdf.numPages);
        
        // Detect parts (level 0) and chapters (level 1+)
        const chapters: TocChapter[] = [];
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
            });
          }
        }

        // If no clear part/chapter distinction, treat all as chapters
        if (chapters.length === 0) {
          for (const entry of flat) {
            chapters.push({
              title: entry.title,
              startPage: entry.startPage,
              endPage: entry.endPage,
              level: entry.level,
            });
          }
        }

        setTocEntries(chapters);
        setHasToc(true);
        setStep("review_toc");
        toast.success(`Найдено оглавление: ${chapters.length} элементов`);
      } else {
        // No TOC found — fallback to full text LLM analysis
        setHasToc(false);
        setStep("analyzing");
        toast.info("Оглавление не найдено. Запускаем AI-анализ всего текста...");
        await runFullTextAnalysis(f, pdf, user.id);
      }
    } catch (err: any) {
      console.error("Parser error:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
      toast.error("Ошибка: " + (err.message || ""));
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [user]);

  const runFullTextAnalysis = async (f: File, pdf: any, userId: string) => {
    const text = await extractTextFromPdf(f);
    if (text.trim().length < 100) {
      throw new Error("Не удалось извлечь достаточно текста из PDF.");
    }

    // Upload & create book record
    const filePath = `${userId}/${Date.now()}_${f.name}`;
    await supabase.storage.from('book-uploads').upload(filePath, f);

    const { data: book, error: bookErr } = await supabase
      .from('books')
      .insert({
        user_id: userId,
        title: f.name.replace('.pdf', ''),
        file_name: f.name,
        file_path: filePath,
        raw_text: text.slice(0, 500000),
        status: 'analyzing',
      })
      .select('id')
      .single();
    if (bookErr) throw bookErr;
    setBookId(book.id);

    const { data: profile } = await supabase
      .from('profiles')
      .select('api_keys')
      .eq('id', userId)
      .single();
    const apiKeys = (profile?.api_keys as Record<string, string>) || {};
    const userKey = apiKeys.openai || apiKeys.gemini || null;

    const { data: fnData, error: fnError } = await supabase.functions.invoke('parse-book-structure', {
      body: { text, user_api_key: userKey, mode: "full" },
    });
    if (fnError) throw new Error(fnError.message);
    if (fnData.error) throw new Error(fnData.error);

    const result = fnData.structure as BookStructure;
    setStructure(result);
    await saveStructureToDb(book.id, result);
    setStep("done");
    toast.success("Структура книги проанализирована!");
  };

  const runParallelChapterAnalysis = async () => {
    if (!user || !file || !pdfRef) return;

    setStep("analyzing");
    setAnalysisProgress({ done: 0, total: tocEntries.length });

    try {
      // Upload & create book record
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      await supabase.storage.from('book-uploads').upload(filePath, file);

      const { data: book, error: bookErr } = await supabase
        .from('books')
        .insert({
          user_id: user.id,
          title: file.name.replace('.pdf', ''),
          file_name: file.name,
          file_path: filePath,
          status: 'analyzing',
        })
        .select('id')
        .single();
      if (bookErr) throw bookErr;
      setBookId(book.id);

      const { data: profile } = await supabase
        .from('profiles')
        .select('api_keys')
        .eq('id', user.id)
        .single();
      const apiKeys = (profile?.api_keys as Record<string, string>) || {};
      const userKey = apiKeys.openai || apiKeys.gemini || null;

      // Group chapters by part
      const partsMap = new Map<string, TocChapter[]>();
      for (const ch of tocEntries) {
        const key = ch.partTitle || "__default__";
        if (!partsMap.has(key)) partsMap.set(key, []);
        partsMap.get(key)!.push(ch);
      }

      // Analyze chapters in parallel (batches of 3 to avoid rate limits)
      const allChapters: { partTitle?: string; chapter: Chapter; chapterIdx: number }[] = [];
      let globalIdx = 0;

      const batchSize = 3;
      const allEntries = [...tocEntries];
      
      for (let batchStart = 0; batchStart < allEntries.length; batchStart += batchSize) {
        const batch = allEntries.slice(batchStart, batchStart + batchSize);
        
        const promises = batch.map(async (entry) => {
          const text = await extractTextByPageRange(pdfRef, entry.startPage, entry.endPage);
          
          if (text.trim().length < 50) {
            return {
              partTitle: entry.partTitle,
              chapter: {
                chapter_number: 0,
                title: entry.title,
                scenes: [],
              },
            };
          }

          const { data: fnData, error: fnError } = await supabase.functions.invoke('parse-book-structure', {
            body: {
              text,
              user_api_key: userKey,
              mode: "chapter",
              chapter_title: entry.title,
            },
          });

          if (fnError || fnData?.error) {
            console.error(`Chapter analysis failed for "${entry.title}":`, fnError?.message || fnData?.error);
            return {
              partTitle: entry.partTitle,
              chapter: {
                chapter_number: 0,
                title: entry.title,
                scenes: [],
              },
            };
          }

          return {
            partTitle: entry.partTitle,
            chapter: {
              chapter_number: 0,
              title: entry.title,
              scenes: fnData.structure.scenes || [],
            },
          };
        });

        const results = await Promise.all(promises);
        for (const r of results) {
          globalIdx++;
          r.chapter.chapter_number = globalIdx;
          allChapters.push({ ...r, chapterIdx: globalIdx });
        }
        setAnalysisProgress({ done: Math.min(batchStart + batchSize, allEntries.length), total: allEntries.length });
      }

      // Build final structure
      const partTitles = [...new Set(tocEntries.map(e => e.partTitle).filter(Boolean))];
      
      let bookStructure: BookStructure;
      if (partTitles.length > 0) {
        const parts: Part[] = partTitles.map((pTitle, pIdx) => ({
          part_number: pIdx + 1,
          title: pTitle!,
          chapters: allChapters
            .filter(c => c.partTitle === pTitle)
            .map(c => c.chapter),
        }));
        // Add chapters without parts
        const orphanChapters = allChapters.filter(c => !c.partTitle).map(c => c.chapter);
        if (orphanChapters.length > 0) {
          parts.push({ part_number: parts.length + 1, title: "Без раздела", chapters: orphanChapters });
        }
        bookStructure = {
          book_title: file.name.replace('.pdf', ''),
          parts,
        };
      } else {
        bookStructure = {
          book_title: file.name.replace('.pdf', ''),
          chapters: allChapters.map(c => c.chapter),
        };
      }

      setStructure(bookStructure);
      await saveStructureToDb(book.id, bookStructure);

      await supabase.from('books').update({
        title: bookStructure.book_title,
        status: 'parsed',
        updated_at: new Date().toISOString(),
      }).eq('id', book.id);

      setStep("done");
      if (bookStructure.parts?.length) {
        setExpandedParts(new Set([1]));
      }
      toast.success("Структура книги успешно проанализирована!");
    } catch (err: any) {
      console.error("Parser error:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
      toast.error("Ошибка: " + (err.message || ""));
    }
  };

  const saveStructureToDb = async (bookIdVal: string, struct: BookStructure) => {
    if (struct.parts) {
      for (const part of struct.parts) {
        const { data: partRow } = await supabase
          .from('book_parts')
          .insert({
            book_id: bookIdVal,
            part_number: part.part_number,
            title: part.title,
          })
          .select('id')
          .single();

        if (partRow) {
          for (const ch of part.chapters) {
            const { data: chRow } = await supabase
              .from('book_chapters')
              .insert({
                book_id: bookIdVal,
                part_id: partRow.id,
                chapter_number: ch.chapter_number,
                title: ch.title,
              })
              .select('id')
              .single();

            if (chRow && ch.scenes) {
              for (const sc of ch.scenes) {
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
        }
      }
    } else if (struct.chapters) {
      for (const ch of struct.chapters) {
        const { data: chRow } = await supabase
          .from('book_chapters')
          .insert({
            book_id: bookIdVal,
            chapter_number: ch.chapter_number,
            title: ch.title,
          })
          .select('id')
          .single();

        if (chRow && ch.scenes) {
          for (const sc of ch.scenes) {
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
    }
  };

  const handleReset = () => {
    setStep("upload");
    setFileName("");
    setStructure(null);
    setErrorMsg("");
    setBookId(null);
    setTocEntries([]);
    setHasToc(false);
    setPdfRef(null);
    setFile(null);
    setAnalysisProgress({ done: 0, total: 0 });
  };

  const currentStepIdx = STEPS_INFO.findIndex(s => s.key === step);

  // Flatten chapters for display
  const allChapters = structure?.parts
    ? structure.parts.flatMap(p => p.chapters)
    : structure?.chapters || [];
  const totalScenes = allChapters.reduce((a, c) => a + (c.scenes?.length || 0), 0);

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
          <Button variant="outline" size="sm" onClick={handleReset}>
            Новый файл
          </Button>
        )}
      </div>

      {/* Steps indicator */}
      <div className="px-6 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          {STEPS_INFO.map((s, i) => {
            const isActive = i === currentStepIdx;
            const isDone = i < currentStepIdx || step === "done";
            const isError = step === "error" && i === currentStepIdx;
            return (
              <div key={s.key} className="flex items-center gap-2">
                {i > 0 && <div className={`w-8 h-px ${isDone ? 'bg-primary' : 'bg-border'}`} />}
                <div className={`flex items-center gap-1.5 text-xs font-medium transition-colors ${
                  isError ? 'text-destructive' :
                  isDone ? 'text-primary' :
                  isActive ? 'text-foreground' : 'text-muted-foreground'
                }`}>
                  {isDone && !isActive ? (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  ) : isError ? (
                    <AlertCircle className="h-3.5 w-3.5" />
                  ) : isActive && (step === "extracting_toc" || step === "analyzing") ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <div className={`h-2 w-2 rounded-full ${isActive ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                  )}
                  <span className="hidden sm:inline">{s.label}</span>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        <AnimatePresence mode="wait">
          {/* Upload */}
          {step === "upload" && (
            <motion.div key="upload" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex items-center justify-center min-h-[400px]">
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
                  <Button variant="hero" size="lg">
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
              className="flex items-center justify-center min-h-[400px]">
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

          {/* Review TOC */}
          {step === "review_toc" && (
            <motion.div key="review_toc" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="space-y-4 max-w-3xl mx-auto">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl gradient-cyan flex items-center justify-center shadow-cool">
                        <Layers className="h-5 w-5 text-primary-foreground" />
                      </div>
                      <div>
                        <CardTitle className="text-xl">Структура из оглавления PDF</CardTitle>
                        <p className="text-sm text-muted-foreground">
                          {tocEntries.length} глав • {totalPages} страниц — проверьте и запустите анализ
                        </p>
                      </div>
                    </div>
                    <Button variant="hero" onClick={runParallelChapterAnalysis}>
                      <Zap className="h-4 w-4 mr-2" />
                      Анализировать
                    </Button>
                  </div>
                </CardHeader>
              </Card>

              {/* Group by parts */}
              {(() => {
                const parts = [...new Set(tocEntries.map(e => e.partTitle).filter(Boolean))];
                if (parts.length > 0) {
                  return parts.map((partTitle, pi) => (
                    <Card key={pi}>
                      <CardHeader className="pb-2">
                        <CardTitle className="text-base text-primary">{partTitle}</CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-1.5">
                        {tocEntries.filter(e => e.partTitle === partTitle).map((entry, i) => (
                          <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                            <span className="text-sm font-medium">{entry.title}</span>
                            <Badge variant="outline" className="text-[10px] font-mono">
                              стр. {entry.startPage}–{entry.endPage}
                            </Badge>
                          </div>
                        ))}
                      </CardContent>
                    </Card>
                  ));
                }
                return (
                  <Card>
                    <CardContent className="pt-4 space-y-1.5">
                      {tocEntries.map((entry, i) => (
                        <div key={i} className="flex items-center justify-between rounded-lg border border-border bg-muted/20 px-3 py-2">
                          <span className="text-sm font-medium">{entry.title}</span>
                          <Badge variant="outline" className="text-[10px] font-mono">
                            стр. {entry.startPage}–{entry.endPage}
                          </Badge>
                        </div>
                      ))}
                    </CardContent>
                  </Card>
                );
              })()}
            </motion.div>
          )}

          {/* Analyzing */}
          {step === "analyzing" && (
            <motion.div key="analyzing" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="flex items-center justify-center min-h-[400px]">
              <Card className="w-full max-w-md">
                <CardContent className="py-10 flex flex-col items-center gap-4">
                  <div className="h-16 w-16 rounded-2xl gradient-cyan flex items-center justify-center shadow-cool animate-pulse">
                    <Zap className="h-8 w-8 text-primary-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="font-display font-semibold text-lg">The Architect</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      {analysisProgress.total > 0
                        ? `Анализ глав: ${analysisProgress.done} / ${analysisProgress.total}`
                        : "AI анализирует структуру книги..."}
                    </p>
                  </div>
                  {analysisProgress.total > 0 && (
                    <Progress value={(analysisProgress.done / analysisProgress.total) * 100} className="h-2 w-full max-w-xs" />
                  )}
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Error */}
          {step === "error" && (
            <motion.div key="error" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="flex items-center justify-center min-h-[400px]">
              <Card className="w-full max-w-md border-destructive/30">
                <CardContent className="py-10 flex flex-col items-center gap-4">
                  <AlertCircle className="h-12 w-12 text-destructive" />
                  <div className="text-center">
                    <p className="font-display font-semibold text-lg">Ошибка анализа</p>
                    <p className="text-sm text-muted-foreground mt-2 max-w-sm">{errorMsg}</p>
                  </div>
                  <Button variant="outline" onClick={handleReset}>Попробовать снова</Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Results */}
          {step === "done" && structure && (
            <motion.div key="done" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="space-y-4 max-w-3xl mx-auto">
              {/* Book header */}
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl gradient-cyan flex items-center justify-center shadow-cool">
                      <BookOpen className="h-5 w-5 text-primary-foreground" />
                    </div>
                    <div>
                      <CardTitle className="text-xl">{structure.book_title}</CardTitle>
                      <p className="text-sm text-muted-foreground">
                        {structure.parts ? `${structure.parts.length} частей • ` : ""}
                        {allChapters.length} глав • {totalScenes} сцен
                      </p>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Parts / Chapters */}
              {structure.parts ? (
                structure.parts.map((part) => (
                  <Collapsible key={part.part_number} open={expandedParts.has(part.part_number)}
                    onOpenChange={() => togglePart(part.part_number)}>
                    <Card>
                      <CollapsibleTrigger asChild>
                        <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
                          <div className="flex items-center gap-3">
                            {expandedParts.has(part.part_number)
                              ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                              : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                            <div>
                              <CardTitle className="text-lg text-primary">
                                {part.title}
                              </CardTitle>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {part.chapters.length} глав
                              </p>
                            </div>
                          </div>
                        </CardHeader>
                      </CollapsibleTrigger>
                      <CollapsibleContent>
                        <CardContent className="pt-0 space-y-3">
                          {part.chapters.map((ch) => renderChapter(ch, `${part.part_number}-${ch.chapter_number}`))}
                        </CardContent>
                      </CollapsibleContent>
                    </Card>
                  </Collapsible>
                ))
              ) : (
                structure.chapters?.map((ch) => renderChapter(ch, `${ch.chapter_number}`))
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );

  function renderChapter(ch: Chapter, key: string) {
    return (
      <Collapsible key={key} open={expandedChapters.has(key)} onOpenChange={() => toggleChapter(key)}>
        <Card>
          <CollapsibleTrigger asChild>
            <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  {expandedChapters.has(key)
                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                  <div>
                    <CardTitle className="text-base">{ch.title}</CardTitle>
                    <p className="text-xs text-muted-foreground mt-0.5">{ch.scenes?.length || 0} сцен</p>
                  </div>
                </div>
              </div>
            </CardHeader>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <CardContent className="pt-0 space-y-2">
              {ch.scenes?.map((sc) => {
                const typeInfo = SCENE_TYPE_LABELS[sc.scene_type] || SCENE_TYPE_LABELS.mixed;
                return (
                  <div key={sc.scene_number} className="rounded-lg border border-border bg-muted/20 p-3 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Сцена {sc.scene_number}: {sc.title}</span>
                      <div className="flex items-center gap-1.5">
                        <Badge variant="outline" className={`text-[10px] ${typeInfo.color}`}>{typeInfo.label}</Badge>
                        <Badge variant="outline" className="text-[10px]">{sc.mood}</Badge>
                        <Badge variant="outline" className="text-[10px] font-mono">{sc.bpm} BPM</Badge>
                      </div>
                    </div>
                    {sc.content_preview && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{sc.content_preview}</p>
                    )}
                  </div>
                );
              })}
              {(!ch.scenes || ch.scenes.length === 0) && (
                <p className="text-xs text-muted-foreground italic py-2">Сцены не определены</p>
              )}
            </CardContent>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    );
  }
}
