---
name: OmniVoice Integration
description: OmniVoice local server integration in VoiceLab — replaces F5-TTS experimental tab
type: feature
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
