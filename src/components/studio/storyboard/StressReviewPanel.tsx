import { useState, useCallback, useMemo, useEffect } from "react";
import { Check, X, ChevronUp, ChevronDown, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

// ── Types ────────────────────────────────────────────────────

export interface StressSuggestion {
  word: string;
  stressed_index: number;
  reason: string;
}

interface ReviewItem extends StressSuggestion {
  status: "pending" | "accepted" | "rejected";
  editedIndex?: number;
}

interface StressReviewPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suggestions: StressSuggestion[];
  isRu: boolean;
  onAccept: (accepted: StressSuggestion[]) => void;
}

// ── Helpers ──────────────────────────────────────────────────

const VOWELS = new Set("аеёиоуыэюяАЕЁИОУЫЭЮЯ");

function highlightStress(word: string, index: number): React.ReactNode {
  if (index < 0 || index >= word.length) return <span>{word}</span>;
  return (
    <>
      <span>{word.slice(0, index)}</span>
      <span className="text-primary font-bold underline decoration-2 decoration-primary">{word[index]}</span>
      <span>{word.slice(index + 1)}</span>
    </>
  );
}

function getVowelIndices(word: string): number[] {
  const indices: number[] = [];
  for (let i = 0; i < word.length; i++) {
    if (VOWELS.has(word[i])) indices.push(i);
  }
  return indices;
}

// ── Component ────────────────────────────────────────────────

