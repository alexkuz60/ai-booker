import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Quote, User, BookOpen, MessageSquare, Brain, Music, StickyNote, Volume2, Pencil, Check, ChevronDown, HelpCircle, Play, CheckCircle2, XCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
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

interface CharacterOption {
  id: string;
  name: string;
  color: string | null;
}

// ─── Segment type config ────────────────────────────────────

const SEGMENT_TYPES = ["epigraph", "narrator", "first_person", "inner_thought", "dialogue", "lyric", "footnote"] as const;

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

// ─── Editable phrase ────────────────────────────────────────

function EditablePhrase({ phrase, isRu, onSave }: {
  phrase: Phrase;
  isRu: boolean;
  onSave: (id: string, text: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(phrase.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editing]);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== phrase.text) {
      onSave(phrase.phrase_id, trimmed);
    }
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex gap-2 px-3 py-1.5 group">
        <span className="text-[10px] text-muted-foreground font-mono pt-1.5 shrink-0 w-5 text-right">
          {phrase.phrase_number}
        </span>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
            if (e.key === "Escape") { setDraft(phrase.text); setEditing(false); }
          }}
          className="flex-1 text-sm font-body text-foreground leading-relaxed bg-background border border-primary/30 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button onClick={save} className="shrink-0 text-primary hover:text-primary/80 pt-1">
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      className="flex gap-2 px-3 py-1.5 hover:bg-accent/20 transition-colors group cursor-text"
      onClick={() => setEditing(true)}
    >
      <span className="text-[10px] text-muted-foreground font-mono pt-0.5 shrink-0 w-5 text-right">
        {phrase.phrase_number}
      </span>
      <p className="text-sm font-body text-foreground leading-relaxed flex-1">
        {renderPhraseText(phrase.text)}
      </p>
      <Pencil className="h-3 w-3 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0 mt-0.5" />
    </div>
  );
}

// ─── Segment type selector ──────────────────────────────────

