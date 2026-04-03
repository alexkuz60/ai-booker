/**
 * StoryboardSegmentRow — renders a single segment card in the storyboard.
 * Extracted from StoryboardPanel.tsx for modularity.
 */

import { memo } from "react";
import {
  CheckCircle2, XCircle, MessageCircle, BookOpen,
  RefreshCw, AudioLines, Timer, X,
} from "lucide-react";
import { RoleBadge } from "@/components/ui/RoleBadge";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";

import type { Phrase, Segment, CharacterOption } from "./types";
import type { PhraseAnnotation, TtsProvider } from "../phraseAnnotations";
import { EditablePhrase } from "./EditablePhrase";
import { SegmentTypeBadge } from "./SegmentTypeBadge";
import { SpeakerBadge } from "./SpeakerBadge";

interface StoryboardSegmentRowProps {
  seg: Segment;
  isRu: boolean;
  isSelected: boolean;
  audioStatus: { status: string; durationMs: number } | undefined;
  ttsProvider: TtsProvider;
  characters: CharacterOption[];
  mergeChecked: boolean;
  resynthSegId: string | null;
  synthesizing: boolean;
  inlineNarrationSpeaker: string | null;
  getModelForRole: (role: string) => string;
  onSelect: (segmentId: string | null) => void;
  onUpdateType: (segmentId: string, newType: string) => void;
  onUpdateSpeaker: (segmentId: string, newSpeaker: string | null) => void;
  onResynthSegment: (segmentId: string) => void;
  onSplitSilenceChange: (segmentId: string, ms: number) => void;
  onToggleMergeCheck: (segmentId: string) => void;
  onSavePhrase: (phraseId: string, newText: string) => void;
  onSplitAtPhrase: (phraseId: string, textBefore: string, textAfter: string) => void;
  onAnnotate: (phraseId: string, annotation: PhraseAnnotation) => void;
  onRemoveAnnotation: (phraseId: string, index: number) => void;
  onRemoveInlineNarration: (segmentId: string, idx: number) => void;
  onUpdateInlineNarrationSpeaker: (speaker: string | null) => void;
}

