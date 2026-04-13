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

/**
 * Build a minimal .npy file blob from a Float32Array + dimensions.
 */
export function buildNpyBlob(data: Float32Array, rows: number, cols: number): Blob {
  const header = `{'descr': '<f4', 'fortran_order': False, 'shape': (${rows}, ${cols}), }`;
  const prefixLen = 12; // magic(6) + version(2) + headerLen(4)
  const padded = Math.ceil((prefixLen + header.length + 1) / 64) * 64;
  const headerPadded = header.padEnd(padded - prefixLen - 1) + "\n";
  const headerBytes = new TextEncoder().encode(headerPadded);
  const buf = new ArrayBuffer(prefixLen + headerBytes.length + data.byteLength);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);
  u8[0] = 0x93; u8[1] = 0x4E; u8[2] = 0x55; u8[3] = 0x4D; u8[4] = 0x50; u8[5] = 0x59;
  u8[6] = 2; u8[7] = 0;
  view.setUint32(8, headerBytes.length, true);
  u8.set(headerBytes, 12);
  new Uint8Array(buf, 12 + headerBytes.length).set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
  return new Blob([buf], { type: "application/octet-stream" });
}

// ── FAISS .index parser ───────────────────────────────────────────────────

/**
 * Helper: read a 4-byte fourcc string at offset.
 */
function readFourcc(view: DataView, off: number): string {
  return String.fromCharCode(
    view.getUint8(off), view.getUint8(off + 1),
    view.getUint8(off + 2), view.getUint8(off + 3),
  );
}

/**
 * FAISS binary stream reader — tracks cursor position.
 */
class FaissReader {
  private view: DataView;
  private pos: number;
  readonly length: number;

  constructor(buffer: ArrayBuffer, offset = 0) {
    this.view = new DataView(buffer);
    this.pos = offset;
    this.length = buffer.byteLength;
  }

  get offset() { return this.pos; }

  fourcc(): string {
    const s = readFourcc(this.view, this.pos);
    this.pos += 4;
    return s;
  }

  int32(): number { const v = this.view.getInt32(this.pos, true); this.pos += 4; return v; }
  uint32(): number { const v = this.view.getUint32(this.pos, true); this.pos += 4; return v; }
  int64(): number {
    // Read as two 32-bit parts (JS doesn't support int64 natively without BigInt)
    const lo = this.view.getUint32(this.pos, true);
    const hi = this.view.getInt32(this.pos + 4, true);
    this.pos += 8;
    return hi * 0x100000000 + lo;
  }
  float32(): number { const v = this.view.getFloat32(this.pos, true); this.pos += 4; return v; }
  uint8(): number { const v = this.view.getUint8(this.pos); this.pos += 1; return v; }

  skip(n: number) { this.pos += n; }

  /** Read a READVECTOR: size(8B) then size elements */
  readVectorSize(): number { return this.int64(); }

  /** Skip a READVECTOR */
  skipVector(elemSize: number) {
    const size = this.int64();
    this.pos += size * elemSize;
  }

  /** Read float32 array of known size */
  readFloat32Array(count: number): Float32Array {
    const arr = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      arr[i] = this.view.getFloat32(this.pos, true);
      this.pos += 4;
    }
    return arr;
  }

  /** Read READXBVECTOR: size(8B) then size*4 bytes */
  readXbVector(): Float32Array {
    const size = this.int64(); // in float-groups-of-4 units
    const totalFloats = size * 4;
    return this.readFloat32Array(totalFloats);
  }

  /** Check remaining bytes */
  remaining(): number { return this.length - this.pos; }
}

/**
 * Read a FAISS index header (shared by all Index types).
 * Returns d and ntotal.
 */
function readIndexHeader(r: FaissReader): { d: number; ntotal: number; metricType: number } {
  const d = r.int32();
  const ntotal = r.int64();
  r.int64(); // dummy
  r.int64(); // dummy
  const isTrained = r.uint8();
  const metricType = r.int32();
  if (metricType > 1) {
    r.float32(); // metric_arg
  }
  return { d, ntotal, metricType };
}

