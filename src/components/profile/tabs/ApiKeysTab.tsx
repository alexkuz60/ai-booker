import React from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Key, Mic2, Brain, Loader2, Check } from 'lucide-react';
import { ApiKeyField } from '@/components/profile/ApiKeyField';
import { getProfileText } from '../i18n';

const TTS_PROVIDERS = [
  { provider: 'elevenlabs', labelKey: 'elevenlabs', placeholder: 'sk_...', hint: { ru: 'elevenlabs.io', en: 'elevenlabs.io', url: 'https://elevenlabs.io/app/settings/api-keys' } },
  { provider: 'yandex_speechkit', labelKey: 'yandexSpeechKit', placeholder: 'AQV...', hint: { ru: 'cloud.yandex.ru', en: 'cloud.yandex.ru', url: 'https://cloud.yandex.ru/docs/speechkit/' } },
  { provider: 'salute_speech', labelKey: 'saluteSpeech', placeholder: '...', hint: { ru: 'developers.sber.ru', en: 'developers.sber.ru', url: 'https://developers.sber.ru/portal/products/speechkit' } },
] as const;

const LLM_PROVIDERS = [
  { provider: 'openai', labelKey: 'openai', placeholder: 'sk-...' },
  { provider: 'gemini', labelKey: 'gemini', placeholder: 'AIza...' },
  { provider: 'anthropic', labelKey: 'anthropic', placeholder: 'sk-ant-...' },
] as const;

interface ApiKeysTabProps {
  apiKeys: Record<string, string>;
  saving: boolean;
  isRu: boolean;
  onKeyChange: (provider: string, v: string) => void;
  onSave: () => void;
}

function renderHint(p: typeof TTS_PROVIDERS[number], isRu: boolean) {
  if (!p.hint) return null;
  return (
    <>
      {getProfileText('getKeyAt', isRu)}{' '}
      <a href={p.hint.url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
        {isRu ? p.hint.ru : p.hint.en}
      </a>
    </>
  );
}

export function ApiKeysTab({ apiKeys, saving, isRu, onKeyChange, onSave }: ApiKeysTabProps) {
  const p = (key: string) => getProfileText(key, isRu);

  return (
    <Card className="border-border/50 bg-card/50 backdrop-blur-sm">
      <CardHeader className="flex flex-row items-center gap-2 pb-4">
        <Key className="h-5 w-5 text-primary" />
        <CardTitle className="font-display">{p('apiKeys')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground mb-4">{p('byokDescription')}</p>

        {/* TTS Providers */}
        <div className="flex items-center gap-2 mb-3">
          <Mic2 className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold font-display">{p('ttsProviders')}</h3>
        </div>

        {TTS_PROVIDERS.map(prov => (
          <ApiKeyField
            key={prov.provider}
            provider={prov.provider}
            label={p(prov.labelKey)}
            value={apiKeys[prov.provider] || ''}
            onChange={(v) => onKeyChange(prov.provider, v)}
            placeholder={prov.placeholder}
            hint={renderHint(prov, isRu)}
          />
        ))}

        <Separator className="my-6" />

        {/* LLM Providers */}
        <div className="flex items-center gap-2 mb-3">
          <Brain className="h-5 w-5 text-primary" />
          <h3 className="text-lg font-semibold font-display">{p('llmProviders')}</h3>
        </div>

        {LLM_PROVIDERS.map(prov => (
          <ApiKeyField
            key={prov.provider}
            provider={prov.provider}
            label={p(prov.labelKey)}
            value={apiKeys[prov.provider] || ''}
            onChange={(v) => onKeyChange(prov.provider, v)}
            placeholder={prov.placeholder}
          />
        ))}

        <div className="pt-4">
          <Button onClick={onSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Check className="h-4 w-4 mr-2" />}
            {p('save')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