function SegmentTypeBadge({ segmentType, isRu, onChange }: {
  segmentType: string;
  isRu: boolean;
  onChange: (newType: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const config = SEGMENT_CONFIG[segmentType] || SEGMENT_CONFIG.narrator;
  const Icon = config.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center cursor-pointer hover:ring-1 hover:ring-primary/40 rounded-full transition-all">
          <Badge variant="outline" className={cn("text-[10px] gap-1 py-0", config.color)}>
            <Icon className="h-3 w-3" />
            {isRu ? config.label_ru : config.label_en}
            <ChevronDown className="h-2.5 w-2.5 opacity-50" />
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="start">
        <div className="space-y-0.5">
          {SEGMENT_TYPES.map((type) => {
            const c = SEGMENT_CONFIG[type];
            const TypeIcon = c.icon;
            const isActive = type === segmentType;
            return (
              <button
                key={type}
                onClick={() => { onChange(type); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-body transition-colors text-left",
                  isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                )}
              >
                <TypeIcon className="h-3 w-3 shrink-0" />
                {isRu ? c.label_ru : c.label_en}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Speaker selector ───────────────────────────────────────

function SpeakerBadge({ speaker, characters, isRu, onChange }: {
  speaker: string | null;
  characters: CharacterOption[];
  isRu: boolean;
  onChange: (newSpeaker: string | null) => void;
}) {
  const [open, setOpen] = useState(false);

  const charColor = speaker
    ? characters.find(c => c.name === speaker)?.color
    : null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center cursor-pointer hover:ring-1 hover:ring-primary/40 rounded-full transition-all">
          <Badge
            variant="outline"
            className={cn(
              "text-[10px] gap-1 py-0",
              speaker
                ? "border-foreground/20 text-foreground/80"
                : "border-orange-500/40 text-orange-400"
            )}
            style={charColor ? { borderColor: charColor + "60", color: charColor } : undefined}
          >
            {speaker ? (
              <>
                <User className="h-3 w-3" />
                {speaker}
              </>
            ) : (
              <>
                <HelpCircle className="h-3 w-3" />
                {isRu ? "персонаж ?" : "character ?"}
              </>
            )}
            <ChevronDown className="h-2.5 w-2.5 opacity-50" />
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-48 p-1" align="start">
        <div className="space-y-0.5 max-h-52 overflow-y-auto">
          <button
            onClick={() => { onChange(null); setOpen(false); }}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-body transition-colors text-left",
              !speaker ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            )}
          >
            <HelpCircle className="h-3 w-3 shrink-0 text-orange-400" />
            {isRu ? "Не назначен" : "Unassigned"}
          </button>
          {characters.map((ch) => {
            const isActive = ch.name === speaker;
            return (
              <button
                key={ch.id}
                onClick={() => { onChange(ch.name); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-body transition-colors text-left",
                  isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                )}
              >
                {ch.color && (
                  <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ backgroundColor: ch.color }} />
                )}
                {!ch.color && <User className="h-3 w-3 shrink-0" />}
                {ch.name}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ─── Main component ─────────────────────────────────────────

export function StoryboardPanel({
  sceneId,
  sceneContent,
  isRu,
  bookId,
  onSegmented,
}: {
  sceneId: string | null;
  sceneContent: string | null;
  isRu: boolean;
  bookId: string | null;
  onSegmented?: (sceneId: string) => void;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthProgress, setSynthProgress] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [audioStatus, setAudioStatus] = useState<Map<string, { status: string; durationMs: number }>>(new Map());

  // Load characters for the book
  useEffect(() => {
    if (!bookId) { setCharacters([]); return; }
    (async () => {
      const { data } = await supabase
        .from("book_characters")
        .select("id, name, color")
        .eq("book_id", bookId)
        .order("sort_order");
      if (data) setCharacters(data.map(c => ({ id: c.id, name: c.name, color: c.color })));
    })();
  }, [bookId]);

  // Load audio status for segments
  const loadAudioStatus = useCallback(async (segIds: string[]) => {
    if (segIds.length === 0) { setAudioStatus(new Map()); return; }
    const { data } = await supabase
      .from("segment_audio")
      .select("segment_id, status, duration_ms")
      .in("segment_id", segIds);
    const map = new Map<string, { status: string; durationMs: number }>();
    if (data) {
      for (const a of data) {
        map.set(a.segment_id, { status: a.status, durationMs: a.duration_ms });
      }
    }
    setAudioStatus(map);
  }, []);

  // Load existing segments from DB, then apply saved type→character mappings
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
      const [{ data: phrases, error: phErr }, { data: mappings }] = await Promise.all([
        supabase
          .from("segment_phrases")
          .select("id, segment_id, phrase_number, text")
          .in("segment_id", segIds)
          .order("phrase_number"),
        supabase
          .from("scene_type_mappings" as any)
          .select("segment_type, character_id")
          .eq("scene_id", sid),
      ]);

      if (phErr) throw phErr;

      // Build character id→name map for mapping application
      const charNameMap = new Map(characters.map(c => [c.id, c.name]));

      // Build mapping: segment_type → character name
      const typeSpeakerMap = new Map<string, string>();
      if (mappings) {
        for (const m of mappings as any[]) {
          const name = charNameMap.get(m.character_id);
          if (name) typeSpeakerMap.set(m.segment_type, name);
        }
      }

      const phraseMap = new Map<string, Phrase[]>();
      for (const p of phrases || []) {
        const list = phraseMap.get(p.segment_id) || [];
        list.push({ phrase_id: p.id, phrase_number: p.phrase_number, text: p.text });
        phraseMap.set(p.segment_id, list);
      }

      // Apply saved mappings to segments missing a speaker
      const needUpdate: string[] = [];
      const builtSegments = segs.map((s) => {
        let speaker = s.speaker;
        if (!speaker && typeSpeakerMap.has(s.segment_type)) {
          speaker = typeSpeakerMap.get(s.segment_type)!;
          needUpdate.push(s.id);
        }
        return {
          segment_id: s.id,
          segment_number: s.segment_number,
          segment_type: s.segment_type,
          speaker,
          phrases: phraseMap.get(s.id) || [],
        };
      });

      // Persist auto-applied speakers
      if (needUpdate.length > 0) {
        for (const [type, name] of typeSpeakerMap) {
          const ids = builtSegments
            .filter(s => s.segment_type === type && needUpdate.includes(s.segment_id))
            .map(s => s.segment_id);
          if (ids.length > 0) {
            await supabase.from("scene_segments").update({ speaker: name }).in("id", ids);
          }
        }
      }

      setSegments(builtSegments);
      setLoaded(true);
      // Load audio status
      loadAudioStatus(builtSegments.map(s => s.segment_id));
    } catch (err) {
      console.error("Failed to load segments:", err);
      toast.error(isRu ? "Ошибка загрузки сегментов" : "Failed to load segments");
    }
    setLoading(false);
  }, [isRu, characters]);

  useEffect(() => {
    setSegments([]);
    setLoaded(false);
    if (sceneId) loadSegments(sceneId);
  }, [sceneId, loadSegments]);

  // Run AI segmentation
  const runAnalysis = useCallback(async () => {
    if (!sceneId || !sceneContent) return;
    setAnalyzing(true);
    try {
      const { data, error } = await supabase.functions.invoke("segment-scene", {
        body: { scene_id: sceneId, content: sceneContent, language: isRu ? "ru" : "en" },
      });
      if (error) throw error;
      setSegments(data.segments || []);
      onSegmented?.(sceneId);
      toast.success(isRu ? "Раскадровка готова" : "Storyboard ready");
    } catch (err: any) {
      console.error("Segmentation failed:", err);
      toast.error(isRu ? "Ошибка анализа" : "Analysis failed");
    }
    setAnalyzing(false);
  }, [sceneId, sceneContent, isRu, onSegmented]);

  // Auto-trigger analysis when scene has no segments and content is available
  useEffect(() => {
    if (loaded && segments.length === 0 && sceneContent && sceneId && !analyzing) {
      runAnalysis();
    }
  }, [loaded, segments.length, sceneContent, sceneId]);

  // Save edited phrase to DB and update local state
  const savePhrase = useCallback(async (phraseId: string, newText: string) => {
    const { error } = await supabase
      .from("segment_phrases")
      .update({ text: newText })
      .eq("id", phraseId);
    if (error) {
      toast.error(isRu ? "Ошибка сохранения" : "Save failed");
      return;
    }
    setSegments(prev => prev.map(seg => ({
      ...seg,
      phrases: seg.phrases.map(ph =>
        ph.phrase_id === phraseId ? { ...ph, text: newText } : ph
      ),
    })));
  }, [isRu]);

  // Update segment type in DB
  const updateSegmentType = useCallback(async (segmentId: string, newType: string) => {
    setSegments(prev => prev.map(seg =>
      seg.segment_id === segmentId ? { ...seg, segment_type: newType } : seg
    ));
    const { error } = await supabase
      .from("scene_segments")
      .update({ segment_type: newType as any })
      .eq("id", segmentId);
    if (error) {
      toast.error(isRu ? "Ошибка сохранения типа" : "Failed to save type");
    }
  }, [isRu]);

  // Update speaker in DB
  // Update speaker — and propagate to all segments of same type in this scene
  const updateSpeaker = useCallback(async (segmentId: string, newSpeaker: string | null) => {
    const targetSeg = segments.find(s => s.segment_id === segmentId);
    if (!targetSeg) return;

    const sameTypeIds = segments
      .filter(s => s.segment_type === targetSeg.segment_type)
      .map(s => s.segment_id);

    // Update all segments of same type locally
    setSegments(prev => prev.map(seg =>
      sameTypeIds.includes(seg.segment_id) ? { ...seg, speaker: newSpeaker } : seg
    ));

    // Persist segments to DB
    const { error } = await supabase
      .from("scene_segments")
      .update({ speaker: newSpeaker })
      .in("id", sameTypeIds);

    // Upsert or delete scene-level type→character mapping
    if (sceneId) {
      const charRecord = newSpeaker ? characters.find(c => c.name === newSpeaker) : null;
      if (charRecord) {
        await supabase
          .from("scene_type_mappings" as any)
          .upsert(
            { scene_id: sceneId, segment_type: targetSeg.segment_type, character_id: charRecord.id },
            { onConflict: "scene_id,segment_type" }
          );
      } else {
        await supabase
          .from("scene_type_mappings" as any)
          .delete()
          .eq("scene_id", sceneId)
          .eq("segment_type", targetSeg.segment_type);
      }
    }

    if (error) {
      toast.error(isRu ? "Ошибка сохранения персонажа" : "Failed to save speaker");
    } else if (sameTypeIds.length > 1) {
      const typeLabel = isRu
        ? SEGMENT_CONFIG[targetSeg.segment_type]?.label_ru
        : SEGMENT_CONFIG[targetSeg.segment_type]?.label_en;
      toast.success(
        isRu
          ? `«${typeLabel}» → ${newSpeaker || "?"} (${sameTypeIds.length} фрагм.)`
          : `"${typeLabel}" → ${newSpeaker || "?"} (${sameTypeIds.length} seg.)`
      );
    }
  }, [isRu, segments, sceneId, characters]);

  // ── Synthesize scene ──
  const runSynthesis = useCallback(async () => {
    if (!sceneId || segments.length === 0) return;
    setSynthesizing(true);
    setSynthProgress(isRu ? "Запуск синтеза…" : "Starting synthesis…");
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-scene", {
        body: { scene_id: sceneId, language: isRu ? "ru" : "en" },
      });
      if (error) throw error;
      const synth = data as { synthesized: number; errors: number; total_duration_ms: number };
      const durSec = (synth.total_duration_ms / 1000).toFixed(1);
      if (synth.errors > 0) {
        toast.warning(
          isRu
            ? `Синтез: ${synth.synthesized} готово, ${synth.errors} ошибок (${durSec}с)`
            : `Synthesis: ${synth.synthesized} done, ${synth.errors} errors (${durSec}s)`
        );
      } else {
        toast.success(
          isRu
            ? `Синтез завершён: ${synth.synthesized} фрагм., ${durSec}с`
            : `Synthesis done: ${synth.synthesized} seg., ${durSec}s`
        );
      }
      // Trigger timeline refresh by notifying parent
      onSegmented?.(sceneId);
      // Reload audio status indicators
      loadAudioStatus(segments.map(s => s.segment_id));
    } catch (err: any) {
      console.error("Synthesis failed:", err);
      toast.error(isRu ? "Ошибка синтеза" : "Synthesis failed");
    }
    setSynthesizing(false);
    setSynthProgress("");
  }, [sceneId, segments.length, isRu, onSegmented]);

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

  // ── Loading / analyzing state ──
  if (loading || analyzing) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3">
        <Loader2 className="h-5 w-5 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground font-body">
          {analyzing
            ? (isRu ? "Анализируем сцену…" : "Analyzing scene…")
            : (isRu ? "Загрузка…" : "Loading…")}
        </p>
      </div>
    );
  }

  // ── No segments and no content to analyze ──
  if (loaded && segments.length === 0 && !sceneContent) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 p-6">
        <Sparkles className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground font-body text-center max-w-xs">
          {isRu
            ? "Нет контента для анализа. Переанализируйте главу в Парсере."
            : "No content to analyze. Re-analyze the chapter in Parser."}
        </p>
      </div>
    );
  }

  // ── Segments view ──
  const totalPhrases = segments.reduce((a, s) => a + s.phrases.length, 0);

  return (
    <div className="h-full flex flex-col">
      <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
        <span className="text-xs text-muted-foreground font-body">
          {segments.length} {isRu ? "фрагм." : "seg."} · {totalPhrases} {isRu ? "фраз" : "phrases"}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            onClick={runSynthesis}
            disabled={synthesizing || analyzing || segments.length === 0}
            className="gap-1.5 h-7 text-xs"
          >
            {synthesizing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
            {synthesizing
              ? (synthProgress || (isRu ? "Синтез…" : "Synth…"))
              : (isRu ? "Синтез сцены" : "Synthesize")}
          </Button>
          <Button variant="ghost" size="sm" onClick={runAnalysis} disabled={analyzing || !sceneContent} className="gap-1.5 h-7 text-xs">
            {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {isRu ? "Переанализ" : "Re-analyze"}
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {segments.map((seg) => {
            return (
              <div key={seg.segment_id} className="rounded-lg border border-border bg-card/50 overflow-hidden">
                {/* Segment header */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/30">
                  <SegmentTypeBadge
                    segmentType={seg.segment_type}
                    isRu={isRu}
                    onChange={(newType) => updateSegmentType(seg.segment_id, newType)}
                  />
                  <SpeakerBadge
                    speaker={seg.speaker}
                    characters={characters}
                    isRu={isRu}
                    onChange={(newSpeaker) => updateSpeaker(seg.segment_id, newSpeaker)}
                  />
                  <span className="ml-auto text-[10px] text-muted-foreground font-mono">
                    #{seg.segment_number}
                  </span>
                </div>
                {/* Phrases */}
                <div className="divide-y divide-border/30">
                  {seg.phrases.map((ph) => (
                    <EditablePhrase
                      key={ph.phrase_id}
                      phrase={ph}
                      isRu={isRu}
                      onSave={savePhrase}
                    />
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
