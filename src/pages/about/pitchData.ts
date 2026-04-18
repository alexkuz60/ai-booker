/**
 * Pitch deck content for sponsors / investors.
 * Used by both /about page and PPTX generator.
 */

export type PitchSlide = {
  id: string;
  kicker: { ru: string; en: string };
  title: { ru: string; en: string };
  subtitle?: { ru: string; en: string };
  body?: { ru: string; en: string };
  bullets?: Array<{ ru: string; en: string }>;
  stats?: Array<{
    value: string;
    label: { ru: string; en: string };
    sub?: { ru: string; en: string };
  }>;
  quote?: { ru: string; en: string };
  layout: "title" | "split" | "stats" | "bullets" | "quote" | "matrix" | "ask";
};

export const pitchDeck: PitchSlide[] = [
  // 1. Title
  {
    id: "cover",
    kicker: { ru: "AI BOOKER STUDIO", en: "AI BOOKER STUDIO" },
    title: {
      ru: "Книги, которые звучат как радиоспектакли",
      en: "Books that sound like radio plays",
    },
    subtitle: {
      ru: "Начитано эмоционально. Сведено профессионально.",
      en: "Emotionally dictated. Professionally mixed.",
    },
    body: {
      ru: "Питч для спонсоров и партнёров · 2026",
      en: "Pitch deck for sponsors & partners · 2026",
    },
    layout: "title",
  },

  // 2. Problem
  {
    id: "problem",
    kicker: { ru: "ПРОБЛЕМА", en: "THE PROBLEM" },
    title: {
      ru: "Большинство книг никогда не станут аудио",
      en: "Most books will never become audio",
    },
    bullets: [
      {
        ru: "Профессиональная студийная запись стоит $3 000–$15 000 за книгу — недоступно для 90% авторов и издателей.",
        en: "Studio audiobook production costs $3K–$15K per title — unaffordable for 90% of authors and publishers.",
      },
      {
        ru: "Одноголосые ИИ-озвучки звучат плоско: нет персонажей, нет эмоций, нет атмосферы.",
        en: "Single-voice AI narrations sound flat: no characters, no emotions, no atmosphere.",
      },
      {
        ru: "Перевод на другой язык удваивает бюджет и время — большинство книг остаются монолингвальными.",
        en: "Translating to another language doubles cost and time — most books stay monolingual.",
      },
      {
        ru: "Издатели и независимые авторы хотят аудио, но не имеют ни студии, ни актёров, ни звукорежиссёра.",
        en: "Publishers and indie authors want audio but lack studios, actors, and sound engineers.",
      },
    ],
    layout: "bullets",
  },

  // 3. Market
  {
    id: "market",
    kicker: { ru: "РЫНОК", en: "MARKET SIZE" },
    title: {
      ru: "Аудиокниги — самый быстрорастущий сегмент издательского мира",
      en: "Audiobooks — the fastest-growing segment in publishing",
    },
    stats: [
      {
        value: "$8.7B",
        label: { ru: "Глобальный рынок аудиокниг 2024", en: "Global audiobook market 2024" },
        sub: { ru: "→ $35B к 2030 (CAGR 26%)", en: "→ $35B by 2030 (26% CAGR)" },
      },
      {
        value: "4M+",
        label: { ru: "Книг издаётся ежегодно", en: "New titles published per year" },
        sub: { ru: "Менее 5% получают аудиоверсию", en: "Less than 5% get an audio version" },
      },
      {
        value: "50M+",
        label: { ru: "Независимых авторов на Amazon KDP", en: "Indie authors on Amazon KDP" },
        sub: { ru: "Целевая аудитория Booker", en: "Booker's target audience" },
      },
      {
        value: "7000+",
        label: { ru: "Языков мира", en: "Languages worldwide" },
        sub: { ru: "Большинство книг — только на 1–2", en: "Most books exist in only 1–2" },
      },
    ],
    body: {
      ru: "Каждый автор и издатель — потенциальный клиент. Каждая книга — потенциальный аудиоспектакль на десятках языков.",
      en: "Every author and publisher is a potential customer. Every book is a potential audio play in dozens of languages.",
    },
    layout: "stats",
  },

  // 4. Solution
  {
    id: "solution",
    kicker: { ru: "РЕШЕНИЕ", en: "THE SOLUTION" },
    title: {
      ru: "Booker превращает PDF в радиоспектакль за один клик",
      en: "Booker turns a PDF into a radio play with one click",
    },
    bullets: [
      {
        ru: "📖 Парсер: PDF/DOCX/FB2 → главы → сцены с настроением и темпом.",
        en: "📖 Parser: PDF/DOCX/FB2 → chapters → scenes with mood and tempo.",
      },
      {
        ru: "🎭 Профайлер: ИИ строит психологические портреты персонажей и подбирает им голоса.",
        en: "🎭 Profiler: AI builds psychological portraits of characters and casts voices.",
      },
      {
        ru: "🎙️ 40+ голосов: Yandex, ElevenLabs, SaluteSpeech, OpenAI — с эмоциональным контролем.",
        en: "🎙️ 40+ voices: Yandex, ElevenLabs, SaluteSpeech, OpenAI — with emotional control.",
      },
      {
        ru: "🎵 Атмосфера и SFX: ИИ-генерация фоновых звуков и музыки под каждую сцену.",
        en: "🎵 Atmosphere & SFX: AI-generated ambient sounds and music for every scene.",
      },
      {
        ru: "🎛️ DAW-таймлайн: микшер, эквалайзер, реверберация, мастеринг — как в профессиональной студии.",
        en: "🎛️ DAW timeline: mixer, EQ, reverb, mastering — like a pro studio.",
      },
      {
        ru: "🌐 Арт-перевод: книга на любой язык с радаром качества по 5 осям.",
        en: "🌐 Art translation: book in any language with a 5-axis quality radar.",
      },
    ],
    layout: "bullets",
  },

  // 5. Technology
  {
    id: "technology",
    kicker: { ru: "ТЕХНОЛОГИЯ", en: "TECHNOLOGY" },
    title: {
      ru: "Локально-первая архитектура. Вычисления — на устройстве пользователя",
      en: "Local-first architecture. Compute on the user's device",
    },
    stats: [
      {
        value: "OPFS",
        label: { ru: "Origin Private File System", en: "Origin Private File System" },
        sub: { ru: "Все проекты — в браузере пользователя", en: "All projects — in the user's browser" },
      },
      {
        value: "WebGPU",
        label: { ru: "Voice Conversion + ONNX", en: "Voice Conversion + ONNX" },
        sub: { ru: "RVC v2, F5-TTS, OmniVoice локально", en: "RVC v2, F5-TTS, OmniVoice locally" },
      },
      {
        value: "Edge",
        label: { ru: "Supabase Edge Functions", en: "Supabase Edge Functions" },
        sub: { ru: "Только тонкая прослойка для ИИ-роутинга", en: "Thin layer only for AI routing" },
      },
      {
        value: "$0",
        label: { ru: "Серверной инфраструктуры на пользователя", en: "Server cost per user" },
        sub: { ru: "Тяжёлая работа — на клиенте", en: "Heavy lifting — on the client" },
      },
    ],
    body: {
      ru: "Stack: React + TypeScript + Tone.js + Web Audio API + ONNX Runtime Web + Supabase. Multi-provider TTS, AI Roles, Model Pools.",
      en: "Stack: React + TypeScript + Tone.js + Web Audio API + ONNX Runtime Web + Supabase. Multi-provider TTS, AI Roles, Model Pools.",
    },
    layout: "stats",
  },

  // 6. Unit economics
  {
    id: "unit-economics",
    kicker: { ru: "ЮНИТ-ЭКОНОМИКА", en: "UNIT ECONOMICS" },
    title: {
      ru: "Стоимость одной книги стремится к нулю",
      en: "Cost per book approaches zero",
    },
    stats: [
      {
        value: "≈ $0.02",
        label: { ru: "Стоимость серверной части на книгу", en: "Server cost per book" },
        sub: { ru: "Только Edge Functions + Storage backup", en: "Edge Functions + Storage backup only" },
      },
      {
        value: "$2–$15",
        label: { ru: "ТТС-провайдер на книгу (300 стр.)", en: "TTS provider per book (300 pages)" },
        sub: { ru: "Платит пользователь напрямую", en: "Paid by the user directly" },
      },
      {
        value: "$3 000+",
        label: { ru: "Студийный бенчмарк", en: "Studio benchmark" },
        sub: { ru: "Booker дешевле в 200–1000 раз", en: "Booker is 200–1000× cheaper" },
      },
      {
        value: "90%+",
        label: { ru: "Маржа на премиум-подписке", en: "Margin on premium subscription" },
        sub: { ru: "При плане $19–49/мес", en: "At $19–49/month plans" },
      },
    ],
    body: {
      ru: "Архитектура «локально-первая» = серверные расходы не растут с числом пользователей. Это редкое экономическое свойство для AI-продуктов.",
      en: "Local-first architecture = server costs don't scale with user count. A rare economic property for AI products.",
    },
    layout: "stats",
  },

  // 7. Traction
  {
    id: "traction",
    kicker: { ru: "TRACTION", en: "TRACTION" },
    title: {
      ru: "Что уже работает",
      en: "What's already shipping",
    },
    bullets: [
      {
        ru: "✅ Полный пайплайн: парсер → раскадровка → синтез → мастеринг → рендер главы (WAV/MP3).",
        en: "✅ Full pipeline: parser → storyboard → synthesis → mastering → chapter render (WAV/MP3).",
      },
      {
        ru: "✅ 4 ТТС-провайдера, 6 ИИ-ролей, 40+ голосов, психотип-профилирование персонажей.",
        en: "✅ 4 TTS providers, 6 AI roles, 40+ voices, psychotype-based character profiling.",
      },
      {
        ru: "✅ Voice Conversion (RVC v2 + WavLM) на WebGPU — клонирование голоса в браузере.",
        en: "✅ Voice Conversion (RVC v2 + WavLM) on WebGPU — in-browser voice cloning.",
      },
      {
        ru: "✅ Арт-перевод с Quality Radar (5 осей: смысл, ритм, стиль, культура, фонетика).",
        en: "✅ Art translation with Quality Radar (5 axes: meaning, rhythm, style, culture, phonetics).",
      },
      {
        ru: "✅ Live: booker-studio.lovable.app — тестируйте прямо сейчас.",
        en: "✅ Live: booker-studio.lovable.app — try it right now.",
      },
      {
        ru: "🔜 Каталог готовых аудиокниг, маркетплейс голосов, мобильное приложение.",
        en: "🔜 Audiobook catalog, voice marketplace, mobile app.",
      },
    ],
    layout: "bullets",
  },

  // 8. Ask / Contact
  {
    id: "ask",
    kicker: { ru: "ВОПРОСЫ И КОНТАКТ", en: "QUESTIONS & CONTACT" },
    title: {
      ru: "Что мы ищем",
      en: "What we're looking for",
    },
    bullets: [
      {
        ru: "🤝 Спонсоров и грантодателей — для ускорения разработки и наполнения каталога.",
        en: "🤝 Sponsors and grant providers — to accelerate development and grow the catalog.",
      },
      {
        ru: "📚 Партнёров-издателей — для пилотных проектов локализации книг в аудио.",
        en: "📚 Publisher partners — for pilot audio-localization projects.",
      },
      {
        ru: "🎙️ Актёров озвучивания — для расширения голосового маркетплейса.",
        en: "🎙️ Voice actors — to expand the voice marketplace.",
      },
      {
        ru: "💡 Обратной связи и идей — мы открыты к диалогу.",
        en: "💡 Feedback and ideas — we're open to dialogue.",
      },
    ],
    quote: {
      ru: "booker-studio.lovable.app",
      en: "booker-studio.lovable.app",
    },
    layout: "ask",
  },
];
