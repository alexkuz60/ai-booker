import { useCallback, useMemo, useRef } from "react";
import { useCloudSettings } from "./useCloudSettings";
import { useUserRole } from "./useUserRole";
import {
  type AiRoleId,
  type AiRoleModelMap,
  type AiRolePoolMap,
  AI_ROLES,
  POOLABLE_ROLES,
  getDefaultAdminModels,
  getDefaultUserModels,
} from "@/config/aiRoles";
import { getModelRegistryEntry, getAvailableModels } from "@/config/modelRegistry";

/**
 * Hook to manage AI role → model mappings AND model pools.
 *
 * Single-model mapping: used for lite roles and as the "primary" model for poolable roles.
 * Pool mapping: additional models for parallel batch processing (standard + heavy roles).
 *
 * "Pre-edit snapshot": before the first change in a session,
 * the current overrides are saved. Reset restores to that snapshot.
 */
export function useAiRoles(userApiKeys: Record<string, string> = {}) {
  const { isAdmin } = useUserRole();
  const { value: overrides, update: setOverrides, loaded } =
    useCloudSettings<AiRoleModelMap>("ai_role_models", {});
  const {
    value: preEditSnapshot,
    update: setPreEditSnapshot,
  } = useCloudSettings<AiRoleModelMap | null>("ai_role_models_pre_edit", null);

  // ── Pool state ──────────────────────────────────────────────────────────
  const { value: pools, update: setPools, loaded: poolsLoaded } =
    useCloudSettings<AiRolePoolMap>("ai_role_model_pools", {});

  /** Track whether we've already taken a snapshot this session */
  const snapshotTakenRef = useRef(false);

  /** Defaults based on user role */
  const defaults = useMemo(
    () => (isAdmin ? getDefaultAdminModels() : getDefaultUserModels()),
    [isAdmin]
  );

  /** Resolved model for a given role (override > default) */
  const getModelForRole = useCallback(
    (roleId: AiRoleId): string => {
      const override = overrides[roleId];
      if (override) {
        const entry = getModelRegistryEntry(override);
        if (entry) {
          if (entry.provider === "lovable" && isAdmin) return override;
          if (entry.apiKeyField && userApiKeys[entry.apiKeyField]) return override;
        }
      }
      return defaults[roleId];
    },
    [overrides, defaults, isAdmin, userApiKeys]
  );

  /** Get system prompt for a role */
  const getPromptForRole = useCallback((roleId: AiRoleId): string => {
    return AI_ROLES[roleId].systemPrompt;
  }, []);

  // ── Snapshot helper ─────────────────────────────────────────────────────
  const takeSnapshot = useCallback(() => {
    if (!snapshotTakenRef.current && preEditSnapshot === null) {
      setPreEditSnapshot({ ...overrides });
      snapshotTakenRef.current = true;
    }
  }, [preEditSnapshot, setPreEditSnapshot, overrides]);

  /** Set model override for a specific role — snapshots pre-edit state on first change */
  const setModelForRole = useCallback(
    (roleId: AiRoleId, modelId: string | null) => {
      takeSnapshot();
      setOverrides((prev) => {
        const next = { ...prev };
        if (modelId === null || modelId === defaults[roleId]) {
          delete next[roleId];
        } else {
          next[roleId] = modelId;
        }
        return next;
      });
    },
    [setOverrides, defaults, takeSnapshot]
  );

  /** Reset to pre-edit snapshot (last working set) or defaults */
  const resetAll = useCallback(() => {
    if (preEditSnapshot !== null) {
      setOverrides(preEditSnapshot);
      setPreEditSnapshot(null);
    } else {
      setOverrides({});
    }
    setPools({});
    snapshotTakenRef.current = false;
  }, [setOverrides, setPools, preEditSnapshot, setPreEditSnapshot]);

  /** Load a preset — apply all its model mappings as overrides */
  const loadPreset = useCallback(
    (models: AiRoleModelMap, presetPools?: AiRolePoolMap) => {
      takeSnapshot();
      const next: AiRoleModelMap = {};
      for (const [roleId, modelId] of Object.entries(models)) {
        if (modelId && modelId !== defaults[roleId as AiRoleId]) {
          next[roleId as AiRoleId] = modelId;
        }
      }
      setOverrides(next);
      if (presetPools) {
        setPools(presetPools);
      }
    },
    [setOverrides, setPools, defaults, takeSnapshot],
  );

  // ── Pool methods ────────────────────────────────────────────────────────

  /** Get the model pool for a role (empty array = no pool, single-model mode) */
  const getPoolForRole = useCallback(
    (roleId: AiRoleId): string[] => {
      if (!AI_ROLES[roleId].poolable) return [];
      return pools[roleId] ?? [];
    },
    [pools]
  );

  /**
   * Set the pool for a role. Pass empty array to disable pooling.
   * Only models available to the current user (by API keys) are kept.
   */
  const setPoolForRole = useCallback(
    (roleId: AiRoleId, modelIds: string[]) => {
      if (!AI_ROLES[roleId].poolable) return;
      takeSnapshot();
      setPools((prev) => {
        const next = { ...prev };
        const valid = modelIds.filter((id) => {
          const entry = getModelRegistryEntry(id);
          if (!entry) return false;
          if (entry.provider === "lovable") return isAdmin;
          return entry.apiKeyField ? !!userApiKeys[entry.apiKeyField] : false;
        });
        if (valid.length === 0) {
          delete next[roleId];
        } else {
          next[roleId] = valid;
        }
        return next;
      });
    },
    [setPools, takeSnapshot, isAdmin, userApiKeys]
  );

  /** Whether a role has an active pool (>1 model) */
  const isPoolEnabled = useCallback(
    (roleId: AiRoleId): boolean => {
      const pool = pools[roleId];
      return !!pool && pool.length > 1;
    },
    [pools]
  );

  /**
   * Effective pool for batch operations.
   * If pool is explicitly configured → use ONLY pool models (user's explicit choice).
   * If no pool configured → fallback to [primaryModel] for single-model mode.
   */
  const getEffectivePool = useCallback(
    (roleId: AiRoleId): string[] => {
      const pool = pools[roleId];
      if (pool && pool.length > 0) return [...pool];
      return [getModelForRole(roleId)];
    },
    [getModelForRole, pools]
  );

  /**
   * Resolved model for batch/queue operations.
   * If a pool is configured, returns the first pool model (user's explicit choice).
   * Otherwise falls back to the standard role primary model.
   * This prevents using the default Lovable AI model when user has configured alternatives.
   */
  const getModelForBatch = useCallback(
    (roleId: AiRoleId): string => {
      const pool = pools[roleId];
      if (pool && pool.length > 0) return pool[0];
      return getModelForRole(roleId);
    },
    [getModelForRole, pools]
  );

  /** Full resolved map */
  const resolvedModels = useMemo(() => {
    const result: Record<AiRoleId, string> = { ...defaults };
    for (const roleId of Object.keys(defaults) as AiRoleId[]) {
      result[roleId] = getModelForRole(roleId);
    }
    return result;
  }, [defaults, getModelForRole]);

  /** Models available to the current user */
  const availableModels = useMemo(
    () => getAvailableModels(userApiKeys),
    [userApiKeys]
  );

  /** Whether there's a pre-edit snapshot to restore to */
  const hasPreEditSnapshot = preEditSnapshot !== null;

  return {
    // Single-model API (unchanged)
    resolvedModels,
    overrides,
    getModelForRole,
    getPromptForRole,
    setModelForRole,
    resetAll,
    loadPreset,
    availableModels,
    isAdmin,
    loaded: loaded && poolsLoaded,
    hasPreEditSnapshot,
    // Pool API (new)
    pools,
    getPoolForRole,
    setPoolForRole,
    isPoolEnabled,
    getEffectivePool,
    poolableRoles: POOLABLE_ROLES,
  };
}
