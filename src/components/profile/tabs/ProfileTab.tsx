import React, { useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { User, Settings, Camera, Trash2, Loader2, Check, Moon, Sun, Globe } from 'lucide-react';
import { getProfileText } from '../i18n';

interface ProfileTabProps {
  email: string;
  displayName: string;
  username: string;
  avatarUrl: string | null;
  avatarSaving: boolean;
  saving: boolean;
  isRu: boolean;
  theme: string;
  language: string;
  onDisplayNameChange: (v: string) => void;
  onUsernameChange: (v: string) => void;
  onSave: () => void;
  onAvatarFileSelect: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onDeleteAvatar: () => void;
  onThemeChange: (v: string) => void;
  onLanguageChange: (v: string) => void;
}

export function ProfileTab({
  email, displayName, username, avatarUrl, avatarSaving, saving, isRu,
  theme, language,
  onDisplayNameChange, onUsernameChange, onSave, onAvatarFileSelect, onDeleteAvatar,
  onThemeChange, onLanguageChange,
}: ProfileTabProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const p = (key: string) => getProfileText(key, isRu);

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      {/* Profile Column */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <User className="h-5 w-5 text-primary" />
          <CardTitle className="font-display">{p('profile')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 pb-2">
            <div className="relative">
              <Avatar className="h-20 w-20 border-2 border-border">
                <AvatarImage src={avatarUrl || undefined} />
                <AvatarFallback className="bg-muted">
                  <User className="h-8 w-8 text-muted-foreground" />
                </AvatarFallback>
              </Avatar>
              {avatarSaving && (
                <div className="absolute inset-0 flex items-center justify-center rounded-full bg-background/60">
                  <Loader2 className="h-5 w-5 animate-spin text-primary" />
                </div>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="hidden"
                onChange={onAvatarFileSelect}
              />
              <Button
                variant="outline"
                size="sm"
                onClick={() => fileInputRef.current?.click()}
                disabled={avatarSaving}
                className="gap-2"
              >
                <Camera className="h-4 w-4" />
                {p('uploadPhoto')}
              </Button>
              {avatarUrl && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onDeleteAvatar}
                  disabled={avatarSaving}
                  className="gap-2 text-destructive hover:text-destructive"
                >
                  <Trash2 className="h-4 w-4" />
                  {p('deleteAvatar')}
                </Button>
              )}
              <p className="text-xs text-muted-foreground">{p('avatarHint')}</p>
            </div>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <Input id="email" type="email" value={email} disabled className="opacity-60" />
          </div>

          <div className="space-y-2">
            <Label htmlFor="displayName">{p('displayName')}</Label>
            <Input
              id="displayName"
              type="text"
              value={displayName}
              onChange={(e) => onDisplayNameChange(e.target.value)}
              placeholder="John Doe"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="username">{p('username')}</Label>
            <Input
              id="username"
              type="text"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              placeholder="johndoe"
            />
          </div>
        </CardContent>
      </Card>

      {/* Preferences Column */}
      <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
        <CardHeader className="flex flex-row items-center gap-2 pb-4">
          <Settings className="h-5 w-5 text-primary" />
          <CardTitle className="font-display">{p('preferences')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              {theme === 'dark' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
              {p('theme')}
            </Label>
            <Select value={theme} onValueChange={onThemeChange}>
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="dark">{p('themeDark')}</SelectItem>
                <SelectItem value="light">{p('themeLight')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label className="flex items-center gap-2">
              <Globe className="h-4 w-4" />
              {p('language')}
            </Label>
            <Select value={language} onValueChange={onLanguageChange}>
              <SelectTrigger className="w-full max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ru">Русский</SelectItem>
                <SelectItem value="en">English</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
            {p('save')}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
