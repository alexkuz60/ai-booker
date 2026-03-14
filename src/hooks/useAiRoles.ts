import { useCallback, useMemo, useRef } from "react";
import { useCloudSettings } from "./useCloudSettings";
import { useUserRole } from "./useUserRole";
import {
  type AiRoleId,
  type AiRoleModelMap,
  AI_ROLES,
  getDefaultAdminModels,
  getDefaultUserModels,
} from "@/config/aiRoles";
import { getModelRegistryEntry, getAvailableModels } from "@/config/modelRegistry";

/**
 * Hook to manage AI role → model mappings.
 * Admin gets Lovable AI defaults, users get external provider defaults.
 * Overrides are stored in cloud settings.
 *
 * "Pre-edit snapshot": before the first change in a session,
 * the current overrides are saved. Reset restores to that snapshot
 * (the last "working" set) instead of clearing everything.
 */
export function useAiRoles(userApiKeys: Record<string, string> = {}) {
  const { isAdmin } = useUserRole();
  const { value: overrides, update: setOverrides, loaded } =
    useCloudSettings<AiRoleModelMap>("ai_role_models", {});
  const {
    value: preEditSnapshot,
    update: setPreEditSnapshot,
  } = useCloudSettings<AiRoleModelMap | null>("ai_role_models_pre_edit", null);

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

  /** Set model override for a specific role — snapshots pre-edit state on first change */
  const setModelForRole = useCallback(
    (roleId: AiRoleId, modelId: string | null) => {
      // Snapshot current overrides before first edit
      if (!snapshotTakenRef.current && preEditSnapshot === null) {
        setPreEditSnapshot({ ...overrides });
        snapshotTakenRef.current = true;
      }
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
    [setOverrides, defaults, preEditSnapshot, setPreEditSnapshot, overrides]
  );

  /** Reset to pre-edit snapshot (last working set) or defaults */
  const resetAll = useCallback(() => {
    if (preEditSnapshot !== null) {
      setOverrides(preEditSnapshot);
      setPreEditSnapshot(null);
    } else {
      setOverrides({});
    }
    snapshotTakenRef.current = false;
  }, [setOverrides, preEditSnapshot, setPreEditSnapshot]);

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
    resolvedModels,
    overrides,
    getModelForRole,
    getPromptForRole,
    setModelForRole,
    resetAll,
    availableModels,
    isAdmin,
    loaded,
    hasPreEditSnapshot,
  };
}
