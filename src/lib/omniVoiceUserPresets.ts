/**
 * OmniVoice user presets — local store + cloud-sync interop.
 *
 * Storage strategy (per user request):
 *   • Primary: OPFS file `omnivoice/user_presets.json` (offline-first).
 *   • Mirror : Supabase `user_settings.omnivoice_advanced_presets` via useCloudSettings.
 *
 * The helpers here only touch OPFS. Cloud sync is wired in the React hook
 * (`useOmniVoiceUserPresets`) so that the same array is mirrored to the cloud
 * automatically whenever it changes.
 */
import type { OmniVoiceAdvancedParams } from "@/components/voicelab/omnivoice/constants";

export interface OmniVoiceUserPreset {
  id: string;
  name: string;
  params: OmniVoiceAdvancedParams;
  speed?: number;
  createdAt: string;
  updatedAt: string;
}

const DIR_NAME = "omnivoice";
const FILE_NAME = "user_presets.json";

async function getDirHandle(create: boolean): Promise<FileSystemDirectoryHandle | null> {
  if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) return null;
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(DIR_NAME, { create });
  } catch (err) {
    if (!create) return null;
    console.warn("[omniVoiceUserPresets] getDirHandle failed:", err);
    return null;
  }
}

async function getFileHandle(create: boolean): Promise<FileSystemFileHandle | null> {
  const dir = await getDirHandle(create);
  if (!dir) return null;
  try {
    return await dir.getFileHandle(FILE_NAME, { create });
  } catch {
    return null;
  }
}

/** Load presets from OPFS. Returns [] if missing/corrupt. */
export async function loadPresetsFromOPFS(): Promise<OmniVoiceUserPreset[]> {
  try {
    const handle = await getFileHandle(false);
    if (!handle) return [];
    const file = await handle.getFile();
    const text = await file.text();
    if (!text.trim()) return [];
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidPreset);
  } catch (err) {
    console.warn("[omniVoiceUserPresets] load failed:", err);
    return [];
  }
}

/** Persist presets to OPFS (atomic-ish write). */
export async function savePresetsToOPFS(presets: OmniVoiceUserPreset[]): Promise<void> {
  const handle = await getFileHandle(true);
  if (!handle) throw new Error("OPFS unavailable");
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(presets, null, 2));
  await writable.close();
}

function isValidPreset(p: unknown): p is OmniVoiceUserPreset {
  if (!p || typeof p !== "object") return false;
  const x = p as Record<string, unknown>;
  return (
    typeof x.id === "string" &&
    typeof x.name === "string" &&
    !!x.params &&
    typeof x.params === "object" &&
    typeof x.createdAt === "string" &&
    typeof x.updatedAt === "string"
  );
}

/** Merge local OPFS presets with cloud copy by id, preferring the newer `updatedAt`. */
export function mergePresets(
  local: OmniVoiceUserPreset[],
  cloud: OmniVoiceUserPreset[],
): OmniVoiceUserPreset[] {
  const map = new Map<string, OmniVoiceUserPreset>();
  for (const p of local) map.set(p.id, p);
  for (const p of cloud) {
    const existing = map.get(p.id);
    if (!existing || new Date(p.updatedAt) > new Date(existing.updatedAt)) {
      map.set(p.id, p);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

/** Build a new preset record from current Advanced state. */
export function makePreset(
  name: string,
  params: OmniVoiceAdvancedParams,
  speed?: number,
): OmniVoiceUserPreset {
  const now = new Date().toISOString();
  return {
    id: (typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: name.trim() || "Untitled preset",
    params: { ...params },
    speed,
    createdAt: now,
    updatedAt: now,
  };
}
