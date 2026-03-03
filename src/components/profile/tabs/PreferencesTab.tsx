import React from 'react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Settings, Moon, Sun, Globe, Loader2, Check } from 'lucide-react';
import { getProfileText } from '../i18n';

interface PreferencesTabProps {
  theme: string;
  language: string;
  saving: boolean;
  isRu: boolean;
  onThemeChange: (v: string) => void;
  onLanguageChange: (v: string) => void;
  onSave: () => void;
}

export function PreferencesTab({
  theme, language, saving, isRu,
  onThemeChange, onLanguageChange, onSave,
}: PreferencesTabProps) {
  const p = (key: string) => getProfileText(key, isRu);

  return (
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
  );
}
