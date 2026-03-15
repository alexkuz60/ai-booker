/**
 * Parser Characters Panel — right sidebar for managing extracted characters.
 * Supports: extraction, rename, aliases editing, merge, delete, appearance view.
 */

import { useState, useRef, useEffect } from "react";
import {
  Users, Scan, Plus, Trash2, Merge, Edit2, X, Check, ChevronDown, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import type { LocalCharacter } from "@/pages/parser/types";

interface ParserCharactersPanelProps {
  isRu: boolean;
  characters: LocalCharacter[];
  extracting: boolean;
  onExtract: () => void;
  onRename: (id: string, newName: string) => void;
  onUpdateAliases: (id: string, aliases: string[]) => void;
  onDelete: (id: string) => void;
  onMerge: (sourceId: string, targetId: string) => void;
  onAdd: (name: string) => void;
  analyzedCount: number;
}

export default function ParserCharactersPanel({
  isRu,
  characters,
  extracting,
  onExtract,
  onRename,
  onUpdateAliases,
  onDelete,
  onMerge,
  onAdd,
  analyzedCount,
}: ParserCharactersPanelProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingAliasId, setEditingAliasId] = useState<string | null>(null);
  const [aliasValue, setAliasValue] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [addingNew, setAddingNew] = useState(false);
  const [newName, setNewName] = useState("");
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const editRef = useRef<HTMLInputElement>(null);
  const aliasRef = useRef<HTMLInputElement>(null);
  const newRef = useRef<HTMLInputElement>(null);

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

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-border flex items-center gap-2 flex-shrink-0">
        <Users className="h-5 w-5 text-primary" />
        <h2 className="font-display font-semibold text-base text-foreground flex-1">
          {isRu ? "Персонажи" : "Characters"}
        </h2>
        <Badge variant="secondary" className="text-xs">
          {characters.length}
        </Badge>
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
            ? (isRu ? "Извлечение..." : "Extracting...")
            : (isRu ? "Извлечь из сцен" : "Extract from scenes")}
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
                <TableHead className="w-8"></TableHead>
                <TableHead className="text-xs">{isRu ? "Имя" : "Name"}</TableHead>
                <TableHead className="text-xs text-center w-16">{isRu ? "Сцен" : "Scenes"}</TableHead>
                <TableHead className="text-xs text-center w-16">{isRu ? "Глав" : "Ch."}</TableHead>
                <TableHead className="w-8"></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {characters.map((char) => {
                const isExpanded = expandedId === char.id;
                const isSelected = selectedIds.has(char.id);
                return (
                  <TableRow key={char.id} className="group" data-state={isSelected ? "selected" : undefined}>
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
                            {char.aliases.slice(0, 2).map(a => (
                              <span key={a} className="text-[10px] text-muted-foreground bg-muted/50 px-1 rounded">
                                {a}
                              </span>
                            ))}
                            {char.aliases.length > 2 && (
                              <span className="text-[10px] text-muted-foreground">+{char.aliases.length - 2}</span>
                            )}
                          </div>
                        )}
                      </div>
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
    </div>
  );
}
