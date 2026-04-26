---
name: booker-gpu-server-roadmap
description: Стратегия и спринты форка omnivoice-server → booker-gpu-server (hot-swap моделей, расширение возможностей GPU-сервера)
type: feature
---

# Booker GPU Server — Roadmap

Форк `omnivoice-server` (k2-fsa/OmniVoice + extras) превращается в универсальный GPU-сервер для всех тяжёлых моделей Booker. Один CUDA-контекст, один VRAM-пул, lazy load + LRU release. Hot-swap архитектура: подгружаем модель только когда нужна, выгружаем по таймауту неактивности.

## Целевые модели (порядок спринтов)

1. **OmniVoice** (TTS) — ✅ базовый, входит в форк
2. **DeepFilterNet3** (denoise) — Sprint 1 (в работе)
3. **MusicGen** (генерация музыки) — Sprint 2
4. **AudioGen** (звуковые эффекты) — Sprint 3
5. **RVC-batch** (Voice Conversion на сервере для длинных глав) — Sprint 4
6. **Whisper-large** (транскрипция) — Sprint 5
7. **Demucs/UVR5** (разделение источников) — Sprint 6

## Архитектурный принцип concurrency

**Решено 2026-04-24**: DFNet НЕ параллелится с TTS. Денойз вызывается ТОЛЬКО для:
- чистки референса перед клонированием голоса (OmniVoice/RVC) — pre-processing
- чистки атмосферных звуков и SFX (Atmo Studio) — post-processing
- чистки записи с микрофона (запись референса/диктора) — pre-processing

Все три сценария — НЕ параллельны TTS-синтезу. Используется один глобальный `MODEL_LOCK = asyncio.Lock()`, гарантирующий монопольный доступ к GPU. Это упрощает архитектуру (нет batching/queueing) и даёт предсказуемые латенси.

## Sprint 0 — ✅ ЗАКРЫТ (2026-04-24)

Базовый форк `~/dev/booker-gpu-server` собран и проверен на RTX A4000 (16 GB).

**Реализованные endpoints**:
- `/health` — базовый (status, model_loaded, RSS, uptime)
- `/metrics` — простой JSON (requests counters, latency p50/p95, ram_mb)
- `/v1/audio/speech` — OpenAI-compatible TTS (10+ presets)
- `/v1/audio/speech/clone` — Voice Cloning (multipart: ref_audio + ref_text)
- `/v1/audio/script` — multi-speaker диалоги
- `/v1/voices`, `/v1/voices/profiles` — пресеты + сохранённые VC-профили
- `/v1/models` + `/v1/models/{id}` — загруженные модели

**Метрики Sprint 0**:
- Тесты форка: 212/212 passed (1m43s)
- Холодный старт: 7.3s (модель в VRAM ~2.2 GB)
- TTS латенси: ~1.1s на 5.76s аудио (5.2× realtime) на A4000
- VRAM в простое: ~2.97 GB; пик при синтезе: +16 MiB
- Output: WAV PCM 16-bit mono **24 kHz** (нативный для OmniVoice)

## Sprint 1 — DeepFilterNet3 hot-swap (В РАБОТЕ)

**Day 1 — ✅ ЗАКРЫТ (2026-04-24)**:
- Установлен Rust 1.95.0 (rustup) — нужен для сборки `deepfilterlib==0.5.6` (нет cp312 wheels на PyPI)
- `pip install deepfilternet soxr` — успешно
- Smoke-test пройден: cold start 5.7s, VRAM idle 9 MB, realtime 18.2× на A4000
- Auto-resample 24→48 kHz внутри DFNet работает

**Калибровка пресетов (на слух, 2026-04-24)**:
- `atmo_light` → `atten_lim_db=10`
- `microphone_med` → `atten_lim_db=15`
- `voice_reference_strong` → `atten_lim_db=30`

