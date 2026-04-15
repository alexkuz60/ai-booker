/**
 * Build a TTS preview request from a character's voice_config.
 * Used in VoiceLab to test VC without duplicating Narrators' per-field state.
 */

import { YANDEX_VOICES } from "@/config/yandexVoices";

export function buildTtsRequestFromConfig(
  voiceConfig: Record<string, unknown>,
  isRu: boolean,
): { url: string; body: Record<string, unknown> } | null {
  const base = import.meta.env.VITE_SUPABASE_URL;
  const provider = (voiceConfig.provider as string) || "yandex";
  const voiceId = (voiceConfig.voice_id as string) || "";
  if (!voiceId) return null;

  const testText = isRu
    ? "Здравствуйте. Это предварительное прослушивание голоса для вашего персонажа."
    : "Hello. This is a voice preview for your character.";

  switch (provider) {
    case "salutespeech":
      return {
        url: `${base}/functions/v1/salutespeech-tts`,
        body: { text: testText, voice: voiceId, lang: isRu ? "ru" : "en" },
      };
    case "proxyapi": {
      const body: Record<string, unknown> = {
        text: testText,
        model: (voiceConfig.model as string) || "gpt-4o-mini-tts",
        voice: voiceId,
        speed: (voiceConfig.speed as number) ?? 1.0,
        lang: isRu ? "ru" : "en",
      };
      const instructions = voiceConfig.instructions as string | undefined;
      if (instructions && body.model === "gpt-4o-mini-tts") body.instructions = instructions;
      return { url: `${base}/functions/v1/proxyapi-tts`, body };
    }
    case "elevenlabs":
      return {
        url: `${base}/functions/v1/elevenlabs-tts`,
        body: { text: testText, voiceId, lang: isRu ? "ru" : "en" },
      };
    default: {
      // yandex
      const selectedV = YANDEX_VOICES.find(v => v.id === voiceId);
      return {
        url: `${base}/functions/v1/yandex-tts`,
        body: {
          text: testText,
          voice: voiceId,
          lang: selectedV?.lang === "en" ? "en" : "ru",
          speed: (voiceConfig.speed as number) ?? 1.0,
          role: voiceConfig.role && voiceConfig.role !== "neutral" ? voiceConfig.role : undefined,
          pitchShift: voiceConfig.pitch && voiceConfig.pitch !== 0 ? voiceConfig.pitch : undefined,
          volume: voiceConfig.volume && voiceConfig.volume !== 0 ? voiceConfig.volume : undefined,
        },
      };
    }
  }
}
