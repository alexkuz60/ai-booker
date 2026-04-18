/**
 * CharacterAutoFillSection — Auto-fill OmniVoice instructions from a Booker character profile.
 *
 * UX (hybrid, per design plan):
 *   1) Pick a book + character (from current OPFS project or DB fallback).
 *   2) Optional scene context (mood / segment_type / scene_type).
 *   3) "Character Base" section (stable across scenes) — editable, with 🪄 Refresh.
 *   4) "Scene Context" section (dynamic) — editable, with 🪄 Refresh.
 *   5) Final preview = `${base} ${scene}` — read-only.
 *   6) "Apply" button writes the final prompt into the parent `instructions` field.
 *
 * Translation pipeline:
 *   • Deterministic English mapping (offline) covers gender/age/temperament/archetype/etc.
 *   • Free-text fields (description, speech_style) are translated via
 *     `translate-character-fields` edge function, cached in
 *     `voice_config.omnivoice_cache` keyed by FNV-1a hash of source RU text.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Loader2, RefreshCw, Wand2, BookOpen, User, Languages, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readCharacterIndex, saveCharacterIndex } from "@/lib/localCharacters";
import {
  buildCharacterBaseInstruction,
  buildSceneContextInstruction,
  hashFreeTextFields,
  needsFreeTextTranslation,
} from "@/lib/omniVoiceInstructions";
import { useAiRoles } from "@/hooks/useAiRoles";
import { useUserApiKeys } from "@/hooks/useUserApiKeys";
import { getModelRegistryEntry } from "@/config/modelRegistry";
import type { CharacterIndex } from "@/pages/parser/types";

interface BookOption {
  id: string;
  title: string;
}

interface CharacterAutoFillSectionProps {
  isRu: boolean;
  /** Called with the final concatenated EN prompt to apply into the Instructions textarea. */
  onApply: (prompt: string) => void;
  /**
   * Optional: called whenever the user picks a character. Receives the full
   * CharacterIndex so the parent can derive Advanced params, voice candidates, etc.
   * Phase 2: panel uses this to auto-apply OmniVoice generation knobs from psychotype.
   */
  onCharacterPicked?: (character: CharacterIndex) => void;
}

/** Mood/scene_type/segment_type options shown to user for the Scene Context block. */
const MOOD_CHOICES = [
  "calm", "tense", "anxious", "joyful", "sad", "angry", "fearful",
  "romantic", "mysterious", "triumphant", "melancholic", "ironic",
] as const;

const SEGMENT_CHOICES = [
  "dialogue", "monologue", "inner_thought", "first_person",
  "telephone", "narrator", "epigraph", "lyric", "footnote",
] as const;

const SCENE_TYPE_CHOICES = [
  "action", "dialogue", "inner_monologue", "description", "lyrical_digression", "remark",
] as const;

const NONE = "__none__";

