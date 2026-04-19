---
name: VocoLoco External Data Files
description: ONNX models with sidecar weights (e.g. OmniVoice LLM = tiny .onnx graph + ~613MB .onnx_data) require both files in OPFS and a worker `externalData` mount. Without it ORT throws "Module.MountedFiles is not available". Implemented end-to-end across registry, modelCache, workerClient and worker.
type: feature
---

# VocoLoco — ONNX external data support (2026-04-19)

## Симптом
```
Failed to load external data file "omnivoice.qint8_per_channel.onnx_data",
error: Module.MountedFiles is not available.
```

## Причина
LLM-модели OmniVoice (Qwen3 backbone) экспортированы с **ONNX external data**:
- `omnivoice.qint8_per_channel.onnx`     — только граф, ~4 MB
- `omnivoice.qint8_per_channel.onnx_data` — веса, 613 MB
ORT-Web ищет `.onnx_data` в виртуальной FS (`Module.MountedFiles`),
которой по умолчанию нет → fail.

Encoder/Decoder (Higgs) — single-file FP32, без `.onnx_data` (404 на HF).

## Решение
1. **Registry**: новые поля `externalDataUrl` + `externalDataSize`.
   Хелпер `totalModelBytes(entry)` = граф + веса для UI.
2. **modelCache**:
   - качает оба файла последовательно, пишет потоково в OPFS (избегая удвоения памяти);
   - имя `.onnx_data` сохраняется КАК В upstream (литеральная строка в графе);
   - `hasVocoLocoModel` = true только если ОБА файла есть и не пустые;
   - `deleteVocoLocoModel` / `clearAllVocoLocoModels` чистят пару;
   - `readVocoLocoExternalData(modelId)` → `{ name, buffer } | null`.
3. **workerClient**:
   - перед `createSession` читает оба файла из OPFS,
     передаёт `externalData: [{ path, buffer }]` в worker,
     все ArrayBuffer уходят как Transferable (zero-copy).
4. **vocoLocoWorker**:
   - принимает `externalData`, мапит в опцию ORT
     `{ externalData: [{ path, data: Uint8Array }] }`,
     ORT монтирует файл по литералу `path` и резолвит ссылки из графа.

## Файлы
- `src/lib/vocoloco/modelRegistry.ts` — интерфейс + LLM варианты с external data
- `src/lib/vocoloco/modelCache.ts` — пара файлов, потоковая запись
- `src/lib/vocoloco/workerClient.ts` — чтение пары, транспорт
- `src/lib/vocoLocoWorker.ts` — `externalData` в session options
- `src/hooks/useVocoLocoLocal.ts` + `VocoLocoModelManager.tsx` — UI размеры

## Размеры (актуальные)
| ID | .onnx | .onnx_data | Total |
|---|---|---|---|
| vocoloco-encoder | 654 MB | — | 654 MB |
| vocoloco-decoder | 86 MB | — | 86 MB |
| vocoloco-llm-int8 | 3.95 MB | 612.77 MB | ~617 MB |
| vocoloco-llm-qint16 | 3.95 MB | 1061.57 MB | ~1066 MB |
| vocoloco-llm-qdq | 3.95 MB | 612.58 MB | ~617 MB |

## Миграция для пользователей
Если LLM был скачан ДО этого фикса (только .onnx ~4MB),
`hasVocoLocoModel` вернёт false — UI попросит скачать заново и
догрузит оба файла. Existing graph переписывается, дубликата нет.
