const texts: Record<string, { ru: string; en: string }> = {
  // Page
  parserTitle: { ru: "Парсер", en: "Parser" },
  parserSubtitle: { ru: "Модуль 1.1 — The Architect: структурная декомпозиция", en: "Module 1.1 — The Architect: structural decomposition" },
  newFile: { ru: "Новый файл", en: "New file" },
  chapters: { ru: "глав", en: "chapters" },
  scenes: { ru: "сцен", en: "scenes" },
  pages: { ru: "стр.", en: "pp." },
  suppl: { ru: "доп.", en: "suppl." },

  // Library
  libraryTitle: { ru: "Ваши книги", en: "Your books" },
  libraryEmpty: { ru: "Пока нет загруженных книг", en: "No books uploaded yet" },
  libraryUpload: { ru: "Загрузить новую книгу", en: "Upload new book" },
  libraryOpen: { ru: "Открыть", en: "Open" },
  libraryDelete: { ru: "Удалить", en: "Delete" },
  libraryChapters: { ru: "глав", en: "chapters" },
  libraryScenes: { ru: "сцен", en: "scenes" },
  libraryUploaded: { ru: "Загружена", en: "Uploaded" },
  libraryAnalyzed: { ru: "Проанализирована", en: "Analyzed" },
  libraryBack: { ru: "К библиотеке", en: "Back to library" },
  libraryLoading: { ru: "Загрузка библиотеки...", en: "Loading library..." },
  libraryLoadingBook: { ru: "Загрузка книги...", en: "Loading book..." },

  // Upload
  uploadTitle: { ru: "Загрузите PDF книги", en: "Upload a book PDF" },
  uploadHint: { ru: "Максимум 20 МБ • PDF формат", en: "Max 20 MB • PDF format" },
  selectFile: { ru: "Выбрать файл", en: "Select file" },
  onlyPdf: { ru: "Поддерживается только PDF формат", en: "Only PDF format is supported" },
  maxSize: { ru: "Максимальный размер файла — 20 МБ", en: "Max file size is 20 MB" },

  // TOC extraction
  searchingToc: { ru: "Поиск оглавления в PDF...", en: "Searching for TOC in PDF..." },
  tocFound: { ru: "Найдено оглавление", en: "TOC found" },
  tocNotFound: { ru: "Оглавление не найдено. Книга загружена как один блок.", en: "No TOC found. Book loaded as a single block." },
  items: { ru: "элементов", en: "items" },

  // Workspace
  selectChapter: { ru: "Выберите главу для анализа", en: "Select a chapter to analyze" },
  analyze: { ru: "Анализировать", en: "Analyze" },
  reanalyze: { ru: "Повторить", en: "Reanalyze" },
  analyzing: { ru: "Анализируем сцены...", en: "Analyzing scenes..." },
  pendingHint: { ru: "Нажмите «Анализировать» для AI-декомпозиции на сцены", en: "Click \"Analyze\" for AI scene decomposition" },
  errorAnalysis: { ru: "Ошибка при анализе. Попробуйте снова.", en: "Analysis failed. Please try again." },
  errorPrefix: { ru: "Ошибка анализа", en: "Analysis error" },
  notEnoughText: { ru: "недостаточно текста для анализа", en: "not enough text to analyze" },
  chapterAnalyzed: { ru: "проанализирована", en: "analyzed" },
  noScenes: { ru: "Сцены не определены (мало текста или нестандартная структура)", en: "No scenes detected (too little text or non-standard structure)" },
  error: { ru: "Ошибка", en: "Error" },
  tryAgain: { ru: "Попробовать снова", en: "Try again" },

  // Section types
  sectionPreface: { ru: "Вступление", en: "Preface" },
  sectionAfterword: { ru: "Послесловие", en: "Afterword" },
  sectionEndnotes: { ru: "Примечания", en: "Notes" },
  sectionAppendix: { ru: "Приложения", en: "Appendix" },

  // Scene types
  sceneAction: { ru: "Экшн", en: "Action" },
  sceneDialogue: { ru: "Диалог", en: "Dialogue" },
  sceneLyrical: { ru: "Лирика", en: "Lyrical" },
  sceneDescription: { ru: "Описание", en: "Description" },
  sceneMonologue: { ru: "Монолог", en: "Monologue" },
  sceneMixed: { ru: "Смешанный", en: "Mixed" },
  sceneNarration: { ru: "Повествование", en: "Narration" },
  sceneExposition: { ru: "Экспозиция", en: "Exposition" },
  sceneConflict: { ru: "Конфликт", en: "Conflict" },
  sceneClimax: { ru: "Кульминация", en: "Climax" },
  sceneTransition: { ru: "Переход", en: "Transition" },
  sceneFlashback: { ru: "Флешбэк", en: "Flashback" },
  sceneSetting: { ru: "Сеттинг", en: "Setting" },

  // Mood labels
  moodTense: { ru: "Напряжённый", en: "Tense" },
  moodCalm: { ru: "Спокойный", en: "Calm" },
  moodSad: { ru: "Грустный", en: "Sad" },
  moodJoyful: { ru: "Радостный", en: "Joyful" },
  moodMysterious: { ru: "Загадочный", en: "Mysterious" },
  moodRomantic: { ru: "Романтичный", en: "Romantic" },
  moodDark: { ru: "Мрачный", en: "Dark" },
  moodEpic: { ru: "Эпичный", en: "Epic" },
  moodNostalgic: { ru: "Ностальгичный", en: "Nostalgic" },
  moodHumorous: { ru: "Юмористичный", en: "Humorous" },
  moodDramatic: { ru: "Драматичный", en: "Dramatic" },
  moodMelancholic: { ru: "Меланхоличный", en: "Melancholic" },
  moodNeutral: { ru: "Нейтральный", en: "Neutral" },
  moodComedic: { ru: "Комедийный", en: "Comedic" },
  moodSuspenseful: { ru: "Тревожный", en: "Suspenseful" },
  moodHopeful: { ru: "Обнадёживающий", en: "Hopeful" },
  moodAngry: { ru: "Злой", en: "Angry" },
  moodFearful: { ru: "Тревожный", en: "Fearful" },
  moodSerene: { ru: "Умиротворённый", en: "Serene" },
  moodBittersweet: { ru: "Светлая грусть", en: "Bittersweet" },
  moodAnxious: { ru: "Тревожный", en: "Anxious" },
  moodUplifting: { ru: "Воодушевляющий", en: "Uplifting" },
  moodEerie: { ru: "Зловещий", en: "Eerie" },
  moodTragic: { ru: "Трагичный", en: "Tragic" },

  // Scene label prefix
  scenePrefix: { ru: "Сцена", en: "Scene" },

  // Error messages
  errPayment: { ru: "Закончились средства на API-ключе. Пополните баланс провайдера или смените модель.", en: "API key credits exhausted. Top up your provider balance or switch model." },
  errRateLimit: { ru: "Превышен лимит запросов. Подождите немного и попробуйте снова.", en: "Rate limit exceeded. Wait a moment and try again." },
  errTimeout: { ru: "Модель не ответила вовремя (превышен таймаут). Попробуйте снова или выберите более быструю модель.", en: "Model did not respond in time (timeout). Try again or pick a faster model." },
  errNoStructure: { ru: "ИИ не вернул структурированный ответ. Попробуйте другую модель.", en: "AI did not return structured output. Try a different model." },
  errNoApiKey: { ru: "API-ключ не настроен. Добавьте ключ в профиле.", en: "API key not configured. Add a key in your profile." },
  errNetwork: { ru: "Ошибка сети. Проверьте подключение к интернету.", en: "Network error. Check your internet connection." },
  errGeneric: { ru: "Ошибка анализа", en: "Analysis error" },
  errChapterFailed: { ru: "Не удалось проанализировать главу", en: "Failed to analyze chapter" },
};

