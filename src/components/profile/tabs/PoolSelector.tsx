/**
 * PoolSelector — multi-model pool picker for poolable AI roles.
 * Shows a collapsible checkbox list of available models grouped by provider.
 * Displays worker count badge when pool is active.
 */
import { useMemo, useState, useCallback } from "react";
import { Layers, ChevronDown, ChevronUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import type { AiRoleId } from "@/config/aiRoles";
import type { ModelRegistryEntry } from "@/config/modelRegistry";

const PER_MODEL_CONCURRENCY = 3;

interface PoolSelectorProps {
  roleId: AiRoleId;
  /** Currently selected pool model IDs */
  pool: string[];
  /** Primary (single-select) model — shown as always-on */
  primaryModel: string;
  /** All models available to the user */
  availableModels: ModelRegistryEntry[];
  /** Is user admin (can use Lovable AI) */
  isAdmin: boolean;
  isRu: boolean;
  onChange: (roleId: AiRoleId, modelIds: string[]) => void;
  /** Controlled open state (for accordion behavior) */
  open?: boolean;
  /** Callback when open state changes */
  onOpenChange?: (open: boolean) => void;
}

function providerLabel(p: string) {
  if (p === "lovable") return "Lovable AI";
  if (p === "proxyapi") return "ProxyAPI";
  if (p === "openrouter") return "OpenRouter";
  return p;
}

export function PoolSelector({
  roleId,
  pool,
  primaryModel,
  availableModels,
  isAdmin,
  isRu,
  onChange,
}: PoolSelectorProps) {
  const [open, setOpen] = useState(pool.length > 0);

  // Exclude the primary model from the checkbox list — it's always included
  const grouped = useMemo(() => {
    const map = new Map<string, ModelRegistryEntry[]>();
    const order = ["lovable", "proxyapi", "openrouter"];
    for (const m of availableModels) {
      if (m.id === primaryModel) continue; // primary is always in effective pool
      const list = map.get(m.provider) || [];
      list.push(m);
      map.set(m.provider, list);
    }
    return order
      .filter((p) => map.has(p))
      .map((p) => ({ provider: p, models: map.get(p)! }));
  }, [availableModels, primaryModel]);

  const poolSet = useMemo(() => new Set(pool), [pool]);

  const toggleModel = useCallback(
    (modelId: string) => {
      const next = poolSet.has(modelId)
        ? pool.filter((id) => id !== modelId)
        : [...pool, modelId];
      onChange(roleId, next);
    },
    [pool, poolSet, roleId, onChange],
  );

  // Total workers = (pool models + primary) × concurrency
  const effectiveCount = new Set([primaryModel, ...pool]).size;
  const workerCount = effectiveCount * PER_MODEL_CONCURRENCY;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="mt-2">
      <CollapsibleTrigger className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors select-none w-full">
        <Layers className="h-3 w-3 shrink-0" />
        <span className="font-body">
          {isRu ? "Пул параллельных моделей" : "Parallel model pool"}
        </span>
        {pool.length > 0 && (
          <Badge
            variant="secondary"
            className="text-[9px] px-1.5 py-0 ml-1 gap-0.5"
            title={isRu ? `${effectiveCount} моделей × ${PER_MODEL_CONCURRENCY} = ${workerCount} потоков` : `${effectiveCount} models × ${PER_MODEL_CONCURRENCY} = ${workerCount} workers`}
          >
            ⚡ {effectiveCount} {isRu ? "моделей" : "models"}
          </Badge>
        )}
        {open ? (
          <ChevronUp className="h-3 w-3 ml-auto shrink-0" />
        ) : (
          <ChevronDown className="h-3 w-3 ml-auto shrink-0" />
        )}
      </CollapsibleTrigger>

      <CollapsibleContent className="mt-2 border border-border/40 rounded-md p-2 space-y-2 bg-muted/20">
        {/* Primary — always on */}
        <div className="flex items-center gap-2 opacity-60">
          <Checkbox checked disabled className="h-3.5 w-3.5" />
          <span className="text-[11px] font-body text-muted-foreground">
            {availableModels.find((m) => m.id === primaryModel)?.displayName ??
              primaryModel.replace(/^(google|openai)\//, "")}
          </span>
          <Badge variant="outline" className="text-[8px] px-1 py-0 ml-auto">
            {isRu ? "основная" : "primary"}
          </Badge>
        </div>

        {grouped.map(({ provider, models }) => (
          <div key={provider} className="space-y-1">
            <p className="text-[9px] uppercase tracking-wider text-muted-foreground/60 font-body pl-5">
              {providerLabel(provider)}
              {provider === "lovable" && !isAdmin && (
                <span className="text-destructive ml-1">(admin)</span>
              )}
            </p>
            {models.map((m) => {
              const disabled = m.provider === "lovable" && !isAdmin;
              const checked = poolSet.has(m.id);
              return (
                <label
                  key={m.id}
                  className={`flex items-center gap-2 cursor-pointer hover:bg-muted/40 rounded px-1 py-0.5 transition-colors ${
                    disabled ? "opacity-40 pointer-events-none" : ""
                  }`}
                >
                  <Checkbox
                    checked={checked}
                    onCheckedChange={() => toggleModel(m.id)}
                    disabled={disabled}
                    className="h-3.5 w-3.5"
                  />
                  <span className="text-[11px] font-body">{m.displayName}</span>
                </label>
              );
            })}
          </div>
        ))}

        {grouped.length === 0 && (
          <p className="text-[10px] text-muted-foreground/50 text-center py-2">
            {isRu
              ? "Добавьте API-ключи для дополнительных провайдеров"
              : "Add API keys for additional providers"}
          </p>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
