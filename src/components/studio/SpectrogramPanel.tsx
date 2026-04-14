/**
 * SpectrogramPanel — Shows side-by-side spectrograms for VC diagnostics.
 * Displays: Input TTS, Reference voice, RVC Output.
 * Canvas auto-resizes to fill container width.
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

const RENDER_HEIGHT = 160;
const BASE_FFT = 2048;
const BASE_HOP = 256;

export function SpectrogramPanel({ isRu, slots, onClose }: SpectrogramPanelProps) {
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const canvasRefs = useRef<(HTMLCanvasElement | null)[]>([]);
  const [rendering, setRendering] = useState(false);
  const [canvasWidth, setCanvasWidth] = useState(0);

  // Track the inner canvas wrapper width with debounce
  useEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const ro = new ResizeObserver(entries => {
      for (const entry of entries) {
        const w = Math.floor(entry.contentRect.width);
        if (w > 0) {
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => setCanvasWidth(w), 300);
        }
      }
    });
    ro.observe(el);
    const w = Math.floor(el.clientWidth);
    if (w > 0) setCanvasWidth(w);
    return () => { ro.disconnect(); if (timer) clearTimeout(timer); };
  }, []);

  const renderAll = useCallback(async () => {
    if (canvasWidth < 100) return;
    setRendering(true);
    const opts: SpectrogramOptions = {
      width: canvasWidth,
      height: RENDER_HEIGHT,
      fftSize: BASE_FFT,
      hop: BASE_HOP,
      minDb: -80,
      maxDb: -5,
      palette: "magma",
    };
    try {
      for (let i = 0; i < slots.length; i++) {
        const canvas = canvasRefs.current[i];
        const slot = slots[i];
        if (!canvas || !slot.blob) continue;
        await renderSpectrogramFromBlob(canvas, slot.blob, {
          ...opts,
          label: slot.label,
        });
      }
    } catch (err) {
      console.error("[SpectrogramPanel] render error:", err);
    } finally {
      setRendering(false);
    }
  }, [slots, canvasWidth]);

  useEffect(() => {
    renderAll();
  }, [renderAll]);

  return (
    <div className="space-y-2 rounded-lg border border-border/50 bg-muted/20 p-3 overflow-hidden">
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

      <div ref={canvasWrapRef} className="flex flex-col gap-2 min-w-0">
        {slots.map((slot, idx) => (
          <div key={idx} className="relative w-full min-w-0">
            {slot.blob ? (
              <canvas
                key={`canvas-${idx}-${canvasWidth}`}
                ref={(el) => { canvasRefs.current[idx] = el; }}
                width={canvasWidth || 480}
                height={RENDER_HEIGHT}
                className="block w-full rounded border border-border/30 bg-black"
                style={{ imageRendering: "pixelated" }}
              />
            ) : (
              <div
                className="flex items-center justify-center rounded border border-dashed border-border/30 bg-muted/40"
                style={{ height: RENDER_HEIGHT }}
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
