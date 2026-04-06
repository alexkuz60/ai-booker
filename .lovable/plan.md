

## План: `bookTemplateOPFS` — единый шаблон структуры OPFS-проекта

### Цель
Создать программный файл `src/lib/bookTemplateOPFS.ts` — единственный источник истины для:
- иерархии папок проекта (корень → chapter → scene → файлы);
- дефолтных значений всех JSON-файлов;
- функций-фабрик для генерации полной структуры при создании нового проекта.

Это позволит `createNewProject()` строить полное дерево OPFS за один проход, а `seedEmptySceneFiles` в `localSync.ts` — брать дефолты из шаблона, а не хардкодить их.

---

### Структура файла `src/lib/bookTemplateOPFS.ts`

```text
bookTemplateOPFS.ts
├── ROOT_FILES            — список корневых файлов + фабрики дефолтов
│   ├── project.json      — projectMetaDefault(title, bookId, userId, lang)
│   ├── characters.json   — [] (пустой массив)
│   └── book_map.json     — (генерируется buildBookMap, не шаблон)
│
├── ROOT_DIRS             — корневые папки (только имена)
│   ├── structure/        — toc.json, chapters.json
│   ├── synopsis/         — (пустая)
│   └── chapters/         — (контейнер)
│
├── CHAPTER_TEMPLATE      — шаблон папки главы
│   ├── content.json      — chapterContentDefault(chapterId, chapterIndex)
│   └── scenes/           — (контейнер)
│
├── SCENE_TEMPLATE        — шаблон папки сцены
│   ├── storyboard.json   — storyboardDefault(sceneId)
│   ├── audio_meta.json   — audioMetaDefault(sceneId)
│   ├── mixer_state.json  — {} (пустой объект)
│   ├── clip_plugins.json — clipPluginsDefault(sceneId)
│   ├── characters.json   — {} 
│   ├── atmospheres.json  — {}
│   ├── audio/tts/        — (пустая папка)
│   ├── audio/atmosphere/ — (пустая папка)
│   └── audio/renders/    — (пустая папка)
│
└── TRANSLATION_SCENE_TEMPLATE  — шаблон {lang}/ внутри сцены
    ├── storyboard.json   — translationStoryboardDefault(sceneId)
    ├── radar-literal.json  — radarDefault(sceneId)
    ├── radar-literary.json — radarDefault(sceneId)
    ├── radar-critique.json — radarDefault(sceneId)
    ├── audio_meta.json   — audioMetaDefault(sceneId)
    ├── mixer_state.json  — {}
    ├── clip_plugins.json — clipPluginsDefault(sceneId)
    └── audio/tts/        — (пустая папка)
```

### Экспортируемый API

| Функция | Назначение |
|---------|------------|
| `getProjectMetaDefault(title, bookId, userId, lang)` | Дефолтный `project.json` |
| `getSceneFileDefaults(sceneId)` | Map<filename, jsonValue> для всех файлов сцены |
| `getTranslationFileDefaults(sceneId)` | Map<filename, jsonValue> для файлов перевода |
| `getChapterContentDefault(chapterId, idx)` | Дефолтный `content.json` |
| `getStructureDefaults()` | Дефолтные `toc.json` и `chapters.json` |
| `SCENE_DIRS` | Список поддиректорий сцены (`audio/tts`, `audio/atmosphere`, `audio/renders`) |
| `TRANSLATION_DIRS` | Список поддиректорий перевода (`audio/tts`) |
| `ROOT_DIRS` | Список корневых папок (`structure`, `synopsis`, `chapters`) |

### Изменения в существующих файлах

**1. `src/lib/localSync.ts`** — `seedEmptySceneFiles`:
- Импортирует `getSceneFileDefaults` / `getTranslationFileDefaults` из шаблона
- Убирает хардкод дефолтных значений `audio_meta`, `mixer_state`, `clip_plugins`, `storyboard`, `radar-*`
- Логика «не перезаписывать существующие» остаётся без изменений

**2. `src/lib/projectStorage.ts`** — `OPFSStorage.openOrCreate`:
- На этом этапе НЕ трогаем (разделение на 3 функции — следующий шаг)
- Но `createProject` (LocalFS) начнёт использовать `ROOT_DIRS` из шаблона вместо хардкода

**3. `src/hooks/useProjectStorage.ts`** — `createProject`:
- Импортирует `getProjectMetaDefault` вместо inline-конструирования `ProjectMeta`

### Что НЕ входит в этот шаг
- Разделение `openOrCreate` на 3 функции — отдельный шаг после утверждения шаблона
- Удаление `source/book.pdf` — отдельный шаг
- Изменение `openExistingProject` / `restoreProjectFromBackup` — зависит от шаблона, делается позже

### Результат
Единый файл ~120 строк, из которого любой код берёт дефолтные значения и структуру папок. Никаких дублирований дефолтов в разных модулях.

