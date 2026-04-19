---
name: VocoLoco Stage D — UI integration
description: Stage D готов — Server | Local toggle, model manager (encoder/decoder/3 LLM quants), useVocoLocoLocal hook, локальный синтез через pipeline.designVoice/cloneVoice. Tab-state (mode/preset/text/speed/ref/transcript) персистится в useCloudSettings("omnivoice-tab-state"); ref blob re-resolved из OPFS на mount; отредактированный transcript авто-сохраняется в vc-references meta через 600ms debounce. Encoder I/O contract: input_values (а не audio).
type: feature
---

# Phase 2 / Stage D — UI integration of VocoLoco into OmniVoice tab

## What shipped
- `useCloudSettings("omnivoice-engine")` хранит выбор `server` | `local`.
- `useCloudSettings("vocoloco-llm-model-id")` хранит выбранный квант (default INT8).
- `useCloudSettings("omnivoice-tab-state")` — единый persisted slice: mode, preset, instructions, synthText, speed, refPickedId, refSource, refAudioName, refTranscript. Re-resolve ref `Blob` из OPFS (`readVcReferenceBlob`) на mount, когда source = opfs/collection. Uploads не восстанавливаются (нет persisted file).
- Auto-save transcript: при правке в textarea — 600ms debounce → `updateVcReferenceMeta(refId, { transcript })`. Кнопка «💾 Сохранить» в OmniVoiceCloningControls остаётся для явного сохранения.
- `VocoLocoEngineToggle` — pill switch + бейдж готовности `cachedCount/total`.
- `VocoLocoModelManager` — менеджер 5 файлов (вынесен во вкладку Models).
- `useVocoLocoLocal` — хук-фасад: subscribes to `VOCOLOCO_MODEL_CACHE_EVENT`+`focus`, `synthesize({ mode, text, refAudioBlob, speed, advanced })`, маппинг advanced → DiffusionParams, cloneVoice декодирует Blob через `decodeBlobToMono24kFloat32`, output Float32 → 16-bit WAV.
- `OmniVoiceLabPanel` ныне роутит синтез: server → useOmniVoiceSynthesis (HTTP), local → useVocoLocoLocal (ONNX в воркере), один OmniVoiceResultCard.

## I/O contract — encoder fix (2026-04-19)
- `VOCOLOCO_IO_CONTRACT.encoder.inputs = ["input_values"]` (а не `"audio"`). Verified at runtime: gluschenko/higgs-audio-v2-tokenizer-onnx использует HF Transformers convention. `pipeline.cloneVoice` отправляет тензор `name: "input_values"`.

## Files
- `src/lib/vocoloco/wavEncoder.ts` — `encodeFloat32ToWav`, `decodeBlobToMono24kFloat32`
- `src/lib/vocoloco/modelRegistry.ts` — `VOCOLOCO_IO_CONTRACT.encoder.inputs = ["input_values"]`
- `src/lib/vocoloco/pipeline.ts` — encoder feed `name: "input_values"`
- `src/hooks/useVocoLocoLocal.ts`
- `src/components/voicelab/omnivoice/VocoLocoEngineToggle.tsx`
- `src/components/voicelab/OmniVoiceLabPanel.tsx` — persisted tabState + ref blob restore + transcript auto-save
- `src/lib/__tests__/vocolocoWavEncoder.test.ts`

## Не делалось намеренно
- Stage E (psycho_tags → DiffusionParams для локального движка) — следующий шаг.
- Прогресс по байтам и ETA в менеджере — пока минимальный hint.
