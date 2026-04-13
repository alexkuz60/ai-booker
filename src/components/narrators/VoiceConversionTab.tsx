/**
 * VoiceConversionTab — Booker Pro Voice Conversion settings tab for Narrators page.
 * Per-character VC enable/disable, pitch shift, reference voice selection,
 * upload custom voice, browse collection, test pipeline.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { getModelStatus, VC_MODEL_REGISTRY } from "@/lib/vcModelCache";
import {
  listVcReferences, saveVcReference, deleteVcReference, hasVcReference,
  type VcReferenceEntry,
} from "@/lib/vcReferenceCache";
import {
  listVcIndexes, saveVcIndex, deleteVcIndex, loadVcIndex, parseNpy,
  type VcIndexEntry,
} from "@/lib/vcIndexSearch";
import {
  Zap, Play, Square, Loader2, RotateCcw, AlertTriangle,
  CheckCircle2, Wand2, ArrowRight, Upload, Music, Trash2,
  Download, Library, Database,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useBookerPro } from "@/hooks/useBookerPro";
import { convertVoiceFull, type VcPipelineOptions } from "@/lib/vcPipeline";
import { RVC_OUTPUT_SR_OPTIONS, RVC_OUTPUT_SR_DEFAULT, vcAudioToWav, type RvcOutputSR } from "@/lib/vcSynthesis";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Per-character VC settings from voice_config
  const vcEnabled = (voiceConfig.vc_enabled as boolean) ?? false;
  const pitchShift = (voiceConfig.vc_pitch_shift as number) ?? 0;
  const vcOutputSR = (voiceConfig.vc_output_sr as RvcOutputSR) || RVC_OUTPUT_SR_DEFAULT;
  const vcReferenceId = (voiceConfig.vc_reference_id as string) || "";
  const indexRate = (voiceConfig.vc_index_rate as number) ?? 0.75;
  const protect = (voiceConfig.vc_protect as number) ?? 0.33;

  // Test pipeline state
  const [stage, setStage] = useState<VcStage>("idle");
  const [stageProgress, setStageProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);
  const [timingInfo, setTimingInfo] = useState<string>("");
  const [errorMsg, setErrorMsg] = useState("");

  // Reference voice state
  const [localRefs, setLocalRefs] = useState<VcReferenceEntry[]>([]);
  const [collectionRefs, setCollectionRefs] = useState<{ id: string; name: string; category: string; durationMs: number }[]>([]);
  const [showCollection, setShowCollection] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const isProcessing = stage !== "idle" && stage !== "done" && stage !== "error";

  // Load local references on mount
  useEffect(() => {
    listVcReferences().then(setLocalRefs);
  }, []);

  // Load collection from voice_references table
  const loadCollection = useCallback(async () => {
    const { data } = await supabase
      .from("voice_references")
      .select("id, name, category, duration_ms")
      .eq("is_public", true)
      .order("name");
    if (data) {
      setCollectionRefs(data.map(r => ({
        id: r.id, name: r.name, category: r.category, durationMs: r.duration_ms,
      })));
    }
  }, []);

  // Handle file upload
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      // Decode to get audio info
      const arrayBuf = await file.arrayBuffer();
      const audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
      audioCtx.close();

      const id = crypto.randomUUID();
      const name = file.name.replace(/\.[^.]+$/, "");
      // Convert to mono WAV for consistency
      const monoSamples = decoded.getChannelData(0);
      const wavBlob = vcAudioToWav(monoSamples, decoded.sampleRate);

      const entry: VcReferenceEntry = {
        id,
        name,
        source: "upload",
        durationMs: Math.round(decoded.duration * 1000),
        sampleRate: decoded.sampleRate,
        sizeBytes: wavBlob.size,
        addedAt: new Date().toISOString(),
      };

      await saveVcReference(id, wavBlob, entry);
      setLocalRefs(await listVcReferences());
      onUpdateVcConfig({ vc_reference_id: id });
      toast.success(isRu ? `Референс "${name}" загружен` : `Reference "${name}" uploaded`);
    } catch (err: any) {
      toast.error(err.message || (isRu ? "Ошибка загрузки" : "Upload error"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [isRu, onUpdateVcConfig]);

  // Download from collection
  const handleDownloadFromCollection = useCallback(async (refId: string, refName: string) => {
    setDownloadingId(refId);
    try {
      // Check if already cached
      if (await hasVcReference(refId)) {
        onUpdateVcConfig({ vc_reference_id: refId });
        toast.info(isRu ? "Уже в кэше" : "Already cached");
        setDownloadingId(null);
        return;
      }

      // Get signed URL
      const { data: refRow } = await supabase
        .from("voice_references")
        .select("file_path, duration_ms, sample_rate")
        .eq("id", refId)
        .single();

      if (!refRow) throw new Error("Reference not found");

      const { data: signedData } = await supabase.storage
        .from("voice-references")
        .createSignedUrl(refRow.file_path, 300);

      if (!signedData?.signedUrl) throw new Error("Failed to get signed URL");

      const resp = await fetch(signedData.signedUrl);
      if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);
      const blob = await resp.blob();

      const entry: VcReferenceEntry = {
        id: refId,
        name: refName,
        source: "collection",
        sourceId: refId,
        durationMs: refRow.duration_ms,
        sampleRate: refRow.sample_rate,
        sizeBytes: blob.size,
        addedAt: new Date().toISOString(),
      };

      await saveVcReference(refId, blob, entry);
      setLocalRefs(await listVcReferences());
      onUpdateVcConfig({ vc_reference_id: refId });
      toast.success(isRu ? `"${refName}" скачан` : `"${refName}" downloaded`);
    } catch (err: any) {
      toast.error(err.message || (isRu ? "Ошибка скачивания" : "Download error"));
    } finally {
      setDownloadingId(null);
    }
  }, [isRu, onUpdateVcConfig]);

  // Delete local reference
  const handleDeleteRef = useCallback(async (id: string) => {
    await deleteVcReference(id);
    setLocalRefs(await listVcReferences());
    if (vcReferenceId === id) onUpdateVcConfig({ vc_reference_id: "" });
  }, [vcReferenceId, onUpdateVcConfig]);

  // Preview reference audio
  const handlePreviewRef = useCallback(async (id: string) => {
    if (playing && audioRef) { audioRef.pause(); setPlaying(false); return; }
    try {
      const { readVcReferenceBlob } = await import("@/lib/vcReferenceCache");
      const blob = await readVcReferenceBlob(id);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { setPlaying(false); URL.revokeObjectURL(url); };
      setAudioRef(audio);
      setPlaying(true);
      await audio.play();
    } catch { /* ignore */ }
  }, [playing, audioRef]);

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
      const pipelineOpts: VcPipelineOptions = {
        onProgress: (s, p) => { setStage(s); setStageProgress(Math.round(p * 100)); },
        synthesis: { pitchShift, outputSampleRate: vcOutputSR, indexRate, protect },
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
  }, [playing, handleStop, buildTtsRequest, isRu, pitchShift, vcOutputSR, indexRate, protect]);

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

      {/* ─── Reference Voice ─── */}
      <div className="space-y-3">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
          {isRu ? "Референсный голос" : "Reference Voice"}
        </p>

        {/* Current selection */}
        {selectedRef ? (
          <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/20">
            <Music className="h-4 w-4 text-primary shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{selectedRef.name}</p>
              <p className="text-[10px] text-muted-foreground">
                {(selectedRef.durationMs / 1000).toFixed(1)}s • {selectedRef.source === "collection" ? (isRu ? "Коллекция" : "Collection") : (isRu ? "Загружен" : "Uploaded")}
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" onClick={() => handlePreviewRef(selectedRef.id)}>
              <Play className="h-3 w-3" />
            </Button>
            <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-destructive" onClick={() => onUpdateVcConfig({ vc_reference_id: "" })}>
              <RotateCcw className="h-3 w-3" />
            </Button>
          </div>
        ) : (
          <p className="text-xs text-muted-foreground italic">
            {isRu ? "Референс не выбран. Загрузите аудио или выберите из коллекции." : "No reference selected. Upload audio or pick from collection."}
          </p>
        )}

        {/* Upload + Collection buttons */}
        <div className="flex gap-2">
          <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={handleFileUpload} />
          <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
            {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
            {isRu ? "Загрузить файл" : "Upload file"}
          </Button>
          <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => { setShowCollection(!showCollection); if (!showCollection) loadCollection(); }}>
            <Library className="h-3.5 w-3.5" />
            {isRu ? "Коллекция" : "Collection"}
          </Button>
        </div>

        {/* Collection browser */}
        {showCollection && (
          <div className="rounded-md border border-border bg-muted/20 overflow-hidden">
            <ScrollArea className="max-h-40">
              {collectionRefs.length === 0 ? (
                <p className="p-3 text-xs text-muted-foreground text-center">
                  {isRu ? "Коллекция пуста" : "Collection is empty"}
                </p>
              ) : (
                <div className="divide-y divide-border/50">
                  {collectionRefs.map(r => {
                    const isCached = localRefs.some(lr => lr.id === r.id);
                    return (
                      <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-xs hover:bg-muted/40">
                        <Music className="h-3 w-3 text-muted-foreground shrink-0" />
                        <span className="flex-1 truncate">{r.name}</span>
                        <Badge variant="outline" className="text-[9px] px-1 py-0">{r.category}</Badge>
                        <span className="text-muted-foreground tabular-nums">{(r.durationMs / 1000).toFixed(1)}s</span>
                        {isCached ? (
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0 text-primary" onClick={() => onUpdateVcConfig({ vc_reference_id: r.id })}>
                            <CheckCircle2 className="h-3 w-3" />
                          </Button>
                        ) : (
                          <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => handleDownloadFromCollection(r.id, r.name)} disabled={downloadingId === r.id}>
                            {downloadingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                          </Button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </ScrollArea>
          </div>
        )}

        {/* Local references list */}
        {localRefs.length > 0 && (
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">
              {isRu ? "Локальный пул:" : "Local pool:"}
            </p>
            {localRefs.map(r => (
              <div
                key={r.id}
                className={`flex items-center gap-2 px-2 py-1 rounded text-xs cursor-pointer transition-colors ${
                  r.id === vcReferenceId ? "bg-primary/10 border border-primary/30" : "bg-muted/20 hover:bg-muted/40"
                }`}
                onClick={() => onUpdateVcConfig({ vc_reference_id: r.id })}
              >
                <Music className="h-3 w-3 text-muted-foreground shrink-0" />
                <span className="flex-1 truncate font-mono">{r.name}</span>
                <span className="text-muted-foreground tabular-nums">{(r.durationMs / 1000).toFixed(1)}s</span>
                <span className="text-muted-foreground">{(r.sizeBytes / 1024).toFixed(0)}KB</span>
                <Button
                  variant="ghost" size="icon"
                  className="h-5 w-5 shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={e => { e.stopPropagation(); handleDeleteRef(r.id); }}
                >
                  <Trash2 className="h-2.5 w-2.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
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
        <p className="text-muted-foreground/60 text-sm text-center">
          {isRu ? "♀→♂: −4…−6 | ♂→♀: +4…+6 | Тонкая коррекция: ±1…2" : "♀→♂: −4…−6 | ♂→♀: +4…+6 | Fine-tune: ±1…2"}
        </p>
      </div>

      <Separator />

      {/* Feature Ratio (index_rate) */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Feature Ratio" : "Feature Ratio"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {indexRate.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Slider min={0} max={1} step={0.05} value={[indexRate]} onValueChange={([v]) => onUpdateVcConfig({ vc_index_rate: v })} className="flex-1" />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_index_rate: 0.75 })} disabled={indexRate === 0.75}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? "0 = чистая артикуляция источника | 1 = максимальное сходство с целевым голосом"
            : "0 = pure source articulation | 1 = max similarity to target voice"}
        </p>
      </div>

      <Separator />

      {/* Consonant Protection (protect) */}
      <div className="space-y-2">
        <div className="flex justify-between">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {isRu ? "Защита согласных" : "Consonant Protection"}
          </label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {protect.toFixed(2)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <Slider min={0} max={0.5} step={0.01} value={[protect]} onValueChange={([v]) => onUpdateVcConfig({ vc_protect: v })} className="flex-1" />
          <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0 text-muted-foreground hover:text-foreground" onClick={() => onUpdateVcConfig({ vc_protect: 0.33 })} disabled={protect === 0.33}>
            <RotateCcw className="h-3 w-3" />
          </Button>
        </div>
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? "0 = без защиты | 0.5 = максимальное сохранение шипящих/взрывных"
            : "0 = no protection | 0.5 = max preservation of sibilants/plosives"}
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
        <p className="text-muted-foreground/60 text-xs text-center">
          {isRu
            ? "Нативный SR модели. Выход всегда 44.1 kHz. Если голос быстрый — попробуйте 32 kHz"
            : "Model native SR. Output is always 44.1 kHz. If voice sounds fast — try 32 kHz"}
        </p>
      </div>

      <Separator />
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

      {/* Info box */}
      <div className="rounded-md border border-border bg-muted/30 p-2.5">
        <p className="text-muted-foreground leading-relaxed text-xs">
          {isRu
            ? "🎙️ Voice Conversion преобразует TTS-аудио в уникальный тембр через ContentVec → CREPE → RVC v2. Обработка полностью на стороне клиента (WebGPU/WASM)."
            : "🎙️ Voice Conversion transforms TTS audio into a unique timbre via ContentVec → CREPE → RVC v2. Processing is fully client-side (WebGPU/WASM)."}
        </p>
      </div>
    </div>
  );
}
