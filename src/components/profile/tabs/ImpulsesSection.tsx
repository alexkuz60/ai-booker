/**
 * ImpulsesSection — Impulse response management in user's Storage tab.
 * Supports batch upload with auto-metadata, inline category/name editing, preview, delete.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  Loader2, Upload, Trash2, ChevronDown, ChevronRight, FolderClosed, Waves,
  Play, Square, Check, Pencil,
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

const VALID_EXTS = ["wav", "flac", "ogg", "mp3"];

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
  sample_rate: number;
  channels: number;
}

interface ImpulsesSectionProps {
  isRu: boolean;
  userId: string;
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function fileToName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, "").replace(/[_-]/g, " ");
}

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  return (ms / 1000).toFixed(1) + "s";
}

/* ─── Component ──────────────────────────────────────────────────────────── */

export function ImpulsesSection({ isRu, userId }: ImpulsesSectionProps) {
  const lang = isRu ? "ru" : "en";
  const [impulses, setImpulses] = useState<ImpulseRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

  // Batch upload
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Delete
  const [deleteTarget, setDeleteTarget] = useState<ImpulseRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Inline editing
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editCategory, setEditCategory] = useState<ImpulseCategory>("hall");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Preview playback
  const [playingId, setPlayingId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const fetchImpulses = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from("convolution_impulses")
      .select("id, name, category, file_path, duration_ms, description, uploaded_by, is_public, created_at, sample_rate, channels")
      .eq("is_public", true)
      .order("category")
      .order("name");
    setImpulses((data as unknown as ImpulseRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { fetchImpulses(); }, [fetchImpulses]);

  /* ─── Batch Upload ─────────────────────────────────────────────────────── */

  const handleBatchUpload = async (fileList: FileList) => {
    const files = Array.from(fileList).filter(f => {
      const ext = f.name.split(".").pop()?.toLowerCase();
      return VALID_EXTS.includes(ext || "");
    });
    if (files.length === 0) {
      toast.error(isRu ? "Нет подходящих файлов (WAV, FLAC, OGG, MP3)" : "No valid files (WAV, FLAC, OGG, MP3)");
      return;
    }

    setUploading(true);
    let uploaded = 0;

    for (const file of files) {
      setUploadProgress(`${uploaded + 1}/${files.length}: ${file.name}`);
      try {
        // Decode metadata
        let durationMs = 0;
        let sampleRate = 48000;
        let channels = 2;
        try {
          const arrayBuf = await file.arrayBuffer();
          const audioCtx = new AudioContext();
          const decoded = await audioCtx.decodeAudioData(arrayBuf);
          durationMs = Math.round(decoded.duration * 1000);
          sampleRate = decoded.sampleRate;
          channels = decoded.numberOfChannels;
          audioCtx.close();
        } catch { /* defaults */ }

        const filePath = `impulses/${userId}/${Date.now()}_${file.name}`;
        const { error: storageErr } = await supabase.storage
          .from("impulse-responses")
          .upload(filePath, file, { contentType: file.type, upsert: false });
        if (storageErr) throw storageErr;

        const { error: dbErr } = await supabase
          .from("convolution_impulses")
          .insert({
            name: fileToName(file.name),
            category: "hall",
            file_path: filePath,
            duration_ms: durationMs,
            sample_rate: sampleRate,
            channels,
            uploaded_by: userId,
            is_public: true,
          } as any);
        if (dbErr) throw dbErr;
        uploaded++;
      } catch (e: any) {
        toast.error(`${file.name}: ${e?.message || "error"}`);
      }
    }

    toast.success(isRu ? `Загружено: ${uploaded} из ${files.length}` : `Uploaded: ${uploaded} of ${files.length}`);
    setUploading(false);
    setUploadProgress("");
    if (fileInputRef.current) fileInputRef.current.value = "";
    await fetchImpulses();
  };

  /* ─── Inline Edit ──────────────────────────────────────────────────────── */

  const startEdit = (imp: ImpulseRow) => {
    setEditingId(imp.id);
    setEditName(imp.name);
    setEditCategory(imp.category as ImpulseCategory);
    setEditDescription(imp.description || "");
  };

  const saveEdit = async () => {
    if (!editingId || !editName.trim()) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from("convolution_impulses")
        .update({
          name: editName.trim(),
          category: editCategory,
          description: editDescription.trim() || null,
        } as any)
        .eq("id", editingId);
      if (error) throw error;
      setImpulses(prev => prev.map(i =>
        i.id === editingId
          ? { ...i, name: editName.trim(), category: editCategory, description: editDescription.trim() || null }
          : i
      ));
      setEditingId(null);
    } catch (e: any) {
      toast.error(e?.message || "Save error");
    } finally {
      setSaving(false);
    }
  };

  /* ─── Delete ───────────────────────────────────────────────────────────── */

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

  /* ─── Playback ─────────────────────────────────────────────────────────── */

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
      if (audioRef.current) audioRef.current.pause();
      const audio = new Audio(data.signedUrl);
      audio.onended = () => setPlayingId(null);
      audioRef.current = audio;
      await audio.play();
      setPlayingId(impulse.id);
    } catch {
      toast.error(isRu ? "Ошибка воспроизведения" : "Playback error");
    }
  };

  /* ─── Render ───────────────────────────────────────────────────────────── */

  const ownCount = impulses.filter(i => i.uploaded_by === userId).length;

  return (
    <>
      <div className="border rounded-md overflow-hidden">
        {/* Hidden batch file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".wav,.flac,.ogg,.mp3"
          className="hidden"
          onChange={e => e.target.files && handleBatchUpload(e.target.files)}
        />

        <Collapsible open={!collapsed} onOpenChange={() => setCollapsed(c => !c)}>
          <div className="flex items-center border-b border-border">
            <CollapsibleTrigger asChild>
              <button className="flex-1 flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors text-accent border-accent/30">
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
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isRu ? "Загрузить импульсы (пакетно)" : "Upload impulses (batch)"}</TooltipContent>
            </Tooltip>
          </div>

          <CollapsibleContent>
            {/* Upload progress */}
            {uploading && (
              <div className="px-4 py-2 border-b border-border bg-muted/20 flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span className="truncate">{uploadProgress}</span>
              </div>
            )}

            {/* List */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : impulses.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
                <FolderClosed className="h-5 w-5 opacity-40" />
                <span>{isRu ? "Нет импульсов" : "No impulses"}</span>
                <Button variant="outline" size="sm" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5 mr-1" />
                  {isRu ? "Загрузить файлы" : "Upload files"}
                </Button>
              </div>
            ) : (
              <div className="divide-y divide-border max-h-96 overflow-y-auto">
                {impulses.map(imp => {
                  const isOwn = imp.uploaded_by === userId;
                  const isEditing = editingId === imp.id;

                  if (isEditing) {
                    return (
                      <div key={imp.id} className="px-4 py-2.5 bg-muted/20 space-y-2">
                        <div className="flex items-center gap-2">
                          <Input
                            value={editName}
                            onChange={e => setEditName(e.target.value)}
                            className="h-7 text-sm flex-1"
                            autoFocus
                            onKeyDown={e => e.key === "Enter" && saveEdit()}
                          />
                          <Select value={editCategory} onValueChange={v => setEditCategory(v as ImpulseCategory)}>
                            <SelectTrigger className="h-7 text-xs w-36">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {CATEGORIES.map(c => (
                                <SelectItem key={c} value={c} className="text-xs">{CAT_LABELS[lang][c]}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2">
                          <Input
                            value={editDescription}
                            onChange={e => setEditDescription(e.target.value)}
                            placeholder={isRu ? "Описание (необязательно)" : "Description (optional)"}
                            className="h-7 text-xs flex-1"
                            onKeyDown={e => e.key === "Enter" && saveEdit()}
                          />
                          <Button size="sm" variant="ghost" className="h-7 px-2" onClick={saveEdit} disabled={saving || !editName.trim()}>
                            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5 text-primary" />}
                          </Button>
                          <Button size="sm" variant="ghost" className="h-7 px-2 text-muted-foreground" onClick={() => setEditingId(null)}>
                            ✕
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={imp.id}
                      className="flex items-center gap-2 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
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
                      <span className="text-[10px] text-muted-foreground shrink-0 hidden sm:block">
                        {formatDuration(imp.duration_ms)}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 hidden md:block">
                        {(imp.sample_rate / 1000).toFixed(0)}kHz
                      </span>
                      {imp.created_at && (
                        <span className="text-xs text-muted-foreground shrink-0 hidden lg:block">
                          {format(new Date(imp.created_at), "dd.MM.yy")}
                        </span>
                      )}
                      {isOwn && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => startEdit(imp)}>
                            <Pencil className="h-3 w-3" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-destructive hover:text-destructive"
                            disabled={deletingId === imp.id}
                            onClick={() => setDeleteTarget(imp)}
                          >
                            {deletingId === imp.id
                              ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </div>
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
