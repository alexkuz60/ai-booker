/**
 * ImpulsesSection — Impulse response management in user's Storage tab.
 * Lists user's own + public impulses, allows upload and delete of own.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Loader2, Upload, Trash2, ChevronDown, ChevronRight, FolderClosed, Waves, Play, Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

/* ─── Constants ──────────────────────────────────────────────────────────── */

const CATEGORIES = ["hall", "room", "plate", "chamber", "spring", "outdoor", "special"] as const;
type ImpulseCategory = (typeof CATEGORIES)[number];

const CAT_LABELS: Record<string, Record<ImpulseCategory, string>> = {
  ru: { hall: "Зал", room: "Комната", plate: "Пластина", chamber: "Камера", spring: "Пружина", outdoor: "Открытое пространство", special: "Спецэффект" },
  en: { hall: "Hall", room: "Room", plate: "Plate", chamber: "Chamber", spring: "Spring", outdoor: "Outdoor", special: "Special" },
};

/* ─── Types ──────────────────────────────────────────────────────────────── */

interface ImpulseRow {
  id: string;
  name: string;
  category: string;
  file_path: string;
  duration_ms: number;
  description: string | null;
  uploaded_by: string;
  is_public: boolean;
  created_at: string;
}

interface ImpulsesSectionProps {
  isRu: boolean;
  userId: string;
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function ImpulsesSection({ isRu, userId }: ImpulsesSectionProps) {
  const lang = isRu ? "ru" : "en";
  const [impulses, setImpulses] = useState<ImpulseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Upload form
  const [showUpload, setShowUpload] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState<ImpulseCategory>("hall");
  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<ImpulseRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Preview playback
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchImpulses = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("convolution_impulses")
      .select("id, name, category, file_path, duration_ms, description, uploaded_by, is_public, created_at")
      .eq("is_public", true)
      .order("category")
      .order("name");
    setImpulses((data as unknown as ImpulseRow[]) ?? []);
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
      const filePath = `impulses/${userId}/${Date.now()}_${file.name}`;
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
          duration_ms: 0,
          sample_rate: 48000,
          channels: 2,
          uploaded_by: userId,
          is_public: true,
        } as any);
      if (dbErr) throw dbErr;

      toast.success(isRu ? "Импульс загружен" : "Impulse uploaded");
      setName(""); setDescription(""); setFile(null); setCategory("hall");
      setShowUpload(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
      await fetchImpulses();
    } catch (e: any) {
      toast.error(e?.message || "Upload error");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (impulse: ImpulseRow) => {
    setDeletingId(impulse.id);
    try {
      await supabase.storage.from("impulse-responses").remove([impulse.file_path]);
      const { error } = await supabase.from("convolution_impulses").delete().eq("id", impulse.id);
      if (error) throw error;
      toast.success(`«${impulse.name}» ${isRu ? "удалён" : "deleted"}`);
      setImpulses(prev => prev.filter(i => i.id !== impulse.id));
    } catch (e: any) {
      toast.error(e?.message || "Delete error");
    } finally {
      setDeletingId(null);
    }
  };

  const togglePlay = async (impulse: ImpulseRow) => {
    if (playingId === impulse.id) {
      audioRef.current?.pause();
      setPlayingId(null);
      return;
    }
    try {
      const { data } = await supabase.storage
        .from("impulse-responses")
        .createSignedUrl(impulse.file_path, 600);
      if (!data?.signedUrl) return;
      if (audioRef.current) { audioRef.current.pause(); }
      const audio = new Audio(data.signedUrl);
      audio.onended = () => setPlayingId(null);
      audioRef.current = audio;
      await audio.play();
      setPlayingId(impulse.id);
    } catch {
      toast.error(isRu ? "Ошибка воспроизведения" : "Playback error");
    }
  };

  const ownCount = impulses.filter(i => i.uploaded_by === userId).length;

  return (
    <>
      <div className="border rounded-md overflow-hidden">
        <Collapsible open={!collapsed} onOpenChange={() => setCollapsed(c => !c)}>
          <div className="flex items-center border-b border-border">
            <CollapsibleTrigger asChild>
              <button className="flex-1 flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors text-cyan-400 border-cyan-400/30">
                {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
                <Waves className="h-5 w-5 shrink-0" />
                <span className="text-base font-semibold">{isRu ? "Импульсы (IR)" : "Impulses (IR)"}</span>
                <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">{impulses.length}</Badge>
                {ownCount > 0 && (
                  <span className="text-xs text-muted-foreground ml-1">
                    ({isRu ? `своих: ${ownCount}` : `own: ${ownCount}`})
                  </span>
                )}
              </button>
            </CollapsibleTrigger>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 mr-2 shrink-0"
                  onClick={() => setShowUpload(v => !v)}
                >
                  <Upload className="h-4 w-4" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isRu ? "Загрузить импульс" : "Upload impulse"}</TooltipContent>
            </Tooltip>
          </div>

          <CollapsibleContent>
            {/* Upload form */}
            {showUpload && (
              <div className="px-4 py-3 border-b border-border bg-muted/20 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label className="text-xs">{isRu ? "Название" : "Name"}</Label>
                    <Input value={name} onChange={e => setName(e.target.value)} placeholder={isRu ? "Концертный зал" : "Concert Hall"} className="h-8 text-sm" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">{isRu ? "Категория" : "Category"}</Label>
                    <Select value={category} onValueChange={v => setCategory(v as ImpulseCategory)}>
                      <SelectTrigger className="h-8 text-sm"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {CATEGORIES.map(c => (
                          <SelectItem key={c} value={c}>{CAT_LABELS[lang][c]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1 sm:col-span-2">
                    <Label className="text-xs">{isRu ? "Описание" : "Description"}</Label>
                    <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={isRu ? "Необязательно" : "Optional"} className="h-8 text-sm" />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <Input
                    ref={fileInputRef}
                    type="file"
                    accept=".wav,.flac,.ogg,.mp3"
                    onChange={e => setFile(e.target.files?.[0] || null)}
                    className="h-8 text-sm flex-1"
                  />
                  <Button size="sm" onClick={handleUpload} disabled={uploading || !file || !name.trim()}>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-1" /> : <Upload className="h-4 w-4 mr-1" />}
                    {isRu ? "Загрузить" : "Upload"}
                  </Button>
                </div>
              </div>
            )}

            {/* List */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : impulses.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                <FolderClosed className="h-4 w-4 mr-2 opacity-40" />
                {isRu ? "Нет импульсов" : "No impulses"}
              </div>
            ) : (
              <div className="divide-y divide-border max-h-80 overflow-y-auto">
                {impulses.map(imp => {
                  const isOwn = imp.uploaded_by === userId;
                  return (
                    <div
                      key={imp.id}
                      className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
                    >
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 shrink-0"
                        onClick={() => togglePlay(imp)}
                      >
                        {playingId === imp.id
                          ? <Square className="h-3 w-3 fill-current" />
                          : <Play className="h-3 w-3 fill-current" />}
                      </Button>
                      <span className="text-sm truncate flex-1 min-w-0">{imp.name}</span>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {CAT_LABELS[lang][imp.category as ImpulseCategory] || imp.category}
                      </Badge>
                      {imp.description && (
                        <span className="text-[10px] text-muted-foreground truncate max-w-[120px] hidden sm:block" title={imp.description}>
                          {imp.description}
                        </span>
                      )}
                      {imp.created_at && (
                        <span className="text-xs text-muted-foreground shrink-0 hidden md:block">
                          {format(new Date(imp.created_at), "dd.MM.yy")}
                        </span>
                      )}
                      {isOwn && (
                        <Badge variant="secondary" className="text-[9px] h-4 px-1 shrink-0">
                          {isRu ? "моё" : "mine"}
                        </Badge>
                      )}
                      {isOwn && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className={cn(
                            "h-7 w-7 text-destructive hover:text-destructive shrink-0",
                            "opacity-0 group-hover:opacity-100 transition-opacity"
                          )}
                          disabled={deletingId === imp.id}
                          onClick={() => setDeleteTarget(imp)}
                        >
                          {deletingId === imp.id
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <Trash2 className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CollapsibleContent>
        </Collapsible>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRu ? "Удалить импульс?" : "Delete impulse?"}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRu
                ? `«${deleteTarget?.name}» будет удалён безвозвратно.`
                : `"${deleteTarget?.name}" will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRu ? "Отмена" : "Cancel"}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => {
                if (deleteTarget) {
                  handleDelete(deleteTarget);
                  setDeleteTarget(null);
                }
              }}
            >
              {isRu ? "Удалить" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
