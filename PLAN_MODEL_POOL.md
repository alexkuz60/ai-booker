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

| # | Задача | Файлы | Зависимости |
|---|--------|-------|-------------|
| 1 | ModelPoolManager | `src/lib/modelPoolManager.ts` | — |
| 2 | Тесты менеджера | `src/lib/__tests__/modelPoolManager.test.ts` | #1 |
| 3 | Расширить aiRoles.ts | `src/config/aiRoles.ts` | — |
| 4 | Расширить useAiRoles | `src/hooks/useAiRoles.ts` | #3 |
| 5 | UI пулов в AiRolesTab | `src/components/profile/tabs/AiRolesTab.tsx` | #4 |
| 6 | Интеграция BatchSegmentationPanel | `src/components/studio/BatchSegmentationPanel.tsx` | #1, #4 |
| 7 | Интеграция useCharacterExtraction | `src/hooks/useCharacterExtraction.ts` | #1, #4 |
| 8 | Интеграция useCharacterProfiles | `src/hooks/useCharacterProfiles.ts` | #1, #4 |
| 9 | Пресеты с пулами | `src/components/profile/tabs/AiRolePresets.tsx` | #4 |

## Ограничения и риски

1. **Rate limits** — round-robin + retry минимизирует, но при агрессивном concurrency 
   возможны массовые 429. Решение: exponential backoff + disable worker.
2. **Консистентность результатов** — разные модели могут давать разный формат ответов.
   Решение: строгие JSON-схемы (tool_choice) + валидация на edge function.
3. **Стоимость** — параллельные запросы увеличивают расход. UI должен показывать 
   ожидаемый расход (количество API calls).
4. **Lovable AI** — только admin, отдельный rate limit workspace.
   Не смешивать с пользовательскими провайдерами в одном пуле для не-админов.
