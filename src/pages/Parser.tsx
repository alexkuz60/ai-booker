import { useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Upload, FileText, BookOpen, ChevronDown, ChevronRight, Loader2, AlertCircle, CheckCircle2, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { extractTextFromPdf } from "@/lib/pdf-extract";

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

interface BookStructure {
  book_title: string;
  chapters: Chapter[];
}

type Step = "upload" | "extracting" | "analyzing" | "done" | "error";

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
  { key: "extracting", label: "Извлечение текста" },
  { key: "analyzing", label: "Анализ структуры (AI)" },
  { key: "done", label: "Готово" },
];

export default function Parser() {
  const { user } = useAuth();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [fileName, setFileName] = useState("");
  const [extractProgress, setExtractProgress] = useState(0);
  const [structure, setStructure] = useState<BookStructure | null>(null);
  const [errorMsg, setErrorMsg] = useState("");
  const [expandedChapters, setExpandedChapters] = useState<Set<number>>(new Set());
  const [bookId, setBookId] = useState<string | null>(null);

  const toggleChapter = (n: number) => {
    setExpandedChapters(prev => {
      const next = new Set(prev);
      next.has(n) ? next.delete(n) : next.add(n);
      return next;
    });
  };

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      toast.error("Поддерживается только PDF формат");
      return;
    }

    if (file.size > 20 * 1024 * 1024) {
      toast.error("Максимальный размер файла — 20 МБ");
      return;
    }

    setFileName(file.name);
    setStep("extracting");
    setExtractProgress(0);
    setStructure(null);
    setErrorMsg("");

    try {
      // 1. Extract text from PDF
      const text = await extractTextFromPdf(file, setExtractProgress);

      if (text.trim().length < 100) {
        throw new Error("Не удалось извлечь достаточно текста из PDF. Попробуйте другой файл.");
      }

      // 2. Upload PDF to storage
      const filePath = `${user.id}/${Date.now()}_${file.name}`;
      await supabase.storage.from('book-uploads').upload(filePath, file);

      // 3. Create book record
      const { data: book, error: bookErr } = await supabase
        .from('books')
        .insert({
          user_id: user.id,
          title: file.name.replace('.pdf', ''),
          file_name: file.name,
          file_path: filePath,
          raw_text: text.slice(0, 500000), // store up to 500k chars
          status: 'analyzing',
        })
        .select('id')
        .single();

      if (bookErr) throw bookErr;
      setBookId(book.id);

      // 4. Analyze with AI
      setStep("analyzing");

      // Check for user API keys
      const { data: profile } = await supabase
        .from('profiles')
        .select('api_keys')
        .eq('id', user.id)
        .single();

      const apiKeys = (profile?.api_keys as Record<string, string>) || {};
      const userKey = apiKeys.openai || apiKeys.gemini || null;

      const { data: fnData, error: fnError } = await supabase.functions.invoke('parse-book-structure', {
        body: {
          text,
          user_api_key: userKey,
        },
      });

      if (fnError) throw new Error(fnError.message);
      if (fnData.error) throw new Error(fnData.error);

      const result = fnData.structure as BookStructure;
      setStructure(result);

      // 5. Save structure to DB
      for (const ch of result.chapters) {
        const { data: chapterRow } = await supabase
          .from('book_chapters')
          .insert({
            book_id: book.id,
            chapter_number: ch.chapter_number,
            title: ch.title,
          })
          .select('id')
          .single();

        if (chapterRow && ch.scenes) {
          for (const sc of ch.scenes) {
            await supabase.from('book_scenes').insert({
              chapter_id: chapterRow.id,
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

      // Update book status
      await supabase.from('books').update({
        title: result.book_title || file.name.replace('.pdf', ''),
        status: 'parsed',
        updated_at: new Date().toISOString(),
      }).eq('id', book.id);

      setStep("done");
      // Expand first chapter by default
      if (result.chapters.length > 0) {
        setExpandedChapters(new Set([result.chapters[0].chapter_number]));
      }
      toast.success("Структура книги успешно проанализирована!");

    } catch (err: any) {
      console.error("Parser error:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
      toast.error("Ошибка при анализе: " + (err.message || ""));
    }

    // Reset file input
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [user]);

  const handleReset = () => {
    setStep("upload");
    setFileName("");
    setExtractProgress(0);
    setStructure(null);
    setErrorMsg("");
    setBookId(null);
  };

  const currentStepIdx = STEPS_INFO.findIndex(s => s.key === step);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="flex-1 flex flex-col h-full"
    >
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
                  ) : isActive && (step === "extracting" || step === "analyzing") ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <div className={`h-2 w-2 rounded-full ${
                      isActive ? 'bg-primary' : 'bg-muted-foreground/30'
                    }`} />
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
          {/* Upload state */}
          {step === "upload" && (
            <motion.div
              key="upload"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex-1 flex items-center justify-center min-h-[400px]"
            >
              <Card
                className="w-full max-w-md cursor-pointer border-dashed border-2 hover:border-primary/50 transition-colors"
                onClick={() => fileInputRef.current?.click()}
              >
                <CardContent className="flex flex-col items-center justify-center py-12 gap-4">
                  <div className="h-16 w-16 rounded-2xl gradient-cyan flex items-center justify-center shadow-cool">
                    <Upload className="h-8 w-8 text-primary-foreground" />
                  </div>
                  <div className="text-center">
                    <p className="font-display font-semibold text-lg text-foreground">
                      Загрузите PDF книги
                    </p>
                    <p className="text-sm text-muted-foreground mt-1">
                      Максимум 20 МБ • PDF формат
                    </p>
                  </div>
                  <Button variant="hero" size="lg">
                    <Upload className="h-4 w-4 mr-2" />
                    Выбрать файл
                  </Button>
                </CardContent>
              </Card>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf"
                className="hidden"
                onChange={handleFileSelect}
              />
            </motion.div>
          )}

          {/* Extracting text */}
          {step === "extracting" && (
            <motion.div
              key="extracting"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex items-center justify-center min-h-[400px]"
            >
              <Card className="w-full max-w-md">
                <CardContent className="py-10 space-y-6">
                  <div className="flex items-center gap-3">
                    <FileText className="h-5 w-5 text-primary" />
                    <span className="font-display font-semibold">{fileName}</span>
                  </div>
                  <div className="space-y-2">
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Извлечение текста...</span>
                      <span className="text-foreground font-medium">{extractProgress}%</span>
                    </div>
                    <Progress value={extractProgress} className="h-2" />
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Analyzing with AI */}
          {step === "analyzing" && (
            <motion.div
              key="analyzing"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex items-center justify-center min-h-[400px]"
            >
              <Card className="w-full max-w-md">
                <CardContent className="py-10 flex flex-col items-center gap-4">
                  <div className="relative">
                    <div className="h-16 w-16 rounded-2xl gradient-cyan flex items-center justify-center shadow-cool animate-pulse">
                      <Zap className="h-8 w-8 text-primary-foreground" />
                    </div>
                  </div>
                  <div className="text-center">
                    <p className="font-display font-semibold text-lg">The Architect</p>
                    <p className="text-sm text-muted-foreground mt-1">
                      AI анализирует структуру книги...
                    </p>
                    <p className="text-xs text-muted-foreground mt-2">
                      Определение глав, сцен, типов и настроений
                    </p>
                  </div>
                  <Loader2 className="h-6 w-6 animate-spin text-primary" />
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Error */}
          {step === "error" && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="flex items-center justify-center min-h-[400px]"
            >
              <Card className="w-full max-w-md border-destructive/30">
                <CardContent className="py-10 flex flex-col items-center gap-4">
                  <AlertCircle className="h-12 w-12 text-destructive" />
                  <div className="text-center">
                    <p className="font-display font-semibold text-lg">Ошибка анализа</p>
                    <p className="text-sm text-muted-foreground mt-2 max-w-sm">{errorMsg}</p>
                  </div>
                  <Button variant="outline" onClick={handleReset}>
                    Попробовать снова
                  </Button>
                </CardContent>
              </Card>
            </motion.div>
          )}

          {/* Results */}
          {step === "done" && structure && (
            <motion.div
              key="done"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-4 max-w-3xl mx-auto"
            >
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
                        {structure.chapters.length} глав •{" "}
                        {structure.chapters.reduce((a, c) => a + (c.scenes?.length || 0), 0)} сцен
                      </p>
                    </div>
                  </div>
                </CardHeader>
              </Card>

              {/* Chapters */}
              {structure.chapters.map((ch) => (
                <Collapsible
                  key={ch.chapter_number}
                  open={expandedChapters.has(ch.chapter_number)}
                  onOpenChange={() => toggleChapter(ch.chapter_number)}
                >
                  <Card>
                    <CollapsibleTrigger asChild>
                      <CardHeader className="cursor-pointer hover:bg-muted/30 transition-colors pb-3">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-3">
                            {expandedChapters.has(ch.chapter_number) ? (
                              <ChevronDown className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <ChevronRight className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div>
                              <CardTitle className="text-base">
                                Глава {ch.chapter_number}: {ch.title}
                              </CardTitle>
                              <p className="text-xs text-muted-foreground mt-0.5">
                                {ch.scenes?.length || 0} сцен
                              </p>
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
                            <div
                              key={sc.scene_number}
                              className="rounded-lg border border-border bg-muted/20 p-3 space-y-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                  Сцена {sc.scene_number}: {sc.title}
                                </span>
                                <div className="flex items-center gap-1.5">
                                  <Badge variant="outline" className={`text-[10px] ${typeInfo.color}`}>
                                    {typeInfo.label}
                                  </Badge>
                                  <Badge variant="outline" className="text-[10px]">
                                    {sc.mood}
                                  </Badge>
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
                            </div>
                          );
                        })}
                      </CardContent>
                    </CollapsibleContent>
                  </Card>
                </Collapsible>
              ))}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
