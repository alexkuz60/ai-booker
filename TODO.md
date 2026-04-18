# TODO — AI-Booker

> Список задач, собранных по ходу обсуждения архитектуры и аудита кода.
> Актуальная дата: 2026-04-13.

---

## Рефакторинг — Снижение сложности

- [x] **BookerProSection** (515→140 строк) — извлечены `GpuStatusCard.tsx`, `ModelDownloadPanel.tsx`
- [x] **Narrators.tsx** (1026→720 строк) — извлечены `SliderField` → `src/components/ui/`, `voiceMatching.ts` → `src/lib/`
- [ ] **VoiceConversionTab** (587 строк) — кандидат на дробление при росте (VcPipelineTest, VcConfigForm)
- [ ] **StudioWorkspace** — оценить и разбить по панелям
- [ ] **Feature-модуль VC** — `src/features/voice-conversion/` с barrel exports
- [ ] **Unit-тесты VC** — vcModelCache, vcRmvpe padding, vcPipeline flow
- [ ] **VC_ARCHITECTURE.md** — граф зависимостей моделей, порядок инициализации

---

## Производительность / Оптимизация

- [x] **Устранение каскадных ре-рендеров в Парсере** — мемоизация LibraryView, стабилизация ProjectStorageContext и PageHeaderProvider, shallow-compare в setPageHeader. CPU idle → ~0%
- [x] **Устранение каскадных ре-рендеров в Студии** — обёртка headerRight в useMemo, стабилизация зависимостей useEffect для setPageHeader. CPU idle снижен с ~25% до ~15%
- [x] **Остановка RAF-циклов метров в idle** — TimelineMasterMeter, LargeMeterSingleChannel, PeakMeterSection, SpectrumAnalyzer подписаны на engine.state; RAF запускается только при playing, в idle рисуется один статичный кадр. CPU idle снижен с ~15% до ~5%
- [ ] **Финальная оптимизация метров/спектра** — вернуться после завершения аудио-функционала: проверить throttle частоты обновления при воспроизведении (30fps вместо 60fps для метров), убедиться что SpectrumAnalyzer полностью останавливает analyser node в idle

---

## Студия — UX раскадровки

- [x] **Визуальный контроль этапов раскадровки** — реализован через PipelineTimeline в Библиотеке (project.json.pipelineProgress). См. ARCHITECTURE.md §1.10

---

## VoiceLab — OmniVoice: расширенные параметры выразительности

> Сервер OmniVoice (k2-fsa + maemreyo/omnivoice-server) поддерживает богатый набор параметров синтеза,
> которые напрямую влияют на выразительность художественной озвучки. Тема большая и перспективная —
> VoiceLab остаётся основной площадкой для исследований.

### Этап 1 — Эксперимент (ручной прогон)

Цель: подобрать рабочие диапазоны параметров на слух до коммита в UI.

- [ ] **Тест-план по сериям** — один референс + один драматический текст, меняем по одному параметру:
  - `guidance_scale` (1.5 / 3.0 / 5.0 / 7.0) — характерность тембра vs естественность
  - `position_temperature` (0 / 2 / 5 / 8) — вариативность интонаций между прогонами
  - `class_temperature` (0 / 0.3 / 0.7 / 1.0) — живость сэмплинга токенов
  - `num_step` (16 / 32 / 48) — качество vs латентность (пресеты Draft / Standard / Final)
  - `t_shift` (0 / 0.3 / 0.7) — характер атаки/окончания фраз
- [ ] **Debug-панель в OmniVoice** (опционально) — временные слайдеры для прогона серий через UI вместо curl

### Этап 2 — Интеграция в UI (после эксперимента)

- [ ] **Advanced-блок в OmniVoice панели** (collapsible) — слайдеры guidance_scale / position_temp / class_temp + селектор num_step (Draft/Standard/Final)
- [ ] **Маппинг психотипов → OmniVoice params** — расширить `psychotypeVoicePresets.ts`
  картой accentuation → { guidance_scale, position_temp, class_temp } (Гипертим/Истероид/Эпилептоид/Шизоид/Психастеноид/Нарратор)
