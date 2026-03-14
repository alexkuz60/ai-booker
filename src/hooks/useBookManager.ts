import { useState, useRef, useCallback, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import {
  extractOutline, extractTocFromText, flattenTocWithRanges, type TocEntry
} from "@/lib/pdf-extract";
import { t } from "@/pages/parser/i18n";
import type {
  Scene, TocChapter, Step, ChapterStatus, BookRecord,
} from "@/pages/parser/types";
import { classifySection, normalizeLevels, ACTIVE_BOOK_KEY } from "@/pages/parser/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import { syncStructureToLocal } from "@/lib/localSync";

interface UseBookManagerParams {
  userId: string | undefined;
  isRu: boolean;
  /** Optional local project storage for dual-write */
  projectStorage?: ProjectStorage | null;
}

export function useBookManager({ userId, isRu, projectStorage }: UseBookManagerParams) {
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

  const [chapterResults, setChapterResults] = useState<Map<number, { scenes: Scene[]; status: ChapterStatus }>>(new Map());

  // ─── Library: Load user's books ────────────────────────────
  const loadLibrary = useCallback(async () => {
    if (!userId) return;
    setLoadingLibrary(true);
    try {
      const { data: booksData } = await supabase
        .from('books')
        .select('id, title, file_name, file_path, status, created_at')
        .eq('user_id', userId)
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
  }, [userId]);

  useEffect(() => { if (userId) loadLibrary(); }, [userId, loadLibrary]);

  // ─── Auto-restore active book on mount ─────────────────────
  const [restoredOnce, setRestoredOnce] = useState(false);
  const openSavedBookRef = useRef<(book: BookRecord) => Promise<void>>();

  useEffect(() => {
    if (restoredOnce || !userId || loadingLibrary) return;
    const savedBookId = sessionStorage.getItem(ACTIVE_BOOK_KEY);
    if (!savedBookId) {
      if (step === "extracting_toc") setStep("library");
      setRestoredOnce(true);
      return;
    }
    const book = books.find(b => b.id === savedBookId);
    if (book) {
      setRestoredOnce(true);
      openSavedBookRef.current?.(book);
    } else if (books.length > 0) {
      sessionStorage.removeItem(ACTIVE_BOOK_KEY);
      setStep("library");
      setRestoredOnce(true);
    }
  }, [userId, loadingLibrary, books, restoredOnce]);

  // ─── Open saved book from DB ──────────────────────────────
  const openSavedBook = useCallback(async (book: BookRecord) => {
    if (!userId) return;
    setStep("extracting_toc");
    setFileName(book.file_name);
    setBookId(book.id);
    sessionStorage.setItem(ACTIVE_BOOK_KEY, book.id);

    try {
      const [partsRes, chaptersRes, pdfBlob] = await Promise.all([
        supabase.from('book_parts').select('id, part_number, title').eq('book_id', book.id).order('part_number'),
        supabase.from('book_chapters').select('id, chapter_number, title, scene_type, mood, bpm, part_id, level, start_page, end_page').eq('book_id', book.id).order('chapter_number'),
        book.file_path
          ? supabase.storage.from('book-uploads').download(book.file_path).then(r => r.data)
          : Promise.resolve(null),
      ]);

      const parts = partsRes.data || [];
      const chapters = chaptersRes.data || [];

      if (chapters.length === 0) {
        toast.info(t("noChaptersFound", isRu));
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
        const dbLevel = ch.level;
        // Prefer DB-stored pages, fallback to PDF outline
        const dbStartPage = (ch as any).start_page || 0;
        const dbEndPage = (ch as any).end_page || 0;
        return {
          title: ch.title,
          startPage: dbStartPage || pdfInfo?.startPage || 0,
          endPage: dbEndPage || pdfInfo?.endPage || 0,
          level: dbLevel != null ? dbLevel : (pdfInfo?.level ?? (hasParts && ch.part_id ? 1 : 0)),
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

      // ── Dual-write: sync to local project ──
      if (projectStorage?.isReady) {
        syncStructureToLocal(projectStorage, {
          bookId: book.id,
          title: book.title || book.file_name.replace('.pdf', ''),
          fileName: book.file_name,
          toc: normalizeLevels(savedToc),
          parts: parts.map(p => ({ id: p.id, title: p.title, partNumber: p.part_number })),
          chapterIdMap: newChapterIdMap,
          chapterResults: initMap,
        });
      }

      const pdfStatus = restoredPdf
        ? ` (${t("pdfRestored", isRu)})`
        : ` (${t("pdfNotFound", isRu)})`;
      toast.success(`${t("bookLoaded", isRu)}: «${book.title}»` + pdfStatus);
    } catch (err: any) {
      console.error("Failed to open book:", err);
      setErrorMsg(err.message || "Unknown error");
      setStep("error");
    }
  }, [userId, isRu]);

  // Keep ref in sync for auto-restore effect
  openSavedBookRef.current = openSavedBook;

  // ─── Delete book ──────────────────────────────────────────
  const deleteBook = useCallback(async (delBookId: string) => {
    try {
      await supabase.from('book_chapters').delete().eq('book_id', delBookId);
      await supabase.from('book_parts').delete().eq('book_id', delBookId);
      await supabase.from('books').delete().eq('id', delBookId);
      setBooks(prev => prev.filter(b => b.id !== delBookId));
      toast.success(t("bookDeleted", isRu));
    } catch (err) {
      console.error("Failed to delete book:", err);
      toast.error(t("bookDeleteFailed", isRu));
    }
  }, [isRu]);

  // ─── File Upload & TOC Extraction ──────────────────────────
  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (!f || !userId) return;

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
        // No embedded outline — try text-based heading detection
        const textToc = await extractTocFromText(pdf);
        if (textToc.length > 0) {
          const flat = flattenTocWithRanges(textToc, pdf.numPages);
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
          toast.success(`${isRu ? "Найдены заголовки глав в тексте" : "Chapter headings found in text"}: ${chapters.length} ${t("items", isRu)}`);
        } else {
          toast.info(t("tocNotFound", isRu));
          chapters = [{
            title: f.name.replace('.pdf', ''),
            startPage: 1, endPage: pdf.numPages, level: 0, sectionType: "content",
          }];
        }
      }

      setTocEntries(normalizeLevels(chapters));

      // Clean up previous uploads of the same file name
      const { data: existingBooks } = await supabase
        .from('books')
        .select('id, file_path')
        .eq('user_id', userId)
        .eq('file_name', f.name);
      if (existingBooks?.length) {
        const oldPaths = existingBooks.map(b => b.file_path).filter(Boolean) as string[];
        if (oldPaths.length) {
          await supabase.storage.from('book-uploads').remove(oldPaths);
        }
        const oldIds = existingBooks.map(b => b.id);
        await supabase.from('book_chapters').delete().in('book_id', oldIds);
        await supabase.from('book_parts').delete().in('book_id', oldIds);
        await supabase.from('books').delete().in('id', oldIds);
      }

      const filePath = `${userId}/${Date.now()}_${f.name}`;
      await supabase.storage.from('book-uploads').upload(filePath, f);
      const { data: book, error: bookErr } = await supabase
        .from('books')
        .insert({ user_id: userId, title: f.name.replace('.pdf', ''), file_name: f.name, file_path: filePath, status: 'uploaded' })
        .select('id').single();
      if (bookErr) throw bookErr;
      setBookId(book.id);
      sessionStorage.setItem(ACTIVE_BOOK_KEY, book.id);

      // Add default characters: Narrator and Commentator
      await supabase.from('book_characters').insert([
        {
          book_id: book.id,
          name: isRu ? 'Рассказчик' : 'Narrator',
          gender: 'male',
          age_group: 'adult',
          description: isRu ? 'Голос повествования от третьего лица' : 'Third-person narration voice',
          sort_order: -2,
          voice_config: { provider: 'yandex' },
        },
        {
          book_id: book.id,
          name: isRu ? 'Комментатор' : 'Commentator',
          gender: 'male',
          age_group: 'adult',
          description: isRu ? 'Озвучивание сносок и комментариев' : 'Footnote and commentary voice',
          sort_order: -1,
          voice_config: { provider: 'yandex' },
        },
      ]);

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
            level: ch.level,
            start_page: ch.startPage,
            end_page: ch.endPage,
            ...(partId ? { part_id: partId } : {}),
          })
          .select('id').single();
        if (chRow) newChapterIdMap.set(i, chRow.id);
      }
      setChapterIdMap(newChapterIdMap);

      const initMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
      chapters.forEach((_, i) => initMap.set(i, { scenes: [], status: "pending" }));
      setChapterResults(initMap);

      // ── Dual-write: sync to local project ──
      if (projectStorage?.isReady && book?.id) {
        const partsArr = uniqueParts.map((title, i) => ({
          id: newPartIdMap.get(title) || "",
          title,
          partNumber: i + 1,
        }));
        syncStructureToLocal(projectStorage, {
          bookId: book.id,
          title: f.name.replace('.pdf', ''),
          fileName: f.name,
          toc: chapters,
          parts: partsArr,
          chapterIdMap: newChapterIdMap,
          chapterResults: initMap,
        });
        // Also save the source PDF locally
        projectStorage.writeBlob("source/book.pdf", f).catch(() => {});
      }

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
  }, [userId, isRu]);

  // ─── Reload book (delete structure, re-upload new PDF) ─────
  const reloadBook = useCallback(async () => {
    if (!bookId) return;
    try {
      // Delete scenes, chapters, parts for this book
      const { data: chapters } = await supabase
        .from('book_chapters').select('id').eq('book_id', bookId);
      if (chapters?.length) {
        const chapterIds = chapters.map(c => c.id);
        await supabase.from('book_scenes').delete().in('chapter_id', chapterIds);
      }
      await supabase.from('book_chapters').delete().eq('book_id', bookId);
      await supabase.from('book_parts').delete().eq('book_id', bookId);

      // Reset state but keep bookId for re-association
      setPartIdMap(new Map()); setChapterIdMap(new Map());
      setTocEntries([]); setPdfRef(null); setFile(null);
      setChapterResults(new Map());
      setStep("upload");
      toast.info(isRu ? "Выберите новый PDF для перезагрузки книги" : "Select a new PDF to reload the book");
    } catch (err) {
      console.error("Failed to reload book:", err);
      toast.error(isRu ? "Не удалось очистить данные книги" : "Failed to clear book data");
    }
  }, [bookId, isRu]);

  // ─── Ensure PDF is loaded (on-demand download) ─────────────
  const ensurePdfLoaded = useCallback(async (): Promise<any> => {
    if (pdfRef) return pdfRef;
    if (!bookId) return null;

    // Find file_path from books list or DB
    const book = books.find(b => b.id === bookId);
    const filePath = book?.file_path;
    if (!filePath) return null;

    try {
      const { data: blob } = await supabase.storage.from('book-uploads').download(filePath);
      if (!blob) return null;
      const arrayBuffer = await blob.arrayBuffer();
      const { getDocument } = await import('pdfjs-dist');
      const pdf = await getDocument({ data: arrayBuffer }).promise;
      setPdfRef(pdf);
      setTotalPages(pdf.numPages);
      return pdf;
    } catch (err) {
      console.warn("Failed to download PDF on demand:", err);
      return null;
    }
  }, [pdfRef, bookId, books]);

  // ─── Reset ─────────────────────────────────────────────────
  const handleReset = useCallback(() => {
    setStep("library");
    sessionStorage.removeItem(ACTIVE_BOOK_KEY);
    setFileName(""); setErrorMsg(""); setBookId(null);
    setPartIdMap(new Map()); setChapterIdMap(new Map());
    setTocEntries([]); setPdfRef(null); setFile(null);
    setChapterResults(new Map());
  }, []);

  return {
    // State
    step, setStep, books, loadingLibrary, fileName, errorMsg, bookId,
    partIdMap, chapterIdMap, setChapterIdMap, tocEntries, setTocEntries, pdfRef, totalPages, file,
    chapterResults, setChapterResults, fileInputRef,
    // Actions
    openSavedBook, deleteBook, handleFileSelect, handleReset, reloadBook, ensurePdfLoaded,
  };
}
