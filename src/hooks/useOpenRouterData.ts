import { useState, useCallback, useEffect, useMemo } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useCloudSettings } from '@/hooks/useCloudSettings';
import type { LogEntry, AnalyticsEntry, TestResult, ProxyApiCatalogModel } from '@/components/profile/proxyapi/types';

export interface OpenRouterKeyInfo {
  label: string;
  is_free_tier: boolean;
  usage_daily: number;
  usage_monthly: number;
  limit: number | null;
  limit_remaining: number | null;
}

export interface OpenRouterCatalogModel {
  id: string;
  name: string;
  pricing?: { prompt: string; completion: string };
  context_length?: number;
}

export function useOpenRouterData(hasKey: boolean) {
  const { user } = useAuth();

  const [pingResult, setPingResult] = useState<{ status: string; latency_ms: number; error?: string } | null>(null);
  const [pinging, setPinging] = useState(false);
  const [keyInfo, setKeyInfo] = useState<OpenRouterKeyInfo | null>(null);
  const [keyLoading, setKeyLoading] = useState(false);

  const { value: testResults, update: updateTestResults } = useCloudSettings<Record<string, TestResult>>(
    'openrouter-test-results-v2', {}, 'openrouter_test_results_v2',
  );
  const setTestResults = useCallback((updater: Record<string, TestResult> | ((prev: Record<string, TestResult>) => Record<string, TestResult>)) => {
    updateTestResults(updater as any);
  }, [updateTestResults]);
  const [testingModel, setTestingModel] = useState<string | null>(null);
  const [massTestRunning, setMassTestRunning] = useState(false);
  const [massTestProgress, setMassTestProgress] = useState({ done: 0, total: 0 });

  const [catalog, setCatalog] = useState<OpenRouterCatalogModel[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [catalogLoaded, setCatalogLoaded] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState('');

  const { value: cloudUserModels, update: updateCloudUserModels } = useCloudSettings<string[]>(
    'openrouter-user-models', [], 'openrouter_user_models',
  );
  const userModelIds = useMemo(() => new Set(cloudUserModels), [cloudUserModels]);

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [logsRefreshTrigger, setLogsRefreshTrigger] = useState(0);

  const registryModels: { id: string; name: string; provider: string }[] = [];

  const filteredCatalogModels = useMemo(() => {
    if (!catalogSearch.trim()) return [];
    const q = catalogSearch.toLowerCase();
    return catalog.filter(m =>
      !userModelIds.has(m.id) &&
      (m.id.toLowerCase().includes(q) || m.name.toLowerCase().includes(q))
    ).slice(0, 20);
  }, [catalogSearch, catalog, userModelIds]);

  const userAddedModels = useMemo(() => {
    const catalogMap = new Map(catalog.map(m => [m.id, m]));
    return Array.from(userModelIds).map(id => {
      const cm = catalogMap.get(id);
      return { id, object: 'model', created: 0, owned_by: cm?.name || 'unknown' } as ProxyApiCatalogModel;
    });
  }, [catalog, userModelIds]);

  const analyticsData: AnalyticsEntry[] = useMemo(() => {
    const byModel: Record<string, AnalyticsEntry> = {};
    logs.forEach(log => {
      if (log.request_type === 'ping') return;
      const key = log.model_id;
      if (!byModel[key]) byModel[key] = { model: key, rawModelId: log.model_id, total: 0, success: 0, errors: 0, avgLatency: 0, latencies: [] };
      byModel[key].total++;
      if (log.status === 'success') byModel[key].success++;
      else byModel[key].errors++;
      if (log.latency_ms) byModel[key].latencies.push(log.latency_ms);
    });
    return Object.values(byModel).map(m => ({
      ...m,
      avgLatency: m.latencies.length ? Math.round(m.latencies.reduce((a, b) => a + b, 0) / m.latencies.length) : 0,
    }));
  }, [logs]);

  // All OpenRouter calls now go through the edge function proxy
  const invokeProxy = useCallback(async (action: string, model_id?: string) => {
    const { data, error } = await supabase.functions.invoke('openrouter-proxy', {
      body: { action, model_id },
    });
    if (error) throw error;
    return data;
  }, []);

  const handlePing = useCallback(async () => {
    if (!hasKey) return;
    setPinging(true);
    setPingResult(null);
    try {
      const data = await invokeProxy('ping');
      setPingResult({ status: data.status, latency_ms: data.latency_ms, error: data.error });
      if (data.key_info) setKeyInfo(data.key_info);
    } catch (err: any) {
      setPingResult({ status: 'error', latency_ms: 0, error: err.message || 'Network error' });
    } finally {
      setPinging(false);
    }
  }, [hasKey, invokeProxy]);

  const fetchKeyInfo = useCallback(async () => {
    if (!hasKey) return;
    setKeyLoading(true);
    try {
      const data = await invokeProxy('ping');
      if (data.key_info) setKeyInfo(data.key_info);
    } catch { /* silent */ } finally {
      setKeyLoading(false);
    }
  }, [hasKey, invokeProxy]);

  const fetchCatalog = useCallback(async (force = false) => {
    if (catalogLoaded && !force) return;
    setCatalogLoading(true);
    try {
      const data = await invokeProxy('models');
      if (data.models) {
        setCatalog(data.models);
        setCatalogLoaded(true);
      }
    } catch { /* silent */ } finally {
      setCatalogLoading(false);
    }
  }, [catalogLoaded, invokeProxy]);

  const handleTestModel = useCallback(async (modelId: string) => {
    if (!hasKey) return;
    setTestingModel(modelId);
    try {
      const data = await invokeProxy('test', modelId);
      setTestResults(prev => ({
        ...prev,
        [modelId]: {
          status: data.status,
          latency_ms: data.latency_ms,
          tokens: data.tokens,
          error: data.error,
        },
      }));
    } catch (err: any) {
      setTestResults(prev => ({ ...prev, [modelId]: { status: 'error', latency_ms: 0, error: err.message } }));
    } finally {
      setTestingModel(null);
    }
  }, [hasKey, invokeProxy, setTestResults]);

  const handleMassTest = useCallback(async () => {
    if (!hasKey || massTestRunning) return;
    const allModels = [...registryModels.map(m => m.id), ...userAddedModels.map(m => m.id)];
    if (allModels.length === 0) return;
    setMassTestRunning(true);
    setMassTestProgress({ done: 0, total: allModels.length });

    for (let i = 0; i < allModels.length; i++) {
      const modelId = allModels[i];
      setTestingModel(modelId);
      try {
        const data = await invokeProxy('test', modelId);
        setTestResults(prev => ({
          ...prev,
          [modelId]: { status: data.status, latency_ms: data.latency_ms, error: data.error },
        }));
      } catch {
        setTestResults(prev => ({ ...prev, [modelId]: { status: 'error', latency_ms: 0, error: 'Network error' } }));
      }
      setMassTestProgress({ done: i + 1, total: allModels.length });
    }
    setTestingModel(null);
    setMassTestRunning(false);
  }, [hasKey, massTestRunning, registryModels, userAddedModels, invokeProxy, setTestResults]);

  const addUserModel = useCallback((modelId: string) => {
    updateCloudUserModels(prev => [...new Set([...prev, modelId])]);
    setCatalogSearch('');
  }, [updateCloudUserModels]);

  const removeUserModel = useCallback(async (modelId: string) => {
    updateCloudUserModels(prev => prev.filter(id => id !== modelId));
    if (user) {
      try {
        await supabase.from('proxy_api_logs').delete().eq('user_id', user.id).eq('model_id', modelId);
        setLogsRefreshTrigger(prev => prev + 1);
      } catch { /* silent */ }
    }
  }, [updateCloudUserModels, user]);

  const fetchLogs = useCallback(async () => {
    if (!user) return;
    setLogsLoading(true);
    try {
      const { data, error } = await supabase
        .from('proxy_api_logs')
        .select('id, model_id, request_type, status, latency_ms, tokens_input, tokens_output, error_message, created_at')
        .eq('user_id', user.id)
        .eq('provider', 'openrouter')
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      setLogs((data as LogEntry[]) || []);
    } catch { /* silent */ } finally {
      setLogsLoading(false);
    }
  }, [user]);

  const handleExportCSV = useCallback(() => {
    if (logs.length === 0) return;
    const headers = ['Date', 'Model', 'Type', 'Status', 'Latency (ms)', 'Tokens In', 'Tokens Out', 'Error'];
    const rows = logs.map(l => [
      new Date(l.created_at).toISOString(), l.model_id, l.request_type, l.status,
      l.latency_ms ?? '', l.tokens_input ?? '', l.tokens_output ?? '', l.error_message ?? '',
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${v}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `openrouter-logs-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [logs]);

  const deleteModelStats = useCallback(async (rawModelId: string) => {
    if (user) {
      try {
        await supabase.from('proxy_api_logs').delete().eq('user_id', user.id).eq('model_id', rawModelId);
      } catch { /* silent */ }
    }
    updateCloudUserModels(prev => prev.filter(id => id !== rawModelId));
    setLogsRefreshTrigger(prev => prev + 1);
  }, [user, updateCloudUserModels]);

  useEffect(() => {
    if (hasKey && user) { fetchKeyInfo(); fetchLogs(); }
  }, [hasKey, user, fetchKeyInfo, fetchLogs]);

  useEffect(() => {
    if (hasKey && user && !catalogLoaded) fetchCatalog();
  }, [hasKey, user, catalogLoaded, fetchCatalog]);

  useEffect(() => {
    if (hasKey && user) fetchLogs();
  }, [hasKey, user, fetchLogs, logsRefreshTrigger]);

  return {
    pingResult, pinging, handlePing,
    keyInfo, keyLoading, fetchKeyInfo,
    catalog, catalogLoading, catalogLoaded, catalogSearch, setCatalogSearch,
    filteredCatalogModels, userAddedModels, userModelIds,
    registryModels, fetchCatalog,
    addUserModel, removeUserModel,
    testResults, testingModel, handleTestModel,
    massTestRunning, massTestProgress, handleMassTest,
    logs, logsLoading, fetchLogs,
    analyticsData, handleExportCSV, deleteModelStats,
  };
}
