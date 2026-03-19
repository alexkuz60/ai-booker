# Model Pool — План реализации

## Концепция

Тяжёлые и стандартные ИИ-роли (Screenwriter, Director, Profiler, Proofreader, Sound Engineer)
получают **пул моделей** вместо одной. Менеджер распределяет задачи round-robin с retry при 429/402.
Конкурентность: **2 параллельных запроса на модель**.

**Пример:** Profiler с пулом [gemini-2.5-pro, gpt-5, claude-3.5-sonnet] и concurrency=2 →
6 параллельных потоков вместо 1.

## Архитектура

### 1. Данные — расширение `aiRoles.ts`

```typescript
// Новое поле в AiRoleDefinition:
poolable: boolean;  // true для standard + heavy tier

// Новый тип для хранения пула:
export type AiRolePoolMap = Partial<Record<AiRoleId, string[]>>;

// В useCloudSettings:
// Ключ "ai_role_model_pools" — сохраняет пулы юзера
```

**Логика:** если пул задан и содержит >1 модели → используется ModelPoolManager.
Если пул пуст или из 1 модели → классическое поведение (одна модель).

### 2. ModelPoolManager — `src/lib/modelPoolManager.ts`

```typescript
interface PoolWorker {
  modelId: string;
  provider: string;
  apiKey: string | null;
  activeCount: number;   // текущие in-flight запросы
  maxConcurrency: number; // 2
  errorCount: number;     // счётчик ошибок для отключения
  disabled: boolean;      // true после 3+ ошибок подряд
}

interface PoolTask<T> {
  id: string;
  execute: (modelId: string, apiKey: string | null) => Promise<T>;
  retryCount: number;
}

class ModelPoolManager {
  private workers: PoolWorker[];
  private roundRobinIdx: number = 0;
  
  constructor(models: string[], userApiKeys: Record<string, string>, perModelConcurrency = 2);
  
  // Главный метод — выполнить массив задач через пул
  async runAll<T>(tasks: PoolTask<T>[], onProgress?: (done: number, total: number) => void): Promise<Map<string, T | Error>>;
  
  // Round-robin выбор следующего доступного воркера
  private pickWorker(): PoolWorker | null;
  
  // Retry: при 429/402 переназначить на другой воркер
  private retryTask<T>(task: PoolTask<T>, failedWorker: PoolWorker): Promise<T>;
  
  // Статистика для UI
  getStats(): { model: string; completed: number; errors: number; active: number }[];
}
```

**Ключевые моменты:**
- Round-robin с пропуском disabled воркеров
- При ошибке 429/402: задача уходит к следующему воркеру (retry до 2 раз)
- При 3+ ошибках подряд у воркера → disabled (не получает новых задач)
- Общий concurrency = models.length × perModelConcurrency

### 3. Интеграция с useAiRoles

```typescript
// Новые методы в useAiRoles:
getPoolForRole(roleId: AiRoleId): string[]       // список моделей
setPoolForRole(roleId: AiRoleId, models: string[]): void
isPoolEnabled(roleId: AiRoleId): boolean          // pool.length > 1

// Обратная совместимость:
getModelForRole(roleId)  // возвращает первую модель пула (или единственную)
```

### 4. UI — расширение AiRolesTab

```
┌─────────────────────────────────────────────────┐
│ 🎬 Сценарист (Screenwriter)  [standard]         │
│                                                  │
│  Основная модель: [Gemini 2.5 Flash      ▼]     │
│                                                  │
│  ⚡ Пул параллельных моделей:                    │
│  ┌──────────────────────────────────────────┐    │
│  │ ✓ gemini-2.5-flash    (Lovable AI)*     │    │
│  │ ✓ gpt-5-mini          (OpenRouter)      │    │
│  │ □ claude-3.5-sonnet    (OpenRouter)      │    │
│  │ □ deepseek-v3          (ProxyAPI)        │    │
│  └──────────────────────────────────────────┘    │
│  * Lovable AI — только для администраторов       │
│                                                  │
│  Итого воркеров: 4 (2 модели × 2 потока)        │
└─────────────────────────────────────────────────┘
```

