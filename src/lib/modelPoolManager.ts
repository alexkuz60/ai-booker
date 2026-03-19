/**
 * ModelPoolManager — distributes tasks across a pool of AI models
 * using round-robin dispatch with per-model concurrency control.
 *
 * Key behaviours:
 *  - Round-robin picks the next worker with available capacity
 *  - Concurrency: up to `perModelConcurrency` (default 2) parallel requests per model
 *  - On retryable error (429/402): task retries on the next available worker (up to MAX_RETRIES)
 *  - After DISABLE_THRESHOLD consecutive errors a worker is disabled
 *  - Exposes real-time stats for UI progress indicators
 */

import { getModelRegistryEntry } from "@/config/modelRegistry";
import { supabase } from "@/integrations/supabase/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PoolWorker {
  modelId: string;
  provider: string;
  apiKey: string | null;
  activeCount: number;
  maxConcurrency: number;
  /** Consecutive error streak */
  errorCount: number;
  disabled: boolean;
  /** Lifetime counters */
  completedCount: number;
  totalErrors: number;
}

export interface PoolTask<T> {
  id: string;
  execute: (modelId: string, apiKey: string | null) => Promise<T>;
}

export interface PoolStats {
  model: string;
  provider: string;
  completed: number;
  errors: number;
  active: number;
  disabled: boolean;
}

export interface PoolProgress {
  done: number;
  failed: number;
  total: number;
}

/** Errors whose `message` matches these patterns trigger a retry on another worker. */
const RETRYABLE_PATTERNS = [
  /429/i,
  /402/i,
  /rate.?limit/i,
  /too many requests/i,
  /payment required/i,
  /credit/i,
  /quota/i,
];

const MAX_RETRIES = 2;
const DISABLE_THRESHOLD = 3;

// ---------------------------------------------------------------------------
// Manager
// ---------------------------------------------------------------------------

export class ModelPoolManager {
  private workers: PoolWorker[];
  private roundRobinIdx = 0;

  constructor(
    models: string[],
    userApiKeys: Record<string, string>,
    private perModelConcurrency = 2,
  ) {
    if (models.length === 0) {
      throw new Error("ModelPoolManager requires at least one model");
    }

    this.workers = models.map((modelId) => {
      const entry = getModelRegistryEntry(modelId);
      const provider = entry?.provider ?? "unknown";
      const apiKeyField = entry?.apiKeyField;
      const apiKey = apiKeyField ? (userApiKeys[apiKeyField] ?? null) : null;

      return {
        modelId,
        provider,
        apiKey,
        activeCount: 0,
        maxConcurrency: perModelConcurrency,
        errorCount: 0,
        disabled: false,
        completedCount: 0,
        totalErrors: 0,
      };
    });
  }

  /** Total theoretical throughput slots. */
  get totalConcurrency(): number {
    return this.workers.filter((w) => !w.disabled).length * this.perModelConcurrency;
  }

