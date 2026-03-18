# Архитектура AI-Booker

> Единый справочник кодовой архитектуры проекта.  
> Цель: дать ИИ-ассистенту (и разработчику) однозначное понимание, где хранятся данные, как они перемещаются и какие файлы за что отвечают — без необходимости искать истину по разным документам.  
> Актуальная дата: 2026-03-18.

---

## 1. Local-First архитектура (ProjectStorage)

### 1.1 Принцип

Пользователь работает с **локальной папкой проекта** на своём устройстве. Облачная синхронизация — **опциональна и инициируется только пользователем** (кнопка «На сервер»).

Локальное хранилище — **единственный primary source of truth** во время работы.

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

### 1.5 Структура папки проекта

```
📁 BookTitle/
├── project.json           — ProjectMeta (version, bookId, title, userId, language, fileFormat)
├── 📁 source/
│   └── book.{pdf|docx|fb2} — исходный файл (ТОЛЬКО ЛОКАЛЬНО)
├── 📁 structure/
│   ├── toc.json           — LocalBookStructure (bookId, title, fileName, parts[], toc[])
│   ├── chapters.json      — маппинг index → chapterId
│   └── characters.json    — LocalCharacter[]
├── 📁 scenes/
│   └── chapter_{id}.json  — { chapterId, scenes[], status }
├── 📁 audio/
│   ├── 📁 tts/            — {segmentId}.mp3
│   ├── 📁 atmosphere/     — атмосферные слои
│   └── 📁 renders/        — финальные рендеры сцен
└── 📁 montage/
```

### 1.6 Ключевые файлы кода

