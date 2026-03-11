import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

/**
 * Cloud-synced settings hook. Stores in user_settings table + localStorage cache.
 */
export function useCloudSettings<T>(
  settingKey: string,
  defaultValue: T,
  localStorageKey?: string,
) {
  const { user } = useAuth();
  const cacheKey = localStorageKey || `cloud-${settingKey}`;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [value, setValue] = useState<T>(() => {
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) return JSON.parse(cached) as T;
    } catch {}
    return defaultValue;
  });
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!user?.id) { setLoaded(true); return; }
    let cancelled = false;

    const loadFromDb = async () => {
      try {
        const { data, error } = await supabase
          .from('user_settings')
          .select('setting_value')
          .eq('user_id', user.id)
          .eq('setting_key', settingKey)
          .maybeSingle();

        if (cancelled) return;
        if (!error && data) {
          const dbValue = data.setting_value as T;
          setValue(dbValue);
          try { localStorage.setItem(cacheKey, JSON.stringify(dbValue)); } catch {}
        }
      } catch (err) {
        console.error(`[useCloudSettings] Failed to load "${settingKey}":`, err);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };

    loadFromDb();
    return () => { cancelled = true; };
  }, [user?.id, settingKey, cacheKey]);

  const saveToDb = useCallback((newValue: T) => {
    if (!user?.id) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        await supabase
          .from('user_settings')
          .upsert({
            user_id: user.id,
            setting_key: settingKey,
            setting_value: newValue as any,
          }, { onConflict: 'user_id,setting_key' });
      } catch (err) {
        console.error(`[useCloudSettings] Failed to save "${settingKey}":`, err);
      }
    }, 400);
  }, [user?.id, settingKey]);

  const update = useCallback((newValue: T | ((prev: T) => T)) => {
    setValue((prev) => {
      const resolved = typeof newValue === 'function'
        ? (newValue as (prev: T) => T)(prev)
        : newValue;
      try { localStorage.setItem(cacheKey, JSON.stringify(resolved)); } catch {}
      saveToDb(resolved);
      return resolved;
    });
  }, [cacheKey, saveToDb]);

  const reset = useCallback(() => {
    setValue(defaultValue);
    try { localStorage.removeItem(cacheKey); } catch {}
    if (user?.id) {
      supabase.from('user_settings').delete()
        .eq('user_id', user.id).eq('setting_key', settingKey).then();
    }
  }, [defaultValue, cacheKey, user?.id, settingKey]);

  useEffect(() => {
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, []);

  return { value, update, reset, loaded };
}
