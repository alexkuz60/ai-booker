/**
 * serverDeploy — Wipe-and-Deploy data pipeline.
 *
 * Pure async function that fetches all book data from Supabase
 * and writes it into a clean OPFS project. No React state — the
 * caller (useBookRestore) handles UI updates.
 *
 * Architecture: This is the ONLY place where server→local data
 * flows. After deploy completes, OPFS is the sole source of truth.
 */

import { supabase } from "@/integrations/supabase/client";
import {
  flattenTocWithRanges,
  type TocEntry,
} from "@/lib/pdf-extract";
import type {
  Scene,
  TocChapter,
  ChapterStatus,
  BookRecord,
  CharacterIndex,
  CharacterAppearance,
  SceneCharacterMap,
} from "@/pages/parser/types";
import { classifySection, normalizeLevels } from "@/pages/parser/types";
import type { ProjectStorage } from "@/lib/projectStorage";
import { syncStructureToLocal } from "@/lib/localSync";
import {
  isFolderNode,
  normalizeTocRanges,
  sanitizeChapterResultsForStructure,
} from "@/lib/tocStructure";
import { detectFileFormat, getSourcePath, stripFileExtension } from "@/lib/fileFormatUtils";
import { saveCharacterIndex, saveSceneCharacterMap } from "@/lib/localCharacters";
import {
  saveStoryboardToLocal,
  type LocalTypeMappingEntry,
} from "@/lib/storyboardSync";
import type { SyncProgressCallback } from "@/components/SyncProgressDialog";

// ── Types ───────────────────────────────────────────────────

export interface DeployResult {
  toc: TocChapter[];
  chapterIdMap: Map<number, string>;
  partIdMap: Map<string, string>;
  chapterResults: Map<number, { scenes: Scene[]; status: ChapterStatus }>;
  pdfProxy: any | null;
  totalPages: number;
}

interface DeployParams {
  book: BookRecord;
  storage: ProjectStorage;
  isRu: boolean;
  report: SyncProgressCallback;
}

// ── Helpers ─────────────────────────────────────────────────

async function fetchChunked<T>(
  table: string,
  select: string,
  filterCol: string,
  filterIds: string[],
  chunkSize: number,
  order?: string,
): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < filterIds.length; i += chunkSize) {
    const chunk = filterIds.slice(i, i + chunkSize);
    let q = supabase.from(table as any).select(select).in(filterCol, chunk);
    if (order) q = q.order(order);
    const { data } = await q;
    if (data) results.push(...(data as T[]));
  }
  return results;
}

// ── Main pipeline ───────────────────────────────────────────

