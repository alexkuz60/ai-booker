# VocoLoco — Phase 1.5 ОТМЕНЁН: готовый ONNX-стек от gluschenko

**Дата:** 2026-04-19
**Источник:** [gluschenko/omnivoice-onnx](https://huggingface.co/gluschenko/omnivoice-onnx) + [gluschenko/higgs-audio-v2-tokenizer-onnx](https://huggingface.co/gluschenko/higgs-audio-v2-tokenizer-onnx)
**Автор экспорта:** Alexander Gluschenko ([github.com/gluschenko](https://github.com/gluschenko))

## TL;DR

Phase 1.5 (самостоятельный ONNX export, 2-3 недели Python-стенда) **отменяется**. Готовый, корректный, квантованный стек уже опубликован на HuggingFace под Apache-2.0. Состоит из 3 ONNX-файлов: encoder, LLM, decoder. Архитектура полностью совместима с нашим существующим `vcOrtWorker` + `vcModelCache` + WebGPU stack.

## Полный стек (3 ONNX-файла)

| Компонент | Файл | I/O контракт | Размер | Тип |
|---|---|---|---|---|
| **Higgs encoder** | `higgs_audio_v2_tokenizer_encoder.onnx` | waveform 24 kHz → audio_codes `[B, 8, T]` | **654 MB** | FP32 |
| **OmniVoice LLM** | `omnivoice.qint8_per_channel.onnx` | (input_ids, audio_mask, attention_mask, position_ids) → logits `[B, 8, T, 1025]` | **613 MB** | INT8 per-channel |
| **Higgs decoder** | `higgs_audio_v2_tokenizer_decoder.onnx` | audio_codes `[B, 8, T]` → waveform `[B, 1, S]` 24 kHz | **86 MB** | FP32 |

### Доступные кванты LLM (выбираем по сценарию)

| Квант | Размер | Прицел |
|---|---|---|
| `omnivoice.onnx` (FP32) | 2.45 GB | reference, точность |
| `omnivoice.qint16_per_channel` | 1.06 GB | средний размер, высокое качество |
| **`omnivoice.qint8_per_channel`** | **613 MB** | **дефолтный выбор для VocoLoco** |
| `omnivoice.quint8_per_channel` | 613 MB | альтернатива (unsigned) |
| `omnivoice.static_qdq_u8s8` | 613 MB | лучшая производительность на CPU/WASM |

## OmniVoice LLM — анализ графа (qint8_per_channel)

### Метаданные
- IR version: 8, opset 17, producer: `onnx.quantize` (Microsoft Olive / ORT quantizer)
- 7,850 nodes, 711 initializers, 613M элементов весов

### I/O контракт
```
Inputs:
  input_ids       INT64  [batch, 8, sequence]      ← 8 audio codebooks
  audio_mask      BOOL   [batch, sequence]         ← маска для diffusion
  attention_mask  INT64  [batch, sequence]
  position_ids    INT64  [batch, sequence]

Outputs:
  logits          FLOAT  [batch, 8, sequence, 1025]  ← 1024 codebook tokens + mask token
```

### Op-coverage (зелёный свет для WebGPU/WASM)
- ✅ **0 custom ops** — RotaryEmbedding собран вручную из Sin/Cos/Mul/Concat
- ✅ **0 subgraphs** — нет Loop/If, diffusion loop делается в JS
- ✅ **28 Softmax** = 28 attention layers (точно совпадает с Qwen3-0.6B)
- ⚠️ **197× MatMulInteger + 113× DynamicQuantizeLinear** — требует ORT с поддержкой dynamic INT8 quant
  - WebGPU EP: поддерживает, но не всегда оптимально
  - WASM EP с SIMD+threads: рекомендуется как первая попытка

### Полный список ops (топ-15)
```
Constant 2392   Mul 932   Unsqueeze 853   Cast 627   Shape 397
Gather 343   Concat 341   Add 254   Reshape 228   MatMulInteger 197
Div 169   Transpose 142   Pow 113   ReduceMean 113   Sqrt 113
DynamicQuantizeLinear 113   Slice 112   Equal 59   Where 58
ConstantOfShape 57   Expand 57   MatMul 57   Neg 56
Softmax 28   Sigmoid 28
```

## Higgs Decoder — анализ графа

### Метаданные
- IR 8, opset 17, producer: `pytorch`
- 839 nodes, 169 initializers, **21.5M параметров** (~86 MB FP32)

### I/O
```
Input:  audio_codes    INT64  [batch, 8, codes_length]
Output: audio_values   FLOAT  [batch, 1, num_samples]   (24 kHz mono)
```

### Op-coverage (топ совместимости)
```
Conv 32   ConvTranspose 5   MatMul 9   Mul 72   Add 68
Sin 36 (snake activation)   Pow 36   Reciprocal 36
Reshape 72   Gather 80   Constant 226
```
**Никаких custom ops**, чистый FP32, работает на любом EP без подготовки.

## Конфиги (config.json)

```json
{
  "sample_rate": 24000,
  "semantic_sample_rate": 16000,
  "downsample_factor": 320,           // 24000 / 75 — но frame rate 25 fps (×3 stride)
  "codebook_dim": 64,
  "codebook_size": 1024,
  "target_bandwidths": [0.5, 1, 1.5, 2],   // выбор bitrate
  "acoustic_model_config": {
    "model_type": "dac",
    "n_codebooks": 9,                  // 9 на конфиге, 8 используются в LLM (1 резерв)
    "codebook_size": 1024,
    "hop_length": 960,                  // 24000 / 960 = 25 fps
    "downsampling_ratios": [8, 5, 4, 2, 3],
    "upsampling_ratios": [8, 5, 4, 2, 3]
  },
  "semantic_model_config": {
    "model_type": "hubert",
    "hidden_size": 768,
    "num_hidden_layers": 12,
    "num_attention_heads": 12
  }
}
```

## Inference pipeline (как мы его соберём в JS)

```
┌─ Voice Design (без cloning) ────────────────────────────────────┐
│  text  →  Qwen3 BPE tokenizer (JS)  →  input_ids                 │
│                                                                   │
│  initial mask audio_codes [B, 8, T_target]   (всё в mask token)  │
│                                                                   │
│  for step in 1..N (16-32):                                       │
│      logits = LLM.run(input_ids, audio_mask, attn, pos)          │
│      sampled = sample_from_logits(logits, temperature, top_p)    │
│      audio_codes[mask_positions] = sampled                       │
│      audio_mask = update_mask(step / N)                          │
│                                                                   │
│  waveform = decoder.run(audio_codes)         ← 24 kHz mono       │
└──────────────────────────────────────────────────────────────────┘

┌─ Voice Cloning (полный) ────────────────────────────────────────┐
│  ref_audio (24 kHz)  →  encoder.run()  →  ref_audio_codes        │
│  ↓ release encoder session (vRAM cleanup)                         │
│  text → tokenizer → input_ids prepended with ref_codes            │
│  ... [ как Voice Design ] ...                                     │
└──────────────────────────────────────────────────────────────────┘
```

## Сценарии VRAM/RAM

| Режим | Активные сессии | Пик памяти | Совместимость |
|---|---|---|---|
| **Voice Design** | LLM INT8 + decoder FP32 | **~700 MB** | 4 GB GPU; WASM CPU |
| **Voice Cloning naive** | encoder + LLM + decoder одновременно | ~1.4 GB | 6+ GB GPU |
| **Voice Cloning staged** | encoder → drop → LLM → drop → decoder | пик ~1 GB | 4 GB GPU; staged release как в `vcInferenceSession` |

## Сравнение: что мы знали в Phase 1 vs реальность

| Phase 1 предположение | Реальность |
|---|---|
| Custom ONNX-export 2-3 недели | ✅ Готов, апстрим качественный |
| Монолитный граф | ✅ 3 раздельных файла — staged release возможен |
| Min 6 GB VRAM | ✅ Voice Design = 700 MB, идёт даже на WASM |
| Diffusion loop проблема | ✅ Граф = single forward, loop в JS = гибкость |
| Custom ops риск | ✅ 0 custom ops в обоих графах |
| 2.45 GB FP32 | ✅ INT8 = 613 MB, в 4× меньше |

## Что сразу переиспользуем из существующей инфры

| Модуль | Применение |
|---|---|
| `vcOrtWorker` | Web Worker для ONNX-сессий, terminate() для VRAM cleanup |
| `vcInferenceSession` | staged GPU release (encoder → drop → LLM → drop → decoder) |
| `vcModelCache` + OPFS `vc-models/` | Кэш 3 ONNX-файлов с прогрессом |
| `webgpuAdapter` + `useWebGPU` | Backend selection с fallback на WASM |
| `omniVoiceAudioPrep` | 24 kHz mono prep для encoder input (уже сделан) |
| `OmniVoiceLabPanel` UI | Существующий UI Voice Design / Cloning / Auto |
| `voice_references` | OPFS-кэш референсов с транскриптами |

## Что нужно дописать (Phase 2)

### Обязательное
1. **Qwen3 BPE tokenizer в JS** — есть готовый `@huggingface/transformers` (Xenova) с поддержкой Qwen tokenizers.
2. **Diffusion loop sampler** — JS-функция: top-p / temperature sampling из logits, mask update между шагами.
3. **Pipeline orchestrator** `vocoLocoPipeline.ts` — собирает encoder → LLM → decoder с staged release.
4. **Модель registry** — добавить 3 новых ID в `VC_ALL_MODELS` или сделать отдельный `VOCOLOCO_MODELS`.

### Желательное
5. **Bench WebGPU vs WASM** — какой EP быстрее для INT8 LLM на разных GPU.
6. **Streaming output** — по мере decoding выдавать первые секунды (если возможно).
7. **Pre-cache decoder** — он маленький (86 MB), может качаться в фоне даже без активации Pro.

## Лицензии и происхождение

- **OmniVoice LLM**: Apache-2.0 (k2-fsa)
- **Higgs tokenizer**: "other" (boson.ai non-commercial для коммерческих случаев — нужно перепроверить!) — см. [bosonai/higgs-audio-v2-tokenizer](https://huggingface.co/bosonai/higgs-audio-v2-tokenizer)
- **gluschenko ONNX export**: использует те же лицензии, что и upstream

⚠️ **Action item**: проверить совместимость лицензии Higgs tokenizer с коммерческим использованием в Booker до выхода в production.

## Оригинальный Phase 1 документ
- `.lovable/research/vocoloco-feasibility.md` — теперь устаревшая часть про Phase 1.5
- `.lovable/archive/vocoloco-feasibility.md` — архив
- `.lovable/archive/vocoloco-plan.md` — план до этой инспекции
