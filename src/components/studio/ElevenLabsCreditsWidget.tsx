import { useState, useCallback, useEffect } from "react";
import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";

interface ElevenLabsCreditsWidgetProps {
  isRu: boolean;
  autoLoad?: boolean;
}

export function ElevenLabsCreditsWidget({ isRu, autoLoad = true }: ElevenLabsCreditsWidgetProps) {
  const [credits, setCredits] = useState<{ used: number; limit: number; tier: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) return;
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/elevenlabs-credits`,
        { headers: { Authorization: `Bearer ${session.access_token}`, apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY } }
      );
      if (response.ok) {
        const data = await response.json();
        setCredits({ used: data.character_count, limit: data.character_limit, tier: data.tier });
      } else {
        const err = await response.json().catch(() => ({ error: "unknown" }));
        if (err.error === "missing_permissions") {
          setError(isRu ? "Ключ не имеет разрешения user_read" : "Key lacks user_read permission");
        }
      }
    } catch (e) {
      console.error("Credits load error:", e);
    } finally {
      setLoading(false);
    }
  }, [isRu]);

  useEffect(() => {
    if (autoLoad && !credits && !loading) load();
  }, [autoLoad]);

  if (!credits && !error) return null;

  return (
    <div className="rounded-md border border-border bg-muted/30 p-2.5">
      {credits && (
        <>
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {isRu ? "Кредиты EL" : "EL Credits"}: <span className="font-semibold text-foreground capitalize">{credits.tier}</span>
            </span>
            <Button variant="ghost" size="icon" className="h-5 w-5" onClick={load} disabled={loading}>
              <RotateCcw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
            </Button>
          </div>
          <div className="mt-1.5">
            <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
              <span>{credits.used.toLocaleString()} / {credits.limit.toLocaleString()}</span>
              <span>{Math.round((credits.used / credits.limit) * 100)}%</span>
            </div>
            <div className="h-1.5 rounded-full bg-muted overflow-hidden">
              <div
                className="h-full rounded-full bg-primary transition-all"
                style={{ width: `${Math.min(100, (credits.used / credits.limit) * 100)}%` }}
              />
            </div>
          </div>
        </>
      )}
      {!credits && error && (
        <p className="text-[10px] text-muted-foreground">⚠️ {error}</p>
      )}
    </div>
  );
}
