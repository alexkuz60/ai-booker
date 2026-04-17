/**
 * OmniVoiceTextEditor — textarea for synthesis text with editing tools:
 *   - stress mark toggle (combining acute)
 *   - clear all stress marks
 *   - restore «ё» via dictionary
 *   - non-verbal tags popover
 *
 * All text mutations live in `textEditing.ts` (pure). This component only
 * binds the textarea ref and surfaces toast feedback.
 */
import { forwardRef, useCallback, useImperativeHandle, useRef } from "react";
import { Eraser, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { recoverYo, YO_DICT_SIZE } from "@/lib/ruYoRecovery";
import { COMBINING_ACUTE } from "./constants";
import { appendTag, clearAllStressMarks, insertTagAt, toggleStressAt } from "./textEditing";
import { OmniVoiceTagsPopover } from "./OmniVoiceTagsPopover";

interface Props {
  isRu: boolean;
  value: string;
  onChange: (v: string) => void;
}

export interface OmniVoiceTextEditorHandle {
  focus: () => void;
}

export const OmniVoiceTextEditor = forwardRef<OmniVoiceTextEditorHandle, Props>(
  function OmniVoiceTextEditor({ isRu, value, onChange }, ref) {
    const taRef = useRef<HTMLTextAreaElement>(null);

    useImperativeHandle(ref, () => ({
      focus: () => taRef.current?.focus(),
    }));

    const restoreCaret = useCallback((caret: number) => {
      queueMicrotask(() => {
        const ta = taRef.current;
        if (!ta) return;
        ta.focus();
        ta.setSelectionRange(caret, caret);
      });
    }, []);

    const handleStress = useCallback(() => {
      const ta = taRef.current;
      if (!ta) return;
      const start = ta.selectionStart ?? 0;
      const end = ta.selectionEnd ?? 0;
      const result = toggleStressAt(ta.value, start, end);
      if (result.action === "none") {
        toast.error(isRu
          ? "Выделите гласную или поставьте курсор после неё"
          : "Select a vowel or place cursor right after it");
        return;
      }
      onChange(result.text);
      restoreCaret(result.caret);
    }, [isRu, onChange, restoreCaret]);

    const handleClearStress = useCallback(() => {
      if (!value.includes(COMBINING_ACUTE)) {
        toast.info(isRu ? "Ударений нет" : "No stress marks");
        return;
      }
      onChange(clearAllStressMarks(value));
      toast.success(isRu ? "Все ударения сняты" : "All stress marks removed");
    }, [isRu, onChange, value]);

    const handleRestoreYo = useCallback(() => {
      const { text, replacements } = recoverYo(value);
      if (replacements === 0) {
        toast.info(isRu ? "Нечего заменять" : "Nothing to replace");
        return;
      }
      onChange(text);
      toast.success(isRu ? `Восстановлено ё: ${replacements}` : `Restored ё: ${replacements}`);
    }, [isRu, onChange, value]);

    const handleInsertTag = useCallback((tag: string) => {
      const ta = taRef.current;
      if (!ta) {
        onChange(appendTag(value, tag));
        return;
      }
      const start = ta.selectionStart ?? ta.value.length;
      const end = ta.selectionEnd ?? ta.value.length;
      const result = insertTagAt(ta.value, start, end, tag);
      onChange(result.text);
      restoreCaret(result.caret);
    }, [onChange, restoreCaret, value]);

    return (
      <div>
        <div className="flex items-center justify-between mb-1">
          <Label className="text-xs">{isRu ? "Текст для синтеза" : "Text to synthesize"}</Label>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={handleStress}
              title={isRu
                ? "Поставить ударение (◌́) после гласной. Выделите гласную или поставьте курсор сразу после неё. Повторное нажатие снимает."
                : "Add stress (◌́) after a vowel. Select a vowel or place cursor right after it. Click again to remove."}
            >
              <span className="font-mono font-bold leading-none">а́</span>
              {isRu ? "Ударение" : "Stress"}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={handleClearStress}
              disabled={!value.includes(COMBINING_ACUTE)}
              title={isRu ? "Снять все ударения" : "Remove all stress marks"}
            >
              <Eraser className="w-3 h-3" />
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={handleRestoreYo}
              disabled={!value.trim()}
              title={isRu
                ? `Восстановить «ё» по словарю (${YO_DICT_SIZE} слов)`
                : `Restore «ё» using dictionary (${YO_DICT_SIZE} words)`}
            >
              <Sparkles className="w-3 h-3" />
              {isRu ? "Восстановить ё" : "Restore ё"}
            </Button>
            <OmniVoiceTagsPopover isRu={isRu} onInsert={handleInsertTag} />
          </div>
        </div>
        <Textarea
          ref={taRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={isRu
            ? "Введите текст для озвучки... Поддерживаются теги: [laughter], [sigh] и др."
            : "Enter text to speak... Supports tags: [laughter], [sigh], etc."}
          rows={4}
          className="mt-1 text-sm"
        />
      </div>
    );
  },
);
