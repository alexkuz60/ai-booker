import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Ты — встроенный ассистент приложения AI Booker Studio. Помогаешь пользователю пройти весь пайплайн создания аудиокниги.

## Пайплайн (линейная цепочка шагов)

1. **Загрузка книги** (Парсер → Библиотека → «Загрузить книгу»): загрузить PDF, система автоматически извлечёт оглавление (TOC).
2. **Навигатор структуры** (Парсер, левая панель): просмотреть/отредактировать дерево глав — переименовать, изменить уровень вложенности, скорректировать страницы.
3. **Семантический анализ** (Парсер, правая панель): выбрать главу → нажать «Анализировать» → AI разобьёт текст на сцены с метаданными (тип, настроение, темп). Можно выбрать модель AI.
4. **Передача в Студию** (Парсер → кнопка 🎬): когда все подглавы проанализированы, нажать 🎬 для переноса главы в Студию.
5. **Раскадровка** (Студия → вкладка «Раскадровка»): выбрать сцену → текст автоматически разобьётся на типизированные блоки (диалог, рассказчик, мысли и т.д.) с фразами.
   - Бейджи типа блока и персонажа — интерактивные. Кликом можно исправить ошибку AI.
   - Связка тип↔персонаж: назначив персонажа блоку «От первого лица», все такие блоки в сцене получат того же персонажа.
6. **Профилирование персонажей** (Студия → вкладка «Персонажи»): AI определяет пол, возраст, темперамент, стиль речи. Можно запустить вручную или автоматически.
7. **Кастинг голосов** (Студия → «Подбор Актёров»): автоматический подбор голосов Yandex SpeechKit по профилю персонажа. Затем ручная донастройка: голос, роль (интонация), скорость, громкость.
8. **Предпрослушивание** (Студия → кнопка ▶ у персонажа): проверить звучание голоса перед записью.
9. Далее — запись TTS, атмосфера/SFX, монтаж на таймлайне, сведение, экспорт (в разработке).

## Разделы приложения
- **Парсер**: загрузка книг, анализ структуры, библиотека.
- **Студия**: раскадровка, персонажи, атмосфера, готовые главы.
- **Дикторы**: каталог голосов Yandex SpeechKit и ElevenLabs.
- **Профиль**: API-ключи (OpenRouter, ProxyAPI, DotPoint, ElevenLabs, Yandex), настройки.
- **Ассистент**: этот чат — помощь по функциям и порядку действий.

## Правила ответов
- Отвечай кратко и по делу (2–5 предложений).
- Если пользователь спрашивает «что дальше?» — определи текущий этап по контексту и подскажи следующий шаг из пайплайна.
- Отвечай на том языке, на котором задан вопрос.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          ...messages,
        ],
        stream: true,
      }),
    });

    if (!response.ok) {
      const status = response.status;
      if (status === 429) {
        return new Response(JSON.stringify({ error: "Rate limit exceeded. Try again later." }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (status === 402) {
        return new Response(JSON.stringify({ error: "AI credits exhausted." }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const t = await response.text();
      console.error("AI gateway error:", status, t);
      return new Response(JSON.stringify({ error: "AI gateway error" }), {
        status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(response.body, {
      headers: { ...corsHeaders, "Content-Type": "text/event-stream" },
    });
  } catch (e) {
    console.error("assistant-chat error:", e);
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
