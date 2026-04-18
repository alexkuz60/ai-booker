---
name: Bevy Timeline Migration
description: Roadmap to migrate Studio Timeline AND Montage WaveformEditor from React+Canvas2D to Bevy ECS+wgpu (Web Worker via wasm-bindgen) for 60fps on 500+ clips and 10+ min rendered scenes; orthogonal to Tauri, code is portable to Tauri without changes
type: reference
---

# Bevy Timeline Migration — короткая памятка

Полный документ: `.lovable/research/bevy-timeline-migration.md`.

## Что и зачем — две поверхности, один движок
- **Studio Timeline** (`StudioTimeline.tsx`): 60 fps на 500+ клипах вместо ~15 fps, плавный scrub.
- **Montage WaveformEditor** (`src/components/montage/WaveformEditor.tsx`): 60 fps playback
  на сценах 7-15 минут вместо дёрганья. **Уже подтверждённая боль пользователя.**
- Общий WASM-модуль на обе фичи — оплачиваем загрузку только раз.
- Меняется ТОЛЬКО слой рендера. Бизнес-логика (`useTimelineClips`, `useTimelinePlayer`,
  `useWaveformPeaks`, OPFS) — без изменений.

## Архитектурный принцип
- Bevy = чистый View-слой. НЕ владеет данными, только визуализирует.
- React держит state → шлёт `set-clips`/`set-playhead`/`set-peaks` через postMessage (Transferable).
- Bevy эмитит события правок (`clip-dragged`, `clip-trimmed`, `seek`) обратно в React.
- НЕ использовать DOM/fetch/Web Audio внутри Bevy → zero-cost portability в Tauri.

## Ключевые приёмы для Montage
- Передача peaks через Transferable ArrayBuffer (10-мин сцена = 18+ МБ PCM, копировать нельзя).
- Playhead движется через GPU uniform buffer — пики не перерисовываются.
- Авто-скролл через GPU camera translation, не CSS `scrollLeft`.
- Selection (trim) — отдельный alpha-blend quad поверх пиков.
- LOD: 95-200% — простой L/R butterfly, 300-1000% — детальные пики.

## Связь с Tauri (см. `desktop-pro-tauri.md`)
- Ортогональны: Bevy лечит лаги UI, Tauri снимает лимиты браузера (VRAM/OPFS/sidecar).
- Очерёдность: **Bevy сейчас (6.5-7.5 недель), Tauri потом (3-4 мес, при росте Pro-аудитории)**.
- При переезде в Tauri Bevy-код работает БЕЗ ИЗМЕНЕНИЙ — тот же wgpu, другой backend.

## Триггеры старта
1. Жалобы на лаги таймлайна Studio (≥3 фидбека).
2. **Жалобы на дёрганый плейбек в Montage на сценах 7+ минут (подтверждено).**
3. Сцены с 200+ клипами становятся нормой.
4. Готовность инвестировать 6.5-7.5 недель / разработчика с Rust.

## Целевые метрики
**Studio**: 500 клипов 60 fps (было ~15), scrub <16 ms, memory ~50 МБ (было ~200).
**Montage**: 7-мин сцена 60 fps playback (было ~20), 15-мин 60 fps (было ~8),
zoom 1000% + playback 60 fps (было ~5), память 60 МБ (было ~180).
WASM-бандл: <500 КБ gzip.

## Что НЕ ломаем
OPFS, `audio_meta.json`, `useTimelineClips`, `useTimelinePlayer`, `useWaveformPeaks`,
аудио-движок, Local-Only контракт, `ProjectStorage`, контракты onSeek/onTrim/onFade.
