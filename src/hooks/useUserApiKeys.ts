import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

const API_KEYS_CACHE_KEY = "profile-api-keys-cache";

/**
 * Loads user API keys from the profiles table.
 * Shared across Parser, Studio, and Montage pages.
 */
export function useUserApiKeys() {
  const { user } = useAuth();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => {
    try {
      const raw = localStorage.getItem(API_KEYS_CACHE_KEY);
      return raw ? JSON.parse(raw) as Record<string, string> : {};
    } catch {
      return {};
    }
  });

  useEffect(() => {
    if (!user?.id) {
      setApiKeys({});
      try {
        localStorage.removeItem(API_KEYS_CACHE_KEY);
      } catch {}
      return;
    }
    supabase
      .from("profiles")
      .select("api_keys")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        const next = (data?.api_keys as Record<string, string>) || {};
        setApiKeys(next);
        try {
          localStorage.setItem(API_KEYS_CACHE_KEY, JSON.stringify(next));
        } catch {}
      });
  }, [user?.id]);

  return apiKeys;
}
