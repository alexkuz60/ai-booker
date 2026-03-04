import React from 'react';
import { AccordionItem, AccordionTrigger, AccordionContent } from '@/components/ui/accordion';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { History, RefreshCw, Download } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { LogEntry } from './proxyapi/types';
import { getStatusExpl } from './proxyapi/types';

interface SimpleLogsTableProps {
  logs: LogEntry[];
  logsLoading: boolean;
  onRefresh: () => void;
  onExportCSV: () => void;
  language: string;
}

export function SimpleLogsTable({ logs, logsLoading, onRefresh, onExportCSV, language }: SimpleLogsTableProps) {
  const isRu = language === 'ru';
  const lang = isRu ? 'ru' as const : 'en' as const;

  return (
    <AccordionItem value="logs" className="border rounded-lg px-4">
      <AccordionTrigger className="hover:no-underline">
        <div className="flex items-center gap-2">
          <History className="h-4 w-4 text-primary" />
          <span className="font-semibold">{isRu ? 'Последние запросы' : 'Recent Requests'}</span>
          <Badge variant="secondary" className="ml-2">{logs.length}</Badge>
        </div>
      </AccordionTrigger>
      <AccordionContent className="pb-4">
        <div className="flex justify-end gap-2 mb-2">
          <Button size="sm" variant="ghost" onClick={onExportCSV} disabled={logs.length === 0}><Download className="h-3.5 w-3.5 mr-1" />CSV</Button>
          <Button size="sm" variant="ghost" onClick={onRefresh} disabled={logsLoading}><RefreshCw className={cn("h-3.5 w-3.5 mr-1", logsLoading && "animate-spin")} />{isRu ? 'Обновить' : 'Refresh'}</Button>
        </div>
        {logs.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">{isRu ? 'Нет записей' : 'No records'}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-muted-foreground">
                  <th className="text-left py-2 pr-3">{isRu ? 'Модель' : 'Model'}</th>
                  <th className="text-left py-2 pr-3">{isRu ? 'Тип' : 'Type'}</th>
                  <th className="text-left py-2 pr-3">{isRu ? 'Статус' : 'Status'}</th>
                  <th className="text-right py-2 pr-3">{isRu ? 'Латенси' : 'Latency'}</th>
                  <th className="text-right py-2 pr-3">{isRu ? 'Токены' : 'Tokens'}</th>
                  <th className="text-right py-2">{isRu ? 'Дата' : 'Date'}</th>
                </tr>
              </thead>
              <tbody>
                {logs.map(log => {
                  const modelShort = log.model_id.replace(/^(proxyapi|dotpoint|openrouter)\//, '');
                  const date = new Date(log.created_at);
                  const timeStr = `${date.toLocaleDateString(isRu ? 'ru-RU' : 'en-US')} ${date.toLocaleTimeString(isRu ? 'ru-RU' : 'en-US', { hour: '2-digit', minute: '2-digit' })}`;
                  const tokens = (log.tokens_input || log.tokens_output) ? `${log.tokens_input || 0}/${log.tokens_output || 0}` : '—';
                  const statusColor = log.status === 'success' ? 'text-emerald-400' : log.status === 'timeout' ? 'text-amber-500' : 'text-destructive';
                  return (
                    <tr key={log.id} className="border-b border-border/50 hover:bg-card/50">
                      <td className="py-1.5 pr-3 font-medium truncate max-w-[140px]">{modelShort}</td>
                      <td className="py-1.5 pr-3">{log.request_type}</td>
                      <td className={cn("py-1.5 pr-3", statusColor)}>{log.status}</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{log.latency_ms ?? '—'}ms</td>
                      <td className="py-1.5 pr-3 text-right font-mono">{tokens}</td>
                      <td className="py-1.5 text-right text-muted-foreground">{timeStr}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
