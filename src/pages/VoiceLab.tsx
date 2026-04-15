/**
 * VoiceLab — Voice Laboratory page for managing VC models, references, indexes, and testing.
 * Full-screen layout with vertical sidebar tabs for desktop.
 */
import { useState, useCallback, useEffect, useRef, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Progress } from "@/components/ui/progress";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { getModelStatus, VC_MODEL_REGISTRY, VC_PITCH_MODELS, VC_ENCODER_MODELS, downloadAllModels, downloadModel, deleteModel, VC_MODEL_CACHE_EVENT, type ModelDownloadProgress } from "@/lib/vcModelCache";
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
import { cn } from "@/lib/utils";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readCharacterIndex, saveCharacterIndex } from "@/lib/localCharacters";
import { VoiceConversionTab } from "@/components/narrators/VoiceConversionTab";
import { buildTtsRequestFromConfig } from "@/lib/buildTtsRequestFromConfig";
import { PROVIDER_LABELS, getVoiceDisplayName } from "@/lib/voiceMatching";
import type { CharacterIndex } from "@/pages/parser/types";

// ─── Sidebar tab definition ─────────────────────────
interface SidebarTab {
  id: string;
  label: { ru: string; en: string };
  icon: React.ElementType;
}

const TABS: SidebarTab[] = [
  { id: "models", label: { ru: "Модели", en: "Models" }, icon: HardDrive },
  { id: "references", label: { ru: "Референсы", en: "References" }, icon: Music },
  { id: "indexes", label: { ru: "Индексы", en: "Indexes" }, icon: Database },
  { id: "vc", label: { ru: "Voice Conversion", en: "Voice Conversion" }, icon: Zap },
];

// ─── Character type for VC ──────────────────────────
interface LabCharacter {
  id: string;
  name: string;
  gender: string;
  age_group: string;
  temperament: string | null;
  voice_config: Record<string, unknown>;
}

