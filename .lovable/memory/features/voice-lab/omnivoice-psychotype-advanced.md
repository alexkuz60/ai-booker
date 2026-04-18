---
name: OmniVoice Psychotype Advanced
description: Phase 2 — accentuation+archetype tags resolve to OmniVoice generation knobs (CFG, num_step, t_shift, temperatures); auto-applied on character pick and persisted to voice_config.omnivoice_advanced as a snapshot+source
type: feature
---
# OmniVoice Psychotype → Advanced Params (Phase 2)

Maps a character's psycho profile to OmniVoice generation parameters and persists the chosen snapshot per character so the same voice/character renders consistently across sessions and devices.

## Mapping (source of truth: `src/config/psychotypeVoicePresets.ts`)
- `ACCENTUATION_OMNIVOICE_PARAMS: Record<Accentuation, OmniVoiceAdvancedParams>` — base params per Leonhard accentuation
- `ARCHETYPE_OMNIVOICE_MODIFIERS: Record<Archetype, { positionTempMul; classTempMul; tShift }>` — multiplicative tweaks per Jungian archetype
- `resolveOmniVoiceAdvanced(accentuation, archetype) → OmniVoiceAdvancedParams` — applies modifiers, clamps to slider ranges
- `resolveOmniVoiceAdvancedFromTags(psycho_tags) → { params, accentuation, archetype } | null` — entry point used by UI; returns `null` when no recognizable tags

## Storage (per character)
Field: `voice_config.omnivoice_advanced` in `characters.json`
```ts
interface OmniVoiceAdvancedSnapshot {
  params: { guidance_scale; num_step; t_shift; position_temperature; class_temperature; denoise };
  source: "auto" | "manual" | "preset:draft" | "preset:standard" | "preset:final";
  updatedAt: string; // ISO
}
```
- Snapshot is **always full** (all 6 fields) — never partial
- `source` drives the header badge in the Advanced block ("Авто / Ручная правка / Пресет: …")
- Wipe-and-Deploy carries the snapshot with `characters.json`

## UX in `OmniVoiceLabPanel`
1. User picks a character via `CharacterAutoFillSection` → `handleCharacterPicked(char)`
2. If `char.voice_config.omnivoice_advanced` exists → restore params + source label (respect last manual override)
3. Else if `psycho_tags` resolve → set params, mark `source: "auto"`, show `Авто · {Accentuation} + {Archetype}`, persist
4. Manual slider edit → `source: "manual"` + persist
5. Preset button (Draft/Standard/Final) → `source: "preset:<id>"` + persist
6. User preset apply → params restored, hint shows preset name (snapshot source stored as `"manual"` since user-preset isn't in the enum)
7. Reset → defaults, `source: "manual"`, persist

## Files
- `src/config/psychotypeVoicePresets.ts` — mapping tables + resolver
- `src/components/voicelab/OmniVoiceLabPanel.tsx` — `persistAdvancedFor`, `handleCharacterPicked`, manual/preset/reset handlers
- `src/components/voicelab/omnivoice/OmniVoiceAdvancedParams.tsx` — sliders + `sourceLabel` badge
- `src/pages/parser/types.ts` — `OmniVoiceAdvancedSnapshot`, `CharacterVoiceConfig.omnivoice_advanced`

## Invariants
- Persistence is local-only (OPFS `characters.json`); cloud sync happens via standard "Push to Server"
- Auto-apply never overrides an existing saved snapshot — manual user state always wins
- Snapshot enum is closed; user-preset application maps to `"manual"` and surfaces the name only via the hint badge
