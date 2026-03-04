import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { getAvailableModels, type ModelRegistryEntry } from "@/config/modelRegistry";
import { Cpu, Lock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  isRu: boolean;
  disabled?: boolean;
  /** User's API keys from profile, e.g. { proxyapi: "sk-...", openrouter: "sk-..." } */
  userApiKeys: Record<string, string>;
}

const PROVIDER_LABELS: Record<string, { ru: string; en: string }> = {
  lovable: { ru: '⚡ Lovable AI (встроенные)', en: '⚡ Lovable AI (built-in)' },
  proxyapi: { ru: '🔑 ProxyAPI', en: '🔑 ProxyAPI' },
  openrouter: { ru: '🔑 OpenRouter', en: '🔑 OpenRouter' },
};

export default function ModelSelector({ value, onChange, isRu, disabled, userApiKeys }: ModelSelectorProps) {
  const models = getAvailableModels(userApiKeys);

  // Group by provider
  const grouped = new Map<string, ModelRegistryEntry[]>();
  for (const m of models) {
    const arr = grouped.get(m.provider) || [];
    arr.push(m);
    grouped.set(m.provider, arr);
  }

  // Provider order
  const providerOrder = ['lovable', 'proxyapi', 'openrouter'];
  const sortedProviders = providerOrder.filter(p => grouped.has(p));

  const pricingLabel = (m: ModelRegistryEntry) => {
    if (m.pricing === 'included') return isRu ? 'встр.' : 'built-in';
    if (m.pricing === 'free') return isRu ? 'бесплатно' : 'free';
    return null;
  };

  // Check which providers are missing keys
  const missingProviders: string[] = [];
  if (!userApiKeys.proxyapi) missingProviders.push('ProxyAPI');
  if (!userApiKeys.openrouter) missingProviders.push('OpenRouter');

  return (
    <TooltipProvider>
      <div className="flex items-center gap-2">
        <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
        <Select value={value} onValueChange={onChange} disabled={disabled}>
          <SelectTrigger className="w-[260px] h-8 text-xs">
            <SelectValue placeholder={isRu ? "Модель AI" : "AI Model"} />
          </SelectTrigger>
          <SelectContent className="max-h-[400px]">
            {sortedProviders.map((provider, provIdx) => {
              const items = grouped.get(provider)!;
              const label = PROVIDER_LABELS[provider]?.[isRu ? 'ru' : 'en'] || provider;
              return (
                <div key={provider}>
                  {provIdx > 0 && <Separator className="my-1" />}
                  <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    {label}
                  </div>
                  {items.map(m => {
                    const badge = pricingLabel(m);
                    return (
                      <SelectItem key={m.id} value={m.id} className="text-xs">
                        <span className="flex items-center gap-2">
                          {m.displayName}
                          {badge && (
                            <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                              {badge}
                            </Badge>
                          )}
                        </span>
                      </SelectItem>
                    );
                  })}
                </div>
              );
            })}
            {missingProviders.length > 0 && (
              <>
                <Separator className="my-1" />
                <div className="px-2 py-2 flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Lock className="h-3 w-3" />
                  {isRu
                    ? `${missingProviders.join(', ')} — добавьте ключ в Профиле`
                    : `${missingProviders.join(', ')} — add key in Profile`}
                </div>
              </>
            )}
          </SelectContent>
        </Select>
      </div>
    </TooltipProvider>
  );
}
