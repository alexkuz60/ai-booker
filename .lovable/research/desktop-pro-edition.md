# Desktop Pro Edition — обход ограничений браузера

> Research-документ. Дата: 2026-04-18.
> Статус: архитектурный набросок, без кода.
> Контекст обсуждения: пользователь поставил задачу — установка Pro-версии Букера на компьютер
> по принципу «один клик на сайте → прогресс-бар → готово». Снять ограничения браузера
> (VRAM, OPFS-квоты, Python-сервер OmniVoice, отсутствие CUDA/Metal в WebGPU).

---

## 1. Почему вообще нужна нативная версия

Текущие ограничения браузерной версии Букера, которые становятся блокерами на Pro-уровне:

| Ограничение | Браузер | Нативная версия |
|------------|---------|-----------------|
| VRAM лимит WebGPU | Firefox душит на ~2 ГБ, Chrome ~4 ГБ | Полный VRAM карты (12-24 ГБ) |
| OPFS квоты | Динамические, ~10-50% диска, могут сбрасываться | Полный диск пользователя |
| Доступ к файлам | Песочница OPFS, нет видимости в Finder/Explorer | Прямые пути `~/Documents/Booker/` |
| OmniVoice сервер | Требует ручной установки Python + uvicorn | Встроенный sidecar (omnivoice-rs) |
| ONNX backend | Только WebGPU/WASM | CUDA, Metal, DirectML, ROCm через Candle/ort |
| Производительность VC | WebGPU baseline | 5-10× быстрее на нативном CUDA |
| Многопоточность | Web Workers + SharedArrayBuffer (требует COOP/COEP) | Полные нативные threads |
| Auto-launch при старте ОС | ❌ | ✅ |
| Системный tray + горячие клавиши | ❌ | ✅ |
| Доступ к buffer audio APIs (ASIO/CoreAudio) | ❌ | ✅ (для будущего live-monitoring) |

---

## 2. Сравнение технологий

### 2.1. Docker Desktop + localhost

```
Пользователь → docker run booker-pro → http://localhost:8000
```

**Плюсы**:
- Один и тот же образ для Win/Mac/Linux.
- Полная изоляция, легко обновлять.
- Уже умеем (omnivoice-server в Docker).

**Минусы (критичные)**:
- ❌ Требует установки Docker Desktop (~600 МБ + лицензия для коммерции).
- ❌ Docker Desktop требует WSL2 на Windows, отдельной VM на macOS — высокий барьер.
- ❌ GPU passthrough работает плохо: на Windows нужен `--gpus all` + CUDA Toolkit на хосте,
   на macOS GPU вообще недоступен из Docker.
- ❌ «Один клик» физически невозможен. Минимум 5-10 экранов установки Docker + первый запуск.
- ❌ Аудитория Букера (писатели, переводчики) — не айтишники. Docker для них — стоп-слово.

**Вердикт**: ❌ Отклонено.

### 2.2. Electron

```
Электрон-обёртка с Chromium + Node.js → наш React-фронт + ноды Python/ONNX
```

**Плюсы**:
- Знакомый стек, у нас уже есть конфигурация (`useful-context` показывает `@electron/packager`).
- Огромная экосистема (VSCode, Slack, Discord — все на Electron).
- Node.js под капотом → можно запускать любые child_process (omnivoice-server.py).
- Кросс-компиляция из Linux работает.

**Минусы**:
- ⚠️ Размер: ~150 МБ пустая обёртка (Chromium ~120 МБ + Node.js ~25 МБ).
- ⚠️ С нашими моделями (~3 ГБ ONNX VC + omnivoice) → итоговый дистрибутив 3.2-3.5 ГБ.
- ⚠️ RAM: пустое окно ест 200-400 МБ только потому, что внутри живёт Chromium.
- ⚠️ Дублирование: у пользователя уже стоит Chrome/Edge — мы тащим второй Chromium.
- ⚠️ GPU-ускорение для ML моделей — только через WebGPU (тот же лимит, что и в браузере).
   Чтобы получить нативный CUDA/Metal — придётся всё равно поднимать Python/Rust sidecar.

**Вердикт**: ⚠️ Резервный вариант. Работает, но избыточен.

### 2.3. Tauri (Rust) — РЕКОМЕНДОВАНО

```
Tauri = ~10 МБ Rust-обёртка + системный WebView (Edge WebView2 / WKWebView / WebKitGTK)
        + наш React-фронт (без изменений) + Rust-бэкенд (omnivoice-rs + ONNX через ort)
```

**Плюсы**:
- ✅ **Размер обёртки ~10 МБ** вместо 150 МБ у Electron. Использует системный WebView (Edge на Windows,
   Safari engine на macOS — уже стоят в системе).
