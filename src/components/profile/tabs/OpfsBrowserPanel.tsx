import { useState, useCallback, useEffect } from "react";
import {
  FolderClosed, FolderOpen, Trash2, RefreshCw, Loader2,
  ChevronRight, ChevronDown, FileText, File, FileAudio, AlertTriangle, Eye,
  ShieldCheck, ShieldOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  ResizableHandle, ResizablePanel, ResizablePanelGroup,
} from "@/components/ui/resizable";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isOPFSSupported } from "@/lib/projectStorage";
import { JsonTreeView } from "./JsonTreeView";


/* ─── Types ──────────────────────────────────────────── */

interface OpfsEntry {
  name: string;
  kind: "file" | "directory";
  path: string;
  size?: number;
  children?: OpfsEntry[];
}

/* ─── Helpers ────────────────────────────────────────── */

async function readDir(dir: FileSystemDirectoryHandle, parentPath = "", depth = 0): Promise<OpfsEntry[]> {
  const entries: OpfsEntry[] = [];
  for await (const [name, handle] of (dir as any).entries()) {
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === "directory") {
      const children = depth < 6
        ? await readDir(handle as FileSystemDirectoryHandle, fullPath, depth + 1)
        : undefined;
      entries.push({ name, kind: "directory", path: fullPath, children });
    } else {
      let size: number | undefined;
      try {
        const f = await (handle as FileSystemFileHandle).getFile();
        size = f.size;
      } catch { /* skip */ }
      entries.push({ name, kind: "file", path: fullPath, size });
    }
  }
  return entries.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "directory" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

