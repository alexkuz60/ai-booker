# Архитектура AI-Booker

> Единый справочник кодовой архитектуры проекта.  
> Цель: дать ИИ-ассистенту (и разработчику) однозначное понимание, где хранятся данные, как они перемещаются и какие файлы за что отвечают — без необходимости искать истину по разным документам.

---

## 1. Local-First архитектура (ProjectStorage)

### 1.1 Принцип

Пользователь работает с **локальной папкой проекта** на своём устройстве. Облачная синхронизация — **опциональна и инициируется только пользователем** (кнопка «На сервер»).

Локальное хранилище — **единственный primary source of truth** во время работы.

### 1.2 Правило PDF-эксклюзивности

**Исходный файл книги (PDF) НИКОГДА не покидает устройство пользователя.**

- PDF хранится в `source/book.pdf` внутри ProjectStorage и читается оттуда при необходимости.
- На сервер отправляются **ТОЛЬКО**:
  - Извлечённые текстовые блоки глав → для семантического анализа ИИ (edge functions).
  - Текст фраз/сегментов → для запросов на TTS-синтез.
  - Структурные метаданные (TOC, части, главы, сцены) → при ручном пуше «На сервер».

### 1.3 Бэкенды хранения

| Бэкенд | Браузеры | Видимость файлов | Детект |
|--------|----------|-------------------|--------|
| `LocalFSStorage` (File System Access API) | Chrome, Edge, Opera | Видны в проводнике ОС | `showDirectoryPicker` в `window` |
| `OPFSStorage` (Origin Private File System) | Firefox, Safari | Скрыты (только через ZIP-экспорт) | `navigator.storage.getDirectory` |

Автодетект: `detectStorageBackend()` → `"fs-access"` | `"opfs"` | `"none"`.

### 1.4 Структура папки проекта

