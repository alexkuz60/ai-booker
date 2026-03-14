import { useState, useMemo } from "react";
import { ChevronDown, HelpCircle, User, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { CharacterOption } from "./types";

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

interface SpeakerBadgeProps {
  speaker: string | null;
  characters: CharacterOption[];
  isRu: boolean;
  onChange: (newSpeaker: string | null) => void;
}

export function SpeakerBadge({ speaker, characters, isRu, onChange }: SpeakerBadgeProps) {
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
