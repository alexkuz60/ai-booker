import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock modelRegistry before importing manager
vi.mock("@/config/modelRegistry", () => ({
  getModelRegistryEntry: (id: string) => {
    if (id.startsWith("lovable/"))
      return { id, provider: "lovable", apiKeyField: null };
    if (id.startsWith("proxyapi/"))
      return { id, provider: "proxyapi", apiKeyField: "proxyapi" };
    if (id.startsWith("openrouter/"))
      return { id, provider: "openrouter", apiKeyField: "openrouter" };
    return undefined;
  },
}));

import { ModelPoolManager, type PoolTask } from "../modelPoolManager";

function makeTask<T>(id: string, fn: () => Promise<T>): PoolTask<T> {
  return { id, execute: () => fn() };
}

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

describe("ModelPoolManager", () => {
  const keys = { proxyapi: "pk_test", openrouter: "or_test" };

  it("throws on empty models list", () => {
    expect(() => new ModelPoolManager([], keys)).toThrow("at least one model");
  });

  it("initialises workers from model list", () => {
    const pool = new ModelPoolManager(
      ["lovable/a", "proxyapi/b", "openrouter/c"],
      keys,
      2,
    );
    expect(pool.totalConcurrency).toBe(6); // 3 × 2
    expect(pool.activeWorkerCount).toBe(3);
    const stats = pool.getStats();
    expect(stats).toHaveLength(3);
    expect(stats[0].provider).toBe("lovable");
    expect(stats[1].provider).toBe("proxyapi");
  });

  it("round-robins tasks across workers", async () => {
    const usedModels: string[] = [];
    const pool = new ModelPoolManager(["lovable/a", "proxyapi/b"], keys, 1);
    const tasks: PoolTask<string>[] = Array.from({ length: 4 }, (_, i) => ({
      id: `t${i}`,
      execute: async (model) => {
        usedModels.push(model);
        return "ok";
      },
    }));

    await pool.runAll(tasks);
    // Expect alternating: a, b, a, b
    expect(usedModels).toEqual([
      "lovable/a",
      "proxyapi/b",
      "lovable/a",
      "proxyapi/b",
    ]);
  });

  it("retries on 429 error with a different worker", async () => {
    const callLog: string[] = [];
    let failCount = 0;
    const pool = new ModelPoolManager(["lovable/a", "proxyapi/b"], keys, 1);

    const tasks: PoolTask<string>[] = [
      {
        id: "retry-task",
        execute: async (model) => {
          callLog.push(model);
          if (model === "lovable/a" && failCount === 0) {
            failCount++;
            throw new Error("429 Too Many Requests");
          }
          return "success";
        },
      },
    ];

    const results = await pool.runAll(tasks);
    expect(results.get("retry-task")).toBe("success");
    // First attempt on a (fails), retry on b (succeeds)
    expect(callLog.length).toBe(2);
    expect(callLog[0]).toBe("lovable/a");
    expect(callLog[1]).toBe("proxyapi/b");
  });

  it("disables worker after 3 consecutive errors", async () => {
    const pool = new ModelPoolManager(["lovable/a", "proxyapi/b"], keys, 1);
    let callIdx = 0;

    // 5 tasks — worker A will fail on all of them (non-retryable),
    // so it should get disabled after 3
    const tasks: PoolTask<string>[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      execute: async (model) => {
        callIdx++;
        if (model === "lovable/a") {
          throw new Error("internal server error");
        }
        return "ok";
      },
    }));

    await pool.runAll(tasks);
    const stats = pool.getStats();
    const workerA = stats.find((s) => s.model === "lovable/a")!;
    expect(workerA.disabled).toBe(true);
  });

  it("reports progress", async () => {
    const pool = new ModelPoolManager(["lovable/a"], keys, 2);
    const progressCalls: { done: number; failed: number; total: number }[] = [];

    const tasks: PoolTask<string>[] = [
      makeTask("ok1", async () => "r1"),
      makeTask("ok2", async () => "r2"),
      {
        id: "fail",
        execute: async () => {
          throw new Error("boom");
        },
      },
    ];

    await pool.runAll(tasks, (p) => progressCalls.push({ ...p }));

    // Final progress should show 2 done + 1 failed out of 3
    const last = progressCalls[progressCalls.length - 1];
    expect(last.total).toBe(3);
    expect(last.done + last.failed).toBe(3);
  });

  it("returns Error for all tasks when all workers disabled", async () => {
    // single worker with concurrency=1, it will fail 3 times and get disabled
    const pool = new ModelPoolManager(["lovable/a"], keys, 1);
    let count = 0;

    const tasks: PoolTask<string>[] = Array.from({ length: 5 }, (_, i) => ({
      id: `t${i}`,
      execute: async () => {
        count++;
        throw new Error("429 rate limit");
      },
    }));

    const results = await pool.runAll(tasks);
    // Some tasks should have "All pool workers disabled" error
    const errors = [...results.values()].filter((v) => v instanceof Error);
    expect(errors.length).toBeGreaterThan(0);
    const disabledError = errors.find(
      (e) => e instanceof Error && e.message.includes("disabled"),
    );
    expect(disabledError).toBeDefined();
  });

  it("respects per-model concurrency", async () => {
    let peakConcurrency = 0;
    let current = 0;
    const pool = new ModelPoolManager(["lovable/a"], keys, 2);

    const tasks: PoolTask<string>[] = Array.from({ length: 6 }, (_, i) => ({
      id: `t${i}`,
      execute: async () => {
        current++;
        peakConcurrency = Math.max(peakConcurrency, current);
        await delay(30);
        current--;
        return "ok";
      },
    }));

    await pool.runAll(tasks);
    // With 1 model × concurrency 2, peak should be ≤ 2
    expect(peakConcurrency).toBeLessThanOrEqual(2);
    expect(peakConcurrency).toBeGreaterThanOrEqual(1);
  });
});
