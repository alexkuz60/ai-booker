// Split text into sentences using punctuation rules
export function splitPhrases(text: string): string[] {
  const raw = text.match(/[^.!?…]+[.!?…]+[")»\\]]*|[^.!?…]+$/g);
  if (!raw) return [text.trim()].filter(Boolean);
  return raw.map((s) => s.trim()).filter(Boolean);
}