- Чекбоксы для добавления моделей в пул (только доступные по ключам)
- Lovable AI модели — только если isAdmin
- Бейдж "⚡ Pool: 4 workers" у ролей с активным пулом
- Сохранение в useCloudSettings("ai_role_model_pools")

### 5. Интеграция с батч-операциями

**BatchSegmentationPanel** (сегментация сцен):
```typescript
// Было: processScene → invoke("segment-scene", { model: getModelForRole("screenwriter") })
// Стало:
const pool = getPoolForRole("screenwriter");
if (pool.length > 1) {
  const manager = new ModelPoolManager(pool, userApiKeys, 2);
  const tasks = scenes.map(s => ({
    id: s.id,
    execute: (model, apiKey) => invokeSegmentScene(s.id, model, apiKey),
  }));
  await manager.runAll(tasks, onProgress);
} else {
  // Классический последовательный режим
}
```

**useCharacterExtraction** (извлечение персонажей):
- Каждая глава = отдельная задача → распределение по пулу Screenwriter/Profiler

**useCharacterProfiles** (профайлинг):
- Каждый персонаж = задача → распределение по пулу Profiler

### 6. Пресеты с пулами

Расширить формат пресетов:
```typescript
interface AiRolePreset {
  name: string;
  models: AiRoleModelMap;       // основные модели
  pools?: AiRolePoolMap;        // пулы (опционально)
}
```

Примеры пресетов:
- **"Быстрая команда"** — Flash-модели + пул из 2-3 лёгких
- **"Максимум качества"** — Pro-модели без пулов
- **"Полный параллель"** — Pro + Flash от разных провайдеров в пулах

## Порядок реализации

| # | Задача | Файлы | Зависимости | Статус |
|---|--------|-------|-------------|--------|
| 1 | ModelPoolManager | `src/lib/modelPoolManager.ts` | — | ✅ Done |
| 2 | Тесты менеджера | `src/lib/__tests__/modelPoolManager.test.ts` | #1 | ✅ Done |
| 3 | Расширить aiRoles.ts | `src/config/aiRoles.ts` | — | ✅ Done |
| 4 | Расширить useAiRoles | `src/hooks/useAiRoles.ts` | #3 | ✅ Done |
| 5 | UI пулов в AiRolesTab | `AiRolesTab.tsx`, `PoolSelector.tsx` | #4 | ✅ Done |
| 6 | Интеграция BatchSegmentationPanel | `BatchSegmentationPanel.tsx`, `StudioWorkspace.tsx`, `Studio.tsx` | #1, #4 | ✅ Done |
| 7 | Интеграция useCharacterExtraction | `useCharacterExtraction.ts`, `useParserCharacters.ts`, `Parser.tsx` | #1, #4 | ✅ Done |
| 8 | Интеграция useCharacterProfiles | `useCharacterProfiles.ts`, `useParserCharacters.ts`, `Parser.tsx` | #1, #4 | ✅ Done |
| 9 | Пресеты с пулами | `src/components/profile/tabs/AiRolePresets.tsx` | #4 | 🔲 |

---

## Итоги реализованных этапов

### Этап 1–2: ModelPoolManager + тесты

**Файл:** `src/lib/modelPoolManager.ts`

Реализован класс `ModelPoolManager` — ядро параллельной обработки:

- **Конструктор:** принимает `models: string[]`, `userApiKeys`, `perModelConcurrency` (default 2). Создаёт массив `PoolWorker` с привязкой к провайдеру и API-ключу через `getModelRegistryEntry()`.
- **`runAll(tasks, onProgress)`** — главный метод. Диспатчит задачи через bounded concurrency:
  - Создаёт пул слотов = `workers.length × perModelConcurrency`
  - Каждая задача получает воркера через `waitForWorker()` (round-robin)
  - При retryable-ошибке (429/402/rate-limit) — retry на следующем воркере (до `MAX_RETRIES=2`)
  - При `DISABLE_THRESHOLD=3` последовательных ошибках — воркер отключается
  - Возвращает `Map<taskId, T | Error>`