function normalizeToken(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[–—-]/g, "_")
    .replace(/\s+/g, "_")
    .replace(/[^\p{L}\p{N}_]/gu, "");
}

function humanizeToken(value: string): string {
  return value
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

// Mood map: English/Russian AI output → i18n key
const MOOD_MAP: Record<string, string> = {
  tense: "moodTense", напряжённый: "moodTense", напряженный: "moodTense",
  calm: "moodCalm", спокойный: "moodCalm",
  sad: "moodSad", грустный: "moodSad",
  joyful: "moodJoyful", радостный: "moodJoyful",
  mysterious: "moodMysterious", загадочный: "moodMysterious",
  romantic: "moodRomantic", романтичный: "moodRomantic",
  dark: "moodDark", мрачный: "moodDark",
  epic: "moodEpic", эпичный: "moodEpic",
  nostalgic: "moodNostalgic", ностальгичный: "moodNostalgic",
  humorous: "moodHumorous", юмористичный: "moodHumorous",
  dramatic: "moodDramatic", драматичный: "moodDramatic",
  melancholic: "moodMelancholic", меланхоличный: "moodMelancholic",
  neutral: "moodNeutral", нейтральный: "moodNeutral",
  comedic: "moodComedic", comedy: "moodComedic", комедийный: "moodComedic",
  suspenseful: "moodSuspenseful", suspense: "moodSuspenseful", саспенс: "moodSuspenseful",
  hopeful: "moodHopeful", optimistic: "moodHopeful", обнадёживающий: "moodHopeful", обнадеживающий: "moodHopeful",
  angry: "moodAngry", гневный: "moodAngry", злой: "moodAngry",
  fearful: "moodFearful", fear: "moodFearful", тревожный: "moodFearful",
  serene: "moodSerene", умиротворённый: "moodSerene", умиротворенный: "moodSerene",
  bittersweet: "moodBittersweet", bittersweet_sadness: "moodBittersweet",
  anxious: "moodAnxious", anxiety: "moodAnxious",
  uplifting: "moodUplifting", вдохновляющий: "moodUplifting", воодушевляющий: "moodUplifting",
  eerie: "moodEerie", зловещий: "moodEerie",
  tragic: "moodTragic", трагичный: "moodTragic", трагический: "moodTragic",
};

const SCENE_TYPE_MAP: Record<string, string> = {
  action: "sceneAction",
  dialogue: "sceneDialogue",
  lyrical_digression: "sceneLyrical",
  lyrical: "sceneLyrical",
  description: "sceneDescription",
  descriptive: "sceneDescription",
  inner_monologue: "sceneMonologue",
  monologue: "sceneMonologue",
  mixed: "sceneMixed",
  narration: "sceneNarration",
  narrative: "sceneNarration",
  exposition: "sceneExposition",
  conflict: "sceneConflict",
  climax: "sceneClimax",
  transition: "sceneTransition",
  flashback: "sceneFlashback",
  setting: "sceneSetting",
};

const SCENE_TITLE_MAP: Record<string, string> = {
  action_scene: "sceneAction",
  dialogue_scene: "sceneDialogue",
  lyrical_scene: "sceneLyrical",
  description_scene: "sceneDescription",
  monologue_scene: "sceneMonologue",
  mixed_scene: "sceneMixed",
  narration_scene: "sceneNarration",
  exposition_scene: "sceneExposition",
  transition_scene: "sceneTransition",
  flashback_scene: "sceneFlashback",
  climax_scene: "sceneClimax",
  conflict_scene: "sceneConflict",
  opening_scene: "sceneSetting",
  closing_scene: "sceneTransition",
};

export function t(key: string, isRu: boolean): string {
  const entry = texts[key];
  if (!entry) return key;
  return isRu ? entry.ru : entry.en;
}

export function tMood(raw: string, isRu: boolean): string {
  const normalized = normalizeToken(raw);
  const key = MOOD_MAP[normalized];
  if (key) return t(key, isRu);
  return humanizeToken(raw);
}

export function tSceneType(raw: string, isRu: boolean): string {
  const normalized = normalizeToken(raw);
  const i18nKey = SCENE_TYPE_MAP[normalized];
  return i18nKey ? t(i18nKey, isRu) : humanizeToken(raw);
}

export function tSceneTitle(raw: string, isRu: boolean): string {
  const normalized = normalizeToken(raw);
  const i18nKey = SCENE_TITLE_MAP[normalized] || SCENE_TYPE_MAP[normalized];
  if (i18nKey) return t(i18nKey, isRu);

  if (isRu) {
    const sceneMatch = raw.match(/^scene\s+(\d+)$/i);
    if (sceneMatch) return `${t("scenePrefix", true)} ${sceneMatch[1]}`;
  }

  return raw;
}

export function tSection(type: string, isRu: boolean): string {
  const map: Record<string, string> = {
    preface: "sectionPreface",
    afterword: "sectionAfterword",
    endnotes: "sectionEndnotes",
    appendix: "sectionAppendix",
  };
  const i18nKey = map[type];
  return i18nKey ? t(i18nKey, isRu) : type;
}
