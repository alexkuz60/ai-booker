# План: VocoLoco — OmniVoice в браузере (WebGPU + ONNX Runtime Web)

> **Цель**: устранить зависимость от локального Python-сервера omnivoice-server, портировав инференс OmniVoice (k2-fsa, Apache-2.0) в браузер по образцу Kitten TTS / Kokoro-js. Использовать уже готовую инфраструктуру: VC ORT-worker, OPFS model cache, GPU benchmarks, Booker Pro gating.
>
> **Статус**: research + architecture (без кода). Исполнение — фазами после approval.

---

## 0. Стратегический контекст

| Что у нас уже есть | Где живёт | Как переиспользуется |
|---|---|---|
| ORT-worker с WebGPU/WASM, тензоры через transferables | `src/lib/vcOrtWorker.ts` + `vcInferenceSession.ts` | Тот же worker (или клон) загружает encoder/transformer/vocoder OmniVoice |
| OPFS-кэш моделей с событийной синхронизацией | `src/lib/vcModelCache.ts` (`VC_ALL_MODELS`, `VC_MODEL_CACHE_EVENT`) | Расширяется новой группой `OMNIVOICE_MODELS` |
| Singleton WebGPU adapter | `src/lib/webgpuAdapter.ts` | Один адаптер на всё приложение — без конкуренции с RVC |
| GPU-бенчмарк + детекция | `src/hooks/useWebGPU.ts` | Уже выдаёт `details.maxBufferSize` — критерий "Pro-ready" |
| Booker Pro gating + Model Download Panel | `src/hooks/useBookerPro.ts`, `ModelDownloadPanel.tsx` | Те же UI-кирпичи для скачивания и активации |
| OmniVoice UI (Design / Cloning / Auto, ref picker, presets, advanced params) | `src/components/voicelab/OmniVoiceLabPanel.tsx` + `omnivoice/*` | НЕ переписываем — меняется только транспорт под капотом |
| Аудио-препроцесс 24 kHz mono WAV | `src/lib/omniVoiceAudioPrep.ts` | Уже формат «как ожидает модель» — отдаём напрямую в encoder |
| Multi-device + VRAM snapshot | `useGpuDevices`, `subscribeVramUsage` | Бейджи "VRAM in use" уже есть |

**Архитектурный вывод**: VocoLoco ложится в существующий стек как «третий пайплайн ONNX» рядом с RVC и F5-TTS. Локальный сервер omnivoice-server остаётся как fallback для машин без WebGPU/без памяти.

---

## Фаза 1 — Research & Feasibility (без кода)

**Цель**: подтвердить, что OmniVoice можно собрать в ONNX-граф под Web и оценить VRAM/UX-бюджеты.

1. **Аудит модели OmniVoice (k2-fsa)** — компоненты (text frontend → token encoder → flow-matching transformer → vocoder), размеры весов, лицензии каждого блока, FP16/INT8 варианты, длина контекста, частота выхода. Проверить наличие официальных ONNX-экспортов.
2. **Тензорные шейпы и операторы** — input/output names и dtypes (по аналогии с F5-TTS, см. `mem://tech/audio/f5-tts-onnx-research`). Прогнать `onnxruntime-web` op-coverage check: какие ops не поддерживаются WebGPU EP → план фолбэка (WASM или fused replacement).
3. **VRAM/Perf prognosis** — пик VRAM: encoder + transformer (NFE-loop) + vocoder одновременно vs. staged release (как у RVC). Сценарии: 4 / 8 / 12 GB. Привязать к `details.maxBufferSize` из `useWebGPU`.
4. **Голосовой клонинг** — как OmniVoice кодирует ref-audio (speaker embedding отдельно или в общий encoder). Сопоставить с `omniVoiceAudioPrep.ts` и кэшем транскриптов в `voice_references`.
5. **Дельта vs текущий omnivoice-server** — список фич сервера: `/v1/audio/speech`, `/v1/audio/speech/clone`, `/v1/audio/transcriptions`, non-verbal tags, multi-language. Что требует отдельной модели (Whisper).

**Артефакт**: `.lovable/research/vocoloco-feasibility.md` с таблицей моделей, шейпов, VRAM-бюджетом и решением Go/No-Go.

---

## Фаза 2 — Контракт и реестр моделей (без рантайма)

1. **Расширить реестр моделей** — `OMNIVOICE_MODELS` в `vcModelCache.ts` (или новый `omniVoiceModelCache.ts` с тем же event-bus’ом, чтобы `ModelDownloadPanel` работал без изменений). Поля: `id`, `url`, `sizeBytes`, `sha256`, `requiredFor` ("design"|"cloning"|"auto"), `optional`.
2. **Контракт OmniVoiceEngine** — TS-интерфейс:
   ```ts
   interface OmniVoiceEngine {
     ensureReady(mode: "design"|"cloning"|"auto"): Promise<void>;
     synthesize(req: OmniVoiceRequest): AsyncIterable<Float32Array>;
     releaseAll(): Promise<void>;
   }
   ```
   Выход — 24 kHz mono Float32 → конвертится в наш стандарт 44.1 kHz / 16-bit WAV (`mem://tech/audio/wav-storage-standard`) перед записью в OPFS.
3. **Транспортный слой → strategy pattern** — существующий `useOmniVoiceServer` остаётся как `RemoteOmniVoiceTransport`. Добавляем `LocalOmniVoiceTransport` (WebGPU). Выбор по `useCloudSettings("omnivoice-engine", "auto"|"local"|"remote")`. UI получает один и тот же API.

