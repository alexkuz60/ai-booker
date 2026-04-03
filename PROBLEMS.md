# Архив решённых проблем и багов

> Этот файл — **read-only архив**. Новые задачи добавляются в `TODO.md`.
> Актуальная дата: 2026-03-31.

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
| B21 | Сброс pipeline-флагов перевода при перезагрузке браузера | ✅ Исправлено |

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

### Р-bis. Зомби-директории OPFS — ✅ РЕШЕНО (B21)
- Проблема: `OPFSStorage.openOrCreate()` использовался в сканерах (useLibrary, useTranslationStorage, localProjectResolver, bootstrap), создавая пустые папки при поиске проектов. После перезагрузки ПК пустые зомби-проекты персистировали и нарушали логику (пустой проект перевода открывался вместо реального).
- Инвариант: **`openOrCreate` — ТОЛЬКО по явному действию пользователя** (4 точки: createProject, importFromZip, createTranslationProject, restoreTranslation). Все сканеры/бутстрапы — строго `openExisting`.
- Решение: замена всех `openOrCreate` → `openExisting` в 11 точках по 8 файлам (сканеры, бутстрап, резолверы). `openOrCreate` оставлен только для 4 легитимных создателей. См. ARCHITECTURE.md §1.6a.
- Файлы: `useTranslationStorage.ts`, `localProjectResolver.ts`, `useProjectStorage.ts`, `useBookRestore.ts`, `projectCleanup.ts`, `useLibrary.ts`, `translationProject.ts`, `useSaveTranslation.ts`.

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

### Т. Зомби-скан удаляет проекты-зеркала перевода — ✅ УСТАРЕЛО (B21)
- Проблема: зеркальные OPFS-проекты перевода (`Book_EN`) имели тот же `bookId` и попадали под удаление при Wipe-and-Deploy.
- Решение (v1): mirror-фильтрация по `targetLanguage`/`sourceProjectName`.
- Решение (v2, текущее): **зеркальная архитектура полностью удалена**. Переводы хранятся в `{lang}/` подпапках внутри единого проекта. `ProjectMeta` больше не содержит `targetLanguage`, `sourceProjectName`, `translationProject`. Wipe удаляет все папки с bookId без mirror-проверок.
- Файлы: `src/lib/projectCleanup.ts`, `src/lib/localProjectResolver.ts`, `src/lib/projectStorage.ts`.

### У. Bootstrap авто-детект — ✅ ОТКАТАНО (B22)
- Проблема: при отсутствии `LAST_PROJECT_KEY` в localStorage была добавлена логика сканирования OPFS для автоматического выбора «лучшего» проекта. Это создавало ложную надёжность и лишние обращения к OPFS на каждом монтировании.
- Решение: откат к исходной простой схеме: `localStorage` → `LAST_PROJECT_KEY` → открыть проект. Если ключа нет — проекта нет. Это проверенная модель, работающая для Парсера и Студии.
- Принцип: **не маскировать потерю состояния заплатками**. Если `LAST_PROJECT_KEY` пропал — это баг upstream, а не повод для авто-восстановления.
- Файл: `src/hooks/useProjectStorage.ts`.

### Ф. Дублирование пресетов AI-ролей — ✅ РЕШЕНО (B23)
- Проблема: при сохранении пресета поле «Имя пресета» оставалось пустым (placeholder), из-за чего логика Update-or-Create не находила совпадения по имени и каждый раз создавала новый пресет вместо обновления существующего. Для книги «Собачье сердце» накопилось 10+ дубликатов.
- Решение: при открытии диалога сохранения поле автоматически заполняется названием текущей книги (`bookTitle`). Логика сохранения сравнивает имена регистронезависимо.
- Файл: `src/components/profile/tabs/AiRolePresets.tsx`.

### Х. Пресеты не сохраняли выбор OpenRouter-моделей — 🔍 ОТКРЫТО (B24)
- Проблема: после сохранения и загрузки пресета с OpenRouter-моделями пайплайн перевода получал модель Lovable AI (с исчерпанным лимитом), что вызывало ошибку 402.
- Частичное решение: пресеты теперь сохраняют `currentOverrides` вместо `resolvedModels`, а `loadPreset` применяет все модели из пресета как overrides.
- Статус: **требует дополнительного расследования** — гипотеза о фоллбэке на дефолты при отсутствии ключа несостоятельна (без ключа модели не отображаются в списке). Реальная причина где-то в цепочке loadPreset → getModelForRole → edge function.
- Файлы: `src/components/profile/tabs/AiRolePresets.tsx`, `src/hooks/useAiRoles.ts`.
- См. TODO.md: «Расследовать фоллбэк на Lovable AI при загрузке пресета».

