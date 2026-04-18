/**
 * Collapsible Advanced Generation Parameters block.
 *
 * Phase 1 (experimentation): exposes raw OmniVoice generation knobs so the
 * user can find optimal ranges per character / psychotype before we wire
 * them into voice_config.omnivoice_advanced.
 *
 * Pure presentational — owner holds state and reset/preset actions.
 */
import { ChevronDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  ADVANCED_PRESETS,
  DEFAULT_ADVANCED_PARAMS,
  type OmniVoiceAdvancedParams,
} from "./constants";
import { OmniVoiceUserPresetsMenu } from "./OmniVoiceUserPresetsMenu";
import type { OmniVoiceUserPreset } from "@/lib/omniVoiceUserPresets";

interface OmniVoiceAdvancedParamsProps {
  isRu: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  value: OmniVoiceAdvancedParams;
  /** Manual edit (slider/switch) — caller marks source as "manual". */
  onChange: (next: OmniVoiceAdvancedParams) => void;
  /** Preset button click — caller marks source as `preset:<id>`. */
  onPresetApply?: (presetId: "draft" | "standard" | "final", params: OmniVoiceAdvancedParams) => void;
  /** Reset button — caller marks source as "manual" with default values. */
  onReset?: () => void;
  /** Optional short label shown in the header (e.g. "Auto · Hyperthymic + Hero"). */
  sourceLabel?: string | null;
  /** Current speed (bundled into a saved user preset for full reproducibility). */
  currentSpeed?: number;
  /** Apply a saved user preset — caller stamps source as `preset:user:<name>`. */
  onUserPresetApply?: (preset: OmniVoiceUserPreset) => void;
}

interface ParamMeta {
  key: keyof OmniVoiceAdvancedParams;
  label_ru: string;
  label_en: string;
  hint_ru: string;
  hint_en: string;
  min: number;
  max: number;
  step: number;
  fmt?: (v: number) => string;
}

const NUMERIC_PARAMS: ParamMeta[] = [
  {
    key: "guidance_scale",
    label_ru: "Guidance Scale (CFG)",
    label_en: "Guidance Scale (CFG)",
    hint_ru: "Сила следования референсу. Выше → стабильнее, но менее естественно.",
    hint_en: "Reference adherence. Higher → more consistent, less natural.",
    min: 1.0, max: 7.0, step: 0.1,
    fmt: (v) => v.toFixed(1),
  },
  {
    key: "num_step",
    label_ru: "Num Steps",
    label_en: "Num Steps",
    hint_ru: "Шаги диффузии. Больше → качественнее и медленнее.",
    hint_en: "Diffusion steps. More → higher quality, slower.",
    min: 4, max: 64, step: 1,
    fmt: (v) => String(Math.round(v)),
  },
  {
    key: "t_shift",
    label_ru: "T-Shift",
    label_en: "T-Shift",
    hint_ru: "Сдвиг шумового расписания. ~1.0 — нейтрально.",
    hint_en: "Noise schedule shift. ~1.0 is neutral.",
    min: 0.5, max: 2.0, step: 0.05,
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "position_temperature",
    label_ru: "Position Temperature",
    label_en: "Position Temperature",
    hint_ru: "Разнообразие интонации. Выше → живее, но менее предсказуемо.",
    hint_en: "Intonation diversity. Higher → livelier, less predictable.",
    min: 0.1, max: 2.0, step: 0.05,
    fmt: (v) => v.toFixed(2),
  },
  {
    key: "class_temperature",
    label_ru: "Class Temperature",
    label_en: "Class Temperature",
    hint_ru: "«Жизнь» сэмплинга токенов. Высокие значения — больше вариативности.",
    hint_en: "Token sampling liveliness. Higher → more variety.",
    min: 0.1, max: 2.0, step: 0.05,
    fmt: (v) => v.toFixed(2),
  },
];

