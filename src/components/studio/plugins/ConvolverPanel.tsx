/**
 * ConvolverPanel — IR catalog selector + waveform visualization + dry/wet + filter controls.
 * Uses pre-computed peaks from DB for instant waveform + stemCache for audio caching.
 */

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ParamSlider } from "./ParamSlider";
import { BypassButton } from "./BypassButton";
import { drawPeaksWaveform } from "@/lib/irPeaks";
import { fetchIrWithCache, addToBookImpulseManifest } from "@/lib/irCache";
import { Play, Square } from "lucide-react";
import type { ClipConvolverConfig } from "@/hooks/useClipPluginConfigs";

interface ConvolverPanelProps {
  isRu: boolean;
  config: ClipConvolverConfig;
  clipId: string;
  disabled?: boolean;
  projectStorage?: import("@/lib/projectStorage").ProjectStorage | null;
  onToggle: () => void;
  onUpdate: (params: Partial<ClipConvolverConfig>) => void;
}

interface ImpulseRow {
  id: string;
  name: string;
  category: string;
  file_path: string;
  duration_ms: number;
  description: string | null;
  peaks: number[] | null;
}

export function ConvolverPanel({ isRu, config, clipId, disabled, projectStorage, onToggle, onUpdate }: ConvolverPanelProps) {
  const [impulses, setImpulses] = useState<ImpulseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [fallbackPeaks, setFallbackPeaks] = useState<number[] | null>(null);
  const [previewing, setPreviewing] = useState(false);

  // Load catalog
  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("convolution_impulses")
        .select("id, name, category, file_path, duration_ms, description, peaks")
        .eq("is_public", true)
        .order("category")
        .order("name");
      setImpulses((data as unknown as ImpulseRow[]) ?? []);
      setLoading(false);
    })();
  }, []);

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, ImpulseRow[]>();
    for (const imp of impulses) {
      const list = map.get(imp.category) ?? [];
      list.push(imp);
      map.set(imp.category, list);
    }
    return map;
  }, [impulses]);

  const selectedImpulse = impulses.find(i => i.id === config.impulseId);

  // Compute fallback peaks only when selected impulse has no stored peaks
  useEffect(() => {
    if (!config.impulseId) { setFallbackPeaks(null); return; }
    const impulse = impulses.find(i => i.id === config.impulseId);
    if (!impulse) return;

    // If we have stored peaks, no need to fetch audio for visualization
    if (impulse.peaks && impulse.peaks.length > 0) {
      setFallbackPeaks(null);
      return;
    }

    // Fallback: fetch + decode for old impulses without peaks
    (async () => {
      try {
        const { data: urlData } = await supabase.storage
          .from("impulse-responses")
          .createSignedUrl(impulse.file_path, 600);
        if (!urlData?.signedUrl) return;

        const arrayBuf = await fetchWithStemCache(impulse.file_path, urlData.signedUrl);
        const { computePeaks } = await import("@/lib/irPeaks");
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        const peaks = computePeaks(decoded);
        setFallbackPeaks(peaks);
        audioCtx.close();

        // Backfill peaks to DB (fire-and-forget)
        supabase
          .from("convolution_impulses")
          .update({ peaks } as any)
          .eq("id", impulse.id)
          .then(() => {
            // Update local state so next render uses stored peaks
            setImpulses(prev => prev.map(i => i.id === impulse.id ? { ...i, peaks } : i));
          });
      } catch {
        setFallbackPeaks(null);
      }
    })();
  }, [config.impulseId, impulses]);

  // Draw waveform from peaks (stored or fallback)
  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;

    const peaks = selectedImpulse?.peaks ?? fallbackPeaks;

    if (!peaks || peaks.length === 0) {
      // Draw empty state
      const dpr = window.devicePixelRatio || 1;
      const w = c.clientWidth;
      const h = c.clientHeight;
      c.width = w * dpr;
      c.height = h * dpr;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.scale(dpr, dpr);
      ctx.fillStyle = "hsl(220 15% 8%)";
      ctx.fillRect(0, 0, w, h);
      ctx.font = "9px monospace";
      ctx.fillStyle = "hsl(220 10% 35%)";
      ctx.textAlign = "center";
      ctx.fillText(isRu ? "Выберите IR" : "Select IR", w / 2, h / 2 + 3);
      return;
    }

    drawPeaksWaveform(c, peaks);
  }, [selectedImpulse, fallbackPeaks, isRu]);

  // Handle IR change → load into engine via stemCache
  const handleImpulseChange = useCallback(async (impulseId: string) => {
    onUpdate({ impulseId });

    const impulse = impulses.find(i => i.id === impulseId);
    if (!impulse) return;

    try {
      const { data: urlData } = await supabase.storage
        .from("impulse-responses")
        .createSignedUrl(impulse.file_path, 600);
      if (urlData?.signedUrl) {
        // Pre-cache the IR audio
        await fetchWithStemCache(impulse.file_path, urlData.signedUrl);
        // Load into engine
        const { getAudioEngine } = await import("@/lib/audioEngine");
        await getAudioEngine().loadTrackConvolverIR(clipId, urlData.signedUrl);
      }
    } catch (e) {
      console.error("Failed to load IR into engine:", e);
    }
  }, [impulses, clipId, onUpdate]);

  // Preview clip through convolver
  const handlePreview = useCallback(async () => {
    try {
      const { getAudioEngine } = await import("@/lib/audioEngine");
      const engine = getAudioEngine();
      if (previewing) {
        engine.stopPreview();
        setPreviewing(false);
      } else {
        await engine.previewClip(clipId);
        setPreviewing(true);
        // Listen for engine state changes to detect when preview ends
        const checkInterval = setInterval(() => {
          if (engine.previewingTrackId !== clipId) {
            setPreviewing(false);
            clearInterval(checkInterval);
          }
        }, 300);
      }
    } catch (e) {
      console.error("Preview error:", e);
      setPreviewing(false);
    }
  }, [clipId, previewing]);

  return (
    <div className="flex flex-col gap-2 h-full">
      {/* Header */}
      <div className="flex items-center justify-between shrink-0">
        <span className="text-[10px] font-mono text-muted-foreground/60 uppercase">
          {isRu ? "Свёрточный реверб" : "Convolution Reverb"}
        </span>
        <BypassButton label="IR" bypassed={!config.enabled} onToggle={onToggle} />
      </div>

      <div className={`flex flex-col gap-2 flex-1 min-h-0 ${disabled || !config.enabled ? "opacity-40 pointer-events-none" : ""}`}>
        {/* IR Selector */}
        <div className="shrink-0">
          <Select
            value={config.impulseId ?? ""}
            onValueChange={handleImpulseChange}
            disabled={!config.enabled || loading}
          >
            <SelectTrigger className="h-6 text-[10px] font-mono">
              <SelectValue placeholder={loading ? (isRu ? "Загрузка…" : "Loading…") : (isRu ? "Импульс…" : "Impulse…")} />
            </SelectTrigger>
            <SelectContent>
              {[...grouped.entries()].map(([cat, items]) => (
                <div key={cat}>
                  <div className="px-2 py-1 text-[9px] font-mono uppercase text-muted-foreground/50">{cat}</div>
                  {items.map(imp => (
                    <SelectItem key={imp.id} value={imp.id} className="text-[10px] font-mono">
                      {imp.name}
                      {imp.duration_ms > 0 && <span className="ml-1 text-muted-foreground/50">{(imp.duration_ms / 1000).toFixed(1)}s</span>}
                    </SelectItem>
                  ))}
                </div>
              ))}
            </SelectContent>
          </Select>
          {selectedImpulse?.description && (
            <p className="text-[8px] text-muted-foreground/40 mt-0.5 truncate">{selectedImpulse.description}</p>
          )}
        </div>

        {/* Waveform + preview */}
        <div className="flex-1 min-h-0 relative" style={{ minHeight: 40 }}>
          <canvas ref={canvasRef} className="w-full h-full rounded" style={{ display: "block" }} />
          {config.impulseId && (
            <button
              onClick={handlePreview}
              className={`absolute top-1 right-1 p-1 rounded transition-colors ${
                previewing
                  ? "bg-primary/30 text-primary"
                  : "bg-background/60 text-muted-foreground/60 hover:text-foreground/80 hover:bg-background/80"
              }`}
              title={isRu ? (previewing ? "Остановить" : "Прослушать клип с IR") : (previewing ? "Stop" : "Preview clip with IR")}
            >
              {previewing
                ? <Square className="h-3 w-3 fill-current" />
                : <Play className="h-3 w-3 fill-current" />}
            </button>
          )}
        </div>

        {/* Controls */}
        <div className="flex gap-3 shrink-0">
          <div className="flex-1">
            <ParamSlider label="Dry/Wet" value={config.dryWet} min={0} max={1} step={0.01} onChange={v => onUpdate({ dryWet: v })} disabled={!config.enabled} />
          </div>
          <div className="flex-1">
            <ParamSlider label="Pre-delay" value={config.preDelaySec} min={0} max={0.5} step={0.005} unit=" s" onChange={v => onUpdate({ preDelaySec: v })} disabled={!config.enabled} />
          </div>
        </div>

        {/* Wet filter */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => onUpdate({ wetFilterEnabled: !config.wetFilterEnabled })}
            className={`text-[8px] font-mono px-1.5 py-0.5 rounded border transition-colors ${
              config.wetFilterEnabled
                ? "border-primary/50 text-primary bg-primary/10"
                : "border-border/30 text-muted-foreground/40"
            }`}
            disabled={!config.enabled}
          >
            {isRu ? "Фильтр" : "Filter"}
          </button>
          {config.wetFilterEnabled && (
            <>
              <button
                onClick={() => onUpdate({ wetFilterType: config.wetFilterType === "lowpass" ? "highpass" : "lowpass" })}
                className="text-[8px] font-mono text-muted-foreground/60 hover:text-foreground/80"
                disabled={!config.enabled}
              >
                {config.wetFilterType === "lowpass" ? "LP" : "HP"}
              </button>
              <div className="flex-1">
                <ParamSlider
                  label={isRu ? "Частота" : "Freq"}
                  value={config.wetFilterFreq}
                  min={100}
                  max={16000}
                  step={50}
                  unit=" Hz"
                  onChange={v => onUpdate({ wetFilterFreq: v })}
                  disabled={!config.enabled}
                />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
