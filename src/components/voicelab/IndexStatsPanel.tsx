/**
 * IndexStatsPanel — Visualizes a loaded VC training index:
 *   - Norm statistics (min, max, mean, std)
 *   - Histogram of L2 norms
 *   - K-means cluster distribution chart
 */
import { useState, useCallback, useEffect, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { loadVcIndex, type VcIndexEntry } from "@/lib/vcIndexSearch";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { BarChart3, Loader2, Info } from "lucide-react";

interface IndexStatsPanelProps {
  index: VcIndexEntry;
  isRu: boolean;
}

interface NormStats {
  min: number;
  max: number;
  mean: number;
  std: number;
  norms: Float32Array;
}

interface ClusterBin {
  label: string;
  count: number;
  range: string;
}

function computeNormStats(data: Float32Array, rows: number, cols: number): NormStats {
  const norms = new Float32Array(rows);
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;

  for (let i = 0; i < rows; i++) {
    const off = i * cols;
    let normSq = 0;
    for (let d = 0; d < cols; d++) {
      normSq += data[off + d] * data[off + d];
    }
    const norm = Math.sqrt(normSq);
    norms[i] = norm;
    sum += norm;
    if (norm < min) min = norm;
    if (norm > max) max = norm;
  }

  const mean = sum / rows;
  let varSum = 0;
  for (let i = 0; i < rows; i++) {
    const diff = norms[i] - mean;
    varSum += diff * diff;
  }
  const std = Math.sqrt(varSum / rows);

  return { min, max, mean, std, norms };
}

function buildHistogram(norms: Float32Array, bins: number = 20): ClusterBin[] {
  if (norms.length === 0) return [];
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < norms.length; i++) {
    if (norms[i] < min) min = norms[i];
    if (norms[i] > max) max = norms[i];
  }
  const range = max - min || 1;
  const binWidth = range / bins;

  const counts = new Uint32Array(bins);
  for (let i = 0; i < norms.length; i++) {
    let b = Math.floor((norms[i] - min) / binWidth);
    if (b >= bins) b = bins - 1;
    counts[b]++;
  }

  return Array.from(counts, (count, i) => ({
    label: (min + (i + 0.5) * binWidth).toFixed(1),
    count,
    range: `${(min + i * binWidth).toFixed(2)} – ${(min + (i + 1) * binWidth).toFixed(2)}`,
  }));
}

/**
 * Simple k-means clustering for visualization (fast, approximate).
 * Groups vectors by cosine similarity to k centroids.
 */
function kmeansCluster(data: Float32Array, rows: number, cols: number, k: number = 8, iters: number = 10): number[] {
  if (rows <= k) return Array.from({ length: rows }, (_, i) => i);

  // Initialize centroids from evenly spaced samples
  const centroids = new Float32Array(k * cols);
  const step = Math.floor(rows / k);
  for (let c = 0; c < k; c++) {
    const src = (c * step) * cols;
    centroids.set(data.subarray(src, src + cols), c * cols);
  }

  const assignments = new Int32Array(rows);
  const clusterSums = new Float32Array(k * cols);
  const clusterCounts = new Uint32Array(k);

  for (let iter = 0; iter < iters; iter++) {
    // Assign
    for (let i = 0; i < rows; i++) {
      const off = i * cols;
      let bestDist = Infinity;
      let bestC = 0;
      for (let c = 0; c < k; c++) {
        const cOff = c * cols;
        let dist = 0;
        for (let d = 0; d < cols; d++) {
          const diff = data[off + d] - centroids[cOff + d];
          dist += diff * diff;
        }
        if (dist < bestDist) { bestDist = dist; bestC = c; }
      }
      assignments[i] = bestC;
    }

    // Update centroids
    clusterSums.fill(0);
    clusterCounts.fill(0);
    for (let i = 0; i < rows; i++) {
      const c = assignments[i];
      clusterCounts[c]++;
      const off = i * cols;
      const cOff = c * cols;
      for (let d = 0; d < cols; d++) {
        clusterSums[cOff + d] += data[off + d];
      }
    }
    for (let c = 0; c < k; c++) {
      if (clusterCounts[c] === 0) continue;
      const cOff = c * cols;
      for (let d = 0; d < cols; d++) {
        centroids[cOff + d] = clusterSums[cOff + d] / clusterCounts[c];
      }
    }
  }

  return Array.from(assignments);
}

const CLUSTER_COLORS = [
  "hsl(var(--primary))",
  "hsl(210, 70%, 55%)",
  "hsl(160, 60%, 45%)",
  "hsl(40, 80%, 55%)",
  "hsl(340, 65%, 50%)",
  "hsl(270, 55%, 55%)",
  "hsl(180, 50%, 45%)",
  "hsl(20, 75%, 50%)",
];

