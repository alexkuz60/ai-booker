---
name: Desktop Pro Tauri Edition
description: Native Pro edition via Tauri (~10MB Rust shell + system WebView) with omnivoice-rs sidecar, native CUDA/Metal ONNX, full disk access, auto-update; planned for Phase 2 after Bevy timeline migration
type: reference
---

# Desktop Pro Edition (Tauri) — короткая памятка

Полный документ: `.lovable/research/desktop-pro-edition.md`.

## Что снимает
- VRAM-лимит браузера (Firefox 2GB, Chrome 4GB) → полный VRAM карты юзера
- Python OmniVoice сервер → встроенный sidecar `omnivoice-rs` (Rust)
- OPFS квоты → полный диск пользователя
- WebGPU-only ML → нативный CUDA/Metal/DirectML/ROCm через `ort` (5-10× быстрее)
- Установка с одного клика (`.msi`/`.dmg`/`.AppImage`)

## Почему Tauri, а не Electron
- ~10 МБ обёртка vs 150 МБ (использует системный WebView)
- Прямая интеграция с Rust-sidecar (omnivoice-rs)
- Auto-update + code signing из коробки
- React-фронт работает БЕЗ изменений

## Что меняется в коде
- `ProjectStorage`: добавляется `TauriFSStorage` рядом с `OPFSStorage`
- TTS OmniVoice: `fetch` → `invoke('omnivoice_synthesize')`
- VC ONNX: `vcOrtWorker.ts` → `invoke('vc_run')` (Rust ort + CUDA)
- Модели: OPFS → `~/Library/Application Support/Booker/models/`

## Триггеры старта (НЕ сейчас)
1. ≥100 платящих Pro-юзеров
2. Жалобы на VRAM/OPFS/латентность
3. OmniVoice + VC стек стабилизировался
4. Появился Rust-разработчик в команде

## Финансовые ограничения для РФ-аудитории
- Apple Developer $99/год + Windows EV $300/год (карта)
- Альтернатива оплаты для юзеров: ЮKassa/Robokassa (рубли, СБП, МИР)
- Self-hosted сервер для юзеров без GPU: selectel.ru / immers.cloud (рубли)

## Синергия с Bevy
- Bevy-таймлайн портируется в Tauri БЕЗ ИЗМЕНЕНИЙ (тот же wgpu)
- Сначала делаем Bevy (5-6 недель), потом Tauri (3-4 мес)
- Экономия ~2 недели на Tauri-фазе за счёт готового Bevy-кода

## Дорожная карта (Tauri-фаза)
1. PoC (2-3 нед): сборка `.msi`/`.dmg`, проверка системного WebView
2. Storage миграция (2-3 нед): `TauriFSStorage`
3. OmniVoice sidecar (3-4 нед): `omnivoice-rs` встроенный
4. VC на нативном ONNX (4-6 нед): CUDA/Metal/DirectML
5. Distribution (2-3 нед): CI/CD, подпись, auto-update, сайт-загрузчик
