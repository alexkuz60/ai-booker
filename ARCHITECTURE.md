# Архитектура AI-Booker

> Единый справочник кодовой архитектуры проекта.  
> Цель: дать ИИ-ассистенту (и разработчику) однозначное понимание, где хранятся данные, как они перемещаются и какие файлы за что отвечают — без необходимости искать истину по разным документам.  
> Актуальная дата: 2026-03-23.

---

## 1. Local-Only архитектура (ProjectStorage)

### 1.1 Принцип

> ⚠️ **Стратегия — LOCAL-ONLY, НЕ local-first.**
> «Local-first» подразумевает приоритет локала с возможным дополнением из облака. Наша архитектура — **local-only**: OPFS является **единственным** источником данных во время работы. Облако — это **резервное хранилище**, из которого проект **разворачивается заново** при смене устройства/браузера. В runtime никакие данные из облака не дополняют и не подмешиваются к локальным.

Пользователь работает с **локальной папкой проекта** на своём устройстве. Облачная синхронизация — **опциональна и инициируется только пользователем** (кнопка «На сервер»).

Локальное хранилище — **единственный source of truth** во время работы. БД — только backup.

### 1.2 Правило эксклюзивности исходного файла

**Исходный файл книги (PDF/DOCX/FB2) НИКОГДА не покидает устройство пользователя.**

- Файл хранится в `source/book.{pdf|docx|fb2}` внутри ProjectStorage и читается оттуда при необходимости.
- Формат определяется автоматически через `detectFileFormat()` из `fileFormatUtils.ts`.
- На сервер отправляются **ТОЛЬКО**:
  - Извлечённые текстовые блоки глав → для семантического анализа ИИ (edge functions).
  - Текст фраз/сегментов → для запросов на TTS-синтез.
  - Структурные метаданные (TOC, части, главы, сцены) → при ручном пуше «На сервер».

### 1.3 Поддерживаемые форматы файлов

| Формат | Библиотека | Извлечение TOC | Извлечение текста |
|--------|-----------|----------------|-------------------|
| **PDF** | `pdfjs-dist` | `pdf.getOutline()` + fallback на text-based TOC | Постраничное извлечение |
| **DOCX** | `mammoth.js` | Heading-стили (H1-H6) + regex-фоллбэк | HTML → текст |
| **FB2** | Нативный XML-парсер | `<section>/<title>` теги | XML → текст |

**Утилиты:** `src/lib/fileFormatUtils.ts` — `detectFileFormat()`, `getSourcePath()`, `findSourceBlob()`, `getMimeType()`.

### 1.4 Бэкенды хранения

| Бэкенд | Браузеры | Видимость файлов | Детект |
|--------|----------|-------------------|--------|
| `LocalFSStorage` (File System Access API) | Chrome, Edge, Opera | Видны в проводнике ОС | `showDirectoryPicker` в `window` |
| `OPFSStorage` (Origin Private File System) | Firefox, Safari | Скрыты (только через ZIP-экспорт) | `navigator.storage.getDirectory` |

Автодетект: `detectStorageBackend()` → `"fs-access"` | `"opfs"` | `"none"`.

### 1.5 Структура папки проекта (V2 — иерархическая)

> V1 (плоская) структура устарела. Проекты автоматически мигрируются на V2 при первом открытии (`ensureV2Layout`).

```
📁 BookTitle/
├── project.json           — ProjectMeta (version, bookId, title, userId, language, fileFormat, layoutVersion: 2)
├── scene_index.json       — SceneIndexData: sceneId→chapterId маппинг, хеши контента, маркеры storyboarded/characterMapped
├── characters.json        — CharacterIndex[] (глобальный реестр персонажей книги)
├── 📁 source/
│   └── book.{pdf|docx|fb2} — исходный файл (ТОЛЬКО ЛОКАЛЬНО)
├── 📁 structure/
│   ├── toc.json           — LocalBookStructure (bookId, title, fileName, parts[], toc[])
│   └── chapters.json      — маппинг index → chapterId
├── 📁 chapters/
│   └── 📁 {chapterId}/
│       ├── content.json   — { chapterId, scenes[], status } (бывш. scenes/chapter_{id}.json)
│       └── 📁 scenes/
│           └── 📁 {sceneId}/
│               ├── storyboard.json — LocalStoryboardData (segments, typeMappings, audioStatus, contentHash)
│               ├── characters.json — SceneCharacterMap (speakers, typeMappings)
│               └── 📁 audio/
│                   ├── 📁 tts/        — {segmentId}.mp3
│                   ├── 📁 atmosphere/ — атмосферные слои
│                   └── 📁 renders/    — финальные рендеры сцен
└── 📁 montage/
```

**Преимущества V2 перед V1:**
- **Структурная изоляция**: данные сцены физически вложены в папку главы → невозможно случайно обратиться к данным чужой главы
- **Атомарное удаление**: удаление главы = удаление одной директории рекурсивно
- **Самодокументирующийся ZIP**: при экспорте структура папок читаема без парсинга ID

#### Реестр персонажей — детали

| Файл | Тип | Назначение |
|------|-----|------------|
| `characters.json` (корень проекта) | `CharacterIndex[]` | Полный реестр на уровне книги: id, name, aliases, gender, age_group, temperament, speech_style, description, speech_tags, psycho_tags, sort_order, color, voice_config, appearances, sceneCount |
| `chapters/{chapterId}/scenes/{sceneId}/characters.json` | `SceneCharacterMap` | Привязка персонажей к сцене: speakers (characterId, role_in_scene, segment_ids), typeMappings (segmentType → characterId) |

**Жизненный цикл:**
- **Парсер → Извлечение**: `useCharacterExtraction` создаёт записи в `characters.json` (имя, пол, алиасы, appearances)
- **Парсер → Профилирование**: `useCharacterProfiles` обогащает `characters.json` (temperament, speech_tags, psycho_tags, description)
- **Студия → Раскадровка**: `upsertSpeakersFromSegments()` добавляет новых спикеров в `characters.json` + создаёт `chapters/{cid}/scenes/{sid}/characters.json`
- **Студия → Кастинг**: `useLocalCharacters.updateCharacter()` записывает voice_config в `characters.json`
- **Дикторы → Голос**: `Narrators.tsx handleSave()` записывает voice_config **только в OPFS** (`characters.json`). DB НЕ обновляется — voice_config попадёт в `book_characters` при следующем Push to Server.
- **Push to Server**: `useSaveBookToProject` читает `characters.json` → upsert в `book_characters`

