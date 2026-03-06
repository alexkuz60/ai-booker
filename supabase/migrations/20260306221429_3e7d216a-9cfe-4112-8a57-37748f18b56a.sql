
-- Store synthesized audio per segment
CREATE TABLE public.segment_audio (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  segment_id uuid NOT NULL REFERENCES public.scene_segments(id) ON DELETE CASCADE,
  audio_path text NOT NULL,
  duration_ms integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending',
  voice_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (segment_id)
);

ALTER TABLE public.segment_audio ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own segment audio"
  ON public.segment_audio
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM scene_segments seg
      JOIN book_scenes s ON s.id = seg.scene_id
      JOIN book_chapters c ON c.id = s.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE seg.id = segment_audio.segment_id
        AND b.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM scene_segments seg
      JOIN book_scenes s ON s.id = seg.scene_id
      JOIN book_chapters c ON c.id = s.chapter_id
      JOIN books b ON b.id = c.book_id
      WHERE seg.id = segment_audio.segment_id
        AND b.user_id = auth.uid()
    )
  );
