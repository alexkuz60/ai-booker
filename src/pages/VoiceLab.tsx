/**
 * VoiceLab — Voice Laboratory page for managing VC models, references, indexes, and testing.
 * Moved from VoiceConversionTab to a dedicated page for better UX.
 */
import { useState, useCallback, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getModelStatus, VC_MODEL_REGISTRY, VC_PITCH_MODELS, VC_ENCODER_MODELS, downloadAllModels, downloadModel, deleteModel, hasModel, type ModelDownloadProgress } from "@/lib/vcModelCache";
import {
  listVcReferences, saveVcReference, deleteVcReference, hasVcReference, readVcReferenceBlob,
  type VcReferenceEntry,
} from "@/lib/vcReferenceCache";
import {
  listVcIndexes, saveVcIndex, deleteVcIndex, parseIndexFile, buildNpyBlob,
  type VcIndexEntry,
} from "@/lib/vcIndexSearch";
import {
  Zap, Play, Square, Loader2, AlertTriangle, CheckCircle2, Wand2,
  Upload, Music, Trash2, Download, Library, Database, ArrowRight,
  HardDrive, FlaskConical, BarChart3,
} from "lucide-react";
import { IndexStatsPanel } from "@/components/voicelab/IndexStatsPanel";
import { useNavigate } from "react-router-dom";
import { useBookerPro } from "@/hooks/useBookerPro";
import { useLanguage } from "@/hooks/useLanguage";
import { usePageHeader } from "@/hooks/usePageHeader";
import { vcAudioToWav } from "@/lib/vcSynthesis";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export default function VoiceLab() {
  const { isRu } = useLanguage();
  const navigate = useNavigate();
  const pro = useBookerPro();
  const { setPageHeader } = usePageHeader();

  useEffect(() => {
    setPageHeader({
      title: isRu ? "Голосовая лаборатория" : "Voice Lab",
      subtitle: isRu ? "Управление моделями, референсами и обучающими индексами" : "Manage models, references, and training indexes",
    });
  }, [isRu, setPageHeader]);

  // ── Model status ──
  const [modelStatus, setModelStatus] = useState<Record<string, boolean>>({});
  const [downloading, setDownloading] = useState(false);
  const [dlProgress, setDlProgress] = useState<ModelDownloadProgress | null>(null);
  const [pitchBusy, setPitchBusy] = useState<string | null>(null);
  const [pitchDlPct, setPitchDlPct] = useState(0);

  // ── References ──
  const [localRefs, setLocalRefs] = useState<VcReferenceEntry[]>([]);
  const [collectionRefs, setCollectionRefs] = useState<{ id: string; name: string; category: string; durationMs: number }[]>([]);
  const [showCollection, setShowCollection] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // ── Indexes ──
  const [localIndexes, setLocalIndexes] = useState<VcIndexEntry[]>([]);
  const [uploadingIndex, setUploadingIndex] = useState(false);
  const indexInputRef = useRef<HTMLInputElement>(null);

  // ── Audio preview ──
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);

  // Load data on mount
  const refreshModelStatus = useCallback(async () => {
    const core = await getModelStatus();
    const pitchEntries = await Promise.all(
      VC_PITCH_MODELS.map(async m => [m.id, await hasModel(m.id)] as const),
    );
    setModelStatus({ ...core, ...Object.fromEntries(pitchEntries) });
  }, []);

  useEffect(() => {
    refreshModelStatus();
    listVcReferences().then(setLocalRefs);
    listVcIndexes().then(setLocalIndexes);
  }, [refreshModelStatus]);

  // ── Model download ──
  const handleDownloadModels = useCallback(async () => {
    setDownloading(true);
    try {
      await downloadAllModels((p) => setDlProgress(p));
      await refreshModelStatus();
      toast.success(isRu ? "Все модели загружены" : "All models downloaded");
    } catch (err: any) {
      toast.error(err.message || (isRu ? "Ошибка загрузки моделей" : "Model download error"));
    } finally {
      setDownloading(false);
      setDlProgress(null);
    }
  }, [isRu, refreshModelStatus]);

  const handleDownloadPitch = useCallback(async (entry: typeof VC_PITCH_MODELS[number]) => {
    setPitchBusy(entry.id);
    setPitchDlPct(0);
    try {
      const ok = await downloadModel(entry, (p) => setPitchDlPct(Math.round(p.fraction * 100)));
      if (!ok) throw new Error("Download failed");
      await refreshModelStatus();
      toast.success(isRu ? `${entry.label} загружена` : `${entry.label} downloaded`);
    } catch (err: any) {
      toast.error(err.message || (isRu ? "Ошибка загрузки" : "Download error"));
    } finally {
      setPitchBusy(null);
    }
  }, [isRu, refreshModelStatus]);

  const handleDeletePitch = useCallback(async (modelId: string, label: string) => {
    const ok = await deleteModel(modelId);
    if (ok) {
      await refreshModelStatus();
      toast.success(isRu ? `${label} удалена` : `${label} deleted`);
    }
  }, [isRu, refreshModelStatus]);

  // ── Reference upload ──
  const handleFileUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const audioCtx = new AudioContext();
      const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
      audioCtx.close();

      const id = crypto.randomUUID();
      const name = file.name.replace(/\.[^.]+$/, "");
      const monoSamples = decoded.getChannelData(0);
      const wavBlob = vcAudioToWav(monoSamples, decoded.sampleRate);

      const entry: VcReferenceEntry = {
        id, name, source: "upload",
        durationMs: Math.round(decoded.duration * 1000),
        sampleRate: decoded.sampleRate,
        sizeBytes: wavBlob.size,
        addedAt: new Date().toISOString(),
      };

      await saveVcReference(id, wavBlob, entry);
      setLocalRefs(await listVcReferences());
      toast.success(isRu ? `Референс "${name}" загружен` : `Reference "${name}" uploaded`);
    } catch (err: any) {
      toast.error(err.message || (isRu ? "Ошибка загрузки" : "Upload error"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [isRu]);

  // ── Collection ──
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

  const handleDownloadFromCollection = useCallback(async (refId: string, refName: string) => {
    setDownloadingId(refId);
    try {
      if (await hasVcReference(refId)) {
        toast.info(isRu ? "Уже в кэше" : "Already cached");
        setDownloadingId(null);
        return;
      }
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
        id: refId, name: refName, source: "collection", sourceId: refId,
        durationMs: refRow.duration_ms, sampleRate: refRow.sample_rate,
        sizeBytes: blob.size, addedAt: new Date().toISOString(),
      };
      await saveVcReference(refId, blob, entry);
      setLocalRefs(await listVcReferences());
      toast.success(isRu ? `"${refName}" скачан` : `"${refName}" downloaded`);
    } catch (err: any) {
      toast.error(err.message || (isRu ? "Ошибка скачивания" : "Download error"));
    } finally {
      setDownloadingId(null);
    }
  }, [isRu]);

  const handleDeleteRef = useCallback(async (id: string) => {
    await deleteVcReference(id);
    setLocalRefs(await listVcReferences());
  }, []);

  const handlePreviewRef = useCallback(async (id: string) => {
    if (playingId === id && audioElRef.current) {
      audioElRef.current.pause();
      setPlayingId(null);
      return;
    }
    try {
      const blob = await readVcReferenceBlob(id);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(url); };
      audioElRef.current?.pause();
      audioElRef.current = audio;
      setPlayingId(id);
      await audio.play();
    } catch { /* ignore */ }
  }, [playingId]);

  // ── Index upload ──
  const handleIndexUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIndex(true);
    try {
      const arrayBuf = await file.arrayBuffer();
      const { rows, cols, data } = parseIndexFile(arrayBuf, file.name);
      if (cols !== 768 && cols !== 256) {
        throw new Error(isRu
          ? `Неподдерживаемая размерность: ${cols}. Ожидается 768 (ContentVec) или 256 (HuBERT v1).`
          : `Unsupported dimension: ${cols}. Expected 768 (ContentVec) or 256 (HuBERT v1).`);
      }
      const id = crypto.randomUUID();
      const name = file.name.replace(/\.[^.]+$/, "");
      const npyBlob = buildNpyBlob(data, rows, cols);
      const entry: VcIndexEntry = {
        id, name, vectorCount: rows, dim: cols,
        sizeBytes: npyBlob.size,
        addedAt: new Date().toISOString(),
      };
      await saveVcIndex(id, npyBlob, entry);
      setLocalIndexes(await listVcIndexes());
      toast.success(isRu
        ? `Индекс "${name}" загружен: ${rows.toLocaleString()} векторов × ${cols}D`
        : `Index "${name}" loaded: ${rows.toLocaleString()} vectors × ${cols}D`);
    } catch (err: any) {
      toast.error(err.message || (isRu ? "Ошибка загрузки индекса" : "Index upload error"));
    } finally {
      setUploadingIndex(false);
      if (indexInputRef.current) indexInputRef.current.value = "";
    }
  }, [isRu]);

  const handleDeleteIndex = useCallback(async (id: string) => {
    await deleteVcIndex(id);
    setLocalIndexes(await listVcIndexes());
  }, []);

  // ── Not activated ──
  if (!pro.enabled || !pro.modelsReady) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Alert className="border-primary/30 bg-primary/5">
          <Zap className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm">
            {isRu
              ? "Voice Lab требует активации Booker Pro в Профиле. Необходимы WebGPU и загруженные ONNX модели (~491 MB)."
              : "Voice Lab requires Booker Pro activation in Profile. WebGPU and downloaded ONNX models (~491 MB) are needed."}
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="gap-2" onClick={() => navigate("/profile")}>
          <ArrowRight className="h-4 w-4" />
          {isRu ? "Перейти в Профиль → Booker Pro" : "Go to Profile → Booker Pro"}
        </Button>
      </div>
    );
  }

  const allModelsReady = VC_MODEL_REGISTRY.every(m => modelStatus[m.id]);

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-6">
      <Tabs defaultValue="references" className="w-full">
        <TabsList className="grid w-full grid-cols-3">
          <TabsTrigger value="models" className="gap-1.5">
            <HardDrive className="h-3.5 w-3.5" />
            {isRu ? "Модели" : "Models"}
          </TabsTrigger>
          <TabsTrigger value="references" className="gap-1.5">
            <Music className="h-3.5 w-3.5" />
            {isRu ? "Референсы" : "References"}
          </TabsTrigger>
          <TabsTrigger value="indexes" className="gap-1.5">
            <Database className="h-3.5 w-3.5" />
            {isRu ? "Индексы" : "Indexes"}
          </TabsTrigger>
        </TabsList>

        {/* ═══ Models Tab ═══ */}
        <TabsContent value="models" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <HardDrive className="h-4 w-4 text-primary" />
                {isRu ? "ONNX модели для Voice Conversion" : "ONNX Models for Voice Conversion"}
                {allModelsReady && <Badge variant="outline" className="text-[10px] text-primary border-primary/50 ml-auto">Ready</Badge>}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{isRu ? "Модель" : "Model"}</TableHead>
                    <TableHead className="text-xs text-right">{isRu ? "Размер" : "Size"}</TableHead>
                    <TableHead className="text-xs text-center">{isRu ? "Статус" : "Status"}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {VC_MODEL_REGISTRY.map(m => (
                    <TableRow key={m.id}>
                      <TableCell className="py-2">
                        <p className="text-sm font-medium">{m.label}</p>
                        <p className="text-xs text-muted-foreground">{m.description}</p>
                      </TableCell>
                      <TableCell className="text-xs text-right text-muted-foreground tabular-nums">
                        {(m.sizeBytes / 1024 / 1024).toFixed(0)} MB
                      </TableCell>
                      <TableCell className="text-center">
                        {modelStatus[m.id]
                          ? <CheckCircle2 className="h-4 w-4 text-primary mx-auto" />
                          : <AlertTriangle className="h-4 w-4 text-muted-foreground mx-auto" />}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>

              {!allModelsReady && (
                <Button onClick={handleDownloadModels} disabled={downloading} className="w-full gap-2">
                  {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                  {downloading && dlProgress
                    ? `${dlProgress.label}: ${Math.round(dlProgress.fraction * 100)}%`
                    : isRu ? "Скачать все модели" : "Download all models"}
                </Button>
              )}
              {downloading && dlProgress && (
                <Progress value={dlProgress.fraction * 100} className="h-1.5" />
              )}
            </CardContent>
          </Card>

          {/* ── Pitch Models (optional) ── */}
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Zap className="h-4 w-4 text-primary" />
                {isRu ? "Модели определения тона (F0)" : "Pitch Detection Models (F0)"}
                <Badge variant="outline" className="text-[10px] ml-auto">
                  {isRu ? "опционально" : "optional"}
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {isRu
                  ? "Дополнительные алгоритмы для более точного определения высоты тона. CREPE Tiny (~2 MB) включён в базовый набор."
                  : "Additional algorithms for higher-quality pitch detection. CREPE Tiny (~2 MB) is included in the core set."}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">{isRu ? "Модель" : "Model"}</TableHead>
                    <TableHead className="text-xs text-right">{isRu ? "Размер" : "Size"}</TableHead>
                    <TableHead className="text-xs text-center">{isRu ? "Статус" : "Status"}</TableHead>
                    <TableHead className="text-xs w-20"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {VC_PITCH_MODELS.map(m => {
                    const cached = !!modelStatus[m.id];
                    const busy = pitchBusy === m.id;
                    return (
                      <TableRow key={m.id}>
                        <TableCell className="py-2">
                          <p className="text-sm font-medium">{m.label}</p>
                          <p className="text-xs text-muted-foreground">{m.description}</p>
                        </TableCell>
                        <TableCell className="text-xs text-right text-muted-foreground tabular-nums">
                          {(m.sizeBytes / 1024 / 1024).toFixed(0)} MB
                        </TableCell>
                        <TableCell className="text-center">
                          {cached
                            ? <CheckCircle2 className="h-4 w-4 text-primary mx-auto" />
                            : <AlertTriangle className="h-4 w-4 text-muted-foreground mx-auto" />}
                        </TableCell>
                        <TableCell className="text-right">
                          {cached ? (
                            <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => handleDeletePitch(m.id, m.label)}>
                              <Trash2 className="h-3.5 w-3.5" />
                            </Button>
                          ) : (
                            <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => handleDownloadPitch(m)} disabled={!!pitchBusy}>
                              {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                              {busy ? `${pitchDlPct}%` : isRu ? "Скачать" : "Download"}
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
              {pitchBusy && <Progress value={pitchDlPct} className="h-1.5" />}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ References Tab ═══ */}
        <TabsContent value="references" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Music className="h-4 w-4 text-primary" />
                {isRu ? "Референсные голоса" : "Reference Voices"}
                <Badge variant="outline" className="text-[10px] ml-auto">{localRefs.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Upload + Collection */}
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
                  <ScrollArea className="max-h-48">
                    {collectionRefs.length === 0 ? (
                      <p className="p-3 text-xs text-muted-foreground text-center">{isRu ? "Коллекция пуста" : "Collection is empty"}</p>
                    ) : (
                      <Table>
                        <TableBody>
                          {collectionRefs.map(r => {
                            const isCached = localRefs.some(lr => lr.id === r.id);
                            return (
                              <TableRow key={r.id} className="text-xs">
                                <TableCell className="py-1.5 px-3">
                                  <div className="flex items-center gap-2">
                                    <Music className="h-3 w-3 text-muted-foreground shrink-0" />
                                    <span className="truncate">{r.name}</span>
                                  </div>
                                </TableCell>
                                <TableCell className="py-1.5 px-2">
                                  <Badge variant="outline" className="text-[9px] px-1 py-0">{r.category}</Badge>
                                </TableCell>
                                <TableCell className="py-1.5 px-2 text-muted-foreground tabular-nums text-right">
                                  {(r.durationMs / 1000).toFixed(1)}s
                                </TableCell>
                                <TableCell className="py-1.5 px-2 w-10">
                                  {isCached ? (
                                    <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
                                  ) : (
                                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handleDownloadFromCollection(r.id, r.name)} disabled={downloadingId === r.id}>
                                      {downloadingId === r.id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                                    </Button>
                                  )}
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </Table>
                    )}
                  </ScrollArea>
                </div>
              )}

              {/* Local references table */}
              {localRefs.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{isRu ? "Имя" : "Name"}</TableHead>
                      <TableHead className="text-xs">{isRu ? "Источник" : "Source"}</TableHead>
                      <TableHead className="text-xs text-right">{isRu ? "Длительность" : "Duration"}</TableHead>
                      <TableHead className="text-xs text-right">{isRu ? "Размер" : "Size"}</TableHead>
                      <TableHead className="text-xs w-20"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {localRefs.map(r => (
                      <TableRow key={r.id}>
                        <TableCell className="py-2">
                          <span className="text-sm font-mono">{r.name}</span>
                        </TableCell>
                        <TableCell className="py-2">
                          <Badge variant="outline" className="text-[10px]">
                            {r.source === "collection" ? (isRu ? "Коллекция" : "Collection") : (isRu ? "Загружен" : "Uploaded")}
                          </Badge>
                        </TableCell>
                        <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                          {(r.durationMs / 1000).toFixed(1)}s
                        </TableCell>
                        <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                          {(r.sizeBytes / 1024).toFixed(0)} KB
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex gap-1 justify-end">
                            <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => handlePreviewRef(r.id)}>
                              {playingId === r.id ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                            </Button>
                            <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteRef(r.id)}>
                              <Trash2 className="h-3 w-3" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4 italic">
                  {isRu ? "Нет загруженных референсов. Загрузите аудио или скачайте из коллекции." : "No references loaded. Upload audio or download from collection."}
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ═══ Indexes Tab ═══ */}
        <TabsContent value="indexes" className="space-y-4 mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Database className="h-4 w-4 text-primary" />
                {isRu ? "Обучающие индексы (Feature Retrieval)" : "Training Indexes (Feature Retrieval)"}
                <Badge variant="outline" className="text-[10px] ml-auto">{localIndexes.length}</Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-xs text-muted-foreground">
                {isRu
                  ? "Загрузите .npy (total_fea.npy) или .index файл из RVC-обучения. Индекс позволяет Feature Ratio влиять на тембр голоса."
                  : "Upload .npy (total_fea.npy) or .index file from RVC training. Index enables Feature Ratio to affect voice timbre."}
              </p>

              <div className="flex gap-2">
                <input ref={indexInputRef} type="file" accept=".npy,.index,.bin" className="hidden" onChange={handleIndexUpload} />
                <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => indexInputRef.current?.click()} disabled={uploadingIndex}>
                  {uploadingIndex ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
                  {isRu ? "Загрузить .npy / .index" : "Upload .npy / .index"}
                </Button>
              </div>

              {localIndexes.length > 0 ? (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="text-xs">{isRu ? "Имя" : "Name"}</TableHead>
                      <TableHead className="text-xs text-right">{isRu ? "Векторы" : "Vectors"}</TableHead>
                      <TableHead className="text-xs text-right">{isRu ? "Размерность" : "Dim"}</TableHead>
                      <TableHead className="text-xs text-right">{isRu ? "Размер" : "Size"}</TableHead>
                      <TableHead className="text-xs w-10"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {localIndexes.map(ix => (
                      <TableRow key={ix.id}>
                        <TableCell className="py-2">
                          <span className="text-sm font-mono">{ix.name}</span>
                        </TableCell>
                        <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                          {ix.vectorCount.toLocaleString()}
                        </TableCell>
                        <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                          {ix.dim}D
                        </TableCell>
                        <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">
                          {(ix.sizeBytes / 1024 / 1024).toFixed(1)} MB
                        </TableCell>
                        <TableCell className="py-2">
                          <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => handleDeleteIndex(ix.id)}>
                            <Trash2 className="h-3 w-3" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              ) : (
                <p className="text-xs text-muted-foreground text-center py-4 italic">
                  {isRu ? "Нет загруженных индексов." : "No indexes loaded."}
                </p>
              )}
            </CardContent>
          </Card>

          {/* Index analysis panels */}
          {localIndexes.map(ix => (
            <IndexStatsPanel key={ix.id} index={ix} isRu={isRu} />
          ))}
        </TabsContent>
      </Tabs>

      {/* Info box */}
      <div className="rounded-md border border-border bg-muted/30 p-3">
        <p className="text-muted-foreground leading-relaxed text-xs">
          {isRu
            ? "🎙️ Voice Lab — управление ресурсами для Voice Conversion. Модели ONNX (ContentVec, CREPE, RVC), референсные голоса и обучающие индексы хранятся локально в OPFS. Назначение голосов персонажам — на странице Дикторы → вкладка VC."
            : "🎙️ Voice Lab — manage resources for Voice Conversion. ONNX models (ContentVec, CREPE, RVC), reference voices, and training indexes are stored locally in OPFS. Assign voices to characters on the Narrators → VC tab."}
        </p>
      </div>
    </div>
  );
}
