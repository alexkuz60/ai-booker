# VocoLoco — Feasibility Study (Phase 1)

> Цель документа: оценить, реально ли запустить **k2-fsa/OmniVoice v0.1.4** в браузере через ONNX Runtime Web + WebGPU, на нашей текущей инфраструктуре (Booker Pro / vcOrtWorker / OPFS cache).
> Дата: 2026-04-18. Решение: **Conditional Go** (см. секцию 7).

---

## 1. Что такое OmniVoice (важно знать ДО начала)

| Параметр | Значение | Источник |
|---|---|---|
| Лицензия | Apache-2.0 | github.com/k2-fsa/OmniVoice |
| Архитектура | Discrete masked diffusion (NAR), single-stage | arXiv 2604.00688 |
| LLM backbone | **Qwen3-0.6B** (init weights), 28 layers, hidden=1024, heads=16, vocab=151676 | HF `config.json` |
| Acoustic tokenizer | **Higgs-audio-v2** (bosonai), 8 codebooks, 25 fps, 24 kHz | `audio_tokenizer/` subfolder + bosonai HF |
| Кол-во параметров | ~0.8B (по issue в sherpa-onnx) | sherpa-onnx#3486 |
| Размер весов FP32 | **2.45 GB** (`model.safetensors`) + tokenizer (отдельно) | HF tree |
| Размер tokenizer.json | 11.4 MB (text tokenizer Qwen3) | HF tree |
| RTF (GPU CUDA) | 0.025 (40× realtime) | README |
| Sample rate | 24 kHz mono | README |
| Языков | 600+ | README |
| Voice cloning | через `ref_audio` + `ref_text` (или Whisper auto-ASR) | README |
| Voice design | свободный текст-инструкция (gender/age/pitch/accent/style) | README |
| Non-verbal tags | `[laughter]`, `[sigh]`, `[question-*]`, `[surprise-*]`... | README |

### 1.1 Ключевое отличие от того, что мы предполагали в плане

В нашем `plan.md` была фраза *"flow-matching transformer + vocoder"*. **Это неверно.**

OmniVoice — это **discrete masked diffusion language model**, то есть:
- Один большой Transformer (Qwen3-0.6B), а **не** три отдельных подмодели (encoder/transformer/vocoder).
- Выход — **acoustic tokens** (8-codebook матрица), а не mel-spectrogram.
- "Vocoder" в нашем понимании отсутствует — за обратное преобразование `tokens → waveform` отвечает **decoder Higgs-audio tokenizer**.

Это меняет дизайн нашего ORT-пайплайна (см. секцию 4).

---

## 2. Состав файлов на Hugging Face

```
k2-fsa/OmniVoice/
├── config.json                    2.24 KB   — описание архитектуры
├── chat_template.jinja            4.17 KB   — шаблон промпта (instruct/transcript)
├── tokenizer.json                 11.4 MB   — text tokenizer (Qwen3 BPE)
├── tokenizer_config.json          ~5 KB
├── model.safetensors              2.45 GB   — единый файл с весами всего LLM+codebook embeddings
├── audio_tokenizer/               (отдельная подпапка)
│   ├── config.json
│   ├── model.safetensors          ~200-400 MB (Higgs-audio-v2 encoder+decoder)
│   └── ... (специфика Higgs)
└── LICENSE                        Apache-2.0
```

**Важно**: в текущей раскладке **нет ONNX-файлов**. Чтобы получить ONNX, нужен экспорт через `optimum-cli export onnx` или ручной `torch.onnx.export`.

---

## 3. ONNX-готовность модели