export default function VoiceLab() {
  const { isRu } = useLanguage();
  const navigate = useNavigate();
  const pro = useBookerPro();
  const { setPageHeader } = usePageHeader();
  const { storage: projectStorage, meta: projectMeta } = useProjectStorageContext();

  const [activeTab, setActiveTab] = useState("models");

  useEffect(() => {
    setPageHeader({
      title: isRu ? "Голосовая лаборатория" : "Voice Lab",
      subtitle: isRu ? "Модели, референсы, индексы и Voice Conversion" : "Models, references, indexes & Voice Conversion",
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

  // ── VC Characters ──
  const [characters, setCharacters] = useState<LabCharacter[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);
  const [vcDirty, setVcDirty] = useState(false);
  const [vcSaving, setVcSaving] = useState(false);

  // Load characters from current OPFS project
  const loadCharacters = useCallback(async () => {
    if (!projectStorage) { setCharacters([]); return; }
    try {
      const localChars = await readCharacterIndex(projectStorage);
      const chars: LabCharacter[] = localChars.map(c => ({
        id: c.id,
        name: c.name,
        gender: c.gender,
        age_group: c.age_group,
        temperament: c.temperament ?? null,
        voice_config: (c.voice_config as Record<string, unknown>) || {},
      }));
      setCharacters(chars);
      if (chars.length > 0 && !selectedCharId) setSelectedCharId(chars[0].id);
    } catch {
      setCharacters([]);
    }
  }, [projectStorage, selectedCharId]);

  useEffect(() => { loadCharacters(); }, [loadCharacters]);

  const selectedChar = characters.find(c => c.id === selectedCharId) ?? null;

  // Build TTS request from voice_config
  const buildTtsRequest = useCallback((): { url: string; body: Record<string, unknown> } | null => {
    if (!selectedChar) return null;
    return buildTtsRequestFromConfig(selectedChar.voice_config, isRu);
  }, [selectedChar, isRu]);

  // Update VC fields in voice_config
  const handleUpdateVcConfig = useCallback((patch: Record<string, unknown>) => {
    if (!selectedCharId) return;
    setCharacters(prev => prev.map(c => {
      if (c.id !== selectedCharId) return c;
      return { ...c, voice_config: { ...c.voice_config, ...patch } };
    }));
    setVcDirty(true);
  }, [selectedCharId]);

  // Save VC config to OPFS
  const handleSaveVcConfig = useCallback(async () => {
    if (!selectedCharId || !projectStorage) return;
    setVcSaving(true);
    try {
      const localChars = await readCharacterIndex(projectStorage);
      const idx = localChars.findIndex(c => c.id === selectedCharId);
      if (idx < 0) throw new Error("Character not found");
      const currentChar = characters.find(c => c.id === selectedCharId);
      if (!currentChar) throw new Error("No selection");
      localChars[idx] = { ...localChars[idx], voice_config: currentChar.voice_config as any };
      await saveCharacterIndex(projectStorage, localChars);
      setVcDirty(false);
      toast.success(isRu ? "VC-настройки сохранены" : "VC settings saved");
    } catch {
      toast.error(isRu ? "Ошибка сохранения" : "Save error");
    } finally {
      setVcSaving(false);
    }
  }, [selectedCharId, projectStorage, characters, isRu]);

  // Load data on mount
  const refreshModelStatus = useCallback(async () => {
    const status = await getModelStatus();
    setModelStatus(status);
  }, []);

  useEffect(() => {
    const handleCacheChange = () => { void refreshModelStatus(); };
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") void refreshModelStatus();
    };

    void refreshModelStatus();
    listVcReferences().then(setLocalRefs);
    listVcIndexes().then(setLocalIndexes);
    window.addEventListener(VC_MODEL_CACHE_EVENT, handleCacheChange);
    window.addEventListener("focus", handleCacheChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      window.removeEventListener(VC_MODEL_CACHE_EVENT, handleCacheChange);
      window.removeEventListener("focus", handleCacheChange);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
    };
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
      if (!refRow) throw new Error("Ref not found");

      const { data: signedData } = await supabase.storage
        .from("voice-references")
        .createSignedUrl(refRow.file_path, 120);
      if (!signedData?.signedUrl) throw new Error("Signed URL fail");

      const resp = await fetch(signedData.signedUrl);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const blob = await resp.blob();

      const entry: VcReferenceEntry = {
        id: refId, name: refName, source: "collection",
        durationMs: refRow.duration_ms,
        sampleRate: refRow.sample_rate,
        sizeBytes: blob.size,
        addedAt: new Date().toISOString(),
      };

      await saveVcReference(refId, blob, entry);
      setLocalRefs(await listVcReferences());
      toast.success(isRu ? `"${refName}" загружен` : `"${refName}" downloaded`);
    } catch (err: any) {
      toast.error(err.message || (isRu ? "Ошибка" : "Error"));
    } finally {
      setDownloadingId(null);
    }
  }, [isRu]);

  const handleDeleteRef = useCallback(async (id: string) => {
    await deleteVcReference(id);
    setLocalRefs(await listVcReferences());
  }, []);

  const handlePreviewRef = useCallback(async (id: string) => {
    if (playingId === id) {
      audioElRef.current?.pause();
      setPlayingId(null);
      return;
    }
    try {
      const blob = await readVcReferenceBlob(id);
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      if (audioElRef.current) { audioElRef.current.pause(); }
      const audio = new Audio(url);
      audioElRef.current = audio;
      setPlayingId(id);
      audio.onended = () => { setPlayingId(null); URL.revokeObjectURL(url); };
      await audio.play();
    } catch {
      toast.error(isRu ? "Ошибка воспроизведения" : "Playback error");
    }
  }, [playingId, isRu]);

  // ── Indexes ──
  const handleIndexUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingIndex(true);
    try {
      const buf = await file.arrayBuffer();
      const parsed = parseIndexFile(buf, file.name);
      const id = crypto.randomUUID();
      const npyBlob = parsed.format === "npy" ? new Blob([buf]) : buildNpyBlob(parsed.vectors, parsed.dim);
      const entry: VcIndexEntry = {
        id, name: file.name.replace(/\.[^.]+$/, ""),
        format: parsed.format,
        vectorCount: parsed.vectorCount,
        dim: parsed.dim,
        sizeBytes: npyBlob.size,
        addedAt: new Date().toISOString(),
      };
      await saveVcIndex(id, npyBlob, entry);
      setLocalIndexes(await listVcIndexes());
      toast.success(isRu ? `Индекс "${entry.name}" загружен (${parsed.vectorCount} векторов)` : `Index "${entry.name}" uploaded (${parsed.vectorCount} vectors)`);
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

  const coreModelsReady = VC_MODEL_REGISTRY.every(m => modelStatus[m.id]);

  // ── Not activated ──
  if (!pro.enabled) {
    return (
      <div className="max-w-3xl mx-auto p-6 space-y-4">
        <Alert className="border-primary/30 bg-primary/5">
          <Zap className="h-4 w-4 text-primary" />
          <AlertDescription className="text-sm">
            {isRu
              ? "Voice Lab требует активации Booker Pro в Профиле."
              : "Voice Lab requires Booker Pro activation in Profile."}
          </AlertDescription>
        </Alert>
        <Button variant="outline" className="gap-2" onClick={() => navigate("/profile")}>
          <ArrowRight className="h-4 w-4" />
          {isRu ? "Перейти в Профиль → Booker Pro" : "Go to Profile → Booker Pro"}
        </Button>
      </div>
    );
  }

  // Determine default tab
  const effectiveTab = activeTab;

  return (
    <div className="flex h-[calc(100vh-3rem)] min-h-0 overflow-hidden w-full">
      {/* ── Vertical sidebar tabs ── */}
      <div className="w-48 shrink-0 border-r border-border bg-muted/30 flex flex-col">
        <div className="px-3 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" />
            <span className="text-xs font-semibold font-display uppercase tracking-wider text-muted-foreground">
              {isRu ? "Лаборатория" : "Laboratory"}
            </span>
          </div>
        </div>
        <nav className="flex-1 p-2 space-y-0.5">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = effectiveTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  "w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors text-left",
                  isActive
                    ? "bg-accent text-accent-foreground font-medium"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="truncate">{isRu ? tab.label.ru : tab.label.en}</span>
              </button>
            );
          })}
        </nav>
        {/* Status badges */}
        <div className="p-3 border-t border-border space-y-1">
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            {coreModelsReady
              ? <CheckCircle2 className="h-3 w-3 text-primary" />
              : <AlertTriangle className="h-3 w-3 text-destructive" />}
            <span>{isRu ? "Модели" : "Models"}: {coreModelsReady ? "OK" : (isRu ? "Не готовы" : "Missing")}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Music className="h-3 w-3" />
            <span>{isRu ? "Референсы" : "Refs"}: {localRefs.length}</span>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <Database className="h-3 w-3" />
            <span>{isRu ? "Индексы" : "Indexes"}: {localIndexes.length}</span>
          </div>
        </div>
      </div>

      {/* ── Content area ── */}
      <ScrollArea className="flex-1">
        <div className="p-4 md:p-6">
          {!coreModelsReady && effectiveTab !== "models" && (
            <Alert className="border-primary/30 bg-primary/5 mb-4">
              <AlertTriangle className="h-4 w-4 text-primary" />
              <AlertDescription className="text-sm">
                {isRu
                  ? "Не все базовые VC-модели найдены. Откройте вкладку «Модели»."
                  : "Some core VC models missing. Open the Models tab."}
              </AlertDescription>
            </Alert>
          )}

          {effectiveTab === "models" && <ModelsPanel
            modelStatus={modelStatus}
            coreModelsReady={coreModelsReady}
            downloading={downloading}
            dlProgress={dlProgress}
            pitchBusy={pitchBusy}
            pitchDlPct={pitchDlPct}
            isRu={isRu}
            onDownloadAll={handleDownloadModels}
            onDownloadPitch={handleDownloadPitch}
            onDeleteModel={handleDeletePitch}
          />}

          {effectiveTab === "references" && <ReferencesPanel
            localRefs={localRefs}
            collectionRefs={collectionRefs}
            showCollection={showCollection}
            uploading={uploading}
            downloadingId={downloadingId}
            playingId={playingId}
            isRu={isRu}
            fileInputRef={fileInputRef}
            onUpload={handleFileUpload}
            onToggleCollection={() => { setShowCollection(!showCollection); if (!showCollection) loadCollection(); }}
            onDownloadFromCollection={handleDownloadFromCollection}
            onDelete={handleDeleteRef}
            onPreview={handlePreviewRef}
          />}

          {effectiveTab === "indexes" && <IndexesPanel
            localIndexes={localIndexes}
            uploadingIndex={uploadingIndex}
            isRu={isRu}
            indexInputRef={indexInputRef}
            onUpload={handleIndexUpload}
            onDelete={handleDeleteIndex}
          />}

          {effectiveTab === "vc" && (
            <VcLabPanel
              characters={characters}
              selectedCharId={selectedCharId}
              onSelectChar={setSelectedCharId}
              selectedChar={selectedChar}
              isRu={isRu}
              buildTtsRequest={buildTtsRequest}
              onUpdateVcConfig={handleUpdateVcConfig}
              vcDirty={vcDirty}
              vcSaving={vcSaving}
              onSaveVcConfig={handleSaveVcConfig}
              projectStorage={projectStorage}
            />
          )}
        </div>
      </ScrollArea>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════
// Sub-panels extracted for readability
// ═══════════════════════════════════════════════════════════

// ── Models Panel ──
function ModelsPanel({ modelStatus, coreModelsReady, downloading, dlProgress, pitchBusy, pitchDlPct, isRu, onDownloadAll, onDownloadPitch, onDeleteModel }: {
  modelStatus: Record<string, boolean>;
  coreModelsReady: boolean;
  downloading: boolean;
  dlProgress: ModelDownloadProgress | null;
  pitchBusy: string | null;
  pitchDlPct: number;
  isRu: boolean;
  onDownloadAll: () => void;
  onDownloadPitch: (entry: any) => void;
  onDeleteModel: (id: string, label: string) => void;
}) {
  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <HardDrive className="h-4 w-4 text-primary" />
            {isRu ? "ONNX модели для Voice Conversion" : "ONNX Models for Voice Conversion"}
            {coreModelsReady && <Badge variant="outline" className="text-[10px] text-primary border-primary/50 ml-auto">Ready</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
              {VC_MODEL_REGISTRY.map(m => {
                const cached = !!modelStatus[m.id];
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
                      {cached ? <CheckCircle2 className="h-4 w-4 text-primary mx-auto" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground mx-auto" />}
                    </TableCell>
                    <TableCell className="text-right">
                      {cached && (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDeleteModel(m.id, m.label)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          {!coreModelsReady && (
            <Button onClick={onDownloadAll} disabled={downloading} className="w-full gap-2">
              {downloading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
              {downloading && dlProgress
                ? `${dlProgress.label}: ${Math.round(dlProgress.fraction * 100)}%`
                : isRu ? "Скачать все модели" : "Download all models"}
            </Button>
          )}
          {downloading && dlProgress && <Progress value={dlProgress.fraction * 100} className="h-1.5" />}
        </CardContent>
      </Card>

      {/* Pitch Models */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Zap className="h-4 w-4 text-primary" />
            {isRu ? "Модели определения тона (F0)" : "Pitch Detection Models (F0)"}
            <Badge variant="outline" className="text-[10px] ml-auto">{isRu ? "опционально" : "optional"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
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
                      {cached ? <CheckCircle2 className="h-4 w-4 text-primary mx-auto" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground mx-auto" />}
                    </TableCell>
                    <TableCell className="text-right">
                      {cached ? (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDeleteModel(m.id, m.label)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onDownloadPitch(m)} disabled={!!pitchBusy}>
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

      {/* Encoder Models */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Wand2 className="h-4 w-4 text-primary" />
            {isRu ? "Альтернативные энкодеры речи" : "Alternative Speech Encoders"}
            <Badge variant="outline" className="text-[10px] ml-auto border-primary/50 text-primary">{isRu ? "рекомендуемый" : "recommended"}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">
            {isRu
              ? "WavLM лучше сохраняет интонации и эмоциональную окраску живого TTS."
              : "WavLM better preserves intonation and emotional quality of live TTS."}
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
              {VC_ENCODER_MODELS.map(m => {
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
                      {cached ? <CheckCircle2 className="h-4 w-4 text-primary mx-auto" /> : <AlertTriangle className="h-4 w-4 text-muted-foreground mx-auto" />}
                    </TableCell>
                    <TableCell className="text-right">
                      {cached ? (
                        <Button variant="ghost" size="icon" className="h-7 w-7 text-destructive hover:text-destructive" onClick={() => onDeleteModel(m.id, m.label)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      ) : (
                        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={() => onDownloadPitch(m)} disabled={!!pitchBusy}>
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
        </CardContent>
      </Card>
    </div>
  );
}

// ── References Panel ──
function ReferencesPanel({ localRefs, collectionRefs, showCollection, uploading, downloadingId, playingId, isRu, fileInputRef, onUpload, onToggleCollection, onDownloadFromCollection, onDelete, onPreview }: {
  localRefs: VcReferenceEntry[];
  collectionRefs: { id: string; name: string; category: string; durationMs: number }[];
  showCollection: boolean;
  uploading: boolean;
  downloadingId: string | null;
  playingId: string | null;
  isRu: boolean;
  fileInputRef: React.RefObject<HTMLInputElement>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onToggleCollection: () => void;
  onDownloadFromCollection: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onPreview: (id: string) => void;
}) {
  return (
    <div className="space-y-4 max-w-3xl">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Music className="h-4 w-4 text-primary" />
            {isRu ? "Референсные голоса" : "Reference Voices"}
            <Badge variant="outline" className="text-[10px] ml-auto">{localRefs.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={onUpload} />
            <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Upload className="h-3.5 w-3.5" />}
              {isRu ? "Загрузить файл" : "Upload file"}
            </Button>
            <Button variant="outline" size="sm" className="gap-1.5 flex-1" onClick={onToggleCollection}>
              <Library className="h-3.5 w-3.5" />
              {isRu ? "Коллекция" : "Collection"}
            </Button>
          </div>

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
                                <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onDownloadFromCollection(r.id, r.name)} disabled={downloadingId === r.id}>
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
                    <TableCell className="py-2"><span className="text-sm font-mono">{r.name}</span></TableCell>
                    <TableCell className="py-2">
                      <Badge variant="outline" className="text-[10px]">
                        {r.source === "collection" ? (isRu ? "Коллекция" : "Collection") : (isRu ? "Загружен" : "Uploaded")}
                      </Badge>
                    </TableCell>
                    <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">{(r.durationMs / 1000).toFixed(1)}s</TableCell>
                    <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">{(r.sizeBytes / 1024).toFixed(0)} KB</TableCell>
                    <TableCell className="py-2">
                      <div className="flex gap-1 justify-end">
                        <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => onPreview(r.id)}>
                          {playingId === r.id ? <Square className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => onDelete(r.id)}>
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
              {isRu ? "Нет загруженных референсов." : "No references loaded."}
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Indexes Panel ──
function IndexesPanel({ localIndexes, uploadingIndex, isRu, indexInputRef, onUpload, onDelete }: {
  localIndexes: VcIndexEntry[];
  uploadingIndex: boolean;
  isRu: boolean;
  indexInputRef: React.RefObject<HTMLInputElement>;
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <div className="space-y-4 max-w-3xl">
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
              ? "Загрузите .npy или .index файл из RVC-обучения."
              : "Upload .npy or .index file from RVC training."}
          </p>
          <div className="flex gap-2">
            <input ref={indexInputRef} type="file" accept=".npy,.index,.bin" className="hidden" onChange={onUpload} />
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
                    <TableCell className="py-2"><span className="text-sm font-mono">{ix.name}</span></TableCell>
                    <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">{ix.vectorCount.toLocaleString()}</TableCell>
                    <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">{ix.dim}D</TableCell>
                    <TableCell className="py-2 text-right text-xs text-muted-foreground tabular-nums">{(ix.sizeBytes / 1024 / 1024).toFixed(1)} MB</TableCell>
                    <TableCell className="py-2">
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-destructive" onClick={() => onDelete(ix.id)}>
                        <Trash2 className="h-3 w-3" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="text-xs text-muted-foreground text-center py-4 italic">
              {isRu ? "Нет индексов." : "No indexes."}
            </p>
          )}
          {localIndexes.map(ix => (
            <IndexStatsPanel key={ix.id} index={ix} isRu={isRu} />
          ))}
        </CardContent>
      </Card>
    </div>
  );
}

// ── Voice Conversion Panel ──
function VcLabPanel({ characters, selectedCharId, onSelectChar, selectedChar, isRu, buildTtsRequest, onUpdateVcConfig, vcDirty, vcSaving, onSaveVcConfig, projectStorage }: {
  characters: LabCharacter[];
  selectedCharId: string | null;
  onSelectChar: (id: string | null) => void;
  selectedChar: LabCharacter | null;
  isRu: boolean;
  buildTtsRequest: () => { url: string; body: Record<string, unknown> } | null;
  onUpdateVcConfig: (patch: Record<string, unknown>) => void;
  vcDirty: boolean;
  vcSaving: boolean;
  onSaveVcConfig: () => void;
  projectStorage: any;
}) {
  if (!projectStorage) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center space-y-2">
          <FlaskConical className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="text-sm">{isRu ? "Откройте проект в Библиотеке для доступа к VC" : "Open a project in Library to access VC"}</p>
        </div>
      </div>
    );
  }

  if (characters.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <div className="text-center space-y-2">
          <Zap className="h-10 w-10 mx-auto text-muted-foreground/30" />
          <p className="text-sm">{isRu ? "Нет персонажей в текущем проекте" : "No characters in current project"}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Character selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wider shrink-0">
          {isRu ? "Персонаж" : "Character"}
        </label>
        <Select value={selectedCharId || ""} onValueChange={v => onSelectChar(v || null)}>
          <SelectTrigger className="w-72 bg-secondary border-border">
            <SelectValue placeholder={isRu ? "Выберите персонажа..." : "Select character..."} />
          </SelectTrigger>
          <SelectContent className="bg-card border-border max-h-64">
            {characters.map(ch => {
              const vc = ch.voice_config;
              const provider = (vc?.provider as string) || "";
              const voiceId = (vc?.voice_id as string) || "";
              return (
                <SelectItem key={ch.id} value={ch.id}>
                  <div className="flex items-center gap-2">
                    <span>{ch.name}</span>
                    {ch.gender !== "unknown" && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {ch.gender === "female" ? "♀" : "♂"}
                      </span>
                    )}
                    {voiceId && (
                      <Badge variant="secondary" className="text-[9px] px-1 py-0">
                        {PROVIDER_LABELS[provider] ?? provider} — {getVoiceDisplayName(provider, voiceId, isRu)}
                      </Badge>
                    )}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        {vcDirty && (
          <Button size="sm" onClick={onSaveVcConfig} disabled={vcSaving} className="gap-1.5">
            {vcSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle2 className="h-3.5 w-3.5" />}
            {isRu ? "Сохранить VC" : "Save VC"}
          </Button>
        )}
      </div>

      {selectedChar ? (
        <VoiceConversionTab
          isRu={isRu}
          characterName={selectedChar.name}
          characterId={selectedChar.id}
          voiceConfig={selectedChar.voice_config}
          onUpdateVcConfig={onUpdateVcConfig}
          ttsProvider={(selectedChar.voice_config.provider as string) || "yandex"}
          buildTtsRequest={buildTtsRequest}
        />
      ) : (
        <div className="flex items-center justify-center h-64 text-muted-foreground">
          <div className="text-center space-y-2">
            <Zap className="h-10 w-10 mx-auto text-muted-foreground/30" />
            <p className="text-sm">{isRu ? "Выберите персонажа для настройки Voice Conversion" : "Select a character to configure Voice Conversion"}</p>
          </div>
        </div>
      )}
    </div>
  );
}