- ✅ **Нативные инсталляторы из коробки**: `.msi` (Windows), `.dmg` (macOS), `.AppImage`/`.deb`/`.rpm` (Linux).
   Tauri Bundler генерирует их автоматически.
- ✅ **Прямая интеграция с omnivoice-rs** (тот самый Rust-порт OmniVoice из вчерашнего ресёрча!).
   Запускается как sidecar-команда внутри процесса, без открытых TCP-портов наружу.
- ✅ **Полноценный CUDA/Metal/DirectML** через `ort` (ONNX Runtime Rust binding) или `candle`.
   VC pipeline работает в 5-10× быстрее, чем через WebGPU.
- ✅ **Auto-update из коробки**: Tauri Updater подписывает релизы, проверяет обновления,
   скачивает дельту, перезапускает приложение. Один раз настроил — забыл.
- ✅ **Безопасность**: Rust-бэкенд изолирован от фронта, IPC через типизированные команды
   (`#[tauri::command]`). XSS из WebView не сможет читать файловую систему.
- ✅ **Наш React-фронт работает БЕЗ изменений** — Tauri просто хостит Vite-билд.
   Меняется только слой `ProjectStorage` (OPFS → нативная FS) и API-вызовы к omnivoice-серверу
   (вместо `http://localhost:7860` → `invoke('omnivoice_synthesize', ...)`).
- ✅ **CSP и sandbox** настраиваются на уровне Rust, фронт не может произвольно делать `fetch`.

**Минусы**:
- ⚠️ Нужен Rust в команде (или придётся учить). Базовые `#[tauri::command]` — простые,
   но сложные интеграции (CUDA bindings, FFmpeg) потребуют экспертизы.
- ⚠️ Системный WebView отличается между ОС: на Windows это Chromium-based Edge WebView2 (норм),
   на macOS — WKWebView (Safari engine, иногда отстаёт по фичам). Нужно тестировать на всех ОС.
- ⚠️ Auto-update + code signing требуют сертификатов (Apple Developer $99/год, Windows EV ~$300/год).
   Без них пользователи получат SmartScreen/Gatekeeper warnings.

**Вердикт**: ✅ **Рекомендовано**.

### 2.4. PWA + браузер (статус-кво расширенный)

Установить наш сайт как PWA через `manifest.json` + Service Worker. Иконка на рабочем столе,
запуск в окне без адресной строки.

**Плюсы**:
- ✅ Ноль усилий разработки, ноль установки.
- ✅ Работает уже сейчас (можно добавить manifest за день).

**Минусы**:
- ❌ Все ограничения браузера остаются (VRAM, OPFS, нет нативного GPU).
- ❌ OmniVoice-сервер всё равно нужно ставить отдельно.
- ❌ Не решает задачу пользователя.

**Вердикт**: ⚠️ Временное решение для Free-версии. Не подходит для Pro.

---

## 3. Архитектура нативной Pro-версии (на Tauri)

```
┌─────────────────────────────────────────────────────────────┐
│  Booker Pro Desktop App (Tauri ~10 МБ + assets ~3 ГБ)       │
│                                                             │
│  ┌──────────────────────────┐   ┌───────────────────────┐  │
│  │  Frontend (React + Vite) │   │ Rust Backend          │  │
│  │  — наш текущий фронт     │   │                       │  │
│  │  — без изменений UI      │←─→│ • omnivoice-rs        │  │
│  │  — заменяется только     │IPC│   (sidecar TTS)       │  │
│  │    слой Storage и TTS    │   │ • ort (ONNX VC)       │  │
│  │                          │   │   CUDA/Metal/DML      │  │
│  └──────────────────────────┘   │ • TauriFSStorage      │  │
│                                  │   ~/Documents/Booker/ │  │
│                                  │ • Auto-updater        │  │
│                                  └───────────────────────┘  │
│                                          │                  │
│                                          ↓                  │
│                                  ┌───────────────────────┐  │
│                                  │ Системные ресурсы     │  │
│                                  │ • CUDA/Metal/ROCm GPU │  │
│                                  │ • Полный диск         │  │
│                                  │ • CoreAudio/WASAPI    │  │
│                                  └───────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

### 3.1. Что меняется в коде

| Слой | Браузер | Нативка |
|------|---------|---------|
| UI (React) | как есть | как есть |
| `ProjectStorage` | `OPFSStorage` | `TauriFSStorage` (новая реализация интерфейса) |
| TTS OmniVoice | `fetch('http://localhost:7860/v1/audio/speech')` | `invoke('omnivoice_synthesize', { text, ref })` |
| VC ONNX | `vcOrtWorker.ts` (Web Worker + WebGPU) | `invoke('vc_run', { ... })` → Rust ort + CUDA |
| Модели | OPFS `vc-models/` | `~/Library/Application Support/Booker/models/` |
| Auth | как есть (Supabase) | как есть |

Абстракция `ProjectStorage` уже спроектирована правильно (см. `ARCHITECTURE.md`) — миграция
сводится к добавлению второй реализации интерфейса, фронт не меняется.

### 3.2. Сборка и распространение

1. **CI/CD**: GitHub Actions matrix:
   - `windows-latest` → `.msi`
   - `macos-latest` → `.dmg` (universal binary x64 + arm64)
   - `ubuntu-latest` → `.AppImage` + `.deb`
2. **Models bundling**: модели НЕ в инсталляторе. Скачиваются при первом запуске
   через Tauri-команду с прогресс-баром (как сейчас в `ModelDownloadPanel`).
   Инсталлятор остаётся ~50 МБ.
3. **Сайт-загрузчик**: на `booker-studio.lovable.app/download` — JS-детект ОС:
   ```
   navigator.userAgent → Windows → /releases/Booker-Pro-x.y.z-win-x64.msi
                       → macOS   → /releases/Booker-Pro-x.y.z-macos-universal.dmg
                       → Linux   → /releases/Booker-Pro-x.y.z-linux-x64.AppImage
   ```
   Большая зелёная кнопка «Скачать для Windows» + прогресс-бар скачивания.

### 3.3. Лицензирование Pro

- При первом запуске Desktop-версии — логин через тот же Supabase Auth (deeplink `booker://`).
- Проверка наличия активной Pro-подписки → разблокировка фич.
- Free-фичи остаются доступными в Desktop без подписки (как маркетинговый канал).

