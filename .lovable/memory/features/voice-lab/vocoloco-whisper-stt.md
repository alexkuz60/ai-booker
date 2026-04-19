---
name: VocoLoco Whisper STT
description: In-browser Whisper (Xenova/whisper-base FP32, ~290MB) for reference transcription. WASM backend forced + dtype:"fp32" — q8 quantized variant breaks on decoder with QDQ TransposeDQWeightsForMatMulNBits error, WebGPU breaks with Invalid buffer. Always-local, independent of TTS engine toggle.
type: feature
---

# VocoLoco Whisper STT (2026-04-19)

## Зачем
Кнопка «Распознать» в OmniVoiceCloningControls раньше ходила на
`requestBaseUrl/v1/audio/transcriptions` (OmniVoice-сервер). Если сервер
не запущен — `NetworkError`. Решение: браузерный Whisper, **всегда локально**,
независимо от выбора движка синтеза (Server/Local).

## Стек
- `@huggingface/transformers` (уже стоит для Qwen3 tokenizer).
- `pipeline("automatic-speech-recognition", "Xenova/whisper-base")`.
- **device: "wasm"** + **dtype: "fp32"** — обязательно оба.
- Кэш — Cache Storage (управляется самой transformers.js), НЕ OPFS.

## Почему именно WASM + FP32
1. **WebGPU EP не работает** — ORT-Web 1.x падает в decoder loop с
   `Failed to download data from buffer: Mapping WebGPU buffer failed: Invalid buffer`
   из `buffer_manager.cc:553` (mapAsync для динамических буферов decoder).
2. **Q8 quantized не работает на WASM** — `qdq_actions.cc:137 TransposeDQWeightsForMatMulNBits Missing required scale: model.decoder.embed_tokens.weight_merged_0_scale`. Это баг QDQ-узлов в whisper-base q8 от Xenova.
3. **FP32 на WASM работает** — это единственный гарантированно совместимый путь. ~290MB, но для разовой транскрипции референса CPU справляется за разумное время.

## Файлы
- `src/lib/vocoloco/whisperStt.ts` — `loadWhisper`, `transcribeBlob`,
  `hasWhisperCached`, `clearWhisperCache`, `releaseWhisper`.
- `src/hooks/useWhisperStt.ts` — `{ cached, downloading, progress, load, clear }`.
- `VocoLocoModelManager.tsx` — секция «Распознавание речи».
- `OmniVoiceCloningControls.tsx` — кнопка «Распознать» **всегда** через локальный Whisper.

## Action при ошибках
После любых правок dtype/device пользователь должен **очистить кэш Whisper**
в Voice Lab (иначе старая модель из IDB подгрузится снова).
