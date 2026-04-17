---
name: OmniVoice Integration
description: OmniVoice local server in VoiceLab — Voice Design/Cloning/Auto, character profile auto-fill, unified reference picker (Upload/OPFS/Booker collection) with transcript caching
---
OmniVoice (k2-fsa/OmniVoice) — основной TTS во вкладке VoiceLab.
- Локальный сервер omnivoice-server, OpenAI-совместимый API (/v1/audio/speech, /v1/audio/speech/clone, /v1/audio/transcriptions)
- Три режима: Voice Design (instructions/presets), Voice Cloning (ref audio + ref_text), Auto Voice
- Server URL → useCloudSettings("omnivoice-server-url"), health check на /health
- Поддержка 600+ языков, non-verbal tags ([laughter], [sigh]...)
- Компонент: src/components/voicelab/OmniVoiceLabPanel.tsx
- F5-TTS код сохранён, но в UI не используется

## Character Auto-Fill (Voice Design)
- Компонент: src/components/voicelab/CharacterAutoFillSection.tsx
- Источник персонажей: ТОЛЬКО активный OPFS-проект (Contract K3)
- Маппинг профайла → EN-инструкция: src/lib/omniVoiceInstructions.ts
- Перевод свободных полей RU→EN: edge `translate-character-fields` (роль `translator` из useAiRoles)
- Кэш переводов: voice_config.omnivoice_cache в characters.json, инвалидация по FNV-1a hash

## Voice Cloning — Unified Reference Picker
- Компонент: src/components/voicelab/OmniVoiceRefPicker.tsx
- Три источника в табах: Upload (файл с диска) / Моя коллекция (OPFS vc-references/) / Букеровская (voice_references public)
- DB-референс при первом выборе скачивается в OPFS (saveVcReference) и далее берётся из локального кэша
- Конвертация: src/lib/omniVoiceAudioPrep.ts — гибрид. Если sampleRate ≠ 24000 или > 1 канала — AudioContext decode → mono mixdown → OfflineAudioContext resample до 24kHz → 16-bit PCM WAV. Иначе блоб идёт как есть.
- Бейдж "T" в списке = у референса есть сохранённый транскрипт (готов для cloning без STT)

## Транскрипты референсов
- Колонка `transcript` в `voice_references` (миграция, nullable text)
- Поле `transcript?: string` в VcReferenceEntry (vcReferenceCache)
- Хелперы: readVcReferenceMeta, updateVcReferenceMeta — патчат meta без перезаписи аудио
- Сохранение: для DB-референсов транскрипт после Whisper-распознавания пишется в OPFS (vc-references/{id}.json), DB не трогается из клиента
- При выборе DB-референса: если в OPFS meta пусто, а в DB transcript есть → синхронизируется в OPFS
- Админ может вписать транскрипт при загрузке через VoiceReferenceManager (форма) — он попадает в DB и подхватывается всеми клиентами
- Кнопка "💾 Сохранить" в Cloning панели сохраняет ручную правку транскрипта в OPFS
