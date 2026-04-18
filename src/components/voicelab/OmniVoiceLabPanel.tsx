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
import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Wifi, WifiOff, Globe } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";

import type { OmniVoicePickedRef } from "@/components/voicelab/OmniVoiceRefPicker";
import {
  DEFAULT_ADVANCED_PARAMS,
  type OmniVoiceAdvancedParams,
  type SynthMode,
} from "./omnivoice/constants";
import { useOmniVoiceServer } from "./omnivoice/useOmniVoiceServer";
import { useOmniVoiceSynthesis } from "./omnivoice/useOmniVoiceSynthesis";
import { OmniVoiceServerCard } from "./omnivoice/OmniVoiceServerCard";
import { OmniVoiceModeSelector } from "./omnivoice/OmniVoiceModeSelector";
import { OmniVoiceDesignControls } from "./omnivoice/OmniVoiceDesignControls";
import { OmniVoiceCloningControls } from "./omnivoice/OmniVoiceCloningControls";
import { OmniVoiceTextEditor } from "./omnivoice/OmniVoiceTextEditor";
import { OmniVoiceResultCard } from "./omnivoice/OmniVoiceResultCard";
import { OmniVoiceAdvancedParams as OmniVoiceAdvancedParamsPanel } from "./omnivoice/OmniVoiceAdvancedParams";
import {
  resolveOmniVoiceAdvancedFromTags,
  ACCENTUATION_LABELS,
  ARCHETYPE_LABELS,
} from "@/config/psychotypeVoicePresets";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readCharacterIndex, saveCharacterIndex } from "@/lib/localCharacters";
import type { CharacterIndex, OmniVoiceAdvancedSnapshot } from "@/pages/parser/types";
import { toast } from "sonner";

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
  const [advanced, setAdvanced] = useState<OmniVoiceAdvancedParams>({ ...DEFAULT_ADVANCED_PARAMS });
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [advancedSource, setAdvancedSource] =
    useState<OmniVoiceAdvancedSnapshot["source"]>("manual");
  const [advancedHint, setAdvancedHint] = useState<string | null>(null);
  const [pickedCharId, setPickedCharId] = useState<string | null>(null);

  // ── OPFS project context (Phase 2: persist Advanced snapshot per character) ──
  const { storage: projectStorage, meta: projectMeta } = useProjectStorageContext();

  /** Persist current Advanced snapshot into characters.json for `charId`. */
  const persistAdvancedFor = useCallback(
    async (
      charId: string,
      params: OmniVoiceAdvancedParams,
      source: OmniVoiceAdvancedSnapshot["source"],
    ) => {
      if (!projectStorage || !projectMeta?.bookId) return;
      try {
        const all = await readCharacterIndex(projectStorage);
        const updated = all.map((c) =>
          c.id === charId
            ? {
                ...c,
                voice_config: {
                  ...c.voice_config,
                  omnivoice_advanced: {
                    params: { ...params },
                    source,
                    updatedAt: new Date().toISOString(),
                  },
                },
              }
            : c,
        );
        await saveCharacterIndex(projectStorage, updated);
      } catch (err) {
        console.warn("[OmniVoiceLabPanel] Failed to persist omnivoice_advanced:", err);
      }
    },
    [projectStorage, projectMeta?.bookId],
  );

  /** Manual slider/switch edits — mark as "manual" + persist if a character is bound. */
  const handleManualChange = useCallback(
    (next: OmniVoiceAdvancedParams) => {
      setAdvanced(next);
      setAdvancedSource("manual");
      setAdvancedHint(isRu ? "Ручная правка" : "Manual edit");
      if (pickedCharId) void persistAdvancedFor(pickedCharId, next, "manual");
    },
    [isRu, pickedCharId, persistAdvancedFor],
  );

  /** Preset button — mark as `preset:<id>` + persist. */
  const handlePresetApply = useCallback(
    (presetId: "draft" | "standard" | "final", next: OmniVoiceAdvancedParams) => {
      setAdvanced(next);
      const src = `preset:${presetId}` as OmniVoiceAdvancedSnapshot["source"];
      setAdvancedSource(src);
      const labels: Record<string, { ru: string; en: string }> = {
        draft:    { ru: "Пресет: Черновик", en: "Preset: Draft" },
        standard: { ru: "Пресет: Стандарт", en: "Preset: Standard" },
        final:    { ru: "Пресет: Финал",    en: "Preset: Final" },
      };
      setAdvancedHint(isRu ? labels[presetId].ru : labels[presetId].en);
      if (pickedCharId) void persistAdvancedFor(pickedCharId, next, src);
    },
    [isRu, pickedCharId, persistAdvancedFor],
  );

  /** Reset → defaults, marked as "manual". */
  const handleReset = useCallback(() => {
    const next = { ...DEFAULT_ADVANCED_PARAMS };
    setAdvanced(next);
    setAdvancedSource("manual");
    setAdvancedHint(isRu ? "Сброшено к дефолтам" : "Reset to defaults");
    if (pickedCharId) void persistAdvancedFor(pickedCharId, next, "manual");
  }, [isRu, pickedCharId, persistAdvancedFor]);

  /** Apply a saved user preset — restore params + speed, surface name in hint. */
  const handleUserPresetApply = useCallback(
    (preset: { name: string; params: OmniVoiceAdvancedParams; speed?: number }) => {
      setAdvanced({ ...preset.params });
      if (typeof preset.speed === "number") setSpeed(preset.speed);
      // Snapshot schema source enum is fixed → store as "manual"; hint shows the
      // actual preset name so the badge in the Advanced header stays informative.
      setAdvancedSource("manual");
      setAdvancedHint(isRu ? `Мой пресет: ${preset.name}` : `My preset: ${preset.name}`);
      if (pickedCharId) void persistAdvancedFor(pickedCharId, preset.params, "manual");
      toast.success(isRu ? `Применён пресет: ${preset.name}` : `Preset applied: ${preset.name}`);
    },
    [isRu, pickedCharId, persistAdvancedFor],
  );

  /**
   * Character pick from CharacterAutoFillSection.
   * Phase 2 contract: auto-apply Advanced params from psycho-tags if available.
   * If a character already has `voice_config.omnivoice_advanced` saved — restore it
   * (respect the user's last manual override).
   */
  const handleCharacterPicked = useCallback(
    (char: CharacterIndex) => {
      setPickedCharId(char.id);

      const saved = char.voice_config?.omnivoice_advanced;
      if (saved?.params) {
        setAdvanced({ ...saved.params });
        setAdvancedSource(saved.source);
        const srcHints: Record<string, { ru: string; en: string }> = {
          auto:                { ru: "Авто из профиля",  en: "Auto from profile" },
          manual:              { ru: "Ручная правка",     en: "Manual edit" },
          "preset:draft":      { ru: "Пресет: Черновик", en: "Preset: Draft" },
          "preset:standard":   { ru: "Пресет: Стандарт", en: "Preset: Standard" },
          "preset:final":      { ru: "Пресет: Финал",    en: "Preset: Final" },
        };
        const hint = srcHints[saved.source];
        setAdvancedHint(hint ? (isRu ? hint.ru : hint.en) : null);
        return;
      }

      const resolved = resolveOmniVoiceAdvancedFromTags(char.psycho_tags);
      if (!resolved) {
        // No psycho data — keep current values, just clear the hint.
        setAdvancedHint(null);
        return;
      }

      setAdvanced(resolved.params);
      setAdvancedSource("auto");
      const accLabel = resolved.accentuation
        ? (isRu ? ACCENTUATION_LABELS[resolved.accentuation].ru : ACCENTUATION_LABELS[resolved.accentuation].en)
        : null;
      const archLabel = resolved.archetype
        ? (isRu ? ARCHETYPE_LABELS[resolved.archetype].ru : ARCHETYPE_LABELS[resolved.archetype].en)
        : null;
      const tail = [accLabel, archLabel].filter(Boolean).join(" + ");
      setAdvancedHint(`${isRu ? "Авто" : "Auto"} · ${tail}`);
      void persistAdvancedFor(char.id, resolved.params, "auto");
      toast.success(
        isRu
          ? `Параметры подобраны по психотипу: ${tail}`
          : `Params auto-tuned from psychotype: ${tail}`,
      );
    },
    [isRu, persistAdvancedFor],
  );

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
    advanced,
  });

  // ── Capture params snapshot of the latest successful run (for chip display) ──
  const [usedRun, setUsedRun] = useState<{
    params: OmniVoiceAdvancedParams;
    speed: number;
    source: string | null;
  } | null>(null);
  const prevStageRef = useRef(synth.stage);
  useEffect(() => {
    const prev = prevStageRef.current;
    if (prev !== "done" && synth.stage === "done") {
      setUsedRun({
        params: { ...advanced },
        speed,
        source: advancedHint ?? advancedSource,
      });
    }
    if (synth.stage === "idle" && !synth.resultUrl) {
      setUsedRun(null);
    }
    prevStageRef.current = synth.stage;
  }, [synth.stage, synth.resultUrl, advanced, speed, advancedHint, advancedSource]);

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
              onCharacterPicked={handleCharacterPicked}
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

          <div className="space-y-1 max-w-xs">
            <Label className="text-xs">{isRu ? "Скорость" : "Speed"}: {speed.toFixed(2)}</Label>
            <Slider value={[speed]} onValueChange={([v]) => setSpeed(v)} min={0.5} max={2.0} step={0.05} />
          </div>

          <OmniVoiceAdvancedParamsPanel
            isRu={isRu}
            open={advancedOpen}
            onOpenChange={setAdvancedOpen}
            value={advanced}
            onChange={handleManualChange}
            onPresetApply={handlePresetApply}
            onReset={handleReset}
            sourceLabel={advancedHint}
            currentSpeed={speed}
            onUserPresetApply={handleUserPresetApply}
          />

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
            usedRun={usedRun}
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
