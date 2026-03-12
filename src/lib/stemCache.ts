/**
 * Stem cache — uses the Cache API to persist fetched audio stems
 * across page reloads. Key = stable audioPath (not the signed URL).
 */

const CACHE_NAME = "booker-stem-cache-v1";

/**
 * Fetch audio with cache-first strategy.
 * @param cacheKey Stable key (e.g. audioPath in storage)
 * @param networkUrl Signed URL for fetching from storage
 * @returns ArrayBuffer of audio data
 */
export async function fetchWithStemCache(
  cacheKey: string,
  networkUrl: string
): Promise<ArrayBuffer> {
  try {
    const cache = await caches.open(CACHE_NAME);
    const fakeUrl = `/_stem_/${cacheKey}`;

    // 1. Check cache
    const cached = await cache.match(fakeUrl);
    if (cached) {
      console.log(`[StemCache] HIT: ${cacheKey}`);
      return cached.arrayBuffer();
    }

    // 2. Fetch from network
    console.log(`[StemCache] MISS, fetching: ${cacheKey}`);
    const response = await fetch(networkUrl);
    if (!response.ok) {
      throw new Error(`Fetch failed: ${response.status} ${response.statusText}`);
    }

    // Clone before consuming — one for cache, one for return
    const cloned = response.clone();
    // Store in cache (fire-and-forget, don't block)
    cache.put(fakeUrl, cloned).catch((e) =>
      console.warn("[StemCache] Failed to store:", cacheKey, e)
    );

    return response.arrayBuffer();
  } catch (err) {
    // If Cache API unavailable, fall back to plain fetch
    console.warn("[StemCache] Cache API error, falling back to fetch:", err);
    const response = await fetch(networkUrl);
    if (!response.ok) throw new Error(`Fetch failed: ${response.status}`);
    return response.arrayBuffer();
  }
}

/**
 * Clear all cached stems (e.g. when switching chapters).
 */
export async function clearStemCache(): Promise<void> {
  try {
    const deleted = await caches.delete(CACHE_NAME);
    if (deleted) console.log("[StemCache] Cache cleared");
  } catch (e) {
    console.warn("[StemCache] Failed to clear cache:", e);
  }
}

/**
 * Remove specific keys from the cache.
 */
export async function removeStemCacheEntries(keys: string[]): Promise<void> {
  try {
    const cache = await caches.open(CACHE_NAME);
    await Promise.all(keys.map((k) => cache.delete(`/_stem_/${k}`)));
  } catch (e) {
    console.warn("[StemCache] Failed to remove entries:", e);
  }
}
