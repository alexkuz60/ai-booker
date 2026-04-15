/**
 * BookerProSection — Booker Pro activation UI in Profile page.
 * Shows GPU status, ONNX model download, and activation toggle.
 * Sub-components extracted to GpuStatusCard and ModelDownloadPanel.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Zap, AlertTriangle } from "lucide-react";
import type { BookerProState } from "@/hooks/useBookerPro";
import { useGpuDevices } from "@/hooks/useGpuDevices";
import { MyDevicesPanel } from "@/components/profile/tabs/MyDevicesPanel";
import { GpuStatusCard } from "@/components/profile/tabs/GpuStatusCard";
import { ModelDownloadPanel } from "@/components/profile/tabs/ModelDownloadPanel";

interface BookerProSectionProps {
  pro: BookerProState;
  isRu: boolean;
}

export function BookerProSection({ pro, isRu }: BookerProSectionProps) {
  const [showDetails, setShowDetails] = useState(false);

  const gpuReady = pro.gpuStatus === "supported";
  const gpuChecking = pro.gpuStatus === "checking";
  const d = pro.gpuDetails;

  const { devices, renameDevice, removeDevice } = useGpuDevices(
    pro.gpuStatus, pro.adapterInfo, pro.gpuDetails, pro.benchmarkResult,
  );

  const handleTogglePro = (checked: boolean) => {
    if (checked && !pro.modelsReady) return;
    pro.setEnabled(checked);
  };

  return (
    <Card className="border-primary/30 bg-card/50 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Zap className="h-5 w-5 text-primary" />
        <CardTitle className="font-display">Booker Pro</CardTitle>
        <Badge variant="outline" className="ml-auto text-xs border-primary/50 text-primary">
          Voice Conversion
        </Badge>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Description */}
        <p className="text-sm text-muted-foreground leading-relaxed">
          {isRu
            ? "Режим Booker Pro активирует клиентский Voice Conversion пайплайн на базе WebGPU + ONNX Runtime. Синтезированный TTS-голос трансформируется в уникальный тембр персонажа через ContentVec → CREPE → RVC v2."
            : "Booker Pro mode activates client-side Voice Conversion pipeline powered by WebGPU + ONNX Runtime. Synthesized TTS voice is transformed into a unique character timbre via ContentVec → CREPE → RVC v2."}
        </p>

        {/* GPU Status Card */}
        <GpuStatusCard
          isRu={isRu}
          gpuChecking={gpuChecking}
          gpuReady={gpuReady}
          pro={pro}
          d={d}
          showDetails={showDetails}
          onToggleDetails={() => setShowDetails(v => !v)}
        />

        {/* Browser compatibility note */}
        {!pro.isChromium && pro.gpuStatus !== "supported" && (
          <Alert className="border-blue-500/30 bg-blue-500/5">
            <AlertTriangle className="h-4 w-4 text-blue-500" />
            <AlertTitle className="text-sm">
              {isRu ? "Совместимость браузера" : "Browser Compatibility"}
            </AlertTitle>
            <AlertDescription className="text-xs text-muted-foreground space-y-2">
              <p>
                {isRu
                  ? "WebGPU поддерживается в Firefox (141+) и Safari (26+). Для максимальной производительности рекомендуем Google Chrome или Microsoft Edge."
                  : "WebGPU is supported in Firefox (141+) and Safari (26+). For best performance, we recommend Google Chrome or Microsoft Edge."}
              </p>
              <p className="font-medium">
                {isRu ? "Firefox — about:config (обязательные):" : "Firefox — about:config (required):"}
              </p>
              <ul className="list-disc pl-4 space-y-0.5 font-mono text-[11px]">
                <li>dom.webgpu.enabled → true <span className="font-sans opacity-60">— {isRu ? "WebGPU для ONNX-инференса" : "WebGPU for ONNX inference"}</span></li>
                <li>gfx.webgpu.ignore-blocklist → true <span className="font-sans opacity-60">— {isRu ? "разблокировка GPU" : "unblock GPU"}</span></li>
                <li>javascript.options.wasm_simd_avx → true <span className="font-sans opacity-60">— {isRu ? "SIMD/AVX-ускорение WASM (×2-3)" : "SIMD/AVX acceleration (×2-3)"}</span></li>
                <li>javascript.options.wasm_memory_control → true <span className="font-sans opacity-60">— {isRu ? "управление памятью для моделей" : "memory control for models"}</span></li>
                <li>javascript.options.wasm_threads → true <span className="font-sans opacity-60">— {isRu ? "многопоточность ONNX Runtime" : "ONNX Runtime multi-threading"}</span></li>
              </ul>
              <p className="font-medium mt-1">
                {isRu ? "Опционально:" : "Optional:"}
              </p>
              <ul className="list-disc pl-4 space-y-0.5 font-mono text-[11px]">
                <li>gfx.webrender.all → true <span className="font-sans opacity-60">— {isRu ? "плавность UI при нагрузке" : "smoother UI under load"}</span></li>
              </ul>
              <p className="text-[11px] opacity-70">
                {isRu
                  ? "После изменений перезапустите Firefox."
                  : "Restart Firefox after changes."}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {/* Models — managed in Voice Lab */}

        {/* Activation toggle */}
        <div className="flex items-center justify-between p-3 rounded-lg bg-muted/30 border border-border/50">
          <div>
            <p className="text-sm font-medium">
              {isRu ? "Активировать Booker Pro" : "Activate Booker Pro"}
            </p>
            <p className="text-xs text-muted-foreground">
              {isRu
                ? "Откроет расширенные голосовые инструменты в Дикторах и Студии"
                : "Unlocks advanced voice tools in Narrators and Studio"}
            </p>
          </div>
          <Switch
            checked={pro.enabled}
            onCheckedChange={handleTogglePro}
            disabled={!pro.modelsReady}
          />
        </div>

        {/* My Devices */}
        {devices.length > 0 && (
          <MyDevicesPanel
            devices={devices}
            isRu={isRu}
            onRename={renameDevice}
            onRemove={removeDevice}
          />
        )}
      </CardContent>
    </Card>
  );
}