### Ц. Индикатор перевода показывал «Сцены: 0/1» вместо прогресса сегментов — ✅ РЕШЕНО (B25)
- Проблема: при запуске пайплайна для одной сцены счётчик в панели прогресса отображал «Сцены: 0/1» и не обновлялся до завершения, вместо показа посегментного прогресса «Сегменты: X/Y».
- Решение: `useTranslationBatch` инициализирует `currentStage` немедленно при старте пайплайна, до получения первого ответа от модели.
- Файл: `src/hooks/useTranslationBatch.ts`.

### Ш. Потеря translation-зеркала после рестарта браузера — ✅ РЕШЕНО (B26)
- Проблема: `useTranslationStorage` получал `sourceStorage=null` до инициализации контекста → `exists: false`.
- Решение: Translation.tsx ждёт `initialized` (спиннер). One-shot разрешение зеркала: backlink → localStorage → каноническое имя через `openExisting`.
- Файлы: `Translation.tsx`, `useTranslationStorage.ts`.

### Щ. Таймлайн и сайдбар не синхронизировались с прогрессом — ✅ РЕШЕНО (B27)
- Проблема: ручное переключение чекбоксов в контекстном меню таймлайна записывало `pipelineProgress` в OPFS, но сайдбар не обновлял гейтинг — пункты оставались заблокированными. При загрузке книги с сервера таймлайн и меню не отражали сохранённый прогресс из `project.json`.
- Решение: реактивный счётчик `progressVersion` в `ProjectStorageContext`. Любое изменение прогресса (ручное, restore, deploy) вызывает `bumpProgressVersion()` → `usePipelineProgress` и `usePipelineGating` перечитывают данные из OPFS.
- Файлы: `useProjectStorage.ts`, `useProjectStorageContext.tsx`, `usePipelineProgress.ts`, `usePipelineGating.ts`, `useBookRestore.ts`, `LibraryView.tsx`.

### Э. Потеря pipelineProgress при Push to Server — ✅ РЕШЕНО (B28)
- Проблема: при нажатии «На сервер» (`useSaveBookToProject.saveBook`) формирование `nextMeta` конструировалось вручную с перечислением полей, без spread существующего `freshMeta`. Поля `pipelineProgress`, `translationProject`, `fileFormat`, `usedImpulseIds` терялись → чекбоксы «Готово» для Студии/Раскадровки и Парсера (персонажи, профайлы) сбрасывались.
- Корневая причина: ручная конструкция `nextMeta: ProjectMeta = { version, bookId, title, ... }` вместо `{ ...freshMeta, version, bookId, title, ... }`.
- Решение: spread `...freshMeta` в начале объекта `nextMeta` → все существующие поля сохраняются, явные поля (version, bookId, updatedAt и др.) перезаписывают только то, что нужно обновить.
- Инвариант: **ЗАПРЕЩЕНО** конструировать `nextMeta` с перечислением полей — только через spread.
- Файл: `src/hooks/useSaveBookToProject.ts`.

### Ю. Ошибка RLS при повторном сохранении перевода — ✅ РЕШЕНО (B29)
- Проблема: повторная загрузка ZIP перевода в бакет `book-uploads` (с `upsert: true`) блокировалась RLS-политикой: `"new row violates row-level security policy"` (HTTP 403).
- Корневая причина: для бакета `book-uploads` существовали RLS-политики INSERT, SELECT и DELETE, но **отсутствовала политика UPDATE**. `upsert: true` в Supabase Storage требует и INSERT, и UPDATE прав.
- Решение: добавлена миграция `CREATE POLICY "Users can update own books" ON storage.objects FOR UPDATE`.
- Файлы: миграция `add_update_policy_book_uploads`.

### Я. Автосоздание пустых проектов перевода — ✅ РЕШЕНО (B30)
- Проблема: `openOrCreate` в read-only контекстах создавал пустые OPFS-папки → «зомби-проекты».
- Решение: все read-only точки используют `openExisting`. `openOrCreate` — только при явном создании пользователем.
- Инвариант: `openOrCreate` допустим ТОЛЬКО в 4 точках: createProject, importZip, createTranslationProject, restoreTranslation.
- Файлы: `useProjectStorage.ts`, `useLibrary.ts`, `LibraryView.tsx`, `localProjectResolver.ts`, `projectCleanup.ts`, `useBookRestore.ts`, `translationProject.ts`, `Translation.tsx`.