/**
 * Read DirectMap structure.
 */
function readDirectMap(r: FaissReader) {
  const type = r.uint8(); // maintain_direct_map char
  r.skipVector(8); // array: vector<idx_t> (int64)
  if (type === 2) { // Hashtable
    r.skipVector(16); // vector<pair<idx_t, idx_t>>
  }
}

/**
 * Recursively read a FAISS Index, extracting flat vectors.
 * Only supports IndexFlatL2, IndexFlatIP, IndexFlat, and IndexIVFFlat.
 */
function readFaissIndex(r: FaissReader): { data: Float32Array; rows: number; cols: number } | null {
  const h = r.fourcc();

  // ── IndexFlat variants (IxFl, IxF2, IxFI) ──
  if (h === "IxFl" || h === "IxF2" || h === "IxFI") {
    const { d, ntotal } = readIndexHeader(r);
    // READXBVECTOR: size(8B) = ntotal*d/4 units, then size*4 floats
    const codes = r.readXbVector();
    const expectedFloats = ntotal * d;
    if (codes.length !== expectedFloats) {
      console.warn(`[faissParser] IndexFlat: expected ${expectedFloats} floats, got ${codes.length}`);
    }
    return { data: codes, rows: ntotal, cols: d };
  }

  // ── IndexIVFFlat (IwFl) — modern format ──
  if (h === "IwFl") {
    const header = readIndexHeader(r);
    const d = header.d;
    const nlist = r.int64();
    r.int64(); // nprobe

    // Read nested quantizer (recursive — usually IndexFlatL2)
    readFaissIndex(r); // skip quantizer, we don't need centroids

    // read_direct_map
    readDirectMap(r);

    // code_size = d * sizeof(float) — we know this from format
    const codeSize = d * 4; // bytes per vector

    // read_InvertedLists
    const ilFourcc = r.fourcc();
    if (ilFourcc === "il00") {
      // null inverted lists
      return null;
    }
    if (ilFourcc !== "ilar") {
      throw new Error(`[faissParser] Unsupported inverted list type: "${ilFourcc}". Expected "ilar" (ArrayInvertedLists).`);
    }

    const ilNlist = r.int64();
    const ilCodeSize = r.int64();

    // Read list sizes
    const listTypeFourcc = r.fourcc();
    let sizes: number[];
    if (listTypeFourcc === "full") {
      const sizeCount = r.int64();
      sizes = [];
      for (let i = 0; i < sizeCount; i++) {
        sizes.push(r.int64());
      }
    } else if (listTypeFourcc === "sprs") {
      sizes = new Array(ilNlist).fill(0);
      const pairCount = r.int64();
      for (let i = 0; i < pairCount; i += 2) {
        const idx = r.int64();
        const sz = r.int64();
        if (idx < ilNlist) sizes[idx] = sz;
      }
    } else {
      throw new Error(`[faissParser] Unknown list_type fourcc: "${listTypeFourcc}"`);
    }

    // Total vectors across all lists
    const totalVectors = sizes.reduce((a, b) => a + b, 0);
    const floatsPerVector = ilCodeSize / 4; // code_size is in bytes

    // Read codes and ids for each list, extract float vectors
    const allVectors = new Float32Array(totalVectors * floatsPerVector);
    let writePos = 0;

    for (let i = 0; i < ilNlist; i++) {
      const n = sizes[i];
      if (n > 0) {
        // codes: n * ilCodeSize bytes = n * floatsPerVector floats
        const listCodes = r.readFloat32Array(n * floatsPerVector);
        allVectors.set(listCodes, writePos);
        writePos += n * floatsPerVector;
        // ids: n * 8 bytes (int64)
        r.skip(n * 8);
      }
    }

    console.info(
      `[faissParser] IVFFlat: ${totalVectors} vectors × ${floatsPerVector}D ` +
      `from ${ilNlist} lists (${(allVectors.byteLength / 1024 / 1024).toFixed(1)} MB)`
    );

    return { data: allVectors, rows: totalVectors, cols: floatsPerVector };
  }

  // ── Legacy IVFFlat (IvFl, IvFL) ──
  if (h === "IvFl" || h === "IvFL") {
    const header = readIndexHeader(r);
    const d = header.d;
    const nlist = r.int64();
    r.int64(); // nprobe

    // Read nested quantizer
    readFaissIndex(r);

    // Legacy format: ids are stored inline in ivf_header
    const ids: number[][] = [];
    for (let i = 0; i < nlist; i++) {
      const idCount = r.int64();
      r.skip(idCount * 8); // skip int64 ids
      ids.push([]); // we don't need the actual ids
    }

    // read_direct_map
    readDirectMap(r);

    // Read codes for each list
    const allCodes: Float32Array[] = [];
    let totalN = 0;

    for (let i = 0; i < nlist; i++) {
      if (h === "IvFL") {
        // codes stored as uint8 vector
        const codeBytes = r.int64();
        const floatCount = codeBytes / 4;
        allCodes.push(r.readFloat32Array(floatCount));
        totalN += floatCount / d;
      } else {
        // Old format: codes stored as float vector
        const floatCount = r.int64();
        allCodes.push(r.readFloat32Array(floatCount));
        totalN += floatCount / d;
      }
    }

    // Concatenate
    const result = new Float32Array(totalN * d);
    let off = 0;
    for (const chunk of allCodes) {
      result.set(chunk, off);
      off += chunk.length;
    }

    console.info(`[faissParser] Legacy IVFFlat: ${totalN} vectors × ${d}D`);
    return { data: result, rows: totalN, cols: d };
  }

  // Unsupported index type — try to give a helpful message
  throw new Error(
    `[faissParser] Unsupported FAISS index type: "${h}". ` +
    `Supported: IxFl/IxF2/IxFI (IndexFlat), IwFl (IndexIVFFlat), IvFl/IvFL (legacy IVFFlat).`
  );
}