export const StoryboardSegmentRow = memo(function StoryboardSegmentRow({
  seg, isRu, isSelected, audioStatus, ttsProvider,
  characters, mergeChecked, resynthSegId, synthesizing,
  inlineNarrationSpeaker, getModelForRole,
  onSelect, onUpdateType, onUpdateSpeaker, onResynthSegment,
  onSplitSilenceChange, onToggleMergeCheck,
  onSavePhrase, onSplitAtPhrase, onAnnotate, onRemoveAnnotation,
  onRemoveInlineNarration, onUpdateInlineNarrationSpeaker,
}: StoryboardSegmentRowProps) {
  return (
    <div
      id={`storyboard-seg-${seg.segment_id}`}
      className={`rounded-lg border overflow-hidden transition-all cursor-pointer ${
        isSelected
          ? "border-primary ring-2 ring-primary/30 bg-card"
          : "border-border bg-card/50"
      }`}
      onClick={() => onSelect(isSelected ? null : seg.segment_id)}
    >
      {/* Segment header */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-border/50 bg-muted/30">
        <RoleBadge roleId="screenwriter" model={getModelForRole("screenwriter")} isRu={isRu} size={12} />
        <SegmentTypeBadge
          segmentType={seg.segment_type}
          isRu={isRu}
          onChange={(newType) => onUpdateType(seg.segment_id, newType)}
        />
        {seg.segment_type !== "narrator" && seg.segment_type !== "footnote" && (
          <SpeakerBadge
            speaker={seg.speaker}
            characters={characters}
            isRu={isRu}
            onChange={(newSpeaker) => onUpdateSpeaker(seg.segment_id, newSpeaker)}
          />
        )}
        {seg.segment_type === "lyric" && (
          <span
            className="text-[10px] text-pink-400 italic"
            title={isRu
              ? "Рекомендация: Yandex filipp/madirus (SSML контроль), OpenAI Onyx (натуральность), Sber Bora (эмоции)"
              : "Tip: Yandex filipp/madirus (SSML control), OpenAI Onyx (natural), Sber Bora (emotions)"}
          >
            🎭 {isRu ? "стих" : "verse"}
          </span>
        )}
        {(() => {
          if (!audioStatus) return null;
          const durSec = (audioStatus.durationMs / 1000).toFixed(1);
          return audioStatus.status === "ready" ? (
            <span className="inline-flex items-center gap-1 text-[10px] text-green-400 font-mono">
              <CheckCircle2 className="h-3 w-3" />
              {durSec}s
            </span>
          ) : (
            <span className="inline-flex items-center gap-1 text-[10px] text-destructive font-mono">
              <XCircle className="h-3 w-3" />
              {isRu ? "ошибка" : "error"}
            </span>
          );
        })()}
        {seg.inline_narrations && seg.inline_narrations.length > 0 && (
          <span
            className="inline-flex items-center gap-0.5 text-[10px] text-accent-foreground font-mono"
            title={isRu
              ? `${seg.inline_narrations.length} авторская вставка`
              : `${seg.inline_narrations.length} narrator insertion(s)`}
          >
            <MessageCircle className="h-3 w-3" />
            {seg.inline_narrations.length}
          </span>
        )}
        <button
          onClick={(e) => { e.stopPropagation(); onResynthSegment(seg.segment_id); }}
          disabled={resynthSegId === seg.segment_id || synthesizing}
          className="ml-1 p-0.5 rounded hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
          title={audioStatus
            ? (isRu ? "Ре-синтез блока" : "Re-synthesize segment")
            : (isRu ? "Синтез блока" : "Synthesize segment")}
        >
          {resynthSegId === seg.segment_id
            ? <AudioLines className="h-3 w-3 animate-pulse-glow text-primary" />
            : audioStatus
              ? <RefreshCw className="h-3 w-3" />
              : <AudioLines className="h-3 w-3" />}
        </button>
        <div className="ml-auto flex items-center gap-1.5">
          {seg.split_silence_ms !== undefined && (
            <div className="flex items-center gap-0.5 border-r border-border pr-1.5 mr-0.5" onClick={(e) => e.stopPropagation()}>
              <Timer className="h-3 w-3 text-muted-foreground" />
              {[0, 500, 1000, 1500, 2000].map((ms) => (
                <button
                  key={ms}
                  onClick={() => onSplitSilenceChange(seg.segment_id, ms)}
                  className={cn(
                    "h-4 min-w-[20px] text-[9px] font-mono rounded transition-colors",
                    (seg.split_silence_ms ?? 0) === ms
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted/50 text-muted-foreground hover:bg-muted"
                  )}
                  title={`${ms}ms`}
                >
                  {ms === 0 ? "0" : (ms / 1000).toFixed(1)}
                </button>
              ))}
              <span className="text-[9px] text-muted-foreground">{isRu ? "с" : "s"}</span>
            </div>
          )}
          <span className="text-[10px] text-muted-foreground font-mono">
            #{seg.segment_number}
          </span>
          <Checkbox
            checked={mergeChecked}
            onCheckedChange={() => onToggleMergeCheck(seg.segment_id)}
            onClick={(e) => e.stopPropagation()}
            className="h-3.5 w-3.5"
          />
        </div>
      </div>
      {/* Phrases */}
      <div className="divide-y divide-border/30">
        {seg.phrases.map((ph) => (
          <EditablePhrase
            key={ph.phrase_id}
            phrase={ph}
            isRu={isRu}
            onSave={onSavePhrase}
            onSplit={onSplitAtPhrase}
            ttsProvider={ttsProvider}
            onAnnotate={onAnnotate}
            onRemoveAnnotation={onRemoveAnnotation}
          />
        ))}
      </div>
      {seg.inline_narrations && seg.inline_narrations.length > 0 && (
        <div className="px-3 py-1 bg-accent/10 border-t border-border/30">
          <div className="flex items-center gap-2 mb-1">
            <BookOpen className="h-3 w-3 text-yellow-400/70" />
            <span className="text-[10px] text-muted-foreground font-mono">
              {isRu ? "Голос вставок:" : "Narration voice:"}
            </span>
            <SpeakerBadge
              speaker={inlineNarrationSpeaker}
              characters={characters}
              isRu={isRu}
              onChange={onUpdateInlineNarrationSpeaker}
            />
          </div>
          {seg.inline_narrations.map((n, idx) => (
            <div key={idx} className="text-sm font-body flex items-start gap-1 leading-relaxed group/narr">
              <BookOpen className="h-3 w-3 mt-1 shrink-0 text-yellow-400/70" />
              <span className="text-muted-foreground/60 shrink-0">
                {isRu ? "после" : "after"} «{n.insert_after.slice(0, 20)}{n.insert_after.length > 20 ? "…" : ""}»
              </span>
              <span className="text-muted-foreground/60">→</span>
              <span className="text-yellow-300/70">«{n.text}»</span>
              <button
                onClick={(e) => { e.stopPropagation(); onRemoveInlineNarration(seg.segment_id, idx); }}
                className="shrink-0 mt-0.5 opacity-0 group-hover/narr:opacity-100 transition-opacity text-destructive/60 hover:text-destructive"
                title={isRu ? "Удалить вставку" : "Remove narration"}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
