---
name: OmniVoice Psychotype → Advanced Mapping
description: Phase 2 — accentuation+archetype tags resolve to OmniVoice generation knobs (CFG, num_step, t_shift, temperatures); auto-applied on character pick and snapshotted into voice_config.omnivoice_advanced
type: feature
---
Phase 2 OmniVoice Advanced parameters автоматически выводятся из психотипа персонажа и сохраняются на каждого персонажа отдельно.

## Маппинг
- src/config/psychotypeVoicePresets.ts:
  - `ACCENTUATION_OMNIVOICE_PARAMS: Record<Accentuation, OmniVoiceAdvancedParams>` — задаёт num_step и guidance_scale (структура подачи: epileptoid/stuck/schizoid → выше CFG и больше шагов; histerionic/demonstrative → денойз on)
  - `ARCHETYPE_OMNIVOICE_MODIFIERS: Record<Archetype, {positionTempMul, classTempMul, tShift}>` — модулирует «живость» поверх accentuation (trickster/rebel → выше temperature; sage → ниже)
  - `resolveOmniVoiceAdvanced(acc, arch)` — full-snapshot с округлением под слайдеры
  - `resolveOmniVoiceAdvancedFromTags(psycho_tags)` — детектит acc+arch через `detectAccentuation`/`detectArchetype` и возвращает {params, accentuation, archetype} | null

## Хранение в characters.json
- src/pages/parser/types.ts: `OmniVoiceAdvancedSnapshot { params, source, updatedAt }` в `CharacterVoiceConfig.omnivoice_advanced`
- source: `"auto" | "manual" | "preset:draft" | "preset:standard" | "preset:final"` — UI показывает источник в шапке Advanced-блока
- Snapshot всегда полный (6 полей), не diff — стабильно при будущих сменах DEFAULT_ADVANCED_PARAMS

## UI поведение (OmniVoiceLabPanel)
- При выборе персонажа в CharacterAutoFillSection (новый prop `onCharacterPicked`):
  1. Если у персонажа уже есть сохранённый omnivoice_advanced → восстанавливаем (не перетираем ручную правку)
  2. Иначе — `resolveOmniVoiceAdvancedFromTags(psycho_tags)` → params, source="auto", тост с указанием психотипа, persist в OPFS
  3. Если ни acc, ни arch не детектится — оставляем текущие значения, чистим hint
- Любая правка слайдера → source="manual", persist
- Кнопка пресета → source="preset:<id>", persist
- Reset → defaults, source="manual", persist
- Persist через `readCharacterIndex`/`saveCharacterIndex` (Contract K3, OPFS-only)

## Компоненты
- src/components/voicelab/omnivoice/OmniVoiceAdvancedParams.tsx — добавлены пропы `onPresetApply`, `onReset`, `sourceLabel` (badge в шапке)
- src/components/voicelab/omnivoice/OmniVoiceDesignControls.tsx — пробрасывает `onCharacterPicked` в CharacterAutoFillSection
- src/components/voicelab/CharacterAutoFillSection.tsx — useEffect на selectedChar.id вызывает callback
