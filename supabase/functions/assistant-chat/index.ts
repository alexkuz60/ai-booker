import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Ты — встроенный ассистент приложения AI Booker Studio. Помогаешь пользователю разобраться в функциях приложения.

Основные разделы:
- **Парсер**: загрузка книг (PDF/TXT), автоматический разбор на части, главы и сцены с помощью ИИ.
- **Студия**: работа с раскадровкой сцен (сегменты: диалог, рассказчик, от первого лица, эпиграф и т.д.), назначение персонажей, подбор голосов, создание атмосферы, озвучка.
- **Дикторы**: каталог голосов Yandex SpeechKit и ElevenLabs для озвучивания персонажей.
- **Профиль**: настройки API-ключей (OpenRouter, ProxyAPI, DotPoint, ElevenLabs, Yandex), язык, тема.

Типичный рабочий процесс:
1. Загрузить книгу в Парсере → дождаться анализа структуры.
2. Перейти в Студию → выбрать главу и сцену.
3. Нажать "Сегментировать" для разбивки сцены на текстовые блоки.
4. Назначить персонажей на блоки, подобрать голоса (Auto-Cast или вручную).
5. Настроить атмосферу (SFX, музыка).
6. Озвучить готовые главы.

Отвечай кратко и по делу. Если вопрос не связан с приложением — вежливо перенаправь к функциям AI Booker.
Отвечай на том языке, на котором задан вопрос.`;

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