| Аспект | Оценка | Комментарий |
|---|---|---|
| **Официальный ONNX export** | ❌ Нет | Issue #3 закрыт автором (zhu-han): *"keep as future plan, may not be able to get this done quickly"* |
| **TensorRT export** | ❌ Нет | Issue #18 закрыт без решения |
| **sherpa-onnx integration** | ❌ Закрыт | Автор треда: *"apparently too big to edge use case"* |
| **Qwen3 → ONNX** | ✅ Поддерживается | HuggingFace Optimum поддерживает Qwen3ForCausalLM |
| **Higgs-audio-v2 → ONNX** | ⚠ Не подтверждён | Похожий MOSS-Audio-Tokenizer-ONNX существует — техника применима, но конкретно для Higgs экспорт нужно делать самим |
| **Кастомный `OmniVoice` wrapper class** | ⚠ Сложность | Нужно либо разбить на (a) text-embed → (b) Qwen3 LLM (autoreg/diffusion loop) → (c) audio decoder, либо экспортировать end-to-end граф через `torch.onnx.export` с трассировкой diffusion-loop |

### Вывод по ONNX
**Нам придётся самим делать ONNX-экспорт.** Это отдельная подзадача (Phase 1.5), которую нельзя обойти. Без неё в браузере запустить нечего.

---

## 4. Предлагаемая декомпозиция на ONNX-сессии

```
                    ┌─────────────────────────────────┐
                    │ 1. Text tokenizer (BPE, JS)    │  ~50 ms, CPU
                    └────────────────┬────────────────┘
                                     ▼
                    ┌─────────────────────────────────┐
                    │ 2. Audio tokenizer ENCODER      │  для cloning: ref_audio → 8 codebooks
                    │    (Higgs-audio-v2 encoder)     │  ~50-200 MB ONNX
                    └────────────────┬────────────────┘
                                     ▼
        ┌───────────────────────────────────────────────────────┐
        │ 3. OmniVoice main LLM (Qwen3-0.6B + codebook heads)   │
        │    Diffusion loop: num_step итераций (16 или 32)      │
        │    На каждом шаге: forward pass через Transformer     │
        │    Размер ONNX FP16: ~1.6 GB,  INT8: ~800 MB          │
        │    ► Большая часть VRAM именно здесь                  │
        └────────────────┬──────────────────────────────────────┘
                         ▼ (acoustic tokens 8×T)
                    ┌─────────────────────────────────┐
                    │ 4. Audio tokenizer DECODER      │  tokens → waveform 24 kHz
                    │    (Higgs-audio-v2 decoder)     │  ~100-200 MB ONNX
                    └────────────────┬────────────────┘
                                     ▼
                              Float32Array (24 kHz mono)
                                     │
                                     ▼ (преобразование 24k → 44.1k mono int16)
                                  WAV в OPFS
```

### Staged release (как у RVC)
1. После шага 2 (если cloning) → освобождаем encoder.
2. Между шагами 3 и 4 → освобождаем main LLM.
3. После шага 4 → освобождаем decoder.

Это критично, потому что одновременно `LLM (1.6 GB) + encoder + decoder` не уместятся в 4 GB VRAM.

---

## 5. VRAM-бюджет (прогноз)

| GPU | maxBufferSize* | Сценарий | Вердикт |
|---|---|---|---|
| Iris Xe / встройка | ~1-2 GB | Не подходит даже для INT8 | ❌ Только Remote |
| GTX 1660 / RTX 3050 (4 GB) | ~3-3.5 GB | INT8 + staged release: на грани | ⚠ Только при INT8 |
| RTX 3060 / 4060 (8 GB) | ~6-7 GB | FP16 + staged release | ✅ Comfortable |
| RTX 3090 / 4090 (24 GB) | ~16-20 GB | FP16, всё одновременно | ✅ Лучший вариант |
| Apple M-series (8-16 GB shared) | зависит от Metal/WebGPU | INT8 рекомендуется | ⚠ Нужны замеры |

*WebGPU обычно отдаёт 50-75% физического VRAM через `requiredLimits.maxBufferSize`.

