import { useMemo } from "react";
import {
  ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent,
  ContextMenuItem, ContextMenuLabel, ContextMenuSeparator,
} from "@/components/ui/context-menu";

const RU_VOWELS = new Set("аеёиоуыэюяАЕЁИОУЫЭЮЯ");
const COMBINING_ACUTE = "\u0301";

interface VowelInfo {
  char: string;
  /** index within the full phrase text */
  phraseIndex: number;
  /** 1-based position within the word */
  posInWord: number;
  /** already has acute accent */
  hasAccent: boolean;
}

interface Props {
  /** The selected word text */
  selectedText: string | null;
  /** Character offset of the selection start inside the phrase text */
  wordOffset: number;
  /** Full phrase text */
  phraseText: string;
  isRu: boolean;
  onApplyStress: (newText: string) => void;
}

export function StressVowelSubmenu({ selectedText, wordOffset, phraseText, isRu, onApplyStress }: Props) {
  const word = selectedText?.trim() ?? "";
  const hasWord = !!word && /[а-яёА-ЯЁ]/i.test(word);

  const vowels = useMemo<VowelInfo[]>(() => {
    if (!hasWord) return [];
    const result: VowelInfo[] = [];
    let vowelNum = 0;
    for (let i = 0; i < word.length; i++) {
      // skip combining accents
      if (word[i] === COMBINING_ACUTE) continue;
      if (RU_VOWELS.has(word[i])) {
        vowelNum++;
        const hasAccent = i + 1 < word.length && word[i + 1] === COMBINING_ACUTE;
        result.push({
          char: word[i],
          phraseIndex: wordOffset + i,
          posInWord: vowelNum,
          hasAccent,
        });
      }
    }
    return result;
  }, [word, wordOffset, hasWord]);

  const handleClick = (v: VowelInfo) => {
    // First remove all existing acute accents from this word in phrase text
    let text = phraseText;
    // Work backwards through vowels to not shift indices
    const accentedVowels = vowels.filter(x => x.hasAccent).sort((a, b) => b.phraseIndex - a.phraseIndex);
    for (const av of accentedVowels) {
      const accentIdx = av.phraseIndex + 1;
      if (accentIdx < text.length && text[accentIdx] === COMBINING_ACUTE) {
        text = text.slice(0, accentIdx) + text.slice(accentIdx + 1);
      }
    }

    // Recalculate target index after removals
    let targetIdx = v.phraseIndex;
    for (const av of accentedVowels) {
      if (av.phraseIndex < v.phraseIndex) {
        targetIdx--; // one accent char was removed before our position
      }
    }

    // If clicked vowel already had accent, we just removed it — done
    if (v.hasAccent) {
      onApplyStress(text);
      return;
    }

    // Insert acute accent after the vowel
    text = text.slice(0, targetIdx + 1) + COMBINING_ACUTE + text.slice(targetIdx + 1);
    onApplyStress(text);
  };

  if (!hasWord || vowels.length === 0) {
    return (
      <ContextMenuSub>
        <ContextMenuSubTrigger className="text-xs gap-2">
          <span>◌́</span>
          {isRu ? "Ударение" : "Stress"}
        </ContextMenuSubTrigger>
        <ContextMenuSubContent className="min-w-[10rem]">
          <ContextMenuItem disabled className="text-xs text-muted-foreground">
            {isRu ? "Выделите слово" : "Select a word"}
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
    );
  }

  // Build word display with highlighted vowels
  const wordDisplay = word.replace(new RegExp(COMBINING_ACUTE, "g"), "");

  return (
    <ContextMenuSub>
      <ContextMenuSubTrigger className="text-xs gap-2">
        <span>◌́</span>
        {isRu ? "Ударение" : "Stress"}
        <span className="ml-auto text-[10px] text-muted-foreground font-mono">{wordDisplay}</span>
      </ContextMenuSubTrigger>
      <ContextMenuSubContent className="min-w-[10rem]">
        <ContextMenuLabel className="text-[10px]">
          {isRu ? "Выберите гласную" : "Pick a vowel"}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        {vowels.map((v, i) => (
          <ContextMenuItem
            key={i}
            onClick={() => handleClick(v)}
            className="text-xs gap-2 cursor-pointer"
          >
            <span className={`font-mono font-bold text-lg ${v.hasAccent ? "text-primary" : "text-foreground"}`}>
              {v.char}{v.hasAccent ? COMBINING_ACUTE : ""}
            </span>
            <span className="text-muted-foreground text-[10px]">
              {isRu ? `гласная ${v.posInWord}` : `vowel ${v.posInWord}`}
            </span>
            {v.hasAccent && (
              <span className="ml-auto text-[10px] text-primary">✓</span>
            )}
          </ContextMenuItem>
        ))}
      </ContextMenuSubContent>
    </ContextMenuSub>
  );
}
