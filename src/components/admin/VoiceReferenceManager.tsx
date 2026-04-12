/**
 * VoiceReferenceManager — Admin UI for uploading and managing voice reference samples.
 * Pattern mirrors ImpulseManager for consistency.
 */
import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Upload, Trash2, Mic, Play, Square, AudioLines } from "lucide-react";

const CATEGORIES = ["male", "female", "child", "elderly", "character"] as const;
type VoiceCategory = typeof CATEGORIES[number];

const categoryLabels: Record<string, Record<VoiceCategory, string>> = {
  ru: { male: "Мужской", female: "Женский", child: "Детский", elderly: "Пожилой", character: "Характерный" },
  en: { male: "Male", female: "Female", child: "Child", elderly: "Elderly", character: "Character" },
};

const LANGUAGES = ["ru", "en", "multi"] as const;
const langLabels: Record<string, Record<string, string>> = {
  ru: { ru: "Русский", en: "Английский", multi: "Мультиязычный" },
  en: { ru: "Russian", en: "English", multi: "Multilingual" },
};

interface VoiceRef {
  id: string;
  name: string;
  description: string | null;
  category: string;
  language: string;
  file_path: string;
  duration_ms: number;
  sample_rate: number;
  channels: number;
  is_public: boolean;
  tags: string[];
  created_at: string;
}

interface VoiceReferenceManagerProps {
  isRu: boolean;
}

