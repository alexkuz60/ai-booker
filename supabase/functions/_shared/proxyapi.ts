export const PROXYAPI_MODEL_MAP: Record<string, string> = {
  "proxyapi/gpt-4o": "openai/gpt-4o",
  "proxyapi/gpt-4o-mini": "openai/gpt-4o-mini",
  "proxyapi/o3-mini": "openai/o3-mini",
  "proxyapi/gpt-5": "openai/gpt-5",
  "proxyapi/gpt-5-mini": "openai/gpt-5-mini",
  "proxyapi/gpt-5.2": "openai/gpt-5.2",
  "proxyapi/gpt-oss-20b": "openai/gpt-oss-20b",
  "proxyapi/gpt-oss-120b": "openai/gpt-oss-120b",
  "proxyapi/claude-sonnet-4": "anthropic/claude-sonnet-4-20250514",
  "proxyapi/claude-opus-4": "anthropic/claude-opus-4-6",
  "proxyapi/claude-3-5-sonnet": "anthropic/claude-3-5-sonnet-20241022",
  "proxyapi/claude-3-5-haiku": "anthropic/claude-3-5-haiku-20241022",
  "proxyapi/gemini-3-pro-preview": "gemini/gemini-3-pro-preview",
  "proxyapi/gemini-3-flash-preview": "gemini/gemini-3-flash-preview",
  "proxyapi/gemini-2.5-pro": "gemini/gemini-2.5-pro",
  "proxyapi/gemini-2.5-flash": "gemini/gemini-2.5-flash",
  "proxyapi/gemini-2.0-flash": "gemini/gemini-2.0-flash",
  "proxyapi/deepseek-chat": "deepseek/deepseek-chat",
  "proxyapi/deepseek-reasoner": "deepseek/deepseek-reasoner",
};

export function resolveProxyApiModel(modelId: string): string {
  return PROXYAPI_MODEL_MAP[modelId] || modelId.replace("proxyapi/", "");
}

export type ProxyModelType = "chat" | "embedding" | "tts" | "stt" | "image" | "image_edit" | "responses";

export function detectModelType(modelId: string): ProxyModelType {
  const id = modelId.toLowerCase();
  if (id.includes("tts") || (id.includes("speech") && !id.includes("speech-to"))) return "tts";
  if (id.includes("whisper") || id.includes("transcription") || id.includes("speech-to")) return "stt";
  if (id.includes("dall-e") || id.includes("dalle") || id.includes("gpt-image") ||
      id.includes("image-generation") || id.includes("sdxl") || id.includes("stable-diffusion") ||
      id.includes("midjourney")) return "image";
  if (id.includes("image-edit")) return "image_edit";
  if (id.includes("embedding") || id.includes("embed") || id.includes("text-embedding")) return "embedding";
  return "chat";
}

export function getFullUrlForType(type: ProxyModelType): string {
  switch (type) {
    case "tts": return "https://api.proxyapi.ru/openai/v1/audio/speech";
    case "stt": return "https://api.proxyapi.ru/openai/v1/audio/transcriptions";
    case "image": return "https://api.proxyapi.ru/openai/v1/images/generations";
    case "image_edit": return "https://api.proxyapi.ru/openai/v1/images/edits";
    case "embedding": return "https://api.proxyapi.ru/openai/v1/embeddings";
    case "responses": return "https://openai.api.proxyapi.ru/v1/responses";
    default: return "https://openai.api.proxyapi.ru/v1/chat/completions";
  }
}

export function stripProviderPrefix(modelId: string): string {
  return modelId.replace(/^[a-z]+\//, "");
}

export function buildTestPayload(realModel: string, type: ProxyModelType): Record<string, unknown> {
  switch (type) {
    case "tts":
      return { model: realModel, input: "Hi", voice: "alloy", response_format: "mp3" };
    case "embedding":
      return { model: realModel, input: "test" };
    case "image":
      return { model: realModel, prompt: "white square", size: "256x256", n: 1 };
    default: {
      const isOpenAI = realModel.startsWith("openai/");
      return {
        model: realModel,
        messages: [{ role: "user", content: "Say hi in 3 words." }],
        max_tokens: isOpenAI ? undefined : 30,
        ...(isOpenAI ? { max_completion_tokens: 30 } : {}),
        stream: false,
      };
    }
  }
}
