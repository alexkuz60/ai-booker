/**
 * ImpulseManager — Admin UI for uploading and managing convolution impulse response files.
 */

import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Upload, Trash2, Waves, Music, RefreshCw } from "lucide-react";

const CATEGORIES = ["hall", "room", "plate", "chamber", "spring", "outdoor", "special"] as const;
type ImpulseCategory = typeof CATEGORIES[number];

const categoryLabels: Record<string, Record<ImpulseCategory, string>> = {
  ru: { hall: "Зал", room: "Комната", plate: "Пластина", chamber: "Камера", spring: "Пружина", outdoor: "Открытое пространство", special: "Спецэффект" },
  en: { hall: "Hall", room: "Room", plate: "Plate", chamber: "Chamber", spring: "Spring", outdoor: "Outdoor", special: "Special" },
};

interface Impulse {
  id: string;
  name: string;
  description: string | null;
  category: string;
  file_path: string;
  duration_ms: number;
  sample_rate: number;
  channels: number;
  is_public: boolean;
  created_at: string;
  peaks: number[] | null;
}

interface ImpulseManagerProps {
  isRu: boolean;
}

export function ImpulseManager({ isRu }: ImpulseManagerProps) {
  const lang = isRu ? "ru" : "en";
  const [impulses, setImpulses] = useState<Impulse[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [backfilling, setBackfilling] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ImpulseCategory>("hall");
  const [file, setFile] = useState<File | null>(null);

  const fetchImpulses = useCallback(async () => {
    const { data, error } = await supabase
      .from("convolution_impulses")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      toast.error(error.message);
    } else {
      setImpulses((data as unknown as Impulse[]) || []);
    }
    setLoading(false);
  }, []);

  useEffect(() => { fetchImpulses(); }, [fetchImpulses]);

  const handleUpload = async () => {
    if (!file || !name.trim()) {
      toast.error(isRu ? "Укажите название и выберите файл" : "Enter a name and select a file");
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["wav", "flac", "ogg", "mp3"].includes(ext || "")) {
      toast.error(isRu ? "Поддерживаются WAV, FLAC, OGG, MP3" : "Supported: WAV, FLAC, OGG, MP3");
      return;
    }

    setUploading(true);
    try {
      // Decode audio to extract metadata + peaks
      let durationMs = 0;
      let sampleRate = 48000;
      let channels = 2;
      let peaks: number[] | null = null;
      try {
        const { computePeaks } = await import("@/lib/irPeaks");
        const arrayBuf = await file.arrayBuffer();
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        durationMs = Math.round(decoded.duration * 1000);
        sampleRate = decoded.sampleRate;
        channels = decoded.numberOfChannels;
        peaks = computePeaks(decoded);
        audioCtx.close();
      } catch {
        console.warn("Could not decode audio metadata, using defaults");
      }

      const filePath = `impulses/${Date.now()}_${file.name}`;

      const { error: storageErr } = await supabase.storage
        .from("impulse-responses")
        .upload(filePath, file, { contentType: file.type, upsert: false });
      if (storageErr) throw storageErr;

      const { error: dbErr } = await supabase
        .from("convolution_impulses")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          category,
          file_path: filePath,
          duration_ms: durationMs,
          sample_rate: sampleRate,
          channels,
          uploaded_by: (await supabase.auth.getUser()).data.user?.id,
          is_public: true,
          peaks,
        } as any);
      if (dbErr) throw dbErr;

      toast.success(isRu ? "Импульс загружен" : "Impulse uploaded");
      setName(""); setDescription(""); setFile(null); setCategory("hall");
      const fileInput = document.getElementById("impulse-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      await fetchImpulses();
    } catch (e: any) {
      toast.error(e?.message || "Upload error");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (impulse: Impulse) => {
    if (!confirm(isRu ? `Удалить "${impulse.name}"?` : `Delete "${impulse.name}"?`)) return;
    try {
      const { error: storageErr } = await supabase.storage
        .from("impulse-responses")
        .remove([impulse.file_path]);
      if (storageErr) console.warn("Storage delete warn:", storageErr.message);

      const { error: dbErr } = await supabase
        .from("convolution_impulses")
        .delete()
        .eq("id", impulse.id);
      if (dbErr) throw dbErr;

      toast.success(isRu ? "Удалено" : "Deleted");
      await fetchImpulses();
    } catch (e: any) {
      toast.error(e?.message || "Delete error");
    }
  };

  /* ─── Backfill Peaks ─────────────────────────────────────────────────── */

  const handleBackfillPeaks = async () => {
    const missing = impulses.filter(i => !i.peaks || (i.peaks as any[]).length === 0);
    if (missing.length === 0) {
      toast.info(isRu ? "Все импульсы уже имеют peaks" : "All impulses already have peaks");
      return;
    }

    setBackfilling(true);
    let done = 0;
    let errors = 0;

    for (const imp of missing) {
      setBackfillProgress(`${done + 1}/${missing.length}: ${imp.name}`);
      try {
        const { data: urlData } = await supabase.storage
          .from("impulse-responses")
          .createSignedUrl(imp.file_path, 600);
        if (!urlData?.signedUrl) throw new Error("No signed URL");

        const resp = await fetch(urlData.signedUrl);
        if (!resp.ok) throw new Error(`Fetch ${resp.status}`);
        const arrayBuf = await resp.arrayBuffer();

        const { computePeaks } = await import("@/lib/irPeaks");
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        const peaks = computePeaks(decoded);
        audioCtx.close();

        const { error } = await supabase
          .from("convolution_impulses")
          .update({ peaks } as any)
          .eq("id", imp.id);
        if (error) throw error;
        done++;
      } catch (e: any) {
        console.error(`Backfill failed for ${imp.name}:`, e);
        errors++;
      }
    }

    setBackfilling(false);
    setBackfillProgress("");
    toast.success(
      isRu
        ? `Peaks пересчитаны: ${done} из ${missing.length}${errors ? `, ошибок: ${errors}` : ""}`
        : `Peaks computed: ${done} of ${missing.length}${errors ? `, errors: ${errors}` : ""}`
    );
    await fetchImpulses();
  };

  const missingPeaksCount = impulses.filter(i => !i.peaks || (i.peaks as any[]).length === 0).length;

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <Upload className="h-5 w-5 text-primary" />
          <CardTitle className="font-display text-base">
            {isRu ? "Загрузить импульс" : "Upload Impulse"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{isRu ? "Название" : "Name"}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={isRu ? "Концертный зал" : "Concert Hall"} />
            </div>
            <div className="space-y-2">
              <Label>{isRu ? "Категория" : "Category"}</Label>
              <Select value={category} onValueChange={v => setCategory(v as ImpulseCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{categoryLabels[lang][c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{isRu ? "Описание" : "Description"}</Label>
              <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={isRu ? "Необязательно" : "Optional"} />
            </div>
            <div className="space-y-2">
              <Label>{isRu ? "Файл (WAV, FLAC, OGG, MP3)" : "File (WAV, FLAC, OGG, MP3)"}</Label>
              <Input
                id="impulse-file-input"
                type="file"
                accept=".wav,.flac,.ogg,.mp3"
                onChange={e => setFile(e.target.files?.[0] || null)}
              />
            </div>
            <div className="flex items-end">
              <Button onClick={handleUpload} disabled={uploading || !file || !name.trim()} className="w-full">
                {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                {isRu ? "Загрузить" : "Upload"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Impulses list */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <Waves className="h-5 w-5 text-primary" />
          <CardTitle className="font-display text-base">
            {isRu ? "Коллекция импульсов" : "Impulse Collection"}
            <Badge variant="secondary" className="ml-2 text-xs">{impulses.length}</Badge>
          </CardTitle>
          <div className="ml-auto flex items-center gap-2">
            {backfilling && (
              <span className="text-xs text-muted-foreground truncate max-w-48">{backfillProgress}</span>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={backfilling || missingPeaksCount === 0}
              onClick={handleBackfillPeaks}
              className="shrink-0"
            >
              {backfilling
                ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                : <RefreshCw className="h-3.5 w-3.5 mr-1.5" />}
              {isRu ? "Пересчитать peaks" : "Recompute peaks"}
              {missingPeaksCount > 0 && (
                <Badge variant="destructive" className="ml-1.5 h-5 px-1.5 text-[10px]">{missingPeaksCount}</Badge>
              )}
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : impulses.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Music className="h-8 w-8 mx-auto mb-2 opacity-30" />
              {isRu ? "Нет загруженных импульсов" : "No impulses uploaded"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{isRu ? "Название" : "Name"}</TableHead>
                  <TableHead>{isRu ? "Категория" : "Category"}</TableHead>
                  <TableHead>{isRu ? "Описание" : "Description"}</TableHead>
                  <TableHead className="w-[90px] text-center">{isRu ? "Публичный" : "Public"}</TableHead>
                  <TableHead className="w-[80px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {impulses.map(imp => (
                  <TableRow key={imp.id}>
                    <TableCell className="font-medium">{imp.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {categoryLabels[lang][imp.category as ImpulseCategory] || imp.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm max-w-[200px] truncate">
                      {imp.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(imp)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
