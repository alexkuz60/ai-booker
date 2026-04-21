---
name: OmniVoice Singing Tags
description: ModelsLab/omnivoice-singing finetune adds [singing] + emotion tags ([happy]/[sad]/[angry]/[excited]/[calm]/[nervous]/[whisper]). Server mode only — manual --model swap on omni.xaoslab.ru. UI: tags surfaced in OmniVoiceTagsPopover with notes.
type: feature
---

# OmniVoice Singing Tags

**Дата:** 2026-04-21

## Что такое
[ModelsLab/omnivoice-singing](https://huggingface.co/ModelsLab/omnivoice-singing) — finetune k2-fsa/OmniVoice (Qwen3-0.6B + HiggsAudioV2). Добавляет:
- `[singing]` — мелодичный вокал (детские песни, напевы; НЕ инструменты)
- Эмоции: `[happy]`, `[sad]`, `[angry]`, `[excited]`, `[calm]`, `[nervous]`, `[whisper]`
- Комбинации: `[singing] [sad]`

`[calm]`/`[excited]` выражены слабее (мало данных). Рекомендуется `guidance_scale=3.0` (наш дефолт уже 3.0).

## Как используется в Booker
**Только серверный режим.** Браузерного ONNX для этого finetune нет — потребуется отдельный экспорт по пути gluschenko (Phase 1.5 для singing-чекпоинта, ~2-3 недели).

Переключение моделей: ручной перезапуск `omni.xaoslab.ru` с `--model ModelsLab/omnivoice-singing` (или с базовой `k2-fsa/OmniVoice`). Один сервер за раз.

## UI
Теги вставлены в `NON_VERBAL_TAG_GROUPS` в `src/components/voicelab/omnivoice/constants.ts` как первые две группы:
- "Пение (ModelsLab)" — `[singing]`
- "Тон (ModelsLab)" — 7 эмоций

`OmniVoiceTagsPopover` теперь поддерживает поле `note_ru`/`note_en` в группах — показывает курсивом пояснение, что теги работают только на singing-чекпоинте.

## Ограничения
- Output bounded by HiggsAudioV2 tokenizer (24 kHz, ~2 kbps speech-tuned)
- Музыкальный аккомпанемент НЕ синтезируется
- Cross-language singing работает, но качество варьируется

## Future
Когда дойдут руки — повторить путь gluschenko для singing-чекпоинта → ONNX в VocoLoco для браузера.
