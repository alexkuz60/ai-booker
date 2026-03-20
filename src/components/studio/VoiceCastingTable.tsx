import { useState, useMemo } from "react";
import { Volume2, ChevronDown, ChevronRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ScrollArea } from "@/components/ui/scroll-area";
import { YANDEX_VOICES, ROLE_LABELS } from "@/config/yandexVoices";
import { ELEVENLABS_VOICES } from "@/config/elevenlabsVoices";
import { SALUTESPEECH_VOICES } from "@/config/salutespeechVoices";
import { PROXYAPI_TTS_VOICES, PROXYAPI_TTS_MODELS } from "@/config/proxyapiVoices";

// ─── Types ──────────────────────────────────────────────

interface BookCharacter {
  id: string;
  name: string;
  gender: string;
  age_group: string;
  temperament: string | null;
  voice_config: {
    provider?: string;
    voice_id?: string;
    role?: string;
    speed?: number;
    pitch?: number;
    volume?: number;
    is_extra?: boolean;
    model?: string;
    instructions?: string;
    stability?: number;
    similarity_boost?: number;
    style?: number;
  };
}

interface VoiceCastingTableProps {
  characters: BookCharacter[];
  isRu: boolean;
  selectedCharacterId?: string | null;
  onSelectCharacter?: (id: string | null) => void;
  filterMode?: "all" | "scene" | "chapter";
  sceneCharIds?: Set<string>;
}

// ─── Helpers ──────────────────────────────────────────────

const PROVIDER_LABELS: Record<string, string> = {
  yandex: "Yandex",
  salutespeech: "Salute",
  elevenlabs: "ElevenLabs",
  proxyapi: "OpenAI",
};

function getVoiceName(provider: string | undefined, voiceId: string | undefined, isRu: boolean): string {
  if (!voiceId) return isRu ? "—" : "—";
  switch (provider) {
    case "yandex": {
      const v = YANDEX_VOICES.find(x => x.id === voiceId);
      return v ? (isRu ? v.name.ru : v.name.en) : voiceId;
    }
    case "salutespeech": {
      const v = SALUTESPEECH_VOICES.find(x => x.id === voiceId);
      return v ? (isRu ? v.name.ru : v.name.en) : voiceId;
    }
    case "elevenlabs": {
      const v = ELEVENLABS_VOICES.find(x => x.id === voiceId);
      return v?.name ?? voiceId;
    }
    case "proxyapi": {
      const v = PROXYAPI_TTS_VOICES.find(x => x.id === voiceId);
      return v?.name ?? voiceId;
    }
    default:
      return voiceId;
  }
}

function getProviderDetails(vc: BookCharacter["voice_config"], isRu: boolean): string[] {
  const details: string[] = [];
  const provider = vc.provider || "yandex";

  if (vc.speed && vc.speed !== 1.0) details.push(`${isRu ? "Скор." : "Spd"}: ${vc.speed.toFixed(1)}×`);

  switch (provider) {
    case "yandex":
      if (vc.role && vc.role !== "neutral") {
        const label = ROLE_LABELS[vc.role]?.[isRu ? "ru" : "en"] ?? vc.role;
        details.push(`${isRu ? "Амплуа" : "Role"}: ${label}`);
      }
      if (vc.pitch && vc.pitch !== 0) details.push(`Pitch: ${vc.pitch > 0 ? "+" : ""}${vc.pitch} Hz`);
      if (vc.volume && vc.volume !== 0) details.push(`Vol: ${vc.volume > 0 ? "+" : ""}${vc.volume} dB`);
      break;
    case "elevenlabs":
      if (vc.stability !== undefined) details.push(`${isRu ? "Стаб." : "Stab."}: ${(vc.stability * 100).toFixed(0)}%`);
      if (vc.similarity_boost !== undefined) details.push(`${isRu ? "Схож." : "Sim."}: ${(vc.similarity_boost * 100).toFixed(0)}%`);
      if (vc.style !== undefined) details.push(`${isRu ? "Стиль" : "Style"}: ${(vc.style * 100).toFixed(0)}%`);
      break;
    case "proxyapi": {
      const model = PROXYAPI_TTS_MODELS.find(m => m.id === vc.model);
      if (model) details.push(`${isRu ? "Модель" : "Model"}: ${model.name}`);
      if (vc.instructions) details.push(`${isRu ? "Инструкции" : "Instr."}: "${vc.instructions.slice(0, 40)}${vc.instructions.length > 40 ? "…" : ""}"`);
      break;
    }
    // salutespeech has no extra settings beyond speed
  }
  return details;
}

