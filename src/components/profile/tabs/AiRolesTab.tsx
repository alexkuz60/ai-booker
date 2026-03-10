import { useMemo } from "react";
import { Bot, RotateCcw, Sparkles, Zap, Cpu } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { useAiRoles } from "@/hooks/useAiRoles";
import { AI_ROLE_LIST, TIER_LABELS, type AiRoleId } from "@/config/aiRoles";
import type { ModelRegistryEntry } from "@/config/modelRegistry";

interface AiRolesTabProps {
  apiKeys: Record<string, string>;
  isRu: boolean;
}

const TIER_ICONS = {
  lite: Zap,
  standard: Cpu,
  heavy: Sparkles,
} as const;

const TIER_COLORS = {
  lite: "text-green-500",
  standard: "text-blue-500",
  heavy: "text-amber-500",
} as const;

export function AiRolesTab({ apiKeys, isRu }: AiRolesTabProps) {
  const {
    resolvedModels,
    overrides,
    setModelForRole,
    resetAll,
    availableModels,
    isAdmin,
  } = useAiRoles(apiKeys);

  const grouped = useMemo(() => {
    const map = new Map<string, ModelRegistryEntry[]>();
    const order = ["lovable", "proxyapi", "openrouter"];
    for (const m of availableModels) {
      const list = map.get(m.provider) || [];
      list.push(m);
      map.set(m.provider, list);
    }
    return order
      .filter((p) => map.has(p))
      .map((p) => ({ provider: p, models: map.get(p)! }));
  }, [availableModels]);

  const providerLabel = (p: string) => {
    if (p === "lovable") return "Lovable AI";
    if (p === "proxyapi") return "ProxyAPI";
    if (p === "openrouter") return "OpenRouter";
    return p;
  };

  const hasOverrides = Object.keys(overrides).length > 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground font-body">
          {isRu
            ? "Выберите модель для каждой AI-роли. Лёгкие задачи — быстрые модели, сложные — мощные."
            : "Choose a model for each AI role. Light tasks → fast models, complex → powerful."}
        </p>
        {hasOverrides && (
          <Button
            variant="ghost"
            size="sm"
            onClick={resetAll}
            className="gap-1.5 text-xs shrink-0"
          >
            <RotateCcw className="h-3 w-3" />
            {isRu ? "Сбросить" : "Reset"}
          </Button>
        )}
      </div>

      <div className="grid gap-3">
        {AI_ROLE_LIST.map((role) => {
          const TierIcon = TIER_ICONS[role.tier];
          const tierColor = TIER_COLORS[role.tier];
          const currentModel = resolvedModels[role.id];
          const isOverridden = !!overrides[role.id];

          return (
            <Card key={role.id} className="border-border/50">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex items-start gap-3 flex-1 min-w-0">
                  <div className={`mt-0.5 ${tierColor}`}>
                    <TierIcon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium font-body">
                        {isRu ? role.labelRu : role.labelEn}
                      </span>
                      <Badge
                        variant="outline"
                        className={`text-[9px] px-1.5 py-0 ${tierColor} border-current/30`}
                      >
                        {isRu
                          ? TIER_LABELS[role.tier].ru
                          : TIER_LABELS[role.tier].en}
                      </Badge>
                      {isOverridden && (
                        <Badge
                          variant="secondary"
                          className="text-[9px] px-1.5 py-0"
                        >
                          {isRu ? "изменено" : "custom"}
                        </Badge>
                      )}
                    </div>
                    <p className="text-[11px] text-muted-foreground font-body mt-0.5 truncate">
                      {isRu ? role.descriptionRu : role.descriptionEn}
                    </p>
                  </div>
                </div>

                <Select
                  value={currentModel}
                  onValueChange={(v) =>
                    setModelForRole(role.id as AiRoleId, v)
                  }
                >
                  <SelectTrigger className="w-full sm:w-[240px] h-8 text-xs shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {grouped.map(({ provider, models }) => (
                      <SelectGroup key={provider}>
                        <SelectLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
                          {providerLabel(provider)}
                          {provider === "lovable" && !isAdmin && (
                            <span className="ml-1 text-destructive">
                              (admin only)
                            </span>
                          )}
                        </SelectLabel>
                        {models.map((m) => (
                          <SelectItem
                            key={m.id}
                            value={m.id}
                            disabled={
                              m.provider === "lovable" && !isAdmin
                            }
                            className="text-xs"
                          >
                            {m.displayName}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Separator />

      <p className="text-[10px] text-muted-foreground/60 font-body flex items-center gap-1.5">
        <Bot className="h-3 w-3" />
        {isRu
          ? "Настройки сохраняются автоматически и синхронизируются между устройствами"
          : "Settings save automatically and sync across devices"}
      </p>
    </div>
  );
}
