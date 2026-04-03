
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

### CharactersPanel.tsx (1238 → 841 строк) ✅
- Список персонажей → `CharacterListSidebar.tsx` (235 строк, `React.memo`)
- Редактор профиля → `CharacterProfileEditor.tsx` (287 строк, `React.memo`)

### StoryboardPanel.tsx (1552 → 1236 строк) ✅
- Тулбар → `StoryboardToolbar.tsx`
- Строка сегмента → `StoryboardSegmentRow.tsx`

### Ожидают (приоритет 1):
| Файл | Строки | Статус |
|------|--------|--------|
| serverDeploy.ts | 1018 | ⏸️ отложен (монолитный пайплайн) |

## Этап 4: Мемоизация ✅ (частично)

- `TimelineTrack` → `React.memo`
- `TrackMixerStrip` → `React.memo`
- `TimelineTransport` → `React.memo`

### Решения:
- Виртуализация (`react-window`) — **отложена**: сегменты переменной высоты (фразы, аннотации, inline narrations), типичная сцена 10-50 блоков — ROI минимален
- `React.memo` для StoryboardPanel sub-components — **не требуется**: SpeakerBadge/SegmentTypeBadge имеют внутренний state (Popover), StoryboardSegmentRow уже обёрнут в `memo`

## Этап 5: Итоги

Все практически значимые оптимизации завершены. Оставшиеся кандидаты (виртуализация, serverDeploy декомпозиция) отложены как низкоприоритетные.

---

**Принцип:** каждый шаг — отдельный коммит, билд зелёный перед следующим шагом.
