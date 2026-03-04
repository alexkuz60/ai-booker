import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, Wifi, Zap, AlertTriangle, Key, Save } from 'lucide-react';
import { ApiKeyField } from '@/components/profile/ApiKeyField';
import { useProxyApiData } from '@/hooks/useProxyApiData';
import { useLanguage } from '@/hooks/useLanguage';
import { SimpleCatalogSection } from './SimpleCatalogSection';
import { SimpleLogsTable } from './SimpleLogsTable';
import { SimpleAnalyticsSection } from './SimpleAnalyticsSection';
import { SimpleSettingsSection } from './SimpleSettingsSection';

interface ProxyApiDashboardProps {
  hasKey: boolean;
  proxyapiPriority: boolean;
  onPriorityChange: (value: boolean) => void;
  apiKeyValue: string;
  onApiKeyChange: (value: string) => void;
  onSave: () => Promise<void>;
  saving: boolean;
}

export function ProxyApiDashboard({ hasKey, proxyapiPriority, onPriorityChange, apiKeyValue, onApiKeyChange, onSave, saving }: ProxyApiDashboardProps) {
  const api = useProxyApiData(hasKey);
  const { isRu } = useLanguage();

  const renderKeySection = () => (
    <Accordion type="multiple" defaultValue={['apikey']} className="mb-4">
      <AccordionItem value="apikey" className="border rounded-lg px-4">
        <AccordionTrigger className="hover:no-underline">
          <div className="flex items-center gap-2">
            <Key className="h-4 w-4 text-primary" />
            <span className="font-semibold">API-{isRu ? 'ключ' : 'key'}</span>
            {hasKey && <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30 ml-2">{isRu ? 'Активен' : 'Active'}</Badge>}
          </div>
        </AccordionTrigger>
        <AccordionContent className="pb-4">
          <ApiKeyField provider="proxyapi" label="ProxyAPI" value={apiKeyValue} onChange={onApiKeyChange} placeholder="sk-..."
            hint={<>{isRu ? 'Получите ключ на' : 'Get your key at'}{' '}<a href="https://console.proxyapi.ru/keys" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">console.proxyapi.ru/keys</a></>}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  const renderInfoBlock = () => (
    <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
      <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-400 mb-1">{isRu ? 'Альтернатива OpenRouter для России' : 'OpenRouter alternative for Russia'}</p>
        <p className="text-xs text-muted-foreground mb-2">{isRu ? 'ProxyAPI — российский шлюз для доступа к моделям без VPN.' : 'ProxyAPI — Russian gateway for accessing models without VPN.'}</p>
        <div className="flex items-center gap-2">
          <Checkbox id="dash-proxyapi-priority" checked={proxyapiPriority} onCheckedChange={(checked) => onPriorityChange(!!checked)} />
          <Label htmlFor="dash-proxyapi-priority" className="text-sm text-muted-foreground cursor-pointer">{isRu ? 'Приоритет над OpenRouter' : 'Priority over OpenRouter'}</Label>
        </div>
      </div>
    </div>
  );

  if (!hasKey) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm p-6">
        <CardHeader className="flex flex-row items-center gap-2 pb-4"><Zap className="h-5 w-5 text-primary" /><CardTitle className="font-display">ProxyAPI</CardTitle></CardHeader>
        <CardContent>
          {renderInfoBlock()}{renderKeySection()}
          <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border border-border">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">{isRu ? 'Добавьте ключ ProxyAPI и сохраните.' : 'Add your ProxyAPI key and save.'}</p>
          </div>
          <div className="flex justify-end pt-2"><Button onClick={onSave} disabled={saving} size="sm">{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}{isRu ? 'Сохранить' : 'Save'}</Button></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm p-6">
      <CardHeader className="flex flex-row items-center gap-2 pb-4"><Zap className="h-5 w-5 text-primary" /><CardTitle className="font-display">ProxyAPI Dashboard</CardTitle></CardHeader>
      <CardContent>
        {renderInfoBlock()}{renderKeySection()}
        <Accordion type="multiple" defaultValue={['status', 'catalog']} className="space-y-2">
          <AccordionItem value="status" className="border rounded-lg px-4">
            <AccordionTrigger className="hover:no-underline">
              <div className="flex items-center gap-2">
                <Wifi className="h-4 w-4 text-primary" />
                <span className="font-semibold">{isRu ? 'Статус подключения' : 'Connection Status'}</span>
                {api.pingResult && <StatusBadge status={api.pingResult.status} isRu={isRu} />}
              </div>
            </AccordionTrigger>
            <AccordionContent className="space-y-4 pb-4">
              <div className="flex items-center gap-3">
                <Button onClick={api.handlePing} disabled={api.pinging} size="sm">{api.pinging ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Zap className="h-4 w-4 mr-2" />}Ping</Button>
                {api.pingResult && (
                  <div className="flex items-center gap-4 text-sm">
                    <span className="text-muted-foreground">{isRu ? 'Латенси' : 'Latency'}: <strong className="text-foreground">{api.pingResult.latency_ms}ms</strong></span>
                    {api.pingResult.model_count !== undefined && <span className="text-muted-foreground">{isRu ? 'Моделей' : 'Models'}: <strong className="text-foreground">{api.pingResult.model_count}</strong></span>}
                  </div>
                )}
              </div>
            </AccordionContent>
          </AccordionItem>

          <SimpleCatalogSection userAddedModels={api.userAddedModels} filteredCatalogModels={api.filteredCatalogModels} userModelIds={api.userModelIds}
            catalogSearch={api.catalogSearch} onCatalogSearchChange={api.setCatalogSearch} catalogLoading={api.catalogLoading} catalogLoaded={api.catalogLoaded}
            catalogCount={api.proxyCatalog.length} testResults={api.testResults} testingModel={api.testingModel} massTestRunning={api.massTestRunning} massTestProgress={api.massTestProgress}
            onTestModel={api.handleTestModel} onMassTest={api.handleMassTest} onAddUserModel={api.addUserModel} onRemoveUserModel={api.removeUserModel}
            onRefreshCatalog={() => api.fetchCatalog(true)} language={isRu ? 'ru' : 'en'} providerName="ProxyAPI" />

          <SimpleSettingsSection settings={api.settings} onSettingsChange={api.setSettings} language={isRu ? 'ru' : 'en'} />
          <SimpleLogsTable logs={api.logs} logsLoading={api.logsLoading} onRefresh={api.fetchLogs} onExportCSV={api.handleExportCSV} language={isRu ? 'ru' : 'en'} />
          <SimpleAnalyticsSection analyticsData={api.analyticsData} onDeleteStats={(raw) => api.deleteModelStats(raw)} language={isRu ? 'ru' : 'en'} />
        </Accordion>
        <div className="flex justify-end pt-4"><Button onClick={onSave} disabled={saving} size="sm">{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}{isRu ? 'Сохранить' : 'Save'}</Button></div>
      </CardContent>
    </Card>
  );
}

function StatusBadge({ status, isRu }: { status: string; isRu: boolean }) {
  if (status === 'online') return <Badge className="bg-emerald-500/20 text-emerald-400 border-emerald-500/30">{isRu ? 'Онлайн' : 'Online'}</Badge>;
  if (status === 'timeout') return <Badge variant="destructive">{isRu ? 'Таймаут' : 'Timeout'}</Badge>;
  return <Badge variant="destructive">{isRu ? 'Ошибка' : 'Error'}</Badge>;
}
