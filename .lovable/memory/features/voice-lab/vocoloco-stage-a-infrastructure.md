---
name: VocoLoco Stage A — Infrastructure Ready
description: Phase 2 Stage A complete — vocoloco/ module with model registry (3 ONNX, 5 entries with 3 LLM quants), OPFS cache (vocoloco-models/ separate from vc-models/), dedicated vocoLocoWorker (isolated from vcOrtWorker), workerClient with fail-fast I/O contract validation, and 8 passing tests
type: feature
---

# VocoLoco Stage A — готово (2026-04-19)

Инфраструктура на месте. UI и tokenizer/sampler — следующие этапы.

## Что появилось

| Модуль | Назначение |
|---|---|
| `src/lib/vocoloco/config.ts` | VOCOLOCO_CONFIG (24kHz, 8 codebooks, vocab 1025, 25 fps, qwen3-0.6b backbone) |
| `src/lib/vocoloco/modelRegistry.ts` | 5 entries: encoder + decoder + 3 LLM quants (int8/qint16/qdq), VOCOLOCO_IO_CONTRACT, revision string |
| `src/lib/vocoloco/modelCache.ts` | OPFS-кэш в `vocoloco-models/`, своё событие VOCOLOCO_MODEL_CACHE_EVENT, has/read/download/delete API |
| `src/lib/vocoLocoWorker.ts` | Отдельный воркер (изолирован от vcOrtWorker), createSession с expectedInputs/Outputs |
| `src/lib/vocoloco/workerClient.ts` | Promise-обёртка, createVocoLocoSession делает fail-fast если контракт I/O сломан |
| `src/lib/vocoloco/index.ts` | Public barrel |

## Гарантии безопасности апдейтов

- `revision` поле в каждой записи registry
- I/O контракт проверяется при создании сессии — ловим breaking changes upstream до первого инференса
- При несовпадении контракта сессия немедленно release-ится и бросается ошибка с диагностикой
- OPFS-папка отдельная → VC и VocoLoco кэши не пересекаются
- Воркер отдельный → terminate() VocoLoco не убивает RVC-сессии

## Тесты

`src/lib/__tests__/vocoloco.test.ts` — 8 passed: конфиг, реестр, дефолтный квант, URL-проверки, единый revision, контракт, поиск.

## Что дальше

- Stage B: Qwen3 BPE tokenizer (через @huggingface/transformers)
- Stage C: diffusion sampler + pipeline orchestrator (cloneVoice end-to-end)
- Stage D: расширить OmniVoiceLabPanel тумблером Server | Local
- Stage E: psycho_tags → VocoLoco params автомаппинг

## Известные TODO

- Подтвердить точное имя input encoder'а ("audio" в контракте — placeholder, проверить на первом ONNX-load и при необходимости заменить)
- Лицензия Higgs tokenizer (boson.ai "other") — ревью перед прод-релизом
