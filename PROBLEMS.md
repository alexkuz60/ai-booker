# Архив решённых проблем и багов

> Этот файл — **read-only архив**. Новые задачи добавляются в `TODO.md`.
> Актуальная дата: 2026-03-29.
> Актуальная дата: 2026-03-28.

---

## Решённые архитектурные вопросы

### А. Синхронизация данных — ✅ РЕШЕНО
- Исходный файл (PDF/DOCX/FB2) **никогда** не покидает устройство. Хранится в ProjectStorage.
- На сервер уходят только текстовые блоки и метаданные (при ручном пуше).
- Жизненный цикл: Инициализация → Local-auto-save → Manual-push → Wipe-and-Deploy (при восстановлении).

### В. Маршрутизация ИИ-провайдеров — ✅ РЕШЕНО
- Edge functions поддерживают пользовательский роутинг (`model` + `apiKey`).
- Lovable AI — только для админов. Каскадный fallback на клиенте через `invokeWithFallback`.
- Унифицированный серверный роутинг через `_shared/providerRouting.ts`.

### Г. Inline-нарротации — ✅ РЕШЕНО
- Детект — Профайлер. UI — Раскадровка. Хранение — `segment_phrases.metadata`.

### Д. Навигатор и БД — ✅ РЕШЕНО
- NavSidebar работает с React-стейтом и OPFS. Синхронизация — только «На сервер».

### Е. Поддержка мульти-форматов — ✅ РЕШЕНО
- PDF, DOCX, FB2 через формат-агностический API (`fileFormatUtils.ts`).
- Автодетект формата, единые утилиты для всех операций.

### Ж. Модульность Парсера — ✅ РЕШЕНО
- Бизнес-логика декомпозирована на 6+ специализированных хуков.
- `Parser.tsx` (~640 строк) — чистый оркестратор.

---

## Архив багов (B1–B14)

| ID | Описание | Статус |
|----|----------|--------|
| B1 | `reloadBook` делает INSERT вместо UPDATE | ✅ Исправлено |
| B2 | PDF folder-ноды не помечаются `done` | ✅ Исправлено |
| B3 | `reloadBook` не очищает `sessionStorage` | ✅ Исправлено |
| B4 | DOCX-mode теряется после refresh | ✅ Исправлено |
| B5 | `mergeOutlineWithTextToc` уплощает иерархию | ✅ Исправлено |
| B6 | `handleFileSelect` безусловный INSERT (= B1) | ✅ Исправлено |
| B7 | `ensurePdfLoaded` для DOCX → null (= B4) | ✅ Исправлено |
| B8 | Молчаливый null при отсутствии PDF на сервере | ✅ Исправлено |
| B9 | Библиотека читает `toc.json` и запрашивает сервер | ✅ Исправлено |
| B10 | `openSavedBook` не проверяет серверный таймстамп | ✅ Исправлено |
| B11 | `restoreFromLocal` не читает персонажей | ✅ Исправлено |
| B12 | `acceptServerVersion` не заменяет локалку | ✅ Исправлено |
| B13 | `openSavedBook` делает upsert при чтении | ✅ Исправлено |
| B14 | Хардкод `source/book.pdf` — DOCX/FB2 не работает | ✅ Исправлено |
| B15 | Stale scene data after merge/delete in Parser | ✅ Исправлено |
| B16 | Автозапуск анализа при выборе главы в навигаторе | ✅ Исправлено |
| B17 | Фантомные персонажи после перезагрузки книги | ✅ Исправлено |
| B18 | Ложные dirty-маркеры после ручных правок раскадровки | ✅ Исправлено |
| B19 | SFX-клипы не отображаются после обновления страницы | ✅ Исправлено |
| B20 | Некорректная ширина клипа после сброса/изменения скорости | ✅ Исправлено |

