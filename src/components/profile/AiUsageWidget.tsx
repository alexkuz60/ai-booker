import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
import { Activity, RefreshCw, Zap, Clock, Hash } from 'lucide-react';

interface UsageRow {
  request_type: string;
  total: number;
  success: number;
  errors: number;
  tokens_in: number;
  tokens_out: number;
  avg_latency: number;
}

const TYPE_LABELS: Record<string, { ru: string; en: string; color: string }> = {
  'segment-scene': { ru: 'Раскадровка', en: 'Storyboard', color: 'hsl(var(--primary))' },
  'profile-characters': { ru: 'Профайлинг', en: 'Profiling', color: 'hsl(210 80% 60%)' },
  'generate-atmosphere': { ru: 'Атмосфера', en: 'Atmosphere', color: 'hsl(150 60% 50%)' },
  'parse-structure': { ru: 'Парсинг', en: 'Parsing', color: 'hsl(40 80% 55%)' },
};

function getLabel(type: string, isRu: boolean) {
  const l = TYPE_LABELS[type];
  return l ? (isRu ? l.ru : l.en) : type;
}
function getColor(type: string, i: number) {
  return TYPE_LABELS[type]?.color ?? `hsl(${(i * 70) % 360} 60% 55%)`;
}

export function AiUsageWidget({ isRu }: { isRu: boolean }) {
  const { user } = useAuth();
  const [rows, setRows] = useState<UsageRow[]>([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase
      .from('proxy_api_logs')
      .select('request_type, status, latency_ms, tokens_input, tokens_output')
      .eq('user_id', user.id)
      .eq('provider', 'lovable');

    if (data) {
      const map = new Map<string, UsageRow>();
      for (const r of data) {
        const key = r.request_type;
        let row = map.get(key);
        if (!row) {
          row = { request_type: key, total: 0, success: 0, errors: 0, tokens_in: 0, tokens_out: 0, avg_latency: 0 };
          map.set(key, row);
        }
        row.total++;
        if (r.status === 'success') row.success++;
        else row.errors++;
        row.tokens_in += r.tokens_input ?? 0;
        row.tokens_out += r.tokens_output ?? 0;
        row.avg_latency += r.latency_ms ?? 0;
      }
      const result = Array.from(map.values()).map(r => ({
        ...r,
        avg_latency: r.total > 0 ? Math.round(r.avg_latency / r.total) : 0,
      }));
      result.sort((a, b) => b.total - a.total);
      setRows(result);
    }
    setLoading(false);
  }, [user]);

  useEffect(() => { load(); }, [load]);

  const totalTokens = rows.reduce((s, r) => s + r.tokens_in + r.tokens_out, 0);
  const totalCalls = rows.reduce((s, r) => s + r.total, 0);

  const chartData = rows.map(r => ({
    name: getLabel(r.request_type, isRu),
    type: r.request_type,
    tokens: r.tokens_in + r.tokens_out,
    latency: r.avg_latency,
  }));

  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          <h3 className="font-semibold font-display">{isRu ? 'AI расход по ролям' : 'AI Usage by Role'}</h3>
        </div>
        <Button variant="ghost" size="icon" onClick={load} disabled={loading} className="h-8 w-8">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-6">
          {isRu ? 'Нет данных — запустите раскадровку или профайлинг' : 'No data — run storyboard or profiling first'}
        </p>
      ) : (
        <>
          {/* Summary chips */}
          <div className="flex flex-wrap gap-3">
            <div className="flex items-center gap-1.5 text-xs bg-muted/50 px-3 py-1.5 rounded-full">
              <Hash className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{isRu ? 'Вызовов' : 'Calls'}:</span>
              <span className="font-mono font-medium">{totalCalls}</span>
            </div>
            <div className="flex items-center gap-1.5 text-xs bg-muted/50 px-3 py-1.5 rounded-full">
              <Zap className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-muted-foreground">{isRu ? 'Токенов' : 'Tokens'}:</span>
              <span className="font-mono font-medium">{totalTokens.toLocaleString()}</span>
            </div>
          </div>

          {/* Token chart */}
          <div>
            <p className="text-xs text-muted-foreground mb-2">{isRu ? 'Токены по типу задачи' : 'Tokens by task type'}</p>
            <ResponsiveContainer width="100%" height={160}>
              <BarChart data={chartData} layout="vertical">
                <XAxis type="number" tick={{ fontSize: 10 }} />
                <YAxis type="category" dataKey="name" width={100} tick={{ fontSize: 11 }} />
                <RechartsTooltip
                  cursor={{ fill: 'hsl(var(--muted) / 0.3)' }}
                  contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                />
                <Bar dataKey="tokens" name={isRu ? 'Токены' : 'Tokens'} radius={[0, 4, 4, 0]}>
                  {chartData.map((d, i) => <Cell key={i} fill={getColor(d.type, i)} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Detail cards */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {rows.map((r, i) => (
              <div key={r.request_type} className="p-3 rounded-lg border bg-card/50 space-y-1.5">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: getColor(r.request_type, i) }} />
                  <span className="text-sm font-medium">{getLabel(r.request_type, isRu)}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs">
                  <span className="text-muted-foreground">{isRu ? 'Вызовов' : 'Calls'}</span>
                  <span className="font-mono text-right">{r.total}</span>
                  <span className="text-muted-foreground">{isRu ? 'Успешно' : 'OK'}</span>
                  <span className="font-mono text-right text-emerald-400">{r.success}</span>
                  <span className="text-muted-foreground">{isRu ? 'Ошибки' : 'Errors'}</span>
                  <span className="font-mono text-right text-destructive">{r.errors}</span>
                  <span className="text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" /> In</span>
                  <span className="font-mono text-right">{r.tokens_in.toLocaleString()}</span>
                  <span className="text-muted-foreground flex items-center gap-1"><Zap className="h-3 w-3" /> Out</span>
                  <span className="font-mono text-right">{r.tokens_out.toLocaleString()}</span>
                  <span className="text-muted-foreground flex items-center gap-1"><Clock className="h-3 w-3" /> Avg</span>
                  <span className="font-mono text-right">{r.avg_latency} ms</span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  );
}