- [ ] **Автозаполнение из персонажа** — подтягивать параметры через `CharacterAutoFillSection`
- [ ] **Сохранение per-character** — `voice_config.omnivoice_advanced` в characters.json
- [ ] **`duration` (опциональный)** — фиксированная длительность клипа для синхронизации с таймингом сцены (продвинутый режим)

### Этап 3 — Дальнейшие возможности OmniVoice-сервера

- [ ] **Voice Profiles** — CRUD на сервере для сохранённых клонированных голосов (загрузка референса один раз, далее — по имени профиля, без пересылки аудио на каждый запрос)
- [ ] **Streaming (`stream: true`)** — предложенческий chunked-transfer для снижения воспринимаемой латентности при длинном тексте
- [ ] **Bearer-token auth** — если сервер будет выставлен наружу
- [ ] **Non-verbal теги в пресетах психотипов** — автоматическая подстановка `[sigh]`, `[laughter]`, `[whisper]` в зависимости от акцентуации и настроения сцены
- [ ] **Multilingual режимы** — проверить 600+ языков для перевода аудиокниг в неосновные локали

### Этап 4 — Исследования (backlog)

- [ ] **A/B-сравнение OmniVoice vs F5-TTS** — на одинаковых референсах, выбор дефолта для pipeline
- [ ] **Batch-синтез сцены через OmniVoice** — интеграция с Studio TTS pipeline (сейчас используется только в VoiceLab)
- [ ] **Кэш профилей в OPFS** — зеркало серверных Voice Profiles локально для offline-режима

---

## 🖥️ Desktop Pro Edition — обход ограничений браузера

> Стратегическая задача: сборка нативной Pro-версии Букера для установки на компьютер пользователя.
> Цель: один клик на сайте → инсталлятор → готово. Снять лимиты браузера (VRAM, OPFS-квоты,
> Python-сервер OmniVoice, CUDA/Metal для VC) и дать прямой доступ к файловой системе.
> Полный разбор: `.lovable/research/desktop-pro-edition.md`

### Сравнение вариантов (выжимка)

| Вариант | Размер | Один клик? | Нативный GPU | Решение |
|---------|--------|-----------|--------------|---------|
| Docker localhost | 500 МБ + Docker Desktop | ❌ требует установки Docker | ⚠️ через --gpus | ❌ отклонено |
| Electron | ~150 МБ обёртка + 3 ГБ моделей | ✅ | ⚠️ только WebGPU | ⚠️ резерв |
| **Tauri (Rust)** | **~10 МБ обёртка + 3 ГБ моделей** | ✅ | ✅ Candle/CUDA/Metal | ✅ **рекомендовано** |
| PWA + браузер | 0 | ✅ | ⚠️ только WebGPU | ⚠️ временное решение |

### Этапы (high-level)

- [ ] **Research-документ** — детальный план миграции на Tauri (см. `.lovable/research/desktop-pro-edition.md`)
- [ ] **PoC: Tauri-обёртка** — пустой инсталлятор с нашим React-фронтом, проверка WebView2/WKWebView, размер бандла, время сборки
- [ ] **Миграция OPFS → нативная FS** — абстракция `ProjectStorage` уже есть, добавить `TauriFSStorage` рядом с `OPFSStorage`
- [ ] **Встраивание omnivoice-rs** — Rust-сервис как sidecar Tauri-команда, запуск/остановка из UI, без открытых портов
- [ ] **Встраивание ONNX моделей VC** — Rust biding `ort` вместо `onnxruntime-web`, прямой доступ к CUDA/Metal/DirectML
- [ ] **Auto-update** — Tauri Updater + signed releases на GitHub Releases или своём CDN
- [ ] **Code signing** — Apple Developer ID ($99/год), Windows EV Cert (~$300/год). Без подписи — SmartScreen warnings
- [ ] **CI/CD pipeline** — GitHub Actions matrix: Windows/macOS/Linux, кросс-компиляция, автогенерация инсталляторов
- [ ] **Сайт-загрузчик** — детект ОС → правильный installer (`.msi` / `.dmg` / `.AppImage`), прогресс-бар, инструкции

