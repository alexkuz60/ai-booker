/**
 * BilingualSegmentRow — single segment accordion item in the bilingual storyboard.
 *
 * Extracted from BilingualSegmentsView for maintainability.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SEGMENT_CONFIG } from "@/components/studio/storyboard/constants";
import type { Segment } from "@/components/studio/storyboard/types";
import { Loader2, Languages, Sparkles, Scale, Lock } from "lucide-react";
import {
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { RadarStage } from "@/lib/radarStages";
import type { SelectedSegmentData } from "./BilingualSegmentsView";

interface Props {
  segment: Segment;
  translatedText: string;
  hasLiteral: boolean;
  currentStage: RadarStage | null;
  isSelected: boolean;
  isRu: boolean;
  translating: boolean;
  isSegTranslating: boolean;
  isSegEditing: boolean;
  isSegCritiquing: boolean;
  
  onTranslate: (seg: Segment) => void;
  onLiteraryEdit?: (seg: Segment) => void;
  onCritique?: (seg: Segment) => void;
}

export function BilingualSegmentRow({
  segment: seg,
  translatedText,
  hasLiteral,
  currentStage,
  isSelected,
  isRu,
  translating,
  isSegTranslating,
  isSegEditing,
  isSegCritiquing,
  onTranslate,
  onLiteraryEdit,
  onCritique,
}: Props) {
  const config = SEGMENT_CONFIG[seg.segment_type] ?? SEGMENT_CONFIG.narrator;
  const Icon = config.icon;
  const fullText = seg.phrases.map((p) => p.text).join(" ");
  const hasTranslation = hasLiteral || !!translatedText;
  const hasLiterary = currentStage === "literary" || currentStage === "critique";
  const hasCritique = currentStage === "critique";

  return (
    <AccordionItem
      key={seg.segment_id}
      value={seg.segment_id}
      data-segment-id={seg.segment_id}
      className={cn(
        "border rounded-md overflow-hidden cursor-pointer transition-colors",
        isSelected
          ? "bg-primary/10 border-primary ring-2 ring-primary/40 shadow-sm shadow-primary/10"
          : "bg-muted/10 hover:border-muted-foreground/30",
      )}
    >
      {/* Segment header */}
      <AccordionTrigger className="px-3 py-1.5 text-xs hover:no-underline gap-2">
        <div className="flex items-center gap-2 flex-wrap flex-1 min-w-0">
          <Badge
            variant="outline"
            className={cn("text-[10px] gap-1 py-0 shrink-0", config.color)}
          >
            <Icon className="h-3 w-3" />
            {isRu ? config.label_ru : config.label_en}
          </Badge>
          {seg.speaker && (
            <span className="text-[10px] text-muted-foreground truncate">
              {seg.speaker}
            </span>
          )}

          {/* ── Stage action buttons ── */}
          <div className="flex items-center gap-0.5 ml-auto mr-1 shrink-0" onClick={e => e.stopPropagation()}>
            {/* 1. Translate */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); onTranslate(seg); }}
                  disabled={translating || isSegTranslating}
                  className={cn("h-5 w-5 p-0", hasTranslation && "text-primary")}
                >
                  {isSegTranslating
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : <Languages className="h-3 w-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px]">
                {hasTranslation
                  ? (isRu ? "Перевести заново" : "Re-translate")
                  : (isRu ? "Перевести" : "Translate")}
              </TooltipContent>
            </Tooltip>

            {/* 2. Art Edit */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); onLiteraryEdit?.(seg); }}
                  disabled={!hasTranslation || translating || isSegEditing}
                  className={cn("h-5 w-5 p-0", hasLiterary && "text-amber-500")}
                >
                  {isSegEditing
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : !hasTranslation
                      ? <Lock className="h-3 w-3 opacity-40" />
                      : <Sparkles className="h-3 w-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px]">
                {!hasTranslation
                  ? (isRu ? "Сначала переведите" : "Translate first")
                  : (isRu ? "Арт-правка" : "Art Edit")}
              </TooltipContent>
            </Tooltip>

            {/* 3. Critique */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={(e) => { e.stopPropagation(); onCritique?.(seg); }}
                  disabled={!hasLiterary || translating || isSegCritiquing}
                  className={cn("h-5 w-5 p-0", hasCritique && "text-emerald-500")}
                >
                  {isSegCritiquing
                    ? <Loader2 className="h-3 w-3 animate-spin" />
                    : !hasLiterary
                      ? <Lock className="h-3 w-3 opacity-40" />
                      : <Scale className="h-3 w-3" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom" className="text-[10px]">
                {!hasLiterary
                  ? (isRu ? "Сначала арт-правка" : "Art edit first")
                  : (isRu ? "Оценка" : "Critique")}
              </TooltipContent>
            </Tooltip>
          </div>

          <span className="text-[10px] text-muted-foreground/50 shrink-0">
            #{seg.segment_number}
          </span>
        </div>
      </AccordionTrigger>

      <AccordionContent className="px-3 pb-3 pt-0 space-y-2">
        {/* Original text */}
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            {isRu ? "Оригинал" : "Original"}
          </span>
          <p className="text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap select-text rounded-md bg-muted/30 border border-border/30 p-2">
            {fullText}
          </p>
        </div>

        {/* Translation */}
        <div className="space-y-1">
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">
            {isRu ? "Перевод" : "Translation"}
          </span>
          {translatedText ? (
            <p className="text-xs text-foreground leading-relaxed whitespace-pre-wrap select-text rounded-md bg-primary/5 border border-primary/20 p-2">
              {translatedText}
            </p>
          ) : (
            <div className="text-xs text-muted-foreground italic rounded-md bg-muted/20 border border-dashed border-muted-foreground/20 p-2 min-h-[2.5rem]">
              {isRu
                ? "Нажмите ▶ для подстрочного перевода"
                : "Click ▶ to translate"}
            </div>
          )}
        </div>
      </AccordionContent>
    </AccordionItem>
  );
}
