import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
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

export interface BookOption {
  id: string;
  title: string;
}

export interface ChapterOption {
  id: string;
  title: string;
  chapter_number: number;
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

export const STEM_TRACKS: StemTrack[] = [
  { id: "voice", label: "Voice", color: "hsl(var(--primary))" },
  { id: "atmosphere", label: "Atmosphere", color: "hsl(175 45% 45%)" },
  { id: "sfx", label: "SFX", color: "hsl(220 50% 55%)" },
];

// ─── Hook ───────────────────────────────────────────────────
export function useMontageData() {
  const { user } = useAuth();

  const [books, setBooks] = useState<BookOption[]>([]);
  const [selectedBookId, setSelectedBookId] = useState<string | null>(null);
  const [chapters, setChapters] = useState<ChapterOption[]>([]);
  const [selectedChapterId, setSelectedChapterId] = useState<string | null>(null);
  const [scenes, setScenes] = useState<SceneOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [sceneRenders, setSceneRenders] = useState<SceneRender[]>([]);
  const [rendersLoading, setRendersLoading] = useState(false);

  // Restore from sessionStorage
  useEffect(() => {
    const studioBookId = sessionStorage.getItem("montage_book_id");
    const studioChapterId = sessionStorage.getItem("montage_chapter_id");
    if (studioBookId) { setSelectedBookId(studioBookId); sessionStorage.removeItem("montage_book_id"); }
    if (studioChapterId) { setSelectedChapterId(studioChapterId); sessionStorage.removeItem("montage_chapter_id"); }
  }, []);

  // Load books
  useEffect(() => {
    if (!user) return;
    (async () => {
      const { data } = await supabase.from("books").select("id, title").eq("user_id", user.id).order("updated_at", { ascending: false });
      setBooks(data ?? []);
      setLoading(false);
    })();
  }, [user?.id]);

  // Load chapters
  useEffect(() => {
    if (!selectedBookId) { setChapters([]); setSelectedChapterId(null); return; }
    (async () => {
      const { data } = await supabase.from("book_chapters").select("id, title, chapter_number").eq("book_id", selectedBookId).order("chapter_number");
      setChapters(data ?? []);
    })();
  }, [selectedBookId]);

  // Load scenes
  useEffect(() => {
    if (!selectedChapterId) { setScenes([]); return; }
    (async () => {
      const { data } = await supabase.from("book_scenes").select("id, title, scene_number, silence_sec").eq("chapter_id", selectedChapterId).order("scene_number");
      setScenes(data ?? []);
    })();
  }, [selectedChapterId]);

  const sceneIds = useMemo(() => scenes.map(s => s.id), [scenes]);

  // Load scene renders
  useEffect(() => {
    if (sceneIds.length === 0) { setSceneRenders([]); return; }
    setRendersLoading(true);
    (async () => {
      const { data } = await supabase
        .from("scene_renders")
        .select("id, scene_id, voice_path, atmo_path, sfx_path, voice_duration_ms, atmo_duration_ms, sfx_duration_ms, status")
        .in("scene_id", sceneIds)
        .eq("status", "ready");
      setSceneRenders((data ?? []) as SceneRender[]);
      setRendersLoading(false);
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sceneIds.join(",")]);

  // Renders map
  const rendersMap = useMemo(() => {
    const m = new Map<string, SceneRender>();
    for (const r of sceneRenders) m.set(r.scene_id, r);
    return m;
  }, [sceneRenders]);

  const renderedSceneIds = useMemo(() => sceneIds.filter(id => rendersMap.has(id)), [sceneIds, rendersMap]);
  const unrenderedSceneIds = useMemo(() => sceneIds.filter(id => !rendersMap.has(id)), [sceneIds, rendersMap]);

  // Build timeline clips from rendered stems
  const { clips, sceneBoundaries, totalDurationSec } = useMemo(() => {
    const clips: TimelineClip[] = [];
    const boundaries: SceneBoundary[] = [];
    let offset = 0;

    for (const sceneId of sceneIds) {
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
  }, [sceneIds, rendersMap, scenes]);

  const selectedBook = books.find(b => b.id === selectedBookId);
  const selectedChapter = chapters.find(c => c.id === selectedChapterId);

  return {
    books, selectedBookId, setSelectedBookId,
    chapters, selectedChapterId, setSelectedChapterId,
    scenes, sceneIds, loading, rendersLoading,
    renderedSceneIds, unrenderedSceneIds,
    clips, sceneBoundaries, totalDurationSec,
    selectedBook, selectedChapter,
  };
}
