/**
 * Parser Characters Panel — right sidebar for managing extracted characters.
 * Supports: extraction, rename, aliases editing, merge, delete, appearance view.
 */

import { useState, useRef, useEffect, useMemo } from "react";
import {
  Users, Scan, Plus, Trash2, Merge, Edit2, X, Check, ChevronDown, ChevronRight,
  ChevronUp, Brain, Loader2,
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
import { RoleBadge } from "@/components/ui/RoleBadge";
import type { LocalCharacter } from "@/pages/parser/types";

interface ParserCharactersPanelProps {
  isRu: boolean;
  characters: LocalCharacter[];
  extracting: boolean;
  extractProgress?: string | null;
  onExtract: () => void;
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
  const [genderPopoverOpen, setGenderPopoverOpen] = useState<string | null>(null);
  const [genderFilter, setGenderFilter] = useState<"all" | "male" | "female">("all");
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
        <Badge variant="secondary" className="text-xs">
          {genderFilter === "all" ? characters.length : characters.filter(c => c.gender === genderFilter).length}
        </Badge>
        {characters.length > 0 && (
          <div className="flex items-center gap-0.5 ml-1">
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
      </div>

      {/* Toolbar */}
      <div className="px-3 py-2 border-b border-border flex items-center gap-2 flex-wrap flex-shrink-0">
        <Button
          variant="outline" size="sm"
          onClick={onExtract}
          disabled={extracting || analyzedCount === 0}
          className="gap-1.5 text-xs"
        >
          <Scan className="h-3.5 w-3.5" />
          {extracting
            ? (extractProgress || (isRu ? "Извлечение..." : "Extracting..."))
            : (isRu ? "Извлечь (AI)" : "Extract (AI)")}
        </Button>
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
      <ScrollArea className="flex-1 min-h-0">
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-7 px-1"></TableHead>
                <TableHead className="text-xs">{isRu ? "Имя" : "Name"}</TableHead>
                <TableHead className="text-xs text-center w-10">{isRu ? "Пол" : "G"}</TableHead>
                <TableHead className="text-xs text-center w-7 px-0">
                  <Brain className="h-3 w-3 mx-auto text-muted-foreground/50" />
                </TableHead>
                <TableHead className="text-xs text-center w-12">{isRu ? "Сцен" : "Sc."}</TableHead>
                <TableHead className="text-xs text-center w-12">{isRu ? "Гл." : "Ch."}</TableHead>
                <TableHead className="w-7 px-1"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {characters
                .filter(c => genderFilter === "all" || c.gender === genderFilter)
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

                    {/* Delete */}
                    <TableCell className="px-2">
                      <button
                        className="opacity-0 group-hover:opacity-50 hover:!opacity-100 text-destructive"
                        onClick={() => setDeleteConfirm(char.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
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
    </div>{/* end left column */}

    {/* Right column: profile detail */}
    {profileViewChar?.profile?.description && (
      <div className="w-72 flex-shrink-0 border-l border-border flex flex-col min-h-0 overflow-hidden bg-muted/10">
        <div className="px-3 py-2.5 border-b border-border flex items-center gap-2 flex-shrink-0">
          <Brain className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground truncate flex-1">
            {profileViewChar.name}
          </h3>
          <button
            onClick={() => setProfileViewId(null)}
            className="text-muted-foreground hover:text-foreground transition-colors"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
        <ScrollArea className="flex-1 min-h-0">
          <div className="px-3 py-3 space-y-3">
            {profileViewChar.profile.age_group && profileViewChar.profile.age_group !== "unknown" && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {isRu ? "Возраст" : "Age"}
                </span>
                <p className="text-sm text-foreground mt-0.5">{profileViewChar.profile.age_group}</p>
              </div>
            )}
            {profileViewChar.profile.temperament && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {isRu ? "Темперамент" : "Temperament"}
                </span>
                <p className="text-sm text-foreground mt-0.5">{profileViewChar.profile.temperament}</p>
              </div>
            )}
            {profileViewChar.profile.speech_style && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {isRu ? "Стиль речи" : "Speech style"}
                </span>
                <p className="text-sm text-foreground mt-0.5">{profileViewChar.profile.speech_style}</p>
              </div>
            )}
            {profileViewChar.profile.description && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {isRu ? "Описание" : "Description"}
                </span>
                <p className="text-sm text-foreground/80 mt-0.5 leading-relaxed whitespace-pre-line">
                  {profileViewChar.profile.description}
                </p>
              </div>
            )}
            {profileViewChar.gender && profileViewChar.gender !== "unknown" && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {isRu ? "Пол" : "Gender"}
                </span>
                <p className="text-sm text-foreground mt-0.5">
                  {profileViewChar.gender === "male" ? (isRu ? "Мужской" : "Male") : (isRu ? "Женский" : "Female")}
                </p>
              </div>
            )}
            {profileViewChar.aliases.length > 0 && (
              <div>
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                  {isRu ? "Алиасы" : "Aliases"}
                </span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {profileViewChar.aliases.map(a => (
                    <Badge key={a} variant="outline" className="text-xs">{a}</Badge>
                  ))}
                </div>
              </div>
            )}
            <div>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                {isRu ? "Появления" : "Appearances"}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {isRu
                  ? `${profileViewChar.sceneCount} сцен в ${profileViewChar.appearances.length} главах`
                  : `${profileViewChar.sceneCount} scenes in ${profileViewChar.appearances.length} chapters`}
              </p>
            </div>
          </div>
        </ScrollArea>
      </div>
    )}
    </div>
  );
}
