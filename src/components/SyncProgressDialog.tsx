import { useState } from "react";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { CloudUpload, Check, Loader2, AlertCircle, X } from "lucide-react";
import { cn } from "@/lib/utils";

export interface SyncStep {
  id: string;
  label: string;
  status: "pending" | "running" | "done" | "error" | "skipped";
  detail?: string;
}

export type SyncProgressCallback = (
  stepId: string,
  status: SyncStep["status"],
  detail?: string,
) => void;

interface SyncProgressDialogProps {
  isRu: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  steps: SyncStep[];
  phase: "confirm" | "running" | "done" | "error";
  errorMessage?: string;
  /** "save" (default) = push to server, "restore" = download from server */
  mode?: "save" | "restore";
  /** Optional checkboxes shown in confirm phase */
  confirmOptions?: Array<{
    id: string;
    label: string;
    checked: boolean;
    onChange: (checked: boolean) => void;
  }>;
}

const STEP_COLORS = [
  "bg-blue-500",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-violet-500",
  "bg-rose-500",
  "bg-cyan-500",
  "bg-orange-500",
];

function StepIcon({ status }: { status: SyncStep["status"] }) {
  switch (status) {
    case "done":
      return <Check className="h-3.5 w-3.5 text-emerald-500" />;
    case "running":
      return <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />;
    case "error":
      return <AlertCircle className="h-3.5 w-3.5 text-destructive" />;
    case "skipped":
      return <X className="h-3.5 w-3.5 text-muted-foreground/50" />;
    default:
      return <div className="h-3.5 w-3.5 rounded-full border-2 border-muted-foreground/30" />;
  }
}

function MultiColorProgress({ steps }: { steps: SyncStep[] }) {
  const total = steps.length;
  if (total === 0) return null;

  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted gap-px">
      {steps.map((step, i) => {
        const colorClass = STEP_COLORS[i % STEP_COLORS.length];
        const isDone = step.status === "done" || step.status === "skipped";
        const isRunning = step.status === "running";
        return (
          <div
            key={step.id}
            className={cn(
              "h-full transition-all duration-500 ease-out",
              isDone ? colorClass : isRunning ? `${colorClass} opacity-40 animate-pulse` : "bg-transparent",
            )}
            style={{ width: `${100 / total}%` }}
          />
        );
      })}
    </div>
  );
}

