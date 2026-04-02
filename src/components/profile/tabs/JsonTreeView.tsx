import { useState, useMemo } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface JsonNodeProps {
  label: string;
  value: unknown;
  depth: number;
  defaultOpen?: boolean;
}

function JsonNode({ label, value, depth, defaultOpen = false }: JsonNodeProps) {
  const [open, setOpen] = useState(defaultOpen);

  if (value === null) {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: depth * 16 }}>
        <span className="text-muted-foreground">{label}:</span>
        <span className="text-orange-400 italic">null</span>
      </div>
    );
  }

  if (typeof value === "boolean") {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: depth * 16 }}>
        <span className="text-muted-foreground">{label}:</span>
        <span className="text-purple-400">{String(value)}</span>
      </div>
    );
  }

  if (typeof value === "number") {
    return (
      <div className="flex items-baseline gap-1" style={{ paddingLeft: depth * 16 }}>
        <span className="text-muted-foreground">{label}:</span>
        <span className="text-blue-400">{value}</span>
      </div>
    );
  }

  if (typeof value === "string") {
    const truncated = value.length > 120 ? value.slice(0, 120) + "…" : value;
    return (
      <div className="flex items-baseline gap-1 min-w-0" style={{ paddingLeft: depth * 16 }}>
        <span className="text-muted-foreground shrink-0">{label}:</span>
        <span className="text-green-400 break-all">"{truncated}"</span>
      </div>
    );
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as unknown[]).map((v, i) => [String(i), v] as const)
    : Object.entries(value as Record<string, unknown>);
  const count = entries.length;
  const bracket = isArray ? ["[", "]"] : ["{", "}"];
  const preview = count === 0
    ? `${bracket[0]}${bracket[1]}`
    : `${bracket[0]}${count} ${isArray ? "items" : "keys"}${bracket[1]}`;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 py-px w-full text-left hover:bg-muted/40 rounded-sm"
        style={{ paddingLeft: depth * 16 }}
      >
        {open
          ? <ChevronDown className="h-3 w-3 shrink-0 text-muted-foreground" />
          : <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground" />}
        <span className="text-muted-foreground">{label}:</span>
        {!open && <span className="text-muted-foreground/60 text-[10px] ml-1">{preview}</span>}
      </button>
      {open && (
        <div>
          {entries.map(([key, val]) => (
            <JsonNode
              key={key}
              label={key}
              value={val}
              depth={depth + 1}
              defaultOpen={depth < 0}
            />
          ))}
          {count === 0 && (
            <div className="text-[10px] text-muted-foreground/50 italic" style={{ paddingLeft: (depth + 1) * 16 }}>
              (empty)
            </div>
          )}
        </div>
      )}
    </div>
  );
}

interface JsonTreeViewProps {
  content: string;
}

export function JsonTreeView({ content }: JsonTreeViewProps) {
  const parsed = useMemo(() => {
    try {
      return JSON.parse(content);
    } catch {
      return null;
    }
  }, [content]);

  if (parsed === null) {
    return (
      <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3 bg-muted/50 rounded-md">
        {content}
      </pre>
    );
  }

  return (
    <div className="text-xs font-mono p-3 bg-muted/50 rounded-md space-y-px">
      {typeof parsed === "object" && !Array.isArray(parsed) ? (
        Object.entries(parsed).map(([key, val]) => (
          <JsonNode key={key} label={key} value={val} depth={0} defaultOpen={true} />
        ))
      ) : Array.isArray(parsed) ? (
        <JsonNode label="root" value={parsed} depth={0} defaultOpen={true} />
      ) : (
        <pre className="whitespace-pre-wrap break-words">{content}</pre>
      )}
    </div>
  );
}
