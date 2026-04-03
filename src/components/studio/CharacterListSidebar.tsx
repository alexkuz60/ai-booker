/**
 * CharacterListSidebar — left column of CharactersPanel.
 * Shows filtered character list with multi-select, filter, merge, profile actions.
 */

import { memo } from "react";
import {
  Users, UsersRound, Volume2, Loader2, Sparkles, User,
  Filter, Merge, CheckSquare, X, Check, SearchCheck,
} from "lucide-react";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import type { CharacterIndex } from "@/pages/parser/types";
import { TEMPERAMENT_LABELS } from "./CharacterProfileEditor";

interface CharacterListSidebarProps {
  isRu: boolean;
  characters: CharacterIndex[];
  filteredCharacters: CharacterIndex[];
  loading: boolean;
  selectedId: string | null;
  filterMode: "all" | "scene" | "chapter";
  sceneId?: string | null;
  effectiveSceneCharIds: Set<string>;
  multiSelect: boolean;
  selectedIds: Set<string>;
  merging: boolean;
  profiling: boolean;
  cleaningDupes: boolean;
  hasProfiles: boolean;
  segmentCounts: Map<string, number>;
  profilerModel: string;
  directorModel: string;
  isExtra: (charId: string) => boolean;
  onFilterModeChange: () => void;
  onToggleExtra: (id: string) => void;
  onToggleMultiSelect: () => void;
  onSelectCharacter: (id: string | null) => void;
  onToggleCharInSelection: (id: string) => void;
  onMerge: () => void;
  onProfile: () => void;
  onAutoCleanDuplicates: () => void;
}

