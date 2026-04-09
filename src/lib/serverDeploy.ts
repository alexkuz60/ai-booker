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
import { detectFileFormat, stripFileExtension } from "@/lib/fileFormatUtils";
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
  /** Whether to download IR audio files into global OPFS cache */
  downloadImpulses?: boolean;
  /** Whether to download atmosphere audio files into OPFS cache */
  downloadAtmosphere?: boolean;
  /** Whether to download SFX audio files into OPFS cache */
  downloadSfx?: boolean;
  /** User ID for downloading per-user audio assets */
  userId?: string;
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
  downloadImpulses = false,
  downloadAtmosphere = false,
  downloadSfx = false,
  
  userId: paramUserId,
}: DeployParams): Promise<DeployResult> {
  // ── 1. Fetch structure (parts + chapters) ─────────────────
  // NOTE: Source file is NEVER downloaded from server.
  // It must be preserved from the local OPFS project before wipe.
  report("fetch_structure", "running");
  const [partsRes, chaptersRes] = await Promise.all([
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
  ]);

  const parts = partsRes.data || [];
  const chapters = chaptersRes.data || [];

  if (chapters.length === 0) {
    report("fetch_structure", "error", isRu ? "Нет глав" : "No chapters");
    throw new Error(isRu ? "Нет глав на сервере" : "No chapters found on server");
  }
  report("fetch_structure", "done", `${chapters.length}`);


  // ── 2. PDF parsing disabled — source file no longer stored in OPFS ──
  const bookFormat = detectFileFormat(book.file_name);
  const pdfProxy: any = null;
  const totalPages = 0;
  const tocFromPdf: { startPage: number; endPage: number; level: number }[] = [];
  report("parse_pdf", "skipped");

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

        const hasProfile = !!(sc.description || sc.temperament || sc.speech_style);
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
          // Reconstruct nested profile from top-level fields for UI compat
          profile: hasProfile ? {
            age_group: sc.age_group || "unknown",
            temperament: sc.temperament || undefined,
            speech_style: sc.speech_style || undefined,
            description: sc.description || undefined,
            speech_tags: sc.speech_tags || [],
            psycho_tags: sc.psycho_tags || [],
          } : undefined,
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

  // ── 8a. Restore audio metadata from DB to OPFS ─────────────
  report("audio_meta", "running");
  let restoredAudioCount = 0;
  try {
    const allSceneIdsForAudio = allScenes.map(s => s.id);
    if (allSceneIdsForAudio.length > 0) {
      // Fetch all segment IDs for these scenes
      type RawSegId = { id: string; scene_id: string };
      const allSegRefs = await fetchChunked<RawSegId>(
        "scene_segments",
        "id, scene_id",
        "scene_id",
        allSceneIdsForAudio,
        500,
      );
      const allSegIds = allSegRefs.map(s => s.id);

      if (allSegIds.length > 0) {
        type RawAudio = {
          segment_id: string;
          status: string;
          duration_ms: number;
          audio_path: string;
          voice_config: any;
        };
        const serverAudio = await fetchChunked<RawAudio>(
          "segment_audio",
          "segment_id, status, duration_ms, audio_path, voice_config",
          "segment_id",
          allSegIds,
          500,
        );

        if (serverAudio.length > 0) {
          const { writeAudioMeta } = await import("@/lib/localAudioMeta");
          type LocalAudioEntry = import("@/lib/localAudioMeta").LocalAudioEntry;

          // Group by scene_id (reverse lookup via fetched segment refs)
          const segToScene = new Map<string, string>();
          for (const ref of allSegRefs) {
            segToScene.set(ref.id, ref.scene_id);
          }

          const audioByScene = new Map<string, Record<string, LocalAudioEntry>>();
          for (const a of serverAudio) {
            if (a.status !== "ready") continue;
            const sid = segToScene.get(a.segment_id);
            if (!sid) continue;
            const entries = audioByScene.get(sid) || {};
            entries[a.segment_id] = {
              segmentId: a.segment_id,
              status: a.status,
              durationMs: a.duration_ms,
              audioPath: a.audio_path,
              voiceConfig: a.voice_config as Record<string, unknown>,
            };
            audioByScene.set(sid, entries);
          }

          const audioWrites: Promise<void>[] = [];
          for (const [sid, entries] of audioByScene) {
            const chId = allScenes.find(s => s.id === sid)?.chapter_id;
            audioWrites.push(writeAudioMeta(storage, sid, entries, chId));
          }
          await Promise.all(audioWrites);
          restoredAudioCount = serverAudio.filter(a => a.status === "ready").length;
          console.log(`[Deploy] Restored ${restoredAudioCount} audio metadata entries`);
        }
      }
    }
  } catch (err) {
    console.warn("[Deploy] Failed to restore audio metadata:", err);
  }
  report("audio_meta", restoredAudioCount > 0 ? "done" : "skipped", restoredAudioCount > 0 ? `${restoredAudioCount}` : undefined);

  // ── 8b. Restore clip plugin configs from DB to OPFS ───────
  report("clip_plugins", "running");
  let restoredPluginCount = 0;
  try {
    const allSceneIdsForPlugins = allScenes.map(s => s.id);
    if (allSceneIdsForPlugins.length > 0) {
      type RawPluginCfg = {
        scene_id: string;
        clip_id: string;
        track_id: string;
        config: any;
      };
      const serverPlugins = await fetchChunked<RawPluginCfg>(
        "clip_plugin_configs",
        "scene_id, clip_id, track_id, config",
        "scene_id",
        allSceneIdsForPlugins,
        200,
      );

      if (serverPlugins.length > 0) {
        const { writeClipPlugins } = await import("@/lib/localClipPlugins");

        const pluginsByScene = new Map<string, Record<string, { trackId: string; config: any }>>();
        for (const p of serverPlugins) {
          const entries = pluginsByScene.get(p.scene_id) || {};
          entries[p.clip_id] = { trackId: p.track_id, config: p.config };
          pluginsByScene.set(p.scene_id, entries);
        }

        const pluginWrites: Promise<void>[] = [];
        for (const [sid, configs] of pluginsByScene) {
          const chId = allScenes.find(s => s.id === sid)?.chapter_id;
          pluginWrites.push(writeClipPlugins(storage, sid, configs, chId));
        }
        await Promise.all(pluginWrites);
        restoredPluginCount = serverPlugins.length;
        console.log(`[Deploy] Restored ${restoredPluginCount} clip plugin configs`);
      }
    }
  } catch (err) {
    console.warn("[Deploy] Failed to restore clip plugins:", err);
  }
  report("clip_plugins", restoredPluginCount > 0 ? "done" : "skipped", restoredPluginCount > 0 ? `${restoredPluginCount}` : undefined);

  // ── 8b2. Restore mixer state from user_settings to OPFS ────
  report("mixer_state", "running");
  let restoredMixerCount = 0;
  try {
    const { data: mixerSettings } = await supabase
      .from("user_settings")
      .select("setting_key, setting_value")
      .like("setting_key", "mixer-scene-%");

    if (mixerSettings && mixerSettings.length > 0) {
      const { writeMixerState } = await import("@/lib/localMixerState");
      type SceneMixerSnapshot = import("@/lib/localMixerState").SceneMixerSnapshot;

      const allSceneIdSet = new Set(allScenes.map(s => s.id));
      const writes: Promise<void>[] = [];

      for (const row of mixerSettings) {
        const sid = row.setting_key.replace("mixer-scene-", "");
        if (!allSceneIdSet.has(sid)) continue;
        const snapshot = row.setting_value as unknown as SceneMixerSnapshot;
        if (!snapshot || Object.keys(snapshot).length === 0) continue;
        const chId = allScenes.find(s => s.id === sid)?.chapter_id;
        writes.push(writeMixerState(storage, sid, snapshot, chId));
        restoredMixerCount++;
      }
      await Promise.all(writes);
      console.log(`[Deploy] Restored ${restoredMixerCount} mixer state snapshots`);
    }
  } catch (err) {
    console.warn("[Deploy] Failed to restore mixer state:", err);
  }
  report("mixer_state", restoredMixerCount > 0 ? "done" : "skipped", restoredMixerCount > 0 ? `${restoredMixerCount}` : undefined);

  // ── 8c. Restore atmosphere clips from DB to OPFS ──────────
  report("atmospheres", "running");
  let restoredAtmoCount = 0;
  try {
    const allSceneIdsForAtmo = allScenes.map(s => s.id);
    if (allSceneIdsForAtmo.length > 0) {
      type RawAtmo = {
        id: string;
        scene_id: string;
        layer_type: string;
        audio_path: string;
        duration_ms: number;
        volume: number;
        fade_in_ms: number;
        fade_out_ms: number;
        offset_ms: number;
        prompt_used: string;
        speed: number;
        created_at: string;
      };
      const serverAtmo = await fetchChunked<RawAtmo>(
        "scene_atmospheres",
        "id, scene_id, layer_type, audio_path, duration_ms, volume, fade_in_ms, fade_out_ms, offset_ms, prompt_used, speed, created_at",
        "scene_id",
        allSceneIdsForAtmo,
        500,
      );

      if (serverAtmo.length > 0) {
        const { saveAtmospheresToLocal } = await import("@/lib/localAtmospheres");
        type LocalAtmoClip = import("@/lib/localAtmospheres").LocalAtmosphereClip;

        // Group by scene_id and split by layer_type
        const atmoByScene = new Map<string, { atmo: LocalAtmoClip[]; sfx: LocalAtmoClip[] }>();
        for (const a of serverAtmo) {
          const entry = atmoByScene.get(a.scene_id) || { atmo: [], sfx: [] };
          const clip: LocalAtmoClip = {
            id: a.id,
            layer_type: a.layer_type,
            audio_path: a.audio_path,
            duration_ms: a.duration_ms,
            volume: a.volume,
            fade_in_ms: a.fade_in_ms,
            fade_out_ms: a.fade_out_ms,
            offset_ms: a.offset_ms,
            prompt_used: a.prompt_used,
            speed: a.speed ?? 1,
            created_at: a.created_at,
          };
          if (a.layer_type === "sfx") entry.sfx.push(clip);
          else entry.atmo.push(clip);
          atmoByScene.set(a.scene_id, entry);
        }

        const atmoWrites: Promise<void>[] = [];
        for (const [sid, sections] of atmoByScene) {
          const chId = allScenes.find(s => s.id === sid)?.chapter_id;
          atmoWrites.push(saveAtmospheresToLocal(storage, sid, sections.atmo, sections.sfx, chId));
        }
        await Promise.all(atmoWrites);
        restoredAtmoCount = serverAtmo.length;
        console.log(`[Deploy] Restored ${restoredAtmoCount} atmosphere clips`);
      }
    }
  } catch (err) {
    console.warn("[Deploy] Failed to restore atmospheres:", err);
  }
  report("atmospheres", restoredAtmoCount > 0 ? "done" : "skipped", restoredAtmoCount > 0 ? `${restoredAtmoCount}` : undefined);

  if (downloadImpulses) {
    report("download_ir", "running");
    try {
      // Extract unique impulseIds from clip_plugin_configs for this book's scenes
      const allSceneIds: string[] = [];
      for (const [, result] of chapterResults) {
        for (const sc of result.scenes) {
          if (sc.id) allSceneIds.push(sc.id);
        }
      }

      if (allSceneIds.length > 0) {
        const configs = await fetchChunked<{ config: any }>(
          "clip_plugin_configs",
          "config",
          "scene_id",
          allSceneIds,
          50,
        );

        const impulseIds = new Set<string>();
        for (const c of configs) {
          const cfg = c.config as Record<string, any>;
          const convolver = cfg?.convolver;
          if (convolver?.impulseId) {
            impulseIds.add(convolver.impulseId);
          }
        }

        if (impulseIds.size > 0) {
          const { downloadIrBatch } = await import("@/lib/irCache");
          const ids = Array.from(impulseIds);
          const downloaded = await downloadIrBatch(ids, (done, total) => {
            report("download_ir", "running", `${done}/${total}`);
          });

          // Save manifest to project.json
          try {
            const projMeta = await storage.readJSON<Record<string, unknown>>("project.json");
            if (projMeta) {
              projMeta.usedImpulseIds = ids;
              const { sanitizeProjectMeta } = await import("@/lib/projectStorage");
              await storage.writeJSON("project.json", sanitizeProjectMeta(projMeta));
            }
          } catch {}

          report("download_ir", "done", `${downloaded}`);
          console.log(`[Deploy] Downloaded ${downloaded} IR files`);
        } else {
          report("download_ir", "skipped");
        }
      } else {
        report("download_ir", "skipped");
      }
    } catch (err) {
      console.warn("[Deploy] IR download failed:", err);
      report("download_ir", "error");
    }
  } else {
    report("download_ir", "skipped");
  }

  // ── 8c. Download atmosphere audio into project OPFS ────────
  if (downloadAtmosphere || downloadSfx) {
    report("download_atmo", "running");
    try {
      const { downloadAtmosphereFromServer } = await import("@/lib/audioAssetCache");
      const { readAtmospheresFromLocal, saveAtmospheresToLocal } = await import("@/lib/localAtmospheres");

      let totalDownloaded = 0;
      // Gather all scene IDs from deployed chapters
      const deployedSceneIds: { sceneId: string; chapterId: string }[] = [];
      for (const [chIdx, result] of chapterResults) {
        const chId = chapterIdMap.get(chIdx);
        if (!chId) continue;
        for (const sc of result.scenes) {
          if (sc.id) deployedSceneIds.push({ sceneId: sc.id, chapterId: chId });
        }
      }

      for (let i = 0; i < deployedSceneIds.length; i++) {
        const { sceneId: sid, chapterId: chId } = deployedSceneIds[i];
        const atmoData = await readAtmospheresFromLocal(storage, sid, chId);
        if (!atmoData) continue;
        const allClips = [...atmoData.atmo, ...atmoData.sfx];
        if (allClips.length === 0) continue;

        let changed = false;
        for (const clip of allClips) {
          // Skip clips that already have project-relative OPFS paths
          if (clip.audio_path.startsWith("chapters/")) continue;
          // Skip if category doesn't match download flags
          const isSfx = clip.layer_type === "sfx";
          if (isSfx && !downloadSfx) continue;
          if (!isSfx && !downloadAtmosphere) continue;

          const opfsPath = await downloadAtmosphereFromServer(clip.audio_path);
          if (opfsPath) {
            clip.audio_path = opfsPath;
            changed = true;
            totalDownloaded++;
          }
        }

        if (changed) {
          await saveAtmospheresToLocal(storage, sid, atmoData.atmo, atmoData.sfx, chId);
        }
        report("download_atmo", "running", `${totalDownloaded}`);
      }

      report("download_atmo", totalDownloaded > 0 ? "done" : "skipped", totalDownloaded > 0 ? `${totalDownloaded}` : undefined);
    } catch (err) {
      console.warn("[Deploy] Atmosphere/SFX download failed:", err);
      report("download_atmo", "error");
    }
  } else {
    report("download_atmo", "skipped");
  }
  report("download_sfx", downloadSfx ? "done" : "skipped");

  // ── 9. Source metadata (no blob storage) ──
  report("source_file", "running");
  try {
    const projMeta = await storage.readJSON<Record<string, unknown>>(
      "project.json",
    );
    if (projMeta) {
      const { sanitizeProjectMeta } = await import("@/lib/projectStorage");
      await storage.writeJSON("project.json", sanitizeProjectMeta({
        ...projMeta,
        fileFormat: bookFormat,
        source: {
          title: book.title || "",
          fileName: book.file_name || "",
          format: bookFormat,
        },
        updatedAt: new Date().toISOString(),
      }));
    }
  } catch {}
  report("source_file", "done");

  // ── 10. Restore translation backup from Storage ──────────
  report("translation", "running");
  try {
    const deployUserId = paramUserId || "";
    if (deployUserId && book.id) {
      const { restoreTranslationBackup } = await import("@/lib/translationBackup");
      const transResult = await restoreTranslationBackup(
        storage,
        book.id,
        deployUserId,
        (detail) => report("translation", "running", detail),
      );
      report(
        "translation",
        transResult.fileCount > 0 ? "done" : "skipped",
        transResult.fileCount > 0 ? `${transResult.fileCount} files, ${transResult.langs.join(",")}` : undefined,
      );
    } else {
      report("translation", "skipped");
    }
  } catch (err) {
    console.warn("[Deploy] Translation restore failed:", err);
    report("translation", "error");
  }

  // ── 11. Finalize ──────────────────────────────────────────
  report("finalize", "done");

  return { toc, chapterIdMap, partIdMap, chapterResults, pdfProxy, totalPages };
}
