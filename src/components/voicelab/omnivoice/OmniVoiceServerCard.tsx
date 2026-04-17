/**
 * OmniVoiceServerCard — URL input, health check button, dev-proxy hint,
 * cloud-preview warning and install hint.
 */
import { Loader2, Globe, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";

interface Props {
  isRu: boolean;
  serverUrl: string;
  onChangeUrl: (value: string) => void;
  onCheck: () => void;
  checking: boolean;
  usingLocalDevProxy: boolean;
  showPreviewWarning: boolean;
}

export function OmniVoiceServerCard({
  isRu, serverUrl, onChangeUrl, onCheck, checking, usingLocalDevProxy, showPreviewWarning,
}: Props) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Globe className="w-4 h-4" />
          {isRu ? "Сервер OmniVoice" : "OmniVoice Server"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <div className="flex items-center gap-2">
          <Input
            value={serverUrl}
            onChange={(e) => onChangeUrl(e.target.value)}
            placeholder="http://127.0.0.1:8880"
            className="text-sm font-mono"
          />
          <Button size="sm" variant="outline" onClick={onCheck} disabled={checking}>
            {checking ? <Loader2 className="w-3 h-3 animate-spin" /> : (isRu ? "Проверить" : "Check")}
          </Button>
        </div>
        {usingLocalDevProxy && (
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "В локальном Booker запросы к OmniVoice идут через встроенный dev-прокси на 127.0.0.1:8880."
              : "When Booker runs locally, OmniVoice requests go through the built-in dev proxy on 127.0.0.1:8880."}
          </p>
        )}
        {showPreviewWarning && (
          <Alert variant="destructive">
            <AlertTriangle className="w-4 h-4" />
            <AlertDescription className="text-xs">
              {isRu ? (
                <>
                  Cloud preview не может достучаться до локального OmniVoice на <code className="rounded bg-muted px-1 text-[10px]">127.0.0.1:8880</code>.
                  Откройте Booker локально через <code className="rounded bg-muted px-1 text-[10px]">npm run dev</code> и используйте <code className="rounded bg-muted px-1 text-[10px]">http://localhost:8080/voice-lab</code>.
                </>
              ) : (
                <>
                  The cloud preview cannot reach a local OmniVoice server at <code className="rounded bg-muted px-1 text-[10px]">127.0.0.1:8880</code>.
                  Run Booker locally with <code className="rounded bg-muted px-1 text-[10px]">npm run dev</code> and use <code className="rounded bg-muted px-1 text-[10px]">http://localhost:8080/voice-lab</code>.
                </>
              )}
            </AlertDescription>
          </Alert>
        )}
        <p className="text-xs text-muted-foreground">
          {isRu
            ? "Запустите: pip install omnivoice-server && omnivoice-server --device cuda"
            : "Run: pip install omnivoice-server && omnivoice-server --device cuda"}
        </p>
      </CardContent>
    </Card>
  );
}