**Миграция:** при открытии проекта, если `characters.json` отсутствует, но есть `characters/index.json` (V1) — автомиграция через `ensureV2Layout()`.

**Ключевые файлы кода:**

| Файл | Назначение |
|------|------------|
| `src/lib/localCharacters.ts` | CRUD: `readCharacterIndex`, `saveCharacterIndex`, `readSceneCharacterMap`, `saveSceneCharacterMap`, `upsertSpeakersFromSegments`, `buildNameLookup`, `findCharacterByNameOrAlias` |
| `src/hooks/useLocalCharacters.ts` | React-хук для Студии: characters[], sceneCharIds, chapterCharIds, segmentCounts, nameLookup, updateCharacter, mergeCharacters |
| `src/pages/parser/types.ts` | Типы: `CharacterIndex`, `SceneCharacterMap`, `CharacterVoiceConfig`, `LocalCharacter` (legacy) |

### 1.6 Ключевые файлы кода

| Файл | Назначение |
|------|------------|
| `src/lib/projectStorage.ts` | Интерфейс `ProjectStorage` + классы `LocalFSStorage`, `OPFSStorage` |
| `src/lib/projectPaths.ts` | **Централизованный резолвер путей** — V1/V2 адаптация, все пути через `paths.*` |
| `src/lib/sceneIndex.ts` | **Индекс сцен** — sceneId→chapterId маппинг, dirty-маркеры, storyboarded/characterMapped |
| `src/lib/contentHash.ts` | **FNV-1a 32-bit хеш** — контроль целостности контента сцен |
| `src/lib/projectMigrator.ts` | **V1→V2 миграция** — автоматическая при открытии проекта (`ensureV2Layout`) |
| `src/lib/serverDeploy.ts` | **Wipe-and-Deploy pipeline** — чистая async-функция `deployFromServer()`: загрузка данных с сервера → запись в OPFS (10 шагов). Батчинг запросов через `fetchChunked()` для >1000 записей |
| `src/lib/localProjectResolver.ts` | **Резолвер проектов** — поиск/активация/создание OPFS ProjectStorage по bookId. `resolveLocalStorageForBook()`, `ensureWritableLocalStorage()` |
| `src/lib/projectCleanup.ts` | **Очистка browser state** — `wipeProjectBrowserState()` (по bookId) и `wipeAllBrowserState()` |
| `src/hooks/useProjectStorage.ts` | React-хук: create / open / close / import / export проекта |
| `src/hooks/useProjectStorageContext.tsx` | React Context + Provider для глобального доступа |
| `src/lib/localSync.ts` | `syncStructureToLocal()` / `readStructureFromLocal()` — запись/чтение структуры |
| `src/lib/projectZip.ts` | ZIP экспорт/импорт через `fflate` |
| `src/lib/fileFormatUtils.ts` | Формат-агностические утилиты (PDF/DOCX/FB2) |
| `src/hooks/useImperativeSave.ts` | Мгновенное автосохранение без debounce, сериализованная очередь |
| `src/hooks/useSaveBookToProject.ts` | Кнопка «На сервер»: upsert в Supabase + `autoSaveToLocal()` |
| `src/lib/storyboardSync.ts` | `saveStoryboardToLocal()` / `readStoryboardFromLocal()` — раскадровка сцен |

### 1.7 Интерфейс ProjectStorage

```typescript
interface ProjectStorage {
  readonly projectName: string;
  readonly isReady: boolean;
  readJSON<T>(path: string): Promise<T | null>;
  writeJSON(path: string, data: unknown): Promise<void>;
  readBlob(path: string): Promise<Blob | null>;
  writeBlob(path: string, blob: Blob): Promise<void>;
  exists(path: string): Promise<boolean>;
  delete(path: string): Promise<void>;
  listDir(path: string): Promise<string[]>;
  exportZip(): Promise<Blob>;
  importZip(zip: Blob): Promise<void>;
}
```

### 1.8 Жизненный цикл данных

```
┌─────────────────────────────────────────────────────────────────┐
│  1. ИНИЦИАЛИЗАЦИЯ                                               │
│     Upload (PDF/DOCX/FB2) → createProject() → project.json     │
│     + source/book.{ext}                                         │
│     Запись начальной структуры (TOC, parts) в structure/        │
│     БД НЕ ТРОГАЕТСЯ. Все ID генерируются на клиенте.           │
├─────────────────────────────────────────────────────────────────┤
│  2. РАБОТА (Local-auto-save)                                    │
│     Любая мутация → useImperativeSave → мгновенная запись       │
│     в OPFS/LocalFS. БД НЕ ТРОГАЕТСЯ.                           │
│     updatedAt в project.json обновляется при каждом auto-save.  │
│     beforeunload → flushSave() (принудительный сброс очереди)   │
├─────────────────────────────────────────────────────────────────┤
│  3. СЕРВЕРНАЯ СИНХРОНИЗАЦИЯ (Manual-push)                        │
│     Кнопка «На сервер» → upsert chapters/scenes в Supabase     │
│     + UI-состояние (user_settings: studio session, mixer, etc.) │
│     Обновляет books.updated_at = NOW()                          │
│     Паттерн: leaf-only delete-then-insert для сцен              │
│     Это ЕДИНСТВЕННЫЙ момент, когда серверный таймстамп меняется │
├─────────────────────────────────────────────────────────────────┤
│  4. ОТКРЫТИЕ ЛОКАЛЬНОЙ КНИГИ                                    │
│     Библиотека: читает ТОЛЬКО project.json из каждого проекта   │
│     При выборе: ТОЛЬКО локальный ProjectStorage                 │
│     НЕ делать авто-fallback на сервер                           │
│     Затем: toc.json → scenes/ → characters.json → source/       │
├─────────────────────────────────────────────────────────────────┤
│  5. ВОССТАНОВЛЕНИЕ С СЕРВЕРА (Wipe-and-Deploy)                  │
│     Книга есть на сервере, нужно развернуть на этом устройстве: │
│     a) ПОЛНОЕ УДАЛЕНИЕ локальной OPFS-папки проекта             │
│     b) ОЧИСТКА browser state: sessionStorage ключей,            │
│        localStorage ключей (heartbeat, sync-check, nav-state),  │
│        in-memory кэшей (sceneIndex, chapterTextsCache)          │
│     c) Создание чистого OPFS-проекта                            │
│     d) Запись ВСЕХ данных с сервера в OPFS:                     │
│        - structure (TOC, chapters, parts)                       │
│        - characters.json (полный реестр с UUID)                 │
│        - chapters/{cid}/content.json (сцены + контент)          │
│        - chapters/{cid}/scenes/{sid}/storyboard.json            │
│        - scene_index.json (с storyboarded/characterMapped)      │
│     e) Восстановление UI-состояния из user_settings:            │
│        - studio session (activeTab, selectedSceneIdx)           │
│        - mixer/plugin configs                                   │
│     f) Только после полного развертывания — установка проекта   │
│        как активного в React state                              │
│     ЗАПРЕЩЕНО: инкрементальный мерж, частичная замена файлов    │
└─────────────────────────────────────────────────────────────────┘
```

