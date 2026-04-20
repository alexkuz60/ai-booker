---
name: VocoLoco архивирован
description: In-browser ONNX OmniVoice (VocoLoco) откатан в .lovable/archive/vocoloco/ из-за нестабильности WebGPU; находки и причины отката
type: constraint
---

## Решение
VocoLoco (in-browser ONNX engine для OmniVoice: encoder Higgs + LLM Qwen3 + decoder NeMo) **архивирован** в `.lovable/archive/vocoloco/`. Долгосрочный путь — локальный GPU-сервер (`omnivoice-server` через OpenAI-совместимый HTTP API).

## Почему откат
- Каждая версия Chrome/Firefox приносит новые WebGPU-регрессии:
  - Firefox: `maxStorageBuffersPerShaderStage` capped at 8 → INT8 LLM (требует 14) падает на WASM
  - Firefox: OPFS-модели вытесняются после reload без `navigator.storage.persist()`
  - Chrome: `adapter is consumed` при попытке ORT-Web переиспользовать адаптер
  - Chrome: V8 ArrayBuffer ~2 GB лимит при загрузке FP32 (2.45 GB)
  - QInt16-модель использует `MatMulInteger` с int16-весами — вне спецификации ONNX, не запустит ни один runtime
- Серверный режим заработал «практически сразу» через PyTorch+CUDA — стабильно и без браузерных тараканов

## Что НЕ переносимо в локал-сервер
Сервер использует свой стек (Python+CUDA), браузерные находки к нему буквально неприменимы:
- prepareWebGpuAdapter (device-not-adapter, raised storage buffer limits)
- per-call backend downgrade по minStorageBuffers
- verbose ORT logging для CPU fallback нод
- fail-fast I/O contract validation expectedInputs/Outputs

## Что сохранено в src/
- **Whisper STT** перенесён из `src/lib/vocoloco/whisperStt.ts` в `src/lib/whisper/whisperStt.ts` — он используется обоими режимами для распознавания референса при cloning. Импорты обновлены в `useWhisperStt`, `OmniVoiceCloningControls`.

## Удалено из UI
- VocoLocoEngineToggle, VocoLocoModelManager, useVocoLocoLocal
- "Engine" переключатель в OmniVoiceLabPanel — теперь только server mode
- Колонка "ONNX модели для OmniVoice" в VoiceLab Models tab

## Находки для будущих браузерных ONNX (vcOrtWorker и пр.)
Если когда-нибудь вернёмся к браузерному ONNX (F5-TTS, ещё что-то), полезные паттерны лежат в архиве:
1. `prepareWebGpuAdapter` — pre-create GPUDevice один раз с raised limits, передавать `ort.env.webgpu.device` (НЕ adapter — Chrome бросит "consumed")
2. `requestDevice({ requiredLimits: { maxStorageBuffersPerShaderStage: 16 } })` с fallback на default — Chrome даёт 16, Firefox capped at 8
3. Per-model min storage buffers + автоматический downgrade на WASM при недостатке
4. ORT verbose logging для диагностики per-node EP assignment

К текущему стабильному vcOrtWorker (RVC) находки **не применяем** — он работает.
