import { useState, useCallback } from "react";
import { Save, FolderOpen, Trash2, BookOpen, RefreshCw, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import type { AiRoleModelMap, AiRolePoolMap } from "@/config/aiRoles";

export interface AiRolePreset {
  id: string;
  name: string;
  bookTitle?: string;
  models: AiRoleModelMap;
  /** Pool configurations (optional, added in pool feature) */
  pools?: AiRolePoolMap;
  createdAt: string;
  updatedAt?: string;
}

interface AiRolePresetsProps {
  currentOverrides: AiRoleModelMap;
  resolvedModels: Record<string, string>;
  onLoadPreset: (models: AiRoleModelMap, pools?: AiRolePoolMap) => void;
  bookTitle?: string;
  isRu: boolean;
  /** Current pool configurations */
  currentPools?: AiRolePoolMap;
}

export function AiRolePresets({
  currentOverrides,
  resolvedModels,
  onLoadPreset,
  bookTitle,
  isRu,
  currentPools,
}: AiRolePresetsProps) {
  const { value: presets, update: setPresets } = useCloudSettings<AiRolePreset[]>(
    "ai_role_presets",
    [],
  );

  const [saveOpen, setSaveOpen] = useState(false);
  const [loadOpen, setLoadOpen] = useState(false);
  const [newName, setNewName] = useState("");

  /** Count non-empty pools */
  const poolCount = (pools?: AiRolePoolMap): number => {
    if (!pools) return 0;
    return Object.values(pools).filter(p => p && p.length > 0).length;
  };

  const handleSave = useCallback(() => {
    const finalName = newName.trim() || bookTitle?.trim() || "";
    if (!finalName) return;

    const poolsPayload = currentPools && Object.keys(currentPools).length > 0
      ? { ...currentPools }
      : undefined;

    setPresets((prev) => {
      // If a preset with the same name (case-insensitive) already exists — update it
      const existingIdx = prev.findIndex(
        (p) => p.name.trim().toLowerCase() === finalName.toLowerCase(),
      );
      if (existingIdx >= 0) {
        return prev.map((p, i) =>
          i === existingIdx
            ? {
                ...p,
                models: { ...resolvedModels } as AiRoleModelMap,
                pools: poolsPayload,
                bookTitle: bookTitle || p.bookTitle,
                updatedAt: new Date().toISOString(),
              }
            : p,
        );
      }
      // Otherwise create new
      return [
        ...prev,
        {
          id: crypto.randomUUID(),
          name: finalName,
          bookTitle: bookTitle || undefined,
          models: { ...resolvedModels } as AiRoleModelMap,
          pools: poolsPayload,
          createdAt: new Date().toISOString(),
        },
      ];
    });
    setNewName("");
    setSaveOpen(false);
  }, [newName, bookTitle, resolvedModels, currentPools, setPresets]);

  const handleUpdate = useCallback(
    (id: string) => {
      setPresets((prev) =>
        prev.map((p) =>
          p.id === id
            ? {
                ...p,
                models: { ...resolvedModels } as AiRoleModelMap,
                pools: currentPools && Object.keys(currentPools).length > 0
                  ? { ...currentPools }
                  : undefined,
                bookTitle: bookTitle || p.bookTitle,
                updatedAt: new Date().toISOString(),
              }
            : p,
        ),
      );
    },
    [resolvedModels, currentPools, bookTitle, setPresets],
  );

  const handleDelete = useCallback(
    (id: string) => {
      setPresets((prev) => prev.filter((p) => p.id !== id));
    },
    [setPresets],
  );

  const handleLoad = useCallback(
    (preset: AiRolePreset) => {
      onLoadPreset(preset.models, preset.pools);
      setLoadOpen(false);
    },
    [onLoadPreset],
  );

  return (
    <div className="flex items-center gap-1.5">
      {/* Save preset */}
      <Popover open={saveOpen} onOpenChange={(open) => {
          if (open && !newName && bookTitle) setNewName(bookTitle);
          setSaveOpen(open);
        }}>
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
            <Button size="sm" className="h-8 px-3 text-xs" onClick={handleSave} disabled={!newName.trim() && !bookTitle?.trim()}>
              OK
            </Button>
          </div>
          {bookTitle && (
            <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-1">
              <BookOpen className="h-3 w-3 shrink-0" />
              {isRu ? "Книга:" : "Book:"} {bookTitle}
            </p>
          )}
          {poolCount(currentPools) > 0 && (
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
              <Layers className="h-3 w-3 shrink-0" />
              {isRu
                ? `Включены пулы: ${poolCount(currentPools)} ролей`
                : `Pools included: ${poolCount(currentPools)} roles`}
            </p>
          )}

          {/* Existing presets to overwrite */}
          {presets.length > 0 && (
            <>
              <Separator className="my-2" />
              <p className="text-[10px] text-muted-foreground mb-1.5">
                {isRu ? "Или обновить существующий:" : "Or update existing:"}
              </p>
              <div className="max-h-32 overflow-y-auto space-y-0.5">
                {presets.map((preset) => (
                  <div
                    key={preset.id}
                    className="flex items-center gap-2 px-2 py-1 rounded-md hover:bg-muted/50 group"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <p className="text-[11px] truncate">{preset.name}</p>
                        {poolCount(preset.pools) > 0 && (
                          <Layers className="h-2.5 w-2.5 text-muted-foreground shrink-0" />
                        )}
                      </div>
                    </div>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 shrink-0 text-primary hover:text-primary"
                          onClick={() => {
                            handleUpdate(preset.id);
                            setSaveOpen(false);
                          }}
                        >
                          <RefreshCw className="h-3 w-3" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent side="left" className="text-xs">
                        {isRu ? "Перезаписать" : "Overwrite"}
                      </TooltipContent>
                    </Tooltip>
                  </div>
                ))}
              </div>
            </>
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
                  <div className="flex items-center gap-1.5">
                    <p className="text-xs font-medium truncate">{preset.name}</p>
                    {poolCount(preset.pools) > 0 && (
                      <Badge variant="secondary" className="text-[8px] px-1 py-0 gap-0.5 shrink-0">
                        <Layers className="h-2 w-2" />
                        {poolCount(preset.pools)}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    {preset.bookTitle && (
                      <p className="text-[10px] text-muted-foreground truncate flex items-center gap-1">
                        <BookOpen className="h-2.5 w-2.5 shrink-0" />
                        {preset.bookTitle}
                      </p>
                    )}
                    {preset.updatedAt && (
                      <p className="text-[9px] text-muted-foreground/60 shrink-0">
                        {isRu ? "обн." : "upd."} {new Date(preset.updatedAt).toLocaleDateString(isRu ? "ru-RU" : "en-US")}
                      </p>
                    )}
                  </div>
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
