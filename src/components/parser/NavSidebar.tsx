import { useState, useRef, useEffect } from "react";
import {
  ChevronDown, ChevronRight, CheckCircle2, Loader2, AlertCircle,
  BookOpen, FolderOpen, Clapperboard, ChevronLeft, ChevronRightIcon, Trash2, ExternalLink, Clock, Merge,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { t, tSection } from "@/pages/parser/i18n";
import type { TocChapter, SectionType, ChapterStatus, Scene } from "@/pages/parser/types";
import { SECTION_ICONS } from "@/pages/parser/types";
import { estimateDurationSec, formatDuration } from "@/lib/durationEstimate";
import { RoleBadges } from "@/components/ui/RoleBadge";
import type { AiRoleId } from "@/config/aiRoles";

interface NavSidebarProps {
  isRu: boolean;
  fileName: string;
  totalPages: number;
  tocEntries: TocChapter[];
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  selectedIndices: Set<number>;
  expandedNodes: Set<string>;
  contentEntries: TocChapter[];
  supplementaryEntries: TocChapter[];
  partGroups: { title: string; indices: number[] }[];
  partlessIndices: number[];
  onSelectChapter: (idx: number, e: React.MouseEvent) => void;
  onAnalyzeChapter: (idx: number) => void;
  onToggleNode: (key: string) => void;
  onSendToStudio: (idx: number) => void;
  isChapterFullyDone: (idx: number) => boolean;
  onChangeLevel: (indices: number[], delta: number) => void;
  onDeleteEntry: (indices: number[]) => void;
  onRenameEntry: (idx: number, newTitle: string) => void;
  onChangeStartPage: (idx: number, newPage: number) => void;
  onOpenPdf?: (page?: number) => void;
  onRenamePart?: (oldTitle: string, newTitle: string) => void;
  onMergeEntries?: (indices: number[]) => void;
  roleModels?: Partial<Record<AiRoleId, string>>;
}

export default function NavSidebar({
  isRu, fileName, totalPages, tocEntries, chapterResults,
  selectedIndices, expandedNodes, contentEntries, supplementaryEntries,
  partGroups, partlessIndices,
  onSelectChapter, onAnalyzeChapter, onToggleNode, onSendToStudio, isChapterFullyDone,
  onChangeLevel, onDeleteEntry, onRenameEntry, onChangeStartPage,
  onOpenPdf, onRenamePart, onMergeEntries, roleModels,
}: NavSidebarProps) {
  const isPdf = /\.pdf$/i.test(fileName);
  const [editingPartTitle, setEditingPartTitle] = useState<string | null>(null);
  const [editPartValue, setEditPartValue] = useState("");
  const editPartRef = useRef<HTMLInputElement>(null);
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editingPageIdx, setEditingPageIdx] = useState<number | null>(null);
  const [editPageValue, setEditPageValue] = useState("");
  const editPageRef = useRef<HTMLInputElement>(null);
  const editInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingIdx !== null) {
      editInputRef.current?.focus();
      editInputRef.current?.select();
    }
  }, [editingIdx]);

  useEffect(() => {
    if (editingPageIdx !== null) {
      editPageRef.current?.focus();
      editPageRef.current?.select();
    }
  }, [editingPageIdx]);

  useEffect(() => {
    if (editingPartTitle !== null) {
      editPartRef.current?.focus();
      editPartRef.current?.select();
    }
  }, [editingPartTitle]);

  const commitPartRename = () => {
    if (editingPartTitle !== null && editPartValue.trim() && editPartValue.trim() !== editingPartTitle) {
      onRenamePart?.(editingPartTitle, editPartValue.trim());
    }
    setEditingPartTitle(null);
  };

  const commitPageEdit = () => {
    if (editingPageIdx !== null) {
      const parsed = parseInt(editPageValue, 10);
      if (!isNaN(parsed) && parsed > 0 && parsed !== tocEntries[editingPageIdx]?.startPage) {
        onChangeStartPage(editingPageIdx, parsed);
      }
      setEditingPageIdx(null);
    }
  };

  const commitRename = () => {
    if (editingIdx !== null && editValue.trim() && editValue.trim() !== tocEntries[editingIdx]?.title) {
      onRenameEntry(editingIdx, editValue.trim());
    }
    setEditingIdx(null);
  };

  function hasDirectChildren(idx: number): boolean {
    const entry = tocEntries[idx];
    return idx + 1 < tocEntries.length &&
      tocEntries[idx + 1].level > entry.level &&
      tocEntries[idx + 1].sectionType === entry.sectionType;
  }

  const selectedArray = Array.from(selectedIndices).sort((a, b) => a - b);
  const multiSelected = selectedIndices.size > 1;

  function renderNavItem(idx: number, depth: number = 0) {
    const entry = tocEntries[idx];
    const result = chapterResults.get(idx);
    const isSelected = selectedIndices.has(idx);
    const status = result?.status || "pending";

    // Compute chapter duration estimate from scenes
    const chapterDurationFormatted = (() => {
      if (status !== "done" || !result?.scenes?.length) return null;
      const totalChars = result.scenes.reduce((sum, s) => sum + (s.content?.length ?? 0), 0);
      if (totalChars === 0) return null;
      const sec = estimateDurationSec(totalChars);
      return formatDuration(sec);
    })();

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
          onClick={(e) => {
            if (isParent && directChildren.length > 0 && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
              onToggleNode(nodeKey);
            }
            onSelectChapter(idx, e);
            if (status === "pending" && !isParent && !e.ctrlKey && !e.metaKey && !e.shiftKey) {
              onAnalyzeChapter(idx);
            }
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
          {editingIdx === idx ? (
            <input
              ref={editInputRef}
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitRename();
                if (e.key === "Escape") setEditingIdx(null);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 bg-background border border-primary rounded px-1 py-0 text-sm text-foreground outline-none"
            />
          ) : (
            <span
              className="truncate flex-1"
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingIdx(idx);
                setEditValue(entry.title);
              }}
            >
              {entry.title}
            </span>
          )}
          {editingPageIdx === idx ? (
            <input
              ref={editPageRef}
              value={editPageValue}
              onChange={(e) => setEditPageValue(e.target.value)}
              onBlur={commitPageEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter") commitPageEdit();
                if (e.key === "Escape") setEditingPageIdx(null);
                e.stopPropagation();
              }}
              onClick={(e) => e.stopPropagation()}
              className="w-10 bg-background border border-primary rounded px-1 py-0 text-[11px] font-mono text-foreground outline-none text-center flex-shrink-0"
            />
          ) : (
            <span
              className={`text-[11px] text-muted-foreground font-mono flex-shrink-0 ${isPdf ? 'cursor-pointer hover:text-primary hover:underline' : ''}`}
              onClick={(e) => {
                e.stopPropagation();
                if (isPdf) onOpenPdf?.(entry.startPage);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                setEditingPageIdx(idx);
                setEditPageValue(String(entry.startPage));
              }}
            >
              {entry.startPage}
            </span>
          )}
          {chapterDurationFormatted && (
            <span className="text-[11px] text-muted-foreground font-mono flex-shrink-0 flex items-center gap-0.5" title={isRu ? "Расчётное время" : "Estimated duration"}>
              <Clock className="h-3 w-3" />
              {chapterDurationFormatted}
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
            {directChildren.map(childIdx => renderNavItem(childIdx, depth + 1))}
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
        {isExpanded && rootEntries.map(({ idx }) => renderNavItem(idx, 0))}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full min-h-0 overflow-hidden bg-card/50">
      <div className="px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <BookOpen className="h-5 w-5 text-primary" />
          <span className="font-display font-semibold text-base text-foreground truncate flex-1">
            {fileName.replace(/\.(pdf|docx?|fb2)$/i, '')}
          </span>
          {(() => {
            const ext = fileName.match(/\.(pdf|docx?|fb2)$/i)?.[1]?.toUpperCase() || "PDF";
            return (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 font-mono shrink-0">
                {ext === "DOC" ? "DOCX" : ext}
              </Badge>
            );
          })()}
          {roleModels && Object.keys(roleModels).length > 0 && (
            <RoleBadges
              roles={Object.entries(roleModels).map(([roleId, model]) => ({ roleId: roleId as AiRoleId, model }))}
              isRu={isRu}
              size={14}
            />
          )}
          {isPdf && onOpenPdf && (
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 flex-shrink-0 text-muted-foreground hover:text-primary"
              title={isRu ? "Открыть PDF" : "Open PDF"}
              onClick={() => onOpenPdf?.()}
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-1">
          {totalPages} {t("pages", isRu)} • {contentEntries.length} {t("chapters", isRu)}
          {supplementaryEntries.length > 0 && ` • ${supplementaryEntries.length} ${t("suppl", isRu)}`}
        </p>
      </div>

      {/* Bulk actions toolbar */}
      {selectedIndices.size > 0 && (
        <div className="px-3 py-2 border-b border-border bg-primary/5 flex items-center gap-2 flex-wrap">
          <span className="text-xs text-primary font-medium">
            {selectedIndices.size} {t("selectedCount", isRu)}
          </span>
          <div className="flex items-center gap-1 ml-auto">
            {selectedIndices.size === 1 && (() => {
              const singleIdx = selectedArray[0];
              const singleResult = chapterResults.get(singleIdx);
              return singleResult?.status === "done" && singleResult.scenes.length > 0;
            })() && (
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-primary hover:text-primary"
                title={t("toStudio", isRu)}
                onClick={() => onSendToStudio(selectedArray[0])}
              >
                <Clapperboard className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6"
              title={isRu ? "Уменьшить вложенность" : "Outdent"}
              onClick={() => onChangeLevel(selectedArray, -1)}
              disabled={selectedArray.every(i => tocEntries[i]?.level === 0)}
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6"
              title={isRu ? "Увеличить вложенность" : "Indent"}
              onClick={() => onChangeLevel(selectedArray, 1)}
            >
              <ChevronRightIcon className="h-3.5 w-3.5" />
            </Button>
            {onMergeEntries && selectedIndices.size >= 2 && (
              <Button
                variant="ghost" size="icon"
                className="h-6 w-6 text-primary hover:text-primary"
                title={isRu ? "Объединить выбранные" : "Merge selected"}
                onClick={() => onMergeEntries(selectedArray)}
              >
                <Merge className="h-3.5 w-3.5" />
              </Button>
            )}
            <Button
              variant="ghost" size="icon"
              className="h-6 w-6 text-destructive hover:text-destructive"
              title={isRu ? "Удалить" : "Delete"}
              onClick={() => onDeleteEntry(selectedArray)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>
      )}

      <ScrollArea className="flex-1 min-h-0">
        <div className="py-2">
          {renderNavSection("preface")}

          {partGroups.map((group) => {
            const partKey = `part:${group.title}`;
            const isExpanded = expandedNodes.has(partKey);
            const firstIdx = group.indices[0];
            const firstEntry = firstIdx != null ? tocEntries[firstIdx] : null;
            return (
              <div key={group.title}>
                <button
                  onClick={() => onToggleNode(partKey)}
                  className="w-full flex items-center gap-1.5 px-4 py-1.5 text-sm font-semibold text-primary hover:bg-muted/30 transition-colors"
                >
                  {isExpanded ? <ChevronDown className="h-3.5 w-3.5 flex-shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 flex-shrink-0" />}
                  <FolderOpen className="h-3.5 w-3.5 flex-shrink-0" />
                  {editingPartTitle === group.title ? (
                    <input
                      ref={editPartRef}
                      value={editPartValue}
                      onChange={(e) => setEditPartValue(e.target.value)}
                      onBlur={commitPartRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitPartRename();
                        if (e.key === "Escape") setEditingPartTitle(null);
                        e.stopPropagation();
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="flex-1 bg-background border border-primary rounded px-1 py-0 text-sm text-foreground outline-none font-semibold"
                    />
                  ) : (
                    <span
                      className="truncate flex-1"
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        setEditingPartTitle(group.title);
                        setEditPartValue(group.title);
                      }}
                    >
                      {group.title}
                    </span>
                  )}
                  <span className="ml-auto flex items-center gap-1.5 flex-shrink-0">
                    {firstEntry && isPdf && (
                      <span
                        className="text-[11px] text-muted-foreground font-mono font-normal cursor-pointer hover:text-primary hover:underline"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenPdf?.(firstEntry.startPage);
                        }}
                      >
                        {t("partPagePrefix", isRu)}{firstEntry.startPage}
                      </span>
                    )}
                    <span className="text-[11px] text-muted-foreground/60 font-normal">·</span>
                    <span className="text-[11px] text-muted-foreground font-normal">{t("partChaptersSuffix", isRu)} {group.indices.length}</span>
                  </span>
                </button>
                {isExpanded && (
                  <div>
                    {group.indices.map(idx => renderNavItem(idx, 1))}
                  </div>
                )}
              </div>
            );
          })}

          {partlessIndices.map(idx => renderNavItem(idx, 0))}

          {renderNavSection("afterword")}
          {renderNavSection("endnotes")}
          {renderNavSection("appendix")}
        </div>
      </ScrollArea>
    </div>
  );
}
