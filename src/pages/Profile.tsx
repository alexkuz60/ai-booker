import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { User, Key, Settings, HardDrive, Network, Bot } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { useCloudSettings } from '@/hooks/useCloudSettings';
import { useUserRole } from '@/hooks/useUserRole';

import { ProfileTab } from '@/components/profile/tabs/ProfileTab';
import { PreferencesTab } from '@/components/profile/tabs/PreferencesTab';
import { ApiKeysTab } from '@/components/profile/tabs/ApiKeysTab';
import { ApiRoutersTab } from '@/components/profile/tabs/ApiRoutersTab';
import { StorageTab } from '@/components/profile/tabs/StorageTab';
import { AiRolesTab } from '@/components/profile/tabs/AiRolesTab';
import { AiUsageWidget } from '@/components/profile/AiUsageWidget';

export default function Profile() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const { lang, isRu, setLang } = useLanguage();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [userTab, setUserTab] = useState('profile');
  const [apiTab, setApiTab] = useState('api-keys');
  
  // Cloud settings for ProxyAPI priority
  const { value: proxyapiPriority, update: setProxyapiPriority } = useCloudSettings('proxyapi-priority', false);

  // Load profile from DB
  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();
      if (data) {
        setDisplayName(data.display_name || '');
        setUsername(data.username || '');
        setAvatarUrl(data.avatar_url);
        setLang((data.language as "ru" | "en") || 'ru');
        setApiKeys((data.api_keys as Record<string, string>) || {});
        if (data.theme) setTheme(data.theme);
      }
      setLoadingProfile(false);
    };
    load();
  }, [user]);

  const handleSaveProfile = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        display_name: displayName,
        username,
        language: lang,
        theme: theme || 'dark',
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success(isRu ? 'Сохранено' : 'Saved');
  };

  const handleSaveApiKeys = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from('profiles')
      .update({
        api_keys: apiKeys as any,
        updated_at: new Date().toISOString(),
      })
      .eq('id', user.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success(isRu ? 'Ключи сохранены' : 'Keys saved');
  };

  const setKeyValue = useCallback((provider: string, value: string) => {
    setApiKeys(prev => ({ ...prev, [provider]: value }));
  }, []);

  const handleLangChange = (v: string) => setLang(v as "ru" | "en");

  if (loadingProfile) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <div className="animate-spin h-8 w-8 border-2 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex-1 p-4 sm:p-8 max-w-4xl mx-auto w-full space-y-10"
    >
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">
          {isRu ? 'Профиль' : 'Profile'}
        </h1>
        <p className="text-muted-foreground font-body mt-1">
          {isRu ? 'Настройки пользователя и API' : 'User settings & API'}
        </p>
      </div>

      <section>
        <div className="flex items-center gap-2 mb-4">
          <User className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold font-display">
            {isRu ? 'Личный кабинет' : 'Personal'}
          </h2>
        </div>
        <Tabs value={userTab} onValueChange={setUserTab} className="space-y-6">
          <TabsList className="flex w-full h-auto flex-wrap gap-0.5">
            <TabsTrigger value="profile" className="flex items-center gap-2 flex-1">
              <User className="h-4 w-4 shrink-0" />
              <span>{isRu ? 'Профиль' : 'Profile'}</span>
            </TabsTrigger>
            <TabsTrigger value="preferences" className="flex items-center gap-2 flex-1">
              <Settings className="h-4 w-4 shrink-0" />
              <span>{isRu ? 'Настройки' : 'Preferences'}</span>
            </TabsTrigger>
            <TabsTrigger value="api-routers" className="flex items-center gap-2 flex-1">
              <Network className="h-4 w-4 shrink-0" />
              <span>{isRu ? 'API Роутеры' : 'API Routers'}</span>
            </TabsTrigger>
            <TabsTrigger value="ai-roles" className="flex items-center gap-2 flex-1">
              <Bot className="h-4 w-4 shrink-0" />
              <span>{isRu ? 'AI Роли' : 'AI Roles'}</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileTab
              email={user?.email || ''}
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

          <TabsContent value="api-routers">
            <ApiRoutersTab
              apiKeys={apiKeys}
              language={lang}
              onKeyChange={setKeyValue}
              onSave={handleSaveApiKeys}
              saving={saving}
              proxyapiPriority={proxyapiPriority}
              onPriorityChange={setProxyapiPriority}
              isAdmin={isAdmin}
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

          <TabsContent value="ai-roles">
            <AiRolesTab apiKeys={apiKeys} isRu={isRu} />
          </TabsContent>
        </Tabs>
      </section>

      <Separator className="my-2" />

      <section>
        <div className="flex items-center gap-2 mb-4">
          <HardDrive className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold font-display">
            {isRu ? 'Файлохранилище' : 'File Storage'}
          </h2>
        </div>
        {user && <StorageTab isRu={isRu} userId={user.id} />}
      </section>

      <Separator className="my-2" />

      <section>
        <div className="flex items-center gap-2 mb-4">
          <Activity className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold font-display">
            {isRu ? 'AI Аналитика' : 'AI Analytics'}
          </h2>
        </div>
        <AiUsageWidget isRu={isRu} />
      </section>

      <Separator className="my-2" />

      <section>
        <div className="flex items-center gap-2 mb-4">
          <Key className="h-5 w-5 text-primary" />
          <h2 className="text-xl font-semibold font-display">
            {isRu ? 'Управление API' : 'API Management'}
          </h2>
        </div>
        <Tabs value={apiTab} onValueChange={setApiTab} className="space-y-6">
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
