import { useState, useEffect, useMemo, useRef, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useProjectStorageContext } from "@/hooks/useProjectStorageContext";
import { readStructureFromLocal } from "@/lib/localSync";
import { clearStemCache } from "@/lib/stemCache";
import type { TimelineClip, SceneBoundary } from "@/hooks/useTimelineClips";

// ─── Types ──────────────────────────────────────────────────
export interface SceneRender {
  id: string;
  scene_id: string;
  voice_path: string | null;
  atmo_path: string | null;
  sfx_path: string | null;
  voice_duration_ms: number;
  atmo_duration_ms: number;
  sfx_duration_ms: number;
  status: string;
}

export interface SceneOption {
  id: string;
  title: string;
  scene_number: number;
}

export interface StemTrack {
  id: string;
  label: string;
  color: string;
}

export function getStemTracks(isRu: boolean): StemTrack[] {
  return [
    { id: "voice", label: isRu ? "Голос" : "Voice", color: "hsl(var(--primary))" },
    { id: "atmosphere", label: isRu ? "Атмосфера" : "Atmosphere", color: "hsl(175 45% 45%)" },
    { id: "sfx", label: isRu ? "Звуки" : "SFX", color: "hsl(220 50% 55%)" },
  ];
}

export interface MontagePart {
  id: string;
  chapter_id: string;
  part_number: number;
  scene_ids: string[];
  user_id: string;
}


const LS_KEY = "montage_last_context";

interface MontageContext {
  bookId: string;
  bookTitle: string;
  chapterId: string;
  chapterTitle: string;
}

function saveContext(ctx: MontageContext) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(ctx)); } catch { /* ignore */ }
}

function loadContext(): MontageContext | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

