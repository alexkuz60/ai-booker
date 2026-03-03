import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface Voice {
  id: string;
  name: string;
  description: string;
}

const VOICES: Voice[] = [
  { id: "JBFqnCBsd6RMkjVDRZzb", name: "George", description: "Warm, British male" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Sarah", description: "Soft, American female" },
  { id: "onwK4e9ZLuTAKqWW03F9", name: "Daniel", description: "Deep, authoritative male" },
  { id: "pFZP5JQG7iQjIQuC4Bku", name: "Lily", description: "Gentle, British female" },
  { id: "TX3LPaxmHKxFdv7VOQHJ", name: "Liam", description: "Young, American male" },
  { id: "Xb7hH8MSUJpSbSDYk0k2", name: "Alice", description: "Clear, British female" },
  { id: "nPczCjzI2devNBz1zQrb", name: "Brian", description: "Classic narrator male" },
  { id: "cgSgspJ2msm6clMCkdW9", name: "Jessica", description: "Friendly, American female" },
];

interface VoiceSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

export default function VoiceSelector({ value, onChange }: VoiceSelectorProps) {
  const selected = VOICES.find(v => v.id === value);

  return (
    <div className="space-y-2">
      <label className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
        Narrator Voice
      </label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="bg-secondary border-border h-12">
          <SelectValue placeholder="Choose a voice..." />
        </SelectTrigger>
        <SelectContent className="bg-card border-border">
          {VOICES.map(voice => (
            <SelectItem key={voice.id} value={voice.id} className="py-3">
              <div className="flex flex-col">
                <span className="font-medium">{voice.name}</span>
                <span className="text-xs text-muted-foreground">{voice.description}</span>
              </div>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {selected && (
        <p className="text-xs text-muted-foreground">
          Selected: {selected.name} — {selected.description}
        </p>
      )}
    </div>
  );
}
