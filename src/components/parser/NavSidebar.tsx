import {
  ChevronDown, ChevronRight, CheckCircle2, Loader2, AlertCircle,
  BookOpen, FolderOpen, Clapperboard, ChevronLeft, ChevronRightIcon, Trash2
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { t, tSection } from "@/pages/parser/i18n";
import type { TocChapter, SectionType, ChapterStatus, Scene } from "@/pages/parser/types";
import { SECTION_ICONS } from "@/pages/parser/types";

interface NavSidebarProps {
  isRu: boolean;
  fileName: string;
  totalPages: number;
  tocEntries: TocChapter[];
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  selectedIdx: number | null;
  expandedNodes: Set<string>;
  contentEntries: TocChapter[];
  supplementaryEntries: TocChapter[];
  partGroups: { title: string; indices: number[] }[];
  partlessIndices: number[];
  onSelectChapter: (idx: number) => void;
  onAnalyzeChapter: (idx: number) => void;
  onToggleNode: (key: string) => void;
  onSendToStudio: (idx: number) => void;
  isChapterFullyDone: (idx: number) => boolean;
  onChangeLevel: (idx: number, delta: number) => void;
  onDeleteEntry: (idx: number) => void;
}

export default function NavSidebar({
  isRu, fileName, totalPages, tocEntries, chapterResults,
  selectedIdx, expandedNodes, contentEntries, supplementaryEntries,
  partGroups, partlessIndices,
  onSelectChapter, onAnalyzeChapter, onToggleNode, onSendToStudio, isChapterFullyDone,
  onChangeLevel, onDeleteEntry,
}: NavSidebarProps) {

  function hasDirectChildren(idx: number): boolean {
    const entry = tocEntries[idx];
    return idx + 1 < tocEntries.length &&
      tocEntries[idx + 1].level > entry.level &&
      tocEntries[idx + 1].sectionType === entry.sectionType;
  }

  function renderNavItem(idx: number, depth: number = 0, isTopLevel: boolean = false) {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    const isSelected = selectedIdx === idx;
    const status = result?.status || "pending";

    const isParent = hasDirectChildren(idx);

    const childIndices: number[] = [];
    if (isParent) {
      for (let i = idx + 1; i < tocEntries.length; i++) {
        if (tocEntries[i].level <= entry.level) break;
        if (tocEntries[i].sectionType !== entry.sectionType) break;
        childIndices.push(i);
      }
    }

    const directChildren = childIndices.filter(i => tocEntries[i].level === entry.level + 1);
    const nodeKey = `item:${idx}`;
    const isExpanded = expandedNodes.has(nodeKey);
    const paddingLeft = `${(depth + 1) * 12 + 16}px`;

    return (
      <div key={idx}>
        <button
          onClick={() => {
            if (isParent && directChildren.length > 0) onToggleNode(nodeKey);
            onSelectChapter(idx);
            if (status === "pending") onAnalyzeChapter(idx);
          }}
          style={{ paddingLeft }}
          className={`w-full flex items-center gap-2 pr-4 py-2 text-left text-sm transition-colors ${
            isSelected
              ? "bg-primary/10 text-primary border-r-2 border-primary"
              : "text-foreground/70 hover:bg-muted/40 hover:text-foreground"
          }`}
        >
          {isParent && directChildren.length > 0 ? (
            <span className="flex-shrink-0" onClick={(e) => { e.stopPropagation(); onToggleNode(nodeKey); }}>
              {isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </span>
          ) : (
            <span className="w-3.5 flex-shrink-0" />
          )}
          <span className="flex-shrink-0">
            {isParent ? (
              <FolderOpen className="h-3.5 w-3.5 text-primary/70" />
            ) : status === "done" ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-green-500" />
            ) : status === "analyzing" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
            ) : status === "error" ? (
              <AlertCircle className="h-3.5 w-3.5 text-destructive" />
            ) : (
              <div className="h-3.5 w-3.5 rounded-full border border-border" />
            )}
          </span>
          <span className="truncate flex-1">{entry.title}</span>
          <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0">
            {entry.startPage}
          </span>
          {isSelected && (
            <span className="flex items-center gap-0 flex-shrink-0 ml-1">
              <button
                title={isRu ? "Уменьшить вложенность" : "Outdent"}
                onClick={(e) => { e.stopPropagation(); onChangeLevel(idx, -1); }}
                disabled={entry.level === 0}
                className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-30 disabled:pointer-events-none"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </button>
              <button
                title={isRu ? "Увеличить вложенность" : "Indent"}
                onClick={(e) => { e.stopPropagation(); onChangeLevel(idx, 1); }}
                className="p-0.5 rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
              >
                <ChevronRightIcon className="h-3.5 w-3.5" />
              </button>
              <button
                title={t("deleteEntry", isRu)}
                onClick={(e) => { e.stopPropagation(); onDeleteEntry(idx); }}
                className="p-0.5 rounded hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors ml-0.5"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </span>
          )}
          {isParent && isChapterFullyDone(idx) && (
            <button
              title={t("toStudio", isRu)}
              onClick={(e) => { e.stopPropagation(); onSendToStudio(idx); }}
              className="flex-shrink-0 ml-1 p-0.5 rounded hover:bg-primary/20 text-primary transition-colors"
            >
              <Clapperboard className="h-3.5 w-3.5" />
            </button>
          )}
        </button>
        {isExpanded && directChildren.length > 0 && (
          <div>
            {directChildren.map(childIdx => renderNavItem(childIdx, depth + 1, false))}
          </div>
        )}
      </div>
    );
  }

  function renderNavSection(type: SectionType) {
    const sectionChildOf = new Set<number>();
    tocEntries.forEach((entry, idx) => {
      if (entry.sectionType !== type) return;
      for (let i = idx + 1; i < tocEntries.length; i++) {
        if (tocEntries[i].level <= entry.level) break;
        if (tocEntries[i].sectionType !== entry.sectionType) break;
        sectionChildOf.add(i);
      }
    });

    const rootEntries = tocEntries
      .map((e, i) => ({ entry: e, idx: i }))
      .filter(({ entry, idx }) => entry.sectionType === type && !sectionChildOf.has(idx));
    if (rootEntries.length === 0) return null;

    const allEntries = tocEntries.filter(e => e.sectionType === type);
    const sectionKey = `section:${type}`;
    const isExpanded = expandedNodes.has(sectionKey);

    return (
      <>
        <button
          onClick={() => onToggleNode(sectionKey)}
          className="w-full flex items-center gap-1.5 px-4 py-1.5 mt-2 text-left"
        >
          {isExpanded ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {SECTION_ICONS[type]} {tSection(type, isRu)}
          </span>
          <span className="ml-auto text-[11px] text-muted-foreground">{allEntries.length}</span>
        </button>
        {isExpanded && rootEntries.map(({ idx }) => renderNavItem(idx, 0, true))}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-card/50">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold text-base text-foreground truncate">
            {fileName.replace('.pdf', '')}
          </span>
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {totalPages} {t("pages", isRu)} • {contentEntries.length} {t("chapters", isRu)}
          {supplementaryEntries.length > 0 && ` • ${supplementaryEntries.length} ${t("suppl", isRu)}`}
        </p>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="py-2">
          {renderNavSection("preface")}

          {partGroups.map((group) => {
            const partKey = `part:${group.title}`;
            const isExpanded = expandedNodes.has(partKey);
            return (
              <div key={group.title}>
                <button
                  onClick={() => onToggleNode(partKey)}
                  className="w-full flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-primary hover:bg-muted/30 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
                  <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="truncate">{group.title}</span>
                  <span className="ml-auto text-[11px] text-muted-foreground font-normal">{group.indices.length}</span>
                </button>
                {isExpanded && (
                  <div>
                    {group.indices.map(idx => renderNavItem(idx, 1, true))}
                  </div>
                )}
              </div>
            );
          })}

          {partlessIndices.map(idx => renderNavItem(idx, 0, true))}

          {renderNavSection("afterword")}
          {renderNavSection("endnotes")}
          {renderNavSection("appendix")}
        </div>
      </ScrollArea>
    </div>
  );
}
