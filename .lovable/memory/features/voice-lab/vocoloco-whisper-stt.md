---
name: VocoLoco Whisper STT
description: In-browser Whisper (Xenova/whisper-base, ~80MB) for reference transcription in Local engine. Uses @huggingface/transformers, IDB-cached, exposed via useWhisperStt + VocoLocoModelManager Whisper row. CloningControls.useLocalStt routes between local Whisper and server /v1/audio/transcriptions.
type: feature
---

# VocoLoco Whisper STT (2026-04-19)

## Зачем
В Local-режиме (VocoLoco) кнопка «Распознать» в OmniVoiceCloningControls
ходила на `requestBaseUrl/v1/audio/transcriptions` (OmniVoice-сервер). Если
сервер не запущен — `NetworkError when attempting to fetch resource`.
Решение: браузерный Whisper.

## Стек
- `@huggingface/transformers` (уже стоит для Qwen3 tokenizer).
- `pipeline("automatic-speech-recognition", "Xenova/whisper-base")`.
- WebGPU device, fallback на WASM делает сама transformers.js.
- Кэш — Cache Storage (управляется самой transformers.js), НЕ OPFS.

## Файлы
- `src/lib/vocoloco/whisperStt.ts` — `loadWhisper(onProgress)`, `transcribeBlob(blob, lang)`,
  `hasWhisperCached()`, `clearWhisperCache()`, `releaseWhisper()`.
  Декодирование через WebAudio → mono → линейный resample 16 kHz.
- `src/hooks/useWhisperStt.ts` — `{ cached, downloading, progress, load, clear }`.
  Подписка на `WHISPER_CACHE_EVENT` для авто-refresh.
- `src/components/voicelab/omnivoice/VocoLocoModelManager.tsx` — отдельная
  секция «Распознавание речи» с download/delete и progress.
- `src/components/voicelab/omnivoice/OmniVoiceCloningControls.tsx` — prop
  `useLocalStt`: true → in-browser, false → server.
- `src/components/voicelab/OmniVoiceLabPanel.tsx` — `const whisper = useWhisperStt()`,
  пропсы в Manager + `useLocalStt={isLocal}` в Cloning.

## UX
- Качается лениво по кнопке "Скачать" в менеджере или при первом клике
  на «Распознать» (loadWhisper → progress callback в state).
- `language: "ru"` форсируется при isRu, иначе auto-detect Whisper.
- Ошибки идут в toast + console `[omnivoice] STT error:`.
