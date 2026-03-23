/**
 * Character profile column for Narrators page.
 * Shows description, badges, speech style/tags, psycho tags, aliases, appearances.
 * Mirrors the profile view from ParserCharactersPanel.
 */

import { Brain } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

// ─── i18n ────────────────────────────────────────────────
const AGE_LABELS: Record<string, { ru: string; en: string }> = {
  infant: { ru: "Младенец", en: "Infant" },
  child: { ru: "Ребёнок", en: "Child" },
  teen: { ru: "Подросток", en: "Teen" },
  young: { ru: "Молодой", en: "Young" },
  adult: { ru: "Взрослый", en: "Adult" },
  elder: { ru: "Пожилой", en: "Elder" },
};

const TEMPERAMENT_LABELS: Record<string, { ru: string; en: string }> = {
  sanguine: { ru: "Сангвиник", en: "Sanguine" },
  choleric: { ru: "Холерик", en: "Choleric" },
  melancholic: { ru: "Меланхолик", en: "Melancholic" },
  phlegmatic: { ru: "Флегматик", en: "Phlegmatic" },
  mixed: { ru: "Смешанный", en: "Mixed" },
};

function localize(value: string, map: Record<string, { ru: string; en: string }>, isRu: boolean): string {
  return map[value.toLowerCase().trim()]?.[isRu ? "ru" : "en"] ?? value;
}

// ─── Types ───────────────────────────────────────────────

export interface CharacterProfileData {
  id: string;
  name: string;
  gender: string;
  age_group: string;
  temperament: string | null;
  description: string | null;
  speech_style: string | null;
  speech_tags: string[];
  psycho_tags: string[];
  aliases: string[];
  appearances: { chapterIdx: number; chapterTitle: string; sceneNumbers: number[] }[];
}

interface CharacterProfileColumnProps {
  character: CharacterProfileData;
  isRu: boolean;
  onClose?: () => void;
}

export function CharacterProfileColumn({ character, isRu, onClose }: CharacterProfileColumnProps) {
  return (
    <div className="flex flex-col min-h-0 overflow-hidden h-full">
      {/* Header */}
      <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 flex-shrink-0">
        <Brain className="h-4 w-4 text-primary" />
        <h3 className="text-xs font-semibold font-display text-muted-foreground uppercase tracking-wider flex-1">
          {isRu ? "Профайл" : "Profile"}
        </h3>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-4">
          {/* Name */}
          <h4 className="text-base font-semibold font-display text-foreground">
            {character.name}
          </h4>

          {/* Description */}
          {character.description && (
            <p className="text-sm text-foreground/90 leading-relaxed">
              {character.description}
            </p>
          )}

          {/* Badges */}
          <div className="flex flex-wrap gap-2">
            {character.gender && character.gender !== "unknown" && (
              <Badge variant="outline" className="text-xs">
                {character.gender === "male"
                  ? (isRu ? "Мужской ♂" : "Male ♂")
                  : (isRu ? "Женский ♀" : "Female ♀")}
              </Badge>
            )}
            {character.age_group && character.age_group !== "unknown" && (
              <Badge variant="outline" className="text-xs">
                {localize(character.age_group, AGE_LABELS, isRu)}
              </Badge>
            )}
            {character.temperament && (
              <Badge variant="secondary" className="text-xs">
                {localize(character.temperament, TEMPERAMENT_LABELS, isRu)}
              </Badge>
            )}
          </div>

          {/* Speech style */}
          {character.speech_style && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Стиль речи" : "Speech Style"}
              </span>
              <p className="text-xs text-muted-foreground mt-1 italic">
                {character.speech_style}
              </p>
            </div>
          )}

          {/* Speech tags */}
          {character.speech_tags.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Теги речи" : "Speech Tags"}
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {character.speech_tags.map((tag) => (
                  <Badge key={tag} variant="outline" className="text-[10px] bg-accent/30 border-accent/50 text-accent-foreground">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Psycho tags */}
          {character.psycho_tags.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Теги психотипа" : "Psychotype Tags"}
              </span>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {character.psycho_tags.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-[10px]">
                    {tag}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Aliases */}
          {character.aliases.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Также известен как" : "Also known as"}
              </span>
              <p className="text-xs text-muted-foreground mt-1">
                {character.aliases.join(", ")}
              </p>
            </div>
          )}

          {/* Appearances */}
          {character.appearances.length > 0 && (
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Появления" : "Appearances"}
              </span>
              <div className="mt-1.5 space-y-1">
                {character.appearances.map((app) => (
                  <div key={app.chapterIdx} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground font-mono w-8 flex-shrink-0 text-right">
                      #{app.chapterIdx + 1}
                    </span>
                    <span className="truncate flex-1 text-foreground/80">
                      {app.chapterTitle}
                    </span>
                    {app.sceneNumbers.length > 0 && (
                      <span className="text-muted-foreground font-mono flex-shrink-0">
                        {isRu ? "сц." : "sc."} {app.sceneNumbers.join(", ")}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {!character.description && character.appearances.length === 0 && (
            <p className="text-xs text-muted-foreground/60 italic">
              {isRu ? "Профайл ещё не создан. Используйте AI-профилирование в Парсере." : "Profile not created yet. Use AI profiling in Parser."}
            </p>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
