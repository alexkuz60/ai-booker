# Bevy Timeline Migration — план миграции Studio Timeline на ECS + wgpu

> Research-документ. Дата: 2026-04-18.
> Статус: утверждено к проработке (приоритет: после стабилизации текущих фич).
> Связанные документы: `.lovable/research/desktop-pro-edition.md` (Tauri Pro Edition).

---

## 1. Зачем мигрировать таймлайн на Bevy

### Текущая боль
`src/components/studio/StudioTimeline.tsx` и связанные (`TimelineTrack.tsx`, `TimelinePlayhead.tsx`,
`TimelineRuler.tsx`, `TimelineMasterMeter.tsx`) рендерятся через React + Canvas2D.

Конкретные проблемы на сценах с 200+ клипами:
- Перерисовка синхронна с React reconciliation — scrub плеера дёргается.
- `useWaveformPeaks` пересчитывает пики на каждый ресайз клипа.
- `peaksWorker.ts` помогает, но финальный рендер всё равно через Canvas2D в main thread.
- Drag-and-drop клипа провоцирует layout thrashing.

### Что даст Bevy
- **ECS (Entity Component System)**: один клип = одна entity, рендеринг батчится через GPU инстансинг.
- **wgpu под капотом**: тот же код работает и в браузере (WebGPU), и нативно (Vulkan/Metal/DX12).
  При переезде в Tauri (см. `desktop-pro-edition.md`) — ноль переписывания.
- **60 fps стабильно** даже на 1000+ клипов.
- **Off-thread рендеринг**: Bevy запускается в Web Worker через `wasm-bindgen`, main thread свободен.
- **Бесплатные фичи**: real-time waveform rendering без `peaksWorker`, плавный zoom, smooth scrub.

---

## 2. Что НЕ меняется

- Вся бизнес-логика (`useTimelineClips`, `useTimelinePlayer`, `useStoryboardSegmentOps`).
- OPFS-хранилище (`audio_meta.json`, `clip_plugins.json`, `mixer_state.json`).
- React-компоненты вокруг таймлайна (`StudioWorkspace`, `TrackMixerStrip`, `MasterEffectsTabs`).
- Контракт `ProjectStorage` и весь Local-Only стек.
- Управление аудио (`audioEngine.ts`, Tone.js).

**Меняется только слой рендеринга таймлайна** — React-компоненты заменяются на canvas-mount,
куда Bevy рисует через wgpu.

---

## 3. Архитектура

```
┌─────────────────────────────────────────────────────────────┐
│  React App (без изменений)                                  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  StudioWorkspace.tsx                                  │  │
│  │  ┌──────────────────────────────────────────────┐    │  │
│  │  │  <BevyTimelineMount />                       │    │  │
│  │  │  ┌─────────────────────────────────────┐     │    │  │
│  │  │  │  <canvas ref={canvasRef} />         │     │    │  │
│  │  │  │  ↓ wgpu surface                      │     │    │  │
│  │  │  │                                      │     │    │  │
│  │  │  │  Bevy ECS World (in Web Worker)     │     │    │  │
│  │  │  │  • ClipEntity × N                    │     │    │  │
│  │  │  │  • WaveformComponent                 │     │    │  │
│  │  │  │  • PluginBadgeComponent              │     │    │  │
│  │  │  │  • PlayheadResource                  │     │    │  │
│  │  │  │  • Systems: render, drag, scrub     │     │    │  │
│  │  │  └─────────────────────────────────────┘     │    │  │
│  │  └──────────────────────────────────────────────┘    │  │
│  │                                                       │  │
│  │  Остальные панели (без изменений)                    │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
         ↑                                    ↓
   IPC через postMessage           Команды / события
   (clips, playhead, edits)        (clip-clicked, drag-end)
```

### IPC-контракт (TypeScript ↔ Rust/WASM)

```ts
// React → Bevy
type TimelineCommand =
  | { type: 'set-clips'; clips: ClipData[] }
  | { type: 'set-playhead'; sec: number }
  | { type: 'set-zoom'; pxPerSec: number }
  | { type: 'highlight-clip'; clipId: string };

// Bevy → React
type TimelineEvent =
  | { type: 'clip-clicked'; clipId: string }
  | { type: 'clip-dragged'; clipId: string; newStartSec: number }
  | { type: 'clip-trimmed'; clipId: string; newDurationSec: number }
  | { type: 'playhead-scrub'; sec: number };
```

React держит state, Bevy только визуализирует и эмитит события правок.
**Принцип**: Bevy не владеет данными, только их отображением.

---

## 4. План миграции (фазы)

### Фаза 0 — PoC (1 неделя)
- [ ] Минимальный Rust-проект: Bevy + wgpu + wasm-bindgen
- [ ] Сборка через `wasm-pack` в `src/lib/bevy-timeline/pkg/`
- [ ] Vite-плагин для импорта `.wasm` модуля
- [ ] Hello-world: один цветной прямоугольник на canvas
- [ ] Замер размера WASM-бандла (цель: <500 КБ gzip)

### Фаза 1 — Базовый рендер клипов (1 неделя)
- [ ] ECS-схема: `ClipEntity { id, startSec, durationSec, trackIdx, color }`
- [ ] Render system: рисует прямоугольники с правильным позиционированием по `pxPerSec`
- [ ] Camera/viewport: pan + zoom через scroll/pinch
- [ ] Команда `set-clips` через postMessage
- [ ] Бенчмарк: 500 клипов @ 60 fps

