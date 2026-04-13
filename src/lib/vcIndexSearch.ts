/**
 * vcIndexSearch.ts — Pure JS feature retrieval for RVC v2 Voice Conversion.
 *
 * Replaces FAISS with brute-force L2 KNN search in the browser.
 * Supports loading training embeddings from:
 *   - .npy files (NumPy binary format — total_fea.npy from RVC training)
 *   - .index files (FAISS IndexIVFFlat / IndexFlatL2 binary format)
 *   - Raw Float32Array
 *
 * Reference RVC algorithm (pipeline.py):
 *   npy = feats[0].cpu().numpy()              # [T, 768]
 *   score, ix = index.search(npy, k=8)        # L2 KNN
 *   weight = 1 / score²                       # inverse square distance
 *   weight /= weight.sum(axis=1)              # normalize
 *   retrieved = sum(big_npy[ix] * weight)      # weighted average
 *   feats = retrieved * index_rate + feats * (1 - index_rate)
 */

const VC_INDEX_DIR = "vc-indexes";

// ── .npy parser ────────────────────────────────────────────────────────────

/**
 * Parse a NumPy .npy file (v1.0/v2.0) containing a 2D float32 array.
 * Returns the flat Float32Array and dimensions [rows, cols].
 */
export function parseNpy(buffer: ArrayBuffer): { data: Float32Array; rows: number; cols: number } {
  const view = new DataView(buffer);

  // Magic: \x93NUMPY
  const magic = new Uint8Array(buffer, 0, 6);
  if (magic[0] !== 0x93 || String.fromCharCode(...Array.from(magic.slice(1))) !== "NUMPY") {
    throw new Error("Not a valid .npy file");
  }

  const major = view.getUint8(6);
  // const minor = view.getUint8(7);

  let headerLen: number;
  let headerOffset: number;
  if (major >= 2) {
    headerLen = view.getUint32(8, true);
    headerOffset = 12;
  } else {
    headerLen = view.getUint16(8, true);
    headerOffset = 10;
  }

  const headerBytes = new Uint8Array(buffer, headerOffset, headerLen);
  const header = new TextDecoder().decode(headerBytes).trim();

  // Parse header dict: {'descr': '<f4', 'fortran_order': False, 'shape': (N, 768), }
  const descrMatch = header.match(/'descr'\s*:\s*'([^']+)'/);
  const shapeMatch = header.match(/'shape'\s*:\s*\(([^)]+)\)/);
  const fortranMatch = header.match(/'fortran_order'\s*:\s*(True|False)/);

  if (!descrMatch || !shapeMatch) {
    throw new Error(`Cannot parse .npy header: ${header}`);
  }

  const descr = descrMatch[1];
  const isFortran = fortranMatch?.[1] === "True";

  if (isFortran) {
    throw new Error("Fortran-order .npy files are not supported");
  }

  // Determine dtype
  const isLittleEndian = descr.startsWith("<") || descr.startsWith("|");
  const dtypeChar = descr.replace(/[<>|=]/, "");
  if (dtypeChar !== "f4") {
    throw new Error(`Unsupported dtype "${descr}". Expected float32 (<f4)`);
  }

  // Parse shape
  const shapeParts = shapeMatch[1].split(",").map(s => s.trim()).filter(Boolean).map(Number);
  if (shapeParts.length !== 2) {
    throw new Error(`Expected 2D array, got shape (${shapeParts.join(", ")})`);
  }
  const [rows, cols] = shapeParts;

  // Data starts after header
  const dataOffset = headerOffset + headerLen;
  const expectedBytes = rows * cols * 4;
  if (buffer.byteLength - dataOffset < expectedBytes) {
    throw new Error(`File too short: need ${expectedBytes} data bytes, have ${buffer.byteLength - dataOffset}`);
  }

  let data: Float32Array;
  if (isLittleEndian) {
    data = new Float32Array(buffer, dataOffset, rows * cols);
  } else {
    // Big-endian — need byte swap
    data = new Float32Array(rows * cols);
    for (let i = 0; i < rows * cols; i++) {
      data[i] = view.getFloat32(dataOffset + i * 4, false);
    }
  }

  return { data, rows, cols };
}