export function CharacterAutoFillSection({ isRu, onApply, onCharacterPicked }: CharacterAutoFillSectionProps) {
  const { storage: projectStorage, meta: projectMeta } = useProjectStorageContext();

  // Translator role: respect user's configured model + API key
  const userApiKeys = useUserApiKeys();
  const { getModelForRole } = useAiRoles(userApiKeys);
  const translatorModel = getModelForRole("translator");
  const translatorKeyInfo = useMemo(() => {
    const entry = getModelRegistryEntry(translatorModel);
    if (!entry) return { apiKey: null as string | null, openrouterKey: null as string | null };
    if (entry.provider === "lovable") return { apiKey: null, openrouterKey: null };
    const apiKey = entry.apiKeyField ? userApiKeys[entry.apiKeyField] ?? null : null;
    const openrouterKey = userApiKeys.openrouter ?? null;
    return { apiKey, openrouterKey };
  }, [translatorModel, userApiKeys]);

  // ── Book + character pickers ──
  const [books, setBooks] = useState<BookOption[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string>("");
  const [characters, setCharacters] = useState<CharacterIndex[]>([]);
  const [selectedCharId, setSelectedCharId] = useState<string>("");
  const [loadingChars, setLoadingChars] = useState(false);

  // ── Scene context pickers ──
  const [mood, setMood] = useState<string>(NONE);
  const [segmentType, setSegmentType] = useState<string>(NONE);
  const [sceneType, setSceneType] = useState<string>(NONE);

  // ── Generated text (editable) ──
  const [baseText, setBaseText] = useState("");
  const [sceneText, setSceneText] = useState("");
  const [translating, setTranslating] = useState(false);

  // ── Active OPFS project as the only book source (Contract K3: no DB fallback) ──
  useEffect(() => {
    if (projectMeta?.bookId && projectMeta?.title) {
      const opt: BookOption = { id: projectMeta.bookId, title: projectMeta.title };
      setBooks([opt]);
      setSelectedBookId(projectMeta.bookId);
    } else {
      setBooks([]);
      setSelectedBookId("");
    }
  }, [projectMeta?.bookId, projectMeta?.title]);

  // ── Load characters strictly from OPFS for the active project ──
  useEffect(() => {
    if (!selectedBookId || !projectStorage || projectMeta?.bookId !== selectedBookId) {
      setCharacters([]);
      setSelectedCharId("");
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingChars(true);
      try {
        const local = await readCharacterIndex(projectStorage);
        if (!cancelled) setCharacters(local);
      } catch (err) {
        console.warn("[CharacterAutoFill] Failed to load characters:", err);
        if (!cancelled) setCharacters([]);
      } finally {
        if (!cancelled) setLoadingChars(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedBookId, projectStorage, projectMeta?.bookId]);

  const selectedChar = useMemo(
    () => characters.find(c => c.id === selectedCharId) ?? null,
    [characters, selectedCharId],
  );

  /** Persist updated cache back into characters.json (local-first). */
  const persistCache = useCallback(
    async (charId: string, patch: Partial<CharacterIndex["voice_config"]["omnivoice_cache"]>) => {
      if (!projectStorage || projectMeta?.bookId !== selectedBookId) return;
      try {
        const all = await readCharacterIndex(projectStorage);
        const updated = all.map(c => {
          if (c.id !== charId) return c;
          const prevCache = c.voice_config?.omnivoice_cache ?? {};
          return {
            ...c,
            voice_config: {
              ...c.voice_config,
              omnivoice_cache: { ...prevCache, ...patch },
            },
          };
        });
        await saveCharacterIndex(projectStorage, updated);
        // Reflect in local state
        setCharacters(updated);
      } catch (err) {
        console.warn("[CharacterAutoFill] Failed to persist cache:", err);
      }
    },
    [projectStorage, projectMeta?.bookId, selectedBookId],
  );

  /** Get translations from cache, or call edge function and cache. */
  const ensureFreeTextTranslation = useCallback(
    async (char: CharacterIndex): Promise<{ description_en: string; speech_style_en: string }> => {
      if (!needsFreeTextTranslation(char)) {
        return { description_en: "", speech_style_en: "" };
      }
      const currentHash = hashFreeTextFields(char);
      const cache = char.voice_config?.omnivoice_cache;
      if (cache?.cached_from_hash === currentHash && (cache.description_en || cache.speech_style_en)) {
        return {
          description_en: cache.description_en ?? "",
          speech_style_en: cache.speech_style_en ?? "",
        };
      }

      // Cache miss → call edge function via translator role
      setTranslating(true);
      try {
        const { data, error } = await supabase.functions.invoke("translate-character-fields", {
          body: {
            description: char.description ?? "",
            speech_style: char.speech_style ?? "",
            // Provider routing — translator role from useAiRoles
            model: translatorModel,
            apiKey: translatorKeyInfo.apiKey,
            openrouter_api_key: translatorKeyInfo.openrouterKey,
          },
        });
        if (error) throw error;
        if ((data as any)?.error) throw new Error((data as any).error);

        const result = {
          description_en: ((data as any).description_en ?? "").toString(),
          speech_style_en: ((data as any).speech_style_en ?? "").toString(),
        };

        // Persist into cache (only if local project)
        await persistCache(char.id, {
          description_en: result.description_en,
          speech_style_en: result.speech_style_en,
          cached_from_hash: currentHash,
        });

        return result;
      } finally {
        setTranslating(false);
      }
    },
    [persistCache, translatorModel, translatorKeyInfo],
  );

  /** Refresh the Character Base text from the selected character + (cached) translations. */
  const refreshBase = useCallback(async () => {
    if (!selectedChar) return;
    try {
      const { description_en, speech_style_en } = await ensureFreeTextTranslation(selectedChar);
      const base = buildCharacterBaseInstruction(selectedChar, {
        descriptionEn: description_en,
        speechStyleEn: speech_style_en,
      });
      setBaseText(base);
      if (!base) {
        toast.info(isRu ? "Профиль пуст — нечего собирать" : "Profile is empty — nothing to build");
      }
    } catch (err: any) {
      console.error("[CharacterAutoFill] refreshBase failed:", err);
      toast.error(err?.message ?? String(err));
    }
  }, [selectedChar, ensureFreeTextTranslation, isRu]);

  /** Refresh the Scene Context text from the picker values. */
  const refreshScene = useCallback(() => {
    const txt = buildSceneContextInstruction({
      mood: mood === NONE ? null : mood,
      sceneType: sceneType === NONE ? null : sceneType,
      segmentType: segmentType === NONE ? null : segmentType,
    });
    setSceneText(txt);
  }, [mood, sceneType, segmentType]);

  // Auto-refresh base when character changes (clears stale text)
  useEffect(() => {
    setBaseText("");
    setSceneText("");
  }, [selectedCharId]);

  // Auto-refresh scene when any picker changes
  useEffect(() => {
    refreshScene();
  }, [refreshScene]);

  const fullPrompt = useMemo(() => {
    const parts = [baseText.trim(), sceneText.trim()].filter(Boolean);
    return parts.join(" ");
  }, [baseText, sceneText]);

  const handleApply = useCallback(() => {
    if (!fullPrompt) {
      toast.error(isRu ? "Промпт пуст — сначала соберите Character Base" : "Prompt is empty — refresh Character Base first");
      return;
    }
    onApply(fullPrompt);
    toast.success(isRu ? "Инструкция применена" : "Instruction applied");
  }, [fullPrompt, onApply, isRu]);

  return (
    <Card className="border-dashed">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2 flex-wrap">
          <Wand2 className="w-4 h-4" />
          {isRu ? "Авто-заполнение из профиля персонажа" : "Auto-fill from character profile"}
          <Badge variant="outline" className="text-[10px] ml-1">EN</Badge>
          <Badge
            variant="secondary"
            className="text-[10px] font-normal"
            title={isRu ? "Модель роли «Переводчик»" : "Translator role model"}
          >
            <Languages className="w-3 h-3 mr-1" />
            {translatorModel.replace(/^(openrouter|proxyapi|dotpoint|lovable)\//, "")}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Pickers row */}
        <div className="grid grid-cols-2 gap-2">
          <div>
            <Label className="text-xs flex items-center gap-1">
              <BookOpen className="w-3 h-3" />
              {isRu ? "Книга" : "Book"}
            </Label>
            <Select value={selectedBookId} onValueChange={setSelectedBookId}>
              <SelectTrigger className="mt-1 text-xs">
                <SelectValue placeholder={isRu ? "Выберите книгу" : "Select book"} />
              </SelectTrigger>
              <SelectContent>
                {books.length === 0 && (
                  <SelectItem value="__empty" disabled>
                    {isRu ? "Откройте проект в Библиотеке" : "Open a project in Library"}
                  </SelectItem>
                )}
                {books.map(b => (
                  <SelectItem key={b.id} value={b.id}>{b.title}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs flex items-center gap-1">
              <User className="w-3 h-3" />
              {isRu ? "Персонаж" : "Character"}
              {loadingChars && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
            </Label>
            <Select value={selectedCharId} onValueChange={setSelectedCharId} disabled={!selectedBookId || loadingChars}>
              <SelectTrigger className="mt-1 text-xs">
                <SelectValue placeholder={isRu ? "Выберите персонажа" : "Select character"} />
              </SelectTrigger>
              <SelectContent>
                {characters.length === 0 && selectedBookId && !loadingChars && (
                  <SelectItem value="__empty" disabled>
                    {isRu ? "Персонажей нет" : "No characters"}
                  </SelectItem>
                )}
                {characters.map(c => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name} {c.gender !== "unknown" && <span className="text-muted-foreground">({c.gender[0]})</span>}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Scene context pickers */}
        <div className="grid grid-cols-3 gap-2">
          <div>
            <Label className="text-xs">{isRu ? "Настроение" : "Mood"}</Label>
            <Select value={mood} onValueChange={setMood}>
              <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {MOOD_CHOICES.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{isRu ? "Тип сегмента" : "Segment type"}</Label>
            <Select value={segmentType} onValueChange={setSegmentType}>
              <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {SEGMENT_CHOICES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">{isRu ? "Тип сцены" : "Scene type"}</Label>
            <Select value={sceneType} onValueChange={setSceneType}>
              <SelectTrigger className="mt-1 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>—</SelectItem>
                {SCENE_TYPE_CHOICES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Character Base */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs font-medium">
              {isRu ? "Character Base (стабильно)" : "Character Base (stable)"}
            </Label>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={refreshBase}
              disabled={!selectedChar || translating}
              title={isRu ? "Пересобрать из профиля + перевод свободных полей" : "Rebuild from profile + translate free fields"}
            >
              {translating ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <RefreshCw className="w-3 h-3" />
              )}
              {isRu ? "Пересобрать" : "Refresh"}
            </Button>
          </div>
          <Textarea
            value={baseText}
            onChange={(e) => setBaseText(e.target.value)}
            placeholder={isRu
              ? "Например: Middle-aged, around 40 male voice. Calm and steady, even tempo; commanding undertone."
              : "e.g. Middle-aged, around 40 male voice. Calm and steady, even tempo; commanding undertone."}
            rows={3}
            className="text-xs font-mono"
          />
          {selectedChar?.voice_config?.omnivoice_cache?.cached_from_hash && (
            <p className="text-[10px] text-muted-foreground mt-1 flex items-center gap-1">
              <Languages className="w-3 h-3" />
              {isRu ? "Перевод закэширован" : "Translation cached"}
            </p>
          )}
        </div>

        {/* Scene Context */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <Label className="text-xs font-medium">
              {isRu ? "Scene Context (динамично)" : "Scene Context (dynamic)"}
            </Label>
            <Button
              size="sm"
              variant="outline"
              className="h-6 px-2 text-[10px] gap-1"
              onClick={refreshScene}
              title={isRu ? "Пересобрать из выбранного контекста" : "Rebuild from selected context"}
            >
              <RefreshCw className="w-3 h-3" />
              {isRu ? "Пересобрать" : "Refresh"}
            </Button>
          </div>
          <Textarea
            value={sceneText}
            onChange={(e) => setSceneText(e.target.value)}
            placeholder={isRu ? "Currently tense, in conversation." : "Currently tense, in conversation."}
            rows={2}
            className="text-xs font-mono"
          />
        </div>

        {/* Final preview + Apply */}
        <div className="rounded border bg-muted/30 p-2 space-y-2">
          <div className="flex items-center justify-between">
            <Label className="text-xs font-medium text-muted-foreground">
              {isRu ? "Финальный промпт" : "Final prompt"}
              <span className="ml-2 text-[10px]">{fullPrompt.length}/320</span>
            </Label>
            <Button
              size="sm"
              variant="default"
              className="h-7 gap-1"
              onClick={handleApply}
              disabled={!fullPrompt}
            >
              <Check className="w-3 h-3" />
              {isRu ? "Применить" : "Apply"}
            </Button>
          </div>
          <pre className="text-[11px] font-mono whitespace-pre-wrap break-words text-foreground/90 min-h-[40px]">
            {fullPrompt || (isRu ? "(пусто)" : "(empty)")}
          </pre>
        </div>
      </CardContent>
    </Card>
  );
}
