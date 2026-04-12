/**
 * MyDevicesPanel — shows list of user's devices with GPU info,
 * editable labels, benchmark results, and last-seen timestamps.
 */
import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Monitor, Pencil, Check, X, Trash2, Gauge, Wifi,
  CheckCircle2, XCircle, AlertTriangle,
} from "lucide-react";
import type { GpuDeviceProfile } from "@/hooks/useGpuDevices";

interface MyDevicesPanelProps {
  devices: GpuDeviceProfile[];
  isRu: boolean;
  onRename: (fingerprint: string, label: string) => void;
  onRemove: (fingerprint: string) => void;
}

function timeAgo(isoDate: string, isRu: boolean): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return isRu ? "только что" : "just now";
  if (mins < 60) return isRu ? `${mins} мин назад` : `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return isRu ? `${hours}ч назад` : `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return isRu ? `${days}д назад` : `${days}d ago`;
  return new Date(isoDate).toLocaleDateString();
}

function GpuStatusBadge({ status, isRu }: { status: string; isRu: boolean }) {
  if (status === "supported") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0 rounded-full border bg-primary/20 text-primary border-primary/50">
        <CheckCircle2 className="h-2.5 w-2.5" />
        WebGPU
      </span>
    );
  }
  if (status === "no-api") {
    return (
      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0 rounded-full border text-destructive border-destructive/30 bg-destructive/10">
        <XCircle className="h-2.5 w-2.5" />
        {isRu ? "Нет WebGPU" : "No WebGPU"}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0 rounded-full border text-amber-400 border-amber-500/30 bg-amber-500/10">
      <AlertTriangle className="h-2.5 w-2.5" />
      {isRu ? "Нет адаптера" : "No adapter"}
    </span>
  );
}

function isLinuxDevice(dev: GpuDeviceProfile): boolean {
  return /Linux/i.test(dev.platform) || /Linux/i.test(dev.browser);
}

