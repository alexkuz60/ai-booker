/**
 * SynopsisContextDialog — modal for viewing/editing translation context
 * before running the pipeline.
 *
 * 4 tabs: Book Meta → Chapter Synopsis → Scene Synopsis → Characters.
 */

import { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Wand2, BookOpen, FileText, Theater, Users, ChevronLeft } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import type { BookMetaSynopsis, ChapterSynopsis, SceneSynopsis } from "@/lib/translationSynopsis";
import type { CharacterIndex } from "@/pages/parser/types";

// ─── Localization ───────────────────────────────────────────────────

const AGE_LABELS: Record<string, { ru: string; en: string }> = {
  child: { ru: "Ребёнок", en: "Child" },
  teen: { ru: "Подросток", en: "Teen" },
  young: { ru: "Молодой", en: "Young" },
  adult: { ru: "Взрослый", en: "Adult" },
  middle: { ru: "Средний возраст", en: "Middle-aged" },
  elder: { ru: "Пожилой", en: "Elder" },
};

const TEMPERAMENT_LABELS: Record<string, { ru: string; en: string }> = {
  sanguine: { ru: "Сангвиник", en: "Sanguine" },
  choleric: { ru: "Холерик", en: "Choleric" },
  melancholic: { ru: "Меланхолик", en: "Melancholic" },
  phlegmatic: { ru: "Флегматик", en: "Phlegmatic" },
};

function loc(value: string, map: Record<string, { ru: string; en: string }>, isRu: boolean): string {
  return map[value]?.[isRu ? "ru" : "en"] ?? value;
}

// ─── Props ──────────────────────────────────────────────────────────

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  isRu: boolean;
  bookMeta: BookMetaSynopsis | null;
  chapterSynopsis: ChapterSynopsis | null;
  sceneSynopsis: SceneSynopsis | null;
  onBookMetaChange: (meta: BookMetaSynopsis) => void;
  onChapterChange: (cs: ChapterSynopsis) => void;
  onSceneChange: (ss: SceneSynopsis) => void;
  onSave: () => Promise<void>;
  onGenerateChapter: () => void;
  onGenerateScene: () => void;
  generating: "book" | "chapter" | "scene" | null;
  chapterTitle?: string;
  sceneTitle?: string;
  /** Characters from the current chapter for the Characters tab */
  chapterCharacters?: CharacterIndex[];
  /** IDs of characters excluded from translation context */
  excludedCharIds?: Set<string>;
  onExcludedCharsChange?: (ids: Set<string>) => void;
}

// ─── Component ──────────────────────────────────────────────────────

