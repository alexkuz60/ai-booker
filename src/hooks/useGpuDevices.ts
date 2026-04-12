/**
 * useGpuDevices — auto-saves GPU profile per device into cloud settings.
 * Generates a stable device fingerprint from GPU adapter info + userAgent,
 * stores a list of known devices in user_settings via useCloudSettings.
 */
import { useEffect, useCallback } from "react";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import type { GpuAdapterDetails } from "@/hooks/useWebGPU";

export interface GpuDeviceProfile {
  /** Stable hash derived from GPU description + userAgent platform */
  fingerprint: string;
  /** User-editable label */
  label: string;
  /** GPU vendor */
  vendor: string;
  /** GPU architecture */
  architecture: string;
  /** GPU description (e.g. "NVIDIA GeForce RTX 4090") */
  description: string;
  /** Whether it's a software/fallback adapter */
  isFallback: boolean;
  /** Browser userAgent (truncated) */
  browser: string;
  /** Platform (e.g. "Win32", "MacIntel") */
  platform: string;
  /** Last benchmark result in GFLOPS, null if never run */
  benchGflops: number | null;
  /** ISO timestamp of first seen */
  firstSeen: string;
  /** ISO timestamp of last login on this device */
  lastSeen: string;
  /** Whether this is the currently active device */
  isCurrent?: boolean;
}

/** Generate a simple hash from a string */
function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const chr = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36).padStart(8, "0");
}

/** Build a stable fingerprint from GPU + platform info */
function buildFingerprint(details: GpuAdapterDetails | null, adapterInfo: string | null): string {
  const gpu = details
    ? `${details.vendor}|${details.architecture}|${details.description}`
    : (adapterInfo || "unknown");
  const platform = navigator.platform || "unknown";
  return simpleHash(`${gpu}::${platform}`);
}

/** Extract short browser name from userAgent */
function shortBrowser(): string {
  const ua = navigator.userAgent;
  if (/Edg\//i.test(ua)) return "Edge " + (ua.match(/Edg\/([\d.]+)/)?.[1] || "");
  if (/Chrome\//i.test(ua)) return "Chrome " + (ua.match(/Chrome\/([\d.]+)/)?.[1] || "");
  if (/Firefox\//i.test(ua)) return "Firefox " + (ua.match(/Firefox\/([\d.]+)/)?.[1] || "");
  if (/Safari\//i.test(ua)) return "Safari " + (ua.match(/Version\/([\d.]+)/)?.[1] || "");
  return ua.slice(0, 40);
}

/** Auto-name device from GPU + platform */
function autoLabel(details: GpuAdapterDetails | null, adapterInfo: string | null): string {
  const platform = navigator.platform || "";
  const gpuName = details?.description || details?.vendor || adapterInfo || "Unknown GPU";
  const os = /Win/i.test(platform) ? "Windows"
    : /Mac/i.test(platform) ? "macOS"
    : /Linux/i.test(platform) ? "Linux"
    : platform;
  return `${os} — ${gpuName}`.slice(0, 60);
}

export function useGpuDevices(
  gpuStatus: string,
  adapterInfo: string | null,
  gpuDetails: GpuAdapterDetails | null,
  benchmarkResult: number | null,
) {
  const { value: devices, update: setDevices, loaded } = useCloudSettings<GpuDeviceProfile[]>(
    "gpu-devices",
    [],
  );

  // Auto-register current device when GPU detection completes
  useEffect(() => {
    if (gpuStatus === "checking" || !loaded) return;

    const fp = buildFingerprint(gpuDetails, adapterInfo);
    const now = new Date().toISOString();

    setDevices((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      const idx = list.findIndex(d => d.fingerprint === fp);

      if (idx >= 0) {
        // Update existing device
        list[idx] = {
          ...list[idx],
          lastSeen: now,
          browser: shortBrowser(),
          // Update GPU info in case driver updated
          vendor: gpuDetails?.vendor || list[idx].vendor,
          architecture: gpuDetails?.architecture || list[idx].architecture,
          description: gpuDetails?.description || list[idx].description,
          isFallback: gpuDetails?.isFallback ?? list[idx].isFallback,
        };
      } else {
        // New device
        list.push({
          fingerprint: fp,
          label: autoLabel(gpuDetails, adapterInfo),
          vendor: gpuDetails?.vendor || "unknown",
          architecture: gpuDetails?.architecture || "",
          description: gpuDetails?.description || adapterInfo || "",
          isFallback: gpuDetails?.isFallback ?? false,
          browser: shortBrowser(),
          platform: navigator.platform || "",
          benchGflops: null,
          firstSeen: now,
          lastSeen: now,
        });
      }
      return list;
    });
  }, [gpuStatus, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update benchmark result for current device
  useEffect(() => {
    if (benchmarkResult === null || !loaded) return;
    const fp = buildFingerprint(gpuDetails, adapterInfo);

    setDevices((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      const idx = list.findIndex(d => d.fingerprint === fp);
      if (idx >= 0 && list[idx].benchGflops !== benchmarkResult) {
        list[idx] = { ...list[idx], benchGflops: benchmarkResult };
        return list;
      }
      return prev;
    });
  }, [benchmarkResult, loaded]); // eslint-disable-line react-hooks/exhaustive-deps

  const currentFingerprint = buildFingerprint(gpuDetails, adapterInfo);

  const renameDevice = useCallback((fingerprint: string, newLabel: string) => {
    setDevices((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      const idx = list.findIndex(d => d.fingerprint === fingerprint);
      if (idx >= 0) {
        list[idx] = { ...list[idx], label: newLabel };
        return list;
      }
      return prev;
    });
  }, [setDevices]);

  const removeDevice = useCallback((fingerprint: string) => {
    setDevices((prev) => {
      const list = Array.isArray(prev) ? [...prev] : [];
      return list.filter(d => d.fingerprint !== fingerprint);
    });
  }, [setDevices]);

  // Mark current device in the list
  const devicesWithCurrent = (Array.isArray(devices) ? devices : []).map(d => ({
    ...d,
    isCurrent: d.fingerprint === currentFingerprint,
  }));

  return {
    devices: devicesWithCurrent,
    currentFingerprint,
    renameDevice,
    removeDevice,
  };
}
