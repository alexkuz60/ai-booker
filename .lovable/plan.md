
# Оптимизация кодовой базы AI-Booker

## Этап 1: Чистка мёртвого кода ✅

- Удалены неиспользуемые импорты из `projectActivity`
- `LibraryView` получает `localProjectNamesByBookId` через проп, убран прямой OPFS-скан
- `openProject()` → `openProjectByName()` без лишнего `listProjects()`

## Этап 2: Lazy loading страниц ✅

- Studio, Montage, Narrators, Soundscape, Translation, Profile, Admin → `React.lazy()` + `Suspense`
- Home, Library, Auth, NotFound — синхронные (критический путь)

## Этап 3: Декомпозиция крупных модулей

### audioEngine.ts (1978 → 1231 строк) ✅
- Типы → `audioEngineTypes.ts`
- `EngineTrack` → `engineTrack.ts`

### StudioTimeline.tsx (1124 → ~780 строк) ✅
- Clip fades → `useClipFades.ts`
- Character tracks → `useCharacterTracks.ts`
- Transport header → `TimelineTransport.tsx` (с `React.memo`)

### Ожидают (приоритет 1):
| Файл | Строки | Статус |
|------|--------|--------|
| StoryboardPanel.tsx | 1552 | 🔲 |
| CharactersPanel.tsx | 1238 | 🔲 |
| serverDeploy.ts | 1018 | ⏸️ отложен (монолитный пайплайн) |

## Этап 4: Мемоизация ✅ (частично)

- `TimelineTrack` → `React.memo`
- `TrackMixerStrip` → `React.memo`
- `TimelineTransport` → `React.memo`

### Ожидают:
- Виртуализация длинных списков (сцены, сегменты) → `react-window`
- `React.memo` для StoryboardPanel sub-components

---

**Принцип:** каждый шаг — отдельный коммит, билд зелёный перед следующим шагом.
