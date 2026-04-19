---
name: VocoLoco Stage B — Tokenizer Ready
description: Phase 2 Stage B done — Qwen3 BPE tokenizer wrapper via @huggingface/transformers (Xenova) loading Qwen/Qwen3-0.6B from HF CDN, IndexedDB-cached after first use, exposes tokenizeForVocoLoco(text) → BigInt64Array. 6 integration tests passed (RU/EN, deterministic, no special tokens)
type: feature
---

# VocoLoco Stage B — токенизатор готов (2026-04-19)

## Что сделано
- `bun add @huggingface/transformers@4.1.0` (Xenova/transformers.js v4)
- `src/lib/vocoloco/tokenizer.ts` — обёртка вокруг `AutoTokenizer.from_pretrained("Qwen/Qwen3-0.6B")`
  - `tokenizeForVocoLoco(text)` → `BigInt64Array` готовый для ort.Tensor("int64", data, [1, N])
  - `previewTokens(text)` → string[] для диагностики
  - `getQwen3Tokenizer()` lazy + idempotent (singleton Promise)
  - `add_special_tokens: false` — OmniVoice добавляет свои audio control токены позже
- Реэкспорт в `src/lib/vocoloco/index.ts`

## Решения
- **Главный поток, не воркер.** BPE быстрая (<5ms/фразу), не оправдывает round-trip через postMessage
- **Repo `Qwen/Qwen3-0.6B`** — тот же что у gluschenko/omnivoice-onnx. При смене backbone (Qwen3.5/Qwen4) — bump константы
- **Кэш через transformers.js IndexedDB** — встроенный, не пересекается с OPFS vocoloco-models/

## Тесты
`src/lib/__tests__/vocolocoTokenizer.test.ts` — 6 passed:
- repo константа = "Qwen/Qwen3-0.6B"
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
