export type ProxyModelType = "chat" | "embedding" | "tts" | "stt" | "image" | "image_edit" | "responses";

export interface ProxyApiCatalogModel {
  id: string;
  owned_by: string;
  created?: number;
}

export function detectModelType(modelId: string): ProxyModelType {
  const id = modelId.toLowerCase();
  if (id.includes("tts") || (id.includes("speech") && !id.includes("speech-to"))) return "tts";
  if (id.includes("whisper") || id.includes("transcription") || id.includes("speech-to")) return "stt";
  if (id.includes("dall-e") || id.includes("dalle") || id.includes("gpt-image") ||
      id.includes("image-generation") || id.includes("sdxl") || id.includes("stable-diffusion")) return "image";
  if (id.includes("image-edit")) return "image_edit";
  if (id.includes("embedding") || id.includes("embed") || id.includes("text-embedding")) return "embedding";
  return "chat";
}

export const MODEL_TYPE_LABELS: Record<ProxyModelType, { label: string; color: string }> = {
  chat: { label: "💬 Chat", color: "" },
  embedding: { label: "📐 Embed", color: "border-blue-500/30 text-blue-400" },
  tts: { label: "🔊 TTS", color: "border-violet-500/30 text-violet-400" },
  stt: { label: "🎤 STT", color: "border-amber-500/30 text-amber-400" },
  image: { label: "🎨 Image", color: "border-pink-500/30 text-pink-400" },
  image_edit: { label: "✏️ ImgEdit", color: "border-rose-500/30 text-rose-400" },
  responses: { label: "⚡ Resp", color: "border-cyan-500/30 text-cyan-400" },
};

export interface PingResult {
  status: 'online' | 'error' | 'timeout';
  latency_ms: number;
  model_count?: number;
  error?: string;
}

export interface TestResult {
  status: 'success' | 'error' | 'timeout' | 'gone' | 'skipped';
  latency_ms: number;
  content?: string;
  model_type?: ProxyModelType;
  tokens?: { input: number; output: number };
  error?: string;
  details?: string;
  message?: string;
}

export interface LogEntry {
  id: string;
  model_id: string;
  request_type: string;
  status: string;
  latency_ms: number | null;
  tokens_input: number | null;
  tokens_output: number | null;
  error_message: string | null;
  created_at: string;
}

export interface ProxyApiSettings {
  timeout_sec: number;
  max_retries: number;
  fallback_enabled: boolean;
}

export interface AnalyticsEntry {
  model: string;
  rawModelId: string;
  total: number;
  success: number;
  errors: number;
  avgLatency: number;
  latencies: number[];
}

export const DEFAULT_SETTINGS: ProxyApiSettings = {
  timeout_sec: 30,
  max_retries: 2,
  fallback_enabled: true,
};

export const SETTINGS_KEY = 'proxyapi_settings';
export const USER_MODELS_KEY = 'proxyapi_user_models';

export const STATUS_EXPLANATIONS: Record<string, { label: { ru: string; en: string }; description: { ru: string; en: string } }> = {
  success: {
    label: { ru: 'Успешно', en: 'Success' },
    description: { ru: 'Запрос выполнен без ошибок.', en: 'Request completed without errors.' },
  },
  error: {
    label: { ru: 'Ошибка', en: 'Error' },
    description: { ru: 'Запрос завершился с ошибкой.', en: 'Request failed.' },
  },
  timeout: {
    label: { ru: 'Таймаут', en: 'Timeout' },
    description: { ru: 'Модель не успела ответить.', en: 'Model did not respond in time.' },
  },
  gone: {
    label: { ru: '410 Gone', en: '410 Gone' },
    description: { ru: 'Модель удалена из сервиса (HTTP 410).', en: 'Model permanently removed (HTTP 410).' },
  },
  skipped: {
    label: { ru: 'Пропущен', en: 'Skipped' },
    description: { ru: 'Тест не выполнен — требуется загрузка файла.', en: 'Test skipped — file upload required.' },
  },
  ping: {
    label: { ru: 'Пинг', en: 'Ping' },
    description: { ru: 'Проверка доступности сервиса.', en: 'Service availability check.' },
  },
  test: {
    label: { ru: 'Тест', en: 'Test' },
    description: { ru: 'Тестовый запрос к модели.', en: 'Test request to model.' },
  },
};

export function getStatusExpl(status: string, lang: 'ru' | 'en') {
  const e = STATUS_EXPLANATIONS[status];
  if (!e) return null;
  return { label: e.label[lang], description: e.description[lang] };
}
