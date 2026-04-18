---
name: OmniVoice User Presets
description: User-saved Advanced parameter presets for OmniVoice — OPFS-first store with Supabase mirror via useCloudSettings
type: feature
---
# OmniVoice User Presets

User can save current Advanced parameter configuration (CFG, Steps, T-Shift, temperatures, denoise + speed) as a named preset, apply, rename, delete, export.

## Storage
- **Primary**: OPFS file `omnivoice/user_presets.json` (offline-first, instant)
- **Mirror**: Supabase `user_settings.omnivoice_advanced_presets` via `useCloudSettings` (cross-device sync)
- Merge by `id` on hydration; newer `updatedAt` wins
- Each preset: `{ id, name, params, speed?, createdAt, updatedAt }`

## UI
- Dropdown "Мои пресеты" in Advanced block header (next to Reset)
- Save dialog with name input
- Per-preset submenu: Rename / Export JSON / Delete
- Applying a preset also restores `speed` if stored
- Hint badge shows "Мой пресет: {name}" (snapshot enum source kept as "manual")

## Files
- `src/lib/omniVoiceUserPresets.ts` — OPFS read/write + merge utility
- `src/hooks/useOmniVoiceUserPresets.ts` — combines OPFS + cloud
- `src/components/voicelab/omnivoice/OmniVoiceUserPresetsMenu.tsx` — dropdown + dialogs
