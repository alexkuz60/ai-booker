/**
 * VcConfigPanel — VC parameter controls with compact grid layout.
 * Pitch algo + encoder (2 cols), reference + index (2 cols),
 * 4 sliders in a row, backend + SR (2 cols).
 */
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  PITCH_ALGORITHM_LABELS, SPEECH_ENCODER_LABELS,
  VC_ALL_MODELS, VC_ENCODER_MODELS,
  type PitchAlgorithm, type SpeechEncoder,
} from "@/lib/vcModelCache";
import { hasModel, downloadModel } from "@/lib/vcModelCache";
import { listVcReferences, type VcReferenceEntry } from "@/lib/vcReferenceCache";
import { listVcIndexes, type VcIndexEntry } from "@/lib/vcIndexSearch";
import { RVC_OUTPUT_SR_OPTIONS, RVC_OUTPUT_SR_DEFAULT, type RvcOutputSR } from "@/lib/vcSynthesis";
import type { VcBackend } from "@/lib/vcInferenceSession";
import {
  Wand2, RotateCcw, FlaskConical, Download, Cpu, Monitor,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import type { PitchFrame } from "@/lib/vcCrepe";

export interface VcConfigValues {
  vcEnabled: boolean;
  pitchShift: number;
  vcOutputSR: RvcOutputSR;
  vcReferenceId: string;
  indexRate: number;
  vcIndexId: string;
  protect: number;
  pitchAlgorithm: PitchAlgorithm;
  vcEncoder: SpeechEncoder;
  dryWet: number;
}

interface VcConfigPanelProps {
  isRu: boolean;
  characterName: string;
  config: VcConfigValues;
  onUpdateVcConfig: (patch: Record<string, unknown>) => void;
  isProcessing: boolean;
  backendChoice: "auto" | VcBackend;
  activeBackend: VcBackend | null;
  onBackendChange: (val: string) => void;
  /** TTS + RVC F0 for pitch shift suggestion */
  ttsF0?: PitchFrame[];
  refF0?: PitchFrame[];
}

export function VcConfigPanel({
  isRu, characterName, config, onUpdateVcConfig, isProcessing,
  backendChoice, activeBackend, onBackendChange, ttsF0, refF0,
}: VcConfigPanelProps) {
  const navigate = useNavigate();
  const {
    vcEnabled, pitchShift, vcOutputSR, vcReferenceId, indexRate,
    vcIndexId, protect, pitchAlgorithm, vcEncoder, dryWet,
  } = config;

  // Pitch model download state
  const [pitchModelDownloading, setPitchModelDownloading] = useState(false);
  const [pitchDlProgress, setPitchDlProgress] = useState(0);

  // Available references & indexes
  const [localRefs, setLocalRefs] = useState<VcReferenceEntry[]>([]);
  const [localIndexes, setLocalIndexes] = useState<VcIndexEntry[]>([]);

  useEffect(() => {
    listVcReferences().then(setLocalRefs);
    listVcIndexes().then(setLocalIndexes);
  }, []);

  const handlePitchAlgorithmChange = useCallback(async (val: string) => {
    const algo = val as PitchAlgorithm;
    onUpdateVcConfig({ vc_pitch_algorithm: algo });
    const cached = await hasModel(algo);
    if (cached) return;
    const entry = VC_ALL_MODELS.find(m => m.id === algo);
    if (!entry) return;
    const confirmed = window.confirm(
      isRu
        ? `Модель "${entry.label}" (${(entry.sizeBytes / 1e6).toFixed(0)} MB) не загружена. Скачать?`
        : `Model "${entry.label}" (${(entry.sizeBytes / 1e6).toFixed(0)} MB) not cached. Download?`
    );
    if (!confirmed) { onUpdateVcConfig({ vc_pitch_algorithm: "crepe-tiny" }); return; }
    setPitchModelDownloading(true);
    setPitchDlProgress(0);
    try {
      const ok = await downloadModel(entry, (p) => setPitchDlProgress(Math.round(p.fraction * 100)));
      if (!ok) throw new Error("Download failed");
      toast.success(isRu ? `${entry.label} загружена` : `${entry.label} downloaded`);
    } catch (err: any) {
      toast.error(isRu ? `Ошибка загрузки: ${err.message}` : `Download error: ${err.message}`);
      onUpdateVcConfig({ vc_pitch_algorithm: "crepe-tiny" });
    } finally {
      setPitchModelDownloading(false);
    }
  }, [isRu, onUpdateVcConfig]);

  const handleEncoderChange = useCallback(async (val: string) => {
    const enc = val as SpeechEncoder;
    onUpdateVcConfig({ vc_encoder: enc });
    if (enc === "wavlm") {
      const cached = await hasModel("wavlm");
      if (!cached) {
        const entry = VC_ENCODER_MODELS.find(m => m.id === "wavlm");
        if (!entry) return;
        const confirmed = window.confirm(
          isRu
            ? `Модель "${entry.label}" (${(entry.sizeBytes / 1e6).toFixed(0)} MB) не загружена. Скачать?`
            : `Model "${entry.label}" (${(entry.sizeBytes / 1e6).toFixed(0)} MB) not cached. Download?`
        );
        if (!confirmed) { onUpdateVcConfig({ vc_encoder: "contentvec" }); return; }
        setPitchModelDownloading(true);
        setPitchDlProgress(0);
        try {
          const ok = await downloadModel(entry, (p) => setPitchDlProgress(Math.round(p.fraction * 100)));
          if (!ok) throw new Error("Download failed");
          toast.success(isRu ? `${entry.label} загружена` : `${entry.label} downloaded`);
        } catch (err: any) {
          toast.error(isRu ? `Ошибка загрузки: ${err.message}` : `Download error: ${err.message}`);
          onUpdateVcConfig({ vc_encoder: "contentvec" });
        } finally {
          setPitchModelDownloading(false);
        }
      }
    }
  }, [isRu, onUpdateVcConfig]);

  // Pitch shift suggestion from F0
  const pitchSuggestion = (() => {
    if (!ttsF0 || !refF0) return null;
    const ttsVoiced = ttsF0.filter(f => f.frequencyHz > 0);
    const refVoiced = refF0.filter(f => f.frequencyHz > 0);
    if (ttsVoiced.length <= 10 || refVoiced.length <= 10) return null;
    const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
    const medTts = median(ttsVoiced.map(f => f.frequencyHz));
    const medRef = median(refVoiced.map(f => f.frequencyHz));
    const suggestedSt = Math.round(12 * Math.log2(medRef / medTts));
    if (suggestedSt === 0) return null;
    return { suggestedSt, medTts, medRef };
  })();

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <Wand2 className="h-4 w-4 text-primary" />
        <span className="text-sm font-medium">
          {isRu ? "Voice Conversion для" : "Voice Conversion for"}{" "}
          <span className="text-primary">{characterName}</span>
        </span>
        <Badge variant="outline" className="text-[10px] border-primary/50 text-primary ml-auto">
          Booker Pro
        </Badge>
      </div>

      {/* Enable VC toggle */}
      <div className="flex items-center justify-between p-2.5 rounded-lg bg-muted/30 border border-border/50">
        <div>
          <p className="text-sm font-medium">{isRu ? "Применять Voice Conversion" : "Apply Voice Conversion"}</p>
          <p className="text-[10px] text-muted-foreground">
            TTS → {vcEncoder === "wavlm" ? "WavLM" : "ContentVec"} → {PITCH_ALGORITHM_LABELS[pitchAlgorithm]?.en?.split(" ")[0] ?? "CREPE"} → RVC v2
          </p>
        </div>
        <Switch checked={vcEnabled} onCheckedChange={v => onUpdateVcConfig({ vc_enabled: v })} />
      </div>

      {/* ── Row 1: Pitch Algorithm + Speech Encoder (2 cols) ── */}
      <div className="grid grid-cols-2 gap-3">
        {/* Pitch Algorithm */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {isRu ? "Алгоритм F0" : "Pitch (F0)"}
            </label>
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              {PITCH_ALGORITHM_LABELS[pitchAlgorithm]?.size ?? "~2 MB"}
            </Badge>
          </div>
          <Select value={pitchAlgorithm} onValueChange={handlePitchAlgorithmChange} disabled={isProcessing || pitchModelDownloading}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(PITCH_ALGORITHM_LABELS) as PitchAlgorithm[]).map(algo => (
                <SelectItem key={algo} value={algo}>
                  {isRu ? PITCH_ALGORITHM_LABELS[algo].ru : PITCH_ALGORITHM_LABELS[algo].en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Speech Encoder */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {isRu ? "Энкодер" : "Encoder"}
            </label>
            <Badge variant="outline" className="h-4 px-1 text-[9px]">
              {SPEECH_ENCODER_LABELS[vcEncoder]?.size ?? "~378 MB"}
            </Badge>
          </div>
          <Select value={vcEncoder} onValueChange={handleEncoderChange} disabled={isProcessing || pitchModelDownloading}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {(Object.keys(SPEECH_ENCODER_LABELS) as SpeechEncoder[]).map(enc => (
                <SelectItem key={enc} value={enc}>
                  {isRu ? SPEECH_ENCODER_LABELS[enc].ru : SPEECH_ENCODER_LABELS[enc].en}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Download progress (shared) */}
      {pitchModelDownloading && (
        <div className="space-y-1">
          <Progress value={pitchDlProgress} className="h-1.5" />
          <p className="text-[10px] text-muted-foreground text-center">
            <Download className="inline h-3 w-3 mr-1" />
            {isRu ? `Загрузка: ${pitchDlProgress}%` : `Downloading: ${pitchDlProgress}%`}
          </p>
        </div>
      )}

      <Separator />

      {/* ── Row 2: Reference Voice + Training Index (2 cols) ── */}
      <div className="grid grid-cols-2 gap-3">
        {/* Reference Voice */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {isRu ? "Референс" : "Reference"}
            </label>
            <Button variant="link" size="sm" className="h-auto p-0 text-[10px] gap-0.5" onClick={() => navigate("/voice-lab")}>
              <FlaskConical className="h-2.5 w-2.5" />Lab
            </Button>
          </div>
          <Select value={vcReferenceId || "__none__"} onValueChange={v => onUpdateVcConfig({ vc_reference_id: v === "__none__" ? "" : v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={isRu ? "Не выбран" : "None"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{isRu ? "— Нет —" : "— None —"}</SelectItem>
              {localRefs.map(r => (
                <SelectItem key={r.id} value={r.id}>{r.name} ({(r.durationMs / 1000).toFixed(1)}s)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Training Index */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {isRu ? "Индекс" : "Index"}
            </label>
            <Button variant="link" size="sm" className="h-auto p-0 text-[10px] gap-0.5" onClick={() => navigate("/voice-lab")}>
              <FlaskConical className="h-2.5 w-2.5" />Lab
            </Button>
          </div>
          <Select value={vcIndexId || "__none__"} onValueChange={v => onUpdateVcConfig({ vc_index_id: v === "__none__" ? "" : v })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue placeholder={isRu ? "Не выбран" : "None"} /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__">{isRu ? "— Нет —" : "— None —"}</SelectItem>
              {localIndexes.map(ix => (
                <SelectItem key={ix.id} value={ix.id}>{ix.name} ({ix.vectorCount.toLocaleString()}×{ix.dim}D)</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Separator />

      {/* ── Row 3: 4 sliders in a grid ── */}
      <div className="grid grid-cols-4 gap-2">
        {/* Pitch Shift */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-mono uppercase">
              {isRu ? "Тон" : "Pitch"}
            </span>
            <span className="text-[10px] text-foreground/70 font-mono tabular-nums">
              {pitchShift > 0 ? "+" : ""}{pitchShift}st
            </span>
          </div>
          <Slider compact min={-12} max={12} step={1} value={[pitchShift]} onValueChange={([v]) => onUpdateVcConfig({ vc_pitch_shift: v })} />
          <div className="flex justify-end">
            <button
              className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-30"
              onClick={() => onUpdateVcConfig({ vc_pitch_shift: 0 })}
              disabled={pitchShift === 0}
            >
              <RotateCcw className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {/* Feature Ratio */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-mono uppercase">
              {isRu ? "Индекс" : "Index"}
            </span>
            <span className="text-[10px] text-foreground/70 font-mono tabular-nums">
              {indexRate.toFixed(2)}
            </span>
          </div>
          <Slider compact min={0} max={1} step={0.05} value={[indexRate]} onValueChange={([v]) => onUpdateVcConfig({ vc_index_rate: v })} />
          <div className="flex justify-end">
            <button
              className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-30"
              onClick={() => onUpdateVcConfig({ vc_index_rate: 0.75 })}
              disabled={indexRate === 0.75}
            >
              <RotateCcw className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {/* Consonant Protection */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-mono uppercase">
              {isRu ? "Защита" : "Protect"}
            </span>
            <span className="text-[10px] text-foreground/70 font-mono tabular-nums">
              {protect.toFixed(2)}
            </span>
          </div>
          <Slider compact min={0} max={0.5} step={0.01} value={[protect]} onValueChange={([v]) => onUpdateVcConfig({ vc_protect: v })} />
          <div className="flex justify-end">
            <button
              className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-30"
              onClick={() => onUpdateVcConfig({ vc_protect: 0.33 })}
              disabled={protect === 0.33}
            >
              <RotateCcw className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>

        {/* Dry/Wet Mix */}
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground font-mono uppercase">
              {isRu ? "Микс" : "Mix"}
            </span>
            <span className="text-[10px] text-foreground/70 font-mono tabular-nums">
              {(dryWet * 100).toFixed(0)}%
            </span>
          </div>
          <Slider compact min={0} max={1} step={0.05} value={[dryWet]} onValueChange={([v]) => onUpdateVcConfig({ vc_dry_wet: v })} />
          <div className="flex justify-end">
            <button
              className="text-[9px] text-muted-foreground hover:text-foreground disabled:opacity-30"
              onClick={() => onUpdateVcConfig({ vc_dry_wet: 1.0 })}
              disabled={dryWet === 1.0}
            >
              <RotateCcw className="h-2.5 w-2.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Pitch suggestion (full width below sliders) */}
      {pitchSuggestion && (
        <button
          className="text-[10px] text-primary hover:underline cursor-pointer text-center w-full"
          onClick={() => onUpdateVcConfig({ vc_pitch_shift: Math.max(-12, Math.min(12, pitchSuggestion.suggestedSt)) })}
        >
          {isRu
            ? `💡 ${pitchSuggestion.suggestedSt > 0 ? "+" : ""}${pitchSuggestion.suggestedSt} пт (${Math.round(pitchSuggestion.medTts)}→${Math.round(pitchSuggestion.medRef)}Гц)`
            : `💡 ${pitchSuggestion.suggestedSt > 0 ? "+" : ""}${pitchSuggestion.suggestedSt} st (${Math.round(pitchSuggestion.medTts)}→${Math.round(pitchSuggestion.medRef)}Hz)`}
        </button>
      )}

      <Separator />

      {/* ── Row 4: Backend + Sample Rate (2 cols) ── */}
      <div className="grid grid-cols-2 gap-3">
        {/* Compute Backend */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {isRu ? "Бэкенд" : "Backend"}
            </label>
            {activeBackend && (
              <Badge variant="outline" className={`h-4 px-1 text-[9px] ${activeBackend === "webgpu" ? "border-primary/50 text-primary" : "border-muted-foreground/50 text-muted-foreground"}`}>
                {activeBackend === "webgpu" ? "GPU" : "CPU"}
              </Badge>
            )}
          </div>
          <Select value={backendChoice} onValueChange={onBackendChange} disabled={isProcessing}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">
                <span className="flex items-center gap-1"><Monitor className="h-3 w-3" />{isRu ? "Авто" : "Auto"}</span>
              </SelectItem>
              <SelectItem value="webgpu">
                <span className="flex items-center gap-1"><Monitor className="h-3 w-3" />GPU</span>
              </SelectItem>
              <SelectItem value="wasm">
                <span className="flex items-center gap-1"><Cpu className="h-3 w-3" />CPU</span>
              </SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Output Sample Rate */}
        <div className="space-y-1.5">
          <div className="flex justify-between items-center">
            <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
              {isRu ? "SR модели" : "Model SR"}
            </label>
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {vcOutputSR === 44_100 ? "44.1" : (vcOutputSR / 1000).toFixed(0)} kHz
            </span>
          </div>
          <Select value={String(vcOutputSR)} onValueChange={v => onUpdateVcConfig({ vc_output_sr: Number(v) })}>
            <SelectTrigger className="h-7 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {RVC_OUTPUT_SR_OPTIONS.map(sr => (
                <SelectItem key={sr} value={String(sr)}>
                  {sr === 44_100 ? "44.1" : (sr / 1000).toFixed(0)} kHz{sr === RVC_OUTPUT_SR_DEFAULT ? " ★" : ""}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  );
}