### 1.9 Точки автосохранения

| Триггер | Что записывается | Куда |
|---------|------------------|------|
| `handleFileSelect` (загрузка файла) | project.json + toc.json + chapters.json + source/book.{ext} + scene_index.json | Local |
| Анализ главы завершён | `chapters/{chapterId}/content.json` + scene_index.json (хеши контента) | Local |
| Ручная правка TOC (уровень, заголовок, страница) | toc.json + chapters.json | Local |
| Удаление/слияние глав | toc.json + удаление директории chapters/{chapterId}/ | Local |
| `openSavedBook` | Wipe OPFS → deploy server copy → React state | Local + React state |
| Кнопка «На сервер» | chapters + scenes + parts + characters + storyboards + UI state | Supabase |

### 1.10 Синхронизация между устройствами (Wipe-and-Deploy)

**Стратегия: Local-Only с облачным бэкапом.**

Облако — не «второй источник», а **резервная копия**. При восстановлении проект **разворачивается заново с нуля**, а не «дополняется». Это исключает:
- смешивание данных старой и новой версии
- «файл не найден» (стейл-указатели на удалённые файлы)
- dirty-маркеры от несовпадения хешей
- призрачные файлы от предыдущей структуры

**Таймстамп — единственный механизм определения «свежести» данных:**

- `project.json.updatedAt` — обновляется **локально** при каждом auto-save.
- `books.updated_at` — обновляется **на сервере** только по кнопке «На сервер».
- Следствие: серверный таймстамп новее локального → push с другого устройства.

**Логика при открытии книги:**

1. Локальная секция: открывает только локальный ProjectStorage по `bookId`. Нет локала → нет данных → показать empty state
2. Серверная секция: пользователь явно выбирает «Загрузить» → **Wipe-and-Deploy** (см. §1.8 шаг 5)
3. `acceptServerVersion`: то же самое — полный wipe + deploy
4. `books.updated_at` — визуальный ориентир, не триггер автоматических действий

**Wipe-and-Deploy checklist:**
1. ✅ Удалить OPFS-папку проекта (если есть)
2. ✅ Очистить browser state: `sessionStorage` (studio-active-chapter, parser-nav-state), `localStorage` (heartbeat, sync-check), in-memory кэши (setCachedSceneIndex(null), clearChapterTextsCache())
3. ✅ Создать чистый OPFS-проект через `OPFSStorage.openOrCreate()`
4. ✅ Записать ВСЕ данные с сервера (structure, characters, storyboards, scene_index)
5. ✅ Восстановить UI state из `user_settings` (studio session, mixer configs)
6. ✅ Только после завершения — установить storage/meta в React state

**browserId:** уникальный идентификатор среды (localStorage), гарантирует что проверка выполняется однократно для данного окружения.

**Батчинг запросов (`fetchChunked`):**

Supabase ограничивает `.in()` запросы ~1000 строками. Для больших книг (сотни сцен, тысячи сегментов/фраз) используется generic-хелпер `fetchChunked<T>()` из `serverDeploy.ts`:

```typescript
async function fetchChunked<T>(
  table: string,        // имя таблицы
  select: string,       // SELECT-выражение
  filterCol: string,    // столбец для .in()
  filterIds: string[],  // массив ID (может быть >1000)
  chunkSize: number,    // размер порции (100–500)
  order?: string,       // опциональная сортировка
): Promise<T[]>
```

Порядок батчинга при deploy:
1. `book_scenes` — chunks по 100 `chapter_id`
2. `scene_segments` — chunks по 500 `scene_id`
3. `segment_phrases` — chunks по 500 `segment_id`
4. `scene_type_mappings` — chunks по 500 `scene_id`

Результаты каждого уровня агрегируются в `Map<parentId, child[]>` для O(1) группировки при записи в OPFS.

### 1.11 Индекс сцен и контроль целостности (V2)

#### scene_index.json — быстрая навигация

Файл `scene_index.json` в корне проекта обеспечивает O(1) навигацию по сценам без рекурсивного обхода папок:

```typescript
interface SceneIndexData {
  version: 2;
  updatedAt: string;
  entries: Record<string, {  // sceneId → ...
    chapterId: string;        // для V2-путей
    chapterIndex: number;
    sceneNumber: number;
    contentHash: number;      // FNV-1a 32-bit хеш контента
  }>;
  storyboarded: string[];     // sceneId[] с данными раскадровки
  characterMapped: string[];  // sceneId[] с маппингом персонажей
}
```

**Использование:**
- `resolveChapterId(sceneId)` — in-memory O(1) резолвинг для `projectPaths.ts`
- `isStoryboarded(sceneId)` — без IO-операций
- `isSceneDirty(sceneId, storyboardHash)` — сравнение хешей для dirty-маркера

#### contentHash — FNV-1a 32-bit

