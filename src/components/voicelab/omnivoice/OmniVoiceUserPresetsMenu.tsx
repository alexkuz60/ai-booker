/**
 * OmniVoiceUserPresetsMenu — Save / Apply / Rename / Delete / Export
 * for Advanced parameter user presets. OPFS-first + cloud-mirrored.
 */
import { useState } from "react";
import { Bookmark, Check, Download, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import type { OmniVoiceAdvancedParams } from "./constants";
import { useOmniVoiceUserPresets } from "@/hooks/useOmniVoiceUserPresets";
import type { OmniVoiceUserPreset } from "@/lib/omniVoiceUserPresets";

interface Props {
  isRu: boolean;
  current: OmniVoiceAdvancedParams;
  /** Optional speed snapshot to bundle with the preset. */
  currentSpeed?: number;
  /** Caller is informed when user picks a preset to apply. */
  onApply: (preset: OmniVoiceUserPreset) => void;
}

export function OmniVoiceUserPresetsMenu({ isRu, current, currentSpeed, onApply }: Props) {
  const { presets, hydrated, savePreset, renamePreset, deletePreset } = useOmniVoiceUserPresets();

  const [saveOpen, setSaveOpen] = useState(false);
  const [saveName, setSaveName] = useState("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState("");

  const handleSave = async () => {
    const name = saveName.trim();
    if (!name) {
      toast.error(isRu ? "Введите название пресета" : "Enter a preset name");
      return;
    }
    await savePreset(name, current, currentSpeed);
    setSaveOpen(false);
    setSaveName("");
    toast.success(isRu ? `Пресет «${name}» сохранён` : `Preset "${name}" saved`);
  };

  const handleRename = async () => {
    if (!renamingId) return;
    const name = renameName.trim();
    if (!name) {
      toast.error(isRu ? "Введите название" : "Enter a name");
      return;
    }
    await renamePreset(renamingId, name);
    setRenamingId(null);
    setRenameName("");
    toast.success(isRu ? "Переименовано" : "Renamed");
  };

  const handleDelete = async (preset: OmniVoiceUserPreset) => {
    await deletePreset(preset.id);
    toast.success(isRu ? `Удалён: ${preset.name}` : `Deleted: ${preset.name}`);
  };

  const handleExport = (preset: OmniVoiceUserPreset) => {
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `omnivoice-preset-${preset.name.replace(/[^\w-]+/g, "_")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-6 px-2 text-[10px] gap-1"
            title={isRu ? "Мои пресеты" : "My presets"}
          >
            <Bookmark className="h-3 w-3" />
            {isRu ? "Мои пресеты" : "My presets"}
            {presets.length > 0 && (
              <span className="ml-0.5 rounded bg-muted px-1 text-[9px] tabular-nums text-muted-foreground">
                {presets.length}
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>

        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuItem
            onSelect={(e) => {
              e.preventDefault();
              setSaveOpen(true);
            }}
            className="gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            <span className="text-xs">
              {isRu ? "Сохранить как пользовательский пресет" : "Save as user preset"}
            </span>
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {!hydrated && (
            <DropdownMenuLabel className="text-[10px] text-muted-foreground">
              {isRu ? "Загрузка..." : "Loading..."}
            </DropdownMenuLabel>
          )}
          {hydrated && presets.length === 0 && (
            <DropdownMenuLabel className="text-[10px] text-muted-foreground font-normal">
              {isRu ? "Пока нет пользовательских пресетов" : "No user presets yet"}
            </DropdownMenuLabel>
          )}

          {presets.map((p) => (
            <div key={p.id} className="flex items-center gap-1 px-1">
              <DropdownMenuItem
                onSelect={() => onApply(p)}
                className="flex-1 gap-2 text-xs"
              >
                <Check className="h-3 w-3 opacity-50" />
                <span className="truncate">{p.name}</span>
              </DropdownMenuItem>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger className="px-1.5 py-1 rounded hover:bg-muted [&>svg:last-child]:hidden">
                  <MoreHorizontal className="h-3.5 w-3.5 text-muted-foreground" />
                </DropdownMenuSubTrigger>
                <DropdownMenuSubContent className="w-44">
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setRenamingId(p.id);
                      setRenameName(p.name);
                    }}
                    className="gap-2 text-xs"
                  >
                    <Pencil className="h-3 w-3" />
                    {isRu ? "Переименовать" : "Rename"}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => handleExport(p)}
                    className="gap-2 text-xs"
                  >
                    <Download className="h-3 w-3" />
                    {isRu ? "Экспорт JSON" : "Export JSON"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    onSelect={() => handleDelete(p)}
                    className="gap-2 text-xs text-destructive focus:text-destructive"
                  >
                    <Trash2 className="h-3 w-3" />
                    {isRu ? "Удалить" : "Delete"}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </div>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Save dialog */}
      <Dialog open={saveOpen} onOpenChange={setSaveOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {isRu ? "Сохранить как пресет" : "Save as preset"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="preset-name" className="text-xs">
              {isRu ? "Название" : "Name"}
            </Label>
            <Input
              id="preset-name"
              autoFocus
              placeholder={isRu ? "Например: Тёплый рассказчик" : "e.g. Warm narrator"}
              value={saveName}
              onChange={(e) => setSaveName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleSave();
              }}
            />
            <p className="text-[10px] text-muted-foreground">
              {isRu
                ? "Текущие значения CFG, Steps, T-Shift, температур и денойза будут сохранены."
                : "Current CFG, Steps, T-Shift, temperatures and denoise will be stored."}
            </p>
          </div>
          <DialogFooter>
            <Button variant="ghost" size="sm" onClick={() => setSaveOpen(false)}>
              {isRu ? "Отмена" : "Cancel"}
            </Button>
            <Button size="sm" onClick={handleSave}>
              {isRu ? "Сохранить" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog
        open={!!renamingId}
        onOpenChange={(open) => {
          if (!open) {
            setRenamingId(null);
            setRenameName("");
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="text-sm">
              {isRu ? "Переименовать пресет" : "Rename preset"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="rename-name" className="text-xs">
              {isRu ? "Новое название" : "New name"}
            </Label>
            <Input
              id="rename-name"
              autoFocus
              value={renameName}
              onChange={(e) => setRenameName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void handleRename();
              }}
            />
          </div>
          <DialogFooter>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setRenamingId(null);
                setRenameName("");
              }}
            >
              {isRu ? "Отмена" : "Cancel"}
            </Button>
            <Button size="sm" onClick={handleRename}>
              {isRu ? "Сохранить" : "Save"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
