/**
 * useWebGPU — detects WebGPU support, adapter info, and device limits.
 * Used to gate Booker Pro features that require GPU compute.
 */
import { useState, useEffect, useCallback } from "react";

export type GpuStatus = "checking" | "supported" | "no-api" | "no-adapter";

export interface GpuDeviceLimits {
  maxBufferSize: number;
  maxStorageBufferBindingSize: number;
  maxComputeWorkgroupSizeX: number;
  maxComputeWorkgroupSizeY: number;
  maxComputeWorkgroupSizeZ: number;
  maxComputeInvocationsPerWorkgroup: number;
  maxComputeWorkgroupsPerDimension: number;
  maxStorageBuffersPerShaderStage: number;
  maxBindGroups: number;
  maxTextureDimension2D: number;
}

export interface GpuAdapterDetails {
  vendor: string;
  architecture: string;
  device: string;
  description: string;
  features: string[];
  limits: GpuDeviceLimits | null;
  isFallback: boolean;
}

export function useWebGPU() {
  const [status, setStatus] = useState<GpuStatus>("checking");
  const [adapterInfo, setAdapterInfo] = useState<string | null>(null);
  const [details, setDetails] = useState<GpuAdapterDetails | null>(null);
  const [benchmarkResult, setBenchmarkResult] = useState<number | null>(null);
  const [benchmarking, setBenchmarking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function detect() {
      if (!navigator.gpu) {
        if (!cancelled) setStatus("no-api");
        return;
      }
      try {
        const adapter = await navigator.gpu.requestAdapter();
        if (cancelled) return;
        if (!adapter) {
          setStatus("no-adapter");
          return;
        }

        const info = (adapter as any).info ?? {};
        const infoStr = `${info.vendor || ""} ${info.architecture || ""} ${info.description || ""}`.trim() || "WebGPU Ready";
        setAdapterInfo(infoStr);

        // Collect features
        const features: string[] = [];
        adapter.features.forEach((f: string) => features.push(f));

        // Collect limits
        const l = adapter.limits;
        const limits: GpuDeviceLimits = {
          maxBufferSize: l.maxBufferSize,
          maxStorageBufferBindingSize: l.maxStorageBufferBindingSize,
          maxComputeWorkgroupSizeX: l.maxComputeWorkgroupSizeX,
          maxComputeWorkgroupSizeY: l.maxComputeWorkgroupSizeY,
          maxComputeWorkgroupSizeZ: l.maxComputeWorkgroupSizeZ,
          maxComputeInvocationsPerWorkgroup: l.maxComputeInvocationsPerWorkgroup,
          maxComputeWorkgroupsPerDimension: l.maxComputeWorkgroupsPerDimension,
          maxStorageBuffersPerShaderStage: l.maxStorageBuffersPerShaderStage,
          maxBindGroups: l.maxBindGroups,
          maxTextureDimension2D: l.maxTextureDimension2D,
        };

        setDetails({
          vendor: info.vendor || "unknown",
          architecture: info.architecture || "",
          device: info.device || "",
          description: info.description || "",
          features,
          limits,
          isFallback: !!(adapter as any).isFallbackAdapter,
        });

        setStatus("supported");
      } catch {
        if (!cancelled) setStatus("no-adapter");
      }
    }

    detect();
    return () => { cancelled = true; };
  }, []);

  const isChromium = /Chrome|Chromium|Edg/i.test(navigator.userAgent);

  /** Run a simple compute benchmark — measures throughput in GFLOPS (approx). */
  const runBenchmark = useCallback(async () => {
    if (!navigator.gpu) return;
    setBenchmarking(true);
    try {
      const adapter = await navigator.gpu.requestAdapter();
      if (!adapter) throw new Error("No adapter");
      const device = await adapter.requestDevice();

      const size = 1024 * 1024; // 1M elements
      const buffer = device.createBuffer({
        size: size * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });
      const resultBuffer = device.createBuffer({
        size: size * 4,
        usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
      });

      const shaderModule = device.createShaderModule({
        code: `
          @group(0) @binding(0) var<storage, read_write> data: array<f32>;
          @group(0) @binding(1) var<storage, read_write> result: array<f32>;
          @compute @workgroup_size(256)
          fn main(@builtin(global_invocation_id) id: vec3u) {
            let i = id.x;
            if (i < arrayLength(&data)) {
              var v = f32(i) * 0.001;
              for (var j = 0u; j < 100u; j = j + 1u) {
                v = v * 1.0001 + 0.0001;
              }
              result[i] = v;
            }
          }
        `,
      });

      const pipeline = device.createComputePipeline({
        layout: "auto",
        compute: { module: shaderModule, entryPoint: "main" },
      });

      const bindGroup = device.createBindGroup({
        layout: pipeline.getBindGroupLayout(0),
        entries: [
          { binding: 0, resource: { buffer } },
          { binding: 1, resource: { buffer: resultBuffer } },
        ],
      });

      // Warmup
      const warmup = device.createCommandEncoder();
      const warmupPass = warmup.beginComputePass();
      warmupPass.setPipeline(pipeline);
      warmupPass.setBindGroup(0, bindGroup);
      warmupPass.dispatchWorkgroups(Math.ceil(size / 256));
      warmupPass.end();
      device.queue.submit([warmup.finish()]);
      await device.queue.onSubmittedWorkDone();

      // Timed run
      const iterations = 10;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        const encoder = device.createCommandEncoder();
        const pass = encoder.beginComputePass();
        pass.setPipeline(pipeline);
        pass.setBindGroup(0, bindGroup);
        pass.dispatchWorkgroups(Math.ceil(size / 256));
        pass.end();
        device.queue.submit([encoder.finish()]);
      }
      await device.queue.onSubmittedWorkDone();
      const elapsed = performance.now() - start;

      // ~2 FLOPs per iteration * 100 inner loops * 1M elements * iterations
      const flops = (2 * 100 * size * iterations) / (elapsed / 1000);
      const gflops = Math.round(flops / 1e9 * 10) / 10;

      buffer.destroy();
      resultBuffer.destroy();
      device.destroy();

      setBenchmarkResult(gflops);
    } catch (e) {
      console.error("GPU benchmark failed:", e);
      setBenchmarkResult(-1);
    } finally {
      setBenchmarking(false);
    }
  }, []);

  return { status, adapterInfo, isChromium, details, benchmarkResult, benchmarking, runBenchmark };
}
