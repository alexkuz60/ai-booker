import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { getModelsForAnalysis, type ModelRegistryEntry } from "@/config/modelRegistry";
import { Cpu } from "lucide-react";

interface ModelSelectorProps {
  value: string;
  onChange: (modelId: string) => void;
  isRu: boolean;
  disabled?: boolean;
}

export default function ModelSelector({ value, onChange, isRu, disabled }: ModelSelectorProps) {
  const models = getModelsForAnalysis();

  const groupByCreator = (entries: ModelRegistryEntry[]) => {
    const map = new Map<string, ModelRegistryEntry[]>();
    for (const m of entries) {
      const arr = map.get(m.creator) || [];
      arr.push(m);
      map.set(m.creator, arr);
    }
    return map;
  };

  const grouped = groupByCreator(models);

  return (
    <div className="flex items-center gap-2">
      <Cpu className="h-4 w-4 text-muted-foreground shrink-0" />
      <Select value={value} onValueChange={onChange} disabled={disabled}>
        <SelectTrigger className="w-[220px] h-8 text-xs">
          <SelectValue placeholder={isRu ? "Модель AI" : "AI Model"} />
        </SelectTrigger>
        <SelectContent>
          {Array.from(grouped.entries()).map(([creator, items]) => (
            <div key={creator}>
              <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {creator}
              </div>
              {items.map(m => (
                <SelectItem key={m.id} value={m.id} className="text-xs">
                  <span className="flex items-center gap-2">
                    {m.displayName}
                    {m.pricing === 'included' && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0 h-4">
                        {isRu ? "встр." : "built-in"}
                      </Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
