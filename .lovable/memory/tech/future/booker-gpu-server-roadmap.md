---
name: booker-gpu-server-roadmap
description: Стратегия и спринты форка omnivoice-server → booker-gpu-server (hot-swap моделей, расширение возможностей GPU-сервера)
type: feature
---

# Booker GPU Server — Roadmap

Форк `omnivoice-server` (k2-fsa/OmniVoice + extras) превращается в универсальный GPU-сервер для всех тяжёлых моделей Booker. Один CUDA-контекст, один VRAM-пул, lazy load + LRU release. Hot-swap архитектура: подгружаем модель только когда нужна, выгружаем по таймауту неактивности.

## Целевые модели (порядок спринтов)

1. **OmniVoice** (TTS) — ✅ базовый, входит в форк
2. **DeepFilterNet3** (denoise) — Sprint 1
3. **MusicGen** (генерация музыки) — Sprint 2
4. **AudioGen** (звуковые эффекты) — Sprint 3
5. **RVC-batch** (Voice Conversion на сервере для длинных глав) — Sprint 4
6. **Whisper-large** (транскрипция) — Sprint 5
7. **Demucs/UVR5** (разделение источников) — Sprint 6

## Sprint 0 — ✅ ЗАКРЫТ (2026-04-24)

Базовый форк `~/dev/booker-gpu-server` собран и проверен на RTX A4000 (16 GB).

**Реализованные endpoints**:
- `/health` — базовый (status, model_loaded, RSS, uptime)
- `/metrics` — простой JSON (requests counters, latency p50/p95, ram_mb) — **БЕЗ GPU-полей** (это Sprint 1+ задача)
- `/v1/audio/speech` — OpenAI-compatible TTS (10+ presets: alloy, ash, ballad, coral, echo, fable, marin, nova, onyx, shimmer)
- `/v1/audio/speech/clone` — Voice Cloning (multipart: ref_audio + ref_text)
- `/v1/audio/script` — multi-speaker диалоги
- `/v1/voices` — список пресетов
- `/v1/voices/profiles` (POST/GET/DELETE/PATCH) — сохранённые VC-профили
- `/v1/models` + `/v1/models/{id}` — загруженные модели

**НЕ реализовано** (план, не код):
- `/v1/health/extended` — endpoint с GPU/VRAM/loaded_models. Запланирован на Sprint 1 вместе с DeepFilterNet hot-swap.

**Метрики Sprint 0**:
- Тесты форка: 212/212 passed (1m43s)
- Холодный старт: 7.3s (модель в VRAM ~2.2 GB)
- TTS латенси: ~1.1s на 5.76s аудио (5.2× realtime) на A4000
- VRAM в простое: ~2.97 GB; пик при синтезе: +16 MiB (граф warm)
- Output: WAV PCM 16-bit mono **24 kHz** (нативный для OmniVoice)

**Артефакт**: `/tmp/test.wav` 271 KB, 5.76s — голос чистый, без артефактов (verified).

## Sprint 1 — DeepFilterNet3 hot-swap (СЛЕДУЮЩИЙ)

Цель: первый swappable модуль. Архитектура отрабатывается на лёгкой модели (~25 MiB VRAM), потом тиражируется на тяжёлые (MusicGen, RVC).

**План (5-7 дней)**:
1. Day 1 — добавить `df` в `pyproject.toml`, smoke-тест локального enhance()
2. Day 2 — endpoint `POST /v1/audio/denoise` (multipart wav → denoised wav 48kHz mono)
3. Day 3 — singleton DfModel с lazy init + idle timeout (5 мин → release)
4. Day 4 — реализовать `/v1/health/extended` (GPU/VRAM через `pynvml` + `loaded_models[]`)
5. Day 4 — тесты: SNR улучшение ≥ 8 dB, concurrency 2× denoise + 1× TTS не падает
6. Day 5 — клиентская интеграция в Booker (denoise() в `useOmniVoiceServer.ts`, кнопка в `VoiceReferenceManager` и `VoiceConversionTab`)
7. Day 6-7 — полировка, доки, обновление этого memory

## Открытые архитектурные вопросы

- **Sample rate mismatch**: OmniVoice выдаёт 24 kHz, Booker WAV Storage Standard требует 44.1 kHz. Решение откладывается на Sprint 2 (при интеграции). Варианты:
  - A) Серверный resample (librosa/soxr) — параметр `?sample_rate=44100` в `/v1/audio/speech`
  - B) Клиентский resample через `OfflineAudioContext` (как в `omniVoiceAudioPrep.ts`)
  - C) Пересмотреть стандарт под TTS (24 kHz хватает для голоса)
  - **Текущее решение**: ресемплировать обязательно (подтверждено пользователем 2026-04-24), вариант определим позже

- **Концурренция**: `max_concurrent=2` в форке. На A4000 (16 GB) при OmniVoice (2.2 GB) + DeepFilterNet (25 MiB) + потенциально MusicGen (~3 GB) — лимит может стать узким. Пересмотр в Sprint 2.

- **GPU метрики**: добавить `gpu_vram_used_mb`, `gpu_util_pct`, `loaded_models[]` в `/metrics` ИЛИ выделить в `/v1/health/extended` (склоняемся к extended — структурированный JSON удобнее парсить из UI).
