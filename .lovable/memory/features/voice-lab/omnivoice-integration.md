---
name: OmniVoice Integration
description: OmniVoice local server integration in VoiceLab — replaces F5-TTS, with character profile auto-fill via translator role
---
OmniVoice (k2-fsa/OmniVoice) заменяет F5-TTS во вкладке VoiceLab.
- Локальный сервер omnivoice-server с OpenAI-совместимым API (/v1/audio/speech)
- Три режима: Voice Design (instructions/presets), Voice Cloning (/v1/audio/speech/clone), Auto Voice
- Сервер URL сохраняется в useCloudSettings("omnivoice-server-url")
- Health check на /health
- Поддержка 600+ языков, non-verbal tags ([laughter], [sigh]...)
- RTF ~0.025 на CUDA
- Компонент: src/components/voicelab/OmniVoiceLabPanel.tsx
- F5-TTS код (src/components/voicelab/F5TtsLabPanel.tsx, src/lib/f5tts/) сохранён, но не используется в UI

## Character Auto-Fill (Voice Design mode)
- Компонент: src/components/voicelab/CharacterAutoFillSection.tsx
- Источник персонажей: ТОЛЬКО активный OPFS-проект (Contract K3 — никакого DB-fallback на book_characters)
- Если проект не открыт — селект Book показывает "Откройте проект в Библиотеке"
- Маппинг профайла → EN-инструкция: src/lib/omniVoiceInstructions.ts (детерминированные словари для gender/age/temperament/archetype + перевод свободных полей)
- Перевод свободных полей (description, speech_style) RU→EN: edge `translate-character-fields`
  - Использует роль `translator` из useAiRoles (модель + apiKey пользователя через resolveAiEndpoint/extractProviderFields)
  - Структурированный tool call `emit_translation` для гарантированного JSON
  - logAiUsage для трекинга в proxy_api_logs
- Кэш переводов: voice_config.omnivoice_cache в characters.json, инвалидация по FNV-1a hash от исходных RU-полей
- UI: гибрид «Character Base (стабильно) + Scene Context (динамично)», обе секции редактируемы, финальный промпт = конкатенация
- Бейдж в шапке показывает имя translator-модели для прозрачности
