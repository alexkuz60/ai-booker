/**
 * useBookerPro — manages Booker Pro mode state.
 * Persists via useCloudSettings, exposes activation status and model download state.
 */
import { useEffect, useRef } from "react";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { useWebGPU } from "@/hooks/useWebGPU";
import type { GpuAdapterDetails } from "@/hooks/useWebGPU";
import { getModelStatus, VC_MODEL_CACHE_EVENT, VC_MODEL_REGISTRY } from "@/lib/vcModelCache";

export interface BookerProState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  gpuStatus: ReturnType<typeof useWebGPU>["status"];
  adapterInfo: string | null;
  gpuDetails: GpuAdapterDetails | null;
  benchmarkResult: number | null;
  benchmarking: boolean;
  runBenchmark: () => Promise<void>;
  isChromium: boolean;
  modelsReady: boolean;
  setModelsReady: (v: boolean) => void;
}

export function useBookerPro(): BookerProState {
  const { value: enabled, update: setEnabled } = useCloudSettings("booker-pro-enabled", false);
  const { value: modelsReady, update: setModelsReady } = useCloudSettings("booker-pro-models-ready", false);
  const { status: gpuStatus, adapterInfo, isChromium, details, benchmarkResult, benchmarking, runBenchmark } = useWebGPU();

  // Use ref to avoid re-running effect when modelsReady changes
  const modelsReadyRef = useRef(modelsReady);
  modelsReadyRef.current = modelsReady;

  useEffect(() => {
    let cancelled = false;

    const syncModelsReady = async () => {
      try {
        const status = await getModelStatus();
        if (cancelled) return;

        const allReady = VC_MODEL_REGISTRY.every(model => status[model.id]);
        if (allReady !== modelsReadyRef.current) {
          setModelsReady(allReady);
        }
      } catch (error) {
        console.warn("[useBookerPro] Failed to sync VC model status:", error);
      }
    };

    const handleCacheChange = () => {
      void syncModelsReady();
    };

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        void syncModelsReady();
      }
    };

    void syncModelsReady();
    window.addEventListener(VC_MODEL_CACHE_EVENT, handleCacheChange);
    window.addEventListener("focus", handleCacheChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      cancelled = true;
      window.removeEventListener(VC_MODEL_CACHE_EVENT, handleCacheChange);
      window.removeEventListener("focus", handleCacheChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
  }, [setModelsReady]);

  return {
    enabled,
    setEnabled,
    gpuStatus,
    adapterInfo,
    gpuDetails: details,
    benchmarkResult,
    benchmarking,
    runBenchmark,
    isChromium,
    modelsReady,
    setModelsReady,
  };
}