export function SynopsisContextDialog({
  open,
  onOpenChange,
  isRu,
  bookMeta,
  chapterSynopsis,
  sceneSynopsis,
  onBookMetaChange,
  onChapterChange,
  onSceneChange,
  onSave,
  onGenerateChapter,
  onGenerateScene,
  generating,
  chapterTitle,
  sceneTitle,
  chapterCharacters = [],
  excludedCharIds = new Set(),
  onExcludedCharsChange,
}: Props) {
  const [selectedCharId, setSelectedCharId] = useState<string | null>(null);

  const handleClose = useCallback(async (nextOpen: boolean) => {
    if (!nextOpen) {
      await onSave();
      setSelectedCharId(null);
    }
    onOpenChange(nextOpen);
  }, [onOpenChange, onSave]);

  const bm = bookMeta ?? { era: "", genre: "", style: "", authorNote: "" };
  const cs = chapterSynopsis;
  const ss = sceneSynopsis;

  const selectedChar = chapterCharacters.find((c) => c.id === selectedCharId) ?? null;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BookOpen className="h-5 w-5 text-primary" />
            {isRu ? "Контекст перевода" : "Translation Context"}
          </DialogTitle>
          <DialogDescription>
            {isRu
              ? "Синопсисы и метаданные передаются переводчику и критику для консистентности."
              : "Synopses and metadata are injected into translator/critic prompts for consistency."}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="meta" className="flex-1 min-h-0 flex flex-col">
          <TabsList className="w-full grid grid-cols-4">
            <TabsTrigger value="meta" className="text-xs gap-1">
              <BookOpen className="h-3.5 w-3.5" />
              {isRu ? "Мета" : "Meta"}
            </TabsTrigger>
            <TabsTrigger value="chapter" className="text-xs gap-1">
              <FileText className="h-3.5 w-3.5" />
              {isRu ? "Глава" : "Chapter"}
            </TabsTrigger>
            <TabsTrigger value="scene" className="text-xs gap-1">
              <Theater className="h-3.5 w-3.5" />
              {isRu ? "Сцена" : "Scene"}
            </TabsTrigger>
            <TabsTrigger value="characters" className="text-xs gap-1">
              <Users className="h-3.5 w-3.5" />
              {isRu ? "Персонажи" : "Characters"}
              {chapterCharacters.length > 0 && (
                <Badge variant="secondary" className="text-[10px] px-1 py-0 ml-0.5">
                  {chapterCharacters.length}
                </Badge>
              )}
            </TabsTrigger>
          </TabsList>

          {/* ── Tab: Book Meta ──────────────────────── */}
          <TabsContent value="meta" className="flex-1 min-h-0">
            <ScrollArea className="h-[calc(85vh-200px)]">
              <div className="space-y-3 pr-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs text-muted-foreground">{isRu ? "Эпоха" : "Era"}</Label>
                    <Input
                      value={bm.era}
                      onChange={(e) => onBookMetaChange({ ...bm, era: e.target.value })}
                      placeholder={isRu ? "XIX век, Серебряный век..." : "Victorian, Modern..."}
                      className="h-8 text-sm"
                    />
                  </div>
                  <div>
                    <Label className="text-xs text-muted-foreground">{isRu ? "Жанр" : "Genre"}</Label>
                    <Input
                      value={bm.genre}
                      onChange={(e) => onBookMetaChange({ ...bm, genre: e.target.value })}
                      placeholder={isRu ? "Роман, детектив..." : "Novel, thriller..."}
                      className="h-8 text-sm"
                    />
                  </div>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{isRu ? "Стиль" : "Style"}</Label>
                  <Input
                    value={bm.style}
                    onChange={(e) => onBookMetaChange({ ...bm, style: e.target.value })}
                    placeholder={isRu ? "Классическая проза, разговорный..." : "Classical prose, colloquial..."}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">{isRu ? "Примечание автора" : "Author note"}</Label>
                  <Textarea
                    value={bm.authorNote}
                    onChange={(e) => onBookMetaChange({ ...bm, authorNote: e.target.value })}
                    placeholder={isRu ? "Особенности стиля, диалекты, неологизмы..." : "Style notes, dialects, neologisms..."}
                    className="min-h-[100px] text-sm"
                    rows={4}
                  />
                </div>
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Tab: Chapter Synopsis ───────────────── */}
          <TabsContent value="chapter" className="flex-1 min-h-0">
            <ScrollArea className="h-[calc(85vh-200px)]">
              <div className="space-y-3 pr-3">
                {chapterTitle && (
                  <div className="text-sm font-medium text-muted-foreground truncate">{chapterTitle}</div>
                )}
                {cs && (
                  <>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">{isRu ? "Синопсис" : "Summary"}</Label>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onGenerateChapter}
                        disabled={generating !== null}
                        className="h-7 text-xs gap-1"
                      >
                        {generating === "chapter" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wand2 className="h-3 w-3" />
                        )}
                        {isRu ? "Сгенерировать" : "Generate"}
                      </Button>
                    </div>
                    <Textarea
                      value={cs.summary}
                      onChange={(e) => onChapterChange({ ...cs, summary: e.target.value })}
                      placeholder={isRu ? "Краткое содержание главы..." : "Chapter summary..."}
                      className="min-h-[120px] text-sm"
                      rows={5}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">{isRu ? "Тон" : "Tone"}</Label>
                        <Input
                          value={cs.tone}
                          onChange={(e) => onChapterChange({ ...cs, tone: e.target.value })}
                          placeholder={isRu ? "мрачный, напряжённый" : "dark, tense"}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">{isRu ? "Темы" : "Themes"}</Label>
                        <Input
                          value={cs.keyThemes.join(", ")}
                          onChange={(e) =>
                            onChapterChange({
                              ...cs,
                              keyThemes: e.target.value.split(",").map((s) => s.trim()).filter(Boolean),
                            })
                          }
                          placeholder={isRu ? "через запятую" : "comma-separated"}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Tab: Scene Synopsis ─────────────────── */}
          <TabsContent value="scene" className="flex-1 min-h-0">
            <ScrollArea className="h-[calc(85vh-200px)]">
              <div className="space-y-3 pr-3">
                {sceneTitle && (
                  <div className="text-sm font-medium text-muted-foreground truncate">{sceneTitle}</div>
                )}
                {ss && (
                  <>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">{isRu ? "События" : "Events"}</Label>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={onGenerateScene}
                        disabled={generating !== null}
                        className="h-7 text-xs gap-1"
                      >
                        {generating === "scene" ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wand2 className="h-3 w-3" />
                        )}
                        {isRu ? "Сгенерировать" : "Generate"}
                      </Button>
                    </div>
                    <Textarea
                      value={ss.events}
                      onChange={(e) => onSceneChange({ ...ss, events: e.target.value })}
                      placeholder={isRu ? "Что происходит в сцене..." : "What happens in the scene..."}
                      className="min-h-[120px] text-sm"
                      rows={5}
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label className="text-xs text-muted-foreground">{isRu ? "Настроение" : "Mood"}</Label>
                        <Input
                          value={ss.mood}
                          onChange={(e) => onSceneChange({ ...ss, mood: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">{isRu ? "Место" : "Setting"}</Label>
                        <Input
                          value={ss.setting}
                          onChange={(e) => onSceneChange({ ...ss, setting: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </div>
                    </div>
                  </>
                )}
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Tab: Characters ────────────────────── */}
          <TabsContent value="characters" className="flex-1 min-h-0">
            <ScrollArea className="h-[calc(85vh-200px)]">
              <div className="pr-3">
                {selectedChar ? (
                  <CharacterProfile char={selectedChar} isRu={isRu} onBack={() => setSelectedCharId(null)} />
                ) : (
                  <CharacterList
                    characters={chapterCharacters}
                    isRu={isRu}
                    onSelect={setSelectedCharId}
                    excludedIds={excludedCharIds}
                    onToggleExclude={(id) => {
                      const next = new Set(excludedCharIds);
                      if (next.has(id)) next.delete(id); else next.add(id);
                      onExcludedCharsChange?.(next);
                    }}
                  />
                )}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

// ─── Character List ─────────────────────────────────────────────────

function CharacterList({
  characters,
  isRu,
  onSelect,
  excludedIds,
  onToggleExclude,
}: {
  characters: CharacterIndex[];
  isRu: boolean;
  onSelect: (id: string) => void;
  excludedIds: Set<string>;
  onToggleExclude: (id: string) => void;
}) {
  if (characters.length === 0) {
    return (
      <div className="text-center text-sm text-muted-foreground py-8">
        {isRu ? "Нет персонажей в этой главе" : "No characters in this chapter"}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between px-2 pb-1">
        <span className="text-xs text-muted-foreground">
          {isRu ? "Включены в контекст" : "Included in context"}: {characters.length - excludedIds.size}/{characters.length}
        </span>
      </div>
      {characters.map((ch) => {
        const hasProfile = !!(ch.temperament || ch.description);
        const excluded = excludedIds.has(ch.id);
        return (
          <div
            key={ch.id}
            className={`flex items-center gap-2 rounded-md p-2.5 hover:bg-muted/70 transition-colors ${excluded ? "opacity-50" : ""}`}
          >
            <Checkbox
              checked={!excluded}
              onCheckedChange={() => onToggleExclude(ch.id)}
              className="shrink-0"
            />
            <button
              onClick={() => onSelect(ch.id)}
              className="flex-1 min-w-0 text-left flex items-center gap-2"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">{ch.name}</span>
                  <Badge variant="outline" className="text-[10px] px-1 py-0 shrink-0">
                    {ch.gender === "male" ? (isRu ? "М" : "M") : ch.gender === "female" ? (isRu ? "Ж" : "F") : "?"}
                  </Badge>
                  {ch.age_group && (
                    <Badge variant="secondary" className="text-[10px] px-1 py-0 shrink-0">
                      {loc(ch.age_group, AGE_LABELS, isRu)}
                    </Badge>
                  )}
                </div>
                {ch.description && (
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{ch.description}</p>
                )}
              </div>
              {hasProfile && (
                <Badge variant="default" className="text-[10px] px-1.5 py-0 shrink-0">
                  {isRu ? "профиль" : "profile"}
                </Badge>
              )}
            </button>
          </div>
        );
      })}
    </div>
  );
}

// ─── Character Profile Detail ───────────────────────────────────────

function CharacterProfile({
  char: ch,
  isRu,
  onBack,
}: {
  char: CharacterIndex;
  isRu: boolean;
  onBack: () => void;
}) {
  return (
    <div className="space-y-4">
      <button onClick={onBack} className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors">
        <ChevronLeft className="h-3.5 w-3.5" />
        {isRu ? "К списку" : "Back to list"}
      </button>

      <div>
        <h3 className="text-base font-semibold">{ch.name}</h3>
        {ch.aliases?.length > 0 && (
          <p className="text-xs text-muted-foreground mt-0.5">
            {isRu ? "Алиасы" : "Aliases"}: {ch.aliases.join(", ")}
          </p>
        )}
      </div>

      {/* Badges */}
      <div className="flex flex-wrap gap-1.5">
        <Badge variant="outline">
          {ch.gender === "male" ? (isRu ? "Мужской" : "Male") : ch.gender === "female" ? (isRu ? "Женский" : "Female") : ch.gender}
        </Badge>
        {ch.age_group && <Badge variant="outline">{loc(ch.age_group, AGE_LABELS, isRu)}</Badge>}
        {ch.temperament && <Badge variant="secondary">{loc(ch.temperament, TEMPERAMENT_LABELS, isRu)}</Badge>}
      </div>

      {/* Description */}
      {ch.description && (
        <div>
          <Label className="text-xs text-muted-foreground">{isRu ? "Описание" : "Description"}</Label>
          <p className="text-sm mt-1 leading-relaxed">{ch.description}</p>
        </div>
      )}

      {/* Speech style */}
      {ch.speech_style && (
        <div>
          <Label className="text-xs text-muted-foreground">{isRu ? "Стиль речи" : "Speech style"}</Label>
          <p className="text-sm mt-1">{ch.speech_style}</p>
        </div>
      )}

      {/* Speech tags */}
      {ch.speech_tags?.length > 0 && (
        <div>
          <Label className="text-xs text-muted-foreground">{isRu ? "Речевые теги" : "Speech tags"}</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {ch.speech_tags.map((tag) => (
              <Badge key={tag} variant="outline" className="text-xs">{tag}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Psycho tags */}
      {ch.psycho_tags?.length > 0 && (
        <div>
          <Label className="text-xs text-muted-foreground">{isRu ? "Психо-теги" : "Psycho tags"}</Label>
          <div className="flex flex-wrap gap-1 mt-1">
            {ch.psycho_tags.map((tag) => (
              <Badge key={tag} variant="secondary" className="text-xs">{tag}</Badge>
            ))}
          </div>
        </div>
      )}

      {/* Appearances */}
      {ch.appearances?.length > 0 && (
        <div>
          <Label className="text-xs text-muted-foreground">
            {isRu ? "Появления" : "Appearances"} ({ch.appearances.length})
          </Label>
          <div className="mt-1 space-y-0.5">
            {ch.appearances.slice(0, 10).map((app, i) => (
              <div key={i} className="text-xs text-muted-foreground">
                {app.chapterTitle}
                {app.sceneNumbers?.length > 0 && ` · ${isRu ? "сцены" : "scenes"}: ${app.sceneNumbers.join(", ")}`}
              </div>
            ))}
            {ch.appearances.length > 10 && (
              <div className="text-xs text-muted-foreground italic">
                +{ch.appearances.length - 10} {isRu ? "ещё" : "more"}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
