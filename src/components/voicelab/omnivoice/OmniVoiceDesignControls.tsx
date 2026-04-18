/**
 * OmniVoiceDesignControls — preset + free-form instructions + character auto-fill.
 */
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CharacterAutoFillSection } from "@/components/voicelab/CharacterAutoFillSection";
import { OPENAI_PRESETS } from "./constants";
import type { CharacterIndex } from "@/pages/parser/types";

interface Props {
  isRu: boolean;
  preset: string;
  onPresetChange: (p: string) => void;
  instructions: string;
  onInstructionsChange: (v: string) => void;
  /** Phase 2: bubble up character pick so the panel can derive Advanced params. */
  onCharacterPicked?: (character: CharacterIndex) => void;
}

export function OmniVoiceDesignControls({
  isRu, preset, onPresetChange, instructions, onInstructionsChange, onCharacterPicked,
}: Props) {
  return (
    <div className="space-y-3">
      <div>
        <Label className="text-xs">{isRu ? "Пресет (OpenAI-совместимый)" : "Preset (OpenAI-compatible)"}</Label>
        <Select value={preset} onValueChange={onPresetChange}>
          <SelectTrigger className="mt-1">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPENAI_PRESETS.map((p) => (
              <SelectItem key={p} value={p}>{p}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label className="text-xs">
          {isRu ? "Инструкции (переопределяет пресет)" : "Instructions (overrides preset)"}
        </Label>
        <Textarea
          value={instructions}
          onChange={(e) => onInstructionsChange(e.target.value)}
          placeholder="female, young adult, high pitch, british accent"
          rows={3}
          className="mt-1 text-sm font-mono"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {isRu
            ? "Свободная форма на английском. Можно собрать автоматически из профиля персонажа ниже."
            : "Free-form English. Can be auto-filled from a character profile below."}
        </p>
      </div>
      <CharacterAutoFillSection
        isRu={isRu}
        onApply={onInstructionsChange}
        onCharacterPicked={onCharacterPicked}
      />
    </div>
  );
}
