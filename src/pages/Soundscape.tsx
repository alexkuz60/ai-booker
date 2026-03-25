import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { motion } from 'framer-motion';
import { HardDrive, FolderOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';

import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StorageTab } from '@/components/profile/tabs/StorageTab';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const val = bytes / Math.pow(1024, i);
  return `${val.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export default function Soundscape() {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();
  const [fileCount, setFileCount] = useState(0);
  const [totalBytes, setTotalBytes] = useState(0);

  const handleStatsReady = useCallback((count: number, bytes: number) => {
    setFileCount(count);
    setTotalBytes(bytes);
  }, []);

  const headerRight = useMemo(() => {
    if (!fileCount && !totalBytes) return undefined;
    return (
      <div className="flex items-center gap-3">
        <Badge variant="secondary" className="gap-1.5 text-xs font-medium">
          <FolderOpen className="h-3.5 w-3.5" />
          {isRu ? 'Файлов' : 'Files'}: {fileCount}
        </Badge>
        <Badge variant="secondary" className="gap-1.5 text-xs font-medium">
          <HardDrive className="h-3.5 w-3.5" />
          {formatBytes(totalBytes)}
        </Badge>
      </div>
    );
  }, [fileCount, totalBytes, isRu]);

  const headerRightRef = useRef(headerRight);
  headerRightRef.current = headerRight;

  useEffect(() => {
    setPageHeader({
      title: isRu ? 'Звуковое оформление книги' : 'Book Soundscape',
      subtitle: isRu ? 'Управление аудио-коллекциями' : 'Audio collections management',
      headerRight: headerRightRef.current,
    });
    return () => setPageHeader({});
  }, [isRu, setPageHeader, fileCount, totalBytes]);

  if (!user) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 p-4 sm:p-8 w-full space-y-6"
    >
      <StorageTab isRu={isRu} userId={user.id} onStatsReady={handleStatsReady} />
    </motion.div>
  );
}
