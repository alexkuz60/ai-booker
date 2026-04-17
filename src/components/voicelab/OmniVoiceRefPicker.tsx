/**
 * OmniVoiceRefPicker — Reference audio picker for OmniVoice Cloning.
 *
 * Three sources:
 *   1. Upload (file from disk)
 *   2. My Collection (OPFS vc-references/)
 *   3. Booker Collection (Supabase voice_references table, public)
 *
 * Selecting a non-upload entry resolves the audio Blob and any cached transcript:
 *   - OPFS: read directly from `vc-references/{id}.json` + `.wav`
 *   - DB:   download to OPFS on first use; transcript is pulled from
 *           `voice_references.transcript` and cached locally.
 *
 * The parent receives the prepared audio (already converted to 24 kHz mono WAV
 * if the source differs) plus an optional transcript.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Upload, FolderOpen, Library, CheckCircle2, AudioLines } from "lucide-react";
import { toast } from "sonner";
import {
  type VcReferenceEntry,
  listVcReferences,
  readVcReferenceBlob,
  readVcReferenceMeta,
  saveVcReference,
  hasVcReference,
  updateVcReferenceMeta,
} from "@/lib/vcReferenceCache";
import { prepareRefAudioForOmniVoice } from "@/lib/omniVoiceAudioPrep";

export interface OmniVoicePickedRef {
  /** WAV blob ready for /v1/audio/speech/clone (24 kHz mono if conversion ran). */
  blob: Blob;
  fileName: string;
  /** Cached transcript (may be empty — caller can run STT). */
  transcript: string;
  /** Stable id when the source is a saved reference; undefined for one-off uploads. */
  refId?: string;
  /** Original source category for UI display. */
  source: "upload" | "opfs" | "collection";
  /** True when conversion to 24 kHz mono actually ran. */
  converted: boolean;
}

interface CollectionRow {
  id: string;
  name: string;
  category: string;
  language: string;
  duration_ms: number;
  transcript: string | null;
}

interface Props {
  isRu: boolean;
  selectedId: string | null;
  onPick: (ref: OmniVoicePickedRef) => void;
  /** Persist transcript back to OPFS / DB when the user transcribes. */
  onTranscriptResolved?: (refId: string, source: "opfs" | "collection", transcript: string) => Promise<void>;
}

