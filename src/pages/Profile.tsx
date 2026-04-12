import { useState, useCallback, useEffect } from 'react';
import { motion } from 'framer-motion';
import { useTheme } from 'next-themes';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { User, Key, Activity, HardDrive, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useAuth } from '@/hooks/useAuth';
import { useLanguage } from '@/hooks/useLanguage';
import { useCloudSettings } from '@/hooks/useCloudSettings';
import { useUserRole } from '@/hooks/useUserRole';
import { usePageHeader } from '@/hooks/usePageHeader';
import { useBookerPro } from '@/hooks/useBookerPro';

import { ProfileTab } from '@/components/profile/tabs/ProfileTab';
import { ApiRoutersTab } from '@/components/profile/tabs/ApiRoutersTab';
import { AiUsageWidget } from '@/components/profile/AiUsageWidget';
import { OpfsBrowserPanel } from '@/components/profile/tabs/OpfsBrowserPanel';
import { BookerProSection } from '@/components/profile/tabs/BookerProSection';

export default function Profile() {
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const { isAdmin } = useUserRole();
  const { lang, isRu, setLang } = useLanguage();
  const { setPageHeader } = usePageHeader();
  const pro = useBookerPro();

  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingProfile, setLoadingProfile] = useState(true);

  const [apiKeys, setApiKeys] = useState<Record<string, string>>({});
  const [activeTab, setActiveTab] = useState('profile');

  const { value: proxyapiPriority, update: setProxyapiPriority } = useCloudSettings('proxyapi-priority', false);

  useEffect(() => {
    if (!user) return;
    const load = async () => {
      const { data } = await supabase
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
        api_keys: apiKeys as Json,
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

  useEffect(() => {
    setPageHeader({
      title: isRu ? 'Профиль' : 'Profile',
      subtitle: isRu ? 'Настройки пользователя и API' : 'User settings & API',
    });
    return () => setPageHeader({});
  }, [isRu, setPageHeader]);

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
      className="flex-1 p-4 sm:p-8 w-full space-y-6"
    >
      <div>
        <h1 className="font-display text-3xl font-bold text-foreground">
          {isRu ? 'Профиль' : 'Profile'}
        </h1>
        <p className="text-muted-foreground font-body mt-1">
          {isRu ? 'Настройки пользователя и API' : 'User settings & API'}
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex w-full h-auto flex-wrap gap-0.5">
          <TabsTrigger value="profile" className="flex items-center gap-2 flex-1">
            <User className="h-4 w-4 shrink-0" />
            <span>{isRu ? 'Профиль' : 'Profile'}</span>
          </TabsTrigger>
          <TabsTrigger value="api-keys" className="flex items-center gap-2 flex-1">
            <Key className="h-4 w-4 shrink-0" />
            <span>{isRu ? 'API-ключи' : 'API Keys'}</span>
          </TabsTrigger>
          <TabsTrigger value="ai-analytics" className="flex items-center gap-2 flex-1">
            <Activity className="h-4 w-4 shrink-0" />
            <span>{isRu ? 'AI Аналитика' : 'AI Analytics'}</span>
          </TabsTrigger>
          <TabsTrigger value="booker-pro" className="flex items-center gap-2 flex-1">
            <Zap className="h-4 w-4 shrink-0" />
            <span>Booker Pro</span>
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="opfs" className="flex items-center gap-2 flex-1">
              <HardDrive className="h-4 w-4 shrink-0" />
              <span>OPFS</span>
            </TabsTrigger>
          )}
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
            theme={theme || 'dark'}
            language={lang}
            onDisplayNameChange={setDisplayName}
            onUsernameChange={setUsername}
            onSave={handleSaveProfile}
            onAvatarFileSelect={() => {}}
            onDeleteAvatar={() => setAvatarUrl(null)}
            onThemeChange={setTheme}
            onLanguageChange={handleLangChange}
          />
        </TabsContent>

        <TabsContent value="api-keys">
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

        <TabsContent value="ai-analytics">
          <AiUsageWidget isRu={isRu} />
        </TabsContent>

        <TabsContent value="booker-pro">
          <BookerProSection pro={pro} isRu={isRu} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="opfs">
            <OpfsBrowserPanel isRu={isRu} />
          </TabsContent>
        )}
      </Tabs>
    </motion.div>
  );
}
