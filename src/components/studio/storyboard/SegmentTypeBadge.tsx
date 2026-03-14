import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import { SEGMENT_TYPES, SEGMENT_CONFIG } from "./constants";

interface SegmentTypeBadgeProps {
  segmentType: string;
  isRu: boolean;
  onChange: (newType: string) => void;
}

export function SegmentTypeBadge({ segmentType, isRu, onChange }: SegmentTypeBadgeProps) {
  const [open, setOpen] = useState(false);
  const config = SEGMENT_CONFIG[segmentType] || SEGMENT_CONFIG.narrator;
  const Icon = config.icon;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button className="inline-flex items-center cursor-pointer hover:ring-1 hover:ring-primary/40 rounded-full transition-all">
          <Badge variant="outline" className={cn("text-[10px] gap-1 py-0", config.color)}>
            <Icon className="h-3 w-3" />
            {isRu ? config.label_ru : config.label_en}
            <ChevronDown className="h-2.5 w-2.5 opacity-50" />
          </Badge>
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-44 p-1" align="start">
        <div className="space-y-0.5">
          {SEGMENT_TYPES.map((type) => {
            const c = SEGMENT_CONFIG[type];
            const TypeIcon = c.icon;
            const isActive = type === segmentType;
            return (
              <button
                key={type}
                onClick={() => { onChange(type); setOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs font-body transition-colors text-left",
                  isActive ? "bg-accent text-accent-foreground" : "hover:bg-accent/50"
                )}
              >
                <TypeIcon className="h-3 w-3 shrink-0" />
                {isRu ? c.label_ru : c.label_en}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