### Сравнение с тем, что у нас уже бегает (RVC):
- ContentVec (175 MB) + RVC v2 (~250 MB) + CREPE Tiny (~25 MB) ≈ 450 MB — комфортно даже на 4 GB.
- OmniVoice INT8 ≈ **800 MB только LLM** — это **2× от всего нашего текущего RVC-стека**.

---

## 6. Альтернативы и их трейдоффы

| Вариант | Размер | Качество | Cloning | 600+ языков | Готовность ONNX | Browser-ready |
|---|---|---|---|---|---|---|
| **OmniVoice (наш кандидат)** | 800 MB INT8 | ⭐⭐⭐⭐⭐ | ✅ | ✅ | ❌ нужен export | ⚠ при INT8 + 6+ GB GPU |
| **Kokoro-82M** | 80 MB | ⭐⭐⭐⭐ | ❌ | EN/JA/ZH/ES/HI/IT/PT/FR | ✅ официальный | ✅ работает (`kokoro-js`) |
| **Kitten TTS (15M/40M/80M)** | 15-80 MB | ⭐⭐⭐ | ❌ | EN | ✅ официальный | ✅ работает |
| **F5-TTS** (у нас уже есть код) | ~1 GB | ⭐⭐⭐⭐ | ✅ | EN/ZH (RU экспериментально) | ⚠ есть community ONNX | ⚠ требует доработки |

**Стратегический вывод**:
- OmniVoice — реально SOTA по качеству и охвату языков, но это **самая тяжёлая опция**.
- Если нужен «browser-only TTS прямо завтра» — это **Kokoro-js**, не OmniVoice.
- Если нужен **cloning + RU/600 языков в браузере** — без OmniVoice не обойтись, но придётся вложиться в ONNX-export.

---

## 7. Решение Phase 1: Conditional Go

### ✅ Идём в Phase 2, ЕСЛИ:
1. Пользователь принимает, что **VocoLoco требует мин. 6 GB VRAM** (т.е. RTX 3060+ / M-series 16+ GB).
2. Пользователь готов на **двухнедельный ONNX-export sprint** ДО фронтенд-работы (см. Phase 1.5 ниже).
3. Локальный `omnivoice-server` остаётся **default fallback** (а не deprecated) для слабых машин.

### ❌ НЕ идём, если:
1. Целевая аудитория — массовая (4 GB GPU и встройки).
2. Нет ресурса на ONNX-export (нужен Python/PyTorch dev-стенд + 1-2 недели).

### 🟡 Альтернативный путь (предлагаю обсудить):
**Параллельно** добавить **Kokoro-js** как «лёгкий локальный TTS» в VoiceLab — это даст:
- Мгновенный «browser-only» mode для большинства пользователей.
- Не блокирует работу над VocoLoco.
- Покрывает кейсы озвучки на основных языках без сервера.
- Cloning остаётся через omnivoice-server до того, как мы доделаем VocoLoco.

---

## 8. Phase 1.5 — ONNX Export Sprint (новая фаза, добавляется в plan.md)

Без этой фазы Phase 2-3 невозможны.

### Объём работ
1. **Стенд**: Linux + Python 3.11 + PyTorch 2.8 + CUDA + 16 GB GPU (для трассировки).
2. **Экспортировать audio tokenizer** (encoder + decoder) — отдельные ONNX, INT8 квантизация.
3. **Экспортировать main LLM** (Qwen3-0.6B + codebook heads):
   - Через `optimum-cli export onnx` с `--task text-generation` и кастомным wrapper.
   - Альтернатива: ручной `torch.onnx.export` с трассировкой одного diffusion-step.
4. **Валидация**: запустить ONNX-pipeline на CPU (onnxruntime), сравнить выход с PyTorch (cosine sim ≥ 0.95).
5. **INT8 квантизация** через `onnxruntime.quantization.quantize_dynamic`.
6. **Тест в WebGPU EP**: op-coverage check (RotaryEmbedding, GroupQueryAttention, SimplifiedLayerNormalization — есть ли всё в onnxruntime-web?).
7. **Артефакт**: 3 ONNX-файла + JSON-манифест с input/output shapes + размерами.

