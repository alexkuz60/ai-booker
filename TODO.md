# TODO — AI-Booker

> Список задач, собранных по ходу обсуждения архитектуры и аудита кода.
> Актуальная дата: 2026-03-22.

---

## Производительность / Оптимизация

- [x] **Устранение каскадных ре-рендеров в Парсере** — мемоизация LibraryView, стабилизация ProjectStorageContext и PageHeaderProvider, shallow-compare в setPageHeader. CPU idle → ~0%
- [x] **Устранение каскадных ре-рендеров в Студии** — обёртка headerRight в useMemo, стабилизация зависимостей useEffect для setPageHeader. CPU idle снижен с ~25% до ~15%
- [x] **Остановка RAF-циклов метров в idle** — TimelineMasterMeter, LargeMeterSingleChannel, PeakMeterSection, SpectrumAnalyzer подписаны на engine.state; RAF запускается только при playing, в idle рисуется один статичный кадр. CPU idle снижен с ~15% до ~5%
- [ ] **Финальная оптимизация метров/спектра** — вернуться после завершения аудио-функционала: проверить throttle частоты обновления при воспроизведении (30fps вместо 60fps для метров), убедиться что SpectrumAnalyzer полностью останавливает analyser node в idle

---

## Парсер (Фаза 1 — Активная)

- [ ] **Доделать структурирование книги** — семантическая разбивка на сцены (Сценарист Stage 1), правка сцен каждой главы
- [ ] **Инлайн-правка контента сцен** — пользовательское редактирование + гибридные алгоритмы очистки
- [ ] **Кнопка «Загрузить с сервера»** — New Workstation Flow: список книг из БД → восстановление в OPFS

## Сохранение и защита данных (Фаза 2)

- [ ] **Сохранение/правка/чистка результатов в локале** — стандартизация записи и чтения из ProjectStorage
- [ ] **Защита результатов при изменении кода** — миграции данных локального хранилища
- [ ] **Синхронизация с БД сервера** — доработка логики кнопки «На сервер» для всех рабочих областей
- [x] **Хеш-верификация контента при чтении из OPFS** — FNV-1a 32-bit хеш в `scene_index.json.contentHash`, сравнение с `storyboard.json.contentHash` при открытии раскадровки. Реализовано в `src/lib/contentHash.ts` + `src/lib/sceneIndex.ts`

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

## Студия / Раскадровка (после завершения Парсера)

- [ ] **Мультирендер клипов сцены через пул TTS-провайдеров** — параллельная озвучка сегментов по карте голосов персонажей: распределение задач между Yandex/SaluteSpeech/ElevenLabs/ProxyAPI через ModelPoolManager, инкрементальное обновление таймлайна по мере готовности клипов
- [ ] **Добавить недостающие категории сегментов** — в enum `segment_type`, константы `SEGMENT_TYPES` и UI: добавить `remark` (Реплика). Проверить полноту списка
- [ ] **Каскадный fallback в BatchSegmentationPanel** — аналогично `invokeWithFallback` в StoryboardPanel

## Архитектура (открытые вопросы)

- [x] **Б. Синхронизация персонажей Парсер ↔ Студия** — решено контрактом K4: `characters.json` — единый источник правды, `useLocalCharacters` — единый хук для Студии
- [x] **В. V2 иерархическая структура OPFS** — реализовано: `projectPaths.ts` (резолвер), `sceneIndex.ts` (индекс), `contentHash.ts` (хеши), `projectMigrator.ts` (автомиграция V1→V2). Все модули используют `paths.*`
- [ ] ~~**Е. Контракт Парсер → Студия** — формализовать sessionStorage-ключи и обработку прямого открытия~~ → устарело: Студия восстанавливает сессию из OPFS (`useStudioSession`), sessionStorage хранит только указатели
- [ ] **Ж. Реестр AI-ролей ↔ Edge Functions** — заполнять маппинг роль → функция → промпт по мере реализации фич
- [ ] **UI для inline-нарротаций** — дать пользователю контроль над интонационными пометками

## Выполненные задачи (архив)

- [x] **Поддержка форматов DOC/DOCX** — загрузка через Mammoth.js с TOC из Heading-стилей + regex-фоллбэк
- [x] **Поддержка формата FB2** — парсинг XML-структуры, извлечение TOC из `<section>/<title>`
- [x] **Формат-агностическая обработка** — `fileFormatUtils.ts` с единым API для PDF/DOCX/FB2
- [x] **Модульная декомпозиция Парсера** — хуки `useLibrary`, `useFileUpload`, `useBookRestore`, `useServerSync`, `useTocMutations`
- [x] **Каскадный fallback провайдеров** — `invokeWithFallback.ts` + `providerRouting.ts` для 402/429 автопереключения
- [x] **Унифицированный провайдер-роутинг** — `_shared/providerRouting.ts` для всех Edge Functions (включая extract-characters после P1-рефакторинга)
- [x] **Local-First архитектура** — OPFS/FS Access как primary source of truth, DB sync только по кнопке
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
