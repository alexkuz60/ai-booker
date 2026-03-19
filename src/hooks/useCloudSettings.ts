import { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';

/**
 * Cloud-synced settings hook. Stores in user_settings table + localStorage cache.
 *
 * Key behaviors:
 * - localStorage is updated synchronously on every change (instant UI).
 * - DB save is debounced (400ms) for performance.
 * - On unmount: pending DB save is FLUSHED (not cancelled) to prevent data loss.
 * - On DB load: skipped if local changes were made since mount (prevents overwrite).
 */
export function useCloudSettings<T>(
  settingKey: string,
  defaultValue: T,
  localStorageKey?: string,
) {
  const { user } = useAuth();
  const cacheKey = localStorageKey || `cloud-${settingKey}`;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Track the pending save payload so we can flush it on unmount */
  const pendingSaveRef = useRef<{ userId: string; value: T } | null>(null);
  /** Flag: true once the user has made a local change in this hook instance */
  const locallyDirtyRef = useRef(false);
  /** Stable ref to flushToDb so the unmount effect doesn't need it as a dep */
  const flushRef = useRef<(userId: string, value: T) => Promise<void>>();

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
        // Only apply DB value if we haven't made local changes since mount
        if (!error && data && !locallyDirtyRef.current) {
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

  /** Immediately persist to DB (no debounce) */
  const flushToDb = useCallback(async (userId: string, newValue: T) => {
    try {
      await supabase
        .from('user_settings')
        .upsert({
          user_id: userId,
          setting_key: settingKey,
          setting_value: newValue as Json,
        }, { onConflict: 'user_id,setting_key' });
    } catch (err) {
      console.error(`[useCloudSettings] Failed to save "${settingKey}":`, err);
    }
  }, [settingKey]);

  const saveToDb = useCallback((newValue: T) => {
    if (!user?.id) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    pendingSaveRef.current = { userId: user.id, value: newValue };
    debounceRef.current = setTimeout(async () => {
      pendingSaveRef.current = null;
      await flushToDb(user.id, newValue);
    }, 400);
  }, [user?.id, flushToDb]);

  const update = useCallback((newValue: T | ((prev: T) => T)) => {
    locallyDirtyRef.current = true;
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
    locallyDirtyRef.current = true;
    setValue(defaultValue);
    try { localStorage.removeItem(cacheKey); } catch {}
    if (user?.id) {
      supabase.from('user_settings').delete()
        .eq('user_id', user.id).eq('setting_key', settingKey).then();
    }
  }, [defaultValue, cacheKey, user?.id, settingKey]);

  // On unmount: FLUSH pending save instead of cancelling
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
      const pending = pendingSaveRef.current;
      if (pending) {
        pendingSaveRef.current = null;
        // Fire-and-forget: save completes even after unmount
        flushToDb(pending.userId, pending.value);
      }
    };
  }, [flushToDb]);

  return { value, update, reset, loaded };
}