- **`waitForWorker()`** — polling (50ms) до появления свободного слота, round-robin с пропуском disabled
- **`getStats()`** — snapshot по воркерам для UI (completed, errors, active, disabled)
- **`isRetryable()`** — regex-матчинг паттернов 429/402/rate-limit/quota/payment/credit

**Тесты:** 8/8 — round-robin порядок, retry на другой воркер, disable после 3 ошибок, progress callback, concurrency ≤ 2, all-disabled fallback.

### Этап 3: Расширение aiRoles.ts

**Файл:** `src/config/aiRoles.ts`

- Добавлено поле `poolable: boolean` в `AiRoleDefinition`:
  - `translator` → `poolable: false` (lite tier, не нужен пул)
  - Все остальные 5 ролей → `poolable: true` (standard + heavy)
- Новый тип `AiRolePoolMap = Partial<Record<AiRoleId, string[]>>` — маппинг роли → массив моделей пула
- Константа `POOLABLE_ROLES: AiRoleId[]` — фильтрованный список ролей с `poolable: true`

### Этап 4: Расширение useAiRoles

**Файл:** `src/hooks/useAiRoles.ts`

Хук расширен пул-методами при полной обратной совместимости:

- **Персистенция:** новый `useCloudSettings<AiRolePoolMap>("ai_role_model_pools", {})` — пулы синхронизируются между устройствами
- **`getPoolForRole(roleId)`** — возвращает текущий пул (пустой массив если роль не poolable)
- **`setPoolForRole(roleId, modelIds[])`** — сохраняет пул с валидацией:
  - Проверяет `poolable` у роли
  - Фильтрует модели по доступности (Lovable AI → только admin, остальные → по apiKey)
  - Пустой валидный список → удаляет ключ из pools
  - Вызывает `takeSnapshot()` для возможности отката
- **`isPoolEnabled(roleId)`** — `pool.length > 1`
- **`getEffectivePool(roleId)`** — primary модель + pool, дедупликация через `Set`. Это массив для передачи в `ModelPoolManager`. Если пул не задан → `[primaryModel]` (single-model fallback)
- **`loadPreset`** — расширен: принимает опциональный `presetPools?: AiRolePoolMap`
- **`resetAll`** — сбрасывает и `overrides`, и `pools`
- **`loaded`** — теперь `loaded && poolsLoaded` (оба стора готовы)
- Экспортируется `poolableRoles` для UI-фильтрации

## Ограничения и риски

1. **Rate limits** — round-robin + retry минимизирует, но при агрессивном concurrency 
   возможны массовые 429. Решение: exponential backoff + disable worker.
2. **Консистентность результатов** — разные модели могут давать разный формат ответов.
   Решение: строгие JSON-схемы (tool_choice) + валидация на edge function.
3. **Стоимость** — параллельные запросы увеличивают расход. UI должен показывать 
   ожидаемый расход (количество API calls).
4. **Lovable AI** — только admin, отдельный rate limit workspace.
    Не смешивать с пользовательскими провайдерами в одном пуле для не-админов.

### Этап 5: UI пулов в AiRolesTab

**Файлы:** `src/components/profile/tabs/PoolSelector.tsx` (новый), `src/components/profile/tabs/AiRolesTab.tsx`

Извлечён отдельный компонент `PoolSelector` для мультивыбора моделей в пул:

- **Collapsible-секция** под основным Select каждой poolable-роли
- **Primary модель** отображается как disabled checkbox с бейджем «основная/primary» — всегда включена в effective pool
- **Остальные модели** группируются по провайдерам (Lovable AI / ProxyAPI / OpenRouter) с чекбоксами
- **Lovable AI модели** — disabled для не-админов с пометкой `(admin)`
- **Worker count badge** `⚡ N потоков/workers` — рассчитывается как `uniqueModels × 2` (perModelConcurrency)
- **Auto-open**: если пул уже заполнен при загрузке — секция развёрнута
- **AiRolesTab** интегрирует `PoolSelector` только для ролей с `poolable: true` (5 из 6, кроме Translator)
- **Pool badge** `🔲 пул/pool` в заголовке карточки роли — виден когда `isPoolEnabled` (>1 модели)
- **Reset** сбрасывает пулы вместе с overrides

