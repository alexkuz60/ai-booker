/**
 * VoiceConversionTab — Simplified VC settings tab for Narrators page.
 * Voice selection (references/indexes) + synthesis params + test pipeline.
 * Full management (upload, models) lives on the Voice Lab page.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getModelStatus, VC_MODEL_REGISTRY } from "@/lib/vcModelCache";
import { listVcReferences, type VcReferenceEntry } from "@/lib/vcReferenceCache";
import { listVcIndexes, loadVcIndex, type VcIndexEntry } from "@/lib/vcIndexSearch";
import {
  Zap, Play, Square, Loader2, RotateCcw, AlertTriangle,
  CheckCircle2, Wand2, ArrowRight, FlaskConical, Cpu, Monitor,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBookerPro } from "@/hooks/useBookerPro";
import { convertVoiceFull, type VcPipelineOptions } from "@/lib/vcPipeline";
import { RVC_OUTPUT_SR_OPTIONS, RVC_OUTPUT_SR_DEFAULT, type RvcOutputSR } from "@/lib/vcSynthesis";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  type VcBackend, setForcedBackend, getForcedBackend,
  releaseAllVcSessions, getAvailableBackend,
} from "@/lib/vcInferenceSession";

interface VoiceConversionTabProps {
  isRu: boolean;
  characterName: string;
  characterId: string;
  voiceConfig: Record<string, unknown>;
  onUpdateVcConfig: (patch: Record<string, unknown>) => void;
  ttsProvider: string;
  buildTtsRequest: () => { url: string; body: Record<string, unknown> } | null;
}

type VcStage = "idle" | "tts" | "resample" | "contentvec" | "crepe" | "synthesis" | "done" | "error";

const STAGE_LABELS: Record<VcStage, { ru: string; en: string }> = {
  idle: { ru: "Ожидание", en: "Idle" },
  tts: { ru: "Генерация TTS...", en: "Generating TTS..." },
  resample: { ru: "Ресемплинг 16kHz...", en: "Resampling 16kHz..." },
  contentvec: { ru: "ContentVec эмбеддинги...", en: "ContentVec embeddings..." },
  crepe: { ru: "CREPE F0 pitch...", en: "CREPE F0 pitch..." },
  synthesis: { ru: "RVC v2 синтез...", en: "RVC v2 synthesis..." },
  done: { ru: "Готово", en: "Done" },
  error: { ru: "Ошибка", en: "Error" },
};

export function VoiceConversionTab({
  isRu, characterName, characterId, voiceConfig,
  onUpdateVcConfig, ttsProvider, buildTtsRequest,
}: VoiceConversionTabProps) {
  const pro = useBookerPro();
  const navigate = useNavigate();

  // Per-character VC settings from voice_config
  const vcEnabled = (voiceConfig.vc_enabled as boolean) ?? false;
  const pitchShift = (voiceConfig.vc_pitch_shift as number) ?? 0;
  const vcOutputSR = (voiceConfig.vc_output_sr as RvcOutputSR) || RVC_OUTPUT_SR_DEFAULT;
  const vcReferenceId = (voiceConfig.vc_reference_id as string) || "";
  const indexRate = (voiceConfig.vc_index_rate as number) ?? 0.75;
  const vcIndexId = (voiceConfig.vc_index_id as string) || "";
  const protect = (voiceConfig.vc_protect as number) ?? 0.33;

  // Test pipeline state
  const [stage, setStage] = useState<VcStage>("idle");
  const [stageProgress, setStageProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);
  const [timingInfo, setTimingInfo] = useState("");
  const [errorMsg, setErrorMsg] = useState("");

  // Available references & indexes (read-only lists from OPFS)
  const [localRefs, setLocalRefs] = useState<VcReferenceEntry[]>([]);
  const [localIndexes, setLocalIndexes] = useState<VcIndexEntry[]>([]);

  const isProcessing = stage !== "idle" && stage !== "done" && stage !== "error";

  // Load available refs & indexes
  useEffect(() => {
    listVcReferences().then(setLocalRefs);
    listVcIndexes().then(setLocalIndexes);
  }, []);

  const handleStop = useCallback(() => {
    if (audioRef) { audioRef.pause(); audioRef.currentTime = 0; }
    setPlaying(false);
  }, [audioRef]);

  const handleTestVc = useCallback(async () => {
    if (playing) { handleStop(); return; }
    setStage("tts");
    setStageProgress(0);
    setTimingInfo("");
    setErrorMsg("");
    try {
      const status = await getModelStatus();
      const missing = VC_MODEL_REGISTRY.filter(m => !status[m.id]);
      if (missing.length > 0) {
        setErrorMsg(isRu
          ? `Модели не загружены: ${missing.map(m => m.label).join(", ")}.`
          : `Models not cached: ${missing.map(m => m.label).join(", ")}.`);
        setStage("error"); return;
      }
      const req = buildTtsRequest();
      if (!req) { setErrorMsg(isRu ? "Не удалось построить TTS-запрос" : "Failed to build TTS request"); setStage("error"); return; }
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { setErrorMsg(isRu ? "Необходимо авторизоваться" : "Please sign in"); setStage("error"); return; }
      const ttsResp = await fetch(req.url, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify(req.body),
      });
      if (!ttsResp.ok) { const txt = await ttsResp.text().catch(() => ""); throw new Error(`TTS: ${ttsResp.status} ${txt.slice(0, 100)}`); }
      const ttsBlob = await ttsResp.blob();
      setStageProgress(100);

      // Load index data if configured
      let indexData: { data: Float32Array; rows: number; cols: number } | undefined;
      if (vcIndexId && indexRate > 0) {
        const loaded = await loadVcIndex(vcIndexId);
        if (loaded) {
          indexData = loaded;
          console.info(`[VcTest] Index loaded: ${loaded.rows} vectors × ${loaded.cols}D`);
        }
      }

      const pipelineOpts: VcPipelineOptions = {
        onProgress: (s, p) => { setStage(s); setStageProgress(Math.round(p * 100)); },
        synthesis: { pitchShift, outputSampleRate: vcOutputSR, indexRate, protect, indexData },
      };
      const result = await convertVoiceFull(ttsBlob, pipelineOpts);
      const t = result.features.timing;
      const rs = result.resample;
      const srIn = rs.inputSR >= 1000 ? `${(rs.inputSR / 1000).toFixed(rs.inputSR % 1000 === 0 ? 0 : 1)}k` : `${rs.inputSR}`;
      const srOut = rs.outputSR >= 1000 ? `${(rs.outputSR / 1000).toFixed(rs.outputSR % 1000 === 0 ? 0 : 1)}k` : `${rs.outputSR}`;
      const srLabel = result.synthesis.sampleRate === 44_100 ? "44.1" : `${(result.synthesis.sampleRate/1000).toFixed(0)}`;
      const srNote = result.synthesis.srAutoDetected ? " (auto)" : "";
      setTimingInfo(
        `${result.features.durationSec.toFixed(1)}s → CV ${t.contentvecMs}ms, CREPE ${t.crepeMs}ms, RVC ${result.synthesis.inferenceMs}ms, total ${result.totalMs}ms @ ${srLabel}kHz${srNote}\n` +
        `Resample: ${rs.inputSamples.toLocaleString()} @ ${srIn}Hz → ${rs.outputSamples.toLocaleString()} @ ${srOut}Hz (${rs.durationSec.toFixed(2)}s, ${rs.resampleMs}ms)`
      );
      setStage("done");
      const url = URL.createObjectURL(result.wav);
      const audio = new Audio(url);
      audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
      setAudioRef(audio);
      setPlaying(true);
      await audio.play();
    } catch (err: any) {
      console.error("[VoiceConversionTab] Test error:", err);
      setErrorMsg(err.message || String(err));
      setStage("error");
    }
  }, [playing, handleStop, buildTtsRequest, isRu, pitchShift, vcOutputSR, indexRate, protect, vcIndexId]);

  // ─── Not activated ───
  if (!pro.enabled || !pro.modelsReady) {
    return (
      <div className="space-y-4 mt-4">
        <Alert className="border-primary/30 bg-primary/5">
          <Zap className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm">
            {isRu
              ? "Voice Conversion требует активации Booker Pro в Профиле. Необходимы WebGPU и загруженные ONNX модели (~491 MB)."
              : "Voice Conversion requires Booker Pro activation in Profile. WebGPU and downloaded ONNX models (~491 MB) are needed."}
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="gap-2" onClick={() => navigate("/profile")}>
          <ArrowRight className="h-4 w-4" />
          {isRu ? "Перейти в Профиль → Booker Pro" : "Go to Profile → Booker Pro"}
        </Button>
      </div>
    );
  }

  const selectedRef = localRefs.find(r => r.id === vcReferenceId);
  const selectedIndex = localIndexes.find(ix => ix.id === vcIndexId);

  return (
    <div className="space-y-5 mt-4">
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
            {isRu ? "TTS → ContentVec → CREPE → RVC v2 → уникальный тембр" : "TTS → ContentVec → CREPE → RVC v2 → unique timbre"}
          </p>
        </div>
        <Switch checked={vcEnabled} onCheckedChange={v => onUpdateVcConfig({ vc_enabled: v })} />
      </div>

      <Separator />

      {/* ─── Reference Voice Select ─── */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Референсный голос" : "Reference Voice"}
          </label>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs gap-1" onClick={() => navigate("/voice-lab")}>
            <FlaskConical className="h-3 w-3" />
            {isRu ? "Voice Lab" : "Voice Lab"}
          </Button>
        </div>
        <Select value={vcReferenceId || "__none__"} onValueChange={v => onUpdateVcConfig({ vc_reference_id: v === "__none__" ? "" : v })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={isRu ? "Не выбран" : "Not selected"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{isRu ? "— Без референса —" : "— No reference —"}</SelectItem>
            {localRefs.map(r => (
              <SelectItem key={r.id} value={r.id}>
                {r.name} ({(r.durationMs / 1000).toFixed(1)}s)
              </SelectItem>
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

      {/* ─── Training Index Select ─── */}
      <div className="space-y-2">
        <div className="flex justify-between items-center">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Индекс обучения" : "Training Index"}
          </label>
          <Button variant="link" size="sm" className="h-auto p-0 text-xs gap-1" onClick={() => navigate("/voice-lab")}>
            <FlaskConical className="h-3 w-3" />
            {isRu ? "Voice Lab" : "Voice Lab"}
          </Button>
        </div>
        <Select value={vcIndexId || "__none__"} onValueChange={v => onUpdateVcConfig({ vc_index_id: v === "__none__" ? "" : v })}>
          <SelectTrigger className="h-8 text-xs">
            <SelectValue placeholder={isRu ? "Не выбран" : "Not selected"} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">{isRu ? "— Без индекса —" : "— No index —"}</SelectItem>
            {localIndexes.map(ix => (
              <SelectItem key={ix.id} value={ix.id}>
                {ix.name} ({ix.vectorCount.toLocaleString()} × {ix.dim}D)
              </SelectItem>
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
          {isRu ? "0 = без защиты | 0.5 = макс. сохранение шипящих/взрывных" : "0 = no protection | 0.5 = max sibilant preservation"}
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
          <SelectTrigger className="h-8 text-xs">
            <SelectValue />
          </SelectTrigger>
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

      {/* Test Pipeline */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {isRu ? "Тест пайплайна" : "Pipeline Test"}
        </p>
        <Button onClick={handleTestVc} disabled={isProcessing} variant={playing ? "destructive" : "outline"} className="w-full gap-2">
          {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : playing ? <Square className="h-4 w-4" /> : <Play className="h-4 w-4" />}
          {isProcessing ? (isRu ? STAGE_LABELS[stage].ru : STAGE_LABELS[stage].en) : playing ? (isRu ? "Стоп" : "Stop") : (isRu ? `Тест: ${ttsProvider} → VC` : `Test: ${ttsProvider} → VC`)}
        </Button>
        {isProcessing && (
          <div className="space-y-1">
            <Progress value={stageProgress} className="h-1.5" />
            <p className="text-xs text-muted-foreground text-center">{isRu ? STAGE_LABELS[stage].ru : STAGE_LABELS[stage].en}</p>
          </div>
        )}
        {stage === "done" && timingInfo && (
          <div className="flex items-start gap-2 text-xs text-primary">
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="font-mono text-xs whitespace-pre-line">{timingInfo}</span>
          </div>
        )}
        {stage === "error" && errorMsg && (
          <div className="flex items-start gap-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
            <span className="break-all">{errorMsg}</span>
          </div>
        )}
      </div>
    </div>
  );
}
