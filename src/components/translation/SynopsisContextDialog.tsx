/**
 * SynopsisContextDialog — modal for viewing/editing translation context
 * before running the pipeline.
 *
 * Accordion: Book Meta → Chapter Synopsis → Scene Synopsis (with character profiles).
 */

import { useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Wand2, BookOpen, FileText, Theater } from "lucide-react";
import type { BookMetaSynopsis, ChapterSynopsis, SceneSynopsis } from "@/lib/translationSynopsis";

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
}

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
}: Props) {
  const handleClose = useCallback(async (nextOpen: boolean) => {
    if (!nextOpen) {
      await onSave();
    }
    onOpenChange(nextOpen);
  }, [onOpenChange, onSave]);

  const bm = bookMeta ?? { era: "", genre: "", style: "", authorNote: "" };
  const cs = chapterSynopsis;
  const ss = sceneSynopsis;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
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

        <Accordion type="multiple" defaultValue={["book", "chapter", "scene"]} className="w-full">
          {/* ── Book Meta ─────────────────────────── */}
          <AccordionItem value="book">
            <AccordionTrigger className="text-sm font-medium">
              <span className="flex items-center gap-2">
                <BookOpen className="h-4 w-4" />
                {isRu ? "Книга" : "Book"}
                {bm.era && <Badge variant="secondary" className="text-xs ml-1">{bm.era}</Badge>}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
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
                  className="min-h-[60px] text-sm"
                  rows={2}
                />
              </div>
            </AccordionContent>
          </AccordionItem>

          {/* ── Chapter Synopsis ──────────────────── */}
          <AccordionItem value="chapter">
            <AccordionTrigger className="text-sm font-medium">
              <span className="flex items-center gap-2">
                <FileText className="h-4 w-4" />
                {isRu ? "Глава" : "Chapter"}
                {chapterTitle && (
                  <span className="text-xs text-muted-foreground font-normal truncate max-w-[200px]">
                    {chapterTitle}
                  </span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
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
                    className="min-h-[80px] text-sm"
                    rows={3}
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
            </AccordionContent>
          </AccordionItem>

          {/* ── Scene Synopsis ────────────────────── */}
          <AccordionItem value="scene">
            <AccordionTrigger className="text-sm font-medium">
              <span className="flex items-center gap-2">
                <Theater className="h-4 w-4" />
                {isRu ? "Сцена" : "Scene"}
                {sceneTitle && (
                  <span className="text-xs text-muted-foreground font-normal truncate max-w-[200px]">
                    {sceneTitle}
                  </span>
                )}
              </span>
            </AccordionTrigger>
            <AccordionContent className="space-y-3 pt-2">
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
                    className="min-h-[80px] text-sm"
                    rows={3}
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

                  {/* Character profiles */}
                  {ss.characters.length > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-muted-foreground">
                        {isRu ? "Персонажи сцены" : "Scene characters"}
                      </Label>
                      <div className="space-y-1.5">
                        {ss.characters.map((ch, i) => (
                          <div
                            key={i}
                            className="flex items-start gap-2 text-xs bg-muted/50 rounded-md p-2"
                          >
                            <span className="font-medium whitespace-nowrap">{ch.name}</span>
                            <span className="text-muted-foreground">
                              ({ch.gender}, {ch.age_group})
                              {ch.temperament && ` · ${ch.temperament}`}
                              {ch.speech_style && ` · ${ch.speech_style}`}
                            </span>
                            {ch.speech_tags.length > 0 && (
                              <div className="flex gap-0.5 flex-wrap">
                                {ch.speech_tags.map((tag) => (
                                  <Badge key={tag} variant="outline" className="text-[10px] px-1 py-0">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      </DialogContent>
    </Dialog>
  );
}