export async function deployFromServer({
  book,
  storage,
  isRu,
  report,
}: DeployParams): Promise<DeployResult> {
  // ── 1. Fetch structure (parts + chapters + source file) ───
  report("fetch_structure", "running");
  const [partsRes, chaptersRes, pdfBlob] = await Promise.all([
    supabase
      .from("book_parts")
      .select("id, part_number, title")
      .eq("book_id", book.id)
      .order("part_number"),
    supabase
      .from("book_chapters")
      .select(
        "id, chapter_number, title, scene_type, mood, bpm, part_id, level, start_page, end_page",
      )
      .eq("book_id", book.id)
      .order("chapter_number"),
    book.file_path
      ? supabase.storage
          .from("book-uploads")
          .download(book.file_path)
          .then((r) => r.data)
      : Promise.resolve(null),
  ]);

  const parts = partsRes.data || [];
  const chapters = chaptersRes.data || [];

  if (chapters.length === 0) {
    report("fetch_structure", "error", isRu ? "Нет глав" : "No chapters");
    throw new Error(isRu ? "Нет глав на сервере" : "No chapters found on server");
  }
  report("fetch_structure", "done", `${chapters.length}`);

  // ── 2. Parse PDF (if applicable) ──────────────────────────
  const bookFormat = detectFileFormat(book.file_name);
  const isBookDocx = bookFormat === "docx";

  report("parse_pdf", "running");
  let pdfProxy: any = null;
  let totalPages = 0;
  let tocFromPdf: { startPage: number; endPage: number; level: number }[] = [];

  if (!isBookDocx && pdfBlob) {
    try {
      const arrayBuffer = await pdfBlob.arrayBuffer();
      const { getDocument } = await import("pdfjs-dist");
      const pdf = await getDocument({ data: arrayBuffer }).promise;
      pdfProxy = pdf;
      totalPages = pdf.numPages;

      const rawOutline = await pdf.getOutline();
      if (rawOutline && rawOutline.length > 0) {
        const flat = flattenTocWithRanges(
          await (async function parseItems(
            items: any[],
            level: number,
          ): Promise<TocEntry[]> {
            const entries: TocEntry[] = [];
            for (const item of items) {
              let pageNumber = 1;
              try {
                if (item.dest) {
                  const dest =
                    typeof item.dest === "string"
                      ? await pdf.getDestination(item.dest)
                      : item.dest;
                  if (dest && dest[0]) {
                    const pageIndex = await pdf.getPageIndex(dest[0]);
                    pageNumber = pageIndex + 1;
                  }
                }
              } catch {}
              const children = item.items?.length
                ? await parseItems(item.items, level + 1)
                : [];
              entries.push({
                title: item.title || "Untitled",
                pageNumber,
                level,
                children,
              });
            }
            return entries;
          })(rawOutline, 0),
          pdf.numPages,
        );

        tocFromPdf = chapters.map((ch, i) => {
          const byTitle = flat.find((f) => f.title === ch.title);
          if (byTitle)
            return {
              startPage: byTitle.startPage,
              endPage: byTitle.endPage,
              level: byTitle.level,
            };
          if (i < flat.length)
            return {
              startPage: flat[i].startPage,
              endPage: flat[i].endPage,
              level: flat[i].level,
            };
          return { startPage: 0, endPage: 0, level: 0 };
        });
      }
    } catch (pdfErr) {
      console.warn("Could not restore PDF for analysis:", pdfErr);
    }
  }
  report("parse_pdf", isBookDocx ? "skipped" : pdfProxy ? "done" : "skipped");

  // ── 3. Build TOC ──────────────────────────────────────────
  report("build_toc", "running");

  const partById = new Map<string, string>();
  const partIdMap = new Map<string, string>();
  for (const p of parts) {
    partById.set(p.id, p.title);
    partIdMap.set(p.title, p.id);
  }

  const hasParts = parts.length > 0;
  const savedToc: TocChapter[] = chapters.map((ch, i) => {
    const pdfInfo = tocFromPdf[i];
    const dbStartPage = (ch as any).start_page || 0;
    const dbEndPage = (ch as any).end_page || 0;
    return {
      title: ch.title,
      startPage: dbStartPage || pdfInfo?.startPage || 0,
      endPage: dbEndPage || pdfInfo?.endPage || 0,
      level:
        ch.level != null
          ? ch.level
          : (pdfInfo?.level ?? (hasParts && ch.part_id ? 1 : 0)),
      partTitle: ch.part_id ? partById.get(ch.part_id) : undefined,
      sectionType: classifySection(ch.title),
    };
  });
  const toc = normalizeTocRanges(
    normalizeLevels(savedToc),
    totalPages > 0 ? totalPages : undefined,
  );

  const chapterIdMap = new Map<number, string>();
  chapters.forEach((ch, i) => chapterIdMap.set(i, ch.id));

  // ── 4. Fetch scenes (chunked) ─────────────────────────────
  const allChapterIds = chapters.map((c) => c.id);

  type RawScene = {
    id: string;
    chapter_id: string;
    scene_number: number;
    title: string;
    content: string | null;
    scene_type: string | null;
    mood: string | null;
    bpm: number | null;
  };

  const allScenes = await fetchChunked<RawScene>(
    "book_scenes",
    "id, chapter_id, scene_number, title, content, scene_type, mood, bpm",
    "chapter_id",
    allChapterIds,
    100,
    "scene_number",
  );

  const scenesByChapter = new Map<string, Scene[]>();
  for (const s of allScenes) {
    const list = scenesByChapter.get(s.chapter_id) || [];
    list.push({
      id: s.id,
      scene_number: s.scene_number,
      title: s.title,
      content: s.content || undefined,
      content_preview: (s.content || "").slice(0, 200) || undefined,
      scene_type: s.scene_type || "mixed",
      mood: s.mood || "neutral",
      bpm: s.bpm || 120,
      char_count: (s.content || "").length,
    });
    scenesByChapter.set(s.chapter_id, list);
  }

  const initRawMap = new Map<number, { scenes: Scene[]; status: ChapterStatus }>();
  chapters.forEach((ch, i) => {
    const scenes = isFolderNode(toc, i) ? [] : (scenesByChapter.get(ch.id) || []);
    initRawMap.set(i, { scenes, status: scenes.length > 0 ? "done" : "pending" });
  });
  const chapterResults = sanitizeChapterResultsForStructure(toc, initRawMap);

  report(
    "build_toc",
    "done",
    `${toc.length} ${isRu ? "глав" : "ch"}, ${allScenes.length} ${isRu ? "сцен" : "sc"}`,
  );

  // ── 5. Write structure to OPFS ────────────────────────────
  report("write_local", "running");
  await syncStructureToLocal(storage, {
    bookId: book.id,
    title: book.title || stripFileExtension(book.file_name),
    fileName: book.file_name,
    toc,
    parts: parts.map((p) => ({
      id: p.id,
      title: p.title,
      partNumber: p.part_number,
    })),
    chapterIdMap,
    chapterResults,
  });
  report("write_local", "done");

  // ── 6. Characters + appearances ─────────────────────────────
  report("characters", "running");
  let restoredChars: CharacterIndex[] = [];
  try {
    const { data: serverChars } = await supabase
      .from("book_characters")
      .select(
        "id, name, aliases, gender, age_group, temperament, speech_style, description, speech_tags, psycho_tags, sort_order, color, voice_config",
      )
      .eq("book_id", book.id)
      .order("sort_order");

    if (serverChars && serverChars.length > 0) {
      // Build reverse map: scene_id → { chapterIdx, chapterTitle }
      const sceneToChapter = new Map<string, { chapterIdx: number; chapterTitle: string }>();
      for (const [idx, ch] of chapters.entries()) {
        const scenesForCh = scenesByChapter.get(ch.id) || [];
        for (const s of scenesForCh) {
          sceneToChapter.set(s.id, { chapterIdx: idx, chapterTitle: ch.title });
        }
      }

      // Fetch character_appearances to rebuild appearances list
      const charIds = serverChars.map(c => c.id);
      type RawAppearance = {
        character_id: string;
        scene_id: string;
        role_in_scene: string;
      };
      const serverAppearances = await fetchChunked<RawAppearance>(
        "character_appearances",
        "character_id, scene_id, role_in_scene",
        "character_id",
        charIds,
        500,
      );

      // Group appearances by character_id → Map<chapterIdx, Set<sceneNumber>>
      const charAppMap = new Map<string, Map<number, { title: string; sceneNumbers: Set<number> }>>();
      const charSceneCount = new Map<string, number>();
      for (const app of serverAppearances) {
        const chInfo = sceneToChapter.get(app.scene_id);
        if (!chInfo) continue;

        // Count unique scenes per character
        charSceneCount.set(app.character_id, (charSceneCount.get(app.character_id) || 0) + 1);

        let chapterMap = charAppMap.get(app.character_id);
        if (!chapterMap) {
          chapterMap = new Map();
          charAppMap.set(app.character_id, chapterMap);
        }
        let chEntry = chapterMap.get(chInfo.chapterIdx);
        if (!chEntry) {
          chEntry = { title: chInfo.chapterTitle, sceneNumbers: new Set() };
          chapterMap.set(chInfo.chapterIdx, chEntry);
        }
        // Find scene_number from raw scenes
        const rawScenes = scenesByChapter.get(chapters[chInfo.chapterIdx]?.id || "") || [];
        const matchScene = rawScenes.find(s => s.id === app.scene_id);
        if (matchScene) chEntry.sceneNumbers.add(matchScene.scene_number);
      }

      restoredChars = serverChars.map((sc) => {
        const chapterMap = charAppMap.get(sc.id);
        const appearances: CharacterAppearance[] = [];
        if (chapterMap) {
          for (const [chIdx, entry] of Array.from(chapterMap.entries()).sort((a, b) => a[0] - b[0])) {
            appearances.push({
              chapterIdx: chIdx,
              chapterTitle: entry.title,
              sceneNumbers: Array.from(entry.sceneNumbers).sort((a, b) => a - b),
            });
          }
        }

        return {
          id: sc.id,
          name: sc.name,
          aliases: sc.aliases || [],
          gender: (sc.gender as "male" | "female" | "unknown") || "unknown",
          age_group: sc.age_group || "unknown",
          temperament: sc.temperament || null,
          speech_style: sc.speech_style || null,
          description: sc.description || null,
          speech_tags: sc.speech_tags || [],
          psycho_tags: sc.psycho_tags || [],
          sort_order: sc.sort_order || 0,
          color: sc.color || null,
          voice_config: (sc.voice_config as Record<string, unknown>) || {},
          appearances,
          sceneCount: charSceneCount.get(sc.id) || 0,
        };
      });
      await saveCharacterIndex(storage, restoredChars);
      console.log(
        `[Deploy] Restored ${restoredChars.length} characters with ${serverAppearances.length} appearances`,
      );
    }
  } catch (err) {
    console.warn("[Deploy] Failed to restore characters:", err);
  }
  report(
    "characters",
    restoredChars.length > 0 ? "done" : "skipped",
    restoredChars.length > 0 ? `${restoredChars.length}` : undefined,
  );

  // ── 7. Storyboards ────────────────────────────────────────
  report("storyboards", "running");
  try {
    const allSceneIds = allScenes.map((s) => s.id);
    if (allSceneIds.length > 0) {
      type RawSeg = {
        id: string;
        scene_id: string;
        segment_number: number;
        segment_type: string;
        speaker: string | null;
        metadata: any;
      };
      const serverSegments = await fetchChunked<RawSeg>(
        "scene_segments",
        "id, scene_id, segment_number, segment_type, speaker, metadata",
        "scene_id",
        allSceneIds,
        500,
        "segment_number",
      );

      if (serverSegments.length > 0) {
        // Phrases (chunked by segment IDs)
        type RawPhrase = {
          id: string;
          segment_id: string;
          phrase_number: number;
          text: string;
          metadata: any;
        };
        const segmentIds = serverSegments.map((s) => s.id);
        const allPhrases = await fetchChunked<RawPhrase>(
          "segment_phrases",
          "id, segment_id, phrase_number, text, metadata",
          "segment_id",
          segmentIds,
          500,
          "phrase_number",
        );

        // Type mappings (chunked)
        type RawMapping = {
          scene_id: string;
          segment_type: string;
          character_id: string;
        };
        const serverMappings = await fetchChunked<RawMapping>(
          "scene_type_mappings",
          "scene_id, segment_type, character_id",
          "scene_id",
          allSceneIds,
          500,
        );

        // Group by parent
        const phrasesBySegment = new Map<string, RawPhrase[]>();
        for (const ph of allPhrases) {
          const list = phrasesBySegment.get(ph.segment_id) || [];
          list.push(ph);
          phrasesBySegment.set(ph.segment_id, list);
        }

        const segmentsByScene = new Map<string, RawSeg[]>();
        for (const seg of serverSegments) {
          const list = segmentsByScene.get(seg.scene_id) || [];
          list.push(seg);
          segmentsByScene.set(seg.scene_id, list);
        }

        const mappingsByScene = new Map<
          string,
          Array<{ segment_type: string; character_id: string }>
        >();
        for (const m of serverMappings) {
          const list = mappingsByScene.get(m.scene_id) || [];
          list.push({
            segment_type: m.segment_type,
            character_id: m.character_id,
          });
          mappingsByScene.set(m.scene_id, list);
        }

        const sceneToChapter = new Map<string, string>();
        for (const s of allScenes) sceneToChapter.set(s.id, s.chapter_id);

        // Write storyboard files
        let restoredCount = 0;
        const writes: Promise<void>[] = [];
        for (const [sceneId, segs] of segmentsByScene) {
          const chId = sceneToChapter.get(sceneId);
          const segments = segs.map((seg) => {
            const meta = (seg.metadata as Record<string, any>) || {};
            const phrases = (phrasesBySegment.get(seg.id) || []).map((ph) => ({
              phrase_id: ph.id,
              phrase_number: ph.phrase_number,
              text: ph.text,
              annotations: (ph.metadata as any)?.annotations || undefined,
            }));
            return {
              segment_id: seg.id,
              segment_number: seg.segment_number,
              segment_type: seg.segment_type,
              speaker: seg.speaker || null,
              phrases,
              inline_narrations: meta.inline_narrations || undefined,
              split_silence_ms: meta.split_silence_ms ?? undefined,
            };
          });

          const sceneMappings = mappingsByScene.get(sceneId) || [];
          const typeMappings: LocalTypeMappingEntry[] = sceneMappings.map(
            (m) => ({
              segmentType: m.segment_type,
              characterId: m.character_id,
              characterName: "",
            }),
          );

          writes.push(
            saveStoryboardToLocal(
              storage,
              sceneId,
              {
                segments,
                typeMappings,
                audioStatus: new Map(),
                inlineNarrationSpeaker: null,
              },
              chId,
            ),
          );
          restoredCount++;
        }
        await Promise.all(writes);
        report(
          "storyboards",
          restoredCount > 0 ? "done" : "skipped",
          restoredCount > 0 ? `${restoredCount}` : undefined,
        );

        // ── 8. Scene character maps ───────────────────────────
        report("scene_maps", "running");
        if (restoredChars.length > 0) {
          const charByName = new Map<string, string>();
          for (const c of restoredChars) {
            charByName.set(c.name.toLowerCase(), c.id);
            for (const alias of c.aliases || []) {
              if (alias) charByName.set(alias.toLowerCase(), c.id);
            }
          }

          const sceneMapWrites: Promise<void>[] = [];
          for (const [sid, segs] of segmentsByScene) {
            const speakerMap = new Map<
              string,
              { characterId: string; segIds: string[] }
            >();
            for (const seg of segs) {
              if (!seg.speaker) continue;
              const cid = charByName.get(seg.speaker.toLowerCase());
              if (!cid) continue;
              const entry = speakerMap.get(cid) || {
                characterId: cid,
                segIds: [],
              };
              entry.segIds.push(seg.id);
              speakerMap.set(cid, entry);
            }

            const sceneMappings = mappingsByScene.get(sid) || [];
            const sceneCharMap: SceneCharacterMap = {
              sceneId: sid,
              updatedAt: new Date().toISOString(),
              speakers: Array.from(speakerMap.values()).map((e) => ({
                characterId: e.characterId,
                role_in_scene: "speaker" as const,
                segment_ids: e.segIds,
              })),
              typeMappings: sceneMappings.map((m) => ({
                segmentType: m.segment_type,
                characterId: m.character_id,
              })),
            };
            sceneMapWrites.push(saveSceneCharacterMap(storage, sceneCharMap));
          }
          await Promise.all(sceneMapWrites);
          report("scene_maps", "done", `${sceneMapWrites.length}`);
        } else {
          report("scene_maps", "skipped");
        }

        console.log(
          `[Deploy] ✅ ${restoredCount} storyboards, ${allPhrases.length} phrases, ${serverMappings.length} mappings`,
        );
      } else {
        report("storyboards", "skipped");
        report("scene_maps", "skipped");
      }
    } else {
      report("storyboards", "skipped");
      report("scene_maps", "skipped");
    }
  } catch (err) {
    console.warn("[Deploy] Failed to restore storyboards:", err);
    report("storyboards", "error");
  }

  // ── 9. Source file ────────────────────────────────────────
  report("source_file", "running");
  if (pdfBlob) {
    const sourcePath = getSourcePath(bookFormat);
    try {
      await storage.writeBlob(sourcePath, pdfBlob);
    } catch (err) {
      console.warn("[Deploy] Failed to save source file:", err);
    }
  }

  try {
    const projMeta = await storage.readJSON<Record<string, unknown>>(
      "project.json",
    );
    if (projMeta) {
      projMeta.fileFormat = bookFormat;
      projMeta.updatedAt = new Date().toISOString();
      await storage.writeJSON("project.json", projMeta);
    }
  } catch {}
  report("source_file", "done");

  // ── 10. Finalize ──────────────────────────────────────────
  report("finalize", "done");

  return { toc, chapterIdMap, partIdMap, chapterResults, pdfProxy, totalPages };
}
