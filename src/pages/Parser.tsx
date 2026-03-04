import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import {
  Upload, FileText, BookOpen, ChevronDown, ChevronRight, Loader2,
  AlertCircle, CheckCircle2, Zap, Layers, PlayCircle, FolderOpen,
  Library, Trash2, ArrowLeft, Clock
} from "lucide-react";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import ModelSelector from "@/components/ModelSelector";
import { DEFAULT_MODEL_ID, isLovableModel } from "@/config/modelRegistry";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel,
  AlertDialogContent, AlertDialogDescription, AlertDialogFooter,
  AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
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
import { t, tSceneType, tMood, tSection } from "@/pages/parser/i18n";
import { useLanguage } from "@/hooks/useLanguage";

const SCENE_TYPE_COLORS: Record<string, string> = {
  action: "bg-red-500/20 text-red-400 border-red-500/30",
  dialogue: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  lyrical_digression: "bg-purple-500/20 text-purple-400 border-purple-500/30",
  description: "bg-green-500/20 text-green-400 border-green-500/30",
  inner_monologue: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30",
  mixed: "bg-muted text-muted-foreground border-border",
};

type Step = "library" | "upload" | "extracting_toc" | "workspace" | "error";
type ChapterStatus = "pending" | "analyzing" | "done" | "error";

interface BookRecord {
  id: string;
  title: string;
  file_name: string;
  status: string;
  created_at: string;
  chapter_count?: number;
  scene_count?: number;
}

const NAV_WIDTH_KEY = "parser-nav-width";

