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
├─────────────────────────────────────────────────────────────────┤
│  2. РАБОТА (Local-auto-save)                                    │
│     Любая мутация → useImperativeSave → мгновенная запись       │
│     в OPFS/LocalFS. БД НЕ ТРОГАЕТСЯ.                           │
│     beforeunload → flushSave() (принудительный сброс очереди)   │
├─────────────────────────────────────────────────────────────────┤
│  3. СЕРВЕРНАЯ СИНХРОНИЗАЦИЯ (Manual-push)                        │
│     Кнопка «На сервер» → upsert chapters/scenes в Supabase     │
│     Обновляет books.updated_at                                  │
│     Паттерн: leaf-only delete-then-insert для сцен              │
├─────────────────────────────────────────────────────────────────┤
│  4. ВОССТАНОВЛЕНИЕ                                              │
│     При открытии → приоритет: локальное хранилище               │
│     Фоллбек: загрузка из Supabase (новое устройство)            │
│     Конфликт: сравнение updated_at (порог > 2 сек)             │
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
