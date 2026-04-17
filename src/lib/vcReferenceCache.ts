/**
 * vcReferenceCache.ts — Global OPFS cache for Voice Conversion reference audio.
 * Stores target voice samples in `vc-references/` directory.
 * Separate from per-project storage and vc-models/.
 *
 * Each reference is stored as:
 *   vc-references/{id}.wav   — audio file
 *   vc-references/{id}.json  — metadata (name, source, duration, etc.)
 */

export interface VcReferenceEntry {
  /** Unique ID (uuid or slug) */
  id: string;
  /** Display name */
  name: string;
  /** Source: "upload" (user file) or "collection" (voice_references table) */
  source: "upload" | "collection";
  /** Original voice_references row ID (if from collection) */
  sourceId?: string;
  /** Category (male/female/child) */
  category?: string;
  /** Duration in ms */
  durationMs: number;
  /** Sample rate */
  sampleRate: number;
  /** File size in bytes */
  sizeBytes: number;
  /** When added */
  addedAt: string;
  /** Recognized speech text in the reference (used by OmniVoice cloning as ref_text) */
  transcript?: string;
}

const VC_REF_DIR = "vc-references";

let persistenceRequested = false;

async function requestPersistence(): Promise<void> {
  if (persistenceRequested) return;
  persistenceRequested = true;
  try {
    if (navigator.storage?.persist) {
      const granted = await navigator.storage.persist();
      console.info(`[vcRefCache] Persistent storage ${granted ? "granted" : "denied"}`);
    }
  } catch { /* ignore */ }
}

async function getRefDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(VC_REF_DIR, { create: true });
  } catch (e) {
    console.warn("[vcRefCache] Cannot open OPFS dir:", e);
    return null;
  }
}

/** List all cached reference entries */
export async function listVcReferences(): Promise<VcReferenceEntry[]> {
  const dir = await getRefDir();
  if (!dir) return [];
  const entries: VcReferenceEntry[] = [];
  for await (const [name] of (dir as any).entries()) {
    if (!name.endsWith(".json")) continue;
    try {
      const fh = await dir.getFileHandle(name);
      const file = await fh.getFile();
      const meta: VcReferenceEntry = JSON.parse(await file.text());
      entries.push(meta);
    } catch { /* skip corrupt */ }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Check if a reference exists */
export async function hasVcReference(id: string): Promise<boolean> {
  const dir = await getRefDir();
  if (!dir) return false;
  try {
    await dir.getFileHandle(`${id}.wav`);
    return true;
  } catch {
    return false;
  }
}

/** Read reference audio as ArrayBuffer */
export async function readVcReference(id: string): Promise<ArrayBuffer | null> {
  const dir = await getRefDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(`${id}.wav`);
    const file = await fh.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

/** Read reference audio as Blob */
export async function readVcReferenceBlob(id: string): Promise<Blob | null> {
  const dir = await getRefDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(`${id}.wav`);
    return await fh.getFile();
  } catch {
    return null;
  }
}

/** Save a reference (audio + metadata) */
export async function saveVcReference(
  id: string,
  audioBlob: Blob,
  meta: VcReferenceEntry,
): Promise<boolean> {
  await requestPersistence();
  const dir = await getRefDir();
  if (!dir) return false;
  try {
    // Write audio
    const audioFh = await dir.getFileHandle(`${id}.wav`, { create: true });
    const audioW = await audioFh.createWritable();
    await audioW.write(audioBlob);
    await audioW.close();

    // Write metadata
    const metaFh = await dir.getFileHandle(`${id}.json`, { create: true });
    const metaW = await metaFh.createWritable();
    await metaW.write(JSON.stringify(meta, null, 2));
    await metaW.close();

    console.info(`[vcRefCache] Saved reference "${meta.name}" (${(meta.sizeBytes / 1024).toFixed(0)} KB)`);
    return true;
  } catch (e) {
    console.error("[vcRefCache] Save error:", e);
    return false;
  }
}

/** Delete a reference */
export async function deleteVcReference(id: string): Promise<boolean> {
  const dir = await getRefDir();
  if (!dir) return false;
  try {
    await dir.removeEntry(`${id}.wav`);
  } catch { /* ok */ }
  try {
    await dir.removeEntry(`${id}.json`);
  } catch { /* ok */ }
  return true;
}

/** Get total size of all cached references */
export async function getVcReferencesTotalSize(): Promise<number> {
  const refs = await listVcReferences();
  return refs.reduce((sum, r) => sum + r.sizeBytes, 0);
}

/** Read metadata for a single reference */
export async function readVcReferenceMeta(id: string): Promise<VcReferenceEntry | null> {
  const dir = await getRefDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(`${id}.json`);
    const file = await fh.getFile();
    return JSON.parse(await file.text()) as VcReferenceEntry;
  } catch {
    return null;
  }
}

/**
 * Patch metadata fields (e.g. transcript) without touching the audio file.
 * Returns updated entry or null on failure.
 */
export async function updateVcReferenceMeta(
  id: string,
  patch: Partial<Omit<VcReferenceEntry, "id">>,
): Promise<VcReferenceEntry | null> {
  const dir = await getRefDir();
  if (!dir) return null;
  const current = await readVcReferenceMeta(id);
  if (!current) return null;
  const next: VcReferenceEntry = { ...current, ...patch, id: current.id };
  try {
    const metaFh = await dir.getFileHandle(`${id}.json`, { create: true });
    const w = await metaFh.createWritable();
    await w.write(JSON.stringify(next, null, 2));
    await w.close();
    return next;
  } catch (e) {
    console.error("[vcRefCache] updateMeta error:", e);
    return null;
  }
}