async function readOpfsFile(path: string): Promise<string> {
  const parts = path.split("/").filter(Boolean);
  let dir: FileSystemDirectoryHandle = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryHandle;
  for (let i = 0; i < parts.length - 1; i++) {
    dir = await dir.getDirectoryHandle(parts[i]);
  }
  const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
  const file = await fileHandle.getFile();
  return file.text();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function countEntries(entries: OpfsEntry[]): { files: number; dirs: number; bytes: number } {
  let files = 0, dirs = 0, bytes = 0;
  for (const e of entries) {
    if (e.kind === "directory") {
      dirs++;
      if (e.children) {
        const sub = countEntries(e.children);
        files += sub.files;
        dirs += sub.dirs;
        bytes += sub.bytes;
      }
    } else {
      files++;
      bytes += e.size ?? 0;
    }
  }
  return { files, dirs, bytes };
}

/* ─── Tree node ──────────────────────────────────────── */

function EntryNode({
  entry, depth, isRu, onViewJson, selectedPath, onDelete,
}: {
  entry: OpfsEntry;
  depth: number;
  isRu: boolean;
  onViewJson: (path: string, name: string) => void;
  selectedPath?: string;
  onDelete: (path: string, name: string, kind: "file" | "directory") => void;
}) {
  const isAudioCache = entry.kind === "directory" && /^(audio|tts|atmosphere|renders|soundscape_cache)$/.test(entry.name);
  const [open, setOpen] = useState(depth < 1 && !isAudioCache);
  const isJson = entry.name.endsWith(".json");
  const isSelected = isJson && entry.path === selectedPath;

  if (entry.kind === "file") {
    const Icon = isJson ? FileText
      : (entry.name.endsWith(".mp3") || entry.name.endsWith(".wav") || entry.name.endsWith(".ogg")) ? FileAudio
      : File;
    return (
      <div
        className={cn(
          "group flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground",
          isSelected && "bg-primary/10 text-foreground rounded-sm",
        )}
        style={{ paddingLeft: depth * 16 }}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span
          className={cn("truncate", isJson && "cursor-pointer hover:text-foreground")}
          onClick={isJson ? () => onViewJson(entry.path, entry.name) : undefined}
        >
          {entry.name}
        </span>
        {isJson && (
          <Button
            variant="ghost" size="icon"
            className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0"
            onClick={() => onViewJson(entry.path, entry.name)}
          >
            <Eye className="h-3 w-3" />
          </Button>
        )}
        <Button
          variant="ghost" size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0 text-destructive hover:text-destructive"
          onClick={() => onDelete(entry.path, entry.name, "file")}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
        {entry.size != null && <span className="ml-auto mr-5 text-[10px] opacity-50 shrink-0">{formatBytes(entry.size)}</span>}
      </div>
    );
  }

  const FolderIcon = open ? FolderOpen : FolderClosed;
  const Chevron = open ? ChevronDown : ChevronRight;
  const stats = entry.children ? countEntries(entry.children) : null;

  return (
    <div>
      <div className="group flex items-center">
        <button
          onClick={() => setOpen(!open)}
          className="flex items-center gap-1.5 py-0.5 flex-1 text-left text-xs hover:bg-muted/50 rounded-sm px-1"
          style={{ paddingLeft: depth * 16 }}
        >
          <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />
          <FolderIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="font-medium truncate">{entry.name}</span>
          {stats && (
            <span className="ml-auto mr-1 text-[10px] text-muted-foreground shrink-0">
              {stats.files}f {stats.dirs > 0 ? `${stats.dirs}d ` : ""}{stats.bytes > 0 ? formatBytes(stats.bytes) : ""}
            </span>
          )}
        </button>
        <Button
          variant="ghost" size="icon"
          className="h-5 w-5 opacity-0 group-hover:opacity-100 shrink-0 text-destructive hover:text-destructive"
          onClick={() => onDelete(entry.path, entry.name, "directory")}
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      </div>
      {open && entry.children && (
        <div>
          {entry.children.map(child => (
            <EntryNode key={child.name} entry={child} depth={depth + 1} isRu={isRu} onViewJson={onViewJson} selectedPath={selectedPath} onDelete={onDelete} />
          ))}
          {entry.children.length === 0 && (
            <div className="text-[10px] text-muted-foreground italic py-0.5" style={{ paddingLeft: (depth + 1) * 16 }}>
              {isRu ? "(пусто)" : "(empty)"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ─── Persistent Storage button ──────────────────────── */

function PersistentStorageButton({ isRu }: { isRu: boolean }) {
  const [persisted, setPersisted] = useState<boolean | null>(null);
  const [requesting, setRequesting] = useState(false);

  const supported = typeof navigator !== "undefined" && !!navigator.storage?.persist;

  useEffect(() => {
    if (!supported) return;
    navigator.storage.persisted().then(setPersisted);
  }, [supported]);

  const handleRequest = async () => {
    if (!supported) {
      toast.warning(isRu ? "Ваш браузер не поддерживает Persistent Storage" : "Your browser does not support Persistent Storage");
      return;
    }
    setRequesting(true);
    try {
      const granted = await navigator.storage.persist();
      setPersisted(granted);
      if (granted) {
        toast.success(isRu ? "Persistent Storage активирован" : "Persistent Storage granted");
      } else {
        toast.warning(isRu ? "Браузер отклонил запрос Persistent Storage. Попробуйте добавить сайт в закладки или установить как PWA." : "Browser denied Persistent Storage. Try bookmarking the site or installing as PWA.");
      }
    } catch (err: any) {
      toast.error(err.message || "Persist request failed");
    } finally {
      setRequesting(false);
    }
  };

  if (!supported) return null;

  return (
    <Button
      variant={persisted ? "outline" : "default"}
      size="sm"
      className="h-7 text-xs gap-1.5"
      onClick={handleRequest}
      disabled={persisted === true || requesting}
    >
      {persisted ? (
        <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 dark:text-emerald-400" />
      ) : (
        <ShieldOff className="h-3.5 w-3.5" />
      )}
      {persisted
        ? (isRu ? "Persistent ✓" : "Persistent ✓")
        : requesting
          ? (isRu ? "Запрос…" : "Requesting…")
          : (isRu ? "Persistent Storage" : "Persistent Storage")}
    </Button>
  );
}

/* ─── Main panel ─────────────────────────────────────── */

interface OpfsBrowserPanelProps {
  isRu: boolean;
}

export function OpfsBrowserPanel({ isRu }: OpfsBrowserPanelProps) {
  const [entries, setEntries] = useState<OpfsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<{ path: string; name: string; kind: "file" | "directory" } | null>(null);
  const [deleting, setDeleting] = useState(false);

  // JSON viewer — inline in right panel
  const [jsonViewer, setJsonViewer] = useState<{ name: string; path: string; content: string } | null>(null);
  const [jsonLoading, setJsonLoading] = useState(false);


  const supported = isOPFSSupported();

  const scan = useCallback(async () => {
    if (!supported) return;
    setLoading(true);
    try {
      const root = await navigator.storage.getDirectory();
      const result = await readDir(root as unknown as FileSystemDirectoryHandle);
      setEntries(result);
    } catch (err: any) {
      toast.error(err.message || "OPFS scan failed");
    } finally {
      setLoading(false);
    }
  }, [supported]);

  // Auto-scan on mount
  useEffect(() => { scan(); }, [scan]);

  const handleViewJson = useCallback(async (path: string, name: string) => {
    setJsonLoading(true);
    setJsonViewer({ name, path, content: "" });
    try {
      const text = await readOpfsFile(path);
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        formatted = text;
      }
      setJsonViewer({ name, path, content: formatted });
    } catch (err: any) {
      setJsonViewer({ name, path, content: `Error: ${err.message}` });
    } finally {
      setJsonLoading(false);
    }
  }, []);

  const handleRequestDelete = useCallback((path: string, name: string, kind: "file" | "directory") => {
    setDeleteTarget({ path, name, kind });
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const parts = deleteTarget.path.split("/").filter(Boolean);
      const entryName = parts.pop()!;
      let dir: FileSystemDirectoryHandle = await navigator.storage.getDirectory() as unknown as FileSystemDirectoryHandle;
      for (const p of parts) {
        dir = await dir.getDirectoryHandle(p);
      }
      await dir.removeEntry(entryName, { recursive: true });
      toast.success(`«${deleteTarget.name}» ${isRu ? "удалено" : "deleted"}`);
      // Clear viewer if deleted file was being viewed
      if (jsonViewer && jsonViewer.path.startsWith(deleteTarget.path)) {
        setJsonViewer(null);
      }
      setDeleteTarget(null);
      await scan();
    } catch (err: any) {
      toast.error(err.message || "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  if (!supported) {
    return (
      <div className="py-8 text-center text-muted-foreground text-sm">
        {isRu ? "OPFS не поддерживается этим браузером" : "OPFS is not supported by this browser"}
      </div>
    );
  }

  const topFolders = entries?.filter(e => e.kind === "directory") ?? [];
  const topFiles = entries?.filter(e => e.kind === "file") ?? [];
  const totalStats = entries ? countEntries(entries) : null;

  return (
    <>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-semibold flex items-center gap-2">
            <FolderOpen className="h-4 w-4 text-primary" />
            {isRu ? "OPFS браузер" : "OPFS Browser"}
            <Badge variant="outline" className="text-[10px] font-normal">admin</Badge>
          </h3>
          {totalStats && (
            <p className="text-[11px] text-muted-foreground mt-0.5">
              {isRu ? "Всего:" : "Total:"} {totalStats.dirs} {isRu ? "папок" : "dirs"}, {totalStats.files} {isRu ? "файлов" : "files"}
              {totalStats.bytes > 0 && ` (${formatBytes(totalStats.bytes)})`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-1.5">
          <PersistentStorageButton isRu={isRu} />
          <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={scan} disabled={loading}>
            <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
            {isRu ? "Обновить" : "Refresh"}
          </Button>
        </div>
      </div>

      {/* Split panel */}
      <div className="border rounded-lg overflow-hidden" style={{ height: "calc(100vh - 20rem)" }}>
        <ResizablePanelGroup direction="horizontal">
          {/* Left: tree navigator */}
          <ResizablePanel defaultSize={45} minSize={25}>
            <div className="h-full overflow-auto p-2">
              {entries === null && !loading && (
                <div className="text-center py-6 text-xs text-muted-foreground">
                  {isRu ? "Нет данных" : "No data"}
                </div>
              )}
              {loading && (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              )}
              {entries !== null && !loading && (
                <div className="space-y-0.5">
                  {topFolders.map(folder => (
                    <EntryNode key={folder.name} entry={folder} depth={0} isRu={isRu} onViewJson={handleViewJson} selectedPath={jsonViewer?.path} onDelete={handleRequestDelete} />
                  ))}
                  {topFiles.map(f => (
                    <EntryNode key={f.name} entry={f} depth={0} isRu={isRu} onViewJson={handleViewJson} selectedPath={jsonViewer?.path} onDelete={handleRequestDelete} />
                  ))}
                  {entries.length === 0 && (
                    <div className="text-center py-4 text-xs text-muted-foreground">
                      {isRu ? "OPFS пуст" : "OPFS is empty"}
                    </div>
                  )}
                </div>
              )}
            </div>
          </ResizablePanel>

          <ResizableHandle withHandle />

          {/* Right: file viewer */}
          <ResizablePanel defaultSize={55} minSize={25}>
            <div className="h-full overflow-auto p-2">
              {!jsonViewer && (
                <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
                  {isRu ? "Выберите JSON-файл для просмотра" : "Select a JSON file to view"}
                </div>
              )}
              {jsonViewer && (
                <div className="h-full flex flex-col">
                  <div className="flex items-center gap-2 pb-2 border-b mb-2 shrink-0">
                    <FileText className="h-3.5 w-3.5 text-primary shrink-0" />
                    <span className="text-xs font-mono truncate">{jsonViewer.name}</span>
                    <span className="text-[10px] text-muted-foreground truncate ml-auto">{jsonViewer.path}</span>
                  </div>
                  {jsonLoading ? (
                    <div className="flex items-center justify-center flex-1">
                      <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                    </div>
                  ) : (
                    <div className="flex-1 overflow-auto min-h-0">
                      <JsonTreeView content={jsonViewer.content} />
                    </div>
                  )}
                </div>
              )}
            </div>
          </ResizablePanel>
        </ResizablePanelGroup>
      </div>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {deleteTarget?.kind === "file"
                ? (isRu ? "Удалить файл?" : "Delete file?")
                : (isRu ? "Удалить папку?" : "Delete folder?")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isRu
                ? `«${deleteTarget?.path}» будет безвозвратно удалён из OPFS.`
                : `"${deleteTarget?.path}" will be permanently deleted from OPFS.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>
              {isRu ? "Отмена" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={deleting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleting && <Loader2 className="h-4 w-4 animate-spin mr-1.5" />}
              {isRu ? "Удалить" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
