/**
 * SoundProvider — abstract interface for generating SFX and music.
 * Currently backed by ElevenLabs; designed for easy swap to
 * Freesound, custom DSP, or any future provider.
 */

import { supabase } from "@/integrations/supabase/client";

// ─── Types ──────────────────────────────────────────────────

export type SoundCategory = "sfx" | "atmosphere" | "music";

export interface GenerateSoundParams {
  prompt: string;
  category: SoundCategory;
  /** Duration in seconds. SFX max 22s, music up to 300s */
  durationSec?: number;
  /** 0-1, how closely to follow prompt (SFX only) */
  promptInfluence?: number;
  lang?: "ru" | "en";
}

export interface GeneratedSound {
  blob: Blob;
  url: string;            // object URL — caller must revoke
  durationSec?: number;
  provider: string;
}

// ─── ElevenLabs provider ────────────────────────────────────

async function getAuthHeaders() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");
  return {
    "Content-Type": "application/json",
    apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    Authorization: `Bearer ${token}`,
  };
}

async function elevenLabsSfx(params: GenerateSoundParams): Promise<GeneratedSound> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-sfx`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: params.prompt,
        duration_seconds: params.durationSec,
        prompt_influence: params.promptInfluence ?? 0.3,
        lang: params.lang ?? "en",
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `SFX generation failed (${response.status})`);
  }

  const blob = await response.blob();
  return { blob, url: URL.createObjectURL(blob), provider: "elevenlabs" };
}

async function elevenLabsMusic(params: GenerateSoundParams): Promise<GeneratedSound> {
  const headers = await getAuthHeaders();
  const response = await fetch(
    `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-music`,
    {
      method: "POST",
      headers,
      body: JSON.stringify({
        prompt: params.prompt,
        duration_seconds: params.durationSec ?? 30,
        lang: params.lang ?? "en",
      }),
    }
  );

  if (!response.ok) {
    const err = await response.json().catch(() => ({ error: "Request failed" }));
    throw new Error(err.error || `Music generation failed (${response.status})`);
  }

  const blob = await response.blob();
  return { blob, url: URL.createObjectURL(blob), provider: "elevenlabs" };
}

// ─── Public API ─────────────────────────────────────────────

export async function generateSound(params: GenerateSoundParams): Promise<GeneratedSound> {
  if (params.category === "music") {
    return elevenLabsMusic(params);
  }
  // sfx + atmosphere both use sound-generation endpoint
  return elevenLabsSfx(params);
}

/**
 * Save generated audio to user-media storage for caching / reuse.
 */
export async function saveToStorage(
  blob: Blob,
  category: SoundCategory,
  fileName: string,
): Promise<string> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user?.id;
  if (!userId) throw new Error("Not authenticated");

  const path = `${userId}/${category}/${fileName}`;
  const { error } = await supabase.storage
    .from("user-media")
    .upload(path, blob, { upsert: true, contentType: "audio/mpeg" });

  if (error) throw error;
  return path;
}
