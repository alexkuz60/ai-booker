---
name: VocoLoco ONNX Stack Ready
description: Phase 1.5 (ONNX export) cancelled — gluschenko published full 3-file stack on HF (encoder 654MB FP32, OmniVoice LLM 613MB INT8, decoder 86MB FP32). 0 custom ops, staged release possible, Voice Design fits in 700MB
type: reference
---

# VocoLoco — готовый ONNX-стек (2026-04-19)

Полная инспекция: `.lovable/research/vocoloco-onnx-inspection.md`.
Заменяет старую research-доку (`vocoloco-architecture-research`) в части Phase 1.5.

## Что изменилось vs Phase 1
- **Phase 1.5 (ONNX export) ОТМЕНЁН** — Alexander Gluschenko опубликовал готовый стек.
- Решение: 🟢 **Strong Go** (было: Conditional Go).

## Стек = 3 ONNX-файла

| Файл | Размер | Тип | I/O |
|---|---|---|---|
| `higgs_audio_v2_tokenizer_encoder.onnx` | 654 MB | FP32 | wav 24k → codes [B,8,T] |
| `omnivoice.qint8_per_channel.onnx` | 613 MB | INT8 | (ids, mask, attn, pos) → logits [B,8,T,1025] |
| `higgs_audio_v2_tokenizer_decoder.onnx` | 86 MB | FP32 | codes [B,8,T] → wav [B,1,S] |

LLM доступен в 7 вариантах: FP32 (2.45 GB), qint16 (1.06 GB), qint8/quint8/qdq (~613 MB).

## Ключевые подтверждённые факты
- 24 kHz mono, 25 fps, 8 codebooks × 1024 + 1 mask token = vocab 1025
- **0 custom ops** в обоих графах (RoPE из Sin/Cos/Mul)
- **0 subgraphs** в LLM — diffusion loop делается в JS (16-32 шага)
- LLM: 28 attention layers (Qwen3-0.6B confirmed), 197 MatMulInteger + 113 DynamicQuantizeLinear
- Decoder: только Conv/ConvTranspose/MatMul/Sin — топ совместимости с любым EP
- IR 8, opset 17 — совместимо с onnxruntime-web 1.16+

## VRAM сценарии
- **Voice Design** (LLM + decoder): ~700 MB — работает на 4 GB GPU и WASM CPU
- **Voice Cloning naive**: ~1.4 GB — нужно 6+ GB
- **Voice Cloning staged**: пик ~1 GB (encoder→drop→LLM→drop→decoder) — 4 GB GPU справится

## Переиспользуем без изменений
vcOrtWorker, vcInferenceSession (staged release), vcModelCache, OPFS vc-models/, webgpuAdapter, useWebGPU, OmniVoiceLabPanel UI, omniVoiceAudioPrep (24 kHz prep), voice_references.

## Phase 2 — что дописать
1. Qwen3 BPE tokenizer в JS (через @huggingface/transformers)
2. Diffusion loop sampler (top-p/temperature, mask update)
3. `vocoLocoPipeline.ts` — orchestrator
4. Регистрация 3 моделей в VC registry с прогрессом
5. Bench WebGPU vs WASM для INT8 LLM

## ⚠️ Action items
- Проверить лицензию Higgs tokenizer (boson.ai "other") на коммерческое использование в Booker до production
- Решить путь интеграции: Browser-Native (всё в OPFS) vs Hybrid (encoder на сервере)

## Источники
- LLM: huggingface.co/gluschenko/omnivoice-onnx (Apache-2.0)
- Tokenizer: huggingface.co/gluschenko/higgs-audio-v2-tokenizer-onnx (other)
- Author: github.com/gluschenko (РФ-разработчик)
- Upstream: github.com/k2-fsa/OmniVoice, huggingface.co/bosonai/higgs-audio-v2-tokenizer