export function IndexStatsPanel({ index, isRu }: IndexStatsPanelProps) {
  const [loading, setLoading] = useState(false);
  const [normStats, setNormStats] = useState<NormStats | null>(null);
  const [clusterData, setClusterData] = useState<{ label: string; count: number }[]>([]);
  const [histData, setHistData] = useState<ClusterBin[]>([]);
  const [analyzed, setAnalyzed] = useState(false);

  const handleAnalyze = useCallback(async () => {
    setLoading(true);
    try {
      const loaded = await loadVcIndex(index.id);
      if (!loaded) return;

      const { data, rows, cols } = loaded;

      // Compute norm stats
      const stats = computeNormStats(data, rows, cols);
      setNormStats(stats);

      // Build norm histogram
      setHistData(buildHistogram(stats.norms, 24));

      // K-means clustering (use fewer vectors for speed if large)
      const maxForKmeans = 20_000;
      let kData = data;
      let kRows = rows;
      if (rows > maxForKmeans) {
        // Subsample evenly
        const step = Math.floor(rows / maxForKmeans);
        kRows = maxForKmeans;
        kData = new Float32Array(kRows * cols);
        for (let i = 0; i < kRows; i++) {
          kData.set(data.subarray(i * step * cols, i * step * cols + cols), i * cols);
        }
      }

      const k = 8;
      const assignments = kmeansCluster(kData, kRows, cols, k, 15);
      const counts = new Uint32Array(k);
      for (const a of assignments) counts[a]++;
      setClusterData(
        Array.from(counts, (count, i) => ({
          label: `C${i + 1}`,
          count,
        })).filter(c => c.count > 0).sort((a, b) => b.count - a.count)
      );

      setAnalyzed(true);
    } catch (err) {
      console.error("[IndexStats] Analysis error:", err);
    } finally {
      setLoading(false);
    }
  }, [index.id]);

  if (!analyzed) {
    return (
      <Card className="border-border/50">
        <CardContent className="py-4 flex items-center justify-center">
          <Button variant="outline" size="sm" className="gap-1.5" onClick={handleAnalyze} disabled={loading}>
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <BarChart3 className="h-3.5 w-3.5" />}
            {isRu ? "Анализировать индекс" : "Analyze index"}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50">
      <CardHeader className="pb-2 pt-3 px-4">
        <CardTitle className="text-xs flex items-center gap-2">
          <BarChart3 className="h-3.5 w-3.5 text-primary" />
          {index.name}
          <Badge variant="outline" className="text-[9px] ml-auto">
            {index.vectorCount.toLocaleString()} × {index.dim}D
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="px-4 pb-4 space-y-4">
        {/* Norm Statistics */}
        {normStats && (
          <div className="grid grid-cols-4 gap-2">
            {[
              { label: "Min", value: normStats.min.toFixed(2) },
              { label: "Max", value: normStats.max.toFixed(2) },
              { label: "Mean", value: normStats.mean.toFixed(2) },
              { label: "Std", value: normStats.std.toFixed(3) },
            ].map(s => (
              <div key={s.label} className="text-center p-2 rounded-md bg-muted/40 border border-border/30">
                <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{s.label}</p>
                <p className="text-sm font-mono font-medium tabular-nums">{s.value}</p>
              </div>
            ))}
          </div>
        )}

        <Separator />

        {/* Norm Distribution Histogram */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
            {isRu ? "Распределение L2 норм" : "L2 Norm Distribution"}
          </p>
          <div className="h-32">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={histData} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                  interval="preserveStartEnd"
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                />
                <YAxis
                  tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={35}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(value: number) => [value.toLocaleString(), isRu ? "Кол-во" : "Count"]}
                  labelFormatter={(label: string, payload: any[]) => {
                    const item = payload?.[0]?.payload;
                    return item?.range || label;
                  }}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {histData.map((_, i) => (
                    <Cell key={i} fill="hsl(var(--primary))" fillOpacity={0.7} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <Separator />

        {/* Cluster Distribution */}
        <div>
          <p className="text-[10px] text-muted-foreground uppercase tracking-wider mb-2">
            {isRu ? "Распределение по кластерам (k-means, k=8)" : "Cluster Distribution (k-means, k=8)"}
          </p>
          <div className="h-28">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={clusterData} margin={{ top: 2, right: 4, bottom: 0, left: -20 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                />
                <YAxis
                  tick={{ fontSize: 8, fill: "hsl(var(--muted-foreground))" }}
                  tickLine={false}
                  axisLine={false}
                  width={40}
                />
                <Tooltip
                  contentStyle={{
                    background: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: 6,
                    fontSize: 11,
                  }}
                  formatter={(value: number) => [value.toLocaleString(), isRu ? "Векторов" : "Vectors"]}
                />
                <Bar dataKey="count" radius={[2, 2, 0, 0]}>
                  {clusterData.map((_, i) => (
                    <Cell key={i} fill={CLUSTER_COLORS[i % CLUSTER_COLORS.length]} fillOpacity={0.8} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Info */}
        <div className="flex items-start gap-1.5 text-[10px] text-muted-foreground">
          <Info className="h-3 w-3 shrink-0 mt-0.5" />
          <span>
            {isRu
              ? "Равномерное распределение по кластерам = голос хорошо покрывает фонетическое пространство. Перекос = недостаточная вариативность обучающих данных."
              : "Even cluster distribution = good phonetic coverage. Skewed = insufficient training data variety."}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
