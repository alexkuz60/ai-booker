import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Key, Mic2, Brain, Loader2, Check, Square, Volume2 } from 'lucide-react';
import { ApiKeyField } from '@/components/profile/ApiKeyField';
import { getProfileText } from '../i18n';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

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

type TtsProvider = 'elevenlabs' | 'yandex_speechkit' | 'salute_speech';

const TTS_ENDPOINTS: Record<TtsProvider, string> = {
  elevenlabs: 'elevenlabs-tts',
  yandex_speechkit: 'yandex-tts',
  salute_speech: 'salutespeech-test',
};

const TTS_TEST_BODY: Record<TtsProvider, (isRu: boolean) => Record<string, string>> = {
  elevenlabs: (isRu) => ({
    text: isRu ? 'Привет! Это тестовое сообщение от AI Booker.' : 'Hello! This is a test message from AI Booker.',
    voiceId: 'JBFqnCBsd6RMkjVDRZzb',
    lang: isRu ? 'ru' : 'en',
  }),
  yandex_speechkit: (isRu) => ({
    text: isRu ? 'Привет! Это тестовое сообщение от AI Booker.' : 'Hello! This is a test message from AI Booker.',
    voice: 'alena',
    lang: isRu ? 'ru' : 'en',
  }),
  salute_speech: (isRu) => ({
    action: 'synthesize',
    text: isRu ? 'Привет! Это тестовое сообщение от AI Booker.' : 'Hello! This is a test message from AI Booker.',
    voice: 'Nec_24000',
    raw: 'true',
  }),
};

function TtsTestButton({ provider, isRu }: { provider: TtsProvider; isRu: boolean }) {
  const [testing, setTesting] = useState(false);
  const [audioRef, setAudioRef] = useState<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);

  const handleTest = async () => {
    if (playing && audioRef) {
      audioRef.pause();
      audioRef.currentTime = 0;
      setPlaying(false);
      return;
    }

    setTesting(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) {
        toast.error(isRu ? 'Необходимо авторизоваться' : 'Please sign in');
        return;
      }

      const endpoint = TTS_ENDPOINTS[provider];
      const body = TTS_TEST_BODY[provider](isRu);

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/${endpoint}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify(body),
        }
      );

      if (!response.ok) {
        let errMsg = `HTTP ${response.status}`;
        try {
          const errData = await response.json();
          errMsg = errData.error || errMsg;
        } catch { /* ignore */ }
        throw new Error(errMsg);
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      setAudioRef(audio);
      setPlaying(true);
      audio.onended = () => {
        setPlaying(false);
        URL.revokeObjectURL(url);
      };
      await audio.play();
      toast.success(isRu ? 'TTS работает!' : 'TTS is working!');
    } catch (e) {
      console.error('TTS test error:', e);
      toast.error(e instanceof Error ? e.message : (isRu ? 'Ошибка TTS' : 'TTS error'));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleTest}
      disabled={testing}
      className="h-8 gap-1.5 text-xs"
    >
      {testing ? (
        <Loader2 className="h-3 w-3 animate-spin" />
      ) : playing ? (
        <Square className="h-3 w-3" />
      ) : (
        <Volume2 className="h-3 w-3" />
      )}
      {isRu ? 'Тест' : 'Test'}
    </Button>
  );
}

const TESTABLE_TTS: Set<string> = new Set(['elevenlabs', 'yandex_speechkit', 'salute_speech']);

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
          <div key={prov.provider} className="space-y-2">
            <div className="flex items-end gap-2">
              <div className="flex-1">
                <ApiKeyField
                  provider={prov.provider}
                  label={p(prov.labelKey)}
                  value={apiKeys[prov.provider] || ''}
                  onChange={(v) => onKeyChange(prov.provider, v)}
                  placeholder={prov.placeholder}
                  hint={renderHint(prov, isRu)}
                />
              </div>
              {TESTABLE_TTS.has(prov.provider) && (
                <div className="pb-6">
                  <TtsTestButton provider={prov.provider as TtsProvider} isRu={isRu} />
                </div>
              )}
            </div>
          </div>
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