  /** Number of active (non-disabled) workers. */
  get activeWorkerCount(): number {
    return this.workers.filter((w) => !w.disabled).length;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Execute all tasks through the pool. Returns a Map of taskId → result|Error.
   * Tasks run concurrently up to total pool capacity.
   */
  async runAll<T>(
    tasks: PoolTask<T>[],
    onProgress?: (progress: PoolProgress) => void,
  ): Promise<Map<string, T | Error>> {
    const results = new Map<string, T | Error>();
    let done = 0;
    let failed = 0;
    const total = tasks.length;

    // Internal wrapper that handles retry logic
    const runTask = async (task: PoolTask<T>): Promise<void> => {
      let lastError: Error | null = null;

      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const worker = await this.waitForWorker();
        if (!worker) {
          // All workers disabled
          results.set(task.id, new Error("All pool workers disabled"));
          failed++;
          onProgress?.({ done, failed, total });
          return;
        }

        worker.activeCount++;
        try {
          const result = await task.execute(worker.modelId, worker.apiKey);
          worker.activeCount--;
          worker.errorCount = 0; // reset consecutive errors
          worker.completedCount++;
          results.set(task.id, result);
          done++;
          onProgress?.({ done, failed, total });
          return;
        } catch (err) {
          worker.activeCount--;
          const error = err instanceof Error ? err : new Error(String(err));
          lastError = error;

          if (this.isRetryable(error) && attempt < MAX_RETRIES) {
            worker.errorCount++;
            worker.totalErrors++;
            if (worker.errorCount >= DISABLE_THRESHOLD) {
              worker.disabled = true;
            }
            // Continue loop → retry on next worker
            continue;
          }

          // Non-retryable or exhausted retries
          worker.errorCount++;
          worker.totalErrors++;
          if (worker.errorCount >= DISABLE_THRESHOLD) {
            worker.disabled = true;
          }
          break;
        }
      }

      // Exhausted all retries
      results.set(task.id, lastError ?? new Error("Unknown error"));
      failed++;
      onProgress?.({ done, failed, total });
    };

    // Dispatch all tasks with bounded concurrency
    const running: Promise<void>[] = [];
    const taskQueue = [...tasks];

    const startNext = (): Promise<void> | null => {
      const task = taskQueue.shift();
      if (!task) return null;
      const promise = runTask(task).then(() => {
        running.splice(running.indexOf(promise), 1);
      });
      return promise;
    };

    // Fill initial batch
    const maxParallel = this.totalConcurrency || 1;
    for (let i = 0; i < Math.min(maxParallel, tasks.length); i++) {
      const p = startNext();
      if (p) running.push(p);
    }

    // Process remaining tasks as slots free up
    while (running.length > 0) {
      await Promise.race(running);
      // Fill freed slots
      while (running.length < (this.totalConcurrency || 1) && taskQueue.length > 0) {
        const p = startNext();
        if (p) running.push(p);
      }
    }

    return results;
  }

  /** Current stats per worker for UI display. */
  getStats(): PoolStats[] {
    return this.workers.map((w) => ({
      model: w.modelId,
      provider: w.provider,
      completed: w.completedCount,
      errors: w.totalErrors,
      active: w.activeCount,
      disabled: w.disabled,
    }));
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Pick the next available worker (round-robin, skip disabled / at-capacity).
   * If all workers are busy, polls every 50ms until a slot opens.
   * Returns null only if ALL workers are disabled.
   */
  private waitForWorker(): Promise<PoolWorker | null> {
    return new Promise((resolve) => {
      const tryPick = () => {
        // Check if any workers are still alive
        const alive = this.workers.filter((w) => !w.disabled);
        if (alive.length === 0) {
          resolve(null);
          return;
        }

        // Try round-robin across all workers
        for (let i = 0; i < this.workers.length; i++) {
          const idx = (this.roundRobinIdx + i) % this.workers.length;
          const w = this.workers[idx];
          if (!w.disabled && w.activeCount < w.maxConcurrency) {
            this.roundRobinIdx = (idx + 1) % this.workers.length;
            resolve(w);
            return;
          }
        }

        // All alive workers are at capacity — poll
        setTimeout(tryPick, 50);
      };

      tryPick();
    });
  }

  private isRetryable(error: Error): boolean {
    const msg = error.message;
    return RETRYABLE_PATTERNS.some((pattern) => pattern.test(msg));
  }
}

// ---------------------------------------------------------------------------
// Pool stats logging
// ---------------------------------------------------------------------------

/**
 * Log pool execution stats to proxy_api_logs for analytics.
 * One row per worker model, with request_type = "pool_<taskType>".
 *
 * @param stats - Final pool stats from manager.getStats()
 * @param taskType - e.g. "extract_characters", "profile_characters", "segment_scene"
 * @param totalDurationMs - Wall-clock time of the entire pool run
 */
export async function logPoolStats(
  stats: PoolStats[],
  taskType: string,
  totalDurationMs: number,
): Promise<void> {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const rows = stats
      .filter(s => s.completed > 0 || s.errors > 0)
      .map(s => ({
        user_id: user.id,
        model_id: s.model,
        provider: s.provider,
        request_type: `pool_${taskType}`,
        status: s.disabled ? "error" : "success",
        latency_ms: stats.length > 0 ? Math.round(totalDurationMs / stats.length) : 0,
        tokens_input: s.completed,  // repurpose: completed task count
        tokens_output: s.errors,    // repurpose: error count
        error_message: s.disabled ? "worker_disabled" : null,
      }));

    if (rows.length > 0) {
      await supabase.from("proxy_api_logs").insert(rows);
    }
  } catch (err) {
    console.warn("[PoolStats] Failed to log pool stats:", err);
  }
}
