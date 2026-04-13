/**
 * voiceMatching — Voice matching helpers extracted from Narrators page.
 */
import { YANDEX_VOICES } from "@/config/yandexVoices";
import { SALUTESPEECH_VOICES } from "@/config/salutespeechVoices";
import { ELEVENLABS_VOICES } from "@/config/elevenlabsVoices";
import { PROXYAPI_TTS_VOICES } from "@/config/proxyapiVoices";

export function matchVoice(gender: string, ageGroup: string): string {
  const genderVoices = gender !== "unknown"
    ? YANDEX_VOICES.filter(v => v.gender === gender)
    : YANDEX_VOICES;
  if (genderVoices.length === 0) return "marina";
  const agePrefs: Record<string, Record<string, string[]>> = {
    female: {
      child: ["masha", "julia"], teen: ["masha", "lera"], young: ["dasha", "lera", "marina"],
      adult: ["alena", "jane", "marina"], elder: ["omazh", "julia"], infant: ["masha"],
    },
    male: {
      child: ["filipp"], teen: ["filipp", "anton"], young: ["anton", "alexander"],
      adult: ["kirill", "alexander", "madirus"], elder: ["zahar", "ermil"], infant: ["filipp"],
    },
  };
  const g = gender === "female" ? "female" : "male";
  const prefs = agePrefs[g]?.[ageGroup];
  if (prefs) {
    const found = prefs.find(id => genderVoices.some(v => v.id === id));
    if (found) return found;
  }
  return genderVoices[0].id;
}

export function matchRole(voiceId: string, temperament: string | null): string {
  const v = YANDEX_VOICES.find(x => x.id === voiceId);
  if (!v?.roles || v.roles.length <= 1) return "neutral";
  const tempRoleMap: Record<string, string[]> = {
    sanguine: ["good", "friendly"], choleric: ["strict", "evil"],
    melancholic: ["neutral", "whisper"], phlegmatic: ["neutral", "friendly"],
  };
  const preferred = tempRoleMap[temperament ?? ""] ?? [];
  const found = preferred.find(r => v.roles!.includes(r));
  return found ?? "neutral";
}

export const PROVIDER_LABELS: Record<string, string> = {
  yandex: "Yandex",
  salutespeech: "Salute",
  elevenlabs: "ElevenLabs",
  proxyapi: "OpenAI",
};

export function getVoiceDisplayName(provider: string | undefined, voiceId: string | undefined, isRu: boolean): string {
  if (!voiceId) return "—";
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