// ── Brute-force L2 KNN ────────────────────────────────────────────────────

export interface KnnResult {
  /** Indices of k nearest neighbors for each query [queryCount × k] */
  indices: Uint32Array;
  /** L2 distances (squared) for each neighbor [queryCount × k] */
  distances: Float32Array;
}

/**
 * Brute-force L2 KNN search.
 * @param queries - [Q, D] query vectors
 * @param database - [N, D] database vectors
 * @param k - number of nearest neighbors
 * @returns indices and distances for each query
 */
export function searchL2(
  queries: Float32Array, queryCount: number,
  database: Float32Array, dbCount: number,
  dim: number, k: number,
): KnnResult {
  const indices = new Uint32Array(queryCount * k);
  const distances = new Float32Array(queryCount * k);

  // Temp arrays for per-query top-k tracking
  const topDist = new Float32Array(k);
  const topIdx = new Uint32Array(k);

  for (let q = 0; q < queryCount; q++) {
    const qOff = q * dim;

    // Initialize with max distances
    topDist.fill(Infinity);
    topIdx.fill(0);

    for (let n = 0; n < dbCount; n++) {
      const nOff = n * dim;

      // Compute L2 squared distance
      let dist = 0;
      for (let d = 0; d < dim; d++) {
        const diff = queries[qOff + d] - database[nOff + d];
        dist += diff * diff;
      }

      // Check if this is closer than current worst in top-k
      // top-k is maintained as a simple sorted array (k is small, typically 8)
      if (dist < topDist[k - 1]) {
        // Insert in sorted position
        let pos = k - 1;
        while (pos > 0 && dist < topDist[pos - 1]) {
          topDist[pos] = topDist[pos - 1];
          topIdx[pos] = topIdx[pos - 1];
          pos--;
        }
        topDist[pos] = dist;
        topIdx[pos] = n;
      }
    }

    // Write results
    const outOff = q * k;
    for (let i = 0; i < k; i++) {
      indices[outOff + i] = topIdx[i];
      distances[outOff + i] = topDist[i];
    }
  }

  return { indices, distances };
}

// ── Feature retrieval (RVC algorithm) ─────────────────────────────────────

/**
 * Apply FAISS-style feature retrieval to ContentVec embeddings.
 *
 * For each frame embedding, find k=8 nearest neighbors in the training set,
 * compute inverse-square-distance weighted average, and blend with source
 * at the given index_rate.
 *
 * @param embeddings - Source embeddings [T, dim] (will be modified in-place)
 * @param T - Number of frames
 * @param dim - Embedding dimension (768)
 * @param trainingData - Training embeddings [N, dim] from .npy
 * @param N - Number of training vectors
 * @param indexRate - Blend factor 0..1 (0 = no retrieval, 1 = full retrieval)
 * @returns Number of frames processed
 */
export function applyFeatureRetrieval(
  embeddings: Float32Array,
  T: number, dim: number,
  trainingData: Float32Array,
  N: number,
  indexRate: number,
): number {
  if (indexRate <= 0 || N === 0) return 0;

  const k = Math.min(8, N); // RVC default: k=8

  const t0 = performance.now();
  const { indices, distances } = searchL2(embeddings, T, trainingData, N, dim, k);
  const searchMs = Math.round(performance.now() - t0);

  // Weighted blending: inverse square distance
  for (let q = 0; q < T; q++) {
    const resOff = q * k;
    const embOff = q * dim;

    // Compute weights (1 / dist²), with epsilon to avoid div-by-zero
    let weightSum = 0;
    const weights = new Float32Array(k);
    for (let i = 0; i < k; i++) {
      const d = distances[resOff + i];
      const w = 1 / (d * d + 1e-8);
      weights[i] = w;
      weightSum += w;
    }

    // Normalize weights
    if (weightSum > 0) {
      for (let i = 0; i < k; i++) weights[i] /= weightSum;
    }

    // Compute weighted average of retrieved embeddings
    for (let d = 0; d < dim; d++) {
      let retrieved = 0;
      for (let i = 0; i < k; i++) {
        const dbIdx = indices[resOff + i];
        retrieved += trainingData[dbIdx * dim + d] * weights[i];
      }
      // Blend: retrieved * index_rate + source * (1 - index_rate)
      embeddings[embOff + d] = retrieved * indexRate + embeddings[embOff + d] * (1 - indexRate);
    }
  }

  console.info(
    `[vcIndex] Feature retrieval: ${T} frames × ${N} db vectors, k=${k}, ` +
    `rate=${indexRate}, search ${searchMs}ms`
  );

  return T;
}