Каждая сцена при записи в `chapters/{cid}/content.json` получает хеш контента (`fnv1a32`). При открытии раскадровки сравнивается хеш из `scene_index.json` и `storyboard.json.contentHash`. Расхождение → dirty-маркер в UI → рекомендация переанализировать.

**Файлы:**
| Файл | Назначение |
|------|------------|
| `src/lib/sceneIndex.ts` | CRUD индекса, in-memory кэш, dirty-проверки |
| `src/lib/contentHash.ts` | FNV-1a 32-bit хеш-функция |

#### projectPaths — централизованный резолвер путей

**Все обращения к файлам OPFS ОБЯЗАНЫ** использовать `paths.*` из `src/lib/projectPaths.ts`. Запрещено хардкодить пути в коде.

```typescript
import { paths } from "@/lib/projectPaths";

// Правильно:
await storage.readJSON(paths.storyboard(sceneId));
await storage.readJSON(paths.chapterContent(chapterId));
await storage.readJSON(paths.characterIndex());

// ЗАПРЕЩЕНО:
await storage.readJSON(`storyboard/scene_${sceneId}.json`);
```

Резолвер автоматически адаптирует пути к активному layout (V1/V2). V2 пути включают chapterId, который резолвится из scene_index через `resolveChapterId()`.

### 1.12 Миграция V1 → V2

Автоматическая миграция выполняется в `ensureV2Layout()` при загрузке проекта:

1. Определяется версия layout (`detectLayoutVersion`)
2. Для V1: читаются `scenes/chapter_*.json` → строится маппинг sceneId→chapterId
3. Файлы перемещаются в V2-иерархию: `chapters/{cid}/content.json`, `chapters/{cid}/scenes/{sid}/storyboard.json`, etc.
4. Создаётся `scene_index.json` с хешами контента
5. `characters/index.json` → `characters.json` (корень)
6. `project.json.layoutVersion` = 2
7. Старые V1 директории (`scenes/`, `storyboard/`) удаляются

**Файл:** `src/lib/projectMigrator.ts`

### 1.13 Критические контракты

#### К1. resolvePageRange — диапазон страниц глав

PDF outline содержит контейнерные узлы (например «Том 2» стр. 3–384). При наивном использовании `entry.startPage`–`entry.endPage` текст главы может оказаться пустым.

**Правило:** при анализе глав (`useChapterAnalysis.ts`) ВСЕГДА использовать `resolveEntryPageRange(idx)` из `src/lib/tocStructure.ts`, а не прямые `startPage/endPage`.

#### К2. Контейнерные узлы TOC

Узлы с `children.length > 0` в PDF outline — это контейнеры (не содержат текста).

**Правило:** при импорте TOC из PDF outline (`useFileUpload.ts`) контейнеры НЕ создаются как главы. Level=0 контейнеры → `partTitle`. Остальные → пропускаются. Фоллбэк: если после фильтрации глав 0 → берём все узлы плоским списком.

#### К3. 🚫 АБСОЛЮТНЫЙ ЗАПРЕТ: БД как fallback для контента

**НИКОГДА** не читать из Supabase в runtime:
- текст сцен (`book_scenes.content`)
- сегменты раскадровки (`scene_segments`)
- фразы (`segment_phrases`)

**OPFS — единственный источник правды.** Если в OPFS данных нет — показать пустое состояние (empty state). Никаких fallback-запросов к БД. Никакого «seed from DB». Никаких исключений.

**Допустимые DB-запросы в runtime (только метаданные, НЕ контент):**
- `book_scenes.id`, `scene_number`, `silence_sec` — для маппинга ID и настроек
- `scene_segments.id`, `scene_id`, `speaker` — для проверки наличия сегментов (без текста)
- `segment_audio` — для статуса аудио и путей к файлам
- `scene_playlists` — для длительностей

> **Примечание (K4):** `book_characters` в runtime НЕ читается. Голосовые конфигурации, профили и связи персонажей берутся из `characters.json` (корень проекта) и `chapters/{cid}/scenes/{sid}/characters.json` (OPFS). `book_characters` — только backup при Push to Server.

**БД используется для записи контента ТОЛЬКО:**
1. Edge Functions (segment-scene, synthesize-scene) — пишут результат анализа/синтеза
2. Кнопка «На сервер» (`pushToDb`) — ручной экспорт пользователем

#### К4. 🚫 ЗАПРЕТ: текстовый контент в sessionStorage/localStorage

**НИКОГДА** не хранить текст книги (контент сцен, HTML глав, chapterTexts) в `sessionStorage` или `localStorage`.  
В session/local storage допустимы **только указатели**: `bookId`, `chapterId`, `sceneId`, `scene_number`, индексы, настройки UI.

**Почему:** sessionStorage ограничен ~5МБ, неизбежно обрезает данные; при восстановлении сессии берётся «мусорный» усечённый текст вместо полного контента из OPFS.

**Решение:** для временного кеша (напр. DOCX chapterTexts) — module-level `Map` в `src/lib/chapterTextsCache.ts`. При cache miss — перечитать из OPFS (`reExtractChapterTexts`).

**Файл:** `src/lib/studioChapter.ts` — `saveStudioChapter()` всегда strip-ит `content`/`content_preview` перед записью в sessionStorage.

### 1.14 Правила целостности библиотеки (Library Integrity Rules)

> Дата добавления: 2026-03-18. Эти инварианты должны соблюдаться ВСЕМИ операциями с книгами.

#### LIR-1. bookId иммутабелен

`bookId` генерируется один раз через `crypto.randomUUID()` при первом импорте файла и **НИКОГДА не меняется**.  
Одна директория OPFS = один bookId. Дедупликация в библиотеке — по bookId.

#### LIR-2. Активация проекта по bookId, а не по контексту

При открытии книги из библиотеки **ОБЯЗАТЕЛЬНО** активировать OPFS-проект через маппинг `localProjectNamesByBookId.get(bookId)` и вызов `openProjectByName(name)`.  
**ЗАПРЕЩЕНО** полагаться на «текущий» контекст `ProjectStorageContext.meta` — он может содержать данные предыдущей книги.

