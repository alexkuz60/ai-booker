/**
 * useWebGPU — detects WebGPU support and adapter availability.
 * Used to gate Booker Pro features that require GPU compute.
 */
import { useState, useEffect } from "react";

export type GpuStatus = "checking" | "supported" | "no-api" | "no-adapter";

export function useWebGPU() {
  const [status, setStatus] = useState<GpuStatus>("checking");
  const [adapterInfo, setAdapterInfo] = useState<string | null>(null);

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
        // GPUAdapter.info is a property (not a method) in the current spec
        const info = (adapter as any).info;
        setAdapterInfo(
          info ? `${info.vendor || ""} ${info.architecture || ""} ${info.description || ""}`.trim() || "WebGPU Ready" : "WebGPU Ready"
        );
        setStatus("supported");
      } catch {
        if (!cancelled) setStatus("no-adapter");
      }
    }

    detect();
    return () => { cancelled = true; };
  }, []);

  const isChromium = /Chrome|Chromium|Edg/i.test(navigator.userAgent);

  return { status, adapterInfo, isChromium };
}