```
📁 BookTitle/
├── project.json           — ProjectMeta (version, bookId, title, userId, language)
├── 📁 source/
│   └── book.pdf           — исходный PDF (ТОЛЬКО ЛОКАЛЬНО)
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

### 1.5 Ключевые файлы кода

| Файл | Назначение |
|------|------------|
| `src/lib/projectStorage.ts` | Интерфейс `ProjectStorage` + классы `LocalFSStorage`, `OPFSStorage` |
| `src/hooks/useProjectStorage.ts` | React-хук: create / open / close / import / export проекта |
| `src/hooks/useProjectStorageContext.tsx` | React Context + Provider для глобального доступа |
| `src/lib/localSync.ts` | `syncStructureToLocal()` / `readStructureFromLocal()` — запись/чтение структуры |
| `src/lib/projectZip.ts` | ZIP экспорт/импорт через `fflate` |
| `src/hooks/useImperativeSave.ts` | Мгновенное автосохранение без debounce, сериализованная очередь |
| `src/hooks/useSaveBookToProject.ts` | Кнопка «На сервер»: upsert в Supabase + `autoSaveToLocal()` |

### 1.6 Интерфейс ProjectStorage

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

### 1.7 Жизненный цикл данных

```
┌─────────────────────────────────────────────────────────────────┐
│  1. ИНИЦИАЛИЗАЦИЯ                                               │
│     PDF upload → createProject() → project.json + source/book.pdf│
│     Запись начальной структуры (TOC, parts) в structure/        │
│     Dual-write: INSERT в Supabase (books, chapters, parts)      │
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
│     автоматическая инициализация локальной структуры из БД      │
└─────────────────────────────────────────────────────────────────┘
```

### 1.8 Точки автосохранения

| Триггер | Что записывается | Куда |
|---------|------------------|------|
| `handleFileSelect` (загрузка PDF) | project.json + toc.json + chapters.json + source/book.pdf | Local |
| Анализ главы завершён | `scenes/chapter_{id}.json` | Local |
| Ручная правка TOC (уровень, заголовок, страница) | toc.json + chapters.json | Local |
| Удаление/слияние глав | toc.json + удаление stale scenes/ | Local |
| `openSavedBook` | Восстановление state из local (сервер = фоллбек) | React state |
| Кнопка «На сервер» | chapters + scenes + parts | Supabase |

### 1.9 Синхронизация между устройствами

- Серверный `updated_at` обновляется **только** при ручном пуше.
- При открытии книги: если серверная версия новее локальной на >2 сек → предложение загрузить.
- Проверка выполняется **один раз** для конкретного `browserId` (localStorage), без повторов при обновлении страницы.
- Если книга есть на сервере, но не локально (новое устройство) → автоматическая инициализация локальной структуры.

### 1.10 Критические контракты

#### К1. resolvePageRange — диапазон страниц глав

PDF outline содержит контейнерные узлы (например «Том 2» стр. 3–384). При наивном использовании `entry.startPage`–`entry.endPage` текст главы может оказаться пустым.

**Правило:** при анализе глав (`useChapterAnalysis.ts`) ВСЕГДА использовать `resolveEntryPageRange(idx)` из `src/lib/tocStructure.ts`, а не прямые `startPage/endPage`.

#### К2. Контейнерные узлы TOC

Узлы с `children.length > 0` в PDF outline — это контейнеры (не содержат текста).

**Правило:** при импорте TOC (`useBookManager.ts`) контейнеры НЕ создаются как главы. Level=0 контейнеры → `partTitle`. Остальные → пропускаются. Фоллбек: если после фильтрации глав 0 → берём все узлы плоским списком.

### 1.11 Ограничения

- **OPFS** не даёт пользователю видеть файлы в проводнике — это ограничение API, не баг. ZIP-экспорт решает проблему.
- **FS Access API** — права сбрасываются при перезапуске браузера, потребуется re-pick папки.
- `project.json` — единственный обязательный файл для валидации проекта.

---

## 2. Роль «Сценарист» (screenwriter) — двухэтапная работа

### 2.1 Парсер: определение границ сцен

Сценарист определяет **границы сцен** для выбранного пункта в Навигаторе структуры книги.

**Обязательный контроль границ:**
- Нумерация страниц книги (PDF page range через `resolveEntryPageRange`)
- Количество знаков контента (`char_count` в каждой сцене)

**Ключевые файлы:**
| Файл | Назначение |
|------|------------|
| `src/hooks/useChapterAnalysis.ts` | Оркестрирует AI-анализ: PDF → текст → edge function → сцены |
| `supabase/functions/parse-book-structure/index.ts` | Edge function: LLM определяет границы сцен |
| `src/pages/parser/types.ts` | `Scene`, `Chapter`, `Part`, `BookStructure` |

### 2.2 Студия / Раскадровка: типизация блоков

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

## 3. Маршрутизация AI-провайдеров (chat-модели)

> TTS-модели имеют отдельную логику маршрутизации (будет описана позже).

### 3.1 Провайдеры и приоритеты

| Приоритет (пользователь) | Приоритет (админ) | Провайдер | Тип подключения | Условие доступа |
|---|---|---|---|---|
| 1 | 2 | **Директ-подписка** (OpenAI, Anthropic, Google и т.д.) | Брендовый API-ключ | Ключ в `profiles.api_keys` |
| 2 | 3 | **OpenRouter** | Роутер | Ключ `openrouter` в `profiles.api_keys` |
| 3 | 3 | **DotPoint** ≡ **ProxyAPI** | Роутер (RU) | Ключ `dotpoint` / `proxyapi`; равноприоритетны, выбор пользователя |
| — | **1** | **Lovable AI** | Встроенный шлюз | Только для админов (`has_role('admin')`) |

### 3.2 Пользовательские списки моделей

Каждый роутер (OpenRouter, ProxyAPI, DotPoint) имеет **пользовательский список моделей** — набор моделей, выбранных пользователем из каталога провайдера и сохранённых в Cloud Settings.

- `openrouter-user-models` → список моделей OpenRouter
- `proxyapi-user-models` → список моделей ProxyAPI
- (DotPoint — аналогично)

Модель доступна для назначения на роль **только если**:
1. У пользователя есть ключ соответствующего провайдера
2. Модель присутствует в пользовательском списке этого провайдера

### 3.3 Логика фоллбэков (chat-модели)

```
┌─────────────────────────────────────────────────────────────────┐
│  1. Попытка использовать модель, назначенную на роль            │
│     ✅ Ключ провайдера есть → отправить запрос                  │
│     ❌ Ключ отсутствует → перейти к п.2                         │
├─────────────────────────────────────────────────────────────────┤
│  2. Поиск аналога по приоритету провайдеров                     │
│     Перебираем провайдеры по приоритету (§3.1).                 │
│     Для каждого: есть ли в пользовательском списке модель       │
│     того же класса (tier: lite/standard/heavy)?                 │
│     ✅ Найдена → использовать                                   │
│     ❌ Нет аналога ни у одного провайдера → перейти к п.3       │
├─────────────────────────────────────────────────────────────────┤
│  3. Диалог-совет пользователю                                   │
│     «Модель [X] недоступна. Добавьте аналогичную модель         │
│     в пользовательский список [провайдер]. Если модель           │
│     отсутствует у провайдера — выберите другую для роли [Y].»   │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 Разрешение модели в Edge Functions

Edge-функции получают `model` и `apiKey` от клиента. Логика:

1. Определить провайдер по префиксу модели (`proxyapi/`, `openrouter/`, `lovable/` и т.д.)
2. Для Lovable AI — проверить `has_role('admin')`; отклонить если не админ
3. Очистить префикс провайдера перед отправкой на upstream API
4. При ошибке upstream — **не делать** автоматический фоллбек на сервере; вернуть ошибку клиенту для обработки по §3.3

### 3.5 Ключевые файлы

| Файл | Назначение |
|------|------------|
| `src/config/modelRegistry.ts` | Реестр моделей: id, провайдер, pricing, apiKeyField |
| `src/hooks/useAiRoles.ts` | Разрешение модели для роли: override > default |
| `src/hooks/useUserApiKeys.ts` | Загрузка API-ключей пользователя из profiles |
| `src/components/ModelSelector.tsx` | UI выбора модели с группировкой по провайдерам |
| `supabase/functions/_shared/proxyapi.ts` | Маппинг моделей ProxyAPI + определение endpoint |