#### LIR-3. Верификация bookId перед записью

Перед любой записью в storage (`syncStructureToLocal`, `writeJSON("project.json", ...)`, `saveBook → DB`) — **ОБЯЗАТЕЛЬНА проверка**:
```ts
const storedBookId = (await storage.readJSON("project.json"))?.bookId;
assert(storedBookId === targetBookId, "bookId mismatch — aborting write");
```

#### LIR-4. Заголовок читается из storage, а не из контекста

При операции «Push to Server» (`saveBook`) заголовок книги берётся из **`storage.readJSON("project.json").title`**, а НЕ из `meta?.title` (React context). Контекст может быть устаревшим при переключении между книгами.

#### LIR-5. Сохранение формата исходного файла

При загрузке исходника на сервер (`file_path` в таблице `books`) расширение файла **ДОЛЖНО соответствовать реальному формату** (`book.fb2`, `book.docx`, `book.pdf`). При скачивании с сервера — расширение из `file_path` определяет формат (`detectFileFormat`).  
**ЗАПРЕЩЕНО** хардкодить `.pdf` как дефолт.

#### LIR-6. Очистка транзиентного состояния при смене книги

При открытии другой книги (`restoreFromLocal`, `openSavedBook`) **ОБЯЗАТЕЛЬНО** очистить:
- `pdfRef` → `null`
- `sessionStorage: docx_chapter_texts, docx_html` → удалить
- Только после очистки — загружать данные новой книги

**Ленивая реэкстракция кэша**: `sessionStorage("docx_chapter_texts")` заполняется только при первичном импорте. При восстановлении сессии кэш пуст. `useChapterAnalysis` автоматически перечитывает исходный файл (DOCX/FB2) из OPFS и перестраивает кэш при первом обращении (`reExtractChapterTexts`). Это гарантирует работу анализа без повторного импорта файла пользователем.

#### LIR-7. Wipe-and-Deploy при восстановлении серверной версии

При восстановлении серверной версии (`acceptServerVersion`, `openSavedBook`) — **ПОЛНОЕ удаление** директории OPFS + **очистка browser state** (sessionStorage, localStorage ключей проекта, in-memory кэшей) перед записью. Запрещена инкрементальная мержевая стратегия — она оставляет «призрачные» файлы сцен от старой структуры и стейл-указатели.

#### LIR-8. Серверная секция библиотеки — только не-локальные книги

`loadServerBooks` фильтрует серверные записи, исключая книги с `id ∈ localBooks.map(b => b.id)`.  
Книга, присутствующая и локально, и на сервере, отображается **ТОЛЬКО** в локальной секции (с индикатором синхронизации).

#### LIR-9. Каскадное удаление на сервере

Удаление книги из серверной секции (`deleteServerBook`) удаляет запись `books` — каскад FK удаляет `book_chapters`, `book_scenes`, `book_parts`, `book_characters`.  
Локальный OPFS проект **НЕ затрагивается** при серверном удалении.

#### LIR-10. Запрет на запись в БД при открытии книги

`openSavedBook` и `restoreFromLocal` — **read-only** по отношению к Supabase.  
Единственная допустимая DB-запись — при ручном нажатии «На сервер» (`saveBook`).

### 1.15 Ограничения

- **OPFS** не даёт пользователю видеть файлы в проводнике — это ограничение API, не баг. ZIP-экспорт решает проблему.
- **FS Access API** — права сбрасываются при перезапуске браузера, потребуется re-pick папки.
- `project.json` — единственный обязательный файл для валидации проекта.

### 1.16 Кэширование аудио-импульсов (IR) для реверберации

Импульсные отклики (Impulse Responses) для convolution reverb кэшируются по **гибридной** схеме:

#### Глобальный OPFS-кэш

Директория `ir-cache/` в **корне OPFS** (вне проектов книг) хранит файлы `{impulseId}.bin`.
Один IR-файл обслуживает все книги пользователя — повторная загрузка с сервера не требуется.

#### Per-book манифест

В `project.json` каждой книги ведётся массив `usedImpulseIds: string[]`.
При применении IR в `ConvolverPanel` — impulseId добавляется в манифест.
При «На сервер» — манифест сохраняется вместе с `clip_plugin_configs`.

#### Жизненный цикл

1. Пользователь выбирает IR в ConvolverPanel
2. Проверяется глобальный OPFS-кэш (`getIrFromCache`)
3. При промахе — загрузка через signed URL из Supabase Storage (`impulse-responses` bucket)
4. Запись в глобальный кэш (`putIrToCache`) — fire-and-forget
5. Добавление impulseId в манифест книги (`addToBookImpulseManifest`)

#### Wipe-and-Deploy

При восстановлении проекта с сервера в диалоге подтверждения доступен чекбокс **«Скачать импульсы (IR)»**.
Если включён — `downloadIrBatch()` извлекает список impulseId из `clip_plugin_configs` и пакетно загружает
недостающие файлы в глобальный OPFS-кэш.

#### Файлы

| Файл | Назначение |
|------|------------|
| `src/lib/irCache.ts` | OPFS CRUD, fetch-with-cache, batch download, per-book manifest |
| `src/components/studio/plugins/ConvolverPanel.tsx` | UI выбора IR, интеграция с кэшем |
| `src/components/admin/ImpulseManager.tsx` | Админ: загрузка, `is_public` флаг, backfill peaks |
| `src/lib/serverDeploy.ts` | Шаг `download_ir` в Wipe-and-Deploy pipeline |

#### Серверное хранилище

- Таблица `convolution_impulses` — метаданные (name, category, file_path, peaks, is_public)
- Bucket `impulse-responses` — аудиофайлы IR
- Администратор управляет флагом `is_public` в `/admin` → ImpulseManager

### 1.17 Плагины клипов и иерархическое управление (Clip Plugin System)

Каждый клип на таймлайне может иметь индивидуальную цепочку обработки: EQ → Compressor → Limiter → Panner3D → Convolver.

#### Иерархия управления: Track → Clip

Кнопки **FX** и **RV** на микшерной полоске дорожки работают как **track-level** переключатели:

- **Track ON:** Включает плагины для **всех** клипов дорожки, которые не были индивидуально переопределены.
- **Track OFF:** Выключает плагины только для клипов **без индивидуальных override** (`fxOverride`/`rvOverride` = false).
- **Mixed state:** Если часть клипов имеет override — кнопка отображается в **полу-ярком** цвете (muted accent).

#### Per-clip override

Когда пользователь вручную переключает плагин на **конкретном клипе** в `ChannelPluginsPanel`:
- Устанавливается флаг `fxOverride: true` (или `rvOverride: true`)
- Этот клип больше не подчиняется track-level переключателю
- Track-level toggle пропускает overridden клипы

#### Визуальная индикация в полоске клипов

В `ChannelPluginsPanel` клипы отображаются пропорционально длительности:

| Состояние | Визуал |
|-----------|--------|
| Есть аудио + плагины | Цвет дорожки, полная непрозрачность, бейдж с числом плагинов |
| Есть аудио, нет плагинов | Цвет дорожки, штриховка, приглушённый |
| Нет аудио (не отрендерен) | Серый фон (`--muted`), штриховка, красная нижняя граница, тултип «нет аудио» |

#### Файлы

| Файл | Назначение |
|------|------------|
| `src/hooks/useClipPluginConfigs.ts` | CRUD конфигов, aggregate state (on/off/mixed), track-level toggle с override-логикой |
| `src/components/studio/ChannelPluginsPanel.tsx` | UI per-clip настройки: EQ/CMP/LIM/3D/IR, полоска клипов с индикацией аудио |
| `src/components/studio/TrackMixerStrip.tsx` | Микшерная полоска: FX/RV кнопки с aggregate state, volume/pan |
| `src/components/studio/plugins/ConvolverPanel.tsx` | Выбор IR, превью через движок (только клипы с аудио) |

#### Персистентность

Конфиги хранятся в таблице `clip_plugin_configs` (Supabase) с привязкой к `scene_id` + `clip_id` + `user_id`.
Стратегия сохранения — **batch debounce с flush-on-unmount**:

1. **Очередь pending-изменений** (`pendingRef: Map<clipId, {trackId, config}>`): каждый вызов `saveToDb()` добавляет/обновляет запись в очереди, не перезаписывая другие клипы.
2. **Debounce 400ms**: после последнего изменения все накопленные конфиги сохраняются одним batch `upsert`.
3. **Flush-on-unmount**: при размонтировании хука (HMR, навигация между сценами) выполняется принудительный `flushToDb()` через стабильную ссылку `flushRef`, гарантируя запись всех pending-конфигов в БД.

> **Историческая проблема (до 2026-03-24):** использовался единственный `setTimeout` ref, который при каждом `saveToDb()` сбрасывался — в результате при быстрых изменениях нескольких клипов сохранялся только последний. При HMR таймер просто очищался без flush, что приводило к полной потере настроек плагинов.

---

## 2. Модульная архитектура Парсера

### 2.1 Декомпозиция хуков

Бизнес-логика Парсера декомпозирована на специализированные хуки:

| Хук / Модуль | Назначение |
|-----|------------|
| `useBookManager` | Оркестратор: объединяет sub-хуки, управляет жизненным циклом книги |
| `useLibrary` | Загрузка списка проектов из OPFS, fallback на Supabase RPC |
| `useFileUpload` | Импорт PDF/DOCX/FB2, извлечение TOC, создание проекта в OPFS |
| `useBookRestore` | **Тонкий оркестратор** (~290 строк): делегирует тяжёлую работу в `serverDeploy.ts` и `localProjectResolver.ts`, управляет UI-состоянием (PDF refs, total pages) |
| `serverDeploy.ts` | **Чистая async-функция** `deployFromServer()`: 10-шаговый data pipeline (Server → OPFS) с батчингом запросов |
| `localProjectResolver.ts` | Поиск/активация/создание OPFS-проекта по bookId |
| `useServerSync` | Сравнение таймстампов local vs server, диалог «новая версия», поддержка `SyncProgressCallback` |
| `useTocMutations` | CRUD-операции над TOC: rename, reorder, indent, delete, merge |
| `useChapterAnalysis` | AI-анализ глав: извлечение текста → edge function → сцены |
| `useParserCharacters` | Извлечение и управление персонажами в Парсере |
| `useImperativeSave` | Немедленная запись в OPFS без debounce |
| `useSaveBookToProject` | Ручная синхронизация с Supabase |

### 2.2 Компоненты страницы

| Компонент | Назначение |
|-----------|------------|
| `Parser.tsx` | Страница-оркестратор (~640 строк): маршрутизация шагов, хедер, вкладки |
| `LibraryView` | Список проектов из OPFS с action-кнопками |
| `UploadView` | Загрузка файла + ввод имени проекта |
| `NavSidebar` | Древовидный навигатор TOC с inline-редактированием |
| `ChapterDetailPanel` | Детали главы: сцены, карточки, анализ, очистка |
| `ParserCharactersPanel` | Панель персонажей с AI-профайлингом |

---

## 3. Роль «Сценарист» (screenwriter) — двухэтапная работа

### 3.1 Парсер: определение границ сцен

Сценарист определяет **границы сцен** для выбранного пункта в Навигаторе структуры книги.

**Обязательный контроль границ:**
- Нумерация страниц книги (PDF page range через `resolveEntryPageRange`)
- Количество знаков контента (`char_count` в каждой сцене)

**Ключевые файлы:**
| Файл | Назначение |
|------|------------|
| `src/hooks/useChapterAnalysis.ts` | Оркестрирует AI-анализ: извлечение текста → edge function → сцены |
| `supabase/functions/parse-book-structure/index.ts` | Edge function: LLM определяет границы сцен |
| `src/pages/parser/types.ts` | `Scene`, `Chapter`, `Part`, `BookStructure` |

### 3.2 Студия / Раскадровка: типизация блоков

Сценарист разбивает сцены на **типизированные блоки** (сегменты) с атрибуцией спикеров.

**Категории сегментов (segment_type enum):**