/**
 * Parse a FAISS .index file and extract all training vectors as a flat Float32Array.
 * Supports IndexFlatL2, IndexFlatIP, IndexIVFFlat (modern and legacy formats).
 *
 * @param buffer - Raw .index file contents
 * @returns { data, rows, cols } — training vectors suitable for KNN search
 */
export function parseFaissIndex(buffer: ArrayBuffer): { data: Float32Array; rows: number; cols: number } {
  const r = new FaissReader(buffer);
  const result = readFaissIndex(r);
  if (!result || result.rows === 0) {
    throw new Error("[faissParser] No vectors found in FAISS index file");
  }
  console.info(
    `[faissParser] Extracted ${result.rows.toLocaleString()} vectors × ${result.cols}D ` +
    `(${(result.data.byteLength / 1024 / 1024).toFixed(1)} MB)`
  );
  return result;
}

/**
 * Auto-detect file type and parse accordingly.
 * @param buffer - File contents
 * @param fileName - Original file name (for extension detection)
 */
export function parseIndexFile(
  buffer: ArrayBuffer, fileName: string,
): { data: Float32Array; rows: number; cols: number } {
  const ext = fileName.toLowerCase().split(".").pop() || "";

  if (ext === "npy") {
    return parseNpy(buffer);
  }

  if (ext === "index" || ext === "bin") {
    return parseFaissIndex(buffer);
  }

  // Try to auto-detect: .npy starts with \x93NUMPY, FAISS starts with a fourcc
  const magic = new Uint8Array(buffer, 0, Math.min(6, buffer.byteLength));
  if (magic[0] === 0x93 && magic.length >= 6) {
    const str = String.fromCharCode(...Array.from(magic.slice(1, 6)));
    if (str === "NUMPY") return parseNpy(buffer);
  }

  // Try FAISS
  try {
    return parseFaissIndex(buffer);
  } catch {
    // Fall through
  }

  throw new Error(
    `Cannot detect file format for "${fileName}". Supported: .npy (NumPy), .index (FAISS IndexFlatL2/IVFFlat).`
  );
}



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