export function MyDevicesPanel({ devices, isRu, onRename, onRemove }: MyDevicesPanelProps) {
  const [editingFp, setEditingFp] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");

  const startEdit = (fp: string, currentLabel: string) => {
    setEditingFp(fp);
    setEditValue(currentLabel);
  };

  const saveEdit = () => {
    if (editingFp && editValue.trim()) {
      onRename(editingFp, editValue.trim());
    }
    setEditingFp(null);
  };

  const cancelEdit = () => setEditingFp(null);

  if (devices.length === 0) return null;

  // Sort: current first, then by lastSeen desc
  const sorted = [...devices].sort((a, b) => {
    if (a.isCurrent && !b.isCurrent) return -1;
    if (!a.isCurrent && b.isCurrent) return 1;
    return new Date(b.lastSeen).getTime() - new Date(a.lastSeen).getTime();
  });

  // Show Linux WebGPU hint if current device is Linux + no WebGPU
  const currentDev = sorted.find(d => d.isCurrent);
  const showLinuxHint = currentDev && currentDev.gpuStatus !== "supported" && isLinuxDevice(currentDev);

  return (
    <Card className="border-border/50 bg-card/30">
      <CardHeader className="pb-3">
        <div className="flex items-center gap-2">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          <CardTitle className="text-sm font-medium">
            {isRu ? "Мои устройства" : "My Devices"}
          </CardTitle>
          <Badge variant="secondary" className="text-[10px] px-1.5">
            {devices.length}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {showLinuxHint && (
          <Alert className="border-amber-500/30 bg-amber-500/5 mb-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <AlertDescription className="text-xs text-muted-foreground space-y-1">
              <p>
                {isRu
                  ? "WebGPU не обнаружен на этом Linux-устройстве. Для Chrome/Edge включите поддержку:"
                  : "WebGPU not detected on this Linux device. For Chrome/Edge, enable support:"}
              </p>
              <ol className="list-decimal pl-4 space-y-0.5 font-mono text-[11px]">
                <li>{isRu ? "Откройте" : "Open"} <code className="bg-muted px-1 rounded">chrome://flags</code></li>
                <li>{isRu ? "Включите" : "Enable"} <code className="bg-muted px-1 rounded">#enable-unsafe-webgpu</code></li>
                <li>{isRu ? "Включите" : "Enable"} <code className="bg-muted px-1 rounded">#enable-vulkan</code></li>
                <li>{isRu ? "Перезапустите браузер" : "Restart the browser"}</li>
              </ol>
              <p className="text-muted-foreground/70">
                {isRu
                  ? "Убедитесь, что установлены NVIDIA Vulkan драйверы (nvidia-driver ≥ 525)."
                  : "Ensure NVIDIA Vulkan drivers are installed (nvidia-driver ≥ 525)."}
              </p>
            </AlertDescription>
          </Alert>
        )}

        {sorted.map(dev => (
          <div
            key={dev.fingerprint}
            className={`rounded-lg border p-3 space-y-2 transition-colors ${
              dev.isCurrent
                ? "border-primary/40 bg-primary/5"
                : "border-border/30 bg-muted/20"
            }`}
          >
            {/* Header row */}
            <div className="flex items-start gap-2">
              <Monitor className={`h-4 w-4 mt-0.5 shrink-0 ${dev.isCurrent ? "text-primary" : "text-muted-foreground"}`} />
              <div className="flex-1 min-w-0">
                {editingFp === dev.fingerprint ? (
                  <div className="flex items-center gap-1">
                    <Input
                      value={editValue}
                      onChange={e => setEditValue(e.target.value)}
                      className="h-6 text-xs px-1.5"
                      onKeyDown={e => { if (e.key === "Enter") saveEdit(); if (e.key === "Escape") cancelEdit(); }}
                      autoFocus
                    />
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={saveEdit}>
                      <Check className="h-3 w-3 text-primary" />
                    </Button>
                    <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={cancelEdit}>
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-medium truncate">{dev.label}</span>
                    <Button
                      variant="ghost" size="sm"
                      className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                      onClick={() => startEdit(dev.fingerprint, dev.label)}
                    >
                      <Pencil className="h-3 w-3" />
                    </Button>
                  </div>
                )}
                <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                  {dev.isCurrent && (
                    <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0 rounded-full border bg-primary/20 text-primary border-primary/50">
                      <Wifi className="h-2.5 w-2.5" />
                      {isRu ? "Текущее" : "Current"}
                    </span>
                  )}
                  <GpuStatusBadge status={dev.gpuStatus || "no-api"} isRu={isRu} />
                  {dev.isFallback && (
                    <span className="inline-flex items-center text-[10px] px-1.5 py-0 rounded-full border text-amber-400 border-amber-500/30">
                      {isRu ? "Программный" : "Software"}
                    </span>
                  )}
                </div>
              </div>

              {/* Remove button (not for current) */}
              {!dev.isCurrent && (
                <Button
                  variant="ghost" size="sm"
                  className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive shrink-0"
                  onClick={() => onRemove(dev.fingerprint)}
                  title={isRu ? "Удалить устройство" : "Remove device"}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              )}
            </div>

            {/* Details row */}
            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs pl-6">
              <span className="text-muted-foreground">GPU</span>
              <span className="text-foreground font-mono truncate">
                {dev.description || dev.vendor || "—"}
              </span>

              <span className="text-muted-foreground">{isRu ? "Браузер" : "Browser"}</span>
              <span className="text-foreground font-mono truncate">{dev.browser}</span>

              <span className="text-muted-foreground">{isRu ? "Платформа" : "Platform"}</span>
              <span className="text-foreground font-mono truncate">{dev.platform || "—"}</span>

              {dev.benchGflops !== null && dev.benchGflops > 0 && (
                <>
                  <span className="text-muted-foreground flex items-center gap-1">
                    <Gauge className="h-3 w-3" /> GFLOPS
                  </span>
                  <span className="text-primary font-mono font-semibold">{dev.benchGflops}</span>
                </>
              )}

              <span className="text-muted-foreground">
                {isRu ? "Последний вход" : "Last seen"}
              </span>
              <span className="text-foreground text-[11px]">
                {timeAgo(dev.lastSeen, isRu)}
              </span>
            </div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
