import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import {
  HardDrive, FolderOpen, FileAudio, Search, Loader2, Trash2, Eye,
  Download, RefreshCw, Upload, Music, Waves, CloudRain, AudioLines,
  FileText, File, FileImage, ChevronDown, ChevronRight, FolderClosed,
  Ghost, ScanSearch, Trash, DatabaseBackup,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import { ImpulsesSection } from './ImpulsesSection';
import {
  isAudioAssetCached,
  removeAudioAssetFromCache,
  type AudioAssetCategory,
} from '@/lib/audioAssetCache';

/* ─── Types ───────────────────────────────────────────────────────────────── */

type StorageFile = {
  id: string;
  name: string;
  category: string;
  size: number;
  mime_type: string | null;
  created_at: string;
  /** Whether the file is cached locally in OPFS */
  cached?: boolean;
};

type PreviewState = { file: StorageFile; url: string; textContent?: string } | null;

/* ─── Categories (virtual folders inside user-media bucket) ───────────────── */

const CATEGORIES = ['sfx', 'atmosphere', 'music', 'audio-ready'] as const;
type Category = (typeof CATEGORIES)[number];

const CATEGORY_META: Record<Category, { icon: React.ElementType; ru: string; en: string; color: string; cacheCategory?: AudioAssetCategory }> = {
  sfx:           { icon: Waves,      ru: 'Звуковые эффекты', en: 'Sound Effects', color: 'text-primary border-primary/30', cacheCategory: 'sfx' },
  atmosphere:    { icon: CloudRain,  ru: 'Атмосфера',        en: 'Atmosphere',    color: 'text-accent border-accent/30', cacheCategory: 'atmosphere' },
  music:         { icon: Music,      ru: 'Музыка',           en: 'Music',         color: 'text-green-400 border-green-400/30' },
  'audio-ready': { icon: AudioLines, ru: 'Готовые аудио',    en: 'Ready Audio',   color: 'text-amber-400 border-amber-400/30' },
};

/* ─── Helpers ─────────────────────────────────────────────────────────────── */

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function fileIcon(mime: string | null) {
  if (!mime) return File;
  if (mime.startsWith('image/')) return FileImage;
  if (mime.startsWith('audio/')) return FileAudio;
  if (mime.startsWith('text/') || mime.includes('pdf')) return FileText;
  return File;
}

const isAudioFile = (mime: string | null) => mime?.startsWith('audio/') ?? false;
const isImageFile = (mime: string | null) => mime?.startsWith('image/') ?? false;

/* ─── Props ───────────────────────────────────────────────────────────────── */

interface StorageTabProps {
  isRu: boolean;
  userId: string;
}

/* ─── Component ───────────────────────────────────────────────────────────── */

export function StorageTab({ isRu, userId }: StorageTabProps) {
  const [files, setFiles] = useState<StorageFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState>(null);
  const [deleteTarget, setDeleteTarget] = useState<StorageFile | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [uploadingCategory, setUploadingCategory] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [activeUploadCategory, setActiveUploadCategory] = useState<Category | null>(null);

  /* Load files from all categories + check OPFS cache status */
  const loadFiles = useCallback(async () => {
    setLoading(true);
    try {
      const allFiles: StorageFile[] = [];
      for (const cat of CATEGORIES) {
        const prefix = `${userId}/${cat}`;
        const { data, error } = await supabase.storage.from('user-media').list(prefix, {
          limit: 500,
          sortBy: { column: 'created_at', order: 'desc' },
        });
        if (error || !data) continue;
        for (const item of data) {
          if (!item.id) continue; // skip folders
          allFiles.push({
            id: `${prefix}/${item.name}`,
            name: item.name,
            category: cat,
            size: item.metadata?.size ?? 0,
            mime_type: item.metadata?.mimetype ?? null,
            created_at: item.created_at ?? '',
            cached: false,
          });
        }
      }

      // Check OPFS cache status for cacheable categories (atmosphere, sfx)
      const cacheChecks = allFiles.map(async (f) => {
        const meta = CATEGORY_META[f.category as Category];
        if (meta?.cacheCategory) {
          f.cached = await isAudioAssetCached(meta.cacheCategory, f.id);
        }
      });
      await Promise.all(cacheChecks);

      setFiles(allFiles);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { loadFiles(); }, [loadFiles]);

  /* Upload */
  const handleUploadClick = (cat: Category) => {
    setActiveUploadCategory(cat);
    fileInputRef.current?.click();
  };

  const handleFileSelected = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files;
    if (!selected || selected.length === 0 || !activeUploadCategory) return;
    setUploadingCategory(activeUploadCategory);

    const uploadPromises = Array.from(selected).map(async (file) => {
      const path = `${userId}/${activeUploadCategory}/${file.name}`;
      const { error } = await supabase.storage.from('user-media').upload(path, file, { upsert: true });
      if (error) {
        toast.error(`${file.name}: ${error.message}`);
        return null;
      }
      return file.name;
    });

    const results = await Promise.all(uploadPromises);
    const uploaded = results.filter(Boolean);
    if (uploaded.length > 0) {
      toast.success(isRu ? `Загружено: ${uploaded.length}` : `Uploaded: ${uploaded.length}`);
      await loadFiles();
    }
    setUploadingCategory(null);
    setActiveUploadCategory(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  /* Delete — also removes from OPFS cache if applicable */
  const handleDelete = async (file: StorageFile) => {
    setDeletingId(file.id);
    try {
      const { error } = await supabase.storage.from('user-media').remove([file.id]);
      if (error) {
        toast.error(isRu ? 'Ошибка удаления' : 'Delete error');
      } else {
        // Also clear from OPFS cache
        const meta = CATEGORY_META[file.category as Category];
        if (meta?.cacheCategory) {
          removeAudioAssetFromCache(meta.cacheCategory, file.id).catch(() => {});
        }
        toast.success(`«${file.name}» ${isRu ? 'удалён' : 'deleted'}`);
        setFiles(prev => prev.filter(f => f.id !== file.id));
        if (preview?.file.id === file.id) setPreview(null);
      }
    } finally {
      setDeletingId(null);
    }
  };

  /* Preview / Download */
  const getSignedUrl = async (file: StorageFile): Promise<string | null> => {
    const { data, error } = await supabase.storage.from('user-media').createSignedUrl(file.id, 3600);
    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  };

  const handlePreview = async (file: StorageFile) => {
    const url = await getSignedUrl(file);
    if (!url) { toast.error(isRu ? 'Не удалось загрузить' : 'Failed to load'); return; }
    setPreview({ file, url });
  };

  const handleDownload = async (file: StorageFile) => {
    const url = await getSignedUrl(file);
    if (!url) { toast.error(isRu ? 'Не удалось загрузить' : 'Failed to load'); return; }
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
  };

  /* Derived data */
  const totalSize = useMemo(() => files.reduce((s, f) => s + f.size, 0), [files]);
  const displayed = useMemo(() => {
    if (!searchQuery.trim()) return files;
    return files.filter(f => f.name.toLowerCase().includes(searchQuery.toLowerCase()));
  }, [files, searchQuery]);

  const groupedFiles = useMemo(() => {
    const groups: Record<string, StorageFile[]> = {};
    for (const cat of CATEGORIES) groups[cat] = [];
    for (const f of displayed) {
      if (groups[f.category]) groups[f.category].push(f);
    }
    return groups;
  }, [displayed]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  /* ─── Render ─────────────────────────────────────────────────── */

  return (
    <TooltipProvider>
      <div className="space-y-6">
        {/* Hidden file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={handleFileSelected}
          accept="audio/*,image/*,.mp3,.wav,.ogg,.flac,.aac,.m4a"
        />

        {/* Stats */}
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {loading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-20" />)
          ) : (
            <>
              <StatCard label={isRu ? 'Файлов' : 'Files'} value={files.length} icon={FolderOpen} accent />
              <StatCard label={isRu ? 'Категорий' : 'Categories'} value={CATEGORIES.length} icon={HardDrive} />
              <StatCard label={isRu ? 'Размер' : 'Size'} value={formatBytes(totalSize)} icon={HardDrive} />
            </>
          )}
        </div>

        {/* Search + refresh */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={isRu ? 'Поиск по имени…' : 'Search by name…'}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              className="pl-9 h-8 text-sm"
            />
          </div>
          <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={loadFiles}>
            <RefreshCw className={cn('h-4 w-4', loading && 'animate-spin')} />
          </Button>
        </div>

        {/* File list grouped by category */}
        <div className="border rounded-md overflow-hidden">
          <ScrollArea className="h-[calc(100vh-28rem)] min-h-[300px]">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div>
                {CATEGORIES.map(cat => {
                  const meta = CATEGORY_META[cat];
                  const catFiles = groupedFiles[cat] || [];
                  const isCollapsed = collapsedGroups.has(cat);
                  const catSize = catFiles.reduce((s, f) => s + f.size, 0);
                  const CatIcon = meta.icon;

                  return (
                    <Collapsible key={cat} open={!isCollapsed} onOpenChange={() => toggleGroup(cat)}>
                      <div className="flex items-center border-b border-border">
                        <CollapsibleTrigger asChild>
                          <button className={cn(
                            'flex-1 flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors',
                            meta.color
                          )}>
                            {isCollapsed
                              ? <ChevronRight className="h-4 w-4 shrink-0" />
                              : <ChevronDown className="h-4 w-4 shrink-0" />}
                            <CatIcon className="h-5 w-5 shrink-0" />
                            <span className="text-base font-semibold">{isRu ? meta.ru : meta.en}</span>
                            <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">{catFiles.length}</Badge>
                            <span className="text-xs text-muted-foreground ml-auto mr-2">{formatBytes(catSize)}</span>
                          </button>
                        </CollapsibleTrigger>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 mr-2 shrink-0"
                              disabled={uploadingCategory === cat}
                              onClick={() => handleUploadClick(cat)}
                            >
                              {uploadingCategory === cat
                                ? <Loader2 className="h-4 w-4 animate-spin" />
                                : <Upload className="h-4 w-4" />}
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>{isRu ? 'Загрузить' : 'Upload'}</TooltipContent>
                        </Tooltip>
                      </div>
                      <CollapsibleContent>
                        {catFiles.length === 0 ? (
                          <div className="flex items-center justify-center py-6 text-muted-foreground text-sm">
                            <FolderClosed className="h-4 w-4 mr-2 opacity-40" />
                            {isRu ? 'Пусто' : 'Empty'}
                          </div>
                        ) : (
                          <div className="divide-y divide-border">
                            {catFiles.map(file => {
                              const Icon = fileIcon(file.mime_type);
                              const canPreview = isAudioFile(file.mime_type) || isImageFile(file.mime_type);
                              return (
                                <div
                                  key={file.id}
                                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
                                >
                                  <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
                                  <span className="text-sm truncate flex-1 min-w-0">{file.name}</span>
                                  <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
                                  {file.created_at && (
                                    <span className="text-xs text-muted-foreground shrink-0 hidden sm:block">
                                      {format(new Date(file.created_at), 'dd.MM.yy')}
                                    </span>
                                  )}
                                  <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                                    {canPreview && (
                                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePreview(file)}>
                                        <Eye className="h-3.5 w-3.5" />
                                      </Button>
                                    )}
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDownload(file)}>
                                      <Download className="h-3.5 w-3.5" />
                                    </Button>
                                    <Button
                                      variant="ghost"
                                      size="icon"
                                      className="h-7 w-7 text-destructive hover:text-destructive"
                                      disabled={deletingId === file.id}
                                      onClick={() => setDeleteTarget(file)}
                                    >
                                      {deletingId === file.id
                                        ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                        : <Trash2 className="h-3.5 w-3.5" />}
                                    </Button>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </CollapsibleContent>
                    </Collapsible>
                  );
                })}
              </div>
            )}
          </ScrollArea>
        </div>

        {/* ─── Impulses Section ─── */}
        <ImpulsesSection isRu={isRu} userId={userId} />

        {/* ─── Orphaned Files Section ─── */}
        <OrphanedFilesSection isRu={isRu} userId={userId} onPreview={handlePreview} />

        {/* Audio/Image preview dialog */}
        <Dialog open={!!preview} onOpenChange={open => !open && setPreview(null)}>
          <DialogContent className="max-w-2xl p-0 overflow-hidden bg-background/95 backdrop-blur">
            <DialogHeader className="px-4 pt-4 pb-3 border-b border-border">
              <DialogTitle className="text-sm font-medium truncate flex items-center gap-2">
                {preview?.file.mime_type?.startsWith('audio/')
                  ? <FileAudio className="h-4 w-4 text-primary shrink-0" />
                  : <FileImage className="h-4 w-4 text-primary shrink-0" />}
                {preview?.file.name}
              </DialogTitle>
            </DialogHeader>
            {preview && (
              <div className="p-4 flex flex-col items-center gap-4">
                {isAudioFile(preview.file.mime_type) && (
                  <audio controls src={preview.url} className="w-full max-w-lg" />
                )}
                {isImageFile(preview.file.mime_type) && (
                  <img
                    src={preview.url}
                    alt={preview.file.name}
                    className="max-w-full max-h-[60vh] object-contain rounded-md"
                  />
                )}
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <Badge variant="outline" className={cn('text-[10px]', CATEGORY_META[preview.file.category as Category]?.color)}>
                    {isRu ? CATEGORY_META[preview.file.category as Category]?.ru : CATEGORY_META[preview.file.category as Category]?.en}
                  </Badge>
                  <span>{formatBytes(preview.file.size)}</span>
                  <span>{preview.file.mime_type}</span>
                </div>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {/* Delete confirmation */}
        <AlertDialog open={!!deleteTarget} onOpenChange={open => !open && setDeleteTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{isRu ? 'Удалить файл?' : 'Delete file?'}</AlertDialogTitle>
              <AlertDialogDescription>
                {isRu
                  ? `«${deleteTarget?.name}» будет удалён безвозвратно.`
                  : `"${deleteTarget?.name}" will be permanently deleted.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{isRu ? 'Отмена' : 'Cancel'}</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  if (deleteTarget) {
                    handleDelete(deleteTarget);
                    setDeleteTarget(null);
                  }
                }}
              >
                {isRu ? 'Удалить' : 'Delete'}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  );
}

/* ─── Orphaned Files Section ──────────────────────────────────────────────── */

type OrphanedFile = {
  path: string;
  name: string;
  size: number;
  url?: string;
};

function OrphanedFilesSection({ isRu, userId, onPreview }: { isRu: boolean; userId: string; onPreview: (file: StorageFile) => void }) {
  const [orphans, setOrphans] = useState<OrphanedFile[]>([]);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [totalScanned, setTotalScanned] = useState(0);
  const [deleting, setDeleting] = useState<Set<string>>(new Set());
  const [deletingAll, setDeletingAll] = useState(false);
  const [deleteAllTarget, setDeleteAllTarget] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  const handleScan = async () => {
    setScanning(true);
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-orphaned-media', {
        body: { dry_run: true },
      });
      if (error) {
        toast.error(isRu ? 'Ошибка сканирования' : 'Scan error');
        console.error(error);
        return;
      }
      setTotalScanned(data.scanned ?? 0);
      const files: Array<{ path: string; size: number }> = data.files ?? [];
      setOrphans(files.map(f => ({ path: f.path, name: f.path.split('/').pop() ?? '', size: f.size ?? 0 })));
      setScanned(true);
    } finally {
      setScanning(false);
    }
  };

  const handleDeleteOne = async (orphan: OrphanedFile) => {
    setDeleting(prev => new Set(prev).add(orphan.path));
    try {
      const { error } = await supabase.storage.from('user-media').remove([orphan.path]);
      if (error) {
        toast.error(`${orphan.name}: ${error.message}`);
      } else {
        toast.success(`«${orphan.name}» ${isRu ? 'удалён' : 'deleted'}`);
        setOrphans(prev => prev.filter(o => o.path !== orphan.path));
      }
    } finally {
      setDeleting(prev => { const n = new Set(prev); n.delete(orphan.path); return n; });
    }
  };

  const handleDeleteAll = async () => {
    setDeletingAll(true);
    try {
      const { data, error } = await supabase.functions.invoke('cleanup-orphaned-media', {
        body: { dry_run: false },
      });
      if (error) {
        toast.error(isRu ? 'Ошибка очистки' : 'Cleanup error');
      } else {
        const count = data.deleted ?? 0;
        toast.success(isRu ? `Удалено: ${count}` : `Deleted: ${count}`);
        setOrphans([]);
      }
    } finally {
      setDeletingAll(false);
      setDeleteAllTarget(false);
    }
  };

  const handlePreviewOrphan = async (orphan: OrphanedFile) => {
    const asFile: StorageFile = {
      id: orphan.path,
      name: orphan.name,
      category: 'orphaned',
      size: 0,
      mime_type: orphan.name.endsWith('.mp3') ? 'audio/mpeg' : orphan.name.endsWith('.wav') ? 'audio/wav' : 'audio/mpeg',
      created_at: '',
    };
    onPreview(asFile);
  };

  return (
    <div className="border rounded-md overflow-hidden">
      <Collapsible open={!collapsed} onOpenChange={() => setCollapsed(c => !c)}>
        <div className="flex items-center border-b border-border">
          <CollapsibleTrigger asChild>
            <button className="flex-1 flex items-center gap-2 px-4 py-3 text-left hover:bg-muted/40 transition-colors text-orange-400 border-orange-400/30">
              {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <ChevronDown className="h-4 w-4 shrink-0" />}
              <Ghost className="h-5 w-5 shrink-0" />
              <span className="text-base font-semibold">{isRu ? 'Осиротевшие файлы' : 'Orphaned Files'}</span>
              {scanned && <Badge variant="outline" className="ml-1 h-5 px-1.5 text-xs">{orphans.length}</Badge>}
            </button>
          </CollapsibleTrigger>
          <div className="flex items-center gap-1 mr-2">
            {scanned && orphans.length > 0 && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive hover:text-destructive"
                    disabled={deletingAll}
                    onClick={() => setDeleteAllTarget(true)}
                  >
                    {deletingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash className="h-4 w-4" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{isRu ? 'Удалить все' : 'Delete all'}</TooltipContent>
              </Tooltip>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8" disabled={scanning} onClick={handleScan}>
                  {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <ScanSearch className="h-4 w-4" />}
                </Button>
              </TooltipTrigger>
              <TooltipContent>{isRu ? 'Сканировать' : 'Scan'}</TooltipContent>
            </Tooltip>
          </div>
        </div>

        <CollapsibleContent>
          {!scanned ? (
            <div className="flex flex-col items-center justify-center py-8 text-muted-foreground text-sm gap-2">
              <ScanSearch className="h-6 w-6 opacity-40" />
              <span>{isRu ? 'Нажмите 🔍 для сканирования' : 'Press 🔍 to scan'}</span>
            </div>
          ) : orphans.length === 0 ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground text-sm gap-2">
              <FolderClosed className="h-4 w-4 opacity-40" />
              <span>{isRu ? `Чисто! Просканировано: ${totalScanned}` : `Clean! Scanned: ${totalScanned}`}</span>
            </div>
          ) : (
            <>
              <div className="px-4 py-2 text-xs text-muted-foreground border-b border-border">
                {isRu
                  ? `Найдено ${orphans.length} осиротевших из ${totalScanned} просканированных`
                  : `Found ${orphans.length} orphaned out of ${totalScanned} scanned`}
              </div>
              <div className="divide-y divide-border max-h-64 overflow-y-auto">
                {orphans.map(orphan => (
                  <div
                    key={orphan.path}
                    className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/30 transition-colors group"
                  >
                    <FileAudio className="h-4 w-4 text-muted-foreground shrink-0" />
                    <span className="text-sm truncate flex-1 min-w-0" title={orphan.path}>{orphan.name}</span>
                    <span className="text-xs text-muted-foreground shrink-0">{formatBytes(orphan.size)}</span>
                    <span className="text-[10px] text-muted-foreground truncate max-w-[150px] hidden sm:block" title={orphan.path}>
                      {orphan.path.split('/').slice(0, -1).join('/')}
                    </span>
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handlePreviewOrphan(orphan)}>
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive hover:text-destructive"
                        disabled={deleting.has(orphan.path)}
                        onClick={() => handleDeleteOne(orphan)}
                      >
                        {deleting.has(orphan.path)
                          ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </CollapsibleContent>
      </Collapsible>

      {/* Delete all confirmation */}
      <AlertDialog open={deleteAllTarget} onOpenChange={open => !open && setDeleteAllTarget(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{isRu ? 'Удалить все осиротевшие файлы?' : 'Delete all orphaned files?'}</AlertDialogTitle>
            <AlertDialogDescription>
              {isRu
                ? `${orphans.length} файлов будут удалены безвозвратно.`
                : `${orphans.length} files will be permanently deleted.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{isRu ? 'Отмена' : 'Cancel'}</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteAll}
            >
              {isRu ? 'Удалить все' : 'Delete all'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/* ─── StatCard ────────────────────────────────────────────────────────────── */

function StatCard({ label, value, icon: Icon, accent }: { label: string; value: string | number; icon: React.ElementType; accent?: boolean }) {
  return (
    <Card className={cn('border', accent ? 'border-primary/40 bg-primary/5' : 'border-border bg-card')}>
      <CardContent className="flex items-start gap-3 p-4">
        <div className={cn('rounded-lg p-2 mt-0.5 shrink-0', accent ? 'bg-primary/15' : 'bg-muted')}>
          <Icon className={cn('h-5 w-5', accent ? 'text-primary' : 'text-muted-foreground')} />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-bold leading-tight">{label}</p>
          <p className="text-2xl font-extrabold mt-0.5">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