**Артефакт**: PR с типами/реестром + обновлённая memory-запись `mem://features/voice-lab/omnivoice-integration` (раздел «Transports»).

---

## Фаза 3 — ORT pipeline (encoder → transformer → vocoder)

1. **Worker-based session lifecycle** — `src/lib/vocoLocoOrtWorker.ts` (клон `vcOrtWorker.ts` или общий worker с namespace’ом). Все сессии OmniVoice живут там. `releaseAll()` через `worker.terminate()` (правило `mem://tech/infrastructure/worker-based-onnx-vram-lifecycle`).
2. **Stage 1 — Encoder** — tokenizer (text frontend) портируем на JS. Для not-Latin — переиспользуем словари F5-TTS (`vocabRu`). Ref-audio: WAV 24 kHz → mel/feature → encoder.
3. **Stage 2 — Flow-matching / transformer NFE-loop** — параметры из `OmniVoiceAdvancedParams` (guidance_scale, num_step, t_shift, temperatures) пробрасываются один-в-один. Snapshot psychotype params уже работает.
4. **Stage 3 — Vocoder** — отдельная сессия. Stream в Float32Array → MediaSource / WebAudio buffer.
5. **Staged GPU release** — между Stage 2 и Stage 3 освобождать transformer-сессию, как у RVC.

**Артефакт**: рабочий локальный синтез одного предложения в `/voice-lab` с метриками (VRAM peak, time per step, RTF).

---

## Фаза 4 — UX интеграция в `OmniVoiceLabPanel`

1. **Engine selector в шапке панели** — tri-state: `Auto` / `Local (WebGPU)` / `Remote server`. Под селектом — бейджи: «VRAM 2.1/4.0 GB», «Models 3/3 ready», «Backend: WebGPU/WASM».
2. **Переиспользование UI** — `CharacterAutoFillSection`, `OmniVoiceUserPresetsMenu`, `OmniVoiceAdvancedParams`, `OmniVoiceRefPicker` без изменений. `OmniVoiceServerCard` расширяется: при `engine === "local"` показывает статус загрузки моделей вместо health-check.
3. **Booker Pro gating** — локальный движок доступен только при `bookerPro.enabled === true` и `gpuStatus === "available"`. Иначе — toast «Включите Booker Pro».
4. **Streaming preview** — по чанкам (как у `OmniVoiceResultCard`); запись в OPFS — после полного завершения.

---

## Фаза 5 — Кэш, портативность, документация

1. **Model cache** — подключить OmniVoice-модели к `getModelStatus()`, прогресс в `Profile → Booker Pro → Model Download`. Учесть OPFS-лимит: `navigator.storage.persist()` перед скачиванием 1+ GB.
2. **Memory updates** — обновить `mem://features/voice-lab/omnivoice-integration` (раздел «VocoLoco»), создать `mem://tech/audio/vocoloco-pipeline` (ORT-стадии, шейпы, VRAM), обновить `mem://index.md`.
3. **Docs** — `ARCHITECTURE.md` раздел «Local TTS Engines (RVC, F5-TTS, VocoLoco)»; `STRATEGY.md` — Python-сервер становится опциональным (не deprecated).

---

## Фаза 6 — Деградация и совместимость

| Сценарий | Поведение |
|---|---|
| Нет WebGPU | Engine selector скрывает `Local`, остаётся Remote |
| WebGPU есть, но `maxBufferSize < N GB` | Warning + автодаунгрейд на INT8 / на Remote |
| Модели не скачаны | Кнопка «Скачать модели VocoLoco (X.Y GB)» с прогресс-баром |
| OPFS заполнен | Toast + ссылка на OPFS browser panel |
| Inference падает (NaN / WebGPUCorruptError) | Авто-release + retry на WASM (как `validateInferenceOutput` в `vcInferenceSession.ts`) |

---

## Acceptance criteria

- [ ] В `/voice-lab` можно выбрать "Local (WebGPU)" engine и синтезировать речь без работающего omnivoice-server.
- [ ] Voice Cloning работает с теми же ref-audio из `voice_references` и OPFS-коллекции.
- [ ] Advanced-параметры психотипа применяются один-в-один (snapshot не теряется).
- [ ] Модели кэшируются в OPFS, статус виден в Booker Pro panel.
- [ ] VRAM peak укладывается в `details.maxBufferSize` для целевых GPU (4/8/12 GB).
- [ ] После `engine.releaseAll()` VRAM возвращается к baseline (`subscribeVramUsage`).
- [ ] Remote server fallback продолжает работать без регрессий.
- [ ] `architecturalInvariants.test.ts` обновлён: реестр расширен, `openOrCreate` отсутствует.

---

## Риски

1. **Op-coverage WebGPU EP** — flow-matching transformer может содержать ops, не поддерживаемые в onnxruntime-web. → WASM-фолбэк per-op + INT8 квантизация.
2. **VRAM** — три сессии одновременно могут не уместиться в 4 GB. → Staged release (как у RVC).
3. **Лицензия весов** — Apache-2.0 у k2-fsa подтверждена, но vocoder может быть отдельным модулем. → Перепроверить в Фазе 1.
4. **Tokenizer non-Latin** — text frontend на JS. Часть уже есть в F5-TTS (`vocabRu`). → Объединить под общий `src/lib/textFrontends/`.
5. **iOS / cross-origin iframe** — WebGPU там нет, остаётся Remote. Уже учтено в `iframe-security-fallback`.

---

## Что предлагаю дальше

Стартовать с **Фазы 1** — research-документ + проверка op-coverage и лицензий, без изменений в коде. Это даст уверенный Go или конкретный список блокеров до начала реализации.
