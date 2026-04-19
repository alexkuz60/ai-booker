/**
 * OmniVoiceCloningControls — ref picker + active ref badge + STT + transcript field.
 *
 * STT routing:
 *   - useLocalStt=true  → in-browser Whisper (Xenova/whisper-base) via
 *                         `transcribeBlob`. Lazily downloads ~80 MB on first use.
 *   - useLocalStt=false → POSTs the blob to `${requestBaseUrl}/v1/audio/transcriptions`
 *                         (OmniVoice / OpenAI-compatible Whisper server).
 */
import { useCallback, useState } from "react";
import { Loader2, Mic } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { OmniVoiceRefPicker, type OmniVoicePickedRef } from "@/components/voicelab/OmniVoiceRefPicker";
import { updateVcReferenceMeta } from "@/lib/vcReferenceCache";
import { transcribeBlob, loadWhisper } from "@/lib/vocoloco/whisperStt";

interface Props {
  isRu: boolean;
  requestBaseUrl: string;
  refAudioBlob: Blob | null;
  refAudioName: string;
  refTranscript: string;
  refPickedId: string | null;
  refSource: "upload" | "opfs" | "collection" | null;
  onPicked: (picked: OmniVoicePickedRef) => void;
  onTranscriptChange: (value: string) => void;
  /** When true, transcribe locally via Whisper ONNX (no server needed). */
  useLocalStt: boolean;
}

export function OmniVoiceCloningControls({
  isRu, requestBaseUrl, refAudioBlob, refAudioName, refTranscript,
  refPickedId, refSource, onPicked, onTranscriptChange, useLocalStt,
}: Props) {
  const [transcribing, setTranscribing] = useState(false);

  const handleTranscribeRef = useCallback(async () => {
    if (!refAudioBlob) {
      toast.error(isRu ? "Сначала выберите референсное аудио" : "Pick reference audio first");
      return;
    }
    setTranscribing(true);
    try {
      let recognized = "";
      if (useLocalStt) {
        // Warm Whisper if not already loaded — first call may take ~10-30s
        // (download + WebGPU compile). Subsequent calls are fast.
        await loadWhisper();
        recognized = (await transcribeBlob(refAudioBlob, isRu ? "ru" : "auto")).trim();
      } else {
        const form = new FormData();
        form.append("file", refAudioBlob, refAudioName || "reference.wav");
        form.append("model", "whisper-1");
        form.append("response_format", "json");

        const res = await fetch(`${requestBaseUrl}/v1/audio/transcriptions`, { method: "POST", body: form });
        if (!res.ok) {
          const errText = await res.text().catch(() => "");
          throw new Error(`HTTP ${res.status}: ${errText || "STT error"}`);
        }
        const data = await res.json().catch(() => null) as { text?: string } | null;
        recognized = (data?.text ?? "").trim();
      }
      if (!recognized) {
        throw new Error(isRu ? "Распознан пустой текст" : "Empty transcript");
      }
      onTranscriptChange(recognized);

      if (refPickedId && (refSource === "opfs" || refSource === "collection")) {
        await updateVcReferenceMeta(refPickedId, { transcript: recognized });
      }
      toast.success(isRu ? `Распознано (${recognized.length} симв.)` : `Recognized (${recognized.length} chars)`);
    } catch (err: any) {
      console.error("[omnivoice] STT error:", err);
      toast.error(err?.message ?? String(err));
    } finally {
      setTranscribing(false);
    }
  }, [refAudioBlob, refAudioName, requestBaseUrl, isRu, refPickedId, refSource, onTranscriptChange, useLocalStt]);


  const persistTranscriptEdit = useCallback(async () => {
    if (!refPickedId || !refTranscript.trim()) return;
    if (refSource === "opfs" || refSource === "collection") {
      await updateVcReferenceMeta(refPickedId, { transcript: refTranscript.trim() });
      toast.success(isRu ? "Транскрипт сохранён" : "Transcript saved");
    }
  }, [refPickedId, refTranscript, refSource, isRu]);

  const sourceLabel =
    refSource === "upload" ? (isRu ? "Файл" : "File")
      : refSource === "opfs" ? (isRu ? "Моя" : "Mine")
      : refSource === "collection" ? (isRu ? "Букеровская" : "Booker")
      : "";

  return (
    <div className="space-y-3">
      <OmniVoiceRefPicker isRu={isRu} selectedId={refPickedId} onPick={onPicked} />

      <div className="flex items-center gap-2 flex-wrap">
        {refAudioName ? (
          <Badge variant="secondary" className="gap-1 text-[10px]">
            <Mic className="w-3 h-3" />
            {sourceLabel}: {refAudioName}
          </Badge>
        ) : (
          <span className="text-[10px] text-muted-foreground">
            {isRu ? "Референс не выбран" : "No reference selected"}
          </span>
        )}
        <Button
          size="sm"
          variant="outline"
          onClick={handleTranscribeRef}
          disabled={!refAudioBlob || transcribing}
          title={isRu ? "Распознать речь в референсе (STT)" : "Transcribe reference audio (STT)"}
        >
          {transcribing
            ? <Loader2 className="w-3 h-3 mr-1 animate-spin" />
            : <Mic className="w-3 h-3 mr-1" />}
          {isRu ? "Распознать" : "Transcribe"}
        </Button>
        {refPickedId && refTranscript.trim() && (
          <Button
            size="sm"
            variant="ghost"
            onClick={persistTranscriptEdit}
            title={isRu ? "Сохранить транскрипт в коллекцию" : "Save transcript to collection"}
          >
            {isRu ? "💾 Сохранить" : "💾 Save"}
          </Button>
        )}
      </div>

      <div>
        <Label className="text-xs">
          {isRu ? "Транскрипт референса" : "Reference transcript"}
        </Label>
        <Textarea
          value={refTranscript}
          onChange={(e) => onTranscriptChange(e.target.value)}
          placeholder={isRu ? "Текст, произносимый в референсном аудио..." : "Text spoken in the reference audio..."}
          rows={2}
          className="mt-1 text-sm"
        />
        <p className="text-xs text-muted-foreground mt-1">
          {isRu
            ? "Подтянется автоматически если у референса есть сохранённый транскрипт. Иначе — нажмите «Распознать»."
            : "Auto-filled when the reference has a saved transcript. Otherwise click «Transcribe»."}
        </p>
      </div>
    </div>
  );
}
