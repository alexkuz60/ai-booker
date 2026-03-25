import { useEffect } from 'react';
import { motion } from 'framer-motion';
import { HardDrive } from 'lucide-react';

import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { usePageHeader } from '@/hooks/usePageHeader';
import { StorageTab } from '@/components/profile/tabs/StorageTab';

export default function Soundscape() {
  const { user } = useAuth();
  const { isRu } = useLanguage();
  const { setPageHeader } = usePageHeader();

  useEffect(() => {
    setPageHeader({
      title: isRu ? 'Звуки' : 'Soundscape',
      subtitle: isRu ? 'Управление аудио-коллекциями' : 'Audio collections management',
    });
    return () => setPageHeader({});
  }, [isRu, setPageHeader]);

  if (!user) return null;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 p-4 sm:p-8 max-w-5xl mx-auto w-full space-y-10"
    >
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">
          {isRu ? 'Звуки' : 'Soundscape'}
        </h1>
        <p className="text-muted-foreground font-body mt-1">
          {isRu ? 'Управление аудио-коллекциями' : 'Audio collections management'}
        </p>
      </div>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <HardDrive className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold font-display">
            {isRu ? 'Файлохранилище' : 'File Storage'}
          </h2>
        </div>
        <StorageTab isRu={isRu} userId={user.id} />
      </section>
    </motion.div>
  );
}
