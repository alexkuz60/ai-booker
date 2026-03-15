import { Undo2, Redo2, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { LabeledSnapshot } from "@/hooks/useStructureUndo";
import { useState } from "react";

interface UndoRedoDropdownProps {
  isRu: boolean;
  canUndo: boolean;
  canRedo: boolean;
  undoStack: LabeledSnapshot[];
  redoStack: LabeledSnapshot[];
  onUndo: () => void;
  onRedo: () => void;
  onUndoTo: (index: number) => void;
  onRedoTo: (index: number) => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function HistoryList({
  items,
  onSelect,
  emptyText,
  direction,
}: {
  items: LabeledSnapshot[];
  onSelect: (index: number) => void;
  emptyText: string;
  direction: "undo" | "redo";
}) {
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null);

  if (items.length === 0) {
    return <div className="text-xs text-muted-foreground px-3 py-4 text-center">{emptyText}</div>;
  }

  // Show newest first for both stacks
  const displayed = [...items].reverse();

  return (
    <ScrollArea className="max-h-[240px]">
      <div className="py-1">
        {displayed.map((entry, displayIdx) => {
          // Map back to original index
          const originalIdx = items.length - 1 - displayIdx;
          // Highlight: for undo, highlight this and all below (newer); for redo, this and all below
          const isHighlighted = hoveredIdx !== null && displayIdx >= hoveredIdx;
          const stepsCount = hoveredIdx !== null ? displayIdx - hoveredIdx + 1 : 0;

          return (
            <button
              key={`${entry.timestamp}-${originalIdx}`}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 transition-colors ${
                isHighlighted
                  ? "bg-accent text-accent-foreground"
                  : "hover:bg-muted/50"
              }`}
              onMouseEnter={() => setHoveredIdx(displayIdx)}
              onMouseLeave={() => setHoveredIdx(null)}
              onClick={() => onSelect(originalIdx)}
            >
              <Clock className="h-3 w-3 shrink-0 text-muted-foreground" />
              <span className="truncate flex-1">{entry.label}</span>
              <span className="text-muted-foreground shrink-0 tabular-nums">{formatTime(entry.timestamp)}</span>
              {isHighlighted && hoveredIdx === displayIdx && stepsCount === 0 && (
                <span className="text-[10px] text-muted-foreground shrink-0">
                  {direction === "undo" ? "↩" : "↪"}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </ScrollArea>
  );
}

export default function UndoRedoDropdown({
  isRu,
  canUndo,
  canRedo,
  undoStack,
  redoStack,
  onUndo,
  onRedo,
  onUndoTo,
  onRedoTo,
}: UndoRedoDropdownProps) {
  const [undoOpen, setUndoOpen] = useState(false);
  const [redoOpen, setRedoOpen] = useState(false);

  return (
    <div className="flex items-center gap-0.5">
      {/* Undo button with dropdown */}
      <Popover open={undoOpen} onOpenChange={setUndoOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={!canUndo}
            className="h-7 w-7"
            title={`${isRu ? "Отменить" : "Undo"} (Ctrl+Z)`}
            onClick={(e) => {
              // Simple click = single undo; long-press / right-click opens list
              if (!e.shiftKey) {
                onUndo();
                e.preventDefault();
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (canUndo) setUndoOpen(true);
            }}
          >
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground">
            {isRu ? "История отмен" : "Undo History"} ({undoStack.length})
          </div>
          <HistoryList
            items={undoStack}
            onSelect={(idx) => {
              onUndoTo(idx);
              setUndoOpen(false);
            }}
            emptyText={isRu ? "Нет действий для отмены" : "Nothing to undo"}
            direction="undo"
          />
        </PopoverContent>
      </Popover>

      {/* Small chevron to explicitly open the dropdown */}
      <Button
        variant="ghost"
        size="icon"
        disabled={!canUndo}
        className="h-7 w-4 px-0"
        onClick={() => canUndo && setUndoOpen(!undoOpen)}
        title={isRu ? "Список отмен" : "Undo list"}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>

      {/* Redo button with dropdown */}
      <Popover open={redoOpen} onOpenChange={setRedoOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            disabled={!canRedo}
            className="h-7 w-7"
            title={`${isRu ? "Повторить" : "Redo"} (Ctrl+Shift+Z)`}
            onClick={(e) => {
              if (!e.shiftKey) {
                onRedo();
                e.preventDefault();
              }
            }}
            onContextMenu={(e) => {
              e.preventDefault();
              if (canRedo) setRedoOpen(true);
            }}
          >
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-72 p-0"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          <div className="px-3 py-2 border-b text-xs font-medium text-muted-foreground">
            {isRu ? "История повторов" : "Redo History"} ({redoStack.length})
          </div>
          <HistoryList
            items={redoStack}
            onSelect={(idx) => {
              onRedoTo(idx);
              setRedoOpen(false);
            }}
            emptyText={isRu ? "Нет действий для повтора" : "Nothing to redo"}
            direction="redo"
          />
        </PopoverContent>
      </Popover>

      <Button
        variant="ghost"
        size="icon"
        disabled={!canRedo}
        className="h-7 w-4 px-0"
        onClick={() => canRedo && setRedoOpen(!redoOpen)}
        title={isRu ? "Список повторов" : "Redo list"}
      >
        <svg className="h-2.5 w-2.5" viewBox="0 0 10 6" fill="none">
          <path d="M1 1l4 4 4-4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Button>
    </div>
  );
}