### Этап 6: Интеграция ModelPoolManager в BatchSegmentationPanel

**Файлы:** `src/components/studio/BatchSegmentationPanel.tsx`, `src/components/studio/StudioWorkspace.tsx`, `src/pages/Studio.tsx`

BatchSegmentationPanel переработан для двухрежимной работы:

- **Режим пула** (pool enabled, >1 модели для роли `screenwriter`):
  - Создаётся `ModelPoolManager(effectivePool, userApiKeys, 2)` — round-robin с retry
  - Каждая сцена → `PoolTask`, execute вызывает `segment-scene` с `modelId` от менеджера
  - `PoolStats` отображаются в реальном времени: per-model completed/errors/active/disabled
  - Общий throughput: `models × 2` параллельных запросов
  - При abort (`abortRef`) задачи выбрасывают ошибку и пул завершается

- **Классический режим** (single model, без пула):
  - Прежний паттерн с фиксированным concurrency (default 3 workers)
  - Используется `getModelForRole("screenwriter")` — одна модель для всех сцен

- **UI расширения:**
  - Badge `⚡ N потоков/workers` в хедере при активном пуле
  - Строка прогресса показывает `Pool: N models × 2 workers` вместо `Concurrency: N workers`
  - Блок pool stats под прогресс-баром: per-model бейджи с ✓completed, ✗errors, ⟳active
  - Цветовая кодировка: primary (active), destructive (disabled), muted (idle)

- **Проброс данных:** `userApiKeys` пробрасывается Studio.tsx → StudioWorkspace → BatchSegmentationPanel

### Этап 7: Интеграция пула в useCharacterExtraction

**Файлы:** `src/hooks/useCharacterExtraction.ts`, `src/hooks/useParserCharacters.ts`, `src/pages/Parser.tsx`

Извлечение персонажей переработано для двухрежимной работы:

- **Режим пула** (`effectivePool.length > 1`):
  - Каждая глава = отдельная `PoolTask` → распределение через `ModelPoolManager`
  - Общий throughput: `models × 2` параллельных вызовов `extract-characters`
  - Прогресс: `Извлечение: N/M глав` обновляется через `onProgress` callback менеджера
  - Результаты мержатся в `allResults` Map по порядку индексов глав (sorted keys)
  - Retry при 429/402 обрабатывается менеджером автоматически (до 2 попыток)

- **Классический режим** (single model):
  - Последовательная обработка глав с ручным break при rate-limit/payment ошибках
  - Промежуточные snapshot'ы через `buildSnapshot()` после каждой главы

- **Рефакторинг:**
  - Выделена функция `invokeForChapter(chapterData, modelId)` — единая точка вызова edge function
  - Выделена функция `mergeChapterResults(idx, entry, extracted)` — слияние результатов в accumulator
  - Обе используются и в pool, и в classic режиме

- **Проброс:** `effectivePool` передаётся Parser.tsx → useParserCharacters → useCharacterExtraction

### Этап 8: Интеграция пула в useCharacterProfiles

**Файлы:** `src/hooks/useCharacterProfiles.ts`, `src/hooks/useParserCharacters.ts`

Профайлинг персонажей переработан для параллельной обработки:

- **Режим пула** (`effectivePool.length > 1` и `charsToProfile.length > 1`):
  - Персонажи разбиваются на N групп (N = min(pool.length, chars.length)) через `chunkArray()`
  - Каждая группа = `PoolTask` → профилируется отдельной моделью из пула
  - Все 30 сцен-контекста передаются каждой группе (общий контекст)
  - Результаты собираются и применяются единым `applyProfiles()` вызовом
  - Частичный успех: toast с кол-вом удачных профилей и ошибок

- **Классический режим** (single model):
  - Один вызов `profile-characters-local` со всеми персонажами (как было)

- **Рефакторинг:**
  - Выделена функция `invokeProfile(chars, modelId)` — единая точка вызова edge function
  - Выделена функция `applyProfiles(profiles)` — слияние результатов в state + persist
  - Утилита `chunkArray<T>(arr, numChunks)` для деления массива на группы