export function OmniVoiceAdvancedParams({
  isRu, open, onOpenChange, value, onChange, onPresetApply, onReset, sourceLabel,
  currentSpeed, onUserPresetApply,
}: OmniVoiceAdvancedParamsProps) {
  const setNumeric = (key: keyof OmniVoiceAdvancedParams, n: number) =>
    onChange({ ...value, [key]: n });

  const isDefault = (k: keyof OmniVoiceAdvancedParams) =>
    value[k] === DEFAULT_ADVANCED_PARAMS[k];

  return (
    <TooltipProvider delayDuration={200}>
      <Collapsible open={open} onOpenChange={onOpenChange} className="rounded-md border border-border/60">
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-muted/40 transition-colors"
          >
            <div className="flex items-center gap-2">
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              />
              <span className="text-xs font-medium">
                {isRu ? "Расширенные параметры (эксперимент)" : "Advanced parameters (experimental)"}
              </span>
              {sourceLabel && (
                <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                  {sourceLabel}
                </span>
              )}
            </div>
            <span className="text-[10px] text-muted-foreground">
              {isRu ? "CFG / Steps / Temperatures" : "CFG / Steps / Temperatures"}
            </span>
          </button>
        </CollapsibleTrigger>

        <CollapsibleContent className="px-3 pb-3 pt-1 space-y-3">
          {/* Presets */}
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] text-muted-foreground mr-1">
              {isRu ? "Пресет:" : "Preset:"}
            </span>
            {ADVANCED_PRESETS.map((p) => (
              <Tooltip key={p.id}>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => {
                      const next = { ...p.params };
                      if (onPresetApply) onPresetApply(p.id, next);
                      else onChange(next);
                    }}
                  >
                    {isRu ? p.label_ru : p.label_en}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  <p className="text-xs">{isRu ? p.description_ru : p.description_en}</p>
                </TooltipContent>
              </Tooltip>
            ))}
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-6 px-2 text-[10px] gap-1 ml-auto"
              onClick={() => {
                if (onReset) onReset();
                else onChange({ ...DEFAULT_ADVANCED_PARAMS });
              }}
            >
              <RotateCcw className="h-3 w-3" />
              {isRu ? "Сброс" : "Reset"}
            </Button>
          </div>

          {/* Numeric sliders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-3">
            {NUMERIC_PARAMS.map((p) => {
              const v = value[p.key] as number;
              const fmt = p.fmt ?? ((x: number) => String(x));
              return (
                <div key={p.key} className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label className="text-[11px] cursor-help">
                          {isRu ? p.label_ru : p.label_en}
                        </Label>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-[260px]">
                        <p className="text-xs">{isRu ? p.hint_ru : p.hint_en}</p>
                      </TooltipContent>
                    </Tooltip>
                    <span
                      className={`text-[10px] tabular-nums ${
                        isDefault(p.key) ? "text-muted-foreground" : "text-foreground font-medium"
                      }`}
                    >
                      {fmt(v)}
                    </span>
                  </div>
                  <Slider
                    value={[v]}
                    min={p.min}
                    max={p.max}
                    step={p.step}
                    onValueChange={([n]) => setNumeric(p.key, n)}
                  />
                </div>
              );
            })}
          </div>

          {/* Denoise switch */}
          <div className="flex items-center justify-between rounded-md bg-muted/30 px-2 py-1.5">
            <Tooltip>
              <TooltipTrigger asChild>
                <Label htmlFor="omnivoice-denoise" className="text-[11px] cursor-help">
                  {isRu ? "Денойз на сервере" : "Server-side denoise"}
                </Label>
              </TooltipTrigger>
              <TooltipContent side="top" className="max-w-[260px]">
                <p className="text-xs">
                  {isRu
                    ? "Постобработка для подавления артефактов. Может смягчить дикцию."
                    : "Post-processing to suppress artifacts. May soften articulation."}
                </p>
              </TooltipContent>
            </Tooltip>
            <Switch
              id="omnivoice-denoise"
              checked={value.denoise}
              onCheckedChange={(c) => onChange({ ...value, denoise: c })}
            />
          </div>
        </CollapsibleContent>
      </Collapsible>
    </TooltipProvider>
  );
}
