/**
 * OmniVoiceLabPanel — composition root for the OmniVoice tab in VoiceLab.
 *
 * Wires together:
 *   • useOmniVoiceServer       — URL / dev-proxy / health check
 *   • useOmniVoiceSynthesis    — synthesize, play, download, reset
 *   • OmniVoiceRefPicker       — unified reference picker (Upload / OPFS / Collection)
 *
 * Sub-UI is split across `./omnivoice/*` to keep this file small and stable
 * when we add Advanced Generation parameters in a later pass.
 */
import { useState } from "react";
import { Loader2, Wifi, WifiOff, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import type { OmniVoicePickedRef } from "@/components/voicelab/OmniVoiceRefPicker";
import type { SynthMode } from "./omnivoice/constants";
import { useOmniVoiceServer } from "./omnivoice/useOmniVoiceServer";
import { useOmniVoiceSynthesis } from "./omnivoice/useOmniVoiceSynthesis";
import { OmniVoiceServerCard } from "./omnivoice/OmniVoiceServerCard";
import { OmniVoiceModeSelector } from "./omnivoice/OmniVoiceModeSelector";
import { OmniVoiceDesignControls } from "./omnivoice/OmniVoiceDesignControls";
import { OmniVoiceCloningControls } from "./omnivoice/OmniVoiceCloningControls";
import { OmniVoiceTextEditor } from "./omnivoice/OmniVoiceTextEditor";
import { OmniVoiceResultCard } from "./omnivoice/OmniVoiceResultCard";

interface OmniVoiceLabPanelProps {
  isRu: boolean;
}

export function OmniVoiceLabPanel({ isRu }: OmniVoiceLabPanelProps) {
  // ── Server ──
  const server = useOmniVoiceServer();

  // ── Mode ──
  const [mode, setMode] = useState<SynthMode>("design");

  // ── Voice Design ──
  const [preset, setPreset] = useState("alloy");
  const [instructions, setInstructions] = useState("");

  // ── Voice Cloning ──
  const [refAudioBlob, setRefAudioBlob] = useState<Blob | null>(null);
  const [refAudioName, setRefAudioName] = useState("");
  const [refTranscript, setRefTranscript] = useState("");
  const [refPickedId, setRefPickedId] = useState<string | null>(null);
  const [refSource, setRefSource] = useState<"upload" | "opfs" | "collection" | null>(null);

  const handleRefPicked = (picked: OmniVoicePickedRef) => {
    setRefAudioBlob(picked.blob);
    setRefAudioName(picked.fileName);
    setRefTranscript(picked.transcript ?? "");
    setRefPickedId(picked.refId ?? null);
    setRefSource(picked.source);
  };

  // ── Synthesis params ──
  const [synthText, setSynthText] = useState("");
  const [speed, setSpeed] = useState(1.0);
  const [numSteps, setNumSteps] = useState(32);

  // ── Synthesis pipeline ──
  const synth = useOmniVoiceSynthesis({
    isRu,
    requestBaseUrl: server.requestBaseUrl,
    mode,
    synthText,
    preset,
    instructions,
    refAudioBlob,
    refAudioName,
    refTranscript,
    speed,
  });

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-lg font-semibold">OmniVoice — Zero-Shot TTS</h3>
          <p className="text-sm text-muted-foreground">
            {isRu
              ? "Локальный сервер: Voice Design, Voice Cloning, 600+ языков"
              : "Local server: Voice Design, Voice Cloning, 600+ languages"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={server.isLocalOrigin ? "secondary" : "outline"} className="gap-1 text-[10px]">
            <Globe className="w-3 h-3" />
            {server.isLocalOrigin ? "Local" : "Cloud Preview"}
          </Badge>
          {server.serverOnline === true && (
            <Badge variant="default" className="gap-1">
              <Wifi className="w-3 h-3" />
              {isRu ? "Онлайн" : "Online"}
            </Badge>
          )}
          {server.serverOnline === false && (
            <Badge variant="destructive" className="gap-1">
              <WifiOff className="w-3 h-3" />
              {isRu ? "Оффлайн" : "Offline"}
            </Badge>
          )}
          {server.serverOnline === null && server.checkingServer && (
            <Badge variant="outline" className="gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {isRu ? "Проверка..." : "Checking..."}
            </Badge>
          )}
        </div>
      </div>

      <OmniVoiceServerCard
        isRu={isRu}
        serverUrl={server.serverUrl}
        onChangeUrl={server.setServerUrl}
        onCheck={server.checkServer}
        checking={server.checkingServer}
        usingLocalDevProxy={server.usingLocalDevProxy}
        showPreviewWarning={server.showPreviewWarning}
      />

      {/* Mode + per-mode controls */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{isRu ? "Режим синтеза" : "Synthesis Mode"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <OmniVoiceModeSelector isRu={isRu} mode={mode} onChange={setMode} />

          {mode === "design" && (
            <OmniVoiceDesignControls
              isRu={isRu}
              preset={preset}
              onPresetChange={setPreset}
              instructions={instructions}
              onInstructionsChange={setInstructions}
            />
          )}

          {mode === "clone" && (
            <OmniVoiceCloningControls
              isRu={isRu}
              requestBaseUrl={server.requestBaseUrl}
              refAudioBlob={refAudioBlob}
              refAudioName={refAudioName}
              refTranscript={refTranscript}
              refPickedId={refPickedId}
              refSource={refSource}
              onPicked={handleRefPicked}
              onTranscriptChange={setRefTranscript}
            />
          )}

          {mode === "auto" && (
            <Alert>
              <AlertDescription className="text-xs">
                {isRu
                  ? "Модель автоматически выберет голос. Просто введите текст."
                  : "The model will automatically choose a voice. Just enter text."}
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>

      {/* Synthesis */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">{isRu ? "Синтез" : "Synthesis"}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <OmniVoiceTextEditor isRu={isRu} value={synthText} onChange={setSynthText} />

          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1">
              <Label className="text-xs">{isRu ? "Скорость" : "Speed"}: {speed.toFixed(2)}</Label>
              <Slider value={[speed]} onValueChange={([v]) => setSpeed(v)} min={0.5} max={2.0} step={0.05} />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">{isRu ? "Шаги диффузии" : "Diffusion steps"}: {numSteps}</Label>
              <Slider value={[numSteps]} onValueChange={([v]) => setNumSteps(v)} min={4} max={64} step={1} />
            </div>
          </div>

          <OmniVoiceResultCard
            isRu={isRu}
            stage={synth.stage}
            busy={synth.busy}
            canSynthesize={!!synthText.trim()}
            serverOnline={server.serverOnline}
            latencyMs={synth.latencyMs}
            errorMessage={synth.errorMessage}
            resultUrl={synth.resultUrl}
            playing={synth.playing}
            onSynthesize={synth.handleSynthesize}
            onReset={synth.handleReset}
            onPlay={synth.handlePlay}
            onDownload={synth.handleDownload}
          />
        </CardContent>
      </Card>

      {/* Info */}
      <Card>
        <CardContent className="pt-4">
          <p className="text-xs text-muted-foreground leading-relaxed">
            {isRu ? (
              <>
                <strong>OmniVoice</strong> — высококачественный TTS с поддержкой 600+ языков, клонирования голоса и Voice Design.
                Для работы запустите <code className="text-[10px] bg-muted px-1 rounded">omnivoice-server</code> локально на GPU.
                RTF ~0.025 на CUDA (в 40× быстрее реального времени).
                Репозиторий: <a href="https://github.com/k2-fsa/OmniVoice" target="_blank" rel="noopener" className="underline">k2-fsa/OmniVoice</a>
              </>
            ) : (
              <>
                <strong>OmniVoice</strong> — high-quality TTS supporting 600+ languages, voice cloning, and Voice Design.
                Run <code className="text-[10px] bg-muted px-1 rounded">omnivoice-server</code> locally on GPU.
                RTF ~0.025 on CUDA (40× faster than real-time).
                Repo: <a href="https://github.com/k2-fsa/OmniVoice" target="_blank" rel="noopener" className="underline">k2-fsa/OmniVoice</a>
              </>
            )}
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