### Фаза 2 — Waveform rendering (1 неделя)
- [ ] Передача peaks из `useWaveformPeaks` в Bevy через SharedArrayBuffer (если COOP/COEP) или Transferable
- [ ] GPU-инстансинг waveform столбиков (один draw call на клип)
- [ ] Адаптивный LOD: при zoom-out — простые прямоугольники, при zoom-in — детальные пики

### Фаза 3 — Интерактивность (1 неделя)
- [ ] Клик по клипу → событие `clip-clicked` → React выделяет в `useTimelineClips`
- [ ] Drag клипа → событие `clip-dragged` → React обновляет `audio_meta.json`
- [ ] Trim ручки (левая/правая) → событие `clip-trimmed`
- [ ] Playhead ruler с временной шкалой
- [ ] Scrub плеера через клик в ruler

### Фаза 4 — Параллельные фичи (опционально)
- [ ] Fade in/out визуализация (градиенты на краях клипа)
- [ ] Плагин-бейджи (иконки EQ/Comp/Reverb на клипе)
- [ ] Snap-to-grid при drag
- [ ] Multi-select + box-select

### Фаза 5 — Замена в production (3 дня)
- [ ] Feature flag: `useBevyTimeline` в `useCloudSettings`
- [ ] A/B-тест на реальных проектах с большим storyboard
- [ ] Замер метрик: FPS, time-to-interactive, memory
- [ ] Полная замена `TimelineTrack.tsx` на `BevyTimelineMount.tsx`

**Итого**: ~5-6 недель для одного разработчика с базовым Rust.

---

## 5. Риски и митигации

| Риск | Вероятность | Митигация |
|------|-------------|-----------|
| WebGPU отсутствует у юзера | Низкая (Booker Pro требует WebGPU) | Fallback на текущий Canvas2D через feature flag |
| WASM-бандл слишком большой | Средняя | Bevy умеет tree-shake, целимся в <500 КБ; lazy-load только при входе в Студию |
| Сложность отладки Rust в браузере | Высокая | source maps через `wasm-bindgen`, console.log через `web-sys` |
| SharedArrayBuffer не работает в Lovable preview | Высокая | Использовать обычный postMessage для PoC, SAB только в production с COOP/COEP |
| Конфликт WebGPU контекста с VC pipeline | Средняя | Bevy и `vcOrtWorker` в разных Web Workers, разные GPU adapters |

---

## 6. Связь с Tauri Pro Edition

Bevy и Tauri **ортогональны**, но синергичны:

| Аспект | Bevy | Tauri |
|--------|------|-------|
| Что снимает | Лаги таймлайна на 200+ клипов | Лимиты браузера (VRAM, OPFS, sidecar) |
| Когда делать | **Сейчас** (1.5 мес) | Потом (3-4 мес, при росте Pro-аудитории) |
| Влияет на юзера | Прозрачно (тот же URL) | Установка `.msi`/`.dmg` |
| GPU acceleration | Только рендер таймлайна | + ML inference (CUDA/Metal) |

**Ключевой профит**: при переезде в Tauri — Bevy-таймлайн работает БЕЗ ИЗМЕНЕНИЙ.
Тот же `wgpu` код, только backend меняется с WebGPU на Vulkan/Metal/DX12.
Это сэкономит ~2 недели работы на Tauri-фазе.

**Архитектурное правило**: при разработке Bevy-таймлайна не использовать
браузер-специфичные API (DOM, fetch, Web Audio). Только wgpu + ECS + IPC через postMessage.
Это гарантирует zero-cost portability в Tauri.

---

## 7. Целевые метрики

| Метрика | Текущее (Canvas2D) | Цель (Bevy) |
|---------|---------------------|-------------|
| FPS на 100 клипов | ~45 fps | 60 fps |
| FPS на 500 клипов | ~15 fps | 60 fps |
| FPS на 1000 клипов | ~5 fps (DnD ломается) | 60 fps |
| Время скраба плейхеда | 50-100 ms | <16 ms |
| Memory (500 клипов) | ~200 МБ | ~50 МБ |
| Time to interactive Studio | 800 ms | 1200 ms (+ загрузка WASM) |

Единственный регресс — TTI из-за загрузки WASM-бандла. Митигация: lazy-load + preload hint.

---

## 8. Когда начинать

**Триггеры для старта**:
1. Жалобы пользователей на лаги таймлайна (≥3 жалобы или явный фидбек).
2. Сцены с 200+ клипами становятся нормой (сейчас редкость).
3. Готовность инвестировать 5-6 недель / 1 разработчика с Rust.
4. Стабилизация текущего стека Студии (не менять Bevy-таргет каждую неделю).

**До этого момента**:
- Документировать текущие узкие места `TimelineTrack.tsx` (FPS-замеры).
- Не наращивать сложность Canvas2D-рендера (каждая новая фича = больше работы при миграции).
- Держать `useTimelineClips` чистым от рендер-логики (готовность к замене View-слоя).

---

## 9. Ссылки

- Bevy: https://bevyengine.org
- Bevy WASM guide: https://bevy-cheatbook.github.io/platforms/wasm.html
- wgpu: https://wgpu.rs
- wasm-bindgen: https://rustwasm.github.io/wasm-bindgen/
- WebGPU status: https://caniuse.com/webgpu
- Связанный документ: `.lovable/research/desktop-pro-edition.md`
