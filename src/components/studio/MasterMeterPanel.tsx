/**
 * MasterMeterPanel — large stereo L/R VU meter with dB scale
 * and mastering plugin chain placeholder with bypass.
 * Used in chapter mode timeline sidebar.
 */

import { useRef, useEffect, useState, useCallback } from "react";
import { getAudioEngine } from "@/lib/audioEngine";
import { Sliders, Power } from "lucide-react";

// ─── Helpers ────────────────────────────────────────────────

function dbToLinear(db: number): number {
  if (db <= -60) return 0;
  if (db >= 0) return 1;
  return Math.pow(10, db / 20);
}

const DB_MARKS = [0, -3, -6, -12, -18, -24, -36, -48, -60];

// ─── Large VU Meter ─────────────────────────────────────────

function LargeMeter({ vertical }: { vertical?: boolean }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const engine = getAudioEngine();
  const meterRef = useRef({ levelL: -60, levelR: -60 });

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

      const linL = dbToLinear(meterRef.current.levelL);
      const linR = dbToLinear(meterRef.current.levelR);

      if (vertical) {
        // Vertical bars: bottom-up
        const barW = (w - 4) / 2;
        const gap = 4;

        // Gradient bottom→top: green→yellow→red
        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, "hsl(140 60% 45%)");
        grad.addColorStop(0.6, "hsl(50 80% 50%)");
        grad.addColorStop(0.85, "hsl(20 80% 50%)");
        grad.addColorStop(1, "hsl(0 75% 50%)");

        // L bar
        const hL = linL * h;
        ctx.fillStyle = "hsla(0,0%,50%,0.12)";
        ctx.fillRect(0, 0, barW, h);
        ctx.fillStyle = grad;
        ctx.fillRect(0, h - hL, barW, hL);

        // R bar
        const hR = linR * h;
        ctx.fillStyle = "hsla(0,0%,50%,0.12)";
        ctx.fillRect(barW + gap, 0, barW, h);
        ctx.fillStyle = grad;
        ctx.fillRect(barW + gap, h - hR, barW, hR);

        // Peak clip indicator
        if (meterRef.current.levelL > -0.5) {
          ctx.fillStyle = "hsl(0 80% 55%)";
          ctx.fillRect(0, 0, barW, 2);
        }
        if (meterRef.current.levelR > -0.5) {
          ctx.fillStyle = "hsl(0 80% 55%)";
          ctx.fillRect(barW + gap, 0, barW, 2);
        }
      } else {
        // Horizontal bars
        const barH = (h - 2) / 2;
        const gap = 2;
        const grad = ctx.createLinearGradient(0, 0, w, 0);
        grad.addColorStop(0, "hsl(140 60% 45%)");
        grad.addColorStop(0.6, "hsl(50 80% 50%)");
        grad.addColorStop(0.85, "hsl(20 80% 50%)");
        grad.addColorStop(1, "hsl(0 75% 50%)");

        ctx.fillStyle = "hsla(0,0%,50%,0.12)";
        ctx.fillRect(0, 0, w, barH);
        ctx.fillRect(0, barH + gap, w, barH);

        const wL = linL * w;
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, wL, barH);
        const wR = linR * w;
        ctx.fillRect(0, barH + gap, wR, barH);
      }

      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [engine, vertical]);

  return <canvas ref={canvasRef} className="w-full h-full" />;
}

// ─── dB Scale ───────────────────────────────────────────────

function DbScale({ vertical, height }: { vertical?: boolean; height?: number }) {
  if (vertical) {
    return (
      <div className="flex flex-col justify-between h-full py-0.5" style={height ? { height } : undefined}>
        {DB_MARKS.map(db => {
          const pct = dbToLinear(db) * 100;
          return (
            <div
              key={db}
              className="flex items-center gap-0.5"
              style={{ position: "absolute", bottom: `${pct}%`, transform: "translateY(50%)" }}
            >
              <div className="w-1.5 h-px bg-muted-foreground/40" />
              <span className="text-[8px] text-muted-foreground/60 font-mono leading-none">
                {db === 0 ? "0" : db}
              </span>
            </div>
          );
        })}
      </div>
    );
  }

  // Horizontal scale
  return (
    <div className="relative w-full h-3">
      {DB_MARKS.map(db => {
        const pct = dbToLinear(db) * 100;
        return (
          <span
            key={db}
            className="absolute text-[7px] text-muted-foreground/60 font-mono leading-none"
            style={{ left: `${pct}%`, transform: "translateX(-50%)", top: 0 }}
          >
            {db === 0 ? " 0" : db}
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
        {/* Meter section */}
        <div className="flex flex-col gap-0.5">
          <div className="flex items-center gap-1">
            <span className="text-[8px] text-muted-foreground/50 font-mono w-3 shrink-0">L</span>
            <div className="flex-1" />
            <span className="text-[8px] text-muted-foreground/50 font-mono w-3 shrink-0 text-right">R</span>
          </div>
          <div className={`rounded border border-border/50 bg-background/50 ${isCompact ? "h-10" : "h-12"}`}>
            <LargeMeter />
          </div>
          <DbScale />
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
