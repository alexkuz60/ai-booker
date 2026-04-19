---
name: VocoLoco Whisper STT
description: In-browser Whisper (Xenova) for reference transcription. Three selectable sizes tiny/base/small (~40/80/250MB), user choice persisted via useCloudSettings("vocoloco-whisper-size"). Always-local — STT and TTS engine are independent. Transcription is one-off and not part of synthesis pipeline, so larger models are fine.
type: feature
---

# VocoLoco Whisper STT (2026-04-19)

## Зачем
Кнопка «Распознать» в OmniVoiceCloningControls раньше ходила на OmniVoice-сервер.
Если сервер не запущен — NetworkError. Решение: браузерный Whisper, **всегда
локально**, независимо от выбора движка синтеза (Server/Local). STT — разовая
операция, не участвует в пайплайне синтеза, поэтому допустимы модели покрупнее.

## Стек
- `@huggingface/transformers` (Xenova), WebGPU device.
- Три варианта с выбором в UI:
  - `Xenova/whisper-tiny`  (~40 MB)  — fastest
  - `Xenova/whisper-base`  (~80 MB)  — default, balanced
  - `Xenova/whisper-small` (~250 MB) — best quality
- Кэш — Cache Storage (каждая модель независимо).

## Файлы
- `src/lib/vocoloco/whisperStt.ts`
  - `WHISPER_VARIANTS: Record<WhisperSize, {modelId, approxBytes, label}>`
  - `getWhisperSize()` / `setWhisperSize(size)` (dispatch `WHISPER_SIZE_EVENT`)
  - `loadWhisper(onProgress, size?)` — pipelinePromises[size] coalesced
  - `transcribeBlob(blob, lang)` — всегда использует активный size
  - `hasWhisperCached(size?)`, `clearWhisperCache(size?)`, `releaseWhisper(size?)`
- `src/hooks/useWhisperStt.ts` — `{ size, setSize, cached, downloading, progress, load, clear }`.
  Подписка на `WHISPER_CACHE_EVENT` + `WHISPER_SIZE_EVENT`.
- `src/components/voicelab/omnivoice/VocoLocoModelManager.tsx` — `<Select>` для
  размера рядом с лейблом «Распознавание речи», карточка показывает текущий вариант.
- `src/components/voicelab/omnivoice/OmniVoiceCloningControls.tsx` — кнопка
  «Распознать» **всегда** идёт через локальный Whisper (deprecated `useLocalStt`).
- `src/components/voicelab/OmniVoiceLabPanel.tsx`:
  - `useCloudSettings("vocoloco-whisper-size", "base")` — персистентный выбор
  - `useEffect` применяет persisted size при монтировании / синке из облака
  - `onWhisperSizeChange` одновременно обновляет runtime (`whisper.setSize`) и облако

## UX
- Пользователь может держать в кэше несколько вариантов одновременно — размеры
  не конфликтуют, переключение `setSize` сбрасывает только RAM-пайплайны других
  размеров (cache остаётся).
- Первый клик на «Распознать» догружает активный размер (прогресс-бар в менеджере).
- `language: "ru"` форсируется при isRu, иначе auto-detect Whisper.

## Why STT/TTS engine independence
STT — разовая, офлайн, лёгкая для браузера операция. Нет смысла гонять её через
сервер только потому что TTS серверный. Symметрично — в Local TTS Whisper
работает в той же модели «всё в браузере».
