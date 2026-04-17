/**
 * OmniVoiceModeSelector — three-mode toggle (Voice Design / Cloning / Auto).
 */
import { Button } from "@/components/ui/button";
import type { SynthMode } from "./constants";

interface Props {
  isRu: boolean;
  mode: SynthMode;
  onChange: (m: SynthMode) => void;
}

export function OmniVoiceModeSelector({ isRu, mode, onChange }: Props) {
  const items: { id: SynthMode; label: string }[] = [
    { id: "design", label: isRu ? "🎨 Дизайн голоса" : "🎨 Voice Design" },
    { id: "clone",  label: isRu ? "🎙️ Клонирование" : "🎙️ Voice Clone" },
    { id: "auto",   label: isRu ? "🤖 Авто" : "🤖 Auto Voice" },
  ];
  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map((m) => (
        <Button
          key={m.id}
          variant={mode === m.id ? "default" : "outline"}
          size="sm"
          onClick={() => onChange(m.id)}
          className="text-xs"
        >
          {m.label}
        </Button>
      ))}
    </div>
  );
}