| Тип | RU | EN | Описание |
|-----|----|----|----------|
| `narrator` | Повествование | Narrator | Авторский текст от третьего лица |
| `first_person` | От первого лица | First Person | Повествование от первого лица |
| `dialogue` | Диалог | Dialogue | Реплики в диалоге |
| `monologue` | Монолог | Monologue | Развёрнутая речь одного персонажа |
| `inner_thought` | Мысли | Thoughts | Внутренний монолог / мысли |
| `lyric` | Стих | Verse | Стихотворный фрагмент |
| `epigraph` | Эпиграф | Epigraph | Эпиграф главы/сцены |
| `footnote` | Сноска | Footnote | Комментарий / примечание |
| `telephone` | Телефон | Telephone | Телефонный разговор |
| `remark` | Реплика | Remark | ⚠️ **НЕ РЕАЛИЗОВАНО** — одиночная реплика вне диалога |

**Ключевые файлы:**
| Файл | Назначение |
|------|------------|
| `supabase/functions/segment-scene/index.ts` | Edge function: LLM → сегменты + фразы |
| `src/components/studio/StoryboardPanel.tsx` | UI раскадровки: сегменты, фразы, операции |
| `src/components/studio/storyboard/constants.ts` | `SEGMENT_TYPES`, `SEGMENT_CONFIG` (иконки, цвета) |
| `src/components/studio/storyboard/SegmentTypeBadge.tsx` | Бейдж типа с попover-выбором |

### 3.3 Фоновый анализ сцен (Background Analysis)

Сегментация сцен выполняется **в фоновых потоках**, не блокируя навигацию между сценами. Результаты сохраняются напрямую в OPFS.

**Два режима работы:**

| Режим | Условие | Механизм | Конкурентность |
|-------|---------|----------|----------------|
| **Queue** | Пул не настроен или 1 сцена | `invokeWithFallback` с очередью | До 3 параллельных |
| **Pool** | Пул включён + 2+ сцены | `ModelPoolManager` (round-robin, retry 429/402, circuit breaker) | models × 2 workers |

**Архитектура:**

| Компонент | Файл | Назначение |
|-----------|------|------------|
| `BackgroundAnalysisProvider` | `src/hooks/useBackgroundAnalysis.tsx` | React Context: очередь/пул задач, persist в OPFS, pool stats |
| `useBackgroundAnalysis()` | `src/hooks/useBackgroundAnalysis.tsx` | Хук: `submit()`, `cancelAll()`, `isAnalyzing()`, `completionToken`, `poolStats`, `summary` |
| Индикаторы в навигаторе | `src/components/studio/ChapterNavigator.tsx` | Спиннер рядом со сценой + бейдж прогресса `done/total` в хедере |
| Реактивность StoryboardPanel | `src/components/studio/StoryboardPanel.tsx` | Автоперезагрузка из OPFS при `completionToken` |

**Жизненный цикл задачи:**
1. `submit(jobs)` → регистрация в `jobs` Map со статусом `pending`
2. Pool mode: `ModelPoolManager.runAll()` / Queue mode: `processNext()` с `MAX_CONCURRENCY=3`
3. Чтение контента из OPFS → вызов edge function `segment-scene`
4. Результат → `saveStoryboardToLocal()` в OPFS по `sceneId` задачи (не по текущей сцене)
5. Извлечение спикеров → `upsertSpeakersFromSegments()`
6. `completionToken++` → все слушатели реагируют
7. Тост: ✅ / ❌

**Защита от race condition:**
- Результаты пишутся по `capturedSceneId` задачи — переключение сцен не влияет
- `cancelledRef` блокирует обработку при отмене
- `StoryboardPanel` реагирует на `completionToken` только если завершена текущая сцена

> **Историческая справка (2026-03-24):** `BatchSegmentationPanel` удалён. Его функциональность (включая Model Pool) перенесена в `BackgroundAnalysisProvider`. Кнопка ✨ в навигаторе и «Анализ выбранных» теперь напрямую вызывают `bgAnalysis.submit()`.

---

## 4. Маршрутизация AI-провайдеров (chat-модели)

> TTS-модели имеют отдельную логику маршрутизации (будет описана позже).

### 4.1 Провайдеры и приоритеты

| Приоритет (пользователь) | Приоритет (админ) | Провайдер | Тип подключения | Условие доступа |
|---|---|---|---|---|
| 1 | 2 | **Директ-подписка** (OpenAI, Anthropic, Google и т.д.) | Брендовый API-ключ | Ключ в `profiles.api_keys` |
| 2 | 3 | **OpenRouter** | Роутер | Ключ `openrouter` в `profiles.api_keys` |
| 3 | 3 | **DotPoint** ≡ **ProxyAPI** | Роутер (RU) | Ключ `dotpoint` / `proxyapi`; равноприоритетны, выбор пользователя |
| — | **1** | **Lovable AI** | Встроенный шлюз | Только для админов (`has_role('admin')`) |

### 4.2 Пользовательские списки моделей

Каждый роутер (OpenRouter, ProxyAPI, DotPoint) имеет **пользовательский список моделей** — набор моделей, выбранных пользователем из каталога провайдера и сохранённых в Cloud Settings.

- `openrouter-user-models` → список моделей OpenRouter
- `proxyapi-user-models` → список моделей ProxyAPI
- (DotPoint — аналогично)

Модель доступна для назначения на роль **только если**:
1. У пользователя есть ключ соответствующего провайдера
2. Модель присутствует в пользовательском списке этого провайдера

### 4.3 Каскадный fallback (invokeWithFallback)

При ошибках 402 (credits exhausted) / 429 (rate limit) клиент автоматически перебирает провайдеров:

```
Lovable AI → OpenRouter → ProxyAPI → DotPoint
```

**Файлы:**
| Файл | Назначение |
|------|------------|
| `src/lib/invokeWithFallback.ts` | Клиентская обёртка: каскадный перебор провайдеров |
| `supabase/functions/_shared/providerRouting.ts` | Серверное разрешение endpoint/model/apiKey по префиксу |

**Логика:**
1. Первый запрос — с оригинальной моделью
2. Если 402/429 и использовался Lovable AI → fallback на OpenRouter (если есть ключ) → ProxyAPI → DotPoint
3. Для каждого fallback: проверяется наличие API-ключа, модель переименовывается с нужным префиксом
4. Toast уведомляет пользователя о переключении