### Критерии решения «когда переходить»

- Когда лимиты браузера станут блокером (большие проекты >2 ГБ OPFS, OmniVoice требует Python-сервер)
- Когда Pro-аудитория будет готова платить за нативную версию (≥$X/мес)
- Когда стек VC + OmniVoice стабилизируется (сейчас идёт активная итерация)

---

## Парсер (Фаза 1 — Активная)

- [ ] **Доделать структурирование книги** — семантическая разбивка на сцены (Сценарист Stage 1), правка сцен каждой главы
- [ ] **Инлайн-правка контента сцен** — пользовательское редактирование + гибридные алгоритмы очистки
- [x] **Кнопка «Загрузить с сервера»** — Wipe-and-Deploy в OPFS с 10-шаговым прогресс-диалогом, батчинг запросов (>1000 строк)

## Wipe-and-Deploy: Local-Only восстановление (Фаза 2)

> Стратегия: при развертывании серверной копии — полное удаление локального проекта и browser state, затем чистая запись с сервера.

### Код: изменения в восстановлении (`useBookRestore.openSavedBook`)
- [x] **Wipe OPFS перед записью** — `wipeProjectBrowserState()` вызывается ДО создания нового проекта
- [x] **Очистка browser state** — sessionStorage, localStorage, in-memory кэши очищаются через `wipeProjectBrowserState()`
- [x] **Восстановление UI state** — `useStudioSession` уже читает `studio_session` из `user_settings` через `useCloudSettings` при пустом sessionStorage. Mixer/plugins аналогично. Wipe-and-Deploy очищает sessionStorage → cloud path активируется автоматически
- [x] **Атомарная активация** — React state устанавливается только после полного завершения записи в OPFS

### Код: изменения в `acceptServerVersion` (`useServerSync`)
- [x] **Делегирование Wipe-and-Deploy** — `acceptServerVersion` использует `wipeProjectBrowserState()` для полной очистки

### Код: изменения в Push to Server (`useSaveBookToProject.saveBook`)
- [x] **Сохранение UI state при Push** — верифицировано: `useCloudSettings` автоматически сохраняет `studio_session`, mixer configs и plugin configs в `user_settings` через debounced flush-on-unmount. Специальной логики в `saveBook` не требуется

### Код: утилита `wipeProjectBrowserState(bookId: string)`
- [x] **Создана утилита** — `src/lib/projectCleanup.ts`: централизованная очистка OPFS + browser state + in-memory кэшей

## Сохранение и защита данных

- [ ] **Сохранение/правка/чистка результатов в локале** — стандартизация записи и чтения из ProjectStorage
- [ ] **Защита результатов при изменении кода** — миграции данных локального хранилища
- [ ] **Синхронизация с БД сервера** — доработка логики кнопки «На сервер» для всех рабочих областей
- [x] **Хеш-верификация контента при чтении из OPFS** — FNV-1a 32-bit хеш в `scene_index.json.contentHash`, фиксация версии текста в `storyboard.json.contentHash`. Dirty-маркеры через явный `dirtyScenes[]` в индексе (устанавливается Парсером при изменении contentHash для сцен с раскадровкой, сбрасывается Студией при переанализе). Runtime-сравнение хешей не используется. `StoryboardSnapshot` включает `contentHash` для предотвращения потери хеша при ручных правках. Валидация хеша через строгую проверку на null (хеш 0 корректен)

## AI-роли

- [x] **Фикс персистенции выбора модели в сайдбаре** — гонка при закрытии/открытии Sheet: DB-load перезаписывал свежий localStorage. Решено через write-timestamp guard в useCloudSettings
- [x] **Просмотр/редактирование промптов роли** — TaskPromptsPopover с expand/collapse, inline-editing (admin-only), двуязычные версии (Ru/En), write-through в user_settings
- [x] **Логирование статистики пула** — сохранять время, модели и ошибки пула в proxy_api_logs для аналитики

