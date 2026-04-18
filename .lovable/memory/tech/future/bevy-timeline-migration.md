---
name: Bevy Timeline Migration
description: Roadmap to migrate StudioTimeline from React+Canvas2D to Bevy ECS+wgpu (in Web Worker via wasm-bindgen) for 60fps on 500+ clips; orthogonal to Tauri, code is portable to Tauri without changes
type: reference
---

# Bevy Timeline Migration — короткая памятка

Полный документ: `.lovable/research/bevy-timeline-migration.md`.

## Что и зачем
- Заменить рендер `StudioTimeline.tsx` (Canvas2D + React) на Bevy ECS + wgpu в Web Worker.
- Цель: 60 fps на 500+ клипах (сейчас ~15 fps), плавный scrub, off-thread waveform.
- Меняется ТОЛЬКО слой рендера таймлайна. Бизнес-логика (`useTimelineClips`, `useTimelinePlayer`, OPFS) — без изменений.

## Архитектурный принцип
- Bevy = чистый View-слой. НЕ владеет данными, только визуализирует.
- React держит state → шлёт `set-clips`/`set-playhead` через postMessage.
- Bevy эмитит события правок (`clip-dragged`, `clip-trimmed`) обратно в React.
- НЕ использовать DOM/fetch/Web Audio внутри Bevy → zero-cost portability в Tauri.

## Связь с Tauri (см. `desktop-pro-edition.md`)
- Ортогональны: Bevy лечит лаги UI, Tauri снимает лимиты браузера (VRAM/OPFS/sidecar).
- Очерёдность: **Bevy сейчас (5-6 недель), Tauri потом (3-4 мес, при росте Pro-аудитории)**.
- При переезде в Tauri Bevy-код работает БЕЗ ИЗМЕНЕНИЙ — тот же wgpu, другой backend.

## Триггеры старта
1. Жалобы на лаги таймлайна (≥3 фидбека).
2. Сцены с 200+ клипами становятся нормой.
3. Готовность инвестировать 5-6 недель / разработчика с Rust.

## Целевые метрики
- 500 клипов: 60 fps (сейчас ~15)
- Scrub: <16 ms (сейчас 50-100)
- WASM-бандл: <500 КБ gzip
- Memory (500 клипов): ~50 МБ (сейчас ~200)

## Что НЕ ломаем
OPFS, `audio_meta.json`, `useTimelineClips`, аудио-движок, Local-Only контракт, `ProjectStorage`.
