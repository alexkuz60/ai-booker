/**
 * OmniVoiceTagsPopover — non-verbal tag buttons grouped by meaning.
 * Parent handles insertion via `onInsert(tag)` — this component is purely presentational.
 */
import { Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { NON_VERBAL_TAG_GROUPS } from "./constants";

interface Props {
  isRu: boolean;
  onInsert: (tag: string) => void;
}

export function OmniVoiceTagsPopover({ isRu, onInsert }: Props) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-6 px-2 text-[10px] gap-1"
          title={isRu ? "Вставить тег в позицию курсора" : "Insert tag at cursor"}
        >
          <Tags className="w-3 h-3" />
          {isRu ? "Теги" : "Tags"}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-2 space-y-2">
        <p className="text-[10px] text-muted-foreground px-1">
          {isRu ? "Клик — вставка в позицию курсора" : "Click to insert at cursor position"}
        </p>
        {NON_VERBAL_TAG_GROUPS.map((group) => (
          <div key={group.label_en} className="space-y-1">
            <div className="text-[10px] font-medium text-muted-foreground px-1">
              {isRu ? group.label_ru : group.label_en}
            </div>
            <div className="flex flex-wrap gap-1">
              {group.tags.map((tag) => (
                <Button
                  key={tag}
                  variant="secondary"
                  size="sm"
                  className="h-6 px-2 text-[10px] font-mono"
                  onClick={() => onInsert(tag)}
                >
                  {tag}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}