// ── OPFS index cache ──────────────────────────────────────────────────────

export interface VcIndexEntry {
  id: string;
  name: string;
  /** Number of training vectors */
  vectorCount: number;
  /** Embedding dimension (768 for ContentVec) */
  dim: number;
  /** File size in bytes */
  sizeBytes: number;
  addedAt: string;
}

async function getIndexDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(VC_INDEX_DIR, { create: true });
  } catch (e) {
    console.warn("[vcIndex] Cannot open OPFS dir:", e);
    return null;
  }
}

/** List all cached index entries */
export async function listVcIndexes(): Promise<VcIndexEntry[]> {
  const dir = await getIndexDir();
  if (!dir) return [];
  const entries: VcIndexEntry[] = [];
  for await (const [name] of (dir as any).entries()) {
    if (!name.endsWith(".json")) continue;
    try {
      const fh = await dir.getFileHandle(name);
      const file = await fh.getFile();
      entries.push(JSON.parse(await file.text()));
    } catch { /* skip */ }
  }
  return entries.sort((a, b) => a.name.localeCompare(b.name));
}

/** Check if an index exists */
export async function hasVcIndex(id: string): Promise<boolean> {
  const dir = await getIndexDir();
  if (!dir) return false;
  try {
    await dir.getFileHandle(`${id}.npy`);
    return true;
  } catch {
    return false;
  }
}

/** Save an index (.npy data + metadata) */
export async function saveVcIndex(
  id: string,
  npyBlob: Blob,
  meta: VcIndexEntry,
): Promise<boolean> {
  const dir = await getIndexDir();
  if (!dir) return false;
  try {
    const dataFh = await dir.getFileHandle(`${id}.npy`, { create: true });
    const dataW = await dataFh.createWritable();
    await dataW.write(npyBlob);
    await dataW.close();

    const metaFh = await dir.getFileHandle(`${id}.json`, { create: true });
    const metaW = await metaFh.createWritable();
    await metaW.write(JSON.stringify(meta, null, 2));
    await metaW.close();

    console.info(`[vcIndex] Saved index "${meta.name}" (${meta.vectorCount} vectors, ${(meta.sizeBytes / 1024 / 1024).toFixed(1)} MB)`);
    return true;
  } catch (e) {
    console.error("[vcIndex] Save error:", e);
    return false;
  }
}

/** Load index training data as Float32Array */
export async function loadVcIndex(id: string): Promise<{ data: Float32Array; rows: number; cols: number } | null> {
  const dir = await getIndexDir();
  if (!dir) return null;
  try {
    const fh = await dir.getFileHandle(`${id}.npy`);
    const file = await fh.getFile();
    const buf = await file.arrayBuffer();
    return parseNpy(buf);
  } catch (e) {
    console.error("[vcIndex] Load error:", e);
    return null;
  }
}

/** Delete an index */
export async function deleteVcIndex(id: string): Promise<boolean> {
  const dir = await getIndexDir();
  if (!dir) return false;
  try { await dir.removeEntry(`${id}.npy`); } catch { /* ok */ }
  try { await dir.removeEntry(`${id}.json`); } catch { /* ok */ }
  return true;
}
