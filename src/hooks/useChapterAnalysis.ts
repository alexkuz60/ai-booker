import { useState, useRef, useEffect } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getModelRegistryEntry } from "@/config/modelRegistry";
import { extractTextByPageRange } from "@/lib/pdf-extract";
import { t } from "@/pages/parser/i18n";
import type { Scene, TocChapter, ChapterStatus } from "@/pages/parser/types";

interface UseChapterAnalysisParams {
  isRu: boolean;
  pdfRef: any;
  userId: string | undefined;
  selectedModel: string;
  userApiKeys: Record<string, string>;
  tocEntries: TocChapter[];
  chapterIdMap: Map<number, string>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  setChapterResults: React.Dispatch<React.SetStateAction<Map<number, { scenes: Scene[]; status: ChapterStatus }>>>;
}

export function useChapterAnalysis({
  isRu, pdfRef, userId, selectedModel, userApiKeys,
  tocEntries, chapterIdMap, chapterResults, setChapterResults,
}: UseChapterAnalysisParams) {
  const [analysisLog, setAnalysisLog] = useState<string[]>([]);
  const analysisTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const prefetchingRef = useRef(false);
  const userStartedAnalysis = useRef(false);

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
        throw new Error(isRu ? 'Timeout: анализ занял более 3 минут' : 'Timeout: analysis took more than 3 minutes');
      }
      throw fetchErr;
    }
  };

  // ─── Two-stage Chapter Analysis (with resume) ─────────────
  const analyzeChapter = async (idx: number) => {
    if (!pdfRef || !userId) return;
    const entry = tocEntries[idx];
    if (!entry) return;

    userStartedAnalysis.current = true;
    setAnalysisLog([]);
    if (analysisTimerRef.current) clearInterval(analysisTimerRef.current);

    const addLog = (msg: string) => setAnalysisLog(prev => [...prev, msg]);

    let userKey: string | null = null;
    const modelEntry = getModelRegistryEntry(selectedModel);
    if (modelEntry?.apiKeyField) {
      userKey = userApiKeys[modelEntry.apiKeyField] || null;
    }
    const baseBody = {
      user_api_key: userKey,
      user_model: selectedModel,
      provider: modelEntry?.provider || 'lovable',
      openrouter_api_key: userApiKeys['openrouter'] || null,
      lang: isRu ? 'ru' : 'en',
    };

    const existingChId = chapterIdMap.get(idx);
    const needsEnrichment = (sc: Scene) => !sc.scene_type || sc.scene_type === '' || sc.scene_type === 'pending';

    const existingResult = chapterResults.get(idx);
    let scenes: Scene[] = existingResult?.scenes || [];
    const wasFullyDone = existingResult?.status === 'done' && scenes.length > 0 && scenes.every(sc => !needsEnrichment(sc));

    if (wasFullyDone && existingChId) {
      addLog(isRu ? "🗑️ Очистка предыдущих результатов..." : "🗑️ Clearing previous results...");
      await supabase.from('book_scenes').delete().eq('chapter_id', existingChId);
      scenes = [];
    }

    const hasExistingScenes = scenes.length > 0;

    if (hasExistingScenes && scenes.every(sc => !needsEnrichment(sc))) {
      toast.info(isRu ? "Все сцены уже проанализированы" : "All scenes already analyzed");
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
        addLog(isRu ? `📖 Извлечение текста главы «${entry.title}»...` : `📖 Extracting chapter text "${entry.title}"...`);
        const text = await extractTextByPageRange(pdfRef, entry.startPage, entry.endPage);
        const charCount = text.trim().length;

        if (charCount < 50) {
          setChapterResults(prev => {
            const next = new Map(prev);
            next.set(idx, { scenes: [], status: "done" });
            return next;
          });
          toast.info(`"${entry.title}" — ${isRu ? "недостаточно текста для анализа" : "not enough text for analysis"}`);
          return;
        }

        addLog(isRu
          ? `📝 Текст извлечён: ${charCount.toLocaleString()} символов (${entry.startPage}–${entry.endPage} стр.)`
          : `📝 Text extracted: ${charCount.toLocaleString()} chars (pages ${entry.startPage}–${entry.endPage})`);
        addLog(isRu ? `🎭 Этап 1: Определение границ сцен...` : `🎭 Stage 1: Detecting scene boundaries...`);
        addLog(isRu ? `🚀 Запрос к AI модели ${selectedModel.split('/').pop()}...` : `🚀 Calling AI model ${selectedModel.split('/').pop()}...`);

        const fnData = await callParseFunction({ ...baseBody, text, mode: "boundaries", chapter_title: entry.title });
        if (fnData?.error) throw new Error(fnData.error);

        const rawScenes = fnData.structure?.scenes || [];

        // Split text by markers
        const splitTextByMarkers = (fullText: string, markers: { start_marker: string; title: string; scene_number: number }[]) => {
          const positions: { idx: number; scene: typeof markers[0] }[] = [];
          for (const m of markers) {
            if (!m.start_marker) continue;
            let pos = fullText.indexOf(m.start_marker);
            if (pos === -1) pos = fullText.indexOf(m.start_marker.trim());
            if (pos === -1 && m.start_marker.length > 40) pos = fullText.indexOf(m.start_marker.slice(0, 40));
            if (pos !== -1) positions.push({ idx: pos, scene: m });
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

        if (scenes.length === 0 && rawScenes.length > 0) {
          scenes = rawScenes.map((s: any, i: number) => ({
            scene_number: s.scene_number || i + 1, title: s.title,
            content: '', content_preview: '', scene_type: 'pending', mood: '', bpm: 0,
          }));
          addLog(isRu ? `⚠️ Маркеры не найдены в тексте, контент будет пустым` : `⚠️ Markers not found in text, content will be empty`);
        }

        addLog(isRu ? `✅ Определено ${scenes.length} сцен:` : `✅ Found ${scenes.length} scenes:`);
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
          addLog(isRu
            ? `  📍 Сцена ${i + 1}: «${sc.title}» — стр. ${pageStart}–${pageEnd}, ${scLen.toLocaleString()} зн.`
            : `  📍 Scene ${i + 1}: "${sc.title}" — pp. ${pageStart}–${pageEnd}, ${scLen.toLocaleString()} chars`);
        });

        addLog(isRu ? "💾 Сохранение структуры в базу данных..." : "💾 Saving structure to database...");
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
        addLog(isRu
          ? `📍 Найдено ${scenes.length} сохранённых сцен, продолжаем обогащение...`
          : `📍 Found ${scenes.length} saved scenes, resuming enrichment...`);
      }

      // ─── STAGE 2: Enrich each scene with metadata ───
      const toEnrich = scenes.filter(needsEnrichment);
      if (toEnrich.length > 0) {
        addLog(isRu
          ? `🧠 Этап 2: Обогащение ${toEnrich.length} из ${scenes.length} сцен...`
          : `🧠 Stage 2: Enriching ${toEnrich.length} of ${scenes.length} scenes...`);

        for (const sc of toEnrich) {
          const scIdx = scenes.indexOf(sc);
          addLog(isRu
            ? `  🎬 Анализ сцены ${scIdx + 1}/${scenes.length}: «${sc.title}»...`
            : `  🎬 Analyzing scene ${scIdx + 1}/${scenes.length}: "${sc.title}"...`);

          const sceneText = sc.content || sc.content_preview || '';
          if (sceneText.length < 20) {
            sc.scene_type = 'mixed'; sc.mood = 'neutral'; sc.bpm = 100;
            addLog(isRu ? `  ⏭️ Пропущена (слишком мало текста)` : `  ⏭️ Skipped (too little text)`);
            continue;
          }

          try {
            const enrichData = await callParseFunction({ ...baseBody, text: sceneText, mode: "enrich" });
            if (enrichData?.structure) {
              sc.scene_type = enrichData.structure.scene_type || 'mixed';
              sc.mood = enrichData.structure.mood || 'neutral';
              sc.bpm = enrichData.structure.bpm || 100;
            }
          } catch (enrichErr: any) {
            console.warn(`Enrich failed for scene ${scIdx + 1}:`, enrichErr);
            sc.scene_type = 'mixed'; sc.mood = 'neutral'; sc.bpm = 100;
            addLog(isRu
              ? `  ⚠️ Обогащение не удалось: ${enrichErr.message}. Установлены значения по умолчанию.`
              : `  ⚠️ Enrichment failed: ${enrichErr.message}. Using defaults.`);
          }

          if (sc.id) {
            await supabase.from('book_scenes').update({
              scene_type: sc.scene_type, mood: sc.mood, bpm: sc.bpm,
            }).eq('id', sc.id);
          }

          addLog(isRu
            ? `  ✅ Сцена ${scIdx + 1}: ${sc.scene_type} / ${sc.mood} / ${sc.bpm} BPM`
            : `  ✅ Scene ${scIdx + 1}: ${sc.scene_type} / ${sc.mood} / ${sc.bpm} BPM`);

          setChapterResults(prev => {
            const next = new Map(prev);
            next.set(idx, { scenes: [...scenes], status: "analyzing" });
            return next;
          });
        }
      }

      addLog(isRu ? `🎉 Глава «${entry.title}» проанализирована!` : `🎉 Chapter "${entry.title}" analyzed!`);
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
        addLog(isRu
          ? `💡 Сохранено: ${partialScenes.length} сцен (${enrichedCount} обогащено). Нажмите ▶ чтобы продолжить.`
          : `💡 Saved: ${partialScenes.length} scenes (${enrichedCount} enriched). Click ▶ to resume.`);
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
    }
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
        const current = chapterResults.get(pendingIdx);
        if (current?.status === "pending") await analyzeChapter(pendingIdx);
      }
      prefetchingRef.current = false;
    })();
  }, [chapterResults, tocEntries]);

  const resetAnalysis = () => {
    prefetchingRef.current = false;
    userStartedAnalysis.current = false;
    setAnalysisLog([]);
  };

  return { analysisLog, analyzeChapter, resetAnalysis };
}
