/**
 * knnWorker.ts — Web Worker for brute-force L2 KNN search.
 * Offloads heavy O(T×N×D) computation from the main thread.
 */

interface KnnRequest {
  queries: Float32Array;
  queryCount: number;
  database: Float32Array;
  dbCount: number;
  dim: number;
  k: number;
}

interface KnnResponse {
  indices: Uint32Array;
  distances: Float32Array;
}

self.onmessage = (e: MessageEvent<KnnRequest>) => {
  const { queries, queryCount, database, dbCount, dim, k } = e.data;

  const indices = new Uint32Array(queryCount * k);
  const distances = new Float32Array(queryCount * k);
  const topDist = new Float32Array(k);
  const topIdx = new Uint32Array(k);

  for (let q = 0; q < queryCount; q++) {
    const qOff = q * dim;
    topDist.fill(Infinity);
    topIdx.fill(0);

    for (let n = 0; n < dbCount; n++) {
      const nOff = n * dim;
      let dist = 0;
      for (let d = 0; d < dim; d++) {
        const diff = queries[qOff + d] - database[nOff + d];
        dist += diff * diff;
      }

      if (dist < topDist[k - 1]) {
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

    const outOff = q * k;
    for (let i = 0; i < k; i++) {
      indices[outOff + i] = topIdx[i];
      distances[outOff + i] = topDist[i];
    }
  }

  const resp: KnnResponse = { indices, distances };
  (self as unknown as Worker).postMessage(resp, [indices.buffer, distances.buffer]);
};