export const CharacterListSidebar = memo(function CharacterListSidebar({
  isRu, characters, filteredCharacters, loading,
  selectedId, filterMode, sceneId, effectiveSceneCharIds,
  multiSelect, selectedIds, merging, profiling, cleaningDupes, hasProfiles,
  segmentCounts, profilerModel, directorModel,
  isExtra, onFilterModeChange, onToggleExtra, onToggleMultiSelect,
  onSelectCharacter, onToggleCharInSelection, onMerge, onProfile, onAutoCleanDuplicates,
}: CharacterListSidebarProps) {
  return (
    <div className="w-56 shrink-0 border-r border-border flex flex-col">
      <div className="p-3 border-b border-border flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold font-display text-foreground flex items-center gap-1.5">
            {isRu ? "Персонажи" : "Characters"}
            <RoleBadge roleId="profiler" model={profilerModel} isRu={isRu} size={13} />
            <RoleBadge roleId="director" model={directorModel} isRu={isRu} size={13} />
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant={filterMode !== "all" ? "secondary" : "ghost"}
              size="icon"
              className="h-6 w-6"
              onClick={onFilterModeChange}
              title={filterMode === "chapter"
                ? (isRu ? "Фильтр: глава" : "Filter: chapter")
                : filterMode === "scene"
                  ? (isRu ? "Фильтр: сцена" : "Filter: scene")
                  : (isRu ? "Фильтр: все" : "Filter: all")}
            >
              <Filter className={`h-3 w-3 ${filterMode !== "all" ? "text-primary" : ""}`} />
            </Button>
            {filterMode !== "all" && (
              <span className="text-[9px] text-primary font-medium">
                {filterMode === "chapter" ? (isRu ? "гл." : "ch.") : (isRu ? "сц." : "sc.")}
              </span>
            )}
            {selectedId && !multiSelect && (
              <Button
                variant={isExtra(selectedId) ? "secondary" : "ghost"}
                size="icon"
                className="h-6 w-6"
                onClick={() => onToggleExtra(selectedId)}
                title={isExtra(selectedId)
                  ? (isRu ? "Убрать из массовки" : "Remove from extras")
                  : (isRu ? "Пометить как массовку" : "Mark as extra")}
              >
                <UsersRound className={`h-3 w-3 ${isExtra(selectedId) ? "text-primary" : ""}`} />
              </Button>
            )}
            {characters.length > 1 && (
              <Button
                variant={multiSelect ? "secondary" : "ghost"}
                size="icon"
                className="h-6 w-6"
                onClick={onToggleMultiSelect}
                title={isRu ? "Мультивыбор для слияния" : "Multi-select for merge"}
              >
                {multiSelect ? <X className="h-3 w-3" /> : <CheckSquare className="h-3 w-3" />}
              </Button>
            )}
            {characters.length > 0 && (
              <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                {filterMode === "scene" && effectiveSceneCharIds.size > 0 ? filteredCharacters.length : characters.length}
              </Badge>
            )}
          </div>
        </div>
        {multiSelect && (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-1.5 text-xs"
            onClick={onMerge}
            disabled={merging || selectedIds.size < 2}
          >
            {merging ? <Loader2 className="h-3 w-3 animate-spin" /> : <Merge className="h-3 w-3" />}
            {merging
              ? (isRu ? "Слияние..." : "Merging...")
              : (isRu ? `Объединить (${selectedIds.size})` : `Merge (${selectedIds.size})`)}
          </Button>
        )}
        {!multiSelect && characters.length > 0 && (
          <div className="flex gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="flex-1 gap-1.5 text-xs"
              onClick={onProfile}
              disabled={profiling || cleaningDupes}
            >
              {profiling ? <Loader2 className="h-3 w-3 animate-spin" /> : <Sparkles className="h-3 w-3" />}
              {profiling
                ? (isRu ? "Анализ..." : "Profiling...")
                : hasProfiles
                  ? (isRu ? "Обновить профайлы" : "Re-profile")
                  : (isRu ? "AI-профайлинг" : "AI Profile")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1 text-xs px-2"
              onClick={onAutoCleanDuplicates}
              disabled={cleaningDupes || profiling}
              title={isRu ? "Найти и объединить дубликаты" : "Find & merge duplicates"}
            >
              {cleaningDupes ? <Loader2 className="h-3 w-3 animate-spin" /> : <SearchCheck className="h-3 w-3" />}
            </Button>
          </div>
        )}
      </div>

      <ScrollArea className="flex-1">
        {loading ? (
          <div className="p-4 flex justify-center">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : filteredCharacters.length === 0 ? (
          <div className="p-4 text-center">
            <Users className="h-8 w-8 mx-auto text-muted-foreground/40 mb-2" />
            <p className="text-xs text-muted-foreground">
              {filterMode === "scene"
                ? (isRu ? "Повествовательная сцена — нет персонажей с диалогами. Используйте Рассказчика и Комментатора." : "Narrative scene — no dialogue characters. Use Narrator and Commentator.")
                : (isRu ? "Персонажи появятся после сегментации сцен" : "Characters will appear after scene segmentation")}
            </p>
          </div>
        ) : (
          <div className="p-1 space-y-0.5">
            {filteredCharacters.map(ch => (
              <button
                key={ch.id}
                onClick={() => {
                  if (multiSelect) {
                    onToggleCharInSelection(ch.id);
                  } else {
                    onSelectCharacter(ch.id);
                  }
                }}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  multiSelect
                    ? selectedIds.has(ch.id)
                      ? "bg-primary/15 text-accent-foreground ring-1 ring-primary/30"
                      : "text-muted-foreground hover:bg-muted/50"
                    : selectedId === ch.id
                      ? "bg-accent/15 text-accent-foreground"
                      : "text-muted-foreground hover:bg-muted/50"
                }`}
              >
                <div className="flex items-center gap-2">
                  {multiSelect && (
                    <div className={`h-3.5 w-3.5 rounded border shrink-0 flex items-center justify-center ${
                      selectedIds.has(ch.id) ? "bg-primary border-primary" : "border-muted-foreground/40"
                    }`}>
                      {selectedIds.has(ch.id) && <Check className="h-2.5 w-2.5 text-primary-foreground" />}
                    </div>
                  )}
                  <span className="truncate font-medium">{ch.name}</span>
                  <div className="flex items-center gap-1 shrink-0">
                    {isExtra(ch.id) && (
                      <span title={isRu ? "Массовка" : "Extra"}><UsersRound className="h-3 w-3 text-muted-foreground/50" /></span>
                    )}
                    {ch.description && <User className="h-3 w-3 text-primary/60" />}
                    {ch.voice_config?.voice_id && <Volume2 className="h-3 w-3 text-primary/60" />}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {ch.gender !== "unknown" && (
                    <span className="text-[10px] text-muted-foreground/60">
                      {ch.gender === "female" ? "♀" : "♂"}
                    </span>
                  )}
                  {ch.temperament && (
                    <span className="text-[10px] text-muted-foreground/50 truncate">
                      {TEMPERAMENT_LABELS[ch.temperament]?.[isRu ? "ru" : "en"] ?? ch.temperament}
                    </span>
                  )}
                  {((ch.psycho_tags?.length ?? 0) > 0 || (ch.speech_tags?.length ?? 0) > 0) && (
                    <span className="text-[10px] text-violet-400/70" title={[...(ch.psycho_tags || []), ...(ch.speech_tags || [])].join(", ")}>
                      🎭{(ch.psycho_tags?.length ?? 0) + (ch.speech_tags?.length ?? 0)}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </ScrollArea>
    </div>
  );
});
