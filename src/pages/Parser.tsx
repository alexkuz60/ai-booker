import { useState, useRef, useCallback, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { ResizablePanelGroup, ResizablePanel, ResizableHandle } from "@/components/ui/resizable";
import { Button } from "@/components/ui/button";
import ModelSelector from "@/components/ModelSelector";
import { DEFAULT_MODEL_ID } from "@/config/modelRegistry";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { useLanguage } from "@/hooks/useLanguage";
import {
  extractOutline, flattenTocWithRanges, type TocEntry
} from "@/lib/pdf-extract";
import { saveStudioChapter } from "@/lib/studioChapter";
import { t } from "@/pages/parser/i18n";
import type {
  Scene, TocChapter, Step, ChapterStatus, BookRecord,
} from "@/pages/parser/types";
import { classifySection, normalizeLevels, NAV_WIDTH_KEY, ACTIVE_BOOK_KEY } from "@/pages/parser/types";
import { useChapterAnalysis } from "@/hooks/useChapterAnalysis";

// UI components
import LibraryView from "@/components/parser/LibraryView";
import UploadView from "@/components/parser/UploadView";
import { ExtractingTocView, ErrorView } from "@/components/parser/StatusViews";
import NavSidebar from "@/components/parser/NavSidebar";
import ChapterDetailPanel from "@/components/parser/ChapterDetailPanel";

export default function Parser() {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>(() =>
    sessionStorage.getItem(ACTIVE_BOOK_KEY) ? "extracting_toc" : "library"
  );
  const [books, setBooks] = useState<BookRecord[]>([]);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [fileName, setFileName] = useState("");
  const [errorMsg, setErrorMsg] = useState("");
  const [bookId, setBookId] = useState<string | null>(null);

  const [partIdMap, setPartIdMap] = useState<Map<string, string>>(new Map());
  const [chapterIdMap, setChapterIdMap] = useState<Map<number, string>>(new Map());

  const [tocEntries, setTocEntries] = useState<TocChapter[]>([]);
  const [pdfRef, setPdfRef] = useState<any>(null);
  const [totalPages, setTotalPages] = useState(0);
  const [file, setFile] = useState<File | null>(null);

  const { value: selectedModel, update: setSelectedModel } = useCloudSettings('parser-model', DEFAULT_MODEL_ID);
  const [userApiKeys, setUserApiKeys] = useState<Record<string, string>>({});

  const [selectedIdx, setSelectedIdx] = useState<number | null>(null);
  const [chapterResults, setChapterResults] = useState<Map<number, { scenes: Scene[]; status: ChapterStatus }>>(new Map());
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(new Set());

  // ─── Analysis hook ─────────────────────────────────────────
  const { analysisLog, analyzeChapter, resetAnalysis } = useChapterAnalysis({
    isRu, pdfRef, userId: user?.id, selectedModel, userApiKeys,
    tocEntries, chapterIdMap, chapterResults, setChapterResults,
  });

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

  // ─── Load user API keys ─────────────────────────────────────
  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('api_keys').eq('id', user.id).single()
      .then(({ data }) => {
        if (data?.api_keys) setUserApiKeys(data.api_keys as Record<string, string>);
      });
  }, [user]);

  // ─── Library: Load user's books ────────────────────────────
  const loadLibrary = useCallback(async () => {
    if (!user) return;
    setLoadingLibrary(true);
    try {
      const { data: booksData } = await supabase
        .from('books')
        .select('id, title, file_name, file_path, status, created_at')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false });

      if (booksData && booksData.length > 0) {
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
          enriched.push({ ...b, chapter_count: chCount || 0, scene_count: scCount });
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

  useEffect(() => { if (user) loadLibrary(); }, [user, loadLibrary]);

  // ─── Auto-restore active book on mount ─────────────────────
  const [restoredOnce, setRestoredOnce] = useState(false);
  useEffect(() => {
    if (restoredOnce || !user || loadingLibrary) return;
    const savedBookId = sessionStorage.getItem(ACTIVE_BOOK_KEY);
    if (!savedBookId) {
      if (step === "extracting_toc") setStep("library");
      setRestoredOnce(true);
      return;
    }
    const book = books.find(b => b.id === savedBookId);
    if (book) {
      setRestoredOnce(true);
      openSavedBook(book);
    } else if (books.length > 0) {
      sessionStorage.removeItem(ACTIVE_BOOK_KEY);
      setStep("library");
      setRestoredOnce(true);
    }
  }, [user, loadingLibrary, books, restoredOnce]);

  // ─── Open saved book from DB ──────────────────────────────
  const openSavedBook = async (book: BookRecord) => {
    if (!user) return;
    setStep("extracting_toc");
    setFileName(book.file_name);
    setBookId(book.id);
    sessionStorage.setItem(ACTIVE_BOOK_KEY, book.id);

    try {
      const [partsRes, chaptersRes, pdfBlob] = await Promise.all([
        supabase.from('book_parts').select('id, part_number, title').eq('book_id', book.id).order('part_number'),
        supabase.from('book_chapters').select('id, chapter_number, title, scene_type, mood, bpm, part_id').eq('book_id', book.id).order('chapter_number'),
        book.file_path
          ? supabase.storage.from('book-uploads').download(book.file_path).then(r => r.data)
          : Promise.resolve(null),
      ]);

      const parts = partsRes.data || [];
      const chapters = chaptersRes.data || [];

      if (chapters.length === 0) {
        toast.info(isRu ? "У этой книги ещё нет глав. Загрузите PDF заново." : "No chapters found. Please re-upload the PDF.");
        setStep("upload");
        return;
      }

      let restoredPdf: any = null;
      let restoredTotalPages = 0;
      let tocFromPdf: { startPage: number; endPage: number; level: number }[] = [];

      if (pdfBlob) {
        try {
          const arrayBuffer = await pdfBlob.arrayBuffer();
          const { getDocument } = await import('pdfjs-dist');
          const pdf = await getDocument({ data: arrayBuffer }).promise;
          restoredPdf = pdf;
          restoredTotalPages = pdf.numPages;

          const rawOutline = await pdf.getOutline();
          if (rawOutline && rawOutline.length > 0) {
            const flat = flattenTocWithRanges(
              await (async function parseItems(items: any[], level: number): Promise<TocEntry[]> {
                const entries: TocEntry[] = [];
                for (const item of items) {
                  let pageNumber = 1;
                  try {
                    if (item.dest) {
                      const dest = typeof item.dest === 'string' ? await pdf.getDestination(item.dest) : item.dest;
                      if (dest && dest[0]) {
                        const pageIndex = await pdf.getPageIndex(dest[0]);
                        pageNumber = pageIndex + 1;
                      }
                    }
                  } catch { /* fallback */ }
                  const children = item.items?.length ? await parseItems(item.items, level + 1) : [];
                  entries.push({ title: item.title || 'Untitled', pageNumber, level, children });
                }
                return entries;
              })(rawOutline, 0),
              pdf.numPages
            );

            tocFromPdf = chapters.map((ch, i) => {
              const byTitle = flat.find(f => f.title === ch.title);
              if (byTitle) return { startPage: byTitle.startPage, endPage: byTitle.endPage, level: byTitle.level };
              if (i < flat.length) return { startPage: flat[i].startPage, endPage: flat[i].endPage, level: flat[i].level };
              return { startPage: 0, endPage: 0, level: 0 };
            });
          }
        } catch (pdfErr) {
          console.warn("Could not restore PDF for analysis:", pdfErr);
        }
      }

      setPdfRef(restoredPdf);
      setTotalPages(restoredTotalPages);

      const partById = new Map<string, string>();
      const newPartIdMap = new Map<string, string>();
      for (const p of parts) {
        partById.set(p.id, p.title);
        newPartIdMap.set(p.title, p.id);
      }
      setPartIdMap(newPartIdMap);

      const hasParts = parts.length > 0;
      const savedToc: TocChapter[] = chapters.map((ch, i) => {
        const pdfInfo = tocFromPdf[i];
        return {
          title: ch.title,
          startPage: pdfInfo?.startPage || 0,
          endPage: pdfInfo?.endPage || 0,
          level: pdfInfo?.level ?? (hasParts && ch.part_id ? 1 : 0),
          partTitle: ch.part_id ? partById.get(ch.part_id) : undefined,
          sectionType: classifySection(ch.title),
        };
      });
      setTocEntries(normalizeLevels(savedToc));

      const newChapterIdMap = new Map<number, string>();
      chapters.forEach((ch, i) => newChapterIdMap.set(i, ch.id));
      setChapterIdMap(newChapterIdMap);

      const allChapterIds = chapters.map(c => c.id);
      const { data: allScenes } = await supabase
        .from('book_scenes')
        .select('id, chapter_id, scene_number, title, content, scene_type, mood, bpm')
        .in('chapter_id', allChapterIds)
        .order('scene_number');

      const scenesByChapter = new Map<string, Scene[]>();
      for (const s of (allScenes || [])) {
        const list = scenesByChapter.get(s.chapter_id) || [];
        list.push({
          id: s.id, scene_number: s.scene_number, title: s.title,
          content: s.content || undefined,
          content_preview: (s.content || '').slice(0, 200) || undefined,
          scene_type: s.scene_type || "mixed", mood: s.mood || "neutral", bpm: s.bpm || 120,
        });
        scenesByChapter.set(s.chapter_id, list);
      }

      const initMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
      chapters.forEach((ch, i) => {
        const scenes = scenesByChapter.get(ch.id) || [];
        initMap.set(i, { scenes, status: scenes.length > 0 ? "done" : "pending" });
      });

      setChapterResults(initMap);
      setStep("workspace");
      const pdfStatus = restoredPdf
        ? (isRu ? ' (PDF восстановлен, анализ доступен)' : ' (PDF restored, analysis available)')
        : (isRu ? ' (PDF не найден, только просмотр)' : ' (PDF not found, view only)');
      toast.success((isRu ? `Книга «${book.title}» загружена` : `Book "${book.title}" loaded`) + pdfStatus);
    } catch (err: any) {
      console.error("Failed to open book:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
    }
  };

  // ─── Delete book ──────────────────────────────────────────
  const deleteBook = async (delBookId: string) => {
    try {
      await supabase.from('book_chapters').delete().eq('book_id', delBookId);
      await supabase.from('book_parts').delete().eq('book_id', delBookId);
      await supabase.from('books').delete().eq('id', delBookId);
      setBooks(prev => prev.filter(b => b.id !== delBookId));
      toast.success(isRu ? "Книга удалена" : "Book deleted");
    } catch (err) {
      console.error("Failed to delete book:", err);
      toast.error(isRu ? "Не удалось удалить книгу" : "Failed to delete book");
    }
  };

  // ─── File Upload & TOC Extraction ──────────────────────────
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !user) return;

    if (!f.name.toLowerCase().endsWith('.pdf')) {
      toast.error(t("onlyPdf", isRu));
      return;
    }
    if (f.size > 20 * 1024 * 1024) {
      toast.error(t("maxSize", isRu));
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
              title: entry.title, startPage: entry.startPage, endPage: entry.endPage,
              level: entry.level, partTitle: currentPart || undefined,
              sectionType: classifySection(entry.title),
            });
          }
        }
        if (chapters.length === 0) {
          for (const entry of flat) {
            chapters.push({
              title: entry.title, startPage: entry.startPage, endPage: entry.endPage,
              level: entry.level, sectionType: classifySection(entry.title),
            });
          }
        }
        toast.success(`${t("tocFound", isRu)}: ${chapters.length} ${t("items", isRu)}`);
      } else {
        toast.info(t("tocNotFound", isRu));
        chapters = [{
          title: f.name.replace('.pdf', ''),
          startPage: 1, endPage: pdf.numPages, level: 0, sectionType: "content",
        }];
      }

      setTocEntries(normalizeLevels(chapters));

      const filePath = `${user.id}/${Date.now()}_${f.name}`;
      await supabase.storage.from('book-uploads').upload(filePath, f);
      const { data: book, error: bookErr } = await supabase
        .from('books')
        .insert({ user_id: user.id, title: f.name.replace('.pdf', ''), file_name: f.name, file_path: filePath, status: 'uploaded' })
        .select('id').single();
      if (bookErr) throw bookErr;
      setBookId(book.id);
      sessionStorage.setItem(ACTIVE_BOOK_KEY, book.id);

      const uniqueParts = [...new Set(chapters.map(c => c.partTitle).filter(Boolean))] as string[];
      const newPartIdMap = new Map<string, string>();
      for (let i = 0; i < uniqueParts.length; i++) {
        const { data: partRow } = await supabase
          .from('book_parts').insert({ book_id: book.id, part_number: i + 1, title: uniqueParts[i] })
          .select('id').single();
        if (partRow) newPartIdMap.set(uniqueParts[i], partRow.id);
      }
      setPartIdMap(newPartIdMap);

      const newChapterIdMap = new Map<number, string>();
      for (let i = 0; i < chapters.length; i++) {
        const ch = chapters[i];
        const partId = ch.partTitle ? newPartIdMap.get(ch.partTitle) : null;
        const { data: chRow } = await supabase
          .from('book_chapters')
          .insert({
            book_id: book.id, chapter_number: i + 1, title: ch.title,
            scene_type: ch.sectionType !== 'content' ? ch.sectionType : null,
            ...(partId ? { part_id: partId } : {}),
          })
          .select('id').single();
        if (chRow) newChapterIdMap.set(i, chRow.id);
      }
      setChapterIdMap(newChapterIdMap);

      const initMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
      chapters.forEach((_, i) => initMap.set(i, { scenes: [], status: "pending" }));
      setChapterResults(initMap);

      setStep("workspace");
    } catch (err: any) {
      console.error("Parser error:", err);
      const msg = err.message || "Unknown error";
      let userErr: string;
      if (/402|payment|credits/i.test(msg)) userErr = t("errPayment", isRu);
      else if (/429|rate.?limit/i.test(msg)) userErr = t("errRateLimit", isRu);
      else if (/timeout|timed?\s?out/i.test(msg)) userErr = t("errTimeout", isRu);
      else if (/api.?key/i.test(msg)) userErr = t("errNoApiKey", isRu);
      else if (/fetch|network/i.test(msg)) userErr = t("errNetwork", isRu);
      else userErr = msg;
      setErrorMsg(userErr);
      setStep("error");
      toast.error(userErr, { duration: 8000 });
    }

    if (fileInputRef.current) fileInputRef.current.value = "";
  }, [user, isRu]);

  // ─── Reset ─────────────────────────────────────────────────
  const handleReset = () => {
    setStep("library");
    sessionStorage.removeItem(ACTIVE_BOOK_KEY);
    setFileName(""); setErrorMsg(""); setBookId(null);
    setPartIdMap(new Map()); setChapterIdMap(new Map());
    setTocEntries([]); setPdfRef(null); setFile(null);
    setSelectedIdx(null); setChapterResults(new Map());
    setExpandedNodes(new Set());
    resetAnalysis();
  };

  // ─── Computed helpers ──────────────────────────────────────
  const selectedEntry = selectedIdx !== null ? tocEntries[selectedIdx] : null;
  const selectedResult = selectedIdx !== null ? chapterResults.get(selectedIdx) : null;

  const contentEntries = tocEntries.filter(e => e.sectionType === "content");
  const supplementaryEntries = tocEntries.filter(e => e.sectionType !== "content");

  const analyzedCount = Array.from(chapterResults.values()).filter(r => r.status === "done").length;
  const totalScenes = Array.from(chapterResults.values()).reduce((a, r) => a + r.scenes.length, 0);

  const isChapterFullyDone = (idx: number): boolean => {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    if (!result || result.status !== "done" || result.scenes.length === 0) return false;
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      const childResult = chapterResults.get(i);
      if (!childResult || childResult.status !== "done" || childResult.scenes.length === 0) return false;
    }
    return true;
  };

  const sendToStudio = (idx: number) => {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    if (!result) return;
    const allScenes = [...result.scenes];
    for (let i = idx + 1; i < tocEntries.length; i++) {
      if (tocEntries[i].level <= entry.level) break;
      if (tocEntries[i].sectionType !== entry.sectionType) break;
      const childResult = chapterResults.get(i);
      if (childResult) allScenes.push(...childResult.scenes);
    }
    saveStudioChapter({ chapterTitle: entry.title, bookTitle: fileName.replace('.pdf', ''), scenes: allScenes });
    navigate("/studio");
  };

  // Part grouping
  const partGroups: { title: string; indices: number[] }[] = [];
  const partlessIndices: number[] = [];
  const partMap = new Map<string, number[]>();
  const childOfAnother = new Set<number>();

  tocEntries.forEach((entry, idx) => {
    if (entry.sectionType !== "content") return;
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
      if (!childOfAnother.has(idx)) partMap.get(key)!.push(idx);
    } else {
      if (!childOfAnother.has(idx)) partlessIndices.push(idx);
    }
  });

  // ─── Render ────────────────────────────────────────────────
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex-1 flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div>
          <h1 className="font-display text-2xl font-bold text-foreground">{t("parserTitle", isRu)}</h1>
          <p className="text-sm text-muted-foreground font-body">{t("parserSubtitle", isRu)}</p>
        </div>
        {step === "workspace" && (
          <div className="flex items-center gap-3">
            <ModelSelector value={selectedModel} onChange={setSelectedModel} isRu={isRu} userApiKeys={userApiKeys} />
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
          {step === "library" && (
            <LibraryView
              isRu={isRu} books={books} loadingLibrary={loadingLibrary}
              onUpload={() => setStep("upload")} onOpen={openSavedBook} onDelete={deleteBook}
            />
          )}

          {step === "upload" && (
            <UploadView isRu={isRu} fileInputRef={fileInputRef} onFileSelect={handleFileSelect} />
          )}

          {step === "extracting_toc" && (
            <ExtractingTocView fileName={fileName} isRu={isRu} />
          )}

          {step === "error" && (
            <ErrorView errorMsg={errorMsg} isRu={isRu} onReset={handleReset} />
          )}

          {step === "workspace" && (
            <motion.div key="workspace" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              className="flex h-full min-h-0 overflow-hidden">
              <ResizablePanelGroup direction="horizontal" autoSaveId={NAV_WIDTH_KEY}>
                <ResizablePanel defaultSize={22} minSize={14} maxSize={45}>
                  <NavSidebar
                    isRu={isRu} fileName={fileName} totalPages={totalPages}
                    tocEntries={tocEntries} chapterResults={chapterResults}
                    selectedIdx={selectedIdx} expandedNodes={expandedNodes}
                    contentEntries={contentEntries} supplementaryEntries={supplementaryEntries}
                    partGroups={partGroups} partlessIndices={partlessIndices}
                    onSelectChapter={setSelectedIdx} onAnalyzeChapter={analyzeChapter}
                    onToggleNode={toggleNode} onSendToStudio={sendToStudio}
                    isChapterFullyDone={isChapterFullyDone}
                  />
                </ResizablePanel>
                <ResizableHandle withHandle />
                <ResizablePanel defaultSize={78}>
                  <div className="flex-1 flex flex-col h-full overflow-hidden">
                    <ChapterDetailPanel
                      isRu={isRu} selectedIdx={selectedIdx}
                      selectedEntry={selectedEntry} selectedResult={selectedResult}
                      analysisLog={analysisLog} onAnalyze={analyzeChapter}
                    />
                  </div>
                </ResizablePanel>
              </ResizablePanelGroup>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  );
}
