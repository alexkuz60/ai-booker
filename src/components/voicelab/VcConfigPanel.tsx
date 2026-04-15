/**
 * VcConfigPanel — VC parameter controls (pitch algo, encoder, reference, index,
 * pitch shift, feature ratio, consonant protection, dry/wet, output SR, backend).
 * Extracted from VoiceConversionTab for maintainability.
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

  return (
    <div className="space-y-5">
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
      <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
        <div>
          <p className="text-sm font-medium">{isRu ? "Применять Voice Conversion" : "Apply Voice Conversion"}</p>
          <p className="text-xs text-muted-foreground">
            {isRu
              ? `TTS → ${vcEncoder === "wavlm" ? "WavLM" : "ContentVec"} → ${PITCH_ALGORITHM_LABELS[pitchAlgorithm]?.en?.split(" ")[0] ?? "CREPE"} → RVC v2 → уникальный тембр`
              : `TTS → ${vcEncoder === "wavlm" ? "WavLM" : "ContentVec"} → ${PITCH_ALGORITHM_LABELS[pitchAlgorithm]?.en?.split(" ")[0] ?? "CREPE"} → RVC v2 → unique timbre`}
          </p>
        </div>
        <Switch checked={vcEnabled} onCheckedChange={v => onUpdateVcConfig({ vc_enabled: v })} />
      </div>

      {/* Pitch Algorithm */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Алгоритм питча (F0)" : "Pitch Algorithm (F0)"}
          </label>
          <Badge variant="outline" className="text-[10px]">
            {PITCH_ALGORITHM_LABELS[pitchAlgorithm]?.size ?? "~2 MB"}
          </Badge>
        </div>
        <Select value={pitchAlgorithm} onValueChange={handlePitchAlgorithmChange} disabled={isProcessing || pitchModelDownloading}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(PITCH_ALGORITHM_LABELS) as PitchAlgorithm[]).map(algo => (
              <SelectItem key={algo} value={algo}>
                {isRu ? PITCH_ALGORITHM_LABELS[algo].ru : PITCH_ALGORITHM_LABELS[algo].en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {pitchModelDownloading && (
          <div className="space-y-1">
            <Progress value={pitchDlProgress} className="h-1.5" />
            <p className="text-xs text-muted-foreground text-center">
              <Download className="inline h-3 w-3 mr-1" />
              {isRu ? `Загрузка модели: ${pitchDlProgress}%` : `Downloading model: ${pitchDlProgress}%`}
            </p>
          </div>
        )}
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? "SwiftF0 = молния | Tiny = быстро | Full = чище | RMVPE = золотой стандарт"
            : "SwiftF0 = lightning | Tiny = fast | Full = cleaner | RMVPE = gold standard"}
        </p>
      </div>

      {/* Speech Encoder */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Энкодер речи" : "Speech Encoder"}
          </label>
          <Badge variant="outline" className="text-[10px]">
            {SPEECH_ENCODER_LABELS[vcEncoder]?.size ?? "~378 MB"}
          </Badge>
        </div>
        <Select value={vcEncoder} onValueChange={handleEncoderChange} disabled={isProcessing || pitchModelDownloading}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {(Object.keys(SPEECH_ENCODER_LABELS) as SpeechEncoder[]).map(enc => (
              <SelectItem key={enc} value={enc}>
                {isRu ? SPEECH_ENCODER_LABELS[enc].ru : SPEECH_ENCODER_LABELS[enc].en}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu ? SPEECH_ENCODER_LABELS[vcEncoder]?.description.ru : SPEECH_ENCODER_LABELS[vcEncoder]?.description.en}
        </p>
      </div>

      <Separator />

      {/* Reference Voice */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Референсный голос" : "Reference Voice"}
          </label>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs gap-1" onClick={() => navigate("/voice-lab")}>
            <FlaskConical className="h-3 w-3" />Voice Lab
          </Button>
        </div>
        <Select value={vcReferenceId || "__none__"} onValueChange={v => onUpdateVcConfig({ vc_reference_id: v === "__none__" ? "" : v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={isRu ? "Не выбран" : "Not selected"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{isRu ? "— Без референса —" : "— No reference —"}</SelectItem>
            {localRefs.map(r => (
              <SelectItem key={r.id} value={r.id}>{r.name} ({(r.durationMs / 1000).toFixed(1)}s)</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {localRefs.length === 0 && (
          <p className="text-xs text-muted-foreground italic">
            {isRu ? "Нет референсов. Загрузите в " : "No references. Upload in "}
            <button className="text-primary underline" onClick={() => navigate("/voice-lab")}>Voice Lab</button>.
          </p>
        )}
      </div>

      <Separator />

      {/* Training Index */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Индекс обучения" : "Training Index"}
          </label>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs gap-1" onClick={() => navigate("/voice-lab")}>
            <FlaskConical className="h-3 w-3" />Voice Lab
          </Button>
        </div>
        <Select value={vcIndexId || "__none__"} onValueChange={v => onUpdateVcConfig({ vc_index_id: v === "__none__" ? "" : v })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue placeholder={isRu ? "Не выбран" : "Not selected"} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{isRu ? "— Без индекса —" : "— No index —"}</SelectItem>
            {localIndexes.map(ix => (
              <SelectItem key={ix.id} value={ix.id}>{ix.name} ({ix.vectorCount.toLocaleString()} × {ix.dim}D)</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Pitch shift */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Сдвиг тона" : "Pitch Shift"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {pitchShift > 0 ? "+" : ""}{pitchShift} {isRu ? "полутонов" : "semitones"}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Slider min={-12} max={12} step={1} value={[pitchShift]} onValueChange={([v]) => onUpdateVcConfig({ vc_pitch_shift: v })} className="flex-1" />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_pitch_shift: 0 })} disabled={pitchShift === 0}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        {ttsF0 && refF0 && (() => {
          const ttsVoiced = ttsF0.filter(f => f.frequencyHz > 0);
          const refVoiced = refF0.filter(f => f.frequencyHz > 0);
          if (ttsVoiced.length > 10 && refVoiced.length > 10) {
            const median = (arr: number[]) => { const s = [...arr].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
            const medTts = median(ttsVoiced.map(f => f.frequencyHz));
            const medRef = median(refVoiced.map(f => f.frequencyHz));
            const suggestedSt = Math.round(12 * Math.log2(medRef / medTts));
            if (suggestedSt !== 0) {
              return (
                <button
                  className="text-xs text-primary hover:underline cursor-pointer text-center w-full"
                  onClick={() => onUpdateVcConfig({ vc_pitch_shift: Math.max(-12, Math.min(12, suggestedSt)) })}
                >
                  {isRu
                    ? `💡 Рекомендация: ${suggestedSt > 0 ? "+" : ""}${suggestedSt} пт (вход ${Math.round(medTts)}Гц → реф ${Math.round(medRef)}Гц) — нажми для применения`
                    : `💡 Suggested: ${suggestedSt > 0 ? "+" : ""}${suggestedSt} st (input ${Math.round(medTts)}Hz → ref ${Math.round(medRef)}Hz) — click to apply`}
                </button>
              );
            }
          }
          return null;
        })()}
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu ? "♀→♂: −4…−6 | ♂→♀: +4…+6 | Тонкая коррекция: ±1…2" : "♀→♂: −4…−6 | ♂→♀: +4…+6 | Fine-tune: ±1…2"}
        </p>
      </div>

      <Separator />

      {/* Feature Ratio */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Feature Ratio</label>
          <span className="text-xs text-muted-foreground tabular-nums">{indexRate.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider min={0} max={1} step={0.05} value={[indexRate]} onValueChange={([v]) => onUpdateVcConfig({ vc_index_rate: v })} className="flex-1" />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_index_rate: 0.75 })} disabled={indexRate === 0.75}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu ? "0 = чистая артикуляция | 1 = макс. сходство с целевым голосом" : "0 = pure articulation | 1 = max target similarity"}
        </p>
      </div>

      <Separator />

      {/* Consonant Protection */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Защита согласных" : "Consonant Protection"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">{protect.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <Slider min={0} max={0.5} step={0.01} value={[protect]} onValueChange={([v]) => onUpdateVcConfig({ vc_protect: v })} className="flex-1" />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_protect: 0.33 })} disabled={protect === 0.33}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? "Работает только с индексом: меньше = сильнее возврат к исходной артикуляции на глухих участках"
            : "Works only with an index: lower = stronger fallback to source articulation on unvoiced frames"}
        </p>
      </div>

      <Separator />

      {/* Dry/Wet Mix */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Микс TTS / RVC" : "TTS / RVC Mix"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {dryWet >= 0.999 ? "100% RVC" : dryWet <= 0.001 ? "100% TTS" : `${((1 - dryWet) * 100).toFixed(0)}% TTS / ${(dryWet * 100).toFixed(0)}% RVC`}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-muted-foreground shrink-0">TTS</span>
          <Slider min={0} max={1} step={0.05} value={[dryWet]} onValueChange={([v]) => onUpdateVcConfig({ vc_dry_wet: v })} className="flex-1" />
          <span className="text-[10px] text-muted-foreground shrink-0">RVC</span>
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_dry_wet: 1.0 })} disabled={dryWet === 1.0}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu ? "Смешивание оригинального TTS с конвертированным голосом для сохранения просодии" : "Blend original TTS with converted voice to preserve prosody"}
        </p>
      </div>

      <Separator />

      {/* Output Sample Rate */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Sample Rate модели RVC" : "RVC Model Sample Rate"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">{vcOutputSR === 44_100 ? "44.1" : (vcOutputSR / 1000).toFixed(0)} kHz</span>
        </div>
        <Select value={String(vcOutputSR)} onValueChange={v => onUpdateVcConfig({ vc_output_sr: Number(v) })}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            {RVC_OUTPUT_SR_OPTIONS.map(sr => (
              <SelectItem key={sr} value={String(sr)}>
                {sr === 44_100 ? "44.1" : (sr / 1000).toFixed(0)} kHz {sr === RVC_OUTPUT_SR_DEFAULT ? (isRu ? "(по умолчанию)" : "(default)") : ""}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Separator />

      {/* Compute Backend */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Вычислительный бэкенд" : "Compute Backend"}
          </label>
          {activeBackend && (
            <Badge variant="outline" className={`text-[10px] ${activeBackend === "webgpu" ? "border-primary/50 text-primary" : "border-muted-foreground/50 text-muted-foreground"}`}>
              {activeBackend === "webgpu" ? "GPU" : "CPU"}
            </Badge>
          )}
        </div>
        <Select value={backendChoice} onValueChange={onBackendChange} disabled={isProcessing}>
          <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">
              <span className="flex items-center gap-1.5">
                <Monitor className="h-3 w-3" />{isRu ? "Авто (GPU → CPU)" : "Auto (GPU → CPU)"}
              </span>
            </SelectItem>
            <SelectItem value="webgpu">
              <span className="flex items-center gap-1.5">
                <Monitor className="h-3 w-3" />{isRu ? "GPU (WebGPU)" : "GPU (WebGPU)"}
              </span>
            </SelectItem>
            <SelectItem value="wasm">
              <span className="flex items-center gap-1.5">
                <Cpu className="h-3 w-3" />{isRu ? "CPU (WASM) — без ошибок WebGPU" : "CPU (WASM) — no WebGPU errors"}
              </span>
            </SelectItem>
          </SelectContent>
        </Select>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? "WASM = стабильно, но медленнее в ~3-5× | GPU = быстро, но возможны ошибки валидации"
            : "WASM = stable but ~3-5× slower | GPU = fast but may have validation errors"}
        </p>
      </div>
    </div>
  );
}