// ─── Component ──────────────────────────────────────────────

export function VoiceCastingTable({
  characters,
  isRu,
  selectedCharacterId,
  onSelectCharacter,
}: VoiceCastingTableProps) {
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());

  const toggleExpand = (id: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const sortedChars = useMemo(() => {
    return [...characters].sort((a, b) => a.name.localeCompare(b.name));
  }, [characters]);

  if (characters.length === 0) {
    return (
      <div className="flex items-center justify-center h-32 text-muted-foreground text-sm">
        {isRu ? "Нет персонажей" : "No characters"}
      </div>
    );
  }

  return (
    <ScrollArea className="h-full">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead className="text-xs">{isRu ? "Персонаж" : "Character"}</TableHead>
            <TableHead className="text-xs">{isRu ? "Провайдер" : "Provider"}</TableHead>
            <TableHead className="text-xs">{isRu ? "Голос" : "Voice"}</TableHead>
            <TableHead className="text-xs w-8"></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sortedChars.map(ch => {
            const vc = ch.voice_config || {};
            const provider = vc.provider || "yandex";
            const hasVoice = !!vc.voice_id;
            const isExpanded = expandedIds.has(ch.id);
            const isSelected = selectedCharacterId === ch.id;
            const details = hasVoice ? getProviderDetails(vc, isRu) : [];

            return (
              <>
                <TableRow
                  key={ch.id}
                  className={`cursor-pointer transition-colors ${
                    isSelected ? "bg-accent/15" : ""
                  }`}
                  onClick={() => onSelectCharacter?.(isSelected ? null : ch.id)}
                >
                  <TableCell className="p-2 w-8">
                    {hasVoice && details.length > 0 && (
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleExpand(ch.id); }}
                        className="p-0.5 rounded hover:bg-muted"
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3 w-3 text-muted-foreground" />
                          : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                      </button>
                    )}
                  </TableCell>
                  <TableCell className="p-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-sm font-medium truncate">{ch.name}</span>
                      {ch.gender !== "unknown" && (
                        <span className="text-[10px] text-muted-foreground/60">
                          {ch.gender === "female" ? "♀" : "♂"}
                        </span>
                      )}
                      {vc.is_extra && (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 border-dashed">
                          {isRu ? "массовка" : "extra"}
                        </Badge>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="p-2">
                    {hasVoice ? (
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                        {PROVIDER_LABELS[provider] ?? provider}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground/40">—</span>
                    )}
                  </TableCell>
                  <TableCell className="p-2">
                    <span className="text-xs">
                      {getVoiceName(provider, vc.voice_id, isRu)}
                    </span>
                  </TableCell>
                  <TableCell className="p-2 w-8">
                    {hasVoice && <Volume2 className="h-3 w-3 text-primary/60" />}
                  </TableCell>
                </TableRow>
                {isExpanded && details.length > 0 && (
                  <TableRow key={`${ch.id}-details`} className="bg-muted/20 hover:bg-muted/30">
                    <TableCell className="p-0" />
                    <TableCell colSpan={4} className="p-2 pl-4">
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {details.map((d, i) => (
                          <span key={i} className="text-[11px] text-muted-foreground">{d}</span>
                        ))}
                      </div>
                    </TableCell>
                  </TableRow>
                )}
              </>
            );
          })}
        </TableBody>
      </Table>
    </ScrollArea>
  );
}