### Ф. Сброс pipeline-флагов перевода при перезагрузке — ✅ РЕШЕНО (B21)
- Проблема: конкурентные записи в `project.json` при холодном старте перезаписывали метаданные без `pipelineProgress`.
- Решение: `readProjectMetaForWrite()` с retry при первом `null`, блокировка записи если meta остаётся `null`. `useLibrary` фильтрует зеркала по суффиксу `_EN`/`_RU`.
- Файлы: `usePipelineProgress.ts`, `translationProject.ts`, `useLibrary.ts`, `useTranslationStorage.ts`.

### АА. Потеря профайлов персонажей после восстановления с сервера — ✅ РЕШЕНО (B31)
- Проблема: после Wipe-and-Deploy профайлы персонажей (description, temperament, speech_style, speech_tags, psycho_tags) отображались как пустые, хотя данные присутствовали в БД. В `characters.json` данные хранились только во вложенном объекте `profile`, а UI читал верхнеуровневые поля (description, temperament и др.), которые были `null`.
- Корневая причина: `serverDeploy.ts` при восстановлении записывал профайльные поля только на верхний уровень `CharacterIndex`, но при последующих чтениях/записях промежуточный код мог терять эту структуру. Отсутствовала нормализация при чтении из OPFS.
- Решение: добавлена функция `normalizeProfileFields()` в `localCharacters.ts`, которая при каждом чтении `characters.json` зеркалирует данные между верхнеуровневыми полями и вложенным `profile`. Функция `applyProfiles()` в `useCharacterProfiles.ts` и `serverDeploy.ts` теперь обновляют оба уровня одновременно.
- Инвариант: **профайльные поля ОБЯЗАНЫ присутствовать на обоих уровнях** (`CharacterIndex.description` и `CharacterIndex.profile.description`). Нормализация выполняется при чтении.
- Файлы: `src/lib/localCharacters.ts`, `src/hooks/useCharacterProfiles.ts`, `src/lib/serverDeploy.ts`.

---

## Защита от регрессий

Для предотвращения повторения исправленных багов созданы автоматические тесты:
- `src/lib/__tests__/fileFormatUtils.test.ts` — формат-агностическая обработка (B14)
- `src/lib/__tests__/pdfMerge.test.ts` — сохранение иерархии TOC (B5)
- `src/lib/__tests__/localSync.test.ts` — roundtrip локального хранилища (B9, B11)
- `src/lib/__tests__/tocStructure.test.ts` — resolvePageRange и контейнерные узлы (К1, К2)
- `src/lib/__tests__/storageGuard.test.ts` — whitelist-only delete, блокировка защищённых файлов, integrity check (B32)

### ВВ. Потеря данных сцен при восстановлении сессии — ✅ РЕШЕНО (B32)
- Проблема: legacy-логика «stale cleanup» в `syncStructureToLocal()` при каждой синхронизации структуры сканировала OPFS-папки глав и сцен и удаляла «осиротевшие» директории. При рестарте браузера и повторной синхронизации TOC из OPFS эта логика ошибочно классифицировала папки сцен как «устаревшие» и рекурсивно удаляла их содержимое: `audio_meta.json`, `clip_plugins.json`, `mixer_state.json`, языковые поддиректории перевода (`{lang}/`) со всеми результатами.
- Корневая причина: `syncStructureToLocal` вызывался из `restoreFromLocal` (при восстановлении сессии) → stale cleanup запускался при КАЖДОМ открытии книги, а не только при изменении структуры.
- Решение (3 уровня):
  1. **Удаление stale cleanup**: из `localSync.ts` полностью удалён код автоматического удаления папок. Функция стала строго write-only.
  2. **guardedDelete() + whitelist**: создан `src/lib/storageGuard.ts` — единственный разрешённый способ удаления файлов внутри проекта. Белый список ограничен: storyboard.json, audio/. Структурные файлы заблокированы.
  3. **snapshotBeforeWipe()**: автоматический ZIP-бэкап перед Wipe-and-Deploy. assertIntegrity() — пост-операционная проверка.
- Инвариант: **АБСОЛЮТНЫЙ ЗАПРЕТ на автоматическое удаление файлов/папок в OPFS**. Удаление — только по явному действию пользователя и только через `guardedDelete()`.
- Файлы: `src/lib/localSync.ts`, `src/lib/storageGuard.ts`, `src/lib/projectCleanup.ts`, `src/hooks/useBookRestore.ts`, `src/lib/storyboardSync.ts`.
