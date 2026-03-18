import { useState } from "react";
import { FileText, ChevronDown, ChevronUp, Copy, Check } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  getTaskPromptsForRole,
  type TaskPromptDefinition,
  type TaskPromptId,
} from "@/config/aiTaskPrompts";
import type { AiRoleId } from "@/config/aiRoles";

interface TaskPromptsPopoverProps {
  roleId: AiRoleId;
  isRu: boolean;
}

function PromptCard({ task, isRu }: { task: TaskPromptDefinition; isRu: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const promptText = isRu && task.promptRu ? task.promptRu : task.prompt;
  const preview = promptText.slice(0, 120).replace(/\n/g, " ") + (promptText.length > 120 ? "…" : "");

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-md border border-border/50 bg-muted/30 p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium">
              {isRu ? task.labelRu : task.labelEn}
            </span>
            {task.isMultilang && (
              <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">
                RU/EN
              </Badge>
            )}
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {isRu ? task.descriptionRu : task.descriptionEn}
          </p>
        </div>
        <div className="flex items-center gap-0.5 shrink-0">
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
            onClick={() => setExpanded(!expanded)}
          >
            {expanded
              ? <ChevronUp className="h-3 w-3" />
              : <ChevronDown className="h-3 w-3" />}
          </Button>
        </div>
      </div>

      {!expanded && (
        <p
          className="text-[9px] text-muted-foreground/70 font-mono mt-1.5 cursor-pointer hover:text-muted-foreground transition-colors"
          onClick={() => setExpanded(true)}
        >
          {preview}
        </p>
      )}

      {expanded && (
        <pre className="text-[9px] text-muted-foreground font-mono mt-1.5 whitespace-pre-wrap break-words max-h-[200px] overflow-y-auto bg-background/50 rounded p-2 border border-border/30">
          {promptText}
        </pre>
      )}

      <div className="flex items-center gap-2 mt-1.5">
        <Badge variant="secondary" className="text-[8px] px-1 py-0 h-3.5 font-mono">
          {task.edgeFunction}
        </Badge>
        <span className="text-[8px] text-muted-foreground/50 font-mono">
          {task.id}
        </span>
      </div>
    </div>
  );
}

export function TaskPromptsPopover({ roleId, isRu }: TaskPromptsPopoverProps) {
  const tasks = getTaskPromptsForRole(roleId);

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
        className="w-[420px] p-0"
      >
        <div className="px-3 py-2 border-b border-border/50">
          <div className="flex items-center gap-1.5">
            <FileText className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-xs font-medium">
              {isRu ? "Промпты" : "Prompts"}
            </span>
            <Badge variant="outline" className="text-[9px] px-1 py-0 ml-auto">
              {tasks.length}
            </Badge>
          </div>
        </div>
        <ScrollArea className="max-h-[400px]">
          <div className="p-2 space-y-2">
            {tasks.map((task) => (
              <PromptCard key={task.id} task={task} isRu={isRu} />
            ))}
          </div>
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
