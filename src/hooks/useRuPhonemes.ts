import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface RuPhoneme {
  ipa: string;
  description: { ru: string; en: string };
  examples: string[];
  category: string;
  notes: string | null;
}

const LS_KEY = "ru-phonemes-cache";

function getCached(): RuPhoneme[] | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return JSON.parse(raw) as RuPhoneme[];
  } catch {}
  return null;
}

export function useRuPhonemes() {
  return useQuery<RuPhoneme[]>({
    queryKey: ["ru-phonemes"],
    queryFn: async () => {
      const cached = getCached();
      if (cached?.length) return cached;

      const { data, error } = await supabase
        .from("ru_phonemes")
        .select("ipa, description, examples, category, notes")
        .order("sort_order");
      if (error) throw error;
      const result = (data ?? []).map((r) => ({
        ipa: r.ipa,
        description: r.description as { ru: string; en: string },
        examples: r.examples ?? [],
        category: r.category,
        notes: r.notes,
      }));
      try { localStorage.setItem(LS_KEY, JSON.stringify(result)); } catch {}
      return result;
    },
    staleTime: Infinity,
  });
}

/** Map Cyrillic letters → possible IPA phonemes */
const LETTER_TO_IPA: Record<string, string[]> = {
  а: ["a"], о: ["o"], у: ["u"], э: ["ɛ"], и: ["i"], ы: ["ɨ"],
  е: ["je", "ɪ", "ɛ"], ё: ["jo"], ю: ["ju"], я: ["ja"],
  б: ["b", "bʲ"], в: ["v", "vʲ"], г: ["ɡ", "ɡʲ"], д: ["d", "dʲ"],
  ж: ["ʐ"], з: ["z", "zʲ"], й: ["j"], к: ["k", "kʲ"],
  л: ["l", "lʲ"], м: ["m", "mʲ"], н: ["n", "nʲ"], п: ["p", "pʲ"],
  р: ["r", "rʲ"], с: ["s", "sʲ"], т: ["t", "tʲ"], ф: ["f", "fʲ"],
  х: ["x", "xʲ"], ц: ["t͡s"], ч: ["t͡ɕ"], ш: ["ʂ"], щ: ["ɕː"],
};

export function getPhonemesForWord(word: string, phonemes: RuPhoneme[]): RuPhoneme[] {
  const lower = word.toLowerCase().replace(/[^а-яё]/g, "");
  if (!lower) return [];

  const ipaSet = new Set<string>();
  for (const ch of lower) {
    const mapped = LETTER_TO_IPA[ch];
    if (mapped) mapped.forEach((p) => ipaSet.add(p));
  }

  return phonemes.filter((p) => ipaSet.has(p.ipa));
}
