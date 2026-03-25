import { useEffect, useState, useCallback } from 'react';
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
  const [stats, setStats] = useState<{ count: number; bytes: number } | null>(null);

  const handleStatsReady = useCallback((count: number, bytes: number) => {
    setStats({ count, bytes });
  }, []);

  useEffect(() => {
    setPageHeader({
      title: isRu ? 'Звуковое оформление книги' : 'Book Soundscape',
      subtitle: isRu ? 'Управление аудио-коллекциями' : 'Audio collections management',
      headerRight: stats ? (
        <div className="flex items-center gap-3">
          <Badge variant="secondary" className="gap-1.5 text-xs font-medium">
            <FolderOpen className="h-3.5 w-3.5" />
            {isRu ? 'Файлов' : 'Files'}: {stats.count}
          </Badge>
          <Badge variant="secondary" className="gap-1.5 text-xs font-medium">
            <HardDrive className="h-3.5 w-3.5" />
            {formatBytes(stats.bytes)}
          </Badge>
        </div>
      ) : undefined,
    });
    return () => setPageHeader({});
  }, [isRu, setPageHeader, stats]);

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
