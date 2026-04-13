/**
 * SliderField — Reusable slider with label, value display and reset button.
 * Extracted from Narrators page for reuse across the app.
 */
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { RotateCcw } from "lucide-react";

interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  default_: number;
  showSign?: boolean;
  multiplier?: number;
  decimals?: number;
  onChange: (v: number) => void;
  onReset: () => void;
}

export function SliderField({
  label, value, min, max, step, suffix, default_, showSign, multiplier, decimals, onChange, onReset,
}: SliderFieldProps) {
  const display = multiplier ? (value * multiplier).toFixed(decimals ?? 0) : value.toFixed(decimals ?? 1);
  const sign = showSign && value > 0 ? "+" : "";
  return (
    <div className="space-y-2">
      <div className="flex justify-between">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{label}</label>
        <span className="text-xs text-muted-foreground tabular-nums">{sign}{display}{suffix ?? ""}</span>
      </div>
      <div className="flex items-center gap-2">
        <Slider min={min} max={max} step={step} value={[value]} onValueChange={([v]) => onChange(v)} className="flex-1" />
        <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={onReset} disabled={value === default_}>
          <RotateCcw className="h-3 w-3" />
        </Button>
      </div>
    </div>
  );
}