### М. Ложные dirty-маркеры после правок раскадровки — ✅ РЕШЕНО (B18)
- Проблема: `StoryboardSnapshot` не включал `contentHash` → при `persist()` после ручных правок (слияние фраз, смена спикера) хеш терялся из `storyboard.json`. При перезагрузке `ChapterNavigator` сравнивал `undefined` с хешем из `scene_index` → ложный dirty-маркер «Сделайте переанализ».
- Инвариант: `contentHash` **ОБЯЗАН** присутствовать в каждом `StoryboardSnapshot` и сохраняться при ЛЮБЫХ ручных правках. См. ARCHITECTURE.md §1.11.
- Решение: добавлен `contentHash?: number` в `StoryboardSnapshot`, `contentHashRef` в `StoryboardPanel`, `buildSnapshot()` всегда включает текущий хеш. Dirty-маркеры переведены на явные флаги `dirtyScenes[]` в `scene_index.json` — устанавливаются Парсером только при изменении contentHash для сцен с существующей раскадровкой (DNI-1), сбрасываются Студией при переанализе. Runtime-сравнение хешей больше не используется.
- Файлы: `useStoryboardPersistence.ts`, `StoryboardPanel.tsx`, `sceneIndex.ts`.

### Н. Восстановление сессии после перезагрузки ПК — ✅ РЕШЕНО (B15-old)
- Браузеры восстанавливают `sessionStorage` после перезапуска → стейл `ACTIVE_BOOK_KEY` открывал вчерашнюю книгу.
- Решение: heartbeat-таймстамп в `localStorage` (5 мин порог). При стейл-сессии — сброс в библиотеку.
- Файл: `useBookManager.ts` (heartbeat guard + effects).

### О. Stale scene data после слияния/удаления сцен — ✅ РЕШЕНО (B15)
- При слиянии или удалении сцен в Парсере `buildSceneIndex` переносил массивы `storyboarded`/`characterMapped` as-is из старого индекса → удалённые sceneId оставались «призраками».
- OPFS-папки удалённых сцен (storyboard.json, characters.json) не очищались.
- Решение: `buildSceneIndex` фильтрует storyboarded/characterMapped по валидным entries; `syncStructureToLocal` удаляет orphan scene directories.
- Файлы: `sceneIndex.ts`, `localSync.ts`.

### П. Автозапуск анализа при выборе главы — ✅ РЕШЕНО (B16)
- `NavSidebar.onClick` автоматически вызывал `onAnalyzeChapter(idx)` для pending глав.
- Решение: убран auto-trigger из навигатора. Анализ — строго по кнопке в панели деталей.
- Файл: `NavSidebar.tsx`.

### B17. Фантомные персонажи после перезагрузки книги — ✅ РЕШЕНО
- Проблема: `characters.json` находится в корне проекта, а не внутри `chapters/`, поэтому при Reload Book он выживал. Содержащиеся в нём `appearances` ссылались на удалённые scene/chapter ID.
- Инвариант: **реестр персонажей жёстко привязан к структуре сцен**. При любом пересоздании структуры (reload, wipe-and-deploy) персонажи должны быть очищены и перестроены с нуля, т.к. ИИ-анализ недетерминирован.
- Решение: `reloadBook` теперь удаляет `characters.json` вместе с `chapters/`.
- Файл: `useBookManager.ts`.

### Р. SFX-клипы не отображаются после обновления страницы — ✅ РЕШЕНО (B19)
- Проблема: `readAtmospheresFromLocal` использовала `atmoPath(sceneId)`, который вызывает `resolveChapterId()` из кэша `sceneIndex`. После F5 кэш пуст → путь содержит `__unresolved__` → файл не читается → клип не отображается. Атмосфера-клипы работали, если загружались позже (когда кэш уже заполнялся другими операциями).
- Решение: добавлен fallback `readSceneIndex(storage)` при обнаружении `__unresolved__` в пути — аналогично существующему паттерну в `storyboardSync`. Fallback добавлен во все функции модуля: `readAtmospheresFromLocal`, `saveAtmospheresToLocal` (транзитивно защищает `addAtmosphereClip`, `deleteAtmosphereClip`, `updateAtmosphereClip`).
- Файл: `src/lib/localAtmospheres.ts`.

