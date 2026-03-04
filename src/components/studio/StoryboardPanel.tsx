import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Quote, User, BookOpen, MessageSquare, Brain, Music, StickyNote, Volume2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────

interface Phrase {
  phrase_id: string;
  phrase_number: number;
  text: string;
}

interface Segment {
  segment_id: string;
  segment_number: number;
  segment_type: string;
  speaker: string | null;
  phrases: Phrase[];
}

// ─── Segment type config ────────────────────────────────────

const SEGMENT_CONFIG: Record<string, {
  icon: typeof Quote;
  label_ru: string;
  label_en: string;
  color: string;
}> = {
  epigraph: { icon: Quote, label_ru: "Эпиграф", label_en: "Epigraph", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  narrator: { icon: BookOpen, label_ru: "Рассказчик", label_en: "Narrator", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  first_person: { icon: User, label_ru: "От первого лица", label_en: "First Person", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  inner_thought: { icon: Brain, label_ru: "Мысли", label_en: "Thoughts", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  dialogue: { icon: MessageSquare, label_ru: "Диалог", label_en: "Dialogue", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  lyric: { icon: Music, label_ru: "Лирика", label_en: "Lyric", color: "bg-purple-500/20 text-purple-400 border-purple-500/30" },
  footnote: { icon: StickyNote, label_ru: "Сноска", label_en: "Footnote", color: "bg-muted text-muted-foreground border-border" },
};

// ─── Inline sound marker rendering ──────────────────────────

function renderPhraseText(text: string) {
  const parts = text.split(/(\[[^\]]+\])/g);
  return parts.map((part, i) => {
    if (/^\[.+\]$/.test(part)) {
      return (
        <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-accent text-accent-foreground text-xs font-medium mx-0.5">
          <Volume2 className="h-3 w-3" />
          {part.slice(1, -1)}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

// ─── Main component ─────────────────────────────────────────

export function StoryboardPanel({
  sceneId,
  sceneContent,
  isRu,
  onSegmented,
}: {
  sceneId: string | null;
  sceneContent: string | null;
  isRu: boolean;
  onSegmented?: (sceneId: string) => void;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Load existing segments from DB
  const loadSegments = useCallback(async (sid: string) => {
    setLoading(true);
    try {
      const { data: segs, error: segErr } = await supabase
        .from("scene_segments")
        .select("id, segment_number, segment_type, speaker")
        .eq("scene_id", sid)
        .order("segment_number");

      if (segErr) throw segErr;
      if (!segs || segs.length === 0) {
        setSegments([]);
        setLoaded(true);
        setLoading(false);
        return;
      }

      const segIds = segs.map((s) => s.id);
      const { data: phrases, error: phErr } = await supabase
        .from("segment_phrases")
        .select("id, segment_id, phrase_number, text")
        .in("segment_id", segIds)
        .order("phrase_number");

      if (phErr) throw phErr;

      const phraseMap = new Map<string, Phrase[]>();
      for (const p of phrases || []) {
        const list = phraseMap.get(p.segment_id) || [];
        list.push({ phrase_id: p.id, phrase_number: p.phrase_number, text: p.text });
        phraseMap.set(p.segment_id, list);
      }

      setSegments(
        segs.map((s) => ({
          segment_id: s.id,
          segment_number: s.segment_number,
          segment_type: s.segment_type,
          speaker: s.speaker,
          phrases: phraseMap.get(s.id) || [],
        }))
      );
      setLoaded(true);
    } catch (err) {
      console.error("Failed to load segments:", err);
      toast.error(isRu ? "Ошибка загрузки сегментов" : "Failed to load segments");
    }
    setLoading(false);
  }, [isRu]);

  useEffect(() => {
    setSegments([]);
    setLoaded(false);
    if (sceneId) loadSegments(sceneId);
  }, [sceneId, loadSegments]);

  // Run AI segmentation
  const runAnalysis = async () => {
    if (!sceneId || !sceneContent) return;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("segment-scene", {
        body: { scene_id: sceneId, content: sceneContent, language: isRu ? "ru" : "en" },
      });
      if (error) throw error;
      setSegments(data.segments || []);
      toast.success(isRu ? "Раскадровка готова" : "Storyboard ready");
    } catch (err: any) {
      console.error("Segmentation failed:", err);
      toast.error(isRu ? "Ошибка анализа" : "Analysis failed");
    }
    setAnalyzing(false);
  };

  // ── No scene selected ──
  if (!sceneId) {
    return (
      <div className="h-full flex items-center justify-center">
        <p className="text-sm text-muted-foreground font-body">
          {isRu ? "Выберите сцену в навигаторе" : "Select a scene in the navigator"}
        </p>
      </div>
    );
  }

  // ── Loading state ──
  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  // ── No segments yet → offer analysis ──
  if (loaded && segments.length === 0) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
        <Sparkles className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground font-body text-center max-w-xs">
          {isRu
            ? "Сцена ещё не раскадрована. Запустите AI-анализ для разбиения на структурные фрагменты и фразы."
            : "Scene not yet segmented. Run AI analysis to split into structural fragments and phrases."}
        </p>
        <Button onClick={runAnalysis} disabled={analyzing || !sceneContent} size="sm" className="gap-2">
          {analyzing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {isRu ? "Раскадровать" : "Analyze"}
        </Button>
      </div>
    );
  }

  // ── Segments view ──
  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground font-body">
          {segments.length} {isRu ? "фрагм." : "segments"} · {segments.reduce((a, s) => a + s.phrases.length, 0)} {isRu ? "фраз" : "phrases"}
        </span>
        <Button variant="ghost" size="sm" onClick={runAnalysis} disabled={analyzing || !sceneContent} className="gap-1.5 h-7 text-xs">
          {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
          {isRu ? "Переанализ" : "Re-analyze"}
        </Button>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {segments.map((seg) => {
            const config = SEGMENT_CONFIG[seg.segment_type] || SEGMENT_CONFIG.narrator;
            const Icon = config.icon;
            return (
              <div key={seg.segment_id} className="rounded-lg border border-border bg-card/50 overflow-hidden">
                {/* Segment header */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/30">
                  <Badge variant="outline" className={cn("text-[10px] gap-1 py-0", config.color)}>
                    <Icon className="h-3 w-3" />
                    {isRu ? config.label_ru : config.label_en}
                  </Badge>
                  {seg.speaker && (
                    <span className="text-xs text-muted-foreground font-body">
                      — {seg.speaker}
                    </span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                    #{seg.segment_number}
                  </span>
                </div>
                {/* Phrases */}
                <div className="divide-y divide-border/30">
                  {seg.phrases.map((ph) => (
                    <div
                      key={ph.phrase_id}
                      className="flex gap-2 px-3 py-1.5 hover:bg-accent/20 transition-colors group"
                    >
                      <span className="text-[10px] text-muted-foreground font-mono pt-0.5 shrink-0 w-5 text-right">
                        {ph.phrase_number}
                      </span>
                      <p className="text-sm font-body text-foreground leading-relaxed flex-1">
                        {renderPhraseText(ph.text)}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