**Day 2-5 — ✅ ЗАКРЫТ + ЗАПУШЕН в origin/main (2026-04-24, commit `d7d75cb`)**:
- `omnivoice_server/locks.py` — глобальный `MODEL_LOCK = asyncio.Lock()` (монопольный GPU)
- `omnivoice_server/services/denoise.py` — singleton DenoiseService, lazy init, 5-мин idle release, 3 пресета, server-side resample через soxr
- `omnivoice_server/routers/denoise.py` — `POST /v1/audio/denoise` (multipart + query: preset, sample_rate, atten_lim_db; response headers X-Snr-Improvement-Db, X-Processing-Ms, X-Output-Sample-Rate, X-Preset-Used)
- `services/inference.py.synthesize()` — обёрнут в `async with MODEL_LOCK` (TTS speech/clone/script все защищены)
- `app.py` — denoise router зарегистрирован
- 8/8 pytest passed (`tests/test_denoise.py`): 3 пресета, unknown preset 422, resample 24kHz, atten override, empty upload, presets constant
- Скрипт автоматизации: `scripts/apply_sprint1.sh` (idempotent, проверяет существующие импорты)

**План Day 6-7 (далее)**:
- Day 6 — клиентская интеграция (`denoise()` в `useOmniVoiceServer.ts`, кнопки в `VoiceReferenceManager`, `VoiceConversionTab`, atmo-панель Studio, mic recorder)
- Day 7 — `/v1/health/extended` (GPU/VRAM через pynvml + loaded_models[]) + полировка + доки

## Sprint 1 API контракт (зафиксирован)

```
POST /v1/audio/denoise
  Content-Type: multipart/form-data
  Body: file=<wav|mp3|flac>
  Query:
    ?preset=light|med|strong          (default: med)
    ?sample_rate=48000                (default: 48000, range 16000..48000)
    ?atten_lim_db=15                  (override preset, optional)

  Response: audio/wav (PCM 16-bit mono, output sample_rate)
  Headers:
    X-Snr-Improvement-Db: float
    X-Processing-Ms: int
    X-Output-Sample-Rate: int
    X-Preset-Used: string
```

Concurrency: запрос ждёт MODEL_LOCK (TTS закончится → DFNet залочит GPU → освободит). Idle release VRAM через 5 минут.

## Открытые архитектурные вопросы

- **Sample rate mismatch**: OmniVoice выдаёт 24 kHz, Booker WAV Storage Standard требует 44.1 kHz. **Решено 2026-04-24**: добавляем query param `?sample_rate=` в `/v1/audio/speech` (default 24000 для совместимости). Реализация: server-side resample через soxr. Запланировано параллельно с Sprint 1 (общий код для denoise и speech).

- **Концурренция**: `max_concurrent=2` в форке. С глобальным MODEL_LOCK эффективно `=1`, но это OK — все наши сценарии sequential. Пересмотр в Sprint 2 (MusicGen может работать параллельно с TTS, разные модели разные слоты VRAM).

- **GPU метрики**: выделить в `/v1/health/extended` (структурированный JSON удобнее парсить из UI чем плоский /metrics).

## Стратегия референсов: LocalAI / Xinference / Booker GPU Server

**Решено 2026-04-26**: LocalAI и Xinference рассматриваются не как замена Booker GPU Server, а как инженерные референсы — источники опыта реализации рабочего кода, которыми можно вдохновляться и эпизодически цитировать архитектурные паттерны.

**Из LocalAI берём идеи**:
- единый OpenAI-compatible API;
- конфиги моделей;
- backend plugins;
- простая установка через Docker / one-click script.

**Из Xinference берём идеи**:
- registry запущенных моделей;
- GPU/VRAM-aware scheduler;
- dashboard состояния;
- ручной pin/unload моделей;
- распределение моделей по картам.

**В Booker оставляем своё**:
- строгий audio production pipeline;
- один `MODEL_LOCK` там, где нужна предсказуемость;
- hot-swap моделей;
- свои endpoints под студийные задачи;
- свой контракт качества WAV / рендеров / референсов.

**Формула**: LocalAI = пример API-шлюза; Xinference = пример оркестратора ресурсов; Booker GPU Server = специализированная аудио-рабочая станция.

**Стратегическое расширение**: Booker GPU Server должен проектироваться как универсальный audio/music GPU server для будущих совместных проектов, связанных с аудио и музыкой, а не только как инфраструктура Booker.