export function SyncProgressDialog({
  isRu,
  open,
  onOpenChange,
  onConfirm,
  steps,
  phase,
  errorMessage,
  mode = "save",
  confirmOptions,
}: SyncProgressDialogProps) {
  const doneCount = steps.filter((s) => s.status === "done" || s.status === "skipped").length;
  const isRunningOrDone = phase === "running" || phase === "done" || phase === "error";

    const isLocked = phase === "running";

    return (
      <AlertDialog open={open} onOpenChange={isLocked ? () => {} : onOpenChange}>
        <AlertDialogContent
          className="max-w-md"
          onEscapeKeyDown={isLocked ? (e) => e.preventDefault() : undefined}
        >
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {mode === "restore"
              ? <CloudDownload className="h-5 w-5 text-primary" />
              : <CloudUpload className="h-5 w-5 text-primary" />}
            {phase === "confirm"
              ? mode === "restore"
                ? (isRu ? "Загрузить с сервера?" : "Download from server?")
                : (isRu ? "Сохранить на сервер?" : "Save to server?")
              : phase === "done"
                ? (isRu ? "Синхронизация завершена" : "Sync complete")
                : phase === "error"
                  ? (isRu ? "Ошибка синхронизации" : "Sync error")
                  : (isRu ? "Синхронизация..." : "Syncing...")}
          </AlertDialogTitle>
          {phase === "confirm" && (
            <AlertDialogDescription>
              {mode === "restore"
                ? (isRu
                  ? "Серверная версия проекта будет загружена и заменит локальные данные. Это может занять некоторое время."
                  : "Server version of the project will be downloaded and replace local data. This may take a moment.")
                : (isRu
                  ? "Текущее состояние проекта будет загружено на сервер как резервная копия. Это может занять некоторое время."
                  : "Current project state will be uploaded to the server as a backup. This may take a moment.")}
            </AlertDialogDescription>
          )}
          {phase === "confirm" && confirmOptions && confirmOptions.length > 0 && (
            <div className="space-y-2 pt-2">
              {confirmOptions.map((opt) => (
                <label key={opt.id} className="flex items-center gap-2 text-sm cursor-pointer">
                  <Checkbox
                    checked={opt.checked}
                    onCheckedChange={(v) => opt.onChange(!!v)}
                  />
                  <span className="text-foreground">{opt.label}</span>
                </label>
              ))}
            </div>
          )}
        </AlertDialogHeader>

        {isRunningOrDone && (
          <div className="space-y-3 py-2">
            <MultiColorProgress steps={steps} />

            <p className="text-xs text-muted-foreground text-center">
              {doneCount}/{steps.length} {isRu ? "шагов" : "steps"}
            </p>

            <div className="space-y-1.5 max-h-60 overflow-y-auto">
              {steps.map((step, i) => (
                <div
                  key={step.id}
                  className={cn(
                    "flex items-start gap-2 rounded-md px-2.5 py-1.5 text-sm transition-colors",
                    step.status === "running" && "bg-primary/5",
                    step.status === "error" && "bg-destructive/5",
                  )}
                >
                  <div className="mt-0.5 shrink-0">
                    <StepIcon status={step.status} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span
                      className={cn(
                        "font-medium",
                        step.status === "pending" && "text-muted-foreground/60",
                        step.status === "skipped" && "text-muted-foreground/50 line-through",
                      )}
                    >
                      {step.label}
                    </span>
                    {step.detail && (
                      <p className="text-xs text-muted-foreground truncate">{step.detail}</p>
                    )}
                  </div>
                  {step.status === "done" && (
                    <div
                      className={cn(
                        "h-2 w-2 rounded-full mt-1.5 shrink-0",
                        STEP_COLORS[i % STEP_COLORS.length],
                      )}
                    />
                  )}
                </div>
              ))}
            </div>

            {errorMessage && (
              <p className="text-xs text-destructive bg-destructive/10 rounded-md px-3 py-2">
                {errorMessage}
              </p>
            )}
          </div>
        )}

        <AlertDialogFooter>
          {phase === "confirm" && (
            <>
              <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
              <Button onClick={onConfirm}>
                <CloudUpload className="h-4 w-4 mr-1.5" />
                {isRu ? "Сохранить" : "Save"}
              </Button>
            </>
          )}
          {(phase === "done" || phase === "error") && (
            <AlertDialogAction onClick={() => onOpenChange(false)}>
              {isRu ? "Закрыть" : "Close"}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Build initial steps array for the sync dialog */
export function buildSyncSteps(isRu: boolean): SyncStep[] {
  return [
    { id: "verify", label: isRu ? "Проверка проекта" : "Verifying project", status: "pending" },
    { id: "book_row", label: isRu ? "Данные книги" : "Book record", status: "pending" },
    { id: "chapters", label: isRu ? "Структура глав" : "Chapter structure", status: "pending" },
    { id: "scenes", label: isRu ? "Сцены" : "Scenes", status: "pending" },
    { id: "parts", label: isRu ? "Части книги" : "Book parts", status: "pending" },
    { id: "characters", label: isRu ? "Персонажи" : "Characters", status: "pending" },
    { id: "storyboard", label: isRu ? "Раскадровка сцен" : "Scene storyboards", status: "pending" },
    { id: "source_file", label: isRu ? "Исходный файл" : "Source file", status: "pending" },
    { id: "browser_state", label: isRu ? "Состояние браузера" : "Browser state", status: "pending" },
    { id: "finalize", label: isRu ? "Завершение" : "Finalizing", status: "pending" },
  ];
}

/** Build initial steps for server restore (Wipe-and-Deploy) */
export function buildRestoreSteps(isRu: boolean): SyncStep[] {
  return [
    { id: "wipe", label: isRu ? "Очистка локальных данных" : "Clearing local data", status: "pending" },
    { id: "fetch_structure", label: isRu ? "Загрузка структуры" : "Fetching structure", status: "pending" },
    { id: "parse_pdf", label: isRu ? "Обработка файла" : "Processing file", status: "pending" },
    { id: "build_toc", label: isRu ? "Построение оглавления" : "Building TOC", status: "pending" },
    { id: "write_local", label: isRu ? "Запись в хранилище" : "Writing to storage", status: "pending" },
    { id: "characters", label: isRu ? "Персонажи" : "Characters", status: "pending" },
    { id: "storyboards", label: isRu ? "Раскадровка сцен" : "Scene storyboards", status: "pending" },
    { id: "scene_maps", label: isRu ? "Карты персонажей сцен" : "Scene character maps", status: "pending" },
    { id: "download_ir", label: isRu ? "Загрузка импульсов (IR)" : "Downloading impulses (IR)", status: "pending" },
    { id: "download_atmo", label: isRu ? "Загрузка атмосферы" : "Downloading atmosphere", status: "pending" },
    { id: "download_sfx", label: isRu ? "Загрузка SFX" : "Downloading SFX", status: "pending" },
    { id: "source_file", label: isRu ? "Сохранение файла" : "Saving source file", status: "pending" },
    { id: "finalize", label: isRu ? "Завершение" : "Finalizing", status: "pending" },
  ];
}
