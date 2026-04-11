/**
 * useStoryboardAnnotations — phrase CRUD, annotation management, stress correction.
 * Extracted from StoryboardPanel.tsx for modularity.
 */

import { useCallback, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { invokeWithFallback } from "@/lib/invokeWithFallback";
import type { PhraseAnnotation, AnnotationType } from "@/components/studio/phraseAnnotations";
import type { Segment } from "@/components/studio/storyboard/types";
import type { StoryboardSnapshot } from "@/hooks/useStoryboardPersistence";
import type { StressSuggestion } from "@/components/studio/storyboard/StressReviewPanel";

interface UseStoryboardAnnotationsParams {
  sceneId: string | null;
  segments: Segment[];
  setSegments: (segs: Segment[]) => void;
  isRu: boolean;
  persist: (snap: StoryboardSnapshot) => void;
  buildSnapshot: (segs?: Segment[]) => StoryboardSnapshot;
  getModelForRole: (role: string) => string;
  userApiKeys: Record<string, string>;
  setMergeChecked: (ids: Set<string>) => void;
}

export function useStoryboardAnnotations({
  sceneId, segments, setSegments, isRu,
  persist, buildSnapshot, getModelForRole, userApiKeys, setMergeChecked,
}: UseStoryboardAnnotationsParams) {
  const [correctingStress, setCorrectingStress] = useState(false);
  const [stressReviewOpen, setStressReviewOpen] = useState(false);
  const [stressSuggestions, setStressSuggestions] = useState<StressSuggestion[]>([]);

  const savePhrase = useCallback((phraseId: string, newText: string) => {
    const updated = segments.map(seg => ({
      ...seg,
      phrases: seg.phrases.map(ph =>
        ph.phrase_id === phraseId ? { ...ph, text: newText } : ph,
      ),
    }));
    setSegments(updated);
    persist(buildSnapshot(updated));
  }, [segments, persist, buildSnapshot, setSegments]);

  const addToStressDictionary = useCallback(async (phraseId: string, annotation: PhraseAnnotation) => {
    if (annotation.type !== "stress" || annotation.start === undefined) return;
    let phraseText = "";
    for (const seg of segments) {
      const ph = seg.phrases.find(p => p.phrase_id === phraseId);
      if (ph) { phraseText = ph.text; break; }
    }
    if (!phraseText) return;

    const stressPos = annotation.start;
    const wordRegex = /[а-яёА-ЯЁ]+/g;
    let m: RegExpExecArray | null;
    while ((m = wordRegex.exec(phraseText)) !== null) {
      if (stressPos >= m.index && stressPos < m.index + m[0].length) {
        const word = m[0].toLowerCase();
        const stressedIndex = stressPos - m.index;
        await supabase.from("stress_dictionary").upsert(
          { user_id: (await supabase.auth.getUser()).data.user?.id, word, stressed_index: stressedIndex },
          { onConflict: "user_id,word,stressed_index" },
        );
        break;
      }
    }
  }, [segments]);

  const saveAnnotation = useCallback((phraseId: string, annotation: PhraseAnnotation) => {
    let currentAnnotations: PhraseAnnotation[] = [];
    for (const seg of segments) {
      const ph = seg.phrases.find(p => p.phrase_id === phraseId);
      if (ph) { currentAnnotations = [...(ph.annotations || [])]; break; }
    }
    currentAnnotations.push(annotation);

    if (annotation.type === "stress") {
      addToStressDictionary(phraseId, annotation);
    }

    const updated = segments.map(seg => ({
      ...seg,
      phrases: seg.phrases.map(ph =>
        ph.phrase_id === phraseId ? { ...ph, annotations: currentAnnotations } : ph,
      ),
    }));
    setSegments(updated);
    persist(buildSnapshot(updated));
    toast.success(isRu ? "Аннотация добавлена" : "Annotation added");
  }, [segments, isRu, addToStressDictionary, persist, buildSnapshot, setSegments]);

  const removeAnnotation = useCallback((phraseId: string, index: number) => {
    let currentAnnotations: PhraseAnnotation[] = [];
    for (const seg of segments) {
      const ph = seg.phrases.find(p => p.phrase_id === phraseId);
      if (ph) { currentAnnotations = [...(ph.annotations || [])]; break; }
    }
    currentAnnotations.splice(index, 1);

    const updated = segments.map(seg => ({
      ...seg,
      phrases: seg.phrases.map(ph =>
        ph.phrase_id === phraseId
          ? { ...ph, annotations: currentAnnotations.length > 0 ? currentAnnotations : undefined }
          : ph,
      ),
    }));
    setSegments(updated);
    persist(buildSnapshot(updated));
    toast.success(isRu ? "Аннотация удалена" : "Annotation removed");
  }, [segments, isRu, persist, buildSnapshot, setSegments]);

  const runStressCorrection = useCallback(async (mode: "correct" | "suggest") => {
    if (!sceneId) return;
    setCorrectingStress(true);
    try {
      const allPhrases = segments.flatMap(seg =>
        seg.phrases.map(p => ({
          id: p.phrase_id,
          segment_id: seg.segment_id,
          phrase_number: p.phrase_number,
          text: p.text,
          metadata: { annotations: p.annotations ?? [] },
        })),
      );

      if (mode === "suggest") {
        const { data, error } = await invokeWithFallback({
          functionName: "correct-stress",
          body: { scene_id: sceneId, mode: "suggest", phrases: allPhrases, model: getModelForRole("proofreader") },
          userApiKeys, isRu,
        });
        if (error) throw error;
        const result = data as any;
        const suggestions = result.suggestions as StressSuggestion[];
        if (!suggestions?.length) {
          toast.info(isRu ? "Неоднозначных ударений не найдено" : "No ambiguous stress found");
        } else {
          setStressSuggestions(suggestions);
          setStressReviewOpen(true);
        }
      } else {
        const { data, error } = await invokeWithFallback({
          functionName: "correct-stress",
          body: { scene_id: sceneId, mode: "correct", phrases: allPhrases, model: getModelForRole("proofreader") },
          userApiKeys, isRu,
        });
        if (error) throw error;
        const result = data as any;
        if (result.applied > 0) {
          const annotationsMap = result.annotations as Record<string, Array<{ type: string; start: number; end: number }>>;
          if (annotationsMap && Object.keys(annotationsMap).length > 0) {
            const updated = segments.map(seg => ({
              ...seg,
              phrases: seg.phrases.map(p => {
                const newAnns = annotationsMap[p.phrase_id];
                if (!newAnns?.length) return p;
                const typed = newAnns.map(a => ({
                  type: a.type as AnnotationType, start: a.start, end: a.end,
                }));
                return {
                  ...p,
                  annotations: [...(p.annotations ?? []), ...typed] as PhraseAnnotation[],
                };
              }),
            })) as Segment[];
            setSegments(updated);
            persist(buildSnapshot(updated));
          }
          toast.success(
            isRu
              ? `Расставлено ${result.applied} ударений в ${result.phrases_affected} фразах`
              : `Applied ${result.applied} stress marks in ${result.phrases_affected} phrases`,
          );
        } else {
          toast.info(result.message || (isRu ? "Нет совпадений со словарём" : "No dictionary matches"));
        }
      }
    } catch (err: any) {
      console.error("Stress correction failed:", err);
      toast.error(isRu ? "Ошибка коррекции ударений" : "Stress correction failed");
    }
    setCorrectingStress(false);
    setMergeChecked(new Set());
  }, [sceneId, segments, isRu, persist, buildSnapshot, getModelForRole, userApiKeys, setMergeChecked, setSegments]);

  const handleStressReviewAccept = useCallback(async (accepted: StressSuggestion[]) => {
    if (accepted.length === 0) return;
    try {
      const userId = (await supabase.auth.getUser()).data.user?.id;
      if (!userId) return;
      for (const s of accepted) {
        await supabase.from("stress_dictionary" as any).upsert(
          { user_id: userId, word: s.word.toLowerCase(), stressed_index: s.stressed_index, context: s.reason },
          { onConflict: "user_id,word,stressed_index" },
        );
      }
      toast.success(
        isRu
          ? `${accepted.length} слов добавлено в словарь. Нажмите «Применить» для расстановки.`
          : `${accepted.length} words added to dictionary. Click "Apply" to set stress marks.`,
      );
    } catch (err) {
      console.error("Failed to save stress dictionary:", err);
      toast.error(isRu ? "Ошибка сохранения словаря" : "Failed to save dictionary");
    }
  }, [isRu]);

  return {
    correctingStress,
    stressReviewOpen,
    setStressReviewOpen,
    stressSuggestions,
    savePhrase,
    saveAnnotation,
    removeAnnotation,
    runStressCorrection,
    handleStressReviewAccept,
  };
}
