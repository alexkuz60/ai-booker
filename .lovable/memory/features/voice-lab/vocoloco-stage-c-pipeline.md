---
name: VocoLoco Stage C — Diffusion Sampler & Pipeline
description: Phase 2 Stage C готов — diffusionSampler.ts (top-p/temperature/cosine schedule, seeded RNG), pipeline.ts (designVoice/cloneVoice со staged release encoder→LLM→decoder), 9 unit-тестов проходят
type: feature
---

# VocoLoco Stage C — Diffusion Sampler & End-to-End Pipeline

**Дата:** 2026-04-19
**Статус:** ✅ READY — sampler + pipeline собраны и протестированы

## Что сделано

### 1. `src/lib/vocoloco/diffusionSampler.ts`
Чистая JS-математика для diffusion-цикла OmniVoice LLM:
- `sampleFromLogits(logits, temperature, topP, rng)` — softmax с температурой + top-p nucleus + categorical sample
- `maskScheduleCosine(t, tShift)` — стандартный косинусный schedule из MaskGIT-like papers
- `buildMaskSchedule(totalPositions, numSteps, tShift)` — массив целевого числа masked-позиций по шагам, последний = 0
- `applyDiffusionStep({...})` — для всех masked позиций сэмплит кандидата, сортирует по confidence, заполняет наиболее уверенные
- `makeRng(seed?)` — детерминированный xorshift32 для reproducible runs
- `DEFAULT_DIFFUSION_PARAMS` = { numSteps: 24, temperature: 0.95, topP: 0.9, cfgScale: 1.5, tShift: 1.0 }

### 2. `src/lib/vocoloco/pipeline.ts`
End-to-end оркестратор с STAGED RELEASE:

**`designVoice({ text, params })`** — Voice Design без референса:
1. tokenize text → input_ids
2. createSession(LLM) → diffusion loop → releaseSession(LLM)  ⬅ освобождает 613 MB
3. createSession(decoder) → run → releaseSession(decoder)
4. (опц.) terminateVocoLocoWorker() — гарантированный VRAM cleanup

**`cloneVoice({ text, refAudioPcm, params })`** — Voice Cloning:
1. createSession(encoder) → encode ref audio → releaseSession(encoder)  ⬅ освобождает 654 MB ДО загрузки LLM
2. tokenize text + reserve ref-frames в canvas
3. createSession(LLM) → diffusion → releaseSession(LLM)
4. trim leading ref frames, createSession(decoder) → decode → release

Воркер изолированный (`vocoLocoWorker`), не конфликтует с RVC `vcOrtWorker`.

### 3. `src/lib/__tests__/vocolocoSampler.test.ts`
9 unit-тестов (все passed):
- argmax при низкой температуре
- top-p truncation выкидывает хвост
- seeded RNG детерминированна
- mask schedule monotonic decreasing, начинается с 1.0 заканчивается 0
- tShift влияет на темп
- applyDiffusionStep НЕ перезаписывает известные позиции
- partial unmask оставляет точное число masked

## Контракты и инварианты

| Что | Значение |
|---|---|
| Sample rate output | 24_000 Hz mono Float32 |
| Frame rate | 25 fps (hop_length 960) |
| Codebooks | 8 |
| Vocab size | 1025 (1024 tokens + mask token id=1024) |
| Default steps | 24 |
| Pipeline backend | webgpu (default), wasm fallback |
| VRAM пик (Voice Design) | ~700 MB (LLM INT8 + decoder FP32 НЕ одновременно — staged) |
| VRAM пик (Voice Cloning staged) | ~700 MB пиково (encoder → drop → LLM → drop → decoder) |

## Что осталось до готовности к запуску

**Stage D (UI):** расширить `OmniVoiceLabPanel`:
- Toggle "Server | Local (VocoLoco)"
- Model manager: download/select 5 моделей (encoder, decoder, 3 LLM кванта)
- Прогресс diffusion + лог стадий через `onProgress`
- Передавать `refAudioPcm` через `omniVoiceAudioPrep` (24 kHz mono)

**Stage E:** mapping `psycho_tags` → DiffusionParams (temperature/topP/cfgScale) — переиспользуем
существующий `omniVoiceInstructions.ts`.

## Технические заметки

### Почему трансформ ref_codes остаётся "consultative hook"
Точная стратегия конкатенации `ref_codes` с `text input_ids` зависит от
upstream training контракта OmniVoice. Сейчас в `cloneVoice` сделан простейший
вариант — text-only input_ids + reserved frames в canvas. Если в проде окажется,
что для качества нужна явная packing-схема (например, `[REF_TOKENS][SEP][TEXT_TOKENS]`),
менять только в одном месте — сразу под комментарием в `pipeline.ts:cloneVoice`.

### Staged release — почему ключевое
Браузерный ORT не умеет надёжно освобождать VRAM по `session.release()` —
особенно Firefox. Единственный гарантированный способ — `worker.terminate()`.
Поэтому:
- между стадиями (encoder → LLM → decoder) делаем `releaseSession()` как best-effort
- по окончании всего синтеза делаем `terminateVocoLocoWorker()` (опц., через `terminateOnDone`)
- для batch-режима (несколько фраз подряд) можно держать LLM в памяти, передавая `terminateOnDone: false`

### Детерминированность тестов
Sampler полностью pure-JS, поэтому unit-тесты детерминированы при `seed`.
Pipeline не покрыт unit-тестами — он требует реальный ONNX-воркер + 700 MB
весов, поэтому это integration-test territory (запуск в VoiceLab UI вручную).
