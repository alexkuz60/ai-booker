import { useCallback, useMemo } from "react";
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
 */
export function useAiRoles(userApiKeys: Record<string, string> = {}) {
  const { isAdmin } = useUserRole();
  const { value: overrides, update: setOverrides, loaded } =
    useCloudSettings<AiRoleModelMap>("ai_role_models", {});

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
        // Verify the model is still available to the user
        const entry = getModelRegistryEntry(override);
        if (entry) {
          if (entry.provider === "lovable" && isAdmin) return override;
          if (entry.apiKeyField && userApiKeys[entry.apiKeyField]) return override;
        }
        // Override invalid → fall back to default
      }
      return defaults[roleId];
    },
    [overrides, defaults, isAdmin, userApiKeys]
  );

  /** Get system prompt for a role */
  const getPromptForRole = useCallback((roleId: AiRoleId): string => {
    return AI_ROLES[roleId].systemPrompt;
  }, []);

  /** Set model override for a specific role */
  const setModelForRole = useCallback(
    (roleId: AiRoleId, modelId: string | null) => {
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
    [setOverrides, defaults]
  );

  /** Reset all overrides to defaults */
  const resetAll = useCallback(() => {
    setOverrides({});
  }, [setOverrides]);

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
  };
}
