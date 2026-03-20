import { useState, useMemo } from "react";
import { Check, Volume2, Sparkles, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { YANDEX_VOICES, ROLE_LABELS } from "@/config/yandexVoices";
import { PROXYAPI_TTS_VOICES } from "@/config/proxyapiVoices";
import type { VoiceCandidate } from "@/config/psychotypeVoicePresets";

// ─── Types ──────────────────────────────────────────────

export interface CastingCharacter {
  id: string;
  name: string;
  gender: string;
  ageGroup: string;
  temperament: string | null;
  candidates: VoiceCandidate[];
}

interface CastingCandidatesPanelProps {
  characters: CastingCharacter[];
  isRu: boolean;
  onConfirm: (picks: Map<string, VoiceCandidate>) => void;
  onCancel: () => void;
}

// ─── Helpers ────────────────────────────────────────────

function getVoiceDisplayName(provider: string, voiceId: string, isRu: boolean): string {
  if (provider === "yandex") {
    const v = YANDEX_VOICES.find(x => x.id === voiceId);
    return v ? (isRu ? v.name.ru : v.name.en) : voiceId;
  }
  if (provider === "proxyapi") {
    const v = PROXYAPI_TTS_VOICES.find(x => x.id === voiceId);
    return v?.name ?? voiceId;
  }
  return voiceId;
}

function getRoleLabel(role: string | undefined, isRu: boolean): string | null {
  if (!role || role === "neutral") return null;
  return ROLE_LABELS[role]?.[isRu ? "ru" : "en"] ?? role;
}

const PROVIDER_LABELS: Record<string, string> = {
  yandex: "Yandex",
  salutespeech: "Salute",
  elevenlabs: "ElevenLabs",
  proxyapi: "OpenAI",
};

const REASON_LABELS: Record<string, { ru: string; en: string }> = {
  archetype: { ru: "по архетипу", en: "by archetype" },
  age: { ru: "по возрасту", en: "by age" },
  gender: { ru: "по полу", en: "by gender" },
};

function reasonLabel(reason: string, isRu: boolean): string {
  const [key] = reason.split(":");
  return REASON_LABELS[key]?.[isRu ? "ru" : "en"] ?? reason;
}

// ─── Component ──────────────────────────────────────────

export function CastingCandidatesPanel({
  characters,
  isRu,
  onConfirm,
  onCancel,
}: CastingCandidatesPanelProps) {
  // picks: charId → selected candidate index
  const [picks, setPicks] = useState<Map<string, number>>(() => {
    const m = new Map<string, number>();
    for (const ch of characters) {
      m.set(ch.id, 0); // default: first (highest score)
    }
    return m;
  });

  const handlePick = (charId: string, idx: number) => {
    setPicks(prev => new Map(prev).set(charId, idx));
  };

  const handleConfirm = () => {
    const result = new Map<string, VoiceCandidate>();
    for (const ch of characters) {
      const idx = picks.get(ch.id) ?? 0;
      const candidate = ch.candidates[idx];
      if (candidate) result.set(ch.id, candidate);
    }
    onConfirm(result);
  };

  const totalChars = characters.length;
  const hasPsychoData = characters.some(ch =>
    ch.candidates.some(c => c.reason.startsWith("archetype:"))
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-3 border-b border-border flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">
            {isRu ? "Кастинг голосов" : "Voice Casting"}
          </span>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {totalChars}
          </Badge>
        </div>
        <div className="flex items-center gap-1.5">
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1" onClick={onCancel}>
            <X className="h-3 w-3" />
            {isRu ? "Отмена" : "Cancel"}
          </Button>
          <Button size="sm" className="h-7 text-xs gap-1" onClick={handleConfirm}>
            <Check className="h-3 w-3" />
            {isRu ? "Применить" : "Apply"}
          </Button>
        </div>
      </div>

      {hasPsychoData && (
        <div className="px-3 py-1.5 bg-violet-500/5 border-b border-violet-500/10">
          <span className="text-[10px] text-violet-400">
            🎭 {isRu
              ? "Голоса подобраны с учётом психотипа персонажей"
              : "Voices matched using character psychotype data"}
          </span>
        </div>
      )}

      {/* Character list */}
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-2">
          {characters.map(ch => (
            <CharacterCandidateRow
              key={ch.id}
              character={ch}
              selectedIdx={picks.get(ch.id) ?? 0}
              onPick={(idx) => handlePick(ch.id, idx)}
              isRu={isRu}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

// ─── Per-character row ──────────────────────────────────

function CharacterCandidateRow({
  character,
  selectedIdx,
  onPick,
  isRu,
}: {
  character: CastingCharacter;
  selectedIdx: number;
  onPick: (idx: number) => void;
  isRu: boolean;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/50 overflow-hidden">
      {/* Character header */}
      <div className="px-3 py-2 bg-muted/30 flex items-center gap-2">
        <span className="text-sm font-medium text-foreground">{character.name}</span>
        {character.gender !== "unknown" && (
          <span className="text-[10px] text-muted-foreground/60">
            {character.gender === "female" ? "♀" : "♂"}
          </span>
        )}
      </div>
      {/* Candidates */}
      <div className="p-1.5 space-y-0.5">
        {character.candidates.map((c, i) => {
          const isSelected = selectedIdx === i;
          const voiceName = getVoiceDisplayName(c.provider, c.voiceId, isRu);
          const roleText = getRoleLabel(c.role, isRu);
          return (
            <button
              key={`${c.provider}-${c.voiceId}`}
              onClick={() => onPick(i)}
              className={`w-full text-left px-3 py-2 rounded-md text-xs transition-colors flex items-center gap-2 ${
                isSelected
                  ? "bg-primary/10 ring-1 ring-primary/30 text-foreground"
                  : "text-muted-foreground hover:bg-muted/50"
              }`}
            >
              {isSelected ? (
                <Check className="h-3.5 w-3.5 text-primary shrink-0" />
              ) : (
                <Volume2 className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="font-medium">{voiceName}</span>
                  <Badge variant="secondary" className="text-[9px] px-1 py-0">
                    {PROVIDER_LABELS[c.provider] ?? c.provider}
                  </Badge>
                  {roleText && (
                    <Badge variant="outline" className="text-[9px] px-1 py-0">
                      {roleText}
                    </Badge>
                  )}
                </div>
                <span className="text-[10px] text-muted-foreground/50">
                  {reasonLabel(c.reason, isRu)} · {isRu ? "совпадение" : "match"}: {c.score}%
                </span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