### С. Некорректная ширина клипа после сброса/изменения скорости — ✅ РЕШЕНО (B20)
- Проблема: оптимистичные дельты ресайза (`optimisticResizes`) не очищались при обновлении данных из OPFS. `prevClipsRef.current` обновлялся ДО проверки на изменение клипов → условие сброса `optimisticResizes` было недостижимо → старые дельты накладывались на новые реальные длительности.
- Решение: консолидация очистки — `prevClipsRef.current`, `optimisticOffsets` и `optimisticResizes` сбрасываются в едином блоке `if (realClips !== prevClipsRef.current)`.
- Файл: `src/components/studio/TimelineTrack.tsx`.

---

### П. Чистка мёртвого кода студии (2026-03-28) — ✅ РЕШЕНО

Удалено 13 единиц dead code из 10 файлов. Перечень для возможного отката:

| Файл | Удалённый импорт/экспорт |
|------|--------------------------|
| `StudioTimeline.tsx` | `Plus` (lucide), `SetStateAction` (react), пустая кнопка-заглушка (строки 933-934) |
| `TrackMixerStrip.tsx` | `useRef` |
| `ChannelPluginsPanel.tsx` | `getAudioEngine` |
| `CharactersPanel.tsx` | `readSceneContentFromLocal` |
| `StoryboardPanel.tsx` | `Json`, `Database` (types), `readCharactersFromLocal`, `readSceneContentFromLocal` |
| `AtmospherePanel.tsx` | `Switch`, `Label` |
| `MasterMeterPanel.tsx` | `Button`, `MasterMeterData` |
| `FinishedChaptersPanel.tsx` | `Loader2` |
| `CastingCandidatesPanel.tsx` | `useMemo` |
| `audioEngine.ts` | `resetAudioEngine()` — функция-экспорт, нигде не вызывалась |

Также ранее удалены «велосипеды» (заменены на Tone.js-native):
- Ручной loop через RAF `seek()` → `transport.loop/loopStart/loopEnd`
- End-of-timeline polling в RAF → `transport.scheduleOnce()`
- `Math.log10` в VuSlider/sceneRenderer/chapterRenderer → `Tone.gainToDb()`/`Tone.dbToGain()`
- `addTrack` polling → `Tone.loaded()`

---

### Т. Зомби-скан удаляет проекты-зеркала перевода — ✅ РЕШЕНО (B21)
- Проблема: `wipeProjectBrowserState` при восстановлении книги (Wipe-and-Deploy) сканировал OPFS на «зомби» по `bookId`. Зеркальные проекты арт-перевода (например, `Book_EN`) имеют тот же `bookId`, что и исходный проект — они попадали под удаление.
- Решение: зомби-скан в `projectCleanup.ts` явно пропускает проекты с `targetLanguage` или `sourceProjectName` в метаданных. Также `booker_last_project` не очищается при целевом wipe (только при `hardReset`), чтобы контекст сессии сохранялся.
- Инвариант: **зеркальные проекты перевода неприкосновенны при wipe исходного проекта**. Удаление зеркала — только при ручном удалении или `hardResetLocalData`.
- Файлы: `src/lib/projectCleanup.ts`, `src/hooks/useProjectStorage.ts`.

### У. Bootstrap авто-детект — ✅ ОТКАТАНО (B22)
- Проблема: при отсутствии `LAST_PROJECT_KEY` в localStorage была добавлена логика сканирования OPFS для автоматического выбора «лучшего» проекта. Это создавало ложную надёжность и лишние обращения к OPFS на каждом монтировании.
- Решение: откат к исходной простой схеме: `localStorage` → `LAST_PROJECT_KEY` → открыть проект. Если ключа нет — проекта нет. Это проверенная модель, работающая для Парсера и Студии.
- Принцип: **не маскировать потерю состояния заплатками**. Если `LAST_PROJECT_KEY` пропал — это баг upstream, а не повод для авто-восстановления.
- Файл: `src/hooks/useProjectStorage.ts`.

---

## Защита от регрессий

Для предотвращения повторения исправленных багов созданы автоматические тесты:
- `src/lib/__tests__/fileFormatUtils.test.ts` — формат-агностическая обработка (B14)
- `src/lib/__tests__/pdfMerge.test.ts` — сохранение иерархии TOC (B5)
- `src/lib/__tests__/localSync.test.ts` — roundtrip локального хранилища (B9, B11)
- `src/lib/__tests__/tocStructure.test.ts` — resolvePageRange и контейнерные узлы (К1, К2)
