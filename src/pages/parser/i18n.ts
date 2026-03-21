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
  libraryServerTitle: { ru: "На сервере", en: "On server" },
  libraryServerEmpty: { ru: "На сервере нет книг", en: "No books on server" },
  libraryServerLoad: { ru: "Загрузить с сервера", en: "Load from server" },
  libraryServerDownload: { ru: "Скачать", en: "Download" },
  libraryServerDelete: { ru: "Удалить с сервера", en: "Delete from server" },
  libraryServerDeleteDesc: { ru: "будет безвозвратно удалена с сервера. Локальные копии не затрагиваются.", en: "will be permanently deleted from the server. Local copies are not affected." },
  libraryServerLoading: { ru: "Загрузка списка...", en: "Loading list..." },
  libraryUpdated: { ru: "Изменено", en: "Updated" },
  libraryLocalTitle: { ru: "Локальные проекты", en: "Local projects" },

  // Upload
  uploadTitle: { ru: "Загрузите книгу", en: "Upload a book" },
  uploadHint: { ru: "Максимум 20 МБ • PDF, DOCX или FB2", en: "Max 20 MB • PDF, DOCX or FB2" },
  selectFile: { ru: "Выбрать файл", en: "Select file" },
  onlySupported: { ru: "Поддерживаются только PDF, DOCX и FB2 форматы", en: "Only PDF, DOCX and FB2 formats are supported" },
  maxSize: { ru: "Максимальный размер файла — 20 МБ", en: "Max file size is 20 MB" },
  docxTocFromHeadings: { ru: "Найдены заголовки (Heading) в документе", en: "Headings found in document" },
  docxTocFromRegex: { ru: "Найдены главы по паттернам в тексте", en: "Chapter patterns found in text" },
  docxNoToc: { ru: "Структура не найдена. Документ загружен как один блок.", en: "No structure found. Document loaded as a single block." },

  // TOC extraction
  searchingToc: { ru: "Поиск оглавления...", en: "Searching for TOC..." },
  tocFound: { ru: "Найдено оглавление", en: "TOC found" },
  tocNotFound: { ru: "Оглавление не найдено. Книга загружена как один блок.", en: "No TOC found. Book loaded as a single block." },
  items: { ru: "элементов", en: "items" },

  // Workspace
  selectChapter: { ru: "Выберите главу для анализа", en: "Select a chapter to analyze" },
  analyze: { ru: "Анализировать", en: "Analyze" },
  reanalyze: { ru: "Повторить", en: "Reanalyze" },
  reanalyzeDialogTitle: { ru: "Повторный анализ главы", en: "Re-analyze chapter" },
  reanalyzeDialogDesc: { ru: "Глава уже проанализирована. Выберите режим повторного анализа:", en: "Chapter already analyzed. Choose re-analysis mode:" },
  reanalyzeFull: { ru: "Полный пересчёт", en: "Full re-parse" },
  reanalyzeFullDesc: { ru: "Удалить все сцены и разметку. Новая модель заново определит границы, типы и настроение.", en: "Delete all scenes and markup. New model will re-detect boundaries, types and mood from scratch." },
  reanalyzeEnrich: { ru: "Только метаданные", en: "Metadata only" },
  reanalyzeEnrichDesc: { ru: "Сохранить текущие границы сцен. Обновить тип, настроение и темп текущей моделью.", en: "Keep current scene boundaries. Update type, mood and BPM with current model." },
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
  moodContemplative: { ru: "Задумчивый", en: "Contemplative" },
  moodDetermined: { ru: "Решительный", en: "Determined" },
  moodDesperate: { ru: "Отчаянный", en: "Desperate" },
  moodDefiant: { ru: "Дерзкий", en: "Defiant" },
  moodIronic: { ru: "Ироничный", en: "Ironic" },
  moodPlayful: { ru: "Игривый", en: "Playful" },
  moodCheerful: { ru: "Весёлый", en: "Cheerful" },
  moodGentle: { ru: "Нежный", en: "Gentle" },
  moodGrim: { ru: "Суровый", en: "Grim" },
  moodOminous: { ru: "Зловещий", en: "Ominous" },
  moodCurious: { ru: "Любопытный", en: "Curious" },
  moodConfused: { ru: "Растерянный", en: "Confused" },
  moodExcited: { ru: "Восторженный", en: "Excited" },
  moodTriumphant: { ru: "Триумфальный", en: "Triumphant" },
  moodResigned: { ru: "Смирённый", en: "Resigned" },
  moodFrustrated: { ru: "Раздражённый", en: "Frustrated" },
  moodLonging: { ru: "Тоскующий", en: "Longing" },
  moodNervous: { ru: "Нервный", en: "Nervous" },
  moodConfident: { ru: "Уверенный", en: "Confident" },
  moodDreamy: { ru: "Мечтательный", en: "Dreamy" },
  moodHostile: { ru: "Враждебный", en: "Hostile" },
  moodPragmatic: { ru: "Деловой", en: "Pragmatic" },
  moodEarnest: { ru: "Искренний", en: "Earnest" },
  moodInspired: { ru: "Вдохновлённый", en: "Inspired" },
  moodNightmarish: { ru: "Кошмарный", en: "Nightmarish" },
  moodDarklyComedic: { ru: "Чёрный юмор", en: "Darkly comedic" },
  moodChaotic: { ru: "Хаотичный", en: "Chaotic" },
  moodConspiratorial: { ru: "Заговорщический", en: "Conspiratorial" },
  moodHeartwarming: { ru: "Тёплый", en: "Heartwarming" },
  moodIdealistic: { ru: "Идеалистичный", en: "Idealistic" },
  moodAmused: { ru: "Забавный", en: "Amused" },
  moodPanicked: { ru: "Паникующий", en: "Panicked" },
  moodWry: { ru: "Саркастичный", en: "Wry" },

  // Scene label prefix
  scenePrefix: { ru: "Сцена", en: "Scene" },

  // ChapterDetailPanel
  pageRange: { ru: "Стр.", en: "pp." },
  resume: { ru: "Продолжить", en: "Resume" },
  retry: { ru: "Повторить", en: "Retry" },
  decomposing: { ru: "Декомпозиция главы на сцены", en: "Decomposing chapter into scenes" },

  // NavSidebar
  toStudio: { ru: "В студию!", en: "To Studio!" },
  deleteEntry: { ru: "Удалить из структуры", en: "Remove from structure" },
  deleteEntryConfirm: { ru: "Удалить «{title}» и все вложенные элементы?", en: "Delete \"{title}\" and all nested items?" },
  deleteMultiConfirm: { ru: "Удалить {count} выбранных элементов и все их вложения?", en: "Delete {count} selected items and all nested?" },
  selectedCount: { ru: "выбрано", en: "selected" },
  partPagePrefix: { ru: "стр.", en: "p." },
  partChaptersSuffix: { ru: "глав", en: "ch." },
  undo: { ru: "Отменить", en: "Undo" },
  redo: { ru: "Повторить", en: "Redo" },

  // LibraryView
  deleteBookTitle: { ru: "Удалить книгу?", en: "Delete book?" },
  deleteBookDesc: { ru: "и все результаты анализа будут удалены безвозвратно.", en: "and all analysis results will be permanently deleted." },
  cancel: { ru: "Отмена", en: "Cancel" },

  // Parser.tsx toasts
  noChaptersFound: { ru: "У этой книги ещё нет глав. Загрузите PDF заново.", en: "No chapters found. Please re-upload the PDF." },
  bookLoaded: { ru: "Книга загружена", en: "Book loaded" },
  pdfRestored: { ru: "PDF восстановлен, анализ доступен", en: "PDF restored, analysis available" },
  pdfNotFound: { ru: "PDF не найден, только просмотр", en: "PDF not found, view only" },
  bookDeleted: { ru: "Книга удалена", en: "Book deleted" },
  bookDeleteFailed: { ru: "Не удалось удалить книгу", en: "Failed to delete book" },

  // useChapterAnalysis log messages
  logTimeout: { ru: "Timeout: анализ занял более 3 минут", en: "Timeout: analysis took more than 3 minutes" },
  logClearing: { ru: "🗑️ Очистка предыдущих результатов...", en: "🗑️ Clearing previous results..." },
  logAllDone: { ru: "Все сцены уже проанализированы", en: "All scenes already analyzed" },
  logExtracting: { ru: "📖 Извлечение текста главы", en: "📖 Extracting chapter text" },
  logNotEnough: { ru: "недостаточно текста для анализа", en: "not enough text for analysis" },
  logExtracted: { ru: "📝 Текст извлечён", en: "📝 Text extracted" },
  logChars: { ru: "символов", en: "chars" },
  logPagesAbbr: { ru: "стр.", en: "pages" },
  logStage1: { ru: "🎭 Этап 1: Определение границ сцен...", en: "🎭 Stage 1: Detecting scene boundaries..." },
  logCallingAI: { ru: "🚀 Запрос к AI модели", en: "🚀 Calling AI model" },
  logMarkersNotFound: { ru: "⚠️ Маркеры не найдены в тексте, контент будет пустым", en: "⚠️ Markers not found in text, content will be empty" },
  logFoundScenes: { ru: "✅ Определено", en: "✅ Found" },
  logScenesWord: { ru: "сцен", en: "scenes" },
  logSceneItem: { ru: "📍 Сцена", en: "📍 Scene" },
  logCharsAbbr: { ru: "зн.", en: "chars" },
  logSaving: { ru: "💾 Сохранение структуры в базу данных...", en: "💾 Saving structure to database..." },
  logResuming: { ru: "📍 Найдено сохранённых сцен, продолжаем обогащение...", en: "📍 Found saved scenes, resuming enrichment..." },
  logStage2: { ru: "🧠 Этап 2: Обогащение", en: "🧠 Stage 2: Enriching" },
  logOfScenes: { ru: "из", en: "of" },
  logAnalyzingScene: { ru: "🎬 Анализ сцены", en: "🎬 Analyzing scene" },
  logSkipped: { ru: "⏭️ Пропущена (слишком мало текста)", en: "⏭️ Skipped (too little text)" },
  logEnrichFailed: { ru: "⚠️ Обогащение не удалось", en: "⚠️ Enrichment failed" },
  logDefaults: { ru: "Установлены значения по умолчанию.", en: "Using defaults." },
  logSceneDone: { ru: "✅ Сцена", en: "✅ Scene" },
  logChapterDone: { ru: "🎉 Глава проанализирована!", en: "🎉 Chapter analyzed!" },
  logSavedPartial: { ru: "💡 Сохранено", en: "💡 Saved" },
  logScenesEnriched: { ru: "сцен (обогащено:", en: "scenes (enriched:" },
  logClickResume: { ru: "Нажмите ▶ чтобы продолжить.", en: "Click ▶ to resume." },

  // Error messages
  errPayment: { ru: "Закончились средства на API-ключе. Пополните баланс провайдера или смените модель.", en: "API key credits exhausted. Top up your provider balance or switch model." },
  errRateLimit: { ru: "Превышен лимит запросов. Подождите немного и попробуйте снова.", en: "Rate limit exceeded. Wait a moment and try again." },
  errTimeout: { ru: "Модель не ответила вовремя (превышен таймаут). Попробуйте снова или выберите более быструю модель.", en: "Model did not respond in time (timeout). Try again or pick a faster model." },
  errNoStructure: { ru: "ИИ не вернул структурированный ответ. Попробуйте другую модель.", en: "AI did not return structured output. Try a different model." },
  errNoApiKey: { ru: "API-ключ не настроен. Добавьте ключ в профиле.", en: "API key not configured. Add a key in your profile." },
  errNetwork: { ru: "Ошибка сети после нескольких попыток. Проверьте подключение и попробуйте снова.", en: "Network error after retries. Check connection and try again." },
  errGeneric: { ru: "Ошибка анализа", en: "Analysis error" },
  errChapterFailed: { ru: "Не удалось проанализировать главу", en: "Failed to analyze chapter" },

  // Content cleanup context menu
  cleanupHeader: { ru: "Колонтитул — удалить похожие", en: "Header/Footer — remove similar" },
  cleanupPageNum: { ru: "Номер страницы — удалить похожие", en: "Page number — remove similar" },
  cleanupChapterSplit: { ru: "Раздел главы — разделить сцену", en: "Chapter section — split scene" },
  cleanupFixSpaces: { ru: "Исправить пробелы у знаков препинания", en: "Fix punctuation spacing" },
  cleanupFootnoteLink: { ru: "Номер сноски — связать с текстом", en: "Footnote number — link to text" },
  cleanupFootnoteAuto: { ru: "Авто-сноски", en: "Auto-footnotes" },
  cleanupNoSelection: { ru: "Выделите текст для действия", en: "Select text for action" },
  cleanupLabel: { ru: "Очистка текста", en: "Text cleanup" },
  mergeScenes: { ru: "Объединить", en: "Merge" },
  mergeScenesHint: { ru: "Выберите смежные сцены для объединения", en: "Select adjacent scenes to merge" },
  mergeScenesDone: { ru: "Сцены объединены", en: "Scenes merged" },
  mergeNotAdjacent: { ru: "Можно объединить только смежные сцены", en: "Can only merge adjacent scenes" },
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
  // Extended mood tokens from AI output
  contemplative: "moodContemplative",
  reflective: "moodContemplative",
  determined: "moodDetermined",
  resolute: "moodDetermined",
  desperate: "moodDesperate",
  frantic: "moodDesperate",
  defiant: "moodDefiant",
  rebellious: "moodDefiant",
  ironic: "moodIronic",
  sardonic: "moodIronic",
  sarcastic: "moodIronic",
  playful: "moodPlayful",
  mischievous: "moodPlayful",
  cheerful: "moodCheerful",
  lighthearted: "moodCheerful",
  lively: "moodCheerful",
  buoyant: "moodCheerful",
  gentle: "moodGentle",
  tender: "moodGentle",
  compassionate: "moodGentle",
  grim: "moodGrim",
  bleak: "moodGrim",
  somber: "moodGrim",
  sombre: "moodGrim",
  ominous: "moodOminous",
  foreboding: "moodOminous",
  menacing: "moodOminous",
  threatening: "moodOminous",
  curious: "moodCurious",
  intrigued: "moodCurious",
  confused: "moodConfused",
  disoriented: "moodConfused",
  excited: "moodExcited",
  exhilarated: "moodExcited",
  ecstatic: "moodExcited",
  triumphant: "moodTriumphant",
  exultant: "moodTriumphant",
  proud: "moodTriumphant",
  resigned: "moodResigned",
  weary: "moodResigned",
  exhausted: "moodResigned",
  listless: "moodResigned",
  frustrated: "moodFrustrated",
  irritated: "moodFrustrated",
  impatient: "moodFrustrated",
  indignant: "moodFrustrated",
  longing: "moodLonging",
  yearning: "moodLonging",
  wistful: "moodLonging",
  nervous: "moodNervous",
  awkward: "moodNervous",
  embarrassed: "moodNervous",
  confident: "moodConfident",
  bold: "moodConfident",
  ambitious: "moodConfident",
  dreamy: "moodDreamy",
  enchanted: "moodDreamy",
  whimsical: "moodDreamy",
  hostile: "moodHostile",
  confrontational: "moodHostile",
  furious: "moodHostile",
  vengeful: "moodHostile",
  heated: "moodHostile",
  pragmatic: "moodPragmatic",
  businesslike: "moodPragmatic",
  methodical: "moodPragmatic",
  focused: "moodPragmatic",
  brisk: "moodPragmatic",
  earnest: "moodEarnest",
  sincere: "moodEarnest",
  inspired: "moodInspired",
  majestic: "moodInspired",
  awestruck: "moodInspired",
  awe: "moodInspired",
  nightmarish: "moodNightmarish",
  grotesque: "moodNightmarish",
  claustrophobic: "moodNightmarish",
  darkly: "moodDarklyComedic",
  chaotic: "moodChaotic",
  conspiratorial: "moodConspiratorial",
  heartwarming: "moodHeartwarming",
  idealistic: "moodIdealistic",
  comic: "moodHumorous",
  amused: "moodAmused",
  bemused: "moodAmused",
  panicked: "moodPanicked",
  panic: "moodPanicked",
  wry: "moodWry",
  undertone: "moodHumorous",
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
  // Try exact match first
  const normalized = normalizeToken(raw);
  const key = MOOD_MAP[normalized];
  if (key) return t(key, isRu);

  // Composite mood: split by comma, slash, "and", "with" and translate each part
  const parts = raw
    .split(/[,/]|\band\b|\bwith\b|\bс\b|\bи\b/i)
    .map(s => s.trim())
    .filter(Boolean);

  if (parts.length > 1) {
    const translated = parts.map(part => {
      // Each part may be multi-word like "darkly comedic" — try full match first
      const partNorm = normalizeToken(part);
      const partKey = MOOD_MAP[partNorm];
      if (partKey) return t(partKey, isRu);
      // Try individual words
      const words = part.split(/\s+/);
      if (words.length > 1) {
        for (const word of words) {
          const wNorm = normalizeToken(word);
          const wKey = MOOD_MAP[wNorm];
          if (wKey) return t(wKey, isRu);
        }
      }
      return humanizeToken(part);
    });
    // Deduplicate and join
    const unique = [...new Set(translated)];
    return unique.join(", ");
  }

  // Single unrecognized token — try word-level lookup
  const words = raw.trim().split(/\s+/);
  if (words.length > 1) {
    for (const word of words) {
      const wNorm = normalizeToken(word);
      const wKey = MOOD_MAP[wNorm];
      if (wKey) return t(wKey, isRu);
    }
  }

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
