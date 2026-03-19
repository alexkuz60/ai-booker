/**
 * Parser Characters Panel — right sidebar for managing extracted characters.
 * Supports: extraction, rename, aliases editing, merge, delete, appearance view.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Users, Scan, Plus, Trash2, Merge, Edit2, X, Check, ChevronDown, ChevronRight,
  ChevronUp, Brain, Loader2, Mic, MicOff, UserRound, RotateCcw, Play, BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSub,
  DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { RoleBadge } from "@/components/ui/RoleBadge";
import type { LocalCharacter, CharacterRole, TocChapter, Scene, ChapterStatus } from "@/pages/parser/types";

// ─── i18n maps for profile badges ────────────────────────
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

const ROLE_LABELS: Record<string, { ru: string; en: string; color: string }> = {
  speaking: { ru: "Говорит", en: "Speaking", color: "text-emerald-500 dark:text-emerald-400" },
  mentioned: { ru: "Упомянут", en: "Mentioned", color: "text-muted-foreground/60" },
  crowd: { ru: "Массовка", en: "Crowd", color: "text-amber-500 dark:text-amber-400" },
  system: { ru: "Системный", en: "System", color: "text-primary/70" },
};

function localizeLabel(value: string, map: Record<string, { ru: string; en: string }>, isRu: boolean): string {
  const key = value.toLowerCase().trim();
  const entry = map[key];
  return entry ? entry[isRu ? "ru" : "en"] : value;
}

interface ParserCharactersPanelProps {
  isRu: boolean;
  characters: LocalCharacter[];
  extracting: boolean;
  extractProgress?: string | null;
  onExtract: (opts?: { mode?: "fresh" | "continue" | "chapter"; chapterIdx?: number }) => void;
  onRename: (id: string, newName: string) => void;
  onUpdateGender: (id: string, gender: "male" | "female" | "unknown") => void;
  onUpdateAliases: (id: string, aliases: string[]) => void;
  onDelete: (id: string) => void;
  onMerge: (sourceId: string, targetId: string) => void;
  onAdd: (name: string) => void;
  analyzedCount: number;
  profilerModel?: string;
  profiling?: boolean;
  profileProgress?: string | null;
  onProfile?: (charIds: string[]) => void;
  tocEntries: TocChapter[];
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
}

export default function ParserCharactersPanel({
  isRu,
  characters,
  extracting,
  extractProgress,
  onExtract,
  onRename,
  onUpdateGender,
  onUpdateAliases,
  onDelete,
  onMerge,
  onAdd,
  analyzedCount,
  profilerModel,
  profiling,
  profileProgress,
  onProfile,
  tocEntries,
  chapterResults,
}: ParserCharactersPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [profileViewId, setProfileViewId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [bulkDeleteConfirm, setBulkDeleteConfirm] = useState(false);
  const [genderPopoverOpen, setGenderPopoverOpen] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<"all" | "male" | "female">("all");
  const [roleFilter, setRoleFilter] = useState<"characters" | "crowd" | "all">("characters");
  const [sortCol, setSortCol] = useState<"name" | "ch" | "brain">("name");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const editRef = useRef<HTMLInputElement>(null);
  const aliasRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());

  // Track which character IDs are new (for entrance animation)
  const newCharIds = useMemo(() => {
    const newIds = new Set<string>();
    for (const c of characters) {
      if (!seenIdsRef.current.has(c.id)) newIds.add(c.id);
    }
    // Update seen set
    for (const c of characters) seenIdsRef.current.add(c.id);
    return newIds;
  }, [characters]);

  // Filtered characters based on role + gender
  const filteredCharacters = useMemo(() => {
    return characters.filter(c => {
      if (genderFilter !== "all" && c.gender !== genderFilter) return false;
      const role = c.role || "speaking";
      if (roleFilter === "characters") {
        return role === "speaking" || role === "mentioned" || role === "system";
      }
      if (roleFilter === "crowd") {
        return role === "crowd";
      }
      return true;
    });
  }, [characters, genderFilter, roleFilter]);

  // Sorted characters
  const sortedCharacters = useMemo(() => {
    const arr = [...filteredCharacters];
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortCol) {
      case "name":
        arr.sort((a, b) => dir * a.name.localeCompare(b.name));
        break;
      case "ch":
        arr.sort((a, b) => {
          const aMin = a.appearances.length > 0 ? Math.min(...a.appearances.map(ap => ap.chapterIdx)) : Infinity;
          const bMin = b.appearances.length > 0 ? Math.min(...b.appearances.map(ap => ap.chapterIdx)) : Infinity;
          return dir * (aMin - bMin) || a.name.localeCompare(b.name);
        });
        break;
      case "brain":
        arr.sort((a, b) => {
          const aHas = a.profile?.description ? 1 : 0;
          const bHas = b.profile?.description ? 1 : 0;
          if (aHas !== bHas) return dir * (bHas - aHas);
          return a.name.localeCompare(b.name);
        });
        break;
    }
    return arr;
  }, [filteredCharacters, sortCol, sortDir]);

  const handleSort = (col: "name" | "ch" | "brain") => {
    if (sortCol === col) {
      setSortDir(d => d === "asc" ? "desc" : "asc");
    } else {
      setSortCol(col);
      setSortDir("asc");
    }
  };

  const SortIcon = ({ col }: { col: "name" | "ch" | "brain" }) => {
    if (sortCol !== col) return null;
    return sortDir === "asc"
      ? <ChevronUp className="h-2.5 w-2.5 inline ml-0.5" />
      : <ChevronDown className="h-2.5 w-2.5 inline ml-0.5" />;
  };

  useEffect(() => {
    if (editingId) { editRef.current?.focus(); editRef.current?.select(); }
  }, [editingId]);

  useEffect(() => {
    if (editingAliasId) { aliasRef.current?.focus(); }
  }, [editingAliasId]);

  useEffect(() => {
    if (addingNew) { newRef.current?.focus(); }
  }, [addingNew]);

  const commitRename = () => {
    if (editingId && editValue.trim()) {
      onRename(editingId, editValue.trim());
    }
    setEditingId(null);
  };

  const addAlias = (charId: string) => {
    if (!aliasValue.trim()) return;
    const char = characters.find(c => c.id === charId);
    if (!char) return;
    if (!char.aliases.includes(aliasValue.trim()) && char.name !== aliasValue.trim()) {
      onUpdateAliases(charId, [...char.aliases, aliasValue.trim()]);
    }
    setAliasValue("");
  };

  const removeAlias = (charId: string, alias: string) => {
    const char = characters.find(c => c.id === charId);
    if (!char) return;
    onUpdateAliases(charId, char.aliases.filter(a => a !== alias));
  };

  const handleMergeSelected = () => {
    const ids = Array.from(selectedIds);
    if (ids.length < 2) return;
    // Merge all into the first (most popular) character
    const sorted = ids
      .map(id => characters.find(c => c.id === id)!)
      .filter(Boolean)
      .sort((a, b) => b.sceneCount - a.sceneCount);
    const targetId = sorted[0].id;
    for (let i = 1; i < sorted.length; i++) {
      onMerge(sorted[i].id, targetId);
    }
    setSelectedIds(new Set());
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const profileViewChar = profileViewId ? characters.find(c => c.id === profileViewId) : null;

  return (
    <div className="flex h-full min-h-0 overflow-hidden">
    {/* Left column: table */}
    <div className="flex flex-col flex-1 min-w-0 min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-shrink-0">
        <Users className="h-5 w-5 text-primary" />
        <h2 className="font-display font-semibold text-base text-foreground flex-1">
          {isRu ? "Персонажи" : "Characters"}
        </h2>
        <RoleBadge roleId="profiler" model={profilerModel} isRu={isRu} size={16} />
        {characters.length > 0 && (
          <div className="flex items-center gap-1 ml-1">
            {/* Role filter: characters vs crowd vs all */}
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setRoleFilter(f => f === "characters" ? "crowd" : f === "crowd" ? "all" : "characters")}
                  className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors flex items-center gap-0.5 ${
                    roleFilter === "characters"
                      ? "bg-emerald-500/20 text-emerald-500 dark:text-emerald-400"
                      : roleFilter === "crowd"
                        ? "bg-amber-500/20 text-amber-500 dark:text-amber-400"
                        : "text-muted-foreground/50 hover:text-muted-foreground"
                  }`}
                >
                  {roleFilter === "crowd" ? <MicOff className="h-3 w-3" /> : <Mic className="h-3 w-3" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-xs">
                {roleFilter === "characters"
                  ? (isRu ? "Персонажи · Нажми для массовки" : "Characters · Click for crowd")
                  : roleFilter === "crowd"
                    ? (isRu ? "Массовка · Нажми для всех" : "Crowd · Click for all")
                    : (isRu ? "Все · Нажми для персонажей" : "All · Click for characters")}
              </TooltipContent>
            </Tooltip>
            {/* Gender filters */}
            <button
              onClick={() => setGenderFilter(f => f === "male" ? "all" : "male")}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                genderFilter === "male"
                  ? "bg-sky-500/20 text-sky-500 dark:text-sky-400"
                  : "text-muted-foreground/50 hover:text-muted-foreground"
              }`}
              title={isRu ? "Мужские" : "Male"}
            >
              М
            </button>
            <button
              onClick={() => setGenderFilter(f => f === "female" ? "all" : "female")}
              className={`px-1.5 py-0.5 rounded text-[10px] font-semibold transition-colors ${
                genderFilter === "female"
                  ? "bg-rose-500/20 text-rose-500 dark:text-rose-400"
                  : "text-muted-foreground/50 hover:text-muted-foreground"
              }`}
              title={isRu ? "Женские" : "Female"}
            >
              Ж
            </button>
          </div>
        )}
        <Badge variant="secondary" className="text-xs">
          {filteredCharacters.length}{characters.length !== filteredCharacters.length ? `/${characters.length}` : ""}
        </Badge>
      </div>

      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap flex-shrink-0">
        {extracting ? (
          <Button variant="outline" size="sm" disabled className="gap-1.5 text-xs">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {extractProgress || (isRu ? "Извлечение..." : "Extracting...")}
          </Button>
        ) : (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" disabled={analyzedCount === 0} className="gap-1.5 text-xs">
                <Scan className="h-3.5 w-3.5" />
                {isRu ? "Поиск (AI)" : "Search (AI)"}
                <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="min-w-[200px]">
              <DropdownMenuItem onClick={() => onExtract({ mode: "fresh" })} className="gap-2 text-xs">
                <RotateCcw className="h-3.5 w-3.5" />
                {isRu ? "Новый поиск" : "New search"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onExtract({ mode: "continue" })} className="gap-2 text-xs">
                <Play className="h-3.5 w-3.5" />
                {isRu ? "Продолжить поиск" : "Continue search"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="gap-2 text-xs">
                  <BookOpen className="h-3.5 w-3.5" />
                  {isRu ? "Искать в главе" : "Search in chapter"}
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="max-h-[300px] overflow-y-auto min-w-[220px]">
                  {(() => {
                    const analyzed: { idx: number; title: string }[] = [];
                    chapterResults.forEach((r, idx) => {
                      if (r.status === "done" && r.scenes?.length && tocEntries[idx]) {
                        analyzed.push({ idx, title: tocEntries[idx].title });
                      }
                    });
                    if (analyzed.length === 0) {
                      return (
                        <DropdownMenuItem disabled className="text-xs text-muted-foreground">
                          {isRu ? "Нет проанализированных глав" : "No analyzed chapters"}
                        </DropdownMenuItem>
                      );
                    }
                    return analyzed.map(ch => (
                      <DropdownMenuItem
                        key={ch.idx}
                        onClick={() => onExtract({ mode: "chapter", chapterIdx: ch.idx })}
                        className="text-xs"
                      >
                        <span className="truncate">{ch.title.slice(0, 50)}</span>
                      </DropdownMenuItem>
                    ));
                  })()}
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
        <Button
          variant="ghost" size="sm"
          onClick={() => { setAddingNew(true); setNewName(""); }}
          className="gap-1.5 text-xs"
        >
          <Plus className="h-3.5 w-3.5" />
          {isRu ? "Добавить" : "Add"}
        </Button>
        {selectedIds.size >= 2 && (
          <Button
            variant="ghost" size="sm"
            onClick={handleMergeSelected}
            className="gap-1.5 text-xs text-primary"
          >
            <Merge className="h-3.5 w-3.5" />
            {isRu ? `Объединить (${selectedIds.size})` : `Merge (${selectedIds.size})`}
          </Button>
        )}
        {onProfile && selectedIds.size >= 1 && (
          <Button
            variant="ghost" size="sm"
            onClick={() => onProfile(Array.from(selectedIds))}
            disabled={profiling || analyzedCount === 0}
            className="gap-1.5 text-xs"
          >
            {profiling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Brain className="h-3.5 w-3.5" />}
            {profiling
              ? (profileProgress || (isRu ? "Профайлинг…" : "Profiling…"))
              : (isRu ? `Профайл (${selectedIds.size})` : `Profile (${selectedIds.size})`)}
          </Button>
        )}
        {selectedIds.size >= 1 && (
          <Button
            variant="ghost" size="sm"
            onClick={() => setBulkDeleteConfirm(true)}
            className="gap-1.5 text-xs text-destructive hover:text-destructive"
          >
            <Trash2 className="h-3.5 w-3.5" />
            {isRu ? `Удалить (${selectedIds.size})` : `Delete (${selectedIds.size})`}
          </Button>
        )}
      </div>

      {/* Add new character inline */}
      {addingNew && (
        <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-shrink-0">
          <Input
            ref={newRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder={isRu ? "Имя персонажа" : "Character name"}
            className="h-7 text-sm flex-1"
            onKeyDown={(e) => {
              if (e.key === "Enter" && newName.trim()) {
                onAdd(newName.trim());
                setNewName("");
                setAddingNew(false);
              }
              if (e.key === "Escape") setAddingNew(false);
            }}
          />
          <Button
            size="icon" variant="ghost" className="h-6 w-6"
            onClick={() => {
              if (newName.trim()) { onAdd(newName.trim()); setNewName(""); }
              setAddingNew(false);
            }}
          >
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setAddingNew(false)}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      )}

      {/* Characters table */}
      <ScrollArea className="flex-1 min-h-0" type="auto">
        {characters.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center px-4">
            <Users className="h-10 w-10 text-muted-foreground/30 mb-3" />
            <p className="text-sm text-muted-foreground">
              {analyzedCount === 0
                ? (isRu ? "Сначала проанализируйте главы" : "Analyze chapters first")
                : (isRu ? "Нажмите «Извлечь из сцен» для поиска персонажей" : "Click \"Extract from scenes\" to find characters")}
            </p>
          </div>
        ) : (
          <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-background">
              <TableRow>
                <TableHead className="w-7 px-1"></TableHead>
                <TableHead
                  className="text-xs cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => handleSort("name")}
                >
                  {isRu ? "Имя" : "Name"}<SortIcon col="name" />
                </TableHead>
                <TableHead className="text-xs text-center w-10">{isRu ? "Пол" : "G"}</TableHead>
                <TableHead
                  className="text-xs text-center w-7 px-0 cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => handleSort("brain")}
                >
                  <Brain className={`h-3 w-3 mx-auto ${sortCol === "brain" ? "text-primary" : "text-muted-foreground/50"}`} />
                </TableHead>
                <TableHead className="text-xs text-center w-12">{isRu ? "Сцен" : "Sc."}</TableHead>
                <TableHead
                  className="text-xs text-center w-12 cursor-pointer select-none hover:text-foreground transition-colors"
                  onClick={() => handleSort("ch")}
                >
                  {isRu ? "Гл." : "Ch."}<SortIcon col="ch" />
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedCharacters
                .map((char) => {
                const isExpanded = expandedId === char.id;
                const isSelected = selectedIds.has(char.id);
                  const isNew = newCharIds.has(char.id);
                return (
                  <TableRow
                    key={char.id}
                    className={`group ${isNew ? "animate-fade-in" : ""}`}
                    data-state={isSelected ? "selected" : undefined}
                  >
                    {/* Checkbox */}
                    <TableCell className="px-2">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelect(char.id)}
                        className="h-3.5 w-3.5 rounded border-border accent-primary cursor-pointer"
                      />
                    </TableCell>

                    {/* Name + aliases */}
                    <TableCell className="py-1.5">
                      <div>
                        {editingId === char.id ? (
                          <input
                            ref={editRef}
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitRename}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") commitRename();
                              if (e.key === "Escape") setEditingId(null);
                            }}
                            className="bg-background border border-primary rounded px-1.5 py-0.5 text-sm text-foreground outline-none w-full"
                          />
                        ) : (
                          <button
                            className="flex items-center gap-1.5 text-sm font-medium text-foreground hover:text-primary cursor-pointer w-full text-left"
                            onClick={() => setExpandedId(isExpanded ? null : char.id)}
                          >
                            {isExpanded ? <ChevronDown className="h-3 w-3 flex-shrink-0" /> : <ChevronRight className="h-3 w-3 flex-shrink-0" />}
                            <span className="truncate">{char.name}</span>
                            {char.role && char.role !== "speaking" && (
                              char.role === "crowd" && (char.age_hint || char.manner_hint) ? (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <span className={`text-[9px] font-medium cursor-default ${ROLE_LABELS[char.role]?.color || "text-muted-foreground"}`}>
                                      {ROLE_LABELS[char.role]?.[isRu ? "ru" : "en"] || char.role}
                                    </span>
                                  </TooltipTrigger>
                                  <TooltipContent side="top" className="text-xs max-w-[200px]">
                                    {char.age_hint && <div>{isRu ? "Возраст" : "Age"}: {char.age_hint}</div>}
                                    {char.manner_hint && <div>{isRu ? "Манера" : "Manner"}: {char.manner_hint}</div>}
                                  </TooltipContent>
                                </Tooltip>
                              ) : (
                                <span className={`text-[9px] font-medium ${ROLE_LABELS[char.role]?.color || "text-muted-foreground"}`}>
                                  {ROLE_LABELS[char.role]?.[isRu ? "ru" : "en"] || char.role}
                                </span>
                              )
                            )}
                            <Edit2
                              className="h-3 w-3 ml-auto opacity-0 group-hover:opacity-50 hover:!opacity-100 flex-shrink-0"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingId(char.id);
                                setEditValue(char.name);
                              }}
                            />
                          </button>
                        )}
                        {char.aliases.length > 0 && !isExpanded && (
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {char.aliases.map(a => (
                              <span key={a} className="text-[10px] text-muted-foreground bg-muted/50 px-1 rounded">
                                {a}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </TableCell>

                    {/* Gender */}
                    <TableCell className="text-center">
                      <Popover
                        open={genderPopoverOpen === char.id}
                        onOpenChange={(open) => setGenderPopoverOpen(open ? char.id : null)}
                      >
                        <PopoverTrigger asChild>
                          <button className="inline-flex items-center gap-0.5 hover:opacity-60 transition-opacity">
                            {char.gender === "male" && (
                              <span className="text-xs text-sky-500 dark:text-sky-400" title={isRu ? "Мужской" : "Male"}>
                                М
                              </span>
                            )}
                            {char.gender === "female" && (
                              <span className="text-xs text-rose-500 dark:text-rose-400" title={isRu ? "Женский" : "Female"}>
                                Ж
                              </span>
                            )}
                            {(!char.gender || char.gender === "unknown") && (
                              <span className="text-xs text-muted-foreground/40" title={isRu ? "Неизвестно" : "Unknown"}>
                                ?
                              </span>
                            )}
                            <ChevronDown className="h-2.5 w-2.5 text-muted-foreground/40" />
                          </button>
                        </PopoverTrigger>
                        <PopoverContent className="w-32 p-1" align="center">
                          <div className="flex flex-col gap-0.5">
                            <button
                              className="text-left px-2 py-1 text-xs rounded hover:bg-accent flex items-center gap-2"
                              onClick={() => {
                                onUpdateGender(char.id, "male");
                                setGenderPopoverOpen(null);
                              }}
                            >
                              <span className="text-sky-500 dark:text-sky-400 font-semibold">М</span>
                              <span>{isRu ? "Мужской" : "Male"}</span>
                            </button>
                            <button
                              className="text-left px-2 py-1 text-xs rounded hover:bg-accent flex items-center gap-2"
                              onClick={() => {
                                onUpdateGender(char.id, "female");
                                setGenderPopoverOpen(null);
                              }}
                            >
                              <span className="text-rose-500 dark:text-rose-400 font-semibold">Ж</span>
                              <span>{isRu ? "Женский" : "Female"}</span>
                            </button>
                            <button
                              className="text-left px-2 py-1 text-xs rounded hover:bg-accent flex items-center gap-2"
                              onClick={() => {
                                onUpdateGender(char.id, "unknown");
                                setGenderPopoverOpen(null);
                              }}
                            >
                              <span className="text-muted-foreground/40 font-semibold">?</span>
                              <span>{isRu ? "Неизвестно" : "Unknown"}</span>
                            </button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </TableCell>

                    {/* Profile icon — clickable to open profile panel */}
                    <TableCell className="text-center px-0">
                      {char.profile?.description ? (
                        <button
                          onClick={() => setProfileViewId(profileViewId === char.id ? null : char.id)}
                          className="mx-auto block"
                          title={isRu ? "Показать профиль" : "Show profile"}
                        >
                          <Brain className={`h-3.5 w-3.5 ${profileViewId === char.id ? "text-primary" : "text-primary/60 hover:text-primary"} transition-colors`} />
                        </button>
                      ) : (
                        <span className="text-muted-foreground/20">—</span>
                      )}
                    </TableCell>

                    {/* Scene count */}
                    <TableCell className="text-center text-xs text-muted-foreground font-mono">
                      {char.sceneCount}
                    </TableCell>

                    {/* Chapter count */}
                    <TableCell className="text-center text-xs text-muted-foreground font-mono">
                      {char.appearances.length}
                    </TableCell>

                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}

        {/* Expanded detail panel */}
        {expandedId && (() => {
          const char = characters.find(c => c.id === expandedId);
          if (!char) return null;
          return (
            <div className="px-4 py-3 border-t border-border bg-muted/20 space-y-3">
              {/* Aliases section */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  {isRu ? "Алиасы" : "Aliases"}
                </h4>
                <div className="flex flex-wrap gap-1.5">
                  {char.aliases.map(alias => (
                    <Badge key={alias} variant="outline" className="text-xs gap-1 pr-1">
                      {alias}
                      <button
                        onClick={() => removeAlias(char.id, alias)}
                        className="hover:text-destructive"
                      >
                        <X className="h-2.5 w-2.5" />
                      </button>
                    </Badge>
                  ))}
                  {editingAliasId === char.id ? (
                    <Input
                      ref={aliasRef}
                      value={aliasValue}
                      onChange={(e) => setAliasValue(e.target.value)}
                      placeholder={isRu ? "Новый алиас" : "New alias"}
                      className="h-6 text-xs w-24 inline-flex"
                      onKeyDown={(e) => {
                        if (e.key === "Enter") { addAlias(char.id); }
                        if (e.key === "Escape") setEditingAliasId(null);
                      }}
                      onBlur={() => { addAlias(char.id); setEditingAliasId(null); }}
                    />
                  ) : (
                    <Button
                      variant="ghost" size="sm"
                      className="h-6 text-xs px-2"
                      onClick={() => { setEditingAliasId(char.id); setAliasValue(""); }}
                    >
                      <Plus className="h-3 w-3 mr-1" />
                      {isRu ? "Добавить" : "Add"}
                    </Button>
                  )}
                </div>
              </div>

              {/* Profile */}
              {char.profile?.description && (
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5 flex items-center gap-1.5">
                    <Brain className="h-3 w-3" />
                    {isRu ? "Профиль" : "Profile"}
                  </h4>
                  <div className="text-xs text-foreground/80 space-y-1">
                    {char.profile.temperament && (
                      <p><span className="text-muted-foreground">{isRu ? "Темперамент:" : "Temperament:"}</span> {char.profile.temperament}</p>
                    )}
                    {char.profile.age_group && char.profile.age_group !== "unknown" && (
                      <p><span className="text-muted-foreground">{isRu ? "Возраст:" : "Age:"}</span> {char.profile.age_group}</p>
                    )}
                    {char.profile.speech_style && (
                      <p><span className="text-muted-foreground">{isRu ? "Речь:" : "Speech:"}</span> {char.profile.speech_style}</p>
                    )}
                    <p>{char.profile.description}</p>
                  </div>
                </div>
              )}

              {/* Appearances */}
              <div>
                <h4 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  {isRu ? "Появления" : "Appearances"}
                </h4>
                {char.appearances.length === 0 ? (
                  <p className="text-xs text-muted-foreground/60">
                    {isRu ? "Нет данных" : "No data"}
                  </p>
                ) : (
                  <div className="space-y-1">
                    {char.appearances.map((app) => (
                      <div key={app.chapterIdx} className="flex items-center gap-2 text-xs">
                        <span className="text-muted-foreground font-mono w-8 flex-shrink-0 text-right">
                          #{app.chapterIdx + 1}
                        </span>
                        <span className="truncate flex-1 text-foreground/80">
                          {app.chapterTitle}
                        </span>
                        <span className="text-muted-foreground font-mono flex-shrink-0">
                          {isRu ? "сц." : "sc."} {app.sceneNumbers.join(", ")}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })()}
      </ScrollArea>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => { if (!open) setDeleteConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRu ? "Удалить персонажа?" : "Delete character?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {deleteConfirm && (() => {
                const char = characters.find(c => c.id === deleteConfirm);
                return char
                  ? (isRu ? `«${char.name}» будет удалён из списка.` : `"${char.name}" will be removed.`)
                  : "";
              })()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirm) onDelete(deleteConfirm);
                setDeleteConfirm(null);
              }}
            >
              {isRu ? "Удалить" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk delete confirmation */}
      <AlertDialog open={bulkDeleteConfirm} onOpenChange={setBulkDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {isRu ? `Удалить ${selectedIds.size} персонажей?` : `Delete ${selectedIds.size} characters?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isRu
                ? "Выбранные персонажи будут удалены из списка."
                : "Selected characters will be removed from the list."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                for (const id of selectedIds) onDelete(id);
                setSelectedIds(new Set());
                setBulkDeleteConfirm(false);
              }}
            >
              {isRu ? "Удалить" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>{/* end left column */}

    {/* Right column: profile detail (Studio-style) */}
    {profileViewChar?.profile?.description && (
      <div className="w-[36rem] flex-shrink-0 border-l border-border flex flex-col min-h-0 overflow-hidden bg-muted/10">
        <div className="px-4 py-2.5 border-b border-border flex items-center gap-2 flex-shrink-0">
          <Brain className="h-4 w-4 text-primary" />
          <h3 className="text-xs font-semibold font-display text-muted-foreground uppercase tracking-wider flex-1">
            {isRu ? "Профайл" : "Profile"}
          </h3>
          <button
            onClick={() => setProfileViewId(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="p-4 space-y-4">
            {/* Character name */}
            <h4 className="text-base font-semibold font-display text-foreground">
              {profileViewChar.name}
            </h4>

            {/* Description */}
            {profileViewChar.profile.description && (
              <p className="text-sm text-foreground/90 leading-relaxed">
                {profileViewChar.profile.description}
              </p>
            )}

            {/* Badges row: gender, age, temperament */}
            <div className="flex flex-wrap gap-2">
              {profileViewChar.gender && profileViewChar.gender !== "unknown" && (
                <Badge variant="outline" className="text-xs">
                  {profileViewChar.gender === "male"
                    ? (isRu ? "Мужской ♂" : "Male ♂")
                    : (isRu ? "Женский ♀" : "Female ♀")}
                </Badge>
              )}
              {profileViewChar.profile.age_group && profileViewChar.profile.age_group !== "unknown" && (
                <Badge variant="outline" className="text-xs">
                  {localizeLabel(profileViewChar.profile.age_group, AGE_LABELS, isRu)}
                </Badge>
              )}
              {profileViewChar.profile.temperament && (
                <Badge variant="secondary" className="text-xs">
                  {localizeLabel(profileViewChar.profile.temperament, TEMPERAMENT_LABELS, isRu)}
                </Badge>
              )}
            </div>

            {/* Speech style */}
            {profileViewChar.profile.speech_style && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {isRu ? "Стиль речи" : "Speech Style"}
                </span>
                <p className="text-xs text-muted-foreground mt-1 italic">
                  {profileViewChar.profile.speech_style}
                </p>
              </div>
            )}

            {/* Aliases */}
            {profileViewChar.aliases.length > 0 && (
              <div>
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  {isRu ? "Также известен как" : "Also known as"}
                </span>
                <p className="text-xs text-muted-foreground mt-1">
                  {profileViewChar.aliases.join(", ")}
                </p>
              </div>
            )}

            {/* Appearances */}
            <div>
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                {isRu ? "Появления" : "Appearances"}
              </span>
              <div className="mt-1.5 space-y-1">
                {profileViewChar.appearances.map((app) => (
                  <div key={app.chapterIdx} className="flex items-center gap-2 text-xs">
                    <span className="text-muted-foreground font-mono w-8 flex-shrink-0 text-right">
                      #{app.chapterIdx + 1}
                    </span>
                    <span className="truncate flex-1 text-foreground/80">
                      {app.chapterTitle}
                    </span>
                    <span className="text-muted-foreground font-mono flex-shrink-0">
                      {isRu ? "сц." : "sc."} {app.sceneNumbers.join(", ")}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </ScrollArea>
      </div>
    )}
    </div>
  );
}
