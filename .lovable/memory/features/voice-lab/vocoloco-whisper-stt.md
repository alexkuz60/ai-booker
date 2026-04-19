---
name: VocoLoco Whisper STT
description: In-browser Whisper (Xenova/whisper-base, ~80MB) for reference transcription. Always-local — STT and TTS engine are independent. CloningControls always uses Whisper regardless of engine toggle (server/local). Manager row in VocoLocoModelManager for download/delete.
type: feature
---

# VocoLoco Whisper STT (2026-04-19)

## Зачем
Кнопка «Распознать» в OmniVoiceCloningControls раньше ходила на
`requestBaseUrl/v1/audio/transcriptions` (OmniVoice-сервер). Если сервер
не запущен — `NetworkError when attempting to fetch resource`. Решение:
браузерный Whisper, **всегда локально**, независимо от выбора движка
синтеза (Server/Local).

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
- `src/components/voicelab/omnivoice/VocoLocoModelManager.tsx` — секция
  «Распознавание речи» с download/delete и progress.
- `src/components/voicelab/omnivoice/OmniVoiceCloningControls.tsx` — кнопка
  «Распознать» **всегда** идёт через локальный Whisper. Параметр `useLocalStt`
  оставлен deprecated для совместимости (игнорируется).

## UX
- Качается лениво по кнопке "Скачать" в менеджере или при первом клике
  на «Распознать» (loadWhisper → progress callback в state).
- `language: "ru"` форсируется при isRu, иначе auto-detect Whisper.
- Ошибки идут в toast + console `[omnivoice] STT error:`.

## Why STT/TTS engine independence
Пользователь может работать в Server-режиме TTS (для качества/скорости),
но иметь референсы с офлайн-распознаванием — никакого смысла гонять STT
через сервер только потому что синтез серверный. Симметрично — в Local
TTS Whisper работает в той же модели «всё в браузере».
