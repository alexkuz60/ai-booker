
## Проблема

После перехода на единый проект с `translationLanguages[]` в коде осталось ~100 упоминаний legacy зеркальной архитектуры: `targetLanguage`, `sourceProjectName`, `isMirrorByMeta`, суффиксы `_EN/_RU`. Эти проверки:
1. Замедляют bootstrap (сканируют все OPFS-папки, читают project.json каждой)
2. Создают false-negatives: зомби-зеркала путают резолвер
3. Усложняют код костылями ("skip mirror", "filter mirror")

## План рефакторинга

### 1. `localProjectResolver.ts` — упрощение
- **Удалить** `isMirrorByMeta()` полностью
- Резолвер ищет по bookId, без mirror-фильтрации — проект один, зеркалов больше нет
- Убрать двойной проход (pre-built map → direct OPFS scan) — оставить только один путь

### 2. `useLibrary.ts` — очистка сканирования
- **Удалить** проверки `sourceProjectName`, `targetLanguage` в `mapLocalStructureToBook`
- **Удалить** эвристику `_EN/_RU` суффиксов (строки 110-123)
- **Удалить** повторные проверки в scanResults (строки 130-133)

### 3. `useBookManager.ts` — очистка deleteBook
- **Удалить** проверки `targetLanguage`/`sourceProjectName` при удалении (строки 214-218)
- Удаление книги удаляет ВСЕ папки с этим bookId (переводы внутри папки, не в отдельных)

### 4. `projectCleanup.ts` — упрощение wipe
- **Удалить** проверки mirror при Wipe-and-Deploy (строки 65-68)
- Wipe удаляет все папки с bookId — зеркалов нет, защищать нечего

### 5. `LibraryView.tsx` — `resolveSourceProject`
- **Удалить** проверки `targetLanguage`/`sourceProjectName` (строка 77, 87)

### 6. `projectStorage.ts` — deprecated типы
- **Удалить** `TranslationProjectLink` interface
- **Удалить** `translationProject`, `sourceProjectName`, `targetLanguage` из `ProjectMeta`
- Оставить только `translationLanguages: string[]`

### 7. НЕ трогаем
- `migrateMirrorTranslation.ts` — утилита одноразовой миграции, пусть живёт
- `translationBackup.ts` — чистый код, работает с `translationLanguages`
- `translationPipeline.ts` — работает с подпапками, не с зеркалами

### Результат
- Единая модель: один проект = один bookId = одна OPFS-папка
- Bootstrap быстрее (нет N×2 чтений project.json для mirror-фильтрации)
- Код проще на ~150 строк
