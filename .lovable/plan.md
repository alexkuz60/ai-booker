
## Проблема
`scene_index.json` уже содержит маппинг sceneId→chapterId, но пути вычисляются на лету через `projectPaths.ts` + `requireChapterId()`. Это создаёт точки отказа при рассинхронизации кэша.

## Решение

### 1. Новый файл `book_map.json` в корне OPFS-проекта
Генерируется **один раз** при создании/изменении структуры (TOC analysis, scene update). Содержит **предвычисленные полные пути** для каждой сущности:

```json
{
  "version": 1,
  "bookId": "...",
  "updatedAt": "...",
  "chapters": {
    "ch-uuid-1": {
      "index": 0,
      "contentPath": "chapters/ch-uuid-1/content.json",
      "scenes": {
        "sc-uuid-1": {
          "sceneNumber": 1,
          "basePath": "chapters/ch-uuid-1/scenes/sc-uuid-1",
          "storyboard": "chapters/ch-uuid-1/scenes/sc-uuid-1/storyboard.json",
          "audioMeta": "chapters/ch-uuid-1/scenes/sc-uuid-1/audio_meta.json",
          "mixerState": "chapters/ch-uuid-1/scenes/sc-uuid-1/mixer_state.json",
          "clipPlugins": "chapters/ch-uuid-1/scenes/sc-uuid-1/clip_plugins.json"
        }
      }
    }
  }
}
```

### 2. Модуль `src/lib/bookMap.ts`
- `buildBookMap(chapterIdMap, chapterResults)` → генерирует карту
- `writeBookMap(storage, map)` / `readBookMap(storage)` → персистенция
- `resolveScenePath(map, sceneId)` → возвращает basePath сцены
- `resolveChapterPath(map, chapterId)` → возвращает путь к главе
- `validateBookMap(storage, map)` → проверяет что все пути реально существуют (диагностика)

### 3. Интеграция
- `syncStructureToLocal()` → после записи структуры генерирует и сохраняет `book_map.json`
- `readStructureFromLocal()` → читает карту при загрузке
- `projectPaths.ts` → `requireChapterId()` сначала смотрит в загруженную карту, потом в scene_index (fallback)
- При загрузке проекта карта читается в память и используется всеми модулями

### 4. Диагностика
- При несовпадении пути из карты и вычисленного пути — `console.error` с указанием точки расхождения
- Это позволяет находить баги в коде до того, как они вызовут потерю данных

### Не меняется
- Формат остальных файлов (project.json, scene_index.json, content.json)
- storageGuard, guardedDelete — без изменений
- scene_index.json продолжает существовать (используется для dirty flags, storyboarded и т.д.)
