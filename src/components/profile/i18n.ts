const texts: Record<string, { ru: string; en: string }> = {
  // ProfileTab
  uploadPhoto: { ru: 'Загрузить фото', en: 'Upload photo' },
  deleteAvatar: { ru: 'Удалить', en: 'Delete' },
  avatarHint: { ru: 'JPEG, PNG, WebP · до 2 МБ', en: 'JPEG, PNG, WebP · up to 2 MB' },

  // PreferencesTab
  preferences: { ru: 'Настройки', en: 'Preferences' },
  theme: { ru: 'Тема', en: 'Theme' },
  themeDark: { ru: 'Тёмная', en: 'Dark' },
  themeLight: { ru: 'Светлая', en: 'Light' },
  language: { ru: 'Язык', en: 'Language' },

  // ApiKeysTab
  apiKeys: { ru: 'API Ключи', en: 'API Keys' },
  byokDescription: { ru: 'Добавьте свои API ключи для использования различных сервисов (BYOK — Bring Your Own Key)', en: 'Add your API keys to use various services (BYOK — Bring Your Own Key)' },
  getKeyAt: { ru: 'Получите ключ на', en: 'Get your key at' },

  // General
  save: { ru: 'Сохранить', en: 'Save' },
  saved: { ru: 'Сохранено', en: 'Saved' },
  profile: { ru: 'Профиль', en: 'Profile' },
  personal: { ru: 'Личный кабинет', en: 'Personal' },
  apiManagement: { ru: 'Управление API', en: 'API Management' },
  displayName: { ru: 'Отображаемое имя', en: 'Display Name' },
  username: { ru: 'Имя пользователя', en: 'Username' },

  // TTS providers
  elevenlabs: { ru: 'ElevenLabs (TTS)', en: 'ElevenLabs (TTS)' },
  yandexSpeechKit: { ru: 'Yandex SpeechKit', en: 'Yandex SpeechKit' },
  saluteSpeech: { ru: 'SaluteSpeech (Сбер)', en: 'SaluteSpeech (Sber)' },

  // LLM providers
  openai: { ru: 'OpenAI', en: 'OpenAI' },
  gemini: { ru: 'Google Gemini', en: 'Google Gemini' },
  anthropic: { ru: 'Anthropic (Claude)', en: 'Anthropic (Claude)' },

  // Sections
  ttsProviders: { ru: 'Провайдеры озвучки (TTS)', en: 'TTS Providers' },
  llmProviders: { ru: 'LLM Провайдеры', en: 'LLM Providers' },
};

export function getProfileText(key: string, isRu: boolean): string {
  const entry = texts[key];
  if (!entry) return key;
  return isRu ? entry.ru : entry.en;
}
