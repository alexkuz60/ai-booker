import { Quote, BookOpen, User, Brain, MessageSquare, Music, StickyNote, MessageCircle, Phone } from "lucide-react";

export const SEGMENT_TYPES = ["epigraph", "narrator", "first_person", "inner_thought", "dialogue", "monologue", "lyric", "footnote", "telephone"] as const;

export const SEGMENT_CONFIG: Record<string, {
  icon: typeof Quote;
  label_ru: string;
  label_en: string;
  color: string;
}> = {
  epigraph: { icon: Quote, label_ru: "Эпиграф", label_en: "Epigraph", color: "bg-amber-500/20 text-amber-400 border-amber-500/30" },
  narrator: { icon: BookOpen, label_ru: "Рассказчик", label_en: "Narrator", color: "bg-green-500/20 text-green-400 border-green-500/30" },
  first_person: { icon: User, label_ru: "От первого лица", label_en: "First Person", color: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30" },
  inner_thought: { icon: Brain, label_ru: "Мысли", label_en: "Thoughts", color: "bg-yellow-500/20 text-yellow-400 border-yellow-500/30" },
  dialogue: { icon: MessageSquare, label_ru: "Диалог", label_en: "Dialogue", color: "bg-blue-500/20 text-blue-400 border-blue-500/30" },
  monologue: { icon: MessageCircle, label_ru: "Монолог", label_en: "Monologue", color: "bg-indigo-500/20 text-indigo-400 border-indigo-500/30" },
  lyric: { icon: Music, label_ru: "Стих", label_en: "Verse", color: "bg-pink-500/20 text-pink-400 border-pink-500/30" },
  footnote: { icon: StickyNote, label_ru: "Сноска", label_en: "Footnote", color: "bg-muted text-muted-foreground border-border" },
  telephone: { icon: Phone, label_ru: "Телефон", label_en: "Telephone", color: "bg-orange-500/20 text-orange-400 border-orange-500/30" },
};
