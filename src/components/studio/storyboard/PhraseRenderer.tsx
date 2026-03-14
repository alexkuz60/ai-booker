import { Volume2 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type PhraseAnnotation,
  type AnnotationType,
  ANNOTATION_STYLES,
  isInsertionAnnotation,
} from "../phraseAnnotations";

export function renderPhraseText(text: string) {
  const parts = text.split(/(\[сн\.→\s*\d+\]|\[[^\]]+\])/g);
  return parts.map((part, i) => {
    // Footnote reference marker [сн.→ N]
    if (/^\[сн\.→\s*\d+\]$/.test(part)) {
      return (
        <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[10px] font-mono mx-0.5 cursor-help" title="Ссылка на сноску">
          {part}
        </span>
      );
    }
    if (/^\[.+\]$/.test(part)) {
      return (
        <span key={i} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-accent text-accent-foreground text-xs font-medium mx-0.5">
          <Volume2 className="h-3 w-3" />
          {part.slice(1, -1)}
        </span>
      );
    }
    return <span key={i}>{part}</span>;
  });
}

export function renderAnnotatedText(text: string, annotations?: PhraseAnnotation[]) {
  if (!annotations || annotations.length === 0) return renderPhraseText(text);

  type Span = { start: number; end: number; type: AnnotationType };
  type Insert = { offset: number; type: AnnotationType };
  const ranges: Span[] = [];
  const inserts: Insert[] = [];

  for (const a of annotations) {
    if (isInsertionAnnotation(a.type)) {
      inserts.push({ offset: a.offset ?? 0, type: a.type });
    } else if (a.start !== undefined && a.end !== undefined) {
      ranges.push({ start: a.start, end: a.end, type: a.type });
    }
  }

  ranges.sort((a, b) => a.start - b.start);
  inserts.sort((a, b) => a.offset - b.offset);

  const charStyles = new Array(text.length).fill(null) as (AnnotationType | null)[];
  for (const r of ranges) {
    for (let i = r.start; i < Math.min(r.end, text.length); i++) {
      charStyles[i] = r.type;
    }
  }

  const fragments: React.ReactNode[] = [];
  let insertIdx = 0;
  let i = 0;

  while (i < text.length) {
    while (insertIdx < inserts.length && inserts[insertIdx].offset <= i) {
      const ins = inserts[insertIdx];
      const style = ANNOTATION_STYLES[ins.type];
      fragments.push(
        <span key={`ins-${insertIdx}`} className="text-muted-foreground text-xs select-none">
          {style.prefix || ""}
        </span>
      );
      insertIdx++;
    }

    const currentStyle = charStyles[i];
    let j = i;
    while (j < text.length && charStyles[j] === currentStyle) j++;
    const chunk = text.slice(i, j);

    if (currentStyle) {
      const style = ANNOTATION_STYLES[currentStyle];
      fragments.push(
        <span key={`r-${i}`} className={cn(style.className, "relative")}>
          {style.prefix && <span className="text-[10px] select-none">{style.prefix}</span>}
          {chunk}
          {style.suffix && <span className="text-[10px] select-none">{style.suffix}</span>}
        </span>
      );
    } else {
      const parts = chunk.split(/(\[сн\.→\s*\d+\]|\[[^\]]+\])/g);
      for (const [pi, part] of parts.entries()) {
        if (/^\[сн\.→\s*\d+\]$/.test(part)) {
          fragments.push(
            <span key={`s-${i}-${pi}`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-500/20 text-sky-400 text-[10px] font-mono mx-0.5 cursor-help" title="Ссылка на сноску">
              {part}
            </span>
          );
        } else if (/^\[.+\]$/.test(part)) {
          fragments.push(
            <span key={`s-${i}-${pi}`} className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-accent text-accent-foreground text-xs font-medium mx-0.5">
              <Volume2 className="h-3 w-3" />
              {part.slice(1, -1)}
            </span>
          );
        } else if (part) {
          fragments.push(<span key={`t-${i}-${pi}`}>{part}</span>);
        }
      }
    }
    i = j;
  }

  while (insertIdx < inserts.length) {
    const ins = inserts[insertIdx];
    const style = ANNOTATION_STYLES[ins.type];
    fragments.push(
      <span key={`ins-${insertIdx}`} className="text-muted-foreground text-xs select-none">
        {style.prefix || ""}
      </span>
    );
    insertIdx++;
  }

  return fragments;
}
