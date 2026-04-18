---
name: VocoLoco Architecture Research
description: Phase 1 findings — OmniVoice (k2-fsa, Apache-2.0) browser feasibility; Qwen3-0.6B + Higgs-audio-v2 tokenizer, 2.45 GB FP32 weights, no official ONNX, requires self-export and ≥6 GB VRAM target
type: reference
---

# VocoLoco Phase 1 — что важно помнить

Полный документ: `.lovable/research/vocoloco-feasibility.md`.

## Архитектура (важно: НЕ flow-matching)
- OmniVoice = single-stage NAR discrete masked diffusion.
- Backbone: **Qwen3-0.6B** (28 layers, hidden=1024, heads=16, vocab=151676).
- Audio tokenizer: **Higgs-audio-v2** (bosonai), 8 codebooks, 25 fps, 24 kHz mono.
- Один большой LLM, а не encoder+transformer+vocoder.
- "Декодер waveform" = decoder самого Higgs tokenizer.

## Размеры и доступность
- `model.safetensors`: **2.45 GB FP32** (единый файл).
- При INT8 ≈ 800 MB только LLM + ~200 MB tokenizer.
- ONNX от апстрима **нет** (issue #3 закрыт «future plan»).
- sherpa-onnx интеграция отклонена как «too big for edge».

## Целевое железо
- Минимум: 6 GB VRAM (RTX 3060+ или M-series 16+ GB).
- 4 GB GPU работает только с INT8 + staged release, на грани.
- Iris Xe / встройки → не подходят, остаётся Remote server.

## Декомпозиция ONNX-сессий
1. Text tokenizer (JS, Qwen3 BPE).
2. Audio tokenizer ENCODER (для cloning).
3. **OmniVoice main LLM** — главный пожиратель VRAM, diffusion loop 16-32 шагов.
4. Audio tokenizer DECODER → Float32 24 kHz.
- Staged release между 2→3 и 3→4 обязателен.

## Phase 1 решение: Conditional Go
- Идём дальше только если: (а) принимаем 6+ GB VRAM как минимум, (б) готовы к Phase 1.5 (ONNX-export sprint).
- Альтернатива параллельно: добавить **Kokoro-js** как лёгкий локальный TTS (80 MB, готовый ONNX, без cloning).

## Phase 1.5 — ОБЯЗАТЕЛЬНО перед Phase 2
- Самим экспортировать ONNX (Python + PyTorch стенд):
  - Audio tokenizer encoder/decoder отдельно.
  - Main LLM через `optimum-cli export onnx` или ручной `torch.onnx.export`.
  - INT8 квантизация.
- Validate vs PyTorch (cosine ≥ 0.95).
- Op-coverage WebGPU EP: RotaryEmbedding, GroupQueryAttention, SimplifiedLayerNormalization.
- Diffusion loop: либо unroll в граф, либо JS-loop с N вызовами `session.run()`.

## Что НЕ меняется
Вся существующая инфра (vcOrtWorker, vcModelCache, OPFS, webgpuAdapter, useWebGPU, OmniVoiceLabPanel UI, omniVoiceAudioPrep 24 kHz, voice_references) переиспользуется как есть.

## Источники
- Paper: arxiv.org/abs/2604.00688
- Repo: github.com/k2-fsa/OmniVoice (Apache-2.0)
- HF: huggingface.co/k2-fsa/OmniVoice
- Higgs tokenizer: huggingface.co/bosonai/higgs-audio-v2-tokenizer
- Reference для экспорта похожего токенизатора: huggingface.co/OpenMOSS-Team/MOSS-Audio-Tokenizer-ONNX