| Файл | Назначение |
|------|------------|
| `src/lib/projectStorage.ts` | Интерфейс `ProjectStorage` + классы `LocalFSStorage`, `OPFSStorage` |
| `src/hooks/useProjectStorage.ts` | React-хук: create / open / close / import / export проекта |
| `src/hooks/useProjectStorageContext.tsx` | React Context + Provider для глобального доступа |
| `src/lib/localSync.ts` | `syncStructureToLocal()` / `readStructureFromLocal()` — запись/чтение структуры |
| `src/lib/projectZip.ts` | ZIP экспорт/импорт через `fflate` |
| `src/lib/fileFormatUtils.ts` | Формат-агностические утилиты (PDF/DOCX/FB2) |
| `src/hooks/useImperativeSave.ts` | Мгновенное автосохранение без debounce, сериализованная очередь |
| `src/hooks/useSaveBookToProject.ts` | Кнопка «На сервер»: upsert в Supabase + `autoSaveToLocal()` |

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
│     Обновляет books.updated_at = NOW()                          │
│     Паттерн: leaf-only delete-then-insert для сцен              │
│     Это ЕДИНСТВЕННЫЙ момент, когда серверный таймстамп меняется │
├─────────────────────────────────────────────────────────────────┤
│  4. ОТКРЫТИЕ КНИГИ                                              │
│     Библиотека: читает ТОЛЬКО project.json из каждого проекта   │
│     При выборе книги:                                           │
│       a) Запросить books.updated_at с сервера                   │
│       b) Если серверный > локальный (порог 2 сек) →             │
│          диалог «На сервере есть новая версия. Загрузить?»      │
│       c) Да → полная замена локального проекта серверной копией  │
│       d) Нет → продолжить с локальными данными                  │
│     Затем: toc.json → scenes/ → characters.json → source/       │
├─────────────────────────────────────────────────────────────────┤
│  5. НОВОЕ УСТРОЙСТВО (New Workstation Flow)                     │
│     Книга есть на сервере, но не в OPFS →                       │
│     кнопка «Загрузить с сервера» в библиотеке (⏳ планируется)  │
└─────────────────────────────────────────────────────────────────┘
```

### 1.9 Точки автосохранения

| Триггер | Что записывается | Куда |
|---------|------------------|------|
| `handleFileSelect` (загрузка файла) | project.json + toc.json + chapters.json + source/book.{ext} | Local |
| Анализ главы завершён | `scenes/chapter_{id}.json` | Local |
| Ручная правка TOC (уровень, заголовок, страница) | toc.json + chapters.json | Local |
| Удаление/слияние глав | toc.json + удаление stale scenes/ | Local |
| `openSavedBook` | Восстановление state из local (сервер = фоллбек) | React state |
| Кнопка «На сервер» | chapters + scenes + parts | Supabase |

### 1.10 Синхронизация между устройствами

**Таймстамп — единственный механизм определения «свежести» данных:**

- `project.json.updatedAt` — обновляется **локально** при каждом auto-save (любая правка TOC, анализ, редактирование).
- `books.updated_at` — обновляется **на сервере** только по кнопке «Сохранить на сервер». Это единственный момент.
- Следствие: если серверный таймстамп новее локального — значит, с другого устройства был выполнен push.

**Логика при открытии книги:**

1. Запросить `books.updated_at` с сервера для `bookId`
2. Сравнить с локальным `project.json.updatedAt` (допуск >2 сек)
3. Серверный новее → диалог подтверждения «На сервере версия от [дата]. Загрузить?»
4. Пользователь подтвердил → **полная замена** локального проекта в OPFS серверной копией (TOC, сцены, персонажи, метаданные). Исходный файл скачивается из Supabase Storage если отсутствует локально.
5. Пользователь отказался → работа продолжается с локальными данными

**New Workstation Flow:** если книга есть на сервере, но не в OPFS (новое устройство / очищенный кэш) → кнопка «Загрузить с сервера» в библиотеке (планируется).

**browserId:** уникальный идентификатор среды (localStorage), гарантирует что проверка выполняется однократно для данного окружения.

### 1.11 Критические контракты

#### К1. resolvePageRange — диапазон страниц глав

PDF outline содержит контейнерные узлы (например «Том 2» стр. 3–384). При наивном использовании `entry.startPage`–`entry.endPage` текст главы может оказаться пустым.

**Правило:** при анализе глав (`useChapterAnalysis.ts`) ВСЕГДА использовать `resolveEntryPageRange(idx)` из `src/lib/tocStructure.ts`, а не прямые `startPage/endPage`.

#### К2. Контейнерные узлы TOC

Узлы с `children.length > 0` в PDF outline — это контейнеры (не содержат текста).

**Правило:** при импорте TOC из PDF outline (`useFileUpload.ts`) контейнеры НЕ создаются как главы. Level=0 контейнеры → `partTitle`. Остальные → пропускаются. Фоллбэк: если после фильтрации глав 0 → берём все узлы плоским списком.

### 1.12 Правила целостности библиотеки (Library Integrity Rules)

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

#### LIR-7. Полная замена при скачивании серверной версии

При принятии серверной версии (`acceptServerVersion`) — **ПОЛНОЕ удаление** директории OPFS перед записью. Запрещена инкрементальная мержевая стратегия — она оставляет «призрачные» файлы сцен от старой структуры.

#### LIR-8. Серверная секция библиотеки — только не-локальные книги

`loadServerBooks` фильтрует серверные записи, исключая книги с `id ∈ localBooks.map(b => b.id)`.  
Книга, присутствующая и локально, и на сервере, отображается **ТОЛЬКО** в локальной секции (с индикатором синхронизации).

#### LIR-9. Каскадное удаление на сервере

Удаление книги из серверной секции (`deleteServerBook`) удаляет запись `books` — каскад FK удаляет `book_chapters`, `book_scenes`, `book_parts`, `book_characters`.  
Локальный OPFS проект **НЕ затрагивается** при серверном удалении.

#### LIR-10. Запрет на запись в БД при открытии книги

`openSavedBook` и `restoreFromLocal` — **read-only** по отношению к Supabase.  
Единственная допустимая DB-запись — при ручном нажатии «На сервер» (`saveBook`).

### 1.13 Ограничения

- **OPFS** не даёт пользователю видеть файлы в проводнике — это ограничение API, не баг. ZIP-экспорт решает проблему.
- **FS Access API** — права сбрасываются при перезапуске браузера, потребуется re-pick папки.
- `project.json` — единственный обязательный файл для валидации проекта.

---

## 2. Модульная архитектура Парсера

### 2.1 Декомпозиция хуков

Бизнес-логика Парсера декомпозирована на специализированные хуки:

| Хук | Назначение |
|-----|------------|
| `useBookManager` | Оркестратор: объединяет sub-хуки, управляет жизненным циклом книги |
| `useLibrary` | Загрузка списка проектов из OPFS, fallback на Supabase RPC |
| `useFileUpload` | Импорт PDF/DOCX/FB2, извлечение TOC, создание проекта в OPFS |
| `useBookRestore` | Восстановление сессии из OPFS при открытии книги |
| `useServerSync` | Сравнение таймстампов local vs server, диалог «новая версия» |
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