### 4.4 Разрешение модели в Edge Functions

Edge-функции получают `model` и `apiKey` от клиента. Логика:

1. Определить провайдер по префиксу модели (`proxyapi/`, `openrouter/`, `dotpoint/`, `lovable/`)
2. Для Lovable AI — проверить `has_role('admin')`; отклонить если не админ
3. Очистить префикс провайдера перед отправкой на upstream API
4. При ошибке upstream — вернуть ошибку клиенту; каскадный fallback обрабатывается на клиенте через `invokeWithFallback`

### 4.5 Ключевые файлы

| Файл | Назначение |
|------|------------|
| `src/config/modelRegistry.ts` | Реестр моделей: id, провайдер, pricing, apiKeyField |
| `src/hooks/useAiRoles.ts` | Разрешение модели для роли: override > default |
| `src/hooks/useUserApiKeys.ts` | Загрузка API-ключей пользователя из profiles |
| `src/components/ModelSelector.tsx` | UI выбора модели с группировкой по провайдерам |
| `supabase/functions/_shared/providerRouting.ts` | Унифицированный серверный роутинг (endpoint + model + apiKey) |
| `supabase/functions/_shared/proxyapi.ts` | Маппинг моделей ProxyAPI + определение endpoint |
| `src/lib/invokeWithFallback.ts` | Клиентский каскадный fallback при 402/429 |

### 4.6 Model Pool — параллельная обработка

Тяжёлые AI-операции (извлечение, профайлинг персонажей, пакетная раскадровка) могут использовать **пул моделей** для параллельного выполнения. Ускорение: ~10x на реальных данных (106 персонажей: ~30 мин → ~2-3 мин).

**Архитектура:**

| Компонент | Файл | Назначение |
|-----------|------|------------|
| `ModelPoolManager` | `src/lib/modelPoolManager.ts` | Round-robin dispatch, concurrency=3/модель, retry 429/402, circuit breaker (3 ошибки → disable), адаптивный размер батча для профайлинга |
| `PoolSelector` | `src/components/profile/tabs/PoolSelector.tsx` | UI выбора моделей для пула роли |
| `AiRolePresets` | `src/components/profile/tabs/AiRolePresets.tsx` | Пресеты с сохранением конфигурации пулов |
| Pool в Extraction | `src/hooks/useCharacterExtraction.ts` | Распределение глав по моделям пула |
| Pool в Profiling | `src/hooks/useCharacterProfiles.ts` | Батчинг персонажей + инкрементальное применение профилей |
| Pool в Segmentation | `src/components/studio/BatchSegmentationPanel.tsx` | Пакетная раскадровка сцен через пул |

**Поведение:**
- Пул активируется при `effectivePool.length > 1` (основная модель + дополнительные)
- Задачи распределяются round-robin с 2 параллельными запросами на модель
- При 429/402 задача автоматически перенаправляется на другой воркер (до 2 retry)
- Воркер отключается после 3 последовательных ошибок (circuit breaker)
- Профили персонажей применяются инкрементально по мере готовности батчей
- Pool stats отображаются в UI в реальном времени (✓completed, ✗errors, ⟳active)
- Конфигурация пулов сохраняется в пресетах и `useCloudSettings` (ключ `ai_role_model_pools`)

**Роли с поддержкой пула:** `poolable: true` в `aiRoles.ts` — screenwriter, director, profiler, proofreader, sound-engineer.

---

## 5. Мост Парсер → Студия: психотип и TTS-синтез

### 5.1 Архитектурный контракт

Данные персонажей проходят через три уровня детализации:

1. **Глобальный профиль** (Парсер → OPFS `characters.json` → Push to Server → `book_characters`)
   - `speech_tags`, `psycho_tags` — генерируются профайлером
   - `accentuation` (Леонгард), `archetype` (тембровый) — расширенные поля в `profile`
   - НЕ перезаписываются при уточнении на уровне сцены

2. **Scene-level уточнения** (Студия → `scene_segments.metadata.speech_context`)
   - Контекстные модификаторы: как персонаж говорит **в данной сцене**
   - Дополняют, но не заменяют глобальный профиль

3. **TTS-инструкции** (автогенерация из mood/scene_type + психотипа)
   - Авто-конвертация `mood` + `scene_type` → темп, тональность, громкость
   - Пользователь может скорректировать перед синтезом

### 5.2 Матрица «Психотип → TTS-пресет»

Конфиг `src/config/psychotypeVoicePresets.ts` (планируется):

```
{ accentuation, archetype, provider } → {
  // Yandex: voice, role (emotion), SSML prosody rate/pitch
  // SaluteSpeech: voice, prosody
  // ElevenLabs: stability, similarity_boost, style, speed
  // ProxyAPI/OpenAI: voice, instructions (текстовое описание эмоции)
}
```

**Принцип:** Профайлер генерирует перечисляемые значения (`accentuation`, `archetype`), которые служат **ключами** для детерминированного маппинга на параметры TTS-движков. AI не решает за пользователя — предлагает 2-3 альтернативы голосов.

### 5.3 Матрица «segment_type → TTS mode»

| segment_type | Модификация | Обоснование |
|-------------|-------------|-------------|
| `dialogue` | Полная эмоциональность, нормальная громкость | Естественная речь |
| `inner_thought` | −3dB, −10% rate, ElevenLabs: +stability | «Близкий микрофон», интимность |
| `narrator` | Нейтральная подача, стабильный темп | Авторский голос |
| `lyric` | +певучесть (ElevenLabs: +style), замедление | Ритмичность стиха |
| `monologue` | Эмоции персонажа, но ровнее чем dialogue | Длинная речь |
| `telephone` | HPF 300Hz, −6dB, сжатие динамики | Имитация телефона |

### 5.4 Ключевые файлы (планируемые)

| Файл | Назначение |
|------|------------|
| `src/config/psychotypeVoicePresets.ts` | Маппинг психотип → TTS-настройки по провайдерам |
| `PSYCHOTYPE_TTS_ANALYTICS.md` | Справочник: классификаторы + TTS-приёмы |
