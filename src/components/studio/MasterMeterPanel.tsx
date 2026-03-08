/**
 * MasterMeterPanel — large stereo L/R output-level meter with dB scale
 * between the bars, mastering plugin chain with bypass.
 * Range: -96 dB … +3 dB. Red zone above 0 dB.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { Sliders, Power } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────

const DB_MIN = -96;
const DB_MAX = 3;
const DB_RANGE = DB_MAX - DB_MIN; // 99

/** Map dB value to 0..1 fraction within -96..+3 range */
function dbToFraction(db: number): number {
  if (db <= DB_MIN) return 0;
  if (db >= DB_MAX) return 1;
  return (db - DB_MIN) / DB_RANGE;
}

const DB_MARKS = [3, 0, -3, -6, -12, -18, -24, -36, -48, -60, -72, -96];

// ─── Large Stereo Output Meter (horizontal L on top, R on bottom) ───

function LargeMeter() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = getAudioEngine();
  const meterRef = useRef({ levelL: -96, levelR: -96 });

  useEffect(() => {
    let raf: number;
    const draw = () => {
      meterRef.current = engine.getMasterMeter();
      const canvas = canvasRef.current;
      if (!canvas) { raf = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { raf = requestAnimationFrame(draw); return; }

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const fracL = dbToFraction(meterRef.current.levelL);
      const fracR = dbToFraction(meterRef.current.levelR);
      const zeroPct = dbToFraction(0); // where 0 dB sits

      // Each bar occupies full width, split vertically into L (top) and R (bottom)
      const barH = (h - 2) / 2;
      const gap = 2;

      // Draw a single horizontal bar
      const drawBar = (y: number, frac: number) => {
        // Background
        ctx.fillStyle = "hsla(0, 0%, 50%, 0.1)";
        ctx.fillRect(0, y, w, barH);

        const fillW = frac * w;
        const zeroX = zeroPct * w;

        if (fillW <= zeroX) {
          // All below 0 dB — green→yellow gradient
          const grad = ctx.createLinearGradient(0, 0, zeroX, 0);
          grad.addColorStop(0, "hsl(140, 60%, 42%)");
          grad.addColorStop(0.5, "hsl(80, 60%, 48%)");
          grad.addColorStop(1, "hsl(50, 80%, 50%)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, y, fillW, barH);
        } else {
          // Below 0 dB portion
          const grad = ctx.createLinearGradient(0, 0, zeroX, 0);
          grad.addColorStop(0, "hsl(140, 60%, 42%)");
          grad.addColorStop(0.5, "hsl(80, 60%, 48%)");
          grad.addColorStop(1, "hsl(50, 80%, 50%)");
          ctx.fillStyle = grad;
          ctx.fillRect(0, y, zeroX, barH);

          // Above 0 dB — RED
          ctx.fillStyle = "hsl(0, 75%, 50%)";
          ctx.fillRect(zeroX, y, fillW - zeroX, barH);
        }

        // 0 dB tick line
        ctx.fillStyle = "hsla(0, 0%, 100%, 0.25)";
        ctx.fillRect(zeroX, y, 1, barH);
      };

      drawBar(0, fracL);
      drawBar(barH + gap, fracR);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

// ─── dB Scale (horizontal, placed between bars via overlay) ──

function DbScale() {
  return (
    <div className="relative w-full h-4">
      {DB_MARKS.map(db => {
        const pct = dbToFraction(db) * 100;
        return (
          <span
            key={db}
            className={`absolute font-mono leading-none select-none ${
              db > 0
                ? "text-[10px] font-bold text-destructive"
                : db === 0
                  ? "text-[10px] font-bold text-foreground"
                  : "text-[9px] text-foreground/80"
            }`}
            style={{ left: `${pct}%`, transform: "translateX(-50%)", top: 0 }}
          >
            {db > 0 ? `+${db}` : db === 0 ? "0" : db}
          </span>
        );
      })}
    </div>
  );
}

// ─── Mastering Plugin Slot ──────────────────────────────────

interface PluginSlot {
  id: string;
  label: string;
  bypassed: boolean;
}

const DEFAULT_PLUGINS: PluginSlot[] = [
  { id: "eq", label: "EQ", bypassed: true },
  { id: "comp", label: "COMP", bypassed: true },
  { id: "limit", label: "LIMIT", bypassed: true },
];

// ─── Exported Panel ─────────────────────────────────────────

interface MasterMeterPanelProps {
  isRu: boolean;
  width: number;
}

export function MasterMeterPanel({ isRu, width }: MasterMeterPanelProps) {
  const [plugins, setPlugins] = useState<PluginSlot[]>(() => {
    try {
      const saved = localStorage.getItem("master-plugins-state");
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return DEFAULT_PLUGINS;
  });

  const [masterBypassed, setMasterBypassed] = useState(() => {
    try { return localStorage.getItem("master-bypass") === "true"; } catch { return false; }
  });

  const togglePluginBypass = useCallback((id: string) => {
    setPlugins(prev => {
      const next = prev.map(p => p.id === id ? { ...p, bypassed: !p.bypassed } : p);
      localStorage.setItem("master-plugins-state", JSON.stringify(next));
      return next;
    });
  }, []);

  const toggleMasterBypass = useCallback(() => {
    setMasterBypassed(prev => {
      const next = !prev;
      localStorage.setItem("master-bypass", String(next));
      return next;
    });
  }, []);

  const isCompact = width < 200;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="h-6 border-b border-border flex items-center px-2 justify-between shrink-0">
        <div className="flex items-center gap-1.5">
          <Sliders className="h-3 w-3 text-muted-foreground" />
          <span className="text-[10px] font-body text-muted-foreground uppercase tracking-wider">
            {isRu ? "Мастер" : "Master"}
          </span>
        </div>
        <button
          onClick={toggleMasterBypass}
          className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase leading-none transition-colors font-semibold ${
            masterBypassed
              ? "text-muted-foreground/50 bg-transparent"
              : "text-primary bg-primary/15"
          }`}
          title={isRu ? "Байпасс мастер-цепи" : "Bypass master chain"}
        >
          <Power className="h-2.5 w-2.5" />
          {isCompact ? "" : "BYP"}
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex flex-col gap-1.5 p-2 min-h-0 overflow-auto">
        {/* Meter section: L bar, dB scale, R bar */}
        <div className="flex flex-col gap-0">
          {/* L label + bar */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-foreground/60 font-mono w-3 shrink-0 font-bold">L</span>
            <div className="flex-1 h-5 rounded-sm overflow-hidden border border-border/40 bg-background/40">
              <LargeMeterSingleChannel channel="L" />
            </div>
          </div>

          {/* dB scale between bars */}
          <div className="pl-4 pr-0">
            <DbScale />
          </div>

          {/* R label + bar */}
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-foreground/60 font-mono w-3 shrink-0 font-bold">R</span>
            <div className="flex-1 h-5 rounded-sm overflow-hidden border border-border/40 bg-background/40">
              <LargeMeterSingleChannel channel="R" />
            </div>
          </div>
        </div>

        {/* Plugin chain */}
        <div className="flex flex-col gap-1 mt-1">
          <span className="text-[9px] text-muted-foreground/50 font-body uppercase tracking-wider">
            {isRu ? "Плагины" : "Plugins"}
          </span>
          {plugins.map(plugin => (
            <button
              key={plugin.id}
              onClick={() => togglePluginBypass(plugin.id)}
              className={`flex items-center justify-between px-2 py-1.5 rounded border transition-colors text-[10px] font-mono uppercase tracking-wide ${
                plugin.bypassed
                  ? "border-border/50 text-muted-foreground/40 bg-transparent hover:bg-muted/20"
                  : masterBypassed
                    ? "border-border text-muted-foreground/60 bg-muted/10"
                    : "border-accent/50 text-accent bg-accent/10 hover:bg-accent/15"
              }`}
            >
              <span className="font-semibold">{plugin.label}</span>
              <span className={`text-[8px] ${plugin.bypassed ? "text-muted-foreground/30" : masterBypassed ? "text-muted-foreground/40" : "text-accent/70"}`}>
                {plugin.bypassed ? "OFF" : masterBypassed ? "BYP" : "ON"}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Single-channel meter bar (canvas) ──────────────────────

function LargeMeterSingleChannel({ channel }: { channel: "L" | "R" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = getAudioEngine();

  useEffect(() => {
    let raf: number;
    const draw = () => {
      const meter = engine.getMasterMeter();
      const canvas = canvasRef.current;
      if (!canvas) { raf = requestAnimationFrame(draw); return; }
      const ctx = canvas.getContext("2d");
      if (!ctx) { raf = requestAnimationFrame(draw); return; }

      const dpr = window.devicePixelRatio || 1;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
        canvas.width = w * dpr;
        canvas.height = h * dpr;
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      const db = channel === "L" ? meter.levelL : meter.levelR;
      const frac = dbToFraction(db);
      const zeroPct = dbToFraction(0);
      const fillW = frac * w;
      const zeroX = zeroPct * w;

      // Background
      ctx.fillStyle = "hsla(0, 0%, 50%, 0.08)";
      ctx.fillRect(0, 0, w, h);

      if (fillW <= zeroX) {
        const grad = ctx.createLinearGradient(0, 0, zeroX, 0);
        grad.addColorStop(0, "hsl(140, 60%, 42%)");
        grad.addColorStop(0.55, "hsl(80, 60%, 48%)");
        grad.addColorStop(1, "hsl(50, 80%, 50%)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, fillW, h);
      } else {
        const grad = ctx.createLinearGradient(0, 0, zeroX, 0);
        grad.addColorStop(0, "hsl(140, 60%, 42%)");
        grad.addColorStop(0.55, "hsl(80, 60%, 48%)");
        grad.addColorStop(1, "hsl(50, 80%, 50%)");
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, zeroX, h);

        // Red zone: 0..+3 dB
        ctx.fillStyle = "hsl(0, 75%, 50%)";
        ctx.fillRect(zeroX, 0, fillW - zeroX, h);
      }

      // 0 dB tick
      ctx.fillStyle = "hsla(0, 0%, 100%, 0.3)";
      ctx.fillRect(zeroX, 0, 1, h);

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, channel]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}
