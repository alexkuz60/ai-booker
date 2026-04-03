/**
 * CharacterProfileEditor — displays and edits a character's profile attributes.
 * Extracted from CharactersPanel.tsx for modularity.
 */

import { memo } from "react";
import { Loader2, Sparkles, UsersRound, MessageSquareQuote } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { RoleBadge } from "@/components/ui/RoleBadge";
import type { CharacterIndex } from "@/pages/parser/types";

// ─── Constants (shared with CharactersPanel) ─────────────
export const GENDER_LABELS: Record<string, { ru: string; en: string }> = {
  male: { ru: "Мужской ♂", en: "Male ♂" },
  female: { ru: "Женский ♀", en: "Female ♀" },
  unknown: { ru: "Не определён", en: "Unknown" },
};
export const GENDER_OPTIONS = ["male", "female"] as const;

export const TEMPERAMENT_OPTIONS = ["sanguine", "choleric", "melancholic", "phlegmatic", "mixed"] as const;

const AGE_LABELS: Record<string, { ru: { m: string; f: string; u: string }; en: { m: string; f: string; u: string } }> = {
  infant:  { ru: { m: "Младенец", f: "Младенец", u: "Младенец" },       en: { m: "Infant", f: "Infant", u: "Infant" } },
  child:   { ru: { m: "Мальчик", f: "Девочка", u: "Ребёнок" },         en: { m: "Boy", f: "Girl", u: "Child" } },
  teen:    { ru: { m: "Подросток", f: "Подросток", u: "Подросток" },    en: { m: "Teen boy", f: "Teen girl", u: "Teen" } },
  young:   { ru: { m: "Юноша", f: "Девушка", u: "Молодой" },           en: { m: "Young man", f: "Young woman", u: "Young" } },
  adult:   { ru: { m: "Мужчина", f: "Женщина", u: "Взрослый" },        en: { m: "Man", f: "Woman", u: "Adult" } },
  elder:   { ru: { m: "Старик", f: "Старуха", u: "Пожилой" },           en: { m: "Old man", f: "Old woman", u: "Elder" } },
  unknown: { ru: { m: "Не определён", f: "Не определён", u: "Не определён" }, en: { m: "Unknown", f: "Unknown", u: "Unknown" } },
};
export const AGE_OPTIONS = ["infant", "child", "teen", "young", "adult", "elder"] as const;

export function getAgeLabel(ageGroup: string, gender: string, isRu: boolean): string {
  const entry = AGE_LABELS[ageGroup];
  if (!entry) return ageGroup;
  const lang = isRu ? "ru" : "en";
  const g = gender === "male" ? "m" : gender === "female" ? "f" : "u";
  return entry[lang][g];
}

export const TEMPERAMENT_LABELS: Record<string, { ru: string; en: string }> = {
  sanguine: { ru: "Сангвиник", en: "Sanguine" },
  choleric: { ru: "Холерик", en: "Choleric" },
  melancholic: { ru: "Меланхолик", en: "Melancholic" },
  phlegmatic: { ru: "Флегматик", en: "Phlegmatic" },
  mixed: { ru: "Смешанный", en: "Mixed" },
};

// ─── Props ─────────────────────────────────────────────────

interface SpeechContext {
  emotion?: unknown;
  tempo?: unknown;
  volume_hint?: unknown;
  manner?: unknown;
  tts_instructions_ru?: unknown;
  tts_instructions_en?: unknown;
}

interface CharacterProfileEditorProps {
  isRu: boolean;
  selectedChar: CharacterIndex | null;
  isExtra: boolean;
  profiling: boolean;
  sceneId?: string | null;
  effectiveSceneCharIds: Set<string>;
  speechContext?: SpeechContext;
  refiningSpeech: boolean;
  getModelForRole: (role: string) => string;
  onProfile: () => void;
  onGenderChange: (charId: string, gender: string) => void;
  onAgeChange: (charId: string, age: string) => void;
  onTemperamentChange: (charId: string, temperament: string) => void;
  onRefineSpeech: () => void;
}

