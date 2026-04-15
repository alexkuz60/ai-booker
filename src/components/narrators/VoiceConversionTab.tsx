/**
 * VoiceConversionTab — Thin wrapper composing VcConfigPanel + VcTestPipeline.
 * Lives in voicelab/ since VC functionality is managed in Voice Lab.
 */
import { useState, useCallback, useEffect } from "react";
import { VcConfigPanel, type VcConfigValues } from "@/components/voicelab/VcConfigPanel";
import { VcTestPipeline, useVcBackendState } from "@/components/voicelab/VcTestPipeline";
import type { PitchAlgorithm, SpeechEncoder } from "@/lib/vcModelCache";
import type { RvcOutputSR } from "@/lib/vcSynthesis";
import { RVC_OUTPUT_SR_DEFAULT } from "@/lib/vcSynthesis";
import type { PitchFrame } from "@/lib/vcCrepe";

interface VoiceConversionTabProps {
  isRu: boolean;
  characterName: string;
  characterId: string;
  voiceConfig: Record<string, unknown>;
  onUpdateVcConfig: (patch: Record<string, unknown>) => void;
  ttsProvider: string;
  buildTtsRequest: () => { url: string; body: Record<string, unknown> } | null;
}

export function VoiceConversionTab({
  isRu, characterName, characterId, voiceConfig,
  onUpdateVcConfig, ttsProvider, buildTtsRequest,
}: VoiceConversionTabProps) {
  const { backendChoice, activeBackend, handleBackendChange } = useVcBackendState();

  // F0 data from pipeline for pitch shift suggestion
  const [ttsF0, setTtsF0] = useState<PitchFrame[] | undefined>();
  const [refF0, setRefF0] = useState<PitchFrame[] | undefined>();

  const handleF0Extracted = useCallback((tts: PitchFrame[], ref: PitchFrame[] | undefined) => {
    setTtsF0(tts);
    setRefF0(ref);
  }, []);

  const config: VcConfigValues = {
    vcEnabled: (voiceConfig.vc_enabled as boolean) ?? false,
    pitchShift: (voiceConfig.vc_pitch_shift as number) ?? 0,
    vcOutputSR: (voiceConfig.vc_output_sr as RvcOutputSR) || RVC_OUTPUT_SR_DEFAULT,
    vcReferenceId: (voiceConfig.vc_reference_id as string) || "",
    indexRate: (voiceConfig.vc_index_rate as number) ?? 0.75,
    vcIndexId: (voiceConfig.vc_index_id as string) || "",
    protect: (voiceConfig.vc_protect as number) ?? 0.33,
    pitchAlgorithm: (voiceConfig.vc_pitch_algorithm as PitchAlgorithm) || "crepe-tiny",
    vcEncoder: (voiceConfig.vc_encoder as SpeechEncoder) || "contentvec",
    dryWet: (voiceConfig.vc_dry_wet as number) ?? 1.0,
  };

  return (
    <div className="space-y-2">
      <VcConfigPanel
        isRu={isRu}
        characterName={characterName}
        config={config}
        onUpdateVcConfig={onUpdateVcConfig}
        isProcessing={false}
        backendChoice={backendChoice}
        activeBackend={activeBackend}
        onBackendChange={handleBackendChange}
        ttsF0={ttsF0}
        refF0={refF0}
      />
      <VcTestPipeline
        isRu={isRu}
        config={config}
        ttsProvider={ttsProvider}
        buildTtsRequest={buildTtsRequest}
        onF0Extracted={handleF0Extracted}
      />
    </div>
  );
}
