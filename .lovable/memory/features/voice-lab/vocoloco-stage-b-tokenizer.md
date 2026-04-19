---
name: VocoLoco Stage B — Tokenizer Ready
description: Phase 2 Stage B done — Qwen3 BPE tokenizer wrapper via @huggingface/transformers (Xenova) loading onnx-community/Qwen3-0.6B-ONNX from HF CDN (transformers.js-friendly mirror; official Qwen/Qwen3-0.6B repo lacks special_tokens_map.json and crashes v4 with "i is undefined"). IndexedDB-cached after first use, exposes tokenizeForVocoLoco(text) → BigInt64Array.
type: feature
---

# VocoLoco Stage B — токенизатор готов (2026-04-19)

## Что сделано
- `bun add @huggingface/transformers@4.1.0` (Xenova/transformers.js v4)
- `src/lib/vocoloco/tokenizer.ts` — обёртка вокруг `AutoTokenizer.from_pretrained("onnx-community/Qwen3-0.6B-ONNX")`
  - `tokenizeForVocoLoco(text)` → `BigInt64Array` готовый для ort.Tensor("int64", data, [1, N])
  - `previewTokens(text)` → string[] для диагностики
  - `getQwen3Tokenizer()` lazy + idempotent (singleton Promise)
  - `add_special_tokens: false` — OmniVoice добавляет свои audio control токены позже
- Реэкспорт в `src/lib/vocoloco/index.ts`

## Решения
- **Главный поток, не воркер.** BPE быстрая (<5ms/фразу), не оправдывает round-trip через postMessage
- **Repo `onnx-community/Qwen3-0.6B-ONNX`** (не `Qwen/Qwen3-0.6B`!).
  Официальный репо отдаёт **404 на `special_tokens_map.json`** — transformers.js v4.1.0 при этом падает с
  `can't access property "tokenizer_class", i is undefined`. ONNX-community зеркало содержит полный
  набор файлов (vocab.json, merges.txt, tokenizer.json, tokenizer_config.json, special_tokens_map.json),
  класс — тот же `Qwen2Tokenizer`, vocab бинарно идентичен (151 936 токенов). При смене backbone (Qwen3.5/Qwen4) — bump константы
- **Кэш через transformers.js IndexedDB** — встроенный, не пересекается с OPFS vocoloco-models/

## Тесты
`src/lib/__tests__/vocolocoTokenizer.test.ts` — 6 passed:
- repo константа = "onnx-community/Qwen3-0.6B-ONNX"
- EN: BigInt64Array, длина в пределах vocab (<200k)
- RU: токенизация работает
- Детерминированность
- previewTokens возвращает string[]
- Разный текст → разные последовательности

Тесты сетевые (HF CDN), пропускаются если fetch недоступен.

## Что дальше
- Stage C: diffusion sampler + pipeline orchestrator (cloneVoice end-to-end)
- Stage D: UI в OmniVoiceLabPanel
- Stage E: psycho_tags → params автомаппинг
