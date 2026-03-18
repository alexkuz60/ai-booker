import { useState, useCallback } from "react";
import { Save, FolderOpen, Trash2, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import type { AiRoleModelMap } from "@/config/aiRoles";

export interface AiRolePreset {
  id: string;
  name: string;
  bookTitle?: string;
  models: AiRoleModelMap;
  createdAt: string;
}

interface AiRolePresetsProps {
  currentOverrides: AiRoleModelMap;
  resolvedModels: Record<string, string>;
  onLoadPreset: (models: AiRoleModelMap) => void;
  bookTitle?: string;
  isRu: boolean;
}

export function AiRolePresets({
  currentOverrides,
  resolvedModels,
  onLoadPreset,
  bookTitle,
  isRu,
}: AiRolePresetsProps) {
  const { value: presets, update: setPresets } = useCloudSettings<AiRolePreset[]>(
    "ai_role_presets",
    [],
  );

  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [newName, setNewName] = useState("");

  const handleSave = useCallback(() => {
    const finalName = newName.trim() || bookTitle?.trim() || "";
    if (!finalName) return;
    const preset: AiRolePreset = {
      id: crypto.randomUUID(),
      name: newName.trim(),
      bookTitle: bookTitle || undefined,
      models: { ...resolvedModels } as AiRoleModelMap,
      createdAt: new Date().toISOString(),
    };
    setPresets((prev) => [...prev, preset]);
    setNewName("");
    setSaveOpen(false);
  }, [newName, bookTitle, resolvedModels, setPresets]);

  const handleDelete = useCallback(
    (id: string) => {
      setPresets((prev) => prev.filter((p) => p.id !== id));
    },
    [setPresets],
  );

  const handleLoad = useCallback(
    (preset: AiRolePreset) => {
      onLoadPreset(preset.models);
      setLoadOpen(false);
    },
    [onLoadPreset],
  );

  return (
    <div className="flex items-center gap-1.5">
      {/* Save preset */}
      <Popover open={saveOpen} onOpenChange={setSaveOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            title={isRu ? "Сохранить текущий набор" : "Save current set"}
          >
            <Save className="h-3 w-3" />
            {isRu ? "Сохранить" : "Save"}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-3" align="end">
          <p className="text-xs font-medium mb-2">
            {isRu ? "Название пресета" : "Preset name"}
          </p>
          <div className="flex gap-2">
            <Input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={
                bookTitle
                  ? `${bookTitle.slice(0, 20)}…`
                  : isRu
                    ? "Мой набор"
                    : "My set"
              }
              className="h-8 text-xs"
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
            />
            <Button size="sm" className="h-8 px-3 text-xs" onClick={handleSave} disabled={!newName.trim()}>
              OK
            </Button>
          </div>
          {bookTitle && (
            <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
              <BookOpen className="h-3 w-3 shrink-0" />
              {isRu ? "Книга:" : "Book:"} {bookTitle}
            </p>
          )}
        </PopoverContent>
      </Popover>

      {/* Load preset */}
      <Popover open={loadOpen} onOpenChange={setLoadOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-xs"
            title={isRu ? "Загрузить пресет" : "Load preset"}
            disabled={presets.length === 0}
          >
            <FolderOpen className="h-3 w-3" />
            {isRu ? "Загрузить" : "Load"}
            {presets.length > 0 && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 ml-0.5">
                {presets.length}
              </Badge>
            )}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-80 p-2" align="end">
          <p className="text-xs font-medium px-2 py-1">
            {isRu ? "Сохранённые пресеты" : "Saved presets"}
          </p>
          <Separator className="my-1" />
          <div className="max-h-60 overflow-y-auto space-y-0.5">
            {presets.map((preset) => (
              <div
                key={preset.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 group cursor-pointer"
                onClick={() => handleLoad(preset)}
              >
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{preset.name}</p>
                  {preset.bookTitle && (
                    <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                      <BookOpen className="h-2.5 w-2.5 shrink-0" />
                      {preset.bookTitle}
                    </p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 shrink-0 text-destructive hover:text-destructive"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(preset.id);
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
