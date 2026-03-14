import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getModelRegistryEntry } from "@/config/modelRegistry";
import { extractTextByPageRange } from "@/lib/pdf-extract";
import { t } from "@/pages/parser/i18n";
import type { Scene, TocChapter, ChapterStatus } from "@/pages/parser/types";
import type { AiRoleId } from "@/config/aiRoles";

interface UseChapterAnalysisParams {
  isRu: boolean;
  pdfRef: any;
  userId: string | undefined;
  userApiKeys: Record<string, string>;
  /** Role-based model resolver from useAiRoles */
  getModelForRole: (roleId: AiRoleId) => string;
  tocEntries: TocChapter[];
  chapterIdMap: Map<number, string>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  setChapterResults: React.Dispatch<React.SetStateAction<Map<number, { scenes: Scene[]; status: ChapterStatus }>>>;
  /** Lazy PDF loader — downloads from storage if not in memory */
  ensurePdfLoaded?: () => Promise<any>;
}

export function useChapterAnalysis({
  isRu, pdfRef, userId, userApiKeys, getModelForRole,
  tocEntries, chapterIdMap, chapterResults, setChapterResults, ensurePdfLoaded,
}: UseChapterAnalysisParams) {
  const [analysisLog, setAnalysisLog] = useState<string[]>([]);
  const analysisTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prefetchingRef = useRef(false);
  const userStartedAnalysis = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // ─── Helper: call edge function ─────────────────────────────
  const callParseFunction = async (body: Record<string, unknown>): Promise<any> => {
    const abortCtrl = new AbortController();
    const timeoutId = setTimeout(() => abortCtrl.abort(), 180_000);
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    const supabaseKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
    const session = (await supabase.auth.getSession()).data.session;

    try {
      const resp = await fetch(`${supabaseUrl}/functions/v1/parse-book-structure`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session?.access_token || supabaseKey}`,
          'apikey': supabaseKey,
        },
        body: JSON.stringify(body),
        signal: abortCtrl.signal,
      });
      clearTimeout(timeoutId);
      if (!resp.ok) {
        const errBody = await resp.text();
        let errMsg: string;
        try { errMsg = JSON.parse(errBody).error; } catch { errMsg = errBody; }
        throw new Error(errMsg || `HTTP ${resp.status}`);
      }
      return await resp.json();
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') {
        throw new Error(t("logTimeout", isRu));
      }
      throw fetchErr;
    }
  };

  // ─── Two-stage Chapter Analysis (with resume) ─────────────
  const analyzeChapter = async (idx: number, mode: "full" | "enrich" | "auto" = "auto") => {
    if (!userId) return;
    // Try to load PDF on demand if not in memory
    let activePdf = pdfRef;
    if (!activePdf && ensurePdfLoaded) {
      activePdf = await ensurePdfLoaded();
    }
    if (!activePdf) {
      toast.error(isRu ? "PDF не загружен. Перезагрузите книгу для анализа." : "PDF not loaded. Reload the book to analyze.");
      return;
    }
    const entry = tocEntries[idx];
    if (!entry) return;

    // Cancel any previous analysis
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    userStartedAnalysis.current = true;
    setIsAnalyzing(true);
    setAnalysisLog([]);
    if (analysisTimerRef.current) clearInterval(analysisTimerRef.current);

    const addLog = (msg: string) => setAnalysisLog(prev => [...prev, msg]);

    // Use Screenwriter role for structure parsing, Director for enrichment
    const buildBaseBody = (roleId: AiRoleId) => {
      const model = getModelForRole(roleId);
      const modelEntry = getModelRegistryEntry(model);
      let userKey: string | null = null;
      if (modelEntry?.apiKeyField) {
        userKey = userApiKeys[modelEntry.apiKeyField] || null;
      }
      return {
        user_api_key: userKey,
        user_model: model,
        provider: modelEntry?.provider || 'lovable',
        openrouter_api_key: userApiKeys['openrouter'] || null,
        lang: isRu ? 'ru' : 'en',
        _modelName: model, // for logging
      };
    };

    const existingChId = chapterIdMap.get(idx);
    const needsEnrichment = (sc: Scene) => !sc.scene_type || sc.scene_type === '' || sc.scene_type === 'pending';

    const existingResult = chapterResults.get(idx);
    let scenes: Scene[] = existingResult?.scenes || [];
    const wasFullyDone = existingResult?.status === 'done' && scenes.length > 0 && scenes.every(sc => !needsEnrichment(sc));

    // Determine effective mode
    if (mode === "enrich" && wasFullyDone && existingChId) {
      // Reset metadata to pending so enrichment re-runs
      addLog(isRu ? "🔄 Сброс метаданных сцен для переобогащения..." : "🔄 Resetting scene metadata for re-enrichment...");
      for (const sc of scenes) {
        sc.scene_type = 'pending';
        sc.mood = '';
        sc.bpm = 0;
        if (sc.id) {
          await supabase.from('book_scenes').update({ scene_type: null, mood: null, bpm: null }).eq('id', sc.id);
        }
      }
      // scenes stay intact, skip to stage 2
    } else if (wasFullyDone && existingChId && mode !== "enrich") {
      addLog(t("logClearing", isRu));
      await supabase.from('book_scenes').delete().eq('chapter_id', existingChId);
      scenes = [];
    }

    const hasExistingScenes = scenes.length > 0;

    if (hasExistingScenes && scenes.every(sc => !needsEnrichment(sc))) {
      toast.info(t("logAllDone", isRu));
      return;
    }

    setChapterResults(prev => {
      const next = new Map(prev);
      next.set(idx, { scenes, status: "analyzing" });
      return next;
    });

    try {
      // ─── STAGE 1: Boundary detection ───
      if (!hasExistingScenes) {
        addLog(`${t("logExtracting", isRu)} «${entry.title}»...`);
        const text = await extractTextByPageRange(activePdf, entry.startPage, entry.endPage);
        const charCount = text.trim().length;

        if (charCount < 50) {
          setChapterResults(prev => {
            const next = new Map(prev);
            next.set(idx, { scenes: [], status: "done" });
            return next;
          });
          toast.info(`"${entry.title}" — ${t("logNotEnough", isRu)}`);
          return;
        }

        addLog(`${t("logExtracted", isRu)}: ${charCount.toLocaleString()} ${t("logChars", isRu)} (${entry.startPage}–${entry.endPage} ${t("logPagesAbbr", isRu)})`);
        addLog(t("logStage1", isRu));
        const screenwriterBody = buildBaseBody("screenwriter");
        addLog(`${t("logCallingAI", isRu)} ${screenwriterBody._modelName.split('/').pop()}...`);

        const fnData = await callParseFunction({ ...screenwriterBody, text, mode: "boundaries", chapter_title: entry.title });
        if (fnData?.error) throw new Error(fnData.error);

        const rawScenes = fnData.structure?.scenes || [];

        // Split text by markers
        const normalizeWS = (s: string) => s.replace(/\s+/g, ' ').trim();

        /** Try to find normMarker in normText with progressive truncation */
        const fuzzyFind = (normText: string, marker: string): number => {
          const normMarker = normalizeWS(marker);
          if (!normMarker) return -1;
          // exact match
          let pos = normText.indexOf(normMarker);
          if (pos !== -1) return pos;
          // try progressively shorter prefixes (down to 30 chars)
          for (let len = Math.min(normMarker.length - 1, 60); len >= 30; len -= 5) {
            pos = normText.indexOf(normMarker.slice(0, len));
            if (pos !== -1) return pos;
          }
          // try first sentence / first line
          const firstLine = normMarker.split(/[.!?\n]/)[0]?.trim();
          if (firstLine && firstLine.length >= 15) {
            pos = normText.indexOf(firstLine);
            if (pos !== -1) return pos;
          }
          return -1;
        };

        const splitTextByMarkers = (fullText: string, markers: { start_marker: string; title: string; scene_number: number }[]) => {
          const normText = normalizeWS(fullText);
          // Build a map from normalized-char-index to original-char-index
          const normToOrig: number[] = [];
          let ni = 0;
          const normChars = normText.length;
          let oi = 0;
          const origLen = fullText.length;
          while (ni < normChars && oi < origLen) {
            if (/\s/.test(fullText[oi]) && (oi === 0 || /\s/.test(fullText[oi - 1]))) {
              if (normToOrig.length > 0 && normToOrig.length === ni) { oi++; continue; }
            }
            normToOrig.push(oi);
            ni++; oi++;
            if (ni > 0 && normText[ni - 1] === ' ') {
              while (oi < origLen && /\s/.test(fullText[oi])) oi++;
            }
          }

          const positions: { idx: number; scene: typeof markers[0] }[] = [];
          for (const m of markers) {
            if (!m.start_marker) continue;
            const normPos = fuzzyFind(normText, m.start_marker);
            if (normPos !== -1) {
              const origPos = normToOrig[normPos] ?? 0;
              positions.push({ idx: origPos, scene: m });
            }
          }
          positions.sort((a, b) => a.idx - b.idx);
          return positions.map((p, i) => {
            const start = p.idx;
            const end = i + 1 < positions.length ? positions[i + 1].idx : fullText.length;
            return { ...p.scene, content: fullText.slice(start, end).trim() };
          });
        };

        const splitScenes = splitTextByMarkers(text, rawScenes);
        scenes = splitScenes.map((s, i) => ({
          scene_number: s.scene_number || i + 1, title: s.title,
          content: s.content || '', content_preview: (s.content || '').slice(0, 200),
          scene_type: 'pending', mood: '', bpm: 0,
        }));

        // Fallback: markers not matched → distribute full text evenly across scenes
        if (scenes.length === 0 && rawScenes.length > 0) {
          addLog(t("logMarkersNotFound", isRu));
          const chunkSize = Math.ceil(text.length / rawScenes.length);
          scenes = rawScenes.map((s: any, i: number) => {
            const chunk = text.slice(i * chunkSize, (i + 1) * chunkSize).trim();
            return {
              scene_number: s.scene_number || i + 1, title: s.title,
              content: chunk, content_preview: chunk.slice(0, 200),
              scene_type: 'pending', mood: '', bpm: 0,
            };
          });
        }

        addLog(`${t("logFoundScenes", isRu)} ${scenes.length} ${t("logScenesWord", isRu)}:`);
        const totalChars = text.length;
        const pageSpan = entry.endPage - entry.startPage + 1;
        let charOffset = 0;
        scenes.forEach((sc, i) => {
          const scLen = sc.content?.length || 0;
          const startFrac = totalChars > 0 ? charOffset / totalChars : 0;
          const endFrac = totalChars > 0 ? (charOffset + scLen) / totalChars : 0;
          const pageStart = Math.floor(entry.startPage + startFrac * pageSpan);
          const pageEnd = Math.max(pageStart, Math.ceil(entry.startPage + endFrac * pageSpan) - 1);
          charOffset += scLen;
          addLog(`  ${t("logSceneItem", isRu)} ${i + 1}: «${sc.title}» — ${t("logPagesAbbr", isRu)} ${pageStart}–${pageEnd}, ${scLen.toLocaleString()} ${t("logCharsAbbr", isRu)}`);
        });

        addLog(t("logSaving", isRu));
        if (existingChId) {
          for (const sc of scenes) {
            const { data: scRow } = await supabase.from('book_scenes').insert({
              chapter_id: existingChId, scene_number: sc.scene_number, title: sc.title,
              content: sc.content || '', scene_type: null, mood: null, bpm: null,
            }).select('id').single();
            if (scRow) sc.id = scRow.id;
          }
        }

        setChapterResults(prev => {
          const next = new Map(prev);
          next.set(idx, { scenes: [...scenes], status: "analyzing" });
          return next;
        });
      } else {
        addLog(`${t("logResuming", isRu).replace("...", "")} ${scenes.length} ...`);
      }

      // ─── STAGE 2: Enrich each scene with metadata ───
      const toEnrich = scenes.filter(needsEnrichment);
      if (toEnrich.length > 0) {
        addLog(`${t("logStage2", isRu)} ${toEnrich.length} ${t("logOfScenes", isRu)} ${scenes.length} ${t("logScenesWord", isRu)}...`);

        for (const sc of toEnrich) {
          const scIdx = scenes.indexOf(sc);
          addLog(`  ${t("logAnalyzingScene", isRu)} ${scIdx + 1}/${scenes.length}: «${sc.title}»...`);

          const sceneText = sc.content || sc.content_preview || '';
          if (sceneText.length < 10) {
            sc.scene_type = 'mixed'; sc.mood = 'neutral'; sc.bpm = 100;
            addLog(`  ${t("logSkipped", isRu)}`);
            continue;
          }

          try {
            const enrichData = await callParseFunction({ ...buildBaseBody("director"), text: sceneText, mode: "enrich" });
            if (enrichData?.structure) {
              sc.scene_type = enrichData.structure.scene_type || 'mixed';
              sc.mood = enrichData.structure.mood || 'neutral';
              sc.bpm = enrichData.structure.bpm || 100;
            }
          } catch (enrichErr: any) {
            console.warn(`Enrich failed for scene ${scIdx + 1}:`, enrichErr);
            sc.scene_type = 'mixed'; sc.mood = 'neutral'; sc.bpm = 100;
            addLog(`  ${t("logEnrichFailed", isRu)}: ${enrichErr.message}. ${t("logDefaults", isRu)}`);
          }

          if (sc.id) {
            await supabase.from('book_scenes').update({
              scene_type: sc.scene_type, mood: sc.mood, bpm: sc.bpm,
            }).eq('id', sc.id);
          }

          addLog(`  ${t("logSceneDone", isRu)} ${scIdx + 1}: ${sc.scene_type} / ${sc.mood} / ${sc.bpm} BPM`);

          setChapterResults(prev => {
            const next = new Map(prev);
            next.set(idx, { scenes: [...scenes], status: "analyzing" });
            return next;
          });
        }
      }

      addLog(`${t("logChapterDone", isRu).replace("!", "")} «${entry.title}»!`);
      setChapterResults(prev => {
        const next = new Map(prev);
        next.set(idx, { scenes: [...scenes], status: "done" });
        return next;
      });
      toast.success(`"${entry.title}" — ${t("chapterAnalyzed", isRu)}`);
    } catch (err: any) {
      console.error(`Chapter ${idx} analysis failed:`, err);
      addLog(`❌ ${err.message || "Unknown error"}`);

      const partialScenes = scenes.length > 0 ? scenes : [];
      const enrichedCount = partialScenes.filter(s => s.scene_type && s.scene_type !== 'pending').length;

      if (partialScenes.length > 0) {
        addLog(`${t("logSavedPartial", isRu)}: ${partialScenes.length} ${t("logScenesEnriched", isRu)} ${enrichedCount}). ${t("logClickResume", isRu)}`);
      }

      const errMsg = err?.message || "";
      let userError: string;
      if (/402|payment|credits/i.test(errMsg)) userError = t("errPayment", isRu);
      else if (/429|rate.?limit/i.test(errMsg)) userError = t("errRateLimit", isRu);
      else if (/timeout|timed?\s?out|abort/i.test(errMsg)) userError = t("errTimeout", isRu);
      else if (/structured|tool_calls/i.test(errMsg)) userError = t("errNoStructure", isRu);
      else if (/api.?key|no.*key|not configured/i.test(errMsg)) userError = t("errNoApiKey", isRu);
      else if (/fetch|network|dns|econnrefused/i.test(errMsg)) userError = t("errNetwork", isRu);
      else userError = `${t("errChapterFailed", isRu)}: ${errMsg || entry.title}`;

      setChapterResults(prev => {
        const next = new Map(prev);
        next.set(idx, { scenes: partialScenes, status: "error" });
        return next;
      });
      toast.error(userError, { duration: 8000 });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const stopAnalysis = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    prefetchingRef.current = false;
    setIsAnalyzing(false);
    setAnalysisLog(prev => [...prev, isRu ? "⏹️ Анализ остановлен пользователем" : "⏹️ Analysis stopped by user"]);
    // Set current analyzing chapters to error so user can resume
    setChapterResults(prev => {
      const next = new Map(prev);
      for (const [idx, result] of next) {
        if (result.status === "analyzing") {
          next.set(idx, { ...result, status: "error" });
        }
      }
      return next;
    });
  };

  // ─── Background Prefetch ───
  useEffect(() => {
    if (prefetchingRef.current) return;
    if (!userStartedAnalysis.current) return;
    const doneIndices = Array.from(chapterResults.entries())
      .filter(([, r]) => r.status === "done").map(([i]) => i);
    if (doneIndices.length === 0) return;

    const maxDone = Math.max(...doneIndices);
    const nextPending: number[] = [];
    for (let i = maxDone + 1; i < tocEntries.length && nextPending.length < 3; i++) {
      const r = chapterResults.get(i);
      if (r && r.status === "pending" && tocEntries[i].sectionType === "content") nextPending.push(i);
    }
    if (nextPending.length === 0) return;

    prefetchingRef.current = true;
    (async () => {
      for (const pendingIdx of nextPending) {
        if (abortRef.current?.signal.aborted) break;
        const current = chapterResults.get(pendingIdx);
        if (current?.status === "pending") await analyzeChapter(pendingIdx);
      }
      prefetchingRef.current = false;
    })();
  }, [chapterResults, tocEntries]);

  const resetAnalysis = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    prefetchingRef.current = false;
    userStartedAnalysis.current = false;
    setIsAnalyzing(false);
    setAnalysisLog([]);
  };

  return { analysisLog, analyzeChapter, resetAnalysis, stopAnalysis, isAnalyzing };
}
