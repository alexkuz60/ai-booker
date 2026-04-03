
## Фаза 1: Новые пути в projectPaths.ts

Добавляем lang-aware пути для перевода:
- `translationStoryboard(sceneId, lang, chapterId)` → `chapters/{ch}/scenes/{sc}/{lang}/storyboard.json`
- `translationRadar(sceneId, lang, stage, chapterId)` → `chapters/{ch}/scenes/{sc}/{lang}/radar-{stage}.json`
- `translationAudioMeta(sceneId, lang, chapterId)` → `chapters/{ch}/scenes/{sc}/{lang}/audio_meta.json`
- `translationMixerState(sceneId, lang, chapterId)` → `chapters/{ch}/scenes/{sc}/{lang}/mixer_state.json`
- `translationTtsClip(segId, sceneId, lang, chapterId)` → `chapters/{ch}/scenes/{sc}/{lang}/audio/tts/{segId}.mp3`
- `translationSynopsis(type, id)` → `synopsis/{type}-{id}.json` (остаётся в основном проекте)

## Фаза 2: radarStages.ts — добавляем lang-aware пути

Функции `radarStagePath`, `readStageRadar`, `writeStageRadar`, `readCritiqueRadar`, `writeCritiqueRadar`, `readAllStages` получают опциональный параметр `lang?: string`. Если `lang` задан, путь идёт в `chapters/{ch}/scenes/{sc}/{lang}/radar-{stage}.json`.

## Фаза 3: Хуки перевода — убираем translationStorage

Все хуки (`useSegmentTranslation`, `useSegmentLiteraryEdit`, `useSegmentCritique`, `useTranslationBatch`) теперь работают с одним `storage` + `targetLang`. Вместо записи в отдельный OPFS-проект пишут в поддиректорию `{lang}/` текущей сцены.

## Фаза 4: translationPipeline.ts — единый storage

`sourceStorage` и `targetStorage` заменяются на один `storage`. Все пути идут через `paths.translationStoryboard(...)`.

## Фаза 5: BilingualSegmentsView — единый storage

Читает оригинал из `paths.storyboard(sceneId)`, перевод из `paths.translationStoryboard(sceneId, lang)`.

## Фаза 6: Translation.tsx — убираем useTranslationStorage

Убираем `useTranslationStorage`, `useSaveTranslation` (перевод теперь часть основного ZIP). Убираем баннер "проект перевода недоступен". `transProjectExists` заменяется проверкой наличия `meta?.translationLanguages` или аналогичного поля.

## Фаза 7: QualityMonitorPanel, SegmentQualityChart — lang-aware

Передаём `lang` вместо `translationStorage`.

## Фаза 8: Инициализация перевода

Вместо `createTranslationProject()` — простая запись `translationLanguages: ["en"]` в `project.json`. Никакого отдельного OPFS-проекта.

## Фаза 9: Очистка мёртвого кода

Удаляем:
- `src/hooks/useTranslationStorage.ts`
- `src/hooks/useSaveTranslation.ts`  
- `src/lib/translationProject.ts` (кроме `checkTranslationReadiness`)
- `src/lib/translationMirrorResolver.ts`

## project.json изменение

Поле `translationProject?: { projectName, targetLanguage, createdAt }` заменяется на `translationLanguages?: string[]` (например `["en"]`).
