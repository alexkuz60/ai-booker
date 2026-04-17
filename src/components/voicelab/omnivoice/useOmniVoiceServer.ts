/**
 * Hook that manages the OmniVoice server connection:
 *  - persisted URL (via useCloudSettings)
 *  - dev-proxy resolution for local Booker
 *  - health check state
 *  - cloud-preview warning flag
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useCloudSettings } from "@/hooks/useCloudSettings";
import {
  DEFAULT_SERVER_URL,
  LOCAL_DEV_HOSTS,
  LOCAL_DEV_PROXY_PATH,
  isDefaultLocalOmniVoiceServer,
  normalizeServerUrl,
} from "./constants";

export interface UseOmniVoiceServerResult {
  serverUrl: string;
  setServerUrl: (value: string) => void;
  requestBaseUrl: string;
  usingLocalDevProxy: boolean;
  isLocalOrigin: boolean;
  showPreviewWarning: boolean;
  serverOnline: boolean | null;
  checkingServer: boolean;
  checkServer: () => Promise<void>;
}

export function useOmniVoiceServer(): UseOmniVoiceServerResult {
  const { value: serverUrl, update: setServerUrl } = useCloudSettings(
    "omnivoice-server-url",
    DEFAULT_SERVER_URL,
  );
  const [serverOnline, setServerOnline] = useState<boolean | null>(null);
  const [checkingServer, setCheckingServer] = useState(false);

  const requestBaseUrl = useMemo(() => {
    const normalized = normalizeServerUrl(serverUrl);
    if (typeof window === "undefined") return normalized;
    const runningLocally = LOCAL_DEV_HOSTS.has(window.location.hostname);
    const canUseDevProxy = import.meta.env.DEV && runningLocally && isDefaultLocalOmniVoiceServer(normalized);
    return canUseDevProxy ? LOCAL_DEV_PROXY_PATH : normalized;
  }, [serverUrl]);

  const usingLocalDevProxy = requestBaseUrl === LOCAL_DEV_PROXY_PATH;
  const isLocalOrigin =
    typeof window !== "undefined" && LOCAL_DEV_HOSTS.has(window.location.hostname);

  const showPreviewWarning = useMemo(() => {
    if (typeof window === "undefined") return false;
    const runningLocally = LOCAL_DEV_HOSTS.has(window.location.hostname);
    return !runningLocally && /^https?:\/\/(?:127\.0\.0\.1|localhost)/i.test(normalizeServerUrl(serverUrl));
  }, [serverUrl]);

  const checkServer = useCallback(async () => {
    setCheckingServer(true);
    try {
      const res = await fetch(`${requestBaseUrl}/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) {
        setServerOnline(true);
      } else {
        await fetch(`${requestBaseUrl}/`, { signal: AbortSignal.timeout(3000) });
        setServerOnline(true);
      }
    } catch {
      setServerOnline(false);
    } finally {
      setCheckingServer(false);
    }
  }, [requestBaseUrl]);

  useEffect(() => {
    checkServer();
  }, [checkServer]);

  return {
    serverUrl,
    setServerUrl,
    requestBaseUrl,
    usingLocalDevProxy,
    isLocalOrigin,
    showPreviewWarning,
    serverOnline,
    checkingServer,
    checkServer,
  };
}
