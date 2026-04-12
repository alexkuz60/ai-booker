/**
 * useBookerPro — manages Booker Pro mode state.
 * Persists via useCloudSettings, exposes activation status and model download state.
 */
import { useCloudSettings } from "@/hooks/useCloudSettings";
import { useWebGPU } from "@/hooks/useWebGPU";

export interface BookerProState {
  enabled: boolean;
  setEnabled: (v: boolean) => void;
  gpuStatus: ReturnType<typeof useWebGPU>["status"];
  adapterInfo: string | null;
  isChromium: boolean;
  /** Whether VC models are downloaded to OPFS _models/ folder */
  modelsReady: boolean;
  setModelsReady: (v: boolean) => void;
}

export function useBookerPro(): BookerProState {
  const { value: enabled, update: setEnabled } = useCloudSettings("booker-pro-enabled", false);
  const { value: modelsReady, update: setModelsReady } = useCloudSettings("booker-pro-models-ready", false);
  const { status: gpuStatus, adapterInfo, isChromium } = useWebGPU();

  return {
    enabled,
    setEnabled,
    gpuStatus,
    adapterInfo,
    isChromium,
    modelsReady,
    setModelsReady,
  };
}