export function OmniVoiceRefPicker({ isRu, selectedId, onPick }: Props) {
  const [tab, setTab] = useState<"upload" | "opfs" | "collection">("upload");
  const [opfsRefs, setOpfsRefs] = useState<VcReferenceEntry[]>([]);
  const [collection, setCollection] = useState<CollectionRow[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refreshOpfs = useCallback(async () => {
    setOpfsRefs(await listVcReferences());
  }, []);

  const refreshCollection = useCallback(async () => {
    const { data, error } = await supabase
      .from("voice_references")
      .select("id, name, category, language, duration_ms, transcript")
      .eq("is_public", true)
      .order("name");
    if (error) {
      console.warn("[OmniVoiceRefPicker] Collection load failed:", error.message);
      return;
    }
    setCollection((data as CollectionRow[]) || []);
  }, []);

  useEffect(() => {
    refreshOpfs();
    refreshCollection();
  }, [refreshOpfs, refreshCollection]);

  // ── Upload flow ───────────────────────────────────
  const handleFileChosen = useCallback(async (file: File) => {
    setBusyId("upload");
    try {
      const prepared = await prepareRefAudioForOmniVoice(file, file.name);
      onPick({
        blob: prepared.blob,
        fileName: prepared.fileName,
        transcript: "",
        source: "upload",
        converted: prepared.converted,
      });
      if (prepared.converted) {
        toast.success(isRu
          ? `Конвертировано в 24kHz mono WAV (${prepared.fileName})`
          : `Converted to 24kHz mono WAV (${prepared.fileName})`);
      }
    } catch (err: any) {
      console.error("[OmniVoiceRefPicker] decode error:", err);
      toast.error(err?.message ?? String(err));
    } finally {
      setBusyId(null);
    }
  }, [isRu, onPick]);

  // ── OPFS pick ─────────────────────────────────────
  const handlePickOpfs = useCallback(async (entry: VcReferenceEntry) => {
    setBusyId(entry.id);
    try {
      const blob = await readVcReferenceBlob(entry.id);
      if (!blob) throw new Error(isRu ? "Файл не найден в OPFS" : "File not found in OPFS");
      const prepared = await prepareRefAudioForOmniVoice(blob, `${entry.name || entry.id}.wav`);
      onPick({
        blob: prepared.blob,
        fileName: prepared.fileName,
        transcript: entry.transcript ?? "",
        refId: entry.id,
        source: "opfs",
        converted: prepared.converted,
      });
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setBusyId(null);
    }
  }, [isRu, onPick]);

  // ── Collection pick (download + cache + pick) ─────
  const handlePickCollection = useCallback(async (row: CollectionRow) => {
    setBusyId(row.id);
    try {
      let blob: Blob | null = null;

      if (await hasVcReference(row.id)) {
        blob = await readVcReferenceBlob(row.id);
      }

      if (!blob) {
        // Fetch metadata + signed URL
        const { data: refRow, error: refErr } = await supabase
          .from("voice_references")
          .select("file_path, duration_ms, sample_rate, transcript, category")
          .eq("id", row.id)
          .single();
        if (refErr || !refRow) throw new Error(refErr?.message ?? "Ref not found");

        const { data: signed } = await supabase.storage
          .from("voice-references")
          .createSignedUrl(refRow.file_path, 120);
        if (!signed?.signedUrl) throw new Error("Signed URL failed");

        const resp = await fetch(signed.signedUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        blob = await resp.blob();

        const entry: VcReferenceEntry = {
          id: row.id,
          name: row.name,
          source: "collection",
          sourceId: row.id,
          category: refRow.category,
          durationMs: refRow.duration_ms,
          sampleRate: refRow.sample_rate,
          sizeBytes: blob.size,
          addedAt: new Date().toISOString(),
          transcript: refRow.transcript ?? row.transcript ?? undefined,
        };
        await saveVcReference(row.id, blob, entry);
        await refreshOpfs();
      }

      // Always pick up transcript: prefer OPFS meta (may have been edited locally),
      // fall back to the DB row we already have.
      const meta = await readVcReferenceMeta(row.id);
      const transcript = meta?.transcript ?? row.transcript ?? "";

      // If OPFS lacked transcript but DB has one — sync into OPFS for offline reuse.
      if (meta && !meta.transcript && row.transcript) {
        await updateVcReferenceMeta(row.id, { transcript: row.transcript });
      }

      const prepared = await prepareRefAudioForOmniVoice(blob, `${row.name || row.id}.wav`);
      onPick({
        blob: prepared.blob,
        fileName: prepared.fileName,
        transcript,
        refId: row.id,
        source: "collection",
        converted: prepared.converted,
      });
    } catch (err: any) {
      toast.error(err?.message ?? String(err));
    } finally {
      setBusyId(null);
    }
  }, [onPick, refreshOpfs]);

  const formatDuration = (ms: number) => {
    if (!ms) return "—";
    const sec = Math.round(ms / 1000);
    return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
  };

  // Сортируем: голоса с транскриптом — выше (готовы к Cloning без STT).
  const sortedCollection = useMemo(
    () => [...collection].sort((a, b) => {
      const ax = a.transcript ? 0 : 1;
      const bx = b.transcript ? 0 : 1;
      if (ax !== bx) return ax - bx;
      return a.name.localeCompare(b.name);
    }),
    [collection],
  );

  return (
    <div className="space-y-2">
      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList className="grid grid-cols-3 w-full h-8">
          <TabsTrigger value="upload" className="text-xs gap-1">
            <Upload className="w-3 h-3" />
            {isRu ? "Загрузить" : "Upload"}
          </TabsTrigger>
          <TabsTrigger value="opfs" className="text-xs gap-1">
            <FolderOpen className="w-3 h-3" />
            {isRu ? "Моя коллекция" : "My collection"}
            {opfsRefs.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1 py-0 text-[9px] h-4">{opfsRefs.length}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="collection" className="text-xs gap-1">
            <Library className="w-3 h-3" />
            {isRu ? "Букеровская" : "Booker"}
            {collection.length > 0 && (
              <Badge variant="secondary" className="ml-1 px-1 py-0 text-[9px] h-4">{collection.length}</Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="upload" className="mt-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={busyId === "upload"}
            className="w-full"
          >
            {busyId === "upload"
              ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
              : <Upload className="w-3 h-3 mr-1" />}
            {isRu ? "Выбрать файл с диска" : "Choose file from disk"}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/*"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = "";
              if (f) handleFileChosen(f);
            }}
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            {isRu
              ? "Любой формат. Будет сконвертирован в 24kHz mono WAV перед отправкой."
              : "Any format. Will be converted to 24kHz mono WAV before sending."}
          </p>
        </TabsContent>

        <TabsContent value="opfs" className="mt-2">
          {opfsRefs.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              {isRu
                ? "Локальная коллекция пуста. Загрузите референсы во вкладке References."
                : "Local collection is empty. Upload references on the References tab."}
            </p>
          ) : (
            <ScrollArea className="h-[180px] rounded border border-border/40">
              <div className="p-1 space-y-0.5">
                {opfsRefs.map((r) => {
                  const isSelected = selectedId === r.id;
                  const isBusy = busyId === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => handlePickOpfs(r)}
                      disabled={isBusy}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-accent/60 transition-colors ${isSelected ? "bg-accent" : ""}`}
                    >
                      {isBusy
                        ? <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        : isSelected
                          ? <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                          : <AudioLines className="w-3 h-3 text-muted-foreground shrink-0" />}
                      <span className="text-xs font-medium truncate flex-1">{r.name}</span>
                      <span className="text-[10px] text-muted-foreground tabular-nums">{formatDuration(r.durationMs)}</span>
                      {r.transcript && (
                        <Badge variant="outline" className="px-1 py-0 text-[9px] h-4">T</Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>

        <TabsContent value="collection" className="mt-2">
          {sortedCollection.length === 0 ? (
            <p className="text-xs text-muted-foreground py-3 text-center">
              {isRu ? "Коллекция пуста." : "Collection is empty."}
            </p>
          ) : (
            <ScrollArea className="h-[180px] rounded border border-border/40">
              <div className="p-1 space-y-0.5">
                {sortedCollection.map((r) => {
                  const isSelected = selectedId === r.id;
                  const isBusy = busyId === r.id;
                  return (
                    <button
                      key={r.id}
                      onClick={() => handlePickCollection(r)}
                      disabled={isBusy}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left hover:bg-accent/60 transition-colors ${isSelected ? "bg-accent" : ""}`}
                    >
                      {isBusy
                        ? <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                        : isSelected
                          ? <CheckCircle2 className="w-3 h-3 text-primary shrink-0" />
                          : <AudioLines className="w-3 h-3 text-muted-foreground shrink-0" />}
                      <span className="text-xs font-medium truncate flex-1">{r.name}</span>
                      <Badge variant="outline" className="px-1 py-0 text-[9px] h-4 shrink-0">{r.category}</Badge>
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">{formatDuration(r.duration_ms)}</span>
                      {r.transcript && (
                        <Badge variant="outline" className="px-1 py-0 text-[9px] h-4 shrink-0" title={isRu ? "Есть транскрипт" : "Has transcript"}>T</Badge>
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