// ─── Hook ───────────────────────────────────────────────────
export function useMontageData() {
  const { user } = useAuth();

  const [bookId, setBookId] = useState<string | null>(null);
  const [bookTitle, setBookTitle] = useState<string>("");
  const [chapterId, setChapterId] = useState<string | null>(null);
  const [chapterTitle, setChapterTitle] = useState<string>("");
  const [scenes, setScenes] = useState<SceneOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sceneRenders, setSceneRenders] = useState<SceneRender[]>([]);

  // ── Parts state ──
  const [parts, setParts] = useState<MontagePart[]>([]);
  const [activePartIdx, setActivePartIdx] = useState(0);

  const prevChapterIdRef = useRef<string | null>(null);

  // ── Resolve context ──
  useEffect(() => {
    const studioBookId = sessionStorage.getItem("montage_book_id");
    const studioChapterId = sessionStorage.getItem("montage_chapter_id");

    if (studioBookId && studioChapterId) {
      sessionStorage.removeItem("montage_book_id");
      sessionStorage.removeItem("montage_chapter_id");
      setBookId(studioBookId);
      setChapterId(studioChapterId);
      fetchTitles(studioBookId, studioChapterId);
    } else {
      const saved = loadContext();
      if (saved) {
        setBookId(saved.bookId);
        setBookTitle(saved.bookTitle);
        setChapterId(saved.chapterId);
        setChapterTitle(saved.chapterTitle);
      }
    }
    setLoading(false);
  }, []);

  // ── Clear stem cache when chapter changes ──
  useEffect(() => {
    if (chapterId && prevChapterIdRef.current && chapterId !== prevChapterIdRef.current) {
      clearStemCache();
    }
    prevChapterIdRef.current = chapterId;
  }, [chapterId]);

  async function fetchTitles(bId: string, cId: string) {
    const [bookRes, chapterRes] = await Promise.all([
      supabase.from("books").select("title").eq("id", bId).single(),
      supabase.from("book_chapters").select("title").eq("id", cId).single(),
    ]);
    const bTitle = bookRes.data?.title ?? "";
    const cTitle = chapterRes.data?.title ?? "";
    setBookTitle(bTitle);
    setChapterTitle(cTitle);
    saveContext({ bookId: bId, bookTitle: bTitle, chapterId: cId, chapterTitle: cTitle });
  }

  // Load scenes
  useEffect(() => {
    if (!chapterId) { setScenes([]); return; }
    (async () => {
      const { data } = await supabase.from("book_scenes").select("id, title, scene_number, silence_sec").eq("chapter_id", chapterId).order("scene_number");
      setScenes(data ?? []);
    })();
  }, [chapterId]);

  const sceneIds = useMemo(() => scenes.map(s => s.id), [scenes]);

  // Load scene renders
  useEffect(() => {
    if (sceneIds.length === 0) { setSceneRenders([]); return; }
    (async () => {
      const { data } = await supabase
        .from("scene_renders")
        .select("id, scene_id, voice_path, atmo_path, sfx_path, voice_duration_ms, atmo_duration_ms, sfx_duration_ms, status")
        .in("scene_id", sceneIds)
        .eq("status", "ready");
      setSceneRenders((data ?? []) as SceneRender[]);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIds.join(",")]);

  // ── Load montage parts ──
  useEffect(() => {
    if (!chapterId) { setParts([]); setActivePartIdx(0); return; }
    (async () => {
      const { data } = await supabase
        .from("montage_parts")
        .select("*")
        .eq("chapter_id", chapterId)
        .order("part_number");
      setParts((data ?? []) as MontagePart[]);
      setActivePartIdx(0);
    })();
  }, [chapterId]);

  // Renders map
  const rendersMap = useMemo(() => {
    const m = new Map<string, SceneRender>();
    for (const r of sceneRenders) m.set(r.scene_id, r);
    return m;
  }, [sceneRenders]);

  const renderedSceneIds = useMemo(() => sceneIds.filter(id => rendersMap.has(id)), [sceneIds, rendersMap]);
  const unrenderedSceneIds = useMemo(() => sceneIds.filter(id => !rendersMap.has(id)), [sceneIds, rendersMap]);

  // ── Active scene IDs (filtered by part if parts exist) ──
  const activeSceneIds = useMemo(() => {
    if (parts.length === 0) return sceneIds; // no parts = show all
    const part = parts[activePartIdx];
    if (!part) return sceneIds;
    return part.scene_ids;
  }, [parts, activePartIdx, sceneIds]);

  // Build timeline clips from rendered stems (using active scene IDs)
  const { clips, sceneBoundaries, totalDurationSec } = useMemo(() => {
    const clips: TimelineClip[] = [];
    const boundaries: SceneBoundary[] = [];
    let offset = 0;

    for (const sceneId of activeSceneIds) {
      const render = rendersMap.get(sceneId);
      if (!render) continue;

      const silenceSec = 2;
      boundaries.push({ startSec: offset, silenceSec, sceneId });
      const sceneStart = offset + silenceSec;

      if (render.voice_path && render.voice_duration_ms > 0) {
        clips.push({
          id: `voice-${sceneId}`, trackId: "voice", speaker: null,
          startSec: sceneStart, durationSec: render.voice_duration_ms / 1000,
          label: scenes.find(s => s.id === sceneId)?.title ?? "Voice",
          segmentType: "voice_stem", hasAudio: true,
          audioPath: render.voice_path, sceneId,
        });
      }

      if (render.atmo_path && render.atmo_duration_ms > 0) {
        clips.push({
          id: `atmo-${sceneId}`, trackId: "atmosphere", speaker: null,
          startSec: sceneStart, durationSec: render.atmo_duration_ms / 1000,
          label: scenes.find(s => s.id === sceneId)?.title ?? "Atmo",
          segmentType: "atmo_stem", hasAudio: true,
          audioPath: render.atmo_path, sceneId,
        });
      }

      if (render.sfx_path && render.sfx_duration_ms > 0) {
        clips.push({
          id: `sfx-${sceneId}`, trackId: "sfx", speaker: null,
          startSec: sceneStart, durationSec: render.sfx_duration_ms / 1000,
          label: scenes.find(s => s.id === sceneId)?.title ?? "SFX",
          segmentType: "sfx_stem", hasAudio: true,
          audioPath: render.sfx_path, sceneId,
        });
      }

      const maxDur = Math.max(render.voice_duration_ms, render.atmo_duration_ms, render.sfx_duration_ms) / 1000;
      offset = sceneStart + maxDur;
    }

    return { clips, sceneBoundaries: boundaries, totalDurationSec: offset };
  }, [activeSceneIds, rendersMap, scenes]);

  // ── Split chapter at transport position ──
  const splitAtScene = useCallback(async (splitAfterSceneId: string) => {
    if (!chapterId || !user) return;

    const splitIdx = sceneIds.indexOf(splitAfterSceneId);
    if (splitIdx < 0 || splitIdx >= sceneIds.length - 1) return; // can't split at last scene

    const beforeIds = sceneIds.slice(0, splitIdx + 1);
    const afterIds = sceneIds.slice(splitIdx + 1);

    if (parts.length === 0) {
      // First split: create 2 parts
      const { data } = await supabase
        .from("montage_parts")
        .upsert([
          { chapter_id: chapterId, part_number: 1, scene_ids: beforeIds, user_id: user.id },
          { chapter_id: chapterId, part_number: 2, scene_ids: afterIds, user_id: user.id },
        ], { onConflict: "chapter_id,part_number" })
        .select();
      setParts((data ?? []) as MontagePart[]);
    } else {
      // Find which existing part contains the split scene, split it
      const partIdx = parts.findIndex(p => p.scene_ids.includes(splitAfterSceneId));
      if (partIdx < 0) return;

      const part = parts[partIdx];
      const sceneIdxInPart = part.scene_ids.indexOf(splitAfterSceneId);
      if (sceneIdxInPart < 0 || sceneIdxInPart >= part.scene_ids.length - 1) return;

      const keepIds = part.scene_ids.slice(0, sceneIdxInPart + 1);
      const newPartIds = part.scene_ids.slice(sceneIdxInPart + 1);

      // Update current part, shift all subsequent parts, insert new
      const newParts = [...parts];
      newParts[partIdx] = { ...part, scene_ids: keepIds };

      // Insert new part after current
      const insertedPart: MontagePart = {
        id: crypto.randomUUID(),
        chapter_id: chapterId,
        part_number: partIdx + 2,
        scene_ids: newPartIds,
        user_id: user.id,
      };

      // Shift subsequent parts
      for (let i = partIdx + 1; i < newParts.length; i++) {
        newParts[i] = { ...newParts[i], part_number: newParts[i].part_number + 1 };
      }
      newParts.splice(partIdx + 1, 0, insertedPart);

      // Re-number and save all
      const upsertData = newParts.map((p, i) => ({
        chapter_id: chapterId,
        part_number: i + 1,
        scene_ids: p.scene_ids,
        user_id: user.id,
      }));

      // Delete all existing parts for this chapter, then insert fresh
      await supabase.from("montage_parts").delete().eq("chapter_id", chapterId);
      const { data } = await supabase
        .from("montage_parts")
        .insert(upsertData)
        .select();
      setParts((data ?? []) as MontagePart[]);
    }
  }, [chapterId, user, sceneIds, parts]);

  // ── Remove all parts (merge back) ──
  const removeParts = useCallback(async () => {
    if (!chapterId) return;
    await supabase.from("montage_parts").delete().eq("chapter_id", chapterId);
    setParts([]);
    setActivePartIdx(0);
  }, [chapterId]);

  return {
    bookId, bookTitle,
    chapterId, chapterTitle,
    scenes, sceneIds, loading,
    renderedSceneIds, unrenderedSceneIds,
    clips, sceneBoundaries, totalDurationSec,
    // Parts
    parts, activePartIdx, setActivePartIdx,
    splitAtScene, removeParts,
    activeSceneIds,
  };
}