---

## 4. Дорожная карта (если решим делать)

### Фаза 0 — Решение и подготовка (1-2 недели)
- [ ] Финальное решение «Tauri vs Electron» (этот документ)
- [ ] Закупка сертификатов: Apple Developer + Windows EV Code Signing
- [ ] Создание `booker-desktop` репозитория (отдельный от веб-фронта или монорепо)

### Фаза 1 — PoC (2-3 недели)
- [ ] Tauri-проект с нашим React-фронтом, без backend-логики
- [ ] Сборка `.msi` / `.dmg` / `.AppImage`
- [ ] Замер размера, RAM, времени запуска
- [ ] Проверка работы существующих фич в системном WebView (особенно WKWebView на macOS)

### Фаза 2 — Storage миграция (2-3 недели)
- [ ] Реализация `TauriFSStorage` (интерфейс уже есть)
- [ ] Импорт существующих OPFS-проектов из браузерной версии (через export ZIP)
- [ ] Настройка пути `~/Documents/Booker/` или `~/Library/Application Support/Booker/`

### Фаза 3 — OmniVoice sidecar (3-4 недели)
- [ ] Встраивание `omnivoice-rs` как Tauri sidecar
- [ ] Замена HTTP-вызовов на `invoke('omnivoice_*', ...)`
- [ ] Прогресс скачивания моделей через Tauri events

### Фаза 4 — VC на нативном ONNX (4-6 недель)
- [ ] Замена `vcOrtWorker.ts` на Rust `ort` через `invoke`
- [ ] CUDA/Metal/DirectML провайдеры
- [ ] Бенчмарк vs WebGPU-версия

### Фаза 5 — Distribution (2-3 недели)
- [ ] CI/CD pipeline с подписью бинарей
- [ ] Tauri Updater + сервер обновлений (GitHub Releases подойдёт)
- [ ] Сайт-загрузчик с детектом ОС
- [ ] Лицензионная проверка через Supabase

**Итого**: ~3-4 месяца силами 1 разработчика с базовым Rust + наш фронт.

---

## 5. Критерии «когда начинать»

Не сейчас. Триггеры для старта:

1. **Лимиты браузера стали блокером**: пользователи Pro начали жаловаться на VRAM/OPFS/латентность.
2. **Pro-аудитория выросла**: ≥100 платящих пользователей или явный спрос на Desktop.
3. **OmniVoice + VC стек стабилизировался**: сейчас идёт активная итерация (новые параметры,
   эксперименты), переносить в нативку преждевременно — придётся постоянно догонять.
4. **Появился Rust-разработчик** в команде или готовность инвестировать в обучение.

До этого момента — оптимизировать браузерную версию, накапливать Pro-аудиторию,
дописать абстракцию `ProjectStorage` так, чтобы миграция в Фазе 2 была однострочной.

---

## 6. Ссылки

- Tauri: https://tauri.app
- Tauri vs Electron: https://tauri.app/v1/references/benchmarks
- omnivoice-rs (Rust порт OmniVoice): https://github.com/FerrisMind/omnivoice-rs
- vocoloco_tts (WebGPU OmniVoice, альтернатива в браузере): https://github.com/Magkino/vocoloco_tts
- ort (ONNX Runtime Rust): https://github.com/pykeio/ort
- Candle (Rust ML фреймворк): https://github.com/huggingface/candle
