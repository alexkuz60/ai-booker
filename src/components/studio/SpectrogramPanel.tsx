/**
 * SpectrogramPanel — Shows side-by-side spectrograms for VC diagnostics.
 * Displays: Input TTS, Reference voice, RVC Output.
 */
import { useRef, useEffect, useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { renderSpectrogramFromBlob, type SpectrogramOptions } from "@/lib/vcSpectrogram";
import { X, BarChart3 } from "lucide-react";

interface SpectrogramSlot {
  label: string;
  blob: Blob | null;
}

interface SpectrogramPanelProps {
  isRu: boolean;
  slots: SpectrogramSlot[];
  onClose?: () => void;
}

const CANVAS_WIDTH = 480;
const CANVAS_HEIGHT = 160;

const baseOpts: SpectrogramOptions = {
  width: CANVAS_WIDTH,
  height: CANVAS_HEIGHT,
  fftSize: 2048,
  hop: 256,
  minDb: -80,
  maxDb: -5,
  palette: "magma",
};

export function SpectrogramPanel({ isRu, slots, onClose }: SpectrogramPanelProps) {
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [rendering, setRendering] = useState(false);

  const renderAll = useCallback(async () => {
    setRendering(true);
    try {
      for (let i = 0; i < slots.length; i++) {
        const canvas = canvasRefs.current[i];
        const slot = slots[i];
        if (!canvas || !slot.blob) continue;
        await renderSpectrogramFromBlob(canvas, slot.blob, {
          ...baseOpts,
          label: slot.label,
        });
      }
    } catch (err) {
      console.error("[SpectrogramPanel] render error:", err);
    } finally {
      setRendering(false);
    }
  }, [slots]);

  useEffect(() => {
    renderAll();
  }, [renderAll]);

  return (
    <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            {isRu ? "Спектрограммы" : "Spectrograms"}
          </span>
          {rendering && (
            <Badge variant="outline" className="text-[10px] animate-pulse">
              {isRu ? "Рендер..." : "Rendering..."}
            </Badge>
          )}
        </div>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-6 w-6" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-2">
        {slots.map((slot, idx) => (
          <div key={idx} className="relative">
            {slot.blob ? (
              <canvas
                ref={(el) => { canvasRefs.current[idx] = el; }}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="w-full rounded border border-border/30"
                style={{ imageRendering: "pixelated", height: CANVAS_HEIGHT }}
              />
            ) : (
              <div
                className="flex items-center justify-center rounded border border-dashed border-border/30 bg-muted/40"
                style={{ height: CANVAS_HEIGHT }}
              >
                <span className="text-xs text-muted-foreground italic">
                  {slot.label}: {isRu ? "нет данных" : "no data"}
                </span>
              </div>
            )}
          </div>
        ))}
      </div>

      <p className="text-[10px] text-muted-foreground/60 text-center">
        {isRu
          ? "Ось Y: частота (снизу → вверх) | Ось X: время | Цвет: амплитуда (dB)"
          : "Y-axis: frequency (bottom → up) | X-axis: time | Color: magnitude (dB)"}
      </p>
    </div>
  );
}