export const CharacterProfileEditor = memo(function CharacterProfileEditor({
  isRu, selectedChar, isExtra, profiling,
  sceneId, effectiveSceneCharIds, speechContext, refiningSpeech,
  getModelForRole,
  onProfile, onGenderChange, onAgeChange, onTemperamentChange, onRefineSpeech,
}: CharacterProfileEditorProps) {
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold font-display text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
          {isRu ? "Профайл" : "Profile"}
          <RoleBadge roleId="profiler" model={getModelForRole("profiler")} isRu={isRu} size={12} />
        </h3>
        {selectedChar && (
          <Button variant="ghost" size="sm" className="h-6 px-2 gap-1 text-xs" onClick={onProfile} disabled={profiling}>
            {profiling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
            {isRu ? "Обновить профайл" : "Re-profile"}
          </Button>
        )}
      </div>

      {selectedChar ? (
        <>
          <div>
            <h4 className="text-base font-semibold font-display text-foreground mb-2 flex items-center gap-2">
              {selectedChar.name}
              {isExtra && (
                <span title={isRu ? "Массовка" : "Extra"}><UsersRound className="h-4 w-4 text-muted-foreground/60" /></span>
              )}
            </h4>
            {selectedChar.description && (
              <p className="text-sm text-foreground/90 leading-relaxed mb-3">{selectedChar.description}</p>
            )}
            <div className="flex flex-wrap gap-2 mb-2">
              {/* Gender picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex items-center">
                    <Badge
                      variant="outline"
                      className={`text-xs cursor-pointer transition-colors hover:bg-accent/20 ${
                        selectedChar.gender === "unknown" ? "border-dashed border-warning text-warning" : ""
                      }`}
                    >
                      {GENDER_LABELS[selectedChar.gender]?.[isRu ? "ru" : "en"] ?? selectedChar.gender}
                      {selectedChar.gender === "unknown" && " ▾"}
                    </Badge>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-1.5" align="start">
                  <div className="grid gap-0.5">
                    {GENDER_OPTIONS.map(g => (
                      <button
                        key={g}
                        className={`px-3 py-1.5 text-xs rounded-md text-left transition-colors ${
                          selectedChar.gender === g ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground"
                        }`}
                        onClick={() => onGenderChange(selectedChar.id, g)}
                      >
                        {GENDER_LABELS[g]?.[isRu ? "ru" : "en"]}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {/* Age picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex items-center">
                    <Badge
                      variant="outline"
                      className={`text-xs cursor-pointer transition-colors hover:bg-accent/20 ${
                        (selectedChar.age_group || "unknown") === "unknown" ? "border-dashed border-warning text-warning" : ""
                      }`}
                    >
                      {getAgeLabel(selectedChar.age_group || "unknown", selectedChar.gender, isRu)}
                      {(selectedChar.age_group || "unknown") === "unknown" && " ▾"}
                    </Badge>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-1.5" align="start">
                  <div className="grid gap-0.5">
                    {AGE_OPTIONS.map(age => (
                      <button
                        key={age}
                        className={`px-3 py-1.5 text-xs rounded-md text-left transition-colors ${
                          selectedChar.age_group === age ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground"
                        }`}
                        onClick={() => onAgeChange(selectedChar.id, age)}
                      >
                        {getAgeLabel(age, selectedChar.gender, isRu)}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              {/* Temperament picker */}
              <Popover>
                <PopoverTrigger asChild>
                  <button type="button" className="inline-flex items-center">
                    <Badge
                      variant="secondary"
                      className={`text-xs cursor-pointer transition-colors hover:bg-accent/20 ${
                        !selectedChar.temperament ? "border-dashed border-warning text-warning" : ""
                      }`}
                    >
                      {selectedChar.temperament
                        ? (TEMPERAMENT_LABELS[selectedChar.temperament]?.[isRu ? "ru" : "en"] ?? selectedChar.temperament)
                        : (isRu ? "Темперамент ▾" : "Temperament ▾")}
                    </Badge>
                  </button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-1.5" align="start">
                  <div className="grid gap-0.5">
                    {TEMPERAMENT_OPTIONS.map(t => (
                      <button
                        key={t}
                        className={`px-3 py-1.5 text-xs rounded-md text-left transition-colors ${
                          selectedChar.temperament === t ? "bg-accent text-accent-foreground" : "hover:bg-muted text-foreground"
                        }`}
                        onClick={() => onTemperamentChange(selectedChar.id, t)}
                      >
                        {TEMPERAMENT_LABELS[t]?.[isRu ? "ru" : "en"]}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
            </div>
            {/* Tags */}
            {((selectedChar.speech_tags?.length ?? 0) > 0 || (selectedChar.psycho_tags?.length ?? 0) > 0) && (
              <div className="mt-3 space-y-2">
                {(selectedChar.speech_tags?.length ?? 0) > 0 && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Манера речи" : "Speech manner"}</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedChar.speech_tags!.map((tag, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 border-sky-500/40 text-sky-400">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}
                {(selectedChar.psycho_tags?.length ?? 0) > 0 && (
                  <div>
                    <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Психотип" : "Psychotype"}</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {selectedChar.psycho_tags!.map((tag, i) => (
                        <Badge key={i} variant="outline" className="text-[10px] px-1.5 py-0 border-violet-500/40 text-violet-400">{tag}</Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            {selectedChar.speech_style && (
              <div className="mt-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Стиль речи" : "Speech Style"}</span>
                <p className="text-xs text-muted-foreground mt-1 italic">{selectedChar.speech_style}</p>
              </div>
            )}
            {selectedChar.aliases.length > 0 && (
              <div className="mt-2">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "Также известен как" : "Also known as"}</span>
                <p className="text-xs text-muted-foreground mt-1">{selectedChar.aliases.join(", ")}</p>
              </div>
            )}
            {/* Scene-level Speech Refinement */}
            {sceneId && selectedChar && effectiveSceneCharIds.has(selectedChar.id) && (
              <div className="mt-4 pt-3 border-t border-border">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                    <MessageSquareQuote className="h-3 w-3" />
                    {isRu ? "Речь в сцене" : "Speech in Scene"}
                  </span>
                  <Button variant="outline" size="sm" className="h-6 px-2 gap-1 text-xs" onClick={onRefineSpeech} disabled={refiningSpeech || profiling}>
                    {refiningSpeech ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
                    {refiningSpeech ? (isRu ? "Анализ…" : "Analyzing…") : (isRu ? "Уточнить речь" : "Refine Speech")}
                  </Button>
                </div>
                {speechContext ? (
                  <div className="space-y-1.5">
                    {speechContext.emotion && (<div className="flex items-center gap-2"><Badge variant="secondary" className="text-[10px] px-1.5 py-0">{isRu ? "Эмоция" : "Emotion"}</Badge><span className="text-xs text-foreground">{String(speechContext.emotion)}</span></div>)}
                    <div className="flex flex-wrap gap-1.5">
                      {speechContext.tempo && (<Badge variant="outline" className="text-[10px] px-1.5 py-0">⏱ {String(speechContext.tempo)}</Badge>)}
                      {speechContext.volume_hint && (<Badge variant="outline" className="text-[10px] px-1.5 py-0">🔊 {String(speechContext.volume_hint)}</Badge>)}
                    </div>
                    {speechContext.manner && (<p className="text-xs text-muted-foreground italic">{String(speechContext.manner)}</p>)}
                    {(speechContext.tts_instructions_ru || speechContext.tts_instructions_en) && (
                      <div className="mt-1 p-2 rounded-md bg-muted/30 border border-border">
                        <span className="text-[9px] font-medium text-muted-foreground uppercase tracking-wider">{isRu ? "TTS инструкции" : "TTS Instructions"}</span>
                        <p className="text-[11px] text-foreground/80 mt-0.5">{String(isRu ? (speechContext.tts_instructions_ru || speechContext.tts_instructions_en) : (speechContext.tts_instructions_en || speechContext.tts_instructions_ru))}</p>
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-[10px] text-muted-foreground/50 italic">{isRu ? "Нажмите «Уточнить речь» для анализа манеры в этой сцене" : "Click 'Refine Speech' to analyze manner in this scene"}</p>
                )}
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
          {isRu ? "Выберите персонажа" : "Select a character"}
        </div>
      )}
    </div>
  );
});
