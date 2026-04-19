---
name: VocoLoco Stage D — UI integration
description: Stage D готов — Server | Local toggle, model manager (encoder/decoder/3 LLM quants), useVocoLocoLocal hook, локальный синтез через pipeline.designVoice/cloneVoice. Сохраняется выбор движка и кванта через useCloudSettings. Auto в локальном режиме = Voice Design. Mode `clone` декодирует Blob → mono 24k Float32 на лету.
type: feature
---

# Phase 2 / Stage D — UI integration of VocoLoco into OmniVoice tab

## What shipped
- `useCloudSettings("omnivoice-engine")` хранит выбор `server` | `local`.
- `useCloudSettings("vocoloco-llm-model-id")` хранит выбранный квант (default INT8).
- `VocoLocoEngineToggle` — pill switch + бейдж готовности `cachedCount/total`.
- `VocoLocoModelManager` — менеджер 5 файлов:
  - decoder (всегда нужен) + encoder (только для cloning) + один из 3 LLM-вариантов
  - per-row download/delete + общий progress + cancel
  - select для смены кванта без перезагрузки страницы
- `useVocoLocoLocal` — хук-фасад:
  - подписка на `VOCOLOCO_MODEL_CACHE_EVENT` + `focus` (как в Booker Pro)
  - `synthesize({ mode, text, refAudioBlob, speed, advanced })`
  - маппинг advanced → `DiffusionParams` (numSteps, temperature, topP, cfgScale, tShift)
  - cloneVoice → внутренне декодирует Blob через `decodeBlobToMono24kFloat32`
  - выходной Float32 → 16-bit PCM WAV через `encodeFloat32ToWav` → blob URL
- `OmniVoiceLabPanel` ныне роутит синтез:
  - `engine === "server"` → старый `useOmniVoiceSynthesis` (HTTP)
  - `engine === "local"` → `useVocoLocoLocal` (ONNX в воркере)
  - один `OmniVoiceResultCard` с унифицированными хендлерами
  - locale-aware live progress hint под Advanced (`stage · stageMessage · %`)

## Files
- `src/lib/vocoloco/wavEncoder.ts` — `encodeFloat32ToWav`, `decodeBlobToMono24kFloat32`
- `src/hooks/useVocoLocoLocal.ts`
- `src/components/voicelab/omnivoice/VocoLocoEngineToggle.tsx`
- `src/components/voicelab/omnivoice/VocoLocoModelManager.tsx`
- `src/components/voicelab/OmniVoiceLabPanel.tsx` (extended)
- `src/lib/__tests__/vocolocoWavEncoder.test.ts`

## Не делалось намеренно
- Stage E (psycho_tags → DiffusionParams для локального движка) — следующий шаг.
- Прогресс по байтам и ETA в менеджере — пока минимальный hint, тонкая полировка позже.
