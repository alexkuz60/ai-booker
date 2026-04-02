import { useState, useCallback } from "react";
import {
  FolderClosed, FolderOpen, Trash2, RefreshCw, Loader2,
  ChevronRight, ChevronDown, FileText, File, FileAudio, AlertTriangle, Eye,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { isOPFSSupported } from "@/lib/projectStorage";

/* ─── Types ──────────────────────────────────────────── */

interface OpfsEntry {
  name: string;
  kind: "file" | "directory";
  path: string;           // full path from OPFS root
  size?: number;
  children?: OpfsEntry[];
}

/* ─── Helpers ────────────────────────────────────────── */

async function readDir(dir: FileSystemDirectoryHandle, parentPath = "", depth = 0): Promise<OpfsEntry[]> {
  const entries: OpfsEntry[] = [];
  for await (const [name, handle] of (dir as any).entries()) {
    const fullPath = parentPath ? `${parentPath}/${name}` : name;
    if (handle.kind === "directory") {
      const children = depth < 2
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

/** Read a file from OPFS by path segments */
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
  entry, depth, isRu, onViewJson,
}: {
  entry: OpfsEntry;
  depth: number;
  isRu: boolean;
  onViewJson: (path: string, name: string) => void;
}) {
  const [open, setOpen] = useState(depth < 1);
  const isJson = entry.name.endsWith(".json");

  if (entry.kind === "file") {
    const Icon = isJson ? FileText
      : (entry.name.endsWith(".mp3") || entry.name.endsWith(".wav") || entry.name.endsWith(".ogg")) ? FileAudio
      : File;
    return (
      <div className="group flex items-center gap-1.5 py-0.5 text-xs text-muted-foreground" style={{ paddingLeft: depth * 16 }}>
        <Icon className="h-3.5 w-3.5 shrink-0 opacity-60" />
        <span className={cn("truncate", isJson && "cursor-pointer hover:text-foreground")}
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
        {entry.size != null && <span className="ml-auto text-[10px] opacity-50 shrink-0">{formatBytes(entry.size)}</span>}
      </div>
    );
  }

  const FolderIcon = open ? FolderOpen : FolderClosed;
  const Chevron = open ? ChevronDown : ChevronRight;
  const stats = entry.children ? countEntries(entry.children) : null;

  return (
    <div>
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 py-0.5 w-full text-left text-xs hover:bg-muted/50 rounded-sm px-1"
        style={{ paddingLeft: depth * 16 }}
      >
        <Chevron className="h-3 w-3 shrink-0 text-muted-foreground" />
        <FolderIcon className="h-3.5 w-3.5 shrink-0 text-primary" />
        <span className="font-medium truncate">{entry.name}</span>
        {stats && (
          <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
            {stats.files}f {stats.dirs > 0 ? `${stats.dirs}d ` : ""}{stats.bytes > 0 ? formatBytes(stats.bytes) : ""}
          </span>
        )}
      </button>
      {open && entry.children && (
        <div>
          {entry.children.map(child => (
            <EntryNode key={child.name} entry={child} depth={depth + 1} isRu={isRu} onViewJson={onViewJson} />
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

/* ─── Main panel ─────────────────────────────────────── */

interface OpfsBrowserPanelProps {
  isRu: boolean;
}

export function OpfsBrowserPanel({ isRu }: OpfsBrowserPanelProps) {
  const [entries, setEntries] = useState<OpfsEntry[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // JSON viewer
  const [jsonViewer, setJsonViewer] = useState<{ name: string; content: string } | null>(null);
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

  const handleViewJson = useCallback(async (path: string, name: string) => {
    setJsonLoading(true);
    setJsonViewer({ name, content: "" });
    try {
      const text = await readOpfsFile(path);
      // Try to pretty-print
      let formatted: string;
      try {
        formatted = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        formatted = text;
      }
      setJsonViewer({ name, content: formatted });
    } catch (err: any) {
      setJsonViewer({ name, content: `Error: ${err.message}` });
    } finally {
      setJsonLoading(false);
    }
  }, []);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const root = await navigator.storage.getDirectory();
      await root.removeEntry(deleteTarget, { recursive: true });
      toast.success(`«${deleteTarget}» ${isRu ? "удалено" : "deleted"}`);
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
      <Card>
        <CardContent className="py-8 text-center text-muted-foreground text-sm">
          {isRu ? "OPFS не поддерживается этим браузером" : "OPFS is not supported by this browser"}
        </CardContent>
      </Card>
    );
  }

  const topFolders = entries?.filter(e => e.kind === "directory") ?? [];
  const topFiles = entries?.filter(e => e.kind === "file") ?? [];
  const totalStats = entries ? countEntries(entries) : null;

  return (
    <>
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <FolderOpen className="h-4 w-4 text-primary" />
              {isRu ? "OPFS браузер" : "OPFS Browser"}
              <Badge variant="outline" className="text-[10px] font-normal">admin</Badge>
            </CardTitle>
            <Button variant="ghost" size="sm" className="h-7 text-xs gap-1.5" onClick={scan} disabled={loading}>
              <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              {isRu ? "Сканировать" : "Scan"}
            </Button>
          </div>
          {totalStats && (
            <p className="text-[11px] text-muted-foreground mt-1">
              {isRu ? "Всего:" : "Total:"} {totalStats.dirs} {isRu ? "папок" : "dirs"}, {totalStats.files} {isRu ? "файлов" : "files"}
              {totalStats.bytes > 0 && ` (${formatBytes(totalStats.bytes)})`}
            </p>
          )}
        </CardHeader>
        <CardContent>
          {entries === null && !loading && (
            <div className="text-center py-6 text-xs text-muted-foreground">
              {isRu
                ? "Нажмите «Сканировать» для просмотра содержимого OPFS"
                : 'Click "Scan" to view OPFS contents'}
            </div>
          )}
          {loading && (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}
          {entries !== null && !loading && (
            <ScrollArea className="h-[calc(100vh-24rem)] min-h-[250px] max-h-[600px]">
              <div className="space-y-0.5">
                {topFolders.map(folder => (
                  <div key={folder.name} className="group relative">
                    <EntryNode entry={folder} depth={0} isRu={isRu} onViewJson={handleViewJson} />
                    <Button
                      variant="ghost"
                      size="icon"
                      className="absolute right-0 top-0 h-6 w-6 opacity-0 group-hover:opacity-100 text-destructive hover:text-destructive"
                      onClick={() => setDeleteTarget(folder.name)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                ))}
                {topFiles.map(f => (
                  <EntryNode key={f.name} entry={f} depth={0} isRu={isRu} onViewJson={handleViewJson} />
                ))}
                {entries.length === 0 && (
                  <div className="text-center py-4 text-xs text-muted-foreground">
                    {isRu ? "OPFS пуст" : "OPFS is empty"}
                  </div>
                )}
              </div>
            </ScrollArea>
          )}
        </CardContent>
      </Card>

      {/* JSON viewer dialog */}
      <Dialog open={!!jsonViewer} onOpenChange={open => !open && setJsonViewer(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-sm font-mono">
              <FileText className="h-4 w-4 text-primary" />
              {jsonViewer?.name}
            </DialogTitle>
          </DialogHeader>
          {jsonLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <ScrollArea className="flex-1 min-h-0 max-h-[60vh]">
              <pre className="text-xs font-mono whitespace-pre-wrap break-words p-3 bg-muted/50 rounded-md">
                {jsonViewer?.content}
              </pre>
            </ScrollArea>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              {isRu ? "Удалить папку?" : "Delete folder?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {isRu
                ? `Папка «${deleteTarget}» и всё её содержимое будут безвозвратно удалены из OPFS.`
                : `Folder "${deleteTarget}" and all its contents will be permanently deleted from OPFS.`}
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
