import { useState, useCallback } from "react";
import { FileText, ChevronDown, ChevronUp, Copy, Check, Save, Undo2, Pencil } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import {
  getTaskPromptsForRole,
  type TaskPromptDefinition,
  type TaskPromptId,
} from "@/config/aiTaskPrompts";
import type { AiRoleId } from "@/config/aiRoles";
import { useCloudSettings } from "@/hooks/useCloudSettings";

interface TaskPromptsPopoverProps {
  roleId: AiRoleId;
  isRu: boolean;
}

/** Admin-only prompt overrides stored in user_settings */
type PromptOverrides = Partial<Record<string, { prompt?: string; promptRu?: string }>>;

function PromptCard({
  task,
  isRu,
  overrides,
  onSaveOverride,
}: {
  task: TaskPromptDefinition;
  isRu: boolean;
  overrides: PromptOverrides;
  onSaveOverride: (taskId: TaskPromptId, field: "prompt" | "promptRu", text: string | null) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);

  const override = overrides[task.id];
  const field = isRu && task.isMultilang ? "promptRu" : "prompt";
  const defaultText = field === "promptRu" && task.promptRu ? task.promptRu : task.prompt;
  const currentText = override?.[field] ?? defaultText;
  const isOverridden = override?.[field] != null;

  const [editText, setEditText] = useState(currentText);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(currentText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleStartEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditText(currentText);
    setEditing(true);
    setExpanded(true);
  };

  const handleSave = (e: React.MouseEvent) => {
    e.stopPropagation();
    const trimmed = editText.trim();
    if (trimmed === defaultText.trim()) {
      onSaveOverride(task.id, field, null);
    } else {
      onSaveOverride(task.id, field, trimmed);
    }
    setEditing(false);
    toast.success(isRu ? "Промпт сохранён" : "Prompt saved");
  };

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSaveOverride(task.id, field, null);
    setEditText(defaultText);
    setEditing(false);
    toast.info(isRu ? "Промпт сброшен к дефолту" : "Prompt reset to default");
  };

  const handleCancel = (e: React.MouseEvent) => {
    e.stopPropagation();
    setEditText(currentText);
    setEditing(false);
    setExpanded(false);
  };

  const preview = currentText.slice(0, 120).replace(/\n/g, " ") + (currentText.length > 120 ? "…" : "");

  return (
    <div className="rounded-md border border-border/50 bg-muted/30 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-medium">
              {isRu ? task.labelRu : task.labelEn}
            </span>
            {task.isMultilang && (
              <Badge variant="outline" className="text-[9px] px-1 py-0 h-4">
                RU/EN
              </Badge>
            )}
            {isOverridden && (
              <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 text-amber-500">
                {isRu ? "изменён" : "modified"}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground mt-0.5">
            {isRu ? task.descriptionRu : task.descriptionEn}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
          {isOverridden && !editing && (
            <Button
              variant="ghost"
              size="icon"
              className="h-5 w-5"
              onClick={handleReset}
              title={isRu ? "Сбросить к дефолту" : "Reset to default"}
            >
              <Undo2 className="h-3 w-3 text-amber-500" />
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={handleStartEdit}
            title={isRu ? "Редактировать" : "Edit"}
          >
            <Pencil className="h-3 w-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={handleCopy}
            title={isRu ? "Копировать промпт" : "Copy prompt"}
          >
            {copied
              ? <Check className="h-3 w-3 text-green-500" />
              : <Copy className="h-3 w-3" />}
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-5 w-5"
            onClick={() => { setExpanded(!expanded); if (editing && !expanded) setEditing(false); }}
          >
            {expanded
              ? <ChevronUp className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {!expanded && (
        <p
          className="text-[10px] text-muted-foreground/70 font-mono mt-1.5 cursor-pointer hover:text-muted-foreground transition-colors"
          onClick={() => setExpanded(true)}
        >
          {preview}
        </p>
      )}

      {expanded && editing && (
        <div className="mt-1.5 space-y-1.5">
          <Textarea
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            className="text-xs font-mono min-h-[180px] bg-background/50 border-border/30"
          />
          <div className="flex justify-end gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={handleCancel}
            >
              {isRu ? "Отмена" : "Cancel"}
            </Button>
            <Button
              variant="default"
              size="sm"
              className="h-6 text-xs gap-1"
              onClick={handleSave}
            >
              <Save className="h-3 w-3" />
              {isRu ? "Сохранить" : "Save"}
            </Button>
          </div>
        </div>
      )}

      {expanded && !editing && (
        <pre className="text-[10px] text-muted-foreground font-mono mt-1.5 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto bg-background/50 rounded p-2 border border-border/30">
          {currentText}
        </pre>
      )}

      <div className="flex items-center gap-2 mt-1.5">
        <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4 font-mono">
          {task.edgeFunction}
        </Badge>
        <span className="text-[9px] text-muted-foreground/50 font-mono">
          {task.id}
        </span>
      </div>
    </div>
  );
}

export function TaskPromptsPopover({ roleId, isRu }: TaskPromptsPopoverProps) {
  const tasks = getTaskPromptsForRole(roleId);
  const { value: overrides, update: updateOverrides } = useCloudSettings<PromptOverrides>(
    "task_prompt_overrides",
    {},
  );

  const handleSaveOverride = useCallback(
    (taskId: TaskPromptId, field: "prompt" | "promptRu", text: string | null) => {
      updateOverrides((prev) => {
        const next = { ...prev };
        if (text === null) {
          if (next[taskId]) {
            const entry = { ...next[taskId] };
            delete entry[field];
            if (Object.keys(entry).length === 0) {
              delete next[taskId];
            } else {
              next[taskId] = entry;
            }
          }
        } else {
          next[taskId] = { ...next[taskId], [field]: text };
        }
        return next;
      });
    },
    [updateOverrides],
  );

  if (tasks.length === 0) return null;

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          title={isRu ? "Функциональные промпты" : "Task prompts"}
        >
          <FileText className="h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="start"
        className="w-[460px] p-0"
      >
        <div className="px-3 py-2 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm font-medium">
              {isRu ? "Промпты" : "Prompts"}
            </span>
            <Badge variant="outline" className="text-[10px] px-1 py-0 ml-auto">
              {tasks.length}
            </Badge>
          </div>
        </div>
        <ScrollArea className="max-h-[500px]">
          <div className="p-2 space-y-2">
            {tasks.map((task) => (
              <PromptCard
                key={task.id}
                task={task}
                isRu={isRu}
                overrides={overrides}
                onSaveOverride={handleSaveOverride}
              />
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}