### Риски Phase 1.5
- **Diffusion loop** в ONNX: каждый step — отдельный forward, итераций 16-32. Нужно либо развернуть в граф (loops в ONNX поддерживаются, но не всегда в WebGPU EP), либо выполнять loop на JS-стороне с N вызовами `session.run()`.
- **Codebook embeddings**: 8 codebooks × 1025 tokens × 1024 dim ≈ 8M параметров — нужно правильно реэкспортировать lookup, иначе размер раздуется.
- **Кастомные ops**: если в коде OmniVoice есть `@torch.jit.script` или fused kernels — придётся переписывать.

---

## 9. Что НЕ меняется в нашей инфраструктуре

Хорошая новость: **вся остальная стратегия из `plan.md` остаётся валидной**:

| Компонент | Используется как есть |
|---|---|
| `vcOrtWorker.ts` (Web Worker для ORT) | Да — добавляем `OMNIVOICE_*` сессии |
| `vcInferenceSession.ts` (singleton API) | Да — расширяем модельным реестром |
| `vcModelCache.ts` + OPFS | Да — добавляем `OMNIVOICE_MODELS` |
| `webgpuAdapter.ts` (singleton adapter) | Да |
| `useWebGPU` + `useGpuDevices` | Да — `details.maxBufferSize` нужен для гейтинга |
| Booker Pro gating | Да — VocoLoco требует Pro by definition |
| `OmniVoiceLabPanel.tsx` + `omnivoice/*` UI | Да — меняется только транспорт под капотом (`useOmniVoiceServer` → strategy pattern) |
| `omniVoiceAudioPrep.ts` (24 kHz mono WAV) | Да — формат уже совпадает с входом Higgs-audio |
| `voice_references` + транскрипты | Да — `ref_audio + ref_text` идут напрямую в pipeline |
| Psychotype advanced params snapshot | Да — `num_step`, `temperature`, `t_shift` пробрасываются один-в-один |

---

## 10. Решения, которые нужны от пользователя

Перед стартом Phase 1.5 / Phase 2 нужно подтверждение по 3 пунктам:

1. **Минимальные требования к железу**: согласны ли мы, что VocoLoco — это «Pro-Pro» фича для 6+ GB GPU, и слабые машины остаются на сервере?
2. **Параллельный Kokoro-js**: добавлять ли его как «лёгкий локальный TTS» сейчас, не дожидаясь VocoLoco?
3. **ONNX-экспорт**: есть ли ресурс на 1-2 недели Python-разработки (или мы ждём, пока k2-fsa сами выпустят ONNX)?

---

## 11. Артефакты Phase 1

- ✅ Этот документ (`.lovable/research/vocoloco-feasibility.md`)
- ⏳ Memory entry (создаётся сразу): `mem://tech/audio/vocoloco-architecture-research`
- ⏳ Обновление `plan.md` — добавить Phase 1.5 (ONNX Export) перед Phase 2
- ⏳ Новые риски в Phase 6: «нет ONNX от апстрима», «3 сессии не помещаются в 4 GB»

---

## 12. Источники

- Paper: https://arxiv.org/abs/2604.00688
- Repo: https://github.com/k2-fsa/OmniVoice (Apache-2.0)
- HF model: https://huggingface.co/k2-fsa/OmniVoice
- Higgs-audio-v2 tokenizer: https://huggingface.co/bosonai/higgs-audio-v2-tokenizer
- ONNX issue (closed): https://github.com/k2-fsa/OmniVoice/issues/3
- sherpa-onnx integration (closed): https://github.com/k2-fsa/sherpa-onnx/issues/3486
- Reference для подхода: https://huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-ONNX (как Higgs-подобный токенизатор был успешно экспортирован)
- Browser TTS reference: https://github.com/svenflow/kitten-tts-webgpu, kokoro-js (npm)