export default function Parser() {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("library");
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [fileName, setFileName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [bookId, setBookId] = useState<string | null>(null);

  // Map partTitle → DB part_id for linking chapters
  const [partIdMap, setPartIdMap] = useState<Map<string, string>>(new Map());

  // TOC state
  const [tocEntries, setTocEntries] = useState<TocChapter[]>([]);
  const [pdfRef, setPdfRef] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  // Model selector
  const [selectedModel, setSelectedModel] = useState(DEFAULT_MODEL_ID);

  // Workspace state
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [chapterResults, setChapterResults] = useState<Map<number, { scenes: Scene[]; status: ChapterStatus }>>(new Map());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  const toggleNode = (key: string) => {
    setExpandedNodes(prev => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  // Auto-expand all nodes on first load
  useEffect(() => {
    if (tocEntries.length > 0 && expandedNodes.size === 0) {
      const allKeys = new Set<string>();
      tocEntries.forEach((e, idx) => {
        if (e.partTitle) allKeys.add(`part:${e.partTitle}`);
        // Auto-expand items that have children
        const hasChild = idx + 1 < tocEntries.length &&
          tocEntries[idx + 1].level > e.level &&
          tocEntries[idx + 1].sectionType === e.sectionType;
        if (hasChild) allKeys.add(`item:${idx}`);
      });
      ["preface", "afterword", "endnotes", "appendix"].forEach(s => {
        if (tocEntries.some(e => e.sectionType === s)) allKeys.add(`section:${s}`);
      });
      setExpandedNodes(allKeys);
    }
  }, [tocEntries]);

  // ─── Library: Load user's books ────────────────────────────

  const loadLibrary = useCallback(async () => {
    if (!user) return;
    setLoadingLibrary(true);
    try {
      const { data: booksData } = await supabase
        .from('books')
        .select('id, title, file_name, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (booksData && booksData.length > 0) {
        // Fetch chapter & scene counts
        const enriched: BookRecord[] = [];
        for (const b of booksData) {
          const { count: chCount } = await supabase
            .from('book_chapters')
            .select('id', { count: 'exact', head: true })
            .eq('book_id', b.id);
          const { data: chapterIds } = await supabase
            .from('book_chapters')
            .select('id')
            .eq('book_id', b.id);
          let scCount = 0;
          if (chapterIds && chapterIds.length > 0) {
            const { count } = await supabase
              .from('book_scenes')
              .select('id', { count: 'exact', head: true })
              .in('chapter_id', chapterIds.map(c => c.id));
            scCount = count || 0;
          }
          enriched.push({
            ...b,
            chapter_count: chCount || 0,
            scene_count: scCount,
          });
        }
        setBooks(enriched);
      } else {
        setBooks([]);
      }
    } catch (err) {
      console.error("Failed to load library:", err);
    } finally {
      setLoadingLibrary(false);
    }
  }, [user]);

  useEffect(() => {
    if (user && step === "library") loadLibrary();
  }, [user, step, loadLibrary]);

  // ─── Open saved book from DB ──────────────────────────────

  const openSavedBook = async (book: BookRecord) => {
    if (!user) return;
    setStep("extracting_toc");
    setFileName(book.file_name);
    setBookId(book.id);

    try {
      // Load chapters with their scenes
      const { data: chapters } = await supabase
        .from('book_chapters')
        .select('id, chapter_number, title, scene_type, mood, bpm')
        .eq('book_id', book.id)
        .order('chapter_number');

      if (!chapters || chapters.length === 0) {
        toast.info("У этой книги ещё нет проанализированных глав. Загрузите PDF заново.");
        setStep("upload");
        return;
      }

      // Build TOC entries from saved chapters
      const savedToc: TocChapter[] = chapters.map(ch => ({
        title: ch.title,
        startPage: 0,
        endPage: 0,
        level: 0,
        sectionType: classifySection(ch.title),
      }));
      setTocEntries(savedToc);
      setTotalPages(0);

      // Load scenes for each chapter
      const initMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const { data: scenes } = await supabase
          .from('book_scenes')
          .select('scene_number, title, content, scene_type, mood, bpm')
          .eq('chapter_id', ch.id)
          .order('scene_number');

        const mappedScenes: Scene[] = (scenes || []).map(s => ({
          scene_number: s.scene_number,
          title: s.title,
          content_preview: s.content || undefined,
          scene_type: s.scene_type || "mixed",
          mood: s.mood || "neutral",
          bpm: s.bpm || 120,
        }));

        initMap.set(i, {
          scenes: mappedScenes,
          status: mappedScenes.length > 0 ? "done" : "pending",
        });
      }
      setChapterResults(initMap);
      setStep("workspace");
      toast.success(`Книга "${book.title}" загружена из библиотеки`);
    } catch (err: any) {
      console.error("Failed to open book:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
    }
  };

  // ─── Delete book ──────────────────────────────────────────

  const deleteBook = async (bookId: string) => {
    try {
      // Scenes are cascade-deleted via chapter FK
      await supabase.from('book_chapters').delete().eq('book_id', bookId);
      await supabase.from('book_parts').delete().eq('book_id', bookId);
      await supabase.from('books').delete().eq('id', bookId);
      setBooks(prev => prev.filter(b => b.id !== bookId));
      toast.success("Книга удалена");
    } catch (err) {
      console.error("Failed to delete book:", err);
      toast.error("Не удалось удалить книгу");
    }
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

      // Save parts to DB
      const uniqueParts = [...new Set(chapters.map(c => c.partTitle).filter(Boolean))] as string[];
      const newPartIdMap = new Map<string, string>();
      for (let i = 0; i < uniqueParts.length; i++) {
        const { data: partRow } = await supabase
          .from('book_parts')
          .insert({
            book_id: book.id,
            part_number: i + 1,
            title: uniqueParts[i],
          })
          .select('id')
          .single();
        if (partRow) {
          newPartIdMap.set(uniqueParts[i], partRow.id);
        }
      }
      setPartIdMap(newPartIdMap);

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

      // Only send user API key for non-Lovable models
      let userKey: string | null = null;
      if (!isLovableModel(selectedModel)) {
        const { data: profile } = await supabase
          .from('profiles')
          .select('api_keys')
          .eq('id', user.id)
          .single();
        const apiKeys = (profile?.api_keys as Record<string, string>) || {};
        userKey = apiKeys.openai || apiKeys.gemini || null;
      }

      const { data: fnData, error: fnError } = await supabase.functions.invoke('parse-book-structure', {
        body: { text, user_api_key: userKey, user_model: selectedModel, mode: "chapter", chapter_title: entry.title },
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
        const partId = entry.partTitle ? partIdMap.get(entry.partTitle) : null;
        const { data: chRow } = await supabase
          .from('book_chapters')
          .insert({
            book_id: bookId,
            chapter_number: idx + 1,
            title: entry.title,
            ...(partId ? { part_id: partId } : {}),
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

  // ─── Background Prefetch: auto-analyze next 1–3 chapters ───

  const prefetchingRef = useRef(false);

  useEffect(() => {
    if (prefetchingRef.current) return;
    // Find indices that are "done" — prefetch next pending ones
    const doneIndices = Array.from(chapterResults.entries())
      .filter(([, r]) => r.status === "done")
      .map(([i]) => i);
    if (doneIndices.length === 0) return;

    const maxDone = Math.max(...doneIndices);
    const nextPending: number[] = [];
    for (let i = maxDone + 1; i < tocEntries.length && nextPending.length < 3; i++) {
      const r = chapterResults.get(i);
      if (r && r.status === "pending" && tocEntries[i].sectionType === "content") {
        nextPending.push(i);
      }
    }
    if (nextPending.length === 0) return;

    prefetchingRef.current = true;
    (async () => {
      for (const idx of nextPending) {
        const current = chapterResults.get(idx);
        if (current?.status === "pending") {
          await analyzeChapter(idx);
        }
      }
      prefetchingRef.current = false;
    })();
  }, [chapterResults, tocEntries]);

  // ─── Reset ─────────────────────────────────────────────────

  const handleReset = () => {
    setStep("library");
    setFileName("");
    setErrorMsg("");
    setBookId(null);
    setPartIdMap(new Map());
    setTocEntries([]);
    setPdfRef(null);
    setFile(null);
    setSelectedIdx(null);
    setChapterResults(new Map());
    setExpandedNodes(new Set());
    prefetchingRef.current = false;
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

  // Track which indices are "consumed" as children of another entry
  const childOfAnother = new Set<number>();
  tocEntries.forEach((entry, idx) => {
    if (entry.sectionType !== "content") return;
    // Mark subsequent deeper-level entries as children
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      childOfAnother.add(i);
    }
  });

  tocEntries.forEach((entry, idx) => {
    if (entry.sectionType !== "content") return;
    const key = entry.partTitle || "";
    if (key) {
      if (!partMap.has(key)) {
        partMap.set(key, []);
        partGroups.push({ title: key, indices: partMap.get(key)! });
      }
      // Only add root-level entries within the part; children are rendered recursively
      if (!childOfAnother.has(idx)) {
        partMap.get(key)!.push(idx);
      }
    } else {
      if (!childOfAnother.has(idx)) {
        partlessIndices.push(idx);
      }
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
        {step === "workspace" && (
          <div className="flex items-center gap-3">
            <ModelSelector value={selectedModel} onChange={setSelectedModel} isRu={isRu} />
            <div className="text-xs text-muted-foreground">
              {analyzedCount}/{tocEntries.length} {t("chapters", isRu)} • {totalScenes} {t("scenes", isRu)}
            </div>
            <Button variant="outline" size="sm" onClick={handleReset} className="gap-1.5">
              <ArrowLeft className="h-3 w-3" />
              {t("libraryBack", isRu)}
            </Button>
          </div>
        )}
        {step === "upload" && (
          <Button variant="ghost" size="sm" onClick={() => setStep("library")} className="gap-1.5">
            <ArrowLeft className="h-3 w-3" />
            {t("libraryBack", isRu)}
          </Button>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        <AnimatePresence mode="wait">

          {/* ═══ LIBRARY ═══ */}
          {step === "library" && (
            <motion.div key="library" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -20 }}
              className="flex-1 h-full overflow-auto">
              <div className="max-w-3xl mx-auto py-8 px-6 space-y-6">
                <div className="flex items-center justify-between">
                  <h2 className="font-display text-xl font-semibold text-foreground">{t("libraryTitle", isRu)}</h2>
                  <Button variant="outline" size="sm" onClick={() => setStep("upload")} className="gap-2">
                    <Upload className="h-4 w-4" />
                    {t("libraryUpload", isRu)}
                  </Button>
                </div>

                {loadingLibrary ? (
                  <div className="flex items-center justify-center py-16 gap-3 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">{t("libraryLoading", isRu)}</span>
                  </div>
                ) : books.length === 0 ? (
                  <Card className="border-dashed">
                    <CardContent className="py-16 flex flex-col items-center gap-4 text-muted-foreground">
                      <Library className="h-12 w-12 opacity-30" />
                      <p className="text-sm">{t("libraryEmpty", isRu)}</p>
                      <Button variant="outline" onClick={() => setStep("upload")} className="gap-2">
                        <Upload className="h-4 w-4" />
                        {t("libraryUpload", isRu)}
                      </Button>
                    </CardContent>
                  </Card>
                ) : (
                  <div className="space-y-2">
                    {books.map(book => (
                      <Card key={book.id} className="hover:border-primary/30 transition-colors group">
                        <CardContent className="py-3 px-4 flex items-center gap-4">
                          <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                            <BookOpen className="h-5 w-5 text-primary" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-sm text-foreground truncate">{book.title}</p>
                            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-0.5">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {new Date(book.created_at).toLocaleDateString(isRu ? 'ru-RU' : 'en-US')}
                              </span>
                              {(book.chapter_count || 0) > 0 && (
                                <span>{book.chapter_count} {t("libraryChapters", isRu)}</span>
                              )}
                              {(book.scene_count || 0) > 0 && (
                                <span>{book.scene_count} {t("libraryScenes", isRu)}</span>
                              )}
                              <Badge variant="outline" className="text-[10px]">
                                {(book.chapter_count || 0) > 0 ? t("libraryAnalyzed", isRu) : t("libraryUploaded", isRu)}
                              </Badge>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="outline" size="sm" onClick={() => openSavedBook(book)} className="gap-1.5 text-xs">
                              <FolderOpen className="h-3 w-3" />
                              {t("libraryOpen", isRu)}
                            </Button>
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive h-8 w-8 p-0">
                                  <Trash2 className="h-3.5 w-3.5" />
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>{isRu ? "Удалить книгу?" : "Delete book?"}</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    {isRu
                                      ? `«${book.title}» и все результаты анализа будут удалены безвозвратно.`
                                      : `"${book.title}" and all analysis results will be permanently deleted.`}
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
                                  <AlertDialogAction onClick={() => deleteBook(book.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                                    {t("libraryDelete", isRu)}
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          </div>
                        </CardContent>
                      </Card>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          )}

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
                    <p className="font-display font-semibold text-lg text-foreground">{t("uploadTitle", isRu)}</p>
                    <p className="text-sm text-muted-foreground mt-1">{t("uploadHint", isRu)}</p>
                  </div>
                  <Button variant="outline" size="lg">
                    <Upload className="h-4 w-4 mr-2" />
                    {t("selectFile", isRu)}
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

              <ResizablePanelGroup
                direction="horizontal"
                autoSaveId={NAV_WIDTH_KEY}
              >
                {/* ── Left Panel: Navigator ── */}
                <ResizablePanel defaultSize={22} minSize={14} maxSize={45}>
                  <div className="flex flex-col h-full bg-card/50">
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
                        {renderNavSection("preface")}

                        {partGroups.map((group) => {
                          const partKey = `part:${group.title}`;
                          const isExpanded = expandedNodes.has(partKey);
                          return (
                            <div key={group.title}>
                              <button
                                onClick={() => toggleNode(partKey)}
                                className="w-full flex items-center gap-1.5 px-4 py-1.5 text-xs font-semibold text-primary hover:bg-muted/30 transition-colors"
                              >
                                {isExpanded ? (
                                  <ChevronDown className="h-3 w-3 flex-shrink-0" />
                                ) : (
                                  <ChevronRight className="h-3 w-3 flex-shrink-0" />
                                )}
                                <FolderOpen className="h-3 w-3 flex-shrink-0" />
                                <span className="truncate">{group.title}</span>
                                <span className="ml-auto text-[10px] text-muted-foreground font-normal">{group.indices.length}</span>
                              </button>
                              {isExpanded && (
                                <div>
                                  {group.indices.map(idx => renderNavItem(idx, 1))}
                                </div>
                              )}
                            </div>
                          );
                        })}

                        {partlessIndices.map(idx => renderNavItem(idx, 0))}

                        {renderNavSection("afterword")}
                        {renderNavSection("endnotes")}
                        {renderNavSection("appendix")}
                      </div>
                    </ScrollArea>
                  </div>
                </ResizablePanel>

                <ResizableHandle withHandle />

                {/* ── Right Panel: Chapter Detail ── */}
                <ResizablePanel defaultSize={78}>
                  <div className="flex-1 flex flex-col h-full overflow-hidden">
                    {selectedIdx === null ? (
                      <div className="flex-1 flex items-center justify-center text-muted-foreground">
                        <div className="text-center space-y-3">
                          <Layers className="h-12 w-12 mx-auto opacity-30" />
                          <p className="text-sm">Выберите главу для анализа</p>
                        </div>
                      </div>
                    ) : selectedEntry && (
                      <ScrollArea className="flex-1">
                        <div className="p-6 space-y-4">
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

                                {selectedResult?.status === "pending" && (
                                  <Button variant="outline" size="sm" onClick={() => analyzeChapter(selectedIdx)} className="gap-2">
                                    <PlayCircle className="h-4 w-4" />
                                    Анализировать
                                  </Button>
                                )}
                                {selectedResult?.status === "done" && (
                                  <Button variant="ghost" size="sm" onClick={() => analyzeChapter(selectedIdx)} className="gap-2 text-muted-foreground">
                                    <Zap className="h-4 w-4" />
                                    Повторить
                                  </Button>
                                )}
                                {selectedResult?.status === "error" && (
                                  <Button variant="outline" size="sm" onClick={() => analyzeChapter(selectedIdx)} className="gap-2 border-destructive/30 text-destructive">
                                    <AlertCircle className="h-4 w-4" />
                                    Повторить
                                  </Button>
                                )}
                              </div>
                            </CardHeader>
                          </Card>

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

                          {selectedResult?.status === "pending" && (
                            <Card className="border-dashed">
                              <CardContent className="py-8 flex flex-col items-center gap-3 text-muted-foreground">
                                <PlayCircle className="h-10 w-10 opacity-30" />
                                <p className="text-sm">Нажмите «Анализировать» для AI-декомпозиции на сцены</p>
                              </CardContent>
                            </Card>
                          )}

                          {selectedResult?.status === "error" && (
                            <Card className="border-destructive/30">
                              <CardContent className="py-6 flex flex-col items-center gap-3">
                                <AlertCircle className="h-8 w-8 text-destructive" />
                                <p className="text-sm text-muted-foreground">Ошибка при анализе. Попробуйте снова.</p>
                              </CardContent>
                            </Card>
                          )}

                          {selectedResult?.status === "done" && selectedResult.scenes.length > 0 && (
                            <div className="space-y-2">
                              <h3 className="text-sm font-semibold text-muted-foreground px-1">
                                {selectedResult.scenes.length} {t("scenes", isRu)}
                              </h3>
                              {selectedResult.scenes.map((sc) => {
                                const colorCls = SCENE_TYPE_COLORS[sc.scene_type] || SCENE_TYPE_COLORS.mixed;
                                return (
                                  <Card key={sc.scene_number}>
                                    <CardContent className="py-3 px-4 space-y-2">
                                      <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium">
                                          {t("scenePrefix", isRu)} {sc.scene_number}: {sc.title}
                                        </span>
                                        <div className="flex items-center gap-1.5">
                                          <Badge variant="outline" className={`text-[10px] ${colorCls}`}>
                                            {tSceneType(sc.scene_type, isRu)}
                                          </Badge>
                                          <Badge variant="outline" className="text-[10px]">{tMood(sc.mood, isRu)}</Badge>
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
                </ResizablePanel>
              </ResizablePanelGroup>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );

  // ─── Nav Sidebar Helpers ───────────────────────────────────

  function renderNavItem(idx: number, depth: number = 0) {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    const isSelected = selectedIdx === idx;
    const status = result?.status || "pending";

    // Check if this entry has "children" (subsequent entries with higher level)
    const hasChildren = idx + 1 < tocEntries.length &&
      tocEntries[idx + 1].level > entry.level &&
      tocEntries[idx + 1].sectionType === entry.sectionType;

    const childIndices: number[] = [];
    if (hasChildren) {
      for (let i = idx + 1; i < tocEntries.length; i++) {
        if (tocEntries[i].level <= entry.level) break;
        if (tocEntries[i].sectionType !== entry.sectionType) break;
        childIndices.push(i);
      }
    }

    // Only show direct children (next level down)
    const directChildren = childIndices.filter(i => tocEntries[i].level === entry.level + 1);
    const nodeKey = `item:${idx}`;
    const isExpanded = expandedNodes.has(nodeKey);
    const paddingLeft = `${(depth + 1) * 12 + 16}px`;

    return (
      <div key={idx}>
        <button
          onClick={() => {
            if (hasChildren && directChildren.length > 0) {
              toggleNode(nodeKey);
            }
            setSelectedIdx(idx);
            if (status === "pending") analyzeChapter(idx);
          }}
          style={{ paddingLeft }}
          className={`w-full flex items-center gap-1.5 pr-4 py-1.5 text-left text-xs transition-colors ${
            isSelected
              ? "bg-primary/10 text-primary border-r-2 border-primary"
              : "text-foreground/70 hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          {hasChildren && directChildren.length > 0 ? (
            <span className="flex-shrink-0" onClick={(e) => { e.stopPropagation(); toggleNode(nodeKey); }}>
              {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            </span>
          ) : (
            <span className="w-3 flex-shrink-0" />
          )}
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
        {isExpanded && directChildren.length > 0 && (
          <div>
            {directChildren.map(childIdx => renderNavItem(childIdx, depth + 1))}
          </div>
        )}
      </div>
    );
  }

  function renderNavSection(type: SectionType) {
    const entries = tocEntries
      .map((e, i) => ({ entry: e, idx: i }))
      .filter(({ entry }) => entry.sectionType === type);
    if (entries.length === 0) return null;

    const sectionKey = `section:${type}`;
    const isExpanded = expandedNodes.has(sectionKey);

    return (
      <>
        <button
          onClick={() => toggleNode(sectionKey)}
          className="w-full flex items-center gap-1.5 px-4 py-1 mt-2 text-left"
        >
          {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {SECTION_ICONS[type]} {tSection(type, isRu)}
          </span>
          <span className="ml-auto text-[10px] text-muted-foreground">{entries.length}</span>
        </button>
        {isExpanded && entries.map(({ idx }) => renderNavItem(idx, 0))}
      </>
    );
  }
}