## Профайлер

- [x] **Теги манеры речи и психотипа** — speech_tags (#отрывисто, #быстро) и psycho_tags (#паникер, #невротик) генерируются при профайлинге в Парсере, отображаются как цветные бейджи в ParserCharactersPanel. Предназначены для auto-casting голосов и настройки TTS в Студии
- [ ] **Доработать логику Профайлера в Парсере** — inline-нарротации, UI ревью результатов профайлинга
- [ ] **Расширить промпт профайлера** — добавить `accentuation` (акцентуация по Леонгарду: гипертим/шизоид/истероид/эпилептоид/депрессив) и `archetype` (тембровый архетип: Мудрец/Герой/Опекун/Трикстер) для автоматического маппинга на голоса TTS-провайдеров
- [ ] **Перенос тегов в Студию** — отображение speech_tags/psycho_tags/accentuation/archetype в CharactersPanel, использование для автоподбора голосов (matchVoice/matchRole) и TTS-инструкций
- [ ] **Доработать логику Профайлера в Студии** — отображение/правка inline-нарротаций в Раскадровке, хранение в `segment_phrases.metadata`

## План «В Студию» (Парсер → Студия)

> Принятые решения: scene-specific речь → `scene_segments.metadata`; теги сцены → из `mood`/`scene_type`; фильтр персонажей дефолт = chapter.
> Психотип-TTS стратегия: accentuation (Леонгард) + archetype (тембровый) → матрица маппинга на провайдеров. См. PSYCHOTYPE_TTS_ANALYTICS.md.

### Фаза 1 — Данные и миграция
- [x] **Миграция БД** — `speech_tags`/`psycho_tags` уже в `book_characters` (DB backup only, K4)
- [x] **Мост useSaveBookToProject** — читает `CharacterIndex` из `characters/index.json`, пушит все поля (speech_tags, psycho_tags, voice_config, sort_order, color) в `book_characters`
- [ ] **Edge-функция profile-characters** — добавить генерацию speech_tags/psycho_tags аналогично profile-characters-local
- [ ] **Расширить промпт профайлера** — добавить `accentuation` (акцентуация по Леонгарду: гипертим/шизоид/истероид/эпилептоид/депрессив/тревожный/эмотивный/циклоид/застревающий/демонстративный) и `archetype` (тембровый архетип: Мудрец/Герой/Опекун/Трикстер/Любовник/Бунтарь) для автоматического маппинга на голоса TTS-провайдеров

### Фаза 2 — Студия / Персонажи + Кастинг
- [x] **Фильтр по умолчанию = chapter** — CharactersPanel: дефолт `filterMode="chapter"`, toggle «Сцена»/«Глава»/«Все»
- [x] **Бейджи speech_tags/psycho_tags** — отображение рядом с temperament в карточке персонажа + 🎭 счётчик в списке
- [x] **Scene-level профайлинг** — кнопка «Уточнить речь» для выбранного персонажа → AI дообогащает `scene_segments.metadata.speech_context` с учётом психотипа + контекста сцены, НЕ перезаписывая глобальный профиль. Edge function `refine-speech-context`, UI в CharactersPanel с отображением emotion/tempo/volume_hint/manner/tts_instructions
- [x] **Психотип → TTS-пресет** — конфиг `src/config/psychotypeVoicePresets.ts`: маппинг `{ accentuation, archetype, provider }` → конкретные настройки провайдера + матрица segment_type → TTS mode
- [x] **Авто-кастинг с альтернативами** — `suggestVoiceCandidates()` в psychotypeVoicePresets.ts предлагает 2-3 голоса-кандидата на основе psycho_tags/accentuation/archetype
- [x] **Матрица «segment_type → TTS mode»** — `SEGMENT_TYPE_TTS_MODIFIERS` в psychotypeVoicePresets.ts: dialogue=полная эмоциональность, inner_thought=тише+медленнее, narrator=нейтрально, lyric=певуче

### Фаза 3 — Инструкции Рассказчику
- [x] **Теги сцены → инструкции** — `MOOD_TTS_INSTRUCTIONS` + `SCENE_TYPE_NARRATOR_HINTS` + `buildSceneTtsContext()` в psychotypeVoicePresets.ts; synthesize-scene применяет mood-based rate/role/instructions к narrator-like сегментам; speech_context из Phase 2 тоже подключен к ProxyAPI instructions
- [ ] **Редактирование** — пользователь может скорректировать авто-инструкции перед синтезом
- [ ] **UI отображение** — показ mood-инструкций в карточке Рассказчика в StoryboardPanel

- [x] **Фоновый параллельный анализ сцен** — `BackgroundAnalysisProvider` (до 3 параллельных задач), результаты пишутся напрямую в OPFS, индикация в ChapterNavigator (Loader2 спиннер), автоперезагрузка StoryboardPanel через `completionToken`, защита от race condition при переключении сцен
- [x] **Унификация пакетного анализа** — `BatchSegmentationPanel` удалён, его функциональность (включая Model Pool) перенесена в `BackgroundAnalysisProvider`. Кнопки ✨ и «Анализ выбранных» в навигаторе вызывают `bgAnalysis.submit()` напрямую. Pool mode активируется автоматически при наличии пула + 2+ сцен

## Студия / Раскадровка (после завершения Парсера)

## Архитектура (открытые вопросы)

- [x] **Б. Синхронизация персонажей Парсер ↔ Студия** — решено контрактом K4: `characters.json` — единый источник правды, `useLocalCharacters` — единый хук для Студии
- [x] **В. Иерархическая структура OPFS** — реализовано: `projectPaths.ts` (резолвер), `sceneIndex.ts` (индекс), `contentHash.ts` (хеши). Все модули используют `paths.*`
- [ ] ~~**Е. Контракт Парсер → Студия** — формализовать sessionStorage-ключи и обработку прямого открытия~~ → устарело: Студия восстанавливает сессию из OPFS (`useStudioSession`), sessionStorage хранит только указатели
- [ ] **Ж. Реестр AI-ролей ↔ Edge Functions** — заполнять маппинг роль → функция → промпт по мере реализации фич
- [ ] **UI для inline-нарротаций** — дать пользователю контроль над интонационными пометками

### Рефакторинг (завершён 2026-03-23)

- [x] **Декомпозиция useBookRestore** — из монолитного хука (~800 строк) вынесены `serverDeploy.ts` (data pipeline) и `localProjectResolver.ts` (резолвинг проектов). Хук теперь ~290 строк — тонкий оркестратор
- [x] **Батчинг запросов к Supabase** — `fetchChunked()` в `serverDeploy.ts` для сцен, сегментов и фраз (chunks 100-500), обход лимита 1000 строк
- [x] **Фикс broken sync detection** — `useBookManager` корректно передаёт `checkServerNewer` и `setServerNewerBookId` в `openSavedBook`
- [x] **Фикс silent failure при отсутствии локальной копии** — автоматический fallback на Wipe-and-Deploy с сервера
- [x] **Progress UI для acceptServerVersion** — `SyncProgressDialog` теперь отображается при принятии серверной версии
- [x] **Консолидация очистки** — `wipeAllBrowserState()` из `projectCleanup.ts` используется в `useBookManager.clearAllProjects`

## Выполненные задачи (архив)

- [x] **Поддержка форматов DOC/DOCX** — загрузка через Mammoth.js с TOC из Heading-стилей + regex-фоллбэк
- [x] **Поддержка формата FB2** — парсинг XML-структуры, извлечение TOC из `<section>/<title>`
- [x] **Формат-агностическая обработка** — `fileFormatUtils.ts` с единым API для PDF/DOCX/FB2
- [x] **Модульная декомпозиция Парсера** — хуки `useLibrary`, `useFileUpload`, `useBookRestore` (тонкий оркестратор), `useServerSync`, `useTocMutations` + модули `serverDeploy.ts`, `localProjectResolver.ts`
- [x] **Каскадный fallback провайдеров** — `invokeWithFallback.ts` + `providerRouting.ts` для 402/429 автопереключения
- [x] **Унифицированный провайдер-роутинг** — `_shared/providerRouting.ts` для всех Edge Functions (включая extract-characters после P1-рефакторинга)
- [x] **Local-Only архитектура** — OPFS/FS Access как единственный source of truth, DB — только backup по кнопке «На сервер», восстановление — Wipe-and-Deploy
- [x] **Библиотека из OPFS** — project.json → список проектов, fallback на toc.json
- [x] **Аварийный сброс** — `?resetLocal=1` для полной очистки OPFS
- [x] **Объединить «Загрузить PDF» и «Новый проект»** — единый UploadView с именем проекта
- [x] **Model Pool** — параллельная обработка через пул моделей (ModelPoolManager, PoolSelector, пресеты). Интеграция: BatchSegmentationPanel, useCharacterExtraction, useCharacterProfiles. ~10x ускорение
- [x] **Инкрементальный профайлинг** — профили применяются по мере готовности батчей, 🧠 иконки и счётчик обновляются в реальном времени
- [x] **Pool stats UI** — визуальные бейджи воркеров (completed/errors/active) в BatchSegmentationPanel и ParserCharactersPanel
- [x] **Retry без temperature** — автоматическая повторная попытка в profile-characters-local при 400 от моделей, не поддерживающих temperature
- [x] **Фикс персистенции profiledBy** — устранена гонка конкурентных записей в OPFS при пул-профайлинге (single final persist)
- [x] **Pool stats сохраняются после завершения** — счётчики воркеров остаются видимыми после профайлинга, очищаются при новом запуске
- [x] **Бейдж пула в PoolSelector** — показывает количество моделей вместо потоков (потоки в тултипе)
- [x] **Русификация mood-бейджей** — композитный tMood() разбирает составные значения ("calm, contemplative"), 60+ токенов в MOOD_MAP
- [x] **Booker Pro: Voice Conversion инфраструктура** — полный клиентский VC-пайплайн (WebGPU/WASM): ресемплинг 16kHz, ContentVec эмбеддинги, CREPE F0 pitch, RVC v2 синтез. Модули: `vcResample.ts`, `vcContentVec.ts`, `vcCrepe.ts`, `vcSynthesis.ts`, `vcPipeline.ts`, `vcModelCache.ts`, `vcInferenceSession.ts`, `vcReferenceCache.ts`. ONNX Runtime Web с CDN fallback для WASM
- [x] **Booker Pro: WebGPU диагностика** — `useWebGPU` хук + GFLOPS бенчмарк на compute shaders, детали адаптера, проверка совместимости браузера. UI в профиле (BookerProSection)
- [x] **Booker Pro: Модели (~491MB)** — трёхмодельный реестр (ContentVec 75MB, CREPE Tiny 8MB, RVC v2 408MB), OPFS кэш `vc-models/`, прогресс загрузки, статусы в UI
- [x] **Booker Pro: Голосовые референсы** — загрузка своих WAV, глобальная коллекция из `voice_references` (admin-only управление), OPFS кэш `vc-references/`, signed URL для скачивания
- [x] **Booker Pro: Настройки VC на персонажа** — VoiceConversionTab в Narrators: вкл/выкл, pitch shift ±12 полутонов, выбор RVC model SR (32/40/44.1/48 kHz), привязка референса
- [x] **Booker Pro: Финальный ресемплинг** — выход RVC всегда ресемплируется в 44.1 kHz (PROJECT_OUTPUT_SR) через OfflineAudioContext для совместимости со Студией. Автодетект SR из ONNX метаданных
- [x] **Booker Pro: Тест пайплайна** — кнопка «TTS → VC» с 5-этапным прогрессом, таймингами, автовоспроизведением результата
- [x] **Voice Lab: KNN через Web Worker** — L2 KNN поиск (k=8) вынесен в Web Worker для индексов >10K векторов, предотвращает блокировку UI
- [x] **Voice Lab: Визуализация индекса** — гистограмма L2-норм (24 бина), статистика (min/max/mean/std), фонетическая кластеризация (k-means, k=8) с subsampling до 20K
- [ ] **Voice Lab: Кастомные .onnx модели** — загрузка пользовательских RVC-весов (конвертированных из .pth) для уникального тембра персонажей
- [ ] **Voice Lab: Серверная конвертация .pth → .onnx** — Edge Function с Python runtime для автоматической конвертации весов

---

## Серверная синхронизация

- [x] **Авто-синхронизация перевода при Push** — данные перевода (lang-поддиректории + synopsis/) упаковываются в ZIP → `book-uploads/{userId}/translation_{bookId}.zip`
- [x] **Восстановление перевода с сервера** — ZIP скачивается из облака → распаковывается в OPFS → `translationLanguages` синхронизируются в `project.json`
- [x] **Консолидация хранения перевода** — устранены зеркальные OPFS-проекты. Данные перевода хранятся в lang-поддиректориях основного проекта (`chapters/{ch}/scenes/{sc}/{lang}/`). Удалены `useTranslationStorage`, `useSaveTranslation`, `translationMirrorResolver`, `_translation_link.json`
- [x] **Рефакторинг роутов** — `/` → Home (лендинг), `/library` → Library (было наоборот). Обновлены все редиректы, навигация в сайдбаре и переходы в парсере
- [x] **Сохранение метаданных при Push** — spread `...freshMeta` в `useSaveBookToProject` гарантирует сохранение `pipelineProgress`, `translationLanguages` и др. полей при записи `project.json`
- [x] **RLS UPDATE для book-uploads** — добавлена политика UPDATE для повторной загрузки ZIP перевода (B29)
- [x] **Автопрокрутка в SyncProgressDialog** — активный шаг автоматически прокручивается в видимую область
- [x] **Счётчик сцен раскадровки** — инкрементальный прогресс (1/15, 2/15...) при сохранении storyboard
- [ ] **Оптимизация трафика при Push to Server** — дельта-синхронизация (hash-сравнение глав/сцен, отправка только изменённых), сжатие payload, батчинг upsert-запросов

---

## Защита контента

- [x] **Чекбоксы «Готово» для глав, профайлов, персонажей** — реализовано через `pipelineProgress` в `project.json`. Ручные шаги (`profiles_done`, `inline_edit`, `mix_done`, `mastering`, `chapter_assembly`) переключаются через контекстное меню таймлайна в Библиотеке. Hard gating блокирует навигацию к стадиям с незавершёнными предусловиями

---

## Студия — Микшер / Таймлайн

- [ ] **Mute/Solo треков таймлайна** — кнопки M/S на каждом TrackMixerStrip, solo с эксклюзивной логикой (solo одного трека мьютит остальные), визуальная индикация состояния

---

## Баги — Потеря translation-зеркала (B26) ✅ РЕШЕНО (УСТАРЕЛО)

- [x] **Фикс** — Проблема полностью устранена: зеркальные проекты больше не используются. Данные перевода хранятся в lang-поддиректориях основного проекта.

## Баги — AI Роли / Пресеты

- [ ] **Расследовать фоллбэк на Lovable AI при загрузке пресета** — Текущая гипотеза (resolvedModels фоллбэчатся при отсутствии ключа) несостоятельна: если ключа нет, модели провайдера не отображаются в списке и не могут быть выбраны. Реальная причина ошибки 402 при загрузке пресета с OpenRouter-моделями — где-то в другом месте цепочки (loadPreset → setOverrides → getModelForRole → edge function). Воспроизвести: сохранить пресет с OpenRouter-моделями, перезагрузить страницу, загрузить пресет, запустить перевод — проверить какая модель реально уходит в edge function.

---

## Арт-перевод — Экспорт

- [ ] **Экспорт перевода в новую книгу** — при готовности перевода пользователь должен иметь возможность экспортировать переведённую раскадровку в отдельный OPFS-проект (новую книгу на целевом языке), чтобы затем пройти стандартный аудио-пайплайн (TTS, микшер, атмосфера) без дублирования аудио-инфраструктуры в translation-поддиректориях.
