import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion';
import { Loader2, Wifi, Zap, AlertTriangle, Key, Network, Save } from 'lucide-react';
import { ApiKeyField } from '@/components/profile/ApiKeyField';
import { useDotPointData } from '@/hooks/useDotPointData';
import { SimpleCatalogSection } from './SimpleCatalogSection';
import { SimpleLogsTable } from './SimpleLogsTable';
import { SimpleAnalyticsSection } from './SimpleAnalyticsSection';
import { SimpleSettingsSection } from './SimpleSettingsSection';

interface DotPointDashboardProps {
  hasKey: boolean;
  apiKeyValue: string;
  onApiKeyChange: (value: string) => void;
  onSave: () => Promise<void>;
  saving: boolean;
  language: string;
}

export function DotPointDashboard({ hasKey, apiKeyValue, onApiKeyChange, onSave, saving, language }: DotPointDashboardProps) {
  const api = useDotPointData(hasKey);
  const isRu = language === 'ru';

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
          <ApiKeyField provider="dotpoint" label="DotPoint API Key" value={apiKeyValue} onChange={onApiKeyChange} placeholder="dp-..."
            hint={<>{isRu ? 'Получите ключ на' : 'Get your key at'}{' '}<a href="https://dotpoin.com/" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">dotpoin.com</a></>}
          />
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );

  const renderInfoBlock = () => (
    <div className="flex items-center gap-3 mb-4 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30">
      <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-semibold text-amber-400 mb-1">{isRu ? 'Альтернативный роутер для России' : 'Alternative router for Russia'}</p>
        <p className="text-xs text-muted-foreground">{isRu ? 'DotPoint — российский AI-роутер с оплатой в рублях.' : 'DotPoint — Russian AI router with ruble payments.'}</p>
      </div>
    </div>
  );

  if (!hasKey) {
    return (
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm p-6">
        <CardHeader className="flex flex-row items-center gap-2 pb-4"><Network className="h-5 w-5 text-primary" /><CardTitle className="font-display">DotPoint</CardTitle></CardHeader>
        <CardContent>
          {renderInfoBlock()}{renderKeySection()}
          <div className="flex items-center gap-3 p-4 rounded-lg bg-muted/50 border border-border">
            <AlertTriangle className="h-5 w-5 text-amber-500 flex-shrink-0" />
            <p className="text-sm text-muted-foreground">{isRu ? 'Добавьте ключ DotPoint и сохраните.' : 'Add your DotPoint key and save.'}</p>
          </div>
          <div className="flex justify-end pt-2"><Button onClick={onSave} disabled={saving} size="sm">{saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Save className="h-4 w-4 mr-2" />}{isRu ? 'Сохранить' : 'Save'}</Button></div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm p-6">
      <CardHeader className="flex flex-row items-center gap-2 pb-4"><Network className="h-5 w-5 text-primary" /><CardTitle className="font-display">DotPoint Dashboard</CardTitle></CardHeader>
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
            catalogCount={api.dotpointCatalog.length} testResults={api.testResults} testingModel={api.testingModel} massTestRunning={api.massTestRunning} massTestProgress={api.massTestProgress}
            onTestModel={api.handleTestModel} onMassTest={api.handleMassTest} onAddUserModel={api.addUserModel} onRemoveUserModel={api.removeUserModel}
            onRefreshCatalog={() => api.fetchCatalog(true)} language={language} providerName="DotPoint" />

          <SimpleSettingsSection settings={api.settings} onSettingsChange={api.setSettings} language={language} />
          <SimpleLogsTable logs={api.logs} logsLoading={api.logsLoading} onRefresh={api.fetchLogs} onExportCSV={api.handleExportCSV} language={language} />
          <SimpleAnalyticsSection analyticsData={api.analyticsData} onDeleteStats={(raw) => api.deleteModelStats(raw)} language={language} />
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