export function VoiceReferenceManager({ isRu }: VoiceReferenceManagerProps) {
  const lang = isRu ? "ru" : "en";
  const [voices, setVoices] = useState<VoiceRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [audioEl, setAudioEl] = useState<HTMLAudioElement | null>(null);

  // Form state
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<VoiceCategory>("male");
  const [voiceLang, setVoiceLang] = useState<string>("ru");
  const [tagsStr, setTagsStr] = useState("");
  const [file, setFile] = useState<File | null>(null);

  const fetchVoices = useCallback(async () => {
    const { data, error } = await supabase
      .from("voice_references")
      .select("*")
      .order("created_at", { ascending: false });
    if (error) toast.error(error.message);
    else setVoices((data as unknown as VoiceRef[]) || []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchVoices(); }, [fetchVoices]);

  const handleUpload = async () => {
    if (!file || !name.trim()) {
      toast.error(isRu ? "Укажите название и выберите файл" : "Enter a name and select a file");
      return;
    }

    const ext = file.name.split(".").pop()?.toLowerCase();
    if (!["wav", "mp3", "ogg", "flac"].includes(ext || "")) {
      toast.error(isRu ? "Поддерживаются WAV, MP3, OGG, FLAC" : "Supported: WAV, MP3, OGG, FLAC");
      return;
    }

    setUploading(true);
    try {
      let durationMs = 0;
      let sampleRate = 48000;
      let channels = 1;
      try {
        const arrayBuf = await file.arrayBuffer();
        const audioCtx = new AudioContext();
        const decoded = await audioCtx.decodeAudioData(arrayBuf);
        durationMs = Math.round(decoded.duration * 1000);
        sampleRate = decoded.sampleRate;
        channels = decoded.numberOfChannels;
        audioCtx.close();
      } catch {
        console.warn("Could not decode audio metadata");
      }

      const filePath = `voices/${Date.now()}_${file.name}`;

      const { error: storageErr } = await supabase.storage
        .from("voice-references")
        .upload(filePath, file, { contentType: file.type, upsert: false });
      if (storageErr) throw storageErr;

      const tags = tagsStr.split(",").map(t => t.trim()).filter(Boolean);

      const { error: dbErr } = await supabase
        .from("voice_references")
        .insert({
          name: name.trim(),
          description: description.trim() || null,
          category,
          language: voiceLang,
          file_path: filePath,
          duration_ms: durationMs,
          sample_rate: sampleRate,
          channels,
          uploaded_by: (await supabase.auth.getUser()).data.user?.id,
          is_public: true,
          tags,
        } as any);
      if (dbErr) throw dbErr;

      toast.success(isRu ? "Голосовой сэмпл загружен" : "Voice sample uploaded");
      setName(""); setDescription(""); setFile(null); setCategory("male"); setTagsStr("");
      const fileInput = document.getElementById("voice-ref-file-input") as HTMLInputElement;
      if (fileInput) fileInput.value = "";
      await fetchVoices();
    } catch (e: any) {
      toast.error(e?.message || "Upload error");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (voice: VoiceRef) => {
    if (!confirm(isRu ? `Удалить "${voice.name}"?` : `Delete "${voice.name}"?`)) return;
    try {
      await supabase.storage.from("voice-references").remove([voice.file_path]);
      const { error } = await supabase.from("voice_references").delete().eq("id", voice.id);
      if (error) throw error;
      toast.success(isRu ? "Удалено" : "Deleted");
      await fetchVoices();
    } catch (e: any) {
      toast.error(e?.message || "Delete error");
    }
  };

  const handlePlay = async (voice: VoiceRef) => {
    if (playingId === voice.id) {
      audioEl?.pause();
      setPlayingId(null);
      return;
    }
    try {
      const { data } = await supabase.storage
        .from("voice-references")
        .createSignedUrl(voice.file_path, 300);
      if (!data?.signedUrl) throw new Error("No URL");
      
      audioEl?.pause();
      const el = new Audio(data.signedUrl);
      el.onended = () => setPlayingId(null);
      el.play();
      setAudioEl(el);
      setPlayingId(voice.id);
    } catch (e: any) {
      toast.error(e?.message || "Playback error");
    }
  };

  const formatDuration = (ms: number) => {
    if (!ms) return "—";
    const sec = Math.round(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };

  return (
    <div className="space-y-6">
      {/* Upload form */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <Upload className="h-5 w-5 text-primary" />
          <CardTitle className="font-display text-base">
            {isRu ? "Загрузить голосовой референс" : "Upload Voice Reference"}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label>{isRu ? "Название голоса" : "Voice Name"}</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder={isRu ? "Детектив Холмс" : "Detective Holmes"} />
            </div>
            <div className="space-y-2">
              <Label>{isRu ? "Категория" : "Category"}</Label>
              <Select value={category} onValueChange={v => setCategory(v as VoiceCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c} value={c}>{categoryLabels[lang][c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{isRu ? "Язык" : "Language"}</Label>
              <Select value={voiceLang} onValueChange={setVoiceLang}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {LANGUAGES.map(l => (
                    <SelectItem key={l} value={l}>{langLabels[lang][l]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>{isRu ? "Теги (через запятую)" : "Tags (comma-separated)"}</Label>
              <Input value={tagsStr} onChange={e => setTagsStr(e.target.value)} placeholder={isRu ? "баритон, спокойный" : "baritone, calm"} />
            </div>
            <div className="space-y-2 sm:col-span-2">
              <Label>{isRu ? "Описание" : "Description"}</Label>
              <Textarea value={description} onChange={e => setDescription(e.target.value)} placeholder={isRu ? "Глубокий баритон, аналитичный тон..." : "Deep baritone, analytical tone..."} rows={2} />
            </div>
            <div className="space-y-2">
              <Label>{isRu ? "Аудио файл (15-30 сек, WAV/MP3)" : "Audio file (15-30 sec, WAV/MP3)"}</Label>
              <Input
                id="voice-ref-file-input"
                type="file"
                accept=".wav,.mp3,.ogg,.flac"
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

      {/* Collection */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <AudioLines className="h-5 w-5 text-primary" />
          <CardTitle className="font-display text-base">
            {isRu ? "Коллекция голосов" : "Voice Collection"}
            <Badge variant="secondary" className="ml-2 text-xs">{voices.length}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-primary" />
            </div>
          ) : voices.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground text-sm">
              <Mic className="h-8 w-8 mx-auto mb-2 opacity-30" />
              {isRu ? "Нет загруженных голосов" : "No voice samples uploaded"}
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[40px]" />
                  <TableHead>{isRu ? "Название" : "Name"}</TableHead>
                  <TableHead>{isRu ? "Категория" : "Category"}</TableHead>
                  <TableHead>{isRu ? "Язык" : "Lang"}</TableHead>
                  <TableHead>{isRu ? "Длит." : "Dur."}</TableHead>
                  <TableHead>{isRu ? "Теги" : "Tags"}</TableHead>
                  <TableHead className="w-[70px] text-center">{isRu ? "Публ." : "Public"}</TableHead>
                  <TableHead className="w-[50px]" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {voices.map(v => (
                  <TableRow key={v.id}>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePlay(v)}>
                        {playingId === v.id
                          ? <Square className="h-3.5 w-3.5 text-primary" />
                          : <Play className="h-3.5 w-3.5" />}
                      </Button>
                    </TableCell>
                    <TableCell className="font-medium">{v.name}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {categoryLabels[lang][v.category as VoiceCategory] || v.category}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs">
                      {langLabels[lang][v.language] || v.language}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDuration(v.duration_ms)}
                    </TableCell>
                    <TableCell>
                      <div className="flex flex-wrap gap-1">
                        {v.tags?.map(t => (
                          <Badge key={t} variant="secondary" className="text-[10px] px-1.5 py-0">{t}</Badge>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <Checkbox
                        checked={v.is_public}
                        onCheckedChange={async (checked) => {
                          const val = !!checked;
                          const { error } = await supabase
                            .from("voice_references")
                            .update({ is_public: val } as any)
                            .eq("id", v.id);
                          if (error) toast.error(error.message);
                          else setVoices(prev => prev.map(i => i.id === v.id ? { ...i, is_public: val } : i));
                        }}
                      />
                    </TableCell>
                    <TableCell>
                      <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground hover:text-destructive" onClick={() => handleDelete(v)}>
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
