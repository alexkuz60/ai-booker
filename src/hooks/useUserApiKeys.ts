import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "./useAuth";

/**
 * Loads user API keys from the profiles table.
 * Shared across Parser, Studio, and Montage pages.
 */
export function useUserApiKeys() {
  const { user } = useAuth();
  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!user?.id) return;
    supabase
      .from("profiles")
      .select("api_keys")
      .eq("id", user.id)
      .single()
      .then(({ data }) => {
        if (data?.api_keys) setApiKeys(data.api_keys as Record<string, string>);
      });
  }, [user?.id]);

  return apiKeys;
}
