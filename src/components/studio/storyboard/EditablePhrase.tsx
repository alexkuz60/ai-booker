import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { useSelectionCapture } from "@/hooks/useSelectionCapture";
import { Pencil, Check } from "lucide-react";
import {
  ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem,
  ContextMenuSeparator, ContextMenuLabel, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
} from "@/components/ui/context-menu";
import {
  type PhraseAnnotation,
  type TtsProvider,
  type AnnotationType,
  getAvailableAnnotations,
  ANNOTATION_STYLES,
  isInsertionAnnotation,
} from "../phraseAnnotations";
import { renderAnnotatedText } from "./PhraseRenderer";
import type { Phrase } from "./types";

interface EditablePhraseProps {
  phrase: Phrase;
  isRu: boolean;
  onSave: (id: string, text: string) => void;
  onSplit: (phraseId: string, textBefore: string, textAfter: string) => void;
  ttsProvider: TtsProvider;
  onAnnotate: (phraseId: string, annotation: PhraseAnnotation) => void;
  onRemoveAnnotation: (phraseId: string, index: number) => void;
}

export function EditablePhrase({ phrase, isRu, onSave, onSplit, ttsProvider, onAnnotate, onRemoveAnnotation }: EditablePhraseProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(phrase.text);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const textRef = useRef<HTMLParagraphElement>(null);
  const { capture: handleContextMenu, peek } = useSelectionCapture(textRef);

  useEffect(() => {
    if (editing && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = "auto";
      textareaRef.current.style.height = textareaRef.current.scrollHeight + "px";
    }
  }, [editing]);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== phrase.text) {
      onSave(phrase.phrase_id, trimmed);
    }
    setEditing(false);
  };

  const handleAnnotate = useCallback((type: AnnotationType, durationMs?: number) => {
    const sel = peek();
    if (isInsertionAnnotation(type)) {
      const offset = sel ? sel.end : phrase.text.length;
      onAnnotate(phrase.phrase_id, { type, offset, durationMs: durationMs ?? 500 });
    } else {
      if (!sel) return;
      const actualType = type === "emphasis" && (sel.end - sel.start) === 1 ? "stress" as AnnotationType : type;
      onAnnotate(phrase.phrase_id, { type: actualType, start: sel.start, end: sel.end });
    }
  }, [phrase.phrase_id, phrase.text.length, onAnnotate, peek]);

  const hasAnnotations = phrase.annotations && phrase.annotations.length > 0;

  const EMOTION_TYPES = new Set(["joy", "sadness", "anger"]);
  const SOUND_TYPES = new Set(["sigh", "cough", "laugh", "hmm"]);

  const availableAnnotations = getAvailableAnnotations(ttsProvider, true);
  const availableInsertions = getAvailableAnnotations(ttsProvider, false).filter(a => !a.needsRange);

  const prosodyItems = availableAnnotations.filter(a => !EMOTION_TYPES.has(a.type) && !SOUND_TYPES.has(a.type));
  const emotionItems = availableAnnotations.filter(a => EMOTION_TYPES.has(a.type));
  const soundInsertions = availableInsertions.filter(a => SOUND_TYPES.has(a.type));
  const otherInsertions = availableInsertions.filter(a => !SOUND_TYPES.has(a.type) && !availableAnnotations.find(x => x.type === a.type));

  if (editing) {
    return (
      <div className="flex gap-2 px-3 py-1.5 group">
        <span className="text-[10px] text-muted-foreground font-mono pt-1.5 shrink-0 w-5 text-right">
          {phrase.phrase_number}
        </span>
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            e.target.style.height = "auto";
            e.target.style.height = e.target.scrollHeight + "px";
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              const pos = textareaRef.current?.selectionStart ?? draft.length;
              const before = draft.slice(0, pos).trim();
              const after = draft.slice(pos).trim();
              if (before && after) {
                onSplit(phrase.phrase_id, before, after);
                setEditing(false);
              } else {
                save();
              }
            }
            if (e.key === "Escape") { setDraft(phrase.text); setEditing(false); }
          }}
          className="flex-1 text-sm font-body text-foreground leading-relaxed bg-background border border-primary/30 rounded px-2 py-1 resize-none focus:outline-none focus:ring-1 focus:ring-primary"
        />
        <button onClick={save} className="shrink-0 text-primary hover:text-primary/80 pt-1">
          <Check className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div onContextMenu={handleContextMenu} className="flex gap-2 px-3 py-1.5 hover:bg-accent/20 transition-colors group">
          <span className="text-[10px] text-muted-foreground font-mono pt-0.5 shrink-0 w-5 text-right">
            {phrase.phrase_number}
          </span>
          <p ref={textRef} className="text-sm font-body text-foreground leading-relaxed flex-1 select-text">
            {renderAnnotatedText(phrase.text, phrase.annotations)}
          </p>
          <button
            onClick={() => setEditing(true)}
            className="shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity text-muted-foreground hover:text-foreground cursor-pointer"
            title={isRu ? "Редактировать" : "Edit"}
          >
            <Pencil className="h-3 w-3" />
          </button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="w-52">
        <ContextMenuLabel className="text-xs">
          {isRu ? "Аннотации речи" : "Speech Annotations"}
          <span className="ml-1 text-[10px] text-muted-foreground font-normal">({ttsProvider})</span>
        </ContextMenuLabel>
        <ContextMenuSeparator />
        {availableAnnotations.length === 0 && availableInsertions.length === 0 ? (
          <ContextMenuItem disabled className="text-xs text-muted-foreground">
            {isRu ? "Нет доступных аннотаций для этого TTS" : "No annotations available for this TTS"}
          </ContextMenuItem>
        ) : (
          <>
            {prosodyItems.map((a) =>
              a.type === "pause" ? (
                <ContextMenuSub key={a.type}>
                  <ContextMenuSubTrigger className="text-xs gap-2">
                    <span>{a.emoji}</span>
                    {isRu ? "Пауза" : "Pause"}
                  </ContextMenuSubTrigger>
                  <ContextMenuSubContent className="min-w-[7rem]">
                    {[250, 500, 1000, 2000].map((ms) => (
                      <ContextMenuItem
                        key={ms}
                        onClick={() => handleAnnotate("pause", ms)}
                        className="text-xs gap-2"
                      >
                        ⏸ {ms >= 1000 ? `${ms / 1000}с` : `${ms}мс`}
                      </ContextMenuItem>
                    ))}
                  </ContextMenuSubContent>
                </ContextMenuSub>
              ) : (
                <ContextMenuItem
                  key={a.type}
                  onClick={() => handleAnnotate(a.type)}
                  className="text-xs gap-2"
                >
                  <span>{a.emoji}</span>
                  {isRu ? a.label_ru.replace(/^. /, "") : a.label_en.replace(/^. /, "")}
                </ContextMenuItem>
              )
            )}

            {emotionItems.length > 0 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger className="text-xs gap-2">
                  <span>🎭</span>
                  {isRu ? "Эмоции" : "Emotions"}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="min-w-[8rem]">
                  {emotionItems.map((a) => (
                    <ContextMenuItem
                      key={a.type}
                      onClick={() => handleAnnotate(a.type)}
                      className="text-xs gap-2"
                    >
                      <span>{a.emoji}</span>
                      {isRu ? a.label_ru.replace(/^. /, "") : a.label_en.replace(/^. /, "")}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}

            {soundInsertions.length > 0 && (
              <ContextMenuSub>
                <ContextMenuSubTrigger className="text-xs gap-2">
                  <span>🔊</span>
                  {isRu ? "Звуки" : "Sounds"}
                </ContextMenuSubTrigger>
                <ContextMenuSubContent className="min-w-[8rem]">
                  {soundInsertions.map((a) => (
                    <ContextMenuItem
                      key={a.type}
                      onClick={() => handleAnnotate(a.type)}
                      className="text-xs gap-2"
                    >
                      <span>{a.emoji}</span>
                      {isRu ? a.label_ru.replace(/^. /, "") : a.label_en.replace(/^. /, "")}
                    </ContextMenuItem>
                  ))}
                </ContextMenuSubContent>
              </ContextMenuSub>
            )}

            {otherInsertions.map((a) => (
              <ContextMenuItem
                key={`ins-${a.type}`}
                onClick={() => handleAnnotate(a.type)}
                className="text-xs gap-2"
              >
                <span>{a.emoji}</span>
                {isRu ? a.label_ru.replace(/^. /, "") : a.label_en.replace(/^. /, "")}
              </ContextMenuItem>
            ))}
          </>
        )}
        {hasAnnotations && (
          <>
            <ContextMenuSeparator />
            <ContextMenuLabel className="text-[10px]">
              {isRu ? "Удалить аннотацию" : "Remove annotation"}
            </ContextMenuLabel>
            {phrase.annotations!.map((a, idx) => (
              <ContextMenuItem
                key={`rm-${idx}`}
                onClick={() => onRemoveAnnotation(phrase.phrase_id, idx)}
                className="text-xs gap-2 text-destructive"
              >
                ✕ {ANNOTATION_STYLES[a.type]?.prefix || ""} {a.type}
                {a.start !== undefined && a.end !== undefined && (
                  <span className="text-muted-foreground ml-1">
                    [{a.start}:{a.end}]
                  </span>
                )}
              </ContextMenuItem>
            ))}
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