export function StressReviewPanel({ open, onOpenChange, suggestions, isRu, onAccept }: StressReviewPanelProps) {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  useEffect(() => {
    if (suggestions.length > 0) {
      setItems(suggestions.map(s => ({ ...s, status: "pending" as const })));
    }
  }, [suggestions]);

  const setStatus = useCallback((idx: number, status: "accepted" | "rejected") => {
    setItems(prev => prev.map((it, i) => i === idx ? { ...it, status } : it));
  }, []);

  const toggleStatus = useCallback((idx: number) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      if (it.status === "accepted") return { ...it, status: "rejected" };
      return { ...it, status: "accepted" };
    }));
  }, []);

  const acceptAll = useCallback(() => {
    setItems(prev => prev.map(it => ({ ...it, status: "accepted" })));
  }, []);

  const rejectAll = useCallback(() => {
    setItems(prev => prev.map(it => ({ ...it, status: "rejected" })));
  }, []);

  const cycleStress = useCallback((idx: number, direction: 1 | -1) => {
    setItems(prev => prev.map((it, i) => {
      if (i !== idx) return it;
      const vowels = getVowelIndices(it.word);
      if (vowels.length <= 1) return it;
      const current = it.editedIndex ?? it.stressed_index;
      const curVowelIdx = vowels.indexOf(current);
      const next = (curVowelIdx + direction + vowels.length) % vowels.length;
      return { ...it, editedIndex: vowels[next], status: "accepted" };
    }));
  }, []);

  const stats = useMemo(() => {
    let accepted = 0, rejected = 0, pending = 0;
    for (const it of items) {
      if (it.status === "accepted") accepted++;
      else if (it.status === "rejected") rejected++;
      else pending++;
    }
    return { accepted, rejected, pending };
  }, [items]);

  const handleConfirm = useCallback(() => {
    const accepted = items
      .filter(it => it.status === "accepted")
      .map(it => ({
        word: it.word,
        stressed_index: it.editedIndex ?? it.stressed_index,
        reason: it.reason,
      }));
    onAccept(accepted);
    onOpenChange(false);
  }, [items, onAccept, onOpenChange]);

  if (!open) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base">
            <BookOpen className="h-4 w-4 text-primary" />
            {isRu ? "Просмотр ударений" : "Stress Review"}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            {isRu
              ? "Проверьте предложения ИИ. Стрелки ▲▼ переключают ударную гласную."
              : "Review AI suggestions. Use ▲▼ to cycle the stressed vowel."}
          </DialogDescription>
        </DialogHeader>

        {/* Stats bar */}
        <div className="flex items-center gap-2 text-xs px-1">
          <Badge variant="outline" className="gap-1">
            {isRu ? "Всего" : "Total"}: {items.length}
          </Badge>
          {stats.accepted > 0 && (
            <Badge className="gap-1 bg-emerald-500/20 text-emerald-400 border-emerald-500/30">
              ✓ {stats.accepted}
            </Badge>
          )}
          {stats.rejected > 0 && (
            <Badge className="gap-1 bg-destructive/20 text-destructive border-destructive/30">
              ✕ {stats.rejected}
            </Badge>
          )}
          <div className="flex-1" />
          <Button variant="ghost" size="sm" className="h-6 text-[10px]" onClick={acceptAll}>
            {isRu ? "Принять все" : "Accept all"}
          </Button>
          <Button variant="ghost" size="sm" className="h-6 text-[10px] text-destructive" onClick={rejectAll}>
            {isRu ? "Отклонить все" : "Reject all"}
          </Button>
        </div>

        {/* Items list */}
        <ScrollArea className="flex-1 min-h-0 border rounded-md">
          <div className="divide-y divide-border">
            {items.map((item, idx) => {
              const effectiveIndex = item.editedIndex ?? item.stressed_index;
              const isEdited = item.editedIndex !== undefined && item.editedIndex !== item.stressed_index;
              return (
                <div
                  key={`${item.word}-${idx}`}
                  className={cn(
                    "flex items-center gap-2 px-3 py-2 transition-colors",
                    item.status === "accepted" && "bg-emerald-500/5",
                    item.status === "rejected" && "bg-destructive/5 opacity-60",
                  )}
                >
                  {/* Word with highlighted stress */}
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium tracking-wide">
                      {highlightStress(item.word, effectiveIndex)}
                      {isEdited && (
                        <span className="ml-1 text-[10px] text-muted-foreground">(✎)</span>
                      )}
                    </div>
                    <div className="text-[11px] text-muted-foreground leading-tight mt-0.5 truncate">
                      {item.reason}
                    </div>
                  </div>

                  {/* Stress cycle buttons */}
                  <div className="flex flex-col gap-0.5">
                    <button
                      onClick={() => cycleStress(idx, -1)}
                      className="h-4 w-4 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                      title={isRu ? "Предыдущая гласная" : "Previous vowel"}
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      onClick={() => cycleStress(idx, 1)}
                      className="h-4 w-4 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground"
                      title={isRu ? "Следующая гласная" : "Next vowel"}
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>

                  {/* Accept / Reject */}
                  <button
                    onClick={() => setStatus(idx, "accepted")}
                    className={cn(
                      "h-7 w-7 flex items-center justify-center rounded-md transition-colors",
                      item.status === "accepted"
                        ? "bg-emerald-500/20 text-emerald-400"
                        : "hover:bg-emerald-500/10 text-muted-foreground hover:text-emerald-400",
                    )}
                    title={isRu ? "Принять" : "Accept"}
                  >
                    <Check className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => setStatus(idx, "rejected")}
                    className={cn(
                      "h-7 w-7 flex items-center justify-center rounded-md transition-colors",
                      item.status === "rejected"
                        ? "bg-destructive/20 text-destructive"
                        : "hover:bg-destructive/10 text-muted-foreground hover:text-destructive",
                    )}
                    title={isRu ? "Отклонить" : "Reject"}
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
          </div>
        </ScrollArea>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            {isRu ? "Отмена" : "Cancel"}
          </Button>
          <Button size="sm" onClick={handleConfirm} disabled={stats.accepted === 0}>
            <Check className="h-3.5 w-3.5 mr-1" />
            {isRu
              ? `Сохранить ${stats.accepted} в словарь`
              : `Save ${stats.accepted} to dictionary`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
