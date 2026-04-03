
# Оптимизация кодовой базы AI-Booker

## Этап 1: Чистка мёртвого кода

**1.1 Неиспользуемые импорты из `projectActivity`**
- `getProjectActivityMs` больше не нужен в `useProjectStorage.ts` (удалён `resolveFreshestSourceProject`)
- Проверить все файлы на мёртвые импорты после рефакторинга mirror-логики

**1.2 Удалить `resolveSourceProject` из LibraryView**
- Сейчас LibraryView сканирует `listProjects()` самостоятельно — это дублирование логики из `useLibrary`. Можно прокинуть `localProjectNamesByBookId` из хука и убрать прямой скан.

**1.3 Проверить `openProject()` в useProjectStorage**
- `openProject()` (строки 164-198) использует `listProjects()` + открывает первый проект — устаревшая логика для FSA-бэкенда. Возможно, мёртвый код.

## Этап 2: Lazy loading страниц

Все 10 страниц импортируются синхронно в `App.tsx`. Это увеличивает начальный бандл.

**Заменить на `React.lazy()` + `Suspense`:**
- Studio (648 строк + тяжёлые компоненты)
- Montage (216 строк + Tone.js)
- Narrators (929 строк)
- Translation (642 строк)
- Admin (260 строк)
- Profile (197 строк)

Оставить синхронными: Home, Library, Auth, NotFound (критический путь).

## Этап 3: Крупные файлы — декомпозиция

**Приоритет 1 (>900 строк, высокий риск регрессии):**
| Файл | Строки | План |
|------|--------|------|
| `audioEngine.ts` | 1978 | Выделить: AudioGraph, AudioMixer, AudioEffects |
| `StoryboardPanel.tsx` | 1552 | Выделить PhraseList, SegmentEditor, SpeakerControls |
| `CharactersPanel.tsx` | 1238 | Выделить CharacterCard, VoiceConfig, CastingSection |
| `ParserCharactersPanel.tsx` | 1125 | Выделить CharacterTable, MergeDialog, ProfileEditor |
| `StudioTimeline.tsx` | 1124 | Выделить TrackList, ClipRenderer, SelectionHandler |
| `serverDeploy.ts` | 1018 | Выделить DeployChapters, DeployCharacters, DeployAudio |
| `Narrators.tsx` | 929 | Выделить NarratorsList, VoicePreview, AssignmentPanel |

**Приоритет 2 (700-900 строк):**
- `useSaveBookToProject.ts` (716) — выделить отдельные save-стратегии
- `useChapterAnalysis.ts` (710) — выделить AI-prompt builder
- `ChapterDetailPanel.tsx` (707) — выделить SceneList, ChapterHeader

## Этап 4: Мемоизация и рендер-оптимизация

- Обернуть тяжёлые компоненты в `React.memo()` (StoryboardPanel, Timeline)
- Проверить `useCallback`/`useMemo` в хуках с большим количеством зависимостей
- Виртуализация длинных списков (сцены, сегменты) через react-window или виртуальный скролл

---

**Порядок исполнения:** 1 → 2 → 3 (по одному файлу за итерацию) → 4
**Принцип:** каждый шаг — отдельный коммит, тесты зелёные перед следующим шагом.
