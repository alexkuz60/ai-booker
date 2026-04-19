/**
 * VocoLocoEngineToggle — switch between server-mode (HTTP /v1/audio/speech)
 * and local-mode (in-browser ONNX via VocoLoco stack).
 *
 * Visual: two pill buttons + small status hint. Disabled when local stack
 * isn't ready and the user hasn't yet opened the model manager.
 */
import { Cloud, Cpu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export type OmniVoiceEngine = "server" | "local";

interface Props {
  isRu: boolean;
  engine: OmniVoiceEngine;
  onChange: (next: OmniVoiceEngine) => void;
  /** Number of cached local models (0..N). */
  cachedCount: number;
  totalCount: number;
}

export function VocoLocoEngineToggle({
  isRu, engine, onChange, cachedCount, totalCount,
}: Props) {
  return (
    <div className="flex items-center gap-2">
      <div className="inline-flex rounded-md border border-border bg-muted/30 p-0.5">
        <Button
          size="sm"
          variant={engine === "server" ? "default" : "ghost"}
          className={cn("h-7 px-3 text-xs gap-1.5", engine !== "server" && "text-muted-foreground")}
          onClick={() => onChange("server")}
        >
          <Cloud className="w-3.5 h-3.5" />
          {isRu ? "Сервер" : "Server"}
        </Button>
        <Button
          size="sm"
          variant={engine === "local" ? "default" : "ghost"}
          className={cn("h-7 px-3 text-xs gap-1.5", engine !== "local" && "text-muted-foreground")}
          onClick={() => onChange("local")}
        >
          <Cpu className="w-3.5 h-3.5" />
          {isRu ? "Локально (VocoLoco)" : "Local (VocoLoco)"}
        </Button>
      </div>
      {engine === "local" && (
        <Badge variant={cachedCount === totalCount ? "default" : "outline"} className="text-[10px]">
          {cachedCount}/{totalCount} {isRu ? "моделей" : "models"}
        </Badge>
      )}
    </div>
  );
}
