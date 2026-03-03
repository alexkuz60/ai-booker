import { useState, useCallback } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { User, Key, Settings } from 'lucide-react';
import { toast } from 'sonner';

import { ProfileTab } from '@/components/profile/tabs/ProfileTab';
import { PreferencesTab } from '@/components/profile/tabs/PreferencesTab';
import { ApiKeysTab } from '@/components/profile/tabs/ApiKeysTab';

const STORAGE_PREFIX = 'ai-booker-profile';

function loadJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? JSON.parse(v) : fallback;
  } catch {
    return fallback;
  }
}

export default function Profile() {
  const { theme, setTheme } = useTheme();
  const [lang, setLang] = useState<string>(() => loadJson(`${STORAGE_PREFIX}-lang`, 'ru'));
  const isRu = lang === 'ru';

  // Profile state
  const [displayName, setDisplayName] = useState(() => loadJson(`${STORAGE_PREFIX}-displayName`, ''));
  const [username, setUsername] = useState(() => loadJson(`${STORAGE_PREFIX}-username`, ''));
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // API keys
  const [apiKeys, setApiKeys] = useState<Record<string, string>>(() => loadJson(`${STORAGE_PREFIX}-apiKeys`, {}));

  // Tab persistence
  const [userTab, setUserTab] = useState(() => loadJson(`${STORAGE_PREFIX}-userTab`, 'profile'));
  const [apiTab, setApiTab] = useState(() => loadJson(`${STORAGE_PREFIX}-apiTab`, 'api-keys'));

  const handleUserTab = useCallback((t: string) => {
    setUserTab(t);
    localStorage.setItem(`${STORAGE_PREFIX}-userTab`, JSON.stringify(t));
  }, []);

  const handleApiTab = useCallback((t: string) => {
    setApiTab(t);
    localStorage.setItem(`${STORAGE_PREFIX}-apiTab`, JSON.stringify(t));
  }, []);

  const handleSaveProfile = () => {
    setSaving(true);
    localStorage.setItem(`${STORAGE_PREFIX}-displayName`, JSON.stringify(displayName));
    localStorage.setItem(`${STORAGE_PREFIX}-username`, JSON.stringify(username));
    localStorage.setItem(`${STORAGE_PREFIX}-lang`, JSON.stringify(lang));
    setTimeout(() => {
      setSaving(false);
      toast.success(isRu ? 'Сохранено' : 'Saved');
    }, 300);
  };

  const handleSaveApiKeys = () => {
    setSaving(true);
    localStorage.setItem(`${STORAGE_PREFIX}-apiKeys`, JSON.stringify(apiKeys));
    setTimeout(() => {
      setSaving(false);
      toast.success(isRu ? 'Ключи сохранены' : 'Keys saved');
    }, 300);
  };

  const setKeyValue = useCallback((provider: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [provider]: value }));
  }, []);

  const handleLangChange = (v: string) => {
    setLang(v);
    localStorage.setItem(`${STORAGE_PREFIX}-lang`, JSON.stringify(v));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 p-4 sm:p-8 max-w-4xl mx-auto w-full space-y-10"
    >
      {/* Header */}
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">
          {isRu ? 'Профиль' : 'Profile'}
        </h1>
        <p className="text-muted-foreground font-body mt-1">
          {isRu ? 'Настройки пользователя и API' : 'User settings & API'}
        </p>
      </div>

      {/* ══════════ Section 1: Personal ══════════ */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <User className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold font-display">
            {isRu ? 'Личный кабинет' : 'Personal'}
          </h2>
        </div>
        <Tabs value={userTab} onValueChange={handleUserTab} className="space-y-6">
          <TabsList className="flex w-full h-auto flex-wrap gap-0.5">
            <TabsTrigger value="profile" className="flex items-center gap-2 flex-1">
              <User className="h-4 w-4 shrink-0" />
              <span>{isRu ? 'Профиль' : 'Profile'}</span>
            </TabsTrigger>
            <TabsTrigger value="preferences" className="flex items-center gap-2 flex-1">
              <Settings className="h-4 w-4 shrink-0" />
              <span>{isRu ? 'Настройки' : 'Preferences'}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileTab
              email="user@example.com"
              displayName={displayName}
              username={username}
              avatarUrl={avatarUrl}
              avatarSaving={false}
              saving={saving}
              isRu={isRu}
              onDisplayNameChange={setDisplayName}
              onUsernameChange={setUsername}
              onSave={handleSaveProfile}
              onAvatarFileSelect={() => {}}
              onDeleteAvatar={() => setAvatarUrl(null)}
            />
          </TabsContent>

          <TabsContent value="preferences">
            <PreferencesTab
              theme={theme || 'dark'}
              language={lang}
              saving={saving}
              isRu={isRu}
              onThemeChange={setTheme}
              onLanguageChange={handleLangChange}
              onSave={handleSaveProfile}
            />
          </TabsContent>
        </Tabs>
      </section>

      <Separator className="my-2" />

      {/* ══════════ Section 2: API Management ══════════ */}
      <section>
        <div className="flex items-center gap-2 mb-4">
          <Key className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold font-display">
            {isRu ? 'Управление API' : 'API Management'}
          </h2>
        </div>
        <Tabs value={apiTab} onValueChange={handleApiTab} className="space-y-6">
          <TabsList className="flex w-full h-auto flex-wrap gap-0.5">
            <TabsTrigger value="api-keys" className="flex items-center gap-2 flex-1">
              <Key className="h-4 w-4 shrink-0" />
              <span>{isRu ? 'API Ключи' : 'API Keys'}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="api-keys">
            <ApiKeysTab
              apiKeys={apiKeys}
              saving={saving}
              isRu={isRu}
              onKeyChange={setKeyValue}
              onSave={handleSaveApiKeys}
            />
          </TabsContent>
        </Tabs>
      </section>
    </motion.div>
  );
}
