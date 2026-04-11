import { useMemo } from "react";
import {
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
  ContextMenuItem, ContextMenuLabel, ContextMenuSeparator,
} from "@/components/ui/context-menu";
import { useRuPhonemes, getPhonemesForWord, type RuPhoneme } from "@/hooks/useRuPhonemes";
import { getCorrections, type PronunciationSuggestion } from "@/lib/ruPronunciationRules";

interface Props {
  selectedText: string | null;
  /** Character offset of the selected word inside the phrase text */
  wordOffset: number;
  isRu: boolean;
  onCorrect?: (suggestion: PronunciationSuggestion, wordOffset: number) => void;
}

export function PhonemeSubmenu({ selectedText, wordOffset, isRu, onCorrect }: Props) {
  const { data: allPhonemes } = useRuPhonemes();

  const word = selectedText?.trim() ?? "";
  const hasWord = !!word && /[а-яёА-ЯЁ]/.test(word);

  const matched = useMemo(() => {
    if (!hasWord || !allPhonemes?.length) return [];
    return getPhonemesForWord(word, allPhonemes);
  }, [word, hasWord, allPhonemes]);

  const corrections = useMemo(() => {
    if (!hasWord) return [];
    return getCorrections(word);
  }, [word, hasWord]);

  if (!allPhonemes?.length) return null;

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="text-xs gap-2">
        <span>🔤</span>
        {isRu ? "Фонетика" : "Phonetics"}
        {hasWord && <span className="ml-auto text-[10px] text-muted-foreground font-mono">{word}</span>}
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[16rem] max-h-[380px] overflow-y-auto">
        {/* ── Corrections section ── */}
        {hasWord && corrections.length > 0 && (
          <>
            <ContextMenuLabel className="text-[10px]">
              {isRu ? "Коррекция произношения" : "Pronunciation correction"}
            </ContextMenuLabel>
            <ContextMenuSeparator />
            {corrections.map((c, i) => (
              <ContextMenuItem
                key={`cor-${i}`}
                onClick={() => onCorrect?.(c, wordOffset)}
                className="text-xs gap-2 cursor-pointer"
              >
                <span className="font-mono font-bold text-primary shrink-0">
                  {c.original}→{c.replacement}
                </span>
                <span className="truncate text-muted-foreground">{c.label}</span>
              </ContextMenuItem>
            ))}
            <ContextMenuSeparator />
          </>
        )}

        {/* ── Phoneme reference section ── */}
        {hasWord && matched.length > 0 ? (
          <>
            <ContextMenuLabel className="text-[10px]">
              {isRu ? `Фонемы «${word}»` : `Phonemes "${word}"`}
            </ContextMenuLabel>
            <ContextMenuSeparator />
            {renderItems(matched, isRu)}
          </>
        ) : hasWord && matched.length === 0 ? (
          <ContextMenuItem disabled className="text-xs text-muted-foreground">
            {isRu ? "Фонемы не найдены" : "No phonemes found"}
          </ContextMenuItem>
        ) : (
          <>
            <ContextMenuLabel className="text-[10px]">
              {isRu ? "Выделите слово для анализа" : "Select a word to analyze"}
            </ContextMenuLabel>
            <ContextMenuSeparator />
            {renderGrouped(allPhonemes, isRu)}
          </>
        )}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}

function renderItems(items: RuPhoneme[], isRu: boolean) {
  return items.map((p) => (
    <ContextMenuItem key={p.ipa} disabled className="text-xs gap-2 py-1">
      <span className="font-mono font-bold text-primary w-8 shrink-0">{p.ipa}</span>
      <span className="truncate">{isRu ? p.description.ru : p.description.en}</span>
      {p.examples[0] && (
        <span className="ml-auto text-[10px] text-muted-foreground italic">{p.examples[0]}</span>
      )}
    </ContextMenuItem>
  ));
}

function renderGrouped(phonemes: RuPhoneme[], isRu: boolean) {
  const consonants = phonemes.filter((p) => p.category === "consonant");
  const vowels = phonemes.filter((p) => p.category === "vowel");

  return (
    <>
      {vowels.length > 0 && (
        <>
          <ContextMenuLabel className="text-[10px] text-muted-foreground">
            {isRu ? "Гласные" : "Vowels"}
          </ContextMenuLabel>
          {renderItems(vowels, isRu)}
        </>
      )}
      {consonants.length > 0 && (
        <>
          <ContextMenuSeparator />
          <ContextMenuLabel className="text-[10px] text-muted-foreground">
            {isRu ? "Согласные" : "Consonants"}
          </ContextMenuLabel>
          {renderItems(consonants, isRu)}
        </>
      )}
    </>
  );
}
