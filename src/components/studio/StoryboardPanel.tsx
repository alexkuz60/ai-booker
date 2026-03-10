import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Loader2, Sparkles, Quote, User, BookOpen, MessageSquare, Brain, Music, StickyNote, Volume2, Pencil, Check, ChevronDown, HelpCircle, AudioLines, CheckCircle2, XCircle, Search, ScanSearch, MessageCircle, RefreshCw, Timer, Merge, Trash2 } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

// ─── Types ──────────────────────────────────────────────────

interface Phrase {
  phrase_id: string;
  phrase_number: number;
  text: string;
}

interface InlineNarration {
  text: string;
  insert_after: string;
}

interface Segment {
  segment_id: string;
  segment_number: number;
  segment_type: string;
  speaker: string | null;
  phrases: Phrase[];
  inline_narrations?: InlineNarration[];
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

function EditablePhrase({ phrase, isRu, onSave, onSplit }: {
  phrase: Phrase;
  isRu: boolean;
  onSave: (id: string, text: string) => void;
  onSplit: (phraseId: string, textBefore: string, textAfter: string) => void;
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
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const pos = textareaRef.current?.selectionStart ?? draft.length;
              const before = draft.slice(0, pos).trim();
              const after = draft.slice(pos).trim();
              if (before && after) {
                // Split at cursor position
                onSplit(phrase.phrase_id, before, after);
                setEditing(false);
              } else {
                save();
              }
            }
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
      className="flex gap-2 px-3 py-1.5 hover:bg-accent/20 transition-colors group"
    >
      <span className="text-[10px] text-muted-foreground font-mono pt-0.5 shrink-0 w-5 text-right">
        {phrase.phrase_number}
      </span>
      <p className="text-sm font-body text-foreground leading-relaxed flex-1">
        {renderPhraseText(phrase.text)}
      </p>
      <button
        onClick={() => setEditing(true)}
        className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground cursor-pointer"
        title={isRu ? "Редактировать" : "Edit"}
      >
        <Pencil className="h-3 w-3" />
      </button>
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

// ─── Speaker search list ────────────────────────────────────

function SpeakerSearchList({ speaker, characters, isRu, onChange }: {
  speaker: string | null;
  characters: CharacterOption[];
  isRu: boolean;
  onChange: (newSpeaker: string | null) => void;
}) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query.trim()) return characters;
    const q = query.toLowerCase();
    return characters.filter(c => c.name.toLowerCase().includes(q));
  }, [characters, query]);

  return (
    <div className="space-y-1">
      {characters.length > 5 && (
        <div className="flex items-center gap-1.5 px-1 pb-1 border-b border-border">
          <Search className="h-3 w-3 shrink-0 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={isRu ? "Поиск…" : "Search…"}
            className="h-6 border-0 bg-transparent px-0 text-xs focus-visible:ring-0 focus-visible:ring-offset-0"
            autoFocus
          />
        </div>
      )}
      <div className="space-y-0.5 max-h-52 overflow-y-auto">
        {!query && (
          <button
            onClick={() => onChange(null)}
            className={cn(
              "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-body transition-colors text-left",
              !speaker ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
            )}
          >
            <HelpCircle className="h-3 w-3 shrink-0 text-orange-400" />
            {isRu ? "Не назначен" : "Unassigned"}
          </button>
        )}
        {filtered.map((ch) => {
          const isActive = ch.name === speaker;
          return (
            <button
              key={ch.id}
              onClick={() => onChange(ch.name)}
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
        {filtered.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">
            {isRu ? "Не найдено" : "Not found"}
          </p>
        )}
      </div>
    </div>
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
      <PopoverContent className="w-52 p-1" align="start">
        <SpeakerSearchList
          speaker={speaker}
          characters={characters}
          isRu={isRu}
          onChange={(v) => { onChange(v); setOpen(false); }}
        />
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
  selectedSegmentId,
  onSelectSegment,
  onSynthesizingChange,
  onErrorSegmentsChange,
  silenceSec,
  onSilenceSecChange,
  onRecalcDone,
}: {
  sceneId: string | null;
  sceneContent: string | null;
  isRu: boolean;
  bookId: string | null;
  onSegmented?: (sceneId: string) => void;
  selectedSegmentId?: string | null;
  onSelectSegment?: (segmentId: string | null) => void;
  onSynthesizingChange?: (ids: Set<string>) => void;
  onErrorSegmentsChange?: (ids: Set<string>) => void;
  silenceSec?: number;
  onSilenceSecChange?: (sec: number) => void;
  onRecalcDone?: () => void;
}) {
  const [segments, setSegments] = useState<Segment[]>([]);
  const [loading, setLoading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [synthesizing, setSynthesizing] = useState(false);
  const [synthProgress, setSynthProgress] = useState("");
  const [detecting, setDetecting] = useState(false);
  const [resynthSegId, setResynthSegId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [characters, setCharacters] = useState<CharacterOption[]>([]);
  const [audioStatus, setAudioStatus] = useState<Map<string, { status: string; durationMs: number }>>(new Map());
  const [inlineNarrationSegIds, setInlineNarrationSegIds] = useState<Set<string>>(new Set());
  const [currentlySynthesizingIds, setCurrentlySynthesizingIds] = useState<Set<string>>(new Set());
  /** Current speaker assigned to inline narrations (from scene_type_mappings with segment_type="inline_narration") */
  const [inlineNarrationSpeaker, setInlineNarrationSpeaker] = useState<string | null>(null);
  const [recalcRunning, setRecalcRunning] = useState(false);
   const [mergeChecked, setMergeChecked] = useState<Set<string>>(new Set());
  const [merging, setMerging] = useState(false);
  const [deleting, setDeleting] = useState(false);

  // Reset merge selection when scene changes
  useEffect(() => { setMergeChecked(new Set()); }, [sceneId]);

  const toggleMergeCheck = useCallback((segId: string) => {
    setMergeChecked(prev => {
      const next = new Set(prev);
      if (next.has(segId)) next.delete(segId); else next.add(segId);
      return next;
    });
  }, []);

  // Find consecutive groups of checked segments (≥2 adjacent)
  const mergeGroups = useMemo(() => {
    if (mergeChecked.size < 2) return [];
    const checked = segments.filter(s => mergeChecked.has(s.segment_id));
    const checkedNums = new Set(checked.map(s => s.segment_number));
    const groups: Segment[][] = [];
    let current: Segment[] = [];
    for (const seg of segments) {
      if (checkedNums.has(seg.segment_number)) {
        current.push(seg);
      } else {
        if (current.length >= 2) groups.push(current);
        current = [];
      }
    }
    if (current.length >= 2) groups.push(current);
    return groups;
  }, [mergeChecked, segments]);

  const canMerge = mergeGroups.length > 0;

  

  // Recalculate durations from actual MP3 files for current scene
  const handleRecalcDurations = useCallback(async () => {
    if (!sceneId) return;
    setRecalcRunning(true);
    try {
      const { data: sceneRow } = await supabase
        .from("book_scenes")
        .select("chapter_id")
        .eq("id", sceneId)
        .single();
      if (!sceneRow) {
        toast.error(isRu ? "Не удалось найти главу" : "Could not find chapter");
        setRecalcRunning(false);
        return;
      }
      const { data, error } = await supabase.functions.invoke("recalc-durations", {
        body: { chapter_id: sceneRow.chapter_id },
      });
      if (error) {
        toast.error(isRu ? "Ошибка пересчёта" : "Recalc error");
      } else {
        const result = data as { updated: number; errors: number; total: number };
        if (result.updated > 0) {
          toast.success(isRu ? `Обновлено ${result.updated} из ${result.total} клипов` : `Updated ${result.updated} of ${result.total} clips`);
          onRecalcDone?.();
        } else {
          toast.info(isRu ? `Все длительности актуальны (${result.total} клипов)` : `All durations up to date (${result.total} clips)`);
        }
      }
    } catch (e) {
      console.error("recalc-durations exception:", e);
      toast.error(isRu ? "Ошибка пересчёта длительностей" : "Duration recalc error");
    }
    setRecalcRunning(false);
  }, [sceneId, isRu, onRecalcDone]);


  useEffect(() => {
    if (!selectedSegmentId) return;
    const el = document.getElementById(`storyboard-seg-${selectedSegmentId}`);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [selectedSegmentId]);

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
        .select("id, segment_number, segment_type, speaker, metadata")
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
      let loadedInlineSpeaker: string | null = null;
      if (mappings) {
        for (const m of mappings as any[]) {
          const name = charNameMap.get(m.character_id);
          if (name) {
            typeSpeakerMap.set(m.segment_type, name);
            if (m.segment_type === "inline_narration") loadedInlineSpeaker = name;
          }
        }
      }
      setInlineNarrationSpeaker(loadedInlineSpeaker);

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
        const meta = (s.metadata ?? {}) as Record<string, unknown>;
        const inlineNarr = Array.isArray(meta.inline_narrations) ? meta.inline_narrations as InlineNarration[] : undefined;
        return {
          segment_id: s.id,
          segment_number: s.segment_number,
          segment_type: s.segment_type,
          speaker,
          phrases: phraseMap.get(s.id) || [],
          inline_narrations: inlineNarr,
        };
      });

      // Persist auto-applied speakers and ensure character_appearances exist
      if (needUpdate.length > 0) {
        for (const [type, name] of typeSpeakerMap) {
          const ids = builtSegments
            .filter(s => s.segment_type === type && needUpdate.includes(s.segment_id))
            .map(s => s.segment_id);
          if (ids.length > 0) {
            await supabase.from("scene_segments").update({ speaker: name }).in("id", ids);
            // Ensure character_appearances record exists so the character shows in scene list & timeline
            const charRecord = characters.find(c => c.name === name);
            if (charRecord && sid) {
              const { data: existing } = await supabase
                .from("character_appearances")
                .select("id, segment_ids")
                .eq("character_id", charRecord.id)
                .eq("scene_id", sid)
                .maybeSingle();
              if (existing) {
                const merged = [...new Set([...existing.segment_ids, ...ids])];
                await supabase.from("character_appearances").update({ segment_ids: merged }).eq("id", existing.id);
              } else {
                await supabase.from("character_appearances").upsert(
                  { character_id: charRecord.id, scene_id: sid, role_in_scene: "speaker", segment_ids: ids },
                  { onConflict: "character_id,scene_id" }
                );
              }
            }
          }
        }
      }

      setSegments(builtSegments);
      // Track which segments have inline narrations
      const inlineIds = new Set(builtSegments.filter(s => s.inline_narrations && s.inline_narrations.length > 0).map(s => s.segment_id));
      setInlineNarrationSegIds(inlineIds);
      setLoaded(true);
      // Load audio status
      loadAudioStatus(builtSegments.map(s => s.segment_id));
    } catch (err) {
      console.error("Failed to load segments:", err);
      toast.error(isRu ? "Ошибка загрузки сегментов" : "Failed to load segments");
    }
    setLoading(false);
  }, [isRu, characters, loadAudioStatus]);

  const handleMergeSegments = useCallback(async () => {
    if (!sceneId || mergeGroups.length === 0) return;
    setMerging(true);
    try {
      for (const group of mergeGroups) {
        const [keeper, ...toMerge] = group;
        const mergeIds = toMerge.map(s => s.segment_id);

        // Collect all phrases in order: keeper's phrases + each merged segment's phrases
        // If a merged segment's first phrase doesn't start a new sentence,
        // concatenate it with the previous phrase's text
        let allPhrases = [...keeper.phrases];
        for (const seg of toMerge) {
          for (let pi = 0; pi < seg.phrases.length; pi++) {
            const ph = seg.phrases[pi];
            const startsNewSentence = /^[A-ZА-ЯЁ«"—–\-\[]/.test(ph.text.trimStart());
            if (pi === 0 && !startsNewSentence && allPhrases.length > 0) {
              // Merge text into previous phrase
              const prev = allPhrases[allPhrases.length - 1];
              const separator = prev.text.endsWith(" ") ? "" : " ";
              allPhrases[allPhrases.length - 1] = {
                ...prev,
                text: prev.text + separator + ph.text,
              };
              // Delete this phrase from DB since it's been merged into previous
              await supabase.from("segment_phrases").delete().eq("id", ph.phrase_id);
            } else {
              allPhrases.push(ph);
            }
          }
        }

        // Now reassign all phrases to keeper with correct numbering
        for (let i = 0; i < allPhrases.length; i++) {
          const ph = allPhrases[i];
          const isFromKeeper = keeper.phrases.some(kp => kp.phrase_id === ph.phrase_id);
          if (isFromKeeper) {
            // Update text (may have been concatenated) and phrase_number
            await supabase.from("segment_phrases")
              .update({ phrase_number: i + 1, text: ph.text })
              .eq("id", ph.phrase_id);
          } else {
            // Move from merged segment to keeper
            await supabase.from("segment_phrases")
              .update({ segment_id: keeper.segment_id, phrase_number: i + 1 })
              .eq("id", ph.phrase_id);
          }
        }

        await supabase.from("segment_audio").delete().in("segment_id", mergeIds);
        await supabase.from("scene_segments").delete().in("id", mergeIds);
      }
      // Renumber remaining segments sequentially
      const { data: remaining } = await supabase
        .from("scene_segments")
        .select("id, segment_number")
        .eq("scene_id", sceneId)
        .order("segment_number");
      if (remaining) {
        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].segment_number !== i + 1) {
            await supabase.from("scene_segments").update({ segment_number: i + 1 }).eq("id", remaining[i].id);
          }
        }
      }
      // Delete scene_playlists to force recalculation
      await supabase.from("scene_playlists").delete().eq("scene_id", sceneId);
      setMergeChecked(new Set());
      toast.success(isRu ? "Блоки объединены" : "Segments merged");
      await loadSegments(sceneId);
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Merge failed:", err);
      toast.error(isRu ? "Ошибка объединения" : "Merge failed");
    }
    setMerging(false);
  }, [sceneId, mergeGroups, isRu, loadSegments, onSegmented]);

  // Delete selected segments
  const handleDeleteSegments = useCallback(async () => {
    if (!sceneId || mergeChecked.size === 0) return;
    const toDelete = segments.filter(s => mergeChecked.has(s.segment_id));
    if (toDelete.length === 0) return;
    if (toDelete.length === segments.length) {
      toast.error(isRu ? "Нельзя удалить все блоки сцены" : "Cannot delete all segments");
      return;
    }
    setDeleting(true);
    try {
      const deleteIds = toDelete.map(s => s.segment_id);
      // Delete phrases, audio, then segments
      await supabase.from("segment_phrases").delete().in("segment_id", deleteIds);
      await supabase.from("segment_audio").delete().in("segment_id", deleteIds);
      await supabase.from("scene_segments").delete().in("id", deleteIds);
      // Renumber remaining segments sequentially
      const { data: remaining } = await supabase
        .from("scene_segments")
        .select("id, segment_number")
        .eq("scene_id", sceneId)
        .order("segment_number");
      if (remaining) {
        for (let i = 0; i < remaining.length; i++) {
          if (remaining[i].segment_number !== i + 1) {
            await supabase.from("scene_segments").update({ segment_number: i + 1 }).eq("id", remaining[i].id);
          }
        }
      }
      // Invalidate playlist to force timeline recalculation
      await supabase.from("scene_playlists").delete().eq("scene_id", sceneId);
      setMergeChecked(new Set());
      toast.success(isRu ? `Удалено ${toDelete.length} блок(ов)` : `Deleted ${toDelete.length} segment(s)`);
      await loadSegments(sceneId);
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Delete segments failed:", err);
      toast.error(isRu ? "Ошибка удаления" : "Delete failed");
    }
    setDeleting(false);
  }, [sceneId, mergeChecked, segments, isRu, loadSegments, onSegmented]);

  // Split a segment into two at a given phrase, splitting the phrase text
  const handleSplitAtPhrase = useCallback(async (phraseId: string, textBefore: string, textAfter: string) => {
    if (!sceneId) return;
    // Find segment containing this phrase
    const seg = segments.find(s => s.phrases.some(p => p.phrase_id === phraseId));
    if (!seg) return;
    const phraseIdx = seg.phrases.findIndex(p => p.phrase_id === phraseId);
    if (phraseIdx < 0) return;

    try {
      // Phrases staying in original segment: [0..phraseIdx] (split phrase gets textBefore)
      // Phrases moving to new segment: split phrase gets textAfter + [phraseIdx+1..]
      const keepPhrases = seg.phrases.slice(0, phraseIdx + 1);
      const movePhrases = seg.phrases.slice(phraseIdx + 1);

      // Update the split phrase to textBefore
      await supabase.from("segment_phrases").update({ text: textBefore }).eq("id", phraseId);

      // Shift all subsequent segments' numbers up by 1
      const { data: allSegs } = await supabase
        .from("scene_segments")
        .select("id, segment_number")
        .eq("scene_id", sceneId)
        .gt("segment_number", seg.segment_number)
        .order("segment_number", { ascending: false });
      if (allSegs) {
        for (const s of allSegs) {
          await supabase.from("scene_segments").update({ segment_number: s.segment_number + 1 }).eq("id", s.id);
        }
      }

      // Create the new segment
      const { data: newSeg } = await supabase
        .from("scene_segments")
        .insert({
          scene_id: sceneId,
          segment_number: seg.segment_number + 1,
          segment_type: seg.segment_type as any,
          speaker: seg.speaker,
          metadata: { split_silence_ms: 1000 },
        })
        .select("id")
        .single();

      if (!newSeg) throw new Error("Failed to create new segment");

      // Create new phrase for the textAfter part
      await supabase.from("segment_phrases").insert({
        segment_id: newSeg.id,
        phrase_number: 1,
        text: textAfter,
      });

      // Move remaining phrases to the new segment
      for (let i = 0; i < movePhrases.length; i++) {
        await supabase.from("segment_phrases")
          .update({ segment_id: newSeg.id, phrase_number: i + 2 })
          .eq("id", movePhrases[i].phrase_id);
      }

      // Delete audio for the original segment (text changed)
      await supabase.from("segment_audio").delete().eq("segment_id", seg.segment_id);

      // Invalidate playlist
      await supabase.from("scene_playlists").delete().eq("scene_id", sceneId);

      toast.success(isRu ? "Блок разделён" : "Segment split");
      await loadSegments(sceneId);
      onSegmented?.(sceneId);
    } catch (err: any) {
      console.error("Split failed:", err);
      toast.error(isRu ? "Ошибка разделения" : "Split failed");
    }
  }, [sceneId, segments, isRu, loadSegments, onSegmented]);


  useEffect(() => {
    setSegments([]);
    setLoaded(false);
    if (sceneId) loadSegments(sceneId);
  }, [sceneId, loadSegments]);

  // Realtime subscription: listen for segment_audio changes to update synthesizing state per-clip
  const synthIdsRef = useRef<Set<string>>(new Set());
  synthIdsRef.current = currentlySynthesizingIds;

  useEffect(() => {
    if (segments.length === 0) return;

    const segmentIdSet = new Set(segments.map(s => s.segment_id));
    const channel = supabase
      .channel(`segment_audio_${sceneId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "segment_audio",
        },
        (payload) => {
          const row = payload.new as { segment_id: string; status: string; duration_ms: number } | undefined;
          if (!row || !segmentIdSet.has(row.segment_id)) return;
          if (!synthIdsRef.current.has(row.segment_id)) return;

          // Remove from synthesizing set
          setCurrentlySynthesizingIds(prev => {
            const next = new Set(prev);
            next.delete(row.segment_id);
            onSynthesizingChange?.(next);
            return next;
          });
          // Update audio status for this segment
          setAudioStatus(prev => {
            const next = new Map(prev);
            next.set(row.segment_id, { status: row.status, durationMs: row.duration_ms });
            return next;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [segments.map(s => s.segment_id).join(","), sceneId, onSynthesizingChange]);

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

  // ── Full sync of character_appearances for scene ──
  // Scans all segments + type mappings to determine which characters are actually used,
  // removes stale appearances (empty tracks), and ensures used characters are present.
  const syncSceneCharacters = useCallback(async (updatedSegments: Segment[]) => {
    if (!sceneId) return;

    // 1. Collect all character IDs actually used
    const usedCharIds = new Set<string>();

    // From segment speakers
    for (const seg of updatedSegments) {
      if (seg.speaker) {
        const charRecord = characters.find(c => c.name === seg.speaker);
        if (charRecord) usedCharIds.add(charRecord.id);
      }
    }

    // From scene_type_mappings (includes first_person, inline_narration, footnote, etc.)
    const { data: mappings } = await supabase
      .from("scene_type_mappings" as any)
      .select("character_id")
      .eq("scene_id", sceneId);
    if (mappings) {
      for (const m of mappings as any[]) {
        usedCharIds.add(m.character_id);
      }
    }

    // Also include system characters that have auto-routed segments
    const SYSTEM_TYPES: Record<string, string> = {
      narrator: "рассказчик", epigraph: "рассказчик", lyric: "рассказчик",
      footnote: "комментатор",
    };
    for (const seg of updatedSegments) {
      const sysName = SYSTEM_TYPES[seg.segment_type];
      if (sysName) {
        const sysChar = characters.find(c => c.name.toLowerCase() === sysName);
        if (sysChar) usedCharIds.add(sysChar.id);
      }
    }

    // 2. Get current appearances
    const { data: currentAppearances } = await supabase
      .from("character_appearances")
      .select("id, character_id")
      .eq("scene_id", sceneId);

    if (!currentAppearances) return;

    // 3. Delete stale appearances
    const staleIds = currentAppearances
      .filter(a => !usedCharIds.has(a.character_id))
      .map(a => a.id);
    if (staleIds.length > 0) {
      await supabase.from("character_appearances").delete().in("id", staleIds);
    }

    // 4. Ensure all used characters have an appearance
    const existingCharIds = new Set(currentAppearances.map(a => a.character_id));
    for (const charId of usedCharIds) {
      if (!existingCharIds.has(charId)) {
        await supabase.from("character_appearances").upsert(
          { character_id: charId, scene_id: sceneId, role_in_scene: "speaker", segment_ids: [] },
          { onConflict: "character_id,scene_id" }
        );
      }
    }

    onSegmented?.(sceneId); // refresh timeline
  }, [sceneId, characters, onSegmented]);

  const PROPAGATE_TYPES = new Set(["narrator", "first_person", "inner_thought", "epigraph", "lyric", "footnote"]);

  // Narrator↔first_person propagation pairs
  const TYPE_PROPAGATION_PAIRS: Record<string, string> = {
    narrator: "first_person",
    first_person: "narrator",
  };

  // Update segment type in DB — propagates narrator↔first_person across all segments of old type
  const updateSegmentType = useCallback(async (segmentId: string, newType: string) => {
    const targetSeg = segments.find(s => s.segment_id === segmentId);
    if (!targetSeg) return;
    const oldType = targetSeg.segment_type;

    // Determine if we should propagate: narrator→first_person or first_person→narrator
    const shouldPropagate = TYPE_PROPAGATION_PAIRS[oldType] === newType;

    const affectedIds = shouldPropagate
      ? segments.filter(s => s.segment_type === oldType).map(s => s.segment_id)
      : [segmentId];

    const updatedSegments = segments.map(seg =>
      affectedIds.includes(seg.segment_id) ? { ...seg, segment_type: newType } : seg
    );
    setSegments(updatedSegments);

    const { error } = await supabase
      .from("scene_segments")
      .update({ segment_type: newType as any })
      .in("id", affectedIds);
    if (error) {
      toast.error(isRu ? "Ошибка сохранения типа" : "Failed to save type");
      return;
    }

    if (affectedIds.length > 1) {
      const newLabel = isRu
        ? SEGMENT_CONFIG[newType]?.label_ru
        : SEGMENT_CONFIG[newType]?.label_en;
      toast.success(
        isRu
          ? `Тип изменён: ${newLabel} (${affectedIds.length} фрагм.)`
          : `Type changed: ${newLabel} (${affectedIds.length} seg.)`
      );
    }

    if (!sceneId) return;

    // If old type was propagatable and no segments of that type remain, clean up mapping
    if (PROPAGATE_TYPES.has(oldType) && oldType !== newType) {
      const remainingOfOldType = updatedSegments.filter(s => s.segment_type === oldType);
      if (remainingOfOldType.length === 0) {
        await supabase
          .from("scene_type_mappings" as any)
          .delete()
          .eq("scene_id", sceneId)
          .eq("segment_type", oldType);
      }
    }

    // Full sync: clean up stale appearances, add missing ones
    await syncSceneCharacters(updatedSegments);
  }, [isRu, segments, sceneId, characters, syncSceneCharacters]);

  const updateSpeaker = useCallback(async (segmentId: string, newSpeaker: string | null) => {
    const targetSeg = segments.find(s => s.segment_id === segmentId);
    if (!targetSeg) return;

    const shouldPropagate = PROPAGATE_TYPES.has(targetSeg.segment_type);

    const affectedIds = shouldPropagate
      ? segments.filter(s => s.segment_type === targetSeg.segment_type).map(s => s.segment_id)
      : [segmentId];

    // Update locally
    const updatedSegments = segments.map(seg =>
      affectedIds.includes(seg.segment_id) ? { ...seg, speaker: newSpeaker } : seg
    );
    setSegments(updatedSegments);

    // Persist to DB
    const { error } = await supabase
      .from("scene_segments")
      .update({ speaker: newSpeaker })
      .in("id", affectedIds);

    // Upsert or delete scene-level type→character mapping (only for propagatable types)
    if (sceneId && shouldPropagate) {
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

    // Full sync: clean up stale appearances, add missing ones
    await syncSceneCharacters(updatedSegments);

    if (error) {
      toast.error(isRu ? "Ошибка сохранения персонажа" : "Failed to save speaker");
    } else if (affectedIds.length > 1) {
      const typeLabel = isRu
        ? SEGMENT_CONFIG[targetSeg.segment_type]?.label_ru
        : SEGMENT_CONFIG[targetSeg.segment_type]?.label_en;
      toast.success(
        isRu
          ? `«${typeLabel}» → ${newSpeaker || "?"} (${affectedIds.length} фрагм.)`
          : `"${typeLabel}" → ${newSpeaker || "?"} (${affectedIds.length} seg.)`
      );
    }
  }, [isRu, segments, sceneId, characters, syncSceneCharacters]);

  // ── Synthesize scene ──
  const runSynthesis = useCallback(async () => {
    if (!sceneId || segments.length === 0) return;
    const allIds = new Set(segments.map(s => s.segment_id));
    setSynthesizing(true);
    setCurrentlySynthesizingIds(allIds);
    onSynthesizingChange?.(allIds);
    onErrorSegmentsChange?.(new Set()); // Clear previous errors
    setSynthProgress(isRu ? "Запуск синтеза…" : "Starting synthesis…");
    try {
      const { data, error } = await supabase.functions.invoke("synthesize-scene", {
        body: { scene_id: sceneId, language: isRu ? "ru" : "en" },
      });
      if (error) throw error;
      const synth = data as { synthesized: number; errors: number; total_duration_ms: number; results?: Array<{ segment_id: string; status: string; error?: string }> };
      const durSec = (synth.total_duration_ms / 1000).toFixed(1);

      // Collect error segment IDs
      const errorIds = new Set<string>();
      if (synth.results) {
        for (const r of synth.results) {
          if (r.status === "error") errorIds.add(r.segment_id);
        }
      }
      onErrorSegmentsChange?.(errorIds);

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
    setCurrentlySynthesizingIds(new Set());
    onSynthesizingChange?.(new Set());
    setSynthProgress("");
  }, [sceneId, segments, isRu, onSegmented, loadAudioStatus, onSynthesizingChange, onErrorSegmentsChange]);

  // ── Re-synthesize single segment (force) ──
  const resynthSegment = useCallback(async (segmentId: string) => {
    if (!sceneId) return;
    setResynthSegId(segmentId);
    setCurrentlySynthesizingIds(new Set([segmentId]));
    onSynthesizingChange?.(new Set([segmentId]));
    try {
      // Delete existing audio record to force re-synthesis
      await supabase.from("segment_audio").delete().eq("segment_id", segmentId);
      const { data, error } = await supabase.functions.invoke("synthesize-scene", {
        body: { scene_id: sceneId, language: isRu ? "ru" : "en", force: true, segment_ids: [segmentId] },
      });
      if (error) throw error;
      toast.success(isRu ? "Блок пересинтезирован" : "Segment re-synthesized");
      onSegmented?.(sceneId);
      // Small delay to ensure DB write is committed before reloading status
      await new Promise(r => setTimeout(r, 500));
      await loadAudioStatus(segments.map(s => s.segment_id));
    } catch (err: any) {
      console.error("Re-synth failed:", err);
      toast.error(isRu ? "Ошибка ре-синтеза" : "Re-synthesis failed");
      // Reload status even on error to reflect current state
      await loadAudioStatus(segments.map(s => s.segment_id));
    }
    setResynthSegId(null);
    setCurrentlySynthesizingIds(new Set());
    onSynthesizingChange?.(new Set());
  }, [sceneId, isRu, onSegmented, loadAudioStatus, segments, onSynthesizingChange]);

  const dialogueCount = segments.filter(s => s.segment_type === "dialogue").length;
  const runDetectNarrations = useCallback(async () => {
    if (!sceneId || dialogueCount === 0) return;
    setDetecting(true);
    try {
      const { data, error } = await supabase.functions.invoke("detect-inline-narrations", {
        body: { scene_id: sceneId, language: isRu ? "ru" : "en" },
      });
      if (error) throw error;
      const det = data as { detected: number; segments_updated: number; message?: string };
      if (det.detected > 0) {
        toast.success(
          isRu
            ? `Найдено ${det.detected} вставок в ${det.segments_updated} фрагментах`
            : `Found ${det.detected} insertions in ${det.segments_updated} segments`
        );
        await loadSegments(sceneId);
      } else {
        toast.info(det.message || (isRu ? "Вставок не найдено" : "No insertions found"));
      }
    } catch (err: any) {
      console.error("Detection failed:", err);
      toast.error(isRu ? "Ошибка поиска вставок" : "Detection failed");
    }
    setDetecting(false);
  }, [sceneId, dialogueCount, isRu, loadSegments]);

  // ── Update inline narration voice assignment ──
  const updateInlineNarrationSpeaker = useCallback(async (newSpeaker: string | null) => {
    if (!sceneId) return;
    setInlineNarrationSpeaker(newSpeaker);
    const charRecord = newSpeaker ? characters.find(c => c.name === newSpeaker) : null;
    if (charRecord) {
      await supabase
        .from("scene_type_mappings" as any)
        .upsert(
          { scene_id: sceneId, segment_type: "inline_narration", character_id: charRecord.id },
          { onConflict: "scene_id,segment_type" }
        );
      toast.success(isRu ? `Голос вставок → ${newSpeaker}` : `Narration voice → ${newSpeaker}`);
    } else {
      await supabase
        .from("scene_type_mappings" as any)
        .delete()
        .eq("scene_id", sceneId)
        .eq("segment_type", "inline_narration");
      toast.success(isRu ? "Голос вставок сброшен" : "Narration voice reset");
    }
    // Full sync: clean up stale appearances, add missing ones
    await syncSceneCharacters(segments);
  }, [sceneId, characters, isRu, segments, syncSceneCharacters]);

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
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground font-body">
            {segments.length} {isRu ? "фрагм." : "seg."} · {totalPhrases} {isRu ? "фраз" : "phrases"}
            {inlineNarrationSegIds.size > 0 && (
              <span className="ml-1.5 text-accent-foreground">
                · <MessageCircle className="inline h-3 w-3 -mt-0.5" /> {inlineNarrationSegIds.size}
              </span>
            )}
          </span>
          {/* Silence duration selector */}
          <div className="flex items-center gap-1 ml-2 border-l border-border pl-2">
            <Timer className="h-3 w-3 text-muted-foreground" />
            {[1, 2, 3].map((sec) => (
              <button
                key={sec}
                onClick={() => onSilenceSecChange?.(sec)}
                className={cn(
                  "h-5 w-5 text-[10px] font-mono rounded transition-colors",
                  (silenceSec ?? 2) === sec
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted"
                )}
                title={isRu ? `Тишина в начале: ${sec}с` : `Start silence: ${sec}s`}
              >
                {sec}
              </button>
            ))}
            <span className="text-[10px] text-muted-foreground ml-0.5">
              {isRu ? "сек" : "s"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={!canMerge || merging || synthesizing}
            onClick={handleMergeSegments}
            title={isRu ? "Объединить выбранные соседние блоки" : "Merge selected adjacent segments"}
          >
            {merging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Merge className="h-3 w-3" />}
            {merging ? (isRu ? "Слияние…" : "Merging…") : (isRu ? "Объединить" : "Merge")}
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-7 gap-1.5 text-xs text-destructive hover:text-destructive"
                disabled={mergeChecked.size === 0 || deleting || synthesizing}
                title={isRu ? "Удалить выбранные блоки" : "Delete selected segments"}
              >
                {deleting ? <Loader2 className="h-3 w-3 animate-spin" /> : <Trash2 className="h-3 w-3" />}
                {deleting ? (isRu ? "Удаление…" : "Deleting…") : (isRu ? "Удалить" : "Delete")}
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{isRu ? "Удалить блоки?" : "Delete segments?"}</AlertDialogTitle>
                <AlertDialogDescription>
                  {isRu
                    ? `Будет удалено ${mergeChecked.size} блок(ов) вместе с фразами и аудио. Это действие нельзя отменить.`
                    : `${mergeChecked.size} segment(s) will be deleted along with phrases and audio. This cannot be undone.`}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
                <AlertDialogAction onClick={handleDeleteSegments} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  {isRu ? "Удалить" : "Delete"}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 text-xs"
            disabled={recalcRunning || !sceneId}
            onClick={handleRecalcDurations}
            title={isRu ? "Пересчитать длительности из MP3" : "Recalculate durations from MP3"}
          >
            {recalcRunning ? <Loader2 className="h-3 w-3 animate-spin" /> : <Timer className="h-3 w-3" />}
            {isRu ? "Пересчёт" : "Recalc"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={runSynthesis}
            disabled={synthesizing || analyzing || segments.length === 0}
            className="gap-1.5 h-7 text-xs"
          >
            {synthesizing ? <AudioLines className="h-3 w-3 animate-pulse-glow text-primary" /> : <AudioLines className="h-3 w-3" />}
            {synthesizing
              ? (synthProgress || (isRu ? "Синтез…" : "Synth…"))
              : (isRu ? "Синтез сцены" : "Synthesize")}
          </Button>
          {dialogueCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={runDetectNarrations}
              disabled={detecting || analyzing || synthesizing}
              className="gap-1.5 h-7 text-xs"
              title={isRu ? "Поиск авторских вставок в диалогах" : "Detect narrator insertions in dialogues"}
            >
              {detecting ? <Loader2 className="h-3 w-3 animate-spin" /> : <ScanSearch className="h-3 w-3" />}
              {detecting ? (isRu ? "Поиск…" : "Detecting…") : (isRu ? "Вставки" : "Narrations")}
            </Button>
          )}
          <Button variant="ghost" size="sm" onClick={runAnalysis} disabled={analyzing || !sceneContent} className="gap-1.5 h-7 text-xs">
            {analyzing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {isRu ? "Переанализ" : "Re-analyze"}
          </Button>
        </div>
      </div>
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-3 space-y-2">
          {segments.map((seg) => {
            const isSelected = selectedSegmentId === seg.segment_id;
            return (
              <div
                key={seg.segment_id}
                id={`storyboard-seg-${seg.segment_id}`}
                className={`rounded-lg border overflow-hidden transition-all cursor-pointer ${
                  isSelected
                    ? "border-primary ring-2 ring-primary/30 bg-card"
                    : "border-border bg-card/50"
                }`}
                onDoubleClick={() => onSelectSegment?.(seg.segment_id)}
              >
                {/* Segment header */}
                <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/30">
                  <SegmentTypeBadge
                    segmentType={seg.segment_type}
                    isRu={isRu}
                    onChange={(newType) => updateSegmentType(seg.segment_id, newType)}
                  />
                  {/* Hide speaker badge for narrator/footnote — they use book-level system characters */}
                  {seg.segment_type !== "narrator" && seg.segment_type !== "footnote" && (
                    <SpeakerBadge
                      speaker={seg.speaker}
                      characters={characters}
                      isRu={isRu}
                      onChange={(newSpeaker) => updateSpeaker(seg.segment_id, newSpeaker)}
                    />
                  )}
                  {/* Audio status indicator */}
                  {(() => {
                    const audio = audioStatus.get(seg.segment_id);
                    if (!audio) return null;
                    const durSec = (audio.durationMs / 1000).toFixed(1);
                    return audio.status === "ready" ? (
                      <span className="inline-flex items-center gap-1 text-[10px] text-green-400 font-mono">
                        <CheckCircle2 className="h-3 w-3" />
                        {durSec}s
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-[10px] text-destructive font-mono">
                        <XCircle className="h-3 w-3" />
                        {isRu ? "ошибка" : "error"}
                      </span>
                    );
                  })()}
                  {/* Inline narration indicator */}
                  {seg.inline_narrations && seg.inline_narrations.length > 0 && (
                    <span
                      className="inline-flex items-center gap-0.5 text-[10px] text-accent-foreground font-mono"
                      title={isRu
                        ? `${seg.inline_narrations.length} авторская вставка`
                        : `${seg.inline_narrations.length} narrator insertion(s)`}
                    >
                      <MessageCircle className="h-3 w-3" />
                      {seg.inline_narrations.length}
                    </span>
                  )}
                  {/* Synth / Re-synth button — always visible */}
                  <button
                    onClick={(e) => { e.stopPropagation(); resynthSegment(seg.segment_id); }}
                    disabled={resynthSegId === seg.segment_id || synthesizing}
                    className="ml-1 p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                    title={audioStatus.get(seg.segment_id)
                      ? (isRu ? "Ре-синтез блока" : "Re-synthesize segment")
                      : (isRu ? "Синтез блока" : "Synthesize segment")}
                  >
                    {resynthSegId === seg.segment_id
                      ? <AudioLines className="h-3 w-3 animate-pulse-glow text-primary" />
                      : audioStatus.get(seg.segment_id)
                        ? <RefreshCw className="h-3 w-3" />
                        : <AudioLines className="h-3 w-3" />}
                  </button>
                  <div className="ml-auto flex items-center gap-1.5">
                    <span className="text-[10px] text-muted-foreground font-mono">
                      #{seg.segment_number}
                    </span>
                    <Checkbox
                      checked={mergeChecked.has(seg.segment_id)}
                      onCheckedChange={() => toggleMergeCheck(seg.segment_id)}
                      onClick={(e) => e.stopPropagation()}
                      className="h-3.5 w-3.5"
                    />
                  </div>
                </div>
                {/* Phrases */}
                <div className="divide-y divide-border/30">
                  {seg.phrases.map((ph) => (
                    <EditablePhrase
                      key={ph.phrase_id}
                      phrase={ph}
                      isRu={isRu}
                      onSave={savePhrase}
                      onSplit={handleSplitAtPhrase}
                    />
                  ))}
                </div>
                {/* Inline narrations detail */}
                {seg.inline_narrations && seg.inline_narrations.length > 0 && (
                  <div className="px-3 py-1 bg-accent/10 border-t border-border/30">
                    <div className="flex items-center gap-2 mb-1">
                      <BookOpen className="h-3 w-3 text-yellow-400/70" />
                      <span className="text-[10px] text-muted-foreground font-mono">
                        {isRu ? "Голос вставок:" : "Narration voice:"}
                      </span>
                      <SpeakerBadge
                        speaker={inlineNarrationSpeaker}
                        characters={characters}
                        isRu={isRu}
                        onChange={updateInlineNarrationSpeaker}
                      />
                    </div>
                    {seg.inline_narrations.map((n, idx) => (
                      <div key={idx} className="text-sm font-body flex items-start gap-1 leading-relaxed">
                        <BookOpen className="h-3 w-3 mt-1 shrink-0 text-yellow-400/70" />
                        <span className="text-muted-foreground/60 shrink-0">
                          {isRu ? "после" : "after"} «{n.insert_after.slice(0, 20)}{n.insert_after.length > 20 ? "…" : ""}»
                        </span>
                        <span className="text-muted-foreground/60">→</span>
                        <span className="text-yellow-300/70">«{n.text}»</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
