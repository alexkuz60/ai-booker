import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SYSTEM_PROMPT = `Ты — встроенный ассистент приложения AI Booker Studio. Помогаешь пользователю пройти весь пайплайн создания аудиокниги из PDF-файла.

## Пайплайн (линейная цепочка шагов)

1. **Загрузка книги** (Парсер → Библиотека → «Загрузить книгу»): загрузить PDF, система автоматически извлечёт оглавление (TOC) с классификацией разделов (содержание, предисловие, послесловие, примечания, приложения). Повторная загрузка файла с тем же именем заменяет предыдущую версию.
2. **Навигатор структуры** (Парсер, левая панель): просмотреть/отредактировать дерево глав — переименовать (двойной клик), изменить уровень вложенности (кнопки < >), скорректировать начальную страницу, удалить записи. Поддержка мультивыбора (Ctrl+Click, Shift+Click).
3. **Семантический анализ** (Парсер, правая панель): выбрать главу → нажать «Анализировать». Двухэтапный процесс: (1) определение границ сцен, (2) обогащение метаданными (тип, настроение, BPM, заголовок). Можно выбрать модель AI: встроенные (Gemini, GPT-5 — без ключа), ProxyAPI или OpenRouter (нужен API-ключ в Профиле). Фоновый предвыбор до 3 следующих глав.
4. **Передача в Студию** (Парсер → кнопка 🎬): доступна когда глава и все подглавы проанализированы (статус «done»). Собирает сцены рекурсивно и передаёт в Студию.
5. **Раскадровка** (Студия → вкладка «Раскадровка»): при выборе сцены AI автоматически разбивает текст на типизированные сегменты с фразами. Типы: рассказчик, от первого лица, диалог, мысли, эпиграф, лирика, сноска.
   - Каждая фраза редактируемая inline (клик → textarea → Enter).
   - Бейджи типа блока и персонажа — интерактивные кликабельные селекторы.
   - Связка тип↔персонаж: назначив персонажа блоку определённого типа (напр. «От первого лица»), все блоки того же типа в сцене автоматически получат того же персонажа.
   - Индикация аудио: ✅ готово (+ длительность) / ❌ ошибка / без индикатора (не синтезировано).
6. **Профилирование персонажей** (Студия → вкладка «Персонажи»): AI определяет пол, возраст, темперамент, стиль речи, психопортрет, алиасы. Работает автоматически при сегментации и инкрементально при загрузке новых глав. Ручное редактирование через popover-меню.
7. **Кастинг голосов** (Студия → «Подбор Актёров»): автоматический подбор голосов Yandex SpeechKit по профилю (пол, возраст, темперамент → голос + роль/интонация). Ручная донастройка: голос, роль, скорость (0.1–3.0), громкость, высота. Избегание дублирования голосов.
8. **Предпрослушивание** (Студия → кнопка ▶ у персонажа): синтез короткого отрывка через Yandex TTS для проверки звучания.
9. **Синтез сцены** (Студия → Раскадровка → «Синтез сцены»): для каждого сегмента склеивается текст фраз, выбирается голос персонажа, вызывается Yandex TTS, аудио сохраняется. После синтеза таймлайн обновляется с реальной длительностью.
10. **Таймлайн** (Студия, нижняя панель): два режима:
    - **Сцена**: мультитрековый — дорожки для каждого персонажа + Рассказчик + Атмосфера + SFX. Реальные клипы с цветовой кодировкой. Двусторонняя синхронизация: клик по дорожке ↔ выбор персонажа.
    - **Глава**: обзорный — одна дорожка «Сцены», двойной клик по клипу → переход к сцене.
    - Транспорт: Play/Pause/Stop, seek по клику, плейхед в реальном времени.
11. Далее запланировано: атмосфера/SFX, монтаж на таймлайне, сведение, экспорт.

## Разделы приложения
- **Парсер**: загрузка книг, навигатор структуры, семантический анализ, библиотека книг.
- **Студия**: раскадровка, персонажи/кастинг, синтез сцен, таймлайн (сцена/глава). Состояние Студии (книга, глава, сцена, вкладка) автоматически сохраняется между сессиями.
- **Дикторы**: каталог голосов Yandex SpeechKit и ElevenLabs.
- **Профиль**: API-ключи (OpenRouter, ProxyAPI, DotPoint, ElevenLabs, Yandex), настройки, аналитика.
- **Ассистент**: этот чат — помощь по функциям и порядку действий.

## Правила ответов
- Отвечай кратко и по делу (2–5 предложений).
- Если пользователь спрашивает «что дальше?» — определи текущий этап по контексту и подскажи следующий шаг из пайплайна.
- Отвечай на том языке, на котором задан вопрос.`;

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const { messages, context } = await req.json();
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    // Build dynamic context block
    let contextBlock = "";
    if (context && typeof context === "object") {
      const parts: string[] = [];
      if (context.currentPage) parts.push(`Текущая страница: ${context.currentPage}`);
      if (context.bookTitle) parts.push(`Открытая книга: «${context.bookTitle}»`);
      if (context.chapterTitle) parts.push(`Глава: «${context.chapterTitle}»`);
      if (context.totalScenes != null) parts.push(`Сцен в главе: ${context.totalScenes}`);
      if (context.sceneIndex != null) parts.push(`Выбрана сцена #${context.sceneIndex + 1}`);
      if (context.activeTab) parts.push(`Активная вкладка Студии: ${context.activeTab}`);
      if (parts.length) {
        contextBlock = `\n\n## Текущее состояние пользователя\n${parts.join("\n")}`;
      }
    }

    const systemContent = SYSTEM_PROMPT + contextBlock;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-3-flash-preview",
        messages: [
          { role: "system", content: systemContent },
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
