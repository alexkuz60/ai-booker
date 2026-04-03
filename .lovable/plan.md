
## ✅ Консолидация хранения перевода — ЗАВЕРШЕНО

Все фазы выполнены. Зеркальные OPFS-проекты устранены. Данные перевода хранятся в lang-поддиректориях основного проекта.

### Фаза 1: Новые пути в projectPaths.ts ✅

Добавлены lang-aware пути: `translationStoryboard`, `translationRadar`, `translationAudioMeta`, `translationMixerState`, `translationTtsClip`, `translationClipPlugins`.

### Фаза 2: radarStages.ts — lang-aware пути ✅

Функции `radarStagePath`, `readStageRadar`, `writeStageRadar` и др. получили параметр `lang?: string`.

### Фаза 3: Хуки перевода — единый storage ✅

Все хуки (`useSegmentTranslation`, `useSegmentLiteraryEdit`, `useSegmentCritique`, `useTranslationBatch`) работают с одним `storage` + `targetLang`.

### Фаза 4: translationPipeline.ts — единый storage ✅

`sourceStorage` и `targetStorage` заменены на один `storage`.

### Фаза 5: BilingualSegmentsView — единый storage ✅

Читает оригинал из `paths.storyboard(sceneId)`, перевод из `paths.translationStoryboard(sceneId, lang)`.

### Фаза 6: Translation.tsx — убран useTranslationStorage ✅

Guard заменён на проверку `meta?.translationLanguages`. Баннер зеркала удалён.

### Фаза 7: QualityMonitorPanel, SegmentQualityChart — lang-aware ✅

### Фаза 8: Инициализация перевода ✅

`translationLanguages: ["en"]` в `project.json`. Степпер в библиотеке: один шаг `trans_activated`.

### Фаза 9: Очистка мёртвого кода ✅

Удалены: `useTranslationStorage`, `useSaveTranslation`, зеркальная логика из `translationProject.ts`, `_translation_link.json`.

### Фаза 10: Облачная синхронизация (Storage ZIP) ✅

`translationBackup.ts`: pack/push/restore. Интеграция в `useSaveBookToProject` и `serverDeploy.ts`.

### project.json

Поле `translationProject?: { projectName, targetLanguage, createdAt }` заменено на `translationLanguages?: string[]`.
