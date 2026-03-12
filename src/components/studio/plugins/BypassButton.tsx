import { Power } from "lucide-react";

export function BypassButton({ label, bypassed, onToggle }: { label: string; bypassed: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className={`flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-mono uppercase leading-none transition-colors font-semibold ${
        bypassed
          ? "text-muted-foreground/40 bg-transparent border border-border/50"
          : "text-accent bg-accent/15 border border-accent/50"
      }`}
    >
      <Power className="h-2.5 w-2.5" />
      {label}: {bypassed ? "OFF" : "ON"}
    </button>
  );
}
